import test from 'node:test'
import assert from 'node:assert/strict'
import { pathGet, pathSet, applyDesignEditToDraft, recordDeletionUpdates, orderedRecordIds } from '../src/record-state.ts'

test('record transaction layer works without a browser or rendering runtime', () => {
  assert.equal(typeof window, 'undefined')
  const manifest = { sections: [{ id: 'entries', records_path: 'model.entries', fields_path: 'details', order: 'model.order' }], fields: [] }
  const original = { model: { entries: { 'opaque.id': { details: { title: 'Before', extra: ['Keep'] }, origin: 'original' } }, order: ['opaque.id'] } }
  const updated = applyDesignEditToDraft(original, manifest, { section: 'entries', record: 'opaque.id', field: 'title', value: 'After' })
  assert.equal(updated.model.entries['opaque.id'].details.title, 'After')
  assert.equal(original.model.entries['opaque.id'].details.title, 'Before')
  assert.deepEqual(updated.model.entries['opaque.id'].details.extra, ['Keep'])
  assert.equal(updated.model.entries['opaque.id'].origin, 'original')
  assert.deepEqual(recordDeletionUpdates(manifest, updated, 'entries', 'opaque.id').updates, { 'model.entries': {}, 'model.order': [] })
})

test('state paths reject prototype traversal while opaque map ids retain their own identity', () => {
  for (const path of ['__proto__.polluted', 'constructor.prototype', 'safe..key', ' safe.key']) {
    assert.equal(pathGet({}, path), undefined)
    assert.throws(() => pathSet({}, path, true), /unsafe state path/)
  }
  const ids = JSON.parse('{"__proto__":{"title":"Own id"},"safe":{"title":"Safe"}}')
  assert.deepEqual(orderedRecordIds(ids, ['__proto__', 'missing', 'safe', 'safe']), ['__proto__', 'safe'])
  assert.equal({}.polluted, undefined)
})
