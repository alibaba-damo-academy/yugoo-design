import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { foldDesignJournal, parseAdvisoryReviewCompletion, DESIGN_JOURNAL_SCHEMA_VERSION } = await import('../src/design-journal.ts')
const { DesignJournalStorage } = await import('../src/design-journal-storage.ts')
const { DesignAdvisoryJournal } = await import('../src/design-advisory-journal.ts')

// A completion that fell back to Design Files always names the concrete reason.
const completion = (overrides = {}) => ({
  profile: 'design.grounding',
  designRevision: 2,
  commit: 'c1',
  itemCount: 0,
  knowledgeUsed: false,
  fallbackReason: 'checkpoint-mismatch',
  kit: 'web_app',
  kitVersion: '1.0',
  vocabularyRevision: 'vocab-1',
  ...overrides,
})
// A completion that really consumed a checkpoint-matched KAG snapshot.
const usedCompletion = (overrides = {}) => ({
  profile: 'design.grounding',
  designRevision: 2,
  commit: 'c1',
  itemCount: 2,
  knowledgeUsed: true,
  kit: 'web_app',
  kitVersion: '1.0',
  vocabularyRevision: 'vocab-1',
  ...overrides,
})
const record = (revision, type, data) => ({ schemaVersion: DESIGN_JOURNAL_SCHEMA_VERSION, revision, type, data })
const kitSelected = (revision) => record(revision, 'design/kit-selected', { kit: 'web_app', version: '1.0', operation: 'activate' })
const changed = (revision, commit) => record(revision, 'design/changed', {
  kit: 'web_app', version: '1.0', skill: 'function_modules', origin: 'agent', state: { functions: {} }, commit,
})

test('completion parser is strict about identity, counts, and the honest KAG path', () => {
  const parsed = parseAdvisoryReviewCompletion(completion())
  assert.equal(parsed.profile, 'design.grounding')
  assert.equal(parsed.knowledgeUsed, false)
  assert.equal(parsed.fallbackReason, 'checkpoint-mismatch')
  const used = parseAdvisoryReviewCompletion(usedCompletion())
  assert.equal(used.knowledgeUsed, true)
  assert.equal(used.fallbackReason, undefined)
  assert.equal(parseAdvisoryReviewCompletion(usedCompletion({ knowledgeSourceCheckpoint: 'older-source' })).knowledgeSourceCheckpoint, 'older-source')
  assert.throws(() => parseAdvisoryReviewCompletion(completion({ knowledgeSourceCheckpoint: 'older-source' })), /requires knowledgeUsed/)
  assert.throws(() => parseAdvisoryReviewCompletion(completion({ extra: 1 })), /invalid fields/)
  const { fallbackReason: _dropped, ...withoutReason } = completion()
  assert.throws(() => parseAdvisoryReviewCompletion(withoutReason), /fallbackReason: required/)
  assert.throws(() => parseAdvisoryReviewCompletion(usedCompletion({ fallbackReason: 'timeout' })), /carries no fallback/)
  assert.throws(() => parseAdvisoryReviewCompletion(completion({ itemCount: -1 })), /non-negative/)
  assert.throws(() => parseAdvisoryReviewCompletion(completion({ designRevision: 0 })), /positive safe integer/)
  assert.equal(parseAdvisoryReviewCompletion(completion({ attemptId: 'user-request-1' })).attemptId, 'user-request-1')
  assert.throws(() => parseAdvisoryReviewCompletion(completion({ attemptId: 'not portable!' })), /portable request identity/)
})

