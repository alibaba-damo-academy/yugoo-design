import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { JSDOM } from 'jsdom'

// Real React Flow's controlled-node/measurement loop with synthetic DOM sizes.
// Browser re-entry checks are separate; this is not a screenshot substitute.
test('reference hub retains measured nodes and ports through hidden mount, re-entry and selection', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'getComputedStyle', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const observers = new Set(), frames = new Map()
  let frameId = 0
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      elements = new Set()
      constructor(callback) { this.callback = callback; observers.add(this) }
      observe(element) { this.elements.add(element) }
      unobserve(element) { this.elements.delete(element) }
      disconnect() { this.elements.clear(); observers.delete(this) }
    },
  })
  dom.window.DOMMatrixReadOnly = class { m22 = 1 }
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    offsetWidth: { get() { return this.classList.contains('react-flow__handle') ? 10
      : Number.parseFloat(this.style.width || this.firstElementChild?.style.width) || 248 } },
    offsetHeight: { get() { return this.classList.contains('react-flow__handle') ? 10
      : Number.parseFloat(this.style.height || this.firstElementChild?.style.height) || 180 } },
  })
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.window.DOMRect(0, 0, this.offsetWidth, this.offsetHeight)
  }
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { ReactFlowProvider, useStoreApi } = await import('@xyflow/react')
  const { ReferenceHub } = await import('../src/reference-hub-view.tsx')
  const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')
  const base = new URL('../../skills-web-app/bundles/ai_agent_capabilities/', import.meta.url)
  const manifest = parse(readFileSync(new URL('panel.yaml', base), 'utf8'))
  const data = JSON.parse(readFileSync(new URL('reference/preview.json', base), 'utf8'))
  const saved = structuredClone(data)
  const node = manifest.ui.children[0]
  let store, hidden = true, locale = 'zh-CN', selection = { section: 'agents', record: 'A-reading' }
  function ObserveStore() { store = useStoreApi(); return null }
  const root = createRoot(document.getElementById('root'))
  const render = () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(ObserveStore), React.createElement(PanelLocaleContext.Provider, { value: locale },
      React.createElement('section', { style: { visibility: hidden ? 'hidden' : 'visible' } },
        React.createElement(ReferenceHub, { node, manifest, read: source => data[source] ?? {},
          selected: selection, select: value => { selection = value; render() } })))))
  const measure = () => act(async () => {
    for (const observer of observers) {
      const elements = [...observer.elements].filter(element => element.classList.contains('react-flow__node'))
      if (elements.length) observer.callback(elements.map(target => ({ target, contentRect: target.getBoundingClientRect() })))
    }
  })
  const assertMeasured = label => {
    for (const node of store.getState().nodes) {
      const internal = store.getState().nodeLookup.get(node.id)
      assert.ok(internal.measured?.width > 0 && internal.measured?.height > 0, `${label}: ${node.id} keeps its measured dimensions`)
      assert.equal(document.querySelector(`[data-id='${node.id}']`).style.visibility, 'visible', `${label}: node is not stuck hidden`)
      if (node.type === 'hubCard') assert.equal(internal.internals.handleBounds?.source.length, 4, `${label}: real measured ports survive`)
    }
    assert.ok(document.querySelectorAll('.react-flow__edge').length > 0, `${label}: actual reference edges remain rendered`)
  }
  const button = label => [...document.querySelectorAll('button')].find(item => item.textContent === label)
  try {
    await act(async () => render())
    await measure(); assertMeasured('first measurement while mounted behind the form')
    hidden = false; await act(async () => render())
    assertMeasured('first reveal without another ResizeObserver delivery')
    const retainedCard = document.querySelector('.react-flow__node-hubCard')
    hidden = true; await act(async () => render())
    hidden = false; await act(async () => render())
    assertMeasured('same-size re-entry without another measurement')
    assert.equal(document.querySelector('.react-flow__node-hubCard'), retainedCard, 're-entry retains the mounted canvas rather than recreating it')
    selection = { section: 'agents', record: 'A-title' }; await act(async () => render())
    assertMeasured('record selection and new callback identities')
    locale = 'en-US'; await act(async () => render())
    assertMeasured('language change')
    const overviewIds = store.getState().nodes.map(node => node.id).sort()
    await act(async () => button('Internal view').click())
    await measure(); assertMeasured('internal view with its new annotation nodes')
    await act(async () => button('Overview').click())
    await measure(); assertMeasured('return to overview')
    assert.deepEqual(store.getState().nodes.map(node => node.id).sort(), overviewIds, 'obsolete internal-view records are pruned rather than retained as ghost nodes')
    assert.deepEqual(data, saved, 'measurement and navigation never write canonical facts')
  } finally {
    await act(async () => root.unmount())
    frames.clear(); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
