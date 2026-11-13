import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
if (!process.execArgv.includes('--experimental-test-module-mocks')) {
  test('mounted diagram details mode contract', () => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { encoding: 'utf8', env, timeout: 30000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /# pass 3/)
  })
} else {
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
let rejectFlush = false, serializations = 0, importError = ''
const instances = []
class Runtime {
  constructor() { this.events = {}; instances.push(this) }
  async importXML() { if (importError) throw Error(importError) }
  on(event, callback) { this.events[event] = callback }
  get(name) {
    if (name === 'elementRegistry') return { getAll: () => [] }
    if (name === 'directEditing') return { complete: () => this.events['commandStack.changed']?.(), getValue: () => '' }
    return {}
  }
  async saveXML() { serializations++; if (rejectFlush) throw Error('TEST serialization failure'); return { xml: '<definitions />' } }
  destroy() {}
}
// Mock only the external diagram engine, not DiagramWorkspace or BpmnSurface.
mock.module(new URL('../src/bpmn-runtime-loader.ts', import.meta.url).href, {
  namedExports: { loadBpmnRuntime: async () => ({ Modeler: Runtime, NavigatedViewer: Runtime }) },
})
mock.module(new URL('../src/bpmn-styles-loader.ts', import.meta.url).href, {
  namedExports: { loadBpmnStyles: async () => {} },
})
const { DiagramWorkspace } = await import('../src/diagram-workspace.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('renderer readiness places active progress with the placeholder and preserves a readable canvas', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const file = 'synthetic/a.bpmn'
  const laidOut = readFileSync(new URL('fixtures/declarative-flow/P-001.bpmn', import.meta.url), 'utf8')
  const structure = laidOut.replace(/<bpmndi:BPMNDiagram[\s\S]*?<\/bpmndi:BPMNDiagram>/u, '')
  let xml = structure, revision = 'structure'
  const data = { items: { a: { title: 'First', file } }, order: ['a'] }, original = structuredClone(data)
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items', order: 'order' }], fields: [] }
  const node = { component: 'diagram_workspace', id: 'diagrams', source: 'items', diagram: {
    format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'test_diagram',
  } }
  const logRequests = [], staged = []
  const readArtifact = async () => ({ found: true, content: xml })
  const readExecutionLog = async runId => {
    logRequests.push(runId)
    return { found: true, revision: 'one', entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: 'Writing this process' }] }
  }
  const show = (phase = 'working') => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(DiagramWorkspace, {
    node, manifest, data, options: { skill: 'synthetic', editable: true, artifactFiles: { [file]: revision }, readArtifact, readExecutionLog,
      executionAttempts: [{ artifactId: 'a', artifactFile: file, artifactKind: 'test_diagram', invocationId: 'current',
        attemptId: 'one', runId: 'exact-flow-run', sequence: 1, phase, role: 'worker' }],
      registerBeforeSave: () => () => {}, onStageArtifact: value => staged.push(value) },
    render: () => React.createElement('p', null, 'Details'),
  }))))
  try {
    // Only the external engine's import outcome is mocked. This is not a
    // real BPMN renderer or native-host visual acceptance test.
    importError = 'no diagram to display'
    await show()
    assert.equal(container.querySelectorAll('.dsh-artifact-placeholder [data-content-state]').length, 0, 'structural generation has one actual progress surface')
    assert.ok(container.querySelector('.dsh-artifact-placeholder [data-execution-log]'), 'the exact active log belongs to the centered group')
    assert.equal(container.querySelectorAll('[data-execution-log]').length, 1)
    assert.equal(container.querySelector('[role="alert"]'), null, 'a first structural draft is still generating')
    assert.equal(container.querySelector('.dsh-bpmn-canvas').hidden, true)
    assert.equal(container.querySelector('.dsh-bpmn-toolbar'), null)

    importError = ''; xml = laidOut; revision = 'layout'
    await show()
    assert.equal(container.querySelector('.dsh-artifact-placeholder'), null)
    const canvas = container.querySelector('.dsh-bpmn-canvas'), runtimeCount = instances.length
    assert.equal(canvas.hidden, false)
    assert.ok(container.querySelector('.dsh-bpmn-surface > [data-execution-log]'))
    assert.ok(container.querySelector('.dsh-bpmn-toolbar'))
    await show('queued')
    assert.equal(container.querySelector('.dsh-bpmn-canvas'), canvas, 'active status changes keep the same readable canvas')
    assert.equal(instances.length, runtimeCount, 'activity does not recreate the native renderer')
    await show('completed')
    assert.equal(container.querySelector('.dsh-bpmn-canvas'), canvas)
    assert.equal(container.querySelector('[data-execution-log]'), null, 'settlement still releases the automatic log')

    importError = 'unparsable XML'; revision = 'parse-error'
    await show('working')
    assert.match(container.querySelector('.dsh-artifact-placeholder [role="alert"]').textContent, /unparsable XML/u, 'active generation cannot suppress real parser failures')

    importError = 'no diagram to display'; xml = structure; revision = 'invalid-final'
    await show('failed')
    assert.match(container.querySelector('.dsh-artifact-placeholder [role="alert"]').textContent, /no diagram to display/u)
    assert.equal(container.querySelector('[data-execution-log]'), null)
    assert.ok(logRequests.length > 0 && logRequests.every(id => id === 'exact-flow-run'))
    assert.deepEqual(data, original); assert.deepEqual(staged, [])
  } finally { importError = ''; await React.act(async () => root.unmount()) }
})

