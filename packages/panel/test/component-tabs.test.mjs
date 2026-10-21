import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window; globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Element = dom.window.Element
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { default: React, act } = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderToStaticMarkup } = await import('react-dom/server')
const { ComponentTabs } = await import('../src/component-tabs.tsx')
const { renderNode, renderManifest } = await import('../src/interpreter.ts')
const tabs = () => [...document.querySelectorAll('[role="tab"]')]
const panels = () => [...document.querySelectorAll('[role="tabpanel"]')]
const select = async index => act(async () => tabs()[index].click())
const node = { id: 'views', component: 'tabs', title: 'Views', children: [
  { id: 'a', component: 'text_block', title: 'First', text: 'One' },
  { id: 'b', component: 'text_block', title: 'Second', text: 'Two' },
] }

test('actual registry switches panels with reciprocal ARIA, keyboard and readonly authority', async () => {
  const root = createRoot(document.getElementById('root')); const edits = []
  try {
    await act(async () => root.render(renderNode(node, {}, {}, { editable: false, onEdit: e => edits.push(e) })))
    assert.deepEqual(panels().map(p => p.hidden), [false, true], 'negative control: all-visible wrapper must fail')
    assert.equal(document.querySelector('.dsh-design-tabs'), null)
    for (const [index, tab] of tabs().entries()) {
      assert.equal(tab.getAttribute('aria-controls'), panels()[index].id)
      assert.equal(panels()[index].getAttribute('aria-labelledby'), tab.id)
    }
    await select(1); assert.deepEqual(panels().map(p => p.hidden), [true, false])
    for (const [key, expected] of [['ArrowRight', 0], ['ArrowLeft', 1], ['Home', 0], ['End', 1]]) {
      await act(async () => document.activeElement === document.body ? tabs()[1].focus() : undefined)
      await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
      assert.equal(document.activeElement, tabs()[expected])
      assert.deepEqual(tabs().map(t => t.tabIndex), expected === 0 ? [0, -1] : [-1, 0])
    }
    const down = new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    await act(async () => tabs()[1].dispatchEvent(down)); assert.equal(down.defaultPrevented, false)
    assert.deepEqual(edits, [])
  } finally { await act(async () => root.unmount()) }
})

test('mounted drafts and stable selection survive reorder/locale; removal/readdition and empty are deterministic', async () => {
  const root = createRoot(document.getElementById('root')); let mounts = 0
  function Draft() {
    const [value, setValue] = React.useState('initial')
    React.useEffect(() => { mounts++ }, [])
    return React.createElement('input', { value, onInput: e => setValue(e.currentTarget.value) })
  }
  const draw = children => React.createElement(ComponentTabs, { node: { ...node, children }, render: () => React.createElement(Draft) })
  try {
    await act(async () => root.render(draw(node.children)))
    const input = panels()[1].querySelector('input')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'unsaved')
    await act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
    await select(1); await select(0); await select(1)
    assert.equal(panels()[1].querySelector('input'), input); assert.equal(input.value, 'unsaved'); assert.equal(mounts, 2)
    await act(async () => root.render(draw([...node.children].reverse().map(c => ({ ...c, title: `中文${c.id}` })))))
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true'); assert.equal(panels()[0].querySelector('input'), input)
    await act(async () => root.render(draw([node.children[0]])))
    await act(async () => root.render(draw(node.children)))
    assert.equal(tabs()[0].getAttribute('aria-selected'), 'true', 're-added b must not steal selection')
    await act(async () => root.render(draw([])))
    assert.equal(tabs().length, 0); assert.equal(panels().length, 0)
  } finally { await act(async () => root.unmount()) }
})

test('nested/repeated IDs produce unique DOM relationships; invalid sibling IDs fail and hidden CSS wins', () => {
  const html = renderToStaticMarkup(React.createElement('div', null,
    renderNode(node, {}, {}), renderNode({ ...node, children: [{ ...node.children[0], component: 'tabs', children: node.children }] }, {}, {})))
  const document = new JSDOM(html).window.document
  const ids = [...document.querySelectorAll('[id]')].map(e => e.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const children of [[{ component: 'text_block' }], [{ id: '', component: 'text_block' }], [node.children[0], node.children[0]]]) {
    assert.throws(() => renderToStaticMarkup(renderNode({ ...node, children }, {}, {})), /unique, non-empty IDs/)
  }
  const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  assert.match(css, /\.dsh-component-tabs > \.dsh-component-tabs-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/)
  assert.equal(/\.dsh-design-tabs/.test(css.slice(css.indexOf('/* Shared declarative tabs:'))), false)
})

test('supported A2UI generated and retained DSL use the same tabs registry and actual rebound input edits', async () => {
  const { basicGenericManifest } = await import('../../core/src/auto-panel-generation.ts')
  const { autoPanelSnapshot, preserveAutoPanelDefinition, readSavedAutoPanelDefinition } = await import('../../core/src/auto-panel-spec.ts')
  const context = { kit: 'equipment', kitVersion: '1.0', bundle: 'inventory', bundleVersion: '1.0',
    schema: { type: 'object', properties: { items: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' } } } } } },
    state: { items: { a: { title: 'Old' } } } }
  const original = basicGenericManifest(context)
  original.ui = { ...node, children: [node.children[0], { id: 'edit', component: 'record_form', title: 'Edit', source: 'items' }] }
  const snapshot = autoPanelSnapshot(context, [
    { version: 'v0.9', createSurface: { surfaceId: 'auto-panel', catalogId: 'urn:dsh:panel-catalog:design-files:v1', sendDataModel: false } },
    { version: 'v0.9', updateComponents: { surfaceId: 'auto-panel', components: [{ id: 'root', component: 'DesignPanel', manifest: original }] } },
  ])
  const current = { ...context, state: { items: { b: { title: 'Current' } } } }
  const retained = readSavedAutoPanelDefinition(JSON.parse(JSON.stringify(preserveAutoPanelDefinition(snapshot, context))), current).manifest
  const transcripts = []
  for (const manifest of [original, retained]) {
    const root = createRoot(document.getElementById('root')); const edits = []
    try {
      for (const locale of ['en-US', 'zh-CN']) {
        await act(async () => root.render(renderManifest(manifest, current.state, { locale, editable: true, onEdit: e => edits.push(e) })))
        await select(1)
        const input = panels()[1].querySelector('input'); assert.equal(input.value, 'Current')
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, `Edited ${locale}`)
        await act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
        assert.deepEqual(edits.at(-1), { section: 'items', record: 'b', field: 'title', value: `Edited ${locale}` })
        await act(async () => root.render(renderManifest(manifest, current.state, { locale, editable: false, onEdit: e => edits.push(e) })))
        await select(0); await select(1)
        for (const control of panels()[1].querySelectorAll('input, textarea, select')) {
          assert.ok(control.disabled || control.readOnly, 'readonly must expose no writable controls')
        }
        assert.match(panels()[1].textContent, /Current/, 'readonly renders current canonical value, not unsaved draft')
      }
      assert.equal(edits.length, 2); transcripts.push(edits)
    } finally { await act(async () => root.unmount()) }
  }
  assert.deepEqual(transcripts[0], transcripts[1]); assert.equal(current.state.items.b.title, 'Current')
})

test.after(() => dom.window.close())
