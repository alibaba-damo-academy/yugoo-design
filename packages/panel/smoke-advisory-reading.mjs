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
    summary: id, items: [{ id: `${id}-item`, title: 'Finding', detail: 'Evidence', references: [] }], acceptanceInstruction: 'Review' } })
const a = entry('a', 1), b = entry('b', 2), c = entry('c', 3), d = entry('d', 4)
assert.deepEqual(selectPendingAdvisories([c, a, b], new Set()).map(item => item.id), ['c', 'b', 'a'])
assert.deepEqual(selectPendingAdvisories([entry('b', 2, 10), entry('a', 1, 20)], new Set()).map(item => item.id), ['b', 'a'], 'publication sequence wins over clock skew')
let root
const render = (entries, preferredAdvisoryId, overrides = {}) => React.createElement(AdvisoryReviewCard, {
  entries, readingScope: 'reading-test', preferredAdvisoryId, emptyText: 'empty',
  onAccept: async () => {}, onRecordAccepted: async () => ({}), onDismiss: async () => {}, onDeferred() {},
  ...overrides,
})
const mount = async (entries, preferred) => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(render(entries, preferred)))
}
const current = () => document.querySelector('[data-advisory-id]')?.getAttribute('data-advisory-id')
const click = async selector => { await act(async () => document.querySelector(selector).click()) }
const checkContainment = () => {
  const carousel = document.querySelector('.dsh-advisory-carousel')
  assert.deepEqual([...carousel.children].map(element => element.tagName), ['ARTICLE', 'NAV'], 'the advice and its existing pagination retain their original containment')
  assert.equal(carousel.querySelector('.dsh-advisory-card').firstElementChild.className, 'dsh-advisory-summary')
  assert.equal(carousel.querySelector('.dsh-advisory-card-header,.dsh-advisory-new-arrival,.dsh-advisory-profile,.dsh-advisory-status'), null, 'collapsed and expanded cards have no superseded title/status row')
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
  assert.equal(document.querySelector('.dsh-advisory-status'), null, 'ordinary pending advice does not repeat its state')
  await click('.dsh-advisory-next')
  assert.equal(current(), 'b')
  await act(async () => root.render(render([a, b, c, d])))
  assert.equal(current(), 'b', 'new arrivals never steal the page being read')
  checkContainment()
  const cardBefore = document.querySelector('.dsh-advisory-card')
  const footerBefore = document.querySelector('.dsh-advisory-carousel-controls')
  const timeBefore = document.querySelector('time')
  await act(async () => {
    const details = document.querySelector('details')
    details.open = true
    details.dispatchEvent(new dom.window.Event('toggle'))
  })
  assert.equal(document.querySelector('.dsh-advisory-card'), cardBefore, 'expansion keeps the same card DOM')
  assert.equal(document.querySelector('.dsh-advisory-carousel-controls'), footerBefore, 'date and pagination retain the same DOM')
  assert.equal(document.querySelector('time'), timeBefore)
  assert.equal(cardBefore.closest('.dsh-advisory-review'), document.querySelector('.dsh-advisory-review'), 'details remain in the original review container')
  checkContainment()
  await click('.dsh-advisory-previous')
  assert.equal(current(), 'c', 'existing pagination reaches the intervening advice')
  await click('.dsh-advisory-previous')
  assert.equal(current(), 'd', 'new arrivals remain reachable through existing pagination')
  assert.equal(document.querySelector('details').open, true, 'pagination preserves expanded mode')
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

  const acceptance = [], authority = { acceptanceReceiptId: 'saved-receipt', actionReceipts: [], executionStatus: 'not-applicable' }
  let failDelivery = true
  const callbacks = {
    readingScope: 'receipt-retry-test',
    onRecordAccepted: async item => { acceptance.push(`record:${item.id}`); return authority },
    onAccept: async (item, receipt) => {
      acceptance.push(`deliver:${item.id}:${receipt.acceptanceReceiptId}`)
      if (failDelivery) throw new Error('delivery unavailable')
    },
  }
  await act(async () => root.render(render([a], undefined, callbacks)))
  await click('.dsh-advisory-accept')
  assert.equal(current(), 'a', 'delivery failure retains the actual advice for recovery')
  assert.match(document.querySelector('[role="alert"]').textContent, /通知尚未确认送达/)
  assert.equal(document.querySelector('.dsh-advisory-accept').textContent, '重试通知')
  assert.equal(document.querySelector('.dsh-advisory-reject,.dsh-advisory-defer'), null, 'saved acceptance retains the existing retry-only decision surface')
  checkContainment()
  failDelivery = false
  await click('.dsh-advisory-accept')
  assert.deepEqual(acceptance, ['record:a', 'deliver:a:saved-receipt', 'record:a', 'deliver:a:saved-receipt'])
  assert.equal(current(), undefined, 'successful delivery clears the advice after the receipt-first retry')

  const dismissals = []; let deferred = 0
  await act(async () => root.render(render([entry('later', 5)], undefined, {
    ...callbacks, onDismiss: async (item, decision) => dismissals.push([item.id, decision]), onDeferred: () => { deferred++ },
  })))
  await click('.dsh-advisory-defer')
  assert.deepEqual(dismissals, [['later', 'deferred']])
  assert.equal(deferred, 1, 'Later keeps the existing inbox-collapse callback')
  assert.equal(acceptance.length, 4, 'Later never records acceptance or sends a continuation')
} finally {
  await act(async () => root.unmount())
  dom.window.close()
}
console.log('ADVISORY READING OK')
