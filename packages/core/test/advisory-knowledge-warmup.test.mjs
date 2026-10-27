import test from 'node:test'
import assert from 'node:assert/strict'

const { register } = await import('tsx/esm/api')
register()
const { DshAdvisoryScheduler } = await import('../src/dsh-advisory-plugin.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { OFFICIAL_GROUNDING_PROFILE } = await import('../src/official-advisory-profiles.ts')
const { readAdvisoryDesignKnowledge } = await import('../src/advisory-knowledge.ts')

test('oversized KAG pin metadata falls back explicitly without counting the captured graph as used', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111'
  const change = { journalRevision: 5, commit: 'a'.repeat(40), kit: 'fixture', version: '1.0' }
  const revision = 'rev:' + 'x'.repeat(32768)
  const knowledge = await readAdvisoryDesignKnowledge({ project: projectId, checkpoint: change.commit }, {
    revision: async () => revision, query: async () => ({ revision, entities: [], relations: [] }),
  }, 20)
  const completions = []
  let prompt
  const scheduler = new DshAdvisoryScheduler({
    design: {
      advisoryDesignKnowledge: async () => knowledge,
      kitForAgent: () => ({ name: 'fixture', version: '1.0' }),
      readDesignJournal: async () => ({ snapshot: { latestDesignChange: change, design: {}, advisories: [] } }),
      projectForAgent: async () => ({ projectId, root: '/tmp/project', designFilesRoot: '/tmp/project/design_files' }),
      refreshAdvisoryProjection: async () => {},
      recordAdvisoryReviewCompletion: async (_agent, completion) => { completions.push(completion) },
    },
    subagents: { start: async (_provider, request) => {
      prompt = request.prompt[0].text
      assert.equal(request.knowledgeContext, undefined)
      return { result: Promise.resolve({ stopReason: 'completed', structured: { schemaVersion: 1, inconsistencies: [] } }), dispose: async () => {} }
    } },
    warn: message => assert.fail(message),
  }, { profiles: [OFFICIAL_GROUNDING_PROFILE] })
  try {
    await scheduler.runProfile({ id: 'oversized-pins', status: 'idle', session: { events: [] } }, OFFICIAL_GROUNDING_PROFILE, 5, new AbortController().signal, () => {})
    assert.doesNotMatch(prompt, /Stored Design KAG|knowledgeDocumentRef/)
    assert.match(prompt, /knowledge-fallback.*read-error/)
    assert.equal(completions.length, 1)
    assert.equal(completions[0].knowledgeUsed, false)
    assert.equal(completions[0].fallbackReason, 'read-error')
    assert.equal(completions[0].knowledgeSourceCheckpoint, undefined)
  } finally { scheduler.dispose() }
})

test('review dispatch reuses one revision warmup instead of queueing a second KAG read', async () => {
  const history = [{ type: 'tool/call', data: { callId: 'foreground', name: 'run_design_skill', arguments: JSON.stringify({ name: 'research', brief: 'Current research intent' }) } }]
  const agent = { id: 'agent-1', status: 'running', session: { snapshotEvents() { return history } } }
  const change = { journalRevision: 3, commit: 'checkpoint-3', kit: 'web_app', version: '1.0' }
  let reads = 0, starts = 0
  const knowledge = { project: 'project-1', checkpoint: change.commit, graph: { entities: [] }, context: '{}' }
  const scheduler = new DshAdvisoryScheduler({
    design: {
      advisoryDesignKnowledge: async (_agent, target) => { assert.deepEqual(target, { project: 'project-1', checkpoint: change.commit }); reads += 1; return knowledge },
      kitForAgent: () => ({ name: 'web_app', version: '1.0' }),
      readDesignJournal: async () => ({ snapshot: { latestDesignChange: change, design: {}, advisories: [] } }),
      projectForAgent: async () => ({ projectId: 'project-1', root: '/tmp/project', designFilesRoot: '/tmp/project/design_files' }),
    },
    subagents: { start: async (_provider, request) => {
      starts += 1
      assert.match(JSON.stringify(request.prompt), /Current research intent/)
      throw new Error('stop before reviewer execution')
    } },
    warn: () => {},
  }, { debounceMs: 0, profiles: [OFFICIAL_GROUNDING_PROFILE] })
  try {
    scheduler.startKnowledgeWarmup(agent, change.journalRevision)
    await assert.rejects(scheduler.runProfile(agent, OFFICIAL_GROUNDING_PROFILE, change.journalRevision,
      new AbortController().signal, () => {}), /stop before reviewer execution/)
    assert.equal(reads, 1, 'the bounded dispatch must await the existing KAG promise')
    assert.equal(starts, 1)
  } finally { scheduler.dispose() }
})

