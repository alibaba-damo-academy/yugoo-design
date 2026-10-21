import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderManifest } from '../src/interpreter.ts'
globalThis.React = React

const manifest = { version: 1, panel_kind: 'capability_map', fields: [],
  sections: ['items', 'links', 'groups'].map(id => ({ id, title: id })),
  ui: { id: 'map', component: 'navigation_workspace', navigation_map: {
    grouping: { path: 'menu', target: 'target', label: 'category' },
    nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
    edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
    frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
  } },
}
test('real manifest entry preserves absent versus explicitly empty frame authority', () => {
  const state = { items: { a: { name: 'Alpha' } }, links: {}, menu: [{ target: 'a', category: 'Derived work group' }] }
  const before = structuredClone(state)
  const absent = renderToStaticMarkup(renderManifest(manifest, state, { locale: 'en-US' }))
  assert.ok(absent.includes('Derived work group'), 'sidebar must expose the derived group through the real interpreter')
  const empty = renderToStaticMarkup(renderManifest(manifest, { ...state, groups: {} }, { locale: 'en-US' }))
  assert.ok(!empty.includes('Derived work group'), 'saved empty groups must not regenerate')
  assert.deepEqual(state, before)
})

test('ordinary empty forms and nested logical aliases remain renderable', () => {
  const form = { version: 1, panel_kind: 'document',
    sections: [{ id: 'records', title: 'Records' }],
    fields: [{ key: 'name', label: 'Name', control: 'text', applies_to: ['records'] }],
    ui: { id: 'form', component: 'record_form', source: 'records' },
  }
  const missing = renderToStaticMarkup(renderManifest(form, {}, { locale: 'en-US' }))
  const empty = renderToStaticMarkup(renderManifest(form, { records: {} }, { locale: 'en-US' }))
  assert.equal(missing, empty)
  const direct = renderToStaticMarkup(renderManifest(form, { records: { a: { name: 'Existing direct record' } } }, { locale: 'en-US' }))
  assert.ok(direct.includes('Existing direct record'))
  const nested = { ...form, sections: [{ ...form.sections[0], records_path: 'nested.records' }] }
  const html = renderToStaticMarkup(renderManifest(nested, { nested: { records: { a: { name: 'Nested record' } } } }, { locale: 'en-US' }))
  assert.ok(html.includes('Nested record'))
})
