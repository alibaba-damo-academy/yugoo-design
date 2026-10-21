import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { default: DesignService } = await import('../src/design-service.ts')
const { officialAdvisoryAttemptIds } = await import('../src/official-advisory-profiles.ts')

const projectId = '11111111-1111-4111-8111-111111111111'
const PROFILES = ['design.grounding', 'design.reflection', 'design.alignment']

function maintenanceReceiver({ state, recovery, retryRecovery, decision = 'scheduled' } = {}) {
  const calls = []
  const receiver = {
    selectionForAgent: () => ({ projectId }),
    knowledgeRuntime: { disposing: false, runtime: { ...(retryRecovery ? { retryRecovery: id => calls.push(['retryRecovery', id]) } : {}) } },
    knowledgeStatusSnapshot: async () => state,
    knowledgeMaintenanceTarget: () => 'gen-target-1',
    scheduleKnowledgeMaintenance: (agent, id, reason) => { calls.push(['schedule', id, reason]); return decision },
  }
  return { receiver, calls }
}
const request = (receiver, agent = {}) => DesignService.prototype.requestKnowledgeMaintenance.call(receiver, agent)
const snapshot = (overrides = {}) => ({
  schemaVersion: 1, project: projectId, head: 'c2', state: 'due', freshness: 'different',
  latestComplete: { checkpoint: 'c1', revision: 'rev:9', warningCount: 0 }, semanticLayer: 'enabled',
  ...overrides,
})

test('requestKnowledgeMaintenance returns structured outcomes aligned with the single-flight gates', async () => {
  // No selection / no runtime are honest rejections, never silent noops.
  assert.deepEqual(await request({ selectionForAgent: () => undefined }), { outcome: 'rejected', reason: 'no-project' })
  const noRuntime = maintenanceReceiver({ state: snapshot() })
  noRuntime.receiver.knowledgeRuntime = undefined
  assert.deepEqual(await request(noRuntime.receiver), { outcome: 'rejected', reason: 'no-knowledge-runtime' })

  // Fresh KAG ⇒ the Agent can no-op; the target identity is reported.
  const current = maintenanceReceiver({ state: snapshot({ state: 'current', freshness: 'matching', latestComplete: { checkpoint: 'c2', revision: 'rev:10', warningCount: 0 } }) })
  const noop = await request(current.receiver)
  assert.equal(noop.outcome, 'noop')
  assert.equal(noop.reason, 'current')
  assert.deepEqual(noop.target, { checkpoint: 'c2', generation: 'gen-target-1', lastPublishedRevision: 'rev:10' })
  assert.deepEqual(current.calls, [], 'a noop never schedules')

  for (const [state, reason] of [['queued', 'already-queued'], ['running', 'already-running']]) {
    const active = maintenanceReceiver({ state: snapshot({ state, phase: state === 'running' ? 'semantic' : undefined }) })
    const result = await request(active.receiver)
    assert.equal(result.outcome, 'noop')
    assert.equal(result.reason, reason)
    assert.deepEqual(active.calls, [])
  }

  for (const [state, reason] of [['unavailable', 'recovery-in-progress'], ['disabled', 'knowledge-runtime-incomplete'], ['unknown', 'no-published-checkpoint']]) {
    const blocked = maintenanceReceiver({ state: snapshot({ state }) })
    assert.deepEqual(await request(blocked.receiver), { outcome: 'rejected', reason, target: { checkpoint: 'c2', generation: 'gen-target-1', lastPublishedRevision: 'rev:9' } })
    assert.deepEqual(blocked.calls, [])
  }

  // Stale publication (due) ⇒ accepted, and the target names THIS request's
  // generation identity while the stale publication is reported separately.
  const due = maintenanceReceiver({ state: snapshot() })
  const accepted = await request(due.receiver)
  assert.equal(accepted.outcome, 'accepted')
  assert.equal(accepted.reason, 'maintenance-accepted')
  assert.deepEqual(accepted.target, { checkpoint: 'c2', generation: 'gen-target-1', lastPublishedRevision: 'rev:9' })
  assert.notEqual(accepted.target.generation, accepted.target.lastPublishedRevision)
  assert.deepEqual(due.calls, [['schedule', projectId, 'retry']], 'explicit requests ride the retry gate, never the auto-attempt gate')

  // The result must match the real single-flight decision: a concurrent pass
  // is disclosed as merged; a gate that admitted nothing is a rejection.
  const merged = maintenanceReceiver({ state: snapshot(), decision: 'merged' })
  const mergedResult = await request(merged.receiver)
  assert.equal(mergedResult.outcome, 'accepted')
  assert.equal(mergedResult.reason, 'merged-into-active-pass')
  const skipped = maintenanceReceiver({ state: snapshot(), decision: 'skipped' })
  const skippedResult = await request(skipped.receiver)
  assert.deepEqual(skippedResult.outcome, 'rejected')
  assert.equal(skippedResult.reason, 'not-schedulable')

  // A failed generation is re-admitted by an explicit request (never auto-looped).
  const failed = maintenanceReceiver({ state: snapshot({ state: 'failed', lastFailure: { target: 't', message: 'model down' } }) })
  const retried = await request(failed.receiver)
  assert.equal(retried.outcome, 'accepted')
  assert.equal(retried.reason, 'failed-generation-retry-accepted')
  assert.deepEqual(failed.calls, [['schedule', projectId, 'retry']])

  // A recovery-store error keeps its explicit retry gate.
  const recoveryError = maintenanceReceiver({
    state: snapshot({ state: 'failed', recovery: { state: 'error', message: 'store corrupt' } }),
    retryRecovery: true,
  })
  const recovered = await request(recoveryError.receiver)
  assert.equal(recovered.outcome, 'accepted')
  assert.equal(recovered.reason, 'recovery-retry-accepted')
  assert.deepEqual(recoveryError.calls, [['retryRecovery', projectId], ['schedule', projectId, 'retry']])
  const notRetryable = maintenanceReceiver({ state: snapshot({ state: 'failed', recovery: { state: 'error', message: 'store corrupt' } }) })
  assert.deepEqual((await request(notRetryable.receiver)).reason, 'recovery-error-not-retryable')
  assert.deepEqual(notRetryable.calls, [])
})

