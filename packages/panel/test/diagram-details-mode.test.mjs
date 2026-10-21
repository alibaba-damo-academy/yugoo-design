import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
if (!process.execArgv.includes('--experimental-test-module-mocks')) {
  test('mounted diagram details mode contract', () => {
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--experimental-test-module-mocks', '--test', fileURLToPath(import.meta.url)], { encoding: 'utf8', env, timeout: 30000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /# pass 1/)
  })
} else {
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
let rejectFlush = false, serializations = 0
const instances = []
class Runtime {
  constructor() { this.events = {}; instances.push(this) }
  async importXML() {}
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
