/**
 * Shared honest-state contract for derived Design Knowledge (KAG) and GRA
 * review freshness.
 *
 * One closed vocabulary consumed by host tools, Companion MCP, snapshot
 * injection, and Panel mappings, so no host or client keeps a second state
 * authority. Derivation is pure and read-only: assembling a status never
 * schedules maintenance, starts indexing, or mutates any store.
 *
 * State precedence (first match wins):
 *
 * | # | condition                                        | state       |
 * |---|--------------------------------------------------|-------------|
 * | 1 | derived store is rebuilding                      | unavailable |
 * | 2 | a maintenance pass is accepted but not started    | queued      |
 * | 3 | the refresh pipeline is actually running          | running     |
 * | 4 | derived store recovery failed                     | failed      |
 * | 5 | the current generation's last attempt failed      | failed      |
 * | 6 | latest-complete source matches current evidence  | current     |
 * | 7 | published source differs from current evidence   | due         |
 * | 8 | head exists, nothing ever completed, semantic on  | due         |
 * | 9 | head exists, nothing ever completed, semantic off | disabled    |
 * |10 | no published Design Files head yet                | unknown     |
 *
 * `current` is derivable ONLY from the durable latest-complete publication
 * matching the authoritative source evidence; in-process job state cannot claim
 * currency. `failed` and `due` keep the latest-complete generation readable
 * and always carry both the target head and the published head.
 */
import type { DesignProjectId } from './design-project.ts'

/** Closed lifecycle vocabulary for the derived Knowledge of one project. */
export type DesignKnowledgeState =
  | 'current' | 'due' | 'queued' | 'running' | 'failed' | 'disabled' | 'unavailable' | 'unknown'

/** The real pipeline phase; only meaningful while state is `running`. */
export type DesignKnowledgeRunPhase = 'projection' | 'semantic' | 'publication'

/** Durable latest-complete generation pointer facts. */
export interface DesignKnowledgeLatestComplete {
  readonly checkpoint: string
  readonly revision: string
  readonly warningCount: number
}

/** Durable recovery state of the derived store, when the provider reports one. */
export interface DesignKnowledgeRecoveryStatus {
  readonly state: 'rebuilding' | 'ready' | 'error'
  readonly message: string
  readonly generation?: string
}

/** One bounded failure of the current project generation. */
export interface DesignKnowledgeFailure {
  readonly target: string
  readonly message: string
}

/** Compact, injection-safe status snapshot for one Design Project. */
export interface DesignKnowledgeStatusSnapshot {
  readonly schemaVersion: 1
  readonly project: DesignProjectId
  /** Authoritative Design Files head the derived graph should match. */
  readonly head?: string
  readonly state: DesignKnowledgeState
  readonly phase?: DesignKnowledgeRunPhase
  /** Relation between the target head and the latest-complete publication. */
  readonly freshness: 'matching' | 'different' | 'none'
  readonly latestComplete?: DesignKnowledgeLatestComplete
  readonly recovery?: DesignKnowledgeRecoveryStatus
  readonly lastFailure?: DesignKnowledgeFailure
  /** Whether semantic (embedding) computation is configured at all. */
  readonly semanticLayer: 'enabled' | 'disabled'
}

/**
 * Derivation inputs. Deliberately excludes any in-memory "ready"/"maintained"
 * flag: currency comes from the durable publication pointer plus exact head
 * equality or proven committed source equality, never stale process-local state.
 */
export interface DesignKnowledgeStatusInput {
  readonly project: DesignProjectId
  readonly head?: string
  readonly publication?: { readonly checkpoint: string; readonly revision: string; readonly warnings?: readonly string[] }
  /** Proved equality of the committed Design evidence source set. */
  readonly publicationMatchesHead?: boolean
  /** `queued` = accepted but not started; `running` = pipeline actually started. */
  readonly liveJob: 'none' | 'queued' | 'running'
  readonly phase?: DesignKnowledgeRunPhase
  /** Failure of the CURRENT generation only; callers drop mismatched targets. */
  readonly indexFailure?: DesignKnowledgeFailure
  readonly recovery?: DesignKnowledgeRecoveryStatus
  readonly semanticEnabled: boolean
}

/**
 * Derive the honest Knowledge status from durable facts and live-job presence.
 * Pure: identical inputs always produce the identical snapshot.
 * @param input - durable pointers plus the exact live-job observation.
 * @returns the frozen status snapshot.
 */
