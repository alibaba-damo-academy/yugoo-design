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


test('unchanged selected artifact retains its frame, draft and success state across unrelated digests and checkpoints', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://panel.test/' })
  for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'HTMLFormElement', 'DocumentFragment', 'Element', 'Node']) globalThis[key] = dom.window[key]
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root')), path = 'bundle/form.html'
  let sourceRevision = 'checkpoint-1', collapseToken = { saved: 1 }, documentVersion = 'workspace-1'
  let artifactFiles = { [path]: 'html-1' }, html = '<h1>Original form</h1>', releaseOld
  const calls = []
  const readArtifact = async file => {
    calls.push(file)
    if (html === 'pending') return new Promise(resolve => { releaseOld = resolve })
    return { found: true, content: html }
  }
  const show = () => act(async () => root.render(React.createElement(NavigationPreview, {
    artifactId: 'form', title: 'Form', path, documentVersion,
    options: { skill: 'bundle', sourceRevision, collapseToken, artifactFiles, readArtifact },
  })))
  try {
    await show()
    const frame = document.querySelector('iframe'), srcDoc = frame.srcdoc
    // JSDOM does not execute srcdoc. These DOM values model state owned by the
    // existing frame; exact element/srcdoc preservation is the tested boundary.
    const draft = frame.contentDocument.createElement('textarea')
    draft.value = '  keep this draft\nexactly  '; frame.contentDocument.body.append(draft)
    frame.contentDocument.documentElement.scrollTop = 57
    artifactFiles = { ...artifactFiles, 'other/report.html': 'other-new' }
    sourceRevision = 'checkpoint-2'; collapseToken = { saved: 2 }; documentVersion = 'workspace-2'
    await show()
    assert.equal(document.querySelector('iframe') === frame, true, 'unrelated inventory/checkpoint must not recreate the selected document')
    assert.equal(frame.srcdoc, srcDoc)
    assert.equal(draft.value, '  keep this draft\nexactly  ')
    assert.equal(frame.contentDocument.documentElement.scrollTop, 57)
    frame.contentDocument.body.textContent = 'Submission complete'
    artifactFiles = { ...artifactFiles, 'other/report.html': 'other-revised' }; await show()
    assert.equal(document.querySelector('iframe') === frame, true)
    assert.equal(frame.contentDocument.body.textContent, 'Submission complete')
    assert.equal(calls.length, 1, 'unrelated entries do not reread unchanged selected HTML')

    await act(async () => document.querySelector('[data-preview-refresh]').click())
    const refreshed = document.querySelector('iframe')
    assert.equal(refreshed === frame, false, 'explicit Refresh still replaces the document')
    html = '<h1>Updated HTML</h1>'; artifactFiles = { ...artifactFiles, [path]: 'html-2' }; await show()
    assert.equal(document.querySelector('iframe') === refreshed, false)
    assert.match(document.querySelector('iframe').srcdoc, /Updated HTML/)
    html = 'pending'; artifactFiles = { ...artifactFiles, [path]: 'html-3' }; await show()
    assert.equal(document.querySelector('iframe') === null, true, 'a genuinely changed artifact hides stale content while pending')
    html = '<h1>Newest HTML</h1>'; artifactFiles = { ...artifactFiles, [path]: 'html-4' }; await show()
    const newest = document.querySelector('iframe')
    await act(async () => releaseOld({ found: true, content: '<h1>Obsolete response</h1>' }))
    assert.equal(document.querySelector('iframe') === newest, true)
    assert.match(newest.srcdoc, /Newest HTML/)
    assert.doesNotMatch(newest.srcdoc, /Obsolete response/)
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
