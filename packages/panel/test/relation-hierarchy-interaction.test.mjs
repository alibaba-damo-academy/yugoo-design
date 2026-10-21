import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { register } from 'tsx/esm/api'
register()

test('opt-in child creation uses one canonical transaction, with cancellation and stale-parent guards', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver']) globalThis[key] = dom.window[key]
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
  const graph = { nodes: 'things', edges: 'links', label_field: 'name', source_field: 'from', target_field: 'to', edge_kind_field: 'kind',
    hierarchy: { values: ['extends'], label: 'Parents', create: { edge_kind: 'extends', create_label: 'Add subtype', create_title: 'Create subtype' } } }
  const manifest = { version: 1, panel_kind: 'neutral_records', sections: [
    { id: 'things', title: 'Things', order: 'order', create: { id_field: 'id' } },
    { id: 'links', title: 'Links', create: { id_field: 'id' } },
  ], fields: [
    { key: 'id', control: 'text', readonly: true, applies_to: ['things', 'links'] },
    { key: 'name', label: 'Name', control: 'text', applies_to: ['things', 'links'] },
    { key: 'kind', control: 'radio', applies_to: ['links'], options: [{ value: 'extends', label: 'Extends' }] },
    { key: 'from', control: 'record_select', options_from_section: 'things', applies_to: ['links'] },
    { key: 'to', control: 'record_select', options_from_section: 'things', applies_to: ['links'] },
  ], ui: { id: 'workspace', component: 'record_workspace', title: 'Things', navigation_roots: 'records', sources: ['things', 'links'], children: [
    { id: 'graph', component: 'relation_graph', graph },
    { id: 'details', component: 'record_inspector', children: [{ id: 'form', component: 'record_form' }] },
  ] } }
  let data = { things: { parent: { id: 'parent', name: 'Parent', note: 'Keep' }, sibling: { id: 'sibling', name: 'Sibling' }, repair: null }, links: { repair: ['keep for repair'] }, order: ['parent', 'sibling', 'repair'] }
  const before = structuredClone(data), writes = []
  const show = editable => act(async () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable,
    onPanelUpdate: updates => { writes.push(updates); data = applyPanelUpdatesToDraft(data, updates) } })))
  const add = () => document.querySelector('.dsh-record-hierarchy-create')
  const dialog = () => document.querySelector('[role="dialog"]')
  const button = text => [...dialog().querySelectorAll('button')].find(el => el.textContent.trim() === text)
  const name = async value => act(async () => {
    const input = dialog().querySelector('input')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await show(false); assert.equal(add(), null)
    await show(true); assert.ok(add())
    assert.ok(document.querySelector('[aria-label="Add subtype: Parent"]'), 'an empty parent subtree exposes creation of its first child')
    await act(async () => add().click())
    assert.equal(dialog().getAttribute('aria-label'), 'Create subtype')
    await name('Cancelled'); await act(async () => button('Cancel').click())
    assert.equal(dialog(), null); assert.equal(writes.length, 0); assert.deepEqual(data, before)

    await act(async () => add().click()); await name('Specialist')
    await act(async () => dialog().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(writes.length, 1, 'node, edge and order are one transaction')
    const child = Object.keys(data.things).find(id => !Object.hasOwn(before.things, id))
    assert.equal(data.things[child].name, 'Specialist')
    assert.deepEqual(data.things.parent, before.things.parent)
    assert.equal(data.things.repair, null, 'display-filtered malformed node is retained by the canonical transaction')
    assert.deepEqual(data.links.repair, before.links.repair, 'display-filtered malformed edge is retained')
    assert.equal(data.things[child].note, undefined, 'no inherited fact copies')
    const edge = Object.entries(data.links).find(([id]) => id !== 'repair')[1]
    assert.equal(edge.from, child)
    assert.equal(edge.to, 'parent')
    assert.equal(edge.kind, 'extends')
    await show(true)
    assert.equal(document.querySelector('[aria-current="page"]').textContent, 'Specialist')
    assert.ok([...document.querySelectorAll('.dsh-panel-workspace-tree-add')].some(el => el.textContent.includes('Add subtype')), 'expanded parent subtree has the shared tail-add entry')

    await act(async () => add().click()); await name('Stale')
    data = { ...data, things: { parent: data.things.parent, sibling: data.things.sibling } }
    await show(true)
    assert.ok(dialog().querySelector('button[type="submit"]').disabled)
    await act(async () => dialog().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(writes.length, 1, 'vanished parent cannot create')
    await show(false); assert.equal(dialog(), null); assert.equal(add(), null)
    assert.equal(writes.length, 1)
    await show(true); await act(async () => button('Cancel').click())
    data = { ...data, links: ['malformed collection: preserve for repair'] }
    await show(true); await act(async () => add().click()); await name('Must not replace the broken map')
    await act(async () => dialog().dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })))
    assert.equal(writes.length, 1, 'a malformed raw edge collection is rejected rather than rebuilt from its empty display projection')
    assert.deepEqual(data.links, ['malformed collection: preserve for repair'])
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