function reviewReceiver({ status, journal, provider } = {}) {
  const receiver = {
    advisoryRuntimeStatus: () => status,
    selectionForAgent: () => ({ projectId }),
    kitForAgent: () => ({ name: 'web_app', version: '1.0' }),
    readReviewPolicy: async () => ({ mode: 'auto', autoMergeWindowMs: 30000 }),
    readDesignJournal: async () => ({ snapshot: journal, records: [] }),
    advisoryRuntime: provider === undefined ? undefined : { provider },
  }
  return receiver
}
const requestReviews = (receiver, profiles, agent = {}) => DesignService.prototype.requestReviews.call(receiver, agent, profiles)
const change = (journalRevision = 5, commit = 'c1') => ({ journalRevision, commit })
test('off rejects Agent GRA before any scheduler trigger', async () => {
  const receiver = reviewReceiver({ status: { available: true, profiles: PROFILES, phase: 'idle' } })
  receiver.readReviewPolicy = async () => ({ mode: 'off', autoMergeWindowMs: 30000 })
  receiver.readDesignJournal = async () => { throw new Error('disabled reviews must not read or dispatch') }
  assert.deepEqual(await requestReviews(receiver), { outcome: 'rejected', reason: 'gra-disabled-by-user' })
})
const completion = (profile, designRevision = 5, commit = 'c1') => ({
  profile, designRevision, commit, itemCount: 0, knowledgeUsed: false, fallbackReason: 'timeout',
  kit: 'web_app', kitVersion: '1.0', vocabularyRevision: 'v1', journalRevision: designRevision + 1,
})

