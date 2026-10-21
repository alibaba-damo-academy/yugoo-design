import test from 'node:test'
import assert from 'node:assert/strict'
import { strictReviewOutput } from '../src/review-output-schema.mjs'
import * as core from '../../core/lib/index.js'

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
function assertStrict(schema) {
  if (schema.type === 'object' || Array.isArray(schema.type) && schema.type.includes('object')) {
    assert.equal(schema.additionalProperties, false)
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
    Object.values(schema.properties).forEach(assertStrict)
  }
  schema.anyOf?.forEach(assertStrict)
  if (schema.items) assertStrict(schema.items)
}

test('every shared review contract produces strict transport without mutating the source', () => {
  const sources = [core.DESIGN_CLARITY_OUTPUT_SCHEMA, ...[core.OFFICIAL_GROUNDING_PROFILE, core.OFFICIAL_REFLECTION_PROFILE, core.OFFICIAL_ALIGNMENT_PROFILE].map(id => core.officialAdvisoryProfile(id).outputSchema)]
  for (const source of sources) {
    const before = JSON.stringify(source), transport = strictReviewOutput(source)
    assertStrict(transport.schema)
    assert.equal(JSON.stringify(source), before)
  }
})

test('clarity absence and present value return through the unchanged shared parser', () => {
  const transport = strictReviewOutput(core.DESIGN_CLARITY_OUTPUT_SCHEMA)
  const base = { summary: 'Evidence', u: { score: 40, evidence: 'Users' }, s: { score: 30, evidence: 'Structure' }, t: { score: 20, evidence: 'Criteria' } }
  const absent = transport.decode({ ...base, nextGap: null })
  assert.deepEqual(absent, base)
  assert.doesNotThrow(() => core.parseDesignClarityInput(absent))
  const present = transport.decode({ ...base, nextGap: 'Missing evidence' })
  assert.equal(core.parseDesignClarityInput(present).nextGap, 'Missing evidence')
})

test('generic nested optionals in arrays preserve empty and false values', () => {
  const source = object({ rows: { type: 'array', items: object({ label: { type: 'string' }, note: { type: 'string' }, score: { type: 'integer' }, enabled: { type: 'boolean' } }, ['label']) } }, ['rows'])
  const transport = strictReviewOutput(source)
  assertStrict(transport.schema)
  assert.deepEqual(transport.decode({ rows: [{ label: 'A', note: null, score: 0, enabled: false }, { label: 'B', note: '', score: null, enabled: null }] }),
    { rows: [{ label: 'A', score: 0, enabled: false }, { label: 'B', note: '' }] })
})

test('optional explicit null remains distinct from absent; required nullable null is preserved', () => {
  const source = object({ optional: { type: ['string', 'null'] }, required: { type: ['integer', 'null'] } }, ['required'])
  const transport = strictReviewOutput(source)
  assertStrict(transport.schema)
  assert.deepEqual(transport.decode({ optional: null, required: null }), { required: null })
  assert.deepEqual(transport.decode({ optional: { value: null }, required: null }), { optional: null, required: null })
  assert.deepEqual(transport.decode({ optional: { value: 'text' }, required: 0 }), { optional: 'text', required: 0 })
})

test('optional nullable objects preserve omission, null and recursively decoded values', () => {
  const inner = { ...object({ tag: { type: 'string' } }), type: ['object', 'null'] }
  const transport = strictReviewOutput(object({ entry: inner }))
  assert.deepEqual(transport.decode({ entry: null }), {})
  assert.deepEqual(transport.decode({ entry: { value: null } }), { entry: null })
  assert.deepEqual(transport.decode({ entry: { value: { tag: null } } }), { entry: {} })
})

test('constraints remain on non-null transport branch, not silently dropped', () => {
  const value = { type: 'string', enum: ['a', 'b'], minLength: 1, maxLength: 1 }
  const transport = strictReviewOutput(object({ choice: value }))
  assert.deepEqual(transport.schema.properties.choice.anyOf[0], value)
})

for (const value of [{}, { required: null }, { required: 'ok', extra: 1 }, { required: 'ok', optional: { value: null, extra: 1 } }]) test(`malformed transport rejects ${JSON.stringify(value)}`, () => {
  const transport = strictReviewOutput(object({ required: { type: 'string' }, optional: { type: ['string', 'null'] } }, ['required']))
  assert.throws(() => transport.decode(value), { code: 'INVALID_TRANSPORT_RESULT' })
})

for (const source of [
  { type: 'object', properties: {} },
  { type: 'object', properties: {}, additionalProperties: { type: 'string' } },
  object({ item: { $ref: '#/unknown' } }),
  object({ item: { anyOf: [{ type: 'string' }, { type: 'number' }] } }),
  object({}, ['missing']),
  { ...object({ x: { type: 'string' } }), const: {} },
  { ...object({ x: { type: 'string' } }), enum: [{}] },
  object({ rows: { type: 'array', items: object({ x: { type: 'string' } }), const: [{}] } }),
  object({ invalid: { type: 'string', enum: 'not-an-array' } }),
  object({ invalid: { type: [] } }),
]) test('unsupported structures reject rather than narrowing domain contracts', () => {
  assert.throws(() => strictReviewOutput(source), { code: 'UNSUPPORTED_REVIEW_SCHEMA' })
})

test('property names are data, including prototype-sensitive names', () => {
  const transport = strictReviewOutput(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"additionalProperties":false}'))
  const decoded = transport.decode(JSON.parse('{"__proto__":"kept"}'))
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype)
  assert.equal(Object.hasOwn(decoded, '__proto__'), true)
  assert.equal(decoded.__proto__, 'kept')
})
