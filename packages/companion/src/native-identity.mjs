import { requireThreadId } from './codex-connection.mjs'
import { createHash } from 'node:crypto'

export function nativeInvocationId(host, sessionId, runId) {
  requireThreadId(sessionId)
  requireNativeId(host, runId)
  if (host === 'codex') return runId
  return `${host}-${createHash('sha256').update(JSON.stringify([host, sessionId, runId])).digest('hex')}`
}

export function requireNativeId(host, id) {
  if (host === 'codex') return requireThreadId(id)
  if (!['qoder', 'claude-code', 'qwenwork', 'workbuddy'].includes(host)) throw new Error('Unsupported native host.')
  if (typeof id !== 'string' || !/^[A-Za-z0-9][\w-]{0,127}$/.test(id)) throw new Error(`Exact ${host === 'qoder' ? 'Qoder' : host === 'qwenwork' ? 'QwenWork' : host === 'workbuddy' ? 'WorkBuddy' : 'Claude Code'} native ID required.`)
  return id
}

// Preserve existing Codex filenames; Qoder identities cannot collide with them.
export function nativeScope(host, sessionId) {
  requireThreadId(sessionId)
  if (host === 'codex') return sessionId
  if (['qoder', 'claude-code', 'qwenwork', 'workbuddy'].includes(host)) return `${host}-${sessionId}`
  throw new Error('Unsupported native host.')
}
