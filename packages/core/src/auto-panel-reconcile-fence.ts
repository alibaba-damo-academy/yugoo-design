/** Prevent an older asynchronous workspace read from scheduling over a newer event. */
export class AutoPanelReconcileFence {
  private readonly latest = new Map<string, number>()
  private readonly agents = new Map<string, { sequence: number; selectionEpoch: number }>()

  event(agentId: string, sequence: number, selectionChanged: boolean): string {
    const previous = this.agents.get(agentId)
    const selectionEpoch = (previous?.selectionEpoch ?? 0) + (selectionChanged ? 1 : 0)
    this.agents.set(agentId, { sequence, selectionEpoch })
    return `${agentId}:${selectionEpoch}`
  }

  currentAgent(agentId: string, sequence: number): boolean {
    return this.agents.get(agentId)?.sequence === sequence
  }

  begin(projectId: string, sequence: number): boolean {
    if (sequence < (this.latest.get(projectId) ?? 0)) return false
    this.latest.set(projectId, sequence)
    return true
  }

  current(projectId: string, sequence: number): boolean {
    return this.latest.get(projectId) === sequence
  }

  dispose(): void { this.latest.clear(); this.agents.clear() }
}
