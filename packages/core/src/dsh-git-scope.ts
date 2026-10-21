/** DSH-local optimization of one store's SpawnFn; never a publication owner. */
import { fileURLToPath } from 'node:url'
import type { Duplex } from 'node:stream'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { gitBackendSetting } from './git.ts'
import type { NativeGitRequest, SpawnFn } from './git.ts'
import type { NativeGitResult } from './git-native-contract.ts'
import { gitMessage, gitWorkerTiming, isNativeGitFailure, nativeGitOperation, readGitFrames, writeGitFrame } from './dsh-git-protocol.ts'
import type { GitWorkerTiming } from './dsh-git-protocol.ts'
import { DshLibraryGitScope } from './dsh-library-git-scope.ts'
import { dshGitOperation, dshWorkerTimingEnabled, emitDshGitScopeTiming, emitDshTimingDiagnostic } from './dsh-timing-diagnostics.ts'

type GitRequest = Parameters<SpawnFn>[0]
type GitResult = Awaited<ReturnType<SpawnFn>>
type Pending = {
  id: number; output: Buffer[]; size: number; timingRequested: boolean; workerTiming?: GitWorkerTiming
} & ({ kind: 'cli'; request: GitRequest; result: ReturnType<typeof deferred<GitResult>> }
  | { kind: 'native'; request: NativeGitRequest; result: ReturnType<typeof deferred<NativeGitResult>> })
type NativeRuntime = SubprocessRuntime & {
  spawnNativeContained(spec: SubprocessSpawnSpec): SubprocessHandle & { readonly containment: 'linux-scope' | 'windows-job' }
}
type ManagedGitRoute = 'scoped-native' | 'host-managed'

function hasStrictNativeSpawn(runtime: SubprocessRuntime): runtime is NativeRuntime {
  return 'spawnNativeContained' in runtime && typeof runtime.spawnNativeContained === 'function'
}

/** Merge anew for every Git call, rather than inheriting the worker's launch env. */
export function gitChildEnvironment(
  overrides?: Readonly<NodeJS.ProcessEnv>,
  base: Readonly<NodeJS.ProcessEnv> = scrubbedParentEnv(),
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  let entries = Object.entries(base)
  for (const [key, value] of Object.entries(overrides ?? {})) {
    entries = entries.filter(([name]) => platform === 'win32' ? name.toUpperCase() !== key.toUpperCase() : name !== key)
    entries.push([key, value])
  }
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== undefined))
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  // Exit/abort may arrive before the caller starts awaiting a specific stage.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

/** The caller's abort signal is never the bound for cleanup observation. */
async function cleanupWait<T>(pending: Promise<T>, signal: AbortSignal, stage: string): Promise<T> {
  const expired = deferred<T>()
  const onAbort = (): void => expired.reject(new Error(`design git: ${stage} timed out`))
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  try { return await Promise.race([pending, expired.promise]) }
  finally { signal.removeEventListener('abort', onAbort) }
}

async function observeRange(handle: SubprocessHandle, signal: AbortSignal, callerSignal: AbortSignal, scopeId?: number,
  route: ManagedGitRoute = 'scoped-native'): Promise<void> {
  const started = performance.now()
  let rangeOutcome: 'confirmed' | 'wait-aborted' | 'rejected' | 'not-confirmed' | undefined
  emitDshGitScopeTiming(scopeId, 'range-start', 0, { route })
  try {
    const exited = await cleanupWait(Promise.resolve().then(() => handle.waitForExit(signal)), signal, 'worker range')
    rangeOutcome = exited === true ? 'confirmed' : signal.aborted ? 'wait-aborted' : 'not-confirmed'
    if (exited !== true) throw new Error('design git: worker range exit was not confirmed')
  } catch (error) { rangeOutcome ??= signal.aborted ? 'wait-aborted' : 'rejected'; throw error }
  finally {
    const rangeConfirmed = rangeOutcome === 'confirmed'
    emitDshGitScopeTiming(scopeId, 'range-end', performance.now() - started,
      { route, completed: rangeConfirmed, rangeConfirmed, rangeOutcome, cancelled: callerSignal.aborted })
  }
}

