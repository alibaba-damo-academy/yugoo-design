/** Per-tab draft routing survives reload. Stored flags describe uncertainty, never saved bytes. */
import { browserRandomUuid } from './browser-uuid.ts'
export interface PanelDraftFlags { dirty: boolean; saving: boolean }
export interface PanelDraftMessage extends PanelDraftFlags {
  projectId: string; pageId: string; sequence: number; lifecycle: 'opened' | 'observed' | 'closed'
}
interface Stored extends PanelDraftFlags { pageId: string; sequence: number }
const documentPages = new Map<string, Stored>()
export class PanelDraftLease {
  private state: Stored
  private flags?: PanelDraftFlags
  private queue = Promise.resolve()
  readonly unresolved: boolean
  private resolved = false
  constructor(private readonly key: string, private readonly projectId: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
    private readonly send: (message: PanelDraftMessage) => Promise<unknown>, resume: boolean) {
    let prior = documentPages.get(key)
    if (!prior && resume) {
      try {
        const value = JSON.parse(storage?.getItem(key) ?? 'null')
        if (value && /^[a-f0-9-]{36}$/u.test(value.pageId) && Number.isSafeInteger(value.sequence)
          && value.sequence >= 0 && typeof value.dirty === 'boolean' && typeof value.saving === 'boolean') prior = value
      } catch { /* Missing or invalid storage cannot assert a clean prior page. */ }
    }
    this.state = prior ?? { pageId: browserRandomUuid(), sequence: 0, dirty: false, saving: false }
    this.unresolved = this.state.dirty || this.state.saving
    documentPages.set(key, this.state)
  }
  private publish(lifecycle: PanelDraftMessage['lifecycle'], flags: PanelDraftFlags): void {
    Object.assign(this.state, flags, { sequence: this.state.sequence + 1 })
    try { this.storage?.setItem(this.key, JSON.stringify(this.state)) } catch { /* Failed storage leaves server expiry unknown. */ }
    const message = { ...this.state, projectId: this.projectId, lifecycle }
    this.queue = this.queue.then(() => this.send(message)).then(() => undefined, () => undefined)
  }
  open(): void { this.publish('opened', this.state) }
  report(flags: PanelDraftFlags): void {
    this.flags = flags
    if (this.unresolved && !this.resolved) return
    this.publish('observed', flags)
  }
  /** Invoked only by a real browser confirmation, never a timer or model argument. */
  discardPriorDraft(): void { this.resolved = true; if (this.flags) this.report(this.flags) }
  heartbeat(): void { if (this.flags) this.report(this.flags) }
  close(): void {
    if (this.flags && !this.flags.dirty && !this.flags.saving && (!this.unresolved || this.resolved)) this.publish('closed', this.flags)
  }
  async flushed(): Promise<void> { await this.queue }
}
