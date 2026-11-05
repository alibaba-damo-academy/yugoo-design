import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { DocumentWorkspace } from '../src/document-workspace.tsx'
globalThis.React = React

test('document outline and sources follow the short last chapter at the scroll boundary', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const selectedPanels = []
  const node = { id: 'document', component: 'document_workspace', document: {
    path: 'html_file', allowed_files: ['bundle/doc.html'], source_attribute: 'data-source',
    sources: [{ value: 'user', label: 'User input' }, { value: 'qa', label: 'Questions', navigable: true },
      { value: 'quality', label: 'Acceptance', navigable: true }],
  } }
  const html = '<h2 data-source="user">Introduction</h2><h2 data-source="qa">Questions</h2><h2 data-source="quality">Conclusion</h2>'
  try {
    await act(async () => root.render(React.createElement(DocumentWorkspace, { node, data: { html_file: 'bundle/doc.html' },
      options: { skill: 'bundle', readArtifact: async () => ({ found: true, content: html }), selectPanel: id => selectedPanels.push(id) } })))
    const frame = document.querySelector('iframe'), doc = frame.contentDocument, win = frame.contentWindow
    doc.body.innerHTML = html // JSDOM does not load srcdoc.
    let scrollTop = 0, scrollHeight = 1600
    Object.defineProperties(doc.documentElement, { scrollTop: { get: () => scrollTop }, scrollHeight: { get: () => scrollHeight } })
    Object.defineProperty(win, 'innerHeight', { value: 600, configurable: true })
    const headings = [...doc.querySelectorAll('h2')]
    headings.forEach((heading, index) => { heading.getBoundingClientRect = () => ({ top: [0, 700, 1300][index] - scrollTop }) })
    await act(async () => frame.dispatchEvent(new dom.window.Event('load')))
    const current = () => document.querySelector('[aria-current="page"]')?.textContent
    assert.equal(current(), 'Introduction')
    assert.equal(document.querySelector('.dsh-document-sources button'), null, 'non-navigable source is context, not a disabled action')
    assert.equal(document.querySelector('.dsh-document-sources span').textContent, 'User input')
    scrollTop = 750
    await act(async () => win.dispatchEvent(new win.Event('scroll')))
    assert.equal(current(), 'Questions')
    scrollTop = 1000
    await act(async () => win.dispatchEvent(new win.Event('scroll')))
    assert.equal(current(), 'Conclusion', 'the final heading cannot reach the top in a short final chapter')
    await act(async () => document.querySelector('.dsh-document-sources button').click())
    assert.deepEqual(selectedPanels, ['quality'], 'sources follow the actually visible last chapter')
    scrollTop = 750
    await act(async () => win.dispatchEvent(new win.Event('scroll')))
    assert.equal(current(), 'Questions', 'scrolling back leaves the final chapter')
    scrollTop = 0; scrollHeight = 500
    await act(async () => win.dispatchEvent(new win.Event('resize')))
    assert.equal(current(), 'Introduction', 'a short document without scrolling does not jump to its end')
  } finally { await act(async () => root.unmount()); dom.window.close() }
})

for (const failure of ['reject', 'not-found']) {
  test(`document refresh clears stale content after ${failure} and recovers`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
    globalThis.window = dom.window; globalThis.document = dom.window.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const root = createRoot(document.getElementById('root'))
    let reads = 0
    const options = { skill: 'bundle', readArtifact: async () => {
      reads++
      if (reads === 2) {
        if (failure === 'reject') throw new Error('Artifact unavailable')
        return { found: false, content: '' }
      }
      return { found: true, content: `<h2>${reads === 1 ? 'Original' : 'Recovered'} document</h2>` }
    } }
    const node = { id: 'document', component: 'document_workspace', document: {
      path: 'html_file', allowed_files: ['bundle/doc.html'],
    } }
    const refresh = () => act(async () => document.querySelector('.dsh-document-toolbar button').click())
    try {
      await act(async () => root.render(React.createElement(DocumentWorkspace, {
        node, data: { html_file: 'bundle/doc.html' }, options,
      })))
      assert.match(document.querySelector('iframe').srcdoc, /Original document/)
      assert.equal(document.querySelector('.dsh-document-toolbar [role=status]'), null, 'loaded content does not need a duplicate ready label')
      await refresh()
      assert.equal(document.querySelector('iframe') === null, true)
      assert.equal(document.querySelector('.dsh-document-toolbar [role=status]') === null, true)
      assert.ok(document.querySelector('[role=alert]'))
      assert.equal(document.querySelector('.dsh-document-toolbar button').disabled, false)
      await refresh()
      assert.match(document.querySelector('iframe').srcdoc, /Recovered document/)
      assert.equal(document.querySelector('[role=alert]') === null, true)
      assert.equal(document.querySelector('.dsh-document-toolbar [role=status]'), null, 'loaded content does not need a duplicate ready label')
      assert.equal(reads, 3)
    } finally { await act(async () => root.unmount()); dom.window.close() }
  })
}


test('a document legend appears for actual references, not an empty pending count', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  const root = createRoot(document.getElementById('root'))
  const node = { component: 'document_workspace', id: 'pending', document: { path: 'html_file', allowed_files: ['bundle/doc.html'], legend: 'Pending clarification', references_path: 'pending', references_id_field: 'id' } }
  const options = { skill: 'bundle', readArtifact: async () => ({ found: true, content: '<h2>Document</h2>' }) }
  const show = pending => act(async () => root.render(React.createElement(DocumentWorkspace, { node, data: { html_file: 'bundle/doc.html', pending }, options })))
  try {
    await show([])
    assert.ok(document.querySelector('iframe'))
    assert.equal(document.querySelector('.dsh-document-legend'), null)
    await show([{ id: 'P-1' }])
    assert.match(document.querySelector('.dsh-document-legend').textContent, /Pending clarification/)
    assert.match(document.querySelector('.dsh-document-legend').textContent, /1/)
    await show([])
    assert.equal(document.querySelector('.dsh-document-legend'), null)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
