import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { AdvisoryReviewCard, selectPendingAdvisories } from './src/client/ported/design/AdvisoryReviewCard.tsx'

const dom = new JSDOM('<div data-conversation-scroll></div><div id="root"></div><div data-composer-card></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
globalThis.cancelAnimationFrame = clearTimeout
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.MutationObserver = dom.window.MutationObserver
document.querySelector('[data-conversation-scroll]').getBoundingClientRect = () => ({ left: 10, top: 40, width: 300 })
document.querySelector('[data-composer-card]').getBoundingClientRect = () => ({ left: 10, top: 500, width: 300 })
const entry = (id, revision, publishedAt = 1700000000000 + revision) => ({ publishedRevision: revision, publishedAt,
  status: 'pending', stale: false, advisory: { id, profile: 'test', attention: 'human-review', kind: 'suggestion',
    summary: id, items: [{ id: `${id}-item`, title: 'Finding', detail: 'Evidence' }], acceptanceInstruction: 'Review' } })
const a = entry('a', 1), b = entry('b', 2), c = entry('c', 3), d = entry('d', 4)
assert.deepEqual(selectPendingAdvisories([c, a, b], new Set()).map(item => item.id), ['c', 'b', 'a'])
assert.deepEqual(selectPendingAdvisories([entry('b', 2, 10), entry('a', 1, 20)], new Set()).map(item => item.id), ['b', 'a'], 'publication sequence wins over clock skew')
let root
const render = (entries, preferredAdvisoryId) => React.createElement(AdvisoryReviewCard, {
  entries, readingScope: 'reading-test', preferredAdvisoryId, emptyText: 'empty',
  onAccept: async () => {}, onRecordAccepted: async () => ({}), onDismiss: async () => {}, onDeferred() {},
})
const mount = async (entries, preferred) => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(render(entries, preferred)))
}
const current = () => document.querySelector('[data-advisory-id]')?.getAttribute('data-advisory-id')
const click = async selector => { await act(async () => document.querySelector(selector).click()) }
const checkContainment = () => {
  const carousel = document.querySelector('.dsh-advisory-carousel')
  assert.deepEqual([...carousel.children].map(element => element.tagName), ['ARTICLE', 'NAV'], 'unread action never owns a separate carousel row or gap')
  const arrival = carousel.querySelector('.dsh-advisory-new-arrival')
  if (arrival) assert.equal(arrival.parentElement.className, 'dsh-advisory-card-header', 'unread action shares existing header in normal and portal views')
}
try {
  await mount([a, b, c])
  checkContainment()
  assert.equal(current(), 'c', 'manual opening starts with newest unread')
  assert.ok(document.querySelector('time')?.dateTime)
  assert.equal(document.querySelector('.dsh-advisory-unread'), null, 'read state does not clutter the card')
  assert.equal(document.querySelector('.dsh-advisory-kind'), null)
  assert.ok(document.querySelector('.dsh-advisory-carousel-controls time')?.title, 'full timestamp stays available on hover in footer')
  assert.equal(document.querySelector('.dsh-advisory-card-header time'), null)
  assert.ok(document.querySelector('.dsh-advisory-status')?.textContent.includes('待处理'))
  await click('.dsh-advisory-next')
  assert.equal(current(), 'b')
  await act(async () => root.render(render([a, b, c, d])))
  assert.equal(current(), 'b', 'new arrivals never steal the page being read')
  checkContainment()
  await act(async () => {
    const details = document.querySelector('details')
    details.open = true
    details.dispatchEvent(new dom.window.Event('toggle'))
  })
  assert.ok(document.querySelector('.dsh-advisory-expanded-layer'), 'details share the expanded portal')
  checkContainment()
  await click('.dsh-advisory-new-arrival')
  assert.equal(current(), 'd', 'new-arrival action jumps to newest unread')
  assert.ok(document.querySelector('.dsh-advisory-expanded-layer'), 'unread navigation preserves expanded mode')
  checkContainment()
  await click('.dsh-advisory-reject')
  assert.equal(current(), 'c', 'removal selects adjacent surviving card')
  await act(async () => root.unmount())
  await mount([a, b, c])
  assert.equal(current(), 'a', 'manual reopening prefers remaining unread')
  await act(async () => root.unmount())
  await mount([a, b, c])
  assert.equal(current(), 'a', 'when all read, reopening restores last selected card')
  checkContainment()
  assert.equal(document.querySelector('.dsh-advisory-new-arrival'), null, 'no placeholder is retained once every advice has been read')
  await act(async () => root.unmount())
  await mount([a, b, c], 'b')
  assert.equal(current(), 'b', 'automatic opening targets the newly arrived suggestion')
  await act(async () => root.render(render([])))
  assert.equal(document.querySelector('[role="status"]')?.textContent, 'empty', 'removing all cards keeps Hooks valid and shows empty state')
} finally {
  await act(async () => root.unmount())
  dom.window.close()
}
console.log('ADVISORY READING OK')
