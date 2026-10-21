/** DSH adapter for one host-neutral official Design advisory analysis. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { DesignAdvisory } from './design-advisory.ts'
import { knowledgeReviewSchema, knowledgeReviewGuidance, splitKnowledgeReviewResult, type KnowledgeReviewObservation, type KnowledgeReviewRetraction } from './design-knowledge-review.ts'
import type { CompiledDesignRelationVocabulary } from './design-relation-vocabulary.ts'
import { KNOWLEDGE_AGENTIC_GUIDANCE } from './design-knowledge-query.ts'
import { publishDshDesignAdvisory, type AdvisoryPublishPort } from './dsh-advisory.ts'
import {
  officialAdvisoryProfile,
  type OfficialAdvisoryInput,
  type OfficialAdvisoryProfileId,
} from './official-advisory-profiles.ts'

/** Public DSH one-shot subagent operation used by advisory analysis. */
export interface AdvisorySubagentPort {
  start(provider: string, request: Parameters<SubagentRuntime['start']>[1] & {
    readonly reviewCommit: string
    readonly knowledgeContext?: string
    /** Opt in to complete small original facts from the same immutable reader. */
    readonly includeSmallSnapshot?: boolean
  }): Promise<{
    /** Actual native child Session id, usable as assessment provenance. */
    readonly id: Agent['id']
    readonly result: Promise<{ readonly stopReason: string; readonly structured?: unknown }>
    dispose(): Promise<void>
  }>
}

/** One attached foreground Bundle whose incomplete output is outside a review run. */
export interface ForegroundDesignWork {
  readonly skillName: string
  readonly brief?: string
}

/** JSON Schema accepted by the installed DSH subagent service. */
type DshOutputSchema = NonNullable<Parameters<SubagentRuntime['start']>[1]['outputSchema']>

/** One pinned official advisory invocation. */
export interface DshAdvisoryRunRequest {
  readonly design: Pick<AdvisoryPublishPort, 'publishAdvisory'>
  readonly parent: Agent
  readonly provider: string
  readonly profile: OfficialAdvisoryProfileId
  readonly input: OfficialAdvisoryInput
  /** Selected Design Project Git repository inspected by the review Agent. */
  readonly projectRoot: string
  /** Authoritative current Design Files tree inside the selected project. */
  readonly designFilesRoot: string
  /** Published Git checkpoint matching the pinned DesignJournal revision. */
  readonly reviewCommit: string
  /** Same stored graph used by other consumers, not an independent Agent graph. */
  readonly knowledgeContext?: string
  readonly handlingMemory?: string
  /** Exact selected Kit vocabulary used by both the Agent schema and writeback. */
  readonly relationVocabulary?: CompiledDesignRelationVocabulary
  /** Transient attached work to exclude from this review; it is not Design evidence. */
  readonly foregroundDesignWork?: ForegroundDesignWork
  readonly signal: AbortSignal
  /**
   * Invoked exactly once after the reviewer subagent really started (the host
   * `subagents.start` promise resolved). A rejected start never fires it, so a
   * caller may only present the profile as running from this point.
   */
  readonly onStarted?: () => void
  /** Recheck exact input revisions after the child settles. */
  stillCurrent(input: OfficialAdvisoryInput): boolean | Promise<boolean>
}

/** Outcome of one non-blocking advisory analysis. */
export type DshAdvisoryRunOutcome =
  | { readonly status: 'published'; readonly advisory: DesignAdvisory }
  | { readonly status: 'stale' }

/** Parsed current advice before the caller chooses the current review set. */
export type DshAdvisoryAnalysisOutcome =
  | { readonly status: 'produced'; readonly advisory: DesignAdvisory; readonly knowledgeRelations?: readonly KnowledgeReviewObservation[]; readonly knowledgeRetractions?: readonly KnowledgeReviewRetraction[]; readonly knowledgeError?: string }
  | { readonly status: 'stale' }

const ADVISORY_INVESTIGATION_STRATEGY = [
  'Investigate the current Design Project yourself instead of assuming that the prompt contains its files.',
  'The published Git commit named below is the complete review authority. Never use live worktree file content as Design evidence.',
  'Use list, read and literal grep for files in that commit. Use read_skill_resource with an exact manifest-listed Bundle binding and path for its method/schema. These resources explain representation, not new requirements. Missing resources are explicit diagnostics; never search the filesystem or substitute another version. Start from the relevant files and follow references only as needed; do not read every file by default.',
  'Never run a command that writes files, changes Git state, installs software, starts background work, or modifies the Design Project.',
  'A Design State summary or Knowledge index from the same published commit may be used when present, but neither is required and every finding must be verified against Design Files in that commit.',
  'Cite the project-relative files that support each emitted item. Return an empty result when the profile-specific threshold is not met.',
].join(' ')

/**
 * Run one official analysis on the host's subagent plane without publishing it.
 * The request deliberately omits `agentOptions`, so DSH applies its public
 * parent-to-child model route and the deployment's existing credential plane.
 * @param request - exact parent, profile, input pins, and selected project paths.
 * @param subagents - DSH one-shot subagent capability.
 * @returns produced current advice or a stale outcome after post-run pin checks.
 */
