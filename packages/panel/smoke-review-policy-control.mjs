import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ReviewPolicyControl } from './src/client/review-policy-control.tsx'
import { ADVISORY_CSS } from './src/client/styles.ts'
import { bindDesignHostLocale } from './src/client/ported/host.ts'

const dom = new JSDOM('<div id="root" style="font-weight:600"></div>', { url: 'http://localhost' })
// The advisory slot must work before a Dock ever mounts. Do not load the
// Dock's utility sheet here: its presence used to conceal Host dependencies.
const advisoryStyles = dom.window.document.createElement('style')
advisoryStyles.textContent = ADVISORY_CSS
dom.window.document.head.append(advisoryStyles)
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
const saved = [], prompts = []
const policy = { mode: 'auto', autoMergeWindowMs: 30000, continuousIntervalMs: 600000 }
const runtime = {
  readReviewPolicy: async () => policy,
  updateReviewPolicy: async (session, value) => { saved.push([session, value]); return value },
  sendPrompt: async (...args) => { prompts.push(args) },
}
const root = createRoot(document.getElementById('root'))
let activeLanguage = 'zh-CN'
const localeListeners = new Set()
const releaseLocale = bindDesignHostLocale({ getSnapshot: () => ({ active: activeLanguage }), subscribe: listener => { localeListeners.add(listener); return () => localeListeners.delete(listener) } })
const click = async selector => { await act(async () => document.querySelector(selector).click()) }
try {
  await act(async () => root.render(React.createElement(ReviewPolicyControl, { sessionId: 'test-session', runtime })))
  const dialog = document.querySelector('dialog')
  assert.equal(dialog.open, false, 'the form is hidden initially')
  assert.equal(document.querySelector('.dsh-review-settings-trigger').textContent.trim(), '设置')
  const triggerStyle = dom.window.getComputedStyle(document.querySelector('.dsh-review-settings-trigger'))
  assert.ok(parseFloat(triggerStyle.minHeight) >= 24, 'standalone settings retain a usable action target without Dock utilities')
  assert.equal(document.querySelector('.dsh-design-dock'), null, 'the test must not borrow the Dock stylesheet lifetime')
  assert.equal(document.querySelector('details'), null, 'settings do not expand the advisory inbox')
  await click('.dsh-review-settings-trigger')
  assert.equal(dialog.open, true)
  assert.ok(['normal', '400'].includes(dom.window.getComputedStyle(dialog).fontWeight), 'modal copy must not inherit the inbox heading weight')
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent, 'GRA 评审设置')
  assert.equal(document.querySelector('input')?.value, '30')
  await click('.dsh-review-settings-save')
  assert.equal(saved[0][0], 'test-session')
  assert.deepEqual(saved[0][1], policy, 'saving preserves the existing policy contract')
  assert.ok(document.querySelector('[role="status"]')?.textContent.includes('生效'))
  const select = document.querySelector('select')
  const depth = document.querySelectorAll('select')[1]
  assert.equal(depth.value, 'standard', 'existing projects retain standard depth')
  await act(async () => { depth.value = 'light'; depth.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  assert.equal(prompts.length, 0, 'choosing depth does not start a review')
  await act(async () => { select.value = 'continuous'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  assert.equal(document.querySelector('input')?.getAttribute('aria-label'), '检查间隔（分钟）')
  assert.equal(document.querySelector('[role="status"]'), null, 'editing clears stale saved feedback')
  await click('.dsh-review-settings-check')
  assert.equal(saved[1][1].mode, 'continuous')
  assert.equal(saved[1][1].depth, 'light', 'depth shares the existing project settings save')
  assert.equal(prompts[0][0], 'test-session')
  assert.match(prompts[0][1], /design_recheck_reviews/)
  assert.match(prompts[0][1], /后台不可用或会占用主对话/)
  assert.match(prompts[0][1], /只有明确确认同步后/)
  assert.match(prompts[0][1], /executionMode="foreground"/)
  assert.equal(saved.length, 2, 'save-and-check persists the selected policy before requesting review')
  assert.equal(document.querySelector('[role="status"]').textContent, '手动检查请求已发送，请在原对话查看执行状态。')
  await act(async () => { select.value = 'off'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await click('.dsh-review-settings-check')
  assert.equal(saved[2][1].mode, 'off')
  assert.equal(prompts.length, 2, 'policy off retains the same manual-check route')
  assert.match(prompts[1][1], /未经用户选择不改变评审策略、不自动同步运行/)
  assert.equal(saved.length, 3, 'save-and-check retains the explicitly selected off policy')
  await act(async () => { activeLanguage = 'en-US'; for (const notify of localeListeners) notify() })
  assert.equal(document.querySelector('dialog'), dialog, 'switching language preserves the open dialog and draft policy')
  assert.equal(select.value, 'off')
  assert.equal(depth.value, 'light', 'language changes preserve the selected depth')
  assert.equal(depth.getAttribute('aria-label'), 'Review depth')
  assert.deepEqual([...depth.options].map(option => option.textContent), ['Light', 'Standard', 'Thorough'])
  assert.equal(document.querySelector('.dsh-review-settings-trigger').textContent.trim(), 'Settings')
  assert.equal(document.querySelector('[role="status"]').textContent, 'Review requested. Check its progress in the conversation.')
  assert.doesNotMatch(dialog.textContent, /[\u3400-\u9fff]/)
  assert.equal(prompts.length, 2, 'switching language does not request another check')
  await click('.dsh-review-settings-check')
  assert.match(prompts[2][1], /design_recheck_reviews/)
  assert.match(prompts[2][1], /only after explicit confirmation/)
  assert.doesNotMatch(prompts[2][1], /[\u3400-\u9fff]/)
  assert.equal(saved.length, 4, 'localized save-and-check uses the same policy save')
  assert.equal(document.querySelector('.dsh-review-settings-check').textContent, 'Save & check')
  const savePolicy = runtime.updateReviewPolicy
  runtime.updateReviewPolicy = async () => { throw new Error('fixture connection lost') }
  await click('.dsh-review-settings-save')
  assert.match(document.querySelector('[role="alert"]').textContent, /choices are preserved/)
  assert.equal(document.querySelector('[role="alert"]').title, 'Error: fixture connection lost')
  assert.equal(document.querySelector('[role="status"]'), null, 'a failed save cannot retain previous success feedback')
  assert.equal(depth.value, 'light', 'failed saves retain the editable choice')
  const sentBeforeFailure = prompts.length
  await click('.dsh-review-settings-check')
  assert.equal(prompts.length, sentBeforeFailure, 'failed save must never send a manual review request')
  assert.equal(depth.value, 'light')
  assert.match(document.querySelector('[role="alert"]').textContent, /choices are preserved/)
  runtime.updateReviewPolicy = savePolicy
  await click('.dsh-review-settings-save')
  assert.equal(document.querySelector('[role="alert"]'), null)
  assert.equal(saved.at(-1)[1].depth, 'light')
  const attempts = []
  const sendPrompt = runtime.sendPrompt
  runtime.sendPrompt = async (...args) => { attempts.push(args); throw new Error('fixture delivery unavailable') }
  await click('.dsh-review-settings-check')
  await click('.dsh-review-settings-check')
  assert.equal(attempts[0][2], attempts[1][2], 'same selected policy retries the same manual request')
  await act(async () => { depth.value = 'thorough'; depth.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await click('.dsh-review-settings-check')
  assert.notEqual(attempts[2][2], attempts[1][2], 'editing depth starts a new request instead of replaying old pinned effort')
  await act(async () => root.render(React.createElement(ReviewPolicyControl, { sessionId: 'next-session', runtime })))
  await click('.dsh-review-settings-check')
  assert.equal(attempts[3][0], 'next-session')
  assert.notEqual(attempts[3][2], attempts[2][2], 'failed request identity cannot follow another conversation')
  const pendingSaves = []
  runtime.updateReviewPolicy = (_session, value) => new Promise(resolve => pendingSaves.push(() => resolve(value)))
  await click('.dsh-review-settings-check')
  assert.equal(pendingSaves.length, 1)
  await act(async () => root.render(React.createElement(ReviewPolicyControl, { sessionId: 'newer-session', runtime })))
  await act(async () => pendingSaves[0]())
  assert.equal(attempts.length, 4, 'late save completion cannot dispatch a review from an obsolete conversation')
  runtime.updateReviewPolicy = savePolicy
  runtime.sendPrompt = sendPrompt
  // A direct review capability dispatches the existing service operation, not
  // a main-conversation prompt. Losing its success response must be retryable.
  const directRequests = []
  let scheduled = 0
  const admitted = new Set()
  runtime.requestManualReview = async (session, requestId) => {
    directRequests.push([session, requestId])
    assert.equal(saved.at(-1)[0], session, 'policy is saved before direct dispatch')
    if (admitted.has(requestId)) return { outcome: 'noop', reason: 'already-active-or-requested' }
    admitted.add(requestId)
    scheduled += 1
    throw new Error('fixture success response lost')
  }
  const promptsBeforeDirect = prompts.length
  await click('.dsh-review-settings-save')
  assert.equal(directRequests.length, 0, 'saving settings alone never starts review or a main turn')
  await click('.dsh-review-settings-check')
  assert.match(document.querySelector('[role="alert"]').textContent, /confirm.*request/i)
  await click('.dsh-review-settings-check')
  assert.equal(directRequests.length, 2)
  assert.equal(directRequests[0][1], directRequests[1][1], 'a lost receipt retries the same service operation')
  assert.equal(scheduled, 1, 'the existing service owns deduplication')
  assert.equal(prompts.length, promptsBeforeDirect, 'unknown delivery and retry never fall back to a main prompt')
  assert.equal(document.querySelector('[role="alert"]'), null)
  assert.match(document.querySelector('[role="status"]').textContent, /already.*requested/i)
  runtime.requestManualReview = async (session, requestId) => {
    directRequests.push([session, requestId])
    return { outcome: 'accepted', reason: 'manual-reviews-triggered', target: { revision: 1 } }
  }
  await click('.dsh-review-settings-check')
  assert.notEqual(directRequests[2][1], directRequests[1][1], 'a new acknowledged check gets a new operation identity')
  assert.match(document.querySelector('[role="status"]').textContent, /queued/i)
  runtime.requestManualReview = async () => ({ outcome: 'rejected', reason: 'no-design-change' })
  await click('.dsh-review-settings-check')
  assert.match(document.querySelector('[role="alert"]').textContent, /save.*design/i)
  assert.equal(document.querySelector('[role="status"]'), null, 'rejection cannot look like a scheduled review')
  assert.equal(prompts.length, promptsBeforeDirect, 'a business rejection never switches execution routes')
  runtime.requestManualReview = async () => ({ outcome: 'noop', reason: 'no-configured-profiles' })
  await click('.dsh-review-settings-check')
  assert.match(document.querySelector('[role="alert"]').textContent, /no.*review.*configured/i)
  runtime.requestManualReview = async () => ({ outcome: 'noop', reason: 'request-already-completed' })
  await click('.dsh-review-settings-check')
  assert.match(document.querySelector('[role="status"]').textContent, /already.*completed/i)
  runtime.updateReviewPolicy = async () => { throw new Error('fixture save failed') }
  runtime.requestManualReview = async () => { assert.fail('failed policy save must not dispatch a direct review') }
  await click('.dsh-review-settings-check')
  assert.match(document.querySelector('[role="alert"]').textContent, /choices are preserved/)
  runtime.updateReviewPolicy = savePolicy
  await act(async () => { activeLanguage = 'zh-CN'; for (const notify of localeListeners) notify() })
  runtime.requestManualReview = async () => ({ outcome: 'accepted', reason: 'manual-reviews-triggered', target: { revision: 1 } })
  await click('.dsh-review-settings-check')
  assert.match(document.querySelector('[role="status"]').textContent, /已排队/)
  await click('.dsh-review-settings-close')
  assert.equal(dialog.open, false)
  const css = await readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8')
  assert.match(css, /\.dsh-advisory-inbox-title\{display:flex;align-items:center;gap:8px\}/)
  const source = await readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /className='dsh-advisory-inbox-title'>[\s\S]*?<ReviewPolicyControl[^\n]*\n\s*<\/div>/)
  assert.match(source, /className='dsh-advisory-inbox-close'[^\n]*onClick=\{\(\) => advisoryInboxVisibility\.setExpanded\(sessionId, false\)\}/)
  assert.match(css, /\.dsh-review-settings-dialog\{[^}]*width:360px;[^}]*max-width:calc\(100vw - 32px\)/)
  assert.match(css, /\.dsh-review-settings-fields input,\.dsh-review-settings-fields select\{[^}]*border:1px[^}]*border-radius:7px/)
  assert.match(css, /\.dsh-review-settings-dialog::backdrop/)
} finally {
  await act(async () => root.unmount())
  releaseLocale()
  dom.window.close()
}
console.log('REVIEW POLICY CONTROL OK')
