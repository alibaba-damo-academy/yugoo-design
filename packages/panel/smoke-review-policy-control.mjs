import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { ADVISORY_CSS } from './src/client/styles.ts'
import { bindDesignHostLocale } from './src/client/ported/host.ts'

const dom = new JSDOM('<!doctype html><div id="root" style="font-weight:600"></div>', { url: 'http://localhost' })
// Settings must work before the Dock mounts; this exercises their own styles.
const advisoryStyles = dom.window.document.createElement('style')
advisoryStyles.textContent = ADVISORY_CSS
dom.window.document.head.append(advisoryStyles)
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { ReviewPolicyControl } = await import('./src/client/review-policy-control.tsx')
dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
const saved = [], prompts = [], directRequests = []
const policy = { mode: 'auto', autoMergeWindowMs: 30000, continuousIntervalMs: 600000 }
const runtime = {
  readReviewPolicy: async () => policy,
  updateReviewPolicy: async (session, value) => { saved.push([session, value]); return value },
  sendPrompt: async (...args) => { prompts.push(args) },
  requestManualReview: async (...args) => { directRequests.push(args); return { outcome: 'accepted' } },
}
const root = createRoot(document.getElementById('root'))
let activeLanguage = 'zh-CN'
const localeListeners = new Set()
const releaseLocale = bindDesignHostLocale({ getSnapshot: () => ({ active: activeLanguage }), subscribe: listener => { localeListeners.add(listener); return () => localeListeners.delete(listener) } })
const click = async selector => { await act(async () => { const element = document.querySelector(selector); assert.ok(element, selector); element.click() }) }
const input = async (selector, value) => act(async () => {
  const element = document.querySelector(selector)
  assert.ok(element, selector)
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, String(value))
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
})
const chooseMode = value => act(async () => {
  const select = document.querySelector('select')
  select.value = value
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
})
const chooseDepth = value => input('input[type=range]', value)
const number = () => document.querySelector('input[type=number]')
const checkHint = () => {
  const hints = [...document.querySelectorAll('.dsh-review-scope-hints p')]
  assert.equal(hints.length, 3, 'all scope hints reserve their layout space')
  const visible = hints.filter(hint => hint.getAttribute('aria-hidden') === 'false')
  assert.equal(visible.length, 1, 'only the selected hint is exposed to assistive technology')
  assert.equal(document.getElementById(document.querySelector('input[type=range]').getAttribute('aria-describedby')), visible[0])
}
try {
  await act(async () => root.render(React.createElement(ReviewPolicyControl, { sessionId: 'test-session', runtime })))
  const dialog = document.querySelector('dialog')
  const depth = document.querySelector('input[type=range]')
  assert.equal(dialog.open, false)
  assert.equal(document.querySelector('.dsh-review-settings-trigger').textContent.trim(), '')
  assert.equal(document.querySelector('.dsh-review-settings-trigger').getAttribute('aria-label'), '设计建议设置')
  assert.equal(document.querySelector('.dsh-review-settings-trigger').getAttribute('title'), '设计建议设置')
  assert.ok(parseFloat(dom.window.getComputedStyle(document.querySelector('.dsh-review-settings-trigger')).minHeight) >= 24)
  assert.equal(document.querySelector('.dsh-design-dock'), null, 'standalone settings do not borrow the Dock stylesheet lifetime')
  await click('.dsh-review-settings-trigger')
  assert.equal(dialog.open, true)
  assert.ok(['normal', '400'].includes(dom.window.getComputedStyle(dialog).fontWeight))
  assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby'))?.textContent, '设计建议设置')
  assert.deepEqual([...document.querySelectorAll('.dsh-review-settings-actions button')].map(button => button.textContent), ['取消', '保存'])
  assert.equal(document.querySelector('.dsh-review-settings-check'), null)
  assert.equal(depth.value, '1', 'an absent saved depth still displays standard without rewriting it')
  assert.equal(depth.min, '0'); assert.equal(depth.max, '2'); assert.equal(depth.step, '1')
  assert.equal(document.querySelectorAll('.dsh-review-scope-stops > span').length, 3)
  checkHint()
  assert.equal(dom.window.getComputedStyle(document.querySelector('.dsh-review-off-hint')).display, 'none', 'inapplicable mode help does not leave an empty row')
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, false, 'successful Save closes the settings dialog')
  assert.deepEqual(saved[0], ['test-session', policy], 'saving an unchanged policy preserves its contract and absent depth')
  await click('.dsh-review-settings-trigger')
  await chooseDepth(0)
  await chooseMode('continuous')
  await input('input[type=number]', 12)
  assert.equal(saved.length, 1, 'scope, mode and timing remain drafts until Save')
  checkHint()
  await act(async () => { activeLanguage = 'en-US'; for (const notify of localeListeners) notify() })
  assert.equal(document.querySelector('dialog'), dialog, 'language changes preserve the dialog and draft')
  assert.equal(dialog.open, true)
  assert.equal(document.querySelector('select').value, 'continuous')
  assert.equal(number().value, '12')
  assert.equal(depth.value, '0')
  assert.equal(depth.getAttribute('aria-valuetext'), 'Current design')
  assert.deepEqual([...document.querySelectorAll('.dsh-review-scope-labels span')].map(span => span.textContent), ['Current design', 'Related designs', 'Entire project'])
  assert.deepEqual([...document.querySelectorAll('.dsh-review-settings-actions button')].map(button => button.textContent), ['Cancel', 'Save'])
  assert.doesNotMatch(dialog.textContent, /[\u3400-\u9fff]/)
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, false)
  assert.deepEqual(saved.at(-1), ['test-session', { ...policy, mode: 'continuous', depth: 'light', continuousIntervalMs: 720000 }])
  await click('.dsh-review-settings-trigger')
  await chooseDepth(2)
  await chooseMode('off')
  checkHint()
  const offHint = document.querySelector('.dsh-review-off-hint')
  assert.equal(dom.window.getComputedStyle(offHint).visibility, 'visible')
  assert.equal(offHint.parentElement.querySelector('select').value, 'off', 'Off help belongs directly to the mode field')
  assert.equal(depth.matches(':disabled'), true, 'Off disables pointer and keyboard scope adjustment')
  assert.equal(depth.value, '2', 'Off preserves the selected scope')
  await chooseMode('auto')
  assert.equal(depth.matches(':disabled'), false)
  assert.equal(depth.value, '2', 'turning reviews on restores the saved draft scope')
  await chooseMode('off')
  await click('.dsh-review-settings-cancel')
  assert.equal(dialog.open, false)
  assert.equal(saved.length, 2, 'Cancel does not persist a draft')
  await click('.dsh-review-settings-trigger')
  assert.equal(depth.value, '0')
  assert.equal(document.querySelector('select').value, 'continuous')
  assert.equal(number().value, '12', 'Cancel restores the most recently saved timing too')
  await chooseDepth(2)
  await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  assert.equal(dialog.open, false, 'Escape follows the same cancel boundary')
  await click('.dsh-review-settings-trigger')
  assert.equal(depth.value, '0')
  await chooseDepth(1)
  await click('.dsh-review-settings-close')
  await click('.dsh-review-settings-trigger')
  assert.equal(depth.value, '0', 'the header close also cancels unsaved edits')

  const savePolicy = runtime.updateReviewPolicy
  await chooseDepth(2)
  runtime.updateReviewPolicy = async () => { throw new Error('fixture connection lost') }
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, true, 'a failed save stays open for recovery')
  assert.match(document.querySelector('[role=alert]').textContent, /choices are preserved/)
  assert.equal(document.querySelector('[role=alert]').title, 'Error: fixture connection lost')
  assert.equal(depth.value, '2')
  assert.equal(document.querySelector('.dsh-review-settings-save').disabled, false)
  runtime.updateReviewPolicy = savePolicy
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, false)
  assert.equal(saved.at(-1)[1].depth, 'thorough', 'retry persists the retained draft')
  await click('.dsh-review-settings-trigger')
  assert.equal(document.querySelector('[role=alert]'), null)
  await input('input[type=number]', 0)
  await click('.dsh-review-settings-save')
  assert.match(document.querySelector('[role=alert]').textContent, /whole number from 1 to 1440/)
  const beforeInvalid = saved.length
  await input('input[type=number]', 1.5)
  await click('.dsh-review-settings-save')
  assert.equal(saved.length, beforeInvalid, 'invalid intervals never reach the settings service')
  await click('.dsh-review-settings-cancel')
  await click('.dsh-review-settings-trigger')
  await chooseMode('auto')
  await input('input[type=number]', '')
  await click('.dsh-review-settings-save')
  assert.match(document.querySelector('[role=alert]').textContent, /0 to 3600 seconds/)
  const savedTiming = { autoMergeWindowMs: saved.at(-1)[1].autoMergeWindowMs, continuousIntervalMs: saved.at(-1)[1].continuousIntervalMs }
  await chooseMode('off')
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, false, 'an invalid hidden automatic draft cannot prevent turning reviews off')
  assert.equal(saved.at(-1)[1].mode, 'off', 'Off only changes the saved policy')
  assert.equal(saved.at(-1)[1].autoMergeWindowMs, savedTiming.autoMergeWindowMs)
  assert.equal(saved.at(-1)[1].continuousIntervalMs, savedTiming.continuousIntervalMs)

  await click('.dsh-review-settings-trigger')
  await chooseMode('continuous')
  await input('input[type=number]', '')
  await chooseMode('auto')
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, false, 'Automatic ignores an invalid hidden scheduled draft')
  assert.equal(saved.at(-1)[1].continuousIntervalMs, savedTiming.continuousIntervalMs)
  await click('.dsh-review-settings-trigger')
  await input('input[type=number]', '')
  await chooseMode('continuous')
  await click('.dsh-review-settings-save')
  assert.equal(dialog.open, false, 'Scheduled ignores an invalid hidden automatic draft')
  assert.equal(saved.at(-1)[1].autoMergeWindowMs, savedTiming.autoMergeWindowMs)

  await click('.dsh-review-settings-trigger')
  await chooseMode('off')
  await click('.dsh-review-settings-save')

  const pendingSaves = []
  runtime.updateReviewPolicy = (_session, value) => new Promise(resolve => pendingSaves.push(() => resolve(value)))
  await click('.dsh-review-settings-trigger')
  await chooseMode('auto')
  await chooseDepth(0)
  await click('.dsh-review-settings-save')
  assert.equal(pendingSaves.length, 1)
  assert.equal(document.querySelector('.dsh-review-settings-cancel').disabled, true)
  await act(async () => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })))
  assert.equal(dialog.open, true, 'an in-flight save cannot appear cancelled while still persisting')
  await act(async () => root.render(React.createElement(ReviewPolicyControl, { sessionId: 'next-session', runtime })))
  const nextDepth = document.querySelector('input[type=range]')
  assert.equal(nextDepth.value, '1')
  await act(async () => pendingSaves[0]())
  assert.equal(dialog.open, true, 'late completion from another session cannot close this dialog')
  assert.equal(nextDepth.value, '1', 'late completion cannot replace this session’s settings')
  assert.equal(document.querySelector('.dsh-review-settings-save').disabled, false)
  assert.equal(prompts.length, 0, 'no settings action sends a main-conversation prompt')
  assert.equal(directRequests.length, 0, 'no settings action starts a manual review')
  await click('.dsh-review-settings-cancel')
  const css = await readFile(new URL('./src/client/styles.ts', import.meta.url), 'utf8')
  assert.match(css, /\.dsh-advisory-inbox-title\{display:flex;align-items:center;gap:8px\}/)
  const source = await readFile(new URL('./src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(source, /className='dsh-advisory-inbox-title'>[\s\S]*?<ReviewPolicyControl[^\n]*\n\s*<\/div>/)
  assert.match(source, /className='dsh-advisory-inbox-close'[^\n]*onClick=\{\(\) => advisoryInboxVisibility\.setExpanded\(sessionId, false\)\}/)
  assert.match(css, /\.dsh-review-settings-dialog\{[^}]*width:360px;[^}]*max-width:calc\(100vw - 32px\)/)
  assert.match(css, /\.dsh-review-settings-dialog::backdrop/)
} finally {
  await act(async () => root.unmount())
  releaseLocale()
  dom.window.close()
}
console.log('REVIEW POLICY CONTROL OK')
