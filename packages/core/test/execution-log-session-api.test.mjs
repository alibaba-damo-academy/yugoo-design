import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { DesignPanelRemote } = await import('../src/panel-remote.ts')
const events = ['parent private context', 'child progress'].map((text, seq) => ({
  type: 'assistant/message', seq, time: seq,
  data: { turn: 1, step: seq, message: { content: [{ type: 'text', text }] } },
}))
const header = { id: 'child', isSeeded: true }
function remote(host, ownsExecutionRun = () => true) {
  const instance = Object.create(DesignPanelRemote.prototype)
  Object.defineProperties(instance, {
    hostContext: { value: host },
    design: { value: { ownsExecutionRun } },
    executionLogReads: { value: new Map() },
  })
  return instance
}
function persisted(meta, storedEvents, inheritedEventCount) {
  let opened = 0, read = 0, closed = 0
  return {
    get counts() { return { opened, read, closed } },
    async open(id, access, options) {
      opened++
      assert.equal(id, 'child')
      assert.equal(access, 'read', 'observing a released Worker must not claim write ownership')
      assert.ok(options.signal instanceof AbortSignal)
      return {
        header: meta, inheritedEventCount,
        async read(offset, length, readOptions) {
          read++
          assert.equal(offset, undefined)
          assert.equal(length, undefined)
          assert.equal(readOptions.signal, options.signal)
          return { events: storedEvents, eventState: 'shared-frozen' }
        },
        async close() { closed++ },
      }
    },
  }
}
for (const live of [true, false]) test(`official ${live ? 'live' : 'persisted'} transcript excludes inherited parent history`, async () => {
  const persistence = persisted(header, events, 1)
  const instance = remote(live ? { sessions: { get: () => ({ header, inheritedEventCount: 1, snapshotEvents() { return events } }) } }
    : { sessionPersistence: persistence })
  const result = await instance.readExecutionLog({}, 'child', undefined, new AbortController().signal)
  assert.equal(result.found, true)
  assert.equal(result.entries.length, 1)
  assert.match(JSON.stringify(result.entries), /child progress/)
  assert.doesNotMatch(JSON.stringify(result.entries), /parent private context/)
  assert.deepEqual(persistence.counts, live ? { opened: 0, read: 0, closed: 0 } : { opened: 1, read: 1, closed: 1 })
})
test('seeded transcript without a boundary is refused, not shown as child work', async () => {
  const instance = remote({ sessions: { get: () => ({ header, snapshotEvents() { return events } }) } })
  await assert.rejects(instance.readExecutionLog({}, 'child', undefined, new AbortController().signal), /no inherited-history boundary/)
})
for (const live of [true, false]) test(`legacy header cannot authorize ${live ? 'live' : 'persisted'} inherited history`, async () => {
  const legacyHeader = { ...header, seedLength: 0 }
  const instance = remote(live
    ? { sessions: { get: () => ({ header: legacyHeader, snapshotEvents() { return events } }) } }
    : { sessionPersistence: persisted(legacyHeader, events, undefined) })
  await assert.rejects(instance.readExecutionLog({}, 'child', undefined, new AbortController().signal), /no inherited-history boundary/)
})

test('released Worker keeps its native log and cursor through the public read handle', async () => {
  let live = true
  const ownHeader = { id: 'child', isSeeded: false }
  const childEvents = events.slice(1)
  const persistence = persisted(ownHeader, childEvents, 0)
  const instance = remote({ sessionPersistence: persistence, sessions: { get: () => live
    ? { header: ownHeader, inheritedEventCount: 0, snapshotEvents: () => childEvents }
    : undefined } })
  const first = await instance.readExecutionLog({}, 'child', undefined, new AbortController().signal)
  assert.equal(first.found, true)
  assert.equal(first.entries.length, 1)
  assert.deepEqual(persistence.counts, { opened: 0, read: 0, closed: 0 })
  live = false
  childEvents.push({ ...events[1], seq: 2, data: { ...events[1].data,
    message: { content: [{ type: 'text', text: 'Worker completed' }] } } })
  const next = await instance.readExecutionLog({}, 'child', first.entries.at(-1).seq, new AbortController().signal)
  assert.equal(next.found, true)
  assert.deepEqual(next.entries.map(entry => entry.message), ['Worker completed'])
  assert.deepEqual(persistence.counts, { opened: 1, read: 1, closed: 1 })
})

test('missing persisted session stays unavailable', async () => {
  let opened = 0
  const instance = remote({ sessionPersistence: { async open() { opened++; throw Error('not found') } } })
  assert.deepEqual(await instance.readExecutionLog({}, 'child', undefined, new AbortController().signal),
    { found: false, revision: null, reset: false, entries: [] })
  assert.equal(opened, 1)
})

test('persisted read failure closes its handle and stays unavailable', async () => {
  let closed = 0, read = 0
  const instance = remote({ sessionPersistence: { async open() { return {
    header: { id: 'child', isSeeded: false }, inheritedEventCount: 0,
    async read() { read++; throw Error('corrupt session') },
    async close() { closed++ },
  } } } })
  assert.equal((await instance.readExecutionLog({}, 'child', undefined, new AbortController().signal)).found, false)
  assert.equal(read, 1)
  assert.equal(closed, 1)
})

