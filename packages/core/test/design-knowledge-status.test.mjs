import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const {
  deriveDesignKnowledgeStatus,
  deriveReviewStatuses,
  hasDueReview,
  renderDesignKnowledgeStatusReminder,
} = await import('../src/design-knowledge-status.ts')
const { DESIGN_KNOWLEDGE_PUBLICATION_KEY, DESIGN_KNOWLEDGE_FAILURE_KEY } = await import('../src/design-knowledge-refresh.ts')
const { default: DesignService } = await import('../src/design-service.ts')

const projectId = '11111111-1111-4111-8111-111111111111'
const base = (overrides = {}) => ({
  project: projectId,
  head: 'c2',
  liveJob: 'none',
  semanticEnabled: true,
  ...overrides,
})
const publication = (checkpoint, revision = 'rev:9') => ({ checkpoint, revision, warnings: [] })

test('knowledge state derivation is exhaustive over the closed vocabulary and precedence', () => {
  // 1. recovery rebuilding outranks everything else.
  const recovering = deriveDesignKnowledgeStatus(base({
    recovery: { state: 'rebuilding', message: 'rebuilding gen 4', generation: 'g4' },
    liveJob: 'running', phase: 'semantic', publication: publication('c2'),
  }))
  assert.equal(recovering.state, 'unavailable')

  // 2/3. queued vs running: accepted-not-started versus pipeline actually running.
  const queued = deriveDesignKnowledgeStatus(base({ liveJob: 'queued', publication: publication('c1') }))
  assert.equal(queued.state, 'queued')
  assert.equal(queued.phase, undefined)
  const running = deriveDesignKnowledgeStatus(base({ liveJob: 'running', phase: 'semantic' }))
  assert.equal(running.state, 'running')
  assert.equal(running.phase, 'semantic')

  // 4. recovery error is failed and keeps the latest complete generation readable.
  const recoveryFailed = deriveDesignKnowledgeStatus(base({
    recovery: { state: 'error', message: 'store corrupt', generation: 'g3' },
    publication: publication('c1'),
  }))
  assert.equal(recoveryFailed.state, 'failed')
  assert.equal(recoveryFailed.latestComplete?.checkpoint, 'c1')
  assert.match(recoveryFailed.lastFailure.message, /store corrupt/)

  // 5. generation failure keeps latest-complete and names the error.
  const failed = deriveDesignKnowledgeStatus(base({
    indexFailure: { target: 't1', message: 'model unavailable' },
    publication: publication('c1'),
  }))
  assert.equal(failed.state, 'failed')
  assert.equal(failed.latestComplete?.checkpoint, 'c1')
  assert.equal(failed.freshness, 'different')
  assert.equal(failed.lastFailure.message, 'model unavailable')

  // 6. current derives ONLY from publication matching the head.
  const current = deriveDesignKnowledgeStatus(base({ publication: publication('c2') }))
  assert.equal(current.state, 'current')
  assert.equal(current.freshness, 'matching')
  // No input field can express an in-memory "ready"; without a publication
  // there is never a current/ready claim.
  const noPointer = deriveDesignKnowledgeStatus(base())
  assert.notEqual(noPointer.state, 'current')

  // 7. stale publication with a head is due, carrying both heads.
  const due = deriveDesignKnowledgeStatus(base({ publication: publication('c1') }))
  assert.equal(due.state, 'due')
  assert.equal(due.freshness, 'different')
  assert.equal(due.head, 'c2')
  assert.equal(due.latestComplete?.checkpoint, 'c1')
  const equivalent = deriveDesignKnowledgeStatus(base({ publication: publication('c1'), publicationMatchesHead: true }))
  assert.equal(equivalent.state, 'current')
  assert.equal(equivalent.freshness, 'matching')
  assert.equal(equivalent.head, 'c2')
  assert.equal(equivalent.latestComplete.checkpoint, 'c1', 'published commit stays auditable')

  // 8. nothing completed yet with semantic enabled is due (freshness none).
  assert.equal(noPointer.state, 'due')
  assert.equal(noPointer.freshness, 'none')

  // 9. semantic layer absent and nothing published is disabled, not due.
  const disabled = deriveDesignKnowledgeStatus(base({ semanticEnabled: false }))
  assert.equal(disabled.state, 'disabled')
  assert.equal(disabled.semanticLayer, 'disabled')

  // 10. no published Design Files head yet is unknown.
  const { head: _noHead, ...headless } = base({ publication: publication('c1') })
  const unknown = deriveDesignKnowledgeStatus({ ...headless, head: undefined })
  assert.equal(unknown.state, 'unknown')
})

