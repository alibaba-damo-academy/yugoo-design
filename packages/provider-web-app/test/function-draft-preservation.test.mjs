import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { WEB_APP_DRAFT_COMPARATORS } = await import('../src/client/packs/web-app-draft-comparators.ts')
const equal = WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.function-modules/v1']
const state = { functions: { 'F-1': { function_id: 'F-1', function_name: 'Search', function_description: 'Find references',
  function_epic: 'Research', reason: 'Current need', details: { behaviors: { 'B-1': { description: 'Find evidence' } } },
  references: { 'R-1': { file: 'context/context.json', pointer: '/records/r1', revision: 'a'.repeat(40) } } } } }

test('function Save detects details, source, reasons and group changes, not just overview fields', () => {
  assert.equal(equal(state, structuredClone(state)), true)
  for (const mutate of [
    value => { value.details.behaviors['B-1'].description = 'View evidence and source' },
    value => { value.references['R-1'].revision = 'b'.repeat(40) },
    value => { value.reason = 'Changed basis' },
    value => { value.function_epic = 'Writing' },
    value => { delete value.details },
  ]) {
    const changed = structuredClone(state); mutate(changed.functions['F-1'])
    assert.equal(equal(state, changed), false)
  }
  assert.equal(equal(state, { functions: {} }), false)
})

test('object key order does not fake an edit, and absent old maps remain compatible', () => {
  const reordered = { functions: { 'F-1': Object.fromEntries(Object.entries(state.functions['F-1']).reverse()) } }
  assert.equal(equal(state, reordered), true)
  assert.equal(equal({}, { functions: {} }), true)
  assert.equal(equal(null, state), false)
})
