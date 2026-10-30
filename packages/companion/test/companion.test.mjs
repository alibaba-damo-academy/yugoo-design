import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile, symlink, unlink, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { request } from 'node:http'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { fixture, threadId } from './fixture.mjs'
import { openCompanionProject } from '../src/project.mjs'
import { createCodexConnection, requireThreadId, openNativeConnection } from '../src/codex-connection.mjs'
import { notificationErrorResponse } from '../src/notification-delivery.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { startCompanion } from '../src/server.mjs'
import { staticFixture } from './static-fixture.mjs'

test('browser default view is an explicit presentation setting on HTML entries only', async () => {
  for (const browserAccess of ['token', 'local']) {
    for (const browserDefaultView of [undefined, 'panel-only']) {
      const f = await fixture({ serverOptions: { browserAccess, browserDefaultView } })
      try {
        for (const view of ['', '?view=full', '?view=studio', '?view=trial-panel', '?view=design', '?view=unknown']) {
          const entry = new URL(f.server.url)
          entry.search = view
          const response = await fetch(entry)
          assert.equal(response.status, 200)
          assert.equal(response.headers.get('x-frame-options'), 'DENY')
          const html = await response.text()
          assert.match(html, /^<!doctype html>/i)
          assert.ok(html.includes(`<meta name="design-companion-default-view" content="${browserDefaultView ?? 'full'}">`))
          assert.ok(html.includes('/client.js'))
        }
        // Both implicit and explicit head elements retain their declaration.
        await writeFile(f.options.indexPath, '<!doctype html><html><head><title>Panel</title></head><body></body></html>')
        const html = await (await fetch(f.server.url)).text()
        assert.match(html, /<head><meta name="design-companion-default-view" content="(?:full|panel-only)"><title>/)
        assert.equal(await (await fetch(f.server.origin + '/client.js')).text(), '// Synthetic API server fixture; no browser execution.\n')
        assert.deepEqual(f.messages, [], 'presentation never submits a native message')
      } finally { await f.close() }
    }
  }
})

test('invalid browser default view fails before acquiring a native connection', async () => {
  await assert.rejects(startCompanion({ browserDefaultView: 'studio' }), /browserDefaultView must be full or panel-only/)
})


test('failed project startup closes the already acquired native transport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-startup-close-'))
  let closed = 0
  try {
    const staticOptions = await staticFixture(root)
    await assert.rejects(startCompanion({ ...staticOptions, host: 'qwenwork', threadId,
      projectRoot: join(root, 'missing-project'), kitRoot: join(root, 'missing-kit'), stateRoot: join(root, 'state'),
      connection: { host: 'qwenwork', threadId, inputMode: 'desktop', close: () => closed++, send: async () => { throw Error('must not send') } },
    }))
    assert.equal(closed, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex native notification binds exact thread and returned queue ID without model overrides', async () => {
  assert.throws(() => requireThreadId('latest'), /exact Codex thread/)
  for (const remote of [undefined, 'unix:///private test/app-server.sock']) {
    const calls = []
    let closed = 0
    const connection = createCodexConnection(threadId, async args => {
      assert.deepEqual(args, ['app-server', 'proxy', ...(remote ? ['--sock', '/private test/app-server.sock'] : [])])
      return { notify: (method, params) => calls.push({ method, params }), close: () => { closed++ },
        request: async (method, params) => {
          calls.push({ method, params })
          if (method === 'thread/queue/add') return { queuedSubmission: { id: 'exact-native-id' } }
          if (method !== 'initialize') throw new Error('Queue transport must not read, resume or start a thread.')
          return {}
        } }
    }, { remote })
    assert.deepEqual(await connection.send('a message; $(not-a-shell)'), {
      accepted: true, threadId, queuedSubmissionId: 'exact-native-id', status: 'queued',
    })
    assert.deepEqual(calls.map(c => c.method), ['initialize', 'initialized', 'thread/queue/add'])
    assert.equal(calls.at(-1).params.threadId, threadId)
    assert.equal(calls[2].params.input[0].text, 'a message; $(not-a-shell)')
    assert.match(calls[2].params.clientUserMessageId, /^[0-9a-f-]{36}$/)
    assert.equal(closed, 1)
    await assert.rejects(connection.send(''), /bytes/)
  }
  for (const remote of ['', 'unix://relative.sock', 'ws://remote.invalid', 'unix:///']) {
    assert.throws(() => createCodexConnection(threadId, undefined, { remote }), /explicit unix/)
  }
})

