import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, isAbsolute } from 'node:path'
import { semanticDigest, semanticEdges, normalizeVector, SEMANTIC_TEXT_VERSION, type DesignGraph, type DesignFieldGraphEdge as DesignGraphEdge, type SemanticStatus } from 'dsh-design-core'

const localEmbeddingFailures: Record<string, string> = {
  runtime: '本地 embedding 运行依赖不可用；请按当前操作系统安装依赖（包括原生模块），不要复用其他平台的 node_modules。',
  model: '本地 embedding 模型加载失败；请检查固定版本模型缓存，离线模式需要先准备完整模型文件。',
  inference: '本地 embedding 推理失败；请检查输入限制和本地内存、CPU 运行资源。',
}

export interface EmbeddingConfig {
  provider?: 'local' | 'remote' | 'disabled'; model?: string; revision?: string; cacheDir?: string; localOnly?: boolean
  endpoint?: string; apiKey?: string; prefix?: string; threshold?: number
}
export interface SemanticCache { readSemanticCache(key: string): Promise<string | undefined>; writeSemanticCache(key: string, value: string): Promise<void> }
interface Job { key: string; status: SemanticStatus; edges: DesignGraphEdge[]; abort: AbortController; memory: MemorySemanticCache; idle?: ReturnType<typeof setTimeout>; settled?: Promise<void>; waiters?: number }
/** Disposable, project-local cache. Never stores Knowledge/GRA facts. */
export class MemorySemanticCache implements SemanticCache {
  private values = new Map<string, string>()
  private bytes = 0
  constructor(private readonly limit = 300, private readonly byteLimit = 4_000_000) {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(byteLimit) || byteLimit < 1) throw new Error('Invalid volatile cache bounds')
  }
  async readSemanticCache(key: string) { return this.values.get(key) }
  async writeSemanticCache(key: string, value: string) {
    const size = Buffer.byteLength(key) + Buffer.byteLength(value)
    if (size > this.byteLimit) return
    const old = this.values.get(key)
    if (old !== undefined) { this.bytes -= Buffer.byteLength(key) + Buffer.byteLength(old); this.values.delete(key) }
    while (this.values.size && (this.values.size >= this.limit || this.bytes + size > this.byteLimit)) {
      const [id, text] = this.values.entries().next().value!
      this.values.delete(id); this.bytes -= Buffer.byteLength(id) + Buffer.byteLength(text)
    }
    this.values.set(key, value); this.bytes += size
  }
}
export async function stopEmbeddingChild(worker: ChildProcess): Promise<void> {
  if (worker.exitCode !== null || worker.signalCode !== null) return
  await new Promise<void>(resolveExit => {
    const timer = setTimeout(() => worker.kill('SIGKILL'), 2000)
    worker.once('exit', () => { clearTimeout(timer); resolveExit() })
    worker.kill('SIGTERM')
  })
}
export class DesignSemanticIndex {
  readonly config: Required<Omit<EmbeddingConfig, 'endpoint' | 'apiKey'>> & Pick<EmbeddingConfig, 'endpoint' | 'apiKey'>
  readonly identity: string
  get publicationIdentity() { return semanticDigest(this.identity + ':similarity-v1:' + this.config.threshold) }
  private jobs = new Map<string, Job>()
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  constructor(config: EmbeddingConfig = {}, private readonly idleMs = 300_000) {
    if (!Number.isSafeInteger(idleMs) || idleMs < 1) throw new Error('Invalid semantic idle timeout')
    this.config = { provider: 'local', model: 'Xenova/multilingual-e5-small', revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78', cacheDir: resolve(homedir(), '.cache/design-system/embeddings'), localOnly: false, prefix: 'query: ', threshold: .8, ...config }
    if (!['local', 'remote', 'disabled'].includes(this.config.provider)) throw new Error('Unknown embedding provider')
    if (!this.config.model || !this.config.revision || !isAbsolute(this.config.cacheDir)) throw new Error('Invalid embedding configuration')
    if (!(this.config.threshold >= 0 && this.config.threshold <= 1)) throw new Error('Invalid semantic threshold')
    if (this.config.provider === 'remote') {
      if (!this.config.endpoint || !config.model || !config.revision) throw new Error('Remote embedding requires explicit endpoint, model and revision')
      const url = new URL(this.config.endpoint)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid embedding endpoint')
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Remote embedding requires HTTPS except loopback')
    }
    this.identity = semanticDigest(JSON.stringify({ provider: this.config.provider, model: this.config.model, revision: this.config.revision, endpoint: this.config.endpoint, prefix: this.config.prefix, text: SEMANTIC_TEXT_VERSION, pooling: 'mean-token-windows-v1', dtype: 'q8', engine: 'transformers-3.8.1' }))
  }
  read(project: string, graph: DesignGraph, cache?: SemanticCache): { edges: DesignGraphEdge[]; status: SemanticStatus } {
    // The caller may strip internal fields or reuse its response object after read.
    // Own the queued evidence, including its revision, before yielding.
    const units = (graph.semanticUnits ?? []).map(unit => ({ ...unit, fieldPointers: unit.fieldPointers?.slice() }))
    const snapshot = { checkpoint: graph.checkpoint, semanticUnits: units }
    const key = semanticDigest(graph.checkpoint + (graph.generation ?? '') + this.publicationIdentity + (cache ? 'persistent' : 'memory') + JSON.stringify(units.map(u => [u.id, u.nodeId, u.file, u.pointer, u.fieldPointers, u.digest])))
    if (this.closed || this.config.provider === 'disabled') return { edges: [], status: { state: 'disabled', completed: 0, total: units.length, model: this.config.model } }
    let job = this.jobs.get(project)
    if (job?.key !== key) {
      if (this.jobs.size >= 8 && !job) return { edges: [], status: { state: 'error', completed: 0, total: units.length, model: this.config.model, message: '语义索引同时最多处理8个项目。' } }
      job?.abort.abort()
      clearTimeout(job?.idle)
      job = { key, status: { state: 'indexing', completed: 0, total: units.length, model: this.config.model, cache: cache ? 'persistent' : 'memory', message: this.config.provider === 'local' ? '本地索引准备中；首次可能下载模型，文本不上传' : '使用已配置远程 embedding 服务处理设计文本' }, edges: [], abort: new AbortController(), memory: job?.memory ?? new MemorySemanticCache() }
      this.jobs.set(project, job)
      const current = job
      this.tail = this.tail.catch(() => {}).then(async () => {
        if (current.abort.signal.aborted) return
        try { await this.build(snapshot, cache, current) } catch (error) {
          const phase = (error as { embeddingFailure?: string })?.embeddingFailure
          const detail = phase && Object.hasOwn(localEmbeddingFailures, phase) ? localEmbeddingFailures[phase] : '语义索引失败；请检查本地运行资源或已配置的 embedding 服务。'
          if (!current.abort.signal.aborted) current.status = { ...current.status, state: 'error', message: detail + ' 保留结构图，不自动上传或重试。' }
        }
      })
      current.settled = this.tail
    }
    // Failed provider acquisition has no Knowledge lease to release on project close.
    // Stop abandoned reads after a bounded grace period; active graph polling renews it.
    clearTimeout(job.idle)
    if (!job.waiters) {
      job.idle = setTimeout(() => this.cancelProject(project), this.idleMs)
      job.idle.unref()
    }
    return { edges: job.edges, status: { ...job.status } }
  }
  /** Await the existing inference job for background persistence; no polling and
   * no project write lock held during model execution. Partial edges never escape. */
  async compute(project: string, graph: DesignGraph, cache?: SemanticCache, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const status = this.read(project, graph, cache)
    const job = this.jobs.get(project)
    if (!job || status.status.state === 'disabled' || status.status.state === 'error') throw new Error(status.status.message ?? 'Semantic indexing unavailable')
    clearTimeout(job.idle)
    job.waiters = (job.waiters ?? 0) + 1
    let rejectAbort!: (reason: unknown) => void
    const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
    const abort = () => rejectAbort(signal?.reason ?? new Error('Semantic consumer cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    try {
      signal?.throwIfAborted()
      await Promise.race([job.settled, cancelled])
      signal?.throwIfAborted()
      job.abort.signal.throwIfAborted()
      if (this.jobs.get(project) !== job || job.status.state !== 'ready') throw new Error(job.status.message ?? 'Semantic indexing did not complete')
      return { edges: structuredClone(job.edges), status: { ...job.status } }
    } finally {
      signal?.removeEventListener('abort', abort)
      job.waiters!--
      // One cancelled review must not cancel inference still used by its peers.
      if (!job.waiters && signal?.aborted && job.status.state === 'indexing') job.abort.abort(signal.reason)
      if (this.jobs.get(project) === job && !job.waiters) {
        job.idle = setTimeout(() => this.cancelProject(project), this.idleMs)
        job.idle.unref()
      }
    }
  }
  cancelProject(project: string) { const job = this.jobs.get(project); clearTimeout(job?.idle); job?.abort.abort(); this.jobs.delete(project) }
  async close() { this.closed = true; for (const project of this.jobs.keys()) this.cancelProject(project); await this.tail }
  private async build(graph: Pick<DesignGraph, 'checkpoint' | 'semanticUnits'>, cache: SemanticCache | undefined, job: Job) {
    const units = graph.semanticUnits ?? [], vectors: number[][] = [], missing: number[] = []
    const signal = job.abort.signal
    for (let i = 0; i < units.length; i++) {
      signal.throwIfAborted()
      const key = semanticDigest(this.identity + units[i].digest)
      let value: string | undefined
      if (cache && job.status.cache === 'persistent') {
        try { value = await cache.readSemanticCache(key) }
        catch { job.status.cache = 'memory' }
      }
      value ??= await job.memory.readSemanticCache(key)
      if (value) { try { vectors[i] = normalizeVector(JSON.parse(value)); job.status.completed++; continue } catch { /* invalid derived cache is regenerated */ } }
      missing.push(i)
    }
    let worker: ChildProcess | undefined
    const kill = () => { worker?.kill('SIGTERM') }
    signal.addEventListener('abort', kill, { once: true })
    try {
      if (missing.length && this.config.provider === 'local') {
        const built = new URL('./embedding-worker.js', import.meta.url)
        // ONNX's native addon cannot reliably reload in successive worker threads.
        // A bounded child process also releases native memory when the job ends.
        worker = fork(existsSync(built) ? built : new URL('./embedding-worker.mjs', import.meta.url), [], { windowsHide: true, execArgv: ['--max-old-space-size=512'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      }
      for (let start = 0; start < missing.length; start += 4) {
        signal.throwIfAborted()
        const indices = missing.slice(start, start + 4), texts = indices.map(i => units[i].text)
        const values = worker ? await this.localBatch(worker, texts, job) : await this.remoteBatch(texts, signal)
        if (!Array.isArray(values) || values.length !== texts.length) throw new Error('Embedding batch count mismatch')
        for (let offset = 0; offset < indices.length; offset++) {
          signal.throwIfAborted()
          const i = indices[offset], vector = normalizeVector(values[offset])
          vectors[i] = vector
          const key = semanticDigest(this.identity + units[i].digest), value = JSON.stringify(vector)
          await job.memory.writeSemanticCache(key, value)
          if (cache && job.status.cache === 'persistent') {
            try { await cache.writeSemanticCache(key, value) }
            catch { job.status.cache = 'memory' }
          }
          job.status.completed++
        }
      }
      signal.throwIfAborted()
      job.edges = semanticEdges(units, vectors, `${this.config.model}@${this.config.revision}/${this.identity.slice(0, 12)}`, graph.checkpoint, this.config.threshold)
      job.status = { ...job.status, state: 'ready', message: `${job.edges.length} 条跨文件语义候选；相似度不等于确认关系` }
    } finally {
      signal.removeEventListener('abort', kill)
      if (worker) await stopEmbeddingChild(worker)
    }
  }
  private localBatch(worker: ChildProcess, texts: string[], job: Job): Promise<unknown[]> {
    return new Promise((resolveBatch, reject) => {
      const cleanup = () => { clearTimeout(timer); worker.off('message', message); worker.off('error', failure); worker.off('exit', failure); job.abort.signal.removeEventListener('abort', failure) }
      const failure = () => { cleanup(); reject(new Error('Embedding worker stopped')) }
      const message = (data: { progress?: string; error?: string; vectors?: unknown[] }) => {
        if (data.progress) { job.status.message = data.progress; return }
        cleanup(); if (data.error || !data.vectors) reject(Object.assign(new Error('Embedding worker failed'), { embeddingFailure: data.error })); else resolveBatch(data.vectors)
      }
      const timer = setTimeout(() => { failure(); worker.kill('SIGTERM') }, 180_000)
      worker.on('message', message); worker.once('error', failure); worker.once('exit', failure)
      job.abort.signal.addEventListener('abort', failure, { once: true })
      if (job.abort.signal.aborted) { failure(); return }
      worker.send({ texts, config: this.config }, error => { if (error) failure() })
    })
  }
  private async remoteBatch(texts: string[], signal: AbortSignal): Promise<unknown[]> {
    const response = await fetch(this.config.endpoint!, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}) }, body: JSON.stringify({ model: this.config.model, input: texts.map(t => this.config.prefix + t) }), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) })
    if (!response.ok) throw new Error('Remote embedding request failed')
    const data = await response.json() as { data?: { index: number; embedding: unknown[] }[] }
    if (!Array.isArray(data.data) || data.data.length !== texts.length || new Set(data.data.map(d => d.index)).size !== texts.length || data.data.some(d => !Number.isInteger(d.index) || d.index < 0 || d.index >= texts.length)) throw new Error('Invalid remote embedding response')
    return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
  }
}
