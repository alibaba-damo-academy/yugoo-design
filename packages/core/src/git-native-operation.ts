/** Host-neutral structured operation validation. No transport or Git implementation. */
import type { NativeGitOperation } from './git-native-contract.ts'

/** Structured operations stay distinct from CLI argv and carry no executable code. */
export function nativeGitOperation(value: unknown): NativeGitOperation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('design git: invalid native operation')
  const operation = value as Record<string, unknown>
  const text = (name: string): boolean => typeof operation[name] === 'string'
  const commit = (name: string): boolean => text(name) && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(operation[name] as string)
  const optionalText = (name: string): boolean => operation[name] === undefined || text(name)
  const scope = (): boolean => optionalText('pathPrefix') && optionalText('path')
  const indexBytes = (): boolean => operation.bytes === undefined || operation.bytes === null
    || (typeof operation.bytes === 'string' && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(operation.bytes))
  switch (operation.kind) {
    case 'head':
    case 'inspect':
    case 'init': break
    case 'ancestor':
      if (commit('ancestor') && commit('descendant')) break
      throw new Error('design git: invalid native ancestry request')
    case 'status':
      if (operation.pathPrefix === undefined || text('pathPrefix')) break
      throw new Error('design git: invalid native status request')
    case 'entry':
      if (commit('commit') && text('path')) break
      throw new Error('design git: invalid native tree entry request')
    case 'tree':
      if (commit('commit') && scope() && (operation.maxBytes === undefined || (Number.isSafeInteger(operation.maxBytes) && Number(operation.maxBytes) >= 0))) break
      throw new Error('design git: invalid native commit request')
    case 'blob':
      if (commit('oid') && Number.isSafeInteger(operation.size) && Number(operation.size) >= 0) break
      throw new Error('design git: invalid native blob request')
    case 'blob-header':
      if (commit('oid')) break
      throw new Error('design git: invalid native object header request')
    case 'message':
    case 'diff-commit':
      if (commit('commit') && scope()) break
      throw new Error('design git: invalid native commit projection request')
    case 'latest-marker':
      if (commit('from') && text('marker') && operation.marker !== '' && !/[\r\n\0]/u.test(operation.marker as string)) break
      throw new Error('design git: invalid native marker request')
    case 'history':
      if (Number.isSafeInteger(operation.limit) && Number(operation.limit) > 0 && scope()
        && (operation.from === undefined || commit('from'))
        && (operation.offset === undefined || (Number.isSafeInteger(operation.offset) && Number(operation.offset) >= 0))) break
      throw new Error('design git: invalid native history request')
    case 'diff-between':
      if (commit('from') && commit('to') && scope()) break
      throw new Error('design git: invalid native diff request')
    case 'diff-since':
      if (optionalText('baseline') && scope()) break
      throw new Error('design git: invalid native baseline diff request')
    case 'index-read':
      if (indexBytes() && Array.isArray(operation.paths) && operation.paths.every(path => typeof path === 'string')) break
      throw new Error('design git: invalid native index read request')
    case 'index-update':
      if (indexBytes() && operation.bytes !== null && Array.isArray(operation.updates) && operation.updates.every(value => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
        const entry = value as Record<string, unknown>
        return typeof entry.path === 'string' && (entry.oid === undefined ? entry.mode === undefined
          : typeof entry.oid === 'string' && /^[0-9a-f]{40}$/u.test(entry.oid) && (entry.mode === 0o100644 || entry.mode === 0o100755))
      })) break
      throw new Error('design git: invalid native index update request')
    case 'publish': {
      if ((operation.expectedHead !== undefined && !commit('expectedHead')) || !text('message') || !text('stagingRoot')
        || (operation.forceCommit !== undefined && typeof operation.forceCommit !== 'boolean') || !Array.isArray(operation.files)
        || !operation.files.every(value => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
          const file = value as Record<string, unknown>
          return typeof file.path === 'string' && (file.mode === 0o100644 || file.mode === 0o100755)
            && (file.source === undefined
              ? file.oid === undefined
              : typeof file.source === 'string' && typeof file.oid === 'string' && /^[0-9a-f]{40}$/u.test(file.oid))
        })) throw new Error('design git: invalid native publication request')
      break
    }
    default: throw new Error('design git: invalid native operation')
  }
  return operation as unknown as NativeGitOperation
}

const NATIVE_GIT_FAILURES = new Set(['invalid-request', 'unsupported-object-format', 'unsupported-history', 'commit-not-found',
  'stale-publication', 'native-unavailable', 'native-operation-failed'])

/** Exception details, paths and arbitrary native text never cross this channel. */
export function nativeGitFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = Object.getOwnPropertyDescriptor(error, 'code')
    if (code !== undefined && 'value' in code && NATIVE_GIT_FAILURES.has(code.value)) return code.value as string
  }
  return 'native-operation-failed'
}

export function isNativeGitFailure(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_GIT_FAILURES.has(value)
}