test('slow KAG warmup falls back to Design Files without a second queued read', async () => {
  const agent = { id: 'agent-slow', status: 'idle', session: { events: [] } }
  const change = { journalRevision: 4, commit: 'checkpoint-4', kit: 'web_app', version: '1.0' }
  let reads = 0, starts = 0
  const scheduler = new DshAdvisoryScheduler({
    design: {
      advisoryDesignKnowledge: async () => { reads += 1; return new Promise(() => {}) },
      kitForAgent: () => ({ name: 'web_app', version: '1.0' }),
      readDesignJournal: async () => ({ snapshot: { latestDesignChange: change, design: {}, advisories: [] } }),
      projectForAgent: async () => ({ projectId: 'project-1', root: '/tmp/project', designFilesRoot: '/tmp/project/design_files' }),
    },
    subagents: { start: async () => { starts += 1; throw new Error('stop before reviewer execution') } },
    warn: () => {},
  }, { debounceMs: 0, knowledgeReadTimeoutMs: 50, profiles: [OFFICIAL_GROUNDING_PROFILE] })
  try {
    scheduler.startKnowledgeWarmup(agent, change.journalRevision)
    const began = Date.now()
    await assert.rejects(scheduler.runProfile(agent, OFFICIAL_GROUNDING_PROFILE, change.journalRevision,
      new AbortController().signal, () => {}), /stop before reviewer execution/)
    assert.ok(Date.now() - began < 1_000, 'KAG cannot hold review dispatch indefinitely')
    assert.equal(reads, 1)
    assert.equal(starts, 1, 'reviewer still starts from pinned Design Files')
  } finally { scheduler.dispose() }
})

test('manual recheck does not duplicate active work or consume a no-op request id', async () => {
  const agent = { id: 'agent-manual', status: 'idle', session: { events: [] } }
  const scheduler = new DshAdvisoryScheduler({
    design: { kitForAgent: () => ({ name: 'web_app', version: '1.0' }) },
    subagents: {}, warn: () => {},
  }, { debounceMs: 0, profiles: [OFFICIAL_GROUNDING_PROFILE] })
  const runs = []
  let releaseFirst
  scheduler.runProfile = async (_agent, _profile, revision, _signal, _onStarted, attemptId, onCompleted) => {
    runs.push({ revision, attemptId })
    if (runs.length === 1) await new Promise(resolve => { releaseFirst = resolve })
    onCompleted?.()
  }
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100 && !predicate(); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(predicate(), 'scheduler did not reach the expected phase')
  }
  try {
    assert.deepEqual(scheduler.requestManualReviews(agent, 7, [OFFICIAL_GROUNDING_PROFILE], 'request-1'), [OFFICIAL_GROUNDING_PROFILE])
    await waitFor(() => runs.length === 1)
    assert.deepEqual(scheduler.requestManualReviews(agent, 7, [OFFICIAL_GROUNDING_PROFILE], 'request-1'), [])
    assert.throws(() => scheduler.requestManualReviews(agent, 8, [OFFICIAL_GROUNDING_PROFILE], 'request-1'), /cannot change target/)
    assert.deepEqual(scheduler.requestManualReviews(agent, 7, [OFFICIAL_GROUNDING_PROFILE], 'request-2'), [], 'active same-target work is not duplicated')
    releaseFirst()
    await waitFor(() => scheduler.status(agent).phase === 'idle')
    assert.deepEqual(scheduler.requestManualReviews(agent, 7, [OFFICIAL_GROUNDING_PROFILE], 'request-2'), [OFFICIAL_GROUNDING_PROFILE], 'a noop during active work did not falsely consume this request')
    await waitFor(() => runs.length === 2)
    await waitFor(() => scheduler.status(agent).phase === 'idle')
    assert.deepEqual(scheduler.requestManualReviews(agent, 7, [OFFICIAL_GROUNDING_PROFILE], 'request-2'), [], 'a genuinely admitted request is idempotent')
    assert.deepEqual(scheduler.requestManualReviews(agent, 7, [OFFICIAL_GROUNDING_PROFILE], 'request-3'), [OFFICIAL_GROUNDING_PROFILE])
    await waitFor(() => runs.length === 3)
    assert.deepEqual(runs, [{ revision: 7, attemptId: 'request-1' }, { revision: 7, attemptId: 'request-2' }, { revision: 7, attemptId: 'request-3' }])
  } finally { scheduler.dispose() }
})

