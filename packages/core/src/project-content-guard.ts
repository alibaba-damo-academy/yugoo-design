/** Host-owned actual page lifecycle. Expiry is unknown, never a save or discard receipt. */
export interface PanelDraftObservation {
  projectId: string; pageId: string; sequence: number; dirty: boolean; saving: boolean
  lifecycle?: 'opened' | 'observed' | 'closed'
}
export class ProjectContentPanelGuard {
  private readonly pages = new Map<string, { sequence: number; dirty: boolean; saving: boolean; observed: boolean; observedAt: number }>()
  private readonly closedSequences = new Map<string, number>()
  constructor(private readonly projectId: string, private readonly lifetimeMs = 30_000, private readonly now = Date.now) {}
  observe(input: PanelDraftObservation): void {
    if (input.projectId !== this.projectId || !/^[a-f0-9-]{36}$/u.test(input.pageId)
      || !Number.isSafeInteger(input.sequence) || input.sequence < 1
      || typeof input.dirty !== 'boolean' || typeof input.saving !== 'boolean'
      || input.lifecycle && !['opened', 'observed', 'closed'].includes(input.lifecycle)) throw new Error('content upgrade: invalid bound Panel observation')
    const prior = this.pages.get(input.pageId)
    if (input.sequence <= (prior?.sequence ?? this.closedSequences.get(input.pageId) ?? 0)) throw new Error('content upgrade: stale Panel observation')
    if (input.lifecycle === 'closed') {
      if (!prior?.observed || prior.dirty || prior.saving || input.dirty || input.saving) throw new Error('content upgrade: closing a page cannot discard an unknown or unsaved draft')
      this.pages.delete(input.pageId)
      this.rememberClosed(input.pageId, input.sequence)
      return
    }
    if (!prior && this.pages.size >= 64) throw new Error('content upgrade: too many Panel pages')
    // Reopening renews routing identity only. It cannot clear the previous draft.
    this.pages.set(input.pageId, input.lifecycle === 'opened'
      ? { sequence: input.sequence, dirty: prior?.dirty ?? false, saving: prior?.saving ?? false, observed: false, observedAt: this.now() }
      : { ...input, observed: true, observedAt: this.now() })
  }
  private rememberClosed(pageId: string, sequence: number): void {
    this.closedSequences.delete(pageId)
    this.closedSequences.set(pageId, sequence)
    while (this.closedSequences.size > 256) this.closedSequences.delete(this.closedSequences.keys().next().value!)
  }
  disconnected(): readonly { pageId: string; sequence: number }[] {
    return [...this.pages].filter(([, page]) => this.now() - page.observedAt >= this.lifetimeMs)
      .map(([pageId, page]) => ({ pageId, sequence: page.sequence }))
  }
  /** Call only after actual user confirmation, using the exact displayed snapshot. */
  discardDisconnected(snapshot: readonly { pageId: string; sequence: number }[]): void {
    for (const item of snapshot) {
      const current = this.pages.get(item.pageId)
      if (!current || current.sequence !== item.sequence || this.now() - current.observedAt < this.lifetimeMs) throw new Error('content upgrade: disconnected page changed; no draft was discarded')
    }
    for (const item of snapshot) { this.pages.delete(item.pageId); this.rememberClosed(item.pageId, item.sequence) }
  }
  assertQuiescent(): void {
    for (const page of this.pages.values()) {
      if (this.now() - page.observedAt >= this.lifetimeMs) throw new Error('content upgrade: a Panel page disconnected; reconnect it or explicitly discard its abandoned draft')
      if (!page.observed) throw new Error('content upgrade: Panel draft observation is missing; reconnect its page')
      if (page.dirty || page.saving) throw new Error('content upgrade: preserve or settle every Panel draft before upgrading')
    }
  }
}
