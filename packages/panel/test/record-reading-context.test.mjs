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
const action = text => [...document.querySelectorAll('.dsh-record-board-actions button')].find(button => button.textContent === text)
const type = async text => React.act(async () => {
  const input = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, text)
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
})

test('reading-card input survives navigation; only explicit Save commits, with Cancel, readonly and stale guards retained', async () => {
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
  const show = (editable = true) => React.act(async () => root.render(renderManifest(manifest, data, {
    locale: 'en-US', editable,
    onPanelUpdate: next => { updates.push(next); data = applyPanelUpdatesToDraft(data, next) },
  })))
  try {
    assert.deepEqual(validatePanelManifest(manifest), [])
    await show()
    await click(document.querySelector('[data-board-record="a"] .dsh-record-board-actions button'))
    await type('Unsubmitted Alpha revision')
    await click(nav('Beta'))
    assert.equal(document.querySelector('textarea'), null, 'another record never inherits the input')
    await click(nav('Alpha'))
    assert.equal(document.querySelector('textarea').value, 'Unsubmitted Alpha revision')
    assert.deepEqual(data, before)
    assert.equal(updates.length, 0, 'navigation cannot implicitly commit an editor')
    await show(false)
    assert.equal(document.querySelector('textarea').disabled, true)
    assert.equal(action('Save').disabled, true)
    await show()
    await click(nav('Beta'))
    data.sections.items.records.a.details.summary = 'External Alpha revision'
    await show()
    await click(nav('Alpha'))
    assert.equal(document.querySelector('textarea').value, 'Unsubmitted Alpha revision')
    assert.ok(document.querySelector('[role="alert"]'))
    assert.equal(action('Save').disabled, true, 'stale input cannot overwrite a newer source')
    await click(action('Cancel'))
    assert.equal(document.querySelector('textarea'), null)
    assert.equal(document.querySelector('.dsh-record-board-description').textContent, 'External Alpha revision')
    assert.equal(updates.length, 0)
    await click(document.querySelector('[data-board-record="a"] .dsh-record-board-actions button'))
    await type('Accepted Alpha revision')
    await click(nav('Beta'))
    await click(nav('Alpha'))
    await click(action('Save'))
    await show()
    assert.equal(updates.length, 1)
    assert.equal(data.sections.items.records.a.details.summary, 'Accepted Alpha revision')
    assert.deepEqual(data.sections.items.records.a.source_refs, ['doc:1'])
    assert.deepEqual(data.sections.items.records.b, before.sections.items.records.b)
    await click(nav('Beta'))
    await click(nav('Alpha'))
    assert.equal(document.querySelector('textarea'), null, 'Save clears transient input')
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
