import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
import { validatePanelManifest } from '../../core/src/panel-dsl.ts'

test('related table details preserve root-name editing and nested-cell ownership', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [
    { id: 'parents', title: 'Parents' },
    { id: 'items', title: 'Items', records_path: 'items', form: { header: { variant: 'detail', title: { field: 'title', editable: true } }, body: [] } },
    { id: 'itemDetails', title: 'Items', records_path: 'items', fields_path: 'details', navigation: 'contextual' },
  ], fields: [
    { key: 'title', label: 'Name', control: 'text', applies_to: ['parents', 'items'] },
    { key: 'parent', control: 'record_select', options_from_section: 'parents', hidden: true, applies_to: ['itemDetails'] },
    { key: 'rule', label: 'Rule', control: 'text', applies_to: ['itemDetails'] },
  ], ui: { id: 'workspace', component: 'record_workspace', navigation_layout: 'tree', sources: ['parents', 'itemDetails'], children: [
    { id: 'inspector', component: 'record_inspector', children: [
      { id: 'table', component: 'record_related_editor', title: 'Permissions', source: 'itemDetails', sources: ['items', 'itemDetails'], bindings: { reference: 'parent' }, record_table: { columns: [{ fields: ['rule'] }] } },
    ] },
  ] } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  let data = { parents: { p: { title: 'Purchaser' } }, items: {
    a: { id: 'a', title: 'Read orders', source_refs: ['customer:decision'], details: { name: 'Existing system name', parent: 'p', rule: 'Own orders only' } },
  } }
  const initial = structuredClone(data)
  let editable = true, writes = 0
  const show = () => root.render(renderManifest(manifest, data, { editable, locale: 'en-US', onPanelUpdate: updates => {
    writes++; data = applyPanelUpdatesToDraft(data, updates); show()
  } }))
  const edit = async (input, value) => React.act(async () => {
    assert.ok(input)
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await React.act(show)
    const table = () => document.querySelector('.dsh-related-record-table')
    const toggle = () => table().querySelector('td.dsh-related-record-actions button[aria-expanded]')
    const detailRow = () => table().querySelector('.dsh-related-record-detail')
    assert.equal(toggle().getAttribute('aria-expanded'), 'false')
    assert.equal(detailRow().hidden, true, 'collapsed details occupy no table row')
    assert.equal(table().querySelector('summary'), null, 'no separate disclosure row')
    assert.equal(toggle().closest('tr').dataset.record, 'a')
    assert.ok(document.getElementById(toggle().getAttribute('aria-controls')))
    await React.act(() => toggle().click())
    assert.equal(detailRow().hidden, false)
    assert.equal(writes, 0, 'opening a row does not edit saved facts')
    await edit(table().querySelector('input[aria-label="Name"]'), 'Read assigned orders')
    await edit(table().querySelector('input[aria-label="Rule"]'), 'Assigned organization only')
    assert.equal(data.items.a.title, 'Read assigned orders')
    assert.deepEqual(data.items.a.details, { name: 'Existing system name', parent: 'p', rule: 'Assigned organization only' })
    assert.deepEqual(data.items.a.source_refs, initial.items.a.source_refs)
    assert.deepEqual(data.parents, initial.parents)
    assert.equal(writes, 2)
    const mountedEditor = table().querySelector('input[aria-label="Name"]')
    await React.act(() => toggle().click())
    assert.equal(detailRow().hidden, true)
    await React.act(() => toggle().click())
    assert.equal(table().querySelector('input[aria-label="Name"]'), mountedEditor, 'folding retains the existing editor')
    assert.equal(writes, 2)
    const relatedEditor = manifest.ui.children[0].children.pop()
    await React.act(show)
    assert.ok(document.querySelector('nav button[aria-label="Read assigned orders"]'), 'without a full table, navigation follows the declared root title over a secondary system name')
    manifest.ui.children[0].children.push(relatedEditor)
    editable = false
    await React.act(show)
    assert.ok(table().querySelector('th.dsh-related-record-actions-heading'), 'readonly readers also have the details action')
    assert.equal(table().querySelector('[data-testid="record-remove-a"]'), null)
    await React.act(() => toggle().click())
    assert.equal(detailRow().hidden, false)
    assert.equal(table().querySelector('input, textarea'), null)
    assert.match(table().textContent, /Read assigned orders/)
    assert.equal(writes, 2, 'viewing a readonly projection cannot write data')
  } finally {
    await React.act(() => root.unmount()); dom.window.close()
  }
})