test('requestReviews triggers only due profiles through the idempotent scheduler entry', async () => {
  const unavailable = reviewReceiver({ status: { available: false, profiles: [], phase: 'failed' } })
  assert.deepEqual(await requestReviews(unavailable), { outcome: 'rejected', reason: 'advisory-runtime-unavailable' })

  const base = {
    available: true, profiles: PROFILES, phase: 'idle',
    profileStatus: [],
  }
  const unknown = reviewReceiver({ status: base, journal: { latestDesignChange: change(), reviewCompletions: [] } })
  assert.deepEqual((await requestReviews(unknown, ['design.bogus'])).reason, 'unknown-profiles:design.bogus')

  const noChange = reviewReceiver({ status: base, journal: { reviewCompletions: [] } })
  assert.deepEqual(await requestReviews(noChange), { outcome: 'rejected', reason: 'no-design-change' })
  const noCommit = reviewReceiver({ status: base, journal: { latestDesignChange: { journalRevision: 3 }, reviewCompletions: [] } })
  assert.deepEqual(await requestReviews(noCommit), { outcome: 'rejected', reason: 'no-published-commit' })

  // Everything completed for the latest revision ⇒ honest noop.
  const allDone = reviewReceiver({
    status: base,
    journal: { latestDesignChange: change(), reviewCompletions: PROFILES.map(profile => completion(profile)) },
  })
  const noneDue = await requestReviews(allDone)
  assert.equal(noneDue.outcome, 'noop')
  assert.equal(noneDue.reason, 'none-due')
  assert.deepEqual(noneDue.target, { revision: 5, checkpoint: 'c1' })

  // A newer change makes every profile due; the trigger carries exactly them.
  const triggered = []
  const provider = { requestReviews: (agent, revision, profiles) => triggered.push([revision, profiles]) }
  const due = reviewReceiver({
    status: base,
    journal: { latestDesignChange: change(7, 'c2'), reviewCompletions: PROFILES.map(profile => completion(profile)) },
    advisoryRuntime: undefined,
  })
  due.advisoryRuntime = { provider }
  const accepted = await requestReviews(due)
  assert.equal(accepted.outcome, 'accepted')
  assert.deepEqual(accepted.profiles, PROFILES)
  assert.deepEqual(triggered, [[7, PROFILES]])

  // A subset request limits the fan-out; already-active loops for the current
  // revision are excluded (idempotent), older-revision loops are refreshed.
  const looped = reviewReceiver({
    status: { ...base, profileStatus: [
      { profile: 'design.grounding', phase: 'running', latestRevision: 7 },
      { profile: 'design.reflection', phase: 'scheduled', latestRevision: 4 },
    ] },
    journal: { latestDesignChange: change(7, 'c2'), reviewCompletions: [] },
  })
  looped.advisoryRuntime = { provider: { requestReviews: (agent, revision, profiles) => triggered.push([revision, profiles]) } }
  const subset = await requestReviews(looped, ['design.grounding', 'design.reflection', 'design.alignment'])
  assert.equal(subset.outcome, 'accepted')
  assert.deepEqual(subset.profiles, ['design.reflection', 'design.alignment'], 'grounding is already running for revision 7')
  assert.deepEqual(triggered.at(-1), [7, ['design.reflection', 'design.alignment']])

  // All requested profiles already active ⇒ noop already-active.
  const active = reviewReceiver({
    status: { ...base, profileStatus: [{ profile: 'design.grounding', phase: 'running', latestRevision: 7 }] },
    journal: { latestDesignChange: change(7, 'c2'), reviewCompletions: [] },
  })
  active.advisoryRuntime = { provider }
  const noopActive = await requestReviews(active, ['design.grounding'])
  assert.equal(noopActive.outcome, 'noop')
  assert.equal(noopActive.reason, 'already-active')

  // A host without the trigger capability reports honestly instead of faking acceptance.
  const noTrigger = reviewReceiver({ status: base, journal: { latestDesignChange: change(), reviewCompletions: [] } })
  assert.deepEqual(await requestReviews(noTrigger), { outcome: 'rejected', reason: 'host-adapter-missing-trigger' })
})

