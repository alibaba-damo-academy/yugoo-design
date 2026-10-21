import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DesignProjectManager, nodeDesignProjectSpawn, GitVersioning, ProjectContentTransaction,
  DesignJournalStorage, recordProjectContentAdoption } from '../lib/index.js'

const hash = 'a'.repeat(64)
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'content-adoption-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const root = join(base, 'project'), manager = new DesignProjectManager()
  const project = await manager.create({ root, name: 'existing identity', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'fixture', version: '1.0' } })
  await mkdir(join(root, 'design_files', 'example'))
  const state = 'design_files/example/example.json', asset = 'design_files/example/image.bin'
  await writeFile(join(root, state), '{"userFact":"kept","old":true}\n')
  await writeFile(join(root, asset), Buffer.from([0, 255, 8, 12]))
  const git = new GitVersioning(nodeDesignProjectSpawn, root)
  const head = await git.head()
  const sourceCheckpoint = await git.commitExact('fixture source', new Map([[state, await readFile(join(root, state))], [asset, await readFile(join(root, asset))]]), head)
  const source = await manager.open(root)
  const metadata = { ...source.metadata, kit: { ...source.metadata.kit, version: '1.1', contentHash: hash } }
  const files = new Map([['project.json', Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`)], [state, Buffer.from('{"userFact":"kept","renamed":true}\n')]])
  const seen = new Set(), receipts = []
  const record = async receipt => { if (!seen.has(receipt.operationId)) { seen.add(receipt.operationId); receipts.push(receipt) } }
  const transaction = options => new ProjectContentTransaction({ root, spawn: nodeDesignProjectSpawn, mutate: operation => operation(), record, ...options })
  const input = { projectId: source.metadata.id, sourceCheckpoint, contentHash: hash, files, validate: async captured => {
    assert.equal(JSON.parse(Buffer.from(captured.get(state)).toString()).userFact, 'kept')
  } }
  return { root, manager, git, source, sourceCheckpoint, state, asset, files, receipts, transaction, input }
}

test('actual journal append/crash replay records exactly one adoption audit fact', async t => {
  const f = await fixture(t), journal = new DesignJournalStorage(join(f.root, '..', 'journal'))
  const record = async receipt => recordProjectContentAdoption(journal, 'native-main', receipt,
    JSON.parse(Buffer.from(f.files.get('project.json')).toString()).kit)
  await assert.rejects(f.transaction({ record, boundary: async phase => {
    if (phase === 'journal-recorded') throw new Error('crash after real append')
  } }).adopt(f.input), /crash after real append/)
  const receipt = await f.transaction({ record }).recover()
  const reopened = await new DesignJournalStorage(join(f.root, '..', 'journal')).read('native-main')
  assert.equal(reopened.records.length, 1)
  assert.equal(reopened.records[0].data.adoption.checkpoint, receipt.checkpoint)
  assert.equal(reopened.records[0].data.operation, 'upgrade')
  assert.equal((await f.manager.open(f.root)).metadata.id, f.source.metadata.id)
})

test('update-ref CAS rejection aborts the prepared receipt without reverting an unrelated commit', async t => {
  const f = await fixture(t)
  let raced = false
  const spawn = async input => {
    if (!raced && input.argv[1] === 'update-ref') {
      raced = true
      await f.git.commitExact('another writer', new Map([['note.txt', Buffer.from('external fact')]]), f.sourceCheckpoint)
    }
    return nodeDesignProjectSpawn(input)
  }
  await assert.rejects(f.transaction({ spawn }).adopt(f.input))
  const externalHead = await f.git.head()
  assert.notEqual(externalHead, f.sourceCheckpoint)
  assert.equal(await f.transaction().recover(), undefined)
  assert.equal(await f.git.head(), externalHead)
  assert.equal((await f.manager.open(f.root)).metadata.kit.version, '1.0')
  assert.equal(f.receipts.length, 0)
})

test('one adoption commits pins and canonical data together and reopens the same identity/root', async t => {
  const f = await fixture(t)
  const receipt = await f.transaction().adopt(f.input)
  assert.notEqual(receipt.checkpoint, f.sourceCheckpoint)
  const reopened = await f.manager.open(f.root)
  assert.equal(reopened.metadata.id, f.source.metadata.id)
  assert.equal(reopened.root, f.root)
  assert.equal(reopened.metadata.kit.version, '1.1')
  assert.equal(reopened.metadata.kit.contentHash, hash)
  assert.equal(JSON.parse(await readFile(join(f.root, f.state), 'utf8')).userFact, 'kept')
  assert.deepEqual(await readFile(join(f.root, f.asset)), Buffer.from([0, 255, 8, 12]))
  assert.equal(f.receipts.length, 1)
  assert.equal((await f.manager.status(reopened)).dirty, false)
  assert.equal((await f.git.history(2))[1].commit, f.sourceCheckpoint)
})

test('validation failure leaves original checkpoint, bytes, pin and identity untouched', async t => {
  const f = await fixture(t)
  await assert.rejects(f.transaction().adopt({ ...f.input, validate: async () => { throw new Error('semantic equivalence not established') } }), /semantic equivalence/)
  assert.equal(await f.git.head(), f.sourceCheckpoint)
  assert.equal((await f.manager.open(f.root)).metadata.kit.version, '1.0')
  assert.equal(JSON.parse(await readFile(join(f.root, f.state), 'utf8')).old, true)
  assert.equal(f.receipts.length, 0)
})

for (const phase of ['prepared', 'committed', 'files-synced', 'journal-recorded']) {
  test(`crash at ${phase} recovers without recreating a project or duplicate journal fact`, async t => {
    const f = await fixture(t)
    await assert.rejects(f.transaction({ boundary: async reached => { if (reached === phase) throw new Error('simulated crash') } }).adopt(f.input), /simulated crash/)
    await assert.rejects(f.manager.open(f.root), /reconciliation is pending/)
    const result = await f.transaction().recover()
    const reopened = await f.manager.open(f.root)
    assert.equal(reopened.metadata.id, f.source.metadata.id)
    assert.equal(reopened.metadata.kit.version, phase === 'prepared' ? '1.0' : '1.1')
    assert.equal(f.receipts.length, phase === 'prepared' ? 0 : 1)
    assert.equal(result === undefined, phase === 'prepared')
    assert.equal(await f.transaction().recover(), undefined)
    assert.equal((await f.manager.status(reopened)).dirty, false)
  })
}

test('post-Git journal failure reports a pending adoption and reconciles the same committed bytes', async t => {
  const f = await fixture(t)
  await assert.rejects(f.transaction({ record: async () => { throw new Error('journal disk fault') } }).adopt(f.input), /journal disk fault/)
  const published = await f.git.head()
  assert.notEqual(published, f.sourceCheckpoint)
  await f.transaction().recover()
  assert.equal(await f.git.head(), published)
  assert.equal(f.receipts[0].checkpoint, published)
  assert.equal((await f.manager.open(f.root)).metadata.id, f.source.metadata.id)
})

test('external edits after commit block recovery and remain byte-for-byte intact', async t => {
  const f = await fixture(t)
  await assert.rejects(f.transaction({ boundary: async phase => { if (phase === 'committed') throw new Error('crash') } }).adopt(f.input), /crash/)
  const external = '{"userFact":"new unsaved user edit"}\n'
  await writeFile(join(f.root, f.state), external)
  await assert.rejects(f.transaction().recover(), /external edit conflicts/)
  assert.equal(await readFile(join(f.root, f.state), 'utf8'), external)
  assert.equal(f.receipts.length, 0)
})

test('stale and uncommitted candidates cannot adopt, and project UUID changes are rejected', async t => {
  const f = await fixture(t)
  await assert.rejects(f.transaction().adopt({ ...f.input, sourceCheckpoint: 'f'.repeat(40) }), /stale/)
  await writeFile(join(f.root, f.state), 'user edit')
  await assert.rejects(f.transaction().adopt(f.input), /uncommitted edit/)
  await writeFile(join(f.root, f.state), await f.git.readBytesAt(f.sourceCheckpoint, f.state))
  const metadata = JSON.parse(f.files.get('project.json').toString())
  metadata.id = '11111111-1111-4111-8111-111111111111'
  await assert.rejects(f.transaction().adopt({ ...f.input, files: new Map([...f.files, ['project.json', Buffer.from(JSON.stringify(metadata))]]) }), /preserve project identity/)
  assert.equal(await f.git.head(), f.sourceCheckpoint)
})

test('a user edit arriving during target validation is preserved and prevents adoption', async t => {
  const f = await fixture(t)
  await assert.rejects(f.transaction().adopt({ ...f.input, validate: async () => writeFile(join(f.root, f.state), 'user edit during validation') }), /edit arrived during validation/)
  assert.equal(await f.git.head(), f.sourceCheckpoint)
  assert.equal(await readFile(join(f.root, f.state), 'utf8'), 'user edit during validation')
})
