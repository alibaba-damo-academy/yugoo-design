/** Passive Panel admission and attached Bundle assessment, not Host/model E2E. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { setImmediate as tick } from 'node:timers/promises'
import { DshClarityLifecycle } from '../src/dsh-clarity-lifecycle.ts'
import DesignService from '../src/design-service.ts'
import { projectKitContentHash } from '../src/project-content.ts'
import { TYPERT_REMOTE } from '../src/typert.remote-client.ts'

const A = 'a'.repeat(40), B = 'b'.repeat(40)
const flush = async () => { await tick(); await tick() }
function fixture() {
  const project = { projectId: '11111111-1111-4111-8111-111111111111', root: '/fixture/project',
    designFilesRoot: '/fixture/project/design_files', stateRoot: '/fixture/state', kit: { name: 'fixture', version: '1.0' } }
  const kit = { name: 'fixture', version: '1.0', mindset: 'One bounded decision.', skills: [] }
  const events = [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'A local prototype.' }] } }]
  const state = { project, kit, head: A, equivalent: false, calls: [], injections: [], result: undefined, wait: undefined }
  const agent = { id: 'main-session', session: { header: { origin: 'user' }, snapshotEvents: () => events }, inject(message) {
    state.injections.push(message)
  } }
  const projectMutationScope = new AsyncLocalStorage(), workspaceReadScope = new AsyncLocalStorage()
  const design = {
    projectMutationScope, workspaceReadScope,
    outsideProjectMutation: DesignService.prototype.outsideProjectMutation,
    assertProjectSelection(_agent, id) { assert.equal(state.project?.projectId, id, 'original selected project required') },
    async selectedProjectForAgent() { return state.project },
    requireKitForAgent() { return state.kit },
    async designFilesForProject() { return { async head() { return state.head }, async sameDesignEvidenceAt() { return state.equivalent } } },
  }
  const evaluate = async request => {
    assert.equal(projectMutationScope.getStore(), undefined, 'Bundle assessment cannot inherit reentrant Design mutation authority')
    assert.equal(workspaceReadScope.getStore(), undefined)
    state.calls.push(request)
    if (state.wait) await state.wait
    if (request.signal.aborted) return { status: 'stale', summary: 'cancelled' }
    return state.result ?? { status: 'updated', report: { summary: 'Saved evidence assessed.',
      u: { score: 50, evidence: 'Intent evidence.' }, s: { score: 40, evidence: 'Structure evidence.' }, t: { score: 30, evidence: 'Observable evidence.' } } }
  }
  const lifecycle = new DshClarityLifecycle(design, evaluate)
  const receipt = (eventId = 'save-a', commit = A, meaningful = true) => ({ project, kit, kitContentHash: projectKitContentHash(kit),
    eventId, commit, returnedCommit: commit, meaningful })
  const record = (eventId = 'save-a', commit = A, meaningful = true) => { const value = receipt(eventId, commit, meaningful); lifecycle.recordPanelSave(agent, value); return value }
  const controller = new AbortController()
  const admit = (rpc = 'host-rpc', saves = [{ eventId: 'save-a', commit: A }]) => lifecycle.admitPanelSave(agent, { requestId: rpc, saves })
  const activity = () => lifecycle.activity(agent, project.projectId)
  return { project, kit, events, state, agent, lifecycle, record, receipt, controller, admit, activity, design }
}

for (const meaningful of [true, false]) test(`Panel receipt admission never starts assessment or orphan activity: meaningful ${meaningful}`, async () => {
  const f = fixture(); f.record('save-a', A, meaningful)
  assert.equal(f.state.calls.length, 0, 'a settled save starts no evaluator')
  assert.equal(f.activity(), undefined)
  assert.equal(f.admit().status, 'unchanged')
  assert.equal(f.activity(), undefined, 'metadata must not create waiting or running activity')
  f.events.push({ type: 'user/message', data: { source: { kind: 'user', rpcId: 'host-rpc' },
    content: [{ type: 'text', text: 'Save and continue designing' }] } })
  assert.equal(f.admit().status, 'unchanged')
  await flush()
  assert.equal(f.state.calls.length, 0, 'logged continuation and exact metadata replay do not spawn a child')
  assert.equal(f.state.injections.length, 0)
  assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('missing, mismatched and partial receipts fail without consuming the request correlation', async () => {
  const f = fixture(); f.record()
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'missing', commit: A }]), /matching settled receipt/)
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'save-a', commit: A }, { eventId: 'failed-save', commit: B }]), /matching settled receipt/)
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'save-a', commit: B }]), /matching settled receipt/)
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'save-a' }]), /matching settled receipt/)
  assert.equal(f.admit().status, 'unchanged')
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'different', commit: A }]), /identity reused/)
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('request correlation rejects empty, oversized and duplicate saved batches', async () => {
  const f = fixture(); f.record()
  for (const request of [
    { requestId: '', saves: [{ eventId: 'save-a', commit: A }] },
    { requestId: 'x'.repeat(257), saves: [{ eventId: 'save-a', commit: A }] },
    { requestId: 'host-rpc', saves: [] },
    { requestId: 'host-rpc', saves: Array.from({ length: 65 }, (_, i) => ({ eventId: 'save-'+i, commit: A })) },
    { requestId: 'host-rpc', saves: [{ eventId: 'save-a', commit: A }, { eventId: 'save-a', commit: A }] },
  ]) assert.throws(() => f.lifecycle.admitPanelSave(f.agent, request), /invalid saved batch correlation/)
  assert.equal(f.admit().status, 'unchanged', 'invalid metadata does not reserve a valid request id')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('multiple saved checkpoints and browser array order remain passive metadata', async () => {
  const f = fixture(); f.record('first', A); f.record('second', B); f.state.head = B
  const saves = [{ eventId: 'second', commit: B }, { eventId: 'first', commit: A }]
  assert.equal(f.admit('host-rpc', saves).status, 'unchanged')
  assert.equal(f.admit('another-rpc', [...saves].reverse()).status, 'unchanged')
  assert.throws(() => f.admit('host-rpc', [...saves].reverse()), /identity reused/)
  assert.equal(f.admit('late-old', [{ eventId: 'first', commit: A }]).status, 'unchanged')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.state.injections.length, 0)
  assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('exact settled-receipt replay is idempotent and changed publication evidence is refused', async () => {
  const f = fixture(); const original = f.record()
  assert.doesNotThrow(() => f.lifecycle.recordPanelSave(f.agent, { ...original, project: { ...f.project } }))
  for (const change of [
    { commit: B }, { returnedCommit: B }, { returnedCommit: undefined }, { meaningful: false },
    { kitContentHash: 'f'.repeat(64) },
    { project: { ...f.project, root: '/other/root' } },
    { project: { ...f.project, designFilesRoot: '/other/design_files' } },
  ]) assert.throws(() => f.lifecycle.recordPanelSave(f.agent, { ...original, ...change }), /identity reused/)
  assert.equal(f.admit().status, 'unchanged')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('a settled receipt correlates the returned commit rather than relabeling its assessed checkpoint', async () => {
  const f = fixture()
  f.lifecycle.recordPanelSave(f.agent, { ...f.receipt(), commit: B, returnedCommit: A })
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'save-a', commit: B }]), /matching settled receipt/)
  assert.equal(f.admit().status, 'unchanged')
  f.lifecycle.reset(f.agent)
  f.lifecycle.recordPanelSave(f.agent, { ...f.receipt(), returnedCommit: undefined })
  assert.equal(f.admit('host-rpc', [{ eventId: 'save-a' }]).status, 'unchanged')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

for (const input of ['project', 'Kit']) test(`saved batches cannot cross ${input} input`, async () => {
  const f = fixture(); f.record()
  // Isolate the batch's own cross-input guard from the service selection guard.
  if (input === 'project') f.design.assertProjectSelection = () => {}
  const otherKit = { ...f.kit, mindset: 'A different Kit calibration.' }
  f.lifecycle.recordPanelSave(f.agent, { ...f.receipt('other-save', B),
    ...(input === 'project' ? { project: { ...f.project, projectId: '22222222-2222-4222-8222-222222222222' } }
      : { kit: otherKit, kitContentHash: projectKitContentHash(otherKit) }),
  })
  assert.throws(() => f.admit('host-rpc', [{ eventId: 'save-a', commit: A }, { eventId: 'other-save', commit: B }]), /crosses project or Kit input/)
  assert.equal(f.admit().status, 'unchanged', 'a rejected mixed batch does not reserve the request id')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('receipt recording and admission require the original selected project', async () => {
  const f = fixture(); f.record(); f.state.project = undefined
  assert.throws(() => f.record('different-save', B), /original selected project required/)
  assert.throws(() => f.admit(), /original selected project required/)
  assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('reset clears saved receipts and request correlations without leaving activity', async () => {
  const f = fixture(); f.record(); f.admit(); f.lifecycle.reset(f.agent)
  assert.throws(() => f.admit(), /matching settled receipt/)
  f.record('save-a', B)
  assert.equal(f.admit('host-rpc', [{ eventId: 'save-a', commit: B }]).status, 'unchanged')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

for (const boundary of ['dispose', 'subagent']) test(`${boundary} makes passive Panel admission unavailable`, async () => {
  const f = fixture()
  if (boundary === 'dispose') { f.record(); f.admit(); f.lifecycle.dispose() }
  else f.agent.session.header.origin = 'subagent'
  f.record()
  assert.equal(f.admit().status, 'unavailable')
  if (boundary === 'subagent') {
    f.agent.session.header.origin = 'user'
    assert.throws(() => f.admit(), /matching settled receipt/, 'subagent receipts are not retained for a later main Agent')
  }
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.state.injections.length, 0)
  assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

for (const change of ['scope', 'cancel']) test(`passive metadata leaves no work or activity after ${change}`, async () => {
  const f = fixture(); f.record(); f.admit()
  if (change === 'scope') f.events.push({ type: 'user/message', data: { source: { kind: 'user' },
    content: [{ type: 'text', text: 'A different product scope.' }] } })
  else f.controller.abort()
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.state.injections.length, 0)
  assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('passive metadata does no model work inside inherited mutation/read scopes', async () => {
  const f = fixture(); f.record()
  const admitted = f.design.projectMutationScope.run('held-project', () => f.design.workspaceReadScope.run({ active: true }, () => f.admit()))
  assert.equal(admitted.status, 'unchanged')
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.state.injections.length, 0)
  assert.equal(f.activity(), undefined)
  f.lifecycle.dispose()
})

test('Panel metadata cannot replace or cancel an attached Bundle assessment', async () => {
  const f = fixture(); f.record()
  let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: A, turn: 39, signal: f.controller.signal }
  const pending = f.lifecycle.assess(request); await flush()
  const running = f.activity()
  assert.equal(running.phase, 'running')
  assert.equal(f.admit().status, 'unchanged')
  assert.deepEqual(f.activity(), running)
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].signal.aborted, false)
  release(); assert.equal((await pending).status, 'updated')
  assert.equal(f.activity(), undefined); assert.equal(f.state.injections.length, 0)
  f.lifecycle.dispose()
})

for (const change of ['cancel', 'selection', 'dispose']) test(`${change} cancels attached Bundle assessment and prevents result injection`, async () => {
  const f = fixture()
  let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: A, turn: 39, signal: f.controller.signal }
  const pending = f.lifecycle.assess(request); await flush(); assert.equal(f.state.calls.length, 1)
  if (change === 'cancel') f.controller.abort()
  else if (change === 'selection') { f.state.project = undefined; f.lifecycle.reset(f.agent) }
  else f.lifecycle.dispose()
  assert.equal(f.state.calls[0].signal.aborted, true)
  release(); assert.equal((await pending).status, 'stale'); assert.equal(f.state.injections.length, 0)
  f.lifecycle.dispose()
})

test('failed attached assessment returns its failure and has no fake score', async () => {
  const f = fixture()
  f.state.result = { status: 'failed', summary: 'Native capability unavailable.' }
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: A, turn: 39, signal: f.controller.signal }
  assert.deepEqual(await f.lifecycle.assess(request), f.state.result)
  assert.deepEqual(f.activity(), { phase: 'failed', checkpoint: A, summary: 'Native capability unavailable.' })
  assert.equal(f.state.injections.length, 0); f.lifecycle.dispose()
})

test('same input overlaps share one job; completed publication awaits but does not inject another notice', async () => {
  const f = fixture(); let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: A, turn: 39, signal: f.controller.signal }
  let returned = false
  const completed = f.lifecycle.assess(request).then(result => { returned = true; return result })
  const repeated = f.lifecycle.assess(request)
  await flush(); assert.equal(f.state.calls.length, 1); assert.equal(returned, false)
  release(); assert.equal((await completed).status, 'updated'); assert.equal((await repeated).status, 'updated')
  assert.equal(f.state.injections.length, 0); f.lifecycle.dispose()
})

test('a late old checkpoint cannot cancel a newer useful assessment', async () => {
  const f = fixture(); f.state.head = B
  let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: B, turn: 39, signal: f.controller.signal }
  const current = f.lifecycle.assess(request); await flush()
  assert.equal((await f.lifecycle.assess({ ...request, commit: A }, true)).status, 'stale')
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].signal.aborted, false)
  assert.equal(f.activity().checkpoint, B); release(); await current; f.lifecycle.dispose()
})

test('equivalent old audit evidence cannot cancel the current-head job', async () => {
  const f = fixture(); f.state.head = B; f.state.equivalent = true
  let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: B, turn: 40, signal: f.controller.signal }
  const current = f.lifecycle.assess(request); await flush()
  assert.equal((await f.lifecycle.assess({ ...request, commit: A, turn: 39 }, true)).status, 'stale')
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].signal.aborted, false)
  assert.equal(f.activity().checkpoint, B); release(); await current; f.lifecycle.dispose()
})

test('a preflight awaiting final selection cannot replace a later-started job with its old head snapshot', async () => {
  const f = fixture(); let finalSelection, releaseSelection
  const paused = new Promise(resolve => { finalSelection = resolve })
  const gate = new Promise(resolve => { releaseSelection = resolve })
  let reads = 0
  f.design.selectedProjectForAgent = async () => { if (++reads === 2) { finalSelection(); await gate } return f.state.project }
  let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: A, turn: 39, signal: f.controller.signal }
  const older = f.lifecycle.assess(request)
  await paused; f.state.head = B
  const newer = f.lifecycle.assess({ ...request, commit: B, turn: 40 }); await flush()
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].commit, B)
  releaseSelection(); assert.equal((await older).status, 'stale')
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].signal.aborted, false)
  release(); await newer; f.lifecycle.dispose()
})

test('a live request never joins the cancelled owner signal; joining cancellation does not cancel a valid owner', async () => {
  const f = fixture(); let release; f.state.wait = new Promise(resolve => { release = resolve })
  const request = { design: f.design, agent: f.agent, project: f.project, kit: f.kit, commit: A, turn: 39, signal: f.controller.signal }
  const owner = f.lifecycle.assess(request); await flush(); f.controller.abort()
  const freshSignal = new AbortController(), subscriber = new AbortController()
  const fresh = f.lifecycle.assess({ ...request, turn: 40, signal: freshSignal.signal }); await flush()
  assert.equal(f.state.calls.length, 2); assert.equal(f.state.calls[1].signal.aborted, false)
  const joined = f.lifecycle.assess({ ...request, turn: 41, signal: subscriber.signal }, true); await flush()
  subscriber.abort(); assert.equal((await joined).status, 'stale')
  assert.equal(f.state.calls.length, 2); assert.equal(f.state.calls[1].signal.aborted, false)
  release(); assert.equal((await owner).status, 'stale'); assert.equal((await fresh).status, 'updated')
  assert.equal(f.state.injections.length, 0, 'an aborted subscriber alone cannot authorize a notice')
  f.lifecycle.dispose()
})

test('bounded receipt and request correlations evict old facts without creating model work', async () => {
  const f = fixture()
  for (let i = 0; i < 65; i++) f.record('save-'+i)
  assert.throws(() => f.admit('old', [{ eventId: 'save-0', commit: A }]), /matching settled receipt/)
  for (let i = 0; i < 65; i++) assert.equal(f.admit('rpc-'+i, [{ eventId: 'save-64', commit: A }]).status, 'unchanged')
  f.record('new-save', B)
  assert.equal(f.admit('rpc-0', [{ eventId: 'new-save', commit: B }]).status, 'unchanged', 'the oldest request id was evicted')
  assert.throws(() => f.admit('rpc-64', [{ eventId: 'new-save', commit: B }]), /identity reused/)
  await flush(); assert.equal(f.state.calls.length, 0); assert.equal(f.activity(), undefined)
  f.lifecycle.reset(f.agent)
  assert.throws(() => f.admit('rpc-64', [{ eventId: 'save-64', commit: A }]), /matching settled receipt/)
  f.lifecycle.dispose()
})

test('shared strict Remote codecs retain activity without granting scores or arbitrary receipt fields', () => {
  const descriptor = TYPERT_REMOTE.descriptors.find(d => d.method === 'admitSavedAssessment')
  const schema = descriptor.parameters.find(p => p.name === 'request').codec.create()
  assert.equal(schema.safeParse({ requestId: 'rpc', saves: [{ eventId: 'save', commit: A }] }).success, true)
  assert.equal(schema.safeParse({ requestId: 'rpc', saves: [{ eventId: 'save', commit: A, authorized: true }] }).success, false)
  assert.equal(schema.safeParse({ requestId: 'rpc', saves: [] }).success, false)
  const workspace = TYPERT_REMOTE.descriptors.find(d => d.method === 'readWorkspace').result.create()
  const snapshot = { projectId: 'project', projectName: 'Demo', projectPath: '/isolated/project', checkpoint: A,
    worktreeRevision: 'tree', executionRevision: 0, executionAttempts: [], access: { mode: 'unconfigured', writable: false },
    journalRevision: 1, design: {}, continuations: [], mustEditHandoffs: [],
    clarity: { assessment: null, needsReassessment: false, activity: { phase: 'running', checkpoint: A } } }
  assert.deepEqual(workspace.parse(snapshot).clarity.activity, snapshot.clarity.activity)
  for (const invalid of [{ phase: 'done', checkpoint: A }, { phase: 'running', checkpoint: A, u: 80 },
    { phase: 'running', checkpoint: A, summary: 'x'.repeat(1001) }]) {
    assert.equal(workspace.safeParse({ ...snapshot, clarity: { ...snapshot.clarity, activity: invalid } }).success, false)
  }
})
