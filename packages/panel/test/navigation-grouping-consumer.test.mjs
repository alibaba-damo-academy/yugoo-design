import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { NavigationWorkspace } from '../src/navigation-workspace.tsx'
globalThis.React = React

test('derived frame selection uses projected inspector data without writing canonical state', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.Element = dom.window.Element
  globalThis.getComputedStyle = dom.window.getComputedStyle
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = clearTimeout
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root')), writes = []
  const binding = {
    grouping: { path: 'menu', target: 'item', label: 'category' },
    nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
    edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
    frames: { path: 'frames', label: 'name', members: 'items', position: 'point', size: 'size' },
  }
  const data = { items: { a: { name: 'Alpha' } }, order: ['a'], links: {}, menu: [{ item: 'a', category: 'Work' }] }
  const manifest = { sections: ['items', 'links', 'frames'].map(id => ({ id, title: id, create: { id_field: 'identity' } })) }
  let displayed
  try {
    await act(async () => root.render(React.createElement(NavigationWorkspace, {
      node: { id: 'map', component: 'navigation_workspace', navigation_map: binding }, manifest, data,
      options: { editable: true, onPanelUpdate: update => writes.push(update) },
      render: (section, id, options, projection) => {
        displayed = { section, id, projection }
        return React.createElement('button', { 'data-testid': 'rename', onClick: () => options.onPanelUpdate({
          frames: { ...projection.frames, [id]: { ...projection.frames[id], name: 'Renamed' } },
        }) }, projection[section][id].name)
      },
    })))
    assert.equal(writes.length, 0)
    const entry = [...document.querySelectorAll('button')].find(button => button.textContent === 'Work')
    assert.ok(entry, 'derived frame is selectable from actual sidebar')
    await act(async () => entry.click())
    assert.equal(displayed.section, 'frames')
    assert.equal(displayed.projection.frames[displayed.id].identity, displayed.id)
    assert.equal(writes.length, 0, 'selection alone must not materialize')
    await act(async () => document.querySelector('[data-testid="rename"]').click())
    assert.equal(writes.length, 1)
    assert.equal(writes[0].frames[displayed.id].name, 'Renamed')
    assert.equal(Object.hasOwn(data, 'frames'), false)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
