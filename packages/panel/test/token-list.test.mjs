import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const dom = new JSDOM('<div id="root"></div>', { url: 'https://panel.test/', pretendToBeVisual: true })
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'getComputedStyle', 'MutationObserver']) {
  if (globalThis[name] === undefined) globalThis[name] = dom.window[name]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { TokenList } = await import('../src/token-list.tsx')
const { PanelLocaleContext } = await import('../src/panel-i18n.tsx')

test('chip and card removal share a borderless icon target without inheriting ordinary button chrome', async () => {
  const container = document.getElementById('root'), root = createRoot(container), changes = []
  const style = document.createElement('style')
  style.textContent = readFileSync(new URL('../src/visual-components.css', import.meta.url), 'utf8')
  document.head.append(style); container.className = 'dsh-design-panel'
  const value = ['One', 'Two']
  try {
    for (const config of [{ layout: 'chips' }, { layout: 'cards' }, { layout: 'cards', addMode: 'menu' }]) {
      await React.act(async () => root.render(React.createElement('div', { className: 'dsh-record-workspace' },
        React.createElement(PanelLocaleContext.Provider, { value: 'en-US' }, React.createElement(TokenList, {
          ...config, label: 'Recipients', value, editable: true, onChange: next => changes.push(next),
        })))))
      const button = container.querySelector('.dsh-token-item > .dsh-token-remove'), css = dom.window.getComputedStyle(button)
      assert.equal(button.type, 'button')
      assert.equal(button.getAttribute('aria-label'), 'Remove RecipientsOne')
      assert.equal(button.title, 'Remove RecipientsOne')
      assert.equal(button.textContent, '', 'no font-dependent multiplication glyph')
      assert.equal(button.querySelector('svg').getAttribute('width'), '16')
      assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true')
      assert.equal(css.width, '24px'); assert.equal(css.height, '24px')
      assert.equal(css.padding, '0px'); assert.equal(css.borderTopWidth, '0px')
      assert.equal(css.backgroundColor, 'rgba(0, 0, 0, 0)')
      await React.act(async () => button.click())
      assert.deepEqual(changes.at(-1), ['Two'])
      assert.deepEqual(value, ['One', 'Two'], 'removal sends only the intended replacement and never mutates incoming data')
    }
    await React.act(async () => root.render(React.createElement(TokenList, { label: 'Recipients', value, editable: false, onChange: next => changes.push(next) })))
    assert.equal(container.querySelector('.dsh-token-remove'), null)
    assert.equal(changes.length, 3)
  } finally { await React.act(async () => root.unmount()); style.remove(); container.className = '' }
})

test('token additions preserve native middle-dot separation and existing separators for click and Enter', async () => {
  const container = document.getElementById('root')
  const root = createRoot(container)
  const original = ['Existing']
  let value = original
  const changes = []
  const render = () => root.render(React.createElement(TokenList, {
    label: 'Recipients', value, editable: true,
    onChange: next => { changes.push(next); value = next; render() },
  }))
  const input = async text => {
    await React.act(async () => {
      const element = container.querySelector('input')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, text)
      element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  try {
    await React.act(async () => render())
    await input(' Applicant · Reviewer，Applicant; Observer； Existing ')
    await React.act(async () => container.querySelector('.dsh-token-add button').click())
    assert.deepEqual(value, ['Existing', 'Applicant', 'Reviewer', 'Observer'])
    assert.equal(container.querySelector('input').value, '')
    await input('Reviewer·Another, Final')
    await React.act(async () => container.querySelector('input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    assert.deepEqual(value, ['Existing', 'Applicant', 'Reviewer', 'Observer', 'Another', 'Final'])
    assert.equal(changes.length, 2)
    assert.deepEqual(original, ['Existing'], 'stored input is not mutated')
    await input(' · , ； ')
    await React.act(async () => container.querySelector('.dsh-token-add button').click())
    assert.equal(changes.length, 2, 'separator-only input cannot emit an empty write')
  } finally { await React.act(async () => root.unmount()) }
})

test('token preset, card descriptions and readonly/invalid boundaries stay generic', async () => {
  const container = document.getElementById('root')
  const root = createRoot(container)
  const changes = []
  const props = { label: 'Channels', value: ['internal', 'External'], options: [{ value: 'internal', label: 'Built in', description: 'Preset description' }],
    layout: 'cards', customDescription: 'Custom description', editable: true, onChange: next => changes.push(next) }
  try {
    await React.act(async () => root.render(React.createElement(TokenList, props)))
    assert.deepEqual([...container.querySelectorAll('.dsh-token-item small')].map(e => e.textContent), ['Preset description', 'Custom description'])
    assert.equal(container.querySelector('option[value="internal"]').disabled, true)
    await React.act(async () => container.querySelector('.dsh-token-item button').click())
    assert.deepEqual(changes, [['External']])
    await React.act(async () => root.render(React.createElement(TokenList, { ...props, editable: false })))
    assert.equal(container.querySelector('input, select, button'), null)
    await React.act(async () => root.render(React.createElement(TokenList, { ...props, value: [42] })))
    assert.ok(container.querySelector('[role="alert"]'))
    assert.equal(container.querySelector('input, select, button'), null)
    assert.equal(changes.length, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test('optional menu preserves presets, cancellable custom draft, keyboard focus and canonical strings', async () => {
  const container = document.getElementById('root'), root = createRoot(container)
  const changes = []; let value = ['internal'], editable = true, locale = 'en-US', identity = 'first'
  const render = () => root.render(React.createElement(PanelLocaleContext.Provider, { value: locale }, React.createElement(TokenList, {
    key: identity, label: 'Delivery', value, editable, addMode: 'menu', layout: 'cards', customDescription: 'External service', customIcon: 'plug', addDescription: 'Choose a delivery method',
    options: [{ value: 'internal', label: 'Built in', description: 'Preset', icon: 'message-square', menu_description: 'Default', selected_description: 'Already added' }, { value: 'mail', label: 'Mail' }],
    onChange: next => { changes.push(next); value = next; render() },
  })))
  const click = async selector => React.act(async () => container.querySelector(selector).click())
  const key = async (selector, key) => React.act(async () => container.querySelector(selector).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })))
  const type = async text => React.act(async () => {
    const element = container.querySelector('input')
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, text)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  try {
    await React.act(async () => render())
    assert.equal(container.querySelector('input, select'), null)
    assert.match(container.querySelector('[aria-haspopup="menu"]').textContent, /Add Delivery/)
    assert.match(container.querySelector('[aria-haspopup="menu"] small').textContent, /Choose a delivery method/)
    assert.equal(container.querySelector('.dsh-token-menu-add').parentElement, container.querySelector('.dsh-token-items'))
    assert.ok(container.querySelector('.dsh-token-icon svg'))
    assert.equal(container.querySelector('.dsh-token-item > button svg').getAttribute('width'), '16')
    assert.equal(container.querySelector('[aria-haspopup="menu"]').querySelectorAll('svg').length, 2)
    await click('[aria-haspopup="menu"]')
    const items = container.querySelectorAll('[role="menuitem"]')
    assert.equal(items[0].disabled, true)
    assert.match(items[0].textContent, /Already added/)
    assert.equal(container.querySelector('.dsh-token-item small').textContent, 'Preset')
    assert.equal(document.activeElement, items[1])
    await key('[role="menu"]', 'End')
    assert.equal(document.activeElement, items[2])
    await key('[role="menu"]', 'Escape')
    assert.equal(container.querySelector('[role="menu"]'), null)
    assert.equal(document.activeElement, container.querySelector('[aria-haspopup="menu"]'))
    assert.equal(changes.length, 0)
    await click('[aria-haspopup="menu"]')
    await click('[role="menuitem"]:last-child')
    assert.equal(document.activeElement, container.querySelector('input'))
    await type('Uncommitted')
    assert.equal(container.querySelector('[aria-label="Cancel adding Delivery"] svg').getAttribute('width'), '16')
    await click('[aria-label="Cancel adding Delivery"]')
    assert.equal(container.querySelector('input'), null)
    assert.equal(document.activeElement, container.querySelector('[aria-haspopup="menu"]'))
    assert.equal(changes.length, 0)
    await click('[aria-haspopup="menu"]')
    await click('[role="menuitem"]:last-child')
    assert.equal(container.querySelector('input').value, '')
    await type(' mail · Custom, Custom ')
    await key('input', 'Enter')
    assert.deepEqual(value, ['internal', 'mail', 'Custom'])
    assert.equal(container.querySelector('input'), null)
    await click('[aria-haspopup="menu"]')
    assert.equal(container.querySelectorAll('[role="menuitem"]')[1].disabled, true)
    await click('[role="menuitem"]:last-child')
    await type('Discard across records')
    identity = 'second'; value = ['second-original']
    await React.act(async () => render())
    assert.equal(container.querySelector('input'), null, 'new record cannot inherit custom draft')
    await click('[aria-haspopup="menu"]')
    await click('[role="menuitem"]:last-child')
    assert.equal(container.querySelector('input').value, '')
    locale = 'zh-CN'; await React.act(async () => render())
    assert.equal(container.querySelector('input').getAttribute('aria-label'), '新增Delivery')
    await type('Pending before lock')
    editable = false; await React.act(async () => render())
    assert.equal(container.querySelector('input, select, button'), null)
    editable = true; await React.act(async () => render())
    assert.equal(container.querySelector('input'), null, 'unlock does not revive abandoned draft')
    assert.equal(changes.length, 1)
  } finally { await React.act(async () => root.unmount()) }
})

test('the shared interpreter forwards menu configuration and isolates entry drafts across record navigation', async () => {
  const { renderManifest } = await import('../src/interpreter.ts')
  const container = document.getElementById('root'), root = createRoot(container), edits = []
  const manifest = { version: 1, panel_kind: 'document', sections: [{ id: 'entries', title: 'Entries' }],
    fields: [{ key: 'title', control: 'text', applies_to: ['entries'] },
      { key: 'delivery', control: 'token_list', label: 'Delivery', token_layout: 'cards', token_add_mode: 'menu', applies_to: ['entries'] }],
    ui: { component: 'record_workspace', id: 'workspace', sources: ['entries'], navigation_layout: 'list', children: [{ component: 'record_inspector', id: 'inspector' }] } }
  const data = { entries: { first: { title: 'First record', delivery: ['One'] }, second: { title: 'Second record', delivery: ['Two'] } } }
  const before = structuredClone(data)
  try {
    await React.act(async () => root.render(renderManifest(manifest, data, { editable: true, locale: 'en-US', onEdit: edit => edits.push(edit) })))
    assert.ok(container.querySelector('[aria-haspopup="menu"]'))
    await React.act(async () => container.querySelector('[aria-haspopup="menu"]').click())
    await React.act(async () => container.querySelector('[role="menuitem"]').click())
    await React.act(async () => {
      const input = container.querySelector('.dsh-token-list input')
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Unsaved first draft')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await React.act(async () => [...container.querySelectorAll('nav button')].find(button => button.textContent === 'Second record').click())
    assert.equal(container.querySelector('.dsh-token-list input'), null)
    assert.match(container.querySelector('.dsh-token-items').textContent, /Two/)
    await React.act(async () => container.querySelector('[aria-haspopup="menu"]').click())
    await React.act(async () => container.querySelector('[role="menuitem"]').click())
    assert.equal(container.querySelector('.dsh-token-list input').value, '')
    assert.deepEqual(edits, [])
    assert.deepEqual(data, before)
  } finally { await React.act(async () => root.unmount()) }
})
