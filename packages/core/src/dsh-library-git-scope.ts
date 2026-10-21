/** DSH authority adapter over Core's local, reusable library executor. */
import { isAbsolute } from 'node:path'
import type { NativeGitRequest, SpawnFn } from './git.ts'
import type { NativeGitResult } from './git-native-contract.ts'
import { nativeGitOperation } from './git-native-operation.ts'
import { executeNativeGitRequest, hasNativeGitCommitReceipt } from './git-native-executor.ts'
import { emitDshGitScopeTiming, emitDshTimingDiagnostic } from './dsh-timing-diagnostics.ts'

/**
 * Only for Core-owned local repositories. This is not a remote/container spawn
 * substitute, a project mutation lane, or a new publication authority.
 * There are no subprocess descendants, so no process-range/Job attestation.
 */
export class DshLibraryGitScope {
  private active = true
  private tail: Promise<unknown> = Promise.resolve()
  private readonly cancellation = new AbortController()
  private readonly onAbort: () => void
  private closing?: Promise<void>
  private pending = 0
  private pendingBytes = 0
  private sequence = 0

  constructor(
    private readonly root: string,
    private readonly signal: AbortSignal,
    private readonly assertScope: () => Promise<void>,
    private readonly scopeId?: number,
    private readonly execute: (request: NativeGitRequest, beforeExecute?: () => Promise<void>) => Promise<NativeGitResult> = executeNativeGitRequest,
  ) {
    if (!isAbsolute(root)) throw new Error('design git: local repository must be absolute')
    this.onAbort = () => this.stop(signal.reason)
    signal.addEventListener('abort', this.onAbort, { once: true })
    if (signal.aborted) this.onAbort()
  }

  readonly spawn: SpawnFn = Object.assign(
    () => Promise.reject(new Error('design git: external command is unavailable in a library scope')),
    { native: (request: NativeGitRequest) => this.native(request) },
  )

  private native(request: NativeGitRequest): Promise<NativeGitResult> {
    if (!this.active) return Promise.reject(new Error('design git: save scope has ended'))
    let operation: NativeGitRequest['operation'], bytes: number
    try {
      this.signal.throwIfAborted(); request.signal?.throwIfAborted()
      if (request.cwd !== this.root) throw new Error('design git: native operation escaped its save repository')
      operation = nativeGitOperation(structuredClone(request.operation))
      bytes = Buffer.byteLength(JSON.stringify(operation)) + Buffer.byteLength(request.cwd)
      if (this.pending >= 128 || bytes > 8 << 20 || this.pendingBytes + bytes > 16 << 20) {
        throw new Error('design git: library scope queue budget exceeded')
      }
    } catch (error) { return Promise.reject(error) }
    this.pending++; this.pendingBytes += bytes
    const sequence = ++this.sequence, started = performance.now(), timings: Record<string, number> = {}
    const signal = request.signal === undefined ? this.cancellation.signal
      : AbortSignal.any([this.cancellation.signal, request.signal])
    // Start admission guards promptly, but reserve FIFO position immediately.
    const admitted = Promise.resolve().then(() => this.assertScope())
    void admitted.catch(() => {})
    let completed = false
    const execution = this.tail.then(async () => {
      timings.queueMs = Math.round(performance.now() - started)
      await admitted
      if (!this.active) throw new Error('design git: save scope has ended')
      signal.throwIfAborted()
      const before = performance.now()
      try { await this.assertScope() }
      finally { timings.preGuardMs = Math.round(performance.now() - before) }
      signal.throwIfAborted()
      const executing = performance.now()
      let result: NativeGitResult
      try { result = await this.execute({ cwd: this.root, operation, signal }, async () => {
        // The shared worker can be queued behind a different scope/project.
        // Recheck at its actual dispatch too; shared FIFO is not an authority.
        signal.throwIfAborted()
        await this.assertScope()
        signal.throwIfAborted()
      }) }
      finally { timings.requestRttMs = Math.round(performance.now() - executing) }
      const after = performance.now()
      try {
        signal.throwIfAborted()
        await this.assertScope()
        signal.throwIfAborted()
      } catch (error) {
        this.stop(error)
        if (operation.kind === 'publish' && hasNativeGitCommitReceipt(result)) {
          completed = true
          return { ...result, publicationScopeInvalidated: true as const }
        }
        throw error
      } finally { timings.postGuardMs = Math.round(performance.now() - after) }
      completed = true
      return result
    }).catch(error => { this.stop(error); throw error }).finally(() => {
      this.pending--; this.pendingBytes -= bytes
      const elapsedMs = Math.round(performance.now() - started)
      emitDshTimingDiagnostic({ tag: 'yugoo-git', operation: operation.kind, at: new Date().toISOString(),
        scopeId: this.scopeId, route: 'library-thread', sequence, elapsedMs, totalMs: elapsedMs,
        ...timings, completed, cancelled: signal.aborted })
    })
    this.tail = execution.catch(() => {})
    return execution
  }

  stop(reason: unknown = new Error('design git: library scope stopped')): void {
    this.active = false
    // Cancels only this scope's requests. Never terminates the shared thread or
    // drops a running publication before its confirmed/unknown outcome arrives.
    if (!this.cancellation.signal.aborted) this.cancellation.abort(reason)
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.stop(new Error('design git: library scope has ended'))
    const started = performance.now()
    emitDshGitScopeTiming(this.scopeId, 'close-start', 0, { route: 'library-thread' })
    this.closing = this.tail.then(() => {
      this.signal.removeEventListener('abort', this.onAbort)
      emitDshGitScopeTiming(this.scopeId, 'close-end', performance.now() - started,
        { route: 'library-thread', completed: true, cancelled: this.signal.aborted })
    })
    return this.closing
  }
}
