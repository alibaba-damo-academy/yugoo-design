/** Trial transport: hosts own snapshots, isolation and native execution. */
export type StudioTrialSource = {
  readonly kind: 'installed' | 'panel-draft'
  readonly kit: { readonly name: string; readonly version: string }
  readonly bundle: { readonly name: string; readonly version: string }
  readonly id?: string
  readonly expectedRevision?: number
}
export interface StudioTrialRecord {
  readonly locale?: 'zh-CN' | 'en-US'
  readonly id: string
  readonly createdAt?: string
  readonly source: StudioTrialSource
  readonly status: 'preparing' | 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'stopped' | 'unknown'
  readonly task?: string
  readonly inputMode?: 'generated' | 'manual'
  readonly sourceLabel: string
  readonly projectLabel: string
  readonly resultUrl?: string
  readonly message?: string
}
export interface StudioTrialClient {
  /** Transport/session evidence only; never a model turn or execution receipt. */
  checkConnection?(): Promise<{ status: 'available' | 'unavailable' | 'unknown' }>
  panelUrl?(record: StudioTrialRecord): string | undefined
  list(): Promise<readonly StudioTrialRecord[]>
  start(input: { source: StudioTrialSource; task?: string; locale?: 'zh-CN' | 'en-US' }): Promise<StudioTrialRecord>
  read(id: string): Promise<StudioTrialRecord>
  stop(id: string): Promise<StudioTrialRecord>
  remove(id: string): Promise<void>
}
export interface StudioTrialState {
  readonly busy: boolean
  readonly history?: readonly StudioTrialRecord[]
  readonly record?: StudioTrialRecord
  readonly error?: string
}
/** Bounded non-generating probe. Legacy/invalid evidence is unknown, not ready. */
export async function checkStudioTrialConnection(client: StudioTrialClient, timeoutMs = 20000): Promise<'available' | 'unavailable' | 'unknown'> {
  if (!client.checkConnection) return 'unknown'
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const reply = await Promise.race([
      client.checkConnection(),
      new Promise<{ status: 'unknown' }>(resolve => { timer = setTimeout(() => resolve({ status: 'unknown' }), timeoutMs) }),
    ])
    return reply?.status === 'available' ? 'available' : reply?.status === 'unavailable' ? 'unavailable' : 'unknown'
  } catch { return 'unavailable' }
  finally { if (timer !== undefined) clearTimeout(timer) }
}
export const trialActive = (record?: StudioTrialRecord): boolean => !!record && !['completed', 'failed', 'stopped'].includes(record.status)
export const trialBlocksNewRun = (record?: StudioTrialRecord): boolean => trialActive(record) && record?.status !== 'waiting'

/** Do not navigate to scripts, credentials or remote sites returned as a result. */
export function localTrialUrl(value?: string): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}

export class StudioTrialController {
  private state: StudioTrialState = Object.freeze({ busy: false })
  private listeners = new Set<() => void>()
  private generation = 0
  private reading = false
  private recovered = false
  private owns(record: StudioTrialRecord): boolean {
    const source = record?.source
    return !!source && source.kind === this.source.kind
      && source.kit?.name === this.source.kit.name && source.kit.version === this.source.kit.version
      && source.bundle?.name === this.source.bundle.name && source.bundle.version === this.source.bundle.version
      && source.id === this.source.id
  }
  private readonly source: StudioTrialSource
  constructor(private readonly client: StudioTrialClient, source: StudioTrialSource) {
    this.source = Object.freeze({ ...source, kit: Object.freeze({ ...source.kit }), bundle: Object.freeze({ ...source.bundle }) })
  }
  getSnapshot = (): StudioTrialState => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private update(state: StudioTrialState): void { this.state = Object.freeze(state); for (const listener of this.listeners) listener() }
  async recover(): Promise<void> {
    if (this.state.busy) return
    const generation = ++this.generation
    this.update({ ...this.state, busy: true, error: undefined })
    try {
      const records = await this.client.list()
      const history = records.filter(record => this.owns(record)).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      if (generation === this.generation) {
        this.recovered = true
        this.update({ busy: false, history, record: history.find(record => record.id === this.state.record?.id) ?? history.find(trialActive) ?? history[0] })
      }
    } catch (error) {
      if (generation === this.generation) this.update({ ...this.state, busy: false, error: String(error instanceof Error ? error.message : error) })
    }
  }
  select(id: string): void {
    if (this.state.busy) return
    const record = this.state.history?.find(record => record.id === id)
    if (record) { ++this.generation; this.update({ ...this.state, record, error: undefined }) }
  }
  async start(task: string, locale?: 'zh-CN' | 'en-US'): Promise<void> {
    if (!this.recovered) { this.update({ ...this.state, error: 'Load existing trials before starting a new one.' }); return }
    if (this.state.busy || this.state.history?.some(trialBlocksNewRun)) return
    if (!task.trim()) { this.update({ ...this.state, error: 'Task is required.' }); return }
    await this.perform(() => this.client.start({ source: this.source, task, ...(locale ? { locale } : {}) }))
  }
  /** Only an explicit first-open click requests native preparation, never mounting or polling. */
  async startExample(locale?: 'zh-CN' | 'en-US'): Promise<void> {
    if (this.state.busy) return
    if (!this.recovered) await this.recover()
    if (!this.recovered || this.state.busy || this.state.history?.length) return
    await this.perform(() => this.client.start({ source: this.source, ...(locale ? { locale } : {}) }))
  }
  async refresh(): Promise<void> {
    if (this.reading || this.state.busy || !this.state.record) return
    const id = this.state.record.id, revision = this.state.record.source.expectedRevision, generation = this.generation
    this.reading = true
    try {
      const record = await this.client.read(id)
      if (generation === this.generation && this.state.record?.id === id) {
        if (record.id !== id || !this.owns(record) || record.source.expectedRevision !== revision) throw new Error('Trial response identity mismatch.')
        this.update({ ...this.state, busy: false, error: undefined, record, history: this.state.history?.map(item => item.id === id ? record : item) })
      }
    } catch (error) {
      if (generation === this.generation) this.update({ ...this.state, error: String(error instanceof Error ? error.message : error) })
    } finally { this.reading = false }
  }
  async stop(): Promise<void> {
    const record = this.state.record
    if (this.state.busy || !trialActive(record)) return
    await this.perform(() => this.client.stop(record!.id), record!.id)
  }
  async remove(): Promise<void> {
    const record = this.state.record
    if (this.state.busy || !record || trialActive(record)) return
    await this.perform(async () => { await this.client.remove(record.id); return undefined })
  }
  private async perform(operation: () => Promise<StudioTrialRecord | undefined>, expectedId?: string): Promise<void> {
    const revision = expectedId ? this.state.record?.source.expectedRevision : this.source.expectedRevision
    const generation = ++this.generation
    this.update({ ...this.state, busy: true, error: undefined })
    try {
      const record = await operation()
      if (record && (!this.owns(record) || record.source.expectedRevision !== revision)) throw new Error('Trial response source mismatch.')
      if (expectedId && record?.id !== expectedId) throw new Error('Trial response identity mismatch.')
      if (generation === this.generation) {
        const previousId = this.state.record?.id
        const history = (this.state.history ?? []).filter(item => item.id !== (record?.id ?? previousId))
        this.update({ busy: false, record, history: record ? [record, ...history] : history })
      }
    } catch (error) {
      if (generation === this.generation) this.update({ ...this.state, busy: false, error: String(error instanceof Error ? error.message : error) })
    }
  }
}
