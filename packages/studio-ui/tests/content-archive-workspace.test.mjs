/** Shared React integration; real browser geometry and installed hosts remain separate. */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { archiveFixture } from './content-archive-fixture.mjs'
import { controlStyleGaps, feedbackStyleGaps } from './control-style-coverage.mjs'
const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
const dom = new JSDOM('<div id="root"></div>', { url: 'https://studio.test/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector('button')?.focus() }
window.HTMLDialogElement.prototype.close = function () { this.open = false }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client')
const { StudioWorkspace, StudioWorkspaceController, InstanceWorkbench, STUDIO_WORKSPACE_CSS } = await import(process.env.STUDIO_CONTENT_ARCHIVE_BUILT === '1' ? '../lib/index.js' : '../src/index.ts')
after(() => dom.window.close())
const pin = { name: 'imported_kit', version: '2.0' }
const button = (text, scope = document) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text)
const click = async (text, scope) => { const node = button(text, scope); assert.ok(node, text); assert.equal(node.disabled, false, text); await React.act(async () => node.click()) }
const edit = async (node, value) => { assert.ok(node); await React.act(async () => { Object.getOwnPropertyDescriptor(node.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })) }) }
const until = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await React.act(async () => new Promise(resolve => setTimeout(resolve, 5))) } assert.fail('UI did not settle') }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function selectFile(file = { size: 12, name: 'SKILL.md', text: async () => '# My method' }) {
  if (button('Import') && !button('Import').disabled) await click('Import')
  const input = document.querySelector('input[type=file]'); assert.ok(input)
  Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] })
  await React.act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}
const copy = (kind = 'bundle') => ({ id: kind + '-copy', kind, revision: 4, title: { en: kind + ' copy', zh: '本地副本' }, source: kind === 'kit' ? { kit: pin } : { bundle: pin }, bundle: kind === 'bundle' ? pin : undefined, mounts: [], refs: [], files: [{ path: kind === 'kit' ? 'mindset.md' : 'SKILL.md', editable: true, bytes: 12 }] })
function ConversationFrame({ children, onDirtyChange }) {
  const [value, setValue] = React.useState('')
  return React.createElement('div', {}, React.createElement('textarea', { 'aria-label': 'Unsent host input', value, onChange: event => { setValue(event.target.value); onDirtyChange(true) } }), children)
}
async function fixture(t, options = {}) {
  const calls = [], exports = [], removed = [], local = [...(options.copies ?? [])]
  const client = { workspace: async () => ({ query: '', kits: [], bundles: options.installedBundle ? [{ ...pin, description: 'Independent methods', usedBy: [] }] : [] }), readBundleWorkspace: async () => ({ workspace: { ...pin, description: 'Independent Bundle', files: [], panel: { kind: 'native', renderer: 'fixture' } }, diagnostics: [] }) }
  const controller = new StudioWorkspaceController(client); await controller.load(); controller.setSection(options.section ?? 'bundles')
  const instances = {
    list: async () => [...local], read: async ({ id }) => local.find(row => row.id === id),
    readFile: async ({ id, path }) => ({ id, path, revision: local.find(row => row.id === id)?.revision ?? 0, content: '# Saved method' }),
    create: async () => copy(), remove: async input => removed.push(input),
    importSources: async input => {
      calls.push(input)
      const row = { ...copy(input.kind), id: `import-${calls.length}`, revision: 0, title: { en: `Imported ${calls.length}`, zh: `导入 ${calls.length}` }, readiness: { ready: !options.incomplete, diagnostics: options.incomplete ? [{ code: 'missing', message: 'Missing required file: panel.yaml', path: 'panel.yaml' }] : [] } }
      local.push(row); return row
    },
  }
  const contentClient = { export: async input => { exports.push(input); return archiveFixture() }, prepare: async () => { throw Error('Legacy import must not be called') } }
  const root = createRoot(document.getElementById('root')); let mounted = true, context
  const close = async () => { if (mounted) { mounted = false; await React.act(async () => root.unmount()) } }; t.after(close)
  const previous = [URL.createObjectURL, URL.revokeObjectURL, window.HTMLAnchorElement.prototype.click], downloads = []
  URL.createObjectURL = () => 'blob:download'; URL.revokeObjectURL = () => {}
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download) }
  t.after(() => { [URL.createObjectURL, URL.revokeObjectURL, window.HTMLAnchorElement.prototype.click] = previous })
  await React.act(async () => root.render(React.createElement(StudioWorkspace, { client, controller, contentClient, instances, locale: 'en',
    ...(options.initial ? { initialInstance: { id: options.initial.id, expectedRevision: options.initial.revision } } : {}),
    renderContent: (content, current) => { context = current; return React.createElement(ConversationFrame, { onDirtyChange: current.onDirtyChange }, content) },
  })))
  return { client, controller, contentClient, instances, calls, exports, removed, downloads, close, context: () => context }
}