test('explicit manual recheck can run a completed revision and replays by request id', async () => {
  const calls = []
  let newlyScheduled = [PROFILES[0]]
  const provider = { requestManualReviews: (_agent, revision, profiles, requestId) => {
    calls.push({ revision, profiles, requestId })
    return newlyScheduled
  } }
  const receiver = reviewReceiver({
    status: { available: true, profiles: PROFILES, phase: 'idle', profileStatus: [] },
    journal: { latestDesignChange: change(), reviewCompletions: PROFILES.map(profile => completion(profile)) },
    provider,
  })
  const recheck = (id, profiles = [PROFILES[0]]) => DesignService.prototype.requestManualReviews.call(receiver, {}, id, profiles)
  const accepted = await recheck('request-1')
  assert.equal(accepted.outcome, 'accepted')
  assert.equal(accepted.reason, 'manual-reviews-triggered')
  assert.deepEqual(calls, [{ revision: 5, profiles: [PROFILES[0]], requestId: 'request-1' }])
  newlyScheduled = []
  assert.equal((await recheck('request-2')).reason, 'already-active-or-requested')

  receiver.readDesignJournal = async () => ({
    snapshot: { latestDesignChange: change(), reviewCompletions: PROFILES.map(profile => completion(profile)) },
    records: [{ type: 'design/advisory-review-completed', data: { attemptId: 'request-1', profile: PROFILES[0], designRevision: 5, commit: 'c1' } }],
  })
  assert.equal((await recheck('request-1')).reason, 'request-already-completed')
  assert.equal((await recheck('request-1', [PROFILES[1]])).reason, 'already-active-or-requested', 'uncompleted profile remains eligible')
  newlyScheduled = [PROFILES[1], PROFILES[2]]
  const partial = await recheck('request-1', PROFILES)
  assert.deepEqual(partial.profiles, [PROFILES[1], PROFILES[2]], 'completed profile is not run again after replay')
  assert.deepEqual(calls.at(-1).profiles, [PROFILES[1], PROFILES[2]])
  receiver.readDesignJournal = async () => ({
    snapshot: { latestDesignChange: change(6, 'c2'), reviewCompletions: [] },
    records: [{ type: 'design/advisory-review-completed', data: { attemptId: 'request-1', profile: PROFILES[0], designRevision: 5, commit: 'c1' } }],
  })
  assert.equal((await recheck('request-1')).reason, 'request-id-target-mismatch')
  assert.equal((await recheck('bad id!')).reason, 'invalid-request-id')
})

test('manual retry repairs a published advisory whose completion append failed without rerunning the model', async () => {
  const profile = PROFILES[0], requestId = 'repair-1'
  const id = officialAdvisoryAttemptIds(profile, 5, requestId).advisoryId
  const advisory = { id, profile, items: [{ id: 'finding-1' }], inputs: [
    { source: 'kit:web_app', revision: '1.0' },
    { source: 'design-project', revision: projectId },
    { source: 'relation-vocabulary', revision: 'v1' },
    { source: 'design-revision', revision: '5' },
    { source: 'design-commit', revision: 'c1' },
    { source: 'knowledge-fallback', revision: 'timeout' },
  ] }
  let scheduling = 0
  const repaired = []
  const receiver = reviewReceiver({
    status: { available: true, profiles: PROFILES, phase: 'idle', profileStatus: [] },
    journal: { latestDesignChange: change(), reviewCompletions: [], advisories: [{ advisory }] },
    provider: { requestManualReviews: () => { scheduling += 1; return [profile] } },
  })
  receiver.recordAdvisoryReviewCompletion = async (_agent, completion) => { repaired.push(completion); return { recorded: true } }
  const result = await DesignService.prototype.requestManualReviews.call(receiver, {}, requestId, [profile])
  assert.equal(result.reason, 'request-already-completed')
  assert.equal(scheduling, 0, 'the published model output is reused rather than regenerated')
  assert.deepEqual(repaired, [{ profile, attemptId: requestId, designRevision: 5, commit: 'c1', itemCount: 1,
    knowledgeUsed: false, fallbackReason: 'timeout', kit: 'web_app', kitVersion: '1.0', vocabularyRevision: 'v1' }])
  receiver.recordAdvisoryReviewCompletion = async () => { throw new Error('journal unavailable') }
  await assert.rejects(DesignService.prototype.requestManualReviews.call(receiver, {}, requestId, [profile]), /journal unavailable/)
  assert.equal(scheduling, 0, 'failed repair still does not rerun the model')
})

