/** Automatically compiled ontology contract for one immutable Design Kit. */
import { createHash } from 'node:crypto'
import type { SchemaSpec } from './schema.ts'
import type { CompiledDesignRelationVocabulary } from './design-relation-vocabulary.ts'
import type { DesignExecutionPolicy, DesignKitVersion } from './types.ts'

export const DESIGN_ONTOLOGY_SCHEMA_VERSION = 1
export type DesignKnowledgeRecordKind = 'design-record' | 'design-content' | 'design-artifact'
export type DesignIdentityQuality = 'stable' | 'structural' | 'anonymous'
export type DesignOntologyIdentityPolicy = 'explicit-id' | 'member-key' | 'structural' | 'content-addressed'

export interface DesignOntologyPropertyShape {
  readonly name: string
  readonly schemaPointer: string
  readonly valueType: NonNullable<SchemaSpec['type']>
  readonly required: boolean
  readonly nullable: boolean
  readonly cardinality: Readonly<{ min: number; max: number | null }>
  readonly enumValues?: readonly unknown[]
  readonly role?: 'metadata' | 'reference' | 'content'
  readonly granularity?: 'container' | 'unit' | 'property'
  readonly referenceTarget?: string
  readonly targetType?: string
  /** Exact compiled type of map values or array items, when node-producing. */
  readonly memberType?: string
}

export interface DesignOntologyActionDefinition {
  readonly id: string
  readonly bundle: string
  readonly mode: 'main' | 'subagent'
  readonly handoff: DesignExecutionPolicy['handoff']
  readonly resumeActionId?: string
}

export interface DesignOntologyTypeDefinition {
  readonly id: string
  readonly kit: string
  readonly kitVersion: string
  readonly bundle: string
  readonly file: string
  readonly schemaPointer: string
  /** Instance-source pattern, using `*` for map/array members. */
  readonly sourcePattern: string
  readonly label: string
  readonly valueType: NonNullable<SchemaSpec['type']>
  readonly recordKind: Exclude<DesignKnowledgeRecordKind, 'design-artifact'>
  readonly identityPolicy: DesignOntologyIdentityPolicy
  readonly enumValues?: readonly unknown[]
  readonly additionalProperties?: boolean
  readonly memberType?: string
  readonly properties: readonly DesignOntologyPropertyShape[]
  readonly definitionDigest: string
}

export interface CompiledDesignOntologyContract {
  readonly schemaVersion: typeof DESIGN_ONTOLOGY_SCHEMA_VERSION
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly revision: string
  readonly relationVocabularyRevision: string
  readonly types: readonly DesignOntologyTypeDefinition[]
  /** Existing Bundle execution capabilities, represented as contract actions rather than graph nodes. */
  readonly actions: readonly DesignOntologyActionDefinition[]
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry)
const digest = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex')
const pointerKey = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1')
const bundleFor = (file: string): string => file.split('/')[0] || 'unknown'
const typeId = (kit: string, bundle: string, pointer: string): string => `${kit}/${bundle}#${pointer || '/'}`

interface IndexedSchema {
  spec: SchemaSpec
  schemaPointer: string
  sourcePattern: string
  name: string
  parentKind?: SchemaSpec['type']
}

/** Walk one schema with both schema and instance-source pointers. */
export function indexDesignOntologySchema(schema: SchemaSpec): readonly IndexedSchema[] {
  const result: IndexedSchema[] = []
  const visit = (spec: SchemaSpec, schemaPointer: string, sourcePattern: string, name: string, parentKind?: SchemaSpec['type']): void => {
    result.push({ spec, schemaPointer, sourcePattern, name, parentKind })
    for (const [key, child] of Object.entries(spec.properties ?? {})) {
      visit(child, `${schemaPointer}/properties/${pointerKey(key)}`, `${sourcePattern}/${pointerKey(key)}`, key, spec.type)
    }
    if (spec.value) visit(spec.value, `${schemaPointer}/value`, `${sourcePattern}/*`, name, spec.type)
    if (spec.items) visit(spec.items, `${schemaPointer}/items`, `${sourcePattern}/*`, name, spec.type)
  }
  visit(schema, '', '', 'root')
  return Object.freeze(result)
}

function nodeEligible(entry: IndexedSchema): boolean {
  return ['object', 'map', 'array'].includes(entry.spec.type ?? '') || entry.spec.knowledge?.role === 'content'
}

