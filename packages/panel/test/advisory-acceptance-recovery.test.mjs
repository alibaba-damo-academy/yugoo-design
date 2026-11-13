import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { AdvisoryReviewCard } from '../src/client/ported/design/AdvisoryReviewCard.tsx'
import { advisoryEntries } from '../fixtures/advisory-review.mjs'

for (const lostResponse of [false, true]) test(`polled acceptance preserves accurate recovery after ${lostResponse ? 'a lost RPC response' : 'failed notice delivery'}`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://advice.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'MutationObserver']) globalThis[key] = dom.window[key]
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  let entries = [structuredClone(advisoryEntries[0])], attempts = 0
  entries[0].status = 'pending'
  entries[0].stale = true
  let firstReceipt
  const render = () => root.render(React.createElement(AdvisoryReviewCard, {
    entries, readingScope: 'delivery-race', emptyText: 'No pending advice',
    onRecordAccepted: async advisory => {
      attempts++
      entries = [{ ...entries[0], status: 'accepted', acceptanceReceiptId: 'saved-acceptance',
        actionReceipts: [], executionStatus: 'not-applicable' }]
      render() // Native polling can expose acceptance before admission finishes.
      if (lostResponse && attempts === 1) throw Error('Acceptance RPC response lost')
      const authority = { acceptanceReceiptId: 'saved-acceptance', actionReceipts: [], executionStatus: 'not-applicable',
        notification: attempts === 1 ? 'failed' : 'sent' }
      firstReceipt ??= authority.acceptanceReceiptId
      assert.equal(authority.acceptanceReceiptId, firstReceipt)
      return authority
    },
    onAccept: async (_advisory, authority) => { if (authority.notification !== 'sent') throw Error('Native queue unavailable') },
    onDismiss: async () => {}, onDeferred() {},
  }))
  try {
    await React.act(async () => render())
    const accept = () => document.querySelector('.dsh-advisory-accept')
    await React.act(async () => accept().click())
    assert.ok(accept(), 'the real accepted projection cannot erase retryable UI')
    assert.equal(attempts, 1, 'no automatic retry')
    assert.match(document.querySelector('.dsh-advisory-status').textContent, /Accepted.*Delivery unconfirmed|已接受.*通知待确认/)
    assert.equal(document.querySelector('.dsh-panel-guidance-trigger'), null, 'saved acceptance retains delivery recovery instead of advice review')
    assert.match(accept().textContent, /Retry notification|重试通知/)
    assert.match(accept().getAttribute('aria-label'), /Retry notification|重试.*通知/)
    assert.equal(document.querySelector('.dsh-advisory-reject'), null, 'accepted advice cannot be rejected again')
    assert.equal(document.querySelector('.dsh-advisory-defer'), null, 'accepted advice cannot be deferred again')
    assert.match(document.body.textContent, /Acceptance is saved|接受已记录/)
    assert.doesNotMatch(document.body.textContent, /real-action-receipt|执行授权/)
    await React.act(async () => accept().click())
    assert.equal(attempts, 2)
    assert.equal(accept(), null)
    assert.match(document.body.textContent, /No pending advice/)
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
  }
})


test('failed receipt persistence keeps the pending decision actions', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://advice.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'MutationObserver']) globalThis[key] = dom.window[key]
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  try {
    await React.act(async () => root.render(React.createElement(AdvisoryReviewCard, {
      entries: [structuredClone(advisoryEntries[0])], readingScope: 'persistence-failure',
      onRecordAccepted: async () => { throw Error('Persistence unavailable') },
      onAccept: async () => assert.fail('failed persistence cannot deliver'),
      onDismiss: async () => {}, onDeferred() {},
    })))
    await React.act(async () => document.querySelector('.dsh-advisory-accept').click())
    assert.equal(document.querySelector('.dsh-advisory-status'), null, 'failed receipt persistence keeps ordinary pending actions without a duplicate label')
    assert.match(document.querySelector('.dsh-advisory-error').textContent, /remains pending|仍待处理/)
    assert.match(document.querySelector('.dsh-advisory-accept').textContent, /Accept|接受/)
    assert.ok(document.querySelector('.dsh-advisory-reject'))
    assert.ok(document.querySelector('.dsh-advisory-defer'))
    assert.match(document.body.textContent, /could not be saved|保存失败/)
  } finally {
    await React.act(async () => root.unmount())
    dom.window.close()
  }
})

