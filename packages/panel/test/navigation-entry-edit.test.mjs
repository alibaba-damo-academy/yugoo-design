import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('real interpreter form rename materializes derived frames, then empty survives rerender', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Element = dom.window.Element
  globalThis.getComputedStyle = dom.window.getComputedStyle
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderManifest } = await import('../src/interpreter.ts')
  const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
  const manifest = { version: 1, panel_kind: 'capability_map',
    sections: ['items', 'links', 'groups'].map(id => ({ id, title: id, create: { id_field: 'id' } })),
    fields: [{ key: 'name', label: 'Name', control: 'text', applies_to: ['groups'] }],
    ui: { id: 'map', component: 'navigation_workspace', navigation_map: {
      grouping: { path: 'menu', target: 'target', label: 'category' },
      nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
      edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
      frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
    } },
  }
  let state = { items: { a: { name: 'Alpha' }, b: { name: 'Beta' } }, links: {},
    menu: [{ target: 'a', category: 'Derived work group' }, { target: 'b', category: 'Untouched group' }] }
  let writes = 0
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(manifest, state, { editable: true, locale: 'en-US',
    onPanelUpdate: updates => { writes++; state = applyPanelUpdatesToDraft(state, updates) },
  }))
  try {
    await act(async () => show())
    const button = [...document.querySelectorAll('button')].find(button => button.textContent === 'Derived work group')
    assert.ok(button)
    await act(async () => button.click())
    assert.equal(writes, 0)
    const input = document.querySelector('.dsh-navigation-inspector [data-field="name"] input')
    assert.ok(input, 'real record form, not a custom renderer substitute')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Renamed group')
    await act(async () => input.dispatchEvent(new dom.window.Event('input', { bubbles: true })))
    assert.equal(writes, 1)
    const frames = Object.values(state.groups)
    assert.equal(frames.length, 2); assert.equal(frames[0].name, 'Renamed group')
    assert.ok(frames[0].id); assert.deepEqual(frames[0].items, ['a'])
    assert.equal(frames[1].name, 'Untouched group'); assert.deepEqual(frames[1].items, ['b'])
    assert.ok(frames[1].id); assert.ok(frames[1].point); assert.ok(frames[1].size)
    assert.equal(state.menu[0].category, 'Derived work group')
    state = JSON.parse(JSON.stringify(state)); await act(async () => show())
    assert.ok([...document.querySelectorAll('button')].some(button => button.textContent === 'Renamed group'))
    assert.ok([...document.querySelectorAll('button')].some(button => button.textContent === 'Untouched group'))
    state = { ...state, groups: {} }; await act(async () => show())
    assert.ok(![...document.querySelectorAll('button')].some(button => button.textContent === 'Derived work group'))
    assert.equal(writes, 1)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