function identityPolicy(entry: IndexedSchema): DesignOntologyIdentityPolicy {
  if (entry.schemaPointer.endsWith('/value')) return 'member-key'
  if (entry.schemaPointer.endsWith('/items')) {
    return entry.spec.type === 'object' && entry.spec.properties?.id?.type === 'string' ? 'explicit-id' : 'content-addressed'
  }
  return 'structural'
}

function recordKind(entry: IndexedSchema): Exclude<DesignKnowledgeRecordKind, 'design-artifact'> {
  return entry.spec.knowledge?.role === 'content' && entry.spec.knowledge.granularity !== 'property'
    ? 'design-content' : 'design-record'
}

function targetLocation(file: string, target: string): { file: string; sourcePointer: string } {
  if (target.startsWith('#')) return { file, sourcePointer: target.slice(1) }
  const separator = target.indexOf('#')
  return { file: target.slice(0, separator), sourcePointer: target.slice(separator + 1) }
}

/** Compile exact Kit schemas into a deterministic, zero-authoring ontology contract. */
export function compileDesignOntologyContract(input: {
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly schemas: Readonly<Record<string, SchemaSpec>>
  readonly relationVocabulary: CompiledDesignRelationVocabulary
  readonly executionPolicies?: Readonly<Record<string, DesignExecutionPolicy>>
}): CompiledDesignOntologyContract {
  const indexed = new Map<string, readonly IndexedSchema[]>()
  for (const [file, schema] of Object.entries(input.schemas).sort(([a], [b]) => a.localeCompare(b))) {
    indexed.set(file, indexDesignOntologySchema(schema))
  }
  const sourceType = (file: string, pointer: string): string | undefined => {
    const entries = indexed.get(file)
    if (!entries) return undefined
    const direct = entries.find(entry => entry.sourcePattern === pointer)
    const selected = direct?.spec.type === 'map' || direct?.spec.type === 'array'
      ? entries.find(entry => entry.schemaPointer === `${direct.schemaPointer}/${direct.spec.type === 'map' ? 'value' : 'items'}`)
      : direct
    return selected && nodeEligible(selected) ? typeId(input.kit, bundleFor(file), selected.schemaPointer) : undefined
  }
  const memberType = (file: string, entry: IndexedSchema): string | undefined => {
    if (entry.spec.type !== 'map' && entry.spec.type !== 'array') return undefined
    const childPointer = `${entry.schemaPointer}/${entry.spec.type === 'map' ? 'value' : 'items'}`
    const child = indexed.get(file)?.find(candidate => candidate.schemaPointer === childPointer)
    return child && nodeEligible(child) ? typeId(input.kit, bundleFor(file), child.schemaPointer) : undefined
  }
  const definitions: DesignOntologyTypeDefinition[] = []
  for (const [file, entries] of indexed) for (const entry of entries) {
    if (!nodeEligible(entry)) continue
    const required = new Set(entry.spec.required ?? [])
    const properties = Object.entries(entry.spec.properties ?? {}).map(([name, property]): DesignOntologyPropertyShape => {
      const schemaPointer = `${entry.schemaPointer}/properties/${pointerKey(name)}`
      const semanticSpec = property.knowledge ? property
        : property.type === 'array' && property.items?.knowledge ? property.items
          : property.type === 'map' && property.value?.knowledge ? property.value : property
      const role = semanticSpec.knowledge?.role
      const target = role === 'reference' && semanticSpec.knowledge?.target
        ? targetLocation(file, semanticSpec.knowledge.target) : undefined
      const propertyEntry = entries.find(candidate => candidate.schemaPointer === schemaPointer)
      const propertyMemberType = propertyEntry ? memberType(file, propertyEntry) : undefined
      return Object.freeze({ name, schemaPointer, valueType: property.type!, required: required.has(name), nullable: property.nullable === true,
        cardinality: Object.freeze({ min: required.has(name) ? 1 : 0, max: property.type === 'array' || property.type === 'map' ? null : 1 }),
        ...(property.type === 'enum' ? { enumValues: Object.freeze([...(property.values ?? [])]) } : {}),
        ...(role ? { role } : {}), ...(semanticSpec.knowledge?.granularity ? { granularity: semanticSpec.knowledge.granularity } : {}),
        ...(semanticSpec.knowledge?.target ? { referenceTarget: semanticSpec.knowledge.target } : {}),
        ...(target && sourceType(target.file, target.sourcePointer) ? { targetType: sourceType(target.file, target.sourcePointer) } : {}),
        ...(propertyMemberType ? { memberType: propertyMemberType } : {}) })
    })
    const base = {
      id: typeId(input.kit, bundleFor(file), entry.schemaPointer), kit: input.kit, kitVersion: String(input.kitVersion), bundle: bundleFor(file), file,
      schemaPointer: entry.schemaPointer, sourcePattern: entry.sourcePattern,
      label: entry.spec.knowledge?.label ?? entry.name, valueType: entry.spec.type!, recordKind: recordKind(entry),
      identityPolicy: identityPolicy(entry), properties: Object.freeze(properties),
      ...(entry.spec.type === 'enum' ? { enumValues: Object.freeze([...(entry.spec.values ?? [])]) } : {}),
      ...(entry.spec.type === 'object' && entry.spec.additional_properties !== undefined
        ? { additionalProperties: entry.spec.additional_properties } : {}),
      ...(memberType(file, entry) ? { memberType: memberType(file, entry) } : {}),
    }
    definitions.push(Object.freeze({ ...base, definitionDigest: digest(base) }))
  }
  definitions.sort((left, right) => left.id.localeCompare(right.id))
  const declaredTypes = new Set([...definitions.map(definition => definition.id), 'design/artifact#file'])
  for (const relation of input.relationVocabulary.relations) {
    for (const [side, types] of [['domain', relation.domain], ['range', relation.range]] as const) {
      for (const endpointType of types ?? []) if (!declaredTypes.has(endpointType)) {
        throw new Error(`design ontology: relation ${JSON.stringify(relation.type)} ${side} references undeclared type ${JSON.stringify(endpointType)}`)
      }
    }
  }
  const actions = Object.entries(input.executionPolicies ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([bundle, execution]) => Object.freeze({
    id: `${input.kit}/${bundle}#execute`, bundle, mode: execution.mode ?? 'subagent', handoff: execution.handoff,
    ...(execution.handoff === 'user_continue' ? { resumeActionId: String(execution.resumeAction.routeId) } : {}),
  }))
  const canonical = { schemaVersion: DESIGN_ONTOLOGY_SCHEMA_VERSION as 1, kit: input.kit, kitVersion: input.kitVersion,
    relationVocabularyRevision: input.relationVocabulary.revision, types: Object.freeze(definitions), actions: Object.freeze(actions) }
  return Object.freeze({ ...canonical, revision: `ontology-v1:${digest(canonical)}` })
}

