/** Reversible strict-output transport. Domain schemas and validators stay unchanged. */
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw Object.assign(new Error(`Review executor: ${code}`), { code }) }
const own = (value, key) => Object.hasOwn(value, key)
const common = ['type', 'title', 'description', 'enum', 'const']
const keywords = {
  object: ['properties', 'required', 'additionalProperties'], array: ['items', 'minItems', 'maxItems'],
  string: ['minLength', 'maxLength', 'pattern', 'format'],
  number: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
  integer: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'], boolean: [], null: [],
}

/** Supported subset: closed typed objects, arrays and primitives, including
 * nullable types. Open maps/references/composition need an explicit reversible
 * codec; reject them rather than silently narrow the shared schema. */
export function strictReviewOutput(schema) {
  let nodes = 0, adapted = false
  function visit(source, depth = 0) {
    if (!record(source) || ++nodes > 1024 || depth > 32) fail('UNSUPPORTED_REVIEW_SCHEMA')
    const types = Array.isArray(source.type) ? source.type : [source.type]
    const base = types.find(type => type !== 'null') ?? 'null'
    if (!types.length || !own(keywords, base) || types.some(type => type !== base && type !== 'null') || new Set(types).size !== types.length
      || Object.keys(source).some(key => ![...common, ...keywords[base]].includes(key))) fail('UNSUPPORTED_REVIEW_SCHEMA')
    // Structured literal constraints refer to the original shape. Retaining them
    // after adding required absence fields would silently change their meaning.
    if ((base === 'object' || base === 'array') && (own(source, 'enum') || own(source, 'const'))
      || own(source, 'enum') && (!Array.isArray(source.enum) || !source.enum.length)) fail('UNSUPPORTED_REVIEW_SCHEMA')
    const nullable = types.includes('null') && (!source.enum || source.enum.includes(null)) && (!own(source, 'const') || source.const === null)
    const output = JSON.parse(JSON.stringify(source))
    let decodeValue = value => value
    if (base === 'object') {
      if (source.additionalProperties !== false || !record(source.properties)) fail('UNSUPPORTED_REVIEW_SCHEMA')
      const required = source.required ?? []
      if (!Array.isArray(required) || new Set(required).size !== required.length || required.some(key => !own(source.properties, key))) fail('UNSUPPORTED_REVIEW_SCHEMA')
      const fields = Object.entries(source.properties).map(([name, property]) => {
        const child = visit(property, depth + 1)
        const mode = required.includes(name) ? 'required' : child.nullable ? 'boxed' : 'nullable'
        if (mode !== 'required') adapted = true
        const present = mode === 'boxed' ? { type: 'object', properties: { value: child.schema }, required: ['value'], additionalProperties: false } : child.schema
        return { name, child, mode, schema: mode === 'required' ? child.schema : {
          anyOf: [present, { type: 'null' }],
          description: mode === 'boxed' ? 'Optional transport field: null means absent; {value: ...} means present, including an explicit null value.' : 'Optional transport field: null means absent; otherwise provide the value.',
        } }
      })
      output.properties = Object.fromEntries(fields.map(field => [field.name, field.schema]))
      output.required = fields.map(field => field.name)
      decodeValue = value => {
        if (Object.keys(value).length !== fields.length || fields.some(field => !own(value, field.name))) fail('INVALID_TRANSPORT_RESULT')
        return Object.fromEntries(fields.flatMap(({ name, child, mode }) => {
          const item = value[name]
          if (mode !== 'required' && item === null) return []
          if (mode === 'boxed') {
            if (!record(item) || Object.keys(item).length !== 1 || !own(item, 'value')) fail('INVALID_TRANSPORT_RESULT')
            return [[name, child.decode(item.value)]]
          }
          return [[name, child.decode(item)]]
        }))
      }
    } else if (base === 'array') {
      const item = visit(source.items, depth + 1)
      output.items = item.schema
      decodeValue = value => value.map(item.decode)
    }
    return { schema: output, nullable, decode(value) {
      if (value === null) {
        if (!nullable) fail('INVALID_TRANSPORT_RESULT')
        return null
      }
      const valid = base === 'object' ? record(value) : base === 'array' ? Array.isArray(value)
        : base === 'integer' ? Number.isSafeInteger(value) : base === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : base === 'null' ? false : typeof value === base
      if (!valid) fail('INVALID_TRANSPORT_RESULT')
      return decodeValue(value)
    } }
  }
  if (schema?.type !== 'object') fail('UNSUPPORTED_REVIEW_SCHEMA')
  const compiled = visit(schema)
  return { schema: compiled.schema, decode: compiled.decode,
    instruction: adapted ? 'Follow the supplied strict transport output schema. An optional field represented by a null branch uses null for absence; emit its non-null branch when present. If that branch is a {value: ...} wrapper, preserve the value inside it (including explicit null). Do not invent a value to fill an absent field. The service restores the original domain shape.' : '',
  }
}
