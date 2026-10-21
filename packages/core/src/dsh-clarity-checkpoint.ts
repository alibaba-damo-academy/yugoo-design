/** Shared DSH clarity evaluation for one already-settled, immutable checkpoint. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type DesignService from './design-service.ts'
import type { RegisteredDesignProject } from './design-project-registry.ts'
import type { DesignClarityAuthority } from './design-clarity-authority.ts'
import type { DesignClarityReportedPayload, DesignKit } from './types.ts'
import { designClarityScopeDigest, renderDesignClarityUserContext } from './design-clarity-context.ts'
import { designClarityDigest, designClarityInputMatches } from './design-clarity-report.ts'
import { createDshAdvisoryAgent } from './dsh-advisory-agent.ts'
import { evaluatePublishedDesignClarity, type ClaritySubagentStart } from './dsh-clarity-evaluator.ts'
import { designSessionEvents } from './dsh-session-events.ts'
import { projectKitContentHash } from './project-content.ts'
import { nodeFs } from './service-tools.ts'

type ClarityDesign = Pick<DesignService,
  | 'selectedProjectForAgent'
  | 'requireKitForAgent'
  | 'designFilesForProject'
  | 'readClarityAuthority'
  | 'advisoryEvidence'
  | 'reportEvaluatedClarity'>

export type DesignClarityCheckpointResult =
  | { readonly status: 'updated' | 'unchanged'; readonly report: DesignClarityReportedPayload }
  | { readonly status: 'stale' | 'failed'; readonly summary: string }

/** Shared read-only admission fence; promotion still rechecks under its lane. */
export async function currentDesignClarityCheckpoint(request: {
  readonly design: ClarityDesign; readonly agent: Agent; readonly project: RegisteredDesignProject
  readonly kit: DesignKit; readonly commit: string; readonly scopeDigest: string; readonly kitHash: string; readonly signal: AbortSignal
}): Promise<string | undefined> {
  const { design, agent, project, kit, commit, scopeDigest, kitHash, signal } = request
  if (signal.aborted) return undefined
  const selected = await design.selectedProjectForAgent(agent, signal)
  if (selected?.projectId !== project.projectId || selected.root !== project.root
    || selected.designFilesRoot !== project.designFilesRoot
    || selected.kit?.name !== kit.name || selected.kit.version !== kit.version
    || projectKitContentHash(design.requireKitForAgent(agent)) !== kitHash
    || designClarityScopeDigest(designSessionEvents(agent.session)) !== scopeDigest) return undefined
  const files = await design.designFilesForProject(agent, project.projectId, nodeFs, signal)
  const head = await files.head(signal)
  if (head === undefined || (head !== commit && !await files.sameDesignEvidenceAt(head, commit, signal))) return undefined
  const finalSelection = await design.selectedProjectForAgent(agent, signal)
  return !signal.aborted && finalSelection?.projectId === project.projectId
    && finalSelection.root === project.root && finalSelection.designFilesRoot === project.designFilesRoot
    && finalSelection.kit?.name === kit.name && finalSelection.kit.version === kit.version
    && projectKitContentHash(design.requireKitForAgent(agent)) === kitHash
    && designClarityScopeDigest(designSessionEvents(agent.session)) === scopeDigest ? head : undefined
}

export async function designClarityCheckpointCurrent(request: Parameters<typeof currentDesignClarityCheckpoint>[0]): Promise<boolean> {
  return await currentDesignClarityCheckpoint(request) !== undefined
}

/**
 * Assess one server-selected saved commit through the existing native readonly
 * evaluator and clarity authority. The caller owns admission, single-flight and
 * cancellation; call only after its save and handoff transaction has settled,
 * outside the project mutation lane. This function never saves or continues a
 * Bundle, wakes the main Agent, or chooses a different model/runtime.
 */