test('failed manual attempt leaves its request id retryable', async () => {
  const agent = { id: 'agent-retry', status: 'idle', session: { events: [] } }
  const scheduler = new DshAdvisoryScheduler({ design: { kitForAgent: () => ({ name: 'web_app', version: '1.0' }) },
    subagents: {}, warn: () => {} }, { debounceMs: 0, profiles: [OFFICIAL_GROUNDING_PROFILE] })
  let attempts = 0
  scheduler.runProfile = async (_agent, _profile, _revision, _signal, _onStarted, _attemptId, onCompleted) => {
    attempts += 1
    if (attempts === 1) throw new Error('reviewer failed')
    onCompleted?.()
  }
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100 && !predicate(); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(predicate())
  }
  try {
    assert.deepEqual(scheduler.requestManualReviews(agent, 11, [OFFICIAL_GROUNDING_PROFILE], 'same-request'), [OFFICIAL_GROUNDING_PROFILE])
    await waitFor(() => scheduler.status(agent).phase === 'failed')
    assert.deepEqual(scheduler.requestManualReviews(agent, 11, [OFFICIAL_GROUNDING_PROFILE], 'same-request'), [OFFICIAL_GROUNDING_PROFILE])
    await waitFor(() => attempts === 2 && scheduler.status(agent).phase === 'idle')
    assert.deepEqual(scheduler.requestManualReviews(agent, 11, [OFFICIAL_GROUNDING_PROFILE], 'same-request'), [])
  } finally { scheduler.dispose() }
})

test('GRA reads the admitted target without journal or HEAD scans, preserving source equivalence and binding checks', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111'
  let head = 'head-derived', reviewCommit = 'review-commit', publicationCommit = 'published-commit'
  let equal = true, mutateHeadDuringQuery = false
  let mutateJournalDuringQuery = false, mutateKitDuringQuery = false, mutateSelectionDuringQuery = false
  let kitVersion = '1.0', selectedProject = projectId
  const comparisons = []
  const publication = () => JSON.stringify({ schemaVersion: 1, key: 'k', edges: 'e', checkpoint: publicationCommit, revision: 'rev:7', warnings: [] })
  const receiver = {
    selectionForAgent: () => ({ projectId: selectedProject }),
    projects: { require: async () => ({ projectId, kit: { name: 'fixture', version: kitVersion } }) },
    assertProjectSelection(_agent, id) { if (id !== selectedProject) throw new Error('project selection changed') },
    journalMutations: new Map(),
    journals: { read: async () => { throw new Error('reader must not scan journal') } },
    withJournalForProject: DesignService.prototype.withJournalForProject,
    requireKnowledgeRuntime: () => ({
      semantic: { publicationCache: () => ({ readSemanticCache: async () => publication() }) },
      service: { query: async ({ revision }) => {
        if (mutateHeadDuringQuery) head = 'new-head'
        if (mutateJournalDuringQuery) reviewCommit = 'new-journal-commit'
        if (mutateKitDuringQuery) kitVersion = '2.0'
        if (mutateSelectionDuringQuery) selectedProject = 'other-project'
        return { revision, entities: [{ id: 'n', provenance: { producer: 'design-file-projection', checkpoint: publicationCommit }, properties: {} }], relations: [] }
      } },
    }),
    designFilesForProject: async () => ({}),
    knowledgeSourceMatches: async (_store, left, right) => { comparisons.push([left, right]); return equal },
  }
  const agent = { id: 'review-agent' }
  const read = () => DesignService.prototype.advisoryDesignKnowledge.call(receiver, agent, { project: projectId, checkpoint: 'review-commit' })
  const knowledge = await read()
  assert.equal(knowledge.checkpoint, reviewCommit)
  assert.equal(knowledge.sourceCheckpoint, publicationCommit)
  assert.deepEqual(comparisons, [[publicationCommit, reviewCommit]])
  assert.equal(JSON.parse(knowledge.context).sourceCheckpoint, publicationCommit)
  equal = false
  assert.equal(await read(), undefined, 'a real Bundle or referenced asset change rejects the old publication')
  equal = true
  mutateHeadDuringQuery = true
  assert.equal((await read()).checkpoint, 'review-commit', 'mutable HEAD cannot replace the admitted immutable review target')
  mutateHeadDuringQuery = false; head = 'head-derived'
  mutateJournalDuringQuery = true
  assert.equal((await read()).checkpoint, 'review-commit', 'reader does not re-admit a target from the changing journal')
  mutateJournalDuringQuery = false; reviewCommit = 'review-commit'
  mutateKitDuringQuery = true
  assert.equal(await read(), undefined, 'Kit identity changing at the same HEAD rejects a late snapshot')
  mutateKitDuringQuery = false; kitVersion = '1.0'
  publicationCommit = 'review-commit'
  receiver.designFilesForProject = async () => { throw new Error('equal pins must not create a Git store') }
  assert.equal((await read()).checkpoint, 'review-commit')
  mutateSelectionDuringQuery = true
  await assert.rejects(read(), /project selection changed/)
})


