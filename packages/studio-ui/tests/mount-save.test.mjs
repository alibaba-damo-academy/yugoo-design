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

test('an unrelated membership change preserves a same-name independent snapshot instead of choosing the live candidate', () => {
  const snapshot = { name: b.name, version: b.version, source: { snapshot: 'retained-import', sourceId: 'import:bundle:local_b@1.0' } }
  const imported = { ...seed, importedFromSnapshot: 'original', mounts: [{ bundle: snapshot }], availableBundles: seed.availableBundles }
  assert.deepEqual(selectedMountPins(imported, [b.name, a.name]), [{ name: b.name, version: b.version }, a])
  assert.equal(snapshot.source.snapshot, 'retained-import')
})

test('a local Bundle mount dialog distinguishes its live identity from an independent same-name snapshot', async () => {
  const liveKit = { ...seed, id: 'live-kit', title: { zh: '引用原来源', en: 'Live source' }, mounts: [{ bundle: b }] }
  const snapshotKit = { ...seed, importedFromSnapshot: 'original', id: 'snapshot-kit', title: { zh: '独立导入', en: 'Independent import' },
    mounts: [{ bundle: { name: b.name, version: b.version, source: { snapshot: 'retained-import', sourceId: 'import:bundle:local_b@1.0' } } }] }
  const client = { list: async () => [liveKit, snapshotKit], read: async ({ id }) => id === liveKit.id ? liveKit : snapshotKit,
    updateMounts: async () => assert.fail('reading membership must not save') }
  const f = await mount(BundleMounts, { client, bundle: b, installed: [], locale: 'en' })
  try {
    assert.deepEqual([...document.querySelectorAll('input[type=checkbox]')].map(node => node.checked), [true, false])
  } finally { await f.close() }
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
    assert.deepEqual(requests, [{ id: base.id, expectedRevision: 0, bundles: [a, { ...b, replaceSource: true }] }])
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

test('retained mount cards use bilingual source metadata and keep selection pins unchanged', async () => {
  const retained = { name: 'local_bundle_uuid', version: '1.0', source: { snapshot: 'saved-source', sourceId: 'import:bundle' } }
  const display = { title: { zh: '业务规则', en: 'Business rules' }, displayDescription: { zh: '定义业务判断。', en: 'Define business decisions.' } }
  const record = { ...seed, mounts: [{ bundle: retained, display }], availableBundles: [] }
  let actions
  const props = { record, locale: 'en', client: {}, onSaved: () => assert.fail('read-only inspection'), onActions: value => { actions = value } }
  const f = await mount(MountEditor, props)
  try {
    for (const locale of ['en', 'zh']) {
      await f.render({ ...props, locale })
      assert.equal(document.querySelector('.ygd-studio-bundle-card h3').textContent, display.title[locale])
      assert.equal(document.querySelector('.ygd-studio-card-description').textContent, display.displayDescription[locale])
      assert.equal(document.querySelectorAll('.ygd-studio-mounts-candidates article').length, 0)
      assert.equal(actions.canSave, false)
      assert.deepEqual(selectedMountPins(record, [retained.name]), [{ name: retained.name, version: retained.version }])
    }
  } finally { await f.close() }
})

test.after(() => dom.window.close())

for (const locale of ['en', 'zh']) test(`Kit explicit remove and re-add selects only that source (${locale})`, async () => {
  const old = { name: b.name, version: b.version, source: { snapshot: 'retained', sourceId: 'import' } }
  const base = { ...seed, importedFromSnapshot: 'original', mounts: [{ bundle: old }, { bundle: a }] }
  let actions, submitted
  const f = await mount(MountEditor, { record: base, locale, client: { updateMounts: async request => { submitted = request; return receipt(base, request.bundles) } },
    onSaved: () => {}, onActions: value => { actions = value } })
  try {
    await click(locale === 'zh' ? '移除' : 'Remove'); await click(locale === 'zh' ? '添加' : 'Add')
    assert.equal(actions.canSave, true, 're-selecting a same-name source is a meaningful change')
    await React.act(async () => actions.save())
    assert.deepEqual(submitted.bundles, [a, { ...b, replaceSource: true }])
  } finally { await f.close() }
})

test('current Bundle matches ordinary builtin fallback while same-name imported snapshots stay unchecked', async () => {
  const plain = { ...seed, id: 'ordinary', mounts: [{ bundle: { name: b.name, version: '0.1' } }] }
  const imported = { ...plain, id: 'import', importedFromSnapshot: 'original' }
  const client = { list: async () => [plain, imported], read: async ({ id }) => id === plain.id ? plain : imported }
  const f = await mount(BundleMounts, { client, bundle: { ...b, current: true }, installed: [], locale: 'en' })
  try { assert.deepEqual([...document.querySelectorAll('input[type=checkbox]')].map(node => node.checked), [true, false]) }
  finally { await f.close() }
})

for (const reject of [false, true]) test(`builtin explicit mount materializes or reuses current identity, and ${reject ? 'localizes a rejected save' : 'saves, reopens and unmounts'}`, async () => {
  const builtin = { name: b.name, version: b.version }, current = { ...seed, id: b.instanceId, kind: 'bundle', bundle: builtin, current: true, source: { bundle: builtin } }
  let saved = { ...seed, importedFromSnapshot: 'original', mounts: [{ bundle: { ...builtin, source: { snapshot: 'retained', sourceId: 'original' } } }], availableBundles: [{ ...builtin, title: seed.title }] }
  let edits = 0, writes = 0
  const client = { list: async () => [saved], read: async () => saved, editCurrent: async () => { edits++; return current }, updateMounts: async input => {
    writes++; if (reject && writes === 1) throw Error('Instance changed elsewhere. Reopen it before saving.')
    saved = { ...receipt(saved, input.bundles.map(({ replaceSource, ...pin }) => pin)), availableBundles: [{ ...builtin, instanceId: current.id, title: seed.title }] }; return saved
  } }
  const props = { client, bundle: builtin, installed: [], locale: 'en' }, f = await mount(BundleMounts, props)
  try {
    assert.equal(edits,0); assert.equal(writes,0); assert.equal(document.querySelector('input[type=checkbox]').checked,false)
    await React.act(async()=>Simulate.change(document.querySelector('input[type=checkbox]'),{target:{checked:true}}))
    assert.equal(edits,1); assert.equal(writes,1)
    if (reject) {
      assert.equal(saved.mounts[0].bundle.instanceId,undefined); assert.equal(document.querySelector('input[type=checkbox]').checked,false)
      assert.match(document.body.textContent,/Mounts could not be saved/)
      await React.act(async()=>Simulate.change(document.querySelector('input[type=checkbox]'),{target:{checked:true}}))
      assert.equal(edits,1,'the actual materialized record is retained after mount rejection; no automatic retry')
    }
    assert.equal(saved.mounts[0].bundle.instanceId,current.id); assert.equal(document.querySelector('input[type=checkbox]').checked,true)
    await f.close()
    const reopened = await mount(BundleMounts,props)
    try {
      assert.equal(document.querySelector('input[type=checkbox]').checked,true,'read-only reopen discovers the current identity')
      assert.equal(edits,1)
      await React.act(async()=>Simulate.change(document.querySelector('input[type=checkbox]'),{target:{checked:false}}))
      assert.deepEqual(saved.mounts,[]); assert.equal(edits,1)
    } finally { await reopened.close() }
  } finally { if (document.querySelector('input[type=checkbox]')) await f.close() }
})

test('unchanged independent snapshot receipts must preserve the actual retained source', () => {
  const source = { snapshot:'original-snapshot', sourceId:'original-source' }, base = { ...seed, importedFromSnapshot:'original', mounts:[{bundle:{...a,source}}] }
  const pending = { base, bundles:selectedMountPins(base,[a.name]) }
  assert.equal(mountSaveMatches({...base,revision:1},pending),true)
  for(const wrong of [{...a},{...a,source:{...source,snapshot:'other'}},{...a,source:{...source,sourceId:'other'}}])
    assert.equal(mountSaveMatches({...base,revision:1,mounts:[{bundle:wrong}]},pending),false)
})

test('builtin selection stays visibly selected while editCurrent is pending and never dispatches a mount on materialization failure', async () => {
  const builtin = {name:b.name,version:b.version}, pending = deferred()
  const kit = {...seed,importedFromSnapshot:'original',mounts:[],availableBundles:[{...builtin,title:seed.title}]}
  let writes=0
  const f=await mount(BundleMounts,{client:{list:async()=>[kit],read:async()=>kit,editCurrent:()=>pending.promise,updateMounts:async()=>{writes++;assert.fail('not materialized')}},bundle:builtin,installed:[],locale:'en'})
  try {
    await React.act(async()=>Simulate.change(document.querySelector('input[type=checkbox]'),{target:{checked:true}}))
    assert.equal(document.querySelector('input[type=checkbox]').checked,true)
    assert.equal(document.querySelector('input[type=checkbox]').disabled,true)
    await React.act(async()=>pending.reject(Error('Source capture failed')))
    assert.equal(writes,0);assert.equal(document.querySelector('input[type=checkbox]').checked,false)
    await click('View issues'); assert.match(document.body.textContent,/Source capture failed/)
  }finally{await f.close()}
})
