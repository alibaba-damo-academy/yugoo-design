import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { evaluateValidationRules, parseValidationYaml } = await import('../src/validation-rules.ts')
const revision = 'a'.repeat(40)
const file = 'sources/sources.json'
const ref = { file, revision, pointer: '/records/first' }
const document = check => parseValidationYaml(`skill: fixture
rules:
  - id: sources
    scope: [state, completion]
    code: fixture.source
    check: ${JSON.stringify(check)}
`)
const doc = document({ for_each_in_map: 'records', source_reference_map: 'references' })
const state = reference => ({ records: { item: { references: { evidence: reference } } } })
const evaluate = (reference, reader, scope = 'completion') => evaluateValidationRules(doc,
  { skill: 'fixture', state: state(reference), ...(reader ? { sourceTextAt: reader } : {}) }, scope)

test('completion reads the pinned path and pointer, without depending on the current target', async () => {
  const reads = []
  assert.deepEqual(await evaluate(ref, async (pin, path) => {
    reads.push([pin, path]); return '{"records":{"first":{"text":"historical evidence"}}}'
  }), [])
  assert.deepEqual(reads, [[revision, file]])
  for (const source of [undefined, '{}', '{broken']) {
    const issues = await evaluate(ref, async () => source)
    assert.equal(issues.length, 1)
    assert.equal(issues[0].artifact, file)
    assert.match(issues[0].message, /item.references.evidence/)
    assert.match(issues[0].message, /pinned version|cannot be read/)
  }
})

test('state saves preserve unfinished references and never require historical I/O', async () => {
  const before = state(ref)
  assert.deepEqual(await evaluate(ref, async () => { throw Error('must not read on save') }, 'state'), [])
  assert.deepEqual(before, state(ref))
  assert.equal((await evaluate(ref)).length, 1, 'completion cannot silently claim a check without its reader')
  assert.deepEqual(await evaluateValidationRules(doc, { skill: 'fixture', state: { records: { item: {} } } }, 'completion'), [])
})

test('malformed locators retain local guards and do not reach the historical reader', async () => {
  let reads = 0
  for (const invalid of [{ ...ref, file: '../outside' }, { ...ref, revision: 'HEAD' },
    { ...ref, subject_pointer: '/absent' }, { ...ref, pointer: '/bad~2escape' }]) {
    assert.equal((await evaluate(invalid, async () => { reads++; return '{}' })).length, 1)
  }
  assert.equal(reads, 0)
})

test('root and ordered locator maps share exact historical checks and cache duplicate reads', async () => {
  let reads = 0
  const reader = async () => { reads++; return '{"records":{"first":null}}' }
  assert.deepEqual(await evaluateValidationRules(document({ source_reference_map: 'references' }), {
    skill: 'fixture', state: { references: { one: ref, two: ref } }, sourceTextAt: reader,
  }, 'completion'), [])
  assert.equal(reads, 1)
  const ordered = document({ for_each_in_order: { map: 'records', order: 'order' }, source_reference_map: 'references' })
  assert.equal((await evaluateValidationRules(ordered, { skill: 'fixture', state: { ...state(ref), order: ['item'] },
    sourceTextAt: async () => undefined }, 'completion')).length, 1)
})
