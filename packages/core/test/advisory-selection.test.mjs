import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { parseDesignAdvisory } = await import('../src/design-advisory.ts')
const { parseDesignJournalAdvisorySelection, foldDesignJournal, DESIGN_JOURNAL_SCHEMA_VERSION } = await import('../src/design-journal.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const { DesignAdvisoryJournal } = await import('../src/design-advisory-journal.ts')

const advisory = (profile = 'alignment', actionSpec) => ({
  schemaVersion: 2, id: 'advice-1', profile: `design.${profile}/v1`, resultRef: 'result-1',
  inputs: [{ source: 'design', revision: 'c1' }], kind: 'suggestion', attention: 'human-review',
  summary: 'Review finding', items: [{ id: 'entity-1', title: 'Review item', detail: 'Check this item', references: [] }],
  acceptanceInstruction: 'Accept then choose a follow-up', blocksConversation: false, authorizesDesignWrite: false,
  actionSpec: actionSpec ?? { kind: 'review-choice', profile, entityRefs: ['entity-1'] },
})
const action = (skillName = 'any-bundle', entityRefs = ['entity-1']) => ({
  actionId: `bundle:${skillName}`, target: { kitName: 'fixture', kitVersion: '1.0', skillName, bundleVersion: '1.0', entityRefs },
})
const request = (entry, kind = 'bundle', extra = {}) => ({
  advisoryId: entry.advisory.id, acceptanceReceiptId: entry.acceptanceReceiptId,
  kind, reason: 'This is the suitable next action', ...extra,
})
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'review-selection-'))
  try { await run(new DesignAdvisoryJournal(new DesignJournalStorage(root)), new DesignJournalStorage(root), root) }
  finally { await rm(root, { recursive: true, force: true }) }
}
async function accepted(journal, conversation = 'conv', profile = 'alignment') {
  await journal.publish(conversation, advisory(profile))
  return (await journal.decide(conversation, { advisoryId: 'advice-1', decision: 'accepted' }))[0]
}

test('review-choice and selection parsers preserve strict bounded contracts', () => {
  assert.equal(parseDesignAdvisory(advisory()).actionSpec.kind, 'review-choice')
  assert.throws(() => parseDesignAdvisory(advisory('grounding')), /profile/)
  assert.throws(() => parseDesignAdvisory(advisory('alignment', { kind: 'review-choice', profile: 'alignment', entityRefs: [], extra: true })), /fields/)
  const base = { advisoryId: 'advice-1', acceptanceReceiptId: 'accept-1', kind: 'bundle', reason: 'Reason', actions: [{ ...action(), receiptId: 'action-1' }] }
  assert.equal(parseDesignJournalAdvisorySelection(base).actions.length, 1)
  assert.throws(() => parseDesignJournalAdvisorySelection({ ...base, actions: [] }), /exactly one/)
  assert.throws(() => parseDesignJournalAdvisorySelection({ ...base, kind: 'no-action' }), /require none/)
  assert.throws(() => parseDesignJournalAdvisorySelection({ ...base, reason: '' }), /reason/)
})

test('acceptance mints no authority; Bundle selection survives restart and uses existing attempt CAS', () => fixture(async (journal, storage, root) => {
  const entry = await accepted(journal)
  assert.deepEqual(entry.actionReceipts, [])
  assert.equal(entry.selection, undefined)
  await assert.rejects(journal.claimActionExecution('conv', { receiptId: entry.acceptanceReceiptId, proposedInvocationId: 'invoke-1' }), /unknown action/)
  const selected = await journal.selectReviewAction('conv', request(entry), action())
  assert.equal(selected.actionReceipts.length, 1)
  assert.equal(selected.selection.acceptanceReceiptId, entry.acceptanceReceiptId)
  const receiptId = selected.actionReceipts[0].receiptId
  assert.notEqual(receiptId, entry.acceptanceReceiptId)
  const restarted = new DesignAdvisoryJournal(new DesignJournalStorage(root))
  const revision = (await storage.read('conv')).revision
  assert.equal((await restarted.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: 0 }), action())).actionReceipts[0].receiptId, receiptId)
  assert.equal((await storage.read('conv')).revision, revision)
  await assert.rejects(restarted.selectReviewAction('conv', request(entry), action('different')), /cannot change/)
  await assert.rejects(restarted.selectReviewAction('conv', request(entry, 'no-action')), /cannot change/)
  await assert.rejects(restarted.selectReviewAction('conv', request(entry, 'bundle', { reason: 'Changed reason' }), action()), /cannot change/)
  const claim = await restarted.claimActionExecution('conv', { receiptId, proposedInvocationId: 'invoke-1' })
  assert.equal(claim.claimed, true)
  assert.equal((await restarted.claimActionExecution('conv', { receiptId, proposedInvocationId: 'invoke-2' })).claimed, false)
  await assert.rejects(restarted.settleActionExecution('conv', { receiptId, attemptId: 'not-owner', state: 'completed' }), /own current attempt/)
  assert.equal((await restarted.settleActionExecution('conv', { receiptId, attemptId: claim.attemptId, state: 'completed' })).state, 'completed')
}))

