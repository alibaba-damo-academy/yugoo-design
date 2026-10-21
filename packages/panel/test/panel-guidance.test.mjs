import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { PanelWorkspace, PanelWorkspaceTip } = await import('../src/panel-workspace.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
const { renderManifest } = await import('../src/interpreter.ts')
const { RecordBoard } = await import('../src/record-board.tsx')
const { CanvasWorkspace } = await import('../src/canvas-workspace.tsx')

test('workspace guidance dismisses only local presentation and remains closed during editing and locale changes', async () => {
  const root = createRoot(document.getElementById('root'))
  const show = (id = 'first', locale = 'zh-CN', guidance = '编辑当前对象，再保存设计。') => React.act(async () => root.render(
    React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement('div', { className: 'dsh-design-panel' },
      React.createElement(PanelWorkspace, { sidebar: 'Navigation', autoSaveId: id, guidance }, React.createElement('input', { 'aria-label': 'Name', defaultValue: 'Preserved' }))))))
  try {
    await show()
    const main = document.querySelector('main')
    assert.ok(main.firstElementChild.classList.contains('dsh-panel-workspace-guidance'))
    assert.equal(main.querySelector('[role="note"] > div').textContent, '编辑当前对象，再保存设计。')
    assert.equal(document.querySelector('.dsh-panel-guidance-dismiss').getAttribute('aria-label'), '关闭操作引导')
    await React.act(async () => document.querySelector('.dsh-panel-guidance-dismiss').click())
    assert.equal(document.querySelector('[role="note"]'), null)
    assert.equal(main.querySelector('input').value, 'Preserved')
    assert.equal(window.localStorage.getItem('dsh-panel-workspace:first:guidance'), null)
    await show('first', 'en-US', 'Edit the current object, then save the design.')
    assert.equal(document.querySelector('[role="note"]'), null, 'locale changes do not reopen dismissed guidance')
    await show('second', 'en-US', 'Edit the current object, then save the design.')
    assert.equal(document.querySelector('.dsh-panel-guidance-dismiss').getAttribute('aria-label'), 'Dismiss panel guidance')
    await show('second', 'en-US', '')
    assert.equal(document.querySelector('.dsh-panel-guidance-dismiss'), null, 'no empty banner or close control')
    await React.act(async () => root.render(React.createElement(PanelWorkspaceTip, null, 'Contextual explanation')))
    assert.equal(document.querySelector('.dsh-panel-guidance-dismiss'), null, 'contextual and warning content is not automatically dismissible')
  } finally { await React.act(async () => root.unmount()) }
})

test('declarative panel_workspace uses independent localized guidance, never empty-state or Bundle picker descriptions', async () => {
  const root = createRoot(document.getElementById('root'))
  const data = { records: { one: { name: 'User-owned name' } } }
  const before = structuredClone(data)
  let updates = 0
  const manifest = { version: 1, panel_kind: 'document', sections: [], fields: [],
    i18n: { default_locale: 'zh-CN', locales: { 'zh-CN': 'locales/zh-CN.json', 'en-US': 'locales/en-US.json' },
      messages: { 'zh-CN': { guidance: '先选择对象，再编辑内容。', bundleDescription: '能力介绍，与操作引导不同。' },
        'en-US': { guidance: 'Select an object, then edit it.', bundleDescription: 'A capability description, not panel guidance.' } } },
    ui: { component: 'panel_workspace', id: 'workspace', guidance: '$t:guidance', description: 'Empty-state copy', slots: {
      sidebar: { component: 'text_block', id: 'navigation', text: 'Navigation' },
      main: { component: 'text_block', id: 'main', text: 'Content' } } } }
  try {
    await React.act(async () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable: false, onPanelUpdate: () => updates++ })))
    assert.equal(document.querySelector('[role="note"] > div').textContent, 'Select an object, then edit it.')
    assert.doesNotMatch(document.getElementById('root').textContent, /capability description/)
    await React.act(async () => document.querySelector('.dsh-panel-guidance-dismiss').click())
    assert.equal(document.querySelector('[role="note"]'), null)
    assert.equal(updates, 0, 'dismissal does not invoke the write callback even in a readonly panel')
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})

test('plain authored forms receive one dismissible guidance without suppressing their content', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [], fields: [],
    ui: { component: 'stack', id: 'plain', guidance: 'Review the saved facts.',
      children: [{ component: 'text_block', id: 'content', text: 'Canonical content remains visible.' }] } }
  try {
    await React.act(async () => root.render(renderManifest(manifest, {}, { locale: 'en-US' })))
    assert.equal(document.querySelectorAll('[role="note"]').length, 1)
    await React.act(async () => document.querySelector('.dsh-panel-guidance-dismiss').click())
    assert.equal(document.querySelector('[role="note"]'), null)
    assert.match(document.getElementById('root').textContent, /Canonical content remains visible/)
  } finally { await React.act(async () => root.unmount()) }
})

