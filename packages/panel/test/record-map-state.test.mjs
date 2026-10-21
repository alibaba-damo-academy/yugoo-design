import test from 'node:test'
import assert from 'node:assert/strict'
import { moveRecordMapItem, newRecordMapItem, recordMapPatch, recordMapState } from '../src/record-map-state.ts'

const field = { key: 'fields', control: 'record_map', id_field: 'id', order_field: 'field_order',
  item_fields: [{ key: 'name', control: 'text' }], item_defaults: { name: '', options: [] } }

test('typed record edits retain opaque ids and unknown facts through save/reopen; reads never write defaults', () => {
  const before = { fields: { 'one.with.dots': { id: 'one.with.dots', name: 'Name', unknown: { private: true } }, two: { id: 'two', name: 'Description' } }, field_order: ['two', 'two', 'removed'], outside: true }
  const original = structuredClone(before), { items, ids } = recordMapState(field, before)
  assert.deepEqual(ids, ['two', 'one.with.dots'])
  assert.deepEqual(before, original)
  const newItem = newRecordMapItem(field, 'new'), reordered = moveRecordMapItem(ids, 'one.with.dots', -1)
  const next = { ...before, ...recordMapPatch(field, { ...items, new: newItem }, [...reordered, 'new']) }
  const reopened = JSON.parse(JSON.stringify(next))
  assert.deepEqual(recordMapState(field, reopened).ids, ['one.with.dots', 'two', 'new'])
  assert.deepEqual(reopened.fields['one.with.dots'], original.fields['one.with.dots'])
  assert.equal(reopened.outside, true)
  assert.deepEqual(reopened.fields.new, { id: 'new', name: '', options: [] })
  newItem.options.push('User choice')
  assert.deepEqual(field.item_defaults.options, [])
  assert.deepEqual(moveRecordMapItem(ids, 'two', -1), ids)
  assert.deepEqual(moveRecordMapItem(ids, 'missing', 1), ids)
})

test('invalid nested shapes disable editing without replacing original values', () => {
  for (const value of [{ fields: [] }, { fields: { bad: null } }, { fields: { bad: 17 } }, { field_order: [17] }, { field_order: 'broken' }]) {
    const before = structuredClone(value)
    assert.equal(recordMapState(field, value), undefined)
    assert.deepEqual(value, before)
  }
  assert.deepEqual(recordMapState(field, {}), { items: {}, ids: [] })
  const mapOnly = { key: 'notes', control: 'record_map', item_fields: [{ key: 'text', control: 'text' }] }
  assert.deepEqual(newRecordMapItem(mapOnly, 'opaque-id'), {})
  assert.deepEqual(recordMapPatch(mapOnly, {}, []), { notes: {} })
})