test('detached review consumes a normal read exceeding the old 250ms budget', async () => {
  const agent = { id: 'agent-normal-kag', status: 'idle', session: { events: [] } }
  const change = { journalRevision: 8, commit: 'checkpoint-8', kit: 'web_app', version: '1.0' }
  let reads = 0, captured
  const scheduler = new DshAdvisoryScheduler({
    design: {
      advisoryDesignKnowledge: async () => {
        reads += 1
        await new Promise(resolve => setTimeout(resolve, 350))
        return { project: 'project-1', checkpoint: change.commit, graph: { entities: [] }, context: 'knowledge-ready-after-250ms' }
      },
      kitForAgent: () => ({ name: 'web_app', version: '1.0' }),
      readDesignJournal: async () => ({ snapshot: { latestDesignChange: change, design: {}, advisories: [] } }),
      projectForAgent: async () => ({ projectId: 'project-1', root: '/tmp/project', designFilesRoot: '/tmp/project/design_files' }),
    },
    subagents: { start: async (_provider, request) => { captured = JSON.stringify(request.prompt); throw new Error('stop before reviewer execution') } },
    warn: () => {},
  }, { debounceMs: 0, profiles: [OFFICIAL_GROUNDING_PROFILE] })
  try {
    scheduler.startKnowledgeWarmup(agent, change.journalRevision)
    await assert.rejects(scheduler.runProfile(agent, OFFICIAL_GROUNDING_PROFILE, change.journalRevision,
      new AbortController().signal, () => {}), /stop before reviewer execution/)
    assert.equal(reads, 1)
    assert.match(captured, /knowledge-ready-after-250ms/)
    assert.doesNotMatch(captured, /knowledge-fallback/)
  } finally { scheduler.dispose() }
})

test('cancelled detached preparation neither dispatches a reviewer nor consumes a late snapshot', async () => {
  const agent = { id: 'agent-cancel-kag', status: 'idle', session: { events: [] } }
  const change = { journalRevision: 9, commit: 'checkpoint-9', kit: 'web_app', version: '1.0' }
  let reads = 0, starts = 0, release
  const controller = new AbortController()
  const scheduler = new DshAdvisoryScheduler({
    design: {
      advisoryDesignKnowledge: async () => { reads += 1; return new Promise(resolve => { release = resolve }) },
      kitForAgent: () => ({ name: 'web_app', version: '1.0' }),
      readDesignJournal: async () => ({ snapshot: { latestDesignChange: change, design: {}, advisories: [] } }),
      projectForAgent: async () => ({ projectId: 'project-1', root: '/tmp/project', designFilesRoot: '/tmp/project/design_files' }),
    },
    subagents: { start: async () => { starts += 1 } }, warn: () => {},
  }, { debounceMs: 0, profiles: [OFFICIAL_GROUNDING_PROFILE] })
  try {
    scheduler.startKnowledgeWarmup(agent, change.journalRevision)
    const running = scheduler.runProfile(agent, OFFICIAL_GROUNDING_PROFILE, change.journalRevision, controller.signal, () => {})
    while (release === undefined) await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('selected project changed'))
    assert.equal(await running, undefined)
    release({ project: 'project-1', checkpoint: change.commit, graph: { entities: [] }, context: 'late-snapshot' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reads, 1)
    assert.equal(starts, 0)
  } finally { scheduler.dispose() }
})

for (const invalidation of ['revision', 'kit']) {
  test(`late KAG result cannot dispatch after review ${invalidation} invalidation`, async () => {
    const agent = { id: 'agent-late-' + invalidation, status: 'idle', session: { events: [] } }
    let change = { journalRevision: 10, commit: 'checkpoint-10', kit: 'web_app', version: '1.0' }
    let kit = { name: 'web_app', version: '1.0' }, release, starts = 0
    const scheduler = new DshAdvisoryScheduler({
      design: {
        advisoryDesignKnowledge: async () => new Promise(resolve => { release = resolve }),
        kitForAgent: () => kit,
        readDesignJournal: async () => ({ snapshot: { latestDesignChange: change, design: {}, advisories: [] } }),
        projectForAgent: async () => ({ projectId: 'project-1', root: '/tmp/project', designFilesRoot: '/tmp/project/design_files' }),
      },
      subagents: { start: async () => { starts += 1 } }, warn: () => {},
    }, { profiles: [OFFICIAL_GROUNDING_PROFILE] })
    try {
      const running = scheduler.runProfile(agent, OFFICIAL_GROUNDING_PROFILE, 10, new AbortController().signal, () => {})
      while (release === undefined) await new Promise(resolve => setImmediate(resolve))
      if (invalidation === 'revision') change = { ...change, journalRevision: 11, commit: 'checkpoint-11' }
      else kit = { ...kit, version: '2.0' }
      release({ project: 'project-1', checkpoint: 'checkpoint-10', graph: { entities: [] }, context: 'stale-snapshot' })
      assert.equal(await running, undefined)
      assert.equal(starts, 0)
    } finally { scheduler.dispose() }
  })
}
