import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { DocumentWorkspace } from '../src/document-workspace.tsx'
globalThis.React = React

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
      assert.ok(document.querySelector('.dsh-document-toolbar [role=status]'))
      await refresh()
      assert.equal(document.querySelector('iframe') === null, true)
      assert.equal(document.querySelector('.dsh-document-toolbar [role=status]') === null, true)
      assert.ok(document.querySelector('[role=alert]'))
      assert.equal(document.querySelector('.dsh-document-toolbar button').disabled, false)
      await refresh()
      assert.match(document.querySelector('iframe').srcdoc, /Recovered document/)
      assert.equal(document.querySelector('[role=alert]') === null, true)
      assert.ok(document.querySelector('.dsh-document-toolbar [role=status]'))
      assert.equal(reads, 3)
    } finally { await act(async () => root.unmount()); dom.window.close() }
  })
}