test('advice only labels special states, with one review status and nearby deferred facts and evidence', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://advice.test/', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'MutationObserver']) globalThis[key] = dom.window[key]
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.getElementById('root'))
  let entries = [{ ...structuredClone(advisoryEntries[0]), stale: true, status: 'pending' }]
  const dismissed = []
  const render = () => root.render(React.createElement(AdvisoryReviewCard, {
    entries, readingScope: 'one-review-state', onAccept: async () => {},
    onDismiss: async (_advisory, status) => { dismissed.push(status); entries = [{ ...entries[0], status }]; render() },
    onDeferred() {},
  }))
  try {
    await React.act(() => render())
    assert.equal(document.querySelectorAll('.dsh-advisory-status').length, 1)
    assert.match(document.querySelector('.dsh-advisory-status').textContent, /Needs review|需复核/)
    assert.equal(document.querySelector('.dsh-advisory-revalidation, .dsh-advisory-kind, .dsh-advisory-count'), null)
    const help = document.querySelector('.dsh-panel-guidance-trigger')
    assert.ok(help?.getAttribute('aria-label'))
    await React.act(() => help.focus())
    assert.match(document.querySelector('[role=tooltip]').textContent, /current design|当前设计/)
    await React.act(() => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role=tooltip]'), null)
    const details = document.querySelector('details')
    await React.act(() => { details.open = true; details.dispatchEvent(new window.Event('toggle')) })
    assert.equal(details.open, true)
    assert.match(document.querySelector('.dsh-advisory-item-detail').textContent, /flow_design/)
    assert.match(document.querySelector('.dsh-advisory-item-rationale').textContent, /requirement revision/)
    assert.match(document.querySelector('.dsh-advisory-item-references').textContent, /design_files\/flow_design.json/)
    assert.ok(document.querySelector('.dsh-advisory-accept'))
    assert.ok(document.querySelector('.dsh-advisory-reject'))
    await React.act(async () => document.querySelector('.dsh-advisory-defer').click())
    assert.deepEqual(dismissed, ['deferred'])
    assert.match(document.querySelector('.dsh-advisory-status').textContent, /^(Needs review|需复核)$/)
    await React.act(() => document.querySelector('.dsh-panel-guidance-trigger').click())
    assert.match(document.querySelector('[role=tooltip]').textContent, /You deferred this advice|你已选择稍后处理/)
    assert.match(document.querySelector('[role=tooltip]').textContent, /current design|当前设计/)
    assert.equal(document.querySelector('details').open, false, 'deferring retains the card and collapses details')
    entries = [{ ...entries[0], stale: false }]
    await React.act(() => render())
    assert.match(document.querySelector('.dsh-advisory-status').textContent, /^(Deferred|稍后处理)$/)
    assert.equal(document.querySelector('.dsh-panel-guidance-trigger'), null)
    entries = [{ ...entries[0], status: 'pending' }]
    await React.act(() => render())
    assert.equal(document.querySelector('.dsh-advisory-status'), null, 'ordinary pending actions need no redundant state label')
    assert.ok(document.querySelector('.dsh-advisory-accept'))
    assert.ok(document.querySelector('.dsh-advisory-reject'))
    assert.ok(document.querySelector('.dsh-advisory-defer'))
  } finally { await React.act(() => root.unmount()); dom.window.close() }
})

