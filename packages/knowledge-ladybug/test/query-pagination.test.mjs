import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')

test('paged queries expose the full fixed revision beyond one-page limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kag-pagination-'))
  let provider
  try {
    provider = await LadybugDesignKnowledgeProvider.open('pagination', { databaseRoot: root, maxQueryLimit: 2 })
    const provenance = { producer: 'design-file-projection', checkpoint: 'c1', evidence: [{ source: 'tasks/tasks.json', revision: 'c1' }] }
    const entity = id => ({ id, entityType: 'record', label: id, lifecycle: 'observed', properties: { marker: 'original' }, provenance })
    await provider.applyDelta({ mutationId: 'seed', pin: { projectId: 'pagination', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: 'rev:0' },
      upsertEntities: ['a', 'b', 'c', 'd', 'e'].map(entity),
      upsertRelations: ['b', 'c', 'd'].map(id => ({ id: 'r-' + id, relationType: 'contains', from: 'a', to: id, lifecycle: 'observed', properties: {}, provenance })),
      removeEntities: [], removeRelations: [] })
    const request = { projectId: 'pagination', limit: 2, offset: 0 }
    const first = await provider.query(request)
    assert.deepEqual(first.page, { offset: 0, nextOffset: 2, totalEntities: 5, totalRelations: 3 })
    first.entities[0].label = 'changed by caller'
    first.entities[0].properties.marker = 'changed by caller'
    first.entities[0].provenance.evidence[0].source = 'changed by caller'
    const cachedPage = await provider.query({ ...request, revision: first.revision })
    assert.equal(cachedPage.entities[0].label, 'a', 'a caller cannot mutate the cached snapshot')
    assert.equal(cachedPage.entities[0].properties.marker, 'original')
    assert.equal(cachedPage.entities[0].provenance.evidence[0].source, 'tasks/tasks.json')
    cachedPage.entities[0].label = 'changed on cache hit'
    cachedPage.entities[0].properties.marker = 'changed on cache hit'
    assert.equal((await provider.query({ ...request, revision: first.revision })).entities[0].label, 'a', 'cache hits also return isolated records')
    assert.equal((await provider.query({ ...request, revision: first.revision })).entities[0].properties.marker, 'original')
    await provider.applyDelta({ mutationId: 'later', pin: { projectId: 'pagination', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: first.revision }, upsertEntities: [entity('0')], upsertRelations: [], removeEntities: [], removeRelations: [] })
    const entities = [...first.entities], relations = [...first.relations]
    let offset = first.page.nextOffset
    while (offset !== null) {
      const page = await provider.query({ ...request, revision: first.revision, offset })
      entities.push(...page.entities); relations.push(...page.relations)
      offset = page.page.nextOffset
    }
    assert.deepEqual(entities.map(x => x.id), ['a', 'b', 'c', 'd', 'e'])
    assert.deepEqual(relations.map(x => x.id), ['r-b', 'r-c', 'r-d'])
    const endpoint = await provider.query({ ...request, revision: first.revision, entityIds: ['c', '0'], relationIds: [] })
    assert.deepEqual(endpoint.entities.map(x => x.id), ['c'], 'Exact lookup cannot leak a node from a newer revision')
    assert.deepEqual(endpoint.relations, [])
    assert.equal(endpoint.page.totalEntities, 1)
    const outgoing = await provider.query({ ...request, revision: first.revision, incidentTo: ['a'], direction: 'outgoing' })
    assert.equal(outgoing.page.totalEntities, 4)
    assert.equal(outgoing.page.totalRelations, 3)
    const incoming = await provider.query({ ...request, revision: first.revision, incidentTo: ['b'], direction: 'incoming' })
    assert.deepEqual(incoming.entities.map(x => x.id), ['a', 'b'])
    assert.deepEqual(incoming.relations.map(x => x.id), ['r-b'], 'One hop does not recursively expand through a')
    const reverse = await provider.query({ ...request, revision: first.revision, incidentTo: ['b'], direction: 'outgoing' })
    assert.deepEqual(reverse.entities.map(x => x.id), ['b'])
    assert.deepEqual(reverse.relations, [])
    const absentType = await provider.query({ ...request, revision: first.revision, incidentTo: ['a'], relationTypes: ['implements'] })
    assert.deepEqual(absentType.entities.map(x => x.id), ['a'])
    assert.deepEqual(absentType.relations, [])
    const noSource = await provider.query({ ...request, sourceFiles: ['other/other.json'] })
    assert.equal(noSource.page.totalEntities, 0)
    assert.equal(noSource.page.totalRelations, 0)
    assert.equal((await provider.query({ ...request, sourceFiles: ['tasks/tasks.json'] })).page.totalEntities, 6)
    await assert.rejects(provider.query({ ...request, direction: 'incoming' }), /direction/)
    await assert.rejects(provider.query({ ...request, incidentTo: ['a'], direction: 'sideways' }), /direction/)
    const edge = await provider.query({ ...request, revision: first.revision, entityIds: [], relationIds: ['r-d'] })
    assert.deepEqual(edge.relations.map(x => x.id), ['r-d'])
    assert.deepEqual(edge.entities, [])
    await assert.rejects(provider.query({ ...request, entityIds: 'c' }), /string array/)
    const filtered = await provider.query({ ...request, entityTypes: ['absent'] })
    assert.equal(filtered.page.totalEntities, 0)
    assert.equal(filtered.page.nextOffset, 2) // Relationships paginate independently of node matches.
    assert.equal((await provider.query({ ...request, offset: 20, revision: first.revision })).page.nextOffset, null)
    await assert.rejects(provider.query({ ...request, offset: 2 }), /pinned revision/)
    for (const offset of [-1, 1.5, NaN]) await assert.rejects(provider.query({ ...request, offset }), /offset/)
    assert.equal((await provider.query({ projectId: 'pagination', limit: 2 })).page, undefined)
    const sidecarName = (await readdir(root)).find(name => name.endsWith('.lbdb.visible-v1.gz'))
    assert.ok(sidecarName, 'a complete current revision gets a disposable persistent projection')
    const sidecar = join(root, sidecarName)
    assert.ok((await readFile(sidecar)).byteLength > 0)
    await provider.close(); provider = undefined
    provider = await LadybugDesignKnowledgeProvider.open('pagination', { databaseRoot: root, maxQueryLimit: 2 })
    assert.equal((await provider.query(request)).page.totalEntities, 6, 'a restart preserves the visible graph')
    await provider.close(); provider = undefined
    await writeFile(sidecar, 'damaged derived cache')
    provider = await LadybugDesignKnowledgeProvider.open('pagination', { databaseRoot: root, maxQueryLimit: 2 })
    assert.equal((await provider.query(request)).page.totalEntities, 6, 'a corrupt sidecar falls back to authoritative versions')
    assert.notEqual((await readFile(sidecar)).toString('utf8'), 'damaged derived cache', 'fallback repairs the derived cache')
    await provider.close(); provider = undefined
    const selfConsistentInvalid = JSON.parse(gunzipSync(await readFile(sidecar)).toString('utf8'))
    selfConsistentInvalid.entities[0].label = 42
    selfConsistentInvalid.digest = createHash('sha256').update(JSON.stringify({ entities: selfConsistentInvalid.entities, relations: selfConsistentInvalid.relations })).digest('hex')
    await writeFile(sidecar, gzipSync(JSON.stringify(selfConsistentInvalid)))
    provider = await LadybugDesignKnowledgeProvider.open('pagination', { databaseRoot: root, maxQueryLimit: 2 })
    assert.equal(typeof (await provider.query(request)).entities[0].label, 'string', 'a self-consistent but invalid sidecar falls back to durable facts')
    const revision = await provider.revision('pagination')
    await provider.applyDelta({ mutationId: 'after-reopen', pin: { projectId: 'pagination', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: revision },
      upsertEntities: [entity('f')], upsertRelations: [], removeEntities: [], removeRelations: [] })
    assert.equal((await provider.query(request)).page.totalEntities, 7, 'a new fact revision invalidates the old sidecar')
    await provider.close(); provider = undefined
    provider = await LadybugDesignKnowledgeProvider.open('pagination', { databaseRoot: root, maxQueryLimit: 2 })
    assert.equal((await provider.query(request)).page.totalEntities, 7, 'the committed next revision sidecar survives reopening')
    const beforeOrder = await provider.revision('pagination')
    await provider.applyDelta({ mutationId: 'mixed-order', pin: { projectId: 'pagination', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: beforeOrder },
      upsertEntities: ['A', 'a-10', 'a-2'].map(entity), upsertRelations: [], removeEntities: [], removeRelations: [] })
    const listIds = async () => {
      const ids = []
      let offset = 0
      let pinned
      do {
        const page = await provider.query({ ...request, offset, ...(pinned ? { revision: pinned } : {}) })
        pinned = page.revision
        ids.push(...page.entities.map(item => item.id))
        offset = page.page.nextOffset
      } while (offset != null)
      return ids
    }
    const sidecarOrder = await listIds()
    assert.ok(sidecarOrder.indexOf('a-10') < sidecarOrder.indexOf('a-2'), 'record IDs retain code-unit order')
    await provider.close(); provider = undefined
    await writeFile(sidecar, 'force historical fold')
    provider = await LadybugDesignKnowledgeProvider.open('pagination', { databaseRoot: root, maxQueryLimit: 2 })
    assert.deepEqual(await listIds(), sidecarOrder, 'derived snapshot paging matches the historical-version fold')
  } finally {
    await provider?.close(); await shutdownLadybugKnowledgeRuntime()
    await rm(root, { recursive: true, force: true })
  }
})
