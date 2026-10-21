/** Host-neutral transport for trusted library Git. No argv or publication authority. */
import { Worker, SHARE_ENV } from 'node:worker_threads'
import { isAbsolute } from 'node:path'
import type { NativeGitRequest } from './git.ts'
import type { NativeGitResult } from './git-native-contract.ts'
import { isNativeGitFailure } from './git-native-operation.ts'

const MAX_QUEUE = 128
const MAX_REQUEST_BYTES = 8 << 20
const MAX_QUEUED_BYTES = 16 << 20

/** Private test seam; production always loads the package-owned fixed worker. */
export interface NativeGitThread {
  postMessage(value: unknown): void
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  ref(): void
  unref(): void
  terminate(): Promise<number>
}

interface Entry {
  readonly id: number
  readonly request: NativeGitRequest
  readonly bytes: number
  readonly cancelled: Int32Array
  readonly resolve: (result: NativeGitResult) => void
  readonly reject: (error: unknown) => void
  readonly abort: () => void
  readonly beforeExecute?: () => Promise<void>
}

function cancelledReason(signal?: AbortSignal): unknown {
  return signal?.aborted ? signal.reason : new DOMException('Native Git operation cancelled', 'AbortError')
}

/** A confirmed publication remains a fact after a caller's authority expires. */
export function hasNativeGitCommitReceipt(result: NativeGitResult): boolean {
  const value = result.value
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'commit' in value
    && typeof value.commit === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(value.commit)
    && 'change' in value && (value.change === 'changed' || value.change === 'unchanged')
}

/**
 * One reusable FIFO thread. It keeps no repository handle between operations.
 * Caller-owned lanes, project selection and publication fences remain required.
 * Cancellation never discards an executing write or its late CAS receipt.
 */
export class NativeGitExecutor {
  private worker?: NativeGitThread
  private current?: Entry
  private readonly queue: Entry[] = []
  private queuedBytes = 0
  private sequence = 0
  private closed = false
  private closing?: Promise<void>
  private idle?: () => void

  constructor(private readonly createWorker: () => NativeGitThread = () => new Worker(
    new URL('./git-native-worker.js', import.meta.url),
    // No inherited --eval, --inspect, custom loaders or caller-selected script.
    { execArgv: [], env: SHARE_ENV, name: 'yugoo-library-git' },
  )) {}

  execute(request: NativeGitRequest, beforeExecute?: () => Promise<void>): Promise<NativeGitResult> {
    if (this.closed) return Promise.reject(new Error('design git: native executor has ended'))
    if (request.signal?.aborted) return Promise.reject(cancelledReason(request.signal))
    if (!isAbsolute(request.cwd)) return Promise.reject(new Error('design git: native repository must be absolute'))
    if (this.queue.length + (this.current ? 1 : 0) >= MAX_QUEUE) {
      return Promise.reject(new Error('design git: native executor queue is full'))
    }
    let operation: NativeGitRequest['operation'], bytes: number
    try {
      // Own a snapshot: queued callers cannot change paths or publication inputs.
      operation = structuredClone(request.operation)
      bytes = Buffer.byteLength(JSON.stringify(operation)) + Buffer.byteLength(request.cwd)
      if (bytes > MAX_REQUEST_BYTES || this.queuedBytes + bytes > MAX_QUEUED_BYTES) {
        throw new Error('design git: native request exceeds its queue budget')
      }
    } catch (error) { return Promise.reject(error) }
    if (!Number.isSafeInteger(++this.sequence)) return Promise.reject(new Error('design git: native sequence exhausted'))
    return new Promise((resolve, reject) => {
      const entry: Entry = {
        id: this.sequence, request: { ...request, operation }, bytes, beforeExecute,
        cancelled: new Int32Array(new SharedArrayBuffer(4)), resolve, reject,
        abort: () => {
          // Synchronous NAPI cannot receive a cancel message until it returns.
          // Shared memory is checked by the implementation at its existing fences.
          Atomics.store(entry.cancelled, 0, 1)
          if (this.current === entry) return
          const index = this.queue.indexOf(entry)
          if (index < 0) return
          this.queue.splice(index, 1)
          this.release(entry)
          reject(cancelledReason(request.signal))
        },
      }
      this.queue.push(entry)
      this.queuedBytes += bytes
      request.signal?.addEventListener('abort', entry.abort, { once: true })
      if (request.signal?.aborted) entry.abort()
      this.advance()
    })
  }

