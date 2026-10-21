import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('shared preview closes fine tuning on execution lock and does not reopen it on unlock', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node']
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
  const adjust = () => container.querySelector('.dsh-preview-toolbar button[aria-expanded]')
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
