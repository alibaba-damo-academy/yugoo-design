import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parsePanelManifest, localizePanelManifest } from '../../core/src/panel-dsl.ts'
import { PanelLocaleContext } from '../src/panel-i18n.tsx'
import assert from 'node:assert/strict'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { DocumentWorkspace } from '../src/document-workspace.tsx'
globalThis.React = React

async function activeDocumentFixture(check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://document.test/' })
  const keys = ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DOMParser', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const key of keys.slice(0, -1)) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root')), logs = []
  const node = { id: 'report', component: 'document_workspace', description: 'No document yet. Ask the agent.', document: {
    path: 'html_file', allowed_files: ['bundle/doc.html'],
  } }
  const attempt = { invocationId: 'current', attemptId: 'producer', runId: 'current-producer', role: 'producer', phase: 'working', sequence: 2 }
  const options = { skill: 'bundle', executionAttempts: [attempt],
    readArtifact: async () => ({ found: false, content: '' }),
    readExecutionLog: async (runId, after, target) => { logs.push({ runId, target }); return { found: true, entries: after === undefined ? [{ seq: 1, message: 'Writing the current document' }] : [] } },
    onPanelUpdate: () => assert.fail('reading progress must not write canonical data'),
  }
  const show = (data = {}, overrides = {}) => act(async () => root.render(React.createElement(DocumentWorkspace, { node, data, options: { ...options, ...overrides } })))
  try { await check({ show, logs, attempt, options, dom, node }) }
  finally {
    await act(async () => root.unmount()); dom.window.close()
    for (const key of keys) { const value = previous.get(key); if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }
  }
}

test('first document generation shows one current execution region through missing output and preserves real failures', async () => {
  await activeDocumentFixture(async ({ show, logs, attempt }) => {
    const body = () => document.querySelector('.dsh-document-body')
    for (const phase of ['queued', 'working']) {
      await show({}, { executionAttempts: [{ ...attempt, phase }] })
      assert.equal(body().querySelector('[data-content-state="empty"]') === null, true, 'first active generation must not ask the user to start it again')
      assert.equal(body().querySelectorAll('[data-execution-log]').length, 1)
      assert.match(body().textContent, /Writing the current document/)
      assert.doesNotMatch(document.querySelector('.dsh-panel-workspace-tree').textContent, /No chapters yet/)
      assert.equal(body().querySelector('iframe') === null, true)
    }
    assert.ok(logs.every(item => item.runId === 'current-producer' && item.target === undefined), 'only the real current Producer is read')
    const data = { html_file: 'bundle/doc.html' }, before = structuredClone(data)
    await show(data)
    assert.equal(body().querySelectorAll('[data-execution-log]').length, 1, 'not-yet-written bound output is still normal generation')
    assert.equal(body().querySelector('[role="alert"]') === null, true)
    await show(data, { readArtifact: async () => { throw new Error('Read transport failed') } })
    assert.ok(body().querySelector('[role="alert"]'), 'a real read failure is not hidden by execution')
    assert.equal(body().querySelector('[data-execution-log]') === null, true)
    await show(data, { readArtifact: undefined })
    assert.ok(body().querySelector('[data-content-state="unavailable"]'))
    await show({ html_file: '../outside.html' })
    assert.ok(body().querySelector('[data-content-state="error"]'))
    await show({}, { readExecutionLog: undefined })
    assert.equal(body().querySelectorAll('[data-content-state="loading"]').length, 1, 'missing exact log capability uses the existing loader')
    assert.equal(body().querySelector('[data-content-state="empty"]') === null, true)
    for (const phase of ['completed', 'failed', 'cancelled']) {
      await show({}, { executionAttempts: [{ ...attempt, phase, sequence: 3 }] })
      assert.equal(body().querySelector('[data-execution-log]') === null, true, `${phase} removes runtime progress`)
      assert.ok(body().querySelector('[data-content-state="empty"]'))
    }
    await show(data, { executionAttempts: [{ ...attempt, phase: 'completed', sequence: 3 }] })
    assert.ok(body().querySelector('[role="alert"]'), 'terminal missing-file feedback retains its existing recovery')
    await show(data, { executionAttempts: [{ ...attempt, phase: 'completed', sequence: 3 }], readArtifact: async () => ({ found: true, content: '<h2>Completed document</h2>' }) })
    assert.match(body().querySelector('iframe').srcdoc, /Completed document/)
    assert.equal(body().querySelector('[role="alert"]') === null, true)
    assert.deepEqual(data, before)
  })
})

