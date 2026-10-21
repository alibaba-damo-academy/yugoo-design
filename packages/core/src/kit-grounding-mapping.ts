/**
 * Kit-owned Grounding semantic mapping (delivery-plan G2). A Kit declares,
 * per Bundle, explicit revision-pinned mappings from Bundle state records to
 * neutral assertion and relationship candidates. Compilation pins every
 * mapping to the exact Kit and Bundle versions it was compiled against and
 * derives one deterministic mapping revision over the canonical declaration.
 * Projection turns one record into authority-free candidates carrying their
 * source anchor, producer reference, and full kit/bundle/mapping provenance.
 * A missing declaration is an explicit empty capability: the compiler and
 * projector never infer assertions or relationships a Kit did not declare.
 */
import { createHash } from 'node:crypto'
import {
  GroundAssertionId,
  GroundAssertionParseError,
  parseGroundAssertionCandidate,
  type GroundAssertionCandidate,
  type GroundJsonValue,
  type GroundProducedByRef,
  type GroundSourceAnchor,
} from './ground-assertions.ts'
import type { DesignBundleVersion, DesignKit, DesignKitVersion } from './types.ts'
import type { AssertionMappingProvenance } from './accepted-assertions.ts'

/** Durable schema revision of Kit grounding declarations. */
export const KIT_GROUNDING_DECLARATION_SCHEMA_VERSION = 1

/**
 * Assertion kinds a Kit may declare for grounding. The kinds that can never
 * become confirmed public facts are not declarable at all.
 */
export type KitGroundingAssertionKind = 'fact' | 'requirement' | 'constraint' | 'decision'

/**
 * Closed source-mapping vocabulary a Kit may declare while projecting Bundle
 * records into grounding candidates. This is not the KAG relation registry:
 * publication into the Design KAG must resolve a candidate through the active
 * Core/Kit relation vocabulary and persist the resulting pinned semantics.
 */
export type GroundRelation = 'supports' | 'motivates' | 'introduces' | 'constrains' | 'challenges' | 'supersedes' | 'verifies'

/** One equality condition on a record field; conditions within one mapping are conjunctive. */
export interface EntityCondition {
  /** Non-root RFC 6901 pointer into the Bundle state record. */
  readonly field: string
  /** Exact JSON value the resolved field must equal (canonical deep equality). */
  readonly equals: GroundJsonValue
}

/**
 * One entity extraction from a Bundle state record. Every mapping whose
 * conditions match produces its entity; there is no first-match-wins.
 */
export interface EntityMapping {
  /** Bundle-unique mapping identity. */
  readonly id: string
  /** Non-root RFC 6901 pointer resolving to the entity's non-empty string subject. */
  readonly subject: string
  /** Optional conjunctive match conditions; absent means always matches. */
  readonly when?: readonly EntityCondition[]
}

/** One declared record-field-to-assertion mapping. */
export interface AssertionMapping {
  /** Bundle-unique mapping identity. */
  readonly id: string
  /** Declarable assertion kind. */
  readonly kind: KitGroundingAssertionKind
  /** Entity mapping in the same Bundle whose resolved subject becomes the claim subject. */
  readonly subjectEntity: string
  /** Claim predicate. */
  readonly predicate: string
  /** Non-root RFC 6901 pointer resolving to the claim value. */
  readonly valuePath: string
  /** Kit-authored one-line claim summary. */
  readonly summary: string
}

/** Relationship endpoint: another resolved entity or a record string field. */
export type GroundRelationshipTarget = { readonly entity: string } | { readonly field: string }

/** One declared entity-to-relationship mapping. */
export interface RelationshipMapping {
  /** Bundle-unique mapping identity. */
  readonly id: string
  /** Closed relationship vocabulary. */
  readonly relation: GroundRelation
  /** Entity mapping in the same Bundle whose resolved subject becomes the origin. */
  readonly fromEntity: string
  /** Target endpoint: a resolved entity subject or a record string field. */
  readonly to: GroundRelationshipTarget
}

