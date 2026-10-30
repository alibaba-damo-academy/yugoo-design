/** Trusted per-Bundle runtime contribution registry. */
import type { JsonValue } from './json-value.ts'
import type { DesignBundleAuthorityId, DesignKit, DesignSkill } from './types.ts'
import type { ValidationEnv } from './validation-rules.ts'
import { DesignDriverId } from './design-driver-id.ts'
export { DesignDriverId, isValidVersionedId } from './design-driver-id.ts'

/** Context shared by trusted state-write hooks. */
export interface DesignRuntimeContext {
  readonly skill: DesignSkill
  readonly origin: 'agent' | 'panel'
  readonly signal?: AbortSignal
}

/** Canonical state and deterministic files prepared without filesystem effects. */
export interface PreparedDesignWrite {
  readonly state: Record<string, unknown>
  /** Artifact paths are relative to the Design Files root. */
  readonly artifacts?: Readonly<Record<string, string | Uint8Array>>
  /**
   * Complete artifact set owned by this Bundle after the write. Existing
   * files in the Bundle folder that are absent from this set are removed in
   * the same Git commit. Omit when the write does not own the complete set.
   */
  readonly ownedArtifacts?: readonly string[]
}

/** Host-selected exact-revision sources available to trusted Producer publication. */
export interface DesignProducerPublicationSources {
  readonly stateRevision: string
  readonly skills: readonly DesignSkill[]
  readonly paths: readonly string[]
  readonly readText: (relativePath: string) => Promise<string | undefined>
  readonly limits: Readonly<{
    readonly maxFileCount: number
    readonly maxPathBytes: number
    readonly maxFileBytes: number
    readonly maxTotalBytes: number
  }>
}

/** Complete invocation-local Bundle workspace snapshot presented to trusted publication. */
export interface DesignProducerPublicationSnapshot {
  readonly state: Record<string, unknown>
  readonly artifacts: Readonly<Record<string, string | Uint8Array>>
  readonly ownedArtifacts: readonly string[]
  readonly mode: 'in_progress' | 'complete'
  readonly baseRevision: string
  /** Paths mutated by this invocation since its current committed baseline. */
  readonly changedPaths?: readonly string[]
}

/** One bounded Provider projection derived from an authoritative Host tool result. */
export interface DesignProducerEvidenceRecord {
  readonly kind: string
  readonly data: JsonValue
}

/** Exact project and Kit context pinned for one Producer publication attempt. */
export interface DesignProducerPublicationContext extends DesignRuntimeContext {
  readonly kit: DesignKit
  readonly previousState: Readonly<Record<string, unknown>>
  readonly sources: DesignProducerPublicationSources
  /** Evidence accepted from this Producer and its successful optional Workers. */
  readonly evidence: readonly DesignProducerEvidenceRecord[]
}

/** Trusted prepared publication plus an optional exact-dependency recheck. */
export interface PreparedDesignProducerPublication {
  readonly write: PreparedDesignWrite
  readonly revalidate?: () => Promise<void>
}

/** One model-invisible Producer tool observation a Provider may expose as evidence. */
export interface DesignProducerToolObservation {
  readonly name: string
  readonly arguments: unknown
  readonly isError: boolean
  /** Canonical execution-local result value; absent for failed tools. */
  readonly value?: JsonValue
  /** Optional tool-private result projection; never used as authority when value exists. */
  readonly meta?: JsonValue
}

/** Trusted Bundle behavior used by the long-lived Design Skill Producer. */
export interface DesignProducerContribution {
  /** Evidence tools that must exist for this Producer to run. */
  readonly producerTools: readonly string[]
  /** Evidence tools granted only when the active Host provides them. */
  readonly optionalProducerTools?: readonly string[]
  /** Project direct Producer tool results into bounded invocation evidence. */
  readonly captureEvidence?: (
    observation: DesignProducerToolObservation,
  ) => readonly DesignProducerEvidenceRecord[]
  /**
   * Whether one Bundle-relative Design File path belongs to this Producer.
   * The canonical state path must be accepted. This predicate constrains
   * mutations before publication; the prepared owned set remains authoritative.
   */
  ownsPath(path: string, skill: DesignSkill): boolean
  /** Apply Bundle publication rules to the authored workspace snapshot. Diagnostics return to the same Producer for repair. */
  validatePublication?(
    snapshot: DesignProducerPublicationSnapshot,
    context: DesignProducerPublicationContext,
  ): readonly string[] | Promise<readonly string[]>
  /** Prepare canonical state and deterministic artifacts without Design File effects. */
  preparePublication(
    snapshot: DesignProducerPublicationSnapshot,
    context: DesignProducerPublicationContext,
  ): PreparedDesignProducerPublication | Promise<PreparedDesignProducerPublication>
}

