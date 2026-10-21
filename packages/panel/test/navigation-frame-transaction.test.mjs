import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

// Drive the callbacks registered with the installed ReactFlow store. Pointer
// geometry is deliberately not claimed here; the browser fixture is prepared, not run.
test('frame drag previews locally, commits once, cancels stale work and restores rejected writes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'getComputedStyle', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
    getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
  })
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { ReactFlowProvider, useStoreApi } = await import('@xyflow/react')
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
  let store
  function Observe() { store = useStoreApi(); return null }
  let binding = {
    nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
    edges: { path: 'links', order: 'linkOrder', source: 'from', target: 'to', label: 'name' },
    frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
  }
  let data = { items: { a: { name: 'Alpha', point: { x: 10, y: 20 }, file: 'a.html' }, b: { name: 'Other', point: { x: 800, y: 0 } } }, links: {},
    groups: { g: { name: 'Group', items: ['a', 'a'], point: { x: 0, y: 0 }, size: { width: 300, height: 300 } },
      other: { name: 'Overlapping membership', items: ['a'], point: { x: 700, y: 0 }, size: { width: 300, height: 300 } } } }
  const otherGroup = structuredClone(data.groups.other)
  let writes = 0, editable = true, revision = 'one', reject = false
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(React.createElement(ReactFlowProvider, null, React.createElement(Observe),
    React.createElement(NavigationWorkspace, {
      node: { id: 'map', component: 'navigation_workspace', navigation_map: binding }, manifest: { sections: [] }, data,
      options: { editable, sourceRevision: revision, onPanelUpdate: updates => {
        if (reject) throw Error('Rejected test transaction')
        writes++; data = applyPanelUpdatesToDraft(data, updates); show()
      } }, render: () => React.createElement('div'),
    })))
  const node = id => store.getState().nodes.find(node => node.id === id)
  const event = (name, position) => act(async () => {
    // XYDrag updates node positions before invoking onNodeDrag/onNodeDragStop.
    if (name !== 'onNodeDragStart') store.getState().onNodesChange([
      { type: 'position', id: 'frame:g', position, dragging: name === 'onNodeDrag' },
    ])
    const handler = store.getState()[name]
    assert.equal(typeof handler, 'function')
    handler({}, { ...node('frame:g'), position }, [])
  })
  try {
    await act(async () => show())
    await act(async () => store.getState().onNodesChange([{ type: 'select', id: 'frame:g', selected: true }]))
    assert.ok(store.getState().nodeLookup.get('frame:g').internals.z < store.getState().nodeLookup.get('node:a').internals.z,
      'selected background frame must stay behind its visible member card')
    await event('onNodeDragStart', { x: 0, y: 0 })
    await event('onNodeDrag', { x: 20, y: 30 })
    assert.deepEqual(node('node:a').position, { x: 30, y: 50 })
    assert.deepEqual(node('node:b').position, { x: 800, y: 0 })
    assert.equal(writes, 0)
    await event('onNodeDrag', { x: 40, y: 50 })
    assert.deepEqual(node('node:a').position, { x: 50, y: 70 })
    await event('onNodeDragStop', { x: 40, y: 50 })
    assert.equal(writes, 1)
    assert.deepEqual(data.items.a.point, { x: 50, y: 70 })
    assert.equal(data.items.a.file, 'a.html')
    assert.deepEqual(data.groups.other, otherGroup, 'duplicate/shared membership never moves a second frame')
    const saved = structuredClone(data)
    for (const cancel of ['revision', 'readonly', 'facts']) {
      editable = true
      await act(async () => show())
      await event('onNodeDragStart', { x: 40, y: 50 })
      await event('onNodeDrag', { x: 80, y: 90 })
      if (cancel === 'revision') revision = 'two'
      if (cancel === 'readonly') editable = false
      if (cancel === 'facts') data = { ...data, groups: { g: { ...data.groups.g, name: 'Changed elsewhere' } } }
      await act(async () => show())
      assert.deepEqual(node('node:a').position, saved.items.a.point)
      await event('onNodeDragStop', { x: 80, y: 90 })
      assert.equal(writes, 1, cancel)
      assert.deepEqual(data.items, saved.items)
      assert.deepEqual(node('frame:g').position, saved.groups.g.point)
    }
    editable = true; reject = true
    await act(async () => show())
    await event('onNodeDragStart', { x: 40, y: 50 })
    await event('onNodeDrag', { x: 80, y: 90 })
    await event('onNodeDragStop', { x: 80, y: 90 })
    assert.equal(writes, 1)
    assert.deepEqual(node('node:a').position, saved.items.a.point)
    assert.deepEqual(node('frame:g').position, saved.groups.g.point)
    assert.match(document.querySelector('[role=alert]').textContent, /Rejected test transaction/)
    reject = false
    const oldFrame = { ...node('frame:g'), data: { ...node('frame:g').data }, position: { x: 500, y: 600 } }
    await event('onNodeDragStart', { x: 40, y: 50 })
    data = { ...data, newItems: { g: { name: 'Not the old frame', point: { x: 7, y: 9 } } }, newGroups: {} }
    binding = { ...binding, nodes: { ...binding.nodes, path: 'newItems' }, frames: { ...binding.frames, path: 'newGroups' } }
    await act(async () => show())
    const rebound = structuredClone(data)
    await act(async () => store.getState().onNodeDragStop({}, oldFrame, []))
    assert.equal(writes, 1, 'old frame stop must not become a new node write after binding replacement')
    assert.deepEqual(data, rebound)
    const oldRecord = { ...node('node:g'), data: { ...node('node:g').data }, position: { x: 500, y: 600 } }
    await act(async () => store.getState().onNodeDragStart({}, oldRecord, []))
    binding = { ...binding, nodes: { ...binding.nodes, position: 'newPoint' } }
    await act(async () => show())
    await act(async () => store.getState().onNodeDragStop({}, oldRecord, []))
    assert.equal(writes, 1, 'old node stop cannot write through a replacement field binding')
    assert.deepEqual(data, rebound)
    const currentRecord = { ...node('node:g'), position: { x: 100, y: 80 } }
    await act(async () => store.getState().onNodeDragStart({}, currentRecord, []))
    await act(async () => store.getState().onNodeDragStop({}, currentRecord, []))
    assert.equal(writes, 2, 'a fresh gesture is still allowed after rebinding')
    assert.deepEqual(data.newItems.g.newPoint, { x: 100, y: 80 })
    assert.deepEqual(data.newItems.g.point, { x: 7, y: 9 })
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
