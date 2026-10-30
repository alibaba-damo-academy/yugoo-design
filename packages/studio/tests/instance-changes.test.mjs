import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStudioInstanceChanges } from '../src/instance-changes.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStudioInstances } from '../src/node/studio-instances.mjs'
import { adapters, pin } from '../../companion/test/fixtures/studio-changes-fixture.mjs'

test('bounded request copies caller-owned inputs before async host work', () => {
  const input = { id: 'working-copy', expectedRevision: 3, changes: [{ path: 'locales/zh-CN.json', content: '人工说明' }], bundle: { name: 'observations', version: '1.0' }, sampleSource: '{}' }
  const normalized = normalizeStudioInstanceChanges(input)
  input.changes[0].content = 'changed'; input.bundle.name = 'other'
  assert.equal(normalized.changes[0].content, '人工说明'); assert.equal(normalized.bundle.name, 'observations')
  assert.equal(Object.isFrozen(normalized.changes), true); assert.equal(Object.isFrozen(normalized.changes[0]), true)
})
test('path, UTF-8, revision and aggregate budgets fail before storage', () => {
  const valid = { id: 'working-copy', expectedRevision: 0, changes: [{ path: 'a', content: '' }] }
  for (const patch of [
    { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER }, { changes: [] },
    { changes: [{ path: '/absolute', content: '' }] }, { changes: [{ path: 'a/../b', content: '' }] },
    { changes: [{ path: 'x', content: '\ud800' }] }, { changes: [{ path: 'x', content: '\0' }] },
    { changes: Array.from({ length: 5 }, (_, i) => ({ path: `f${i}`, content: 'x'.repeat(1_048_576) })) },
    { sampleSource: 'x'.repeat(262_145) }, { bundle: { name: 'observations', version: 'latest' } },
  ]) assert.throws(() => normalizeStudioInstanceChanges({ ...valid, ...patch }))
  assert.equal(normalizeStudioInstanceChanges({ ...valid, changes: [{ path: 'optional.md', content: null }] }).changes[0].content, null)
})

async function kitFixture(t, { blank = false } = {}) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-kit-source-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const ports = adapters(), options = { stateRoot, ...ports }, service = await createStudioInstances(options)
  let record = await service.create({ kind: 'kit', title: { zh: '测试方法', en: 'Test method' } })
  if (!blank) record = await service.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: [pin] })
  const file = await service.readFile({ id: record.id, path: 'mindset.md' })
  const request = { id: record.id, expectedRevision: record.revision,
    changes: [{ path: file.path, content: file.content + '\nPreserve confirmed design intent.\n' }] }
  return { service, options, ports, record, file, request }
}

