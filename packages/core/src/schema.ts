/**
 * Declarative write-time schema validation. Compiles a skill's `schema.yaml`
 * into a SchemaValidator used at the Design Files write boundary (fail loud).
 * This is the first of the two validation layers; the renderability checkpoint
 * (validate_design) is the second.
 */
import { parse } from 'yaml'
import type { SchemaValidator } from './design-files.ts'

/** A declarative schema node (the subset used by schema.yaml). */
export interface SchemaSpec {
  type?: 'object' | 'map' | 'array' | 'enum' | 'string' | 'number' | 'boolean'
  required?: readonly string[]
  properties?: Record<string, SchemaSpec>
  value?: SchemaSpec
  items?: SchemaSpec
  values?: readonly unknown[]
  /** Reject keys absent from `properties`; omitted preserves open-object behavior. */
  additional_properties?: boolean
  /** Accept JSON null (the Pydantic `X | None` translation); absent means null is rejected. */
  nullable?: boolean
  /** Projection-only semantics; never changes which Design File values validate. */
  knowledge?: {
    role: 'metadata' | 'reference' | 'content'
    /** Root-only Bundle source eligibility, also covering its owned artifacts. */
    source_kind?: 'independent' | 'derived'
    /** Reference collection: local #/pointer or canonical-file.json#/pointer. */
    target?: string
    /** Optional knowledge projection only; properties remain source evidence. */
    granularity?: 'container' | 'unit' | 'property'
    /** Contract-supplied display/context label, never an identity or source fact. */
    label?: string
    /** Metadata map containing versioned source locators, not graph entities. */
    source_reference?: boolean
  }
  readonly [extra: string]: unknown
}