/** Bundle identity and manifests required by model-state projection drivers. */
export interface DesignRuntimeSkill {
  readonly name: string
  readonly metadata?: Record<string, unknown>
}

/** Trusted server behavior associated with one Bundle authority. */
export interface DesignRuntimeDriver {
  /** Render the Bundle's persisted value into model-visible design state. */
  renderState(state: Readonly<Record<string, unknown>>, skill: DesignRuntimeSkill): readonly string[]
  /**
   * Normalize a whole candidate before schema validation and persistence.
   * @param state - the authored candidate to normalize.
   * @param context - write context identifying the Bundle and origin.
   * @param prior - last persisted state of the Bundle, or undefined on first authoring.
   */
  normalizeState?(
    state: Record<string, unknown>,
    context: DesignRuntimeContext,
    prior?: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | Promise<Record<string, unknown>>
  /** Prepare canonical state and deterministic artifacts without filesystem effects. */
  prepareWrite?(
    state: Record<string, unknown>,
    context: DesignRuntimeContext,
  ): PreparedDesignWrite | Promise<PreparedDesignWrite>
  /** Trusted publication behavior for the long-lived Design Skill Producer. */
  readonly producer?: DesignProducerContribution
}

/** Trusted procedural validation unavailable to the declarative rule grammar. */
export interface DesignValidationDriver {
  /** Reject invalid driver-specific options while the Kit version is staged. */
  validateOptions?(options: Readonly<Record<string, unknown>>): void
  /** Evaluate one validation rule and return its concrete diagnostics. */
  evaluate(
    env: ValidationEnv,
    options: Readonly<Record<string, unknown>>,
  ): readonly string[] | Promise<readonly string[]>
}

/** One runtime implementation contributed by its owning Bundle provider. */
export interface DesignRuntimeContribution {
  /** Globally unique stable runtime identity referenced by `skill.yaml`. */
  readonly id: DesignDriverId
  /** Trusted implementation installed for this Bundle authority. */
  readonly driver: DesignRuntimeDriver
}

/** One procedural validation implementation contributed by its owning Bundle provider. */
export interface DesignValidationContribution {
  /** Globally unique stable validation identity referenced by `validation.yaml`. */
  readonly id: DesignDriverId
  /** Trusted implementation installed for this Bundle authority. */
  readonly driver: DesignValidationDriver
}

/** Atomic server-side contributions installed for one Bundle. */
export interface DesignBundleContribution {
  /** Trusted source-and-catalog authority this provider serves. */
  readonly authority: DesignBundleAuthorityId
  /** Optional server runtime declared by this Bundle. */
  readonly runtime?: DesignRuntimeContribution
  /** Optional procedural validations declared by this Bundle. */
  readonly validations?: readonly DesignValidationContribution[]
  /** Optional server capability identities declared by this Bundle. */
  readonly capabilities?: readonly DesignDriverId[]
  /** Optional native presentation identity; its implementation remains client-only. */
  readonly presentation?: DesignDriverId
}

interface RegisteredDriver<T> {
  readonly owner: symbol
  readonly authority: DesignBundleAuthorityId
  readonly value: T
}

interface RegisteredClaim {
  readonly owner: symbol
  readonly authority: DesignBundleAuthorityId
}

/** Namespace-aware identities owned by one atomic Bundle contribution. */
export interface DesignBundleContributionIds {
  /** Runtime identity owned by the contribution. */
  readonly runtime?: DesignDriverId
  /** Validation identities owned by the contribution. */
  readonly validations: ReadonlySet<DesignDriverId>
  /** Capability identities owned by the contribution. */
  readonly capabilities: ReadonlySet<DesignDriverId>
  /** Native presentation identity owned by the contribution. */
  readonly presentation?: DesignDriverId
}

type ContributionDisposalGuard = (ids: DesignBundleContributionIds) => string | undefined

function freezeRuntimeDriver(id: DesignDriverId, driver: DesignRuntimeDriver): DesignRuntimeDriver {
  let producer = driver.producer
  if (producer !== undefined) {
    const required = producer.producerTools
    const optional = producer.optionalProducerTools ?? []
    for (const [label, values] of [
      ['producerTools', required],
      ['optionalProducerTools', optional],
    ] as const) {
      if (!Array.isArray(values)
        || values.some(value => typeof value !== 'string' || value.trim() === '')
        || new Set(values).size !== values.length) {
        throw new Error(`design runtime: driver ${JSON.stringify(id)} ${label} must be a unique non-blank string list`)
      }
    }
    const overlap = optional.find(tool => required.includes(tool))
    if (overlap !== undefined) {
      throw new Error(`design runtime: driver ${JSON.stringify(id)} declares Producer tool ${JSON.stringify(overlap)} as both required and optional`)
    }
    producer = Object.freeze({
      ...producer,
      producerTools: Object.freeze([...required]),
      optionalProducerTools: Object.freeze([...optional]),
    })
  }
  return Object.freeze({
    renderState: driver.renderState,
    ...(driver.normalizeState === undefined ? {} : { normalizeState: driver.normalizeState }),
    ...(driver.prepareWrite === undefined ? {} : { prepareWrite: driver.prepareWrite }),
    ...(producer === undefined ? {} : { producer }),
  })
}

/** Effect-scoped registry of globally unique per-Bundle server contributions. */
export class DesignBundleContributionRegistry {
  private readonly runtimes = new Map<DesignDriverId, RegisteredDriver<DesignRuntimeDriver>>()
  private readonly validations = new Map<DesignDriverId, RegisteredDriver<DesignValidationDriver>>()
  private readonly capabilities = new Map<DesignDriverId, RegisteredClaim>()
  private readonly presentations = new Map<DesignDriverId, RegisteredClaim>()