test('diagram waiting, reader failure and retry remain distinct from executor activity', async () => {
  const container = document.getElementById('root'), root = createRoot(container), pending = []
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items' }], fields: [] }
  const node = { component: 'diagram_workspace', id: 'diagrams', source: 'items', diagram: { format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'test_diagram' } }
  const data = { items: { a: { title: 'Process' } } }, original = structuredClone(data)
  const readArtifact = () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  const readExecutionLog = async () => ({ found: true, revision: 'one', entries: [{ seq: 1, timestamp: 1, eventType: 'message', message: 'Building process' }] })
  const show = (phase, file, reader = readExecutionLog, contentReader = readArtifact) => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(DiagramWorkspace, {
    node, manifest, data: file ? { items: { a: { title: 'Process', file } } } : data,
    options: { skill: 'synthetic', readArtifact: contentReader, readExecutionLog: reader, executionAttempts: [{ projectId: 'test', artifactId: 'a', artifactKind: 'test_diagram', invocationId: 'generation', attemptId: 'worker', runId: 'exact-flow', role: 'worker', phase, sequence: 1, timestamp: 1 }] },
    render: () => React.createElement('p', null, 'Details'),
  }))))
  try {
    for (const phase of ['queued', 'working']) {
      await show(phase)
      assert.equal(container.querySelectorAll('.dsh-artifact-placeholder [data-content-state]').length, 0, 'a not-yet-published diagram is still generating')
      assert.equal(container.querySelectorAll('.dsh-artifact-placeholder [data-execution-log]').length, 1)
    }
    await show('working', undefined, null)
    assert.equal(container.querySelector('[data-content-state]').dataset.contentState, 'loading')
    assert.equal(container.querySelectorAll('[data-content-state]').length, 1)
    await show('cancelled')
    assert.equal(container.querySelector('[data-execution-log]'), null)
    assert.notEqual(container.querySelector('[data-content-state]').dataset.contentState, 'loading')
    await show('working', 'synthetic/a.bpmn', readExecutionLog, null)
    assert.equal(container.querySelector('[data-content-state]').dataset.contentState, 'unavailable')
    await show('working', 'synthetic/a.bpmn')
    await React.act(async () => pending.shift().reject(new Error('Network read failed')))
    assert.match(container.querySelector('[role="alert"]').textContent, /Network read failed/u)
    await React.act(async () => container.querySelector('.dsh-artifact-placeholder button').click())
    assert.equal(container.querySelectorAll('.dsh-artifact-placeholder [data-content-state]').length, 0)
    await React.act(async () => pending.shift().resolve({ found: true, content: readFileSync(new URL('fixtures/declarative-flow/P-001.bpmn', import.meta.url), 'utf8') }))
    const canvas = container.querySelector('.dsh-bpmn-canvas')
    assert.equal(canvas.hidden, false)
    await show('completed', 'synthetic/a.bpmn')
    assert.equal(container.querySelector('.dsh-bpmn-canvas'), canvas)
    assert.equal(container.querySelector('[data-execution-log]'), null)
    assert.deepEqual(data, original)
  } finally { await React.act(async () => root.unmount()) }
})

