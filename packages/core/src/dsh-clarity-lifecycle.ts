/** Synchronous Bundle assessment plus passive legacy Panel receipt admission. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type DesignService from './design-service.ts'
import type { DesignClarityActivity } from './types.ts'
import type { DesignClarityRuntime, SavedDesignAssessmentAdmission, SavedDesignAssessmentRequest, SettledDesignPanelSave } from './design-clarity-runtime.ts'
import { currentDesignClarityCheckpoint, evaluateDesignClarityCheckpoint, type DesignClarityCheckpointResult } from './dsh-clarity-checkpoint.ts'
import { designClarityScopeDigest } from './design-clarity-context.ts'
import { designSessionEvents } from './dsh-session-events.ts'
import { projectKitContentHash } from './project-content.ts'
import { createYugooDesignMessage } from './dsh-message-source.ts'

type AssessmentRequest = Parameters<typeof evaluateDesignClarityCheckpoint>[0]
interface Entry {
  readonly receipts: Map<string, SettledDesignPanelSave>
  readonly correlations: Map<string, string>
  activity?: DesignClarityActivity
  projectId?: string
  assessmentSequence: number
  latestStartedAssessment: number
  running?: { readonly key: string; readonly controller: AbortController; readonly signal: AbortSignal; readonly promise: Promise<DesignClarityCheckpointResult>; readonly injectSignals: Set<AbortSignal> }
}

const LIMIT = 64
function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.set(key, value)
  while (map.size > LIMIT) map.delete(map.keys().next().value!)
}

/** Joining a checkpoint never borrows another invocation's cancellation. */
function awaitAssessment(promise: Promise<DesignClarityCheckpointResult>, signal: AbortSignal): Promise<DesignClarityCheckpointResult> {
  if (signal.aborted) return Promise.resolve({ status: 'stale', summary: 'Design clarity assessment was cancelled.' })
  return new Promise((resolve, reject) => {
    const cancelled = (): void => { resolve({ status: 'stale', summary: 'Design clarity assessment was cancelled.' }) }
    signal.addEventListener('abort', cancelled, { once: true })
    promise.then(result => { signal.removeEventListener('abort', cancelled); resolve(result) },
      error => { signal.removeEventListener('abort', cancelled); reject(error) })
  })
}

/**
 * A bounded, latest-checkpoint single-flight for attached Bundle assessment.
 * Legacy Panel metadata validates settled receipts but never creates a model
 * job or activity. Panel assessment belongs to the existing main report tool.
 */
export class DshClarityLifecycle implements DesignClarityRuntime<Agent> {
  private readonly entries = new Map<Agent, Entry>()
  private disposed = false
  constructor(private readonly design: Pick<DesignService, 'assertProjectSelection' | 'outsideProjectMutation'> & AssessmentRequest['design'],
    private readonly evaluate: typeof evaluateDesignClarityCheckpoint = evaluateDesignClarityCheckpoint) {}

  private entry(agent: Agent): Entry {
    let entry = this.entries.get(agent)
    if (!entry) {
      entry = { receipts: new Map(), correlations: new Map(), assessmentSequence: 0, latestStartedAssessment: 0 }
      this.entries.set(agent, entry)
    }
    return entry
  }

  recordPanelSave(agent: Agent, receipt: SettledDesignPanelSave): void {
    if (this.disposed || agent.session.header.origin === 'subagent') return
    this.design.assertProjectSelection(agent, receipt.project.projectId)
    const entry = this.entry(agent)
    const prior = entry.receipts.get(receipt.eventId)
    if (prior) {
      if (prior.commit !== receipt.commit || prior.returnedCommit !== receipt.returnedCommit
        || prior.project.projectId !== receipt.project.projectId || prior.project.root !== receipt.project.root
        || prior.project.designFilesRoot !== receipt.project.designFilesRoot
        || prior.kitContentHash !== receipt.kitContentHash || prior.meaningful !== receipt.meaningful) {
        throw new Error('design clarity: settled save identity reused with different publication evidence')
      }
      return // An exact audit replay is not a new publication or newer checkpoint.
    }
    remember(entry.receipts, receipt.eventId, receipt)
  }

  admitPanelSave(agent: Agent, request: SavedDesignAssessmentRequest): SavedDesignAssessmentAdmission {
    if (this.disposed || agent.session.header.origin === 'subagent') return { status: 'unavailable' }
    if (!request.requestId || request.requestId.length > 256 || request.saves.length < 1 || request.saves.length > LIMIT
      || new Set(request.saves.map(save => save.eventId)).size !== request.saves.length) {
      throw new Error('design clarity: invalid saved batch correlation')
    }
    const entry = this.entry(agent)
    const correlation = JSON.stringify(request.saves)
    const prior = entry.correlations.get(request.requestId)
    if (prior !== undefined) {
      if (prior !== correlation) throw new Error('design clarity: request identity reused with a different saved batch')
      return { status: 'unchanged' }
    }
    const saves = request.saves.map(save => {
      const receipt = entry.receipts.get(save.eventId)
      if (!receipt || receipt.returnedCommit !== save.commit) throw new Error('design clarity: saved batch has no matching settled receipt')
      this.design.assertProjectSelection(agent, receipt.project.projectId)
      return receipt
    })
    if (saves.some(save => save.project.projectId !== saves[0]!.project.projectId
      || save.kitContentHash !== saves[0]!.kitContentHash)) {
      throw new Error('design clarity: saved batch crosses project or Kit input')
    }
    if (!saves.some(save => save.meaningful)) return { status: 'unchanged' }
    remember(entry.correlations, request.requestId, correlation)
    // Backward-compatible metadata only: do not enqueue activity that could
    // outlive a discarded/cancelled input or race the main Agent's assessment.
    return { status: 'unchanged' }
  }

