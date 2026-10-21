import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LadybugDesignKnowledgeProvider,
  LadybugProjectLockError,
  LadybugSchemaMismatchError,
  shutdownLadybugKnowledgeRuntime,
} from '../lib/index.js'

const require = createRequire(import.meta.url)
const ladybug = require('@ladybugdb/wasm-core/nodejs')
const originalConnectionClose = ladybug.Connection.prototype.close

const root = await mkdtemp(join(tmpdir(), 'design-knowledge-ladybug-'))
const projectId = 'project:provider-test'
const config = {
  databaseRoot: root,
  writerAttempts: 16,
  writerRetryMs: 1,
  projectLockRetries: 1,
  projectLockMinTimeoutMs: 1,
  projectLockStaleMs: 2_000,
  maxQueryLimit: 100,
  maxFilterValues: 2,
  maxTextBytes: 16,
}
const evidence = Object.freeze([{ source: 'design-file:test', revision: 'cp-1' }])
const provenance = Object.freeze({ producer: 'design-file-projection', checkpoint: 'cp-1', evidence })
const entity = (id, label = id) => Object.freeze({ id, entityType: 'test', label, lifecycle: 'observed', properties: Object.freeze({ label }), provenance })
const relation = (id, from, to) => Object.freeze({ id, relationType: 'links', from, to, lifecycle: 'observed', properties: Object.freeze({}), provenance })
async function execute(connection, statement, parameters) {
  const prepared = await connection.prepare(statement)
  assert.equal(prepared.isSuccess(), true, await prepared.getErrorMessage())
  const result = await connection.execute(prepared, parameters)
  assert.equal(result.isSuccess(), true, await result.getErrorMessage())
  await result.close()
  await prepared.close()
}
const pin = (expectedRevision, overrides = {}) => Object.freeze({
  projectId,
  inputCheckpoint: overrides.inputCheckpoint ?? 'cp-1',
  observedCheckpoint: overrides.observedCheckpoint ?? 'cp-1',
  expectedRevision,
})
const delta = (mutationId, expectedRevision, overrides = {}) => Object.freeze({
  mutationId,
  pin: pin(expectedRevision, overrides.pin),
  upsertEntities: overrides.upsertEntities ?? [entity('entity:a'), entity('entity:b')],
  upsertRelations: overrides.upsertRelations ?? [relation('relation:a-b', 'entity:a', 'entity:b')],
  removeRelations: overrides.removeRelations ?? [],
  removeEntities: overrides.removeEntities ?? [],
})

