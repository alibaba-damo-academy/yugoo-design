import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCodexDesktopConnection, desktopRequest } from '../src/codex-desktop-connection.mjs'

const threadId = '00000000-0000-4000-8000-000000000001'
const tool = { namespace: 'codex_app', name: 'send_message_to_thread', inputSchema: { properties: { threadId: {}, prompt: {} } } }
const options = { endpoint: '/private/current.sock', executorThreadId: threadId, platform: 'darwin', uid: 501,
  stat: async () => ({ isSocket: () => true, uid: 501, dev: 1, ino: 2, ctimeMs: 3 }) }
const accepted = () => ({ success: true, contentItems: [{ type: 'inputText', text: JSON.stringify({ threadId }) }] })

test('binds only the current executor and explicit Mac endpoint', () => {
  for (const patch of [{ executorThreadId: undefined }, { executorThreadId: 'another' }, { platform: 'linux' }, { endpoint: '' }, { endpoint: 'relative.sock' }]) {
    assert.throws(() => createCodexDesktopConnection(threadId, { ...options, ...patch }))
  }
  assert.throws(() => createCodexDesktopConnection('latest', options))
})

test('validates admission, sends once to the exact thread, and reports only submission', async () => {
  const calls = []
  const c = createCodexDesktopConnection(threadId, { ...options, request: async (...args) => {
    calls.push(args)
    return args[1] === 'tools/list' ? { tools: [tool] } : accepted()
  } })
  assert.deepEqual(await c.probe(), { status: 'available', capability: 'desktop-message-submission' })
  const receipt = await c.send('Saved design evidence')
  assert.equal(receipt.status, 'submitted_unverified')
  assert.equal(receipt.threadId, threadId)
  assert.deepEqual(calls.map(call => call[1]), ['tools/list', 'tools/call'])
  const params = calls[1][2]
  assert.equal(params.threadId, threadId)
  assert.deepEqual(params.arguments, { threadId, hostId: 'local', prompt: 'Saved design evidence' })
  assert.equal(params.tool, 'send_message_to_thread')
  assert.equal(params.model, undefined)
})

test('missing capability and endpoint replacement cannot submit', async () => {
  const c = createCodexDesktopConnection(threadId, { ...options, request: async () => ({ tools: [] }) })
  await assert.rejects(c.send('hello'), error => error.notSubmitted === true)
  let ino = 2, calls = 0
  const changed = createCodexDesktopConnection(threadId, { ...options,
    stat: async () => ({ isSocket: () => true, uid: 501, dev: 1, ino, ctimeMs: 3 }),
    request: async () => { calls++; return { tools: [tool] } },
  })
  await changed.probe()
  ino++
  await assert.rejects(changed.send('hello'), /ENDPOINT_CHANGED/)
  assert.equal(calls, 1)
  const foreign = createCodexDesktopConnection(threadId, { ...options, stat: async () => ({ isSocket: () => true, uid: 502 }) })
  await assert.rejects(foreign.probe(), /OWNER_MISMATCH/)
})

test('lost, rejected and wrong-thread receipts stay unknown, without replay or payload leaks', async () => {
  for (const result of [null, { success: false }, { success: true, contentItems: [{ type: 'inputText', text: '{"threadId":"another"}' }] }, new Error('SECRET')]) {
    let sends = 0
    const c = createCodexDesktopConnection(threadId, { ...options, request: async (_, method) => {
      if (method === 'tools/list') return { tools: [tool] }
      sends++
      if (result instanceof Error) throw result
      return result
    } })
    await assert.rejects(c.send('PRIVATE_BODY'), error => error.delivery === 'unknown'
      && !JSON.stringify(error).includes('SECRET') && !error.message.includes('PRIVATE_BODY'))
    assert.equal(sends, 1)
  }
})

async function pipe(t, reply) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-pipe-'))
  const endpoint = join(root, 'host.sock')
  const sockets = new Set()
  const server = createServer(socket => {
    sockets.add(socket)
    socket.on('error', () => {})
    socket.once('close', () => sockets.delete(socket))
    let buffer = Buffer.alloc(0)
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < 4 || buffer.length < buffer.readUInt32LE(0) + 4) return
      const request = JSON.parse(buffer.subarray(4).toString())
      reply(socket, request)
    })
  })
  await new Promise(resolve => server.listen(endpoint, resolve))
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })
  return endpoint
}
const frame = value => { const data = Buffer.from(JSON.stringify(value)); const size = Buffer.alloc(4); size.writeUInt32LE(data.length); return Buffer.concat([size, data]) }

test('bounded framing supports fragmented native replies', { skip: process.platform === 'win32' }, async t => {
  const endpoint = await pipe(t, (socket, request) => {
    const bytes = frame({ jsonrpc: '2.0', id: request.id, result: { tools: [tool] } })
    socket.write(bytes.subarray(0, 2))
    setImmediate(() => socket.end(bytes.subarray(2)))
  })
  assert.deepEqual(await desktopRequest(endpoint, 'tools/list', { threadStartKind: 'all' }), { tools: [tool] })
})

test('wrong IDs, disconnect and timeout terminate with bounded sanitized errors', { skip: process.platform === 'win32' }, async t => {
  const wrong = await pipe(t, socket => socket.end(frame({ jsonrpc: '2.0', id: 'wrong', result: {} })))
  await assert.rejects(desktopRequest(wrong, 'tools/list', {}), /RESPONSE_MISMATCH/)
  const closed = await pipe(t, socket => socket.destroy())
  await assert.rejects(desktopRequest(closed, 'tools/list', {}), /PIPE_CLOSED/)
  const quiet = await pipe(t, () => {})
  await assert.rejects(desktopRequest(quiet, 'tools/list', {}, { timeoutMs: 30 }), /TIMEOUT/)
  await assert.rejects(desktopRequest(join(tmpdir(), 'missing-yugoo.sock'), 'tools/list', {}), error => error.notSubmitted === true)
})
