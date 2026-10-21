import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<style></style><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { localizePanelManifest } = await import('../../core/src/panel-dsl.ts')

test('same-record sidecar works outside workspace, nested canonical edits update preview and readonly has no writes', async () => {
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries', records_path: 'container.entries', fields_path: 'detail', order: 'container.order',
    form: { body: [{ kind: 'group', items: [{ kind: 'field', field: 'description' }], sidecar: { component: 'record_preview', title: '$t:preview', preview: { title: 'caption', body: 'description', action: 'destination' } } }] } }],
    fields: ['caption', 'description', 'destination'].map(key => ({ key, label: key, control: key === 'description' ? 'textarea' : 'text', applies_to: ['entries'] })),
    i18n: { default_locale: 'en-US', locales: { 'en-US': 'locales/en-US.json', 'zh-CN': 'locales/zh-CN.json' }, messages: { 'en-US': { preview: 'Preview' }, 'zh-CN': { preview: '预览' } } },
    ui: { id: 'form', component: 'record_form', source: 'entries' } }
  let data = { container: { entries: { a: { retained: 'A metadata', detail: { caption: 'First', description: 'Line one\nLine two', destination: 'Destination A' } },
    b: { retained: 'B metadata', detail: { caption: 'Second', description: 'Other body', destination: 'Destination B' } } }, order: ['b', 'a'] } }
  const before = structuredClone(data), patches = [], root = createRoot(document.getElementById('root'))
  let locale = 'en-US', editable = true
  const paint = () => root.render(React.createElement('div', { className: 'dsh-design-panel' }, renderNode(manifest.ui, localizePanelManifest(manifest, locale), data,
    { editable, onPanelUpdate: next => { patches.push(next); data = { container: { ...data.container, entries: next['container.entries'] } }; paint() } })))
  try {
    await React.act(async () => paint())
    const previews = [...document.querySelectorAll('.dsh-record-preview')]
    assert.deepEqual(previews.map(p => p.querySelector('h3').textContent), ['Second', 'First'])
    assert.deepEqual(previews.map(p => p.querySelector('article p').textContent), ['Other body', 'Line one\nLine two'])
    assert.equal(previews[0].querySelector('button,a,input'), null, 'display action cannot execute or edit')
    assert.equal(patches.length, 0)
    const content = document.querySelector('.has-sidecar')
    assert.equal(window.getComputedStyle(content).display, 'grid')
    assert.match(window.getComputedStyle(content).gridTemplateColumns, /auto-fit.*min\(100%, 260px\)/)
    const input = document.querySelector('[data-record="b"] textarea')
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'Edited current record')
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.equal(document.querySelector('[data-record="b"] .dsh-record-preview article p').textContent, 'Edited current record')
    assert.deepEqual(data.container.entries.a, before.container.entries.a)
    assert.equal(data.container.entries.b.retained, 'B metadata')
    assert.deepEqual(data.container.order, before.container.order)
    const count = patches.length; locale = 'zh-CN'; editable = false
    await React.act(async () => paint())
    assert.equal(document.querySelector('.dsh-record-preview small').textContent, '预览')
    assert.equal(document.querySelector('input,textarea,button'), null)
    assert.equal(patches.length, count)
  } finally { await React.act(async () => root.unmount()) }
})