  /** @param disposalGuard - optional live-Kit reference check run before disposal. */
  constructor(private readonly disposalGuard?: ContributionDisposalGuard) {}

  /**
   * Atomically register one Bundle's server contributions.
   * @param contribution - runtime, validation, and capability identities owned by one Bundle.
   * @returns an owner-safe idempotent disposer.
   */
  registerBundleContribution(contribution: DesignBundleContribution): () => void {
    const runtime = contribution.runtime === undefined
      ? undefined
      : Object.freeze({
        id: DesignDriverId(contribution.runtime.id),
        driver: freezeRuntimeDriver(DesignDriverId(contribution.runtime.id), contribution.runtime.driver),
      })
    const validations = (contribution.validations ?? []).map((entry) => Object.freeze({
      id: DesignDriverId(entry.id),
      driver: Object.freeze({ ...entry.driver }),
    }))
    const capabilities = (contribution.capabilities ?? []).map(id => DesignDriverId(id))
    const presentation = contribution.presentation === undefined ? undefined : DesignDriverId(contribution.presentation)
    const ownedIds = [
      ...(runtime === undefined ? [] : [runtime.id]),
      ...validations.map(entry => entry.id),
      ...capabilities,
      ...(presentation === undefined ? [] : [presentation]),
    ]
    if (ownedIds.length === 0) throw new Error('design runtime: Bundle contribution must not be empty')
    const validationIds = validations.map(entry => entry.id)
    if (new Set(validationIds).size !== validationIds.length) throw new Error('design runtime: Bundle contribution repeats a validation id')
    if (new Set(capabilities).size !== capabilities.length) throw new Error('design runtime: Bundle contribution repeats a capability id')
    if (runtime !== undefined && this.runtimes.has(runtime.id)) throw new Error(`design runtime: duplicate globally registered runtime id ${JSON.stringify(runtime.id)}`)
    for (const id of validationIds) {
      if (this.validations.has(id)) throw new Error(`design runtime: duplicate globally registered validation id ${JSON.stringify(id)}`)
    }
    for (const id of capabilities) {
      if (this.capabilities.has(id)) throw new Error(`design runtime: duplicate globally registered capability id ${JSON.stringify(id)}`)
    }
    if (presentation !== undefined && this.presentations.has(presentation)) {
      throw new Error(`design runtime: duplicate globally registered native presentation id ${JSON.stringify(presentation)}`)
    }

    const owner = Symbol(ownedIds[0])
    if (runtime !== undefined) this.runtimes.set(runtime.id, { owner, authority: contribution.authority, value: runtime.driver })
    for (const entry of validations) this.validations.set(entry.id, { owner, authority: contribution.authority, value: entry.driver })
    for (const id of capabilities) this.capabilities.set(id, { owner, authority: contribution.authority })
    if (presentation !== undefined) this.presentations.set(presentation, { owner, authority: contribution.authority })
    const guardedIds: DesignBundleContributionIds = Object.freeze({
      ...(runtime === undefined ? {} : { runtime: runtime.id }),
      validations: new Set(validationIds),
      capabilities: new Set(capabilities),
      ...(presentation === undefined ? {} : { presentation }),
    })
    let disposed = false
    return () => {
      if (disposed) return
      const reason = this.disposalGuard?.(guardedIds)
      if (reason !== undefined) throw new Error(reason)
      disposed = true
      if (runtime !== undefined && this.runtimes.get(runtime.id)?.owner === owner) this.runtimes.delete(runtime.id)
      for (const entry of validations) {
        if (this.validations.get(entry.id)?.owner === owner) this.validations.delete(entry.id)
      }
      for (const id of capabilities) {
        if (this.capabilities.get(id)?.owner === owner) this.capabilities.delete(id)
      }
      if (presentation !== undefined && this.presentations.get(presentation)?.owner === owner) this.presentations.delete(presentation)
    }
  }