/** One managed handle, one channel and at most one executing Git command. */
export class DshGitScope {
  private active = true
  private stopped?: { readonly reason: unknown }
  private tail: Promise<unknown> = Promise.resolve()
  private sequence = 0
  private readonly ready = deferred<void>()
  private readonly closed = deferred<void>()
  private readonly interrupted = deferred<never>()
  private pending?: Pending
  private closePromise?: Promise<void>
  private readonly channel: Duplex
  private readonly onAbort: () => void

  constructor(
    private readonly handle: SubprocessHandle,
    private readonly root: string,
    private readonly signal: AbortSignal,
    private readonly assertScope: () => Promise<void>,
    private readonly cleanupMs = 15_000,
    private readonly scopeId?: number,
    private readonly route: ManagedGitRoute = 'scoped-native',
  ) {
    if (handle.control === undefined) {
      handle.terminate()
      throw new Error('design git: native worker has no control channel')
    }
    this.channel = handle.control
    this.onAbort = () => this.stop(signal.reason)
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.onAbort()
    void this.read().catch(error => this.stop(error))
    void handle.done.then(() => {
      if (this.active || this.pending !== undefined) this.stop(new Error('design git: worker exited before settlement'))
    }, error => this.stop(error))
  }

  async start(): Promise<void> {
    const started = performance.now()
    emitDshGitScopeTiming(this.scopeId, 'ready-start', 0, { route: this.route })
    let completed = false
    try { await this.withDeadline(this.ready.promise, 'worker startup'); completed = true }
    finally { emitDshGitScopeTiming(this.scopeId, 'ready-end', performance.now() - started,
      { route: this.route, completed, cancelled: this.signal.aborted }) }
  }

  readonly spawn: SpawnFn = Object.assign((request: GitRequest) => {
    const started = performance.now(), timings: Record<string, number> = {}
    let completed = false, exitCode: number | null | undefined, sequence: number | undefined
    const trace = (): void => {
      if (this.scopeId === undefined) return
      try {
        const elapsedMs = Math.round(performance.now() - started)
        emitDshTimingDiagnostic({ tag: 'yugoo-git', scopeId: this.scopeId, route: this.route,
          operation: dshGitOperation(request.argv), at: new Date().toISOString(), elapsedMs, totalMs: elapsedMs,
          ...timings, completed, cancelled: this.signal.aborted || request.signal?.aborted === true,
          ...(sequence === undefined ? {} : { sequence }),
          ...(exitCode === undefined ? {} : { exitCode }) })
      } catch { /* Operational diagnostics never change Git or authorization results. */ }
    }
    if (!this.active) { trace(); return Promise.reject(new Error('design git: save scope has ended')) }
    // Backpressure is applied before encoding/sending. Concurrent GitVersioning
    // reads retain distinct promises and preserve submission order.
    const execution = this.tail.then(async () => {
      timings.queueMs = Math.round(performance.now() - started)
      try {
        if (this.stopped !== undefined) throw this.stopped.reason
        if (!this.active) throw new Error('design git: save scope has ended')
        request.signal?.throwIfAborted()
        const preGuardStarted = performance.now()
        try { await this.assertScope() }
        finally { timings.preGuardMs = Math.round(performance.now() - preGuardStarted) }
        if (request.cwd !== this.root || request.argv[0] !== 'git') throw new Error('design git: command escaped its save repository')
        if (++this.sequence > 0xffff_ffff) throw new Error('design git: worker request sequence exhausted')
        sequence = this.sequence // The existing wire id, not another telemetry counter.
        const result = deferred<GitResult>()
        const timingRequested = dshWorkerTimingEnabled(this.scopeId)
        this.pending = { kind: 'cli', id: this.sequence, request, result, output: [], size: 0, timingRequested }
        const onAbort = (): void => this.stop(request.signal?.reason)
        request.signal?.addEventListener('abort', onAbort, { once: true })
        try {
          request.signal?.throwIfAborted()
          // Includes wire write, worker wall time and response read; never Git CPU.
          const requestStarted = performance.now()
          let value: GitResult
          try {
            await writeGitFrame(this.channel, {
              type: 'run', id: this.sequence, argv: request.argv, cwd: request.cwd,
              env: gitChildEnvironment(request.env),
              ...(request.binaryStdout === undefined ? {} : { binaryMax: request.binaryStdout.maxBytes }),
              ...(timingRequested ? { timing: true } : {}),
            })
            value = await result.promise
            exitCode = value.exitCode
          } finally {
            timings.requestRttMs = Math.round(performance.now() - requestStarted)
            const worker = this.pending?.workerTiming
            if (worker !== undefined) {
              Object.assign(timings, worker)
              const until = worker.workerUntilReplyStartMs!
              // Both are durations, not cross-process clock subtraction or Git CPU.
              // The remainder includes reply encoding/wire and parent scheduling/decoding.
              const residual = timings.requestRttMs - until
              if (Number.isSafeInteger(residual) && residual >= 0 && residual <= 0x7fffffff) timings.wireParentResidualMs = residual
            }
          }
          const postGuardStarted = performance.now()
          try { await this.assertScope() }
          finally { timings.postGuardMs = Math.round(performance.now() - postGuardStarted) }
          completed = true
          return value
        } catch (error) {
          this.stop(error)
          throw error
        } finally {
          request.signal?.removeEventListener('abort', onAbort)
          this.pending = undefined
        }
      } finally { trace() }
    })
    this.tail = execution.catch(() => {})
    return execution
  }, { native: (request: NativeGitRequest) => this.nativeSpawn(request) })

