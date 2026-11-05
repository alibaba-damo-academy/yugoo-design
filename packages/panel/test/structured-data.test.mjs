import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { readableValue } from '../src/structured-data.tsx'
import { renderNode } from '../src/interpreter.ts'

const documentOf = element => new JSDOM(renderToStaticMarkup(element)).window.document
const fields = [
  { key: 'layout', label: 'Layout' },
  { key: 'navigation', label: 'Navigation', item_label_field: 'label', fields: [
    { key: 'target_page_id', label: 'Destination', options_from_section: 'pages' },
    { key: 'icon_ref', label: 'Icon reference', collapsed: true },
  ] },
  { key: 'source', label: 'Style source', collapsed: true },
]

test('named reading orders saved keys, titles items once and preserves unknown values verbatim', () => {
  const value = { source: 'design_style', unknown_fact: { nested_unknown_key: 'Keep this' },
    navigation: [{ id: 'menu-1', label: 'Feedback', target_page_id: 'PG-1', icon_ref: 'inbox', future_note: 'Keep item note' }],
    layout: 'Sidebar', false_fact: false, zero_fact: 0, empty_fact: '', null_fact: null }
  const original = structuredClone(value)
  const doc = documentOf(readableValue(value, 0, 'en-US', { fields, referenceLabel: (section, id) => section === 'pages' && id === 'PG-1' ? 'Feedback inbox' : undefined }))
  const rows = [...doc.body.firstElementChild.children]
  assert.deepEqual(rows.slice(0, 3).map(e => e.querySelector(':scope > summary, :scope > details > summary').textContent), ['Layout', 'Navigation', 'Style source'])
  assert.equal(rows[0].classList.contains('dsh-panel-content-group'), true)
  assert.equal(rows[1].classList.contains('dsh-panel-content-group'), true)
  assert.equal(doc.querySelectorAll('h4').length, 1)
  assert.equal(doc.querySelector('h4').textContent, 'Feedback')
  assert.equal([...doc.querySelectorAll('.dsh-design-field-label')].some(e => e.textContent === 'label'), false)
  assert.match(doc.body.textContent, /Feedback inbox \(PG-1\)/)
  for (const text of ['unknown_fact', 'nested_unknown_key', 'Keep this', 'future_note', 'Keep item note', 'menu-1', 'false', 'zero_fact', 'null_fact']) assert.ok(doc.body.textContent.includes(text), text)
  assert.ok(rows.every(row => row.classList.contains('dsh-panel-content-group')), 'folded and unknown top-level sections retain the same surface as their peers')
  assert.equal(rows[2].open, false)
  assert.equal(rows[3].open, false)
  assert.equal(rows[1].querySelector('details')?.querySelector('summary')?.textContent, 'Icon reference')
  assert.equal(doc.querySelector('input,textarea,button'), null)
  assert.deepEqual(value, original)
})

test('fallback titles, unresolved IDs, scalar lists and unsafe-looking text stay readable', () => {
  const value = { navigation: [
    { label: '', target_page_id: 'missing' },
    { label: { nested: 'Keep non-scalar label' }, target_page_id: 'PG-2' },
    { label: '<img src=x onerror=alert(1)>', target_page_id: 'PG-3' },
  ], components: ['Long explanation', 'Confirmation form'] }
  const doc = documentOf(readableValue(value, 0, 'en-US', { fields: [...fields, { key: 'components', label: 'Components' }] }))
  assert.ok(doc.body.textContent.includes('missing'))
  assert.ok(doc.body.textContent.includes('Keep non-scalar label'))
  assert.equal(doc.querySelector('img'), null)
  assert.ok(doc.body.textContent.includes('<img src=x onerror=alert(1)>'))
  assert.ok([...doc.querySelectorAll('li')].some(e => e.textContent === 'Long explanation'))
  assert.equal([...doc.querySelectorAll('h4')].length, 1, 'empty/non-scalar labels do not suppress their source row')
})

test('without declarations generic nested reading and explicit bounded overflow are retained', () => {
  const doc = documentOf(readableValue({ legacy_key: { child_key: 'Original' } }, 0, 'en-US'))
  assert.match(doc.body.textContent, /legacy key/)
  assert.equal(doc.querySelector('details').open, false)
  assert.match(doc.body.textContent, /Original/)
  const overflow = documentOf(readableValue(Array.from({ length: 101 }, (_, i) => `Value ${i}`), 0, 'en-US', { fields: [] }))
  assert.equal(overflow.querySelectorAll('li').length, 100)
  assert.match(overflow.body.textContent, /1 more/)
  const deeplyNested = Array.from({ length: 9 }).reduce(value => ({ nested: value }), 'Too deep')
  const deep = documentOf(readableValue(deeplyNested, 0, 'en-US'))
  assert.equal(deep.body.textContent.includes('Too deep'), false, 'depth limit keeps recursively nested input bounded')
  assert.match(deep.body.textContent, /nested|depth|deep/i)
})

test('interpreter resolves original section bindings, retains IDs and emits no writes in an editable Host', () => {
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'pages', title: 'Pages', records_path: 'model.screens', fields_path: 'facts' }], fields: [],
    ui: { component: 'structured_data', id: 'shared', source: 'shared', read_fields: fields } }
  const data = { shared: { layout: 'Sidebar', navigation: [{ label: 'Feedback', target_page_id: 'PG-1' }, { label: 'Unknown', target_page_id: 'PG-X' }] },
    model: { screens: { 'PG-1': { facts: { name: 'Current feedback inbox' } } } } }
  const before = structuredClone(data), writes = []
  const doc = documentOf(renderNode(manifest.ui, manifest, data, { locale: 'en-US', editable: true,
    onPanelUpdate: patch => writes.push(patch), onEdit: patch => writes.push(patch) }))
  assert.match(doc.body.textContent, /Current feedback inbox \(PG-1\)/)
  assert.match(doc.body.textContent, /PG-X/)
  assert.equal(doc.querySelector('input,textarea,button'), null)
  assert.deepEqual(writes, [])
  assert.deepEqual(data, before)
})
