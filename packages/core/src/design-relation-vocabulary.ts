/** Version-pinned relation semantics shared by KAG writers, readers, and Studio. */
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import type { DesignBilingualText, DesignKitVersion } from './types.ts'

export const DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION = 1
export const DESIGN_RELATION_TYPE_PATTERN = '^[a-z][a-z0-9._:-]{0,79}$'
export type DesignRelationDirection = 'forward' | 'symmetric' | 'unknown'
export type DesignRelationClassification = 'core' | 'kit' | 'unknown'

export interface DesignRelationDefinition {
  /** Stable stored relation type. Kit extensions must use `kit_name:local-name`. */
  readonly type: string
  /** Canonical query meaning. It may reuse a Core meaning or remain namespaced. */
  readonly meaning: string
  readonly direction: Exclude<DesignRelationDirection, 'unknown'>
  readonly label: DesignBilingualText
  readonly description: DesignBilingualText
  /** Optional ontology endpoint constraints. Absence keeps the relation open. */
  readonly domain?: readonly string[]
  readonly range?: readonly string[]
  readonly inverse?: string
  readonly cardinality?: Readonly<{ from: 'one' | 'many'; to: 'one' | 'many' }>
  readonly reasoning?: Readonly<{ impact?: boolean; causal?: boolean; transitive?: boolean }>
  readonly evidence?: Readonly<{ minimum: 'explicit' | 'inferred' }>
}

export interface CompiledDesignRelationVocabulary {
  readonly schemaVersion: typeof DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  /** Digest of the canonical authored extension, not of the mutable install path. */
  readonly revision: string
  readonly relations: readonly DesignRelationDefinition[]
}

export interface ResolvedDesignRelation {
  readonly relationType: string
  readonly meaning: string
  readonly direction: DesignRelationDirection
  readonly classification: DesignRelationClassification
  readonly vocabularyRevision: string
  /** Integrity digest of the resolved semantic tuple written by Core. */
  readonly definitionDigest: string
  readonly kit?: string
  readonly kitVersion?: string
}

const CORE_DEFINITIONS = [
  ['contains', 'contains', 'forward', '包含', 'Contains', 'A structurally contains B.', 'A 在结构上包含 B。'],
  ['references', 'references', 'forward', '引用', 'References', 'A explicitly refers to B.', 'A 明确引用 B。'],
  ['supports', 'supports', 'forward', '支持', 'Supports', 'A provides evidence or support for B.', 'A 为 B 提供证据或支持。'],
  ['realizes', 'realizes', 'forward', '实现', 'Realizes', 'Concrete A implements specification B.', '具体的 A 实现规范 B。'],
  ['constrains', 'constrains', 'forward', '约束', 'Constrains', 'Rule A limits B.', '规则 A 约束 B。'],
  ['depends-on', 'depends-on', 'forward', '依赖', 'Depends on', 'A depends on B.', 'A 依赖 B。'],
  ['precedes', 'precedes', 'forward', '先于', 'Precedes', 'A occurs before B.', 'A 发生在 B 之前。'],
  ['contradicts', 'contradicts', 'symmetric', '冲突', 'Contradicts', 'A and B conflict under the cited conditions.', 'A 与 B 在所引条件下冲突。'],
  ['similar', 'similar', 'symmetric', '相似候选', 'Similarity candidate', 'A and B are candidates for semantic similarity, not causation.', 'A 与 B 是语义相似候选，不代表因果。'],
] as const

export const CORE_DESIGN_RELATIONS: readonly DesignRelationDefinition[] = Object.freeze(CORE_DEFINITIONS.map(
  ([type, meaning, direction, zhLabel, enLabel, enDescription, zhDescription]) => Object.freeze({
    type, meaning, direction, label: Object.freeze({ zh: zhLabel, en: enLabel }),
    description: Object.freeze({ zh: zhDescription, en: enDescription }),
  }),
))

const CORE_REVISION = `core-v1:${createHash('sha256').update(JSON.stringify(CORE_DESIGN_RELATIONS)).digest('hex')}`
const CORE_BY_TYPE = new Map(CORE_DESIGN_RELATIONS.map((definition) => [definition.type, definition]))
const CORE_ALIASES = new Map<string, string>([
  ['identifier-match', 'references'],
  ['references-artifact', 'references'],
  ['semantic-similarity', 'similar'],
])
const AGENT_CORE_DESIGN_RELATIONS = CORE_DESIGN_RELATIONS.filter((definition) => definition.type !== 'contains')
const EXTENSION_TYPE = /^[a-z][a-z0-9_]{0,63}:[a-z][a-z0-9._-]{0,63}$/u
const SAFE_TOKEN = new RegExp(DESIGN_RELATION_TYPE_PATTERN, 'u')
const MAX_RELATIONS = 64
const MAX_SOURCE_BYTES = 128 * 1024

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key))
  if (extra.length > 0) throw new Error(`design relation vocabulary: ${path} has unsupported field ${JSON.stringify(extra[0])}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`design relation vocabulary: ${path} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, path: string, max = 500): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`design relation vocabulary: ${path} must be non-empty bounded text`)
  }
  return value.trim()
}

