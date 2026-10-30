/** Transport only: never starts a second model or edits a Codex transcript. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Duplex } from 'node:stream'
import { unknownDeliveryError, notificationSetupError } from './notification-delivery.mjs'

export function requireThreadId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('An exact Codex thread UUID is required; session names are not a safe binding.')
  }
  return value
}

export function createCodexConnection(threadId, connect = openNativeConnection, { remote } = {}) {
  requireThreadId(threadId)
  if (remote !== undefined && (typeof remote !== 'string' || !remote.startsWith('unix:///') || remote.length <= 8 || /[\r\n\0]/.test(remote))) {
    throw new Error('Codex remote must be an explicit unix:///absolute/socket path.')
  }
  async function initializeConnection() {
    let client
    let stage = 'proxy-connect'
    try {
      client = await connect(['app-server', 'proxy',
        ...(remote === undefined ? [] : ['--sock', remote.slice('unix://'.length)])])
      stage = 'initialize'
      await client.request('initialize', { clientInfo: { name: 'design_companion', version: '0.1.0' }, capabilities: { experimentalApi: true } })
      client.notify('initialized', {})
      return client
    } catch (error) {
      // No queue call exists in setup. Preserve only our allowlisted handshake
      // stage; raw child/RPC errors must never reach a browser or CLI receipt.
      try { await client?.close() } catch { /* Keep the setup failure. */ }
      throw notificationSetupError({ stage: stage === 'proxy-connect' && error?.stage === 'websocket-handshake' ? error.stage : stage,
        transportCategory: error?.transportCategory, rpcCode: error?.rpcCode })
    }
  }
  return {
    threadId,
    async probe() {
      const client = await initializeConnection()
      try {
        const value = await client.request('thread/read', { threadId, includeTurns: false })
        // This verifies exact native thread/API reachability, not TUI liveness
        // or execution. A notLoaded proxy view must not resume the user's TUI.
        return { status: value?.thread?.id === threadId ? 'available' : 'unknown' }
      } finally { await client.close() }
    },
    async send(text) {
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 128 * 1024) {
        throw new Error('Codex message must contain 1–131072 bytes.')
      }
      const client = await initializeConnection()
      let addAttempted = false
      let queuedSubmissionId
      const clientUserMessageId = randomUUID()
      const stage = 'queue-add'
      const lastConfirmed = 'initialized'
      try {
        // Match the native `codex queue` primitive. A regular local TUI owns its
        // runtime separately and consumes the durable queue; the proxy can read
        // that same thread as notLoaded. That is not an admission failure.
        // Never resume it or start a turn in this transport's app server.
        addAttempted = true
        const added = await client.request('thread/queue/add', {
          threadId, clientUserMessageId, input: [{ type: 'text', text, text_elements: [] }],
        })
        queuedSubmissionId = added.queuedSubmission?.id
        if (typeof queuedSubmissionId !== 'string' || !queuedSubmissionId) throw Object.assign(new Error('Missing queued submission ID.'), { transportCategory: 'invalid-response' })
        // Acceptance is durable queue insertion only. The original host owns
        // execution, approvals, errors and completion; an offline host may not
        // consume this yet. Unknown delivery is never retried automatically.
        return { accepted: true, threadId, queuedSubmissionId, status: 'queued' }
      } catch (error) {
        if (addAttempted) {
          throw unknownDeliveryError({ stage, lastConfirmed, clientUserMessageId, queuedSubmissionId,
            transportCategory: error?.transportCategory, rpcCode: error?.rpcCode })
        }
        throw error
      } finally { await client.close() }
    },
  }
}

// Standard WebSocket framing over the native proxy; no daemon path discovery,
// credentials, provider overrides, transcript edits, or second model process.
export async function openNativeConnection(args, { WebSocket, spawnProxy = spawn, timeoutMs = 15000 } = {}) {
  WebSocket ??= (await import('ws')).default
  let child
  try { child = spawnProxy('codex', args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }) }
  catch { throw notificationSetupError({ stage: 'proxy-connect', transportCategory: 'disconnected' }) }
  child.stderr.resume() // Never forward server credentials or notification bodies.
  const stream = Duplex.from({ readable: child.stdout, writable: child.stdin })
  let socket
  let opened = false
  const pending = new Map()
  let nextId = 0
  let failure
  let timer
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    socket?.terminate()
    stream.destroy()
    child.stdin.destroy()
    child.stdout.destroy()
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM') // Only our proxy, never its server.
      const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }, 1000)
      force.unref()
      child.once('exit', () => clearTimeout(force))
    }
  }
  const fail = (category, stage = 'websocket-handshake') => {
    const transportCategory = ['timeout', 'protocol', 'send-failed'].includes(category) ? category : 'disconnected'
    failure ??= opened ? Object.assign(new Error('Codex native notification transport disconnected or timed out.'), { transportCategory })
      : notificationSetupError({ stage, transportCategory })
    for (const waiter of pending.values()) waiter.reject(failure)
    pending.clear()
    dispose()
  }
  // Suppress raw error details: they can contain bodies or private server data.
  child.on('error', () => fail('disconnected', 'proxy-connect'))
  child.on('exit', () => fail('disconnected', 'proxy-connect'))
  stream.on('error', () => fail('disconnected', 'proxy-connect'))
  timer = setTimeout(() => fail('timeout'), timeoutMs)
  try {
    socket = new WebSocket('ws://localhost/', { createConnection: () => stream, perMessageDeflate: false, maxPayload: 1024 * 1024 })
    socket.on('error', () => fail('disconnected'))
    socket.on('close', () => fail('disconnected'))
    socket.on('message', bytes => {
      let response
      try { response = JSON.parse(bytes.toString()) } catch { fail('protocol'); return }
      if (!Object.hasOwn(response, 'id') || !pending.has(response.id)) return
      const waiter = pending.get(response.id)
      pending.delete(response.id)
      if (response.error) waiter.reject(Object.assign(new Error('Codex native notification request was rejected.'), {
        transportCategory: 'rpc-rejected',
        ...(Number.isInteger(response.error.code) && response.error.code >= -2147483648 && response.error.code <= 2147483647 ? { rpcCode: response.error.code } : {}),
      }))
      else waiter.resolve(response.result)
    })
    await new Promise((resolve, reject) => {
      pending.set('open', { reject })
      socket.once('open', () => { opened = true; pending.delete('open'); resolve() })
    })
    return {
      request(method, params) {
        if (failure || disposed) return Promise.reject(failure ?? new Error('Codex native connection closed.'))
        return new Promise((resolve, reject) => {
          const id = ++nextId
          pending.set(id, { resolve, reject })
          try { socket.send(JSON.stringify({ id, method, params })) } catch { fail('send-failed') }
        })
      },
      notify(method, params) {
        if (failure || disposed) throw failure ?? new Error('Codex native connection closed.')
        socket.send(JSON.stringify({ method, params }))
      },
      close() { dispose() },
    }
  } catch {
    failure ??= notificationSetupError({ stage: 'websocket-handshake', transportCategory: 'disconnected' })
    dispose()
    throw failure
  }
}