test('Kit source candidates validate the real retained definition without preview, then save and reopen exact bytes', async t => {
  const f = await kitFixture(t)
  let previewCalls = 0, validationCalls = 0
  f.ports.composition.preview = async () => { previewCalls++; throw Error('Source-only Kit must not request a Panel.') }
  const validate = f.ports.composition.validateKit
  f.ports.composition.validateKit = async input => { validationCalls++; return validate(input) }
  const candidate = await f.service.prepareChanges(f.request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.equal(Object.hasOwn(candidate, 'preview'), false)
  assert.deepEqual(candidate.diagnostics, [])
  assert.equal(candidate.diff[0].before, f.file.content)
  assert.equal(candidate.diff[0].after, f.request.changes[0].content)
  assert.equal((await f.service.read(f.record.id)).revision, f.record.revision, 'preparation is read-only')
  const saved = await f.service.saveChanges({ ...f.request, mode: 'validated', digest: candidate.digest })
  assert.deepEqual(saved.changeReceipt, { baseRevision: f.record.revision, revision: f.record.revision + 1,
    digest: candidate.digest, mode: 'validated', validation: 'definition_passed' })
  assert.equal(validationCalls, 2, 'save revalidates through the same Core definition port')
  assert.equal(previewCalls, 0)
  const reopened = await createStudioInstances(f.options)
  assert.equal((await reopened.readFile({ id: saved.id, path: 'mindset.md' })).content, f.request.changes[0].content)
  assert.deepEqual((await reopened.read(saved.id)).mounts, f.record.mounts)
})

test('Kit source validated saves retain exact digest, transaction-time validation and stale-base protection', async t => {
  const f = await kitFixture(t), candidate = await f.service.prepareChanges(f.request)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  const save = { ...f.request, mode: 'validated', digest: candidate.digest }
  await assert.rejects(f.service.saveChanges({ ...save, digest: '0'.repeat(64) }), /digest changed/u)
  await assert.rejects(f.service.saveChanges({ ...save, changes: [{ path: 'mindset.md', content: f.file.content }] }), /digest changed/u)
  const validate = f.ports.composition.validateKit
  f.ports.composition.validateKit = async () => { throw Error('Definition rejected during save.') }
  await assert.rejects(f.service.saveChanges(save), /Definition rejected during save/u)
  assert.equal((await f.service.read(f.record.id)).revision, f.record.revision)
  assert.equal((await f.service.readFile({ id: f.record.id, path: 'mindset.md' })).content, f.file.content)
  f.ports.composition.validateKit = validate
  await f.service.saveFile({ id: f.record.id, expectedRevision: f.record.revision, path: 'mindset.md', content: f.file.content + '\nHuman change.\n' })
  const reopened = await createStudioInstances(f.options)
  await assert.rejects(reopened.saveChanges(save), /changed elsewhere/u)
  assert.match((await reopened.readFile({ id: f.record.id, path: 'mindset.md' })).content, /Human change/u)
})

test('invalid Kit definitions and zero-mount blank Kits never acquire validated receipts; explicit draft saves recover text', async t => {
  for (const blank of [false, true]) {
    const f = await kitFixture(t, { blank })
    const request = blank ? f.request : { ...f.request, changes: [{ path: 'relations.yaml', content: 'relations: [\n' }] }
    const candidate = await f.service.prepareChanges(request)
    assert.equal(candidate.valid, false)
    assert.equal(Object.hasOwn(candidate, 'preview'), false)
    assert.ok(candidate.diagnostics.length)
    if (blank) assert.match(candidate.diagnostics[0].message, /nonempty mounts/u)
    await assert.rejects(f.service.saveChanges({ ...request, mode: 'validated', digest: candidate.digest }), /Core definition/u)
    assert.equal((await f.service.read(f.record.id)).revision, f.record.revision)
    const saved = await f.service.saveChanges({ ...request, mode: 'draft', digest: candidate.digest })
    assert.equal(saved.changeReceipt.validation, 'not_requested')
    const reopened = await createStudioInstances(f.options)
    assert.equal((await reopened.readFile({ id: saved.id, path: request.changes[0].path })).content, request.changes[0].content)
  }
})

test('Kit source preparation preserves membership ownership and explicit preview pins retain real preview checks', async t => {
  const f = await kitFixture(t)
  for (const change of [
    { path: 'kit.yaml', content: 'version: 1\nmounts: []\n' },
    { path: 'skills/observations/SKILL.md', content: 'Foreign Bundle source.' },
  ]) await assert.rejects(f.service.prepareChanges({ ...f.request, changes: [change] }), /mount management|Kit-owned/u)
  for (const content of [f.file.content.replace('## observations', '## foreign_bundle'), f.file.content.replace(f.record.kit.name, 'foreign_kit')]) {
    const candidate = await f.service.prepareChanges({ ...f.request, changes: [{ path: 'mindset.md', content }] })
    assert.equal(candidate.valid, false, 'incomplete source gets real diagnostics, not a save prohibition')
  }
  const explicit = { ...f.request, bundle: pin }, candidate = await f.service.prepareChanges(explicit)
  assert.equal(candidate.valid, true, JSON.stringify(candidate.diagnostics))
  assert.deepEqual(candidate.preview.bundle, pin)
  const realPreview = f.ports.composition.preview
  f.ports.composition.preview = async input => { const value = await realPreview(input); return { ...value, preview: { ...value.preview, revision: input.revision + 1 } } }
  await assert.rejects(f.service.saveChanges({ ...explicit, mode: 'validated', digest: candidate.digest }), /revision/u)
  f.ports.composition.preview = realPreview
  const foreign = await f.service.prepareChanges({ ...f.request, bundle: { name: 'foreign_bundle', version: '1.0' } })
  assert.equal(foreign.valid, false)
  const saved = await f.service.saveChanges({ ...explicit, mode: 'validated', digest: candidate.digest })
  assert.equal(saved.changeReceipt.validation, 'preview_passed')
})