export async function evaluateDesignClarityCheckpoint(request: {
  readonly design: ClarityDesign
  readonly agent: Agent
  readonly project: RegisteredDesignProject
  readonly kit: DesignKit
  readonly commit: string
  /** Actual Host turn associated with this request, not a synthetic tool call. */
  readonly turn: number
  readonly signal: AbortSignal
  /** Scripted test seam; production uses the existing native readonly factory. */
  readonly start?: ClaritySubagentStart
}): Promise<DesignClarityCheckpointResult> {
  const { design, agent, project, kit, commit, signal } = request
  const stale = (summary: string): DesignClarityCheckpointResult => ({ status: 'stale', summary })
  let capturedScope: string | undefined
  let capturedKitHash: string | undefined
  try {
    if (!Number.isSafeInteger(request.turn) || request.turn < 0) {
      throw new Error('design clarity checkpoint: an actual non-negative Host turn is required')
    }
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) {
      throw new Error('design clarity checkpoint: a full immutable commit is required')
    }
    if (signal.aborted) return stale('Design clarity assessment was cancelled.')
    // Bundle overrides may recompose the same closure into fresh objects. Pin
    // authored content once, not object identity or a later-mutated original.
    const kitHash = projectKitContentHash(kit)
    capturedKitHash = kitHash
    const events = [...designSessionEvents(agent.session)]
    const scopeDigest = designClarityScopeDigest(events)
    if (!/^[a-f0-9]{64}$/.test(scopeDigest)) throw new Error('design clarity checkpoint: a valid scope digest is required')
    capturedScope = scopeDigest
    const userContext = renderDesignClarityUserContext(events)

    const current = (): Promise<boolean> => designClarityCheckpointCurrent({ design, agent, project, kit, commit, scopeDigest, kitHash, signal })
    const matches = (authority: DesignClarityAuthority | undefined): authority is DesignClarityAuthority =>
      authority?.projectId === project.projectId && authority.assessedCheckpoint === commit
      && designClarityInputMatches(authority.report, { kit: kit.name, version: kit.version,
        scopeDigest, kitContentHash: kitHash })

    // This lookup only reads historical authority for the already captured
    // project. It neither starts an Agent nor promotes/re-signs that authority.
    // One full fence AFTER the awaited read covers both cache reuse and child
    // creation; repeating it before this readonly lookup adds registry/Git
    // launches without narrowing the checked admission boundary.
    const previous = await design.readClarityAuthority(project.projectId, signal)
    if (!await current()) return stale('The Design Project, Kit, checkpoint or conversation scope changed.')
    if (matches(previous)) return { status: 'unchanged', report: previous.report }

    const start = request.start ?? createDshAdvisoryAgent((parent, checkpoint, cancellation) =>
      design.advisoryEvidence(parent, checkpoint, cancellation, { expectedProjectId: project.projectId })).start
    const evaluated = await evaluatePublishedDesignClarity({
      start,
      parent: agent,
      provider: 'spawn',
      projectRoot: project.root,
      designFilesRoot: project.designFilesRoot,
      commit,
      kitName: kit.name,
      kitVersion: kit.version,
      kit,
      ...(userContext === undefined ? {} : { userContext }),
      signal,
      timeoutMs: 120_000,
    })
    if (!await current()) return stale('The Design Project, Kit, checkpoint or conversation scope changed during assessment.')
    const report: DesignClarityReportedPayload = Object.freeze({
      origin: 'evaluator',
      digest: designClarityDigest(evaluated.assessment, kit.name, kit.version),
      scopeDigest,
      kitContentHash: kitHash,
      turn: request.turn,
      callId: evaluated.evaluationId,
      kit: kit.name,
      version: kit.version,
      ...evaluated.assessment,
    })
    // The service repeats the original-project and scope checks atomically at
    // promotion, closing the asynchronous gap after current() above.
    const promotion = await design.reportEvaluatedClarity(agent, commit, report, {
      expectedProjectId: project.projectId,
      signal,
    })
    if (promotion.status === 'stale') return stale('The assessment no longer matches the current Design checkpoint or scope.')
    const authority = await design.readClarityAuthority(project.projectId, signal)
    if (!await current()) return stale('The Design Project, Kit, checkpoint or conversation scope changed after assessment.')
    if (!matches(authority)) throw new Error('design clarity checkpoint: promoted authority does not match the requested assessment pins')
    return { status: promotion.status, report: authority.report }
  } catch (error) {
    if (signal.aborted) return stale('Design clarity assessment was cancelled.')
    // A service fence may throw when selection changes across an await. Keep
    // that expected lifecycle outcome distinct from an evaluator/storage error.
    try {
      const selected = await design.selectedProjectForAgent(agent, signal)
      if (selected?.projectId !== project.projectId || selected.root !== project.root
        || selected.designFilesRoot !== project.designFilesRoot
        || selected.kit?.name !== kit.name || selected.kit.version !== kit.version
        || (capturedKitHash !== undefined && projectKitContentHash(design.requireKitForAgent(agent)) !== capturedKitHash)
        || (capturedScope !== undefined
          && designClarityScopeDigest(designSessionEvents(agent.session)) !== capturedScope)) {
        return stale('The Design Project, Kit or conversation scope changed during assessment.')
      }
    } catch { /* An unavailable identity cannot turn a real service error into success. */ }
    return { status: 'failed', summary: (error instanceof Error ? error.message : String(error)).slice(0, 1_000) }
  }
}
