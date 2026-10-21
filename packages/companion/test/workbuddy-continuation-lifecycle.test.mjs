import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRelayQueue } from '../src/workbuddy-mcp-relay.mjs'
import { relayWidget } from '../src/workbuddy-relay-probe.mjs'
import { runInNewContext } from 'node:vm'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSavedContinuation } from '../src/saved-continuation.mjs'
import { createWorkBuddyPanelMcp } from '../src/workbuddy-panel-mcp.mjs'

test('normal bridge/RPC latency does not exhaust the production renewal lease', () => {
  let now = 0
  const queue = createRelayQueue({ now: () => now }), client = randomUUID()
  const lease = queue.pulse(client, true)
  now = 5001
  assert.equal(queue.status().online, true)
  const id = randomUUID(); queue.submit(id, 'saved changes'); queue.take(client, lease.generation)
  now = 10000; queue.pulse(client, true, lease.generation)
  now = 20000; assert.equal(queue.status(id).message.status, 'claimed')
  queue.settle(client, id, 'submitted_unverified', lease.generation)
})

test('authenticated stale-lease remount fences old generation and never replays its claimed message', () => {
  let now = 0
  const queue = createRelayQueue({ now: () => now }), old = randomUUID(), next = randomUUID(), id = randomUUID()
  const first = queue.pulse(old, true)
  queue.submit(id, 'claimed once'); queue.take(old, first.generation)
  assert.throws(() => queue.pulse(next, true), /Another widget/)
  now = 16000
  const second = queue.pulse(next, true)
  assert.ok(second.generation > first.generation)
  assert.equal(queue.status(id).message.status, 'delivery_unknown')
  assert.throws(() => queue.pulse(old, true, first.generation), /Stale/)
  assert.throws(() => queue.take(old, first.generation), /not ready/)
  assert.throws(() => queue.settle(next, id, 'submitted_unverified', second.generation), /Stale/)
  assert.throws(() => queue.settle(old, id, 'submitted_unverified', first.generation), /Stale/)
  assert.equal(queue.take(next, second.generation).message, null)
  assert.throws(() => queue.submit(randomUUID(), 'must not replay'), /不会自动重发/)
})

test('explicit disposal releases only its exact lease; queued but unclaimed delivery can move once', () => {
  const queue = createRelayQueue(), old = randomUUID(), next = randomUUID(), id = randomUUID()
  const lease = queue.pulse(old, true)
  queue.submit(id, 'not claimed')
  queue.release(old, lease.generation)
  const current = queue.pulse(next, true)
  assert.throws(() => queue.release(old, lease.generation), /Stale/)
  assert.equal(queue.take(next, current.generation).message.id, id)
  assert.equal(queue.take(next, current.generation).message, null)
})

test('33rd and later messages work with bounded full receipts and no evicted-ID replay', () => {
  const queue = createRelayQueue(), client = randomUUID(), first = randomUUID()
  const lease = queue.pulse(client, true)
  for (let n = 0; n < 100; n++) {
    const id = n === 0 ? first : randomUUID()
    queue.submit(id, `message-${n}`); queue.take(client, lease.generation); queue.settle(client, id, 'submitted_unverified', lease.generation)
  }
  assert.ok(queue.status().retainedReceipts <= 33)
  assert.throws(() => queue.submit(first, 'message-0'), /不会再次投递/)
})

