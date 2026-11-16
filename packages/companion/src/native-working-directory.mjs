/** Native working directories are execution context, not conversation identity.
 * Only native record metadata can establish a later cwd; message content cannot.
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

const LIMIT = 32 * 1024 * 1024
const hosts = new Set(['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy'])
const sdkTypes = new Set(['user', 'assistant', 'system', 'attachment'])
const buddyTypes = new Set(['message', 'function_call', 'function_call_result'])

export function requireRecordedCwd(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || /[\r\n\0]/u.test(cwd)) throw Error('Invalid native working directory metadata.')
  return cwd
}

// An old workspace may have been removed without removing its Design Project.
// Historical metadata remains comparable; the current execution cwd must exist.
export async function recordedCwd(cwd) {
  requireRecordedCwd(cwd)
  try { return await realpath(cwd) }
  catch (error) { if (error.code === 'ENOENT') return resolve(cwd); throw error }
}

export function latestNativeCwd(records, { host, sessionId, agentId }) {
  if (!hosts.has(host)) throw Error('Unsupported native working directory record format.')
  let cwd
  for (const event of records) {
    if (host === 'codex') {
      if (event.type === 'turn_context' && typeof event.payload?.turn_id === 'string' && event.payload.turn_id) cwd = requireRecordedCwd(event.payload.cwd)
      continue
    }
    const types = host === 'workbuddy' ? buddyTypes : sdkTypes
    if (!types.has(event.type)) continue
    if (event.sessionId !== sessionId) throw Error('Native working directory session identity mismatch.')
    if (host !== 'workbuddy' && (event.agentId ?? undefined) !== agentId) continue
    if (event.cwd !== undefined) cwd = requireRecordedCwd(event.cwd)
  }
  return cwd
}

async function currentNativeCwd(file, options) {
  const stat = await file.stat()
  let length = Math.min(4096, stat.size)
  for (;;) {
    const start = stat.size - length
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start)
    let text = bytes.subarray(0, bytesRead).toString('utf8')
    if (start) text = text.slice(text.indexOf('\n') + 1)
    // Only complete native records in this bounded snapshot are evidence.
    const records = text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(line => JSON.parse(line))
    const cwd = latestNativeCwd(records, options)
    if (cwd !== undefined) return cwd
    if (!start) return undefined
    if (length === LIMIT) throw Object.assign(Error('Current native context is outside the bounded lookup.'), { code: 'NATIVE_TRANSCRIPT_CONTEXT_UNAVAILABLE' })
    length = Math.min(LIMIT, stat.size, length * 4)
  }
}

export async function verifyNativeWorkingDirectory(file, { host, sessionId, agentId, initialCwd, expectedCwd }) {
  // The owning adapter verifies this file's session/parent before calling here.
  if (!hosts.has(host)) throw Error('Unsupported native working directory record format.')
  const expected = await realpath(expectedCwd)
  requireRecordedCwd(initialCwd)
  const current = await currentNativeCwd(file, { host, sessionId, agentId })
  if (await recordedCwd(current ?? initialCwd) === expected) return
  throw Object.assign(Error('Native transcript cwd mismatch: no matching current native context.'), { code: 'NATIVE_TRANSCRIPT_CWD_MISMATCH' })
}

export async function verifyNativeRecordWorkingDirectory(records, options) {
  const cwd = latestNativeCwd(records, options)
  if (!cwd || await recordedCwd(cwd) !== await realpath(options.expectedCwd)) throw Error('Native transcript cwd mismatch.')
}
