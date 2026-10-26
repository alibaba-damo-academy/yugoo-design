import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { projectDesignGraph, readDesignGraph } = await import('../src/design-graph.ts')
const { materializeDesignFilesKnowledge, readSourceDesignKnowledge } = await import('../src/design-knowledge-projection.ts')
const { queryKnowledgeSnapshot } = await import('../src/design-knowledge-query.ts')
const file = 'tasks/tasks.json'
const schema = { type: 'object', properties: { tasks: { type: 'map', value: { type: 'object' } } } }

async function sourceFixture() {
  const files = { 'a/a.json': JSON.stringify({ title: 'Alpha', note: 'literal source evidence' }), 'b/b.json': JSON.stringify({ title: 'Beta' }) }
  let head = 'c1', writes = 0
  const sources = new Map([['c1', structuredClone(files)]]), snapshots = new Map([['rev:0', { revision: 'rev:0', entities: [], relations: [], generation: 'generation-1' }]])
  let revision = 'rev:0'
  const store = {
    head: async () => head,
    listPathsAt: async checkpoint => Object.keys(sources.get(checkpoint)),
    readTextAt: async (checkpoint, path) => sources.get(checkpoint)[path],
    sameDesignEvidenceAt: async (a, b) => JSON.stringify(sources.get(a)) === JSON.stringify(sources.get(b)),
  }
  const service = {
    revision: async project => { assert.equal(project, 'project', 'project identity cannot be silently replaced'); return revision },
    query: async request => {
      assert.equal(request.projectId, 'project', 'project identity cannot be silently replaced')
      const snapshot = snapshots.get(request.revision ?? revision)
      if (!snapshot) throw Error('unknown Knowledge revision')
      return queryKnowledgeSnapshot(snapshot, request)
    },
    applyDelta: async delta => {
      assert.equal(delta.pin.projectId, 'project'); assert.equal(delta.pin.expectedRevision, revision)
      const previous = snapshots.get(revision)
      const merge = (before, removed, upsert) => [...before.filter(record => !removed.includes(record.id) && !upsert.some(next => next.id === record.id)), ...upsert]
      revision = `rev:${++writes}`
      snapshots.set(revision, { revision, generation: 'generation-1', entities: merge(previous.entities, delta.removeEntities, delta.upsertEntities), relations: merge(previous.relations, delta.removeRelations, delta.upsertRelations) })
      return { revision, replayed: false }
    },
  }
  const options = { store, service, projectId: 'project' }
  return { options, sources, snapshots, service, store,
    head: value => { head = value }, revision: () => revision, writes: () => writes,
    project: () => materializeDesignFilesKnowledge(options),
    read: request => readSourceDesignKnowledge({ ...options, checkpoint: head, ...request }),
  }
}

test('source-only reads prove the complete source set and exclude semantic records without writing', async () => {
  const f = await sourceFixture()
  await assert.rejects(f.read(), /not available/)
  await f.project()
  const stored = f.snapshots.get(f.revision())
  const endpoints = stored.entities.slice(0, 2).map(record => record.id)
  stored.relations.push({ id: 'semantic:unfinished', from: endpoints[0], to: endpoints[1], relationType: 'semantic-similarity', lifecycle: 'proposed', properties: { projection: 'embedding-v1' }, provenance: { producer: 'source-analysis', checkpoint: 'c1', evidence: [] } })
  const writes = f.writes(), result = await f.read()
  assert.equal(result.sourceCheckpoint, 'c1'); assert.equal(result.graph.revision, f.revision())
  assert.deepEqual(result.sourceFiles, ['a/a.json', 'b/b.json'])
  assert.ok(result.graph.entities.length > 0)
  assert.ok(!result.graph.relations.some(edge => edge.id === 'semantic:unfinished'))
  assert.equal(stored.relations.at(-1).id, 'semantic:unfinished', 'the read view cannot mutate or retire stored candidates')
  const page = queryKnowledgeSnapshot(result.graph, { projectId: 'project', revision: result.graph.revision, text: 'literal', offset: 0, limit: 1 })
  assert.ok(page.entities.length > 0); assert.equal(page.page.totalEntities > 0, true)
  assert.equal(f.writes(), writes, 'source proof never runs projection or writes a marker')
})

