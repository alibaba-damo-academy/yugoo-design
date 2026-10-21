import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  DESIGN_KNOWLEDGE_RECORDS_PATH, DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY,
  readDesignKnowledgeRecords, saveDesignKnowledgeRecords, restoreDesignKnowledgeRecords,
} from '../src/design-knowledge-records.ts'
import { DESIGN_KNOWLEDGE_PUBLICATION_KEY } from '../src/design-knowledge-refresh.ts'

const projectId = '0198e58d-2fd4-7a45-b667-620f71dba9df'
const provenance = { producer: 'source-analysis', checkpoint: 'checkpoint:1', evidence: [{ source: 'design_files/research/source.md', revision: 'checkpoint:1', locator: '#fact' }] }
const archive = (revision = 'rev:9', label = 'Durable source fact') => ({ formatVersion: 1, projectId, revision,
  entities: [{ id: 'entity:source', entityType: 'source', label, lifecycle: 'observed', properties: { url: 'https://example.test/source', quoted: 'User-owned evidence' }, provenance }],
  relations: [], proposals: [], decisions: [] })
const publication = revision => ({ schemaVersion: 1, key: 'semantic-input', edges: 'semantic-edges', checkpoint: 'checkpoint:1', revision, warnings: ['Source warning retained'] })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-records-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'project.json'), JSON.stringify({ kind: 'dsh-design-project', formatVersion: 3, id: projectId, name: 'Archive fixture', createdAt: '2026-10-19T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' } }))
  return { projectRoot: root, projectId }
}

function fakeService(initial = archive()) {
  let stored = structuredClone(initial), resets = 0, imports = 0, exports = 0
  const semantic = new Map()
  return {
    get resets() { return resets }, get imports() { return imports }, get exports() { return exports },
    get stored() { return structuredClone(stored) },
    revision: async id => { assert.equal(id, projectId); return stored.revision },
    exportProject: async id => { exports++; assert.equal(id, projectId); return structuredClone(stored) },
    importProject: async value => {
      imports++; assert.equal(stored.entities.length, 0)
      stored = { ...structuredClone(value), revision: 'rev:4' }
      // The final source revision may also name a proposal batch in the
      // existing import map; only report.revision is the restored final state.
      return { revision: 'rev:4', sourceToTargetRevisions: { [value.revision]: 'rev:2' } }
    },
    resetCache: async () => { resets++; stored = { ...archive('rev:0'), entities: [] }; semantic.clear() },
    readSemanticCache: async key => semantic.get(key),
    writeSemanticCache: async (key, value) => { semantic.set(key, value) },
    replaceCached: value => { stored = structuredClone(value) },
  }
}

test('archive is one readable project file with exact evidence, publication and a Git persistence callback', async t => {
  const location = await fixture(t), service = fakeService()
  let calls = 0
  const saved = await saveDesignKnowledgeRecords({ ...location, service, publication: publication('rev:9'), cache: service,
    persist: async paths => { calls++; assert.deepEqual(paths, [DESIGN_KNOWLEDGE_RECORDS_PATH]); assert.deepEqual(await readDesignKnowledgeRecords(location), savedExpected()) } })
  function savedExpected() { return { formatVersion: 1, archive: archive(), publication: publication('rev:9') } }
  assert.equal(calls, 1)
  assert.deepEqual(saved, savedExpected())
  assert.deepEqual(await readDesignKnowledgeRecords(location), saved)
  assert.equal((await restoreDesignKnowledgeRecords({ ...location, service, cache: service, resetCache: service.resetCache })).restored, false)
  assert.equal(service.resets, 0)
  assert.deepEqual(await readdir(join(location.projectRoot, 'design_records', 'knowledge')), ['archive.json'])
  const text = await readFile(join(location.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH), 'utf8')
  assert.equal(text.includes('embeddingVector'), false)
})

test('blank cache restores final snapshot, proposal/decision provenance and the publication with target revision', async t => {
  const location = await fixture(t)
  const sourceArchive = archive()
  sourceArchive.proposals.push({ proposal: { id: 'proposal:one', projectId, checkpoint: 'checkpoint:1', summary: 'Retained proposal', entities: [], relations: [] }, proposalRevision: 'rev:3', proposalDigest: 'a'.repeat(64) })
  sourceArchive.decisions.push({ projectId, proposalId: 'proposal:one', proposalRevision: 'rev:3', proposalDigest: 'a'.repeat(64), decision: 'deferred', journal: 'design_records/journal/events.json', journalRevision: 7, checkpoint: 'checkpoint:1' })
  await saveDesignKnowledgeRecords({ ...location, service: fakeService(sourceArchive), publication: publication('rev:9') })
  const target = fakeService({ ...archive('rev:0'), entities: [] })
  const result = await restoreDesignKnowledgeRecords({ ...location, service: target, cache: target, resetCache: target.resetCache })
  assert.equal(result.restored, true)
  assert.equal(result.revision, 'rev:4')
  assert.deepEqual(target.stored, { ...sourceArchive, revision: 'rev:4' })
  assert.deepEqual(JSON.parse(await target.readSemanticCache(DESIGN_KNOWLEDGE_PUBLICATION_KEY)), publication('rev:4'))
  assert.equal((await restoreDesignKnowledgeRecords({ ...location, service: target, cache: target, resetCache: target.resetCache })).restored, false)
  assert.equal(target.imports, 1)
})

