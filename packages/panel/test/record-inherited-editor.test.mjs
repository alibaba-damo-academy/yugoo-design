import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { register } from 'tsx/esm/api'
import { installSelectDom } from './select-interaction.mjs'
register()

test('inherited related records are read-only, source-navigable and share the same draft with parent edits', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) globalThis[key] = dom.window[key]
  installSelectDom(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.getComputedStyle = dom.window.getComputedStyle
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest } = await import('../src/interpreter.ts')
  const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
  const root = createRoot(document.getElementById('root'))
  const graph = { nodes: 'things', edges: 'links', label_field: 'name', source_field: 'from', target_field: 'to', edge_kind_field: 'kind', hierarchy: { values: ['extends'], label: 'Parent', max_parents: 1 } }
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'things', title: 'Things' }, { id: 'links', title: 'Links', create: { id_field: 'id' } },
    { id: 'facts', title: 'Own facts', item_name: 'fact', navigation: 'contextual', add_mode: 'context' }], fields: [
    { key: 'name', control: 'text', label: 'Name', applies_to: ['things', 'links', 'facts'] },
    { key: 'kind', control: 'select', applies_to: ['links'], options: [{ value: 'extends', label: 'Extends' }] },
    { key: 'from', control: 'record_select', options_from_section: 'things', applies_to: ['links'] },
    { key: 'to', control: 'record_select', options_from_section: 'things', applies_to: ['links'] },
    { key: 'owner', control: 'record_select', options_from_section: 'things', applies_to: ['facts'] },
    { key: 'condition', control: 'textarea', label: 'Conditions', applies_to: ['facts'] },
  ], ui: { id: 'workspace', component: 'record_workspace', sources: ['things', 'links', 'facts'], navigation_roots: 'records', children: [
    { id: 'graph', component: 'relation_graph', graph },
    { id: 'details', component: 'record_inspector', children: [{ id: 'form', component: 'record_form', source: 'things' },
      { id: 'related', component: 'record_related_editor', source: 'facts', bindings: { reference: 'owner' }, inherit_from_graph: true }] },
  ] } }
  let data = { things: { base: { name: 'Base' }, child: { name: 'Child' }, leaf: { name: 'Leaf' }, other: { name: 'Other' } },
    links: { one: { name: 'First', from: 'child', to: 'base', kind: 'extends' }, two: { name: 'Second', from: 'leaf', to: 'child', kind: 'extends' } },
    facts: { a: { name: 'Base fact', owner: 'base', condition: 'Identity confirmation required' }, b: { name: 'Child fact', owner: 'child', condition: 'Deny unless reviewed' }, c: { name: 'Leaf fact', owner: 'leaf', condition: 'Explicit confirmation' } } }
  const before = structuredClone(data), writes = [], edits = []
  const show = editable => act(async () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable,
    onEdit: (...args) => edits.push(args), onPanelUpdate: updates => { writes.push(updates); data = applyPanelUpdatesToDraft(data, updates) } })))
  try {
    await show(true)
    await act(async () => document.querySelector('.dsh-panel-workspace-tree [aria-label="Child"]').click())
    await act(async () => document.querySelector('.dsh-panel-workspace-tree [aria-label="Leaf"]').click())
    const inherited = [...document.querySelectorAll('.dsh-record-inherited-related')]
    assert.equal(inherited.length, 2)
    assert.ok(inherited[0].textContent.includes('Deny unless reviewed')); assert.ok(inherited[1].textContent.includes('Identity confirmation required'))
    assert.equal(inherited.flatMap(el => [...el.querySelectorAll('input:not([readonly]),textarea:not([readonly]),select:not([disabled]),.dsh-design-record-delete')]).length, 0)
    assert.equal(document.querySelector('.dsh-panel-workspace-tree').textContent.includes('Own facts'), false, 'no duplicate permission branch in hierarchy navigation')
    const select = document.querySelector('select[aria-label="Parent"]')
    assert.equal(select.value, 'child')
    await act(async () => { select.value = 'other'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(writes.length, 1); assert.equal(data.links.two.to, 'other'); assert.deepEqual(data.facts, before.facts)
    await show(true); assert.equal(document.querySelectorAll('.dsh-record-inherited-related').length, 0)
    await act(async () => { const el = document.querySelector('select[aria-label="Parent"]'); el.value = 'child'; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await show(true)
    await act(async () => document.querySelector('[aria-label="View source: Child"]').click())
    assert.equal(document.querySelector('[aria-current="page"]').textContent, 'Child')
    assert.equal(document.querySelector('select[aria-label="Parent"] option[value="leaf"]').disabled, true, 'descendant cannot become parent')
    assert.deepEqual(data.facts, before.facts)
    assert.equal(edits.length, 0, 'viewing inherited sources does not write facts')
    await show(false); assert.equal(document.querySelector('.dsh-record-parent-select'), null)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
