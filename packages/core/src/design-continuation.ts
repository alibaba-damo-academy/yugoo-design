/** Host-neutral browser projections of authoritative Runtime handoff gates. */
import type { DesignExecutionGate, DesignExecutionPin } from './design-execution-runtime.ts'

/** Display-only pending edit handoff; the existing Panel save owns consumption. */
export interface DesignMustEditHandoffDescriptor {
  readonly skill: string
  readonly pin: DesignExecutionPin
}

/** Copy an already-derived edit gate; do not infer it from business JSON. */
export function deriveDesignMustEditHandoff(
  gate: Extract<DesignExecutionGate, { readonly kind: 'must_edit' }>,
): DesignMustEditHandoffDescriptor {
  return Object.freeze({ skill: gate.pin.skillName, pin: Object.freeze({ ...gate.pin }) })
}

/** Bilingual user-facing text owned by the Bundle manifest. */
export interface DesignContinuationLabel {
  readonly zh: string
  readonly en: string
}

/** Bilingual accepted phrasings that route back to the same resume action. */
export interface DesignContinuationAliases {
  readonly zh: readonly string[]
  readonly en: readonly string[]
}

/** One real pending user-continue gate exposed to Host UI. */
export interface DesignContinuationDescriptor {
  readonly skill: string
  readonly title?: DesignContinuationLabel
  /** Runtime invocation identity; a new gate always receives a new identity. */
  readonly invocationId: string
  readonly routeId: string
  readonly label: DesignContinuationLabel
  readonly aliases?: DesignContinuationAliases
  /** Journal ordering used only when several real gates coexist. */
  readonly journalRevision?: number
  readonly summary?: string
}

/** Trusted Runtime gate plus optional presentation and ordering metadata. */
export interface DesignContinuationDerivationInput {
  readonly gate: Extract<DesignExecutionGate, { readonly kind: 'user_continue' }>
  readonly title?: DesignContinuationLabel
  readonly journalRevision?: number
  readonly summary?: string
}

/**
 * Project a Runtime-derived gate without inferring lifecycle from Bundle JSON.
 * The gate has already been reconstructed from the published execution
 * authority; this function only copies browser-safe display fields.
 */
export function deriveDesignContinuation(
  input: DesignContinuationDerivationInput,
): DesignContinuationDescriptor {
  const { gate } = input
  const aliases = gate.action.aliases === undefined
    || (gate.action.aliases.zh.length === 0 && gate.action.aliases.en.length === 0)
    ? undefined
    : Object.freeze({
        zh: Object.freeze([...gate.action.aliases.zh]),
        en: Object.freeze([...gate.action.aliases.en]),
      })
  return Object.freeze({
    skill: gate.pin.skillName,
    ...(input.title === undefined
      ? {}
      : { title: Object.freeze({ zh: input.title.zh, en: input.title.en }) }),
    invocationId: String(gate.invocationId),
    routeId: gate.action.routeId,
    label: Object.freeze({ zh: gate.action.label.zh, en: gate.action.label.en }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(input.journalRevision === undefined ? {} : { journalRevision: input.journalRevision }),
    ...(input.summary === undefined || input.summary.trim() === '' ? {} : { summary: input.summary }),
  })
}