  /**
   * Resolve a globally registered Bundle runtime driver.
   * @param authority - trusted authority carried by the mounted Bundle.
   * @param id - globally unique runtime identity.
   * @returns the authority-bound runtime implementation.
   */
  requireRuntime(authority: DesignBundleAuthorityId, id: DesignDriverId): DesignRuntimeDriver {
    const registered = this.runtimes.get(id)
    if (registered === undefined) throw new Error(`design runtime: runtime driver ${JSON.stringify(id)} is not installed`)
    if (registered.authority !== authority) throw new Error(`design runtime: runtime driver ${JSON.stringify(id)} is not authorized for Bundle authority ${JSON.stringify(authority)}`)
    return registered.value
  }

  /**
   * Resolve a globally registered procedural validation driver.
   * @param authority - trusted authority carried by the mounted Bundle.
   * @param id - globally unique validation identity.
   * @returns the authority-bound validation implementation.
   */
  requireValidation(authority: DesignBundleAuthorityId, id: DesignDriverId): DesignValidationDriver {
    const registered = this.validations.get(id)
    if (registered === undefined) throw new Error(`design runtime: validation driver ${JSON.stringify(id)} is not installed`)
    if (registered.authority !== authority) throw new Error(`design runtime: validation driver ${JSON.stringify(id)} is not authorized for Bundle authority ${JSON.stringify(authority)}`)
    return registered.value
  }

  /**
   * Require one globally registered model/tool capability.
   * @param authority - trusted authority carried by the mounted Bundle.
   * @param id - globally unique capability identity.
   */
  requireCapability(authority: DesignBundleAuthorityId, id: DesignDriverId): void {
    const registered = this.capabilities.get(id)
    if (registered === undefined) throw new Error(`design runtime: capability ${JSON.stringify(id)} is not installed`)
    if (registered.authority !== authority) throw new Error(`design runtime: capability ${JSON.stringify(id)} is not authorized for Bundle authority ${JSON.stringify(authority)}`)
  }

  /**
   * Require one native presentation identity claimed by the matching Bundle authority.
   * @param authority - trusted authority carried by the mounted Bundle.
   * @param id - globally unique native presentation identity.
   */
  requirePresentation(authority: DesignBundleAuthorityId, id: DesignDriverId): void {
    const registered = this.presentations.get(id)
    if (registered === undefined) throw new Error(`design runtime: native presentation ${JSON.stringify(id)} is not installed`)
    if (registered.authority !== authority) throw new Error(`design runtime: native presentation ${JSON.stringify(id)} is not authorized for Bundle authority ${JSON.stringify(authority)}`)
  }

  /**
   * Validate every executable reference before a Kit version becomes observable.
   * @param kit - fully compiled Kit candidate carrying trusted Bundle authorities.
   */
  assertKit(kit: DesignKit): void {
    for (const skill of kit.skills) {
      const manifestValue = skill.metadata?.skillManifest
      if (manifestValue === undefined) continue
      if (typeof manifestValue !== 'object' || manifestValue === null || Array.isArray(manifestValue)) {
        throw new Error(`design runtime: Bundle ${JSON.stringify(skill.name)} has an invalid skill manifest`)
      }
      const manifest = manifestValue as Record<string, unknown>
      const runtime = manifest.runtime as { driver?: DesignDriverId } | undefined
      if (runtime?.driver !== undefined) {
        this.requireRuntime(skill.authority, runtime.driver)
      }
      const presentation = manifest.presentation as { mode?: unknown; renderer?: DesignDriverId } | undefined
      if (presentation?.mode === 'native' && presentation.renderer !== undefined) {
        this.requirePresentation(skill.authority, presentation.renderer)
      }
      for (const capability of (manifest.capabilities ?? []) as DesignDriverId[]) this.requireCapability(skill.authority, capability)
      const validation = skill.metadata?.validationDocument as { rules?: readonly { check?: Record<string, unknown> }[] } | undefined
      for (const rule of validation?.rules ?? []) {
        if (typeof rule.check?.driver === 'string') {
          const driver = this.requireValidation(skill.authority, rule.check.driver as DesignDriverId)
          driver.validateOptions?.((rule.check.options ?? {}) as Record<string, unknown>)
        }
      }
    }
  }
}
