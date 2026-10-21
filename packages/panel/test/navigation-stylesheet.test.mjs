import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { useNavigationStylesheet } from '../src/use-navigation-stylesheet.ts'
import { NavigationPreview } from '../src/navigation-preview.tsx'
globalThis.React = React

test('parent stylesheet reads once, refreshes hashes and isolates old reader completions', async () => {
  const dom = new JSDOM('<div id="root"></div>')
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const path = 'styles/theme.css', requests = []
  const htmlReads = []
  const reader = queue => file => {
    if (file === path) return new Promise(resolve => queue.push({ file, resolve }))
    htmlReads.push(file)
    return Promise.resolve({ found: true, content: `<h1>Artifact ${file}</h1>` })
  }
  const read = reader(requests)
  const files = Object.fromEntries(Array.from({ length: 20 }, (_, key) => [`sample/${key}.html`, 'html1']))
  const frames = () => [...document.querySelectorAll('.dsh-navigation-thumbnail iframe')]
  const allContain = text => { assert.equal(frames().length, 20); assert.ok(frames().every(frame => frame.srcdoc.includes(text))) }
  const noneContain = text => assert.ok(frames().every(frame => !frame.srcdoc.includes(text)))
  function Parent({ options, count = 20 }) {
    const style = useNavigationStylesheet(path, options)
    return React.createElement('div', null, ...Array.from({ length: count }, (_, key) =>
      React.createElement(NavigationPreview, { key, thumbnail: true, path: `sample/${key}.html`, artifactId: String(key), title: String(key), options, stylesheet: path, sharedStylesheet: style })))
  }
  const show = options => act(async () => root.render(React.createElement(Parent, { options })))
  const options = { skill: 'sample', readArtifact: read, artifactFiles: { ...files, [path]: 'v1' }, sourceRevision: 'r1' }
  try {
    await show(options)
    assert.equal(requests.length, 1, '20 consumers share one parent request')
    assert.equal(htmlReads.length, 20, 'each distinct HTML is read separately from the single CSS request')
    await act(async () => requests[0].resolve({ found: true, content: 'body{color:rgb(1,2,3)}' }))
    allContain('rgb(1,2,3)')
    frames().forEach((frame, key) => assert.ok(frame.srcdoc.includes(`Artifact sample/${key}.html`)))
    await show({ ...options })
    assert.equal(requests.length, 1, 'equivalent status poll does not reread')
    await show({ ...options, artifactFiles: { ...files, [path]: 'v2' } })
    assert.equal(requests.length, 2)
    noneContain('rgb(1,2,3)')
    const newRequests = []
    const nextReader = reader(newRequests)
    await show({ ...options, readArtifact: nextReader, artifactFiles: { ...files, [path]: 'v2' } })
    assert.equal(newRequests.length, 1)
    await act(async () => requests[1].resolve({ found: true, content: 'body{color:rgb(4,5,6)}' }))
    noneContain('rgb(4,5,6)')
    await act(async () => newRequests[0].resolve({ found: true, content: 'body{color:rgb(7,8,9)}' }))
    allContain('rgb(7,8,9)')
    await show({ ...options, readArtifact: nextReader, artifactFiles: { ...files, [path]: 'v2' }, sourceRevision: 'r2' })
    assert.equal(newRequests.length, 2, 'new source revision rereads once, never once per child')
    noneContain('rgb(7,8,9)')
    await act(async () => newRequests[1].resolve({ found: true, content: 'body{color:rgb(10,11,12)}' }))
    allContain('rgb(10,11,12)')
    await show({ ...options, artifactFiles: files })
    noneContain('rgb(10,11,12)')
    assert.equal(requests.length, 2, 'known absent stylesheet does not read')
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
