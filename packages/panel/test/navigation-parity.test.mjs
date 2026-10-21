import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

test('artifact navigation starts with whole-workspace map and preserves manual detail across hydration', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'DOMParser', 'getComputedStyle', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'React']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, DOMParser: dom.window.DOMParser, getComputedStyle: dom.window.getComputedStyle, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true })
  const { default: React, act } = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { NavigationWorkspace } = await import('../src/navigation-workspace.tsx')
  const binding = { nodes: { path: 'pages', label: 'name', order: 'order', position: 'point', artifact: 'file', artifact_kind: 'page_html' }, edges: { path: 'links', order: 'link_order', source: 'from', target: 'to', label: 'name' }, frames: { path: 'groups', label: 'name', members: 'pages', position: 'point', size: 'size' }, entry_ids: 'entries' }
  let data = { pages: {}, links: {}, groups: {}, entries: ['a'] }, writes = 0, editable = true
  const readArtifact = async path => ({ found: true, content: '<h1>' + path + '</h1>' })
  const root = createRoot(document.getElementById('root'))
  const show = () => root.render(React.createElement(NavigationWorkspace, { node: { id: 'pages', component: 'navigation_workspace', navigation_map: binding }, manifest: { sections: ['pages', 'links', 'groups'].map(id => ({ id, title: id })) }, data, options: { skill: 'pages', editable, onPanelUpdate: () => writes++, readArtifact }, render: (section, id) => React.createElement('output', { 'data-selection': true }, section + ':' + id) }))
  const click = async selector => act(async () => document.querySelector(selector).click())
  try {
    await act(async () => show())
    assert.ok(document.querySelector('.dsh-navigation-detail-header [role="status"]').textContent, 'empty detail has an explicit state')
    data = { ...data, pages: { a: { name: 'Alpha', file: 'pages/a.html' }, b: { name: 'Beta', file: 'pages/b.html' } } }
    await act(async () => show())
    assert.ok(document.querySelector('.dsh-workspace-cover-surface .dsh-navigation-map'))
    assert.ok(document.querySelector('.dsh-workspace-cover-base').hasAttribute('inert'))
    assert.ok(!document.querySelector('.dsh-navigation-inspector'))
    const mapElement = document.querySelector('.dsh-navigation-map')
    await click('.dsh-workspace-cover-return')
    await act(async () => [...document.querySelectorAll('.dsh-panel-workspace-tree-item')].find(el => el.getAttribute('aria-label') === 'Beta').click())
    assert.equal(document.querySelector('.dsh-navigation-preview iframe').title, 'Beta')
    const mapAction = document.querySelector('.dsh-navigation-map-toggle[aria-expanded="false"]')
    assert.ok(mapAction)
    assert.notEqual(mapAction.textContent, 'Preview', 'map action is not mislabeled as preview')
    data = { ...data, pages: { ...data.pages, b: { ...data.pages.b, name: 'Beta hydrated' } } }
    await act(async () => show())
    assert.equal(document.querySelector('.dsh-workspace-cover-surface').style.visibility, 'hidden', 'hydration does not reopen map')
    assert.equal(document.querySelector('.dsh-navigation-preview iframe').title, 'Beta hydrated')
    assert.equal(document.querySelector('.dsh-navigation-entry').disabled, false)
    await act(async () => [...document.querySelectorAll('.dsh-panel-workspace-tree-item')].find(el => el.getAttribute('aria-label') === 'Alpha').click())
    assert.equal(document.querySelector('.dsh-navigation-entry').disabled, true, 'last entry stays protected')
    editable = false; await act(async () => show())
    assert.equal(document.querySelector('.dsh-navigation-entry').disabled, true)
    await click('.dsh-navigation-map-toggle')
    assert.equal(document.querySelector('.dsh-navigation-map'), mapElement, 'map provider DOM identity survives closing and reopening')
    assert.ok(document.querySelector('.dsh-workspace-cover-surface .dsh-navigation-map'))
    await click('.dsh-workspace-cover-return')
    assert.equal(document.querySelector('.dsh-navigation-preview iframe').title, 'Alpha')
    assert.equal(writes, 0)
  } finally {
    await act(() => root.unmount()); dom.window.close()
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
})
