import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<style></style><div id="root"></div>', { url: 'https://panel.test/' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) globalThis[key] = dom.window[key]
document.querySelector('style').textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { renderNode } = await import('../src/interpreter.ts')

test('record icon actions use native-sized ghost hitboxes and preserve boundary, order, confirm and atomic deletion semantics', async () => {
  const root = createRoot(document.getElementById('root'))
  const manifest = { version: 1, panel_kind: 'document', sections: [
    { id: 'entries', title: 'Entries', order: 'entry_order', confirm_delete: true,
      delete_children: [{ section: 'children', reference_field: 'owner' }] },
    { id: 'children', title: 'Children', order: 'child_order' },
  ], fields: [{ key: 'title', label: 'Title', control: 'text', applies_to: ['entries'] }] }
  let data = { entries: { a: { title: 'First' }, b: { title: 'Middle' }, c: { title: 'Last' } }, entry_order: ['a', 'b', 'c'],
    children: { owned: { owner: 'b' }, unrelated: { owner: 'a' } }, child_order: ['owned', 'unrelated'] }
  let updates
  const show = (editable = true) => React.act(async () => root.render(React.createElement('div', { className: 'dsh-design-panel dsh-record-workspace' },
    renderNode({ component: 'record_form', id: 'editor', source: 'entries' }, manifest, data,
      { locale: 'en-US', editable, onPanelUpdate: next => { updates = next } }))))
  const action = (kind, id) => document.querySelector(`[data-testid="record-${kind}-${id}"]`)
  try {
    await show()
    assert.equal(action('up', 'a').disabled, true)
    assert.equal(action('down', 'c').disabled, true)
    assert.equal(action('up', 'b').disabled, false)
    assert.equal(action('down', 'b').disabled, false)
    for (const [kind, svgName] of [['up', 'arrow-up'], ['down', 'arrow-down'], ['remove', 'trash-2']]) {
      const button = action(kind, 'b')
      assert.ok(button.getAttribute('aria-label').includes('Middle'))
      assert.equal(button.textContent, '', 'icons are not Unicode text buttons')
      assert.ok(button.querySelector(`svg.lucide-${svgName}`))
      assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true')
      const style = window.getComputedStyle(button)
      assert.equal(style.width, '32px')
      assert.equal(style.height, '32px')
      assert.equal(style.borderTopWidth, '0px')
      assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)')
      assert.equal(window.getComputedStyle(button.querySelector('svg')).width, '16px')
    }
    assert.equal(window.getComputedStyle(document.querySelector('.dsh-design-record-actions')).gap, '2px')
    await React.act(async () => action('up', 'a').click())
    assert.equal(updates, undefined, 'disabled boundary cannot emit updates')
    await React.act(async () => action('up', 'b').click())
    assert.deepEqual(updates.entry_order, ['b', 'a', 'c'])
    assert.deepEqual(updates.entries, data.entries)
    data = { ...data, ...updates }; updates = undefined
    await show()
    assert.equal(action('up', 'b').disabled, true)
    let confirms = 0
    window.confirm = () => { confirms++; return false }
    await React.act(async () => action('remove', 'b').click())
    assert.equal(updates, undefined)
    window.confirm = () => { confirms++; return true }
    await React.act(async () => action('remove', 'b').click())
    assert.equal(confirms, 2)
    assert.deepEqual(Object.keys(updates.entries), ['a', 'c'])
    assert.deepEqual(updates.entry_order, ['a', 'c'])
    assert.deepEqual(updates.children, { unrelated: { owner: 'a' } })
    assert.deepEqual(updates.child_order, ['unrelated'])
    assert.ok(data.entries.b, 'canonical data is not mutated before host applies atomic update')
    await show(false)
    assert.equal(document.querySelector('.dsh-design-record-actions'), null)
    delete manifest.sections[0].order
    await show()
    assert.equal(action('up', 'a'), null, 'no durable order path means no move actions')
    assert.ok(action('remove', 'a'))
  } finally { await React.act(async () => root.unmount()); dom.window.close() }
})
