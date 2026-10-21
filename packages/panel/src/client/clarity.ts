/**
 * Design clarity readout — pure helpers for the Design workspace value. The
 * wire value is `{ assessment, needsReassessment, explanation?, activity? }`: the latest assessment
 * from the project `clarity.json` authority served by the workspace Remote
 * (null while no assessment exists) plus the host-derived staleness flag.
 * Kit or checkpoint changes keep the displayed scores and only set the
 * staleness flag; they never clear the assessment. Optional Host-observed
 * activity remains visible before the first assessment without inventing scores.
 */

// Type-only import: erased from the browser bundle; the wire shape is owned
// by dsh-design-core so panel and host cannot drift.
import type { DesignClarityActivity, DesignClarityAssessment, DesignClarityExplanation } from 'dsh-design-core'

export type { DesignClarityAssessment }

/** Client wire view of the workspace clarity readout. */
export interface DesignClarityView {
  /** Latest assessment from the project clarity authority, or null. */
  readonly assessment: DesignClarityAssessment | null
  /** True once the assessed checkpoint or Kit pin is no longer current. */
  readonly needsReassessment: boolean
  readonly explanation?: DesignClarityExplanation
  /** Host-observed assessment activity; not a score or a persistence receipt. */
  readonly activity?: DesignClarityActivity
}

/** Weighted clarity index: U*.4 + S*.4 + T*.2, rounded to an integer. */
export const CLARITY_WEIGHTS = { u: 0.4, s: 0.4, t: 0.2 } as const

/**
 * Compute the weighted clarity index of an assessment.
 * @param assessment - the clarity assessment.
 * @returns the rounded weighted index (0–100).
 */
export function clarityIndex(assessment: DesignClarityAssessment): number {
  const { u, s, t } = assessment
  return Math.round(u * CLARITY_WEIGHTS.u + s * CLARITY_WEIGHTS.s + t * CLARITY_WEIGHTS.t)
}

/** Integer 0–100 guard for one score. */
function isClarityScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
}

/**
 * Tolerant guard for one assessment payload (wire boundary). Accepts exactly
 * the kit/version/u/s/t fields; extra or missing keys are foreign payloads.
 * @param value - the projected assessment value.
 * @returns whether it is a complete, well-formed assessment.
 */
export function isClarityAssessment(value: unknown): value is DesignClarityAssessment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  if (keys.length !== 5 || !['kit', 'version', 'u', 's', 't'].every((key) => Object.hasOwn(candidate, key))) return false
  return typeof candidate.kit === 'string' && candidate.kit !== ''
    && typeof candidate.version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(candidate.version)
    && isClarityScore(candidate.u)
    && isClarityScore(candidate.s)
    && isClarityScore(candidate.t)
}

/**
 * Strict guard for the whole projection wire value (wire boundary). Accepts
 * `{ assessment, needsReassessment }` plus optional saved explanation/activity; a bare legacy assessment,
 * smuggled keys, or any malformed payload yields undefined so the readout
 * stays hidden.
 * @param value - the clarity value returned by the Design workspace Remote.
 * @returns the validated view, or undefined for absent or foreign values.
 */
export function parseClarityView(value: unknown): DesignClarityView | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate)
  if (keys.some(key => !['assessment', 'needsReassessment', 'explanation', 'activity'].includes(key)) || !Object.hasOwn(candidate, 'assessment') || !Object.hasOwn(candidate, 'needsReassessment')) return undefined
  if (typeof candidate.needsReassessment !== 'boolean') return undefined
  if (candidate.activity !== undefined && !isClarityActivity(candidate.activity)) return undefined
  const activity = candidate.activity as DesignClarityActivity | undefined
  if (candidate.assessment === null) {
    return candidate.needsReassessment || candidate.explanation !== undefined ? undefined : {
      assessment: null, needsReassessment: false, ...(activity === undefined ? {} : { activity }),
    }
  }
  if (!isClarityAssessment(candidate.assessment)) return undefined
  if (candidate.explanation !== undefined && !isClarityExplanation(candidate.explanation)) return undefined
  return { assessment: candidate.assessment, needsReassessment: candidate.needsReassessment,
    ...(candidate.explanation === undefined ? {} : { explanation: candidate.explanation as DesignClarityExplanation }),
    ...(activity === undefined ? {} : { activity }) }
}

function isClarityActivity(value: unknown): value is DesignClarityActivity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return Object.keys(data).every(key => ['phase', 'checkpoint', 'summary'].includes(key))
    && ['phase', 'checkpoint'].every(key => Object.hasOwn(data, key))
    && ['queued', 'running', 'failed', 'stale', 'unavailable'].includes(data.phase as string)
    && typeof data.checkpoint === 'string' && data.checkpoint.trim() !== ''
    && (data.summary === undefined || typeof data.summary === 'string')
}

function isClarityExplanation(value: unknown): value is DesignClarityExplanation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return Object.keys(data).every(key => ['summary', 'u', 's', 't', 'nextGap', 'assessedCheckpoint'].includes(key))
    && ['summary', 'u', 's', 't', 'assessedCheckpoint'].every(key => typeof data[key] === 'string')
    && (data.nextGap === undefined || typeof data.nextGap === 'string')
}

/** Structural wire clarity value: the exact fields workspace emissions compare. */
export interface DesignClarityWireView {
  readonly assessment: {
    readonly kit: string
    readonly version: string
    readonly u: number
    readonly s: number
    readonly t: number
  } | null
  readonly needsReassessment: boolean
  readonly explanation?: DesignClarityExplanation
  readonly activity?: DesignClarityActivity
}

/**
 * Compare two clarity views for exact equality.
 * @param left - first clarity view.
 * @param right - second clarity view.
 * @returns true when both views carry identical assessments and staleness.
 */
export function equalClarityViews(left: DesignClarityWireView, right: DesignClarityWireView): boolean {
  if (left.needsReassessment !== right.needsReassessment) return false
  const leftActivity = left.activity, rightActivity = right.activity
  if (leftActivity === undefined || rightActivity === undefined) {
    if (leftActivity !== rightActivity) return false
  } else if (leftActivity.phase !== rightActivity.phase || leftActivity.checkpoint !== rightActivity.checkpoint
    || leftActivity.summary !== rightActivity.summary) return false
  const a = left.explanation, b = right.explanation
  if (a === undefined || b === undefined) {
    if (a !== b) return false
  } else if (a.summary !== b.summary || a.u !== b.u || a.s !== b.s || a.t !== b.t
    || a.nextGap !== b.nextGap || a.assessedCheckpoint !== b.assessedCheckpoint) return false
  const leftAssessment = left.assessment
  const rightAssessment = right.assessment
  if (leftAssessment === null || rightAssessment === null) return leftAssessment === rightAssessment
  return leftAssessment.kit === rightAssessment.kit
    && leftAssessment.version === rightAssessment.version
    && leftAssessment.u === rightAssessment.u
    && leftAssessment.s === rightAssessment.s
    && leftAssessment.t === rightAssessment.t
}
