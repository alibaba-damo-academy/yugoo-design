import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const domKeys = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLSelectElement', 'HTMLTextAreaElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'DOMParser', 'Event', 'getComputedStyle']

test('shared preview closes fine tuning on execution lock and does not reopen it on unlock', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  const keys = domKeys
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  const previousReact = globalThis.React, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  for (const key of keys) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { PreviewWorkspace } = await import('../src/preview-workspace.tsx')
  const container = document.getElementById('root'), root = createRoot(container)
  const node = { component: 'preview_workspace', id: 'preview', live_preview: {
    file_path: 'preview.path', tokens: [], restore_paths: ['config.color'], swatch_paths: ['config.color'],
    presets: [{ id: 'blue', title: 'Blue', description: 'A blue palette', values: { 'config.color': '#00f' } }],
  } }
  let data = { config: { color: '#fff' } }
  const original = structuredClone(data), applied = []
  let updates = 0, saves = 0
  const options = { editable: true, onPanelUpdate: value => { updates++; applied.push(value) }, onSaveAndContinue: () => saves++ }
  const render = value => React.act(async () => root.render(React.createElement(PreviewWorkspace, {
    node, data, options: value,
  }, React.createElement('input', { 'aria-label': 'Fine tuning control' }))))
  const adjust = () => container.querySelector('.dsh-preview-toolbar button[aria-expanded]:not([role="combobox"])')
  const sheet = () => container.querySelector('.dsh-preview-adjustments')
  try {
    await render(options)
    assert.ok(container.querySelector('.dsh-panel-workspace-sidebar .dsh-panel-workspace-tree > header'))
    const preset = () => container.querySelector('button[aria-label="Blue"]')
    assert.equal(preset().getAttribute('aria-pressed'), 'false')
    assert.equal(preset().hasAttribute('aria-current'), false, 'applying a palette is not navigation')
    assert.match(preset().textContent, /A blue palette/)
    assert.ok(preset().querySelector('.dsh-preview-swatches'))
    await React.act(async () => preset().click())
    assert.deepEqual(applied.pop(), { 'config.color': '#00f' })
    data = { config: { color: '#00f' } }; await render(options)
    assert.equal(preset().getAttribute('aria-pressed'), 'true')
    await React.act(async () => container.querySelector('.dsh-panel-workspace-choice').click())
    assert.deepEqual(applied.pop(), { 'config.color': '#fff' }, 'original palette survives updates')
    data = structuredClone(original); await render(options)
    assert.equal(adjust().disabled, false)
    await React.act(async () => adjust().click())
    assert.ok(sheet())
    assert.equal(adjust().getAttribute('aria-expanded'), 'true')
    await render({ ...options, editable: false })
    assert.equal(preset().disabled, true)
    await React.act(async () => preset().click())
    assert.equal(sheet(), null)
    assert.equal(adjust().disabled, true)
    assert.equal(adjust().getAttribute('aria-expanded'), 'false')
    await React.act(async () => adjust().click())
    assert.equal(sheet(), null, 'locked button cannot expose editing controls')
    await render(options)
    assert.equal(sheet(), null, 'unlock does not revive the previously open sheet')
    await React.act(async () => adjust().click())
    assert.ok(sheet())
    await render({ editable: true })
    assert.equal(adjust(), null, 'native read-only adapter has no tuning action without an update handler')
    assert.equal(sheet(), null)
    await render(options)
    assert.equal(sheet(), null)
    assert.deepEqual(data, original)
    assert.equal(updates, 2, 'only the explicit palette and restore actions write')
    assert.equal(saves, 0)
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const key of keys) {
      if (previous[key] === undefined) delete globalThis[key]
      else globalThis[key] = previous[key]
    }
    if (previousReact === undefined) delete globalThis.React; else globalThis.React = previousReact
    if (previousAct === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT; else globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})