test('document progress reads only the exact active Main association and drops it when that association ends', async () => {
  await activeDocumentFixture(async ({ show, logs, attempt }) => {
    const data = { html_file: 'bundle/doc.html' }
    const activity = { executor: 'main', projectId: 'project', skill: 'bundle', invocationId: 'main-invocation', runId: 'main-run',
      artifactId: 'report', artifactKind: 'document', artifactFile: 'bundle/doc.html', active: true, available: true,
      nativeStatus: 'running', sequence: 5, logTarget: { artifactId: 'report', invocationId: 'main-invocation' } }
    const other = { ...activity, artifactFile: 'bundle/other.html', artifactId: 'other', runId: 'other-run', sequence: 6 }
    const options = { executionAttempts: [{ ...attempt, phase: 'completed' }], artifactActivities: [activity, other] }
    await show(data, options)
    assert.equal(document.querySelectorAll('.dsh-document-body [data-execution-log]').length, 1)
    assert.ok(logs.length > 0)
    assert.ok(logs.every(item => item.runId === 'main-run'), 'another document activity or an old Producer cannot supply the visible log')
    assert.deepEqual(logs[0].target, activity.logTarget)
    for (const end of [{ active: false }, { available: false }, { nativeStatus: 'completed' }]) {
      await show(data, { ...options, artifactActivities: [{ ...activity, ...end }, other] })
      assert.equal(document.querySelector('[data-execution-log]') === null, true, 'ended or unavailable association removes the live region')
      assert.ok(document.querySelector('.dsh-document-body [role="alert"]'), 'terminal missing output keeps its existing feedback')
    }
  })
})

test('document regeneration hides the old report and outline until the current execution settles', async () => {
  await activeDocumentFixture(async ({ show, attempt, dom }) => {
    const data = { html_file: 'bundle/doc.html' }, before = structuredClone(data)
    let html = '<h2>Old report</h2>'
    const readArtifact = async () => ({ found: true, content: html })
    await show(data, { readArtifact, executionAttempts: [{ ...attempt, phase: 'completed' }] })
    const frame = document.querySelector('iframe')
    frame.contentDocument.body.innerHTML = html
    await act(async () => frame.dispatchEvent(new dom.window.Event('load')))
    assert.match(document.querySelector('.dsh-panel-workspace-tree').textContent, /Old report/)
    await show(data, { readArtifact })
    assert.equal(document.querySelector('iframe') === null, true, 'the prior report cannot appear current during regeneration')
    assert.doesNotMatch(document.querySelector('.dsh-panel-workspace-tree').textContent, /Old report/)
    assert.ok(document.querySelector('.dsh-document-body [data-execution-log]'))
    html = '<h2>New report</h2>'
    await show(data, { readArtifact, sourceRevision: 'new-file' })
    assert.equal(document.querySelector('iframe') === null, true, 'landed intermediate content stays hidden until this document execution settles')
    await show(data, { readArtifact, sourceRevision: 'new-file', executionAttempts: [{ ...attempt, phase: 'completed', sequence: 3 }] })
    assert.match(document.querySelector('iframe').srcdoc, /New report/)
    assert.equal(document.querySelector('[data-execution-log]') === null, true)
    assert.deepEqual(data, before)
  })
})

test('document outline follows the short last chapter while each source stays at its chapter end', async () => {
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
    assert.equal(document.querySelector('.dsh-document-sources'), null, 'no source toolbar consumes document reading space')
    assert.equal(doc.querySelector('.dsh-document-chapter-sources span').textContent, 'User input')
    assert.equal(headings[1].previousElementSibling.dataset.documentChapterSources, 'document-chapter-1')
    assert.equal(headings[2].previousElementSibling.dataset.documentChapterSources, 'document-chapter-2')
    scrollTop = 750
    await act(async () => win.dispatchEvent(new win.Event('scroll')))
    assert.equal(current(), 'Questions')
    scrollTop = 1000
    await act(async () => win.dispatchEvent(new win.Event('scroll')))
    assert.equal(current(), 'Conclusion', 'the final heading cannot reach the top in a short final chapter')
    await act(async () => doc.querySelector('[data-document-chapter-sources="document-chapter-3"] a').click())
    assert.deepEqual(selectedPanels, ['quality'], 'sources follow the actually visible last chapter')
    scrollTop = 750
    await act(async () => win.dispatchEvent(new win.Event('scroll')))
    assert.equal(current(), 'Questions', 'scrolling back leaves the final chapter')
    scrollTop = 0; scrollHeight = 500
    await act(async () => win.dispatchEvent(new win.Event('resize')))
    assert.equal(current(), 'Introduction', 'a short document without scrolling does not jump to its end')
  } finally { await act(async () => root.unmount()); dom.window.close() }
})