test('manual retry refuses a published advisory pinned to another project or Kit', async () => {
  const profile = PROFILES[0], requestId = 'repair-forged'
  const id = officialAdvisoryAttemptIds(profile, 5, requestId).advisoryId
  const baseInputs = [
    { source: 'kit:web_app', revision: '1.0' },
    { source: 'design-project', revision: projectId },
    { source: 'design-revision', revision: '5' },
    { source: 'design-commit', revision: 'c1' },
    { source: 'knowledge-fallback', revision: 'timeout' },
  ]
  let scheduling = 0, recording = 0
  const receiver = reviewReceiver({
    status: { available: true, profiles: PROFILES, phase: 'idle', profileStatus: [] },
    journal: { latestDesignChange: change(), reviewCompletions: [], advisories: [{ advisory: { id, profile, items: [], inputs: baseInputs } }] },
    provider: { requestManualReviews: () => { scheduling += 1; return [profile] } },
  })
  receiver.recordAdvisoryReviewCompletion = async () => { recording += 1 }
  for (const inputs of [
    baseInputs.map(input => input.source === 'design-project' ? { ...input, revision: 'another-project' } : input),
    baseInputs.map(input => input.source === 'kit:web_app' ? { source: 'kit:other', revision: '1.0' } : input),
    baseInputs.map(input => input.source === 'kit:web_app' ? { ...input, revision: '0.9' } : input),
  ]) {
    receiver.readDesignJournal = async () => ({ snapshot: { latestDesignChange: change(), advisories: [{ advisory: { id, profile, items: [], inputs } }] }, records: [] })
    const result = await DesignService.prototype.requestManualReviews.call(receiver, {}, requestId, [profile])
    assert.equal(result.reason, 'published-attempt-pin-mismatch')
  }
  const secondProfile = PROFILES[1]
  receiver.readDesignJournal = async () => ({ snapshot: { latestDesignChange: change(), advisories: [
    { advisory: { id, profile, items: [], inputs: baseInputs } },
    { advisory: { id: officialAdvisoryAttemptIds(secondProfile, 5, requestId).advisoryId,
      profile: secondProfile, items: [], inputs: baseInputs.map(input => input.source === 'design-project'
        ? { ...input, revision: 'another-project' } : input) } },
  ] }, records: [] })
  const multi = await DesignService.prototype.requestManualReviews.call(receiver, {}, requestId, [profile, secondProfile])
  assert.equal(multi.reason, 'published-attempt-pin-mismatch')
  assert.equal(recording, 0, 'all recovery pins are validated before any completion is appended')
  assert.equal(scheduling, 0)
  assert.equal(recording, 0)
})

