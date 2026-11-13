/** Source React and stylesheet lifecycle checks; not browser geometry or Host execution. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', runScripts: 'outside-only' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DOMParser']) globalThis[key] = dom.window[key]
// JSDOM has no layout observer; these checks assert render branches, not geometry.
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { PanelContentState } = await import('../src/panel-content-state.tsx')
const { PanelLocaleContext, panelText } = await import('../src/panel-i18n.tsx')
const { NavigationPreview } = await import('../src/navigation-preview.tsx')
const { DocumentWorkspace } = await import('../src/document-workspace.tsx')
const { ArtifactWorkspace } = await import('../src/artifact-workspace.tsx')
const { PreviewWorkspace } = await import('../src/preview-workspace.tsx')
after(() => dom.window.close())
const state = () => document.querySelector('[data-content-state]')
const root = () => createRoot(document.getElementById('root'))
const localized = child => React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, child)

test('shared region states have readable names, decorative icons and retained recovery actions', async () => {
  const view = root()
  try {
    for (const value of ['loading', 'empty', 'unavailable', 'error']) {
      await React.act(async () => view.render(React.createElement(PanelContentState, { state: value, message: `${value} content` },
        value === 'error' ? React.createElement('button', null, 'Retry') : null)))
      assert.equal(state().getAttribute('role'), value === 'error' ? 'alert' : 'status')
      assert.equal(state().querySelector('svg').getAttribute('aria-hidden'), 'true')
      assert.equal(state().querySelector('p').textContent, `${value} content`)
      assert.equal(state().querySelector('button')?.textContent, value === 'error' ? 'Retry' : undefined)
    }
  } finally { await React.act(async () => view.unmount()) }
})

test('empty Panel workspace has a decorative illustration, localized title and one conversation action', async () => {
  const view = root()
  let focused = 0
  try {
    for (const locale of ['en-US', 'zh-CN']) {
      await React.act(async () => view.render(React.createElement(PanelContentState, {
        state: 'empty', kind: 'panel', title: panelText('panelEmptyTitle', locale), message: panelText('panelEmptyDescription', locale),
      }, React.createElement('button', { onClick: () => focused++ }, panelText('panelContinueInChat', locale)))))
      assert.equal(state().querySelector('h3').textContent, panelText('panelEmptyTitle', locale))
      assert.equal(state().querySelector('p').textContent, panelText('panelEmptyDescription', locale))
      assert.equal(state().querySelector('.dsh-panel-empty-illustration').getAttribute('aria-hidden'), 'true')
      assert.equal(state().querySelectorAll('button').length, 1)
      await React.act(async () => state().querySelector('button').click())
    }
    assert.equal(focused, 2)
  } finally { await React.act(async () => view.unmount()) }
})

test('thumbnail loading replaces another document immediately and ignores late target responses', async () => {
  const view = root(), pending = new Map(), reads = []
  const options = { skill: 'bundle', readArtifact: path => {
    reads.push(path); return new Promise(resolve => pending.set(path, resolve))
  }, onPanelUpdate: () => assert.fail('content states cannot write canonical data') }
  const show = path => React.act(async () => view.render(localized(React.createElement(NavigationPreview, {
    path, title: 'Page', artifactId: path, thumbnail: true, options,
  }))))
  try {
    await show('bundle/a.html')
    assert.equal(state().dataset.contentState, 'loading')
    assert.equal(state().classList.contains('is-compact'), true)
    assert.equal(document.querySelector('.dsh-navigation-thumbnail').getAttribute('aria-busy'), 'true')
    await show('bundle/b.html')
    await React.act(async () => pending.get('bundle/a.html')({ found: true, content: '<h1>Old page</h1>' }))
    assert.equal(document.querySelector('iframe'), null)
    assert.equal(state().dataset.contentState, 'loading')
    await React.act(async () => pending.get('bundle/b.html')({ found: true, content: '<h1>New page</h1>' }))
    const frame = document.querySelector('iframe')
    assert.match(frame.srcdoc, /New page/)
    assert.doesNotMatch(frame.srcdoc, /Old page/)
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts')
    assert.equal(frame.getAttribute('aria-hidden'), 'true')
    assert.ok(frame.srcdoc.includes("connect-src 'none'"))
    assert.equal(state(), null)
    assert.equal(document.querySelector('.dsh-navigation-thumbnail').getAttribute('aria-busy'), 'false')
    assert.deepEqual(reads, ['bundle/a.html', 'bundle/b.html'])
  } finally { await React.act(async () => view.unmount()) }
})

test('unpublished, empty, missing-reader and failed thumbnails are distinct and unsafe paths never read', async () => {
  const view = root(), reads = []
  const reader = async path => { reads.push(path); return { found: path.includes('empty'), content: '  ' } }
  const show = (path, readArtifact = reader) => React.act(async () => view.render(localized(React.createElement(NavigationPreview, {
    path, title: 'Page', artifactId: 'page', thumbnail: true, options: { skill: 'bundle', readArtifact },
  }))))
  try {
    await show(undefined)
    assert.equal(state().dataset.contentState, 'empty')
    await show('bundle/empty.html')
    assert.equal(state().dataset.contentState, 'empty')
    assert.equal(document.querySelector('iframe'), null)
    await show('bundle/missing.html')
    assert.equal(state().dataset.contentState, 'error')
    assert.match(state().textContent, /unavailable/)
    await React.act(async () => view.render(localized(React.createElement(NavigationPreview, {
      path: 'bundle/available.html', title: 'Page', artifactId: 'page', thumbnail: true, options: { skill: 'bundle' },
    }))))
    assert.equal(state().dataset.contentState, 'unavailable')
    const count = reads.length
    await show('../escape.html')
    assert.equal(reads.length, count)
    assert.equal(state().dataset.contentState, 'error')
    assert.match(state().textContent, /Invalid document reference/)
    assert.equal(document.querySelector('.dsh-navigation-thumbnail button'), null)
  } finally { await React.act(async () => view.unmount()) }
})

test('shared CSS cannot turn a whitespace-only navigation artifact into thumbnail or full preview content', async () => {
  const view = root(), reads = []
  const options = { skill: 'bundle', readArtifact: async path => {
    reads.push(path); return { found: true, content: ' \n\t ' }
  }, onPanelUpdate: () => assert.fail('content states cannot write canonical data') }
  try {
    for (const thumbnail of [true, false]) {
      await React.act(async () => view.render(localized(React.createElement(NavigationPreview, {
        path: 'bundle/empty.html', title: 'Empty page', artifactId: 'page', thumbnail, options,
        stylesheet: 'bundle/common.css', sharedStylesheet: { path: 'bundle/common.css', content: 'body { color: red; }' },
      }))))
      assert.equal(state()?.dataset.contentState, 'empty')
      assert.equal(document.querySelector('iframe'), null)
      assert.equal(document.querySelector('.dsh-live-preview'), null)
    }
    assert.deepEqual(reads, ['bundle/empty.html'])
  } finally { await React.act(async () => view.unmount()) }
})

test('preview workspace treats whitespace-only source as empty even when its common stylesheet is valid', async () => {
  const view = root(), reads = []
  let source = ' \n\t '
  const node = { id: 'preview', live_preview: { file_path: 'preview.file', stylesheet: 'bundle/common.css', tokens: [] } }
  const data = { preview: { file: 'bundle/empty.html' } }, original = structuredClone(data)
  const options = { skill: 'bundle', readArtifact: async path => {
    reads.push(path); return { found: true, content: path.endsWith('.css') ? 'body { color: red; }' : source }
  }, onPanelUpdate: () => assert.fail('content states cannot write canonical data') }
  try {
    await React.act(async () => view.render(localized(React.createElement(PreviewWorkspace, { node, data, options }))))
    assert.equal(state()?.dataset.contentState, 'empty')
    assert.equal(document.querySelector('iframe'), null)
    assert.equal(document.querySelector('.dsh-live-preview'), null)
    assert.deepEqual(reads, ['bundle/empty.html', 'bundle/common.css'])
    source = '<h1>Published page</h1>'
    await React.act(async () => document.querySelector('.dsh-preview-toolbar button').click())
    assert.equal(state(), null)
    assert.match(document.querySelector('iframe').srcdoc, /Published page/)
    assert.match(document.querySelector('iframe').srcdoc, /body \{ color: red; \}/)
    assert.deepEqual(data, original)
  } finally { await React.act(async () => view.unmount()) }
})

test('document loading keeps a same-source refresh readable and empty bytes do not render a blank iframe', async () => {
  const view = root(), pending = []
  const node = { id: 'document', document: { path: 'file', allowed_files: ['bundle/doc.html'] } }
  const data = { file: 'bundle/doc.html' }, original = structuredClone(data)
  const options = { skill: 'bundle', readArtifact: () => new Promise(resolve => pending.push(resolve)) }
  const show = () => React.act(async () => view.render(localized(React.createElement(DocumentWorkspace, { node, data, options }))))
  try {
    await show()
    assert.equal(state().dataset.contentState, 'loading')
    await React.act(async () => pending.shift()({ found: true, content: '<h2>Saved document</h2>' }))
    assert.ok(document.querySelector('iframe'))
    await React.act(async () => document.querySelector('.dsh-document-toolbar button').click())
    assert.match(document.querySelector('iframe').srcdoc, /Saved document/)
    assert.equal(document.querySelector('.dsh-document-body').getAttribute('aria-busy'), 'true')
    await React.act(async () => pending.shift()({ found: true, content: '   ' }))
    assert.equal(document.querySelector('iframe'), null)
    assert.equal(state().dataset.contentState, 'empty')
    assert.deepEqual(data, original)
  } finally { await React.act(async () => view.unmount()) }
})

test('artifact read errors retain retry and cannot masquerade as an empty document', async () => {
  const view = root(), pending = []
  const node = { id: 'reports', artifacts: { records_path: 'reports', title_field: 'title', file_field: 'file', artifact_kind: 'report',
    children: { records_field: 'parts', title_field: 'title', file_field: 'file', artifact_kind: 'part' } } }
  const data = { reports: { r: { title: 'Report', file: 'bundle/report.md', parts: {} } } }, original = structuredClone(data)
  const options = { skill: 'bundle', readArtifact: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }
  const show = () => React.act(async () => view.render(localized(React.createElement(ArtifactWorkspace, { node, data, options }))))
  const refresh = () => [...document.querySelectorAll('.dsh-document-toolbar button')].find(button => button.textContent === 'Refresh')
  try {
    await show()
    assert.equal(state().dataset.contentState, 'loading')
    await React.act(async () => pending.shift().reject(new Error('Read failed')))
    assert.equal(state().dataset.contentState, 'error')
    assert.ok(refresh(), 'retry stays on the shared document toolbar')
    assert.equal(refresh().disabled, false)
    await React.act(async () => refresh().click())
    assert.equal(state().dataset.contentState, 'loading')
    await React.act(async () => pending.shift().resolve({ found: true, content: '# Published report' }))
    assert.match(document.querySelector('.dsh-artifact-markdown').textContent, /Published report/)
    assert.equal(state(), null)
    assert.deepEqual(data, original)
  } finally { await React.act(async () => view.unmount()) }
})

for (const kind of ['artifact', 'preview']) test(`active ${kind} waiting has one progress surface and preserves real read failures`, async () => {
  const view = root(), pending = [], logReads = []
  const file = kind === 'artifact' ? 'bundle/report.md' : 'bundle/page.html'
  const node = { id: 'reports', artifacts: { records_path: 'reports', title_field: 'title', file_field: 'file', artifact_kind: 'report',
    children: { records_field: 'parts', title_field: 'title', file_field: 'file', artifact_kind: 'part' } } }
  const initial = { reports: { r: { title: 'Report', parts: {} } } }, original = structuredClone(initial)
  const readArtifact = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  const readExecutionLog = async runId => { logReads.push(runId); return { found: true, revision: 'one', entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: 'Preparing this artifact' }] } }
  const show = (phase, path, reader = readExecutionLog, contentReader = readArtifact) => React.act(async () => {
    const options = { skill: 'bundle', readArtifact: contentReader, readExecutionLog: reader,
      executionAttempts: [{ projectId: 'test', artifactId: 'r', artifactKind: 'report', invocationId: 'generation', attemptId: 'worker', runId: 'exact-worker', role: 'worker', phase, sequence: 1, timestamp: 1 }],
      onPanelUpdate: () => assert.fail('waiting does not modify canonical records') }
    view.render(localized(kind === 'artifact' ? React.createElement(ArtifactWorkspace, {
      node, data: path ? { reports: { r: { ...initial.reports.r, file: path } } } : initial, options,
    }) : React.createElement(NavigationPreview, { path, title: 'Page', artifactId: 'r', artifactKind: 'report', options })))
  })
  const retry = () => document.querySelector('[data-preview-refresh]')
    ?? [...document.querySelectorAll('.dsh-document-toolbar button')].find(button => button.textContent === 'Refresh')
  try {
    for (const phase of ['queued', 'working']) {
      await show(phase)
      assert.equal(document.querySelectorAll('.dsh-artifact-placeholder [data-content-state]').length, 0, 'active logs replace ordinary empty/loading placeholders')
      assert.equal(document.querySelectorAll('.dsh-artifact-placeholder [data-execution-log]').length, 1)
    }
    await show('working', undefined, null)
    assert.equal(state().dataset.contentState, 'loading', 'missing log capability still gives truthful active feedback')
    assert.equal(document.querySelectorAll('[data-content-state]').length, 1)
    assert.equal(document.querySelector('[data-execution-log]'), null, 'no log association is fabricated')
    await show('failed')
    assert.equal(document.querySelector('[data-execution-log]'), null)
    assert.notEqual(state().dataset.contentState, 'loading', 'settled generation cannot keep spinning')
    await show('working', file, readExecutionLog, null)
    assert.equal(state().dataset.contentState, 'unavailable', 'an absent content reader remains a real capability limit')
    await show('working', file)
    await React.act(async () => pending.shift().reject(new Error('Network read failed')))
    assert.equal(state().dataset.contentState, 'error', 'actual read failure cannot hide behind active generation')
    assert.ok(retry() && !retry().disabled)
    await React.act(async () => retry().click())
    assert.equal(document.querySelector('.dsh-artifact-placeholder [data-content-state]'), null)
    await React.act(async () => pending.shift().resolve({ found: true, content: kind === 'artifact' ? '# Saved report' : '<h1>Saved page</h1>' }))
    assert.equal(state(), null)
    const readable = document.querySelector(kind === 'artifact' ? '.dsh-artifact-markdown' : '.dsh-live-preview')
    assert.ok(readable, 'recovery retains the available result beside actual progress')
    await show('completed', file)
    assert.equal(document.querySelector('[data-execution-log]'), null)
    assert.equal(document.querySelector(kind === 'artifact' ? '.dsh-artifact-markdown' : '.dsh-live-preview'), readable, 'execution settlement keeps the readable result mounted')
    assert.ok(logReads.length > 0 && logReads.every(id => id === 'exact-worker'))
    assert.deepEqual(initial, original)
  } finally { await React.act(async () => view.unmount()) }
})

test('live preview empty/loading/error states leave tuning and canonical inputs untouched', async () => {
  const view = root(), node = { id: 'preview', live_preview: { file_path: 'preview.file', tokens: [] } }
  let resolve
  const data = { preview: { file: 'bundle/page.html' }, value: 'Unchanged' }, original = structuredClone(data)
  const options = { skill: 'bundle', editable: true, onPanelUpdate: () => assert.fail('no edit expected'),
    readArtifact: () => new Promise(done => { resolve = done }) }
  try {
    await React.act(async () => view.render(localized(React.createElement(PreviewWorkspace, { node, data, options },
      React.createElement('input', { 'aria-label': 'Tuning value', defaultValue: 'Keep' })))))
    assert.equal(state().dataset.contentState, 'loading')
    await React.act(async () => document.querySelector('[aria-expanded]').click())
    assert.equal(document.querySelector('[aria-label="Tuning value"]').value, 'Keep')
    await React.act(async () => resolve({ found: false, content: '' }))
    assert.equal(state().dataset.contentState, 'error')
    assert.equal(document.querySelector('[aria-label="Tuning value"]').value, 'Keep')
    assert.deepEqual(data, original)
  } finally { await React.act(async () => view.unmount()) }
})

test('state CSS reaches DSH module lifetime and Companion/HMR through their shared styles entry', async () => {
  const { dshClientStyles } = await import('../../../scripts/tsdown-client-styles.ts')
  const config = new URL('../tsdown.config.ts', import.meta.url)
  const plugin = dshClientStyles('dsh-design-panel', config.href)
  const id = plugin.resolveId('../panel-content-state.css', new URL('../src/client/owned-styles.ts', import.meta.url).pathname)
  const module = plugin.load.call({ addWatchFile() {} }, id)
  const evaluate = () => dom.window.eval(`(function () { ${module.code.replace('export {};', '')} })()`)
  try {
    evaluate(); evaluate()
    const tags = document.querySelectorAll('style[data-plugin="dsh-design-panel"]')
    assert.equal(tags.length, 1, 'materialization deduplicates this module-owned sheet')
    assert.ok(tags[0].textContent.includes('prefers-reduced-motion'))
    assert.ok(tags[0].textContent.includes('dsh-panel-content-spin'))
    tags[0].remove(); evaluate()
    assert.equal(document.querySelectorAll('style[data-plugin="dsh-design-panel"]').length, 1, 'HMR rematerialization restores the state sheet')
    for (const [path, specifier] of [
      ['../src/client/index.tsx', "import './owned-styles.ts'"],
      ['../../companion/src/client.tsx', "import '../../panel/src/client/owned-styles.ts'"],
    ]) assert.ok(readFileSync(new URL(path, import.meta.url), 'utf8').includes(specifier))
    assert.ok(readFileSync(new URL('../src/client/owned-styles.ts', import.meta.url), 'utf8').includes("import '../panel-content-state.css'"))
  } finally { document.querySelectorAll('style[data-plugin="dsh-design-panel"]').forEach(tag => tag.remove()) }
})
