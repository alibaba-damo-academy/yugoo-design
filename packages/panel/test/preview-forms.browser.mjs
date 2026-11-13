/** Actual LivePreview output in Chromium, plus the underlying CSP form boundary. */
import assert from 'node:assert/strict'
import http from 'node:http'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chromium } from 'playwright'
import { JSDOM } from 'jsdom'
import { LivePreview } from '../src/live-preview.tsx'
import { INTERACTIVE_PREVIEW_SANDBOX, secureDesignSrcDoc } from '../src/client/srcdoc-security.ts'

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
try {
  const action = `http://127.0.0.1:${server.address().port}/must-not-submit`
  const html = `<form id="native"><label>Title<input id="title" required></label><button>Submit</button><button type="reset">Cancel</button><output id="result">Waiting</output></form>
    <form id="custom" novalidate><input id="description" required aria-label="Description"><button>Save draft</button><output id="custom-result">Waiting</output></form>
    <script>
    const native=document.getElementById('native'),title=document.getElementById('title'),result=document.getElementById('result');
    title.addEventListener('invalid',()=>{result.textContent='Title required'});
    native.addEventListener('submit',()=>{result.textContent='Saved: '+title.value});
    native.addEventListener('reset',()=>{result.textContent='Cancelled'});
    document.getElementById('custom').addEventListener('submit',()=>{const text=document.getElementById('description').value;document.getElementById('custom-result').textContent=text.trim()?'Draft: '+text:'Description required'});
    </script>`
  const preview = renderToStaticMarkup(React.createElement(LivePreview, { html, variables: {}, title: 'Form prototype' }))
  assert.match(preview, /sandbox="allow-scripts allow-forms"/u)
  browser = cdpEndpoint ? await chromium.connectOverCDP(cdpEndpoint) : await chromium.launch({ headless: true })
  context = await browser.newContext()
  const page = await context.newPage()
  await page.setContent(preview)
  const frame = page.frameLocator('iframe[title="Form prototype"]')
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
