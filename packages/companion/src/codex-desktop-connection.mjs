/** Opt-in adapter for the installed macOS Codex desktop tool bridge.
 * This is version-bound host capability, not the Codex CLI app-server protocol.
 * Run with the desktop's bundled Node; never discover sockets or bypass admission.
 */
import { lstat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { requireThreadId } from './codex-connection.mjs'
import { unknownDeliveryError } from './notification-delivery.mjs'

const LIMIT = 8 * 1024 * 1024
const SEND = 'send_message_to_thread'
const fail = (code, extra = {}) => Object.assign(new Error(code), extra)

// One bounded request. Raw host errors, endpoint paths and message bodies never
// enter public errors. A write followed by a lost receipt cannot be retried.
export function desktopRequest(endpoint, method, params, { timeoutMs = 6000 } = {}) {
  const id = randomUUID()
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  if (body.length > LIMIT) return Promise.reject(fail('CODEX_DESKTOP_FRAME_TOO_LARGE', { notSubmitted: true }))
  const header = Buffer.alloc(4)
  header.writeUInt32LE(body.length)
  return new Promise((resolve, reject) => {
    let written = false, done = false, buffer = Buffer.alloc(0)
    const socket = createConnection(endpoint)
    const finish = (code, result, category = 'protocol') => {
      if (done) return
      done = true
      clearTimeout(timer)
      socket.destroy()
      if (code) reject(fail(code, { notSubmitted: !written, transportCategory: category }))
      else resolve(result)
    }
    const timer = setTimeout(() => finish('CODEX_DESKTOP_TIMEOUT', undefined, 'timeout'), timeoutMs)
    socket.on('error', () => finish('CODEX_DESKTOP_CONNECTION_FAILED', undefined, 'disconnected'))
    socket.on('close', () => finish('CODEX_DESKTOP_PIPE_CLOSED', undefined, 'disconnected'))
    socket.on('connect', () => {
      written = true
      socket.write(Buffer.concat([header, body]))
    })
    socket.on('data', chunk => {
      if (buffer.length + chunk.length > LIMIT + 4) return finish('CODEX_DESKTOP_FRAME_TOO_LARGE')
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length < 4) return
      const length = buffer.readUInt32LE(0)
      if (length > LIMIT || !length) return finish('CODEX_DESKTOP_FRAME_TOO_LARGE')
      if (buffer.length < length + 4) return
      if (buffer.length !== length + 4) return finish('CODEX_DESKTOP_INVALID_RESPONSE')
      let response
      try { response = JSON.parse(buffer.subarray(4).toString()) }
      catch { return finish('CODEX_DESKTOP_INVALID_RESPONSE') }
      if (response?.jsonrpc !== '2.0' || response.id !== id) return finish('CODEX_DESKTOP_RESPONSE_MISMATCH')
      if (response.error) return finish('CODEX_DESKTOP_RPC_REJECTED', undefined, 'rpc-rejected')
      finish(undefined, response.result)
    })
  })
}

export function createCodexDesktopConnection(threadId, {
  endpoint = process.env.CODEX_APP_TOOLS_PIPE_PATH,
  executorThreadId = process.env.CODEX_THREAD_ID,
  platform = process.platform,
  uid = process.getuid?.(),
  stat = lstat,
  request = desktopRequest,
} = {}) {
  requireThreadId(threadId)
  if (platform !== 'darwin') throw fail('CODEX_DESKTOP_MACOS_REQUIRED', { notSubmitted: true })
  if (threadId !== executorThreadId) throw fail('CODEX_DESKTOP_EXECUTOR_THREAD_MISMATCH', { notSubmitted: true })
  if (typeof endpoint !== 'string' || !isAbsolute(endpoint) || /[\r\n\0]/.test(endpoint)) {
    throw fail('CODEX_DESKTOP_ENDPOINT_REQUIRED', { notSubmitted: true })
  }
  let identity, capable = false
  const verifyEndpoint = async () => {
    let entry
    try { entry = await stat(endpoint) }
    catch { throw fail('CODEX_DESKTOP_ENDPOINT_UNAVAILABLE', { notSubmitted: true }) }
    if (!entry.isSocket() || entry.uid !== uid || uid === undefined) throw fail('CODEX_DESKTOP_ENDPOINT_OWNER_MISMATCH', { notSubmitted: true })
    const current = `${entry.dev}:${entry.ino}:${entry.ctimeMs}`
    if (identity && identity !== current) throw fail('CODEX_DESKTOP_ENDPOINT_CHANGED', { notSubmitted: true })
    identity = current
  }
  const probe = async () => {
    await verifyEndpoint()
    if (!capable) {
      let result
      try { result = await request(endpoint, 'tools/list', { threadStartKind: 'all' }) }
      catch (error) { throw fail(error.message, { notSubmitted: true }) }
      const tool = result?.tools?.find(tool => tool.namespace === 'codex_app' && tool.name === SEND)
      if (!tool?.inputSchema?.properties?.threadId || !tool.inputSchema.properties.prompt) {
        throw fail('CODEX_DESKTOP_SEND_TOOL_UNAVAILABLE', { notSubmitted: true })
      }
      capable = true
    }
    return { status: 'available', capability: 'desktop-message-submission' }
  }
  return {
    host: 'codex', threadId, inputMode: 'desktop', probe,
    async send(text) {
      if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 128 * 1024) {
        throw fail('CODEX_DESKTOP_MESSAGE_INVALID', { notSubmitted: true })
      }
      await probe()
      const messageId = randomUUID()
      let result
      try {
        result = await request(endpoint, 'tools/call', {
          namespace: 'codex_app', tool: SEND, callerSource: 'codex', threadId,
          // Correlation ids use the installed bridge's fallback format. These
          // are not fabricated native turn identities or authorization tokens.
          callId: `mcp-call-${messageId}`, turnId: `mcp-turn-${messageId}`,
          arguments: { threadId, hostId: 'local', prompt: text },
        }, { timeoutMs: 20000 })
        const content = result?.contentItems?.find(item => item.type === 'inputText')?.text
        let receipt
        try { receipt = JSON.parse(content) } catch {}
        if (result?.success !== true || receipt?.threadId !== threadId) {
          throw fail('CODEX_DESKTOP_RECEIPT_UNCONFIRMED', { transportCategory: 'invalid-response' })
        }
      } catch (error) {
        if (error?.notSubmitted === true) throw error
        throw unknownDeliveryError({ clientUserMessageId: messageId, transportCategory: error?.transportCategory })
      }
      return { accepted: true, status: 'submitted_unverified', threadId, messageId }
    },
  }
}
