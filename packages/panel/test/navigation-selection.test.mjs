import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('shared workspace routes two hotspots to one target with host context and clears stale arrivals', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const keys = ['window', 'document', 'DOMParser', 'HTMLElement', 'Element', 'getComputedStyle', 'ResizeObserver',
    'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, getComputedStyle: dom.window.getComputedStyle,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: callback => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true })
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  const binding = {
    nodes: { path: 'screens', order: 'order', label: 'name', position: 'point', artifact: 'file' },
    edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name', hotspot: 'hotspot', context: 'input' },
    frames: { path: 'groups', label: 'name', members: 'screens', position: 'point', size: 'size' },
  }
  const data = { screens: { list: { name: 'List', file: 'bundle/list.html' }, detail: { name: 'Detail', file: 'bundle/detail.html' } }, groups: {}, links: {
    first: { from: 'list', to: 'detail', hotspot: 'one', input: { selection: 'first' } },
    second: { from: 'list', to: 'detail', hotspot: 'two', input: { selection: 'second' } },
    back: { from: 'detail', to: 'list', hotspot: 'back' },
  } }
  const initial = structuredClone(data)
  const root = createRoot(document.getElementById('root'))
  let revision = 'r1', writes = 0, lastWrite, editable = true
  let read = async path => ({ found: true, content: path.endsWith('list.html')
    ? '<button data-prototype-id="one">One</button><button data-prototype-id="two">Two</button>'
    : '<h1>Detail</h1><button data-prototype-id="back">Back</button>' })
  const show = () => root.render(React.createElement(NavigationWorkspace, {
    node: { id: 'map', component: 'navigation_workspace', navigation_map: binding },
    manifest: { sections: ['screens', 'links', 'groups'].map(id => ({ id, title: id })) }, data,
    options: { skill: 'bundle', sourceRevision: revision, readArtifact: read, editable, onPanelUpdate: updates => { writes++; lastWrite = updates } },
    render: (section, id) => React.createElement('output', { 'data-selection': true }, `${section}:${id}`),
  }))
  const clickItem = async label => act(async () => {
    const button = [...document.querySelectorAll('.dsh-panel-workspace-tree-item')].find(item => item.textContent === label)
    assert.ok(button, label); button.click()
  })
  const frame = () => document.querySelector('.dsh-navigation-preview iframe')
  const config = iframe => JSON.parse(iframe.srcdoc.match(/const config=(\{.*?\});document/)[1])
  const context = () => {
    const doc = new dom.window.DOMParser().parseFromString(frame().srcdoc, 'text/html')
    const block = doc.getElementById('dsh-design-preview-context')
    return block ? JSON.parse(block.textContent) : undefined
  }
  const send = async (id, extra = {}, source = frame()?.contentWindow, channel = config(frame()).channel) => act(async () => {
    window.dispatchEvent(new dom.window.MessageEvent('message', { source, data: { type: 'design-preview:navigate', channel, id, ...extra } }))
  })
  try {
    await act(async () => show())
    await clickItem('List')
    assert.equal(document.querySelector('.dsh-workspace-cover-surface').style.visibility, 'hidden', 'sidebar selection enters the real preview directly')
    assert.ok(frame())
    const old = frame(), oldChannel = config(old).channel
    const geometry = async (issues, source = frame().contentWindow, channel = config(frame()).channel, extra = {}) => act(async () => {
      window.dispatchEvent(new dom.window.MessageEvent('message', { source, data: { type: 'design-preview:geometry', channel, issues, ...extra } }))
    })
    await geometry([], window)
    assert.equal(document.querySelector('.dsh-navigation-visual-check'), null, 'foreign geometry is rejected')
    await geometry([], frame().contentWindow, oldChannel, { arbitrary: true })
    assert.equal(document.querySelector('.dsh-navigation-visual-check'), null, 'extra geometry keys are rejected')
    await geometry([''])
    assert.equal(document.querySelector('.dsh-navigation-visual-check'), null, 'invalid issues are rejected')
    await geometry([])
    assert.ok(document.querySelector('.dsh-navigation-visual-check.is-pass'))

    await send('first', { context: { selection: 'second' } })
    assert.equal(frame().title, 'List', 'frame payload cannot choose context')
    await send('first', {}, window)
    assert.equal(frame().title, 'List', 'another window cannot navigate')
    await send('first')
    assert.equal(frame().title, 'Detail')
    assert.equal(document.querySelector('.dsh-navigation-visual-check'), null, 'new preview clears old geometry')
    await geometry(['body-empty'], old.contentWindow, oldChannel)
    assert.equal(document.querySelector('.dsh-navigation-visual-check'), null, 'stale frame/channel geometry is rejected')
    await geometry(['body-empty'])
    assert.ok(document.querySelector('.dsh-navigation-visual-check.is-fail'))
    assert.deepEqual(context(), { selection: 'first' })
    await send('second', {}, old.contentWindow, oldChannel)
    assert.deepEqual(context(), { selection: 'first' }, 'prior document cannot change current arrival')
    await send('back')
    assert.equal(frame().title, 'List')
    assert.equal(context(), undefined)
    await send('second')
    assert.deepEqual(context(), { selection: 'second' })
    await act(async () => document.querySelector('.dsh-navigation-preview [data-preview-refresh]').click())
    assert.equal(context(), undefined, 'explicit target document refresh clears arrival')
    assert.equal(document.querySelector('.dsh-navigation-visual-check'), null, 'refresh clears old geometry')
    await clickItem('List'); await send('second')
    await clickItem('Detail')
    assert.equal(context(), undefined, 'manual same-target selection clears arrival')
    await clickItem('List'); await send('second')
    revision = 'r2'; await act(async () => show())
    assert.equal(context(), undefined, 'new source revision clears arrival')
    await clickItem('List'); await send('first')
    binding.edges.context = 'other_input'; await act(async () => show())
    assert.equal(context(), undefined, 'replacement DSL binding clears arrival')
    binding.edges.context = 'input'; await act(async () => show())
    await clickItem('List'); await send('first')
    const previousReader = read
    read = path => previousReader(path)
    await act(async () => show())
    assert.equal(context(), undefined, 'replacement reader clears arrival even with same path/bytes')
    await clickItem('List')
    data.links.second.input = { selection: 1 }
    await act(async () => show())
    await send('second')
    assert.equal(frame().title, 'List', 'invalid context must not degrade to context-free navigation')
    assert.match(document.querySelector('[role="alert"]').textContent, /Invalid preview navigation context/)
    delete data.links.second.input
    await act(async () => show()); await send('second')
    assert.equal(frame().title, 'Detail', 'old context-free connections still work')
    assert.equal(context(), undefined)
    assert.equal(writes, 0, 'prototype navigation never saves canonical data')
    data.links.second.input = initial.links.second.input
    assert.deepEqual(data, initial)
    assert.equal(frame().getAttribute('sandbox'), 'allow-scripts')
    assert.match(frame().srcdoc, /connect-src 'none'/)
    await clickItem('List')
    const selector = document.querySelector('.dsh-navigation-binding-controls select')
    assert.equal(selector.options.length, 2, 'outgoing connections are available from the preview header')
    await act(async () => { selector.value = 'second'; selector.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    assert.equal(writes, 0, 'choosing a connection does not write')
    const pick = () => document.querySelector('.dsh-navigation-binding-controls button[aria-pressed]')
    await act(async () => pick().click())
    const pickedFrame = frame(), pickedChannel = config(frame()).channel
    const sendPick = async (source, channel) => act(async () => window.dispatchEvent(new dom.window.MessageEvent('message', {
      source, data: { type: 'design-preview:bind', channel, id: 'second', element: 'new-trigger', label: 'New trigger' },
    })))
    await sendPick(window, pickedChannel)
    assert.equal(writes, 0, 'foreign windows cannot bind')
    revision = 'r3'; await act(async () => show())
    await sendPick(pickedFrame.contentWindow, pickedChannel)
    assert.equal(writes, 0, 'old source revision cannot bind')
    await act(async () => pick().click())
    await sendPick(frame().contentWindow, config(frame()).channel)
    assert.equal(writes, 1)
    assert.equal(lastWrite.links.second.hotspot, 'new-trigger')
    assert.deepEqual(lastWrite.links.first, data.links.first, 'binding preserves sibling connection')
    assert.deepEqual(lastWrite.links.second.input, data.links.second.input, 'binding preserves host-resolved context')
    await act(async () => document.querySelector('.dsh-navigation-binding-controls button[aria-label]').click())
    assert.equal(writes, 2)
    assert.equal(lastWrite.links.second.hotspot, undefined)
    assert.equal(lastWrite.links.second.to, 'detail', 'unbind preserves navigation endpoint')
    editable = false; await act(async () => show())
    assert.ok(document.querySelector('.dsh-navigation-binding-controls select').disabled)
    assert.ok(pick().disabled)
    await act(async () => pick().click())
    assert.equal(writes, 2, 'readonly preview does not acquire binding authority')

  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const key of keys) {
      const descriptor = previous.get(key)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('navigation gestures are readonly; explicit frame creation preserves existing records', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  // A zero-sized JSDOM viewport makes D3's zoom interpolation undefined.
  // This fixture tests event/state behavior, not browser geometry.
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 600 },
  })
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    const hidden = this.style.display === 'none'
    return { x: 0, y: 0, left: 0, top: 0, right: hidden ? 0 : 800, bottom: hidden ? 0 : 600,
      width: hidden ? 0 : 800, height: hidden ? 0 : 600 }
  }
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
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  const { applyPanelUpdatesToDraft } = await import('../src/record-state.ts')
  const binding = {
    nodes: { path: 'items', order: 'order', label: 'name', position: 'point' },
    edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' },
    frames: { path: 'groups', label: 'name', members: 'items', position: 'point', size: 'size' },
  }
  let data = { items: { a: { name: 'Alpha' } }, links: {}, groups: {
    g: { name: 'Group', items: ['a'], point: { x: 0, y: 0 }, size: { width: 300, height: 300 } },
  } }
  const original = structuredClone(data)
  const root = createRoot(document.getElementById('root'))
  let writes = 0, editable = true
  const show = () => root.render(React.createElement(NavigationWorkspace, {
    node: { id: 'map', component: 'navigation_workspace', navigation_map: binding },
    manifest: { sections: ['items', 'links', 'groups'].map(id => ({ id, title: id })) }, data,
    options: { editable, onPanelUpdate: updates => { writes++; data = applyPanelUpdatesToDraft(data, updates); show() } },
    render: (section, id) => React.createElement('output', { 'data-selection': true }, `${section}:${id}`),
  }))
  const fire = async (selector, type) => {
    const element = document.querySelector(selector)
    assert.ok(element, selector)
    await act(async () => element.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true })))
  }
  try {
    // ReactFlow defers onInit: check the first committed render before its timer.
    act(() => show())
    const pendingAdd = [...document.querySelectorAll('.dsh-panel-workspace-tree-add')].find(button => button.textContent.includes('groups'))
    assert.ok(pendingAdd.disabled, 'uninitialized viewport must not offer frame creation')
    act(() => pendingAdd.click())
    assert.equal(writes, 0)
    editable = false
    await act(async () => show())
    await fire('[data-id="node:a"]', 'click')
    assert.equal(document.querySelector('[data-selection]').textContent, 'items:a')
    await fire('.react-flow__pane', 'click')
    assert.equal(document.querySelector('[data-selection]'), null)
    await fire('[data-id="node:a"]', 'dblclick')
    assert.notEqual(document.querySelector('.dsh-navigation-map').style.display, 'none', 'no artifact binding means no preview')
    binding.nodes = { ...binding.nodes, artifact: 'file', artifact_kind: 'page_html' }
    await act(async () => show())
    await fire('[data-id="frame:g"]', 'dblclick')
    assert.notEqual(document.querySelector('.dsh-workspace-cover-surface').style.visibility, 'hidden', 'frames never close the map to open artifact preview')
    await fire('[data-id="node:a"]', 'dblclick')
    assert.equal(document.querySelector('.dsh-navigation-preview-title strong').textContent, 'Alpha')
    assert.equal(document.querySelector('[data-selection]'), null, 'artifact preview is not a generic detail form')
    assert.equal(document.querySelector('.dsh-workspace-cover-surface').style.visibility, 'hidden', 'readonly users can inspect configured artifacts')
    assert.equal(writes, 0)
    assert.deepEqual(data, original)
    editable = true
    await act(async () => show())
    assert.equal(document.querySelector('.dsh-workspace-cover-surface').style.visibility, 'hidden')
    const hiddenAdd = document.querySelector('.dsh-navigation-map-cover > header button')
    assert.ok(hiddenAdd.disabled, 'cannot create a frame using a hidden canvas')
    await act(async () => hiddenAdd.click())
    assert.equal(writes, 0)
    // Return through the actual preview toggle, not a click on a hidden pane.
    await act(async () => document.querySelector('.dsh-navigation-map-toggle[aria-expanded="false"]').click())
    const add = document.querySelector('.dsh-navigation-map-cover > header button')
    assert.ok(add)
    assert.equal(add.disabled, false)
    await act(async () => add.click())
    assert.equal(writes, 1)
    assert.deepEqual(data.groups.g, original.groups.g)
    assert.deepEqual(data.items, original.items)
    assert.deepEqual(data.links, original.links)
    const created = Object.entries(data.groups).find(([id]) => id !== 'g')?.[1]
    assert.ok(created)
    assert.equal(created.name, '分组 2')
    assert.deepEqual(created.items, [])
    assert.deepEqual(created.size, { width: 500, height: 300 })
    assert.ok(Number.isFinite(created.point.x) && Number.isFinite(created.point.y))
    assert.notDeepEqual(created.point, { x: 0, y: 0 })
    binding.grouping = { path: 'menu', target: 'target', label: 'category' }
    data = { items: { a: { name: 'Alpha' }, b: { name: 'Beta' } }, links: {},
      menu: [{ target: 'a', category: 'Work' }, { target: 'b', category: 'Read' }] }
    await act(async () => show())
    assert.equal(Object.hasOwn(data, 'groups'), false)
    assert.equal(document.querySelectorAll('.dsh-navigation-group-header').length, 2)
    await act(async () => document.querySelector('.dsh-navigation-map-cover > header button').click())
    assert.equal(writes, 2)
    assert.deepEqual(Object.values(data.groups).map(group => group.name), ['Work', 'Read', '分组 3'])
    assert.deepEqual(Object.values(data.groups).map(group => group.items), [['a'], ['b'], []])
    data = { ...data, groups: {} }
    await act(async () => show())
    await act(async () => document.querySelector('.dsh-navigation-map-cover > header button').click())
    assert.equal(writes, 3)
    assert.equal(Object.keys(data.groups).length, 1, 'explicit empty frames do not revive old groups')
    assert.equal(Object.values(data.groups)[0].name, '分组 1')
    editable = false
    await act(async () => show())
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-add'), null, 'readonly cannot create records or frames')
    assert.equal(writes, 3)
  } finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
