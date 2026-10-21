/** Project-scoped background indexing, shared by DSH and all Companion hosts.
 * This owns no facts: success is persisted by refreshDesignKnowledge only after
 * its fenced publication. A failed input is retained until the input changes. */
export class DesignKnowledgeIndex {
  private jobs = new Map<string, { key: string; artifact: string; warning?: string; state: 'indexing' | 'ready' | 'error'; controller: AbortController; settled: Promise<void> }>()
  private pending = new Set<Promise<void>>()
  private epochs = new Map<string, number>()
  private closed = false

  capture(project: string) {
    if (this.closed) throw new DOMException('Knowledge index runtime closed', 'AbortError')
    return this.epochs.get(project) ?? 0
  }
  assertCurrent(project: string, epoch: number) {
    if (this.capture(project) !== epoch) throw new DOMException('Knowledge project released during index preparation', 'AbortError')
  }
  warning(project: string, key: string) { const job = this.jobs.get(project); return job?.key === key ? job.warning : undefined }
  state(project: string): 'indexing' | 'ready' | 'error' | 'unknown' { return this.jobs.get(project)?.state ?? 'unknown' }
  /** The live job's settlement promise, when one exists; rejects on real failure. */
  settledState(project: string): Promise<void> | undefined { return this.jobs.get(project)?.settled }
  /** Admit one new attempt only at an explicit project lifecycle boundary. */
  retry(project: string) {
    const job = this.jobs.get(project)
    if (job?.state === 'error') this.jobs.delete(project)
  }

  ready(project: string, key: string, artifact: string, epoch = this.capture(project)) {
    this.assertCurrent(project, epoch)
    const previous = this.jobs.get(project)
    if (previous?.key === key && previous.artifact === artifact && previous.state === 'ready') return
    previous?.controller.abort(new Error('Current persisted index supersedes pending work'))
    this.jobs.set(project, { key, artifact, state: 'ready', controller: new AbortController(), settled: Promise.resolve() })
  }

  async run(project: string, key: string, artifact: string, operation: (signal: AbortSignal) => Promise<{ artifact: string; warning?: string }>, background = false, signal?: AbortSignal, epoch = this.capture(project)) {
    this.assertCurrent(project, epoch)
    signal?.throwIfAborted()
    let job = this.jobs.get(project)
    if (job?.key !== key || job.state === 'ready' && job.artifact !== artifact) {
      job?.controller.abort(new Error('Design semantic input changed'))
      const controller = new AbortController()
      const current = { key, artifact, warning: undefined as string | undefined, state: 'indexing' as 'indexing' | 'ready' | 'error', controller, settled: Promise.resolve() }
      this.jobs.set(project, current)
      // Detached from the Panel request signal; closing the owning runtime drains
      // this lane. A transient reader disappearing must not cancel other readers.
      current.settled = Promise.resolve().then(() => operation(controller.signal)).then(result => {
        controller.signal.throwIfAborted()
        current.state = 'ready'
        current.artifact = result.artifact
        current.warning = result.warning
      }).catch(error => {
        current.state = 'error'
        current.warning = '语义索引未完成；请检查模型配置或下载网络。系统会在下一次项目生命周期事件重试，已有完整图谱仍可使用。'
        if ((controller.signal.aborted || error?.name === 'AbortError') && this.jobs.get(project) === current) this.jobs.delete(project)
        throw error
      })
      void current.settled.catch(() => {})
      this.pending.add(current.settled)
      void current.settled.finally(() => this.pending.delete(current.settled)).catch(() => {})
      job = current
    }
    if (!background) await job.settled
    signal?.throwIfAborted()
    return job.state
  }

  async close() {
    this.closed = true
    const jobs = [...this.jobs.values()]
    for (const job of jobs) job.controller.abort(new Error('Knowledge index runtime closed'))
    await Promise.allSettled(this.pending)
    this.jobs.clear()
  }

  release(project: string) {
    this.epochs.set(project, (this.epochs.get(project) ?? 0) + 1)
    const job = this.jobs.get(project)
    if (!job) return
    job.controller.abort(new Error('Knowledge project released'))
    // A project close can itself own the host mutation queue. Do not wait here
    // for a cancelled publication queued behind it; its signal fence rejects it.
    this.jobs.delete(project)
  }
}
