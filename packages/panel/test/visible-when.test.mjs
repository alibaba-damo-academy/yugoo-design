import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldIsVisible, applyRecordFieldEdit } from '../src/record-state.ts'
import { installSelectDom, chooseSelectValue } from './select-interaction.mjs'

const gate = { all: [{ field: 'source_ref', in: [''] }, { field: 'connection', in: ['existing', 'other'] }] }
const detail = { key: 'detail', control: 'text', visible_when: gate, applies_to: ['items'] }

test('single and conjunctive gates preserve missing, scalar and array matching semantics', () => {
  const accepted = ['', 'show', '1', 'true']
  for (const [value, expected] of [
    [undefined, true], [null, true], ['', true], ['show', true], ['hide', false],
    [1, true], [true, true], [false, false], [[], false],
    [['show', 'hide'], true], [['hide'], false], [[1, true], false], [[null], false],
  ]) {
    const single = { ...detail, visible_when: { field: 'mode', in: accepted } }
    const all = { ...detail, visible_when: { all: [single.visible_when] } }
    const values = { mode: value }
    assert.equal(fieldIsVisible(single, values), expected, `legacy: ${JSON.stringify(value)}`)
    assert.equal(fieldIsVisible(all, values), expected, `all: ${JSON.stringify(value)}`)
  }
  assert.equal(fieldIsVisible({ ...detail, visible_when: { field: 'absent', in: [''] } }, {}), true)
  assert.equal(fieldIsVisible({ ...detail, visible_when: { all: [{ field: 'absent', in: [''] }] } }, {}), true)
})

test('all clauses must match, with hidden fields still hidden and ungated fields still visible', () => {
  for (const source_ref of [undefined, null, '', 'selected', []]) {
    for (const connection of [undefined, '', 'existing', 'other', 'new', ['existing', 'new']]) {
      const values = { source_ref, connection }
      const expected = (source_ref == null || source_ref === '')
        && (connection === 'existing' || connection === 'other' || Array.isArray(connection))
      assert.equal(fieldIsVisible(detail, values), expected, JSON.stringify(values))
      assert.equal(fieldIsVisible({ ...detail, hidden: true }, values), false)
    }
  }
  assert.equal(fieldIsVisible({ key: 'ordinary', control: 'text' }, {}), true)
})

test('visibility edits preserve values unless clearing is explicit and a dependency is edited', () => {
  const panel = { fields: [detail], sections: [{ id: 'items' }] }
  const values = { source_ref: '', connection: 'existing', detail: 'User text', unrelated: 'Keep' }
  const hidden = applyRecordFieldEdit(panel, 'items', values, 'source_ref', 'selected')
  assert.equal(fieldIsVisible(detail, hidden), false)
  assert.equal(hidden.detail, 'User text')
  const restored = applyRecordFieldEdit(panel, 'items', hidden, 'source_ref', undefined)
  assert.equal(fieldIsVisible(detail, restored), true)
  assert.equal(restored.detail, 'User text')
  for (const [control, clear_when_hidden, saved, expected] of [
    ['text', true, 'User text', ''], ['list', true, ['User item'], []], ['select', 'omit', 'saved', undefined],
  ]) {
    const field = { ...detail, control, clear_when_hidden }
    const manifest = { fields: [field], sections: panel.sections }
    const original = { ...values, detail: saved }
    for (const [key, value] of [['source_ref', 'selected'], ['connection', 'new']]) {
      const next = applyRecordFieldEdit(manifest, 'items', original, key, value)
      assert.deepEqual(next.detail, expected)
      if (expected === undefined) assert.equal(Object.hasOwn(next, 'detail'), false)
      assert.deepEqual(original.detail, saved, 'the input record is immutable')
    }
    const stale = { ...original, connection: 'new' }
    assert.deepEqual(applyRecordFieldEdit(manifest, 'items', stale, 'unrelated', 'Edited').detail, saved)
    assert.deepEqual(applyRecordFieldEdit(manifest, 'items', original, 'connection', 'other').detail, saved)
    assert.deepEqual(applyRecordFieldEdit(manifest, 'elsewhere', original, 'source_ref', 'selected').detail, saved)
  }
  assert.equal(values.detail, 'User text')
})

test('rendered record forms hide and restore conjunctive fields without erasing saved content', async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
  installSelectDom(dom.window)
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const React = await import('react'); globalThis.React = React
  const { createRoot } = await import('react-dom/client')
  const { renderNode } = await import('../src/interpreter.ts')
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'items', title: 'Items' }], fields: [
    { key: 'source_ref', label: 'Source', control: 'select', options: [{ value: 'selected', label: 'Selected' }], applies_to: ['items'] },
    { key: 'connection', label: 'Connection', control: 'select', options: ['existing', 'other', 'new'].map(value => ({ value, label: value })), applies_to: ['items'] },
    { ...detail, label: 'Detail' },
  ], ui: { component: 'record_form', id: 'form', source: 'items' } }
  let data = { items: { one: { connection: 'existing', detail: 'Preserved content' } } }, writes = 0
  const show = (editable = true) => React.act(async () => root.render(renderNode(manifest.ui, manifest, data, {
    editable, onPanelUpdate: patch => { data = { ...data, ...patch }; writes++ },
  })))
  const change = async (key, value) => {
    const select = document.querySelector(`[data-field="${key}"] [role="combobox"]`)
    await chooseSelectValue(React, select, value)
    await show()
  }
  const renderedDetail = () => document.querySelector('[data-field="detail"]')
  try {
    await show()
    assert.equal(renderedDetail().querySelector('input').value, 'Preserved content')
    assert.equal(writes, 0, 'mount does not normalize missing dependencies')
    await change('source_ref', 'selected')
    assert.equal(renderedDetail(), null)
    assert.equal(data.items.one.detail, 'Preserved content')
    await change('source_ref', '')
    assert.equal(renderedDetail().querySelector('input').value, 'Preserved content')
    await change('connection', 'new')
    assert.equal(renderedDetail(), null)
    await change('connection', 'other')
    assert.equal(renderedDetail().querySelector('input').value, 'Preserved content')
    const editCount = writes
    await show(false)
    assert.match(renderedDetail().textContent, /Preserved content/)
    assert.equal(renderedDetail().querySelector('input'), null)
    assert.equal(writes, editCount, 'read-only rendering does not write')
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
  }
})