export function deriveDesignKnowledgeStatus(input: DesignKnowledgeStatusInput): DesignKnowledgeStatusSnapshot {
  const latestComplete = input.publication === undefined
    ? undefined
    : Object.freeze({
      checkpoint: input.publication.checkpoint,
      revision: input.publication.revision,
      warningCount: input.publication.warnings?.length ?? 0,
    })
  const base = {
    schemaVersion: 1 as const,
    project: input.project,
    ...(input.head === undefined ? {} : { head: input.head }),
    ...(latestComplete === undefined ? {} : { latestComplete }),
    ...(input.recovery === undefined ? {} : { recovery: input.recovery }),
    semanticLayer: input.semanticEnabled ? 'enabled' as const : 'disabled' as const,
  }
  const withFreshness = (freshness: DesignKnowledgeStatusSnapshot['freshness']) => Object.freeze({ ...base, freshness })
  if (input.recovery?.state === 'rebuilding') {
    return Object.freeze({ ...withFreshness(freshnessOf(input)), state: 'unavailable' as const })
  }
  if (input.liveJob === 'queued') {
    return Object.freeze({ ...withFreshness(freshnessOf(input)), state: 'queued' as const })
  }
  if (input.liveJob === 'running') {
    return Object.freeze({
      ...withFreshness(freshnessOf(input)),
      state: 'running' as const,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
    })
  }
  if (input.recovery?.state === 'error') {
    return Object.freeze({
      ...withFreshness(freshnessOf(input)),
      state: 'failed' as const,
      lastFailure: Object.freeze({ target: 'recovery', message: input.recovery.message }),
    })
  }
  if (input.indexFailure !== undefined) {
    return Object.freeze({ ...withFreshness(freshnessOf(input)), state: 'failed' as const, lastFailure: input.indexFailure })
  }
  if (input.head === undefined) return Object.freeze({ ...withFreshness('none'), state: 'unknown' as const })
  if (input.publication !== undefined) {
    return input.publication.checkpoint === input.head || input.publicationMatchesHead === true
      ? Object.freeze({ ...withFreshness('matching'), state: 'current' as const })
      : Object.freeze({ ...withFreshness('different'), state: 'due' as const })
  }
  if (input.semanticEnabled) return Object.freeze({ ...withFreshness('none'), state: 'due' as const })
  return Object.freeze({ ...withFreshness('none'), state: 'disabled' as const })
}

function freshnessOf(input: DesignKnowledgeStatusInput): DesignKnowledgeStatusSnapshot['freshness'] {
  if (input.publication === undefined) return 'none'
  return input.head !== undefined && (input.publication.checkpoint === input.head || input.publicationMatchesHead === true) ? 'matching' : 'different'
}

/** GRA review freshness of one profile against the latest Design change. */
export type DesignReviewFreshness = 'completed' | 'due' | 'never-reviewed' | 'not-reviewable' | 'no-design-yet'

/** Per-profile runtime loop phase reported by the host advisory scheduler. */
export interface DesignAdvisoryProfileRuntimeStatus {
  readonly profile: string
  readonly phase: 'idle' | 'scheduled' | 'running' | 'failed'
  readonly lastError?: string
  /** Latest Design journal revision the loop observed; proves which revision is already active. */
  readonly latestRevision?: number
}

/** Exact identity of what an orchestration action accepted, deduped, or refused. */
export interface DesignOrchestrationTarget {
  /** Authoritative Design Files head the request targeted. */
  readonly checkpoint?: string
  /**
   * The single-flight generation identity this request targeted (the exact
   * maintenance key: checkpoint + Kit pin + ontology revision + semantic
   * identity). Never the previously published revision. Hosts that cannot
   * expose the exact key omit it rather than approximate.
   */
  readonly generation?: string
  /** The latest complete published KAG revision at sampling time, when any. */
  readonly lastPublishedRevision?: string
  /** Journal revision target of a review trigger. */
  readonly revision?: number
}

/**
 * Structured outcome of every Agent-initiated orchestration action. The lower
 * layer never loops or retries on its own; an explicit Agent request is the
 * only re-entry after failure, and it always learns exactly what happened.
 */
export type DesignOrchestrationResult =
  | { readonly outcome: 'accepted'; readonly reason: string; readonly target: DesignOrchestrationTarget; readonly profiles?: readonly string[] }
  | { readonly outcome: 'noop'; readonly reason: string; readonly target?: DesignOrchestrationTarget }
  | { readonly outcome: 'rejected'; readonly reason: string; readonly target?: DesignOrchestrationTarget }

/** One profile's combined durable + runtime review status. */
export interface DesignReviewProfileStatusSnapshot {
  readonly profile: string
  readonly review: DesignReviewFreshness
  readonly completedAt?: {
    readonly designRevision: number
    readonly commit: string
    readonly itemCount: number
    readonly knowledgeUsed: boolean
    readonly fallbackReason?: string
    readonly journalRevision: number
  }
  /** Present only while a real loop is scheduled/running/failed. */
  readonly runtime?: 'scheduled' | 'running' | 'failed'
  readonly runtimeError?: string
}

/** Journal facts the review derivation consumes. */
export interface DesignReviewJournalFacts {
  readonly latestDesignChange?: { readonly journalRevision: number; readonly commit?: string }
  readonly reviewCompletions: readonly {
    readonly profile: string
    readonly designRevision: number
    readonly commit: string
    readonly itemCount: number
    readonly knowledgeUsed: boolean
    readonly fallbackReason?: string
    readonly journalRevision: number
  }[]
}