  /** Use the same managed worker, FIFO and authority guards without emulating argv. */
  private readonly nativeSpawn = (request: NativeGitRequest): Promise<NativeGitResult> => {
    if (!this.active) return Promise.reject(new Error('design git: save scope has ended'))
    const execution = this.tail.then(async () => {
      if (this.stopped !== undefined) throw this.stopped.reason
      if (!this.active) throw new Error('design git: save scope has ended')
      request.signal?.throwIfAborted()
      await this.assertScope()
      if (request.cwd !== this.root) throw new Error('design git: native operation escaped its save repository')
      const operation = nativeGitOperation(request.operation)
      if (++this.sequence > 0xffff_ffff) throw new Error('design git: worker request sequence exhausted')
      const result = deferred<NativeGitResult>()
      this.pending = { kind: 'native', id: this.sequence, request, result, output: [], size: 0, timingRequested: false }
      const onAbort = (): void => this.stop(request.signal?.reason)
      request.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        request.signal?.throwIfAborted()
        await writeGitFrame(this.channel, { type: 'native', id: this.sequence, cwd: request.cwd, operation })
        const value = await result.promise
        try {
          request.signal?.throwIfAborted()
          await this.assertScope()
        } catch (error) {
          this.stop(error)
          const receipt = value.value
          // A confirmed HEAD CAS remains a committed fact even when the local
          // authorization ends before the caller can maintain its index.
          if (operation.kind === 'publish' && typeof receipt === 'object' && receipt !== null
            && !Array.isArray(receipt) && 'commit' in receipt && typeof receipt.commit === 'string'
            && /^[0-9a-f]{40}$/u.test(receipt.commit) && 'change' in receipt
            && (receipt.change === 'changed' || receipt.change === 'unchanged')) {
            return { ...value, publicationScopeInvalidated: true as const }
          }
          throw error
        }
        return value
      } catch (error) { this.stop(error); throw error }
      finally { request.signal?.removeEventListener('abort', onAbort); this.pending = undefined }
    })
    this.tail = execution.catch(() => {})
    return execution
  }

  stop(reason?: unknown): void {
    this.active = false
    this.stopped ??= { reason: arguments.length === 0 ? new Error('design git: worker stopped') : reason }
    this.ready.reject(this.stopped.reason)
    this.closed.reject(this.stopped.reason)
    this.interrupted.reject(this.stopped.reason)
    this.pending?.result.reject(this.stopped.reason)
    this.handle.terminate()
    this.channel.destroy()
  }

  /** End admission immediately and join the provider's range independently of operation abort. */
  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    this.active = false
    this.closePromise = this.finish()
    return this.closePromise
  }

  private async finish(): Promise<void> {
    const started = performance.now(), deadline = started + this.cleanupMs
    emitDshGitScopeTiming(this.scopeId, 'close-start', 0, { route: this.route })
    let completed = false
    try {
      let failure: { reason: unknown } | undefined
      if (this.stopped === undefined) {
        // One total bound: half for graceful drain/ACK/direct+range observation,
        // reserving the other half for the provider's existing termination escalation.
        const grace = new AbortController()
        const timer = setTimeout(() => grace.abort(), Math.max(0, Math.floor(this.cleanupMs / 2)))
        let range: Promise<void> | undefined
        try {
          await cleanupWait(this.tail, grace.signal, 'worker drain')
          await cleanupWait(writeGitFrame(this.channel, { type: 'close' }), grace.signal, 'worker close')
          await cleanupWait(this.closed.promise, grace.signal, 'worker close')
          emitDshGitScopeTiming(this.scopeId, 'close-ack', performance.now() - started, { route: this.route })
          this.channel.end()
          const direct = this.handle.done.then(outcome => {
            if (outcome.exitCode !== 0 || outcome.signal !== null) throw new Error('design git: worker exited abnormally during close')
          })
          range = observeRange(this.handle, grace.signal, this.signal, this.scopeId, this.route)
          // Observe both concurrently. A direct result/ACK cannot certify the range.
          await cleanupWait(Promise.race([Promise.all([direct, range]), this.interrupted.promise]), grace.signal, 'worker exit')
        } catch (error) { failure = { reason: error }; this.stop(error) }
        finally {
          clearTimeout(timer); if (failure !== undefined) grace.abort()
          // Our own abort race settles this observer even if a provider ignores its signal.
          await range?.catch(() => {})
        }
      }
      if (this.stopped !== undefined) {
        this.handle.terminate()
        // Fresh independent wait after escalation, within the original total deadline.
        const forced = new AbortController()
        const timer = setTimeout(() => forced.abort(), Math.max(0, Math.floor(deadline - performance.now())))
        try { await observeRange(this.handle, forced.signal, this.signal, this.scopeId, this.route) }
        catch (error) { failure ??= { reason: error } }
        finally { clearTimeout(timer) }
      }
      if (failure !== undefined) throw failure.reason
      completed = true
    } finally {
      this.signal.removeEventListener('abort', this.onAbort)
      this.channel.destroy()
      emitDshGitScopeTiming(this.scopeId, 'close-end', performance.now() - started,
        { route: this.route, completed, cancelled: this.signal.aborted })
    }
  }

  private async withDeadline<T>(pending: Promise<T>, stage: string): Promise<T> {
    const signal = AbortSignal.timeout(this.cleanupMs)
    const expired = deferred<T>()
    const onAbort = (): void => {
      const error = new Error(`design git: ${stage} timed out`)
      this.stop(error); expired.reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    try { return await Promise.race([pending, expired.promise]) }
    finally { signal.removeEventListener('abort', onAbort) }
  }

  private async read(): Promise<void> {
    let ready = false, closed = false
    for await (const frame of readGitFrames(this.channel)) {
      if (frame.kind === 'bytes') {
        const pending = this.pending
        const maxBytes = pending?.kind === 'cli' ? pending.request.binaryStdout?.maxBytes
          : pending?.request.operation.kind === 'blob' ? pending.request.operation.size : undefined
        if (pending === undefined || pending.id !== frame.id || maxBytes === undefined) throw new Error('design git: unexpected worker byte result')
        pending.size += frame.bytes.length
        if (pending.size > maxBytes) throw new Error('design git: binary stdout exceeded its declared blob size')
        pending.output.push(frame.bytes)
        continue
      }
      const message = gitMessage(frame.value)
      if (message.type === 'ready' && message.version === 1 && !ready) {
        ready = true; this.ready.resolve(); continue
      }
      if (!ready || closed) throw new Error('design git: invalid worker lifecycle')
      if (message.type === 'closed' && !this.active && this.pending === undefined) {
        closed = true; this.closed.resolve(); continue
      }
      const pending = this.pending
      if (pending === undefined || message.id !== pending.id) throw new Error('design git: unexpected worker result')
      if (pending.kind === 'native') {
        if (message.type !== 'native-result') throw new Error('design git: unexpected native worker result')
        if (message.failure !== undefined) {
          if (!isNativeGitFailure(message.failure)) throw new Error('design git: invalid native worker failure')
          throw new Error(`design git native: ${message.failure}`)
        }
        const operation = pending.request.operation
        const blob = operation.kind === 'blob'
        if (operation.kind === 'blob' && pending.size !== operation.size) throw new Error('design git: native blob size mismatch')
        pending.result.resolve({ value: message.value, ...(blob ? { bytes: Buffer.concat(pending.output) } : {}) })
        continue
      }
      if (message.type !== 'result') throw new Error('design git: unexpected worker result')
      if (pending.timingRequested) pending.workerTiming = gitWorkerTiming(Object.getOwnPropertyDescriptor(message, 'timing')?.value)
      if (message.failure !== undefined) {
        throw new Error(message.failure === 'binary-overflow'
          ? 'design git: binary stdout exceeded its declared blob size' : 'design git: worker command failed')
      }
      if ((message.exitCode !== null && !Number.isInteger(message.exitCode)) || typeof message.stdout !== 'string' || typeof message.stderr !== 'string') throw new Error('design git: malformed worker result')
      // Caps are checked again at the consuming boundary, before retention.
      if (Buffer.byteLength(message.stdout) > 3 * (1 << 20) || Buffer.byteLength(message.stderr) > 3 * (1 << 18)) throw new Error('design git: worker text result exceeded its limit')
      pending.result.resolve({ exitCode: message.exitCode as number | null, stdout: message.stdout, stderr: message.stderr,
        ...(pending.request.binaryStdout === undefined ? {} : { stdoutBytes: Buffer.concat(pending.output) }) })
    }
    if (!closed) throw new Error('design git: worker channel ended before settlement')
  }
}

