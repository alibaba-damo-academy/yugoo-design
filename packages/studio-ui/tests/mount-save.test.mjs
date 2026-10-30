/** S2 mounted UI/receipt boundaries; no native Host or durable-save acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import React from 'react'
import { mountSaveMatches, mountWriteWasRejected, selectedMountPins } from '../src/mount-save-receipt.ts'
const { JSDOM } = createRequire(new URL('../../panel/package.json', import.meta.url))('jsdom')
const dom = new JSDOM('<main></main>', { url: 'http://127.0.0.1:32123/' })
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createRoot } = await import('react-dom/client'), { Simulate } = await import('react-dom/test-utils')
const { MountEditor } = await import('../src/MountEditor.tsx')
const { BundleMounts } = await import('../src/BundleMounts.tsx')
const { InstanceWorkbench } = await import('../src/InstanceWorkbench.tsx')
const h = React.createElement, a = { name: 'a', version: '1.0' }, b = { name: 'local_b', version: '1.0', instanceId: 'bundle-copy' }
const seed = { id: 'kit-copy', revision: 0, kind: 'kit', kit: { name: 'local_kit', version: '1.0' }, source: { kit: { name: 'installed_kit', version: '1.0' } }, title: { zh: 'Kit 副本', en: 'Kit copy' },
  mounts: [{ bundle: a }], refs: [], files: [{ path: 'mindset.md', editable: true, bytes: 9 }], availableBundles: [a, b].map(pin => ({ ...pin, title: { zh: pin.name, en: pin.name } })) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label)
const click = async label => { const node = button(label); assert.ok(node, label); assert.equal(node.disabled, false, label); await React.act(async () => node.click()) }
async function mount(Component, props) {
  const host = document.createElement('div'); document.querySelector('main').append(host)
  const root = createRoot(host), render = props => React.act(async () => root.render(h(Component, props)))
  await render(props)
  return { render, close: async () => { await React.act(async () => root.unmount()); host.remove() } }
}
const receipt = (base, bundles) => ({ ...base, revision: base.revision + 1, mounts: bundles.map(bundle => ({ bundle })) })

test('S2 mount receipts require the same Kit identity, next revision and ordered local identities', () => {
  const bundles = selectedMountPins(seed, ['a', 'local_b']), pending = { base: seed, bundles }, saved = receipt(seed, bundles)
  assert.deepEqual(bundles, [a, b]); assert.equal(mountSaveMatches(saved, pending), true)
  for (const patch of [{ id: 'foreign' }, { kind: 'bundle' }, { revision: 0 }, { revision: 2 }, { deletedAt: 'deleted' }, { title: { ...seed.title, en: 'Other' } }, { kit: { ...seed.kit, name: 'other' } }, { source: { kit: { name: 'other', version: '1.0' } } }, { mounts: [] }, { mounts: [...saved.mounts].reverse() }, { mounts: [{ bundle: a }, { bundle: { ...b, instanceId: 'other' } }] }]) assert.equal(mountSaveMatches({ ...saved, ...patch }, pending), false)
  assert.equal(mountSaveMatches(undefined, pending), false)
  assert.equal(mountWriteWasRejected(new Error('studioAuthoring/updateMounts: Instance changed elsewhere. Reopen it before saving.')), true)
  assert.equal(mountWriteWasRejected(new Error('Bundle binding keys must be unique.')), true)
  assert.equal(mountWriteWasRejected(new Error('This working copy is no longer available or has been moved to the system trash.')), true)
  assert.equal(mountWriteWasRejected(new Error('studioAuthoring/updateMounts: Bundle local_b@1.0 is unavailable in the global catalog.')), true)
  assert.equal(mountWriteWasRejected(new Error('Network response lost')), false)
  assert.equal(mountWriteWasRejected(Object.assign(new Error('Invalid response'), { name: 'ZodError' })), false)
})

for (const mismatch of ['foreign', 'stale', 'selection']) test(`MountEditor retains selection and verifies a ${mismatch} save receipt without repeating writes`, async () => {
  let actions, saved = seed, writes = 0
  const accepted = [], dirty = [], requests = []
  const client = { read: async () => saved, updateMounts: async input => {
    writes++; requests.push(input)
    const correct = receipt(seed, input.bundles)
    return mismatch === 'foreign' ? { ...correct, id: 'other' } : mismatch === 'stale' ? { ...correct, revision: 0 } : { ...correct, mounts: [{ bundle: a }] }
  } }
  const props = { client, record: seed, locale: 'en', onSaved: value => accepted.push(value), onActions: value => { actions = value }, onDirtyChange: value => dirty.push(value) }
  const f = await mount(MountEditor, props)
  try {
    await click('Add')
    await React.act(async () => { await Promise.all([actions.save(), actions.save()]) })
    assert.equal(writes, 1, 'the synchronous submit fence blocks double dispatch')
    assert.deepEqual(requests[0], { id: seed.id, expectedRevision: 0, bundles: [a, b] })
    assert.equal(accepted.length, 0); assert.equal(actions.canSave, false); assert.equal(dirty.at(-1), true)
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 2)
    assert.ok([...document.querySelectorAll('[aria-label="Mounted Bundles"] button')].every(node => node.disabled))
    await click('Verify mounts'); assert.equal(actions.saveUnverified, true, 'old readback cannot unlock another write')
    saved = receipt(seed, [a, b]); await click('Verify mounts')
    assert.equal(writes, 1); assert.equal(accepted.length, 1); assert.equal(actions.isSaveSubmitted(), false)
  } finally { await f.close() }
})

test('a known S2 rejection keeps mount selection editable and never retries by itself', async () => {
  let actions, writes = 0
  const f = await mount(MountEditor, { record: seed, locale: 'en', client: { updateMounts: async () => { writes++; throw Error('Instance changed elsewhere. Reopen it before saving.') } }, onSaved: () => assert.fail('rejected write'), onActions: value => { actions = value } })
  try {
    await click('Add'); await React.act(async () => actions.save())
    assert.equal(actions.canSave, true); assert.equal(actions.saveUnverified, false); assert.equal(writes, 1)
    assert.equal(button('Verify mounts'), undefined)
    assert.ok([...document.querySelectorAll('[aria-label="Mounted Bundles"] button')].every(node => !node.disabled))
  } finally { await f.close() }
})

test('MountEditor late receipts cannot affect a newly selected Kit', async () => {
  let actions; const pending = deferred(), accepted = [], busy = []
  const client = { updateMounts: () => pending.promise }
  const props = record => ({ client, record, locale: 'en', onSaved: value => accepted.push(value), onActions: value => { actions = value }, onBusyChange: value => busy.push(value) })
  const f = await mount(MountEditor, props(seed))
  try {
    await click('Add'); let saving
    await React.act(async () => { saving = actions.save() })
    await f.render(props({ ...seed, id: 'new-kit', mounts: [] }))
    const before = busy.length
    await React.act(async () => { pending.resolve(receipt(seed, [a, b])); await saving })
    assert.equal(accepted.length, 0); assert.equal(busy.length, before)
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 0)
    assert.equal(actions.saveUnverified, false)
  } finally { await f.close() }
})

test('a replacement MountEditor connection preserves pending choices and ignores the previous receipt', async () => {
  let actions; const pending = deferred(), accepted = []
  const props = client => ({ client, record: seed, locale: 'en', onSaved: value => accepted.push(value), onActions: value => { actions = value } })
  const f = await mount(MountEditor, props({ updateMounts: () => pending.promise }))
  try {
    await click('Add'); let saving
    await React.act(async () => { saving = actions.save() })
    await f.render(props({ read: async () => receipt(seed, [a, b]), updateMounts: () => assert.fail('verification cannot submit') }))
    assert.equal(actions.saveUnverified, true); assert.equal(actions.canSave, false)
    await React.act(async () => { pending.resolve(receipt(seed, [a, b])); await saving })
    assert.equal(accepted.length, 0)
    await click('Verify mounts'); assert.equal(accepted.length, 1)
  } finally { await f.close() }
})

test('BundleMounts verifies wrong receipts and retains the chosen local pin across old reads', async () => {
  let saved = { ...seed, mounts: [] }, writes = 0
  const client = { list: async () => [{ id: seed.id }], read: async () => saved, updateMounts: async () => { writes++; return { ...saved, id: 'foreign', revision: 1 } } }
  const f = await mount(BundleMounts, { client, bundle: b, installed: [], locale: 'en' })
  const check = () => document.querySelector('input[type=checkbox]')
  try {
    await React.act(async () => Simulate.change(check(), { target: { checked: true } }))
    assert.equal(check().disabled, true); assert.equal(check().checked, true)
    await click('Refresh mounts'); assert.equal(check().disabled, true); assert.equal(check().checked, true)
    saved = receipt(saved, [b]); await click('Refresh mounts')
    assert.equal(writes, 1); assert.equal(check().disabled, false); assert.equal(check().checked, true)
  } finally { await f.close() }
})

test('BundleMounts preserves unavailable existing pins and local instance identity on save', async () => {
  const requests = [], base = { ...seed, availableBundles: seed.availableBundles.filter(pin => pin.name === b.name) }
  const client = { list: async () => [{ id: base.id }], read: async () => base, updateMounts: async input => { requests.push(input); return receipt(base, input.bundles) } }
  const f = await mount(BundleMounts, { client, bundle: b, installed: [], locale: 'en' })
  try {
    await React.act(async () => Simulate.change(document.querySelector('input[type=checkbox]'), { target: { checked: true } }))
    assert.deepEqual(requests, [{ id: base.id, expectedRevision: 0, bundles: [a, b] }])
    assert.equal(document.querySelector('[role=alert]'), null)
  } finally { await f.close() }
})

test('BundleMounts explicit rejection allows an intentional correction without an automatic second write', async () => {
  let writes = 0
  const client = { list: async () => [{ id: seed.id }], read: async () => seed, updateMounts: async input => {
    writes++; if (writes === 1) throw Error('Bundle binding keys must be unique.')
    return receipt(seed, input.bundles)
  } }
  const f = await mount(BundleMounts, { client, bundle: b, installed: [], locale: 'en' })
  const toggle = () => React.act(async () => Simulate.change(document.querySelector('input[type=checkbox]'), { target: { checked: true } }))
  try {
    await toggle(); assert.equal(writes, 1)
    assert.equal(document.querySelector('input[type=checkbox]').disabled, false)
    assert.equal(document.querySelector('input[type=checkbox]').checked, false)
    await toggle(); assert.equal(writes, 2)
    assert.equal(document.querySelector('[role=alert]'), null)
  } finally { await f.close() }
})

test('Instance initial load shows loading without an empty-file assertion', async () => {
  const read = deferred()
  const f = await mount(InstanceWorkbench, { client: { read: () => read.promise, readFile: async ({ id, path }) => ({ id, path, revision: 0, content: '# Method' }) }, id: seed.id, locale: 'en', onBack: () => {}, onChanged: () => {} })
  try {
    assert.ok(document.querySelector('[aria-label="Opening content"]'))
    assert.equal(document.querySelector('.ygd-studio-file-tree-header'), null)
    assert.doesNotMatch(document.body.textContent, /No readable files|All Files · 0/)
    await React.act(async () => read.resolve(seed))
    assert.equal(document.querySelector('[aria-label="Opening content"]'), null)
    assert.match(document.querySelector('.ygd-studio-file-tree-header').textContent, /All Files · 1/)
  } finally { await f.close() }
})

test('Instance global actions preserve unknown mount selection; Refresh verifies without discard or second save', async () => {
  let saved = seed, writes = 0, confirms = 0, supplement
  const changed = [], dirty = []
  window.confirm = () => { confirms++; return true }
  const client = { read: async () => saved, readFile: async ({ id, path }) => ({ id, path, revision: saved.revision, content: '# Method' }), updateMounts: async () => { writes++; throw Error('Receipt lost') } }
  const f = await mount(InstanceWorkbench, { client, id: seed.id, locale: 'en', onBack: () => {}, onChanged: value => changed.push(value), onDirtyChange: value => dirty.push(value), renderSupplement: value => { supplement = value; return null } })
  try {
    await click('Mount management'); await click('Add'); await click('Save')
    assert.equal(writes, 1); assert.equal(dirty.at(-1), true)
    for (const label of ['Save', 'Revert', 'Source Files', 'Rename', 'Copy', 'Move to Trash']) assert.equal(button(label).disabled, true, label)
    assert.equal(supplement.proposalReplacement.canDiscard(), false)
    await click('Refresh content')
    assert.equal(confirms, 0); assert.equal(button('Save').disabled, true)
    assert.equal(document.querySelectorAll('[aria-label="Mounted Bundles"] article').length, 2)
    saved = receipt(seed, [a, b]); await click('Refresh content')
    assert.equal(writes, 1); assert.equal(changed.length, 1); assert.equal(dirty.at(-1), false)
    assert.equal(button('Source Files').disabled, false)
  } finally { await f.close() }
})

test.after(() => dom.window.close())
