import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('same visual projection with a new DSL binding writes only the new field', async () => {
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
  let manifest = { version: 1, panel_kind: 'capability_map',
    sections: ['items', 'links', 'groups'].map(id => ({ id, title: id })), fields: [],
    ui: { id: 'map', component: 'navigation_workspace', navigation_map: {
      nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
      edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
      frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
    } },
  }
  let state = { items: { a: { name: 'Alpha' } }, links: {}, groups: {
    g: { name: 'Group', caption: 'Group', items: ['a'], point: { x: 0, y: 0 }, size: { width: 300, height: 300 } },
  } }
  let writes = 0, editable = true
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(renderManifest(manifest, state, { editable, locale: 'en-US',
    onPanelUpdate: updates => { writes++; state = applyPanelUpdatesToDraft(state, updates); show() },
  }))
  try {
    await act(async () => show())
    const oldInput = document.querySelector('.dsh-navigation-group-header input')
    assert.equal(oldInput.value, 'Group')
    // Immutable replacement, same component ID and identical projected values.
    // Mutating the old binding object would accidentally update captured closures.
    manifest = { ...manifest, ui: { ...manifest.ui, navigation_map: {
      ...manifest.ui.navigation_map, frames: { ...manifest.ui.navigation_map.frames, label: 'caption' },
    } } }
    await act(async () => show())
    const input = document.querySelector('.dsh-navigation-group-header input')
    assert.equal(input, oldInput, 'exercise reuse, not an unmount/remount workaround')
    assert.equal(writes, 0, 'changing a UI binding does not change design facts')
    await act(async () => {
      input.focus()
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'New caption')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => input.blur())
    assert.equal(writes, 1)
    assert.equal(state.groups.g.caption, 'New caption')
    assert.equal(state.groups.g.name, 'Group', 'old field must remain untouched')
    assert.deepEqual(state.groups.g.items, ['a'])
    const oldGroups = structuredClone(state.groups)
    state = { ...state, alternateGroups: structuredClone(state.groups) }
    manifest = { ...manifest, sections: [...manifest.sections, { id: 'alternateGroups', title: 'Alternate groups' }],
      ui: { ...manifest.ui, navigation_map: { ...manifest.ui.navigation_map,
        frames: { ...manifest.ui.navigation_map.frames, path: 'alternateGroups' },
      } } }
    await act(async () => show())
    await act(async () => {
      input.focus()
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'New section')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => input.blur())
    assert.equal(state.alternateGroups.g.caption, 'New section')
    assert.deepEqual(state.groups, oldGroups, 'section switch never modifies the previous section')
    assert.equal(writes, 2)
    editable = false
    manifest = { ...manifest, ui: { ...manifest.ui, navigation_map: { ...manifest.ui.navigation_map,
      frames: { ...manifest.ui.navigation_map.frames, label: 'name' },
    } } }
    await act(async () => show())
    assert.equal(input.disabled, true)
    await act(async () => document.querySelector('.dsh-navigation-group-header button').click())
    assert.equal(writes, 2, 'readonly remains authoritative after another binding switch')
    assert.deepEqual(state.groups, oldGroups)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
