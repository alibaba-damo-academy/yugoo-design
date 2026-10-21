/** Project-owned GRA policy. Never part of a Kit or a Design File. */
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveConfinedFilePath } from './confined-fs.ts'

export type DesignReviewMode = 'auto' | 'continuous' | 'every-publication' | 'off'
export interface DesignReviewPolicy {
  readonly mode: DesignReviewMode
  readonly autoMergeWindowMs: number
  readonly continuousIntervalMs?: number
}
export const DEFAULT_DESIGN_REVIEW_POLICY: DesignReviewPolicy = Object.freeze({
  mode: 'auto', autoMergeWindowMs: 30_000,
})

export function parseDesignReviewPolicy(value: unknown): DesignReviewPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid project GRA policy')
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !['mode', 'autoMergeWindowMs', 'continuousIntervalMs'].includes(key))) throw new Error('Unknown GRA policy field')
  if (!['auto', 'continuous', 'every-publication', 'off'].includes(String(record.mode))) throw new Error('Invalid GRA mode')
  if (!Number.isSafeInteger(record.autoMergeWindowMs) || (record.autoMergeWindowMs as number) < 0
    || (record.autoMergeWindowMs as number) > 3_600_000) throw new Error('GRA auto merge window must be 0..3600000 milliseconds')
  if (record.continuousIntervalMs !== undefined && (!Number.isSafeInteger(record.continuousIntervalMs)
    || (record.continuousIntervalMs as number) < 60_000 || (record.continuousIntervalMs as number) > 86_400_000)) throw new Error('GRA continuous interval must be 1..1440 minutes')
  return Object.freeze({ mode: record.mode as DesignReviewMode, autoMergeWindowMs: record.autoMergeWindowMs as number,
    ...(record.continuousIntervalMs === undefined ? {} : { continuousIntervalMs: record.continuousIntervalMs as number }) })
}

