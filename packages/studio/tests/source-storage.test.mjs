import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm, open, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudioDraftPorts } from '../src/node/studio-panel-drafts.mjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const source = [{ path: 'SKILL.md', base64: Buffer.from('saved source').toString('base64') }]
async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-source-storage-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot }
  const ports = await createStudioDraftPorts(options, 'instance')
  const snapshot = await ports.sources.retainTree(source)
  const identity = { name: 'local_bundle_storage', version: '1.0' }
  const record = { recordVersion: 2, kind: 'bundle', bundle: identity, runtimeName: 'storage', source: { bundle: identity },
    sourceId: 'local:bundle:' + identity.name, title: { zh: '存储', en: 'Storage' }, baseSnapshot: snapshot.id, overlays: {}, mounts: [] }
  return { stateRoot, options, ...ports, snapshot, record, directory: join(stateRoot, 'studio-instance-drafts') }
}

test('current records need no confirmation state; legacy confirmation cannot lock source saves and CAS still rejects stale writers', async t => {
  const f = await fixture(t), record = await f.repository.create(f.record)
  assert.equal(Object.hasOwn(await f.repository.read(record.id), 'confirmed'), false)
  const historical = { format: 'studio-instance-draft/v1', ...record, confirmed: true }
  await writeFile(join(f.directory, record.id + '.json'), JSON.stringify(historical))
  const reopened = await createStudioDraftPorts(f.options, 'instance')
  const read = await reopened.repository.read(record.id)
  assert.equal(Object.hasOwn(read, 'confirmed'), false)
  const saved = await reopened.repository.replace(read.id, read.revision, { ...read, overlays: { 'SKILL.md': 'human edit' } })
  assert.equal(saved.revision, read.revision + 1)
  assert.equal(Object.hasOwn(JSON.parse(await readFile(join(f.directory, record.id + '.json'), 'utf8')), 'confirmed'), false)
  await assert.rejects(f.repository.replace(read.id, read.revision, { ...read, overlays: {} }), /changed elsewhere/)
})

test('existing authoring records do not impose an arbitrary global creation quota', async t => {
  const f = await fixture(t)
  await Promise.all(Array.from({ length: 128 }, async () => {
    const id = randomUUID()
    await writeFile(join(f.directory, id + '.json'), JSON.stringify({ format: 'studio-instance-draft/v1', ...f.record, id, revision: 0, confirmed: false }))
  }))
  const created = await f.repository.create(f.record)
  assert.equal(created.revision, 0)
  assert.equal((await f.repository.list()).length, 129)
})

test('retained source count does not block a new current source and existing snapshots stay intact', async t => {
  const f = await fixture(t), directory = join(f.directory, 'snapshots')
  const saved = []
  for (let offset = 0; offset < 1024; offset += 64) {
    await Promise.all(Array.from({ length: 64 }, async (_, index) => {
      const text = JSON.stringify([['history-' + (offset + index), '']]), id = hash(text)
      await writeFile(join(directory, id + '.json'), text)
      if (offset + index === 0) saved.push({ id, text })
    }))
  }
  const next = await f.sources.retainTree([{ path: 'new.txt', base64: Buffer.from('current').toString('base64') }])
  assert.equal(await next.fs.readText(join(next.root, 'new.txt')), 'current')
  assert.equal(await readFile(join(directory, saved[0].id + '.json'), 'utf8'), saved[0].text)
})

test('unreferenced retained bytes do not impose a cumulative save limit; per-source count, path and integrity boundaries remain', async t => {
  const f = await fixture(t), old = join(f.directory, 'snapshots', 'f'.repeat(64) + '.json')
  // A sparse historical file tests the former aggregate stat-size gate without allocating a large payload.
  const handle = await open(old, 'wx')
  try { await handle.truncate(129 * 1024 * 1024) } finally { await handle.close() }
  const saved = await f.sources.retainTree([{ path: 'next.txt', base64: '' }])
  assert.equal(await saved.fs.readText(join(saved.root, 'next.txt')), '')
  assert.equal((await stat(old)).size, 129 * 1024 * 1024)
  await assert.rejects(f.sources.retainTree(Array.from({ length: 4097 }, (_, i) => ({ path: 'file-' + i, base64: '' }))), /4096/)
  await assert.rejects(f.sources.retainTree([{ path: '../escape', base64: '' }]), /Invalid source/)
  await writeFile(join(f.directory, 'snapshots', saved.id + '.json'), 'tampered')
  await assert.rejects(f.sources.open(saved.id), /integrity/)
})

test('historical Panel trial records and byte sources remain readable without exposing record writers or archive adoption', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-panel-history-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const kitRoot = join(stateRoot, 'installed'), directory = join(stateRoot, 'studio-panel-drafts')
  await mkdir(kitRoot); await mkdir(join(directory, 'snapshots'), { recursive: true })
  const bytes = Buffer.from([0, 255, 128]), text = JSON.stringify([['binary.bin', bytes.toString('base64')]]), id = randomUUID(), baseSnapshot = hash(text)
  const record = { format: 'studio-panel-draft/v1', id, revision: 4, baseSnapshot, kit: { name: 'history', version: '1.0' },
    bundle: { name: 'history_bundle', version: '1.0' }, panelSource: 'saved panel', sampleSource: '{}', confirmed: true }
  await writeFile(join(directory, id + '.json'), JSON.stringify(record))
  await writeFile(join(directory, 'snapshots', baseSnapshot + '.json'), text)
  await writeFile(join(kitRoot, 'current.txt'), 'current installed source')
  const ports = await createStudioDraftPorts({ stateRoot, kitRoot, readInstalledKit: async () => ({ name: 'history', version: '2.0' }) }, 'panel')
  assert.equal((await ports.repository.read(id)).revision, 4)
  const snapshot = await ports.sources.open(baseSnapshot)
  assert.deepEqual(await snapshot.fs.readBytes(join(snapshot.root, 'binary.bin')), bytes)
  assert.equal(ports.repository.create, undefined)
  assert.equal(ports.repository.replace, undefined)
  assert.equal(ports.sources.retain, undefined)
  const captured = await ports.sources.capture({ name: 'history', version: '1.0' })
  assert.equal(await captured.fs.readText(join(captured.root, 'current.txt')), 'current installed source', 'source version is provenance, not an installed capture lock')
  await assert.rejects(ports.sources.capture({ name: 'different_kit', version: '2.0' }), /identity/)
})