test('Codex availability is read-only, exact-thread and not a native execution receipt', async () => {
  for (const id of [threadId, 'another-thread', undefined]) {
    const calls = []; let closed = 0
    const connection = createCodexConnection(threadId, async () => ({
      notify(method) { calls.push({ method }) }, close() { closed++ }, async request(method, params) {
        calls.push({ method, params })
        if (method === 'thread/read') return { thread: { id, status: { type: 'notLoaded' } } }
        assert.equal(method, 'initialize', 'a probe cannot queue, resume, or start a turn')
        return {}
      },
    }))
    assert.deepEqual(await connection.probe(), { status: id === threadId ? 'available' : 'unknown' })
    assert.deepEqual(calls.map(call => call.method), ['initialize', 'initialized', 'thread/read'])
    assert.deepEqual(calls.at(-1).params, { threadId, includeTurns: false })
    assert.equal(closed, 1)
  }
})

test('Codex queue leaves local TUI lifecycle to the host and never retries unknown delivery', async () => {
  for (const status of ['active', 'notLoaded', 'systemError', 'idle']) {
    const calls = []
    let closed = 0
    const connection = createCodexConnection(threadId, async () => ({
      notify() {}, close() { closed++ }, async request(method) {
        calls.push(method)
        if (method === 'thread/read') return { thread: { id: threadId, status: { type: status } } }
        if (method === 'thread/queue/add') return { queuedSubmission: { id: 'only-new-id' } }
        if (method !== 'initialize') throw new Error('Unexpected lifecycle method.')
        return {}
      },
    }))
    const result = await connection.send('new user notification')
    assert.equal(result.status, 'queued')
    assert.equal(result.turnId, undefined)
    assert.deepEqual(calls, ['initialize', 'thread/queue/add'])
    assert.equal(closed, 1)
  }
})

test('Codex unknown queue-add delivery receipts never leak raw failures or retry', async () => {
  for (const failure of ['add', 'invalid-response']) {
    const calls = []
    const connection = createCodexConnection(threadId, async () => ({
      notify() {}, close() {}, async request(method, params) {
        calls.push({ method, params })
        if (method === `thread/queue/${failure}`) throw Object.assign(new Error('SECRET token https://private.invalid/raw'), { transportCategory: 'rpc-rejected', rpcCode: -32600, raw: 'SECRET' })
        if (method === 'thread/queue/add') return { queuedSubmission: {} }
        return {}
      },
    }))
    await assert.rejects(connection.send('SECRET notification body'), error => {
      const receipt = notificationErrorResponse(error)
      assert.equal(receipt.delivery, 'unknown')
      assert.equal(receipt.stage, 'queue-add')
      assert.equal(receipt.lastConfirmed, 'initialized')
      assert.equal(receipt.queuedSubmissionId, undefined)
      assert.equal(receipt.clientUserMessageId, calls.find(c => c.method === 'thread/queue/add').params.clientUserMessageId)
      assert.equal(receipt.transportCategory, failure === 'add' ? 'rpc-rejected' : 'invalid-response')
      assert.equal(receipt.rpcCode, failure === 'add' ? -32600 : undefined)
      assert.equal(receipt.turnId, undefined)
      assert.equal(receipt.accepted, undefined)
      assert.equal(error.notSubmitted, undefined, 'an attempted queue insertion is never safe to replay')
      assert.doesNotMatch(JSON.stringify(error), /SECRET|private.invalid|notification body/)
      assert.doesNotMatch(JSON.stringify(receipt), /SECRET|private.invalid|notification body/)
      return true
    })
    assert.equal(calls.filter(c => c.method === 'thread/queue/add').length, 1)
    assert.equal(calls.filter(c => c.method === 'thread/queue/start').length, 0)
  }
})

