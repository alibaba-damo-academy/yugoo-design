import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'
const dom = new JSDOM('<style></style><div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual:true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver=class{observe(){} unobserve(){} disconnect(){}}
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window)
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { parsePanelManifest, localizePanelManifest } = await import('../../core/src/panel-dsl.ts')

test('shared headers edit a single canonical title, retain readonly/delete semantics, and opt out of reordering without discarding order', async () => {
  const root = createRoot(document.getElementById('root'))
  let manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/role_access/panel.yaml', import.meta.url), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['zh-CN', 'en-US'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`../../skills-web-app/bundles/role_access/locales/${locale}.json`, import.meta.url), 'utf8'))]))
  manifest = localizePanelManifest(manifest, 'en-US')
  let data = { schema_version: 5, roles: { a: { id: 'a', title: 'First role', assignment_rule: '注册后自动拥有' },
    b: { id: 'b', title: 'Second role', assignment_rule: '由管理员授予' } }, role_order: ['a', 'b'],
    policies: { p: { id: 'p', title: 'Derived title stays intact', role_ref: 'a', effect: 'allow', capability: 'Submit', applies_when: '', requirements: [], custom_requirement: '' },
      other: { id: 'other', title: 'Other role policy', role_ref: 'b', effect: 'deny', capability: 'Remove', requirements: [] } }, policy_order: ['p', 'other'] }
  let updates
  const show = (editable = true, node = manifest.ui) => React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel' },
    renderNode(node, manifest, data, { locale: 'en-US', editable, onPanelUpdate: next => { updates = next } }))))
  const style = selector => window.getComputedStyle(document.querySelector(selector))
  const input = async (element, text) => React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, text)
    element.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  try {
    const before = structuredClone(data)
    await show()
    assert.ok(document.querySelector('.dsh-design-record-header-content > [data-panel-title="editable"][aria-required="true"]'))
    assert.equal(document.querySelector('.dsh-design-record-header-content > .dsh-design-required-mark'), null, 'editable titles use a pencil, not a required asterisk')
    const pencil = document.querySelector('.dsh-design-record-header-content > .dsh-panel-title-edit')
    assert.ok(pencil)
    assert.equal(pencil.getAttribute('aria-label'), 'Edit title')
    await React.act(async () => pencil.click())
    assert.equal(document.activeElement, document.querySelector('[data-panel-title="editable"]'))
    assert.equal(updates, undefined, 'focusing a name never writes design facts')
    assert.ok(document.querySelector('[data-field="assignment_rule"] .dsh-design-required-mark'), 'ordinary required fields retain their indication')
    assert.equal(style('.dsh-design-record-header-content').gap, '4px')
    assert.equal(document.querySelectorAll('[data-panel-title="editable"]').length, 1)
    assert.equal(document.querySelector('[data-panel-title="editable"]').getAttribute('aria-label'), 'Role name')
    assert.equal(document.querySelector('[data-section="roles"] [data-field="title"]'), null)
    assert.equal(document.querySelector('[data-testid^="record-up-"]'), null)
    assert.equal(document.querySelector('[data-testid^="record-down-"]'), null)
    assert.equal(style('.dsh-design-record-header.is-detail').minHeight, '44px')
    assert.ok(document.querySelector('.dsh-design-record-header > .dsh-record-parent-inline'), 'the accepted inline parent control stays in the shared header')
    assert.equal(style('.dsh-record-inspector').paddingTop, '0px', 'an inline parent control does not create an extra row above the header')
    assert.equal(style('.dsh-record-inspector').paddingLeft, '16px', 'body reading gutter remains intact')
    assert.equal(style('.dsh-design-record-header-input').height, '32px')
    assert.ok(document.querySelector('.dsh-related-record-table .dsh-design-rows-table'))
    assert.equal(document.querySelectorAll('.dsh-related-record-table tbody tr').length, 1)
    assert.match(document.querySelector('.dsh-related-record-table thead').textContent, /Capability/)
    await input(document.querySelector('[data-panel-title="editable"]'), 'Renamed role')
    assert.equal(updates.roles.a.title, 'Renamed role')
    assert.deepEqual(updates.roles.b, data.roles.b)
    assert.equal(updates.role_order, undefined, 'rename does not rewrite order')
    assert.equal(updates.policies, undefined)
    assert.deepEqual(data, before, 'host owns application of updates')
    data = { ...data, ...updates }; updates = undefined
    await show()
    assert.equal(document.querySelector('[data-panel-title="editable"]').value, 'Renamed role')
    await show(false)
    assert.equal(document.querySelector('[data-panel-title="editable"]'), null)
    assert.equal(document.querySelector('.dsh-panel-title-edit'), null)
    assert.equal(document.querySelector('.dsh-design-record-actions'), null)
    assert.match(document.querySelector('.dsh-design-record-header.is-detail').textContent, /Renamed role/)
    assert.equal(document.querySelector('.dsh-design-record-header .dsh-design-required-mark'), null, 'readonly titles also have no misleading asterisk')
    await show()
    assert.match(document.querySelector('[data-testid="record-remove-p"]').getAttribute('aria-label'), /Derived title stays intact/,
      'static Permission caption must not replace record identity in actions')
    window.confirm = () => false
    await React.act(async () => document.querySelector('[data-testid="record-remove-a"]').click())
    assert.equal(updates, undefined)
    window.confirm = () => true
    await React.act(async () => document.querySelector('[data-testid="record-remove-a"]').click())
    assert.deepEqual(Object.keys(updates.roles), ['b'])
    assert.deepEqual(updates.role_order, ['b'])
    assert.deepEqual(Object.keys(updates.policies), ['other'])
    assert.deepEqual(updates.policy_order, ['other'])

    // Neutral nested binding: same shared header, no role field assumptions.
    manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'equipment', title: 'Equipment',
      records_path: 'model.equipment', fields_path: 'details', order: 'model.order',
      form: { reorder: false, header: { variant: 'detail', title: { field: 'caption', editable: true } }, body: [
        { kind: 'group', title: 'Duplicated title', items: [{ kind: 'field', field: 'caption' }] },
        { kind: 'field', field: 'note' }, { kind: 'field', field: 'aliases' },
      ] } }],
      fields: [{ key: 'caption', label: 'Equipment caption', control: 'text', applies_to: ['equipment'] },
        { key: 'note', label: 'Note', control: 'text', applies_to: ['equipment'] },
        { key: 'aliases', label: 'Aliases', control: 'record_map', item_fields: [{ key: 'caption', label: 'Alias caption', control: 'text' }], applies_to: ['equipment'] }],
      ui: { id: 'form', component: 'record_form', source: 'equipment' } }
    data = { model: { equipment: { x: { origin: 'Keep', details: { caption: 'Meter', note: 'Keep note', aliases: { child: { caption: 'Nested alias' } } } },
      y: { details: { caption: 'Gauge', note: '' } } }, order: ['y', 'x'] } }
    updates = undefined
    await show()
    assert.equal(document.querySelector('[data-record="x"] > .dsh-design-record-fields > .dsh-design-form-group'),null,'title-only group does not leave an empty heading')
    assert.equal(document.querySelector('[data-record="x"] > .dsh-design-record-fields > [data-field="caption"]'),null)
    assert.equal(document.querySelectorAll('[data-panel-title="editable"]').length,2,'one header editor per actual record')
    assert.equal(document.querySelector('[data-child-record] [data-field="caption"] input').value,'Nested alias','same-key nested name is not deduplicated')
    assert.match(document.querySelector('[data-testid="record-remove-x"]').getAttribute('aria-label'), /Meter/)
    await input(document.querySelector('[data-record="x"] [data-panel-title="editable"]'), 'Renamed meter')
    assert.equal(updates['model.equipment'].x.details.caption, 'Renamed meter')
    assert.equal(updates['model.equipment'].x.origin, 'Keep')
    assert.equal(updates['model.equipment'].x.details.note, 'Keep note')
    assert.deepEqual(updates['model.equipment'].x.details.aliases,data.model.equipment.x.details.aliases)
    assert.deepEqual(updates['model.equipment'].y, data.model.equipment.y)
    assert.equal(updates['model.order'], undefined)
    assert.deepEqual(data.model.order, ['y', 'x'])
    data.model.equipment = updates['model.equipment']; updates = undefined
    const workspace = { id: 'equipment-workspace', component: 'record_workspace', sources: ['equipment'], children: [{ id: 'equipment-inspector', component: 'record_inspector' }] }
    for (const editable of [true, false]) {
      await show(editable, workspace)
      assert.equal(style('.dsh-record-inspector').paddingTop, '0px', 'a leading detail header meets guidance without an outer spacer')
      assert.equal(style('.dsh-record-inspector').paddingLeft, '16px', 'body reading gutter remains intact')
      assert.equal(style('.dsh-design-record-header.is-detail').minHeight, '44px')
    }
    manifest.sections[0].confirm_delete = true
    manifest.sections[0].form.reorder = true
    await show()
    for (const action of ['remove', 'up', 'down']) {
      assert.match(document.querySelector(`[data-testid="record-${action}-x"]`).getAttribute('aria-label'), /Renamed meter/)
    }
    let confirmation
    window.confirm = text => { confirmation = text; return false }
    await React.act(async () => document.querySelector('[data-testid="record-remove-x"]').click())
    assert.match(confirmation, /Renamed meter/)
    assert.equal(updates, undefined, 'cancel confirmation leaves canonical state intact')
    manifest.sections[0].form.header.title.editable=false
    await show()
    assert.equal(document.querySelector('[data-record="x"] > .dsh-design-record-fields > .dsh-design-form-group input').value,'Renamed meter','non-editable header keeps the explicitly declared body entrance')
    manifest.sections[0].form.header.title={text:'Equipment'}
    await show()
    assert.equal(document.querySelector('[data-record="x"] > .dsh-design-record-fields > .dsh-design-form-group input').value,'Renamed meter','static collection caption must not remove the record name')
    delete manifest.sections[0].form
    await show()
    assert.equal(document.querySelector('[data-panel-title="editable"]'), null)
    assert.match(document.querySelector('[data-testid="record-remove-x"]').getAttribute('aria-label'), /x$/,
      'undeclared title keeps the legacy fallback')
    assert.equal(document.querySelectorAll('.dsh-design-record-form > [data-record] > .dsh-design-record-fields > [data-field="caption"]').length, 2)
    assert.ok(document.querySelector('[data-testid="record-up-x"]'), 'legacy order controls remain')
    manifest.sections[0].form = { reorder: true }
    delete manifest.sections[0].order
    await show()
    assert.equal(document.querySelector('[data-testid="record-up-x"]'), null, 'true cannot invent durable order')

    // Actual Page declaration: frame and edge identity is label, not the UUID.
    manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/page_design/panel.yaml', import.meta.url), 'utf8'))
    data = { pages: {}, page_order: [], connections: { edge: { id: 'edge', label: 'Read chosen record' } },
      connection_order: ['edge'], canvas_sections: { frame: { id: 'frame', label: 'Reading group', page_ids: [] } } }
    for (const [section, id, label] of [['connections', 'edge', 'Read chosen record'], ['canvas_sections', 'frame', 'Reading group']]) {
      await show(true, { component: 'record_form', id: 'form', source: section })
      assert.equal(document.querySelector('[data-panel-title="editable"]').value, label)
      assert.equal(document.querySelector('[data-field="label"]'), null, 'title has only one editor')
      assert.match(document.querySelector(`[data-testid="record-remove-${id}"]`).getAttribute('aria-label'), new RegExp(label))
      const before = structuredClone(data)
      updates = undefined
      await input(document.querySelector('[data-panel-title="editable"]'), label + ' renamed')
      assert.deepEqual(updates[section], { ...before[section], [id]: { ...before[section][id], label: label + ' renamed' } })
      assert.deepEqual(data, before, 'header edit cannot mutate source facts')
      assert.equal(updates[section === 'connections' ? 'canvas_sections' : 'connections'], undefined)
    }
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
