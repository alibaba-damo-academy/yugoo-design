/** Actual LivePreview output in Chromium, plus the underlying CSP form boundary. */
import assert from 'node:assert/strict'
import http from 'node:http'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { JSDOM } from 'jsdom'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LivePreview } from '../src/live-preview.tsx'
import { INTERACTIVE_PREVIEW_SANDBOX, secureDesignSrcDoc } from '../src/client/srcdoc-security.ts'
import { inlinePreviewStylesheet } from '../src/preview-tokens.ts'

globalThis.React = React
const dom = new JSDOM('<!doctype html>')
const previousParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
globalThis.DOMParser = dom.window.DOMParser
const requests = []
const server = http.createServer((request, response) => {
  requests.push({ path: request.url, method: request.method })
  response.end('unexpected form submission')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser, context
const cdpEndpoint = process.env.PANEL_TEST_CDP_ENDPOINT
const evidenceDirectory = process.env.PANEL_TEST_EVIDENCE_DIR
if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true })
try {
  const action = `http://127.0.0.1:${server.address().port}/must-not-submit`
  const html = `<form id="native"><label>Title<input id="title" required></label><button>Submit</button><button type="reset">Cancel</button><output id="result">Waiting</output></form>
    <form id="custom" novalidate><input id="description" required aria-label="Description"><button>Save draft</button><output id="custom-result">Waiting</output></form>
    <button id="review" type="button">Review schedule</button>
    <dialog id="schedule" aria-label="Schedule confirmation"><form method="dialog">
      <label>Reason<input id="reason" required></label>
      <button value="confirmed">Confirm scheduling</button><button value="cancelled" formnovalidate>Cancel scheduling</button>
    </form><form method="post" action="${action}"><button formmethod="dialog" value="local-choice">Confirm local choice</button></form></dialog>
    <output id="schedule-result">Not scheduled</output>
    <script>
    const native=document.getElementById('native'),title=document.getElementById('title'),result=document.getElementById('result');
    title.addEventListener('invalid',()=>{result.textContent='Title required'});
    native.addEventListener('submit',event=>{event.preventDefault();result.textContent='Saved: '+title.value});
    native.addEventListener('reset',()=>{result.textContent='Cancelled'});
    document.getElementById('custom').addEventListener('submit',event=>{event.preventDefault();const text=document.getElementById('description').value;document.getElementById('custom-result').textContent=text.trim()?'Draft: '+text:'Description required'});
    const schedule=document.getElementById('schedule');
    document.getElementById('review').onclick=()=>schedule.showModal();
    schedule.addEventListener('close',()=>{document.getElementById('schedule-result').textContent=schedule.returnValue==='confirmed'?'Scheduled: '+document.getElementById('reason').value:schedule.returnValue});
    </script>`
  const styledHtml = inlinePreviewStylesheet(`<head><link rel="stylesheet" href="./tokens.css"></head>${html}`,
    '#schedule-result { color: rgb(20, 84, 37); font-weight: 700; }')
  const preview = renderToStaticMarkup(React.createElement(LivePreview, { html: styledHtml, variables: {}, title: 'Form prototype' }))
  assert.match(preview, /sandbox="allow-scripts allow-forms"/u)
  browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch({ headless: true })
  context = await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.bringToFront()
  await page.setContent(preview)
  const frame = page.frameLocator('iframe[title="Form prototype"]')
  assert.equal(await page.evaluate(() => document.visibilityState), 'visible')
  assert.equal(await frame.locator('#schedule-result').evaluate(element => getComputedStyle(element).color), 'rgb(20, 84, 37)',
    'the declared local stylesheet is already inlined without a network stylesheet capability')
  await frame.getByRole('button', { name: 'Submit', exact: true }).click()
  assert.equal(await frame.locator('#result').textContent(), 'Title required', 'native invalid event must run')
  await frame.getByLabel('Title', { exact: true }).fill('Palette comparison')
  await frame.getByRole('button', { name: 'Submit', exact: true }).click()
  assert.equal(await frame.locator('#result').textContent(), 'Saved: Palette comparison', 'the host must not suppress the local submit listener')
  await frame.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await frame.getByLabel('Title', { exact: true }).inputValue(), '')
  assert.equal(await frame.locator('#result').textContent(), 'Cancelled')
  await frame.getByLabel('Title', { exact: true }).fill('Keyboard submission')
  await frame.getByLabel('Title', { exact: true }).press('Enter')
  assert.equal(await frame.locator('#result').textContent(), 'Saved: Keyboard submission')
  await frame.getByRole('button', { name: 'Save draft', exact: true }).click()
  assert.equal(await frame.locator('#custom-result').textContent(), 'Description required', 'novalidate author handlers must also receive submit')
  await frame.getByLabel('Description', { exact: true }).fill('Keep all original reasons')
  await frame.getByRole('button', { name: 'Save draft', exact: true }).click()
  assert.equal(await frame.locator('#custom-result').textContent(), 'Draft: Keep all original reasons')

  // Native local form defaults matter as well as author-installed listeners.
  // A capture preventDefault() lets the tests above pass but breaks dialog confirmation.
  await frame.getByRole('button', { name: 'Review schedule', exact: true }).click()
  await frame.getByRole('button', { name: 'Confirm scheduling', exact: true }).click()
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.open), true, 'required input keeps the local dialog open')
  await frame.getByLabel('Reason', { exact: true }).fill('Approved locally')
  if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, 'native-dialog-before-confirm.png') })
  await frame.getByRole('button', { name: 'Confirm scheduling', exact: true }).click()
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.open), false, 'method=dialog must close through the native form default')
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.returnValue), 'confirmed')
  await frame.getByText('Scheduled: Approved locally', { exact: true }).waitFor()
  if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, 'native-dialog-after-confirm.png') })
  await frame.getByRole('button', { name: 'Review schedule', exact: true }).click()
  await frame.getByLabel('Reason', { exact: true }).fill('')
  await frame.getByRole('button', { name: 'Cancel scheduling', exact: true }).click()
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.open), false, 'formnovalidate cancellation remains native')
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.returnValue), 'cancelled')
  await frame.getByRole('button', { name: 'Review schedule', exact: true }).click()
  await frame.getByRole('button', { name: 'Confirm local choice', exact: true }).click()
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.open), false, 'submitter formmethod=dialog overrides its form without network submission')
  assert.equal(await frame.locator('#schedule').evaluate(dialog => dialog.returnValue), 'local-choice')

  // No LivePreview submit guard here: prove CSP itself blocks native navigation,
  // including form.submit(), which bypasses validation and submit listeners.
  const confined = secureDesignSrcDoc(`<form id="get" action="${action}" method="get"><input name="value" value="private"><button>Native network submit</button></form>
    <form id="post" action="${action}" method="post"><input name="value" value="private"></form>
    <button id="direct">Direct network submit</button><p id="retained">Original frame</p>
    <script>document.addEventListener('securitypolicyviolation',event=>parent.postMessage({formViolation:event.effectiveDirective},'*'));document.getElementById('direct').onclick=()=>document.getElementById('post').submit();</script>`, 'interactive-preview')
  await page.evaluate(({ html, sandbox }) => {
    window.formViolations = []
    const probe = document.createElement('iframe')
    probe.title = 'CSP form probe'
    probe.sandbox = sandbox
    probe.srcdoc = html
    window.addEventListener('message', event => {
      if (event.source === probe.contentWindow && event.data?.formViolation) window.formViolations.push(event.data.formViolation)
    })
    document.body.replaceChildren(probe)
  }, { html: confined, sandbox: INTERACTIVE_PREVIEW_SANDBOX })
  const probe = page.frameLocator('iframe[title="CSP form probe"]')
  await probe.getByRole('button', { name: 'Native network submit', exact: true }).click()
  await page.waitForFunction(() => window.formViolations.length >= 1)
  await probe.getByRole('button', { name: 'Direct network submit', exact: true }).click()
  await page.waitForFunction(() => window.formViolations.length >= 2)
  assert.deepEqual(await page.evaluate(() => window.formViolations), ['form-action', 'form-action'])
  assert.equal(await probe.locator('#retained').textContent(), 'Original frame')
  assert.deepEqual(requests, [], 'GET and POST must not leave the preview')
  console.log('PREVIEW LOCAL FORMS AND CSP BROWSER OK')
} finally {
  await context?.close()
  // Closing a CDP connection disconnects this client; the user browser stays open.
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
  if (previousParser) Object.defineProperty(globalThis, 'DOMParser', previousParser)
  else delete globalThis.DOMParser
  dom.window.close()
}
