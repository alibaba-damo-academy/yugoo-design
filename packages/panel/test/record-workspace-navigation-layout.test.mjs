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

test('explicit list presents real primary records and add actions while preserving related editors and default trees', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [
    { id: 'parents', title: 'Parents', item_name: 'Parent', create: { id_field: 'id', defaults: { title: 'New parent' } } },
    { id: 'children', title: 'Children', navigation: 'contextual' },
    { id: 'others', title: 'Others' },
  ], fields: [
    { key: 'title', label: 'Title', control: 'text', applies_to: ['parents', 'children', 'others'] },
    { key: 'parent_ref', control: 'record_select', options_from_section: 'parents', hidden: true, applies_to: ['children'] },
  ] }
  let data = { parents: { p: { id: 'p', title: 'First parent' }, q: { id: 'q', title: 'Second parent' } },
    children: { c: { title: 'Child', parent_ref: 'p' } }, others: { o: { title: 'Other record' } } }
  const before = structuredClone(data)
  let updates
  const show = async (layout, editable = false, sources = ['parents', 'children'], relatedEditor = true) => React.act(async () => root.render(renderNode({
    component: 'record_workspace', id: 'workspace', title: 'Workspace title', sources,
    ...(layout ? { navigation_layout: layout } : {}),
    children: [{ component: 'record_inspector', id: 'inspector', children: relatedEditor ? [
      { component: 'record_related_editor', id: 'related', title: 'Related editor', source: 'children', bindings: { reference: 'parent_ref' } },
    ] : [] }],
  }, manifest, data, { locale: 'en-US', editable, onPanelUpdate: next => { updates = next } })))
  const nav = () => document.querySelector('nav')
  try {
    await show('list')
    assert.equal(nav().querySelector('h2').textContent, 'Workspace title')
    assert.equal(nav().querySelectorAll('h2').length, 1)
    assert.equal(nav().querySelectorAll('button').length, 2, 'only actual primary records, no collection/category or permission nodes')
    assert.equal(nav().querySelector('[aria-expanded]'), null)
    assert.ok(nav().classList.contains('dsh-panel-workspace-tree'), 'flat records use structure navigation, not round cards')
    assert.equal(nav().querySelector('.dsh-panel-workspace-tree-add'), null, 'read-only cannot add')
    assert.equal(document.querySelectorAll('.dsh-record-related-editor [data-record="c"]').length, 1)
    assert.deepEqual(data, before)
    const buttonFor = label => [...nav().querySelectorAll('button')].find(button => button.textContent === label)
    await React.act(async () => buttonFor('Second parent').click())
    assert.equal(buttonFor('Second parent').getAttribute('aria-current'), 'page')
    assert.equal(document.querySelector('.dsh-record-related-editor [data-record="c"]'), null)
    await React.act(async () => buttonFor('First parent').click())
    assert.ok(document.querySelector('.dsh-record-related-editor [data-record="c"]'))
    await show('list', true)
    const add = nav().querySelector('.dsh-panel-workspace-tree-add')
    assert.ok(add?.getAttribute('aria-label'), 'add remains accessible with the active panel locale')
    await React.act(async () => add.click())
    assert.equal(Object.keys(updates.parents).length, 3)
    assert.deepEqual(updates.parents.p, before.parents.p)
    assert.deepEqual(updates.parents.q, before.parents.q)
    assert.deepEqual(data, before, 'only emitted updates may change canonical state')
    data = { ...data, ...updates }
    await show('list', true)
    assert.equal(buttonFor('New parent').getAttribute('aria-current'), 'page', 'new record becomes selected after ordinary update')
    assert.deepEqual(data.children, before.children)
    assert.deepEqual(data.others, before.others)
    await show(undefined, false)
    assert.equal(nav().querySelectorAll('.dsh-panel-workspace-tree-group').length, 0, 'default tree shows one real collection directly without a redundant category')
    await React.act(async () => nav().querySelector('button[aria-label="First parent"]').click())
    assert.equal(nav().querySelector('button[aria-label="Child"]'), null, 'a complete inline editor avoids duplicating its child records in navigation')
    assert.ok(document.querySelector('.dsh-record-related-editor [data-record="c"]'), 'the child remains available in its owner detail')
    await show(undefined, false, ['parents', 'children'], false)
    assert.ok(nav().querySelector('button[aria-label="Child"]'), 'without an inline editor the contextual child remains in the tree')
    await React.act(async () => nav().querySelector('button[aria-label="Child"]').click())
    assert.equal(nav().querySelector('button[aria-label="Child"]').getAttribute('aria-current'), 'page')
    assert.deepEqual(data.children, before.children, 'navigation projection does not rewrite the relationship')
    await show('tree', false, ['parents', 'children', 'others'])
    assert.equal(nav().querySelectorAll('.dsh-panel-workspace-tree-group').length, 2)
    const toggle = nav().querySelector('.dsh-panel-workspace-tree-group-toggle')
    await React.act(async () => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(nav().querySelector('button[aria-label="First parent"]'), null)
    assert.ok(nav().querySelector('button[aria-label="Other record"]'))
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
