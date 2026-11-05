import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { validatePanelManifest } from '../../core/src/panel-dsl.ts'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLFormElement', 'Element', 'Node', 'MutationObserver', 'CustomEvent']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
after(() => dom.window.close())
const click = async element => { assert.ok(element); await React.act(async () => element.click()) }
const nav = label => [...document.querySelectorAll('nav button')].find(button => button.getAttribute('aria-label') === label)
const type = async text => React.act(async () => {
  const input = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

test('direct card draft survives navigation and respects global reset, readonly and canonical updates', async () => {
  const manifest = {
    version: 1, panel_kind: 'evidence_workbook',
    sections: [{ id: 'items', title: 'Items', add_mode: 'none', records_path: 'sections.items.records', fields_path: 'details' }],
    fields: [
      { key: 'title', label: 'Name', control: 'text', applies_to: ['items'] },
      { key: 'summary', label: 'Description', control: 'textarea', applies_to: ['items'] },
    ],
    ui: { id: 'workspace', component: 'record_workspace', sources: ['items'], children: [{
      id: 'inspector', component: 'record_inspector', sources: ['items'],
      record_cards: { label: 'title', description: 'summary', details_title: 'Details' },
    }] },
  }
  let data = { sections: { items: { records: {
    a: { id: 'a', source_refs: ['doc:1'], details: { title: 'Alpha', summary: 'Original Alpha' } },
    b: { id: 'b', details: { title: 'Beta', summary: 'Original Beta' } },
  } } } }
  const before = structuredClone(data), updates = []
  const root = createRoot(document.getElementById('root'))
  let editable = true
  const render = () => root.render(renderManifest(manifest, data, {
    locale: 'en-US', editable,
    onPanelUpdate: next => { updates.push(next); data = applyPanelUpdatesToDraft(data, next); render() },
  }))
  const show = () => React.act(render)
  try {
    assert.deepEqual(validatePanelManifest(manifest), [])
    await show()
    assert.equal(document.querySelector('textarea').value, 'Original Alpha')
    await type('Unsubmitted Alpha revision')
    assert.equal(data.sections.items.records.a.details.summary, 'Unsubmitted Alpha revision')
    assert.equal(updates.length, 1, 'typing updates the existing Panel draft directly')
    await click(nav('Beta'))
    assert.equal(document.querySelector('textarea').value, 'Original Beta', 'another record never inherits the input')
    await click(nav('Alpha'))
    assert.equal(document.querySelector('textarea').value, 'Unsubmitted Alpha revision')
    assert.equal(updates.length, 1, 'navigation adds no write')
    editable = false; await show()
    assert.equal(document.querySelector('textarea'), null)
    assert.equal(document.querySelector('.dsh-record-board-description').textContent, 'Unsubmitted Alpha revision')
    assert.equal(document.querySelector('.dsh-record-board-actions'), null, 'readonly cannot submit an editor')
    editable = true; await show()
    await click(nav('Beta'))
    data = structuredClone(before)
    data.sections.items.records.a.details.summary = 'Current canonical Alpha revision'
    await show()
    await click(nav('Alpha'))
    assert.equal(document.querySelector('textarea').value, 'Current canonical Alpha revision', 'no hidden local snapshot overwrites the current Panel draft')
    await type('Accepted Alpha revision')
    assert.equal(updates.length, 2)
    assert.equal(data.sections.items.records.a.details.summary, 'Accepted Alpha revision')
    assert.deepEqual(data.sections.items.records.a.source_refs, ['doc:1'])
    assert.deepEqual(data.sections.items.records.b, before.sections.items.records.b)
    data = structuredClone(before); await show()
    await click(nav('Beta')); await click(nav('Alpha'))
    assert.equal(document.querySelector('textarea').value, 'Original Alpha', 'global draft reset is not revived by navigation')
    assert.equal(updates.length, 2)
  } finally { await React.act(async () => root.unmount()) }
})

test('contextual union parents resolve uniquely; missing and ambiguous references remain reachable without mutation', async () => {
  const manifest = {
    version: 1, panel_kind: 'evidence_workbook',
    sections: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'children', title: 'Children', navigation: 'contextual', add_mode: 'context' }],
    fields: [
      { key: 'title', label: 'Name', control: 'text', applies_to: ['a', 'b', 'children'] },
      { key: 'parent', label: 'Parent', control: 'record_select', options_from_sections: ['a', 'b'], applies_to: ['children'] },
    ],
    ui: { id: 'workspace', component: 'record_workspace', sources: ['a', 'b', 'children'],
      children: [{ id: 'inspector', component: 'record_inspector' }] },
  }
  const data = {
    a: { parentA: { title: 'Parent A' }, duplicate: { title: 'Duplicate A' } },
    b: { parentB: { title: 'Parent B' }, duplicate: { title: 'Duplicate B' } },
    children: {
      validA: { title: 'Child A', parent: 'parentA' }, validB: { title: 'Child B', parent: 'parentB' },
      missing: { title: 'Missing child', parent: 'absent' }, ambiguous: { title: 'Ambiguous child', parent: 'duplicate' },
    },
  }
  const before = structuredClone(data), root = createRoot(document.getElementById('root'))
  try {
    assert.deepEqual(validatePanelManifest(manifest), [])
    await React.act(async () => root.render(renderManifest(manifest, data, { locale: 'en-US', editable: false })))
    const alert = document.querySelector('nav [role="alert"]')
    assert.ok(alert.textContent.includes('Missing child'))
    assert.ok(alert.textContent.includes('Ambiguous child'))
    assert.equal(alert.textContent.includes('Child A'), false)
    assert.equal(alert.textContent.includes('Child B'), false)
    await click(nav('Parent A'))
    assert.ok(nav('Child A'))
    assert.equal(document.querySelector('.dsh-record-context-summary strong').textContent, '1')
    await click(nav('Parent B'))
    assert.ok(nav('Child B'))
    assert.equal(document.querySelector('.dsh-record-context-summary strong').textContent, '1')
    await click(nav('Child B'))
    assert.equal(nav('Child B').getAttribute('aria-current'), 'page')
    for (const title of ['Duplicate A', 'Duplicate B']) {
      await click(nav(title))
      assert.equal(document.querySelector('.dsh-record-context-summary'), null)
    }
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})