test('Bundle import next to New accepts bare Skill with no metadata form', async t => {
  const f = await fixture(t), input = document.querySelector('input[type=file]')
  let picks = 0; input.click = () => picks++
  await click('Import'); assert.equal(picks, 1); await selectFile()
  assert.equal(f.calls[0].kind, 'bundle'); assert.equal(f.calls[0].files[0].path, 'SKILL.md')
  assert.match(document.querySelector('.ygd-studio-kits-grid').textContent, /Imported 1/)
  assert.equal(document.querySelector('dialog'), null)
  assert.deepEqual(controlStyleGaps(document, STUDIO_WORKSPACE_CSS), [])
})
test('incomplete Bundle can stay, warn on its card, and open authoring with repair context', async t => {
  const f = await fixture(t, { incomplete: true }); await selectFile()
  assert.match(document.querySelector('dialog').textContent, /panel.yaml/)
  await click('Not now'); assert.equal(document.querySelector('dialog'), null)
  await click('⚠ Incomplete'); await click('Complete with AI')
  await until(() => document.querySelector('[aria-label="Unsent host input"]'))
  assert.match(f.context().initialPrompt, /panel.yaml/); assert.match(f.context().initialPrompt, /preserving its existing SKILL.md/)
  assert.equal(f.calls.length, 1)
})
test('Kit import checks its own core files and accepts a selected folder', async t => {
  const f = await fixture(t, { section: 'kits' }); await selectFile(); assert.equal(f.calls.length, 0)
  await click('View issues'); assert.match(document.querySelector('dialog[open] .ygd-studio-error-details').textContent, /mindset.md/)
  await click('Close error dialog')
  const input = document.querySelector('[webkitdirectory]')
  Object.defineProperty(input, 'files', { configurable: true, value: ['mindset.md', 'kit.yaml'].map(name => ({ name, size: 4, webkitRelativePath: 'my-kit/' + name, text: async () => 'text' })) })
  await React.act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  assert.equal(f.calls[0].kind, 'kit'); assert.deepEqual(f.calls[0].files.map(file => file.path), ['mindset.md', 'kit.yaml'])
})
test('cancel and pending selections are inert; failed import can retry', async t => {
  const f = await fixture(t), gate = deferred(), save = f.instances.importSources
  await selectFile(null); assert.equal(f.calls.length, 0)
  let attempts = 0; f.instances.importSources = async input => { attempts++; await gate.promise; return save(input) }
  await selectFile(); await selectFile(); assert.equal(attempts, 1)
  await React.act(async () => gate.reject(Error('Network unavailable')))
  f.instances.importSources = save; await selectFile(); assert.equal(f.calls.length, 1)
})
test('unmount while reading never sends late write', async t => {
  const f = await fixture(t), gate = deferred()
  await selectFile({ name: 'SKILL.md', size: 4, text: () => gate.promise }); await f.close()
  await React.act(async () => gate.resolve('text')); assert.equal(f.calls.length, 0)
})
for (const method of ['workspace', 'list']) test(`import survives ${method} refresh failure without repeated writes`, async t => {
  const f = await fixture(t), owner = method === 'workspace' ? f.client : f.instances, read = owner[method]
  owner[method] = async () => { throw Error('List unavailable') }
  await selectFile(); assert.equal(f.calls.length, 1); await until(() => button('Retry refresh'))
  owner[method] = read; await click('Retry refresh'); assert.equal(f.calls.length, 1)
})
test('direct local export retains revision and unsent conversation', async t => {
  const row = copy(), f = await fixture(t, { copies: [row], initial: row })
  await until(() => document.querySelector('[aria-label="Unsent host input"]'))
  const composer = document.querySelector('[aria-label="Unsent host input"]')
  await edit(composer, 'Keep this request'); await click('Export')
  assert.deepEqual(f.exports, [{ id: row.id, expectedRevision: row.revision }]); assert.equal(document.querySelector('dialog'), null)
  assert.equal(composer.value, 'Keep this request'); assert.deepEqual(f.downloads, ['bundle copy.zip'])
})
test('installed direct export preserves kind/pin and suppresses duplicate requests', async t => {
  const f = await fixture(t, { installedBundle: true }), gate = deferred(); let calls = 0
  f.contentClient.export = async input => { calls++; f.exports.push(input); await gate.promise; return archiveFixture() }
  await click('Export'); assert.equal(button('Export').disabled, true)
  await React.act(async () => button('Export').click()); assert.equal(calls, 1)
  await React.act(async () => gate.resolve()); assert.deepEqual(f.exports, [{ kind: 'bundle', pin }])
  assert.equal(f.downloads[0], 'imported_kit.zip')
})

