import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { createCodexConnection, openNativeConnection } from '../src/codex-connection.mjs'
import { notificationErrorResponse } from '../src/notification-delivery.mjs'

const threadId = '00000000-0000-4000-8000-000000000001'

function proxy() {
  const child = new EventEmitter()
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null })
  child.signals = []
  child.kill = signal => { child.signals.push(signal); child.signalCode = signal; child.emit('exit') }
  return child
}

test('Codex proxy exit and real WebSocket handshake rejection report setup without exposing stderr', async () => {
  for (const mode of ['proxy-exit', 'proxy-error', 'handshake-rejected']) {
    const child = new EventEmitter()
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null })
    const signals = []; const input = []
    child.kill = signal => { signals.push(signal); child.signalCode = signal; child.emit('exit') }
    child.stdin.on('data', bytes => {
      input.push(bytes.toString())
      if (mode === 'handshake-rejected') child.stdout.write('HTTP/1.1 403 SECRET\r\nX-Private: SECRET\r\nContent-Length: 0\r\n\r\n')
    })
    await assert.rejects(openNativeConnection(['app-server', 'proxy'], {
      spawnProxy() {
        setImmediate(() => {
          child.stderr.write('SECRET socket/path token native notification body')
          if (mode === 'proxy-exit') { child.exitCode = 1; child.emit('exit', 1) }
          if (mode === 'proxy-error') child.emit('error', Error('SECRET spawn error'))
        })
        return child
      },
    }), error => {
      const receipt = notificationErrorResponse(error)
      assert.equal(receipt?.notSubmitted, true)
      assert.equal(receipt.stage, mode.startsWith('proxy-') ? 'proxy-connect' : 'websocket-handshake')
      assert.equal(receipt.transportCategory, 'disconnected')
      assert.doesNotMatch(JSON.stringify(error), /SECRET|socket\/path|notification body/)
      return true
    })
    assert.match(input.join(''), /^GET \/ HTTP\/1\.1/)
    assert.doesNotMatch(input.join(''), /initialize|thread\/queue|notification body/)
    assert.deepEqual(signals, mode === 'proxy-exit' ? [] : ['SIGTERM'])
    assert.equal(child.stdin.destroyed, true)
    assert.equal(child.stdout.destroyed, true)
  }
})

test('Codex initialize disconnect/rejection is not submitted but queue disconnect/rejection stays unknown', async () => {
  for (const stage of ['initialize', 'queue-add']) for (const failure of ['disconnected', 'rejected']) {
    const child = new EventEmitter()
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null })
    const signals = []; const methods = []
    child.kill = signal => { signals.push(signal); child.signalCode = signal; child.emit('exit') }
    class Socket extends EventEmitter {
      constructor() { super(); queueMicrotask(() => this.emit('open')) }
      terminate() {}
      send(text) {
        const request = JSON.parse(text); methods.push(request.method)
        if (!request.id) return
        const failed = request.method === (stage === 'initialize' ? stage : 'thread/queue/add')
        if (failed && failure === 'disconnected') { queueMicrotask(() => this.emit('close')); return }
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: request.id,
          ...(failed ? { error: { code: -32600, message: 'SECRET native body' } } : { result: {} }),
        }))))
      }
    }
    const connection = createCodexConnection(threadId, args => openNativeConnection(args, { WebSocket: Socket, spawnProxy: () => child }))
    await assert.rejects(connection.send('SECRET user text'), error => {
      const receipt = notificationErrorResponse(error)
      assert.equal(receipt.delivery, stage === 'initialize' ? 'not-submitted' : 'unknown')
      assert.equal(receipt.notSubmitted, stage === 'initialize' ? true : undefined)
      assert.equal(receipt.stage, stage)
      assert.equal(receipt.transportCategory, failure === 'disconnected' ? 'disconnected' : 'rpc-rejected')
      if (stage === 'queue-add') {
        assert.equal(receipt.lastConfirmed, 'initialized')
        assert.match(receipt.clientUserMessageId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
      }
      assert.doesNotMatch(JSON.stringify(error), /SECRET/)
      return true
    })
    assert.equal(methods.filter(method => method === 'thread/queue/add').length, stage === 'initialize' ? 0 : 1)
    assert.equal(methods.some(method => ['thread/resume', 'turn/start', 'thread/queue/start'].includes(method)), false)
    assert.deepEqual(signals, ['SIGTERM'])
  }
})

