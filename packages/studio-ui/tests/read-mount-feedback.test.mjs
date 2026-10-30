/** Mounted source checks with explicit read/write fixtures; no Host acceptance. */
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
const { createRoot } = await import('react-dom/client'), { Simulate } = await import('react-dom/test-utils')
const loader = register({ namespace: 'read-mount-feedback', tsconfig: new URL('./source-tsconfig.json', import.meta.url).pathname })
const get = name => loader.import(new URL(`../src/${name}.tsx`, import.meta.url).href, import.meta.url)
const [{ KitFiles }, { BundleMounts }, { MountEditor }, { STUDIO_WORKSPACE_CSS }] = await Promise.all([
  get('KitFiles'), get('BundleMounts'), get('MountEditor'), loader.import(new URL('../src/styles.ts', import.meta.url).href, import.meta.url),
])
const h = React.createElement, host = document.getElementById('root')
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent.trim() === text)
async function click(text) { const node = button(text); assert.ok(node, text); assert.equal(node.disabled, false); await React.act(async () => node.click()) }
async function until(check) { for (let n = 0; n < 100; n++) { if (check()) return; await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 3)) }) } assert.fail('Source fixture did not settle') }
function styles() { assert.deepEqual(controlStyleGaps(host, STUDIO_WORKSPACE_CSS), []); for (const notice of host.querySelectorAll('.ygd-studio-notice,.ygd-studio-loading')) assert.deepEqual(feedbackStyleGaps(notice, STUDIO_WORKSPACE_CSS), []) }
async function fixture(t, Component, props) {
  const root = createRoot(host), render = async next => { await React.act(async () => root.render(h(Component, next))) }
  t.after(async () => { await React.act(async () => root.unmount()) }); await render(props); return render
}
const kitFiles = { name: 'kit-a', version: '1.0', mindset: '# Installed mindset', locale: 'en' }

test('Kit list and file failures retain independent errors and retry only their own operation', async t => {
  let lists = 0, reads = 0, failList = true, failFile = true
  const client = { readKitFiles: async () => { lists++; if (failList) throw Error('List failure'); return ['mindset.md', 'reference.md'] }, readKitFile: async ({ path }) => { reads++; if (failFile) throw Error('File failure'); return { content: '# ' + path } } }
  await fixture(t, KitFiles, { ...kitFiles, client }); await until(() => button('Retry file list') && button('Retry file'))
  styles(); failFile = false; const beforeLists = lists; await click('Retry file'); await until(() => host.querySelector('h1'))
  assert.ok(button('Retry file list')); assert.equal(lists, beforeLists)
  failList = false; const beforeReads = reads; await click('Retry file list'); await until(() => button('reference.md'))
  assert.equal(reads, beforeReads); failFile = true; await click('reference.md'); await until(() => button('Retry file'))
  failFile = false; await click('Retry file'); await until(() => host.querySelector('h1')?.textContent === 'reference.md')
  assert.equal(host.querySelector('.ygd-studio-document-name').textContent, 'reference.md'); styles()
})

test('late Kit reads cannot repopulate a new Kit or a replacement connection', async t => {
  const oldList = deferred(), oldFile = deferred()
  const render = await fixture(t, KitFiles, { ...kitFiles, client: { readKitFiles: () => oldList.promise, readKitFile: () => oldFile.promise } })
  const client = { readKitFiles: async () => ['mindset.md', 'new.md'], readKitFile: async () => ({ content: '# New exact source' }) }
  await render({ ...kitFiles, name: 'kit-b', client }); await until(() => host.querySelector('h1')?.textContent === 'New exact source')
  await React.act(async () => { oldList.resolve(['old-only.md']); oldFile.reject(Error('Old file failed')) })
  assert.equal(button('old-only.md'), undefined); assert.equal(host.querySelector('[role=alert]'), null)
  const pending = deferred(); await render({ ...kitFiles, name: 'kit-b', client: { ...client, readKitFile: () => pending.promise } })
  await render({ ...kitFiles, name: 'kit-b', client }); await until(() => host.querySelector('h1'))
  await React.act(async () => pending.resolve({ content: '# Old connection source' }))
  assert.equal(host.querySelector('h1').textContent, 'New exact source')
})

const a = { name: 'a', version: '1.0' }, b = { name: 'b', version: '1.0' }
const kit = (title = 'Kit A', revision = 0) => ({ id: 'kit', kind: 'kit', revision, title: { en: title, zh: title }, mounts: [], availableBundles: [a, b].map(pin => ({ ...pin, title: { en: pin.name, zh: pin.name } })) })
const mountProps = { bundle: a, installed: [{ name: 'Official', version: '1.0' }], locale: 'en' }
const localCheck = () => [...host.querySelectorAll('input[type=checkbox]')].find(node => !node.closest('label').textContent.includes('Official'))
async function toggle() { await React.act(async () => Simulate.change(localCheck(), { target: { checked: true } })) }

for (const outcome of ['success', 'failure']) test(`late mount ${outcome} cannot modify or unlock the next Bundle`, async t => {
  const write = deferred(), read = deferred(); let second = false, writes = 0
  const client = { list: async () => [{ id: 'kit' }], read: () => second ? read.promise : Promise.resolve(kit()), updateMounts: () => { writes++; return write.promise } }
  const render = await fixture(t, BundleMounts, { ...mountProps, client }); await until(() => localCheck() && !localCheck().disabled)
  styles(); await toggle(); assert.equal(writes, 1)
  second = true; await render({ ...mountProps, bundle: b, client }); await until(() => host.querySelector('.ygd-studio-loading'))
  await React.act(async () => outcome === 'success' ? write.resolve({ ...kit('Old receipt', 1), mounts: [{ bundle: a }] }) : write.reject(Error('Old write failed')))
  assert.match(host.querySelector('.ygd-studio-loading').getAttribute('aria-label'), /Loading mounts/)
  assert.equal(host.querySelector('[role=alert]'), null); assert.equal(localCheck(), undefined)
  await React.act(async () => read.resolve(kit('Kit B', 10))); await until(() => localCheck() && !localCheck().disabled)
  assert.match(localCheck().closest('label').textContent, /Kit B/); assert.equal(localCheck().checked, false)
  assert.doesNotMatch(host.textContent, /Old receipt|Old write failed/); styles()
})

