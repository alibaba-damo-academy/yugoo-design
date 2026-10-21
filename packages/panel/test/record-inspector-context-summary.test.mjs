import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')

test('inspector summaries omit only collections covered by a matching selected-parent editor', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'evidence_workbook', fields: [
    { key: 'title', label: 'Title', control: 'text', applies_to: ['parents', 'children', 'notes', 'others'] },
    { key: 'parent_ref', control: 'record_select', options_from_section: 'parents', hidden: true, applies_to: ['children', 'notes'] },
    { key: 'other_ref', control: 'record_select', options_from_section: 'others', hidden: true, applies_to: ['children'] },
  ], sections: [
    { id: 'parents', title: 'Parents' }, { id: 'others', title: 'Others' },
    { id: 'children', title: 'Children', navigation: 'contextual' },
    { id: 'notes', title: 'Notes', navigation: 'contextual' },
  ] }
  const data = { parents: { p: { title: 'Parent' } }, others: { o: { title: 'Other parent' } },
    children: { c: { title: 'Child', parent_ref: 'p', other_ref: 'o' } },
    notes: { n: { title: 'Note', parent_ref: 'p' } } }
  const original = structuredClone(data)
  const editor = reference => ({ component: 'record_related_editor', id: 'child-editor', title: 'Full child editor', source: 'children', bindings: { reference } })
  const show = children => React.act(async () => root.render(renderNode({
    component: 'record_workspace', id: 'workspace', sources: ['parents', 'others', 'children', 'notes'], children: [
      { component: 'record_inspector', id: 'inspector', children },
    ],
  }, manifest, data, { editable: false, locale: 'en-US' })))
  const summary = () => document.querySelector('.dsh-record-context-summary')
  try {
    await show([editor('parent_ref')])
    assert.equal(document.querySelectorAll('.dsh-record-related-editor').length, 1)
    assert.equal(document.querySelectorAll('.dsh-record-related-editor [data-record="c"]').length, 1)
    assert.doesNotMatch(summary().textContent, /Children/, 'full editor must not be followed by duplicate child summary')
    assert.match(summary().textContent, /Notes/, 'uncovered contextual collection remains discoverable')
    await show([])
    assert.match(summary().textContent, /Children/)
    assert.match(summary().textContent, /Notes/)
    await show([editor('other_ref')])
    assert.equal(document.querySelector('.dsh-record-related-editor'), null, 'editor bound to another parent is not displayed')
    assert.match(summary().textContent, /Children/, 'nonmatching reference cannot suppress summary')
    await React.act(async () => document.querySelector('button[aria-label="Other parent"]').click())
    assert.equal(document.querySelectorAll('.dsh-record-related-editor').length, 1)
    assert.equal(summary(), null, 'matching editor replaces summary for the newly selected parent')
    assert.deepEqual(data, original, 'presentation deduplication cannot write canonical records')
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
