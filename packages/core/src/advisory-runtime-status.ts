/** Host-neutral operational status for the built-in Design advisory profiles. */
import type { DesignAdvisoryProfileRuntimeStatus } from './design-knowledge-status.ts'
import type { DesignReviewPolicy } from './design-review-policy.ts'

/** One session's background advisory scheduler phase. */
export type DesignAdvisoryRuntimePhase = 'idle' | 'scheduled' | 'running' | 'failed'

/** Bounded status exposed to host commands and diagnostics. */
export interface DesignAdvisoryRuntimeStatus {
  readonly available: boolean
  readonly profiles: readonly string[]
  readonly phase: DesignAdvisoryRuntimePhase
  readonly lastPublished?: { readonly profile: string; readonly advisoryId: string }
  readonly lastError?: string
  /** Per-profile loop phases when any loop exists; aggregate fields unchanged. */
  readonly profileStatus?: readonly DesignAdvisoryProfileRuntimeStatus[]
}

/** Host adapter contribution that reports advisory state for one conversation. */
export interface DesignAdvisoryRuntimeStatusProvider<AgentLike = unknown> {
  /** Return the current status without starting or cancelling analysis. */
  status(agent: AgentLike): DesignAdvisoryRuntimeStatus
  /**
   * Optional Agent-initiated trigger: start exactly the listed profiles for
   * one journal revision through the scheduler's existing idempotent,
   * latest-wins, single-flight loop machinery. Hosts without an advisory
   * scheduler omit it; callers report the absence honestly.
   */
  requestReviews?(agent: AgentLike, journalRevision: number, profiles: readonly string[]): void
  /** Explicit same-revision recheck; returns only profiles newly scheduled by this call. */
  requestManualReviews?(agent: AgentLike, journalRevision: number, profiles: readonly string[], requestId: string): readonly string[]
  /** Drop not-started automatic work when the project policy changes. */
  configureReviews?(agent: AgentLike, policy: DesignReviewPolicy): void | Promise<void>
}

/** Status returned when a host integration omitted the built-in advisory runtime. */
export const UNAVAILABLE_ADVISORY_RUNTIME_STATUS: DesignAdvisoryRuntimeStatus = Object.freeze({
  available: false,
  profiles: Object.freeze([]),
  phase: 'failed',
  lastError: 'the Design System advisory runtime is not installed',
})
