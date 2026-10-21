import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLFormElement', 'HTMLSelectElement', 'Element', 'Node', 'NodeFilter', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event']) globalThis[key] = dom.window[key]
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
dom.window.HTMLElement.prototype.scrollIntoView = function() {}
dom.window.HTMLElement.prototype.hasPointerCapture = () => false
dom.window.HTMLElement.prototype.releasePointerCapture = function() {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { PanelSelect } = await import('../src/panel-select.tsx')
const tick = () => new Promise(resolve => setTimeout(resolve, 30))
const key = async (element, value) => {
  await React.act(() => element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true })))
  // Radix returns focus after the popup's unmount cleanup.
  await React.act(tick)
}

test('shared select preserves controlled values and delegates keyboard selection, disabled options and focus to Radix', async () => {
  const root = createRoot(document.getElementById('root')), writes = []
  let value = 'low'
  const options = [{ value: 'high', label: 'High' }, { value: 'blocked', label: 'Unavailable', disabled: true }, { value: 'low', label: 'Low' }]
  const show = () => root.render(React.createElement(PanelSelect, { 'aria-label': 'Priority', value, options,
    onValueChange(next) { writes.push(next); value = next; show() } }))
  try {
    await React.act(show)
    const trigger = document.querySelector('[role="combobox"]')
    trigger.focus()
    await key(trigger, 'Enter')
    assert.equal(document.querySelector('[role="listbox"]').closest('#root'), null, 'menu escapes workspace clipping')
    assert.equal(document.querySelector('[role="option"][data-disabled]').textContent, 'Unavailable')
    await key(document.activeElement, 'Home')
    await key(document.activeElement, 'Enter')
    assert.deepEqual(writes, ['high'])
    assert.match(trigger.textContent, /High/)
    assert.ok(document.activeElement === trigger, `selection restores keyboard focus (active: ${document.activeElement?.tagName})`)
    await key(trigger, 'Enter')
    await key(document.activeElement, 'ArrowDown')
    assert.match(document.activeElement.textContent, /Low/, 'disabled option is skipped')
    await key(document.activeElement, 'Escape')
    assert.deepEqual(writes, ['high'], 'Escape does not commit a highlighted value')
  } finally { await React.act(() => root.unmount()) }
})

test('empty and unknown values stay exact and disabled controls never open or write', async () => {
  const root = createRoot(document.getElementById('root')), writes = []
  const options = [{ value: '', label: 'None' }, { value: '__ygd_empty__', label: 'Real sentinel-like value' }, { value: 'known', label: 'Known' }]
  let value = 'old value', disabled = false
  const show = () => root.render(React.createElement(PanelSelect, { 'aria-label': 'Choice', value, options, disabled,
    onValueChange(next) { writes.push(next); value = next; show() } }))
  try {
    await React.act(show)
    let trigger = document.querySelector('[role="combobox"]')
    assert.match(trigger.textContent, /old value/)
    await key(trigger, 'Enter')
    assert.equal(document.querySelector('[role="option"][data-disabled]').textContent, 'old value')
    await key(document.activeElement, 'Home')
    await key(document.activeElement, 'Enter')
    assert.deepEqual(writes, [''])
    assert.match(trigger.textContent, /None/)
    await key(trigger, 'Enter')
    await key(document.activeElement, 'ArrowDown')
    await key(document.activeElement, 'Enter')
    assert.deepEqual(writes, ['', '__ygd_empty__'])
    value = ''
    await React.act(() => root.render(React.createElement(PanelSelect, { 'aria-label': 'Blank choice', value,
      options: [{ value: '', label: '' }, { value: 'known', label: 'Known' }], onValueChange: next => writes.push(next) })))
    assert.equal(document.querySelector('[role="combobox"]').textContent, '\u00a0', 'empty label stays visually blank')
    disabled = true
    await React.act(show)
    trigger = document.querySelector('[role="combobox"]')
    assert.equal(trigger.disabled, true)
    await key(trigger, 'Enter')
    await React.act(() => trigger.click())
    assert.equal(document.querySelector('[role="listbox"]'), null)
    assert.deepEqual(writes, ['', '__ygd_empty__'])
  } finally { await React.act(() => root.unmount()) }
})

test('ordinary fields preserve stale labels, required naming, clear semantics and read-only rendering', async () => {
  const { renderManifest } = await import('../src/interpreter.ts')
  const root = createRoot(document.getElementById('root')), writes = []
  const field = { key: 'choice', label: 'Choice', required: true, control: 'select', applies_to: ['items'], options: [{ value: 'known', label: 'Known' }] }
  const panel = { version: 1, panel_kind: 'neutral', sections: [{ id: 'items', title: 'Items' }], fields: [field], ui: { id: 'form', component: 'record_form', source: 'items' } }
  const state = { items: { a: { choice: 'lost', untouched: 'Keep' } } }, original = structuredClone(state)
  const show = editable => root.render(renderManifest(panel, state, { editable, locale: 'en-US', onEdit: edit => writes.push(edit) }))
  try {
    await React.act(() => show(true))
    let trigger = document.querySelector('[role="combobox"]')
    assert.equal(trigger.getAttribute('aria-label'), 'Choice')
    assert.equal(trigger.getAttribute('aria-required'), 'true')
    assert.match(trigger.textContent, /lost \(invalid reference\)/)
    await key(trigger, 'Enter')
    assert.equal(document.querySelector('[data-disabled][role="option"]').textContent, 'lost (invalid reference)')
    await key(document.activeElement, 'Home')
    await key(document.activeElement, 'Enter')
    assert.deepEqual(writes, [{ section: 'items', record: 'a', field: 'choice', value: undefined }])
    assert.deepEqual(state, original, 'only the owning caller may apply edits')
    field.allow_clear = false
    state.items.a.choice = 'known'
    await React.act(() => show(true))
    trigger = document.querySelector('[role="combobox"]')
    await key(trigger, 'Enter')
    assert.deepEqual([...document.querySelectorAll('[role="option"]')].map(option => option.textContent), ['Known'])
    await key(document.activeElement, 'Escape')
    await React.act(() => show(false))
    assert.equal(document.querySelector('[role="combobox"]'), null)
    assert.match(document.querySelector('.dsh-design-field-value').textContent, /Known/)
    assert.equal(writes.length, 1, 'rendering and read-only inspection never write')
  } finally { await React.act(() => root.unmount()) }
})