test('mount read recovery and uncertain write verification never repeat the mutation', async t => {
  let fail = true, reads = 0, writes = 0
  let saved = kit()
  const client = { list: async () => { reads++; if (fail) throw Error('Read failed'); return [{ id: 'kit' }] }, read: async () => saved, updateMounts: async () => { writes++; throw Error('Receipt lost') } }
  await fixture(t, BundleMounts, { ...mountProps, client }); await until(() => button('Retry loading'))
  assert.doesNotMatch(host.textContent, /Copy a Kit/); styles(); fail = false; await click('Retry loading'); await until(() => localCheck() && !localCheck().disabled)
  await toggle(); await until(() => button('Refresh mounts')); assert.equal(localCheck().disabled, true); styles()
  await click('Refresh mounts'); await until(() => !host.querySelector('.ygd-studio-loading'))
  assert.equal(localCheck().disabled, true, 'an old read is not proof that the uncertain write failed')
  assert.equal(localCheck().checked, true, 'the requested selection survives readback')
  saved = { ...kit('Kit A', 1), mounts: [{ bundle: a }] }
  await click('Refresh mounts'); await until(() => localCheck() && !localCheck().disabled)
  assert.equal(writes, 1); assert.equal(reads, 4)
})

test('MountEditor identifies a Kit-retained source separately from unavailable global candidates', async t => {
  const record = { ...kit(), availableBundles: [], mounts: [{ bundle: { name: 'retained_rules', version: '1.0',
    source: { snapshot: 'saved-source-hash', sourceId: 'import:bundle:retained_rules@1.0' } } }] }
  let actions
  await fixture(t, MountEditor, { client: {}, record, locale: 'en', onSaved: () => assert.fail('reading must not save'), onActions: value => { actions = value } })
  assert.doesNotMatch(host.textContent, /Source unavailable|Some mounted sources are unavailable/)
  assert.match(host.textContent, /retained with this Kit/)
  assert.equal(host.querySelector('[aria-label="Mounted Bundles"] .ygd-studio-bundle-card') !== null, true)
  assert.equal(host.querySelector('[aria-label="Available Bundles"] .ygd-studio-bundle-card'), null, 'retained source is not a new global candidate')
  assert.equal(actions.canSave, false)
})

test('a missing live Bundle instance is not treated as a usable retained fallback', async t => {
  const record = { ...kit(), availableBundles: [], mounts: [{ bundle: { name: 'missing_live_rules', version: '1.0', instanceId: 'missing-instance',
    source: { snapshot: 'historical-source-hash', sourceId: 'local:bundle:missing_live_rules' } } }] }
  await fixture(t, MountEditor, { client: {}, record, locale: 'en', onSaved: () => assert.fail('reading must not save'), onActions: () => {} })
  assert.match(host.textContent, /Source unavailable/)
  assert.doesNotMatch(host.textContent, /retained with this Kit/)
})

test('MountEditor failure retains selected Bundles and the shared reason entry', async t => {
  const record = { ...kit(), mounts: [{ bundle: a }] }; let actions, writes = 0
  await fixture(t, MountEditor, { client: { updateMounts: async () => { writes++; throw Error('Save failed') } }, record, locale: 'en', onSaved: () => assert.fail('failed write must not report a save'), onActions: value => { actions = value } })
  await click('Add'); await until(() => actions?.canSave); await React.act(async () => actions.save())
  assert.equal(writes, 1); assert.equal(actions.canSave, false, 'an uncertain save must be verified before any new write')
  assert.equal(host.querySelector('dialog'), null, 'uncertain save remains contextual until details are requested'); await click('View issues'); styles()
  assert.match(host.querySelector('dialog').textContent, /Save failed/)
  assert.equal(host.querySelector('section[aria-label="Mounted Bundles"]').querySelectorAll('.ygd-studio-bundle-card').length, 2)
})

const mindset = '---\nname: demo\n---\n\n# Method\n<design_skills>\n- a@1.0\n</design_skills>\n\nTail\n'
test('a replaced mount connection rejects the old write receipt and clears local data when disconnected', async t => {
  const write = deferred()
  const client = { list: async () => [{ id: 'kit' }], read: async () => kit(), updateMounts: () => write.promise }
  const render = await fixture(t, BundleMounts, { ...mountProps, client }); await until(() => localCheck() && !localCheck().disabled)
  await toggle()
  const replacement = { ...client, read: async () => kit('New connection', 8) }
  await render({ ...mountProps, client: replacement }); await until(() => localCheck() && !localCheck().disabled)
  await React.act(async () => write.resolve({ ...kit('Old connection', 1), mounts: [{ bundle: a }] }))
  assert.match(localCheck().closest('label').textContent, /New connection/); assert.equal(localCheck().checked, false)
  await render({ ...mountProps, client: undefined }); assert.equal(localCheck(), undefined)
  assert.equal(host.querySelector('.ygd-studio-loading'), null); assert.equal(host.querySelector('[role=alert]'), null)
})