test('Codex native proxy uses standard WebSocket and bounds owned transport cleanup', async () => {
  for (const mode of ['response', 'cancelled', 'rejected']) {
    const child = new EventEmitter()
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null })
    const signals = []
    child.kill = signal => { signals.push(signal); child.signalCode = signal; child.emit('exit') }
    let terminated = false
    class Socket extends EventEmitter {
      constructor(url, options) { super(); assert.equal(url, 'ws://localhost/'); assert.ok(options.createConnection()); queueMicrotask(() => this.emit('open')) }
      send(text) { const r = JSON.parse(text); if (mode !== 'cancelled' && r.id) queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: r.id,
        ...(mode === 'rejected' ? { error: { code: -32600, message: 'SECRET https://private.invalid' } } : { result: {} }),
      })))) }
      terminate() { terminated = true }
    }
    const client = await openNativeConnection(['app-server', 'proxy'], { WebSocket: Socket,
      spawnProxy(command, args, options) { assert.equal(command, 'codex'); assert.deepEqual(args, ['app-server', 'proxy']); assert.equal(options.shell, false); return child } })
    if (mode === 'response') { await client.request('initialize', {}); client.close() }
    else if (mode === 'rejected') {
      await assert.rejects(client.request('initialize', {}), error => {
        assert.equal(error.transportCategory, 'rpc-rejected')
        assert.equal(error.rpcCode, -32600)
        assert.doesNotMatch(error.message, /SECRET|private.invalid/)
        return true
      })
      client.close()
    } else {
      const pending = client.request('initialize', {})
      client.close()
      await assert.rejects(pending, error => {
        assert.match(error.message, /disconnected/)
        assert.equal(error.transportCategory, 'disconnected')
        return true
      })
    }
    assert.equal(terminated, true)
    assert.deepEqual(signals, ['SIGTERM'])
    assert.equal(child.stdin.destroyed, true)
    assert.equal(child.stdout.destroyed, true)
  }
})

test('Codex queue response remains pending beyond the former fifteen-second connection deadline', { timeout: 30000 }, async t => {
  const child = proxy(), methods = []
  let socket, client, queued, request
  const ready = new Promise(resolve => { queued = resolve })
  class Socket extends EventEmitter {
    constructor() { super(); socket = this; queueMicrotask(() => this.emit('open')) }
    terminate() {}
    send(text) {
      const value = JSON.parse(text); methods.push(value.method)
      if (value.method === 'initialize') queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: value.id, result: {} }))))
      if (value.method === 'thread/queue/add') { request = value; queued() }
    }
  }
  const connection = createCodexConnection(threadId, async args => {
    client = await openNativeConnection(args, { WebSocket: Socket, spawnProxy: () => child })
    return client
  })
  t.after(() => client?.close())
  let state = 'pending'
  const outcome = connection.send('Controlled slow queue submission').then(value => { state = 'accepted'; return { value } }, error => { state = 'rejected'; return { error } })
  await ready
  await new Promise(resolve => setTimeout(resolve, 16000))
  assert.equal(state, 'pending', 'a live native queue RPC must not be cut off by elapsed connection time')
  assert.equal(request.params.threadId, threadId)
  assert.match(request.params.clientUserMessageId, /^[0-9a-f-]{36}$/)
  socket.emit('message', Buffer.from(JSON.stringify({ id: request.id, result: { queuedSubmission: { id: 'queued-after-old-deadline' } } })))
  assert.deepEqual((await outcome).value, { accepted: true, threadId, queuedSubmissionId: 'queued-after-old-deadline', status: 'queued' })
  assert.equal(methods.filter(method => method === 'thread/queue/add').length, 1)
  assert.equal(methods.some(method => ['thread/resume', 'turn/start', 'thread/queue/start'].includes(method)), false)
  assert.deepEqual(child.signals, ['SIGTERM'])
})

test('Codex explicit close cancels pending RPC before an unresponsive owned proxy exits', async t => {
  const child = proxy()
  child.kill = signal => { child.signals.push(signal) }
  t.after(() => { child.signalCode = 'SIGTERM'; child.emit('exit') })
  let terminated = false
  class Socket extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('open')) }
    send() {}
    terminate() { terminated = true }
  }
  const client = await openNativeConnection(['app-server', 'proxy'], { WebSocket: Socket, spawnProxy: () => child })
  let state = 'pending'
  const result = client.request('thread/read', { threadId }).then(value => { state = 'resolved'; return value }, error => { state = 'rejected'; return error })
  client.close()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state, 'rejected', 'caller close must settle pending RPC without depending on a proxy exit event')
  assert.equal((await result).transportCategory, 'disconnected')
  client.close()
  assert.deepEqual(child.signals, ['SIGTERM'])
  assert.equal(terminated, true)
  assert.equal(child.stdin.destroyed, true)
  assert.equal(child.stdout.destroyed, true)
})