test('review statuses derive due/completed from durable journal facts with runtime overlay', () => {
  const profiles = ['design.grounding', 'design.reflection', 'design.alignment']
  const completion = {
    profile: 'design.reflection', designRevision: 5, commit: 'c1', itemCount: 0,
    knowledgeUsed: false, fallbackReason: 'timeout', journalRevision: 6,
  }
  // Legacy journal: a change exists, no completion facts → honestly never-reviewed.
  const legacy = deriveReviewStatuses(
    { latestDesignChange: { journalRevision: 5, commit: 'c1' }, reviewCompletions: [] },
    profiles,
  )
  assert.deepEqual(legacy.map(entry => entry.review), ['never-reviewed', 'never-reviewed', 'never-reviewed'])
  assert.equal(hasDueReview(legacy), true)

  const journal = { latestDesignChange: { journalRevision: 5, commit: 'c1' }, reviewCompletions: [completion] }
  const withLoops = deriveReviewStatuses(journal, profiles, [
    { profile: 'design.grounding', phase: 'running' },
    { profile: 'design.alignment', phase: 'failed', lastError: 'boom' },
    { profile: 'design.reflection', phase: 'idle' },
  ])
  const byProfile = Object.fromEntries(withLoops.map(entry => [entry.profile, entry]))
  assert.equal(byProfile['design.reflection'].review, 'completed')
  assert.equal(byProfile['design.reflection'].completedAt.itemCount, 0)
  assert.equal(byProfile['design.reflection'].completedAt.fallbackReason, 'timeout')
  assert.equal(byProfile['design.reflection'].runtime, undefined, 'an idle loop is not a runtime state')
  assert.equal(byProfile['design.grounding'].runtime, 'running', 'only a real loop shows running')
  assert.equal(byProfile['design.alignment'].runtime, 'failed')
  assert.equal(byProfile['design.alignment'].runtimeError, 'boom')

  // A newer Design change makes the completed profile due again.
  const superseded = deriveReviewStatuses(
    { latestDesignChange: { journalRevision: 7, commit: 'c2' }, reviewCompletions: [completion] },
    profiles,
  )
  assert.equal(superseded.find(entry => entry.profile === 'design.reflection').review, 'due')

  // No design yet, or a change without a published commit, are distinct honest states.
  assert.equal(deriveReviewStatuses({ reviewCompletions: [] }, profiles)[0].review, 'no-design-yet')
  assert.equal(deriveReviewStatuses({ latestDesignChange: { journalRevision: 2 }, reviewCompletions: [] }, profiles)[0].review, 'not-reviewable')
  assert.equal(hasDueReview(superseded), true)
})

test('the reminder renderer stays bounded and carries the decision-grade facts', () => {
  const status = deriveDesignKnowledgeStatus(base({
    publication: publication('c1'),
    indexFailure: { target: 't1', message: 'x'.repeat(2_000) },
  }))
  const reviews = deriveReviewStatuses(
    { latestDesignChange: { journalRevision: 5, commit: 'c1' }, reviewCompletions: [] },
    ['design.grounding'],
  )
  const text = renderDesignKnowledgeStatusReminder(status, reviews)
  assert.match(text, /^<design-knowledge-status>\n/)
  assert.match(text, /KAG: failed \(freshness=different, semantic=enabled\)/)
  assert.match(text, /design head: c2/)
  assert.match(text, /latest-complete: checkpoint c1, revision rev:9/)
  assert.match(text, /review design\.grounding: never-reviewed/)
  assert.ok(text.length < 2_000, `reminder must stay bounded, got ${text.length}`)
})