test('Codex setup failures before queue-add are safe, staged and never submit a message', async () => {
  for (const failure of ['proxy-connect', 'initialize', 'initialized']) {
    const calls = []; let closed = 0
    const secret = Object.assign(new Error('SECRET token https://private.invalid/raw'), { transportCategory: 'rpc-rejected', rpcCode: -32600, raw: 'SECRET' })
    const connection = createCodexConnection(threadId, async () => {
      if (failure === 'proxy-connect') throw secret
      return { close() { closed++ }, notify(method) { calls.push(method); if (failure === method) throw secret },
        async request(method) { calls.push(method); if (failure === method) throw secret; return {} } }
    })
    for (const operation of ['send', 'probe']) {
      await assert.rejects(operation === 'send' ? connection.send('SECRET notification body') : connection.probe(), error => {
        const receipt = notificationErrorResponse(error)
        assert.equal(receipt?.delivery, 'not-submitted')
        assert.equal(receipt.notSubmitted, true)
        assert.equal(receipt.stage, failure === 'proxy-connect' ? failure : 'initialize')
        assert.equal(receipt.status, 'unavailable')
        assert.equal(receipt.transportCategory, 'rpc-rejected')
        assert.equal(receipt.rpcCode, -32600)
        assert.match(receipt.error, /setup.*unavailable/i)
        assert.doesNotMatch(JSON.stringify(receipt), /SECRET|private.invalid|notification body/)
        assert.doesNotMatch(JSON.stringify(error), /SECRET|private.invalid|notification body/)
        return true
      })
    }
    assert.equal(calls.includes('thread/queue/add'), false)
    assert.equal(calls.includes('thread/read'), false, 'failed initialization cannot probe a thread')
    assert.equal(closed, failure === 'proxy-connect' ? 0 : 2)
  }
})

test('Codex setup safe HTTP receipt survives CLI transport without trusting raw fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notification-setup-'))
  const originalFetch = globalThis.fetch
  try {
    const connection = join(root, 'connection.json')
    await writeFile(connection, JSON.stringify({ origin: 'http://127.0.0.1:12345', token: 'a'.repeat(64) }))
    const serialized = notificationErrorResponse({ delivery: 'not-submitted', notSubmitted: true, stage: 'websocket-handshake',
      transportCategory: 'disconnected', token: 'SECRET', raw: 'SECRET' })
    let calls = 0
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ...serialized, error: 'SECRET', raw: 'SECRET' }), { status: 400 }) }
    await assert.rejects(callCompanion(connection, { method: 'sendPrompt', params: { text: 'SECRET' } }), error => {
      assert.deepEqual(notificationErrorResponse(error), serialized)
      assert.equal(error.notSubmitted, true)
      assert.match(error.message, /setup.*unavailable/i)
      assert.doesNotMatch(JSON.stringify(error), /SECRET/)
      return true
    })
    assert.equal(calls, 1)
    assert.equal(notificationErrorResponse({ delivery: 'not-submitted', stage: 'initialize' }), undefined)
    assert.equal(notificationErrorResponse({ delivery: 'not-submitted', notSubmitted: true, stage: 'SECRET' }), undefined)
    const unknown = notificationErrorResponse({ delivery: 'unknown', stage: 'queue-add', notSubmitted: true })
    assert.equal(unknown.notSubmitted, undefined, 'an unknown receipt cannot acquire recovery authority')
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }) }
})

test('Codex proxy exit and real WebSocket handshake rejection report setup without exposing stderr', async () => {
  for (const mode of ['proxy-exit', 'proxy-error', 'handshake-rejected', 'handshake-timeout']) {
    const child = new EventEmitter()
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null })
    const signals = []; const input = []
    child.kill = signal => { signals.push(signal); child.signalCode = signal; child.emit('exit') }
    child.stdin.on('data', bytes => {
      input.push(bytes.toString())
      if (mode === 'handshake-rejected') child.stdout.write('HTTP/1.1 403 SECRET\r\nX-Private: SECRET\r\nContent-Length: 0\r\n\r\n')
    })
    await assert.rejects(openNativeConnection(['app-server', 'proxy'], { timeoutMs: 100,
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
      assert.equal(receipt.transportCategory, mode === 'handshake-timeout' ? 'timeout' : 'disconnected')
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

test('Codex initialize timeout/rejection is not submitted but queue timeout/rejection stays unknown', async () => {
  for (const stage of ['initialize', 'queue-add']) for (const failure of ['timeout', 'rejected']) {
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
        if (failed && failure === 'timeout') return
        queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: request.id,
          ...(failed ? { error: { code: -32600, message: 'SECRET native body' } } : { result: {} }),
        }))))
      }
    }
    const connection = createCodexConnection(threadId, args => openNativeConnection(args, { WebSocket: Socket, timeoutMs: 50, spawnProxy: () => child }))
    await assert.rejects(connection.send('SECRET user text'), error => {
      const receipt = notificationErrorResponse(error)
      assert.equal(receipt.delivery, stage === 'initialize' ? 'not-submitted' : 'unknown')
      assert.equal(receipt.notSubmitted, stage === 'initialize' ? true : undefined)
      assert.equal(receipt.stage, stage)
      assert.equal(receipt.transportCategory, failure === 'timeout' ? 'timeout' : 'rpc-rejected')
      assert.doesNotMatch(JSON.stringify(error), /SECRET/)
      return true
    })
    assert.equal(methods.filter(method => method === 'thread/queue/add').length, stage === 'initialize' ? 0 : 1)
    assert.equal(methods.some(method => ['thread/resume', 'turn/start', 'thread/queue/start'].includes(method)), false)
    assert.deepEqual(signals, ['SIGTERM'])
  }
})

