/** Keyless source smoke for the DesignJournal-backed advisory repository. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignAdvisoryJournal } from '../packages/core/src/design-advisory-journal.ts'
import { foldDesignJournal } from '../packages/core/src/design-journal.ts'
import { DesignJournalStorage } from '../packages/core/src/design-journal-storage.ts'

const root = await mkdtemp(join(tmpdir(), 'dsh-design-advisory-journal-'))
const kitVersion = '1.0'
const kitSelected = (kit, version) => ({ type: 'design/kit-selected', data: { kit, version, operation: 'activate' } })

function advisoryValue({ id, attention = 'human-review', summary = 'Confirm the preference.' }) {
  return {
    schemaVersion: 1,
    id,
    profile: 'io.deepseek.design.advisory.alignment/v1',
    resultRef: `${id}-result`,
    inputs: [{ source: 'design-state', revision: 'state-1' }],
    kind: 'reminder',
    attention,
    summary,
    items: [{ id: 'item-1', title: 'Choose format', detail: `Ask for the export format for ${id}.`, references: [] }],
    ...(attention === 'human-review' ? { acceptanceInstruction: 'Ask the user for the preferred export format.' } : {}),
    blocksConversation: false,
    authorizesDesignWrite: false,
  }
}

function v2AdvisoryValue(id, targets = ['alpha', 'beta']) {
  return {
    ...advisoryValue({ id }),
    schemaVersion: 2,
    actionSpec: {
      kind: 'bundle-revisions',
      targets: targets.map((skillName) => ({ skillName, entityRefs: [`facet:${skillName}`] })),
    },
  }
}

const resolvedAction = (skillName) => ({
  actionId: `bundle:${skillName}`,
  target: {
    kitName: 'web_app',
    kitVersion,
    skillName,
    bundleVersion: '1.0',
    entityRefs: [`facet:${skillName}`],
  },
})

try {
  const storage = new DesignJournalStorage(root)
  const repo = new DesignAdvisoryJournal(storage)
  await storage.append('conversation/A', kitSelected('web_app', kitVersion))

  // Publication, decision, and subscribe projection.
  const observed = []
  const dispose = repo.subscribe('conversation/A', (entries) => observed.push(entries.map((entry) => entry.status)))
  const published = await repo.publish('conversation/A', advisoryValue({ id: 'alignment/run-1' }))
  assert.deepEqual(published.map((entry) => entry.status), ['pending'])
  const decided = await repo.decide('conversation/A', { advisoryId: 'alignment/run-1', decision: 'accepted' })
  assert.deepEqual(decided.map((entry) => entry.status), ['accepted'])
  const firstReceipt = decided[0].acceptanceReceiptId
  assert.equal(typeof firstReceipt, 'string')
  assert.deepEqual(observed, [['pending'], ['accepted']])
  dispose()

  // Restart restoration: a fresh repository over the same root folds the same state.
  const restored = new DesignAdvisoryJournal(new DesignJournalStorage(root))
  const listed = await restored.list('conversation/A')
  assert.equal(listed.length, 1)
  assert.equal(listed[0].advisory.id, 'alignment/run-1')
  assert.equal(listed[0].status, 'accepted')
  assert.equal(listed[0].publishedAt, published[0].publishedAt, 'restart and acceptance preserve the original publication time')
  assert.equal(listed[0].publishedRevision, published[0].publishedRevision)
  assert.equal(listed[0].acceptanceReceiptId, firstReceipt, 'refresh/session restoration keeps the exact acceptance outbox receipt')

  // Exact per-conversation ordering under concurrent appends, isolated conversations.
  const publishes = await Promise.all(['alignment/a', 'alignment/b', 'alignment/c'].map((id) => (
    repo.publish('conversation/A', advisoryValue({ id }))
  )))
  assert.deepEqual(new Set(publishes.map((entries) => entries.length)), new Set([2, 3, 4]), 'each append observes its own revision')
  const afterConcurrent = await repo.list('conversation/A')
  assert.deepEqual(afterConcurrent.map((entry) => entry.advisory.id), [
    'alignment/run-1', 'alignment/a', 'alignment/b', 'alignment/c',
  ])
  assert.deepEqual(await repo.list('conversation/B'), [], 'another conversation keeps its own empty journal')

  // Historical atomic-set records remain foldable, but no live storage or
  // advisory-repository writer may append another one.
  const setItems = [advisoryValue({ id: 'set/a' }), advisoryValue({ id: 'set/b' })]
  const historical = foldDesignJournal([{
    schemaVersion: 3,
    revision: 1,
    type: 'design/advisory-set-published',
    data: { setId: 'historical-set', advisories: setItems, invalidations: [] },
  }])
  assert.deepEqual(historical.latestAdvisorySet.advisoryIds, ['set/a', 'set/b'])
  await assert.rejects(
    storage.append('conversation/set', {
      type: 'design/advisory-set-published',
      data: { setId: 'set-disabled', advisories: [], invalidations: [] },
    }),
    /read-only/,
  )
  await repo.publish('conversation/set', setItems[0])
  await repo.publish('conversation/set', setItems[1])

  // Legacy acceptance remains durable disposition evidence but never tool authority.
  const acceptedSet = await repo.decide('conversation/set', { advisoryId: 'set/a', decision: 'accepted' })
  const receiptId = acceptedSet.find(entry => entry.advisory.id === 'set/a').acceptanceReceiptId
  assert.equal(typeof receiptId, 'string')
  const repeatAccepted = await repo.decide('conversation/set', { advisoryId: 'set/a', decision: 'accepted' })
  assert.equal(repeatAccepted.find(entry => entry.advisory.id === 'set/a').acceptanceReceiptId, receiptId)
  await assert.rejects(
    repo.claimExecution('conversation/set', receiptId),
    /not tool authority/,
  )
  assert.equal((await repo.list('conversation/set')).find(entry => entry.advisory.id === 'set/a').status, 'accepted')

  // V2 acceptance atomically mints one exact receipt per logical Bundle action.
  await repo.publish('conversation/v2', v2AdvisoryValue('reflection/v2'))
  const v2Accepted = await repo.decide(
    'conversation/v2',
    { advisoryId: 'reflection/v2', decision: 'accepted' },
    [resolvedAction('alpha'), resolvedAction('beta')],
  )
  const v2Entry = v2Accepted[0]
  assert.equal(v2Entry.status, 'accepted', 'human disposition stays independent from execution')
  assert.equal(v2Entry.executionStatus, 'ready')
  assert.equal(v2Entry.actionReceipts.length, 2)
  assert.equal(new Set(v2Entry.actionReceipts.map(action => action.receiptId)).size, 2)
  const alphaReceipt = v2Entry.actionReceipts.find(action => action.actionId === 'bundle:alpha').receiptId
  const alphaClaims = await Promise.all([
    repo.claimActionExecution('conversation/v2', { receiptId: alphaReceipt, proposedInvocationId: 'logical-alpha' }),
    repo.claimActionExecution('conversation/v2', { receiptId: alphaReceipt, proposedInvocationId: 'rival-root' }),
  ])
  assert.equal(alphaClaims.filter(result => result.claimed).length, 1, 'only one concurrent action attempt wins')
  const alphaFirst = alphaClaims.find(result => result.claimed)
  assert.equal(alphaClaims.every(result => result.effectiveInvocationId === 'logical-alpha'), true)
  await repo.settleActionExecution('conversation/v2', {
    receiptId: alphaReceipt,
    attemptId: alphaFirst.attemptId,
    state: 'needs-user-input',
  })
  const alphaResume = await repo.claimActionExecution('conversation/v2', {
    receiptId: alphaReceipt,
    proposedInvocationId: 'new-root-must-not-win',
  })
  assert.equal(alphaResume.claimed, true)
  assert.equal(alphaResume.effectiveInvocationId, 'logical-alpha', 'continuation keeps the logical invocation')
  await assert.rejects(
    repo.settleActionExecution('conversation/v2', {
      receiptId: alphaReceipt,
      attemptId: alphaFirst.attemptId,
      state: 'completed',
    }),
    /does not own current attempt/,
  )
  await repo.settleActionExecution('conversation/v2', {
    receiptId: alphaReceipt,
    attemptId: alphaResume.attemptId,
    state: 'completed',
  })
  const completedReplay = await repo.claimActionExecution('conversation/v2', {
    receiptId: alphaReceipt,
    proposedInvocationId: 'another-root',
  })
  assert.equal(completedReplay.claimed, false)
  assert.equal(completedReplay.effectiveInvocationId, 'logical-alpha')
  assert.equal((await repo.list('conversation/v2'))[0].status, 'accepted')
  assert.equal((await repo.list('conversation/v2'))[0].executionStatus, 'ready', 'the second Bundle still owns unfinished work')

  // A mismatched resolved target rejects the whole atomic acceptance.
  await repo.publish('conversation/v2-invalid', v2AdvisoryValue('reflection/invalid', ['alpha']))
  await assert.rejects(
    repo.decide(
      'conversation/v2-invalid',
      { advisoryId: 'reflection/invalid', decision: 'accepted' },
      [resolvedAction('beta')],
    ),
    /mismatched Bundle action/,
  )
  assert.equal((await repo.list('conversation/v2-invalid'))[0].status, 'pending')
  // Duplicate-id idempotency appends nothing; conflicting republish fails loud.
  const beforeRetry = (await storage.read('conversation/A')).revision
  await repo.publish('conversation/A', advisoryValue({ id: 'alignment/a' }))
  assert.equal((await storage.read('conversation/A')).revision, beforeRetry, 'identical republish must not append')
  await assert.rejects(
    repo.publish('conversation/A', advisoryValue({ id: 'alignment/a', summary: 'A different summary.' })),
    /republished with different content/,
  )
  assert.equal((await storage.read('conversation/A')).revision, beforeRetry, 'conflicting republish must not append')

  // Next-boundary advisories cannot receive decisions.
  await repo.publish('conversation/A', advisoryValue({ id: 'alignment/quiet', attention: 'next-boundary' }))
  await assert.rejects(
    repo.decide('conversation/A', { advisoryId: 'alignment/quiet', decision: 'accepted' }),
    /next-boundary advisory/,
  )

  // Terminal decisions are immutable; repeating one is idempotent; deferred stays mutable.
  await assert.rejects(
    repo.decide('conversation/A', { advisoryId: 'alignment/run-1', decision: 'rejected' }),
    /terminal decision/,
  )
  const beforeRepeat = (await storage.read('conversation/A')).revision
  await repo.decide('conversation/A', { advisoryId: 'alignment/run-1', decision: 'accepted' })
  assert.equal((await storage.read('conversation/A')).revision, beforeRepeat, 'repeated terminal decision must not append')
  await repo.decide('conversation/A', { advisoryId: 'alignment/b', decision: 'deferred' })
  const afterDefer = await repo.decide('conversation/A', { advisoryId: 'alignment/b', decision: 'rejected' })
  assert.equal(afterDefer.find((entry) => entry.advisory.id === 'alignment/b').status, 'rejected')
  await assert.rejects(
    repo.decide('conversation/A', { advisoryId: 'alignment/ghost', decision: 'accepted' }),
    /unknown advisory/,
  )

  // A Kit selection is an audit fact only: it must not clear the advisory view.
  await storage.append('conversation/A', kitSelected('web_app_v2', '2.0'))
  const advisoryIdsBeforeSwitch = (await repo.list('conversation/A')).map((entry) => entry.advisory.id)
  await repo.publish('conversation/A', advisoryValue({ id: 'alignment/after-switch' }))
  assert.deepEqual(
    (await repo.list('conversation/A')).map((entry) => entry.advisory.id),
    [...advisoryIdsBeforeSwitch, 'alignment/after-switch'],
    'a Kit selection keeps prior advisories in the advisory read model',
  )

  // Atomic compare/fold+append across concurrent repositories on one storage.
  const rival = new DesignAdvisoryJournal(storage)
  const beforeRace = (await storage.read('conversation/A')).revision

  const identical = await Promise.allSettled([
    repo.publish('conversation/A', advisoryValue({ id: 'race/same' })),
    rival.publish('conversation/A', advisoryValue({ id: 'race/same' })),
  ])
  assert.deepEqual(identical.map((result) => result.status), ['fulfilled', 'fulfilled'], 'identical concurrent publishes both succeed')
  assert.equal((await storage.read('conversation/A')).revision, beforeRace + 1, 'identical concurrent publishes append exactly once')

  const conflicting = await Promise.allSettled([
    repo.publish('conversation/A', advisoryValue({ id: 'race/conflict', summary: 'First content.' })),
    rival.publish('conversation/A', advisoryValue({ id: 'race/conflict', summary: 'Second content.' })),
  ])
  const winners = conflicting.filter((result) => result.status === 'fulfilled')
  const losers = conflicting.filter((result) => result.status === 'rejected')
  assert.equal(winners.length, 1, 'exactly one conflicting publish wins')
  assert.match(String(losers[0].reason), /republished with different content/)
  const persistedRace = (await repo.list('conversation/A')).find((entry) => entry.advisory.id === 'race/conflict')
  assert.equal(persistedRace.advisory.summary, 'First content.', 'only the winner is persisted')

  await repo.publish('conversation/A', advisoryValue({ id: 'race/decide' }))
  const competing = await Promise.allSettled([
    repo.decide('conversation/A', { advisoryId: 'race/decide', decision: 'accepted' }),
    rival.decide('conversation/A', { advisoryId: 'race/decide', decision: 'rejected' }),
  ])
  const decisionWinners = competing.filter((result) => result.status === 'fulfilled')
  const decisionLosers = competing.filter((result) => result.status === 'rejected')
  assert.equal(decisionWinners.length, 1, 'exactly one competing decision wins')
  assert.match(String(decisionLosers[0].reason), /terminal decision/)
  const decidedRace = (await repo.list('conversation/A')).find((entry) => entry.advisory.id === 'race/decide')
  assert.equal(decidedRace.status, 'accepted', 'the winning terminal decision is preserved')

  // Restart exactness after the races: fresh storage and repository fold the same state.
  const restarted = new DesignAdvisoryJournal(new DesignJournalStorage(root))
  const finalEntries = await restarted.list('conversation/A')
  assert.deepEqual(finalEntries.map((entry) => [entry.advisory.id, entry.status]), [
    ['alignment/run-1', 'accepted'],
    ['alignment/a', 'pending'],
    ['alignment/b', 'rejected'],
    ['alignment/c', 'pending'],
    ['alignment/quiet', 'pending'],
    ['alignment/after-switch', 'pending'],
    ['race/same', 'pending'],
    ['race/conflict', 'pending'],
    ['race/decide', 'accepted'],
  ])
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('DESIGN ADVISORY JOURNAL OK')
