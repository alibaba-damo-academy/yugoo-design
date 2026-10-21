import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('group projection reuses selection, expansion, add and read-only without canonical parent objects', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'items', title: 'Items', item_name: 'Item', fields_path: 'details', order: 'item_order',
      create: { id_field: 'id', defaults: { title: 'New item' } } },
    { id: 'children', title: 'Children', navigation: 'contextual' },
  ], fields: [
    { key: 'title', control: 'text', applies_to: ['items', 'children'] },
    { key: 'category', control: 'text', applies_to: ['items'] },
    { key: 'parent', control: 'record_select', options_from_section: 'items', hidden: true, applies_to: ['children'] },
  ] }
  let data = { items: {
    a: { metadata: 'untouched', details: { id: 'a', title: 'Alpha', category: 'B', unknown: 'keep' } },
    b: { details: { id: 'b', title: 'Beta', category: 'A' } },
    c: { details: { id: 'c', title: 'No category', category: ' ' } },
    d: { details: { id: 'd', title: 'Literal label', category: 'Ungrouped' } },
  }, item_order: ['b', 'a', 'c', 'd'], children: { child: { title: 'Child', parent: 'a' } }, unrelated: { keep: true } }
  const before = structuredClone(data)
  let updates = []
  const show = async (editable = false, layout = 'tree', locale = 'en-US', grouped = true) => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, renderNode({
    component: 'record_workspace', id: 'workspace', sources: ['items', 'children'], navigation_layout: layout,
    ...(grouped ? { navigation_group_by: 'category' } : {}),
    children: [{ component: 'record_inspector', id: 'inspector', children: [
      { component: 'record_related_editor', id: 'related', source: 'children', bindings: { reference: 'parent' } },
    ] }],
  }, manifest, data, { locale, editable, onPanelUpdate: next => updates.push(next) }))))
  const nav = () => document.querySelector('nav')
  const button = label => nav().querySelector(`button[aria-label="${label}"]`)
  const headings = () => [...nav().querySelectorAll('.dsh-panel-workspace-tree-group-toggle')].map(el => el.textContent)
  try {
    await show()
    assert.deepEqual(headings(), ['A', 'B', 'Ungrouped', 'Ungrouped'])
    assert.equal(nav().querySelectorAll('.dsh-panel-workspace-tree-add').length, 0)
    assert.equal(updates.length, 0); assert.deepEqual(data, before)
    await React.act(async () => button('Alpha').click())
    assert.equal(button('Alpha').getAttribute('aria-current'), 'page')
    assert.ok(document.querySelector('.dsh-record-related-editor [data-record="child"]'))
    const toggle = nav().querySelectorAll('.dsh-panel-workspace-tree-group-toggle')[1]
    await React.act(async () => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(button('Alpha'), null)
    assert.ok(document.querySelector('[data-section="items"] [data-record="a"]'), 'collapsing is not selecting a fabricated parent')
    await show(false, 'list')
    assert.equal(button('Child'), null, 'list preserves flat members')
    await React.act(async () => button('Beta').click())
    data = { ...data, items: { ...data.items, b: { ...data.items.b, details: { ...data.items.b.details, category: 'B' } } } }
    await show(true, 'list')
    assert.equal(button('Beta').getAttribute('aria-current'), 'page', 'classification edit preserves selected identity and opens its new group')
    assert.deepEqual(headings(), ['B', 'Ungrouped', 'Ungrouped'])
    assert.equal(nav().querySelectorAll('.dsh-panel-workspace-tree-add').length, 1)
    await React.act(async () => nav().querySelector('.dsh-panel-workspace-tree-add').click())
    assert.equal(updates.length, 1)
    const next = updates[0]
    const newId = Object.keys(next.items).find(id => !Object.hasOwn(data.items, id))
    assert.ok(newId)
    assert.equal(next.items[newId].details.category, undefined, 'add never guesses a group')
    assert.deepEqual(next.items.a, before.items.a)
    assert.deepEqual(next.item_order, [...before.item_order, newId])
    data = { ...data, ...next }; await show(true, 'list')
    assert.equal(button('New item').getAttribute('aria-current'), 'page')
    assert.deepEqual(data.unrelated, before.unrelated); assert.deepEqual(data.children, before.children)
    const count = updates.length
    await show(false, 'tree', 'zh-CN')
    assert.ok(headings().includes('未分组'))
    assert.ok(headings().includes('Ungrouped'), 'canonical labels are not translated')
    assert.equal(updates.length, count)
    await show(false, 'tree', 'en-US', false)
    assert.deepEqual(headings(), [], 'an ungrouped single collection shows its real records without a category wrapper')
    for (const title of ['Alpha', 'Beta', 'No category', 'Literal label', 'New item']) assert.ok(button(title))
    assert.equal(button('New item').getAttribute('aria-current'), 'page', 'removing presentation grouping preserves selection')
  } finally { await React.act(async () => root.unmount()) }
})