/** Resolve one instance schema to its exact compiled type, with a safe fallback. */
export function resolveDesignOntologyType(contract: CompiledDesignOntologyContract | undefined, file: string,
  schemaPointer: string | undefined, recordKind: Exclude<DesignKnowledgeRecordKind, 'design-artifact'>): string {
  const selected = schemaPointer === undefined ? undefined : contract?.types.find(type => type.file === file && type.schemaPointer === schemaPointer)
  if (selected) return selected.id
  const kit = contract?.kit ?? 'unscoped'
  return `${kit}/${bundleFor(file)}#${recordKind === 'design-record' ? 'untyped-record' : 'untyped-content'}`
}

/** Stable pointer lookup for projector-owned schema objects. */
export function designOntologySchemaPointers(schema: SchemaSpec): ReadonlyMap<SchemaSpec, string> {
  return new Map(indexDesignOntologySchema(schema).map(entry => [entry.spec, entry.schemaPointer]))
}

export interface DesignOntologyCoverage {
  readonly contractRevision?: string
  readonly declaredTypes: number
  readonly instantiatedTypes: number
  readonly stable: number
  readonly structural: number
  readonly anonymous: number
  readonly untyped: number
}

/** Summarize instance coverage without depending on a provider or UI graph type. */
export function designOntologyCoverage(nodes: readonly { ontologyType?: string; identityQuality?: DesignIdentityQuality }[],
  contract?: CompiledDesignOntologyContract): DesignOntologyCoverage {
  const types = new Set(nodes.flatMap(node => typeof node.ontologyType === 'string' ? [node.ontologyType] : []))
  const count = (quality: DesignIdentityQuality) => nodes.filter(node => node.identityQuality === quality).length
  return Object.freeze({ ...(contract ? { contractRevision: contract.revision } : {}), declaredTypes: contract?.types.length ?? 0,
    instantiatedTypes: types.size, stable: count('stable'), structural: count('structural'), anonymous: count('anonymous'),
    untyped: nodes.filter(node => node.ontologyType === undefined || node.ontologyType.includes('#untyped-')).length })
}