test('source edits, rename and pending save still prevent export until the new revision is saved', async t => {
  let record = copy(), release
  const exported = [], root = createRoot(document.getElementById('root'))
  const client = { read: async () => record, readFile: async ({ id, path }) => ({ id, path, revision: record.revision, content: '# Saved source' }), saveFile: async () => { await new Promise(resolve => { release = resolve }); record = { ...record, revision: 5 }; return record } }
  t.after(async () => React.act(async () => root.unmount()))
  await React.act(async () => root.render(React.createElement(InstanceWorkbench, { client, id: record.id, locale: 'en', onBack() {}, onChanged() {}, onExport: value => exported.push(value) })))
  await until(() => document.querySelector('textarea[aria-label="SKILL.md"]'))
  assert.equal(button('Export').disabled, false)
  await edit(document.querySelector('textarea[aria-label="SKILL.md"]'), '# New source')
  assert.equal(button('Export').disabled, true); await click('Save'); assert.equal(button('Export').disabled, true)
  await React.act(async () => release()); await until(() => !button('Export').disabled)
  await click('Export'); assert.equal(exported[0].revision, 5)
  await click('Rename'); assert.equal(button('Export').disabled, true)
  await edit(document.querySelector('input[aria-label="Name"]'), 'New copy title')
  assert.equal(button('Export').disabled, true); assert.equal(exported.length, 1)
})

test('toolbar refresh catches copy-list failure and offers a successful retry', async t => {
  const f = await fixture(t), read = f.instances.list
  f.instances.list = async () => { throw Error('Copy list unavailable') }
  await click('Refresh content'); await until(() => button('Retry refresh'))
  assert.match(document.querySelector('.ygd-studio-error-entry').textContent, /Could not refresh content/)
  assert.equal(button('Refresh content').disabled, false)
  f.instances.list = read
  await click('Retry refresh'); assert.equal(document.querySelector('.ygd-studio-error-entry'), null)
})

test('unsent host input protects browser reload as well as in-app navigation', async t => {
  const row = copy(); await fixture(t, { copies: [row], initial: row })
  await until(() => document.querySelector('[aria-label="Unsent host input"]'))
  const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean)
  assert.equal(clean.defaultPrevented, false)
  await edit(document.querySelector('[aria-label="Unsent host input"]'), 'Keep this request on reload')
  const dirty = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(dirty)
  assert.equal(dirty.defaultPrevented, true)
})

test('Kit-count badge is the single mount entry on Bundle cards', async t => {
  await fixture(t, { installedBundle: true })
  assert.equal(button('View mounts'), undefined)
  await click('0 Kit · View mounts')
  await until(() => document.querySelector('dialog'))
  assert.match(document.querySelector('dialog').textContent, /mount/i)
})