  /** Stop admission; retain and join any running operation before ending its thread. */
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    for (const entry of this.queue.splice(0)) {
      this.release(entry)
      entry.reject(new Error('design git: native executor has ended'))
    }
    if (this.current) Atomics.store(this.current.cancelled, 0, 1)
    this.closing = (async () => {
      if (this.current) await new Promise<void>(resolve => { this.idle = resolve })
      const worker = this.worker
      this.worker = undefined
      if (worker) await worker.terminate()
    })()
    return this.closing
  }

  private release(entry: Entry): void {
    this.queuedBytes -= entry.bytes
    entry.request.signal?.removeEventListener('abort', entry.abort)
  }

  private advance(): void {
    if (this.current) return
    const entry = this.closed ? undefined : this.queue.shift()
    if (!entry) {
      this.worker?.unref()
      this.idle?.(); this.idle = undefined
      return
    }
    this.current = entry
    if (entry.beforeExecute !== undefined) {
      // A global FIFO may wait behind another scope. Its caller revalidates
      // authority at actual dispatch, not only when it first joined this queue.
      void Promise.resolve().then(entry.beforeExecute).then(() => {
        if (Atomics.load(entry.cancelled, 0) !== 0) throw cancelledReason(entry.request.signal)
        this.dispatch(entry)
      }).catch(error => {
        if (this.current !== entry) return
        this.current = undefined; this.release(entry); entry.reject(error); this.advance()
      })
      return
    }
    this.dispatch(entry)
  }

  private dispatch(entry: Entry): void {
    if (this.current !== entry) return
    try {
      const worker = this.worker ?? this.start()
      worker.ref()
      worker.postMessage({ type: 'run', id: entry.id, cwd: entry.request.cwd,
        operation: entry.request.operation, cancelled: entry.cancelled.buffer })
    } catch (error) { this.failed(error) }
  }

  private start(): NativeGitThread {
    const worker = this.createWorker()
    this.worker = worker
    worker.on('message', message => { if (this.worker === worker) this.result(message) })
    worker.on('error', () => {
      if (this.worker === worker) this.failed(new Error('design git: native worker failed before settlement; reconcile operation outcome'))
    })
    worker.on('exit', () => {
      if (this.worker === worker) this.failed(new Error('design git: native worker exited before settlement; reconcile operation outcome'))
    })
    return worker
  }

  private failed(error: unknown): void {
    const worker = this.worker
    this.worker = undefined
    const entries = [...(this.current ? [this.current] : []), ...this.queue.splice(0)]
    this.current = undefined
    for (const entry of entries) { this.release(entry); entry.reject(error) }
    // Never replay an uncertain request. An errored worker is not reusable.
    if (worker) void worker.terminate().catch(() => {})
    this.idle?.(); this.idle = undefined
  }

  private result(message: unknown): void {
    const entry = this.current
    if (!entry || !message || typeof message !== 'object' || !('id' in message) || message.id !== entry.id
      || !('type' in message) || message.type !== 'result') {
      this.failed(new Error('design git: native worker reply did not match its operation; reconcile operation outcome'))
      return
    }
    this.current = undefined
    this.release(entry)
    if ('failure' in message) {
      // The worker only sends a bounded code; never forward native paths/output.
      const failure = isNativeGitFailure(message.failure) ? message.failure : 'native-operation-failed'
      entry.reject(entry.request.signal?.aborted ? cancelledReason(entry.request.signal)
        : new Error(`design git native: ${failure}`))
    } else if ('value' in message && (!('bytes' in message) || message.bytes instanceof Uint8Array)) {
      const result: NativeGitResult = { value: message.value,
        ...('bytes' in message ? { bytes: message.bytes as Uint8Array } : {}) }
      if (Atomics.load(entry.cancelled, 0) !== 0) {
        if (entry.request.operation.kind === 'publish' && hasNativeGitCommitReceipt(result)) {
          entry.resolve({ ...result, publicationScopeInvalidated: true })
        } else entry.reject(cancelledReason(entry.request.signal))
      } else entry.resolve(result)
    } else entry.reject(new Error('design git: invalid native operation result; reconcile operation outcome'))
    this.advance()
  }
}

const sharedExecutor = new NativeGitExecutor()
export function executeNativeGitRequest(request: NativeGitRequest, beforeExecute?: () => Promise<void>): Promise<NativeGitResult> {
  return sharedExecutor.execute(request, beforeExecute)
}