test('details exclusively replace canvas, leave edit mode, collapse on selection and fence failed flush', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const data = { items: { a: { title: 'First', file: 'synthetic/a.bpmn', description: 'Summary A' }, b: { title: 'Second', file: 'synthetic/b.bpmn', description: 'Summary B' } }, order: ['a', 'b'] }
  const original = structuredClone(data), staged = []
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items', order: 'order' }], fields: [] }
  const node = { component: 'diagram_workspace', id: 'diagrams', source: 'items', diagram: { format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'test_diagram', summary_fields: ['description'] } }
  const click = selector => React.act(async () => { container.querySelector(selector).click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const details = () => container.querySelector('.dsh-diagram-heading button[aria-expanded]')
  const edit = () => container.querySelector('.dsh-diagram-heading button[aria-pressed]')
  try {
    await React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(DiagramWorkspace, {
      node, manifest, data, options: { skill: 'synthetic', editable: true, artifactFiles: { 'synthetic/a.bpmn': 'hash-a', 'synthetic/b.bpmn': 'hash-b' },
        readArtifact: async () => ({ found: true, content: '<definitions />' }),
        registerBeforeSave: () => () => {}, onStageArtifact: value => staged.push(value) },
      render: id => React.createElement('p', null, `Details ${id}`),
    }))))
    await click('.dsh-diagram-heading button[aria-pressed]')
    assert.equal(edit().getAttribute('aria-pressed'), 'true')
    await click('.dsh-diagram-heading button[aria-expanded]')
    assert.equal(details().getAttribute('aria-expanded'), 'true')
    assert.equal(edit().disabled, true)
    assert.equal(edit().getAttribute('aria-pressed'), 'false')
    assert.equal(container.querySelector('.dsh-diagram-stage'), null)
    assert.equal(container.querySelector('.dsh-diagram-summary'), null)
    assert.match(container.querySelector('.dsh-diagram-details').textContent, /Details a/)
    assert.equal(staged.length, 1, 'pending editor is serialized before it is unmounted')
    await React.act(async () => { [...container.querySelectorAll('.dsh-panel-workspace-tree-item')].find(x => x.textContent.includes('Second')).click() })
    assert.equal(details().getAttribute('aria-expanded'), 'false')
    assert.ok(container.querySelector('.dsh-diagram-stage'))
    assert.match(container.querySelector('.dsh-diagram-summary').textContent, /Summary B/)
    await click('.dsh-diagram-heading button[aria-pressed]')
    rejectFlush = true
    await click('.dsh-diagram-heading button[aria-expanded]')
    assert.equal(details().getAttribute('aria-expanded'), 'false', 'failed flush cannot enter details')
    assert.equal(edit().getAttribute('aria-pressed'), 'true', 'editor stays mounted on failure')
    assert.ok(container.querySelector('.dsh-diagram-stage'))
    assert.match(container.querySelector('[role=alert]').textContent, /TEST serialization failure/)
    await React.act(async () => { [...container.querySelectorAll('.dsh-panel-workspace-tree-item')].find(x => x.textContent.includes('First')).click(); await new Promise(resolve => setTimeout(resolve, 0)) })
    assert.match(container.querySelector('.dsh-diagram-heading strong').textContent, /Second/, 'failed flush cannot switch records')
    assert.equal(edit().getAttribute('aria-pressed'), 'true')
    rejectFlush = false
    await click('.dsh-diagram-heading button[aria-expanded]')
    assert.equal(details().getAttribute('aria-expanded'), 'true')
    assert.equal(container.querySelector('.dsh-diagram-stage'), null)
    assert.deepEqual(data, original)
    assert.ok(serializations >= 3)
  } finally { await React.act(async () => root.unmount()); dom.window.close(); mock.restoreAll() }
})
}