test('cancellation during a persisted read closes the handle and propagates', async () => {
  const controller = new AbortController()
  let closed = 0
  const instance = remote({ sessionPersistence: { async open() { return {
    header: { id: 'child', isSeeded: false }, inheritedEventCount: 0,
    async read() { controller.abort(); controller.signal.throwIfAborted() },
    async close() { closed++ },
  } } } })
  await assert.rejects(instance.readExecutionLog({}, 'child', undefined, controller.signal), { name: 'AbortError' })
  assert.equal(closed, 1)
})

test('an unrelated execution cannot open a persisted transcript', async () => {
  let opened = 0
  const instance = remote({ sessionPersistence: { async open() { opened++; throw Error('must not open') } } }, () => false)
  await assert.rejects(instance.readExecutionLog({}, 'child', undefined, new AbortController().signal), /does not belong/)
  assert.equal(opened, 0)
})

for (const isError of [false, true]) test(`current tool-role failure flag is projected as error=${isError}`, async () => {
  const session = { header: { id: 'child', isSeeded: false }, snapshotEvents: () => [
    { type: 'tool/call', seq: 0, time: 0, data: { callId: 'call-1', name: 'read', arguments: {} } },
    { type: 'tool/result', seq: 1, time: 1, data: { message: {
      role: 'tool', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1', isError,
      content: [{ type: 'text', text: isError ? 'failed' : 'read complete' }],
    } } },
  ] }
  const result = await remote({ sessions: { get: () => session } }).readExecutionLog({}, 'child', undefined, new AbortController().signal)
  assert.equal(result.entries.filter(entry => entry.eventType === 'error').length, Number(isError))
  if (isError) assert.match(result.entries.at(-1).message, /read · failed/)
})


test('persisted native tool history carries locale-neutral labels through the strict Remote codec without rewriting prose', async () => {
  const { TYPERT_REMOTE } = await import('../src/typert.remote-client.ts')
  const codec = TYPERT_REMOTE.descriptors.find(item => item.method === 'readExecutionLog').result.create()
  const prose = '搜索：这是 Worker 的实际正文；keep this unchanged {detail}'
  const tools = [
    ['search_web', { query: '用户反馈 Jira {detail}' }, { kind: 'search', detail: '用户反馈 Jira {detail}' }],
    ['fetch', { url: 'https://example.com/证据?q=one' }, { kind: 'fetch', detail: 'https://example.com/证据?q=one' }],
    ['read_file', { file_path: 'reference/artifact-contract.md', content: 'PRIVATE INPUT' }, { kind: 'read-file', detail: 'reference/artifact-contract.md' }],
    ['write_file', { path: 'design_files/用户反馈.json', content: 'PRIVATE INPUT' }, { kind: 'write-file', detail: 'design_files/用户反馈.json' }],
    ['run_skill_script', { path: 'scripts/check.mjs' }, { kind: 'run-script', detail: 'scripts/check.mjs' }],
    ['structured_output', {}, { kind: 'structured-output', detail: '' }],
    ['design_worker_read_artifact', {}, { kind: 'run-tool', detail: 'design_worker_read_artifact' }],
    ['fetch', { url: 'javascript:private()' }, { kind: 'fetch', detail: 'fetch' }],
  ]
  const history = [events[0], { ...events[1], data: { ...events[1].data, message: { content: [{ type: 'text', text: prose }] } } },
    ...tools.map(([name, args], index) => ({ type: 'tool/call', seq: index + 2, time: index + 2,
      data: { name, arguments: JSON.stringify(args), callId: `tool-${index}` } })),
    { type: 'tool/result', seq: 10, time: 10, data: { error: { code: 'E_READ' }, message: {
      source: { callId: 'tool-2' }, isError: true, content: [{ type: 'text', text: 'PRIVATE RESULT' }],
    } } }]
  const original = JSON.stringify(history)
  for (let reopen = 0; reopen < 2; reopen++) {
    const persistence = persisted(header, history, 1)
    const projected = await remote({ sessionPersistence: persistence }).readExecutionLog({}, 'child', undefined, new AbortController().signal)
    const decoded = codec.parse(projected)
    assert.deepEqual(decoded, projected, 'strict transport must not strip the activity metadata')
    assert.equal(decoded.entries[0].message, prose)
    assert.equal(decoded.entries[0].activity, undefined, 'native prose has no system label metadata')
    assert.deepEqual(decoded.entries.slice(1, -1).map(entry => entry.activity), tools.map(tool => tool[2]))
    assert.equal(decoded.entries[2].url, tools[1][1].url, 'the complete HTTP href survives unchanged')
    assert.equal(decoded.entries[8].url, undefined, 'unsafe URLs never become links')
    assert.deepEqual(decoded.entries.at(-1).activity, { kind: 'tool-failed', detail: 'read_file (E_READ)' })
    assert.doesNotMatch(JSON.stringify(decoded), /PRIVATE INPUT|PRIVATE RESULT|parent private context/)
    assert.deepEqual(persistence.counts, { opened: 1, read: 1, closed: 1 })
    const legacy = { ...decoded, entries: decoded.entries.map(({ activity, ...entry }) => entry) }
    assert.deepEqual(codec.parse(legacy), legacy, 'older projections remain valid without metadata')
  }
  assert.equal(JSON.stringify(history), original, 'reading never rewrites the persisted native history')
})