test('Codex malformed frames, send failures and socket errors reject pending RPC without exposing host details', async () => {
  for (const fault of ['protocol', 'send-failed', 'disconnected']) {
    const child = proxy()
    class Socket extends EventEmitter {
      constructor() { super(); queueMicrotask(() => this.emit('open')) }
      terminate() {}
      send() {
        if (fault === 'protocol') this.emit('message', Buffer.from('SECRET invalid JSON'))
        else if (fault === 'send-failed') throw Error('SECRET native send failure')
        else this.emit('error', Error('SECRET socket error'))
      }
    }
    const client = await openNativeConnection(['app-server', 'proxy'], { WebSocket: Socket, spawnProxy: () => child })
    await assert.rejects(client.request('thread/read', { threadId }), error => {
      assert.equal(error.transportCategory, fault)
      assert.doesNotMatch(error.message, /SECRET/)
      return true
    })
    client.close()
    assert.deepEqual(child.signals, ['SIGTERM'])
  }
})

test('Codex connection close retains bounded TERM/KILL cleanup for its unresponsive proxy', { timeout: 5000 }, async t => {
  if (process.platform === 'win32') { t.skip('POSIX signal escalation'); return }
  const child = spawn(process.execPath, ['--input-type=module', '--eval',
    'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'],
  { stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await exited
  })
  assert.equal((await once(child.stdout, 'data'))[0].toString(), 'ready\n')
  const signals = [], kill = child.kill.bind(child)
  child.kill = signal => { signals.push(signal); return kill(signal) }
  class Socket extends EventEmitter {
    constructor() { super(); queueMicrotask(() => this.emit('open')) }
    send() {}
    terminate() {}
  }
  const client = await openNativeConnection(['app-server', 'proxy'], { WebSocket: Socket, spawnProxy: () => child })
  t.after(() => client.close())
  client.close()
  assert.deepEqual(signals, ['SIGTERM'])
  assert.deepEqual(await exited, [null, 'SIGKILL'])
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
})

for (const stage of ['handshake', 'initialize', 'queue-add']) {
  test(`Codex factory close reaches its pending ${stage} transport and owns proxy cleanup`, { timeout: 5000 }, async t => {
    if (process.platform === 'win32') { t.skip('POSIX signal escalation'); return }
    const child = spawn(process.execPath, ['--input-type=module', '--eval',
      'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000)'],
    { stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    let client, factory, outcome
    t.after(async () => {
      factory?.close?.()
      client?.close()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await exited
      await outcome
    })
    assert.equal((await once(child.stdout, 'data'))[0].toString(), 'ready\n')
    const signals = [], kill = child.kill.bind(child)
    child.kill = signal => { signals.push(signal); return kill(signal) }
    let waiting, spawns = 0
    const ready = new Promise(resolve => { waiting = resolve })
    const methods = []
    class Socket extends EventEmitter {
      constructor() {
        super()
        if (stage === 'handshake') waiting()
        else queueMicrotask(() => this.emit('open'))
      }
      terminate() {}
      send(text) {
        const request = JSON.parse(text); methods.push(request.method)
        if (request.method === (stage === 'initialize' ? 'initialize' : 'thread/queue/add')) waiting()
        else if (request.id) queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: request.id, result: {} }))))
      }
    }
    factory = createCodexConnection(threadId, async (args, options) => {
      client = await openNativeConnection(args, { WebSocket: Socket, signal: options?.signal,
        spawnProxy: () => { spawns++; return child } })
      return client
    })
    let state = 'pending'
    outcome = factory.send('SECRET controlled cancellation').then(value => { state = 'resolved'; return value }, error => { state = 'rejected'; return error })
    await ready
    factory.close?.() // The existing Companion server close hook calls this factory port.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(state, 'rejected', 'service close must settle the factory request, not merely a separately held low-level client')
    const receipt = notificationErrorResponse(await outcome)
    assert.equal(receipt.delivery, stage === 'queue-add' ? 'unknown' : 'not-submitted')
    assert.equal(receipt.stage, stage === 'handshake' ? 'websocket-handshake' : stage)
    assert.equal(receipt.transportCategory, 'disconnected')
    assert.doesNotMatch(JSON.stringify(receipt), /SECRET/)
    if (stage === 'queue-add') {
      assert.equal(receipt.lastConfirmed, 'initialized')
      assert.match(receipt.clientUserMessageId, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
    }
    assert.equal(methods.filter(method => method === 'thread/queue/add').length, stage === 'queue-add' ? 1 : 0)
    assert.equal(methods.some(method => ['thread/resume', 'turn/start', 'thread/queue/start'].includes(method)), false)
    assert.deepEqual(await exited, [null, 'SIGKILL'])
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
    factory.close()
    await assert.rejects(factory.send('Must not restart a closed service'), error => error.notSubmitted === true)
    assert.equal(spawns, 1)
  })
}