test('Git-restored older file and unarchived cache revisions replace cached facts without promoting them', async t => {
  const location = await fixture(t), source = fakeService()
  await saveDesignKnowledgeRecords({ ...location, service: source })
  const original = await readFile(join(location.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH))
  source.replaceCached(archive('rev:10', 'Newer cached fact'))
  await saveDesignKnowledgeRecords({ ...location, service: source, cache: source })
  await writeFile(join(location.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH), original)
  const options = { ...location, service: source, cache: source, resetCache: source.resetCache }
  assert.equal((await restoreDesignKnowledgeRecords(options)).restored, true)
  assert.equal(source.stored.entities[0].label, 'Durable source fact')
  source.replaceCached(archive('rev:11', 'Unarchived cached fact'))
  await restoreDesignKnowledgeRecords(options)
  assert.equal(source.stored.entities[0].label, 'Durable source fact')
  assert.equal(source.imports, 2)
  assert.equal(source.exports, 2, 'Restoration never exports cached data into the archive')
})

test('missing archive clears an existing external graph; pure read creates nothing', async t => {
  const location = await fixture(t), service = fakeService()
  assert.equal(await readDesignKnowledgeRecords(location), undefined)
  assert.deepEqual(await readdir(location.projectRoot), ['project.json'])
  const result = await restoreDesignKnowledgeRecords({ ...location, service, cache: service, resetCache: service.resetCache })
  assert.deepEqual(result, { restored: true, revision: 'rev:0' })
  assert.equal(service.stored.entities.length, 0)
  assert.equal(service.imports, 0); assert.equal(service.exports, 0)
  assert.equal(await readDesignKnowledgeRecords(location), undefined)
})

test('identity, archive envelope and publication snapshot guards preserve prior file and cache', async t => {
  const location = await fixture(t), service = fakeService()
  await saveDesignKnowledgeRecords({ ...location, service, cache: service })
  const path = join(location.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH), before = await readFile(path, 'utf8')
  for (const invalid of [
    { ...archive(), projectId: 'another-project' },
    { ...archive(), vectors: [1, 2] },
    { ...archive(), proposals: [{ proposal: { projectId: 'another-project' } }] },
    { ...archive(), decisions: [{ projectId: 'another-project' }] },
  ]) {
    await assert.rejects(saveDesignKnowledgeRecords({ ...location, service: fakeService(invalid) }), /identity|fields/)
  }
  await assert.rejects(saveDesignKnowledgeRecords({ ...location, service, publication: publication('rev:8') }), /final snapshot/)
  await assert.rejects(saveDesignKnowledgeRecords({ ...location, projectId: 'another-project', service }), /identity/)
  assert.equal(await readFile(path, 'utf8'), before)
  await writeFile(path, JSON.stringify({ formatVersion: 2, archive: archive() }))
  await assert.rejects(restoreDesignKnowledgeRecords({ ...location, service, cache: service, resetCache: service.resetCache }), /format/)
  assert.equal(service.resets, 0, 'Malformed authoritative files fail before cache mutation')
})

test('oversized, malformed and nonregular files are rejected; symlinked parents cannot redirect archive writes', async t => {
  const location = await fixture(t), service = fakeService()
  await assert.rejects(saveDesignKnowledgeRecords({ ...location, service, maxBytes: 20 }), /exceeds/)
  await saveDesignKnowledgeRecords({ ...location, service })
  await assert.rejects(readDesignKnowledgeRecords({ ...location, maxBytes: 20 }), /exceeds/)
  const path = join(location.projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH)
  await writeFile(path, '{')
  await assert.rejects(readDesignKnowledgeRecords(location), SyntaxError)
  await rm(path); await mkdir(path)
  await assert.rejects(readDesignKnowledgeRecords(location), /regular file/)
  await rm(path, { recursive: true }); await symlink(join(location.projectRoot, 'project.json'), path)
  await assert.rejects(readDesignKnowledgeRecords(location), /symbolic link/)
  await rm(path); await rm(dirname(path), { recursive: true })
  const outside = await mkdtemp(join(tmpdir(), 'knowledge-records-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, dirname(path))
  await assert.rejects(saveDesignKnowledgeRecords({ ...location, service }), /symbolic link/)
  assert.deepEqual(await readdir(outside), [])
})

test('Git persistence failure is visible and does not advance cache marker', async t => {
  const location = await fixture(t), service = fakeService()
  await saveDesignKnowledgeRecords({ ...location, service, cache: service })
  const before = await service.readSemanticCache(DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY)
  service.replaceCached(archive('rev:10', 'New source'))
  await assert.rejects(saveDesignKnowledgeRecords({ ...location, service, cache: service, persist: async () => { throw new Error('Git compare-and-swap failed') } }), /compare-and-swap/)
  assert.equal(await service.readSemanticCache(DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY), before)
  assert.equal((await readDesignKnowledgeRecords(location)).archive.entities[0].label, 'New source', 'The pending file remains available for the owning publication path to reconcile')
})