const SCHEMA_TYPES = new Set(['object', 'map', 'array', 'enum', 'string', 'number', 'boolean'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parse and structurally validate one schema.yaml document. */
export function parseSchemaYaml(text: string): SchemaSpec {
  const value = parse(text)
  const errors: string[] = []
  const visit = (candidate: unknown, path: string): void => {
    if (!isRecord(candidate)) {
      errors.push(`${path}: schema node must be an object`)
      return
    }
    if (typeof candidate.type !== 'string' || !SCHEMA_TYPES.has(candidate.type)) {
      errors.push(`${path}: unknown schema type ${JSON.stringify(candidate.type)}`)
      return
    }
    const allowedKeys = new Set(['type', 'nullable', 'knowledge'])
    if (candidate.type === 'object') {
      allowedKeys.add('required')
      allowedKeys.add('properties')
      allowedKeys.add('additional_properties')
    } else if (candidate.type === 'map') allowedKeys.add('value')
    else if (candidate.type === 'array') allowedKeys.add('items')
    else if (candidate.type === 'enum') allowedKeys.add('values')
    for (const key of Object.keys(candidate)) {
      if (!allowedKeys.has(key)) errors.push(`${path}: unsupported schema key ${JSON.stringify(key)}`)
    }
    if (candidate.knowledge !== undefined) {
      const k = candidate.knowledge
      if (!isRecord(k) || !['metadata', 'reference', 'content'].includes(String(k.role))
        || Object.keys(k).some(key => !['role', 'target', 'granularity', 'label', 'source_reference', 'source_kind'].includes(key))) {
        errors.push(`${path}.knowledge: expected metadata, reference or content role`)
      } else {
        if (k.source_kind !== undefined && (path !== '$' || !['independent', 'derived'].includes(String(k.source_kind)))) errors.push(`${path}.knowledge.source_kind: requires root independent or derived source declaration`)
        if (k.source_reference !== undefined && (k.source_reference !== true || k.role !== 'metadata' || candidate.type !== 'map' || !isRecord(candidate.value) || candidate.value.type !== 'object')) errors.push(`${path}.knowledge.source_reference: requires a metadata map of locator objects`)
        if (k.role === 'content') {
          if (!['container', 'unit', 'property'].includes(String(k.granularity))) errors.push(`${path}.knowledge: content requires granularity`)
          if (k.label !== undefined && (typeof k.label !== 'string' || !k.label.trim() || k.label.length > 100 || /[\r\n]/u.test(k.label))) errors.push(`${path}.knowledge.label: expected single-line label (1–100 characters)`)
          if (k.granularity === 'container' && !['object', 'map', 'array'].includes(String(candidate.type))) errors.push(`${path}.knowledge: container requires structured content`)
        } else if (k.granularity !== undefined || k.label !== undefined) errors.push(`${path}.knowledge: granularity and label require content role`)
        if (k.role === 'reference' && candidate.type !== 'string') errors.push(`${path}.knowledge: reference requires a string leaf`)
        if (k.target !== undefined && (k.role !== 'reference' || typeof k.target !== 'string'
          || !/^(?:[\w-]+\/[\w-]+\.json)?#(?:\/(?:[^~]|~[01])*)?$/u.test(k.target))) {
          errors.push(`${path}.knowledge.target: expected canonical file and JSON Pointer collection`)
        }
      }
    }
    if (candidate.nullable !== undefined && typeof candidate.nullable !== 'boolean') {
      errors.push(`${path}.nullable: expected boolean`)
    }
    if (candidate.additional_properties !== undefined && typeof candidate.additional_properties !== 'boolean') {
      errors.push(`${path}.additional_properties: expected boolean`)
    }
    if (candidate.required !== undefined && (!Array.isArray(candidate.required) || candidate.required.some((entry) => typeof entry !== 'string' || entry === ''))) {
      errors.push(`${path}.required: expected non-empty string names`)
    }
    if (candidate.type === 'object') {
      if (candidate.properties !== undefined && !isRecord(candidate.properties)) {
        errors.push(`${path}.properties: expected object`)
      } else if (isRecord(candidate.properties)) {
        for (const [key, child] of Object.entries(candidate.properties)) visit(child, `${path}.properties.${key}`)
      }
    } else if (candidate.additional_properties !== undefined) {
      errors.push(`${path}.additional_properties: only valid for object schemas`)
    }
    if (candidate.type === 'map') {
      if (candidate.value === undefined) errors.push(`${path}.value: required for map`)
      else visit(candidate.value, `${path}.value`)
    }
    if (candidate.type === 'array') {
      if (candidate.items === undefined) errors.push(`${path}.items: required for array`)
      else visit(candidate.items, `${path}.items`)
    }
    if (candidate.type === 'enum' && (!Array.isArray(candidate.values) || candidate.values.length === 0)) {
      errors.push(`${path}.values: expected a non-empty list`)
    }
  }
  visit(value, '$')
  if (errors.length > 0) throw new Error(`schema.yaml invalid:\n- ${errors.join('\n- ')}`)
  return value as SchemaSpec
}

/** Validate one value against a schema node, accumulating path-tagged errors. */
function check(spec: SchemaSpec, value: unknown, path: string, errors: string[]): void {
  if (value === null && spec.nullable === true) return
  switch (spec.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object`)
        return
      }
      const record = value as Record<string, unknown>
      const properties = spec.properties ?? {}
      for (const key of spec.required ?? []) {
        if (!(key in record)) errors.push(`${path}: missing required "${key}"`)
      }
      if (spec.additional_properties === false) {
        for (const key of Object.keys(record)) {
          if (!Object.hasOwn(properties, key)) errors.push(`${path}: unexpected property "${key}"`)
        }
      }
      for (const [key, propSpec] of Object.entries(properties)) {
        if (key in record) check(propSpec, record[key], `${path}.${key}`, errors)
      }
      return
    }
    case 'map': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected map`)
        return
      }
      if (spec.value !== undefined) {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
          check(spec.value, entry, `${path}.${key}`, errors)
        }
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`)
        return
      }
      if (spec.items !== undefined) {
        value.forEach((entry, index) => check(spec.items as SchemaSpec, entry, `${path}[${index}]`, errors))
      }
      return
    }
    case 'enum': {
      if (!(spec.values ?? []).includes(value)) {
        errors.push(`${path}: ${JSON.stringify(value)} not in [${(spec.values ?? []).join(', ')}]`)
      }
      return
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected string`)
      return
    case 'number':
      if (typeof value !== 'number') errors.push(`${path}: expected number`)
      return
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`)
      return
    default:
      return
  }
}

/**
 * Compile a schema node into an error-collecting validator.
 * @param spec - the root schema node.
 * @returns a function returning all validation errors for a candidate value.
 */
export function compileSchema(spec: SchemaSpec): (value: unknown) => string[] {
  return (value) => {
    const errors: string[] = []
    check(spec, value, '$', errors)
    return errors
  }
}

/**
 * Build a write-time SchemaValidator from a schema.yaml source.
 * @param text - the schema.yaml source.
 * @returns a validator suitable for DesignFilesStore.write.
 */
export function validatorFromSchemaYaml(text: string): SchemaValidator {
  const spec = parseSchemaYaml(text)
  const validate = compileSchema(spec)
  return (state) => {
    const errors = validate(state)
    return errors.length === 0 ? { ok: true } : { ok: false, error: errors.join('; ') }
  }
}
