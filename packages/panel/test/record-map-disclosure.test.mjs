import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react'); globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { RecordMap } = await import('../src/record-map.tsx')
const field = { key: 'entries', label: 'Entries', row_name: 'Entry', control: 'record_map', id_field: 'id',
  order_field: 'entry_order', item_label_field: 'name', item_collapsible: true,
  item_defaults: { name: '' }, item_fields: [{ key: 'name', control: 'text' }] }
const initial = { entries: { one: { id: 'one', name: 'First' }, two: { id: 'two', name: 'Second' } },
  entry_order: ['one', 'two'], unrelated: 'Keep' }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function change(action = () => {}) {
  await React.act(async () => { action(); await tick() })
  await React.act(async () => { await tick() })
}
async function mount(editable = true) {
  const root = createRoot(document.getElementById('root')), writes = []
  let current
  function Harness() {
    const [record, setRecord] = React.useState(() => structuredClone(initial)); current = record
    return React.createElement(RecordMap, { field, record, editable, onPatch: patch => {
      writes.push(patch); setRecord(previous => ({ ...previous, ...patch }))
    }, renderItem: (id, value) => React.createElement(React.Fragment, null,
      React.createElement('input', { 'aria-label': `Draft ${id}`, defaultValue: value.name }),
      React.createElement('details', null, React.createElement('summary', null, 'Nested context'), 'Keep context')) })
  }
  await change(() => root.render(React.createElement(Harness)))
  return { root, writes, value: () => current }
}
const entry = id => document.querySelector(`[data-child-record="${id}"]`)
const summary = id => entry(id).querySelector(':scope > summary')
const remove = id => summary(id).querySelector('.dsh-record-map-actions button:last-child')

test('native record headings end with the glyph and keep local drafts while switching records', async () => {
  const fixture = await mount()
  try {
    assert.equal(entry('one').tagName, 'DETAILS')
    assert.equal(entry('one').open, true)
    assert.equal(entry('two').open, false)
    for (const id of ['one', 'two']) {
      const heading = summary(id)
      assert.ok(heading.lastElementChild.matches('svg.dsh-panel-disclosure-icon'))
      assert.equal(heading.querySelector('.dsh-record-map-actions').nextElementSibling, heading.lastElementChild)
      assert.equal(heading.querySelector('button button'), null)
    }
    const draft = entry('one').querySelector('input'); draft.value = 'Unfinished local text'
    await change(() => summary('one').click())
    assert.equal(entry('one').open, false)
    assert.equal(entry('one').querySelector('input'), draft)
    await change(() => summary('two').click())
    assert.equal(entry('two').open, true, 'the old record closing event must not clear the new selection')
    await change(() => summary('one').click())
    assert.equal(entry('one').open, true)
    assert.equal(entry('two').open, false)
    assert.equal(entry('one').querySelector('input').value, 'Unfinished local text')
    await change(() => entry('one').querySelector('details').dispatchEvent(new window.Event('toggle', { bubbles: true })))
    assert.equal(entry('one').open, true, 'nested toggle events do not control their parent')
    assert.equal(fixture.writes.length, 0)
  } finally { await React.act(async () => fixture.root.unmount()) }
})

test('summary actions preserve canonical order, add selection and deletion recovery without folding', async () => {
  const fixture = await mount()
  try {
    await change(() => summary('two').click())
    await change(() => summary('two').querySelector('.dsh-record-map-actions button').click())
    assert.deepEqual(fixture.value().entry_order, ['two', 'one'])
    assert.equal(entry('two').open, true)
    await change(() => remove('two').click())
    assert.equal(entry('two'), null)
    assert.equal(entry('one').open, true)
    await change(() => document.querySelector('.dsh-record-map-add').click())
    const added = fixture.value().entry_order.at(-1)
    assert.notEqual(added, 'one')
    assert.equal(entry(added).open, true)
    assert.equal(entry('one').open, false)
    await change(() => remove('one').click())
    assert.equal(entry(added).open, true, 'deleting a closed record keeps the current selection')
    await change(() => remove(added).click())
    assert.deepEqual(fixture.value().entries, {})
    assert.deepEqual(fixture.value().entry_order, [])
    assert.equal(fixture.value().unrelated, 'Keep')
    assert.ok(document.querySelector('.dsh-record-map-add'))
  } finally { await React.act(async () => fixture.root.unmount()) }
})

test('read-only records retain native disclosure without mutation controls', async () => {
  const fixture = await mount(false)
  try {
    assert.equal(document.querySelector('button'), null)
    await change(() => summary('two').click())
    assert.equal(entry('two').open, true)
    assert.equal(entry('one').open, false)
    assert.deepEqual(fixture.value(), initial)
    assert.equal(fixture.writes.length, 0)
  } finally { await React.act(async () => fixture.root.unmount()) }
})
