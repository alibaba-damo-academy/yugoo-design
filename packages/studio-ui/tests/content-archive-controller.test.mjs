import test from 'node:test'
import assert from 'node:assert/strict'
import { StudioContentArchiveController, assertStudioImportRequestSize } from '../src/ContentArchiveWorkbench.tsx'

const record = { id: 'import-one', archive: { kind: 'kit', pin: { name: 'demo', version: '1.0' }, provenance: { source: 'fixture', license: 'declared-only' }, files: [], dependencies: [] }, validation: { valid: true, diagnostics: [] }, executionGranted: false, requiresTrustReview: true }
const contents = [{ kind: 'kit', pin: record.archive.pin }]
const draft = { id: 'draft-one', revision: 0, confirmed: false, baseKit: record.archive.pin }
function fixture() {
  const calls = []
  const client = {
    list: async () => [], read: async input => { calls.push(['read', input]); return structuredClone(record) },
    prepare: async input => { calls.push(['prepare', input]); return structuredClone(record) },
    adopt: async input => { calls.push(['adopt', input]); return { importId: input.id, contents, draft, executionGranted: false, requiresTrustReview: true } },
    export: async input => { calls.push(['export', input]); return 'exact archive bytes' },
  }
  return { calls, client, controller: new StudioContentArchiveController(client) }
}
test('file/text prepare → read summary → explicit adoption; declared export provenance', async () => {
  const { controller, calls } = fixture()
  await controller.loadFile({ size: 2, text: async () => '{}' })
  assert.equal(controller.getSnapshot().dirty, true); assert.equal(calls.length, 0)
  await controller.prepare(); assert.equal(controller.getSnapshot().dirty, false)
  assert.equal(controller.getSnapshot().items[0].pin.version, '1.0')
  assert.equal(calls.some(([action]) => action === 'adopt'), false)
  assert.equal((await controller.adopt()).draft.id, draft.id)
  controller.edit('new input'); assert.equal(await controller.adopt(), undefined)
  await controller.select(record.id); assert.equal(controller.getSnapshot().source, '')
  assert.equal(await controller.export(record.archive.pin, record.archive.provenance), 'exact archive bytes')
  assert.deepEqual(calls.at(-1)[1].provenance, record.archive.provenance)
})
test('invalid records never call adopt; valid independent Bundles need no Kit draft', async () => {
  const f = fixture()
  f.client.read = async () => ({ ...record, validation: { valid: false, diagnostics: [{ code: 'bad', message: 'invalid' }] } })
  await f.controller.select(record.id); assert.equal(await f.controller.adopt(), undefined)
  assert.equal(f.calls.length, 0)
  const contents = [{ kind: 'bundle', pin: record.archive.pin }]
  f.client.read = async () => ({ ...record, archive: { ...record.archive, kind: 'bundle' } })
  f.client.adopt = async input => { f.calls.push(['adopt', input]); return { importId: input.id, contents, executionGranted: false, requiresTrustReview: true } }
  await f.controller.select(record.id)
  assert.deepEqual((await f.controller.adopt()).contents, contents)
  assert.deepEqual(f.calls, [['adopt', { id: record.id }]])
  f.client.adopt = async () => ({ importId: record.id, contents, draft, executionGranted: false, requiresTrustReview: true })
  assert.equal(await f.controller.adopt(), undefined, 'a Bundle receipt must not create an implicit Kit working copy')
})
test('HTTP wrapper/escaping and oversize file reject before RPC/read without truncation', async () => {
  const f = fixture(); let read = false
  await f.controller.loadFile({ size: 12 * 1024 * 1024 + 1, text: async () => { read = true; return '' } })
  assert.equal(read, false); assert.match(f.controller.getSnapshot().error, /12 MiB/)
  assert.throws(() => assertStudioImportRequestSize('"'.repeat(7 * 1024 * 1024)), /12 MiB/)
  f.controller.edit('"'.repeat(7 * 1024 * 1024)); await f.controller.prepare()
  assert.equal(f.calls.length, 0); assert.equal(f.controller.getSnapshot().source.length, 7 * 1024 * 1024)
})
test('busy selection blocks edits; disposal rejects late responses and follow-on actions', async () => {
  const f = fixture(); let finish
  f.client.read = () => new Promise(resolve => { finish = resolve })
  const pending = f.controller.select(record.id)
  f.controller.edit('late edit'); assert.equal(f.controller.getSnapshot().source, '')
  f.controller.dispose(); finish(record); await pending
  assert.equal(f.controller.getSnapshot().record, undefined)
  assert.equal(await f.controller.adopt(), undefined)
  assert.equal(await f.controller.select(record.id), undefined)
})
test('adoption verifies exact content closure, retained identity and inert authority', async () => {
  const f = fixture(); await f.controller.select(record.id)
  const receipt = { importId: record.id, contents, draft, executionGranted: false, requiresTrustReview: true }
  for (const altered of [
    { importId: 'different' }, { executionGranted: true }, { requiresTrustReview: false },
    { contents: [] }, { contents: [...contents, ...contents] },
    { contents: [{ kind: 'kit', pin: { name: 'different', version: '1.0' } }] },
    { draft: { ...draft, baseKit: { name: 'different', version: '1.0' } } },
    { draft: { ...draft, confirmed: undefined } }, { draft: { ...draft, revision: 1 } },
  ]) {
    f.client.adopt = async () => ({ ...receipt, ...altered })
    assert.equal(await f.controller.adopt(), undefined)
    assert.match(f.controller.getSnapshot().error, /Adoption response/)
  }
  const dependency = { name: 'dependency', version: '2.0' }
  f.client.read = async () => ({ ...record, archive: { ...record.archive, dependencies: [dependency] } })
  await f.controller.select(record.id)
  f.client.adopt = async () => receipt
  assert.equal(await f.controller.adopt(), undefined, 'Kit adoption must retain its entire exact Bundle closure')
  f.client.adopt = async () => ({ ...receipt, contents: [...contents, { kind: 'bundle', pin: dependency }] })
  assert.equal((await f.controller.adopt()).draft.id, draft.id)
})

test('read rejects a different archive ID or execution authority without replacing the selection', async () => {
  const f = fixture()
  f.client.read = async () => ({ ...record, id: 'other' })
  await f.controller.select(record.id)
  assert.equal(f.controller.getSnapshot().record, undefined)
  assert.match(f.controller.getSnapshot().error, /selected inert archive/)
  f.client.read = async () => ({ ...record, executionGranted: true })
  await f.controller.select(record.id)
  assert.equal(f.controller.getSnapshot().record, undefined)
})