test('widget renews independently while original ui/message remains pending, and disposal fences late replies', async () => {
  const listeners = {}, timers = new Map(), calls = [], requests = []
  let timerId = 0, sent = false
  const element = () => ({ hidden: true, disabled: false, appendChild(child) { child.parentNode = this } })
  const elements = Object.fromEntries(['primary-actions','secondary-actions','open-options','connect','status','description','copy-design-url','design-browser-guide','manual-copy','design-url'].map(id => [id, element()]))
  elements['primary-actions'].appendChild(elements.connect)
  const parent = { postMessage(request) {
    requests.push(request)
    if (request.id && request.method !== 'ui/message') queueMicrotask(() => listeners.message({ source: parent, origin: 'https://native.example', data: { jsonrpc: '2.0', id: request.id, result: request.method === 'ui/initialize' ? { hostCapabilities: { message: {}, openLinks: {} } } : {} } }))
  } }
  runInNewContext(relayWidget({ dynamic: true, autoConnect: true, origin: '', widgetToken: '', url: '' }).match(/<script>([\s\S]*)<\/script>/)[1], {
    document: { getElementById: id => elements[id] }, window: { addEventListener: (type, listener) => { listeners[type] = listener } }, parent,
    URL, crypto: { randomUUID }, AbortSignal, navigator: {},
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId }, clearTimeout: id => timers.delete(id),
    fetch: async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body)
      const value = body.action === 'pulse' ? { generation: 1 } : body.action === 'take' && !sent ? (sent = true, { message: { id: randomUUID(), text: 'saved change' } }) : {}
      return { ok: true, json: async () => value }
    },
  })
  const drain = async () => { for (let n = 0; n < 8; n++) await new Promise(resolve => setImmediate(resolve)) }
  await drain()
  listeners.message({ source: parent, origin: 'https://native.example', data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { workbuddyPanel: {
    origin: 'http://127.0.0.1:31001', widgetToken: 'a'.repeat(64), url: 'http://127.0.0.1:31002/#' + 'b'.repeat(64),
    projectId: 'exact-project', threadId: randomUUID(), connectionPath: '/exact/connection.json', view: 'panel-only',
  } } } } })
  await drain()
  assert.equal(requests.filter(request => request.method === 'ui/message').length, 1)
  const before = calls.filter(call => call.action === 'pulse').length
  for (const [id, timer] of [...timers]) if (timer.ms === 1000) { timers.delete(id); timer.fn() }
  await drain()
  assert.ok(calls.filter(call => call.action === 'pulse').length > before)
  listeners.pagehide({ persisted: true })
  assert.equal(calls.at(-1).action, 'release')
  const count = calls.length, request = requests.find(request => request.method === 'ui/message')
  listeners.message({ source: parent, origin: 'https://native.example', data: { jsonrpc: '2.0', id: request.id, result: {} } })
  for (const timer of [...timers.values()]) if (timer.ms === 1000) timer.fn()
  await drain()
  assert.equal(calls.length, count, 'late receipt/heartbeat cannot reclaim or settle after disposal')
})

