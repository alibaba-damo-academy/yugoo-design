import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { refreshDesignKnowledge, readDesignKnowledgePublication, DESIGN_KNOWLEDGE_PUBLICATION_KEY } = await import('../../core/src/design-knowledge-refresh.ts')
const { readCompleteDesignKnowledge } = await import('../../core/src/design-knowledge-snapshot.ts')
const { semanticEdges } = await import('../../core/src/design-semantic.ts')
const { storedKnowledgeGraph } = await import('../../core/src/design-knowledge-semantic.ts')
const { DesignKnowledgeIndex } = await import('../../core/src/design-knowledge-index.ts')
after(() => shutdownLadybugKnowledgeRuntime())

test('files, complete embedding input and candidate edges share one persisted graph', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-refresh-'))
  let provider
  try {
    provider = await LadybugDesignKnowledgeProvider.open('refresh', { databaseRoot: directory })
    let checkpoint = 'c1', inMutation = false
    const files = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`b${i}/b${i}.json`, JSON.stringify({ records: { main: { caption: '科研记录 ' + i, text: '研究'.repeat(9500) + '结尾证据' } } })]))
    const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(files), readTextAt: async (_revision, path) => files[path] }
    const mutate = async fn => { assert.equal(inMutation, false); inMutation = true; try { return await fn() } finally { inMutation = false } }
    let count = 0
    const compute = async graph => {
      assert.equal(inMutation, false, 'Inference must not hold the host project mutation lock')
      count = graph.semanticUnits.length
      assert.ok(count > 300, 'No presentation chunk budget may truncate indexing')
      assert.ok(graph.semanticUnits.some(u => u.text.includes('结尾证据')), 'Long fields must not stop after eight chunks')
      return { edges: semanticEdges(graph.semanticUnits, graph.semanticUnits.map(() => [1,0,0,0,0,0,0,0]), 'test@1', graph.checkpoint) }
    }
    const phases = []
    const options = { store, service: provider, projectId: 'refresh', mutate, compute, report: phase => phases.push(phase) }
    const first = await refreshDesignKnowledge(options)
    assert.equal(first.semantic, 'ready')
    assert.deepEqual(phases, ['projection', 'semantic', 'publication', 'ready'], 'UI progress reports real pipeline stages in order')
    const snapshot = await readCompleteDesignKnowledge(provider, { projectId: 'refresh', limit: 100 })
    const candidates = snapshot.relations.filter(e => e.properties.projection === 'embedding-v1')
    assert.ok(candidates.length > 0)
    const ids = new Set(snapshot.entities.map(n => n.id))
    assert.ok(candidates.every(e => ids.has(e.from) && ids.has(e.to) && e.lifecycle === 'proposed'))
    assert.ok(candidates.every(e => e.provenance.evidence.length && e.properties.model === 'test@1'))
    const view = storedKnowledgeGraph(snapshot, 'c1')
    assert.deepEqual(view.edges.filter(e => e.kind === 'semantic').map(e => e.id).sort(), candidates.map(e => e.id).sort(), 'Panel projection consumes persisted candidate IDs, not another similarity calculation')
    assert.equal((await refreshDesignKnowledge(options)).revision, first.revision, 'Repeating the same result does not append graph history')
    await assert.rejects(refreshDesignKnowledge({ ...options, compute: async () => { throw new Error('model unavailable') } }), /model unavailable/)
    assert.equal(await provider.revision('refresh'), first.revision, 'Inference failure cannot clear existing candidates')
    await assert.rejects(refreshDesignKnowledge({ ...options, compute: async input => { const result = await compute(input); checkpoint = 'c2'; return result } }), /checkpoint changed/)
    assert.equal(await provider.revision('refresh'), first.revision, 'Stale model output must not publish')
    await provider.close()
    provider = await LadybugDesignKnowledgeProvider.open('refresh', { databaseRoot: directory })
    const reopened = await readCompleteDesignKnowledge(provider, { projectId: 'refresh', limit: 100 })
    assert.equal(reopened.relations.filter(e => e.properties.projection === 'embedding-v1').length, candidates.length)
  } finally {
    await provider?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('healthy legacy graph: background single-flight, durable zero-edge success, model/schema freshness and failed-input retention', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-on-open-'))
  let provider, indexer = new DesignKnowledgeIndex()
  let checkpoint = 'c1', calls = 0, release
  const waiting = new Promise(resolve => { release = resolve })
  const files = { 'a/a.json': JSON.stringify({ schema_version: 1, title: '研究计划' }), 'b/b.json': JSON.stringify({ title: '实验计划' }) }
  const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(files), readTextAt: async (_revision, path) => files[path] }
  let tail = Promise.resolve()
  const mutate = fn => { const task = tail.then(fn, fn); tail = task.catch(() => {}); return task }
  try {
    provider = await LadybugDesignKnowledgeProvider.open('on-open', { databaseRoot: directory })
    const base = () => ({ projectId: 'on-open', store, service: provider, mutate })
    await refreshDesignKnowledge(base()) // Healthy, pre-existing file graph, no recovery.
    let identity = 'model-a:threshold-.8', schemas
    const compute = async () => { calls++; await waiting; return { edges: [] } }
    const options = () => ({ ...base(), cache: provider, identity, schemas, indexer, compute, background: true })
    const first = await refreshDesignKnowledge(options())
    assert.equal(first.semantic, 'indexing')
    assert.equal(provider.recovery, undefined)
    assert.ok((await Promise.all(Array.from({ length: 5 }, () => refreshDesignKnowledge(options())))).every(r => r.semantic === 'indexing'))
    assert.equal(calls, 1, 'Concurrent project readers share one job')
    release()
    assert.equal((await refreshDesignKnowledge({ ...options(), background: false })).semantic, 'ready')
    await indexer.close(); await provider.close()
    indexer = new DesignKnowledgeIndex()
    provider = await LadybugDesignKnowledgeProvider.open('on-open', { databaseRoot: directory })
    assert.equal((await refreshDesignKnowledge(options())).semantic, 'ready')
    assert.equal(calls, 1, 'Reopening a successful zero-edge index does not recompute')
    identity = 'model-b:threshold-.8'
    assert.equal((await refreshDesignKnowledge({ ...options(), background: false })).semantic, 'ready')
    assert.equal(calls, 2, 'Model/policy identity changes at the same checkpoint are not suppressed')
    schemas = { 'a/a.json': { type: 'object', properties: { schema_version: { type: 'number', knowledge: { role: 'metadata' } }, title: { type: 'string' } } } }
    await refreshDesignKnowledge({ ...options(), background: false })
    assert.equal(calls, 3, 'Same-checkpoint schema projection changes invalidate the semantic input')
    const fail = async () => { calls++; throw new Error('model unavailable') }
    identity = 'broken-model'
    await assert.rejects(refreshDesignKnowledge({ ...options(), compute: fail, background: false }), /model unavailable/)
    for (let i = 0; i < 5; i++) assert.equal((await refreshDesignKnowledge({ ...options(), compute: fail })).semantic, 'error')
    assert.equal(calls, 4, 'Panel polling does not automatically retry a failed input')
    checkpoint = 'c2'
    await refreshDesignKnowledge({ ...options(), background: false })
    assert.equal(calls, 5, 'A genuinely new input permits another attempt')
    const snapshot = await readCompleteDesignKnowledge(provider, { projectId: 'on-open', limit: 100 })
    const [from, to] = snapshot.entities
    await provider.applyDelta({ mutationId: 'unrelated-review', pin: { projectId: 'on-open', inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: snapshot.revision },
      upsertEntities: [], removeEntities: [], removeRelations: [], upsertRelations: [{ id: 'review:unrelated', from: from.id, to: to.id,
        relationType: 'supports', lifecycle: 'proposed', properties: { summary: 'review evidence' },
        provenance: { producer: 'grounding', checkpoint, evidence: [{ source: from.properties.file, revision: checkpoint, locator: from.properties.pointer }] } }] })
    assert.equal((await refreshDesignKnowledge(options())).semantic, 'ready')
    assert.equal(calls, 5, 'Unrelated GRA graph revisions do not invalidate embedding completion')
    assert.equal((await refreshDesignKnowledge({ ...base(), indexer })).semantic, 'disabled')
    assert.equal(calls, 5, 'Disabled indexing never creates work')
    let cacheWritable = false
    const unavailableCache = { readSemanticCache: async () => undefined, writeSemanticCache: async () => {
      if (!cacheWritable) throw new Error('cache read-only')
    } }
    const nonPersistent = { ...options(), identity: 'uncached-model', cache: unavailableCache }
    await assert.rejects(refreshDesignKnowledge({ ...nonPersistent, background: false }), /complete-publication pointer/)
    const completed = await refreshDesignKnowledge(nonPersistent)
    assert.equal(completed.semantic, 'error', 'A missing complete-publication pointer is never reported ready')
    assert.equal(calls, 6, 'Pure reads cannot turn a failed publication into an implicit retry')
    cacheWritable = true; indexer.retry('on-open')
    assert.equal((await refreshDesignKnowledge({ ...nonPersistent, background: false })).semantic, 'ready')
    assert.equal(calls, 7, 'An explicit lifecycle retry may republish the same input')
    for (const action of ['release', 'close']) {
      const isolated = new DesignKnowledgeIndex()
      let unblock, entered
      const blocked = new Promise(resolve => { unblock = resolve })
      const started = new Promise(resolve => { entered = resolve })
      const preparation = refreshDesignKnowledge({ ...options(), identity: action, indexer: isolated,
        mutate: async fn => { entered(); await blocked; return mutate(fn) } })
      await started
      if (action === 'release') isolated.release('on-open')
      else await isolated.close()
      unblock()
      await assert.rejects(preparation, /released|closed/)
      assert.equal(calls, 7, 'A prepared request cannot revive after its project/runtime release')
      await isolated.close()
    }
    let edgeCalls = 0
    const withEdges = { ...options(), identity: 'edge-model', compute: async input => { edgeCalls++; return { edges: semanticEdges(input.semanticUnits,
      input.semanticUnits.map(() => [1,0,0,0,0,0,0,0]), 'edge-model', checkpoint) } }, background: false }
    await refreshDesignKnowledge(withEdges)
    const withCandidates = await readCompleteDesignKnowledge(provider, { projectId: 'on-open', limit: 100 })
    const candidate = withCandidates.relations.find(edge => edge.properties.projection === 'embedding-v1')
    assert.ok(candidate)
    await provider.applyDelta({ mutationId: 'remove-derived-edge', pin: { projectId: 'on-open', inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: withCandidates.revision },
      upsertEntities: [], removeEntities: [], upsertRelations: [], removeRelations: [candidate.id] })
    await refreshDesignKnowledge(withEdges)
    assert.equal(edgeCalls, 2, 'A missing published candidate invalidates completion even when file input is unchanged')
  } finally { release(); await indexer.close(); await provider?.close(); await rm(directory, { recursive: true, force: true }) }
})

