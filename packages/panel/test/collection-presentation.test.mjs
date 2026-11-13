import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { installSelectDom } from './select-interaction.mjs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
installSelectDom(dom.window)
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderManifest, applyPanelUpdatesToDraft } = await import('../src/interpreter.ts')
const { collectionFieldCount } = await import('../src/record-state.ts')

test('collection counts represent actual children rather than filled values or selected choices', () => {
  assert.equal(collectionFieldCount({ control: 'list' }, ['First', '', 'First']), 3)
  assert.equal(collectionFieldCount({ control: 'record_map' }, { a: {}, b: { name: '' } }), 2)
  assert.equal(collectionFieldCount({ control: 'rows' }, []), 0)
  assert.equal(collectionFieldCount({ control: 'multi_select' }, ['a', 'b']), undefined)
  assert.equal(collectionFieldCount({ control: 'textarea' }, 'Long explanation'), undefined)
})

test('shared list and row actions preserve complete values and unrelated data; unordered maps do not gain move controls', async () => {
  const manifest = { version: 1, panel_kind: 'evidence_workbook',
    sections: [{ id: 'items', title: 'Items', add_mode: 'none' }],
    fields: [
      { key: 'notes', label: 'Notes', control: 'list', applies_to: ['items'] },
      { key: 'checks', label: 'Checks', control: 'rows', columns: [{ key: 'name', label: 'Name', control: 'text' }], applies_to: ['items'] },
      { key: 'unordered', label: 'Unordered', control: 'record_map', columns: [{ key: 'name', label: 'Name', control: 'text' }], applies_to: ['items'] },
    ], ui: { component: 'record_form', id: 'form', source: 'items' } }
  let data = { items: { one: { title: 'Current', notes: ['First\nwith context', '', 'First\nwith context'],
    checks: [{ name: 'First check', provenance: 'Keep A' }, { name: 'Second check', provenance: 'Keep B' }],
    unordered: { a: { name: 'Alpha' }, b: { name: 'Beta' } }, source: 'Keep source' } } }
  const initial = structuredClone(data), root = createRoot(document.getElementById('root'))
  let editable = true
  const render = () => root.render(renderManifest(manifest, data, { editable, locale: 'en-US',
    onPanelUpdate: updates => { data = applyPanelUpdatesToDraft(data, updates); render() } }))
  const click = element => React.act(async () => element.click())
  try {
    await React.act(render)
    assert.deepEqual([...document.querySelectorAll('.dsh-panel-collection-count')].map(node => node.textContent), ['(3)', '(2)', '(2)'])
    const list = () => document.querySelector('[data-field="notes"]')
    assert.equal(list().querySelector('.dsh-string-list-item button').disabled, true)
    await click(list().querySelector('.dsh-string-list-item button[aria-label^="Move down"]'))
    assert.deepEqual(data.items.one.notes, ['', 'First\nwith context', 'First\nwith context'])
    assert.deepEqual(data.items.one.checks, initial.items.one.checks)
    const rows = () => document.querySelector('[data-field="checks"] tbody')
    await click(rows().querySelector('button[aria-label^="Move down"]'))
    assert.deepEqual(data.items.one.checks, [...initial.items.one.checks].reverse())
    assert.equal(data.items.one.source, 'Keep source')
    assert.equal(document.querySelector('[data-record-map="unordered"] button[aria-label^="Move"]'), null)
    await click(list().querySelector('.dsh-string-list-item button[aria-label^="Delete"]'))
    assert.deepEqual(data.items.one.notes, ['First\nwith context', 'First\nwith context'])
    assert.equal(list().querySelector('.dsh-panel-collection-count').textContent, '(2)')
    const saved = structuredClone(data)
    editable = false; await React.act(render)
    assert.equal(document.querySelector('.dsh-design-record-actions'), null)
    assert.deepEqual(data, saved)
    assert.equal(document.querySelector('[data-field="checks"] .dsh-panel-collection-count').textContent, '(2)')
    // A real second Kit's typed record declaration uses the same count/actions.
    // This exercises its record form, not graph navigation or a native Host.
    const { readFile } = await import('node:fs/promises')
    const { parsePanelManifest } = await import('../src/dsl.ts')
    const bundle = new URL('../../skills-decision-modeling/bundles/decision_objects/', import.meta.url)
    const actual = parsePanelManifest(await readFile(new URL('panel.yaml', bundle), 'utf8'))
    actual.i18n.messages = { 'en-US': JSON.parse(await readFile(new URL('locales/en-US.json', bundle), 'utf8')) }
    actual.ui = { component: 'record_form', id: 'representative-relation-form', source: 'relations' }
    let foreign = JSON.parse(await readFile(new URL('reference/preview.json', bundle), 'utf8'))
    const retained = structuredClone(foreign)
    const paint = (editable = true) => root.render(renderManifest(actual, foreign, { locale: 'en-US', editable,
      onPanelUpdate: updates => { foreign = applyPanelUpdatesToDraft(foreign, updates); paint() } }))
    await React.act(() => paint())
    assert.equal(document.querySelector('[data-field="participants"] .dsh-panel-collection-count').textContent, '(2)')
    await click(document.querySelector('[data-record-map="participants"] button[aria-label^="Move down"]'))
    assert.deepEqual(foreign.relations.assignment.participant_order, ['period', 'worker'])
    assert.deepEqual(foreign.relations.assignment.participants, retained.relations.assignment.participants)
    assert.deepEqual(foreign.objects, retained.objects)
    const expectedTitleEdit = structuredClone(foreign)
    expectedTitleEdit.relations.assignment.participants.worker.role = 'Primary decision owner'
    const participantTitle = document.querySelector('[data-record-map="participants"] [data-child-record="worker"] [data-panel-title="editable"]')
    assert.ok(participantTitle, 'another Kit reuses the nested title editor')
    await React.act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(participantTitle, 'Primary decision owner')
      participantTitle.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
    assert.deepEqual(foreign, expectedTitleEdit)
    assert.equal(document.querySelector('[data-record-map="participants"] [data-child-record="worker"] [data-field="role"]'), null)
    await React.act(() => paint(false))
    assert.equal(document.querySelector('[data-record-map="participants"] button[aria-label^="Move"]'), null)
  } finally { await React.act(() => root.unmount()); dom.window.close() }
})
