/**
 * Shared types for the Design System seam.
 *
 * NOTE: the `design/*` SessionEventMap and MessageSourceMap declaration merges
 * are added once the plugin is built against the real dsh-session / dsh-llm
 * type surfaces. The payload shapes are fixed here so the merge is a one-line
 * wiring step.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { createHash } from 'node:crypto'

/** Published version identity of one Design Kit: explicit major.minor metadata. */
export type DesignKitVersion = Branded<'DesignKitVersion'>

/** Published version identity of one Bundle: explicit major.minor metadata. */
export type DesignBundleVersion = Branded<'DesignBundleVersion'>

/** Strict major.minor grammar shared by Kit and Bundle versions. */
const DESIGN_VERSION_GRAMMAR = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

/**
 * Validate and brand a serialized Design Kit version.
 * @param value - explicit major.minor version text, e.g. `1.0`.
 * @returns the branded version.
 */
export function DesignKitVersion(value: string): DesignKitVersion {
  if (typeof value !== 'string' || !DESIGN_VERSION_GRAMMAR.test(value)) {
    throw new Error(`invalid Design Kit version ${JSON.stringify(value)}; expected major.minor`)
  }
  return value as DesignKitVersion
}

/**
 * Validate and brand a serialized Bundle version.
 * @param value - explicit major.minor version text, e.g. `1.0`.
 * @returns the branded version.
 */
export function DesignBundleVersion(value: string): DesignBundleVersion {
  if (typeof value !== 'string' || !DESIGN_VERSION_GRAMMAR.test(value)) {
    throw new Error(`invalid Bundle version ${JSON.stringify(value)}; expected major.minor`)
  }
  return value as DesignBundleVersion
}

/** Stable deployment-owned authority of one Bundle source and catalog slot. */
export type DesignBundleAuthorityId = Branded<'DesignBundleAuthorityId'>

/**
 * Derive executable authority from trusted source identity and catalog membership.
 * @param sourceId - deployment-owned package or absolute-directory source identity.
 * @param bundle - validated Bundle catalog name.
 * @returns a stable authority independent of mutable Bundle content and versions.
 */
export function deriveDesignBundleAuthorityId(sourceId: string, bundle: string): DesignBundleAuthorityId {
  if (sourceId === '' || sourceId.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(sourceId)) {
    throw new Error('design Bundle authority: sourceId must be bounded non-empty text without control characters')
  }
  if (!/^[a-z][a-z0-9_]*$/u.test(bundle)) throw new Error(`design Bundle authority: invalid Bundle name ${JSON.stringify(bundle)}`)
  const digest = createHash('sha256').update(sourceId).update('\0').update(bundle).digest('hex')
  return `bundle-authority:${digest}` as DesignBundleAuthorityId
}

/** Bilingual user-facing text validated at Kit load; both languages required. */
export interface DesignBilingualText {
  /** Simplified-Chinese display text. */
  readonly zh: string
  /** English display text and the locale fallback. */
  readonly en: string
}

/**
 * One design skill exposed by a kit: the method playbook plus common manifests
 * and any presentation-specific metadata.
 */
export interface DesignSkill {
  /** Independent catalog identity; omitted for existing identity == runtime name. */
  readonly catalogName?: string
  /** Exact installed Bundle version root; independent of every mounting Kit. */
  readonly resourceRoot?: string
  /** Skill id, e.g. `function-modules`. Unique within a kit. */
  readonly name: string
  /** Trusted source-and-catalog authority used to resolve executable contributions. */
  readonly authority: DesignBundleAuthorityId
  /** Published version declared by this Bundle's skill.yaml. */
  readonly version: DesignBundleVersion
  /** One-line routing description available to Design System catalog consumers. */
  readonly description: string
  /** Optional bilingual picker description owned by the Bundle manifest. */
  readonly pickerDescription?: DesignBilingualText
  /** Bilingual user-facing heading; titles are unique per locale within a Kit. */
  readonly title: DesignBilingualText
  /** Bilingual user-facing picker label accompanying the title. */
  readonly label: DesignBilingualText
  /** The SKILL.md method body supplied only to the focused producer or worker. */
  readonly content: string
  /** Compiled execution policy shared by the manifest and the loaded skill. */
  readonly execution: DesignExecutionPolicy
  /** Common and conditional manifests in raw and load-validated parsed forms. */
  readonly metadata?: Record<string, unknown>
}

