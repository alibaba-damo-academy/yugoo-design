import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { previewNavigationTarget, previewNavigationMarkup, previewHotspotSelection } = await import('../src/preview-navigation.ts')
const links = [{ id: 'open', element: 'button', target: 'detail' }]
const { validatePreviewNavigationContext, previewNavigationContextMarkup, PREVIEW_CONTEXT_ELEMENT_ID } = await import('../src/preview-navigation-context.ts')
const { previewNavigation } = await import('../src/preview-navigation.ts')

test('host-selected context is bounded, immutable and cannot be supplied by the frame', () => {
  const context = validatePreviewNavigationContext({ selection: 'second' })
  assert.equal(Object.getPrototypeOf(context), null)
  assert.ok(Object.isFrozen(context))
  const message = { type: 'design-preview:navigate', channel: 'current', id: 'open' }
  assert.equal(previewNavigation(message, 'current', [{ ...links[0], context }]).context.selection, 'second')
  assert.equal(previewNavigation({ ...message, context: { selection: 'first' } }, 'current', [{ ...links[0], context }]), undefined)
  for (const invalid of [null, [], { selection: 1 }, { selection: {} }, { selection: 'x'.repeat(257) },
    JSON.parse('{"__proto__":"bad"}'), { constructor: 'bad' }, { prototype: 'bad' },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`k${i}`, 'x'])),
    Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, '中'.repeat(256)]))]) {
    assert.throws(() => validatePreviewNavigationContext(invalid), /Invalid preview navigation context/)
  }
  assert.throws(() => previewNavigation(message, 'current', [{ ...links[0], contextError: 'Bad canonical context' }]), /Bad canonical context/)
})