test('host choices and no-action never mint executable receipts and enforce review profile', () => fixture(async journal => {
  for (const [profile, kind] of [['alignment', 'host-question'], ['reflection', 'host-research'], ['alignment', 'no-action'], ['reflection', 'no-action']]) {
    const conversation = `${profile}-${kind}`
    const entry = await accepted(journal, conversation, profile)
    assert.deepEqual((await journal.selectReviewAction(conversation, request(entry, kind))).actionReceipts, [])
  }
  for (const [profile, kind] of [['reflection', 'host-question'], ['alignment', 'host-research']]) {
    const conversation = `${profile}-${kind}`
    const entry = await accepted(journal, conversation, profile)
    await assert.rejects(journal.selectReviewAction(conversation, request(entry, kind)), /review profile/)
  }
}))

test('selection requires exact accepted binding and scope; acceptance cannot bypass selection', () => fixture(async journal => {
  await journal.publish('conv', advisory())
  await assert.rejects(journal.selectReviewAction('conv', { advisoryId: 'advice-1', acceptanceReceiptId: 'not-accepted', kind: 'bundle', reason: 'Reason' }, action()), /exact active acceptance/)
  await assert.rejects(journal.decide('conv', { advisoryId: 'advice-1', decision: 'accepted' }, [action()]), /before selection/)
  const entry = (await journal.decide('conv', { advisoryId: 'advice-1', decision: 'accepted' }))[0]
  await assert.rejects(journal.selectReviewAction('other', request(entry), action()), /unknown advisory/)
  await assert.rejects(journal.selectReviewAction('conv', request(entry, 'bundle', { acceptanceReceiptId: 'wrong' }), action()), /exact active acceptance/)
  await assert.rejects(journal.selectReviewAction('conv', request(entry), action('any-bundle', ['other'])), /entity scope/)
  await journal.publish('rejected', advisory())
  await journal.decide('rejected', { advisoryId: 'advice-1', decision: 'rejected' })
  await assert.rejects(journal.selectReviewAction('rejected', request(entry), action()), /exact active acceptance/)
}))

test('revision CAS closes read/select race; competing choices cannot both append', () => fixture(async (journal, storage) => {
  const entry = await accepted(journal)
  const revision = (await storage.read('conv')).revision
  await assert.rejects(journal.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: revision - 1 }), action()), /revision changed/)
  await assert.rejects(journal.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: -1 }), action()), /safe integer/)
  const results = await Promise.allSettled([
    journal.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: revision }), action('first')),
    journal.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: revision }), action('second')),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await storage.read('conv')).revision, revision + 1)
}))

test('Grounding fixed Bundle acceptance is unchanged', () => fixture(async journal => {
  await journal.publish('conv', advisory('grounding', { kind: 'bundle-revisions', targets: [{ skillName: 'any-bundle', entityRefs: ['entity-1'] }] }))
  const entry = (await journal.decide('conv', { advisoryId: 'advice-1', decision: 'accepted' }, [action()]))[0]
  assert.equal(entry.actionReceipts.length, 1)
  await assert.rejects(journal.selectReviewAction('conv', request(entry), action()), /review-choice/)
}))

test('identical concurrent selection is idempotent', () => fixture(async (journal, storage) => {
  const entry = await accepted(journal)
  const revision = (await storage.read('conv')).revision
  const [a, b] = await Promise.all([
    journal.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: revision }), action()),
    journal.selectReviewAction('conv', request(entry, 'bundle', { expectedJournalRevision: revision }), action()),
  ])
  assert.equal(a.actionReceipts[0].receiptId, b.actionReceipts[0].receiptId)
  assert.equal((await storage.read('conv')).revision, revision + 1)
}))

test('historical invalidation blocks first selection and replay without a new legacy writer', () => fixture(async (journal, storage) => {
  for (const selected of [false, true]) {
    const conversation = `invalidated-${selected}`
    const entry = await accepted(journal, conversation)
    if (selected) await journal.selectReviewAction(conversation, request(entry), action())
    const { records, revision } = await storage.read(conversation)
    const invalidation = { schemaVersion: DESIGN_JOURNAL_SCHEMA_VERSION, revision: revision + 1, type: 'design/advisory-set-published', data: {
      setId: 'audit-1', advisories: [], invalidations: [{
        advisoryId: 'advice-1', reason: 'superseded', evidenceRevision: 'c2', validationReceipt: 'validated-1',
      }],
    } }
    const selection = { schemaVersion: DESIGN_JOURNAL_SCHEMA_VERSION, revision: revision + 2, type: 'design/advisory-action-selected', data: {
      ...request(entry), actions: [{ ...action(), receiptId: 'selected-receipt' }],
    } }
    assert.throws(() => foldDesignJournal([...records, invalidation, selection]), /exact active acceptance/)
  }
}))