/** A registered Design Kit: one Mindset plus the design skills it exposes. */
export interface DesignKit {
  /** Absolute installed Kit root retained only for Host-confined resource execution. */
  readonly sourceRoot?: string
  /** Kit / mindset id, e.g. `example_kit`. Unique across installed kits. */
  readonly name: string
  /** Published version declared by the Kit's mindset frontmatter. */
  readonly version: DesignKitVersion
  /** Human description surfaced in the mindset-selection catalog. */
  readonly description?: string
  /** Optional bilingual display copy; never replaces the Mindset or routing description. */
  readonly pickerDescription?: DesignBilingualText
  /** Complete raw mindset.md text, including frontmatter, exactly as installed. */
  readonly mindsetSource: string
  /** Parsed Mindset body (frontmatter stripped) injected into the system prompt when active. */
  readonly mindset: string
  /** Optional Kit-authored KAG relation extension, compiled and pinned to this exact Kit version. */
  readonly relationVocabulary?: import('./design-relation-vocabulary.ts').CompiledDesignRelationVocabulary
  /** Zero-configuration ontology contract compiled from this exact Kit's schemas and relation vocabulary. */
  readonly ontologyContract?: import('./design-ontology.ts').CompiledDesignOntologyContract
  /** The design skills this kit exposes (mindset-gated catalog). */
  readonly skills: readonly DesignSkill[]
  /** Immutable text resources captured when this version was validated. */
  readonly resources: Readonly<Record<string, string>>
}

/** Payload for one `design/kit-selected` DesignJournal fact. */
export interface DesignKitSelectedPayload {
  readonly kit: string
  readonly version: DesignKitVersion
  readonly operation: 'activate' | 'upgrade'
  /** Audit/recovery evidence only; the committed project pin remains authoritative. */
  readonly adoption?: import('./project-content-transaction.ts').ProjectContentAdoptionReceipt
}

/** One evidence-based U/S/T clarity assessment for an exact Kit version. */
export interface DesignClarityAssessment {
  /** Selected Kit family at assessment time. */
  readonly kit: string
  /** Exact selected version at assessment time. */
  readonly version: DesignKitVersion
  /** User-intent clarity: users, scenarios, outcomes, and boundaries. */
  readonly u: number
  /** Solution-structure clarity: capabilities, flows, pages, and dependencies. */
  readonly s: number
  /** Testability clarity: observable behavior, acceptance, and constraints. */
  readonly t: number
}

/** Full saved reasons displayed alongside the matching U/S/T scores. */
export interface DesignClarityExplanation {
  readonly summary: string
  readonly u: string
  readonly s: string
  readonly t: string
  readonly nextGap?: string
  /** The exact published revision these reasons describe. */
  readonly assessedCheckpoint: string
}

/** Transient assessment work, not saved scores or a publication receipt. */
export interface DesignClarityActivity {
  readonly phase: 'queued' | 'running' | 'failed' | 'stale' | 'unavailable'
  /** Saved checkpoint this activity concerns; never the live worktree. */
  readonly checkpoint: string
  /** Bounded diagnostics; clients present localized status, not raw internals. */
  readonly summary?: string
}

/** Complete U/S/T scores of one clarity assessment. */
export type DesignClarityScores = Pick<DesignClarityAssessment, 'u' | 's' | 't'>

/** One clarity dimension's evidence-based score as the model reports it. */
export interface DesignClarityDimensionInput {
  /** Integer 0–100 assessed against the clarity rubric. */
  readonly score: number
  /** The concrete design evidence justifying the score. */
  readonly evidence: string
}

/** The model-authored structured clarity report (validated tool input). */
export interface DesignClarityInput {
  /** One-paragraph assessment summary. */
  readonly summary: string
  /** User-intent clarity: users, scenarios, outcomes, and boundaries. */
  readonly u: DesignClarityDimensionInput
  /** Solution-structure clarity: capabilities, flows, pages, and dependencies. */
  readonly s: DesignClarityDimensionInput
  /** Testability clarity: observable behavior, acceptance, and constraints. */
  readonly t: DesignClarityDimensionInput
  /** Optional single most important gap blocking a higher assessment. */
  readonly nextGap?: string
}

/** Stable identity of one exact clarity report's assessed content. */
export type DesignClarityDigest = Branded<'DesignClarityDigest'>

/**
 * Validate and brand a clarity report digest.
 * @param value - lowercase SHA-256 hex text.
 * @returns the branded digest.
 */
export function DesignClarityDigest(value: string): DesignClarityDigest {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`invalid clarity digest ${JSON.stringify(value)}`)
  return value as DesignClarityDigest
}

/**
 * One durable structured clarity report with its assessed Kit and optional real Host metadata. The
 * authoritative DesignJournal fact and presentation metadata carry this exact
 * value; the digest lets a host verify both representations agree.
 */