/**
 * Derive per-profile review freshness from durable journal facts, overlaid
 * with the real scheduler loop phases. A profile is `completed` only when a
 * durable completion covers the latest Design change's revision AND commit;
 * legacy journals without completion facts keep every profile honestly
 * `never-reviewed` (due once a reviewable change exists).
 * @param journal - folded journal facts of the conversation.
 * @param profiles - configured advisory profile ids.
 * @param loops - real runtime loop phases; only genuine loops appear.
 * @returns frozen per-profile statuses in the configured profile order.
 */
export function deriveReviewStatuses(
  journal: DesignReviewJournalFacts,
  profiles: readonly string[],
  loops?: readonly DesignAdvisoryProfileRuntimeStatus[],
): readonly DesignReviewProfileStatusSnapshot[] {
  return Object.freeze(profiles.map((profile) => {
    const completion = journal.reviewCompletions.find((entry) => entry.profile === profile)
    const change = journal.latestDesignChange
    let review: DesignReviewFreshness
    if (change === undefined) review = 'no-design-yet'
    else if (change.commit === undefined) review = 'not-reviewable'
    else if (completion === undefined) review = 'never-reviewed'
    else if (completion.designRevision >= change.journalRevision && completion.commit === change.commit) review = 'completed'
    else review = 'due'
    const loop = loops?.find((entry) => entry.profile === profile)
    const runtime = loop !== undefined && loop.phase !== 'idle' ? loop.phase : undefined
    return Object.freeze({
      profile,
      review,
      ...(completion === undefined ? {} : {
        completedAt: Object.freeze({
          designRevision: completion.designRevision,
          commit: completion.commit,
          itemCount: completion.itemCount,
          knowledgeUsed: completion.knowledgeUsed,
          ...(completion.fallbackReason === undefined ? {} : { fallbackReason: completion.fallbackReason }),
          journalRevision: completion.journalRevision,
        }),
      }),
      ...(runtime === undefined ? {} : { runtime }),
      ...(runtime === undefined || loop?.lastError === undefined ? {} : { runtimeError: loop.lastError }),
    })
  }))
}

/** True when at least one profile has an unreviewed published Design change. */
export function hasDueReview(statuses: readonly DesignReviewProfileStatusSnapshot[]): boolean {
  return statuses.some((entry) => entry.review === 'due' || entry.review === 'never-reviewed')
}

const REMINDER_FAILURE_LIMIT = 300

/**
 * Render the compact, bounded snapshot reminder injected into the main
 * conversation at activation and after save settlement. Informational only:
 * it never wakes the model, promises execution, or authorizes anything.
 * @param knowledge - derived Knowledge status of the selected project.
 * @param reviews - derived per-profile review statuses.
 * @returns bounded reminder text for one non-waking inbox notice.
 */
export function renderDesignKnowledgeStatusReminder(
  knowledge: DesignKnowledgeStatusSnapshot,
  reviews: readonly DesignReviewProfileStatusSnapshot[],
): string {
  const lines: string[] = []
  lines.push(`project: ${knowledge.project}`)
  lines.push(`KAG: ${knowledge.state} (freshness=${knowledge.freshness}, semantic=${knowledge.semanticLayer})`)
  if (knowledge.head !== undefined) lines.push(`design head: ${knowledge.head}`)
  if (knowledge.latestComplete !== undefined) {
    lines.push(`latest-complete: checkpoint ${knowledge.latestComplete.checkpoint}, revision ${knowledge.latestComplete.revision}`)
  }
  if (knowledge.phase !== undefined) lines.push(`phase: ${knowledge.phase}`)
  if (knowledge.recovery !== undefined) lines.push(`recovery: ${knowledge.recovery.state} — ${knowledge.recovery.message.slice(0, REMINDER_FAILURE_LIMIT)}`)
  if (knowledge.lastFailure !== undefined) lines.push(`last failure: ${knowledge.lastFailure.message.slice(0, REMINDER_FAILURE_LIMIT)}`)
  for (const review of reviews) {
    const parts = [`review ${review.profile}: ${review.review}`]
    if (review.completedAt !== undefined) {
      parts.push(`last completed at revision ${review.completedAt.designRevision} (${review.completedAt.itemCount} items, knowledge ${review.completedAt.knowledgeUsed ? 'used' : `fallback:${review.completedAt.fallbackReason ?? 'unspecified'}`})`)
    }
    if (review.runtime !== undefined) parts.push(`runtime: ${review.runtime}${review.runtimeError === undefined ? '' : ` — ${review.runtimeError.slice(0, REMINDER_FAILURE_LIMIT)}`}`)
    lines.push(parts.join(', '))
  }
  return `<design-knowledge-status>\n${lines.join('\n')}\n</design-knowledge-status>`
}