test('Codex existing availability probe and send API expose only safe setup feedback', async () => {
  let connections = 0
  const connection = createCodexConnection(threadId, async () => { connections++; throw Error('SECRET native setup failure') })
  const f = await fixture({ serverOptions: { connection } })
  try {
    const probe = await callCompanion(f.server.connectionPath, { method: 'studioTrialAvailability', params: {} })
    assert.equal(probe.status, 'unavailable')
    assert.equal(probe.stage, 'proxy-connect')
    assert.equal(probe.notSubmitted, true)
    assert.doesNotMatch(JSON.stringify(probe), /SECRET/)
    await assert.rejects(callCompanion(f.server.connectionPath, { method: 'sendPrompt', params: { text: 'Fixture only', saved: [] } }), error => {
      assert.equal(error.notSubmitted, true)
      assert.equal(error.stage, 'proxy-connect')
      assert.doesNotMatch(error.message, /SECRET/)
      return true
    })
    assert.equal(connections, 2)
    assert.deepEqual(f.messages, [])
  } finally { await f.close() }
})

test('Codex unknown delivery safe HTTP receipt survives CLI transport and excludes untrusted fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notification-receipt-'))
  const originalFetch = globalThis.fetch
  try {
    const connection = join(root, 'connection.json')
    await writeFile(connection, JSON.stringify({ origin: 'http://127.0.0.1:12345', token: 'a'.repeat(64) }))
    const serialized = notificationErrorResponse({ delivery: 'unknown', stage: 'queue-start', lastConfirmed: 'post-add-read',
      queuedSubmissionId: threadId, clientUserMessageId: threadId, transportCategory: 'rpc-rejected', rpcCode: -32600,
      token: 'SECRET', text: 'SECRET', raw: 'https://private.invalid', error: 'SECRET' })
    let calls = 0
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ ...serialized, error: 'SECRET', raw: 'SECRET' }), { status: 400 }) }
    await assert.rejects(callCompanion(connection, { method: 'sendPrompt', params: { text: 'SECRET' } }), error => {
      assert.deepEqual(notificationErrorResponse(error), serialized)
      assert.doesNotMatch(JSON.stringify(notificationErrorResponse(error)), /SECRET|private.invalid/)
      assert.equal(error.delivery, 'unknown')
      return true
    })
    assert.equal(calls, 1)
    const unsafe = notificationErrorResponse({ delivery: 'unknown', stage: 'SECRET', lastConfirmed: 'SECRET',
      queuedSubmissionId: 'a'.repeat(64), turnId: 'https://private.invalid', rpcCode: Infinity, transportCategory: 'SECRET' })
    assert.deepEqual(Object.keys(unsafe), ['error', 'delivery', 'transportCategory'])
    assert.equal(unsafe.transportCategory, 'unknown')
  } finally { globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }) }
})