  /** Completed Bundle calls still await this exact checkpoint before returning. */
  async assess(request: AssessmentRequest, inject = false): Promise<DesignClarityCheckpointResult> {
    if (this.disposed || request.signal.aborted) return { status: 'stale', summary: 'Design clarity assessment was cancelled.' }
    const entry = this.entry(request.agent)
    const sequence = ++entry.assessmentSequence
    let kitHash: string, scopeDigest: string, head: string | undefined
    // Reject late old batches before they can cancel a useful newer job. Reuse
    // the helper's fence rather than trusting a browser commit or live worktree.
    try {
      kitHash = projectKitContentHash(request.kit)
      scopeDigest = designClarityScopeDigest(designSessionEvents(request.agent.session))
      head = await currentDesignClarityCheckpoint({ ...request, scopeDigest, kitHash })
      if (head === undefined
        || this.disposed || this.entries.get(request.agent) !== entry) {
        if (!entry.running) entry.activity = { phase: 'stale', checkpoint: request.commit }
        return { status: 'stale', summary: 'The saved assessment input is no longer current.' }
      }
    } catch (error) {
      const result = { status: request.signal.aborted ? 'stale' as const : 'failed' as const,
        summary: (error instanceof Error ? error.message : String(error)).slice(0, 1000) }
      if (!entry.running) entry.activity = { phase: result.status, checkpoint: request.commit, summary: result.summary }
      return result
    }
    const key = JSON.stringify([request.project.projectId, request.commit, kitHash, scopeDigest])
    if (entry.running?.key === key && !entry.running.signal.aborted) {
      if (inject) entry.running.injectSignals.add(request.signal)
      return awaitAssessment(entry.running.promise, request.signal)
    }
    if (sequence < entry.latestStartedAssessment) {
      return { status: 'stale', summary: 'A newer assessment superseded this pending request.' }
    }
    // Audit-only commits may have equivalent design evidence. That permits
    // readback/currentness, not an old request cancelling useful newer work.
    if (entry.running && !entry.running.signal.aborted && head !== request.commit) {
      return { status: 'stale', summary: 'A current checkpoint assessment is already in progress.' }
    }
    entry.running?.controller.abort(new Error('A newer Design assessment superseded this checkpoint.'))
    entry.latestStartedAssessment = sequence
    const controller = new AbortController()
    const signal = AbortSignal.any([request.signal, controller.signal])
    entry.projectId = request.project.projectId
    entry.activity = { phase: 'running', checkpoint: request.commit }
    const work = { key, controller, signal, injectSignals: new Set(inject ? [request.signal] : []),
      promise: Promise.resolve<DesignClarityCheckpointResult>({ status: 'failed', summary: 'Assessment has not started.' }) }
    entry.running = work
    work.promise = Promise.resolve().then(() => this.evaluate({ ...request, signal })).catch((error: unknown): DesignClarityCheckpointResult => ({
      status: signal.aborted ? 'stale' : 'failed', summary: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    })).then(result => {
      if (this.entries.get(request.agent) !== entry || entry.running !== work) return result
      entry.running = undefined
      if ('report' in result) {
        if (entry.activity?.checkpoint === request.commit) entry.activity = undefined
        if (!signal.aborted && [...work.injectSignals].some(source => !source.aborted)) {
          const report = result.report
          const compact = { summary: report.summary.slice(0, 1500), u: { score: report.u.score, evidence: report.u.evidence.slice(0, 1200) },
            s: { score: report.s.score, evidence: report.s.evidence.slice(0, 1200) }, t: { score: report.t.score, evidence: report.t.evidence.slice(0, 1200) },
            nextGap: report.nextGap?.slice(0, 1200), scopeDigest: report.scopeDigest, kitContentHash: report.kitContentHash }
          try { request.agent.inject(createYugooDesignMessage({ notice: 'design clarity assessment updated', content: [{ type: 'text', text:
            `The saved Design checkpoint ${JSON.stringify(request.commit)} now has an objective clarity assessment (bounded summary, complete reasons remain in the project authority). ${JSON.stringify(compact)}\nUse its saved evidence and real user intent to explain a useful next action. This assessment is not an execution receipt or permission to run another Bundle. If newer input has arrived, recheck currentness rather than treating these scores as fresh.` }] })) }
          catch { /* Non-waking assistance cannot invalidate a committed assessment. */ }
        }
      } else if (entry.activity?.checkpoint === request.commit) entry.activity = { phase: result.status, checkpoint: request.commit, summary: result.summary }
      return result
    })
    return work.promise
  }

  activity(agent: Agent, projectId: string): DesignClarityActivity | undefined {
    const entry = this.entries.get(agent)
    return entry?.projectId === projectId ? entry.activity : undefined
  }
  reset(agent: Agent): void {
    this.entries.get(agent)?.running?.controller.abort(new Error('Design project selection or Agent lifecycle changed.'))
    this.entries.delete(agent)
  }
  dispose(): void {
    this.disposed = true
    for (const agent of this.entries.keys()) this.reset(agent)
  }
}
