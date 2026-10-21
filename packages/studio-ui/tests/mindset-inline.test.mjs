// Source-plane focused check: TSX_TSCONFIG_PATH=packages/studio-ui/tsconfig.json node --import tsx --test packages/studio-ui/tests/mindset-inline.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MindsetInlineController, splitMindsetSource } from '../src/mindset-inline-controller.ts'
import { MindsetInlineEditor } from '../src/MindsetInlineEditor.tsx'

const source = '\uFEFF---\r\nname: demo\r\nversion: "1.0"\r\n---\r\n\r\n# Method\r\n\r\n<design_skills>\r\n- example@1.0\r\n</design_skills>\r\n\r\n  Preserve spaces  \r\n'
const kit = { name: 'demo', version: '1.0' }
const record = () => ({ id: 'draft', revision: 0, baseKit: { ...kit }, baseSnapshot: 'snapshot', mounts: [{ name: 'example', version: '1.0' }], mindsetSource: source, relationsSource: '# unrelated\r\n', confirmed: false })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture(overrides = {}) {
  let stored = record()
  const calls = [], adopted = []
  const client = {
    async create(input) { calls.push(['create', input]); return structuredClone(stored) },
    async read(id) { calls.push(['read', id]); return structuredClone(stored) },
    async save(input) {
      calls.push(['save', input]); assert.equal(input.expectedRevision, stored.revision)
      stored = { ...stored, ...input, revision: stored.revision + 1 }; return structuredClone(stored)
    }, ...overrides,
  }
  return { controller: new MindsetInlineController(client, kit, source, value => adopted.push(value)), client, calls, adopted }
}

test('offset slicing preserves every byte and refuses ambiguous method declarations', () => {
  const segments = splitMindsetSource(source)
  assert.equal(segments.map(s => s.text).join(''), source)
  assert.equal(segments[0].text, '\uFEFF---\r\nname: demo\r\nversion: "1.0"\r\n---\r\n')
  assert.equal(segments[2].text, '<design_skills>\r\n- example@1.0\r\n</design_skills>')
  for (const invalid of ['---\nunfinished', '# body only', source + '<design_skills>', source + '<design_skills', source.replace('</design_skills>', ''), source.replace('<design_skills>', '<design_skills x="a">')]) {
    assert.throws(() => splitMindsetSource(invalid))
  }
})

test('lazy create, protected segments, cancel without save, reopen and exact CAS save', async () => {
  const f = fixture()
  assert.equal(f.calls.length, 0)
  await f.controller.begin()
  f.controller.edit(0, 'overwrite frontmatter')
  assert.equal(f.controller.getSnapshot().dirty, false)
  f.controller.edit(1, '\r\n# Edited\r\n')
  assert.equal(f.controller.getSnapshot().dirty, true)
  f.controller.cancel()
  assert.equal(f.calls.length, 1)
  assert.equal(f.adopted.length, 0)
  assert.equal(f.controller.getSnapshot().source, source)
  await f.controller.begin()
  assert.equal(f.calls[1][0], 'read')
  const before = f.controller.getSnapshot().segments
  f.controller.edit(3, '\r\n\r\n changed trailing body  \r\n')
  await f.controller.save()
  const input = f.calls.at(-1)[1]
  assert.equal(input.expectedRevision, 0)
  assert.equal(input.relationsSource, '# unrelated\r\n')
  const after = splitMindsetSource(input.mindsetSource)
  assert.deepEqual(after.filter(s => s.protected), before.filter(s => s.protected))
  assert.equal(f.adopted.at(-1), input.mindsetSource)
  assert.equal(f.controller.getSnapshot().unpublished, true)
  assert.equal(f.controller.getSnapshot().editing, false)
  await f.controller.begin()
  f.controller.edit(1, 'next')
  await f.controller.save()
  assert.equal(f.calls.at(-1)[1].expectedRevision, 1)
})

test('conflict retains the input, revision and dirty guard; retry is explicit', async () => {
  const f = fixture({ async save() { throw new Error('CAS conflict') } })
  await f.controller.begin(); f.controller.edit(1, 'pending body')
  await f.controller.save()
  assert.equal(f.controller.getSnapshot().segments[1].text, 'pending body')
  assert.equal(f.controller.getSnapshot().dirty, true)
  assert.equal(f.controller.getSnapshot().editing, true)
  assert.equal(f.controller.getSnapshot().busy, false)
  assert.equal(f.controller.getSnapshot().error, 'CAS conflict')
  assert.equal(f.adopted.length, 0)
})

test('new protection markers cannot become saved method declarations', async () => {
  const f = fixture(); await f.controller.begin()
  f.controller.edit(1, '<design_skills>replacement</design_skills>')
  await f.controller.save()
  assert.equal(f.calls.length, 1)
  assert.equal(f.controller.getSnapshot().dirty, true)
  assert.ok(f.controller.getSnapshot().error)
})

