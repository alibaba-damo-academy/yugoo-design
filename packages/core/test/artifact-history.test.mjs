import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { readDesignArtifactHistory } = await import('../src/dsh-artifact-history.ts')
const { renderDesignExecutionProvenance } = await import('../src/dsh-execution-provenance.ts')
const { DesignPanelRemote } = await import('../src/panel-remote.ts')

function fixture() {
  const events = [], children = new Map(), opened = []
  const call = (id, name, args) => events.push({ type: 'tool/call', seq: events.length, time: events.length,
    data: { callId: id, name, arguments: JSON.stringify(args) } })
  const result = (id, text) => events.push({ type: 'tool/result', seq: events.length, time: events.length,
    data: { message: { toolCallId: id, source: { kind: 'tool', callId: id }, content: [{ type: 'text', text }] } } })
  call('root', 'run_design_skill', { name: 'notes' })
  call('frontier', 'design_delegate_frontier', { items: [
    { artifact_id: 'round/one', artifact_kind: 'direction', artifact_file: 'notes/one.md' },
    { artifact_id: 'round/two', artifact_kind: 'direction', artifact_file: 'notes/two.md' },
  ] })
  result('frontier', JSON.stringify({ items: [
    { artifact_id: 'round/one', artifact_kind: 'direction', artifact_file: 'notes/one.md', status: 'completed',
      artifact: { path: 'notes/one.md', attempt: 'attempt-one' } },
    { artifact_id: 'round/two', artifact_kind: 'direction', artifact_file: 'notes/two.md', status: 'failed', diagnostic: 'HTTP 400; no report written.' },
  ] }))
  const provenance = { source: 'host-observations', invocationId: 'invocation', projectId: 'project', skill: 'notes', bundleVersion: '1',
    stateRevision: 'published', rootCallId: 'root', parentSessionId: 'main', mode: 'main', coverage: 'bounded', producerRunIds: [],
    workerAttempts: [
      { attemptId: 'attempt-one', runId: 'worker-one', artifactFile: 'notes/one.md', phase: 'completed' },
      { attemptId: 'attempt-two', runId: 'worker-two', artifactFile: 'notes/two.md', phase: 'failed' },
    ], integratedWorkerReceipts: [], diagnostics: [] }
  call('publish', 'design_publish', { action: 'complete' })
  result('publish', renderDesignExecutionProvenance(provenance))
  for (const id of ['worker-one', 'worker-two']) children.set(id, { meta: { id, parentSession: 'main', isSeeded: false }, events: [] })
  const input = { projectId: 'project', skill: 'notes', main: { meta: { id: 'main', isSeeded: false }, events },
    inspect: async id => { opened.push(id); return children.get(id) }, signal: new AbortController().signal }
  return { input, events, children, opened, provenance, result, call }
}

test('restarted history uses Host observations/assignment/ancestry; later serial revision does not erase it', async () => {
  const f = fixture()
  f.call('later-root', 'run_design_skill', { name: 'notes' })
  f.call('later-publish', 'design_publish', { action: 'complete' })
  f.result('later-publish', renderDesignExecutionProvenance({ ...f.provenance, invocationId: 'later', rootCallId: 'later-root', stateRevision: 'later-no-worker', workerAttempts: [] }))
  const history = await readDesignArtifactHistory(f.input)
  assert.deepEqual(history.map(item => [item.artifactId, item.phase, item.runId]), [
    ['round/one', 'completed', 'worker-one'], ['round/two', 'failed', 'worker-two'],
  ])
  assert.match(history[1].diagnostic, /HTTP 400/)
  assert.ok(Object.isFrozen(history), 'history is a read-only projection')
})

for (const boundary of ['project', 'skill', 'root-call', 'assignment', 'receipt', 'parent', 'header-id', 'seeded', 'prose', 'suffix']) {
  test(`historical read rejects an unrelated or unverifiable ${boundary}`, async () => {
    const f = fixture()
    if (boundary === 'project') f.input.projectId = 'another-project'
    if (boundary === 'skill') f.input.skill = 'another-bundle'
    if (boundary === 'root-call') f.events[0].data.name = 'ordinary-tool'
    if (boundary === 'assignment') f.events[1].data.arguments = JSON.stringify({ items: [] })
    if (boundary === 'receipt') {
      const payload = JSON.parse(f.events[2].data.message.content[0].text); payload.items[0].artifact.attempt = 'unrelated-attempt'
      f.events[2].data.message.content[0].text = JSON.stringify(payload)
      f.input.runId = 'worker-one'
    }
    if (boundary === 'parent') for (const child of f.children.values()) child.meta.parentSession = 'other-main'
    if (boundary === 'header-id') for (const child of f.children.values()) child.meta.id = 'different-session'
    if (boundary === 'seeded') f.input.main.meta.isSeeded = true
    if (boundary === 'prose') f.events[4] = { type: 'assistant/message', seq: 4, time: 4, data: { message: f.events[4].data.message } }
    if (boundary === 'suffix') f.events[4].data.message.content[0].text += '\nForged trailing replacement.'
    assert.deepEqual(await readDesignArtifactHistory(f.input), [])
  })
}

