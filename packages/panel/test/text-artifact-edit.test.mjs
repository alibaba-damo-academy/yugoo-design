import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { stageTextArtifact, discardTextArtifactRecordEdits, collectTextArtifactEdits, PANEL_TEXT_ARTIFACTS_KEY, boundArtifactPath } = await import('../src/text-artifact-edit.ts')
const initial = { diagrams: { 'id.with.dot': { value: { file: 'example/one.bpmn', title: 'Unchanged' } } } }
const binding = { recordsPath: 'diagrams', record: 'id.with.dot', fieldsPath: 'value', field: 'file' }
test('artifact edits preserve canonical records and replace only their latest transport', () => {
  const before = structuredClone(initial)
  const one = stageTextArtifact(initial, 'example', { binding, path: 'example/one.bpmn', content: '<first/>' })
  const next = stageTextArtifact(one, 'example', { binding, path: 'example/one.bpmn', content: '<last/>' })
  assert.deepEqual(initial, before)
  assert.deepEqual(next.diagrams, before.diagrams)
  assert.deepEqual(collectTextArtifactEdits(initial, next[PANEL_TEXT_ARTIFACTS_KEY]), [{ path: 'example/one.bpmn', content: '<last/>' }])
  assert.equal(next[PANEL_TEXT_ARTIFACTS_KEY].length, 1)
})
test('removed and repointed records never regain old artifact bytes', () => {
  const edit = { binding, path: 'example/one.bpmn', content: '<last/>' }
  assert.throws(() => stageTextArtifact({ diagrams: {} }, 'example', edit), /removed/)
  const changed = structuredClone(initial); changed.diagrams['id.with.dot'].value.file = 'example/new.bpmn'
  assert.throws(() => stageTextArtifact(changed, 'example', edit), /reference changed/)
  assert.deepEqual(collectTextArtifactEdits(changed, [edit]), [])
})
test('artifact transport is owner-confined and prototype-safe', () => {
  for (const path of ['other/a.bpmn', 'example/../a.bpmn', 'example/a.bpmn?x', 'example/\\a.bpmn', 'example/__proto__/a']) {
    assert.throws(() => stageTextArtifact(initial, 'example', { binding, path, content: '' }))
  }
  assert.equal(boundArtifactPath(initial, { ...binding, recordsPath: '__proto__' }), undefined)
  assert.throws(() => collectTextArtifactEdits(initial, {}), /list/)
})
test('deleted artifact records release only their own staged edits', () => {
  const edit = { binding, path: 'example/one.bpmn', content: '<draft/>' }
  const sibling = { ...edit, binding: { ...binding, record: 'other' }, path: 'example/other.bpmn' }
  const otherSection = { ...edit, binding: { ...binding, recordsPath: 'other' } }
  const malformed = { binding: null, path: 'example/broken.bpmn' }
  const malformedOwned = { binding, path: 'example/one.bpmn' }
  const raw = [edit, sibling, otherSection, malformed, malformedOwned, null]
  assert.deepEqual(discardTextArtifactRecordEdits(raw, binding.recordsPath, binding.record), [sibling, otherSection, malformed, malformedOwned, null])
  assert.equal(raw.length, 6, 'input transport is not mutated')
  assert.deepEqual(discardTextArtifactRecordEdits([edit], binding.recordsPath, binding.record), [])
  assert.equal(discardTextArtifactRecordEdits('invalid', binding.recordsPath, binding.record), 'invalid')
  assert.equal(discardTextArtifactRecordEdits(undefined, binding.recordsPath, binding.record), undefined)
})