/** All grounding mappings one Bundle declares; every section is optional. */
export interface BundleGroundingDeclaration {
  readonly entities?: readonly EntityMapping[]
  readonly assertions?: readonly AssertionMapping[]
  readonly relationships?: readonly RelationshipMapping[]
}

/** Kit-authored grounding declaration: Bundle name to its mappings. */
export interface KitGroundingDeclaration {
  readonly schemaVersion: typeof KIT_GROUNDING_DECLARATION_SCHEMA_VERSION
  readonly bundles: Readonly<Record<string, BundleGroundingDeclaration>>
}

/** One Bundle's mappings compiled against its exact Bundle version. */
export interface CompiledBundleGrounding {
  readonly bundle: string
  readonly bundleVersion: DesignBundleVersion
  readonly entities: readonly EntityMapping[]
  readonly assertions: readonly AssertionMapping[]
  readonly relationships: readonly RelationshipMapping[]
}

/**
 * One Kit's grounding compiled against an exact Kit version. The mapping
 * revision is the deterministic SHA-256 of the canonical declaration and
 * lets consumers reject projections produced against a stale mapping.
 */
export interface CompiledKitGrounding {
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly mappingRevision: string
  readonly bundles: Readonly<Record<string, CompiledBundleGrounding>>
}

/** One Bundle state record submitted for grounding projection. */
export interface BundleGroundingProjectionInput {
  /** Caller-unique identity of the record; part of every derived candidate identity. */
  readonly recordId: string
  /** The Bundle state record the declared mappings read. */
  readonly record: GroundJsonValue
  /** Exact evidence location the caller attributes the record to. */
  readonly source: GroundSourceAnchor
  /** Durable Grounding result and run that requested the projection. */
  readonly producedBy: GroundProducedByRef
}

/** One projected assertion candidate with its kit/bundle/mapping provenance. */
export interface ProjectedGroundAssertion {
  /** The authority-free candidate, already round-tripped through the strict candidate parser. */
  readonly candidate: GroundAssertionCandidate
  readonly recordId: string
  readonly mappingId: string
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly bundle: string
  readonly bundleVersion: DesignBundleVersion
  readonly mappingRevision: string
}

/** One projected relationship candidate with its full provenance for graph rebuilds. */
export interface GroundRelationshipCandidate {
  /** Stable derived identity covering kit, bundle, mapping, and record. */
  readonly id: string
  readonly relation: GroundRelation
  /** Resolved origin entity subject. */
  readonly from: string
  /** Resolved target subject. */
  readonly to: string
  readonly recordId: string
  readonly mappingId: string
  readonly source: GroundSourceAnchor
  readonly producedBy: GroundProducedByRef
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly bundle: string
  readonly bundleVersion: DesignBundleVersion
  readonly mappingRevision: string
}

/** Authority-free grounding output of one record under one compiled Bundle. */
export interface BundleGroundProjection {
  readonly assertions: readonly ProjectedGroundAssertion[]
  readonly relationships: readonly GroundRelationshipCandidate[]
}

type UnknownRecord = Record<string, unknown>

const DECLARATION_KEYS = ['schemaVersion', 'bundles'] as const
const BUNDLE_KEYS = ['entities', 'assertions', 'relationships'] as const
const ENTITY_KEYS = ['id', 'when', 'subject'] as const
const CONDITION_KEYS = ['field', 'equals'] as const
const ASSERTION_KEYS = ['id', 'kind', 'subjectEntity', 'predicate', 'valuePath', 'summary'] as const
const RELATIONSHIP_KEYS = ['id', 'relation', 'fromEntity', 'to'] as const
const DECLARABLE_KINDS = new Set<KitGroundingAssertionKind>(['fact', 'requirement', 'constraint', 'decision'])
const NON_DECLARABLE_KINDS = new Set(['assumption', 'question', 'recommendation'])
const RELATIONS = new Set<GroundRelation>(['supports', 'motivates', 'introduces', 'constrains', 'challenges', 'supersedes', 'verifies'])
const MAPPING_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,63}$/
const BUNDLE_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/

function plainRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new GroundAssertionParseError(path, 'expected a plain object')
  }
  return value as UnknownRecord
}

function exactKeys(input: UnknownRecord, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new GroundAssertionParseError(path, `unknown field ${JSON.stringify(unknown[0])}`)
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new GroundAssertionParseError(path, 'expected a non-empty string')
  return value
}

function mappingId(value: unknown, path: string): string {
  const id = nonEmptyString(value, path)
  if (!MAPPING_ID_RE.test(id)) throw new GroundAssertionParseError(path, 'expected a lowercase mapping id of letters, digits, dot, underscore, dash, or colon')
  return id
}

function isUnsafeToken(token: string): boolean {
  return token === '__proto__' || token === 'prototype' || token === 'constructor'
}

function pointerTokens(pointer: string, path: string): string[] {
  if (!pointer.startsWith('/') || pointer === '/') throw new GroundAssertionParseError(path, 'expected a non-root RFC 6901 pointer')
  const tokens = pointer.slice(1).split('/').map((token) => {
    if (/~(?:[^01]|$)/.test(token)) throw new GroundAssertionParseError(path, 'invalid RFC 6901 escape')
    return token.replace(/~1/g, '/').replace(/~0/g, '~')
  })
  for (const token of tokens) {
    if (token === '') throw new GroundAssertionParseError(path, 'empty path segments are not supported')
    if (isUnsafeToken(token)) throw new GroundAssertionParseError(path, `unsafe path segment ${JSON.stringify(token)}`)
  }
  return tokens
}

function pointer(value: unknown, path: string): string {
  const pointerText = nonEmptyString(value, path)
  pointerTokens(pointerText, path)
  return pointerText
}

