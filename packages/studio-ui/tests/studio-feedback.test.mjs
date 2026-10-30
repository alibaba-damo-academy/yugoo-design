/** Shared feedback interaction and authored styles; no browser/host acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { register } from 'tsx/esm/api'
import { controlStyleGaps, feedbackStyleGaps } from './control-style-coverage.mjs'
const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
const dom = new JSDOM('<div id="root" class="ygd-studio-workspace"></div>', { url: 'https://studio.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const loader = register({ namespace: 'studio-feedback', tsconfig: new URL('./source-tsconfig.json', import.meta.url).pathname })
const { StudioFeedback, StudioEmptyState, STUDIO_WORKSPACE_CSS } = process.env.STUDIO_SOURCE_CANDIDATE_REVIEW_BUILT === '1'
  ? await import('../lib/index.js') : await loader.import(new URL('../src/index.ts', import.meta.url).href, import.meta.url)
const h = React.createElement, host = document.getElementById('root')
const button = label => [...(host.querySelector('dialog[open]') ?? host).querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)
async function click(label) { const target = button(label); assert.ok(target, label); await React.act(async () => target.click()) }

test('operation errors use one dismissible dialog, preserve focus and do not reopen on polling', async t => {
  let retries = 0, opened = 0
  const composer = document.createElement('textarea'); document.body.append(composer)
  t.after(() => composer.remove())
  const root = createRoot(host)
  t.after(async () => { await React.act(async () => root.unmount()) })
  const props = { feedbackId: 'failed-1', tone: 'error', autoOpen: true, title: 'Cannot save', message: 'Input is retained.', locale: 'en',
    details: [{ message: 'Fix schema.yaml: unsupported type.', file: 'schema.yaml', onOpen: () => opened++ }],
    actions: [{ label: 'Retry', onClick: () => { retries++; composer.focus() } }] }
  await React.act(async () => root.render(h(StudioFeedback, props)))
  assert.equal(host.querySelector('dialog[open] h2').textContent, 'Cannot save')
  assert.equal(host.querySelector('dialog details').open, false)
  assert.deepEqual(controlStyleGaps(host, STUDIO_WORKSPACE_CSS), [])
  await click('Close error dialog')
  assert.equal(host.querySelector('dialog'), null)
  await React.act(async () => root.render(h(StudioFeedback, { ...props, details: [...props.details] })))
  assert.equal(host.querySelector('dialog'), null, 'polling the same outcome never reopens it')
  assert.equal(host.textContent, 'Cannot saveRetryView issues', 'a compact contextual error and recovery action remain, without technical details')
  button('View issues').focus()
  await click('View issues'); await click('Close error dialog')
  assert.equal(document.activeElement, button('View issues'))
  await click('View issues'); await click('schema.yaml'); assert.equal(opened, 1)
  assert.equal(host.querySelector('dialog'), null, 'file navigation closes the modal without retrying')
  assert.equal(retries, 0)
  await click('View issues'); await click('Retry'); assert.equal(retries, 1)
  assert.equal(host.querySelector('dialog'), null)
  assert.equal(document.activeElement, composer, 'a repair action keeps its own focus destination after closing')
  await React.act(async () => root.render(h(StudioFeedback, { ...props, feedbackId: 'failed-2' })))
  assert.ok(host.querySelector('dialog[open]'), 'a distinct failed outcome can open once')
})

test('background validation opens only by explicit action; Escape restores focus and success stays nonblocking', async t => {
  const root = createRoot(host)
  t.after(async () => { await React.act(async () => root.unmount()) })
  await React.act(async () => root.render(h(StudioFeedback, { feedbackId: 'candidate', tone: 'error', autoOpen: false, title: 'Validation needed', details: [{ message: 'Review the source.' }], locale: 'en' })))
  assert.equal(host.querySelector('dialog,[role=alert],[role=status]'), null)
  assert.equal(host.textContent, 'Validation neededView issues')
  button('View issues').focus(); await click('View issues')
  const dialog = host.querySelector('dialog')
  await React.act(async () => dialog.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  assert.equal(host.querySelector('dialog'), null)
  assert.equal(document.activeElement, button('View issues'))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await React.act(async () => root.render(h(StudioFeedback, { feedbackId: 'saved-1', tone: 'success', title: 'Saved', locale: 'en' })))
  assert.equal(host.querySelector('[role=status]').textContent, 'Saved')
  assert.equal(host.querySelector('dialog'), null)
  await React.act(async () => t.mock.timers.tick(4000))
  assert.equal(host.textContent, '')
})

test('missing content stays in its region; background errors offer recovery without opening a modal', async t => {
  const root = createRoot(host); let repairs = 0
  t.after(async () => { await React.act(async () => root.unmount()) })
  await React.act(async () => root.render(h(StudioEmptyState, { title: 'Preview sample is missing', description: 'Add reference/preview.json.', actions: [{ label: 'Add sample', onClick: () => repairs++ }] })))
  assert.ok(host.querySelector('.ygd-studio-content-state[data-tone=warning]'))
  assert.equal(host.querySelector('dialog,[role=alert]'), null)
  assert.deepEqual(feedbackStyleGaps(host, STUDIO_WORKSPACE_CSS), [])
  assert.deepEqual(controlStyleGaps(host, STUDIO_WORKSPACE_CSS), [])
  await click('Add sample'); assert.equal(repairs, 1)
  await React.act(async () => root.render(h(StudioFeedback, { feedbackId: 'ai-check', tone: 'error', title: 'Changes need repair', message: 'parser internal detail', locale: 'en', actions: [{ label: 'Continue repair', onClick: () => repairs++ }] })))
  assert.equal(host.querySelector('dialog'), null)
  assert.doesNotMatch(host.textContent, /parser internal detail/)
  await click('Continue repair'); assert.equal(repairs, 2)
  await click('View issues'); assert.match(host.querySelector('dialog details').textContent, /parser internal detail/)
})
