import test from 'node:test'
import assert from 'node:assert/strict'
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'DOMParser']) globalThis[key] = dom.window[key]
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { NavigationPreview } = await import('../src/navigation-preview.tsx')
test('landed executor artifact and trace are read-only projections before canonical integration', async () => {
  const root = createRoot(document.getElementById('root'))
  const file = 'page_design/pages/a.html', reads = [], logs = []
  const attempt = { invocationId: 'invoke', attemptId: 'a-run', runId: 'worker', artifactId: 'a', artifactKind: 'page_html', artifactFile: file, role: 'worker', phase: 'working', sequence: 1 }
  const options = { skill: 'page_design', artifactFiles: { [file]: 'hash1' }, executionAttempts: [attempt],
    readArtifact: async path => { reads.push(path); return { found: true, content: '<h1>Live artifact</h1>' } },
    readExecutionLog: async (run, after) => { logs.push(run); return { found: true, entries: after === undefined ? [{ seq: 1, message: 'Actual worker trace' }] : [] } },
    onPanelUpdate: () => assert.fail('preview must never write canonical state'),
  }
  const show = async (path, overrides = {}) => React.act(async () => root.render(React.createElement(NavigationPreview, {
    artifactId: 'a', artifactKind: 'page_html', title: 'Page', path, options: { ...options, ...overrides },
  })))
  try {
    await show(null)
    assert.ok(reads.includes(file))
    assert.ok(logs.includes('worker'))
    assert.match(document.body.textContent, /Actual worker trace/)
    assert.equal(document.querySelector('[data-execution-status]').dataset.executionStatus, 'working')
    const count = reads.length
    await show('../escape.html')
    assert.equal(reads.length, count, 'invalid explicit ref must not fall back or read')
    await show(null, { artifactFiles: {} })
    assert.equal(reads.length, count, 'unlanded planned path must not be fetched')
    await show(null, { artifactFiles: { 'other/pages/a.html': 'hash' }, executionAttempts: [{ ...attempt, artifactFile: 'other/pages/a.html' }] })
    assert.equal(reads.length, count, 'executor metadata must not grant cross-Bundle HTML access')
    await React.act(async () => root.render(React.createElement(NavigationPreview, {
      artifactId: 'a', artifactKind: 'page_html', title: 'Thumbnail', path: file, options, thumbnail: true,
    })))
    const thumbnail = document.querySelector('.dsh-navigation-thumbnail iframe')
    assert.ok(thumbnail, 'landed HTML is reused for the map thumbnail')
    assert.equal(thumbnail.getAttribute('sandbox'), 'allow-scripts')
    assert.equal(thumbnail.tabIndex, -1)
    assert.equal(thumbnail.getAttribute('aria-hidden'), 'true')
    assert.equal(thumbnail.getAttribute('loading'), 'lazy')
    assert.ok(thumbnail.srcdoc.includes("script-src 'unsafe-inline'"))
    for (const directive of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "default-src 'none'"]) {
      assert.ok(thumbnail.srcdoc.includes(directive), directive)
    }
    assert.ok(!thumbnail.srcdoc.includes('design-preview:variables'), 'this fixture receives no injected host bridge')
    assert.ok(thumbnail.srcdoc.includes('Live artifact'))
    assert.equal(document.querySelector('.dsh-navigation-thumbnail button'), null)
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