function bilingual(value: unknown, path: string): DesignBilingualText {
  const input = record(value, path)
  exactKeys(input, ['zh', 'en'], path)
  return Object.freeze({ zh: text(input.zh, `${path}.zh`, 160), en: text(input.en, `${path}.en`, 160) })
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => (typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry)
}

function ontologyTypes(value: unknown, path: string, kit: string): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new Error(`design relation vocabulary: ${path} must be a non-empty array of at most 64 ontology types`)
  const types = value.map((entry, index) => text(entry, `${path}[${index}]`, 256))
  if (new Set(types).size !== types.length) throw new Error(`design relation vocabulary: ${path} contains duplicate ontology types`)
  for (const type of types) if (!type.startsWith(`${kit}/`) && !type.startsWith('design/')) {
    throw new Error(`design relation vocabulary: ${path} ontology types must use ${JSON.stringify(`${kit}/`)} or "design/" namespace`)
  }
  return Object.freeze(types)
}

/** Parse one optional Kit-level `relations.yaml` against its exact Kit pin. */
export function compileDesignRelationVocabulary(source: string | undefined, kit: string, kitVersion: DesignKitVersion): CompiledDesignRelationVocabulary {
  if (source === undefined || source.trim() === '') {
    return Object.freeze({ schemaVersion: DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION, kit, kitVersion,
      revision: `kit-empty:${createHash('sha256').update(`${kit}@${kitVersion}`).digest('hex')}`, relations: Object.freeze([]) })
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) throw new Error('design relation vocabulary: relations.yaml exceeds 128 KiB')
  const input = record(parse(source), 'relations.yaml')
  exactKeys(input, ['schema_version', 'relations'], 'relations.yaml')
  if (input.schema_version !== DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION) {
    throw new Error(`design relation vocabulary: relations.yaml schema_version must be ${DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(input.relations) || input.relations.length > MAX_RELATIONS) {
    throw new Error(`design relation vocabulary: relations.yaml relations must be an array of at most ${MAX_RELATIONS} entries`)
  }
  const seen = new Set<string>()
  const relations = input.relations.map((value, index): DesignRelationDefinition => {
    const path = `relations.yaml.relations[${index}]`
    const relation = record(value, path)
    exactKeys(relation, ['type', 'meaning', 'direction', 'label', 'description', 'domain', 'range', 'inverse', 'cardinality', 'reasoning', 'evidence'], path)
    const type = text(relation.type, `${path}.type`, 80)
    if (!EXTENSION_TYPE.test(type) || !type.startsWith(`${kit}:`)) {
      throw new Error(`design relation vocabulary: ${path}.type must use the current Kit namespace ${JSON.stringify(`${kit}:`)}`)
    }
    if (CORE_BY_TYPE.has(type) || seen.has(type)) throw new Error(`design relation vocabulary: duplicate or reserved type ${JSON.stringify(type)}`)
    seen.add(type)
    const meaning = text(relation.meaning, `${path}.meaning`, 80)
    if (!SAFE_TOKEN.test(meaning) || (!CORE_BY_TYPE.has(meaning) && !meaning.startsWith(`${kit}:`))) {
      throw new Error(`design relation vocabulary: ${path}.meaning must be a Core meaning or use the current Kit namespace`)
    }
    if (meaning === 'contains') {
      throw new Error(`design relation vocabulary: ${path}.meaning cannot reuse the projection-owned Core contains relation`)
    }
    if (relation.direction !== 'forward' && relation.direction !== 'symmetric') {
      throw new Error(`design relation vocabulary: ${path}.direction must be "forward" or "symmetric"`)
    }
    const coreMeaning = CORE_BY_TYPE.get(meaning)
    if (coreMeaning !== undefined && coreMeaning.direction !== relation.direction) {
      throw new Error(`design relation vocabulary: ${path}.direction conflicts with Core meaning ${JSON.stringify(meaning)}`)
    }
    const domain = ontologyTypes(relation.domain, `${path}.domain`, kit)
    const range = ontologyTypes(relation.range, `${path}.range`, kit)
    const inverse = relation.inverse === undefined ? undefined : text(relation.inverse, `${path}.inverse`, 80)
    if (inverse !== undefined && !SAFE_TOKEN.test(inverse)) throw new Error(`design relation vocabulary: ${path}.inverse must be a relation type`)
    let cardinality: DesignRelationDefinition['cardinality']
    if (relation.cardinality !== undefined) {
      const value = record(relation.cardinality, `${path}.cardinality`); exactKeys(value, ['from', 'to'], `${path}.cardinality`)
      if (!['one', 'many'].includes(String(value.from)) || !['one', 'many'].includes(String(value.to))) throw new Error(`design relation vocabulary: ${path}.cardinality requires from/to one or many`)
      cardinality = Object.freeze({ from: value.from as 'one' | 'many', to: value.to as 'one' | 'many' })
    }
    let reasoning: DesignRelationDefinition['reasoning']
    if (relation.reasoning !== undefined) {
      const value = record(relation.reasoning, `${path}.reasoning`); exactKeys(value, ['impact', 'causal', 'transitive'], `${path}.reasoning`)
      for (const key of Object.keys(value)) if (typeof value[key] !== 'boolean') throw new Error(`design relation vocabulary: ${path}.reasoning.${key} must be boolean`)
      reasoning = Object.freeze({ ...(value.impact === undefined ? {} : { impact: value.impact as boolean }),
        ...(value.causal === undefined ? {} : { causal: value.causal as boolean }),
        ...(value.transitive === undefined ? {} : { transitive: value.transitive as boolean }) })
    }
    let evidence: DesignRelationDefinition['evidence']
    if (relation.evidence !== undefined) {
      const value = record(relation.evidence, `${path}.evidence`); exactKeys(value, ['minimum'], `${path}.evidence`)
      if (value.minimum !== 'explicit' && value.minimum !== 'inferred') throw new Error(`design relation vocabulary: ${path}.evidence.minimum must be explicit or inferred`)
      evidence = Object.freeze({ minimum: value.minimum })
    }
    return Object.freeze({ type, meaning, direction: relation.direction,
      label: bilingual(relation.label, `${path}.label`), description: bilingual(relation.description, `${path}.description`),
      ...(domain ? { domain } : {}), ...(range ? { range } : {}), ...(inverse ? { inverse } : {}),
      ...(cardinality ? { cardinality } : {}), ...(reasoning ? { reasoning } : {}), ...(evidence ? { evidence } : {}) })
  })
  const available = new Set([...CORE_DESIGN_RELATIONS.map(relation => relation.type), ...relations.map(relation => relation.type)])
  for (const relation of relations) if (relation.inverse !== undefined && !available.has(relation.inverse)) {
    throw new Error(`design relation vocabulary: relation ${JSON.stringify(relation.type)} inverse ${JSON.stringify(relation.inverse)} is not registered`)
  }
  const canonical = { schemaVersion: DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION as 1, kit, kitVersion, relations }
  return Object.freeze({ ...canonical, revision: `kit-v1:${createHash('sha256').update(stable(canonical)).digest('hex')}`,
    relations: Object.freeze(relations) })
}

/** Resolve exact stored semantics. Unknown types keep their raw type only for display/exact filtering. */
export function resolveDesignRelation(relationType: string, vocabulary?: CompiledDesignRelationVocabulary): ResolvedDesignRelation {
  const canonicalType = CORE_ALIASES.get(relationType) ?? relationType
  const core = CORE_BY_TYPE.get(canonicalType)
  if (core !== undefined) {
    const resolved = { relationType, meaning: core.meaning, direction: core.direction,
      classification: 'core' as const, vocabularyRevision: CORE_REVISION }
    return Object.freeze({ ...resolved, definitionDigest: createHash('sha256').update(stable(resolved)).digest('hex') })
  }
  const selected = vocabulary
  const extension = selected?.relations.find((definition) => definition.type === relationType)
  if (extension !== undefined && selected !== undefined) {
    const resolved = { relationType, meaning: extension.meaning, direction: extension.direction,
      classification: 'kit' as const, vocabularyRevision: selected.revision, kit: selected.kit, kitVersion: String(selected.kitVersion) }
    return Object.freeze({ ...resolved, definitionDigest: createHash('sha256').update(stable(resolved)).digest('hex') })
  }
  const resolved = { relationType, meaning: 'unknown', direction: 'unknown' as const, classification: 'unknown' as const, vocabularyRevision: CORE_REVISION }
  return Object.freeze({ ...resolved, definitionDigest: createHash('sha256').update(stable(resolved)).digest('hex') })
}

/** Check optional Kit endpoint constraints without inventing types for open relations. */
export function designRelationEndpointIssue(relationType: string, fromType: unknown, toType: unknown,
  vocabulary?: CompiledDesignRelationVocabulary): string | undefined {
  const definition = vocabulary?.relations.find(relation => relation.type === relationType)
  if (!definition) return undefined
  if (definition.domain && (typeof fromType !== 'string' || !definition.domain.includes(fromType))) {
    return `${relationType} source ontology type ${JSON.stringify(fromType)} is outside declared domain`
  }
  if (definition.range && (typeof toType !== 'string' || !definition.range.includes(toType))) {
    return `${relationType} target ontology type ${JSON.stringify(toType)} is outside declared range`
  }
  return undefined
}

/** Validate semantics previously generated by Core. Invalid provider bytes are never authoritative. */
export function parsePinnedDesignRelation(value: unknown, relationType: string): ResolvedDesignRelation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const keys = Object.keys(input)
  if (keys.some((key) => !['relationType', 'meaning', 'direction', 'classification', 'vocabularyRevision', 'definitionDigest', 'kit', 'kitVersion'].includes(key))
    || input.relationType !== relationType || typeof input.meaning !== 'string'
    || !['forward', 'symmetric', 'unknown'].includes(String(input.direction))
    || !['core', 'kit', 'unknown'].includes(String(input.classification))
    || typeof input.vocabularyRevision !== 'string' || !/^[0-9a-f]{64}$/u.test(String(input.definitionDigest))) return undefined
  if (input.classification === 'core') {
    if (!/^core-v[1-9][0-9]*:[0-9a-f]{64}$/u.test(input.vocabularyRevision)
      || input.kit !== undefined || input.kitVersion !== undefined || !SAFE_TOKEN.test(input.meaning)
      || (input.direction !== 'forward' && input.direction !== 'symmetric')) return undefined
    const resolved = { relationType, meaning: input.meaning, direction: input.direction as 'forward' | 'symmetric',
      classification: 'core' as const, vocabularyRevision: input.vocabularyRevision }
    return input.definitionDigest === createHash('sha256').update(stable(resolved)).digest('hex')
      ? Object.freeze({ ...resolved, definitionDigest: input.definitionDigest as string }) : undefined
  }
  if (input.classification === 'unknown') {
    if (input.meaning !== 'unknown' || input.direction !== 'unknown' || input.kit !== undefined || input.kitVersion !== undefined) return undefined
    const resolved = { relationType, meaning: 'unknown', direction: 'unknown' as const, classification: 'unknown' as const, vocabularyRevision: input.vocabularyRevision }
    return input.definitionDigest === createHash('sha256').update(stable(resolved)).digest('hex')
      ? Object.freeze({ ...resolved, definitionDigest: input.definitionDigest as string }) : undefined
  }
  if (typeof input.kit !== 'string' || typeof input.kitVersion !== 'string' || !relationType.startsWith(`${input.kit}:`)
    || !/^kit-v1:[0-9a-f]{64}$/u.test(input.vocabularyRevision) || !SAFE_TOKEN.test(input.meaning)
    || (input.direction !== 'forward' && input.direction !== 'symmetric')) return undefined
  const resolved = { relationType, meaning: input.meaning, direction: input.direction as 'forward' | 'symmetric', classification: 'kit' as const,
    vocabularyRevision: input.vocabularyRevision, kit: input.kit, kitVersion: input.kitVersion }
  return input.definitionDigest === createHash('sha256').update(stable(resolved)).digest('hex')
    ? Object.freeze({ ...resolved, definitionDigest: input.definitionDigest as string }) : undefined
}

/** Render the only vocabulary guidance Agents receive, from the compiled registry. */
export function renderDesignRelationVocabulary(vocabulary?: CompiledDesignRelationVocabulary): string {
  const describe = (definition: DesignRelationDefinition) => `${definition.type} (${definition.description.en}; ${definition.direction}`
    + `${definition.domain ? `; domain ${definition.domain.join('|')}` : ''}${definition.range ? `; range ${definition.range.join('|')}` : ''}`
    + `${definition.reasoning?.impact ? '; impact-enabled' : ''}${definition.reasoning?.causal ? '; causal' : ''})`
  const active = vocabulary
  const extensionText = active !== undefined && active.relations.length
    ? ` Kit ${active.kit}@${active.kitVersion} extensions: ${active.relations.map(describe).join('; ')}.` : ''
  return `Choose relationType by cited evidence, not producer or visual distance. Agent-selectable Core vocabulary: ${AGENT_CORE_DESIGN_RELATIONS.map(describe).join('; ')}.${extensionText} Prefer a Kit extension when it precisely matches, otherwise an agent-selectable Core type. The structural contains relation is maintained only by file projection and must not be inferred by a reviewer. If neither selectable vocabulary matches, emit a bounded raw type such as unknown:related-context and explain it in summary; Core retains that raw type for exact filtering but classifies its meaning and direction as unknown, so it cannot support causal or dependency inference.`
}