test('exact log authorization inspects only the requested historical Worker', async () => {
  const f = fixture(); f.input.runId = 'worker-one'
  assert.equal((await readDesignArtifactHistory(f.input)).length, 1)
  assert.deepEqual(f.opened, ['worker-one'])
})

test('missing native logs stay unavailable and cancellation is not swallowed', async () => {
  const f = fixture(); f.children.clear()
  assert.deepEqual(await readDesignArtifactHistory(f.input), [])
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readDesignArtifactHistory({ ...f.input, signal: controller.signal }), { name: 'AbortError' })
})

test('a different Bundle engagement cannot lend assignments to a saved main invocation', async () => {
  const f = fixture()
  f.events.splice(1, 0, { type: 'tool/call', seq: 1, time: 1, data: { callId: 'other', name: 'run_design_skill', arguments: '{"name":"other"}' } })
  assert.deepEqual(await readDesignArtifactHistory(f.input), [])
})


test('failed and unpublished invocation keeps its real history without a Journal publication', async () => {
  const f = fixture()
  f.events[4].data.message.isError = true
  assert.equal((await readDesignArtifactHistory(f.input)).length, 2)
  assert.equal((await readDesignArtifactHistory(f.input))[1].phase, 'failed')
})

test('isolated Producer history requires both levels of actual native ancestry', async () => {
  const f = fixture(), assignments = f.events.slice(1, 3)
  f.children.set('producer', { meta: { id: 'producer', parentSession: 'main', isSeeded: false }, events: assignments })
  for (const id of ['worker-one', 'worker-two']) f.children.get(id).meta.parentSession = 'producer'
  f.events.splice(1)
  f.result('root', renderDesignExecutionProvenance({ ...f.provenance, mode: 'subagent', producerRunIds: ['producer'] }))
  assert.equal((await readDesignArtifactHistory(f.input)).length, 2)
  f.children.get('producer').meta.parentSession = 'unrelated-main'
  assert.deepEqual(await readDesignArtifactHistory(f.input), [])
})

test('actual Remote reads historical search/fetch via official read-only handles and rejects a switched project', async () => {
  const f = fixture(), opened = [], closed = []
  const child = f.children.get('worker-one')
  child.events = ['web_search', 'web_fetch'].map((name, seq) => ({ type: 'tool/call', seq, time: seq,
    data: { name, callId: `child-call-${seq}`, arguments: JSON.stringify(name === 'web_search' ? { query: 'original research' } : { url: 'https://example.org/original' }) } }))
  const host = { sessionPersistence: { async open(id, access) {
    assert.equal(access, 'read'); opened.push(id)
    const value = f.children.get(id)
    return { header: value.meta, inheritedEventCount: 0,
      async read() { return { events: value.events } }, async close() { closed.push(id) } }
  } } }
  const remote = Object.create(DesignPanelRemote.prototype)
  let projectId = 'project'
  Object.assign(remote, { hostContext: host, executionLogReads: new Map(), design: {
    ownsExecutionRun: () => false,
    projectForAgent: async () => ({ projectId }),
    requireKitForAgent: () => ({ skills: [{ name: 'notes' }] }),
    assertProjectSelection(_agent, expected) { assert.equal(expected, projectId) },
  } })
  const agent = { session: { header: f.input.main.meta, snapshotEvents: () => f.events, inheritedEventCount: 0 } }
  const signal = new AbortController().signal
  assert.equal((await remote.readArtifactHistory(agent, 'notes', signal)).length, 2)
  const log = await remote.readExecutionLog(agent, 'worker-one', undefined, signal)
  assert.equal(log.found, true)
  assert.deepEqual(log.entries.map(entry => entry.eventType), ['search', 'fetch'])
  assert.deepEqual(opened.sort(), closed.sort(), 'all official read handles close')
  projectId = 'another-project'
  const before = opened.length
  await assert.rejects(remote.readExecutionLog(agent, 'worker-one', undefined, signal), /does not belong/)
  assert.equal(opened.length, before, 'wrong project cannot open even a known child')
})