test('manual completion identity is durable and cannot be reused for a different target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'manual-review-completion-'))
  try {
    const conversation = 'manual-conv'
    const storage = new DesignJournalStorage(root)
    const journal = new DesignAdvisoryJournal(storage)
    const first = await journal.recordReviewCompletion(conversation, completion({ attemptId: 'request-1' }))
    assert.equal(first.recorded, true)
    const restarted = new DesignAdvisoryJournal(new DesignJournalStorage(root))
    assert.equal((await restarted.recordReviewCompletion(conversation,
      usedCompletion({ attemptId: 'request-1' }))).recorded, false, 'replay never publishes a second completion')
    await assert.rejects(restarted.recordReviewCompletion(conversation,
      completion({ attemptId: 'request-1', commit: 'other' })), /cannot change target/)
    assert.equal((await restarted.recordReviewCompletion(conversation,
      completion({ attemptId: 'request-2' }))).recorded, true, 'a later explicit request is a new pass')
    assert.equal((await restarted.recordReviewCompletion(conversation,
      completion({ attemptId: 'request-2', profile: 'design.reflection' }))).recorded, true,
      'one manual request may complete multiple distinct profiles')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('fold keeps the latest completion per profile and never lets a late older pass supersede', () => {
  const snapshot = foldDesignJournal([
    kitSelected(1),
    changed(2, 'c1'),
    record(3, 'design/advisory-review-completed', completion()),
    record(4, 'design/advisory-review-completed', completion({ profile: 'design.alignment' })),
    record(5, 'design/advisory-review-completed', usedCompletion({ itemCount: 3, commit: 'c1' })),
    record(6, 'design/advisory-review-completed', completion({ designRevision: 1, commit: 'c0' })),
  ])
  assert.equal(snapshot.reviewCompletions.length, 2)
  const grounding = snapshot.reviewCompletions.find((entry) => entry.profile === 'design.grounding')
  assert.equal(grounding.itemCount, 3, 'newer pass supersedes')
  assert.equal(grounding.knowledgeUsed, true)
  assert.equal(grounding.journalRevision, 5)
  assert.ok(snapshot.reviewCompletions.some((entry) => entry.profile === 'design.alignment'))
})

test('a legacy journal without completion events folds cleanly and every profile remains due', () => {
  const snapshot = foldDesignJournal([kitSelected(1), changed(2, 'c1')])
  assert.deepEqual(snapshot.reviewCompletions, [])
  assert.equal(snapshot.latestDesignChange?.journalRevision, 2)
  // Due derivation data basis: a change exists, no completion covers it.
  const due = snapshot.latestDesignChange !== undefined
    && !snapshot.reviewCompletions.some((entry) => entry.designRevision >= snapshot.latestDesignChange.journalRevision)
  assert.equal(due, true)
})

test('empty-findings completion records exactly once, replays idempotently, and recovers after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-completion-'))
  try {
    const conversation = 'conv-1'
    const storage = new DesignJournalStorage(root)
    const journal = new DesignAdvisoryJournal(storage)
    await storage.append(conversation, { type: 'design/kit-selected', data: { kit: 'web_app', version: '1.0', operation: 'activate' } })
    await storage.append(conversation, { type: 'design/changed', data: { kit: 'web_app', version: '1.0', skill: 'function_modules', origin: 'agent', state: { functions: {} }, commit: 'c1' } })

    // A produced pass with zero findings is a real completion.
    const first = await journal.recordReviewCompletion(conversation, completion())
    assert.equal(first.recorded, true)
    assert.equal(first.entry?.itemCount, 0)
    const afterFirst = await storage.read(conversation)
    const recordCount = afterFirst.records.length

    // Replaying the identical completion appends nothing.
    const replay = await journal.recordReviewCompletion(conversation, completion())
    assert.equal(replay.recorded, false)
    const afterReplay = await storage.read(conversation)
    assert.equal(afterReplay.records.length, recordCount)
    assert.equal(afterReplay.revision, afterFirst.revision)

    // A late pass for an older Design revision appends nothing.
    const older = await journal.recordReviewCompletion(conversation, completion({ designRevision: 1, commit: 'c0' }))
    assert.equal(older.recorded, false)

    // A genuinely newer pass supersedes through the fold.
    await storage.append(conversation, { type: 'design/changed', data: { kit: 'web_app', version: '1.0', skill: 'function_modules', origin: 'agent', state: { functions: { a: {} } }, commit: 'c2' } })
    const newer = await journal.recordReviewCompletion(conversation, usedCompletion({ designRevision: 4, commit: 'c2' }))
    assert.equal(newer.recorded, true)
    assert.equal(newer.entry?.commit, 'c2')

    // Restart: a fresh storage over the same root recovers the exact state.
    const folded = await new DesignJournalStorage(root).read(conversation)
    assert.equal(folded.snapshot.reviewCompletions.length, 1)
    assert.equal(folded.snapshot.reviewCompletions[0].commit, 'c2')
    assert.equal(folded.snapshot.reviewCompletions[0].designRevision, 4)
    assert.equal(folded.snapshot.reviewCompletions[0].knowledgeUsed, true)

    // A second conversation with only legacy facts recovers as due.
    await storage.append('conv-legacy', { type: 'design/changed', data: { kit: 'web_app', version: '1.0', skill: 'research', origin: 'agent', state: {}, commit: 'c9' } })
    const legacy = await storage.read('conv-legacy')
    assert.deepEqual(legacy.snapshot.reviewCompletions, [])
    assert.equal(legacy.snapshot.latestDesignChange?.commit, 'c9')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