export interface DesignClarityReportedPayload {
  /** Real assessment producer; absent only for legacy main-Agent records. */
  readonly origin?: 'main-agent' | 'evaluator'
  /** Optional context metadata, not an authentication or reporting gate. */
  readonly scopeDigest?: string
  /** Exact authored effective Kit closure; absent historical inputs are unknown. */
  readonly kitContentHash?: string
  /** Digest of the assessed content: the host tool computes it, durable and meta parsers recompute and verify. */
  readonly digest: DesignClarityDigest
  /** Actual Host turn metadata when available; never fabricate a required value. */
  readonly turn?: number
  /** Actual tool call or evaluator id when available; not a reporting prerequisite. */
  readonly callId?: string
  /** Active Kit family at assessment time. */
  readonly kit: string
  /** Exact active Kit version at assessment time. */
  readonly version: DesignKitVersion
  readonly summary: string
  readonly u: DesignClarityDimensionInput
  readonly s: DesignClarityDimensionInput
  readonly t: DesignClarityDimensionInput
  readonly nextGap?: string
}

/** Payload for one `design/changed` DesignJournal fact (whole post-change value). */
export interface DesignChangedPayload {
  readonly kit: string
  readonly version: DesignKitVersion
  readonly skill: string
  readonly state: unknown
  readonly origin: 'agent' | 'panel'
  readonly commit?: string
  /** Producer publication authority; panel-origin changes never carry it. */
  readonly execution?: Readonly<{
    readonly invocationId: string
    readonly stateStatus: 'pending' | 'complete'
    readonly handoff: 'none' | 'must_edit' | 'user_continue'
  }>
  /** The owning skill's panel manifest (panel.yaml), so a client can render it. */
  readonly panelYaml?: string
  /** The owning skill's parsed skill.yaml (tab order/label/icon for the FE). */
  readonly skillManifest?: Record<string, unknown>
}

/** One Host-authored execution attempt; observability only, never canonical Design state. */
export interface DesignExecutionAttemptPayload {
  readonly projectId: string
  readonly invocationId: string
  /** Root run_design_skill call that owns this invocation; binds its conversation row. */
  readonly rootCallId?: string
  readonly skill: string
  /** Stable artifact identity, or the skill id for a Producer-wide attempt. */
  readonly artifactId: string
  readonly artifactKind?: string
  /** Pre-bound project-relative artifact path, available before bytes land. */
  readonly artifactFile?: string
  readonly attemptId: string
  /** Published Producer/Worker session id; absent when launch failed before publication. */
  readonly runId?: string
  readonly parentRunId?: string
  readonly role: 'producer' | 'worker'
  readonly phase: 'queued' | 'working' | 'completed' | 'failed' | 'cancelled'
  readonly diagnostics?: readonly string[]
  readonly receipt?: Readonly<{
    readonly path: string
    readonly sha256: string
    readonly bytes: number
  }>
}

/** Stable identity of one resume action, shared by manifest, runtime, UI, and chat. */
export type DesignResumeActionId = Branded<'DesignResumeActionId'>

/**
 * Validate and brand a resume action identity.
 * @param value - portable identifier (letters, digits, dot, underscore, dash).
 * @returns the branded identifier.
 */
export function DesignResumeActionId(value: string): DesignResumeActionId {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)) {
    throw new Error(`invalid resume action id ${JSON.stringify(value)}`)
  }
  return value as DesignResumeActionId
}

/** The single server-owned resume action of a `user_continue` handoff. */
export interface DesignResumeAction {
  /** Stable action identity (parity with the authored manifest). */
  readonly routeId: DesignResumeActionId
  /** Bilingual visible label; both languages required. */
  readonly label: Readonly<{ readonly zh: string; readonly en: string }>
  /** Exact chat controls meaning "run the current plan", per language. */
  readonly aliases?: Readonly<{
    readonly zh: readonly string[]
    readonly en: readonly string[]
  }>
}

/** Handoffs that do not expose an explicit server-owned resume action. */
export type DesignSimpleHandoff = 'none' | 'must_edit'

/**
 * Manifest-owned execution placement and user-interaction policy. Omitted mode
 * retains subagent placement. Worker delegation does not change either choice.
 */
export type DesignExecutionPolicy = { readonly mode?: 'main' | 'subagent' } & (
  | { readonly handoff: DesignSimpleHandoff }
  | {
      readonly handoff: 'user_continue'
      readonly resumeAction: DesignResumeAction
    }
)
