import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// Exercise the installed React Flow measurement/controlled-state loop, not a
// replacement edge renderer. Geometry is synthetic; this is not visual proof.
test('navigation retains measured handles across parent updates and resize delivery', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'getComputedStyle', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const observers = new Set(), raf = new Map()
  let rafId = 0, cardHeight = 228
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: callback => { raf.set(++rafId, callback); return rafId },
    cancelAnimationFrame: id => raf.delete(id),
    ResizeObserver: class {
      elements = new Set()
      constructor(callback) { this.callback = callback; observers.add(this) }
      observe(element) { this.elements.add(element) }
      unobserve(element) { this.elements.delete(element) }
      disconnect() { this.elements.clear(); observers.delete(this) }
    },
  })
  dom.window.DOMMatrixReadOnly = class { m22 = 1 }
  dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 80, height: 16 })
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    offsetWidth: { get() { return this.classList.contains('react-flow__handle') ? 10 : 206 } },
    offsetHeight: { get() { return this.classList.contains('react-flow__handle') ? 10 : cardHeight } },
  })
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return new dom.window.DOMRect(0, 0, this.offsetWidth, this.offsetHeight)
  }
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { ReactFlowProvider, useStoreApi } = await import('@xyflow/react')
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  let store
  function ObserveStore() { store = useStoreApi(); return null }
  const binding = {
    nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
    edges: { path: 'links', order: 'linkOrder', source: 'from', target: 'to', label: 'name' },
    frames: { path: 'frames', label: 'name', members: 'items', position: 'point', size: 'size' },
  }
  let data = { items: { a: { name: 'Alpha', point: { x: 0, y: 0 } }, b: { name: 'Beta', point: { x: 0, y: 350 } } },
    links: { ab: { from: 'a', to: 'b', name: 'Continues' } }, frames: {} }
  const root = createRoot(document.getElementById('root'))
  const render = () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(ObserveStore), React.createElement(NavigationWorkspace, {
      node: { id: 'map', component: 'navigation_workspace', navigation_map: binding },
      manifest: { sections: [] }, data,
      options: { editable: true, sourceRevision: 'same', onPanelUpdate: () => assert.fail('measurement must not write facts') },
      render: () => React.createElement('div'),
    })))
  const measure = async () => act(async () => {
    for (const observer of observers) {
      const nodes = [...observer.elements].filter(element => element.classList.contains('react-flow__node'))
      if (nodes.length) observer.callback(nodes.map(target => ({ target, contentRect: target.getBoundingClientRect() })))
    }
  })
  const assertMeasured = label => {
    for (const id of ['node:a', 'node:b']) {
      const node = store.getState().nodeLookup.get(id)
      assert.equal(node.measured.width, 206, label)
      assert.equal(node.measured.height, cardHeight, label)
      assert.equal(node.internals.handleBounds.source.length, 4, label)
      assert.equal(node.internals.handleBounds.target, null, 'four bidirectional ports have no overlapping hidden targets')
      assert.equal(store.getState().connectionMode, 'loose', 'incoming links resolve the same four measured ports')
    }
    assert.equal(document.querySelectorAll('.react-flow__edge').length, 1, label)
  }
  try {
    await act(async () => render())
    assert.equal(document.querySelectorAll('.react-flow__edge').length, 0, 'unmeasured nodes cannot supply an edge')
    await act(async () => render())
    assert.equal(document.querySelectorAll('.react-flow__edge').length, 0, 'parent render does not manufacture a measurement')
    await measure(); assertMeasured('initial measurement')
    await act(async () => render()); assertMeasured('new parent/options identities')
    data = { ...data, items: { ...data.items, a: { ...data.items.a, name: 'Renamed' } } }
    await act(async () => render()); assertMeasured('projection update keeps controlled measured state')
    cardHeight = 260
    await measure(); assertMeasured('changed size is written back to controlled nodes')
    await act(async () => render()); assertMeasured('subsequent parent render retains resized handles')
    data = { ...data, items: { ...data.items, a: { ...data.items.a, point: { x: 450, y: 350 } } } }
    await act(async () => render()); assertMeasured('controlled position update retains measured handles')
    assert.deepEqual(store.getState().nodeLookup.get('node:a').position, { x: 450, y: 350 })
    assert.equal(store.getState().edges[0].sourceHandle, 'left')
    // Negative control: emulate an outside caller discarding measurements.
    // This is explicitly NOT evidence that NavigationWorkspace does so.
    await act(async () => store.getState().setNodes(store.getState().nodes.map(node => {
      const { measured, ...withoutMeasurement } = node
      return withoutMeasurement
    })))
    assert.equal(store.getState().nodeLookup.get('node:a').internals.handleBounds, undefined)
    assert.equal(document.querySelectorAll('.react-flow__edge').length, 0, 'lost measurement blocks real edge rendering')
    await measure(); assertMeasured('observer measurement restores an intentionally cleared node')
  } finally {
    await act(async () => root.unmount())
    raf.clear(); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