test('both source choices drive the same artifact through a unique inert context block', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('')
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
  globalThis.DOMParser = dom.window.DOMParser
  const artifact = '<h1 id="selected"></h1><script>const ctx=JSON.parse(document.getElementById("dsh-design-preview-context").textContent);document.getElementById("selected").textContent=ctx.selection;</script>'
  try {
    for (const selection of ['first', 'second', '</script><script>throw Error("injection")</script>']) {
      const markup = previewNavigationContextMarkup(artifact, { selection })
      assert.equal(markup.match(/<\/script>/g).length, 1)
      const frame = new JSDOM(`<!doctype html><head>${markup}</head><body>${artifact}</body>`, { runScripts: 'dangerously' })
      assert.equal(frame.window.document.getElementById('selected').textContent, selection)
      assert.equal(frame.window.document.querySelectorAll(`#${PREVIEW_CONTEXT_ELEMENT_ID}`).length, 1)
      frame.window.close()
    }
    assert.equal(previewNavigationContextMarkup('<p>Legacy</p>'), '')
    for (const html of [`<p id="${PREVIEW_CONTEXT_ELEMENT_ID}">spoof</p>`, `<template><p id="${PREVIEW_CONTEXT_ELEMENT_ID}">spoof</p></template>`]) {
      assert.throws(() => previewNavigationContextMarkup(html, { selection: 'first' }), /reserved id/)
    }
  } finally {
    dom.window.close()
    if (previous) Object.defineProperty(globalThis, 'DOMParser', previous)
    else delete globalThis.DOMParser
  }
})
test('real preview document generation replaces the iframe, while variable and image patches retain it', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const names = ['window', 'document', 'DOMParser', 'ResizeObserver', 'React', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const { default: React, act } = await import('react')
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser,
    ResizeObserver: class { observe() {} disconnect() {} }, React, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const { LivePreview } = await import('../src/live-preview.tsx')
  const root = createRoot(document.getElementById('root'))
  const html = '<style>body{color:red}</style><img src="asset.png"><button data-prototype-id="button">Open</button>'
  const render = props => act(async () => root.render(React.createElement(LivePreview, { html, title: 'Preview', variables: {}, links, ...props })))
  try {
    await render({})
    const original = document.querySelector('iframe'), originalDocument = original.srcdoc
    await render({ variables: { '--accent': 'blue' } })
    assert.equal(document.querySelector('iframe'), original, 'variable updates preserve prototype interaction state')
    await render({ imageHtml: html.replace('asset.png', 'data:image/png;base64,AA==') })
    assert.equal(document.querySelector('iframe'), original, 'image hydration uses the existing one-way patch')
    assert.equal(original.srcdoc, originalDocument)
    await render({ html: html.replace('color:red', 'color:blue') })
    assert.notEqual(document.querySelector('iframe'), original, 'changed HTML/CSS must create the current document generation')
    assert.equal(original.isConnected, false, 'old document can no longer own the preview frame')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const name of names) {
      const descriptor = previous.get(name)
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
})
test('binding messages require active edge and current document identity', () => {
  const message = { type: 'design-preview:bind', channel: 'current', id: 'open', element: 'button', label: 'Read' }
  assert.deepEqual(previewHotspotSelection(message, 'current', 'open'), { element: 'button', label: 'Read' })
  for (const [channel, edge] of [['old', 'open'], ['current', undefined], ['current', 'other']]) assert.equal(previewHotspotSelection(message, channel, edge), undefined)
  assert.equal(previewHotspotSelection({ ...message, extra: true }, 'current', 'open'), undefined)
})
test('preview navigation accepts only the exact current-channel declared edge', () => {
  const message = { type: 'design-preview:navigate', channel: 'current', id: 'open' }
  assert.equal(previewNavigationTarget(message, 'current', links), 'detail')
  for (const invalid of [null, [], { ...message, channel: 'old' }, { ...message, id: 'unknown' }, { ...message, target: 'external' }]) {
    assert.equal(previewNavigationTarget(invalid, 'current', links), undefined)
  }
  assert.equal(previewNavigationTarget(message, 'current', []), undefined)
})
test('artifact element identities cannot terminate trusted bridge script', () => {
  const markup = previewNavigationMarkup('channel', [{ ...links[0], element: '</script><script>evil()</script>' }])
  assert.equal(markup.match(/<script>/g).length, 1)
  assert.equal(markup.match(/<\/script>/g).length, 1)
  assert.ok(markup.includes('\\u003c/script>'))
})

test('trusted bridge intercepts a nested hotspot click but not undeclared elements', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<button data-prototype-id="button"><span>Open</span></button><button data-prototype-id="other">Other</button>', { runScripts: 'outside-only' })
  try {
    const messages = []
    dom.window.postMessage = (message, origin) => messages.push({ message, origin })
    const markup = previewNavigationMarkup('active', links)
    dom.window.eval(markup.slice('<script>'.length, -'</script>'.length))
    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
    dom.window.document.querySelector('span').dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(messages.length, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
      message: { type: 'design-preview:navigate', channel: 'active', id: 'open' }, origin: '*',
    })
    dom.window.document.querySelector('[data-prototype-id="other"]').click()
    assert.equal(messages.length, 1)
    assert.equal(previewNavigationTarget(messages[0].message, 'replacement', links), undefined)
  } finally { dom.window.close() }
})

test('binding mode emits a pick instead of following an existing navigation', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<button data-prototype-id="button" data-prototype-label="Read"><span>Open</span></button>', { runScripts: 'outside-only' })
  try {
    const messages = []
    dom.window.postMessage = message => messages.push(message)
    const markup = previewNavigationMarkup('active', links, 'new-edge')
    dom.window.eval(markup.slice(8, -9))
    dom.window.document.querySelector('span').click()
    assert.equal(messages.length, 1)
    assert.deepEqual(previewHotspotSelection(messages[0], 'active', 'new-edge'), { element: 'button', label: 'Read' })
    assert.equal(previewNavigationTarget(messages[0], 'active', links), undefined)
    assert.equal(previewHotspotSelection(messages[0], 'active', undefined), undefined)
  } finally { dom.window.close() }
})
