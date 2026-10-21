import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePanelManifest } from '../src/panel-dsl.ts'

const condition = () => ({ all: [{ field: 'source_ref', in: [''] }, { field: 'connection', in: ['existing', 'other'] }] })
const fixture = (visible_when = condition()) => ({
  version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }, { id: 'elsewhere', title: 'Elsewhere' }],
  fields: [
    { key: 'source_ref', control: 'text', applies_to: ['items'] },
    { key: 'connection', control: 'text', applies_to: ['items'] },
    { key: 'detail', control: 'text', applies_to: ['items'], visible_when },
    { key: 'foreign', control: 'text', applies_to: ['elsewhere'] },
  ],
  ui: { id: 'form', component: 'record_form', source: 'items' },
})

test('visibility accepts legacy gates and a non-empty flat conjunction', () => {
  for (const visible_when of [
    { field: 'source_ref', in: [''] }, condition(),
    { all: [{ field: 'connection', in: ['existing'] }] },
  ]) assert.deepEqual(validatePanelManifest(fixture(visible_when)), [])
  const clearing = fixture()
  clearing.fields[2].clear_when_hidden = true
  assert.deepEqual(validatePanelManifest(clearing), [])
})

test('visibility rejects malformed, recursive, undeclared and unrelated conjunction conditions', () => {
  const good = { field: 'source_ref', in: [''] }
  for (const visible_when of [
    { all: [] }, { all: null }, { all: {} }, { all: 'source_ref' },
    { all: [good], field: 'connection', in: ['existing'] },
    { all: [good], any: [good] }, { all: [good], expression: 'run()' },
    { all: [null] }, { all: [[]] }, { all: ['source_ref'] }, { all: [1] },
    { all: [{}] }, { all: [{ all: [good] }] }, { all: [{ any: [good] }] },
    { all: [{ ...good, all: [good] }] }, { all: [{ ...good, expression: 'run()' }] },
    { all: [{ field: 'missing', in: [''] }] }, { all: [{ field: 'foreign', in: [''] }] },
    { all: [good, { field: 'foreign', in: [''] }] },
    { all: [{ field: null, in: [''] }] }, { all: [{ field: '', in: [''] }] },
    { all: [{ field: 'source_ref' }] }, { all: [{ field: 'source_ref', in: [] }] },
    { all: [{ field: 'source_ref', in: null }] }, { all: [{ field: 'source_ref', in: '' }] },
    { all: [{ field: 'source_ref', in: [1] }] }, { all: [{ field: 'source_ref', in: ['', false] }] },
  ]) assert.ok(validatePanelManifest(fixture(visible_when)).some(error => error.includes('visible_when')), JSON.stringify(visible_when))
})

test('legacy visibility still rejects invalid field references and value lists', () => {
  for (const visible_when of [null, {}, [], true, 'source_ref',
    { field: 'missing', in: [''] }, { field: 'foreign', in: [''] },
    { field: 'source_ref', in: [] }, { field: 'source_ref', in: [false] },
  ]) assert.ok(validatePanelManifest(fixture(visible_when)).some(error => error.includes('visible_when')), JSON.stringify(visible_when))
})

test('nested conjunctions can reference only declared fields of the same child record', () => {
  const panel = fixture()
  panel.fields = [panel.fields[0], {
    key: 'children', control: 'record_map', applies_to: ['items'], item_fields: [
      { key: 'source_ref', control: 'text' }, { key: 'connection', control: 'text' },
      { key: 'detail', control: 'text', visible_when: condition() },
    ],
  }]
  assert.deepEqual(validatePanelManifest(panel), [])
  panel.fields[1].item_fields.shift()
  assert.ok(validatePanelManifest(panel).some(error => error.includes('item_fields') && error.includes('visible_when')),
    'a parent field cannot satisfy a missing child dependency')
})
