/** DSH-only operational timing, not design facts or a general logger export. */
import type { Writable } from 'node:stream'
import { GIT_WORKER_TIMING_FIELDS } from './dsh-git-protocol.ts'

const phases = new Set(['request', 'project-resolved', 'mutation-entered', 'publication-start',
  'commit-accepted', 'journal-settled', 'committed-diff-read', 'handoff-settled', 'returned', 'failed'])
const operations = new Set(['rev-parse', 'cat-file', 'ls-tree', 'ls-files', 'log', 'show', 'diff',
  'read-tree', 'write-tree', 'hash-object', 'update-index', 'commit-tree', 'update-ref', 'status', 'merge-base', 'other',
  'inspect', 'init', 'head', 'ancestor', 'entry', 'tree', 'blob', 'blob-header', 'message', 'latest-marker', 'history',
  'diff-commit', 'diff-between', 'diff-since', 'index-read', 'index-update', 'publish'])
const scopePhases = new Set(['registered-open-start', 'registered-open-end', 'route-start', 'route-selected', 'route-refused',
  'resolve-start', 'resolve-end', 'spawn-start', 'spawn-end', 'ready-start', 'ready-end',
  'close-start', 'close-ack', 'close-end', 'range-start', 'range-end'])
const routes = new Set(['scoped-native', 'host-managed', 'fallback', 'library-thread'])
const reasons = new Set(['non-windows', 'optional-package-missing', 'different-runtime', 'missing-native-api', 'native-api', 'public-api', 'module-import-failed', 'local-library'])
const rangeOutcomes = new Set(['confirmed', 'wait-aborted', 'rejected', 'not-confirmed'])
const gitDurations = ['queueMs', 'preGuardMs', 'requestRttMs', 'postGuardMs', 'totalMs',
  ...GIT_WORKER_TIMING_FIELDS, 'wireParentResidualMs'] as const
const bounds = { maxMs: 15 * 60 * 1000, maxRecords: 5000, maxBytes: 2 * 1024 * 1024 }
const duration = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 0x7fffffff
const exitCode = (value: unknown): boolean => value === null || (Number.isSafeInteger(value) && Number(value) >= -0x80000000 && Number(value) <= 0x7fffffff)
const scopeId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 0x7fffffff

/** Read only own data properties; unrelated fields/getters are never visited. */
function data(record: object, key: string): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value
}

function project(input: unknown): object | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return
  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) return
  const tag = data(input, 'tag'), at = data(input, 'at'), elapsedMs = data(input, 'elapsedMs')
  if (!duration(elapsedMs) || typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)) return
  const date = new Date(at)
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== at) return
  if (tag === 'yugoo-panel-save') {
    const phase = data(input, 'phase')
    if (typeof phase !== 'string' || !phases.has(phase)) return
    const id = data(input, 'scopeId')
    if (id !== undefined && !scopeId(id)) return
    return { tag, phase, at, elapsedMs, ...(id === undefined ? {} : { scopeId: id }) }
  }
  if (tag === 'yugoo-git-scope') {
    const id = data(input, 'scopeId'), phase = data(input, 'phase'), route = data(input, 'route'), reason = data(input, 'reason'), rangeOutcome = data(input, 'rangeOutcome')
    if (!scopeId(id) || typeof phase !== 'string' || !scopePhases.has(phase)) return
    if (route !== undefined && (typeof route !== 'string' || !routes.has(route))) return
    if (reason !== undefined && (typeof reason !== 'string' || !reasons.has(reason))) return
    if (rangeOutcome !== undefined && (typeof rangeOutcome !== 'string' || !rangeOutcomes.has(rangeOutcome))) return
    const extra: Record<string, unknown> = {}
    for (const name of ['completed', 'cancelled', 'rangeConfirmed'] as const) {
      const property = Object.getOwnPropertyDescriptor(input, name)
      if (property !== undefined) {
        if (!('value' in property) || typeof property.value !== 'boolean') return
        extra[name] = property.value
      }
    }
    return { tag, phase, at, elapsedMs, scopeId: id,
      ...(route === undefined ? {} : { route }), ...(reason === undefined ? {} : { reason }),
      ...(rangeOutcome === undefined ? {} : { rangeOutcome }), ...extra }
  }
  if (tag !== 'yugoo-git') return
  const operation = data(input, 'operation'), completed = data(input, 'completed'), cancelled = data(input, 'cancelled')
  if (typeof operation !== 'string' || !operations.has(operation) || typeof completed !== 'boolean' || typeof cancelled !== 'boolean') return
  const spawn = Object.getOwnPropertyDescriptor(input, 'spawnMs'), code = Object.getOwnPropertyDescriptor(input, 'exitCode')
  if (spawn !== undefined && (!('value' in spawn) || !duration(spawn.value))) return
  if (code !== undefined && (!('value' in code) || !exitCode(code.value))) return
  const id = data(input, 'scopeId'), route = data(input, 'route'), sequence = data(input, 'sequence'), extra: Record<string, unknown> = {}
  if (id !== undefined && !scopeId(id)) return
  if (route !== undefined && (typeof route !== 'string' || !routes.has(route))) return
  if (sequence !== undefined && (!Number.isSafeInteger(sequence) || Number(sequence) <= 0 || Number(sequence) > 0xffff_ffff)) return
  for (const name of gitDurations) {
    const property = Object.getOwnPropertyDescriptor(input, name)
    if (property !== undefined) {
      if (!('value' in property) || !duration(property.value)) return
      extra[name] = property.value
    }
  }
  return { tag, operation, at, elapsedMs, completed, cancelled,
    ...(spawn === undefined ? {} : { spawnMs: spawn.value }), ...(code === undefined ? {} : { exitCode: code.value }),
    ...(id === undefined ? {} : { scopeId: id }), ...(route === undefined ? {} : { route }),
    ...(sequence === undefined ? {} : { sequence }), ...extra }
}