test('shared advisory help is styled on a cold client before any Dock, after Dock styles and after HMR', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://advice.test/', runScripts: 'outside-only', pretendToBeVisual: true })
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'MutationObserver']) globalThis[key] = dom.window[key]
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { readFileSync } = await import('node:fs')
  const { dshClientStyles } = await import('../../../scripts/tsdown-client-styles.ts')
  const config = new URL('../tsdown.config.ts', import.meta.url)
  const entry = new URL('../src/client/owned-styles.ts', import.meta.url)
  const plugin = dshClientStyles('dsh-design-panel', config.href)
  // Follow the real initial style entry and existing CSS loader. Importing the
  // visual sheet directly here would hide the cold-start dependency regression.
  const modules = [...readFileSync(entry, 'utf8').matchAll(/\bimport\s+['"]([^'"]+\.css)['"]/g)].map(([, path]) => {
    const id = plugin.resolveId(path, entry.pathname)
    return plugin.load.call({ addWatchFile() {} }, id).code
  })
  const materialize = () => modules.forEach(code => dom.window.eval(`(function () { ${code.replace('export {};', '')} })()`))
  const root = createRoot(document.getElementById('root'))
  const geometry = element => {
    const style = window.getComputedStyle(element)
    return Object.fromEntries(['width', 'minWidth', 'height', 'padding', 'borderWidth', 'borderRadius', 'backgroundColor', 'cursor'].map(key => [key, style[key]]))
  }
  const assertSharedTrigger = () => {
    const trigger = document.querySelector('.dsh-advisory-card .dsh-panel-guidance-trigger')
    assert.ok(trigger)
    assert.equal(trigger.closest('.dsh-design-root, .dsh-design-panel'), null, 'host advice is independent of a mounted Dock')
    const style = geometry(trigger)
    assert.equal(style.width, '28px')
    assert.equal(style.minWidth, '28px')
    assert.equal(style.height, '28px')
    assert.equal(style.padding, '0px')
    assert.equal(style.borderWidth, '0px')
    assert.equal(style.borderRadius, '50%')
    assert.equal(style.backgroundColor, 'rgba(0, 0, 0, 0)')
    // JSDOM miscomputes font:inherit followed by font-size; retain the font
    // role check in its CSSOM and leave actual computed typography to Chrome.
    const fontRoles = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).filter(rule => {
      try { return rule.selectorText && trigger.matches(rule.selectorText) && rule.style.fontSize } catch { return false }
    })
    assert.equal(fontRoles.at(-1)?.style.fontSize, '12px')
    assert.equal(style.cursor, 'pointer')
    return style
  }
  try {
    materialize(); materialize()
    await React.act(() => root.render(React.createElement(AdvisoryReviewCard, {
      entries: [{ ...structuredClone(advisoryEntries[0]), stale: true }], readingScope: 'cold-help-styles',
      onAccept: async () => assert.fail('help cannot accept'), onDismiss: async () => assert.fail('help cannot dismiss'), onDeferred() {},
    })))
    const cold = assertSharedTrigger()
    const tagCount = document.querySelectorAll('style[data-plugin="dsh-design-panel"]').length
    assert.equal(tagCount, modules.length, 'initial materialization deduplicates each shared sheet')
    await React.act(() => document.querySelector('.dsh-panel-guidance-trigger').focus())
    const popup = document.querySelector('[role=tooltip]')
    assert.ok(popup)
    assert.equal(window.getComputedStyle(popup).position, 'fixed')
    assert.equal(window.getComputedStyle(popup).padding, '12px 16px')
    await React.act(() => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role=tooltip]'), null)
    // Mount the actual generated Dock stylesheet as a warm-state source check;
    // the native Host's cold/warm walkthrough remains a separate acceptance.
    const dockStyle = document.createElement('style')
    dockStyle.textContent = readFileSync(new URL('../src/client/generated/design.tw.css', import.meta.url), 'utf8')
    document.head.append(dockStyle)
    assert.ok(dockStyle.sheet, 'the warm stylesheet must parse rather than silently leave cold CSS alone')
    assert.deepEqual(assertSharedTrigger(), cold)
    dockStyle.remove()
    assert.deepEqual(assertSharedTrigger(), cold, 'closing the Dock cannot remove shared help styling')
    document.querySelectorAll('style[data-plugin="dsh-design-panel"]').forEach(tag => tag.remove())
    materialize(); materialize()
    assert.equal(document.querySelectorAll('style[data-plugin="dsh-design-panel"]').length, tagCount)
    assert.deepEqual(assertSharedTrigger(), cold, 'existing HMR rematerialization restores the same shared default')
  } finally { await React.act(() => root.unmount()); dom.window.close() }
})