export async function analyzeDshDesignAdvisory(
  request: DshAdvisoryRunRequest,
  subagents: AdvisorySubagentPort,
): Promise<DshAdvisoryAnalysisOutcome> {
  const profile = officialAdvisoryProfile(request.profile)
  const input = profile.parseInput(request.input)
  const run = await subagents.start(request.provider, {
    reviewCommit: request.reviewCommit,
    ...(request.knowledgeContext === undefined ? {} : { knowledgeContext: request.knowledgeContext }),
    label: `Design ${request.profile}`,
    parent: request.parent,
    signal: request.signal,
    outputSchema: (request.knowledgeContext ? knowledgeReviewSchema(profile.outputSchema, request.relationVocabulary) : profile.outputSchema) as unknown as DshOutputSchema,
    toolFilter: { allow: [] },
    prompt: [{
      type: 'text',
      text: [
        profile.prompt,
        request.handlingMemory ?? '',
        'Files under design_files/_experiences/ are derived demonstrations, not authoritative design evidence. Do not use their assumptions or rendered content as new requirements or findings; inspect the original owning Bundle files instead.',
        '',
        `Investigation strategy: ${ADVISORY_INVESTIGATION_STRATEGY}`,
        '',
        'Language: Write every natural-language output field in the same primary natural language as Pinned input.userContextSummary. If userContextSummary is absent, use the dominant natural language in the files you inspect. Keep identifiers, enum values, references, and schema keys unchanged.',
        '',
        'Pinned input:',
        JSON.stringify(input),
        '',
        'Design Project:',
        `Git repository root: ${JSON.stringify(request.projectRoot)}`,
        `Design Files root: ${JSON.stringify(request.designFilesRoot)}`,
        `Published review commit: ${JSON.stringify(request.reviewCommit)}`,
        ...(request.knowledgeContext ? ['Stored Design KAG (bounded retrieval; candidate relationships are not confirmed facts):', request.knowledgeContext, knowledgeReviewGuidance(request.relationVocabulary), KNOWLEDGE_AGENTIC_GUIDANCE,
          'Use design_query_knowledge for additional pages, exact endpoint IDs or text searches. Always pass project and checkpoint from this context, and pass knowledgeRevision as revision. Keep that revision for every read; do not switch to a newer graph mid-review. This tool is read-only; output validated graph observations through knowledgeRelations, never a write tool.'] : []),
        ...(request.foregroundDesignWork === undefined ? [] : [
          '',
          'Foreground Design work (transient exclusion, not Design evidence):',
          JSON.stringify(request.foregroundDesignWork),
          'This only explains what is being produced concurrently. Do not exclude that entire Bundle from the published review commit: review all content present in the commit, while ignoring any newer worktree content.',
        ]),
      ].join('\n'),
    }],
  })
  // The reviewer subagent genuinely exists from this point only; a rejected
  // start must never surface a running phase.
  request.onStarted?.()
  try {
    const result = await run.result
    request.signal.throwIfAborted()
    if (result.stopReason !== 'completed' || result.structured === undefined) {
      throw new Error(`design advisory: subagent ended with ${JSON.stringify(result.stopReason)} without a structured result`)
    }
    let original = result.structured
    if (request.knowledgeContext && original !== null && typeof original === 'object' && !Array.isArray(original)) {
      const { knowledgeRelations: _extension, knowledgeRetractions: _retractions, ...advisory } = original as Record<string, unknown>
      original = advisory
    }
    // The original profile remains authoritative for advice validity. An invalid
    // optional graph extension cannot discard an otherwise valid recommendation.
    const output = profile.parseOutput(original)
    let split: ReturnType<typeof splitKnowledgeReviewResult> | undefined, knowledgeError: string | undefined
    if (request.knowledgeContext) {
      try { split = splitKnowledgeReviewResult(result.structured) }
      catch (error) { knowledgeError = String(error).slice(0, 1000) }
    }
    if (!await request.stillCurrent(input)) return { status: 'stale' }
    const advisory = profile.project(input, output)
    return { status: 'produced', advisory, ...(split ? { knowledgeRelations: split.observations, knowledgeRetractions:split.retractions } : {}), ...(knowledgeError ? { knowledgeError } : {}) }
  } finally {
    await run.dispose()
  }
}

/**
 * Analyze and immediately publish one advisory.
 * Independent schedulers may use `analyzeDshDesignAdvisory` and publish the
 * produced result without waiting for any sibling profile.
 * @param request - exact parent, profile, input pins, and selected project paths.
 * @param subagents - DSH one-shot subagent capability.
 * @returns a published advisory or a stale outcome.
 */
export async function runDshDesignAdvisory(
  request: DshAdvisoryRunRequest,
  subagents: AdvisorySubagentPort,
): Promise<DshAdvisoryRunOutcome> {
  const outcome = await analyzeDshDesignAdvisory(request, subagents)
  if (outcome.status === 'stale') return outcome
  await publishDshDesignAdvisory(request.design, request.parent, outcome.advisory)
  return { status: 'published', advisory: outcome.advisory }
}