function statusFixture({ head = 'c2', publicationRecord, failureRecord, entry, indexerState = 'unknown', recovery, semantic = true, phase = 'unknown', target = 't1', equivalent = false } = {}) {
  const resolvedHead = head === null ? undefined : head
  const cache = {
    async readSemanticCache(key) {
      if (key === DESIGN_KNOWLEDGE_PUBLICATION_KEY) return publicationRecord
      if (key === DESIGN_KNOWLEDGE_FAILURE_KEY) return failureRecord
      return undefined
    },
    async writeSemanticCache() { throw new Error('status sampling is a pure read') },
  }
  return {
    selectionForAgent: () => ({ projectId }),
    knowledgeRuntime: {
      disposing: false,
      runtime: {
        semantic: semantic ? { publicationCache: () => cache } : undefined,
        ...(recovery === undefined ? {} : { recoveryStatus: () => recovery }),
      },
    },
    projects: { status: async () => ({ lastCheckpoint: resolvedHead }) },
    designFilesForProject: async () => ({}),
    knowledgeSourceMatches: async () => equivalent,
    assertProjectSelection() {},
    knowledgeMaintenanceTarget: () => target,
    knowledgeIndexFailures: new Map(),
    knowledgeMaintenance: new Map(entry === undefined ? [] : [[projectId, entry]]),
    knowledgeIndexer: { state: () => indexerState },
    knowledgeIndexPhase: () => phase,
    scheduleKnowledgeMaintenance: () => { throw new Error('status sampling must never schedule maintenance') },
    refreshPublishedKnowledge: async () => { throw new Error('status sampling must never start indexing') },
    rebuildDerivedKnowledge: async () => { throw new Error('status sampling must never rebuild') },
  }
}
const sample = (fixture) => DesignService.prototype.knowledgeStatusSnapshot.call(fixture, {})
const pub = (checkpoint) => JSON.stringify({ schemaVersion: 1, key: 'k', edges: 'e', checkpoint, revision: 'rev:9', warnings: [] })

test('service snapshot sampling is a pure read and derives honest states from durable pointers', async () => {
  // Stale publication, no live job → due with both heads (pure read: any
  // scheduling attempt in the fixture throws and would fail this test).
  const due = await sample(statusFixture({ publicationRecord: pub('c1') }))
  assert.equal(due.state, 'due')
  assert.equal(due.head, 'c2')
  assert.equal(due.latestComplete.checkpoint, 'c1')
  assert.equal(due.freshness, 'different')

  const current = await sample(statusFixture({ publicationRecord: pub('c2') }))
  assert.equal(current.state, 'current')
  const equivalent = await sample(statusFixture({ publicationRecord: pub('c1'), equivalent: true }))
  assert.equal(equivalent.state, 'current', 'a proved unchanged Design evidence tree is current without rewriting the publication pin')
  assert.equal(equivalent.latestComplete.checkpoint, 'c1')

  // A durable failure for the CURRENT target survives restarts; a failure for
  // another target does not poison the new generation.
  const failure = JSON.stringify({ schemaVersion: 1, target: 't1', message: 'model unavailable' })
  const failed = await sample(statusFixture({ publicationRecord: pub('c1'), failureRecord: failure }))
  assert.equal(failed.state, 'failed')
  assert.equal(failed.lastFailure.message, 'model unavailable')
  assert.equal(failed.latestComplete.checkpoint, 'c1', 'failed keeps the latest complete generation')
  const otherTarget = await sample(statusFixture({ publicationRecord: pub('c1'), failureRecord: failure, target: 't2' }))
  assert.equal(otherTarget.state, 'due')

  // queued versus running comes from the real maintenance entry.
  const queued = await sample(statusFixture({ entry: { running: false } }))
  assert.equal(queued.state, 'queued')
  const running = await sample(statusFixture({ entry: { running: true }, phase: 'semantic' }))
  assert.equal(running.state, 'running')
  assert.equal(running.phase, 'semantic')
  // A detached companion-style indexing job without an entry is still running.
  assert.equal((await sample(statusFixture({ indexerState: 'indexing', phase: 'publication' }))).state, 'running')

  const rebuilding = await sample(statusFixture({ recovery: { state: 'rebuilding', message: 'gen 5' } }))
  assert.equal(rebuilding.state, 'unavailable')
  const disabled = await sample(statusFixture({ semantic: false }))
  assert.equal(disabled.state, 'disabled')
  const headless = await sample(statusFixture({ head: null }))
  assert.equal(headless.state, 'unknown')
})

test('review statuses combine journal facts with the real scheduler loops', async () => {
  const receiver = {
    advisoryRuntimeStatus: () => ({
      available: true,
      profiles: ['design.grounding', 'design.alignment'],
      phase: 'running',
      profileStatus: [{ profile: 'design.grounding', phase: 'running' }],
    }),
    selectionForAgent: () => ({ projectId }),
    readDesignJournal: async () => ({
      snapshot: {
        latestDesignChange: { journalRevision: 5, commit: 'c1' },
        reviewCompletions: [{
          profile: 'design.alignment', designRevision: 5, commit: 'c1',
          itemCount: 1, knowledgeUsed: true, journalRevision: 6,
        }],
      },
    }),
  }
  const statuses = await DesignService.prototype.reviewStatuses.call(receiver, {})
  assert.equal(statuses.length, 2)
  assert.equal(statuses[0].review, 'never-reviewed')
  assert.equal(statuses[0].runtime, 'running')
  assert.equal(statuses[1].review, 'completed')
  assert.equal(statuses[1].runtime, undefined)
})
