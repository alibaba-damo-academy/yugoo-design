/**
 * Semantic capability bindings: Kit-scoped resolution of a behavioral
 * capability (such as question rounds) to the unique Bundle that provides
 * it. Unlike authority-bound server contribution capabilities, semantic capabilities are
 * declared by any Bundle — including purely declarative content Bundles —
 * and grant no executable authority.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { DesignKit, DesignSkill } from './types.ts'
import { isValidVersionedId } from './runtime-drivers.ts'

/** Opaque identity of one semantic capability a Bundle provides to its Kit. */
export type DesignSemanticCapabilityId = Branded<'DesignSemanticCapabilityId'>

/**
 * Validate and brand a semantic capability identity read from Kit content.
 * @param value - versioned dotted identifier ending in `/vN`.
 * @param label - diagnostic subject.
 * @returns the branded identifier.
 */
export function DesignSemanticCapabilityId(value: string, label = 'design semantic capability'): DesignSemanticCapabilityId {
  if (!isValidVersionedId(value)) throw new Error(`${label}: invalid versioned id ${JSON.stringify(value)}`)
  return value as DesignSemanticCapabilityId
}

/** Question-round capability: human questions route through the unique Bundle providing it. */
export const DESIGN_QUESTION_ROUND_CAPABILITY = DesignSemanticCapabilityId('io.deepseek.design.capability.question-round/v1')

/**
 * Read the semantic capability ids declared by one Bundle manifest.
 * @param skill - loaded Bundle.
 * @returns declared capability ids, empty when the Bundle provides none.
 */
export function semanticCapabilitiesOf(skill: DesignSkill): readonly DesignSemanticCapabilityId[] {
  const manifest = skill.metadata?.skillManifest as Record<string, unknown> | undefined
  const declared = manifest?.semantic_capabilities
  return Array.isArray(declared) ? declared as readonly DesignSemanticCapabilityId[] : []
}

/** One Kit-local capability binding resolved from a pinned Kit version. */
export interface DesignCapabilityBinding {
  /** Kit-local binding key; the current model binds at most one Bundle per capability. */
  readonly bindingKey: string
  /** The bound provider Bundle carrying its declared version. */
  readonly skill: DesignSkill
}

/**
 * Resolve the unique binding providing a semantic capability within one Kit.
 * The Kit loader rejects revisions binding the same capability twice, so at
 * most one binding matches.
 * @param kit - loaded Kit version.
 * @param capability - semantic capability identity.
 * @returns the binding, or undefined when the Kit binds none and callers may
 * fall back to main-conversation behavior.
 */
export function capabilityBinding(kit: DesignKit, capability: DesignSemanticCapabilityId): DesignCapabilityBinding | undefined {
  const skill = kit.skills.find((candidate) => semanticCapabilitiesOf(candidate).includes(capability))
  return skill === undefined ? undefined : { bindingKey: skill.name, skill }
}

/**
 * Resolve the unique Bundle providing a semantic capability within one Kit.
 * @param kit - loaded Kit version.
 * @param capability - semantic capability identity.
 * @returns the providing Bundle, or undefined when the Kit binds none and
 * callers may fall back to main-conversation behavior.
 */
export function resolveSemanticCapability(kit: DesignKit, capability: DesignSemanticCapabilityId): DesignSkill | undefined {
  return capabilityBinding(kit, capability)?.skill
}
