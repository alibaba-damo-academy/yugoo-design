import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { workspacePollResult } = await import('../src/workspace-poll.ts')
const { createWorkspacePollReader } = await import('../../panel/src/client/workspace-poll-reader.ts')
const { default: descriptor } = await import('../src/typert.remote-client.ts')

test('conditional transport includes every visible field, is stateless and saves bytes', () => {
  const snapshot = { projectId: 'one', checkpoint: 'same', design: { text: 'a'.repeat(229000) }, access: { writable: true } }
  const first = workspacePollResult(snapshot, null)
  const same = workspacePollResult(structuredClone(snapshot), first.revision)
  assert.equal(same.unchanged, true)
  assert.ok(JSON.stringify(same).length < 120)
  for (const delta of [{ projectId: 'two' }, { access: { writable: false } }, { publicationError: 'broken' },
    { executionRevision: 2 }, { clarity: { score: 80 } }, { reviews: ['new'] }, { conversation: ['new'] },
    { design: { text: 'changed' } }, { continuations: ['new'] }, { mustEditHandoffs: ['new'] }, { reviewPolicy: { mode: 'off' } }]) {
    assert.equal(workspacePollResult({ ...snapshot, ...delta }, first.revision).unchanged, false)
  }
  assert.equal(workspacePollResult(snapshot, 'invalid').unchanged, false)
})

test('browser caches are session-local, preserve failures, and compare the captured response', async () => {
  let current = { projectId: 'one', text: 'first' }, fail = false
  const requests = []
  const read = createWorkspacePollReader(async (session, revision) => {
    requests.push({ session, revision })
    if (fail) throw Error('read failed')
    return workspacePollResult(current, revision)
  })
  const first = await read('a')
  assert.equal(await read('a'), first)
  await read('b'); assert.equal(requests.at(-1).revision, null)
  fail = true; await assert.rejects(read('a'), /read failed/)
  fail = false; assert.equal(await read('a'), first)
  current = { projectId: 'two', text: 'different project' }
  assert.equal((await read('a')).projectId, 'two')
  for (let i = 0; i < 9; i++) await read(`other-${i}`)
  await read('a'); assert.equal(requests.at(-1).revision, null, 'bounded cache evicts old sessions')
  const invalid = createWorkspacePollReader(async () => ({ revision: 'fake', unchanged: true }))
  await assert.rejects(invalid('x'), /no matching snapshot/)
})

test('concurrent old completion cannot replace a newer browser cache', async () => {
  const pending = []
  const read = createWorkspacePollReader((session, revision) => new Promise(resolve => pending.push({ revision, resolve })))
  const older = read('a'), newer = read('a')
  const next = workspacePollResult({ version: 2 }, null)
  pending[1].resolve(next); await newer
  pending[0].resolve(workspacePollResult({ version: 1 }, null)); await older
  const third = read('a'); assert.equal(pending[2].revision, next.revision)
  pending[2].resolve({ unchanged: true, revision: next.revision })
  assert.deepEqual(await third, { version: 2 })
})

test('DSH conditional route has explicit typed input and both result variants', () => {
  const d = descriptor.descriptors.find(x => x.method === 'pollWorkspace')
  assert.equal(d.scope.context, 'agent')
  assert.equal(d.parameters[1].codec.create().safeParse(null).success, true)
  assert.equal(d.parameters[1].codec.create().safeParse('x'.repeat(65)).success, false)
  assert.equal(d.result.create().safeParse({ revision: 'a', unchanged: true }).success, true)
  assert.equal(d.result.create().safeParse({ revision: 'a', unchanged: false }).success, false)
})

test('DSH workspace codecs retain exact handoff projections and running-main visibility', () => {
  const workspace = { projectId: 'project', projectName: 'Example', projectPath: '/isolated/example', checkpoint: 'head',
    worktreeRevision: 'worktree', executionRevision: 0, executionAttempts: [],
    activeMainBundles: [{ skill: 'review', invocationId: 'main-run' }],
    access: { mode: 'writable', writable: true, kit: { name: 'fixture', version: '1.0' } }, journalRevision: 1, design: {},
    continuations: [{ skill: 'continue', invocationId: 'continue-run', routeId: 'continue_review', title: { zh: '示例', en: 'Example' },
      label: { zh: '继续', en: 'Continue' }, aliases: { zh: ['接着'], en: ['Go on'] }, journalRevision: 1, summary: 'Ready' }],
    mustEditHandoffs: [{ skill: 'review', pin: { projectId: 'project', kitName: 'fixture', kitVersion: '1.0',
      skillName: 'review', bundleVersion: '1.0', invocationId: 'review-run', stateRevision: 'head' } }],
    clarity: { assessment: null, needsReassessment: false } }
  const direct = descriptor.descriptors.find(x => x.method === 'readWorkspace').result.create()
  const conditional = descriptor.descriptors.find(x => x.method === 'pollWorkspace').result.create()
  assert.deepEqual(direct.parse(workspace), workspace, 'direct wire must not strip gate or busy fields')
  assert.deepEqual(conditional.parse({ unchanged: false, revision: 'r1', workspace }).workspace, workspace)
  for (const key of Object.keys(workspace.mustEditHandoffs[0].pin)) {
    const malformed = structuredClone(workspace); delete malformed.mustEditHandoffs[0].pin[key]
    assert.equal(direct.safeParse(malformed).success, false, `incomplete ${key} cannot masquerade as the exact gate pin`)
  }
  const malformed = structuredClone(workspace); delete malformed.continuations[0].routeId
  assert.equal(direct.safeParse(malformed).success, false, 'user-continue still requires the owning route')
})

test('a newer concurrent completion replaces the earlier one in request order', async () => {
  const pending = []
  const read = createWorkspacePollReader((session, revision) => new Promise(resolve => pending.push({ revision, resolve })))
  const older = read('a'), newer = read('a')
  pending[0].resolve(workspacePollResult({ version: 1 }, null)); await older
  const next = workspacePollResult({ version: 2 }, null)
  pending[1].resolve(next); await newer
  const third = read('a'); assert.equal(pending[2].revision, next.revision)
  pending[2].resolve({ unchanged: true, revision: next.revision })
  assert.deepEqual(await third, { version: 2 })
})
