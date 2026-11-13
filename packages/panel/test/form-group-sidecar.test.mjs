import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><style></style><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')
const { localizePanelManifest } = await import('../../core/src/panel-dsl.ts')
const { PanelContentGroup, PanelEditableTitle, PanelRecordId, PanelHelp } = await import('../src/panel-workspace.tsx')
const { StandardQuestionList } = await import('../src/question-list.tsx')

test('shared grey title slots fit plain text, editable names, actions and static groups without duplicate insets', async () => {
  const root = createRoot(document.getElementById('root'))
  const longTitle = 'A complete multi-line section title that must remain readable when the available content width becomes narrow. '.repeat(4)
  const group = (name, title, preview) => React.createElement(PanelContentGroup, { key: name, 'aria-label': name, title, preview },
    React.createElement('div', { className: 'dsh-design-form-group-content' }, React.createElement('textarea', { defaultValue: `Draft ${name}` })))
  const actions = React.createElement('div', { className: 'dsh-design-record-actions' },
    React.createElement('button', { type: 'button', style: { height: 32 } }, 'Action'))
  const editable = React.createElement('span', { className: 'dsh-design-record-header-label' },
    React.createElement(PanelRecordId, { value: 'AC-001' }),
    React.createElement(PanelEditableTitle, { value: 'An editable record name', onChange() {} }))
  try {
    await React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel dsh-record-board-cards', style: { width: 220 } },
      group('plain', 'Ordinary section'), group('editable', editable, actions), group('long', longTitle),
      group('numbered', React.createElement(React.Fragment, null, React.createElement(PanelRecordId, { value: 'AC-002' }),
        React.createElement('span', { className: 'dsh-design-record-header-label' }, longTitle))),
      group('help', React.createElement(React.Fragment, null, 'Math notation', React.createElement(PanelHelp, { label: 'Notation help' }, 'Context'))),
      React.createElement(StandardQuestionList, { questions: [
        { id: 'fixed', prompt: 'Platform', kind: 'text', answer: 'Saved answer' },
        { id: 'ordinary', prompt: longTitle, kind: 'text', answer: '' },
      ], cardGroups: [{ id: 'static', title: 'App basics', questionIds: ['fixed'], presentation: { alwaysExpanded: true } }] }),
    )))
    const sections = [...document.querySelectorAll('.dsh-design-form-group.is-collapsible')]
    for (const section of sections) {
      const summary = section.querySelector(':scope > summary'), label = summary.querySelector(':scope > .dsh-panel-disclosure-label')
      const summaryStyle = window.getComputedStyle(summary), labelStyle = window.getComputedStyle(label)
      assert.equal(summaryStyle.paddingTop, '8px')
      assert.equal(summaryStyle.paddingBottom, '8px')
      assert.equal(labelStyle.minHeight, '32px')
      assert.equal(parseFloat(labelStyle.paddingBlock), 0, 'the title slot never pads an existing control twice')
      assert.equal(labelStyle.alignItems, section.getAttribute('aria-label') === 'numbered' ? 'first baseline' : 'center', 'direct business numbers retain their existing first-line baseline')
      assert.ok(['', 'auto'].includes(labelStyle.height), '32px is a minimum, never a fixed multi-line title height')
      const editor = section.querySelector('textarea')
      editor.value = `Retained ${section.getAttribute('aria-label')}`
      await React.act(async () => { summary.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
      assert.equal(section.open, false)
      assert.equal(window.getComputedStyle(summary).paddingBottom, '8px', 'closing keeps the same title inset')
      await React.act(async () => { summary.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
      assert.equal(section.querySelector('textarea'), editor, 'native disclosure retains its existing editor')
      assert.equal(editor.value, `Retained ${section.getAttribute('aria-label')}`)
    }
    assert.equal(document.querySelector('[aria-label="long"] .dsh-panel-disclosure-label').textContent, longTitle)
    assert.equal(window.getComputedStyle(document.querySelector('.dsh-design-record-header-input')).height, '28px', 'the Board name control keeps its own size')
    assert.equal(window.getComputedStyle(document.querySelector('.dsh-panel-title-edit')).height, '24px')
    assert.equal(window.getComputedStyle(document.querySelector('.dsh-design-record-actions button')).height, '32px', 'ordinary action hit targets remain intact')
    const compact = document.querySelector('.dsh-standard-question-card-group.is-compact')
    assert.equal(window.getComputedStyle(compact).paddingTop, '8px')
    assert.equal(window.getComputedStyle(compact.querySelector('h3')).minHeight, '32px', 'a static grey heading uses the same minimum title slot')
    assert.equal(document.querySelector('[data-question-id="ordinary"] .dsh-standard-question-heading').textContent, longTitle)
    assert.equal(window.getComputedStyle(document.querySelector('[data-question-id="ordinary"] .dsh-standard-question-heading')).paddingBlock, '4px', 'long question prompts retain their own established text rhythm')
  } finally { await React.act(async () => root.unmount()) }
})

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