test('Codex native proxy uses standard WebSocket and bounds owned transport cleanup', async () => {
  for (const mode of ['response', 'timeout', 'rejected']) {
    const child = new EventEmitter()
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null })
    const signals = []
    child.kill = signal => { signals.push(signal); child.signalCode = signal; child.emit('exit') }
    let terminated = false
    class Socket extends EventEmitter {
      constructor(url, options) { super(); assert.equal(url, 'ws://localhost/'); assert.ok(options.createConnection()); queueMicrotask(() => this.emit('open')) }
      send(text) { const r = JSON.parse(text); if (mode !== 'timeout' && r.id) queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: r.id,
        ...(mode === 'rejected' ? { error: { code: -32600, message: 'SECRET https://private.invalid' } } : { result: {} }),
      })))) }
      terminate() { terminated = true }
    }
    const client = await openNativeConnection(['app-server', 'proxy'], { WebSocket: Socket, timeoutMs: 30,
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
    } else await assert.rejects(client.request('initialize', {}), error => {
      assert.match(error.message, /disconnected or timed out/)
      assert.equal(error.transportCategory, 'timeout')
      return true
    })
    assert.equal(terminated, true)
    assert.deepEqual(signals, ['SIGTERM'])
    assert.equal(child.stdin.destroyed, true)
    assert.equal(child.stdout.destroyed, true)
  }
})

test('real files, native Kit validation, atomic save and failed notification recovery', async () => {
  const statusEntryPath = '/installed companion fixture/shared/scripts/design.mjs'
  const f = await fixture({ serverOptions: { statusEntryPath } })
  try {
    const api = f.server.project
    const state = { questions: { overview: { prompt: '产品目标是什么？', kind: 'text', answer: '帮助研究者整理证据', detail: '' } } }
    const path = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
    await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
    await writeFile(path, JSON.stringify(state))
    const live = await api.readWorkspace()
    assert.deepEqual(live.design.smart_questions.state, state, 'uncommitted file is immediately visible')
    assert.ok(live.design.smart_questions.skillManifest, 'native renderer metadata is provided by the real Kit')
    const changed = structuredClone(state)
    changed.questions.overview.answer = '本地保存后的答案'
    const event = { skill: 'smart_questions', state: changed, eventId: 'save-one' }
    const saved = await api.savePanel(event)
    assert.ok(saved.commit)
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), changed)
    assert.deepEqual(await api.savePanel(event), saved, 'same save event is idempotent')
    assert.equal(await api.store.head(), saved.commit)
    await assert.rejects(api.savePanel({ ...event, state, }), /different content/)
    await assert.rejects(api.savePanel({ ...event, eventId: 'invalid', state: { unexpected: true } }), /./)
    assert.equal(await api.store.head(), saved.commit)
    await assert.rejects(api.savePanel({ ...event, eventId: 'bad-attachment', artifacts: [{ path: 'smart_questions/a.png', encoding: 'base64', content: '%invalid%' }] }), /base64/)
    await assert.rejects(api.readArtifact({ path: 'smart_questions/../../project.json' }), /./)
    await symlink(join(f.options.projectRoot, 'project.json'), join(f.options.projectRoot, 'design_files/smart_questions/escape.txt'))
    await assert.rejects(api.readArtifact({ path: 'smart_questions/escape.txt' }), /./)
    await unlink(join(f.options.projectRoot, 'design_files/smart_questions/escape.txt'))
    f.failNotification(true)
    await assert.rejects(api.sendPrompt({ text: '保存并继续设计' }), /disconnected/)
    assert.equal(await api.store.head(), saved.commit, 'notification failure does not undo or repeat save')
    f.failNotification(false)
    const originalSend = f.options.connection.send
    // Held/unknown are covered by the durable no-replay regressions, not by
    // treating a later retry as proof that the prior submission was absent.
    for (const status of ['denied', 'expired']) {
      f.options.connection.send = async text => {
        assert.match(text, /本地保存后的答案/)
        return { accepted: false, status }
      }
      assert.equal((await api.sendPrompt({ text: 'fixture notification' })).status, status)
      assert.equal(await api.store.head(), saved.commit)
    }
    f.options.connection.send = originalSend
    await api.sendPrompt({ text: '请读取当前文件' })
    assert.equal(f.messages.length, 1)
    assert.match(f.messages[0], /本地保存后的答案/)
    assert.match(f.messages[0], /Do not call a write tool/)
    assert.match(f.messages[0], /After this Panel save, read design_status once\./)
    assert.ok(f.messages[0].includes(`Exact Companion connection file: ${JSON.stringify(f.server.connectionPath)}`))
    assert.match(f.messages[0], /Pass the path only; do not read, print, or copy its token or file contents/)
    assert.ok(f.messages[0].includes(`node ${JSON.stringify(statusEntryPath)} call --connection ${JSON.stringify(f.server.connectionPath)} --request /absolute/temporary-status-request.json`))
    assert.ok(f.messages[0].includes('The temporary request must contain {"method":"readWorkspace","params":{}}'))
    assert.ok(!f.messages[0].includes(f.server.token), 'notification carries the exact path, not connection secrets')
    assert.match(f.messages[0], /do not wait for background GRA, busy-poll, or automatically retry failed reviews/)
    assert.equal(await api.store.head(), saved.commit, 'notification-only recovery never writes again')
    const reopened = await openCompanionProject(f.options)
    assert.deepEqual(await reopened.savePanel(event), saved, 'Core Git event ID prevents a repeated commit after restart')
    assert.equal(await reopened.store.head(), saved.commit)
    assert.deepEqual((await reopened.readWorkspace()).design.smart_questions.state, changed)
    await api.sendPrompt({ text: 'Invoke run_design_skill exactly once' })
    assert.match(f.messages.at(-1), /native-execution/)
    assert.doesNotMatch(f.messages.at(-1), /After this Panel save/, 'save reminder is consumed with its successfully delivered diff')
    assert.ok(f.messages.at(-1).includes(`Exact Companion connection file: ${JSON.stringify(f.server.connectionPath)}`), 'ordinary continuation retains its exact connection after the saved diff is consumed')
  } finally { await f.close() }
})

