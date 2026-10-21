import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('frame header edits use one projected authority and readonly blocks writes', async () => {
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
  const { renderManifest } = await import('../src/interpreter.ts')
  const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
  const manifest = { version: 1, panel_kind: 'capability_map',
    sections: ['items', 'links', 'groups'].map(id => ({ id, title: id, create: { id_field: 'id' } })), fields: [],
    ui: { id: 'map', component: 'navigation_workspace', navigation_map: {
      grouping: { path: 'menu', target: 'target', label: 'category' },
      nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
      edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
      frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
    } },
  }
  let state = { items: { a: { name: 'Alpha', file: 'a.html' }, b: { name: 'Beta', file: 'b.html' } }, links: {},
    menu: [{ target: 'a', category: 'Work' }, { target: 'b', category: 'Read' }] }
  const original = structuredClone(state)
  let writes = 0, editable = true, reject = false
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(manifest, state, { editable, locale: 'en-US',
    onPanelUpdate: updates => {
      if (reject) throw new Error('Test validation rejected the edit')
      writes++; state = applyPanelUpdatesToDraft(state, updates); show()
    },
  }))
  const input = () => document.querySelector('.dsh-navigation-group-header input')
  const edit = async value => act(async () => {
    input().focus()
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input(), value)
    input().dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await act(async () => show())
    assert.equal(input().getAttribute('aria-label'), 'Group name')
    assert.equal(document.querySelector('.dsh-navigation-group-header span').textContent, 'Records: 1')
    assert.equal(writes, 0); assert.equal(Object.hasOwn(state, 'groups'), false)
    await edit('Cancelled')
    await act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(input().value, 'Work'); assert.equal(writes, 0)
    await edit('  '); await act(async () => input().blur())
    assert.equal(input().value, 'Work'); assert.equal(writes, 0)
    await edit('  Renamed  ')
    await act(async () => input().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    assert.equal(writes, 1); assert.equal(input().value, 'Renamed')
    assert.equal(Object.keys(state.groups).length, 2)
    assert.deepEqual(Object.values(state.groups).map(group => group.name), ['Renamed', 'Read'])
    await edit('Blur commit'); await act(async () => input().blur())
    assert.equal(writes, 2); assert.equal(input().value, 'Blur commit')
    await edit('Must not save'); editable = false; await act(async () => show())
    await act(async () => input().blur())
    assert.equal(writes, 2)
    assert.ok(input().disabled)
    const remove = document.querySelector('.dsh-navigation-group-header button')
    assert.ok(remove.disabled); await act(async () => remove.click()); assert.equal(writes, 2)
    editable = true; await act(async () => show())
    assert.equal(input().value, 'Blur commit', 'readonly transition discards the uncommitted title')
    await act(async () => { input().focus(); input().blur() })
    assert.equal(writes, 2, 're-enabling must not submit an old draft')
    const beforeRejection = structuredClone(state)
    reject = true
    await edit('Rejected title'); await act(async () => input().blur())
    assert.deepEqual(state, beforeRejection); assert.equal(writes, 2)
    assert.match(document.querySelector('.dsh-navigation-inspector [role="alert"]').textContent, /validation rejected/)
    reject = false
    await edit('Accepted title'); await act(async () => input().blur())
    assert.equal(writes, 3)
    assert.equal(document.querySelector('.dsh-navigation-inspector [role="alert"]'), null)
    const beforeDelete = structuredClone(state)
    reject = true
    await act(async () => document.querySelector('.dsh-navigation-group-header button').click())
    assert.deepEqual(state, beforeDelete); assert.equal(writes, 3)
    assert.match(document.querySelector('.dsh-navigation-inspector [role="alert"]').textContent, /validation rejected/)
    reject = false
    await act(async () => document.querySelector('.dsh-navigation-group-header button').click())
    assert.equal(writes, 4)
    assert.equal(document.querySelector('.dsh-navigation-inspector [role="alert"]'), null)
    assert.deepEqual(Object.values(state.groups).map(group => group.name), ['Read'])
    assert.deepEqual(state.items, original.items); assert.deepEqual(state.menu, original.menu)
    assert.deepEqual(state.links, original.links)
    state = JSON.parse(JSON.stringify(state)); await act(async () => show())
    assert.equal(document.querySelectorAll('.dsh-navigation-group-header').length, 1)
    await act(async () => document.querySelector('.dsh-navigation-group-header button').click())
    assert.deepEqual(state.groups, {})
    state = JSON.parse(JSON.stringify(state)); await act(async () => show())
    assert.equal(document.querySelectorAll('.dsh-navigation-group-header').length, 0)
    assert.deepEqual(state.items, original.items)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
