import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) return { url: 'data:text/javascript,export {}', shortCircuit: true }
  if (specifier === 'dsh-design-panel/client-api') return nextResolve(new URL('../panel/src/client-api.ts', import.meta.url).href, context)
  return nextResolve(specifier, context)
} })
const { register } = await import('tsx/esm/api')
register()
globalThis.React = React
globalThis.DOMParser = new JSDOM('').window.DOMParser
const { PagePreview, PageThumbnail } = await import('./src/client/ported/design/PageDesignPanel/PagePreview.tsx')
const page = { id: 'welcome', name: 'Welcome', html: '<html><head></head><body style="color:var(--ds-text-9)">Welcome</body></html>' }
const css = ':root{--ds-text-9:#123456;--ds-font-main:Arial}\n@media(max-width:600px){:root{--ds-text-9:#654321}}'
function documentFor(Component, styleCss, extra = {}) {
  const dom = new JSDOM(renderToStaticMarkup(React.createElement(Component, { page, styleCss, ...extra })))
  const frame = dom.window.document.querySelector('iframe')
  const doc = frame ? new JSDOM(frame.getAttribute('srcdoc')).window.document : null
  dom.window.close()
  return doc
}
for (const Component of [PagePreview, PageThumbnail]) {
  assert.equal(documentFor(Component, undefined), null, 'do not show an unstyled page while CSS is unavailable')
  const doc = documentFor(Component, css)
  assert.ok(doc)
  const injected = doc.querySelector('#page-design-host-vars').textContent
  assert.ok(injected.startsWith(css), 'use whole landed stylesheet, including media rules and non-legacy token names')
  assert.ok(!injected.includes('--ds-primary:'), 'no guessed JSON/default projection')
  doc.defaultView.close()
  const updated = documentFor(Component, css.replace('#123456', '#abcdef'))
  assert.match(updated.querySelector('#page-design-host-vars').textContent, /#abcdef/)
  updated.defaultView.close()
  const hostile = documentFor(Component, css + '</style><script id="css-injection">bad()</script>')
  assert.equal(hostile.querySelector('#css-injection'), null, 'CSS cannot break out of the inline style element')
  assert.ok(hostile.querySelector('meta[http-equiv="Content-Security-Policy"]'))
  hostile.defaultView.close()
}
console.log('PAGE STYLE FILE PREVIEWS OK')

const contextId = 'dsh-design-preview-context'
for (const item_id of ['one', 'two', '</script><img src=x>']) {
  const doc = documentFor(PagePreview, css, { arrivalContext: { item_id } })
  const block = doc.getElementById(contextId)
  assert.equal(block.type, 'application/json')
  assert.deepEqual(JSON.parse(block.textContent), { item_id })
  assert.equal(doc.querySelector('img'), null, 'selection cannot break out as markup')
  doc.defaultView.close()
}
const noArrival = documentFor(PagePreview, css)
assert.equal(noArrival.getElementById(contextId), null, 'manual or legacy navigation has no invented selection')
noArrival.defaultView.close()
const thumbnail = documentFor(PageThumbnail, css, { arrivalContext: { item_id: 'one' } })
assert.equal(thumbnail.getElementById(contextId), null, 'thumbnails never inherit arrival')
thumbnail.defaultView.close()
for (const html of [`<div id="${contextId}"></div>`, `<template><template><div id="${contextId}"></div></template></template>`]) {
  for (const Component of [PagePreview, PageThumbnail]) {
    const view = new JSDOM(renderToStaticMarkup(React.createElement(Component, { page: { ...page, html }, styleCss: css })))
    assert.match(view.window.document.querySelector('[role="alert"]').textContent, /reserved id/)
    assert.equal(view.window.document.querySelector('iframe'), null, 'reject locally without rendering the artifact or crashing the panel')
    view.window.close()
  }
}

// Real native panel interaction: two canonical card edges, one shared detail page.
const { act } = React
const { createRoot } = await import('react-dom/client')
const { PageDesignPanel } = await import('./src/client/ported/design/PageDesignPanel/PageDesignPanel.tsx')
const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.AbortController = dom.window.AbortController
globalThis.AbortSignal = dom.window.AbortSignal
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
// Layout is outside this interaction smoke; keep the actual map component mounted.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root'))
const listHtml = '<html><body><button data-prototype-id="one">One</button><button data-prototype-id="two">Two</button></body></html>'
const detailHtml = '<html><body><main id="selection">Choose an item</main><script>var c=document.getElementById("dsh-design-preview-context");if(c)document.getElementById("selection").textContent=JSON.parse(c.textContent).item_id;</script></body></html>'
let data = {
  pages: { list: { id: 'list', name: 'List', html: listHtml }, detail: { id: 'detail', name: 'Detail', html: detailHtml } },
  page_order: ['list', 'detail'],
  connections: {
    one: { id: 'one', source_page_id: 'list', target_page_id: 'detail', source_element_id: 'one', preview_context: { item_id: 'one' } },
    two: { id: 'two', source_page_id: 'list', target_page_id: 'detail', source_element_id: 'two', preview_context: { item_id: 'two' } },
  },
}
let identity = {}
let edits = 0
const render = () => act(async () => root.render(React.createElement(PageDesignPanel, { data, styleCss: css, previewResetIdentity: identity, onChange: () => edits++ })))
const frame = () => document.querySelector('iframe[title$=" preview"]')
const send = (payload, source = frame().contentWindow) => act(async () => window.dispatchEvent(new window.MessageEvent('message', { source, data: payload })))
const navigate = id => send({ source: 'page-design-prototype', type: 'navigate', connectionId: id })
const back = () => send({ source: 'page-design-prototype', type: 'navigate-page', pageId: 'list' })
function selection() {
  const child = new JSDOM(frame().getAttribute('srcdoc'), { runScripts: 'dangerously', beforeParse(win) { win.requestAnimationFrame = () => 0 } })
  const value = child.window.document.getElementById('selection')?.textContent
  child.window.close()
  return value
}
try {
  await render()
  await navigate('one')
  assert.equal(selection(), 'one')
  await navigate('two')
  assert.equal(selection(), 'one', 'a detail page cannot use a list edge')
  await back()
  await navigate('two')
  assert.equal(selection(), 'two', 'the second card reuses the same detail page with its own identity')
  await send({ source: 'page-design-prototype', type: 'navigate-page', pageId: 'detail' })
  assert.equal(selection(), 'Choose an item', 'direct page navigation clears arrival even on the same page')
  await back(); await navigate('one')
  identity = {}; await render()
  assert.equal(selection(), 'Choose an item', 'reader/revision reset clears arrival before preview')
  await back(); await navigate('two')
  data = { ...data }; await render()
  assert.equal(selection(), 'Choose an item', 'canonical refresh revokes arrival')
  await back(); await navigate('one')
  const mapButton = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-expanded') !== null)
  await act(async () => mapButton.click())
  assert.equal(selection(), 'Choose an item', 'returning to the map clears selection')
  await back()
  const oldWindow = frame().contentWindow
  identity = {}; await render()
  assert.notEqual(frame().contentWindow, oldWindow, 'a reader reset replaces the iframe even without an arrival context')
  await send({ source: 'page-design-prototype', type: 'navigate', connectionId: 'one' }, oldWindow)
  assert.equal(frame().title, 'List preview', 'queued messages from the old WindowProxy cannot navigate the new generation')
  const oldListWindow = frame().contentWindow
  await navigate('one')
  assert.notEqual(frame().contentWindow, oldListWindow, 'navigation creates a distinct document/frame generation')
  await send({ source: 'page-design-prototype', type: 'navigate-page', pageId: 'list' }, oldListWindow)
  assert.equal(frame().title, 'Detail preview', 'old frame messages are rejected after srcDoc navigation')
  await back()
  data = { ...data, connections: { ...data.connections, one: { ...data.connections.one, preview_context: { item_id: 7 } } } }
  await render(); await navigate('one')
  assert.equal(frame().title, 'List preview', 'invalid explicit context is not silently navigated without selection')
  assert.match(document.querySelector('[role="alert"]').textContent, /Invalid preview navigation context/)
  assert.equal(edits, 0, 'preview navigation never persists selection into design facts')
} finally {
  await act(async () => root.unmount())
  dom.window.close()
}
console.log('NATIVE PAGE ARRIVAL AND REVOCATION OK')
