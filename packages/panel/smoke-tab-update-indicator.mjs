import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { DesignTabsBar } from './src/client/ported/design/DesignTabsBar.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
const originalTimeout = globalThis.setTimeout
const originalClear = globalThis.clearTimeout
const timers = []
globalThis.setTimeout = (callback, duration, ...args) => {
  if (duration !== 1500) return originalTimeout(callback, duration, ...args)
  const timer = { callback, cancelled: false }
  timers.push(timer)
  return timer
}
globalThis.clearTimeout = id => {
  if (timers.includes(id)) id.cancelled = true
  else originalClear(id)
}
const root = createRoot(document.getElementById('root'))
const render = (unread, nonce) => React.createElement(DesignTabsBar, {
  value: 'a', onChange() {}, onAddPanel() {},
  options: [{ value: 'a', label: 'A', unread, badge: false }],
  flashTab: { type: 'a', nonce },
})
try {
  await act(async () => root.render(render(false, 1)))
  assert.equal(document.querySelector('[data-flash]')?.textContent, '已更新')
  await act(async () => root.render(render(false, 1)))
  assert.equal(timers.length, 1, 'ordinary polling rerenders do not restart the timeout')
  assert.equal(timers[0].cancelled, false)
  await act(async () => timers[0].callback())
  assert.equal(document.querySelector('[data-flash]'), null, 'updated hint expires')
  await act(async () => root.render(render(false, 1)))
  assert.equal(document.querySelector('[data-flash]'), null, 'expired hint does not return on rerender')
  await act(async () => root.render(render(false, 2)))
  assert.equal(timers.length, 2, 'a genuinely new update starts a fresh timeout')
  await act(async () => root.render(render(true, 2)))
  assert.equal(document.querySelector('[data-testid="chat-design-tab-unread-a"]')?.textContent.trim(), 'new')
  await act(async () => timers[1].callback())
  assert.ok(document.querySelector('[data-testid="chat-design-tab-unread-a"]'), 'unread does not expire with the flash')
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.classList.contains('dsh-design-tabs-scroll') ? 600 : 0 } })
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 200 } })
  navigator.language = 'en-US'
  const selected = []
  await act(async () => root.render(React.createElement(DesignTabsBar, { value: 'b', onChange: value => selected.push(value), onAddPanel() {}, options: [{ value: 'a', label: 'First panel' }, { value: 'b', label: 'Current panel' }] })))
  const trigger = document.querySelector('[data-testid="chat-design-tabs-overflow"]')
  assert.equal(trigger.getAttribute('aria-label'), 'All panels')
  assert.equal(trigger.textContent.trim(), '')
  assert.ok(trigger.querySelector('svg[aria-hidden="true"]'), 'overflow is an icon-only menu with its accessible name retained')
  await act(async () => trigger.click())
  assert.equal(document.activeElement.textContent.trim(), 'Current panel')
  const menu = document.querySelector('[role="menu"]')
  await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
  assert.equal(document.activeElement.textContent.trim(), 'First panel')
  await act(async () => document.activeElement.click())
  assert.deepEqual(selected, ['a'])
  assert.equal(document.activeElement === trigger, true, 'choosing an overflow item restores focus after the item unmounts')
  await act(async () => trigger.click())
  await act(async () => document.querySelector('[role="menu"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('[role="menu"]'), null)
  assert.equal(document.activeElement === trigger, true)
} finally {
  await act(async () => root.unmount())
  globalThis.setTimeout = originalTimeout
  globalThis.clearTimeout = originalClear
  dom.window.close()
}
console.log('TAB UPDATE INDICATOR OK')