test('equal checkpoints cannot disguise partial, added, deleted or changed source projection data', async t => {
  for (const mode of ['missing-entity', 'missing-relation', 'new-source', 'deleted-source', 'changed-source', 'mixed-checkpoint']) await t.test(mode, async () => {
    const f = await sourceFixture(); await f.project()
    const snapshot = f.snapshots.get(f.revision())
    if (mode === 'missing-entity') snapshot.entities.pop()
    if (mode === 'missing-relation') { assert.ok(snapshot.relations.length); snapshot.relations.pop() }
    if (mode === 'new-source') f.sources.get('c1')['new/new.json'] = '{"title":"new source"}'
    if (mode === 'deleted-source') delete f.sources.get('c1')['b/b.json']
    if (mode === 'changed-source') f.sources.get('c1')['a/a.json'] = '{"title":"changed body"}'
    if (mode === 'mixed-checkpoint') snapshot.entities[0].provenance.checkpoint = 'other'
    const writes = f.writes()
    await assert.rejects(f.read(), /complete pinned source set|mixed checkpoints/)
    assert.equal(f.writes(), writes)
  })
})

test('source read keeps original checkpoint on proven equivalence and rejects stale or changed pins', async () => {
  const f = await sourceFixture(); await f.project()
  f.sources.set('auxiliary', structuredClone(f.sources.get('c1'))); f.head('auxiliary')
  assert.equal((await f.read()).sourceCheckpoint, 'c1')
  f.sources.set('changed', { 'a/a.json': '{"title":"new design"}' }); f.head('changed')
  await assert.rejects(f.read(), /stale/)
  f.head('c1')
  await assert.rejects(f.read({ revision: 'rev:0' }), /not available/)
  await assert.rejects(f.read({ revision: 'rev:999' }), /unknown Knowledge revision/)
  await assert.rejects(f.read({ projectId: 'wrong-project' }), /project identity/)
  const read = f.store.readTextAt
  f.store.readTextAt = async (...args) => { const value = await read(...args); f.head('changed'); return value }
  await assert.rejects(f.read(), /checkpoint changed/)
})

test('source proof cannot cross provider generations while paging', async () => {
  const f = await sourceFixture()
  for (let i = 0; i < 120; i++) f.sources.get('c1')[`file${i}/file${i}.json`] = JSON.stringify({ title: `Source ${i}` })
  await f.project()
  const query = f.service.query
  let pages = 0
  f.service.query = async request => ({ ...await query(request), generation: ++pages === 1 ? 'generation-1' : 'changed-generation' })
  await assert.rejects(f.read(), /generation changed/)
  assert.ok(pages > 1)
})
test('storage reuses view identities without display node and semantic budgets', () => {
  const tasks = Object.fromEntries(Array.from({ length: 350 }, (_, i) => ['t' + i, { caption: '任务 ' + i, details: Array.from({ length: 5 }, (_, j) => '详细说明 ' + j) }]))
  const files = { [file]: { tasks } }, schemas = { [file]: schema }
  const view = projectDesignGraph(files, 'c', schemas)
  const stored = projectDesignGraph(files, 'c', schemas, { purpose: 'storage' })
  assert.equal(view.nodes.filter(n => n.record).length, 300)
  assert.equal(stored.nodes.filter(n => n.record).length, 350)
  assert.ok(stored.nodes.filter(n => !n.record).length > 1200)
  const ids = new Set(stored.nodes.map(n => n.id))
  assert.ok(view.nodes.every(n => ids.has(n.id)))
  assert.deepEqual(stored.semanticUnits, []) // Text is persisted; embedding gets its own work batches.
})
test('complete read is not truncated at four MB and rejects unreadable inputs', async () => {
  const content = '文'.repeat(1_400_000)
  const store = { listPathsAt: async () => [file], readTextAt: async () => JSON.stringify({ tasks: { a: { caption: '测试记录', content } } }) }
  const graph = await readDesignGraph(store, 'c', undefined, { [file]: schema }, { purpose: 'storage' })
  assert.equal(graph.nodes[0].fields.find(f => f.pointer.endsWith('/content')).text, content)
  for (const text of [undefined, '{bad', '[]']) {
    await assert.rejects(readDesignGraph({ ...store, readTextAt: async () => text }, 'c', undefined, {}, { purpose: 'storage' }))
  }
})
test('storage retains root settings alongside records without reviving excluded questions', () => {
  const root = { version: 3, enabled: false, tags: ['个人研究', '跨学科'], tasks: { a: { caption: '科研计划' } }, questions: { unanswered: { prompt: '待回答', answer: '' } } }
  const graph = projectDesignGraph({ [file]: root }, 'c', {}, { purpose: 'storage' })
  const fields = new Map(graph.nodes.flatMap(n => n.fields ?? []).map(f => [f.pointer, f.text]))
  assert.equal(fields.get('/version'), '3')
  assert.equal(fields.get('/enabled'), 'false')
  assert.equal(fields.get('/tags/1'), '跨学科')
  assert.equal(fields.get('/tasks/a/caption'), '科研计划')
  assert.equal([...fields.keys()].some(p => p.startsWith('/questions/')), false)
  assert.equal(graph.nodes.filter(n => n.record && n.pointer === '').length, 1)
})