test('unknown delivery exposes explicit same-session fresh-service recovery for new events only', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'wb-explicit-recovery-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const args = { projectRoot: '/exact/project', sessionId: randomUUID(), nativeCwd: '/exact/native', transcriptPath: '/exact/transcript.jsonl', view: 'panel-only' }
  const binding = { stateRoot, projectId: 'exact-project', projectRoot: args.projectRoot, host: 'workbuddy', threadId: args.sessionId, nativeCwd: args.nativeCwd, transcriptPath: args.transcriptPath }
  const outbox = () => createSavedContinuation(binding), services = [], startArgs = []
  let now = 0
  const mcp = createWorkBuddyPanelMcp({ runtimeRoot: '/runtime', stateRoot, start: async input => {
    startArgs.push(input); services.push(createRelayQueue({ now: () => now }))
    return { origin: `http://127.0.0.1:${31000 + services.length}`, widgetToken: 'a'.repeat(64), url: `http://127.0.0.1:${32000 + services.length}/#${'b'.repeat(64)}`, projectId: binding.projectId, threadId: args.sessionId, connectionPath: `/state/service-${services.length}.json` }
  } })
  const open = async () => (await mcp.handle({ id: 1, method: 'tools/call', params: { name: 'yugoo_workbuddy_open_panel', arguments: args } })).result._meta.workbuddyPanel
  const initial = await open(), old = services[0], oldClient = randomUUID(), oldLease = old.pulse(oldClient, true), oldId = randomUUID()
  await outbox().prepare({ eventId: 'old-save', skill: 'test_bundle', payloadHash: 'old' }); await outbox().saved('old-save', 'a'.repeat(40))
  await outbox().begin({ saved: [{ eventId: 'old-save', commit: 'a'.repeat(40) }], requestId: oldId, text: 'old notification' })
  old.submit(oldId, 'old notification'); old.take(oldClient, oldLease.generation); now = 16000
  const listeners = {}, requests = [], elements = {}, clientId = randomUUID()
  for (const name of ['primary-actions','secondary-actions','open-options','connect','status','description','copy-design-url','design-browser-guide','manual-copy','design-url']) elements[name] = { appendChild(child) { child.parentNode = this } }
  elements['primary-actions'].appendChild(elements.connect)
  const parent = { postMessage(request) {
    requests.push(request)
    if (request.id) queueMicrotask(() => listeners.message({ source: parent, origin: 'https://native.example', data: { jsonrpc: '2.0', id: request.id, result: request.method === 'ui/initialize' ? { hostCapabilities: { message: {}, openLinks: {} } } : {} } }))
  } }
  runInNewContext(relayWidget({ dynamic: true, autoConnect: true, origin: '', widgetToken: '', url: '' }).match(/<script>([\s\S]*)<\/script>/)[1], {
    document: { getElementById: id => elements[id] }, window: { addEventListener: (type, listener) => { listeners[type] = listener } }, parent,
    URL, crypto: { randomUUID: () => clientId }, AbortSignal, navigator: {}, setTimeout: () => 1, clearTimeout: () => {},
    fetch: async (_url, options) => { const body = JSON.parse(options.body); return { ok: true, json: async () => body.action === 'pulse' ? old.pulse(clientId, true, body.generation) : old.take(clientId, body.generation) } },
  })
  const drain = async () => { for (let n = 0; n < 8; n++) await new Promise(resolve => setImmediate(resolve)) }
  await drain()
  listeners.message({ source: parent, origin: 'https://native.example', data: { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { _meta: { workbuddyPanel: initial } } } })
  await drain()
  assert.equal(elements.connect.textContent, '恢复设计面板')
  assert.equal(requests.filter(request => request.method === 'ui/message').length, 0, 'unknown message is never replayed on remount')
  await elements.connect.onclick(); await elements.connect.onclick(); await drain()
  const recovery = requests.filter(request => request.method === 'ui/message')
  assert.equal(recovery.length, 1, 'only the explicit recovery click sends a single reopen request')
  const instruction = recovery[0].params.content[0].text
  assert.ok(instruction.includes(JSON.stringify(args))); assert.ok(!instruction.includes('old notification'))
  assert.match(instruction, /不要新建项目、运行 Bundle、启动子代理、修改设计文件或重发之前的消息/)
  const replacement = await open(), fresh = services[1]
  assert.notEqual(replacement.connectionPath, initial.connectionPath)
  assert.deepEqual(startArgs[1], startArgs[0], 'open_panel starts a fresh owned service with identical exact binding; no cached service')
  assert.equal((await outbox().snapshot())[0].status, 'unknown', 'persisted uncertain receipt survives service replacement')
  assert.equal((await outbox().begin({ saved: [{ eventId: 'old-save', commit: 'a'.repeat(40) }], text: 'retry old', requestId: randomUUID() })).entries.length, 0)
  await outbox().prepare({ eventId: 'new-save', skill: 'test_bundle', payloadHash: 'new' }); await outbox().saved('new-save', 'b'.repeat(40))
  const next = await outbox().begin({ text: 'new authorized operation', requestId: randomUUID() })
  assert.deepEqual(next.entries.map(entry => entry.eventId), ['new-save'])
  const freshClient = randomUUID(), lease = fresh.pulse(freshClient, true)
  fresh.submit(next.requestId, 'new authorized operation')
  assert.equal(fresh.take(freshClient, lease.generation).message.text, 'new authorized operation')
  assert.equal(old.status(oldId).message.status, 'delivery_unknown', 'old queue stays quarantined')
})
