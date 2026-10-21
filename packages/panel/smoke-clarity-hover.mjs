import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ClarityDockReadout, CLARITY_DOCK_CSS } from './src/client/clarity-dock.tsx'

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' })
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'zh-CN' } })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root'))
const explanation = { summary: '概述', u: '理解依据'.repeat(900), s: '<script>unsafe</script>', t: '验收依据', assessedCheckpoint: 'fixture' }
const value = { assessment: { kit: 'fixture', version: '1.0', u: 80, s: 65, t: 50 }, explanation, needsReassessment: true }
const indicator = key => document.querySelector(`[data-testid="design-clarity-dock-${key}"]`)
const event = async (target, type, relatedTarget) => {
  await act(async () => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, relatedTarget })))
}
const pause = async () => { await act(async () => new Promise(resolve => setTimeout(resolve, 150))) }
try {
  await act(async () => root.render(React.createElement(ClarityDockReadout, { value })))
  assert.ok(indicator('u').textContent.includes('理解度'))
  assert.ok(indicator('s').textContent.includes('结构化'))
  assert.ok(indicator('t').textContent.includes('可验证'))
  assert.equal(document.querySelector('details,summary'), null)
  assert.equal(document.querySelector('[role="tooltip"]'), null)
  indicator('u').getBoundingClientRect = () => ({ left: 1000, top: 20, bottom: 40 })
  await event(indicator('u'), 'mouseover')
  let tooltip = document.querySelector('[role="tooltip"]')
  assert.ok(tooltip.textContent.includes(explanation.u), 'full saved evidence is readable without truncation')
  assert.ok(tooltip.textContent.includes('需要重新评估'))
  assert.equal(indicator('u').getAttribute('aria-describedby'), tooltip.id)
  assert.ok(parseFloat(tooltip.style.left) + 360 <= window.innerWidth - 12, 'tooltip fits the right viewport edge')
  await event(indicator('u'), 'mouseout', tooltip)
  await event(tooltip, 'mouseover', indicator('u'))
  await pause()
  assert.ok(document.querySelector('[role="tooltip"]'), 'moving onto the explanation keeps long text readable')
  await act(async () => tooltip.dispatchEvent(new dom.window.Event('scroll', { bubbles: true })))
  assert.ok(document.querySelector('[role="tooltip"]'), 'scrolling the explanation does not dismiss it')
  await event(tooltip, 'mouseout', document.body)
  await pause()
  assert.equal(document.querySelector('[role="tooltip"]'), null)
  await act(async () => indicator('s').focus())
  tooltip = document.querySelector('[role="tooltip"]')
  assert.ok(tooltip.textContent.includes(explanation.s), 'keyboard focus shows the corresponding dimension')
  assert.equal(document.querySelector('script'), null, 'reason text never becomes executable markup')
  await act(async () => tooltip.focus())
  await act(async () => tooltip.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(document.querySelector('[role="tooltip"]'), null, 'Escape closes instead of reopening on focus return')
  assert.equal(document.activeElement, indicator('s'))
  await act(async () => root.render(React.createElement(ClarityDockReadout, { value: { ...value, explanation: undefined } })))
  await act(async () => indicator('t').focus())
  assert.ok(document.querySelector('[role="tooltip"]').textContent.includes('尚未保存解释'), 'legacy scores do not invent a reason')
  assert.match(CLARITY_DOCK_CSS, /position: fixed/)
  assert.match(CLARITY_DOCK_CSS, /overflow-y: auto/)
  assert.match(CLARITY_DOCK_CSS, /flex-wrap: wrap/)
} finally {
  await act(async () => root.unmount())
  dom.window.close()
}
console.log('CLARITY HOVER OK')
