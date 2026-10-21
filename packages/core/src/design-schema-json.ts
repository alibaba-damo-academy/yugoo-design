/** Pure translation from validated Design schema specs to DSH structured-output schemas. */
import type { JsonSchemaNode, ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { SchemaSpec } from './schema.ts'

type ScalarType = 'string' | 'number' | 'boolean' | 'null'
type Scalar = string | number | boolean | null

function enumScalar(value: unknown, path: string): { readonly type: ScalarType; readonly value: Scalar } {
  if (value === null) return { type: 'null', value }
  if (typeof value === 'string' || typeof value === 'boolean') return { type: value === true || value === false ? 'boolean' : 'string', value }
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) {
    return { type: 'number', value }
  }
  throw new Error(`${path}: enum value ${String(value)} is not a supported lossless JSON scalar`)
}

function enumSchema(values: readonly unknown[] | undefined, path: string): JsonSchemaNode {
  if (values === undefined || values.length === 0) throw new Error(`${path}.values: expected a non-empty list`)
  const groups = new Map<ScalarType, Scalar[]>()
  for (const value of values) {
    const scalar = enumScalar(value, `${path}.values`)
    const group = groups.get(scalar.type) ?? []
    group.push(scalar.value)
    groups.set(scalar.type, group)
  }
  const branches = [...groups].map(([type, entries]) => ({ type, enum: entries }) satisfies JsonSchemaNode)
  return branches.length === 1 ? branches[0] as JsonSchemaNode : { oneOf: branches }
}

function nullable(schema: JsonSchemaNode, enabled: boolean | undefined): JsonSchemaNode {
  if (enabled !== true) return schema
  if (schema.type === 'null') return schema
  if (schema.oneOf !== undefined && schema.oneOf.some((branch) => branch.type === 'null')) return schema
  return { oneOf: [schema, { type: 'null' }] }
}

function translate(spec: SchemaSpec, path: string): JsonSchemaNode {
  let schema: JsonSchemaNode
  switch (spec.type) {
    case 'object': {
      const properties: Record<string, JsonSchemaNode> = {}
      for (const [name, child] of Object.entries(spec.properties ?? {})) {
        properties[name] = translate(child, `${path}.properties.${name}`)
      }
      for (const name of spec.required ?? []) {
        if (!Object.hasOwn(properties, name)) {
          throw new Error(`${path}.required names ${JSON.stringify(name)} which is not in properties`)
        }
      }
      schema = {
        type: 'object',
        ...(spec.properties === undefined ? {} : { properties }),
        ...(spec.required === undefined ? {} : { required: [...spec.required] }),
        ...(spec.additional_properties === undefined ? {} : { additionalProperties: spec.additional_properties }),
      }
      break
    }
    case 'map':
      // Pinned DSH accepts only boolean additionalProperties. The authoritative
      // SchemaSpec validator enforces `value` before persistence and repair.
      schema = { type: 'object', additionalProperties: true }
      break
    case 'array':
      if (spec.items === undefined) throw new Error(`${path}.items: required for array`)
      schema = { type: 'array', items: translate(spec.items, `${path}.items`) }
      break
    case 'enum':
      schema = enumSchema(spec.values, path)
      break
    case 'string':
    case 'number':
    case 'boolean':
      schema = { type: spec.type }
      break
    default:
      throw new Error(`${path}: unsupported schema type ${JSON.stringify(spec.type)}`)
  }
  return nullable(schema, spec.nullable)
}

/**
 * Translate one validated object-rooted Design schema for focused structured output.
 * Map value constraints remain authoritative in `SchemaSpec` validation because
 * pinned DSH supports only boolean `additionalProperties`.
 * @param spec - validated Design schema specification.
 * @returns the DSH-supported object-rooted formatting schema.
 */
export function designSchemaToObjectJsonSchema(spec: SchemaSpec): ObjectJsonSchema {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec) || spec.type !== 'object') {
    throw new Error('design structured-output schema root must be object')
  }
  if (spec.nullable === true) throw new Error('design structured-output schema root cannot be nullable')
  return translate(spec, '$') as ObjectJsonSchema
}