test('board and canvas names use the original canonical update and do not offer fake readonly pencils', async () => {
  const root = createRoot(document.getElementById('root'))
  const writes = []
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items', add_mode: 'none' }],
    fields: [{ key: 'name', label: 'Name', control: 'text', applies_to: ['items'], required: true },
      { key: 'group', control: 'text', applies_to: ['items'] },
      { key: 'description', control: 'textarea', applies_to: ['items'] }] }
  const data = { items: { first: { id: 'first', name: 'Original name', description: 'Keep content', group: 'Group' } } }
  const before = structuredClone(data)
  const node = { id: 'board', component: 'record_board', source: 'items', board: { label: 'name', description: 'description', group: 'group' } }
  const change = async (input, value) => React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  })
  const showBoard = (editable, onTransaction) => React.act(async () => root.render(React.createElement(RecordBoard,
    { node, manifest, data, options: { editable, onTransaction }, render: () => null })))
  try {
    await showBoard(true, edits => writes.push(edits))
    const title = document.querySelector('header [data-panel-title="editable"]')
    assert.ok(title && title.getAttribute('aria-required') === 'true')
    await React.act(async () => document.querySelector('.dsh-panel-title-edit').click())
    assert.equal(document.activeElement, title)
    assert.equal(writes.length, 0, 'pencil only focuses the existing editor')
    await change(title, 'Renamed board item')
    assert.deepEqual(writes, [[{ section: 'items', record: 'first', field: 'name', value: 'Renamed board item' }]])
    assert.deepEqual(data, before)
    for (const [editable, callback] of [[false, edits => writes.push(edits)], [true, undefined]]) {
      await showBoard(editable, callback)
      assert.equal(document.querySelector('.dsh-panel-title-edit'), null)
    }
    const canvasNode = { component: 'canvas_workspace', id: 'canvas', source: 'items', canvas: {
      format: 'excalidraw', file_field: 'artifact', label_field: 'name', id_field: 'id', scene_directory: 'boards', new_title: 'New' } }
    const showCanvas = (editable, onEdit, titlePolicy = {}) => React.act(async () => root.render(React.createElement(CanvasWorkspace,
      { node: canvasNode, manifest: { ...manifest, fields: manifest.fields.map(field => field.key === 'name' ? { ...field, ...titlePolicy } : field) }, data, options: { editable, skill: 'neutral', onEdit,
        onPanelUpdate() {}, onStageArtifact() {}, registerBeforeSave: () => () => {} } })))
    writes.length = 0
    await showCanvas(true, edit => writes.push(edit))
    assert.equal(document.querySelector('.dsh-canvas-heading input').getAttribute('aria-required'), 'true')
    await change(document.querySelector('.dsh-canvas-heading input'), 'Renamed canvas')
    assert.deepEqual(writes, [{ section: 'items', record: 'first', field: 'name', value: 'Renamed canvas' }])
    assert.deepEqual(data, before)
    await showCanvas(true, undefined)
    assert.equal(document.querySelector('.dsh-panel-title-edit'), null, 'staging capability alone is not a name update callback')
    await showCanvas(false, edit => writes.push(edit))
    assert.equal(document.querySelector('.dsh-panel-title-edit'), null)
    for (const titlePolicy of [{ readonly: true }, { hidden: true }, { control: 'select' },
      { visible_when: { field: 'group', in: ['Other group'] } }]) {
      writes.length = 0
      await showCanvas(true, edit => writes.push(edit), titlePolicy)
      const input = document.querySelector('.dsh-canvas-heading input')
      assert.equal(input.disabled, true)
      assert.equal(document.querySelector('.dsh-panel-title-edit'), null)
      await change(input, 'Blocked title change')
      assert.deepEqual(writes, [], 'a disabled or non-text title cannot emit an update')
      assert.deepEqual(data, before)
    }
    await showCanvas(true, edit => writes.push(edit), { visible_when: { field: 'group', in: ['Group'] } })
    assert.ok(document.querySelector('.dsh-panel-title-edit'), 'an applicable condition preserves editing')
    await change(document.querySelector('.dsh-canvas-heading input'), 'Visible title change')
    assert.deepEqual(writes, [{ section: 'items', record: 'first', field: 'name', value: 'Visible title change' }])
  } finally { await React.act(async () => root.unmount()) }
})

test('guidance spans the main content without an outer inset or an artificial scrollbar gutter', () => {
  const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
  const wrapper = rules.find(match => match[1].trim() === '.dsh-panel-workspace-guidance')
  assert.ok(wrapper && /(?:^|;)\s*padding:\s*0\s*;/.test(wrapper[2]))
  assert.ok(!rules.some(match => match[1].includes('.dsh-panel-workspace-guidance') && /scrollbar-gutter:/.test(match[2])))
  assert.ok(rules.some(match => match[1].trim() === '.dsh-panel-workspace-guidance > .dsh-panel-workspace-tip' && /margin:\s*0\s*;/.test(match[2])))
})
