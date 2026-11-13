import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'

const dom = new JSDOM('<!doctype html><style></style><div id="root" class="dsh-design-panel"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
const { parsePanelManifest } = await import('../src/dsl.ts')
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const change = async action => { await React.act(async () => { action(); await tick() }); await React.act(tick) }
const input = (element, value) => change(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
})

async function mount(manifest, initial) {
  const root = createRoot(document.getElementById('root')), writes = []
  let data = structuredClone(initial), editable = true
  const render = () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable,
    onPanelUpdate: updates => { writes.push(updates); data = applyPanelUpdatesToDraft(data, updates); render() } }))
  await change(render)
  return { root, writes, value: () => data, readonly: () => change(() => { editable = false; render() }) }
}
async function actual(bundle, source) {
  const dir = new URL(`../../skills-web-app/bundles/${bundle}/`, import.meta.url)
  const manifest = parsePanelManifest(readFileSync(new URL('panel.yaml', dir), 'utf8'))
  manifest.i18n.messages = { 'en-US': JSON.parse(readFileSync(new URL('locales/en-US.json', dir), 'utf8')) }
  manifest.ui = { id: 'title-regression', component: 'record_form', source }
  const data = JSON.parse(readFileSync(new URL('reference/preview.json', dir), 'utf8'))
  return { manifest, data }
}

test('actual Business Data name has one title editor; pencil, rename and disclosure preserve the canonical record', async () => {
  const { manifest, data } = await actual('business_data', 'objects'), fixture = await mount(manifest, data)
  const objectId = data.object_order[0]
  const card = () => document.querySelector(`[data-record="${objectId}"] [data-record-map="fields"] [data-child-record="title"]`)
  const title = () => card().querySelector(':scope > summary [data-panel-title="editable"]')
  try {
    assert.ok(title())
    assert.equal(title().getAttribute('aria-required'), 'true')
    assert.equal(Boolean(card().querySelector('[data-field="name"]')), false, 'the same name is not edited twice')
    assert.equal(window.getComputedStyle(title()).borderTopWidth, '0px', 'nested titles retain the shared borderless input')
    assert.equal(window.getComputedStyle(title()).padding, '0px')
    await change(() => card().querySelector('.dsh-panel-title-edit').click())
    assert.equal(document.activeElement, title())
    assert.equal(title().selectionStart, 0)
    assert.equal(title().selectionEnd, title().value.length)
    assert.equal(card().open, true)
    assert.equal(fixture.writes.length, 0, 'pencil focus is not a design edit')
    await change(() => title().click())
    assert.equal(card().open, true)
    await input(title(), 'Project title')
    const expected = structuredClone(data); expected.objects[objectId].fields.title.name = 'Project title'
    assert.deepEqual(fixture.value(), expected, 'ids, order, source and other business facts remain intact')
    await change(() => card().querySelector(':scope > summary').click())
    assert.equal(card().open, false)
    await change(() => card().querySelector(':scope > summary').click())
    assert.equal(title().value, 'Project title')
    await fixture.readonly()
    assert.equal(Boolean(card().querySelector('[data-panel-title="editable"], .dsh-panel-title-edit, [data-field="name"]')), false)
    assert.match(card().querySelector(':scope > summary').textContent, /Project title/)
    assert.deepEqual(fixture.value(), expected)
  } finally { await React.act(() => fixture.root.unmount()) }
})

test('actual AI entry title and token Add use shared controls without duplicate name inputs or heading weight', async () => {
  const { manifest, data } = await actual('ai_agent_capabilities', 'agents'), fixture = await mount(manifest, data)
  const card = () => document.querySelector('[data-record="A-001"] [data-record-map="entries"] [data-child-record="chat"]')
  try {
    assert.ok(card())
    assert.equal(Boolean(card().querySelector('[data-field="name"]')), false)
    await input(card().querySelector('[data-panel-title="editable"]'), 'Discuss the current material')
    const expected = structuredClone(data); expected.agents['A-001'].entries.chat.name = 'Discuss the current material'
    assert.deepEqual(fixture.value(), expected)
    const add = card().querySelector('[data-field="input_modes"] .dsh-token-add-trigger')
    assert.ok(add)
    assert.equal(Boolean(add.querySelector('strong')), false)
    assert.equal(window.getComputedStyle(add.querySelector('.dsh-token-add-label')).fontWeight, '400')
    await change(() => add.click())
    assert.ok(card().querySelector('[role="menu"]'), 'the action still opens the original token menu')
    assert.deepEqual(fixture.value(), expected, 'opening a menu does not change saved entry facts')
  } finally { await React.act(() => fixture.root.unmount()) }
})

test('nested titles respect visibility, readonly and identity fields, and keep dependent edit semantics', async () => {
  const field = { key: 'entries', label: 'Entries', control: 'record_map', id_field: 'id', item_label_field: 'name',
    item_fields: [{ key: 'name', label: 'Name', control: 'text', max_length: 30, required: true },
      { key: 'extra', label: 'Extra', control: 'text', visible_when: { field: 'name', in: ['Keep'] }, clear_when_hidden: 'omit' }],
    item_defaults: { name: '' }, applies_to: ['items'] }
  const initial = { items: { one: { entries: { a: { id: 'stable', name: 'Keep', extra: 'Original', source: 'Preserve' } } } } }
  const manifest = () => ({ version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }], fields: [field],
    ui: { id: 'form', component: 'record_form', source: 'items' } })
  for (const mode of ['editable', 'readonly', 'hidden', 'conditional', 'identity']) {
    const current = manifest(); current.fields = [structuredClone(field)]
    const name = current.fields[0].item_fields[0]
    if (mode === 'readonly') name.readonly = true
    if (mode === 'hidden') name.hidden = true
    if (mode === 'conditional') name.visible_when = { field: 'id', in: ['different'] }
    if (mode === 'identity') current.fields[0].id_field = 'name'
    const fixture = await mount(current, initial)
    try {
      const card = () => document.querySelector('[data-child-record="a"]')
      const title = card().querySelector('[data-panel-title="editable"]')
      assert.equal(Boolean(title), mode === 'editable')
      if (mode === 'editable') {
        assert.equal(title.maxLength, 30)
        await input(title, 'Changed')
        assert.deepEqual(fixture.value().items.one.entries.a, { id: 'stable', name: 'Changed', source: 'Preserve' }, 'title edits apply the existing clear_when_hidden contract')
        await change(() => document.querySelector('.dsh-record-map-add').click())
        const added = Object.keys(fixture.value().items.one.entries).find(id => id !== 'a')
        assert.equal(document.querySelector(`[data-child-record="${added}"] [data-panel-title="editable"]`).value, '')
      } else {
        assert.equal(Boolean(card().querySelector('.dsh-panel-title-edit')), false)
        assert.deepEqual(fixture.value(), initial)
        if (mode === 'hidden' || mode === 'conditional') assert.doesNotMatch(card().querySelector('header').textContent, /Keep/, 'hidden names do not leak into the header')
      }
    } finally { await React.act(() => fixture.root.unmount()) }
  }
})