/** Keep a known save receipt or its original error distinct from cleanup. */
export async function runDshGitScope<T>(
  scope: Pick<DshGitScope, 'stop' | 'close'> | undefined,
  operation: () => Promise<T>,
  cleanupFailed: (completed: boolean) => void,
): Promise<T> {
  let completed = false
  try {
    const result = await operation()
    completed = true
    return result
  } catch (error) {
    scope?.stop(error)
    throw error
  } finally {
    try { await scope?.close() }
    catch { try { cleanupFailed(completed) } catch { /* Diagnostics never replace publication facts. */ } }
  }
}

/** Core owns this local filesystem; native operations do not launch a host process. */
export async function openDshGitScope(options: {
  subprocess: unknown; root: string; signal: AbortSignal; assertScope: () => Promise<void>; scopeId?: number; backend?: 'cli' | 'native'
}): Promise<DshGitScope | DshLibraryGitScope | undefined> {
  if ((options.backend ?? gitBackendSetting()) === 'cli') return openDshProcessGitScope({ ...options, backend: 'cli' })
  const started = performance.now()
  options.signal.throwIfAborted()
  await options.assertScope()
  options.signal.throwIfAborted()
  const scope = new DshLibraryGitScope(options.root, options.signal, options.assertScope, options.scopeId)
  emitDshGitScopeTiming(options.scopeId, 'route-selected', performance.now() - started,
    { route: 'library-thread', reason: 'local-library' })
  return scope
}

