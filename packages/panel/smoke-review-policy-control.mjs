import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ReviewPolicyControl } from './src/client/review-policy-control.tsx'
import { ADVISORY_CSS } from './src/client/styles.ts'

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
  await act(async () => { select.value = 'continuous'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  assert.equal(document.querySelector('input')?.getAttribute('aria-label'), '检查间隔（分钟）')
  assert.equal(document.querySelector('[role="status"]'), null, 'editing clears stale saved feedback')
  await click('.dsh-review-settings-save')
  assert.equal(saved[1][1].mode, 'continuous')
  await click('.dsh-review-settings-check')
  assert.equal(prompts[0][0], 'test-session')
  assert.match(prompts[0][1], /design_recheck_reviews/)
  assert.match(prompts[0][1], /后台不可用或会占用主对话/)
  assert.match(prompts[0][1], /只有明确确认同步后/)
  assert.match(prompts[0][1], /executionMode="foreground"/)
  assert.equal(saved.length, 2, 'requesting a manual check does not silently change policy')
  assert.equal(document.querySelector('[role="status"]').textContent, '手动检查请求已发送，请在原对话查看执行状态。')
  await act(async () => { select.value = 'off'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
  await click('.dsh-review-settings-save')
  assert.equal(saved[2][1].mode, 'off')
  await click('.dsh-review-settings-check')
  assert.equal(prompts.length, 2, 'policy off retains the same manual-check route')
  assert.match(prompts[1][1], /未经用户选择不改变评审策略、不自动同步运行/)
  assert.equal(saved.length, 3, 'manual check leaves the explicitly selected off policy intact')
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
  dom.window.close()
}
console.log('REVIEW POLICY CONTROL OK')
