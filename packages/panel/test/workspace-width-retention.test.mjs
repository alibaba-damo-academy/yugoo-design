import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelWorkspaceCanvasToggle } = await import('../src/panel-workspace.tsx')

let width = 1030
const observers = new Set()
globalThis.ResizeObserver = class {
  targets = new Set()
  constructor(callback) { this.callback = callback; observers.add(this) }
  observe(target) { this.targets.add(target) }
  disconnect() { this.targets.clear(); observers.delete(this) }
}
const originalBounds = dom.window.HTMLElement.prototype.getBoundingClientRect
dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  return this.classList.contains('dsh-panel-workspace')
    ? { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 600, width, height: 600 }
    : originalBounds.call(this)
}

test('narrow workspace retains the same navigator, focused draft and saved column preference', async () => {
  const storageKey = 'dsh-panel-workspace:width-retention:sidebar-width'
  window.localStorage.setItem(storageKey, '460')
  const root = createRoot(document.getElementById('root'))
  let canvasOpen = 0
  let recordSelections = 0
  const resize = async next => React.act(async () => {
    width = next
    for (const observer of [...observers]) if ([...observer.targets].some(target => target.classList.contains('dsh-panel-workspace'))) observer.callback([])
  })
  try {
    await React.act(async () => root.render(React.createElement(PanelWorkspace, {
      autoSaveId: 'width-retention',
      sidebar: React.createElement(React.Fragment, null,
        React.createElement(PanelWorkspaceTree, { title: 'Records' },
          React.createElement(PanelWorkspaceTreeItem, { selected: true, onSelect: () => recordSelections++ }, 'Selected record')),
        React.createElement(PanelWorkspaceCanvasToggle, { label: 'Mind Map', onOpen: () => canvasOpen++ })),
    }, React.createElement('div', { className: 'dsh-panel-workspace-content' },
      React.createElement('textarea', { 'aria-label': 'Draft', defaultValue: 'Saved text' })))))
    const workspace = document.querySelector('.dsh-panel-workspace')
    const sidebar = document.querySelector('.dsh-panel-workspace-sidebar')
    const selection = sidebar.querySelector('[aria-current="page"]')
    const handle = document.querySelector('[role="separator"]')
    const draft = document.querySelector('textarea')
    const canvas = document.querySelector('[aria-label="Mind Map"]')
    draft.value = 'Unsubmitted user wording'
    draft.focus()
    assert.equal(handle.getAttribute('aria-valuenow'), '460')
    for (const [available, expected] of [[700, 299], [550, 160], [346, 160], [0, 160], [1030, 460]]) {
      await resize(available)
      assert.equal(handle.getAttribute('aria-valuenow'), String(expected))
      assert.equal(handle.hidden, false, 'the existing splitter is not replaced by another navigation mode')
      assert.equal(handle.tabIndex, 0)
      assert.equal(window.localStorage.getItem(storageKey), '460', 'automatic constraints never overwrite the chosen width')
      assert.equal(document.querySelector('.dsh-panel-workspace'), workspace)
      assert.equal(document.querySelector('.dsh-panel-workspace-sidebar'), sidebar)
      assert.equal(sidebar.querySelector('[aria-current="page"]'), selection)
      assert.equal(document.querySelector('textarea'), draft)
      assert.equal(draft.value, 'Unsubmitted user wording')
      assert.equal(document.activeElement, draft, 'view geometry does not steal editing focus')
      assert.equal(document.querySelector('[aria-label="Mind Map"]'), canvas)
    }
    await resize(346)
    await React.act(async () => {
      handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      handle.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
    })
    await React.act(async () => {
      window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 250, bubbles: true }))
      window.dispatchEvent(new window.Event('pointerup'))
    })
    assert.equal(window.localStorage.getItem(storageKey), '460', 'attempts beyond a temporary boundary also preserve the preference')
    await resize(1030)
    handle.focus()
    await React.act(async () => handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    assert.equal(handle.getAttribute('aria-valuenow'), '448')
    assert.equal(window.localStorage.getItem(storageKey), '448', 'an intentional usable resize updates the preference')
    await React.act(async () => canvas.click())
    assert.equal(canvasOpen, 1, 'the original canvas action remains reachable')
    assert.equal(recordSelections, 0, 'resizing never selects or writes a record')
    assert.equal(draft.value, 'Unsubmitted user wording')
  } finally {
    await React.act(async () => root.unmount())
    assert.equal(observers.size, 0)
    dom.window.close()
  }
})