function jsonValue(value: unknown, path: string): GroundJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new GroundAssertionParseError(path, 'numbers must be finite')
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${path}[${index}]`))
  const input = plainRecord(value, path)
  const output: Record<string, GroundJsonValue> = {}
  for (const key of Object.keys(input)) {
    if (isUnsafeToken(key)) throw new GroundAssertionParseError(`${path}.${key}`, 'unsafe object key')
    output[key] = jsonValue(input[key], `${path}.${key}`)
  }
  return output
}

function compareCodePoints(first: string, second: string): number {
  const firstPoints = Array.from(first, (character) => character.codePointAt(0) as number)
  const secondPoints = Array.from(second, (character) => character.codePointAt(0) as number)
  const sharedLength = Math.min(firstPoints.length, secondPoints.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (firstPoints[index] as number) - (secondPoints[index] as number)
    if (difference !== 0) return difference
  }
  return firstPoints.length - secondPoints.length
}

function canonicalJson(value: GroundJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodePoints)
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, GroundJsonValue>)[key] as GroundJsonValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function parseCondition(value: unknown, path: string): EntityCondition {
  const input = plainRecord(value, path)
  exactKeys(input, CONDITION_KEYS, path)
  if (!('equals' in input) || input.equals === undefined) throw new GroundAssertionParseError(`${path}.equals`, 'expected an explicit JSON value')
  return Object.freeze({ field: pointer(input.field, `${path}.field`), equals: jsonValue(input.equals, `${path}.equals`) })
}

function parseEntityMapping(value: unknown, path: string): EntityMapping {
  const input = plainRecord(value, path)
  exactKeys(input, ENTITY_KEYS, path)
  const id = mappingId(input.id, `${path}.id`)
  const subject = pointer(input.subject, `${path}.subject`)
  if (input.when === undefined) return Object.freeze({ id, subject })
  if (!Array.isArray(input.when) || input.when.length === 0) throw new GroundAssertionParseError(`${path}.when`, 'expected at least one condition')
  const when = Object.freeze(input.when.map((condition, index) => parseCondition(condition, `${path}.when[${index}]`)))
  return Object.freeze({ id, subject, when })
}

function parseAssertionKind(value: unknown, path: string): KitGroundingAssertionKind {
  const kind = nonEmptyString(value, path)
  if (NON_DECLARABLE_KINDS.has(kind)) throw new GroundAssertionParseError(path, `${kind} can never be declared for Kit grounding`)
  if (!DECLARABLE_KINDS.has(kind as KitGroundingAssertionKind)) throw new GroundAssertionParseError(path, `unsupported value ${JSON.stringify(kind)}`)
  return kind as KitGroundingAssertionKind
}

function parseAssertionMapping(value: unknown, path: string): AssertionMapping {
  const input = plainRecord(value, path)
  exactKeys(input, ASSERTION_KEYS, path)
  return Object.freeze({
    id: mappingId(input.id, `${path}.id`),
    kind: parseAssertionKind(input.kind, `${path}.kind`),
    subjectEntity: mappingId(input.subjectEntity, `${path}.subjectEntity`),
    predicate: nonEmptyString(input.predicate, `${path}.predicate`),
    valuePath: pointer(input.valuePath, `${path}.valuePath`),
    summary: nonEmptyString(input.summary, `${path}.summary`),
  })
}

function parseRelationshipTarget(value: unknown, path: string): GroundRelationshipTarget {
  const input = plainRecord(value, path)
  if ('entity' in input) {
    exactKeys(input, ['entity'], path)
    return Object.freeze({ entity: mappingId(input.entity, `${path}.entity`) })
  }
  exactKeys(input, ['field'], path)
  return Object.freeze({ field: pointer(input.field, `${path}.field`) })
}

function parseRelationshipMapping(value: unknown, path: string): RelationshipMapping {
  const input = plainRecord(value, path)
  exactKeys(input, RELATIONSHIP_KEYS, path)
  const relation = nonEmptyString(input.relation, `${path}.relation`)
  if (!RELATIONS.has(relation as GroundRelation)) throw new GroundAssertionParseError(`${path}.relation`, `unsupported value ${JSON.stringify(relation)}`)
  return Object.freeze({
    id: mappingId(input.id, `${path}.id`),
    relation: relation as GroundRelation,
    fromEntity: mappingId(input.fromEntity, `${path}.fromEntity`),
    to: parseRelationshipTarget(input.to, `${path}.to`),
  })
}

function mappingArray<T>(value: unknown, path: string, parse: (value: unknown, path: string) => T): readonly T[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new GroundAssertionParseError(path, 'expected an array')
  return Object.freeze(value.map((item, index) => parse(item, `${path}[${index}]`)))
}

function parseBundleDeclaration(value: unknown, path: string): BundleGroundingDeclaration {
  const input = plainRecord(value, path)
  exactKeys(input, BUNDLE_KEYS, path)
  const entities = mappingArray(input.entities, `${path}.entities`, parseEntityMapping)
  const assertions = mappingArray(input.assertions, `${path}.assertions`, parseAssertionMapping)
  const relationships = mappingArray(input.relationships, `${path}.relationships`, parseRelationshipMapping)
  const seen = new Set<string>()
  for (const mapping of [...(entities ?? []), ...(assertions ?? []), ...(relationships ?? [])]) {
    if (seen.has(mapping.id)) throw new GroundAssertionParseError(path, `duplicate mapping id ${JSON.stringify(mapping.id)}`)
    seen.add(mapping.id)
  }
  const entityIds = new Set((entities ?? []).map((entity) => entity.id))
  for (const assertion of assertions ?? []) {
    if (!entityIds.has(assertion.subjectEntity)) {
      throw new GroundAssertionParseError(`${path}.assertions`, `subjectEntity ${JSON.stringify(assertion.subjectEntity)} is not an entity mapping of this Bundle`)
    }
  }
  for (const relationship of relationships ?? []) {
    if (!entityIds.has(relationship.fromEntity)) {
      throw new GroundAssertionParseError(`${path}.relationships`, `fromEntity ${JSON.stringify(relationship.fromEntity)} is not an entity mapping of this Bundle`)
    }
    if ('entity' in relationship.to && !entityIds.has(relationship.to.entity)) {
      throw new GroundAssertionParseError(`${path}.relationships`, `to.entity ${JSON.stringify(relationship.to.entity)} is not an entity mapping of this Bundle`)
    }
  }
  const declaration: { entities?: readonly EntityMapping[]; assertions?: readonly AssertionMapping[]; relationships?: readonly RelationshipMapping[] } = {}
  if (entities !== undefined) declaration.entities = entities
  if (assertions !== undefined) declaration.assertions = assertions
  if (relationships !== undefined) declaration.relationships = relationships
  return Object.freeze(declaration)
}

/**
 * Parse one Kit-authored grounding declaration. Strict exact-key validation
 * fails loud on unknown fields, non-declarable assertion kinds, relations
 * outside the closed vocabulary, duplicate mapping ids, entity references
 * that do not resolve within the same Bundle, and unsafe or root pointers.
 * @param value - raw declaration read from Kit content.
 * @param path - diagnostic path prefix.
 * @returns the validated declaration.
 */
export function parseKitGroundingDeclaration(value: unknown, path = '$'): KitGroundingDeclaration {
  const input = plainRecord(value, path)
  exactKeys(input, DECLARATION_KEYS, path)
  if (input.schemaVersion !== KIT_GROUNDING_DECLARATION_SCHEMA_VERSION) throw new GroundAssertionParseError(`${path}.schemaVersion`, 'expected 1')
  const rawBundles = plainRecord(input.bundles, `${path}.bundles`)
  const bundles: Record<string, BundleGroundingDeclaration> = {}
  for (const name of Object.keys(rawBundles)) {
    if (!BUNDLE_NAME_RE.test(name)) throw new GroundAssertionParseError(`${path}.bundles`, `invalid Bundle name ${JSON.stringify(name)}`)
    bundles[name] = parseBundleDeclaration(rawBundles[name], `${path}.bundles[${JSON.stringify(name)}]`)
  }
  return Object.freeze({ schemaVersion: KIT_GROUNDING_DECLARATION_SCHEMA_VERSION, bundles: Object.freeze(bundles) })
}

function conditionValue(condition: EntityCondition): GroundJsonValue {
  return { equals: condition.equals, field: condition.field }
}

function entityValue(entity: EntityMapping): GroundJsonValue {
  const value: Record<string, GroundJsonValue> = { id: entity.id, subject: entity.subject }
  if (entity.when !== undefined) value.when = entity.when.map(conditionValue)
  return value
}

function assertionValue(assertion: AssertionMapping): GroundJsonValue {
  return {
    id: assertion.id,
    kind: assertion.kind,
    predicate: assertion.predicate,
    subjectEntity: assertion.subjectEntity,
    summary: assertion.summary,
    valuePath: assertion.valuePath,
  }
}

function relationshipValue(relationship: RelationshipMapping): GroundJsonValue {
  const to: GroundJsonValue = 'entity' in relationship.to ? { entity: relationship.to.entity } : { field: relationship.to.field }
  return { fromEntity: relationship.fromEntity, id: relationship.id, relation: relationship.relation, to }
}

function canonicalDeclarationValue(declaration: KitGroundingDeclaration): GroundJsonValue {
  const bundles: Record<string, GroundJsonValue> = {}
  for (const name of Object.keys(declaration.bundles)) {
    const declared = declaration.bundles[name] as BundleGroundingDeclaration
    const value: Record<string, GroundJsonValue> = {}
    if (declared.entities !== undefined) value.entities = declared.entities.map(entityValue)
    if (declared.assertions !== undefined) value.assertions = declared.assertions.map(assertionValue)
    if (declared.relationships !== undefined) value.relationships = declared.relationships.map(relationshipValue)
    bundles[name] = value
  }
  return { bundles, schemaVersion: declaration.schemaVersion }
}

function kitGroundingMappingRevision(declaration: KitGroundingDeclaration): string {
  return sha256Hex(canonicalJson(canonicalDeclarationValue(declaration)))
}

/**
 * Compile one Kit's grounding declaration against the Kit's exact loaded
 * revision. Every Bundle the Kit contains appears in the result: Bundles the
 * declaration does not mention compile to explicit empty mappings. A declared
 * Bundle the Kit does not contain fails loud. Omitting the declaration
 * compiles the explicit empty capability with a deterministic mapping
 * revision. The mapping revision is the SHA-256 of the canonical declaration
 * and changes whenever any mapping changes.
 * @param kit - loaded Kit version.
 * @param declaration - parsed declaration, or undefined for empty capability.
 * @returns the compiled, revision-pinned grounding.
 */
export function compileKitGrounding(kit: DesignKit, declaration?: KitGroundingDeclaration): CompiledKitGrounding {
  const emptyDeclaration: KitGroundingDeclaration = Object.freeze({ schemaVersion: KIT_GROUNDING_DECLARATION_SCHEMA_VERSION, bundles: Object.freeze({}) })
  const resolved = declaration ?? emptyDeclaration
  for (const name of Object.keys(resolved.bundles)) {
    if (!kit.skills.some((skill) => skill.name === name)) {
      throw new GroundAssertionParseError(`$.bundles[${JSON.stringify(name)}]`, 'declares grounding for a Bundle the Kit does not contain')
    }
  }
  const bundles: Record<string, CompiledBundleGrounding> = {}
  for (const skill of kit.skills) {
    const declared = resolved.bundles[skill.name]
    bundles[skill.name] = Object.freeze({
      bundle: skill.name,
      bundleVersion: skill.version,
      entities: Object.freeze(declared?.entities ?? []),
      assertions: Object.freeze(declared?.assertions ?? []),
      relationships: Object.freeze(declared?.relationships ?? []),
    })
  }
  return Object.freeze({
    kit: kit.name,
    kitVersion: kit.version,
    mappingRevision: kitGroundingMappingRevision(resolved),
    bundles: Object.freeze(bundles),
  })
}

function resolvePointer(record: GroundJsonValue, tokens: readonly string[]): GroundJsonValue | undefined {
  let current: GroundJsonValue | undefined = record
  for (const token of tokens) {
    if (current === null || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return undefined
      const index = Number(token)
      if (index >= current.length) return undefined
      current = current[index]
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return undefined
      current = (current as Record<string, GroundJsonValue>)[token]
    }
  }
  return current
}

function entityMatches(record: GroundJsonValue, entity: EntityMapping): boolean {
  if (entity.when === undefined) return true
  return entity.when.every((condition) => {
    const resolved = resolvePointer(record, pointerTokens(condition.field, `entity ${entity.id}`))
    return resolved !== undefined && canonicalJson(resolved) === canonicalJson(condition.equals)
  })
}

/**
 * Derive a stable readable identity: a sanitized label prefix plus a SHA-256
 * truncation of a canonical identity, always within the GroundAssertionId
 * vocabulary and length bound.
 */
function deriveGroundId(label: string, identity: Record<string, GroundJsonValue>): string {
  const digest = sha256Hex(canonicalJson(identity)).slice(0, 40)
  const sanitized = label
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 64)
  return `ground:${sanitized === '' ? 'kit' : sanitized}.${digest}`
}

function projectionRecordId(input: BundleGroundingProjectionInput): string {
  if (typeof input.recordId !== 'string' || input.recordId.trim() === '') {
    throw new GroundAssertionParseError('$.recordId', 'expected a non-empty string')
  }
  return input.recordId
}

/**
 * Project one Bundle state record into authority-free assertion and
 * relationship candidates under one compiled Kit grounding. Every entity
 * mapping whose conjunctive conditions match produces its entity; assertion
 * and relationship mappings whose referenced entity did not match are
 * skipped explicitly, never inferred. Resolved pointers that a matched
 * mapping needs fail loud, as does projecting a Bundle outside the compiled
 * Kit. Every assertion candidate round-trips the strict candidate parser as
 * its final self-check, and every output carries the record id, source
 * anchor, producer reference, and kit/bundle/mapping revision provenance.
 * @param compiled - compiled Kit grounding to project under.
 * @param bundle - Bundle name within the compiled Kit.
 * @param input - record identity, record value, source anchor, and producer.
 * @returns projected assertions and relationships in declaration order.
 */
export function projectBundleGroundCandidates(compiled: CompiledKitGrounding, bundle: string, input: BundleGroundingProjectionInput): BundleGroundProjection {
  const recordId = projectionRecordId(input)
  const compiledBundle = compiled.bundles[bundle]
  if (compiledBundle === undefined) throw new GroundAssertionParseError(`$.bundles[${JSON.stringify(bundle)}]`, 'is not part of the compiled Kit grounding')
  const entitySubjects = new Map<string, string>()
  for (const entity of compiledBundle.entities) {
    if (!entityMatches(input.record, entity)) continue
    const subject = resolvePointer(input.record, pointerTokens(entity.subject, `entity ${entity.id}.subject`))
    if (typeof subject !== 'string' || subject.trim() === '') {
      throw new GroundAssertionParseError(`entity ${entity.id}.subject`, `pointer ${entity.subject} must resolve to a non-empty string in record ${JSON.stringify(recordId)}`)
    }
    entitySubjects.set(entity.id, subject)
  }
  const assertions: ProjectedGroundAssertion[] = []
  for (const mapping of compiledBundle.assertions) {
    const subject = entitySubjects.get(mapping.subjectEntity)
    if (subject === undefined) continue
    const value = resolvePointer(input.record, pointerTokens(mapping.valuePath, `assertion ${mapping.id}.valuePath`))
    if (value === undefined) {
      throw new GroundAssertionParseError(`assertion ${mapping.id}.valuePath`, `pointer ${mapping.valuePath} does not resolve in record ${JSON.stringify(recordId)}`)
    }
    const identity: Record<string, GroundJsonValue> = {
      bundle,
      bundleVersion: compiledBundle.bundleVersion,
      kit: compiled.kit,
      kitVersion: compiled.kitVersion,
      mappingId: mapping.id,
      mappingRevision: compiled.mappingRevision,
      recordId,
      scope: 'assertion',
    }
    const candidate: GroundAssertionCandidate = {
      schemaVersion: 1,
      id: GroundAssertionId(deriveGroundId(`kit.${compiled.kit}.${bundle}.${mapping.id}`, identity)),
      kind: mapping.kind,
      claim: { subject, predicate: mapping.predicate, value, summary: mapping.summary },
      sources: [input.source],
      producedBy: input.producedBy,
      productAnchors: [],
      supersedes: [],
    }
    assertions.push(Object.freeze({
      candidate: parseGroundAssertionCandidate(candidate),
      recordId,
      mappingId: mapping.id,
      kit: compiled.kit,
      kitVersion: compiled.kitVersion,
      bundle,
      bundleVersion: compiledBundle.bundleVersion,
      mappingRevision: compiled.mappingRevision,
    }))
  }
  const relationships: GroundRelationshipCandidate[] = []
  for (const mapping of compiledBundle.relationships) {
    const from = entitySubjects.get(mapping.fromEntity)
    if (from === undefined) continue
    let to: string
    if ('entity' in mapping.to) {
      const resolved = entitySubjects.get(mapping.to.entity)
      if (resolved === undefined) continue
      to = resolved
    } else {
      const resolved = resolvePointer(input.record, pointerTokens(mapping.to.field, `relationship ${mapping.id}.to.field`))
      if (typeof resolved !== 'string' || resolved.trim() === '') {
        throw new GroundAssertionParseError(`relationship ${mapping.id}.to.field`, `pointer ${mapping.to.field} must resolve to a non-empty string in record ${JSON.stringify(recordId)}`)
      }
      to = resolved
    }
    const identity: Record<string, GroundJsonValue> = {
      bundle,
      bundleVersion: compiledBundle.bundleVersion,
      kit: compiled.kit,
      kitVersion: compiled.kitVersion,
      mappingId: mapping.id,
      mappingRevision: compiled.mappingRevision,
      recordId,
      scope: 'relationship',
    }
    relationships.push(Object.freeze({
      id: deriveGroundId(`rel.${compiled.kit}.${bundle}.${mapping.id}`, identity),
      relation: mapping.relation,
      from,
      to,
      recordId,
      mappingId: mapping.id,
      source: input.source,
      producedBy: input.producedBy,
      kit: compiled.kit,
      kitVersion: compiled.kitVersion,
      bundle,
      bundleVersion: compiledBundle.bundleVersion,
      mappingRevision: compiled.mappingRevision,
    }))
  }
  return Object.freeze({ assertions: Object.freeze(assertions), relationships: Object.freeze(relationships) })
}

/** One mapping provenance field does not match the current compiled grounding. */
export class GroundingPinMismatchError extends Error {
  readonly field: 'kit' | 'kitVersion' | 'bundle' | 'bundleVersion' | 'mappingRevision' | 'mappingId'
  readonly expected: string
  readonly actual: string

  /**
   * @param field - provenance field that failed the pin check.
   * @param expected - value the current compiled grounding holds.
   * @param actual - value the submitted provenance carries.
   */
  constructor(field: 'kit' | 'kitVersion' | 'bundle' | 'bundleVersion' | 'mappingRevision' | 'mappingId', expected: string, actual: string) {
    super(`kit grounding pin mismatch: ${field} ${JSON.stringify(actual)} does not match compiled grounding ${JSON.stringify(expected)}`)
    this.name = 'GroundingPinMismatchError'
    this.field = field
    this.expected = expected
    this.actual = actual
  }
}

/**
 * Require one persisted mapping provenance to equal the current compiled
 * grounding exactly. Promotions call this before committing so a candidate
 * produced against a stale Kit, Bundle, or mapping revision fails loud with
 * zero writes.
 * @param compiled - the current compiled Kit grounding.
 * @param provenance - mapping provenance recorded with the candidate.
 */
export function requireGroundingPinMatch(compiled: CompiledKitGrounding, provenance: AssertionMappingProvenance): void {
  if (provenance.kit !== compiled.kit) throw new GroundingPinMismatchError('kit', compiled.kit, provenance.kit)
  if (provenance.kitVersion !== compiled.kitVersion) throw new GroundingPinMismatchError('kitVersion', compiled.kitVersion, provenance.kitVersion)
  const bundle = compiled.bundles[provenance.bundle]
  if (bundle === undefined) throw new GroundingPinMismatchError('bundle', [...Object.keys(compiled.bundles)].sort().join(', '), provenance.bundle)
  if (provenance.bundleVersion !== bundle.bundleVersion) throw new GroundingPinMismatchError('bundleVersion', bundle.bundleVersion, provenance.bundleVersion)
  if (provenance.mappingRevision !== compiled.mappingRevision) throw new GroundingPinMismatchError('mappingRevision', compiled.mappingRevision, provenance.mappingRevision)
  if (!bundle.assertions.some((mapping) => mapping.id === provenance.mappingId)) {
    throw new GroundingPinMismatchError('mappingId', bundle.assertions.map((mapping) => mapping.id).sort().join(', '), provenance.mappingId)
  }
}