test('multiple collections keep separate same-named groups and empty collections retain only their ordinary add', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'one', title: 'First collection' }, { id: 'two', title: 'Second collection' },
    { id: 'empty', title: 'Empty collection' },
  ], fields: [{ key: 'title', control: 'text', applies_to: ['one', 'two', 'empty'] }] }
  const data = { one: { a: { title: 'One', category: 'A' } }, two: { a: { title: 'Two', category: 'A' } }, empty: {} }
  let updates = []
  try {
    await React.act(async () => root.render(renderNode({ component: 'record_workspace', id: 'workspace',
      sources: ['one', 'two', 'empty'], navigation_group_by: 'category',
      children: [{ component: 'record_inspector', id: 'details' }],
    }, manifest, data, { editable: true, onPanelUpdate: next => updates.push(next) })))
    const nav = document.querySelector('nav')
    const groups = nav.querySelectorAll('.dsh-panel-workspace-tree-group')
    assert.equal(groups.length, 5, 'three collection headers and two distinct A groups')
    await React.act(async () => groups[1].querySelector('button').click())
    assert.equal(nav.querySelector('button[aria-label="One"]'), null)
    assert.ok(nav.querySelector('button[aria-label="Two"]'))
    await React.act(async () => nav.querySelector('button[aria-label="Two"]').click())
    assert.equal(document.querySelector('[data-section="two"] [data-record="a"]')?.dataset.record, 'a')
    assert.equal(updates.length, 0)
    assert.equal(nav.querySelectorAll('.dsh-panel-workspace-tree-add').length, 3)
    const emptyGroup = groups[4]
    assert.equal(emptyGroup.querySelectorAll('.dsh-panel-workspace-tree-group').length, 0)
    await React.act(async () => emptyGroup.querySelector('.dsh-panel-workspace-tree-add').click())
    assert.equal(updates.length, 1)
    assert.deepEqual(Object.keys(updates[0]), ['empty'])
    assert.equal(Object.keys(updates[0].empty).length, 1)
    assert.deepEqual(data.empty, {})
  } finally { await React.act(async () => root.unmount()) }
})

test('cross-group self parents remain facts while each grouped record stays reachable once', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }], fields: [
    { key: 'title', control: 'text', applies_to: ['items'] },
    { key: 'parent', control: 'record_select', options_from_section: 'items', applies_to: ['items'],
      hierarchy: { label_field: 'title', group_label: 'Specific' } },
  ] }
  const data = { items: { p: { title: 'Parent', category: 'A' },
    c: { title: 'Cross child', category: 'B', parent: 'p' }, s: { title: 'Same child', category: 'A', parent: 'p' } } }
  const before = structuredClone(data)
  try {
    await React.act(async () => root.render(renderNode({ component: 'record_workspace', id: 'workspace',
      sources: ['items'], navigation_group_by: 'category', children: [{ component: 'record_inspector', id: 'details' }],
    }, manifest, data, { locale: 'en-US', editable: false })))
    const nav = document.querySelector('nav')
    for (const title of ['Parent', 'Same child', 'Cross child']) assert.equal(nav.querySelectorAll(`button[aria-label="${title}"]`).length, 1)
    await React.act(async () => nav.querySelector('button[aria-label="Cross child"]').click())
    assert.equal(nav.querySelector('button[aria-label="Cross child"]').getAttribute('aria-current'), 'page')
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
