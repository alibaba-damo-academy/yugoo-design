/** Private child IPC vocabulary. Never serialize an exception or its free text. */
const names = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'URIError', 'EvalError', 'AggregateError'])
const codes = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED', 'EACCES', 'EPERM', 'ENOENT', 'ENOSPC',
])
// Transformers.js 3.8.1 utils/hub.js: ERROR_MAPPING + handleError. These
// tokens describe library text, not an independently observed HTTP response.
const hubPrefixes = [
  [400, 'Bad request error occurred while trying to load file'],
  [401, 'Unauthorized access to file'], [403, 'Forbidden access to file'], [404, 'Could not locate file'],
  [408, 'Request timeout error occurred while trying to load file'],
  [500, 'Internal server error error occurred while trying to load file'],
  [502, 'Bad gateway error occurred while trying to load file'],
  [503, 'Service unavailable error occurred while trying to load file'],
  [504, 'Gateway timeout error occurred while trying to load file'],
] as const
const hubTokens = new Set<string>(hubPrefixes.map(([status]) => `hf3.8.1-http-${status}`))
interface Diagnostic {
  name?: string; code?: string; causeCode?: string; hubText?: string
  localOnly?: boolean; remoteAllowed?: boolean
}

/** Revalidate at the receiving boundary; unknown keys and values never escape. */
export function readEmbeddingDiagnostic(value: unknown): Diagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const result: Diagnostic = {}, input = value as Record<string, unknown>
  try {
    for (const [key, allowed] of [['name', names], ['code', codes], ['causeCode', codes], ['hubText', hubTokens]] as const) {
      if (!Object.hasOwn(input, key)) continue
      const item = input[key]
      if (typeof item === 'string' && allowed.has(item)) result[key] = item
    }
    for (const key of ['localOnly', 'remoteAllowed'] as const) {
      if (!Object.hasOwn(input, key)) continue
      const item = input[key]
      if (typeof item === 'boolean') result[key] = item
    }
  } catch { /* Unreadable input cannot replace the original failure. */ }
  return Object.keys(result).length ? result : undefined
}

export function captureEmbeddingDiagnostic(error: unknown, phase: string, effective?: unknown): Diagnostic | undefined {
  const result: Diagnostic = {}, policy = readEmbeddingDiagnostic(effective)
  if (policy?.localOnly !== undefined) result.localOnly = policy.localOnly
  if (policy?.remoteAllowed !== undefined) result.remoteAllowed = policy.remoteAllowed
  try {
    const seen = new Set<object>()
    let current = error
    // Three exception objects total, including the outer error; never walk a cycle.
    for (let depth = 0; depth < 3 && current && typeof current === 'object' && !seen.has(current); depth++) {
      seen.add(current)
      const item = current as { name?: unknown; code?: unknown; cause?: unknown; message?: unknown }
      const name = item.name
      if (!depth && typeof name === 'string' && names.has(name)) result.name = name
      const code = item.code
      if (typeof code === 'string' && codes.has(code)) {
        if (!depth) result.code = code
        else result.causeCode ??= code
      }
      const message = item.message
      if (!depth && phase === 'model' && typeof message === 'string' && message.endsWith('".')) {
        const matched = hubPrefixes.find(([, prefix]) => message.startsWith(`${prefix}: "`))
        if (matched) result.hubText = `hf3.8.1-http-${matched[0]}`
      }
      current = item.cause
    }
  } catch { /* Broken getters are not permission to expose a raw error. */ }
  return readEmbeddingDiagnostic(result)
}

/** Closed values keep the suffix below 256 characters, including every field. */
export function embeddingDiagnosticSuffix(value: unknown): string {
  const diagnostic = readEmbeddingDiagnostic(value)
  return diagnostic ? ` [embedding: ${Object.entries(diagnostic).map(([key, item]) => `${key}=${item}`).join('; ')}]` : ''
}
