import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { NavigationPreview } from '../src/navigation-preview.tsx'
globalThis.React = React

test('changing readers immediately hides old HTML even when path and revision match', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const path = 'bundle/item.html'
  const first = async () => ({ found: true, content: '<h1>Old source</h1>' })
  let resolveNext
  const second = () => new Promise(resolve => { resolveNext = resolve })
  const render = readArtifact => act(async () => root.render(React.createElement(NavigationPreview, {
    thumbnail: true, artifactId: 'item', title: 'Item', path,
    options: { skill: 'bundle', sourceRevision: 'same', artifactFiles: { [path]: 'same' }, readArtifact },
  })))
  try {
    await render(first)
    assert.ok(document.querySelector('iframe').srcdoc.includes('Old source'))
    await render(second)
    assert.equal(document.querySelector('iframe') === null, true, 'old source must not remain visible while new reader is pending')
    await act(async () => resolveNext({ found: true, content: '<h1>New source</h1>' }))
    assert.ok(document.querySelector('iframe').srcdoc.includes('New source'))
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