/** Internal seam for bounded stream tests; never registers a Host RPC/exporter. */
export function createDshTimingDiagnostics(options: {
  enabled: boolean
  output: Writable
  now?: () => number
  limits?: Partial<typeof bounds>
}): { emit(record: unknown): void; stop(): void } {
  const { output, now = () => performance.now() } = options
  const limits = { ...bounds, ...options.limits }
  let stopped = !options.enabled, started: number | undefined, records = 0, bytes = 0, paused = false, attached = false
  let timer: ReturnType<typeof setTimeout> | undefined
  for (const key of ['maxMs', 'maxRecords', 'maxBytes'] as const) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > bounds[key]) stopped = true
  }
  const stop = (): void => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    output.removeListener('drain', onDrain)
    // A failed write's callback can precede its deferred 'error' event. Keep
    // this one passive guard until close, even after limits/disposal, so late
    // owned I/O errors cannot become uncaught Host errors. Never destroy/end it.
  }
  const onDrain = (): void => { paused = false }
  const onClose = (): void => {
    stop()
    output.removeListener('error', stop)
    output.removeListener('close', onClose)
  }
  const emit = (input: unknown): void => {
    if (stopped) return
    try {
      if (output.destroyed || output.writableEnded || output.writableFinished) { stop(); return }
      const time = now()
      if (!Number.isFinite(time) || (started !== undefined && (time < started || time - started >= limits.maxMs))) { stop(); return }
      if (paused || output.writableNeedDrain) return // Drop; never queue or await diagnostic writes.
      const record = project(input)
      if (record === undefined) return
      const line = JSON.stringify(record) + '\n', size = Buffer.byteLength(line)
      if (records >= limits.maxRecords || bytes + size > limits.maxBytes) { stop(); return }
      if (!attached) {
        output.on('error', stop)
        output.once('close', onClose)
        output.on('drain', onDrain)
        attached = true
        started = time
        timer = setTimeout(stop, limits.maxMs)
        timer.unref()
      }
      records++
      bytes += size
      if (!output.write(line, (error) => { if (error) stop() })) paused = true
      if (records === limits.maxRecords || bytes === limits.maxBytes) stop()
    } catch { stop() } // Malformed records and synchronous I/O must not affect publication.
  }
  return { emit, stop }
}

// Snapshot once at module load: enabling is an explicit dedicated-process
// launch choice, never a persisted setting or an after-boot logger toggle.
// Do not set this in shared environments or stdout-protocol (e.g. MCP) hosts.
const optedIn = process.env.YUGOO_DSH_TIMING_DIAGNOSTICS === '1'
let processTiming: ReturnType<typeof createDshTimingDiagnostics> | undefined
let saveSequence = 0

/** The same startup opt-in and anonymous scope gate the private worker request. */
export function dshWorkerTimingEnabled(id: number | undefined): boolean { return optedIn && scopeId(id) }

/** Process-local anonymous correlation only, never a session/project/user identity. */
export function allocateDshSaveScopeId(): number | undefined {
  if (!optedIn || saveSequence >= 0x7fffffff) return undefined
  return ++saveSequence
}

/** Fixed scalars only; no new logger/transport and no effect on an operation outcome. */
export function emitDshGitScopeTiming(id: number | undefined, phase: string, elapsedMs: number,
  fields: { route?: 'scoped-native' | 'host-managed' | 'fallback' | 'library-thread'; reason?: string; completed?: boolean; cancelled?: boolean; rangeConfirmed?: boolean;
    rangeOutcome?: 'confirmed' | 'wait-aborted' | 'rejected' | 'not-confirmed' } = {}): void {
  if (id === undefined) return
  try { emitDshTimingDiagnostic({ tag: 'yugoo-git-scope', scopeId: id, phase,
    at: new Date().toISOString(), elapsedMs: Math.round(elapsedMs), ...fields }) }
  catch { /* Diagnostic creation must not replace save/cleanup facts. */ }
}

/** Reduce argv to the existing fixed operation vocabulary; never retain arguments. */
export function dshGitOperation(argv: readonly string[]): string {
  return argv[0] === 'git' ? argv.slice(1).find(value => operations.has(value)) ?? 'other' : 'other'
}

/** Best-effort bounded stdout copy of the owned DSH timing record schemas. */
export function emitDshTimingDiagnostic(record: unknown): void {
  if (!optedIn) return
  try {
    processTiming ??= createDshTimingDiagnostics({ enabled: true, output: process.stdout })
    processTiming.emit(record)
  } catch { /* Optional diagnostics cannot affect the Host or save outcome. */ }
}
