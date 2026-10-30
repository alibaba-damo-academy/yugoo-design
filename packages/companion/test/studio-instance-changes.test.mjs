import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudioInstances } from '../src/studio-instances.mjs'
import { adapters, additions, pin, originalFiles, textOf } from './fixtures/studio-changes-fixture.mjs'

async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-multifile-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const ports = adapters(), options = { stateRoot, ...ports }, service = await createStudioInstances(options)
  const record = await service.copy({ kind: 'bundle', bundle: pin })
  return { service, options, record, ports, stateRoot }
}
const readAll = async (service, id) => {
  const record = await service.read({ id }), result = {}
  for (const file of record.files.filter(file => file.editable)) result[file.path] = (await service.readFile({ id, path: file.path })).content
  return result
}

test('one exact source candidate supplies diff, real Core preview, atomic CAS and fresh-service reopen', async t => {
  const { service, record, options, stateRoot } = await fixture(t)
  const request = { id: record.id, expectedRevision: 0, changes: additions() }
  const before = await readAll(service, record.id), snapshots = await readdir(join(stateRoot, 'studio-instance-drafts/snapshots'))
  const candidate = await service.prepareChanges(request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.equal(candidate.preview.revision, candidate.revision); assert.equal(candidate.revision, 1)
  assert.deepEqual(candidate.diff.map(file => file.path), request.changes.map(file => file.path).sort())
  for (const diff of candidate.diff) { assert.equal(diff.before, before[diff.path]); assert.equal(diff.after, request.changes.find(change => change.path === diff.path).content) }
  assert.deepEqual(await readAll(service, record.id), before, 'prepare does not save or stage a second mutable source')
  assert.deepEqual(await readdir(join(stateRoot, 'studio-instance-drafts/snapshots')), snapshots)
  const saved = await service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest })
  assert.equal(saved.revision, 1); assert.equal(saved.confirmed, undefined)
  assert.deepEqual(saved.changeReceipt, { baseRevision: 0, revision: 1, digest: candidate.digest, mode: 'validated', validation: 'preview_passed' })
  const reopened = await createStudioInstances(options), after = await readAll(reopened, record.id)
  for (const change of request.changes) assert.equal(after[change.path], change.content)
  assert.equal(after['SKILL.md'], before['SKILL.md']); assert.equal(after['reference/preview.json'], before['reference/preview.json'])
  assert.equal((await reopened.read({ id: record.id })).baseSnapshot, saved.baseSnapshot)
  assert.equal((await reopened.preview({ id: record.id, expectedRevision: 1 })).diagnostics.length, 0)
  assert.equal(textOf(originalFiles, 'skill.yaml').includes('identity:'), false, 'installed fixture sources were not modified')
})
test('changed digest, wrong preview revision and stale base cannot save a validated candidate', async t => {
  const { service, record, options, ports } = await fixture(t), changes = additions()
  const request = { id: record.id, expectedRevision: 0, changes }, candidate = await service.prepareChanges(request)
  await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: '0'.repeat(64) }), /digest changed/)
  await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest, changes: [...changes, { path: 'SKILL.md', content: 'different source' }] }), /digest changed/)
  const realPreview = ports.composition.preview
  ports.composition.preview = async input => { const result = await realPreview(input); return { ...result, preview: { ...result.preview, revision: input.revision + 1 } } }
  await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /revision/)
  assert.equal((await service.read(record.id)).revision, 0)
  ports.composition.preview = realPreview
  await service.saveFile({ id: record.id, expectedRevision: 0, path: 'SKILL.md', content: 'Manual source retained.' })
  const concurrent = await createStudioInstances(options)
  await assert.rejects(concurrent.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /changed elsewhere/)
  assert.equal((await concurrent.readFile({ id: record.id, path: 'SKILL.md' })).content, 'Manual source retained.')
  assert.equal((await concurrent.readFile({ id: record.id, path: 'schema.yaml' })).content, textOf(originalFiles, 'schema.yaml'))
})
test('invalid/missing source is recoverable as draft and never a validated candidate', async t => {
  const { service, record, options } = await fixture(t)
  const changes = [{ path: 'schema.yaml', content: null }, { path: 'reference/pending.md', content: 'Unfinished author text, preserved exactly.\n' }]
  const request = { id: record.id, expectedRevision: 0, changes }
  const candidate = await service.prepareChanges(request)
  assert.equal(candidate.valid, false); assert.ok(candidate.diagnostics.length)
  await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /Core preview/)
  assert.equal((await service.read(record.id)).revision, 0)
  const saved = await service.saveChanges(request)
  assert.equal(saved.changeReceipt.validation, 'not_requested'); assert.equal(saved.revision, 1)
  const reopened = await createStudioInstances(options)
  await assert.rejects(reopened.readFile({ id: record.id, path: 'schema.yaml' }), /does not exist/)
  assert.equal((await reopened.readFile({ id: record.id, path: 'reference/pending.md' })).content, changes[1].content)
  const restored = await reopened.saveChanges({ id: record.id, expectedRevision: 1, changes: [{ path: 'schema.yaml', content: textOf(originalFiles, 'schema.yaml') }] })
  assert.equal(restored.revision, 2); assert.equal((await reopened.preview({ id: record.id, expectedRevision: 2 })).diagnostics.length, 0)
})
test('real Core rejects duplicate options and old sample outside the edited enum without changing current files', async t => {
  const { service, record } = await fixture(t), before = await readAll(service, record.id)
  for (const changes of [
    [{ path: 'panel.yaml', content: before['panel.yaml'].replace('{value: closed,', '{value: open,') }],
    [{ path: 'schema.yaml', content: before['schema.yaml'].replace('[open, closed]', '[review, closed]') }, { path: 'panel.yaml', content: before['panel.yaml'].replace('{value: open,', '{value: review,') }],
  ]) {
    const request = { id: record.id, expectedRevision: 0, changes }, candidate = await service.prepareChanges(request)
    assert.equal(candidate.valid, false); assert.ok(candidate.diagnostics.length)
    await assert.rejects(service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /Core preview/)
    assert.deepEqual(await readAll(service, record.id), before)
  }
})
test('bounded changes reject traversal, duplicate paths, binary edits and file-directory collisions without writes', async t => {
  const { service, record } = await fixture(t), before = await readAll(service, record.id)
  const invalid = [
    [{ path: '../outside', content: 'x' }], [{ path: 'schema.yaml', content: '{}' }, { path: 'schema.yaml', content: '{}' }],
    [{ path: 'reference/preserved.bin', content: 'replace binary' }], [{ path: 'SKILL.md/child', content: 'x' }],
    [{ path: 'missing.md', content: null }], [{ path: 'a.md', content: 'x'.repeat(1_048_577) }],
    Array.from({ length: 65 }, (_, index) => ({ path: `file${index}.md`, content: 'x' })),
  ]
  for (const changes of invalid) {
    await assert.rejects(service.prepareChanges({ id: record.id, expectedRevision: 0, changes }))
    await assert.rejects(service.saveChanges({ id: record.id, expectedRevision: 0, changes }))
  }
  assert.deepEqual(await readAll(service, record.id), before); assert.equal((await service.read(record.id)).revision, 0)
})
