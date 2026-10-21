/** Simulated DOM acceptance, not browser UX or installed-host evidence. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { ContentArchiveWorkbench } from '../src/ContentArchiveWorkbench.tsx'
const requirePanel = createRequire(new URL('../../panel/package.json', import.meta.url))
const { JSDOM } = requirePanel('jsdom')
const dom = new JSDOM('<html lang="en"><body><div id="root"></div></body></html>', { url: 'http://localhost/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
const { createRoot } = await import('react-dom/client')
const { act } = React
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const root = createRoot(document.getElementById('root'))
let discarded = false, dirty = false, adopted, exportInput, downloaded, revoked = false
window.confirm = () => discarded
URL.createObjectURL = blob => { downloaded = blob; return 'blob:fixture' }
URL.revokeObjectURL = () => { revoked = true }
window.HTMLAnchorElement.prototype.click = function () { assert.match(this.download, /demo-1\.0\.studio-content\.json/) }
const valid = { id: 'one', archive: { kind: 'kit', pin: { name: 'demo', version: '1.0' }, provenance: { source: '<unsafe source>', license: 'declared-only' }, files: [], dependencies: [{ name: 'alpha', version: '1.0' }] }, validation: { valid: true, diagnostics: [] }, executionGranted: false, requiresTrustReview: true }
const records = [valid, { ...valid, id: 'invalid', validation: { valid: false, diagnostics: [{ code: 'archive.definition', message: 'Invalid definition' }] } }, { ...valid, id: 'bundle', archive: { ...valid.archive, kind: 'bundle' } }]
const client = {
  list: async () => records.map(row => ({ ...row, kind: row.archive.kind, pin: row.archive.pin })),
  read: async ({ id }) => records.find(row => row.id === id), prepare: async () => valid,
  adopt: async ({ id }) => {
    const record = records.find(row => row.id === id)
    return { importId: id, contents: [{ kind: record.archive.kind, pin: record.archive.pin }, ...(record.archive.kind === 'kit' ? record.archive.dependencies.map(pin => ({ kind: 'bundle', pin })) : [])],
      ...(record.archive.kind === 'kit' ? { draft: { id: 'draft-one', confirmed: false, revision: 0, baseKit: valid.archive.pin } } : {}), executionGranted: false, requiresTrustReview: true }
  },
  export: async input => { exportInput = input; return 'exact exported archive' },
}
const button = text => [...document.querySelectorAll('button')].find(item => item.textContent === text)
const click = async text => { assert.ok(button(text), text); await act(async () => button(text).click()) }
const input = async (label, value) => {
  const element = document.querySelector(`[aria-label="${label}"]`); assert.ok(element, label)
  await act(async () => { const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })) })
}
await act(async () => root.render(React.createElement(React.StrictMode, {}, React.createElement(ContentArchiveWorkbench, { client, installedKit: valid.archive.pin, locale: 'en', canAdoptKit: true, onAdopt: result => { adopted = result }, onDirtyChange: value => { dirty = value } }))))
assert.equal(document.querySelector('details').open, false, 'pasted JSON is secondary and initially collapsed')
assert.equal(button('Download installed Kit archive').disabled, true, 'no invented provenance defaults')
const fileInput = document.querySelector('input[type="file"]')
Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ size: 2, text: async () => '{}' }] })
await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })))
assert.equal(dirty, true); assert.equal(adopted, undefined)
await click('Prepare import'); assert.equal(dirty, false)
assert.match(document.body.textContent, /demo @1\.0/); assert.match(document.body.textContent, /Bundle: 1/)
assert.match(document.body.textContent, /declared-only/); assert.match(document.body.textContent, /Trust review required/)
assert.equal(document.querySelector('.ygd-studio-diagnostics'), null, 'valid archives have no empty error region')
assert.equal(document.querySelector('unsafe'), null, 'provenance is escaped text, not HTML')
await input('Archive JSON', 'unprepared input')
await click('kit · demo @1.0'); assert.equal(dirty, true, 'cancelled discard retains input')
assert.equal(button('Adopt Kit and create working copy').disabled, true)
discarded = true; await click('kit · demo @1.0'); assert.equal(dirty, false)
await click('Adopt Kit and create working copy'); assert.equal(adopted.draft.id, 'draft-one')
const readRows = [...document.querySelectorAll('[aria-label="Content Archives"] button')]
await act(async () => readRows[1].click())
assert.equal(button('Adopt Kit and create working copy').disabled, true); assert.match(document.body.textContent, /Invalid definition/)
await act(async () => readRows[2].click())
assert.equal(button('Adopt Bundle').disabled, false); assert.match(document.body.textContent, /adopted independently/)
await click('Adopt Bundle'); assert.equal(adopted.draft, undefined); assert.equal(adopted.contents[0].kind, 'bundle')
await input('Declared source', 'user supplied origin'); await input('Declared license', 'user supplied license')
await click('Download installed Kit archive')
assert.deepEqual(exportInput.provenance, { source: 'user supplied origin', license: 'user supplied license' })
assert.equal(await downloaded.text(), 'exact exported archive'); assert.equal(revoked, true)

await act(async () => root.render(React.createElement(ContentArchiveWorkbench, { key: 'readonly', client, locale: 'en', canAdoptKit: false, onAdopt: result => { adopted = result }, onDirtyChange: () => {} })))
await input('Archive JSON', '{}'); await click('Prepare import')
assert.equal(button('Adopt Kit and create working copy').disabled, true, 'Kit adoption needs the Kit editor capability')
assert.equal(button('Download installed Kit archive').disabled, true, 'a noninstalled copy is not offered as an installed export')
assert.match(document.body.textContent, /Open an installed Kit workspace/)
await click('bundle · demo @1.0'); await click('Adopt Bundle')
assert.equal(adopted.draft, undefined, 'independent Bundle adoption needs no Kit authoring capability')
await act(async () => root.unmount())
console.log('Archive file/secondary text/summary/diagnostics/explicit adopt/declared export/dirty guard/read-only host rendered PASS')