test('file-only publication is serialized and cannot overwrite a newer checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-publication-order-'))
  let provider, checkpoint = 'c1', releaseWrite, enteredWrite, firstWrite = true
  const blocked = new Promise(resolve => { releaseWrite = resolve })
  const entered = new Promise(resolve => { enteredWrite = resolve })
  const files = { 'a/a.json': JSON.stringify({ title: '研究计划' }) }
  const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(files), readTextAt: async (_revision, path) => files[path] }
  let tail = Promise.resolve()
  const mutate = fn => { const task = tail.then(fn, fn); tail = task.catch(() => {}); return task }
  try {
    provider = await LadybugDesignKnowledgeProvider.open('publication-order', { databaseRoot: directory })
    const cache = {
      readSemanticCache: key => provider.readSemanticCache(key),
      writeSemanticCache: async (key, value) => {
        if (key === DESIGN_KNOWLEDGE_PUBLICATION_KEY && firstWrite) {
          firstWrite = false; enteredWrite(); await blocked
        }
        return provider.writeSemanticCache(key, value)
      },
    }
    const options = { projectId: 'publication-order', service: provider, store, cache, mutate }
    const first = refreshDesignKnowledge(options)
    await entered
    checkpoint = 'c2'
    const second = refreshDesignKnowledge(options)
    releaseWrite()
    await Promise.all([first, second])
    assert.equal((await readDesignKnowledgePublication(cache)).checkpoint, 'c2')
  } finally { releaseWrite(); await provider?.close(); await rm(directory, { recursive: true, force: true }) }
})

