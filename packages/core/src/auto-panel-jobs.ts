/** Single-flight lifecycle for project-local, disposable generated Panels. */
export type AutoPanelJobState =
  | { readonly phase: 'queued' | 'running'; readonly target: string }
  | { readonly phase: 'ready' | 'failed'; readonly target: string; readonly detail?: string;
      readonly attempts?: number; readonly durationMs?: number; readonly fallbackReason?: string }

export interface AutoPanelJobCompletion {
  readonly attempts?: number
  readonly fallbackReason?: string
}

interface Job {
  target: string
  owner: string
  run: (signal: AbortSignal) => Promise<void | AutoPanelJobCompletion>
  controller: AbortController
  active: boolean
  rerun: boolean
}

export class AutoPanelJobs {
  private readonly jobs = new Map<string, Job>()
  private readonly states = new Map<string, AutoPanelJobState>()
  private readonly attemptedOwners = new Map<string, { target: string; owners: Set<string> }>()
  private disposed = false

  status(key: string): AutoPanelJobState | undefined { return this.states.get(key) }

  /** New targets supersede old work; a different session may take over a failed or active target once. */
  request(key: string, target: string, owner: string, run: (signal: AbortSignal) => Promise<void | AutoPanelJobCompletion>): 'scheduled' | 'merged' | 'noop' {
    if (this.disposed) return 'noop'
    const existing = this.jobs.get(key)
    if (existing !== undefined) {
      if (existing.target === target && existing.owner === owner) return 'merged'
      if (existing.target === target && this.wasAttempted(key, target, owner)) return 'noop'
      this.markAttempt(key, target, owner)
      existing.target = target
      existing.owner = owner
      existing.run = run
      existing.rerun = true
      existing.controller.abort()
      this.states.set(key, { phase: 'queued', target })
      return 'merged'
    }
    if (this.states.get(key)?.target === target && this.wasAttempted(key, target, owner)) return 'noop'
    this.markAttempt(key, target, owner)
    const job: Job = { target, owner, run, controller: new AbortController(), active: false, rerun: true }
    this.jobs.set(key, job)
    this.states.set(key, { phase: 'queued', target })
    queueMicrotask(() => { void this.execute(key, job) })
    return 'scheduled'
  }

  private wasAttempted(key: string, target: string, owner: string): boolean {
    const attempts = this.attemptedOwners.get(key)
    return attempts?.target === target && attempts.owners.has(owner)
  }

  private markAttempt(key: string, target: string, owner: string): void {
    const attempts = this.attemptedOwners.get(key)
    const owners = attempts?.target === target ? attempts.owners : new Set<string>()
    owners.add(owner)
    this.attemptedOwners.set(key, { target, owners })
  }

  private async execute(key: string, job: Job): Promise<void> {
    if (job.active || this.disposed) return
    job.active = true
    try {
      while (job.rerun && !this.disposed) {
        job.rerun = false
        const target = job.target
        const run = job.run
        job.controller = new AbortController()
        this.states.set(key, { phase: 'running', target })
        const startedAt = Date.now()
        try {
          const completion = await run(job.controller.signal)
          if (!job.rerun && !this.disposed) this.states.set(key, {
            phase: 'ready', target, durationMs: Date.now() - startedAt,
            ...(completion === undefined ? {} : completion),
          })
        } catch (error) {
          if (!job.rerun && !this.disposed) this.states.set(key, {
            phase: 'failed', target,
            detail: (error instanceof Error ? error.message : String(error)).slice(0, 300),
            durationMs: Date.now() - startedAt,
          })
        }
      }
    } finally {
      job.active = false
      if (this.jobs.get(key) === job) this.jobs.delete(key)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const job of this.jobs.values()) job.controller.abort()
    this.jobs.clear()
    this.states.clear()
    this.attemptedOwners.clear()
  }
}
