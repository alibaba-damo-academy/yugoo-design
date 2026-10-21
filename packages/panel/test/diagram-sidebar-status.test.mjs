import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFile } from 'node:fs/promises'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
const sheet = dom.window.document.createElement('style')
sheet.textContent = await readFile(new URL('../src/visual-components.css', import.meta.url), 'utf8')
dom.window.document.head.append(sheet)
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { DiagramWorkspace } = await import('../src/diagram-workspace.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('diagram sidebar marks observed artifacts, not refs alone; active and failed attempts override green', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'evidence_workbook', sections: [{ id: 'items', title: 'Items', order: 'order' }], fields: [] }
  const node = { component: 'diagram_workspace', id: 'diagrams', source: 'items', diagram: {
    format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'test_diagram', order_only: true,
  } }
  const file = 'synthetic/a.bpmn'
  const data = { items: { a: { title: 'Saved', file }, b: { title: 'Missing', file: 'synthetic/b.bpmn' },
    c: { title: 'Unsafe', file: '../outside.bpmn' } }, order: ['a', 'b', 'c'] }
  const original = structuredClone(data)
  const show = (attempts = [], locale = 'zh-CN', files = { [file]: 'actual-hash', '../outside.bpmn': 'outside-hash' }) => React.act(async () => root.render(
    React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(DiagramWorkspace, {
      node, manifest, data, options: { skill: 'synthetic', artifactFiles: files, executionAttempts: attempts },
      render: () => React.createElement('p', null, 'Details'),
    }))))
  const markers = () => [...document.querySelectorAll('.dsh-panel-workspace-tree-item [data-execution-status]')]
  const attempt = phase => ({ artifactId: 'a', artifactFile: file, artifactKind: 'test_diagram',
    invocationId: 'current', attemptId: 'one', sequence: 1, phase, role: 'worker' })
  try {
    await show()
    assert.deepEqual(markers().map(node => node.dataset.executionStatus), ['completed', 'pending', 'pending'])
    const row = markers()[0].closest('button'), title = row.firstElementChild
    assert.equal(title.textContent.trim(), 'Saved')
    assert.equal(row.lastElementChild.firstElementChild, markers()[0], 'shared trailing slot keeps status at the right edge')
    const titleStyle = window.getComputedStyle(title)
    assert.equal(titleStyle.flex, '1 1 0%')
    assert.equal(titleStyle.minWidth, '0px')
    assert.equal(titleStyle.whiteSpace, 'normal', 'long titles wrap without displacing the trailing status')
    assert.equal(titleStyle.overflowWrap, 'anywhere')
    assert.equal(markers()[0].style.flexShrink, '0')
    assert.match(markers()[0].firstElementChild.style.background, /--ds-success-6/)
    assert.equal(markers()[0].getAttribute('aria-label'), '可阅读')
    await show([attempt('working')])
    assert.equal(markers()[0].dataset.executionStatus, 'working')
    assert.equal(markers()[0].getAttribute('role'), 'status')
    await show([attempt('failed')])
    assert.equal(markers()[0].dataset.executionStatus, 'failed', 'old file cannot conceal failed regeneration')
    await show([attempt('queued')])
    assert.equal(markers()[0].dataset.executionStatus, 'queued')
    await show([attempt('completed')], 'en-US')
    assert.equal(markers()[0].dataset.executionStatus, 'completed')
    assert.equal(markers()[0].getAttribute('aria-label'), 'Available')
    await show([attempt('completed')], 'en-US', {})
    assert.equal(markers()[0].dataset.executionStatus, 'failed', 'completion event without observed output is not green')
    assert.deepEqual(data, original, 'status projection does not alter canonical Design Files')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
