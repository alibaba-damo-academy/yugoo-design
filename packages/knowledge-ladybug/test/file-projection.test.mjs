import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { materializeDesignFilesKnowledge } = await import('../../core/src/design-knowledge-projection.ts')
const { compileDesignOntologyContract } = await import('../../core/src/design-ontology.ts')
const { compileDesignRelationVocabulary } = await import('../../core/src/design-relation-vocabulary.ts')
after(() => shutdownLadybugKnowledgeRuntime())
test('schema-only refresh retires metadata and old candidate edges, preserving unrelated GRA and history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-schema-refresh-'))
  let provider
  try {
    provider = await LadybugDesignKnowledgeProvider.open('schema-refresh', { databaseRoot: directory })
    const file = 'tasks/tasks.json'
    const text = JSON.stringify({ schema_version: 8, tasks: { a: { caption: '科研问题', version: 3 }, b: { caption: '研究方案' } } })
    const store = { head: async () => 'c1', listPathsAt: async () => [file], readTextAt: async () => text }
    const run = schemas => materializeDesignFilesKnowledge({ store, service: provider, projectId: 'schema-refresh', schemas })
    await run({})
    const before = await provider.query({ projectId: 'schema-refresh', limit: 100 })
    const metadata = before.entities.find(n => n.properties.pointer === '')
    const a = before.entities.find(n => n.properties.pointer === '/tasks/a')
    const b = before.entities.find(n => n.properties.pointer === '/tasks/b')
    assert.ok(metadata)
    const edge = (id, from, to, producer, projection) => ({ id, from, to, relationType: 'related', lifecycle: 'proposed',
      properties: { projection }, provenance: { producer, checkpoint: 'c1', evidence: [{ source: file, revision: 'c1', locator: from === metadata.id ? '/schema_version' : '/tasks/a/caption' }] } })
    await provider.applyDelta({ mutationId: 'seed-legacy-edges', pin: { projectId: 'schema-refresh', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: before.revision },
      upsertEntities: [], removeEntities: [], removeRelations: [], upsertRelations: [
        edge('old-identifier-candidate', a.id, b.id, 'design-file-projection', 'design-files-v1'),
        edge('old-metadata-semantic', metadata.id, a.id, 'source-analysis', 'embedding-v1'),
        edge('unaffected-gra', a.id, b.id, 'grounding', 'review-v1'),
      ] })
    const oldRevision = await provider.revision('schema-refresh')
    const schemas = { [file]: { type: 'object', properties: { schema_version: { type: 'number', knowledge: { role: 'metadata' } }, tasks: { type: 'map', value: { type: 'object' } } } } }
    assert.equal((await run(schemas)).changed, true)
    const current = await provider.query({ projectId: 'schema-refresh', limit: 100 })
    assert.equal(current.entities.some(n => n.id === metadata.id), false)
    assert.ok(current.entities.find(n => n.id === a.id).properties.fields.some(f => f.pointer.endsWith('/version') && f.text === '3'))
    assert.deepEqual(current.relations.map(r => r.id), ['unaffected-gra'])
    const old = await provider.query({ projectId: 'schema-refresh', revision: oldRevision, limit: 100 })
    assert.ok(old.entities.some(n => n.id === metadata.id)); assert.equal(old.relations.length, 3)
    assert.equal((await run(schemas)).changed, false)
  } finally {
    await provider?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('ontology instance facts persist and remain queryable after reopening Ladybug', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-ontology-'))
  let provider
  try {
    const projectId = 'ontology'
    provider = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
    const file = 'tasks/tasks.json'
    const schemas = { [file]: { type: 'object', properties: { tasks: { type: 'map', value: { type: 'object', required: ['title'], properties: { id: { type: 'string' }, title: { type: 'string' } } } } } } }
    const ontology = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', schemas,
      relationVocabulary: compileDesignRelationVocabulary(undefined, 'fixture', '1.0') })
    const store = { head: async () => 'c1', listPathsAt: async () => [file],
      readTextAt: async () => JSON.stringify({ tasks: { research: { id: 'T-1', title: '研究计划' } } }) }
    await materializeDesignFilesKnowledge({ store, service: provider, projectId, schemas, ontology })
    const type = 'fixture/tasks#/properties/tasks/value'
    let selected = await provider.query({ projectId, ontologyTypes: [type], identityQualities: ['stable'], limit: 100 })
    assert.equal(selected.entities.length, 1)
    assert.equal(selected.entities[0].properties.recordKind, 'design-record')
    assert.equal(selected.entities[0].properties.ontologyRevision, ontology.revision)
    await provider.close()
    provider = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
    selected = await provider.query({ projectId, ontologyTypes: [type], recordKinds: ['design-record'], limit: 100 })
    assert.equal(selected.entities.length, 1)
  } finally {
    await provider?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('artifact bytes persist in the shared graph and changes retire their derived relationships', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-artifacts-'))
  let provider
  try {
    provider = await LadybugDesignKnowledgeProvider.open('artifacts', { databaseRoot: directory })
    let checkpoint = 'c1'
    const files = {
      'page/page.json': Buffer.from(JSON.stringify({ pages: { a: { caption: '真实页面', logo: 'logo.png', preview: 'view.html' } } })),
      'page/logo.png': Buffer.from([0,1,2,255]), 'page/view.html': Buffer.from('<main>科研工作台</main>'),
    }
    const initialFiles = { ...files }
    const at = c => c === 'c1' ? initialFiles : files
    const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(files), readTextAt: async (c, p) => at(c)[p]?.toString(), readBytesAt: async (c, p) => at(c)[p] }
    const schemas = { 'page/page.json': { type: 'object', properties: { pages: { type: 'map', value: { type: 'object' } } } } }
    const ontology = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', schemas,
      relationVocabulary: compileDesignRelationVocabulary(undefined, 'fixture', '1.0') })
    const run = () => materializeDesignFilesKnowledge({ store, service: provider, projectId: 'artifacts', schemas, ontology })
    await run()
    const before = await provider.query({ projectId: 'artifacts', limit: 100 })
    const logo = before.entities.find(n => n.properties.file === 'page/logo.png')
    const preview = before.entities.find(n => n.properties.file === 'page/view.html')
    assert.equal(logo.entityType, 'design-artifact')
    assert.equal(logo.properties.ontologyRevision, ontology.revision)
    assert.equal(logo.properties.source.encoding, 'binary')
    assert.equal(preview.properties.fields[0].text, '<main>科研工作台</main>')
    assert.equal(before.relations.filter(r => r.relationType === 'references-artifact').length, 2)
    await provider.close()
    provider = await LadybugDesignKnowledgeProvider.open('artifacts', { databaseRoot: directory })
    const reopenedLogo = (await provider.query({ projectId: 'artifacts', ontologyTypes: ['design/artifact#file'], limit: 100 }))
      .entities.find(n => n.properties.file === 'page/logo.png')
    assert.equal(reopenedLogo.properties.ontologyRevision, ontology.revision)
    await provider.applyDelta({ mutationId: 'artifact-derived', pin: { projectId: 'artifacts', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: before.revision },
      upsertEntities: [], removeEntities: [], removeRelations: [], upsertRelations: [{ id: 'derived', from: logo.id, to: preview.id, relationType: 'related', lifecycle: 'proposed', properties: {}, provenance: { producer: 'source-analysis', checkpoint: 'c1', evidence: [{ source: 'page/logo.png', revision: 'c1', locator: '' }] } }] })
    const historical = await provider.revision('artifacts')
    checkpoint = 'c2'; files['page/logo.png'] = Buffer.from([0,1,3,255])
    await run()
    const after = await provider.query({ projectId: 'artifacts', limit: 100 })
    const changed = after.entities.find(n => n.id === logo.id)
    assert.notEqual(changed.properties.contentRevision, logo.properties.contentRevision)
    assert.equal(after.relations.some(r => r.id === 'derived'), false)
    assert.ok((await provider.query({ projectId: 'artifacts', revision: historical, limit: 100 })).relations.some(r => r.id === 'derived'))
  } finally {
    await provider?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
test('complete file projection persists, is idempotent and removes only its own missing records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-files-'))
  let provider
  try {
    provider = await LadybugDesignKnowledgeProvider.open('files', { databaseRoot: directory })
    const source = { id: 'external', entityType: 'source', label: '来源证据', lifecycle: 'proposed', properties: {}, provenance: { producer: 'source-analysis', checkpoint: 'c1', evidence: [{ source: '/source/a.ts', revision: 'hash' }] } }
    await provider.applyDelta({ mutationId: 'external', pin: { projectId: 'files', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: 'rev:0' }, upsertEntities: [source], upsertRelations: [], removeEntities: [], removeRelations: [] })
    let checkpoint = 'c1', text = JSON.stringify({ tasks: { a: { caption: '研究问题', note: '待验证假设' }, b: { caption: '实验方案' } } })
    const initialText = text
    const store = { head: async () => checkpoint, listPathsAt: async () => ['tasks/tasks.json'], readTextAt: async c => c === 'c1' || c === 'c1-audit-only' ? initialText : text }
    const run = () => materializeDesignFilesKnowledge({ store, service: provider, projectId: 'files', pageSize: 2 })
    const first = await run()
    assert.equal(first.changed, true)
    assert.equal((await run()).changed, false)
    assert.equal(await provider.revision('files'), first.revision)
    const before = await provider.query({ projectId: 'files', limit: 100 })
    const a = before.entities.find(n => n.properties.pointer === '/tasks/a')
    const b = before.entities.find(n => n.properties.pointer === '/tasks/b')
    const relation = { id: 'review-derived', from: a.id, to: 'external', relationType: 'supports', lifecycle: 'proposed', properties: {}, provenance: { producer: 'grounding', checkpoint: 'c1', evidence: [{ source: 'tasks/tasks.json', revision: 'c1', locator: '/tasks/a' }] } }
    await provider.applyDelta({ mutationId: 'review', pin: { projectId: 'files', inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: before.revision }, upsertEntities: [], upsertRelations: [relation], removeEntities: [], removeRelations: [] })
    const reviewedRevision = await provider.revision('files')
    checkpoint = 'c1-audit-only'
    await run()
    assert.ok((await provider.query({ projectId: 'files', limit: 100 })).relations.some(r => r.id === relation.id), 'Checkpoint-only changes preserve existing relationships')
    checkpoint = 'c2'; text = JSON.stringify({ tasks: { a: { caption: '更新研究问题', note: '待验证假设' } } })
    await run()
    const after = await provider.query({ projectId: 'files', limit: 100 })
    assert.equal(after.entities.find(n => n.id === a.id).label, '更新研究问题')
    assert.equal(after.entities.some(n => n.id === b.id), false)
    assert.ok(after.entities.some(n => n.id === 'external'))
    assert.equal(after.relations.some(r => r.id === relation.id), false, 'Changed source content retires derived relationships')
    assert.ok((await provider.query({ projectId: 'files', revision: reviewedRevision, limit: 100 })).relations.some(r => r.id === relation.id), 'Previous evidence remains available in the old graph revision')
    const saved = after.revision
    for (const corrupt of [
      page => ({ ...page, entities: [] }),
      page => ({ ...page, page: { ...page.page, nextOffset: null } }),
      page => ({ ...page, page: { ...page.page, offset: 99 } }),
    ]) {
      const service = { revision: id => provider.revision(id), query: async request => corrupt(await provider.query(request)), applyDelta: () => assert.fail('Partial snapshots must never be applied') }
      await assert.rejects(materializeDesignFilesKnowledge({ store, service, projectId: 'files', pageSize: 1 }), /complete snapshot pagination/)
      assert.equal(await provider.revision('files'), saved)
    }
    text = '{broken'
    await assert.rejects(run(), /invalid JSON/)
    assert.equal(await provider.revision('files'), saved)
    text = '{}'
    let calls = 0
    await assert.rejects(materializeDesignFilesKnowledge({ ...{ store, service: provider, projectId: 'files' }, store: { ...store, head: async () => ++calls === 1 ? 'c2' : 'c3' } }), /checkpoint changed/)
    assert.equal(await provider.revision('files'), saved)
    await provider.close()
    provider = await LadybugDesignKnowledgeProvider.open('files', { databaseRoot: directory })
    assert.equal((await provider.query({ projectId: 'files', limit: 100 })).entities.find(n => n.id === a.id).label, '更新研究问题')
  } finally {
    await provider?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