test('chapter-end sources preserve every label, navigation and reference count without a toolbar', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  const sources = [{ value: 'user', label: 'User input' }, ...Array.from({ length: 14 }, (_, index) => ({ value: `owner-${index}`, label: `Owner ${index}`, navigable: true }))]
  const html = `<h2 data-source="${sources.map(source => source.value).join(' ')}" data-reference="P-1">Traceability</h2>`
  const node = { id: 'document', component: 'document_workspace', document: {
    path: 'html_file', allowed_files: ['bundle/doc.html'], source_attribute: 'data-source', sources,
    references_attribute: 'data-reference', references_path: 'pending', references_id_field: 'id',
    references_label: 'Pending confirmation', legend: 'Purple marks need confirmation.',
  } }
  const selected = [], data = { html_file: 'bundle/doc.html', pending: [{ id: 'P-1' }] }
  try {
    await act(async () => root.render(React.createElement(DocumentWorkspace, { node, data,
      options: { skill: 'bundle', readArtifact: async () => ({ found: true, content: html }), selectPanel: id => selected.push(id) } })))
    const frame = document.querySelector('iframe')
    frame.contentDocument.body.innerHTML = html
    await act(async () => frame.dispatchEvent(new dom.window.Event('load')))
    const note = frame.contentDocument.querySelector('.dsh-document-chapter-sources')
    assert.equal(document.querySelector('.dsh-document-sources'), null)
    assert.equal(note.querySelectorAll('a').length, 14, 'every navigable source stays reachable')
    assert.equal(note.querySelector('span').textContent, 'User input', 'non-navigable evidence stays text')
    await act(async () => [...note.querySelectorAll('a')].at(-1).click())
    assert.deepEqual(selected, ['owner-13'])
    assert.equal(document.querySelectorAll('.dsh-document-legend').length, 1)
    assert.match(document.querySelector('.dsh-document-legend').textContent, /Pending confirmation ×1/)
    assert.doesNotMatch(note.textContent, /Pending confirmation/, 'the same pending count is not repeated')
    await act(async () => frame.dispatchEvent(new dom.window.Event('load')))
    assert.equal(frame.contentDocument.querySelectorAll('.dsh-document-chapter-sources').length, 1, 'a load callback cannot accumulate annotations')
    assert.deepEqual(data.pending, [{ id: 'P-1' }], 'source browsing does not edit reference data')
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


test('real PRD labels every chapter source including AI, updates locale in place, and keeps nested sections separate', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  const root = createRoot(document.getElementById('root'))
  const base = new URL('../../skills-web-app/bundles/web_app_prd_assembly/', import.meta.url)
  const manifest = parsePanelManifest(readFileSync(new URL('panel.yaml', base), 'utf8'))
  manifest.i18n.messages = Object.fromEntries(['en-US', 'zh-CN'].map(locale => [locale,
    JSON.parse(readFileSync(new URL(`locales/${locale}.json`, base), 'utf8'))]))
  const html = '<main><section><header><h2 data-prd-sources="function_modules ai_agent_capabilities user">Capabilities</h2></header><p id="first-end">Preserve the human exception.</p></section><section><h2 data-prd-sources="research">Evidence</h2><p id="last-end">Keep the original evidence.</p></section></main>'
  const selected = [], data = { html_file: 'web_app_prd_assembly/prd.html', ai_provenance: [] }
  const options = { skill: 'web_app_prd_assembly', readArtifact: async () => ({ found: true, content: html }), selectPanel: id => selected.push(id) }
  const show = locale => act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale },
    React.createElement(DocumentWorkspace, { node: localizePanelManifest(manifest, locale).ui, data, options }))))
  try {
    await show('en-US')
    const frame = document.querySelector('iframe'), doc = frame.contentDocument
    doc.body.innerHTML = html
    await act(async () => frame.dispatchEvent(new dom.window.Event('load')))
    assert.equal(document.querySelector('.dsh-document-sources'), null)
    const first = doc.querySelector('#first-end').nextElementSibling
    assert.match(first.textContent, /Sources: Functions · AI capabilities · User input/)
    assert.equal(first.parentElement.tagName, 'SECTION')
    assert.equal(first.querySelectorAll('a').length, 2)
    assert.equal(doc.querySelector('#last-end').nextElementSibling.querySelector('a').textContent, 'Research')
    await act(async () => [...first.querySelectorAll('a')].at(-1).click())
    assert.deepEqual(selected, ['ai_agent_capabilities'])
    await show('zh-CN')
    assert.equal(document.querySelector('iframe'), frame, 'locale changes do not reload the authored report')
    assert.equal(doc.querySelectorAll('.dsh-document-chapter-sources').length, 2)
    assert.match(doc.querySelector('#first-end').nextElementSibling.textContent, /AI 能力/)
    assert.doesNotMatch(doc.body.textContent, /ai_agent_capabilities/)
    assert.equal(doc.querySelector('#first-end').textContent, 'Preserve the human exception.')
    assert.equal(doc.querySelector('#last-end').textContent, 'Keep the original evidence.')
    assert.deepEqual(data, { html_file: 'web_app_prd_assembly/prd.html', ai_provenance: [] })
  } finally { await act(async () => root.unmount()); dom.window.close() }
})
