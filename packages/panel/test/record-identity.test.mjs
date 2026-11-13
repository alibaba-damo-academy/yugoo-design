import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'

const dom = new JSDOM('<!doctype html><style></style><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, renderNode } = await import('../src/interpreter.ts')
const { PanelRecordHeader, PanelEditableTitle, PanelCollectionCount } = await import('../src/panel-workspace.tsx')
const { recordIdentityOf, fieldValuesOf, sectionBindingOf } = await import('../src/record-state.ts')
const { parsePanelManifest } = await import('../../core/src/panel-dsl.ts')

test('primary record bodies use the shared field gap without legacy footer or detail margins', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = parsePanelManifest(readFileSync(new URL('../../skills-web-app/bundles/function_modules/panel.yaml', import.meta.url), 'utf8'))
  const data = JSON.parse(readFileSync(new URL('../../skills-web-app/bundles/function_modules/reference/preview.json', import.meta.url), 'utf8'))
  try {
    await React.act(() => root.render(React.createElement('div', { className: 'dsh-design-panel' }, renderNode(manifest.ui, manifest, data, { editable: true, onEdit() {} }))))
    const body = document.querySelector('[data-board-record] .dsh-design-form-group-fields')
    assert.ok(body)
    assert.equal(getComputedStyle(body).gap, 'var(--ygd-panel-detail-section-gap, 16px)')
    for (const selector of ['.dsh-record-board-footer', '.dsh-record-board-editor']) {
      const child = body.querySelector(`:scope > ${selector}`)
      assert.ok(child)
      assert.equal(parseFloat(getComputedStyle(child).marginTop) || 0, 0, 'the shared grid gap is not added to an old card margin')
    }
  } finally { await React.act(() => root.unmount()) }
})

test('saved identity uses explicit field bindings and projected values without inventing a fallback', () => {
  const manifest = { sections: [{ id: 'items', create: { id_field: 'canonical' }, fields_path: 'facts' }], fields: [
    { key: 'canonical', label: 'Record number', applies_to: ['items'] }, { key: 'external', label: 'Board number', applies_to: ['items'] },
  ] }
  const record = { canonical: 'WRAPPER-TECHNICAL', facts: { canonical: 'OBJ-007', external: 'OLD-BOARD-ID' } }
  const values = fieldValuesOf(record, sectionBindingOf(manifest, 'items').fieldsPath)
  const before = structuredClone(record)
  assert.deepEqual(recordIdentityOf(manifest, 'items', values), { value: 'OBJ-007', label: 'Record number' })
  assert.deepEqual(recordIdentityOf(manifest, 'items', values, 'external'), { value: 'OLD-BOARD-ID', label: 'Board number' })
  assert.equal(recordIdentityOf(manifest, 'items', { canonical: 'Unformatted legacy number / 原样保留' }).value, 'Unformatted legacy number / 原样保留')
  for (const canonical of [undefined, '', '  ', 7]) assert.equal(recordIdentityOf(manifest, 'items', { canonical }), undefined)
  assert.equal(recordIdentityOf(manifest, 'unbound', values), undefined)
  const field = manifest.fields[0]
  field.hidden = true
  assert.equal(recordIdentityOf(manifest, 'items', values), undefined, 'creation identity alone does not expose a hidden field')
  assert.deepEqual(recordIdentityOf(manifest, 'items', values, 'canonical'), { value: 'OBJ-007', label: 'Record number' }, 'an explicit display binding still owns its ID presentation')
  field.hidden = false
  field.visible_when = { field: 'showNumber', in: ['yes'] }
  assert.equal(recordIdentityOf(manifest, 'items', values), undefined)
  assert.equal(recordIdentityOf(manifest, 'items', { ...values, showNumber: 'yes' }).value, 'OBJ-007')
  manifest.fields = manifest.fields.slice(1)
  assert.equal(recordIdentityOf(manifest, 'items', values), undefined, 'an undeclared technical identity is not a visible business field')
  assert.deepEqual(record, before)
})

