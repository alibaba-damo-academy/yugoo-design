import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { DiagramWorkspace } = await import('../src/diagram-workspace.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('diagram outline separates expansion and selection, creates within the chosen parent and retains unassigned records', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'processes', title: 'Processes', item_name: 'Process', order: 'process_order', create: { defaults: { title: 'New process' } } },
    { id: 'steps', title: 'Steps', item_name: 'Step', order: 'step_order', create: { defaults: { title: 'New step' } } },
  ], fields: [] }
  const node = { component: 'diagram_workspace', id: 'flows', source: 'processes', diagram: {
    format: 'bpmn', file_field: 'file', label_field: 'title', artifact_kind: 'diagram',
    inspector: { process_sections: ['processes'], nodes: { source: 'steps', process_field: 'process', element_field: 'element', label_field: 'title', sections: ['steps'] } },
  } }
  let data = { processes: { first: { title: 'First process' }, second: { title: 'Second process' } }, process_order: ['first', 'second'],
    steps: { a: { title: 'First step', process: 'first' }, b: { title: 'Second step', process: 'second' }, loose: { title: 'Unassigned step', process: 'missing' } },
    step_order: ['a', 'b', 'loose'], unrelated: { preserve: true } }
  const original = structuredClone(data), updates = []
  const show = async (editable = true) => React.act(async () => root.render(React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(DiagramWorkspace, {
    manifest, node, data, options: { editable, onPanelUpdate: value => updates.push(value) },
    render: (id, section) => React.createElement('p', { 'data-reading': `${section}:${id}` }, `${section}:${id}`),
  }))))
  const nav = () => document.querySelector('nav')
  const item = label => [...nav().querySelectorAll('.dsh-panel-workspace-tree-item')].find(e => e.textContent.trim() === label)
  const record = label => item(label).closest('.dsh-panel-workspace-tree-record')
  const toggle = label => record(label).querySelector('button[aria-expanded]')
  const click = async element => React.act(async () => { element.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
  const reading = () => document.querySelector('.dsh-diagram-inspector [data-reading]')?.dataset.reading
  try {
    await show()
    assert.equal(reading(), 'processes:first')
    await click(toggle('First process'))
    assert.equal(item('First step'), undefined)
    assert.equal(reading(), 'processes:first', 'collapsing does not change the edited record')
    await click(toggle('Second process'))
    assert.equal(reading(), 'processes:first', 'expanding another process does not select it')
    await click(item('Second step'))
    assert.equal(reading(), 'steps:b', 'selecting a child in another process retains that child')
    assert.equal(item('Second step').getAttribute('aria-current'), 'page')
    assert.match(document.querySelector('.dsh-diagram-heading strong').textContent, /Second process/)
    assert.deepEqual(data, original); assert.equal(updates.length, 0)

    await click(toggle('First process'))
    await click(record('First process').querySelector('.dsh-panel-workspace-tree-add'))
    assert.equal(updates.length, 1)
    const created = Object.keys(updates[0].steps).find(id => !Object.hasOwn(data.steps, id))
    assert.ok(created)
    assert.equal(updates[0].steps[created].process, 'first', 'add belongs to its expanded parent, not the previous selection')
    assert.deepEqual(updates[0].steps.b, original.steps.b)
    assert.deepEqual(updates[0].step_order, [...original.step_order, created])
    data = { ...data, ...updates[0] }; await show()
    assert.equal(reading(), `steps:${created}`)
    assert.equal(item('New step').getAttribute('aria-current'), 'page')
    assert.deepEqual(data.unrelated, original.unrelated)

    await click(item('Unassigned step'))
    assert.equal(reading(), 'steps:loose')
    await click(nav().querySelector('.dsh-panel-workspace-tree-group-toggle'))
    assert.equal(item('Unassigned step'), undefined)
    assert.equal(reading(), 'steps:loose', 'unassigned group collapse retains the open record')
    await click(nav().querySelector('.dsh-panel-workspace-tree-group-toggle'))
    assert.ok(item('Unassigned step'))
    await show(false)
    assert.equal(document.querySelector('.dsh-panel-workspace-tree-add'), null, 'read-only mode offers no add actions')
    assert.equal(updates.length, 1)
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