test('a single tree collection omits its wrapper while preserving contextual children and creation', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node', 'MutationObserver', 'CustomEvent']) globalThis[key] = dom.window[key]
  installSelectDom(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [
    { id: 'plans', title: 'Plans', item_name: 'Plan', records_path: 'plans', create: { id_field: 'id', defaults: { title: 'New plan' } } },
    { id: 'rules', title: 'Rules', item_name: 'Rule', records_path: 'rules', navigation: 'contextual', add_mode: 'context', create: { id_field: 'id', defaults: { title: 'New rule' } } },
  ], fields: [
    { key: 'title', label: 'Name', control: 'text', applies_to: ['plans', 'rules'] },
    { key: 'parent', label: 'Plan', control: 'record_select', options_from_section: 'plans', applies_to: ['rules'] },
  ], ui: { id: 'workspace', component: 'record_workspace', title: 'Plan decisions', navigation_layout: 'tree', sources: ['plans', 'rules'],
    children: [{ id: 'inspector', component: 'record_inspector', sources: ['plans', 'rules'] }] } }
  assert.deepEqual(validatePanelManifest(manifest), [])
  let data = { plans: { p: { id: 'p', title: 'First plan' } }, rules: { r: { id: 'r', title: 'Initial rule', parent: 'p' } } }
  const show = () => root.render(renderManifest(manifest, data, { editable: true, locale: 'en-US', onPanelUpdate: updates => {
    data = applyPanelUpdatesToDraft(data, updates); show()
  } }))
  const navButton = label => document.querySelector(`nav button[aria-label="${label}"]`)
  try {
    await React.act(show)
    assert.ok(navButton('First plan'))
    assert.equal([...document.querySelectorAll('nav button')].some(button => button.textContent === 'Plans'), false)
    await React.act(() => navButton('Initial rule').click())
    assert.equal(navButton('Initial rule').getAttribute('aria-current'), 'page')
    assert.ok(navButton('First plan'), 'selecting a child keeps its real parent visible')
    await React.act(() => navButton('Add Rule').click())
    const addedRule = Object.values(data.rules).find(record => record.id !== 'r')
    assert.equal(addedRule.parent, 'p', 'context creation still uses the real parent identity')
    await React.act(() => navButton('Add Plan').click())
    assert.equal(Object.keys(data.plans).length, 2)
    assert.deepEqual(data.rules.r, { id: 'r', title: 'Initial rule', parent: 'p' })
    // Two independent object collections still need their collection labels.
    manifest.sections.push({ id: 'policies', title: 'Policies', records_path: 'policies' })
    manifest.fields[0].applies_to.push('policies'); manifest.ui.sources.push('policies')
    data.policies = { policy: { id: 'policy', title: 'Shared policy' } }
    await React.act(show)
    const labels = [...document.querySelectorAll('nav button')].map(button => button.textContent)
    assert.ok(labels.includes('Plans')); assert.ok(labels.includes('Policies'))
  } finally { await React.act(() => root.unmount()); dom.window.close() }
})

test('missing contextual parents keep records reachable without guessing or rewriting references', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node', 'MutationObserver', 'CustomEvent']) globalThis[key] = dom.window[key]
  installSelectDom(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest, applyDesignEditToDraft } = await import('../src/interpreter.ts')
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'parents', title: 'Parents' },
    { id: 'children', title: 'Children', navigation: 'contextual', add_mode: 'context' },
  ], fields: [
    { key: 'title', label: 'Name', control: 'text', applies_to: ['parents', 'children'] },
    { key: 'parent_refs', label: 'Belongs to', control: 'record_multi_select', options_from_section: 'parents', applies_to: ['children'] },
  ], ui: { id: 'workspace', component: 'record_workspace', sources: ['parents', 'children'], children: [
    { id: 'details', component: 'record_inspector', children: [
      { id: 'child-editor', component: 'record_related_editor', source: 'children', bindings: { reference: 'parent_refs' } },
    ] },
  ] } }
  let data = { parents: { p: { title: 'Existing parent' } }, children: {
    linked: { title: 'Linked child', parent_refs: ['p'] },
    orphan: { title: 'Lost parent', parent_refs: ['gone'], evidence: ['keep'] },
    undecided: { title: 'Undecided parent', parent_refs: [] },
    partial: { title: 'Partially linked', parent_refs: ['p', 'gone'] },
  } }
  const before = structuredClone(data)
  let writes = 0
  const show = () => root.render(renderManifest(manifest, data, { editable: false, locale: 'en-US', onPanelUpdate: () => writes++ }))
  const warningButtons = () => [...document.querySelectorAll('nav [role="alert"] button')]
  try {
    await React.act(show)
    assert.equal(warningButtons().length, 2)
    assert.ok(warningButtons().some(button => button.textContent.includes('Lost parent')))
    assert.ok(warningButtons().some(button => button.textContent.includes('Undecided parent')))
    assert.equal(warningButtons().some(button => button.textContent.includes('Partially linked')), false, 'one valid parent keeps the record reachable without duplicate warnings')
    await React.act(() => warningButtons().find(button => button.textContent.includes('Lost parent')).click())
    assert.ok(document.querySelector('.dsh-record-inspector [data-record="orphan"]'), 'the original record can be opened even when its usual inline editor has no parent')
    assert.deepEqual(data, before); assert.equal(writes, 0)
    data = applyDesignEditToDraft(data, manifest, { section: 'children', record: 'orphan', field: 'parent_refs', value: ['p'] })
    await React.act(show)
    assert.equal(warningButtons().length, 1, 'an explicit user repair removes only that record warning')
    assert.ok(document.querySelector('.dsh-record-inspector [data-record="orphan"]'), 'repair keeps the selected record open')
    assert.deepEqual(data.children.orphan.evidence, before.children.orphan.evidence)
    assert.deepEqual(data.children.partial.parent_refs, ['p', 'gone'], 'the view never cleans up other invalid references')
    data = { ...data, parents: {} }
    await React.act(show)
    assert.equal(warningButtons().length, 4, 'removing the last parent cannot make any child disappear')
    assert.equal(writes, 0, 'view projection emits no writes in read-only mode')
  } finally { await React.act(() => root.unmount()); dom.window.close() }
})