let provider
try {
  provider = await LadybugDesignKnowledgeProvider.open(projectId, config)
  await assert.rejects(
    LadybugDesignKnowledgeProvider.open(projectId, config),
    (error) => error instanceof LadybugProjectLockError,
  )
  assert.equal(await provider.revision(projectId), 'rev:0')

  await assert.rejects(
    provider.applyDelta(delta('mutation:checkpoint', 'rev:0', { pin: { observedCheckpoint: 'cp-2' } })),
    /checkpoint .* stale/u,
  )
  assert.equal(await provider.revision(projectId), 'rev:0')

  const first = await provider.applyDelta(delta('mutation:first', 'rev:0'))
  assert.deepEqual(first, { revision: 'rev:1', replayed: false })
  assert.deepEqual(await provider.applyDelta(delta('mutation:first', 'rev:0')), { revision: 'rev:1', replayed: true })
  await assert.rejects(provider.applyDelta(delta('mutation:first', 'rev:1')), /replayed with different content/u)
  await assert.rejects(provider.applyDelta(delta('mutation:stale', 'rev:0')), /expected revision/u)
  await assert.rejects(provider.applyDelta(delta('mutation:forge-authority', 'rev:1', {
    upsertEntities: [{ ...entity('entity:c'), lifecycle: 'accepted' }], upsertRelations: [],
  })), /cannot write authoritative lifecycle/u)
  assert.equal(await provider.revision(projectId), 'rev:1')

  const atOne = await provider.query({ projectId, revision: 'rev:1', limit: 100 })
  assert.deepEqual(atOne.entities.map((value) => value.id), ['entity:a', 'entity:b'])
  assert.deepEqual(atOne.relations.map((value) => value.id), ['relation:a-b'])
  assert.ok(Object.isFrozen(atOne.entities))
  await assert.rejects(provider.query({ projectId, limit: 101 }), /limit must be between/u)
  await assert.rejects(provider.query({ projectId, text: 'x'.repeat(17), limit: 1 }), /query text exceeds/u)
  await assert.rejects(provider.query({ projectId, entityTypes: ['a', 'b', 'c'], limit: 1 }), /entityTypes exceeds/u)
  assert.equal(await provider.revision(projectId), 'rev:1')

  await assert.rejects(
    provider.applyDelta(delta('mutation:dangling', 'rev:1', {
      upsertEntities: [],
      upsertRelations: [relation('relation:dangling', 'entity:a', 'entity:absent')],
    })),
    /endpoint absent/u,
  )
  await assert.rejects(
    provider.applyDelta(delta('mutation:implicit-cascade', 'rev:1', {
      upsertEntities: [], upsertRelations: [], removeEntities: ['entity:a'],
    })),
    /endpoint absent/u,
  )
  assert.equal(await provider.revision(projectId), 'rev:1')

  assert.deepEqual(await provider.applyDelta(delta('mutation:remove', 'rev:1', {
    upsertEntities: [], upsertRelations: [], removeRelations: ['relation:a-b'], removeEntities: ['entity:a'],
  })), { revision: 'rev:2', replayed: false })
  const current = await provider.query({ projectId, limit: 100 })
  assert.deepEqual(current.entities.map((value) => value.id), ['entity:b'])
  assert.deepEqual(current.relations, [])
  const historical = await provider.query({ projectId, revision: 'rev:1', text: 'entity:a', limit: 100 })
  assert.deepEqual(historical.entities.map((value) => value.id), ['entity:a'])
  assert.deepEqual((await provider.query({ projectId, revision: 'rev:1', limit: 100 })).relations.map((value) => value.id), ['relation:a-b'])
  await assert.rejects(provider.query({ projectId, revision: 'rev:99', limit: 1 }), /expected revision/u)

  const concurrent = await Promise.allSettled([
    provider.applyDelta(delta('mutation:concurrent-a', 'rev:2', { upsertEntities: [entity('entity:c')], upsertRelations: [] })),
    provider.query({ projectId, limit: 100 }),
    provider.applyDelta(delta('mutation:concurrent-b', 'rev:2', { upsertEntities: [entity('entity:d')], upsertRelations: [] })),
  ])
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 2)
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1)
  assert.equal(concurrent[1].status, 'fulfilled')
  assert.equal(concurrent[1].value.revision, 'rev:3')
  assert.equal(await provider.revision(projectId), 'rev:3')
  await provider.close()
  provider = undefined

  const sourceDatabasePath = join(root, `${createHash('sha256').update(projectId).digest('hex')}.lbdb`)
  const authoritativeDatabase = new ladybug.Database(sourceDatabasePath)
  const authoritativeConnection = new ladybug.Connection(authoritativeDatabase)
  await authoritativeConnection.init()
  const acceptedEntity = { ...entity('entity:accepted'), lifecycle: 'accepted' }
  await execute(authoritativeConnection, 'CREATE (:KnowledgeEntityIdentity {id: $id});', { id: acceptedEntity.id })
  await execute(authoritativeConnection, 'CREATE (:KnowledgeEntityVersion {key: $key, entityId: $id, revision: 3, tombstone: false, payload: $payload});', {
    key: `${acceptedEntity.id}@3`, id: acceptedEntity.id, payload: JSON.stringify(acceptedEntity),
  })
  await authoritativeConnection.close()
  await authoritativeDatabase.close()

  provider = await LadybugDesignKnowledgeProvider.open(projectId, config)
  assert.equal(await provider.revision(projectId), 'rev:3')
  assert.deepEqual((await provider.query({ projectId, revision: 'rev:1', limit: 100 })).relations.map((value) => value.id), ['relation:a-b'])
  assert.deepEqual((await provider.query({ projectId, lifecycles: ['accepted'], limit: 100 })).entities.map((value) => value.id), ['entity:accepted'])
  await assert.rejects(provider.applyDelta(delta('mutation:overwrite-accepted', 'rev:3', {
    upsertEntities: [entity('entity:accepted')], upsertRelations: [],
  })), /cannot overwrite or remove authoritative entity/u)
  await assert.rejects(provider.applyDelta(delta('mutation:remove-accepted', 'rev:3', {
    upsertEntities: [], upsertRelations: [], removeEntities: ['entity:accepted'],
  })), /cannot overwrite or remove authoritative entity/u)
  assert.equal(await provider.revision(projectId), 'rev:3')

  await provider.close()
  provider = undefined

  const cleanupProject = 'project:cleanup-failure'
  ladybug.Connection.prototype.close = async function syntheticPrimaryCloseFailure() {
    await originalConnectionClose.call(this)
    throw new Error('synthetic connection close failure')
  }
  const cleanupProvider = await LadybugDesignKnowledgeProvider.open(cleanupProject, config)
  await assert.rejects(cleanupProvider.close(), /synthetic connection close failure/u)
  await assert.rejects(cleanupProvider.revision(cleanupProject), /closing or closed/u)
  ladybug.Connection.prototype.close = originalConnectionClose
  await cleanupProvider.close()
  const cleanupReopened = await LadybugDesignKnowledgeProvider.open(cleanupProject, config)
  await cleanupReopened.close()

  const databasePath = (id) => join(root, `${createHash('sha256').update(id).digest('hex')}.lbdb`)
  const copiedProject = 'project:copied-wrong-identity'
  await copyFile(databasePath(projectId), databasePath(copiedProject))
  await assert.rejects(
    LadybugDesignKnowledgeProvider.open(copiedProject, config),
    (error) => error instanceof LadybugSchemaMismatchError && /does not identify schema/u.test(error.message),
  )

  const database = new ladybug.Database(databasePath(projectId))
  const connection = new ladybug.Connection(database)
  await connection.init()
  const corrupted = await connection.query('MATCH (s:KnowledgeSchema) SET s.schemaVersion = 99;')
  assert.equal(corrupted.isSuccess(), true, await corrupted.getErrorMessage())
  await corrupted.close()
  await connection.close()
  await database.close()
  await assert.rejects(
    LadybugDesignKnowledgeProvider.open(projectId, config),
    (error) => error instanceof LadybugSchemaMismatchError && /incompatible Knowledge schema/u.test(error.message),
  )
  console.log('LADYBUG DESIGN KNOWLEDGE PROVIDER GATE OK')
} finally {
  ladybug.Connection.prototype.close = originalConnectionClose
  await provider?.close().catch(() => {})
  await shutdownLadybugKnowledgeRuntime()
  await rm(root, { recursive: true, force: true })
}
