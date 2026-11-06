import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { DshAdvisoryScheduler } = await import('../src/dsh-advisory-plugin.ts')
const { TYPERT_REMOTE } = await import('../src/typert.remote-client.ts')
const { OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE } = await import('../src/official-advisory-profiles.ts')

const profiles = [OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE]
const checkpoint = 'a'.repeat(40)
function fixture() {
  const agent = { id: 'bound-session', status: 'idle',
    followup() { assert.fail('manual admission must not send a foreground prompt') },
    steer() { assert.fail('manual admission must not steer the foreground') },
  }
  const state = { projectId: 'project-a', revision: 5, records: [], scheduled: [], calls: [] }
  const scheduler = new DshAdvisoryScheduler({ design: {}, subagents: {}, warn: assert.fail }, { profiles })
  // Exercise real scheduler admission/coalescing without launching a reviewer.
  scheduler.schedule = (key, entry) => { state.scheduled.push({ key, agent: entry.agent, requestId: entry.readyAttemptId }) }
  scheduler.startKnowledgeWarmup = () => {}
  const design = {
    advisoryRuntimeStatus: () => ({ available: true, profiles, phase: 'idle' }),
    selectionForAgent: candidate => candidate === agent ? { projectId: state.projectId } : undefined,
    kitForAgent: () => ({ name: 'web_app', version: '1.0' }),
    readDesignJournal: async () => ({
      snapshot: { latestDesignChange: { journalRevision: state.revision, commit: checkpoint } },
      records: state.records,
    }),
    advisoryRuntime: { provider: scheduler },
    requestManualReviews(...args) {
      state.calls.push(args)
      return DesignService.prototype.requestManualReviews.call(this, ...args)
    },
  }
  const remote = Object.create(DesignPanelRemote.prototype)
  remote.design = design
  return { remote, agent, state, scheduler }
}

test('manual Panel command uses the resolved Agent and existing active/journal replay after a lost response', async () => {
  const { remote, agent, state, scheduler } = fixture()
  const signal = new AbortController().signal, requestId = 'panel-check-1'
  try {
    await assert.rejects((async () => {
      const accepted = await remote.requestManualReview(agent, requestId, signal)
      assert.equal(accepted.outcome, 'accepted')
      assert.deepEqual(accepted.profiles, profiles)
      throw new Error('client lost the accepted response')
    })(), /lost the accepted response/)
    const retry = await remote.requestManualReview(agent, requestId, signal)
    assert.equal(retry.outcome, 'noop')
    assert.equal(retry.reason, 'already-active-or-requested')
    assert.equal(state.scheduled.length, profiles.length, 'one admission per profile, not one per transport attempt')
    for (const scheduled of state.scheduled) {
      assert.equal(scheduled.agent, agent)
      assert.equal(scheduled.requestId, requestId)
    }
    assert.deepEqual(state.calls[0], [agent, requestId, undefined, signal], 'server binding and cancellation reach the existing service')

    state.records = profiles.map(profile => ({ type: 'design/advisory-review-completed',
      data: { profile, attemptId: requestId, designRevision: 5, commit: checkpoint } }))
    scheduler.dispose()
    const replay = await remote.requestManualReview(agent, requestId, signal)
    assert.equal(replay.reason, 'request-already-completed', 'journal completion wins even with a disposed/replaced scheduler')
    assert.equal(state.scheduled.length, profiles.length)
    state.revision = 6
    assert.equal((await remote.requestManualReview(agent, requestId, signal)).reason, 'request-id-target-mismatch')
  } finally { scheduler.dispose() }
})

test('unbound and cancelled manual commands never reach the scheduler', async () => {
  const { remote, agent, state, scheduler } = fixture()
  try {
    assert.deepEqual(await remote.requestManualReview({ id: 'other-session' }, 'unbound', new AbortController().signal),
      { outcome: 'rejected', reason: 'no-project' })
    const controller = new AbortController()
    controller.abort(new Error('caller cancelled'))
    await assert.rejects(remote.requestManualReview(agent, 'cancelled', controller.signal), /caller cancelled/)
    assert.deepEqual(state.scheduled, [])
  } finally { scheduler.dispose() }
})

test('manual command wire requires an Agent lookup and preserves strict structured outcomes', () => {
  const descriptor = TYPERT_REMOTE.descriptors.find(item => item.method === 'requestManualReview')
  assert.ok(descriptor)
  assert.deepEqual(descriptor.invocation, { kind: 'direct' })
  assert.deepEqual(descriptor.scope, { context: 'agent', wire: 'agentId' })
  assert.deepEqual(descriptor.parameters.map(({ name, wire, source, lookup }) => ({ name, wire, source, lookup })), [
    { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent' },
    { name: 'requestId', wire: 'requestId', source: 'json', lookup: undefined },
  ])
  assert.deepEqual(descriptor.cancellation, { parameter: 'signal' })
  const request = descriptor.parameters[1].codec.create()
  for (const invalid of ['', 'bad id', 'x'.repeat(65)]) assert.equal(request.safeParse(invalid).success, false)
  assert.equal(request.parse('panel-check-1'), 'panel-check-1')
  const result = descriptor.result.create()
  for (const outcome of [
    { outcome: 'accepted', reason: 'manual-reviews-triggered', target: { revision: 5, checkpoint }, profiles },
    { outcome: 'noop', reason: 'request-already-completed', target: { revision: 5, checkpoint } },
    { outcome: 'rejected', reason: 'no-project' },
  ]) assert.deepEqual(result.parse(outcome), outcome)
  for (const invalid of [
    { outcome: 'accepted', reason: 'missing target' },
    { outcome: 'running', reason: 'not an admission outcome' },
    { outcome: 'noop', reason: 'extra authority', startAgent: true },
    { outcome: 'noop', reason: 'extra target field', target: { agent: 'forged' } },
  ]) assert.equal(result.safeParse(invalid).success, false)
})
