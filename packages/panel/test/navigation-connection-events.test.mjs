import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('real connection handle clicks enforce current policy and permission', async () => {
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
  let pointed
  document.elementFromPoint = () => pointed
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
  let binding = {
    connection_policy: { allow_self: false, allow_parallel: false },
    nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
    edges: { path: 'links', order: 'linkOrder', source: 'from', target: 'to', label: 'name', new_label: '{source} to {target}' },
    frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
  }
  let data = { items: { a: { name: 'Alpha', file: 'a.html' }, b: { name: 'Beta' } },
    links: { ab: { from: 'a', to: 'b', name: 'Existing' } }, linkOrder: ['ab'], groups: {} }
  const original = structuredClone(data)
  let writes = 0, editable = true
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(React.createElement(NavigationWorkspace, {
    node: { id: 'map', component: 'navigation_workspace', navigation_map: binding },
    manifest: { sections: ['items', 'links', 'groups'].map(id => ({ id, title: id, ...(id === 'links' ? { order: 'linkOrder' } : {}) })) }, data,
    options: { editable, onPanelUpdate: updates => { writes++; data = applyPanelUpdatesToDraft(data, updates); show() } },
    render: () => React.createElement('div'),
  }))
  const click = async (id, type, port = 'right') => {
    pointed = document.querySelector(`[data-id="node:${id}"] .react-flow__handle.${type}[data-handlepos="${port}"]`)
    assert.ok(pointed)
    await act(async () => pointed.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
  }
  try {
    await act(async () => show())
    await click('a', 'source'); await click('a', 'target')
    await click('a', 'source', 'top'); await click('b', 'target', 'bottom')
    await click('a', 'source', 'right'); await click('a', 'source', 'left')
    await click('a', 'source', 'top'); await click('b', 'source', 'bottom')
    assert.equal(writes, 0, 'self and duplicate endpoints rejected even on different ports')
    // Each visible port is a source handle layered above its target handle.
    // A normal center hit therefore reaches source at both ends.
    await click('b', 'source'); await click('a', 'source')
    assert.equal(writes, 1, 'reverse relation is permitted through the visible port centers')
    assert.equal(Object.keys(data.links).length, 2)
    assert.equal(Object.values(data.links).find(edge => edge.from === 'b' && edge.to === 'a').name, 'Beta to Alpha',
      'real connection creation applies the explicit generic label contract')
    assert.equal(data.linkOrder.length, 2)
    assert.deepEqual(data.items, original.items)
    assert.deepEqual(data.links.ab, original.links.ab)
    binding = { ...binding, connection_policy: { allow_parallel: true, allow_self: true } }
    const { new_label, ...unlabeledEdges } = binding.edges
    binding.edges = unlabeledEdges
    await act(async () => show())
    await click('a', 'source'); await click('b', 'target')
    await click('a', 'source'); await click('a', 'target')
    assert.equal(writes, 3, 'generic declarations can permit both patterns')
    assert.ok(Object.values(data.links).filter(edge => edge.from === 'a').some(edge => !Object.hasOwn(edge, 'name')),
      'omitted label declaration does not synthesize a canonical name')
    await click('b', 'source')
    editable = false
    await act(async () => show())
    await click('b', 'target')
    assert.equal(writes, 3, 'readonly transition during connection blocks completion')
    editable = true
    await act(async () => show())
    await click('b', 'source')
    data = { ...data, items: { a: data.items.a } }
    await act(async () => show())
    await click('a', 'target')
    assert.equal(writes, 3, 'removed source cannot finish a pending connection')
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