export async function readDesignReviewPolicy(stateRoot: string, projectRoot = stateRoot): Promise<DesignReviewPolicy> {
  const path = await resolveConfinedFilePath(projectRoot, relative(projectRoot, join(stateRoot, 'gra-policy.json')).split(sep).join('/'))
  try { return parseDesignReviewPolicy(JSON.parse(await readFile(path, 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_DESIGN_REVIEW_POLICY
    // Corruption must not silently enable token-consuming automatic reviews.
    throw error
  }
}

export async function writeDesignReviewPolicy(stateRoot: string, value: unknown, projectRoot = stateRoot): Promise<DesignReviewPolicy> {
  const policy = parseDesignReviewPolicy(value)
  const path = relative(projectRoot, join(stateRoot, 'gra-policy.json')).split(sep).join('/')
  await resolveConfinedFilePath(projectRoot, path)
  await mkdir(stateRoot, { recursive: true })
  const target = await resolveConfinedFilePath(projectRoot, path)
  const temporary = join(stateRoot, `gra-policy.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify(policy) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  } finally { await rm(temporary, { force: true }) }
  return policy
}

/** Admission only; executor owns immutable snapshots, completion and errors. */
export class DesignReviewPublicationQueue<T extends { readonly checkpoint: string }> {
  private policy: DesignReviewPolicy
  private readonly seen = new Set<string>()
  private pending: { target: T; mergeable: boolean }[] = []
  private dueAt = 0
  constructor(policy: DesignReviewPolicy = DEFAULT_DESIGN_REVIEW_POLICY) { this.policy = parseDesignReviewPolicy(policy) }
  configure(policy: DesignReviewPolicy): void {
    const next = parseDesignReviewPolicy(policy)
    if(next.mode==='every-publication')this.dueAt=0
    else if(next.mode==='auto'&&this.policy.mode==='auto'&&this.pending.at(-1)?.mergeable) {
      this.dueAt=Math.max(0,this.dueAt+next.autoMergeWindowMs-this.policy.autoMergeWindowMs)
    }
    this.policy = next
    if (policy.mode === 'off' || policy.mode === 'continuous') this.pending = []
    // Keep previously admitted every-publication targets when changing modes.
  }
  publish(target: T, now: number): boolean {
    if (this.policy.mode === 'off' || this.policy.mode === 'continuous' || this.seen.has(target.checkpoint)) return false
    if(this.pending.length >= 10000 && !(this.policy.mode === 'auto' && this.pending.at(-1)?.mergeable)) {
      throw new Error('GRA pending publication limit exceeded; finish queued reviews before admitting more')
    }
    this.seen.add(target.checkpoint)
    const entry = { target, mergeable: this.policy.mode === 'auto' }
    const last = this.pending.at(-1)
    if (entry.mergeable && last?.mergeable) this.pending[this.pending.length - 1] = entry
    else this.pending.push(entry)
    this.dueAt = this.policy.mode === 'auto' ? now + this.policy.autoMergeWindowMs : now
    return true
  }
  take(now: number, immediate = false): T | undefined {
    if (!immediate && this.pending[0]?.mergeable && now < this.dueAt) return undefined
    return this.pending.shift()?.target
  }
  get size(): number { return this.pending.length }
  latest(): T | undefined { return this.pending.at(-1)?.target }
  delay(now: number): number { return this.pending[0]?.mergeable ? Math.max(0, this.dueAt - now) : 0 }
  snapshot(): unknown {
    return { schemaVersion: 1, policy: this.policy, seen: [...this.seen], pending: this.pending, dueAt: this.dueAt }
  }
  static restore<T extends { readonly checkpoint: string }>(value: unknown, validateTarget: (value: unknown) => T): DesignReviewPublicationQueue<T> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid persisted GRA queue')
    const data = value as Record<string, unknown>
    if (data.schemaVersion !== 1 || !Array.isArray(data.seen) || !Array.isArray(data.pending)
      || data.pending.length > 10000
      || typeof data.dueAt !== 'number' || !Number.isSafeInteger(data.dueAt) || data.dueAt < 0) throw new Error('Invalid persisted GRA queue')
    const queue = new DesignReviewPublicationQueue<T>(parseDesignReviewPolicy(data.policy))
    for (const checkpoint of data.seen) {
      if (typeof checkpoint !== 'string' || !checkpoint || checkpoint.length > 256) throw new Error('Invalid GRA queue identity')
      queue.seen.add(checkpoint)
    }
    for (const entry of data.pending) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.mergeable !== 'boolean') throw new Error('Invalid GRA pending entry')
      const target = validateTarget(entry.target)
      if (!queue.seen.has(target.checkpoint) || queue.pending.some(entry => entry.target.checkpoint === target.checkpoint)) throw new Error('Invalid GRA pending identity')
      queue.pending.push({target, mergeable: entry.mergeable})
    }
    queue.dueAt = data.dueAt
    return queue
  }
}

/** Online-only cadence; never catches up missed ticks or queues overlapping callbacks. */
export class DesignContinuousReviewClock {
  private timer?: ReturnType<typeof setTimeout>
  private key = ''
  private generation = 0
  private closed = false
  private readonly tick: () => Promise<void>
  private readonly onError: (error: unknown) => void
  constructor(tick: () => Promise<void>, onError: (error: unknown) => void) {
    this.tick = tick
    this.onError = onError
  }
  configure(policy: DesignReviewPolicy): void {
    const interval = policy.continuousIntervalMs ?? 600_000
    const key = policy.mode === 'continuous' ? String(interval) : ''
    if (this.closed || this.key === key) return
    this.key = key
    const generation = ++this.generation
    clearTimeout(this.timer)
    if (!key) return
    const schedule = () => {
      this.timer = setTimeout(async () => {
        if (this.closed || generation !== this.generation) return
        try { await this.tick() } catch (error) { this.onError(error) }
        if (!this.closed && generation === this.generation) schedule()
      }, interval)
      this.timer.unref?.()
    }
    schedule()
  }
  close(): void { this.closed = true; this.generation++; clearTimeout(this.timer) }
}