for (const kind of ['style', 'navigation']) test(`${kind} preview size remains a readable view choice without remounting the document or writing the draft`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://preview.test/', pretendToBeVisual: true })
  const keys = [...domKeys, 'ResizeObserver', 'React', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = Object.fromEntries(keys.map(key => [key, globalThis[key]]))
  for (const key of domKeys) globalThis[key] = dom.window[key]
  let width = 706
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get() { return this.classList.contains('dsh-live-preview') ? width : 0 } })
  dom.window.HTMLElement.prototype.scrollIntoView = function() {}
  const observers = []
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; observers.push(this) } observe(element) { this.element = element } disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { readFileSync } = await import('node:fs')
  const { PreviewWorkspace } = await import('../src/preview-workspace.tsx')
  const { NavigationPreview } = await import('../src/navigation-preview.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const css = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  const sheet = document.createElement('style')
  sheet.textContent = [...css.matchAll(/\.dsh-live-preview(?:\[[^\]]+\])?\s*\{[^}]+\}/g)].map(match => match[0]).join('\n')
  document.head.append(sheet)
  const root = createRoot(document.getElementById('root'))
  const node = { component: 'preview_workspace', id: 'preview', live_preview: { file_path: 'file', design_width: 1280, tokens: [] } }
  const data = { file: 'bundle/example.html', config: { color: '#456789' } }, original = structuredClone(data)
  let reads = 0, writes = 0, resets = 0
  const options = { skill: 'bundle', editable: true, readArtifact: async () => { reads++; return { found: true, content: '<style>body { color:#456789 }</style><input value="Local prototype input"><div style="width:1280px">Far edge</div>' } }, onPanelUpdate: () => writes++ }
  const context = { selection: 'req-001' }
  const toolbar = kind === 'style' ? '.dsh-preview-toolbar' : '.dsh-navigation-preview-actions'
  const paint = (locale = 'en-US', editable = true) => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, kind === 'style'
    ? React.createElement(PreviewWorkspace, { node, data, options: { ...options, editable } })
    : React.createElement(NavigationPreview, { title: 'Request detail', recordId: 'detail', artifactId: 'detail', path: data.file,
      navigationContext: context, onNavigationReset: () => resets++, actions: React.createElement('button', { type: 'button' }, 'Details'), options: { ...options, editable } }))))
  const choose = async label => {
    const trigger = document.querySelector(`${toolbar} [role="combobox"]`)
    await React.act(async () => { trigger.focus(); trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    const option = [...document.querySelectorAll('[role="option"]')].find(item => item.textContent === label)
    assert.ok(option, `reading option ${label} is discoverable`)
    await React.act(async () => option.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  }
  try {
    await paint()
    assert.equal(document.querySelectorAll(`${toolbar} [role="combobox"]`).length, 1, 'the reading size entry is in the existing toolbar')
    const reader = document.querySelector('.dsh-live-preview'), frame = reader.querySelector('iframe'), html = frame.srcdoc, windowIdentity = frame.contentWindow
    // JSDOM does not run srcdoc: frame-owned input/scroll values prove retention, not real browser form or scrolling behavior.
    const input = frame.contentDocument.createElement('textarea')
    input.value = 'Retain this local input'; frame.contentDocument.body.append(input)
    frame.contentDocument.documentElement.scrollTop = 57
    if (kind === 'navigation') assert.match(html, /"selection":"req-001"/, 'the actual incoming selection stays in the existing document')
    assert.equal(frame.style.transform, `scale(${706 / 1280})`)
    await choose('Actual size (100%)')
    assert.equal(frame.style.transform, 'scale(1)')
    assert.equal(frame.style.width, '1280px', 'actual size keeps the original design viewport even in a narrow panel')
    assert.equal(getComputedStyle(reader).overflowX, 'auto', 'the same reading region exposes horizontal overflow')
    assert.equal(reader.tabIndex, 0, 'keyboard users can reach the scroll region')
    reader.scrollLeft = 574
    await paint('zh-CN', false)
    assert.match(document.querySelector(`${toolbar} [role="combobox"]`).textContent, /原尺寸/)
    assert.equal(document.querySelector(`${toolbar} [role="combobox"]`).disabled, false, 'readonly permits reading choices')
    assert.equal(reader.scrollLeft, 574)
    width = 800
    await React.act(async () => observers.find(observer => observer.element === reader).callback())
    assert.equal(frame.style.transform, 'scale(1)', 'resize cannot override the explicit actual-size choice')
    await choose('适应宽度')
    assert.equal(frame.style.transform, 'scale(0.625)')
    assert.equal(reader.scrollLeft, 0, 'fit returns to the document left edge')
    assert.equal(document.querySelector('iframe') === frame, true)
    assert.equal(frame.contentWindow === windowIdentity, true)
    assert.equal(frame.srcdoc, html, 'reading controls do not reload the prototype or replace its content')
    assert.equal(input.value, 'Retain this local input')
    assert.equal(frame.contentDocument.documentElement.scrollTop, 57)
    assert.deepEqual([...document.querySelectorAll(`${toolbar} button:not([role="combobox"])`)].map(button => button.textContent), kind === 'style' ? ['刷新', '微调设置'] : ['Details', '刷新'], 'existing actions retain their relative order')
    assert.equal(reads, 1)
    assert.equal(writes, 0)
    assert.equal(resets, 0, 'reading size does not reset the selected arrival')
    assert.deepEqual(data, original)
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const key of keys) { if (previous[key] === undefined) delete globalThis[key]; else globalThis[key] = previous[key] }
  }
})
