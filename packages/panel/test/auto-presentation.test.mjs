import test from 'node:test'
import assert from 'node:assert/strict'

const { register } = await import('tsx/esm/api')
register()
const { panelPresentation } = await import('../src/client/native-panel-registry.ts')

test('missing presentation is no panel, not an implicit generated panel', () => {
  assert.deepEqual(panelPresentation({}), { mode: 'none' })
  assert.deepEqual(panelPresentation(undefined), { mode: 'none' })
})

test('auto is explicit and cannot claim a native renderer', () => {
  assert.deepEqual(panelPresentation({ presentation: { mode: 'auto' } }), { mode: 'auto' })
  assert.equal(panelPresentation({ presentation: { mode: 'auto', renderer: 'other' } }).mode, 'invalid')
})
