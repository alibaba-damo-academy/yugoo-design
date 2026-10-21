import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { refreshDesignKnowledge } = await import('../../core/src/design-knowledge-refresh.ts')
const { readCompleteDesignKnowledge } = await import('../../core/src/design-knowledge-snapshot.ts')
const { knowledgeSemanticInput, storedKnowledgeGraph, publishKnowledgeSemantic } = await import('../../core/src/design-knowledge-semantic.ts')
after(() => shutdownLadybugKnowledgeRuntime())

test('granularity refresh preserves source, stable IDs and unrelated GRA; invalidates old inputs and survives reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-granularity-'))
  let service, calls = 0
  const projectId = 'granularity', file = 'styles/styles.json'
  const files = { [file]: JSON.stringify({ config: { theme: 'Workspace', patterns: { card: { description: 'Card', size: '14px', states: ['default'] } } } }),
    'pages/pages.json': JSON.stringify({ pages: { a: { title: 'Page', ref: 'card' } } }) }
  let checkpoint = 'c1'
  const revisions = new Map([[checkpoint, { ...files }]])
  const commit = () => { checkpoint = `c${revisions.size + 1}`; revisions.set(checkpoint, { ...files }) }
  const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(files), readTextAt: async (rev, path) => revisions.get(rev)?.[path] }
  let schemas = { [file]: { type: 'object', properties: { config: { type: 'object', properties: { theme: { type: 'string' }, patterns: { type: 'map', value: { type: 'object' } } } } } },
    'pages/pages.json': { type: 'object', properties: { pages: { type: 'map', value: { type: 'object', properties: { title: { type: 'string' }, ref: { type: 'string', knowledge: { role: 'reference', target: file + '#/config/patterns' } } } } } } } }
  const read = () => readCompleteDesignKnowledge(service, { projectId, limit: 3 })
  const run = () => refreshDesignKnowledge({ projectId, service, store, schemas, cache: service, identity: 'test-context-v5', mutate: fn => fn(), compute: async () => { calls++; return { edges: [] } } })
  try {
    service = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
    await run()
    const before = await read(), oldInput = knowledgeSemanticInput(before, 'c1')
    const find = (s, pointer) => s.entities.find(n => n.properties.pointer === pointer)
    const card = find(before, '/config/patterns/card'), child = find(before, '/config/patterns/card/size'), page = find(before, '/pages/a')
    assert.ok(card && child && page)
    const edge = (id, from) => ({ id, from: from.id, to: page.id, relationType: 'supports', lifecycle: 'proposed', properties: {},
      provenance: { producer: 'grounding', checkpoint: 'c1', evidence: [{ source: file, revision: 'c1', locator: from.properties.pointer }] } })
    await service.applyDelta({ mutationId: 'seed', pin: { projectId, inputCheckpoint: 'c1', observedCheckpoint: 'c1', expectedRevision: before.revision },
      upsertEntities: [], removeEntities: [], removeRelations: [], upsertRelations: [edge('stable-gra', card), edge('old-endpoint-gra', child),
        { ...edge('exact-field-gra', card), provenance: { producer: 'grounding', checkpoint: 'c1', evidence: [{ source: file, revision: 'c1', locator: '/config/patterns/card/description' }] } },
      ] })
    schemas = structuredClone(schemas)
    schemas[file].properties.config.knowledge = { role: 'content', granularity: 'container', label: '风格配置' }
    schemas[file].properties.config.properties.patterns.value.knowledge = { role: 'content', granularity: 'unit', label: '组件模式' }
    await run(); assert.equal(calls, 2)
    const next = await read()
    assert.equal(find(next, '/config/patterns/card').id, card.id)
    assert.equal(find(next, '/config/patterns/card').properties.contentKind, 'unit')
    assert.ok(next.relations.some(e => e.id === 'stable-gra'))
    assert.ok(!next.relations.some(e => e.id === 'old-endpoint-gra'))
    const fields = s => [...new Set(s.entities.flatMap(n => n.properties.fields.map(f => n.properties.file + '#' + f.pointer + ':' + f.text)))].sort()
    assert.deepEqual(fields(next), fields(before))
    await assert.rejects(publishKnowledgeSemantic({ projectId, service, input: oldInput, edges: [], currentCheckpoint: 'c1' }), /content changed/)
    const view = storedKnowledgeGraph(next, 'c1')
    assert.equal(view.nodes.find(n => n.id === card.id).contentKind, 'unit')
    assert.equal(view.nodes.find(n => n.pointer === '/config').sourceLabel, 'Workspace')
    await run(); assert.equal(calls, 2)
    const input = knowledgeSemanticInput(next, 'c1')
    files[file] = files[file].replace('Workspace', 'New context')
    commit()
    await run(); assert.equal(calls, 3)
    const current = await read()
    assert.notEqual(knowledgeSemanticInput(current, checkpoint).semanticUnits.find(u => u.nodeId === card.id).digest, input.semanticUnits.find(u => u.nodeId === card.id).digest)
    await assert.rejects(publishKnowledgeSemantic({ projectId, service, input, edges: [], currentCheckpoint: checkpoint }), /content changed|checkpoint/)
    await service.close()
    service = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
    await run(); assert.equal(calls, 3, 'Persistent completion matches exact new semantic inputs')
    assert.deepEqual(await read(), current)
    assert.ok((await read()).relations.some(e => e.id === 'stable-gra'))
    files[file] = files[file].replace('14px', '18px')
    commit()
    await run()
    const edited = await read()
    assert.ok(!edited.relations.some(e => e.id === 'stable-gra'), 'Broad unit evidence changed')
    assert.ok(edited.relations.some(e => e.id === 'exact-field-gra'), 'Unchanged exact description evidence survives size edit')
    files[file] = files[file].replace('"description":"Card"', '"description":"Panel"')
    commit()
    await run()
    assert.ok(!(await read()).relations.some(e => e.id === 'exact-field-gra'), 'Exact evidence edit invalidates its derived relation')
  } finally { await service?.close(); await rm(directory, { recursive: true, force: true }) }
})
