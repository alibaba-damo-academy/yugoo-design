import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rename } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { LadybugDesignKnowledgeProvider as Provider, isRecoverableLadybugError, shutdownLadybugKnowledgeRuntime } from '../lib/index.js'
import { refreshDesignKnowledge, readCompleteDesignKnowledge, publishKnowledgeReview, knowledgeSemanticInput, publishKnowledgeSemantic } from '../../core/lib/index.js'
const require = createRequire(import.meta.url), ladybug = require('@ladybugdb/wasm-core/nodejs')
after(() => shutdownLadybugKnowledgeRuntime())
const pathFor = (root, id) => join(root, createHash('sha256').update(id).digest('hex') + '.lbdb')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function assertBackup(root, id, original) {
  const path = pathFor(root, id), manifest = JSON.parse(await readFile(path + '.recovery.json'))
  const name = path.split('/').at(-1)
  assert.equal(digest(await readFile(join(root, manifest.backup, name))), digest(original))
}
const files = { 'a/a.json': JSON.stringify({ records: { a: { name: '研究计划', description: '论文证据' } } }),
  'b/b.json': JSON.stringify({ records: { b: { name: '研究计划', description: '论文证据' } } }) }
const store = { head: async () => 'c1', listPathsAt: async () => Object.keys(files), readTextAt: async (_, path) => files[path] }
async function oldDatabase(id) {
  const root = await mkdtemp('/tmp/knowledge-recovery-test-')
  const provider = await Provider.open(id, { databaseRoot: root }); await provider.close()
  const db = new ladybug.Database(pathFor(root, id)), connection = new ladybug.Connection(db)
  await connection.init()
  const result = await connection.query('MATCH (s:KnowledgeSchema) SET s.schemaVersion = 1;')
  assert.equal(result.isSuccess(), true); await result.close(); await connection.close(); await db.close()
  return root
}
function rebuild(id, options = {}) {
  return async provider => {
    await refreshDesignKnowledge({ projectId: id, service: provider, store, mutate: fn => fn() })
    await options.during?.(provider)
    return async () => { await options.fence?.() }
  }
}
test('recovery classifier excludes identity, lock, permission and resource failures', () => {
  for (const text of ['EACCES', 'ENOSPC', 'out of memory', 'project metadata', 'already open']) {
    assert.equal(isRecoverableLadybugError(new Error(text, { cause: new Error('memory access out of bounds') })), false)
  }
  assert.equal(isRecoverableLadybugError(new Error('memory access out of bounds')), true)
  assert.equal(isRecoverableLadybugError(new Error('unknown error')), false)
})
test('old derived schema rebuilds under one lock, preserves bytes, reopens, fences old GRA and indexing', async () => {
  const id = 'recovered', root = await oldDatabase(id), path = pathFor(root, id)
  const original = await readFile(path), states = []
  let provider, other
  try {
    other = await Provider.open('other', { databaseRoot: root })
    provider = await Provider.open(id, { databaseRoot: root, projectLockRetries: 0 }, {
      onState: s => states.push(s.state), rebuild: rebuild(id, { during: async () => {
        await assert.rejects(Provider.open(id, { databaseRoot: root, projectLockRetries: 0 }), /already open/)
        assert.equal(await other.revision('other'), 'rev:0')
      } }),
    })
    assert.deepEqual(states, ['rebuilding', 'ready'])
    await assertBackup(root, id, original)
    const snapshot = await readCompleteDesignKnowledge(provider, { projectId: id, limit: 1 })
    assert.ok(snapshot.entities.length > 0); assert.ok(snapshot.generation)
    await assert.rejects(provider.query({ projectId: id, revision: 'rev:0', limit: 1 }), /earlier database generation/)
    await assert.rejects(publishKnowledgeReview({ projectId: id, service: provider, checkpoint: 'c1', reviewed: { ...snapshot, generation: undefined }, producer: 'grounding', observations: [] }), /generation changed/)
    const input = knowledgeSemanticInput(snapshot, 'c1'); delete input.generation
    await assert.rejects(publishKnowledgeSemantic({ projectId: id, service: provider, currentCheckpoint: 'c1', input, edges: [] }), /generation changed/)
    await provider.close(); provider = await Provider.open(id, { databaseRoot: root })
    assert.deepEqual(await readCompleteDesignKnowledge(provider, { projectId: id, limit: 1 }), snapshot)
    await assertBackup(root, id, original)
  } finally { await provider?.close(); await other?.close() }
})
test('continuous source changes are caught up only three times, then disclosed and explicitly retryable', async () => {
  const id = 'changed', root = await oldDatabase(id), path = pathFor(root, id)
  const original = await readFile(path)
  let calls = 0
  await assert.rejects(Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id, { fence: () => { calls++; throw new Error('checkpoint changed') } }) }), /设计文件持续变化/)
  assert.equal(JSON.parse(await readFile(path + '.recovery.json')).state, 'failed')
  await assert.rejects(Provider.open(id, { databaseRoot: root }, { rebuild: () => { calls++; throw new Error('must not run') } }), /设计文件持续变化/)
  assert.equal(calls, 3)
  const provider = await Provider.open(id, { databaseRoot: root }, { retryFailed: true, rebuild: rebuild(id) })
  try { assert.equal(provider.recovery.state, 'ready'); await assertBackup(root, id, original) }
  finally { await provider.close() }
})
test('one source change is caught up without user retry', async () => {
  const id = 'catchup', root = await oldDatabase(id)
  let calls = 0
  const provider = await Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id, { fence: () => { if (++calls === 1) throw new Error('checkpoint changed') } }) })
  try { assert.equal(calls, 2); assert.equal(provider.recovery.state, 'ready') } finally { await provider.close() }
})
test('missing published generation is rebuilt, never accepted as an empty ready database', async () => {
  const id = 'deleted', root = await oldDatabase(id), path = pathFor(root, id)
  let provider = await Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id) })
  await provider.close()
  const manifest = JSON.parse(await readFile(path + '.recovery.json'))
  const directory = path + '.generations/' + manifest.generation
  await rename(directory, directory + '.retained')
  provider = await Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id) })
  try {
    assert.notEqual(provider.recovery.generation, manifest.generation)
    assert.ok((await readCompleteDesignKnowledge(provider, { projectId: id, limit: 1 })).entities.length > 0)
  } finally { await provider.close() }
})
test('interrupted native-open reuses first registered complete backup', async () => {
  const id = 'backup-resume', root = await oldDatabase(id), path = pathFor(root, id)
  const original = await readFile(path)
  let provider = await Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id) })
  await provider.close()
  const manifest = JSON.parse(await readFile(path + '.recovery.json'))
  await writeFile(path + '.recovery.json', JSON.stringify({ ...manifest, state: 'backed-up' }))
  provider = await Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id) })
  try {
    await assertBackup(root, id, original)
    assert.equal(JSON.parse(await readFile(path + '.recovery.json')).backup, manifest.backup)
    assert.equal((await readdir(root)).filter(name => name.includes('.backup-')).length, 1)
  } finally { await provider.close() }
})
test('building manifest resumes same generation after interruption, removing stale derived records', async () => {
  const id = 'resume', root = await oldDatabase(id), path = pathFor(root, id)
  let provider = await Provider.open(id, { databaseRoot: root }, { rebuild: rebuild(id) })
  await provider.close()
  const manifest = JSON.parse(await readFile(path + '.recovery.json'))
  await writeFile(path + '.recovery.json', JSON.stringify({ ...manifest, state: 'building' }))
  const one = { ...store, listPathsAt: async () => ['a/a.json'] }
  provider = await Provider.open(id, { databaseRoot: root }, { rebuild: async candidate => {
    await refreshDesignKnowledge({ projectId: id, service: candidate, store: one, mutate: fn => fn() }); return async () => {}
  } })
  try {
    const snapshot = await readCompleteDesignKnowledge(provider, { projectId: id, limit: 1 })
    assert.equal(snapshot.generation, manifest.generation)
    assert.ok(snapshot.entities.every(e => e.properties.file === 'a/a.json'))
    assert.equal((await readdir(path + '.generations')).length, 1)
  } finally { await provider.close() }
})