test('index release prevents late publication and drains without blocking a host selection transaction', async () => {
  const indexer = new DesignKnowledgeIndex()
  let release, published = 0, signal
  const waiting = new Promise(resolve => { release = resolve })
  assert.equal(await indexer.run('p', 'input-old', 'edges', async current => { signal = current; await waiting; current.throwIfAborted(); published++; return { artifact: 'edges' } }, true), 'indexing')
  indexer.release('p')
  assert.equal(signal.aborted, true)
  assert.equal(await indexer.run('p', 'input-new', 'edges', async () => { published++; return { artifact: 'edges' } }), 'ready')
  release(); await indexer.close()
  assert.equal(published, 1)
  await assert.rejects(indexer.run('p', 'input-old', 'edges', async () => { published++; return { artifact: 'edges' } }), /closed/)
})

test('settled KAG persists inside its mutation boundary and accepts only auxiliary checkpoint changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-project-records-'))
  let provider, checkpoint = 'design', inMutation = false, records = 0
  const files = { 'a/a.json': JSON.stringify({ title: 'Saved evidence' }) }
  const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(files),
    readTextAt: async (_revision, path) => files[path],
    sameDesignEvidenceAt: async (left, right) => [left, right].every(value => ['design', 'records'].includes(value)) }
  const mutate = async fn => { assert.equal(inMutation, false); inMutation = true; try { return await fn() } finally { inMutation = false } }
  try {
    provider = await LadybugDesignKnowledgeProvider.open('project-records', { databaseRoot: directory })
    const options = { projectId: 'project-records', service: provider, store, cache: provider, mutate, identity: 'test',
      compute: async () => { assert.equal(inMutation, false); checkpoint = 'records'; return { edges: [] } },
      persist: async publication => {
        assert.equal(inMutation, true, 'The existing queue owns file publication too')
        assert.equal(publication.checkpoint, 'design')
        assert.equal(publication.revision, await provider.revision('project-records'))
        records++
      } }
    assert.equal((await refreshDesignKnowledge(options)).semantic, 'ready')
    assert.equal(records, 1)
    checkpoint = 'design'
    await assert.rejects(refreshDesignKnowledge({ ...options, identity: 'changed', compute: async () => {
      checkpoint = 'different-design'; return { edges: [] }
    } }), /checkpoint changed/)
    assert.equal(records, 1, 'Changed Design evidence cannot publish a stale archive')
    checkpoint = 'design'
    const phases = []
    await assert.rejects(refreshDesignKnowledge({ ...options, identity: 'persist-fails',
      report: phase => phases.push(phase), persist: async () => { throw new Error('Project record unavailable') } }), /Project record unavailable/)
    assert.equal(phases.includes('ready'), false, 'A cache-only result is not a successfully durable publication')
  } finally { await provider?.close(); await rm(directory, { recursive: true, force: true }) }
})