test('only successful Design publications schedule KAG; status snapshots still dedupe', async () => {
  const injected = []
  const listeners = []
  const maintenance = []
  const receiver = {
    workspaceChangeListeners: new Set([change => listeners.push(change.kind)]),
    injectKnowledgeOrchestrationSnapshot: async agent => { injected.push(agent) },
    scheduleKnowledgeMaintenance: (agent, id, reason) => { maintenance.push([agent, id, reason]) },
    selectionForAgent: () => ({ projectId }),
  }
  const notify = change => DesignService.prototype.notifyWorkspaceChange.call(receiver, change)
  const agent = { id: 'a1' }
  await notify({ kind: 'design-changed', agent, journalRevision: 5 })
  await notify({ kind: 'selection-changed', agent })
  await notify({ kind: 'advisory-changed', agent, journalRevision: 6 })
  assert.deepEqual(injected, [agent, agent], 'settlement and selection inject; advisory-changed does not')
  assert.deepEqual(listeners, ['design-changed', 'selection-changed', 'advisory-changed'], 'observers still see every change')
  assert.deepEqual(maintenance, [[agent, projectId, 'changed']], 'selection and advice cannot trigger maintenance')
  await notify({kind:'design-changed',agent,journalRevision:7,projectId:'another-project'})
  assert.equal(maintenance.length,1,'late publication cannot refresh a newly selected project')
  await notify({kind:'review-policy-changed',agent,policy:{mode:'off',autoMergeWindowMs:30000}})
  assert.equal(injected.length,3,'policy changes inject a non-waking policy reminder')
  assert.equal(maintenance.length,1,'policy changes never reindex facts')

  // Injection itself: deduped by content, contained on failure.
  const messages = []
  const injectAgent = { id: 'a2', inject: message => messages.push(message) }
  let currentSnapshot
  const injectReceiver = {
    knowledgeStatusInjections: new WeakMap(),
    selectionForAgent: () => ({ projectId }),
    knowledgeStatusSnapshot: async () => {
      if (currentSnapshot === 'throw') throw new Error('sampling failed')
      return currentSnapshot
    },
    reviewStatuses: async () => [],
    readReviewPolicy: async () => ({mode:'auto',autoMergeWindowMs:30000}),
  }
  const inject = () => DesignService.prototype.injectKnowledgeOrchestrationSnapshot.call(injectReceiver, injectAgent)
  currentSnapshot = { schemaVersion: 1, project: projectId, head: 'c1', state: 'due', freshness: 'none', semanticLayer: 'enabled' }
  await inject()
  await inject()
  assert.equal(messages.length, 1, 'identical consecutive snapshots inject once')
  assert.match(messages[0].content[0].text, /<design-knowledge-status>/)
  assert.equal(messages[0].source.form, 'notice')
  currentSnapshot = { ...currentSnapshot, state: 'current', freshness: 'matching' }
  await inject()
  assert.equal(messages.length, 2, 'a changed state injects again')
  currentSnapshot = 'throw'
  await inject()
  assert.equal(messages.length, 2, 'a sampling failure never surfaces to the lifecycle event')
  currentSnapshot = undefined
  await inject()
  assert.equal(messages.length, 2, 'no selection or runtime injects nothing')
})

test('injection identity: project switches are never deduped away and mid-sample selection changes are dropped', async () => {
  const messages = []
  const agent = { id: 'switcher', inject: message => messages.push(message) }
  let selected = 'project-a'
  const shape = { schemaVersion: 1, head: 'c1', state: 'due', freshness: 'none', semanticLayer: 'enabled' }
  const receiver = {
    knowledgeStatusInjections: new WeakMap(),
    selectionForAgent: () => ({ projectId: selected }),
    // The snapshot reports whichever project was selected when sampling began.
    knowledgeStatusSnapshot: async () => ({ ...shape, project: selected }),
    reviewStatuses: async () => [],
    readReviewPolicy: async () => ({mode:'auto',autoMergeWindowMs:30000}),
  }
  const inject = () => DesignService.prototype.injectKnowledgeOrchestrationSnapshot.call(receiver, agent)

  await inject()
  assert.equal(messages.length, 1)
  assert.match(messages[0].content[0].text, /project: project-a/)
  // Two projects with identical state still produce distinct notices because
  // the reminder carries the project identity.
  selected = 'project-b'
  await inject()
  assert.equal(messages.length, 2, 'a real project switch is never suppressed by dedupe')
  assert.match(messages[1].content[0].text, /project: project-b/)
  // A selection that changes WHILE sampling drops the stale-project notice.
  const switching = {
    ...receiver,
    knowledgeStatusInjections: receiver.knowledgeStatusInjections,
    knowledgeStatusSnapshot: async () => {
      const snapshot = { ...shape, project: selected }
      selected = 'project-c'
      return snapshot
    },
  }
  await DesignService.prototype.injectKnowledgeOrchestrationSnapshot.call(switching, agent)
  assert.equal(messages.length, 2, 'a mid-sample selection change injects nothing')
})