test('late create and save after disposal/pin switch cannot adopt source', async () => {
  const createJob = deferred(), f = fixture({ create: () => createJob.promise })
  const begin = f.controller.begin(); f.controller.dispose(); createJob.resolve(record()); await begin
  assert.equal(f.adopted.length, 0)
  assert.equal(f.controller.getSnapshot().editing, false)
  const saveJob = deferred(), g = fixture({ save: () => saveJob.promise })
  await g.controller.begin(); g.controller.edit(1, 'late')
  const requested = g.controller.getSnapshot().segments.map(segment => segment.text).join('')
  const save = g.controller.save(); g.controller.dispose()
  const fresh = new MindsetInlineController(g.client, { ...kit, version: '2.0' }, source, value => g.adopted.push(value))
  saveJob.resolve({ ...record(), revision: 1, mindsetSource: requested }); await save
  assert.equal(g.adopted.length, 0)
  assert.equal(fresh.getSnapshot().source, source)
})

test('wrong pin, locked record, changed installed bytes and wrong saved receipt are rejected', async () => {
  for (const changed of [{ baseKit: { ...kit, version: '2.0' } }, { confirmed: true }, { mindsetSource: source + 'externally changed' }]) {
    const f = fixture({ create: async () => ({ ...record(), ...changed }) }); await f.controller.begin()
    assert.equal(f.controller.getSnapshot().editing, false); assert.ok(f.controller.getSnapshot().error)
  }
  const f = fixture({ save: async () => ({ ...record(), revision: 1 }) })
  await f.controller.begin(); f.controller.edit(1, 'edited'); await f.controller.save()
  assert.equal(f.adopted.length, 0); assert.equal(f.controller.getSnapshot().dirty, true)
})

test('component is an inline optional edit control, not another workspace', () => {
  const f = fixture()
  const html = renderToStaticMarkup(React.createElement(MindsetInlineEditor, { authoring: { client: f.client }, kit, installedSource: source, onSource() {}, onDirtyChange() {} }))
  assert.match(html, /编辑原文/)
  assert.doesNotMatch(html, /<main|<aside|<textarea/)
  assert.equal(f.calls.length, 0)
})

test('explicit saved ID restores draft bytes after remount without another create', async () => {
  const stored = { ...record(), revision: 4, mindsetSource: source + 'saved body\r\n' }
  const readIds = [], adopted = [], receipts = []
  const f = fixture({ create: async () => { throw new Error('must not create') }, read: async id => { readIds.push(id); return stored },
    save: async input => { assert.equal(input.expectedRevision, 4); return { ...stored, mindsetSource: input.mindsetSource, revision: 5 } } })
  const controller = new MindsetInlineController(f.client, kit, source, value => adopted.push(value), { initialId: 'draft', onRecord: value => receipts.push(value) })
  await controller.begin()
  assert.deepEqual(readIds, ['draft'])
  assert.equal(controller.getSnapshot().source, stored.mindsetSource)
  assert.equal(adopted[0], stored.mindsetSource)
  assert.equal(receipts[0].revision, 4)
  assert.equal(controller.getSnapshot().unpublished, true)
  receipts[0].baseKit.name = 'external mutation'
  controller.edit(1, 'restored edit'); await controller.save()
  assert.equal(controller.getSnapshot().dirty, false)
  assert.equal(receipts.at(-1).revision, 5)
  assert.equal(receipts.at(-1).baseKit.name, 'demo')
  assert.equal(adopted.at(-1), receipts.at(-1).mindsetSource)
  const wrong = new MindsetInlineController({ ...f.client, read: async () => ({ ...stored, id: 'other' }) }, kit, source, () => { throw new Error('must not adopt') }, { initialId: 'draft' })
  await wrong.begin()
  assert.match(wrong.getSnapshot().error, /selected record/)
})

test('StrictMode effect disposal/re-activation restarts an explicit read and rejects its older reply', async () => {
  const jobs = [deferred(), deferred()], adopted = [], receipts = []
  let calls = 0
  const f = fixture({ read: () => jobs[calls++].promise })
  const c = new MindsetInlineController(f.client, kit, source, value => adopted.push(value), { initialId: 'draft', onRecord: value => receipts.push(value) })
  const first = c.begin(); c.dispose(); c.activate(); const second = c.begin()
  jobs[1].resolve(record()); await second
  jobs[0].resolve({ ...record(), mindsetSource: source + 'old response' }); await first
  assert.equal(calls, 2)
  assert.equal(c.getSnapshot().busy, false)
  assert.equal(c.getSnapshot().source, source)
  assert.equal(receipts.length, 1)
  assert.deepEqual(adopted, [source])
})