test('local HTTP endpoint checks origin, token, paths and method allowlist', async () => {
  const f = await fixture()
  try {
    const { origin, token } = f.server
    const call = async (body, headers = {}) => fetch(`${origin}/api`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Design-Token': token, ...headers }, body: JSON.stringify(body) })
    assert.equal((await call({ method: 'readWorkspace' }, { 'X-Design-Token': '' })).status, 403)
    assert.equal((await call({ method: 'readWorkspace' }, { Origin: 'https://untrusted.invalid' })).status, 403)
    // Node fetch rewrites Host; raw HTTP exercises DNS-rebinding protection.
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(origin, { headers: { Host: 'untrusted.invalid' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end()
    })
    assert.equal(wrongHost, 403)
    assert.equal((await call({ method: 'constructor' })).status, 400)
    assert.equal((await call({ method: 'readWorkspace' })).status, 200)
    const index = await fetch(origin)
    assert.equal(index.status, 200)
    assert.ok((await index.text()).includes('/client.js'))
    assert.equal((await fetch(`${origin}/project.json`)).status, 404)
    assert.equal((await fetch(`${origin}/client.js`)).status, 200)
  } finally { await f.close() }
})

test('local browser access survives fresh clients without opening the native tool surface', async () => {
  const f = await fixture({ serverOptions: { browserAccess: 'local' } })
  try {
    const { origin, url, token, browserGeneration } = f.server
    assert.equal(new URL(url).hash, '')
    assert.equal(new URL(url).pathname, `/browser/${browserGeneration}/`)
    const endpoint = `${url}api`
    const call = (method, headers = {}) => fetch(endpoint, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1', ...headers,
    }, body: JSON.stringify({ method, params: {} }) })
    for (const query of ['', '?view=panel-only', '?view=full', '?browserAccess=token']) {
      const page = await fetch(url + query)
      assert.equal(page.status, 200)
      assert.equal(page.headers.get('x-frame-options'), 'DENY')
      assert.ok((await page.text()).includes('/client.js'))
      assert.equal((await call('info')).status, 200)
    }
    assert.deepEqual(f.messages, [], 'loading a page never sends a native message')
    assert.equal((await call('readWorkspace')).status, 200)
    // Current library editing remains usable through the local entry.
    for (const method of ['studioWorkspace', 'studioInstanceList']) {
      const response = await call(method)
      assert.equal(response.status, 200, `${method}: ${await response.text()}`)
    }
    const state={questions:{local:{prompt:'Local browser save',kind:'text',answer:'durable local answer',detail:''}}}
    const localWrite=async(method,params)=>fetch(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Design-Browser':'1'},body:JSON.stringify({method,params})})
    const saved=await localWrite('savePanel',{skill:'smart_questions',state,eventId:'local-browser-save'})
    assert.equal(saved.status,200)
    const receipt=await saved.json();assert.ok(receipt.commit)
    assert.deepEqual(JSON.parse((await f.server.project.readArtifact({path:'smart_questions/smart_questions.json'})).content),state)
    const sent=await localWrite('sendPrompt',{text:'Read the saved local browser answers'})
    assert.equal(sent.status,200);assert.equal(f.messages.length,1);assert.match(f.messages[0],/Read the saved local browser answers/)
    for (const method of ['prepareBundle', 'finishNativeRun', 'registerNativeRun', 'bindReviewRun', 'constructor']) {
      assert.equal((await call(method, { 'X-Design-Token': token })).status, 403, method)
    }
    for (const headers of [
      { Origin: '' }, { Origin: 'null' }, { Origin: 'https://outside.invalid' },
      { Origin: 'http://127.0.0.1:1' }, { 'X-Design-Browser': '' },
      { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/jsonp' },
      { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' },
    ]) assert.equal((await call('info', headers)).status, 403, JSON.stringify(headers))
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://outside.invalid', 'Access-Control-Request-Method': 'POST' } })
    assert.equal(preflight.headers.get('access-control-allow-origin'), null)
    assert.equal(preflight.status, 405)
    assert.equal((await fetch(`${origin}/api`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1' }, body: '{"method":"info"}' })).status, 403)
    assert.equal((await fetch(`${origin}/api`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Design-Token': token }, body: '{"method":"info"}' })).status, 200)
  } finally { await f.close() }
})

test('token mode and new service generations reject stale or URL-enabled local access', async () => {
  const a = await fixture({ serverOptions: { browserAccess: 'local' } })
  const b = await fixture({ serverOptions: { browserAccess: 'local' } })
  const legacy = await fixture()
  try {
    const oldPath = new URL(a.server.url).pathname
    for (const server of [b.server, legacy.server]) {
      assert.equal((await fetch(server.origin + oldPath + '?browserAccess=local')).status, 410)
      assert.equal((await fetch(server.origin + oldPath + 'api', { method: 'POST', headers: {
        Origin: server.origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1',
      }, body: '{"method":"info"}' })).status, 410)
    }
    assert.equal(legacy.server.browserAccess, 'token')
    assert.match(legacy.server.url, /#[a-f0-9]{64}$/)
  } finally { await Promise.all([a.close(), b.close(), legacy.close()]) }
})

test('native attachment bytes and references save together; missing references cannot pass', async () => {
  const f = await fixture()
  try {
    const api = f.server.project
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII='
    const attachment = 'smart_questions/attachments/fixture.png'
    const state = { questions: { example: { prompt: '参考素材', kind: 'text', answer: '图片说明', multimodal_answer: [{
      type: 'file', file_md5: 'fixture', filename: 'fixture.png', mime_type: 'image/png',
      size_bytes: Buffer.from(image, 'base64').length, artifact_file: attachment,
    }] } } }
    const before = await api.store.head()
    await assert.rejects(api.savePanel({ skill: 'smart_questions', state, eventId: 'missing-image' }), /referenced_artifact_invalid/)
    assert.equal(await api.store.head(), before)
    const result = await api.savePanel({ skill: 'smart_questions', state, eventId: 'image-save', artifacts: [{ path: attachment, content: image, encoding: 'base64' }] })
    assert.ok(result.commit)
    assert.equal((await api.readBinaryArtifact({ path: attachment })).base64, image)
    const canonical = await api.readArtifact({ path: 'smart_questions/smart_questions.json' })
    assert.deepEqual(JSON.parse(canonical.content), state)
    assert.ok(!canonical.content.includes(image), 'base64 is transport only, not canonical state')
  } finally { await f.close() }
})


test('closed local instance cannot attach to a different project after the exact port is reused', async () => {
 const prior=await fixture({serverOptions:{browserAccess:'local'}})
 const oldUrl=prior.server.url, port=Number(new URL(oldUrl).port)
 await prior.close()
 const next=await fixture({serverOptions:{browserAccess:'local',port}})
 try {
  assert.equal(next.server.origin,new URL(oldUrl).origin)
  assert.equal((await fetch(oldUrl)).status,410)
  assert.equal((await fetch(next.server.url)).status,200)
  assert.deepEqual(next.messages,[])
 } finally {await next.close()}
})