test('shared workspace header retains the same saved ID through rename, navigation and same-record details', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [
    { id: 'items', title: 'Items', create: { id_field: 'canonical' }, form: { header: { variant: 'detail', title: { field: 'name', editable: true } } } },
    { id: 'detail', records_path: 'items', fields_path: 'facts', create: { id_field: 'canonical' } },
  ], fields: [
    { key: 'name', label: 'Name', control: 'text', applies_to: ['items'] },
    { key: 'canonical', label: 'Record number', control: 'text', readonly: true, hidden: true, applies_to: ['items', 'detail'] },
    { key: 'notes', label: 'Notes', control: 'textarea', applies_to: ['detail'] },
  ], ui: { component: 'record_workspace', id: 'identity-workspace', sources: ['items'], children: [{ component: 'record_inspector', id: 'inspector' }] } }
  const oldId = 'legacy-record-550e8400-e29b-41d4-a716-446655440000'
  let data = { items: { internal: { canonical: oldId, name: 'First item', facts: { canonical: 'SAME-RECORD-DETAIL', notes: 'Preserve this content' } }, second: { canonical: 'OBJ-002', name: 'Second item' } } }
  const original = structuredClone(data)
  let writes = 0
  const paint = () => root.render(renderManifest(manifest, data, { editable: true, locale: 'en-US',
    onPanelUpdate: updates => { writes++; data = { ...data, ...updates }; paint() },
  }))
  const identity = () => document.querySelector('.dsh-design-record-title .dsh-record-board-id')
  try {
    await React.act(paint)
    assert.equal(identity(), null, 'a hidden creation identity stays out of the ordinary title')
    manifest.fields.find(field => field.key === 'canonical').hidden = false
    await React.act(paint)
    assert.equal(identity().textContent, oldId)
    assert.equal(identity().parentElement.firstElementChild, identity(), 'identity precedes the name')
    assert.equal(getComputedStyle(identity().parentElement).alignItems, 'first baseline', 'a business number stays on the title first line')
    assert.equal(identity().title, 'Record number')
    assert.equal(document.querySelectorAll('.dsh-record-board-id').length, 1, 'the selected record has one identity header')
    const input = document.querySelector('input[aria-label="Name"]')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'Renamed item')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(data.items.internal.canonical, oldId)
    assert.equal(data.items.internal.name, 'Renamed item')
    assert.deepEqual(data.items.internal.facts, original.items.internal.facts)
    await React.act(async () => document.querySelector('nav button[aria-label="Second item"]').click())
    assert.equal(identity().textContent, 'OBJ-002')
    await React.act(async () => document.querySelector('nav button[aria-label="Renamed item"]').click())
    assert.equal(identity().textContent, oldId)
    assert.equal(document.querySelector('input[aria-label="Name"]').value, 'Renamed item')
    assert.equal(writes, 1, 'reading and navigating never initialize or repair IDs')
    await React.act(() => root.render(renderNode({ component: 'record_form', id: 'detail', source: 'detail' }, manifest, data)))
    assert.equal(document.querySelector('.dsh-record-board-id'), null, 'same-record fields_path projection does not repeat identity')
    delete data.items.internal.canonical
    await React.act(paint)
    assert.equal(identity(), null, 'missing saved identity never becomes the internal map key')
    assert.equal(writes, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test('an explicit header shows the saved hidden business number without exposing another editor or inventing a number', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'items', title: 'Items', form: { header: { variant: 'detail', show_id: true, title: { field: 'name', editable: true } } } },
  ], fields: [
    { key: 'id', control: 'text', readonly: true, hidden: true, applies_to: ['items'] },
    { key: 'name', control: 'text', applies_to: ['items'] },
  ], ui: { component: 'record_form', id: 'numbered-records', source: 'items' } }
  const data = { items: { row: { id: 'BO-001', name: 'Feedback' } } }
  const before = structuredClone(data), writes = []
  const paint = () => root.render(renderNode(manifest.ui, manifest, data, { editable: true, onPanelUpdate: value => writes.push(value) }))
  try {
    await React.act(paint)
    assert.equal(document.querySelector('.dsh-record-board-id').textContent, 'BO-001')
    assert.equal(document.querySelectorAll('[data-field="id"]').length, 0)
    assert.equal(document.querySelectorAll('.dsh-record-board-id').length, 1)
    assert.equal(document.querySelectorAll('input').length, 1)
    manifest.ui.record_table = { columns: [{ fields: ['name'], label: 'Name' }] }
    await React.act(paint)
    const row = document.querySelector('tbody tr')
    assert.equal(row.querySelectorAll('td').length, 2, 'number adds no column beside the existing name and actions')
    assert.equal(row.querySelector('td .dsh-record-board-id').textContent, 'BO-001')
    assert.equal(row.querySelectorAll('.dsh-record-board-id').length, 1)
    delete data.items.row.id
    await React.act(paint)
    assert.equal(document.querySelector('.dsh-record-board-id'), null, 'a missing number stays absent rather than showing the storage key')
    data.items.row = before.items.row
    manifest.sections[0].form.header.show_id = false
    await React.act(paint)
    assert.equal(document.querySelector('.dsh-record-board-id'), null)
    assert.deepEqual(writes, [])
    assert.deepEqual(data, before)
  } finally { await React.act(() => root.unmount()) }
})

test('long identity keeps its shared wrapping beside editable title, metadata and independent count', async () => {
  const root = createRoot(document.getElementById('root'))
  const id = 'legacy-record-550e8400-e29b-41d4-a716-446655440000'
  let writes = 0
  try {
    await React.act(() => root.render(React.createElement('div', { className: 'dsh-design-panel', style: { width: 400 } },
      React.createElement(PanelRecordHeader, { titleRole: 'record', recordId: id, meta: 'Performer: Project lead' },
        React.createElement(PanelEditableTitle, { 'aria-label': 'Name', value: 'Keep the complete editable title', onChange: () => writes++ }),
        React.createElement(PanelCollectionCount, { count: 12, locale: 'en-US' })))))
    const identity = document.querySelector('.dsh-record-board-id')
    const style = getComputedStyle(identity)
    assert.equal(identity.textContent, id)
    assert.equal(style.maxWidth, '25%')
    assert.equal(style.overflowWrap, 'anywhere')
    assert.equal(style.fontSize, '12px')
    assert.equal(getComputedStyle(document.querySelector('.dsh-panel-header-main')).display, 'flex')
    assert.equal(document.querySelector('.dsh-panel-collection-count').getAttribute('aria-label'), '12 items')
    assert.equal(document.querySelector('.dsh-panel-header-meta').textContent, 'Performer: Project lead')
    await React.act(async () => document.querySelector('.dsh-panel-title-edit').click())
    assert.equal(document.activeElement, document.querySelector('input[aria-label="Name"]'))
    assert.equal(writes, 0)
    await React.act(() => root.render(React.createElement(PanelRecordHeader, { recordId: '  ' }, 'Unnumbered item')))
    assert.equal(document.querySelector('.dsh-record-board-id'), null)
  } finally { await React.act(async () => root.unmount()) }
})