/** Retained process adapter for explicit diagnostic use; never a native failure fallback. */
export async function openDshProcessGitScope(options: {
  subprocess: unknown; root: string; signal: AbortSignal; assertScope: () => Promise<void>; scopeId?: number; backend?: 'cli' | 'native'
}): Promise<DshGitScope | undefined> {
  const started = performance.now()
  emitDshGitScopeTiming(options.scopeId, 'route-start', 0)
  const fallback = (reason: string): undefined => {
    emitDshGitScopeTiming(options.scopeId, 'route-selected', performance.now() - started, { route: 'fallback', reason })
    return undefined
  }
  // Other platforms retain their already validated adapter unchanged.
  if (process.platform !== 'win32') return fallback('non-windows')
  let module: typeof import('@deepseek-ai/dsh-subprocess-local')
  try { module = await import('@deepseek-ai/dsh-subprocess-local') }
  catch (error) {
    const missing = error as { code?: string; message?: string }
    if (missing.code === 'ERR_MODULE_NOT_FOUND' && missing.message?.includes("'@deepseek-ai/dsh-subprocess-local'")) return fallback('optional-package-missing')
    emitDshGitScopeTiming(options.scopeId, 'route-refused', performance.now() - started, { reason: 'module-import-failed', completed: false })
    throw error
  }
  const local = options.subprocess
  if (!(local instanceof module.LocalSubprocessRuntime)) return fallback('different-runtime')
  let route: ManagedGitRoute, launch: (spec: SubprocessSpawnSpec) => SubprocessHandle
  if (hasStrictNativeSpawn(local)) {
    route = 'scoped-native'; launch = spec => local.spawnNativeContained(spec)
  } else if ((options.backend ?? gitBackendSetting()) === 'native') {
    // Public spawn owns its documented range, which can include weaker
    // fallback visibility. It does not attest strict native containment.
    route = 'host-managed'; launch = spec => local.spawn(spec)
  } else return fallback('missing-native-api')
  emitDshGitScopeTiming(options.scopeId, 'route-selected', performance.now() - started,
    { route, reason: route === 'scoped-native' ? 'native-api' : 'public-api' })
  options.signal.throwIfAborted()
  await options.assertScope()
  const resolveStarted = performance.now()
  let resolved = false, executable: string
  emitDshGitScopeTiming(options.scopeId, 'resolve-start', 0, { route })
  try { executable = await local.resolveExecutable(process.execPath, undefined, options.signal); resolved = true }
  finally { emitDshGitScopeTiming(options.scopeId, 'resolve-end', performance.now() - resolveStarted,
    { route, completed: resolved, cancelled: options.signal.aborted }) }
  await options.assertScope()
  options.signal.throwIfAborted()
  const spawnStarted = performance.now()
  let spawned = false, handle: SubprocessHandle
  emitDshGitScopeTiming(options.scopeId, 'spawn-start', 0, { route })
  try { handle = launch({
    argv: [executable, fileURLToPath(new URL('./dsh-git-worker.js', import.meta.url)), options.root],
    cwd: options.root, signal: options.signal, graceMs: 5000,
    env: process.versions.electron === undefined ? undefined : { ELECTRON_RUN_AS_NODE: '1' },
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 4096 }, control: 'pipe' },
  }); spawned = true }
  finally { emitDshGitScopeTiming(options.scopeId, 'spawn-end', performance.now() - spawnStarted,
    { route, completed: spawned, cancelled: options.signal.aborted }) }
  let scope: DshGitScope | undefined
  try {
    scope = new DshGitScope(handle, options.root, options.signal, options.assertScope, undefined, options.scopeId, route)
    await scope.start()
    return scope
  } catch (error) {
    handle.terminate()
    try {
      if (scope !== undefined) { scope.stop(error); await scope.close() }
      else {
        const cleanup = new AbortController(), timer = setTimeout(() => cleanup.abort(), 15_000)
        try { await observeRange(handle, cleanup.signal, options.signal, options.scopeId, route) }
        finally { clearTimeout(timer) }
      }
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'design git: worker startup failed and cleanup was not confirmed', { cause: error })
    }
    throw error
  }
}
