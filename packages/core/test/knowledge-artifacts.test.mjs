import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { appendReferencedKnowledgeArtifacts } = await import('../src/design-knowledge-artifacts.ts')
const { projectDesignGraph } = await import('../src/design-graph.ts')

const fixture = () => {
  const files = {
    'page/page.json': Buffer.from('{}'), 'empty/empty.json': Buffer.from('{}'),
    'page/view.html': Buffer.from('<main>真实页面内容</main>'),
    'page/logo.png': Buffer.from([137,80,78,71,0,255]),
    'shared.txt': Buffer.from('root'), 'page/shared.txt': Buffer.from('relative'),
    '_experiences/view.html': Buffer.from('not authoritative'),
  }
  const fields = ['view.html', 'page/logo.png', 'empty/empty.json', 'shared.txt', '_experiences/view.html']
    .map((text, i) => ({ pointer: '/record/refs/' + i, text }))
  const graph = { checkpoint: 'c1', nodes: [{ id: 'record', recordId: 'record', file: 'page/page.json', pointer: '/record', fields }], edges: [] }
  const store = { listPathsAt: async () => Object.keys(files), readBytesAt: async (revision, path) => { assert.equal(revision, graph.checkpoint); return files[path] } }
  return { graph, store, files }
}
test('exact referenced artifacts preserve text or binary identity without guessing ambiguous paths', async () => {
  const { graph, store } = fixture()
  await appendReferencedKnowledgeArtifacts(store, graph)
  const artifacts = graph.nodes.filter(n => n.source)
  assert.deepEqual(artifacts.map(n => n.file), ['page/logo.png', 'page/view.html'])
  assert.equal(artifacts[0].source.encoding, 'binary')
  assert.deepEqual(artifacts[0].fields, [])
  assert.equal(artifacts[1].fields[0].text, '<main>真实页面内容</main>')
  assert.equal(graph.edges.length, 2)
  assert.ok(graph.edges.every(e => e.from === 'record' && artifacts.some(n => n.id === e.to)))
})
test('artifact identities survive byte changes while content digest changes', async () => {
  const first = fixture(), second = fixture()
  second.files['page/logo.png'] = Buffer.from([137,80,78,71,0,254])
  await appendReferencedKnowledgeArtifacts(first.store, first.graph)
  await appendReferencedKnowledgeArtifacts(second.store, second.graph)
  const before = first.graph.nodes.find(n => n.file === 'page/logo.png')
  const after = second.graph.nodes.find(n => n.file === 'page/logo.png')
  assert.equal(before.id, after.id)
  assert.notEqual(before.source.digest, after.source.digest)
})
test('unreadable referenced bytes and cancellation cannot produce successful partial projections', async () => {
  const { graph, store } = fixture()
  await assert.rejects(appendReferencedKnowledgeArtifacts({ ...store, readBytesAt: async () => undefined }, graph), /missing artifact/)
  const aborted = fixture()
  await assert.rejects(appendReferencedKnowledgeArtifacts(aborted.store, aborted.graph, AbortSignal.abort()), /abort/i)
})

const reference = target => ({ type: 'string', knowledge: { role: 'reference', ...(target ? { target } : {}) } })
const records = properties => ({ type: 'map', value: { type: 'object', properties } })
const sourceFile = 'source/source.json'
const artifactPath = 'source/artifacts/availability.csv'
const csv = Buffer.from('worker,available\nA,1')
function referenceFixture({ linked = artifactPath, artifacts = { [artifactPath]: csv }, target, files = {}, schemas = {} } = {}) {
  const canonical = { [sourceFile]: { records: { a: { title: 'Independent staffing facts', linked, other: 'missing-record' } } }, ...files }
  schemas = { [sourceFile]: { type: 'object', properties: { records: records({ linked: reference(target), other: reference() }) } }, ...schemas }
  const graph = projectDesignGraph(canonical, 'checkpoint', schemas, { purpose: 'storage' })
  const reads = []
  const store = {
    listPathsAt: async checkpoint => { assert.equal(checkpoint, graph.checkpoint); return [...Object.keys(canonical), ...Object.keys(artifacts)].map(p => 'design_files/' + p) },
    readBytesAt: async (checkpoint, path) => { assert.equal(checkpoint, graph.checkpoint); reads.push(path); return artifacts[path] },
  }
  const append = () => appendReferencedKnowledgeArtifacts(store, graph, undefined, undefined, schemas)
  return { graph, canonical, store, reads, schemas, append }
}
const linkedWarnings = graph => graph.warnings.filter(w => w.startsWith(sourceFile + '#/records/a/linked:'))
const artifactEdges = graph => graph.edges.filter(e => e.id.startsWith('artifact-ref:'))

test('verified checkpoint artifacts resolve only their own missing-reference warning', async () => {
  assert.equal(csv.byteLength, 20)
  for (const linked of [artifactPath, 'artifacts/availability.csv', 'design_files/' + artifactPath]) {
    const f = referenceFixture({ linked }), before = JSON.stringify(f.canonical)
    assert.equal(linkedWarnings(f.graph).length, 1)
    const unrelated = f.graph.warnings.filter(w => !linkedWarnings(f.graph).includes(w))
    assert.equal(unrelated.length, 1, 'ordinary missing reference remains diagnostic evidence')
    await f.append()
    const artifact = f.graph.nodes.find(n => n.file === artifactPath)
    assert.equal(artifact.source.byteLength, 20)
    assert.equal(artifact.fields[0].text, csv.toString())
    assert.equal(artifactEdges(f.graph).length, 1)
    assert.equal(artifactEdges(f.graph)[0].to, artifact.id)
    assert.deepEqual(f.reads, [artifactPath])
    assert.deepEqual(linkedWarnings(f.graph), [])
    assert.deepEqual(f.graph.warnings, unrelated)
    assert.equal(JSON.stringify(f.canonical), before)
  }
})

test('missing, ambiguous-relative and derived artifacts retain unresolved diagnostics', async () => {
  const fixtures = [
    referenceFixture({ artifacts: {} }),
    referenceFixture({ linked: 'shared.csv', artifacts: { 'shared.csv': csv, 'source/shared.csv': csv } }),
    referenceFixture({ linked: 'compiled/output.csv', artifacts: { 'compiled/output.csv': csv },
      schemas: { 'compiled/compiled.json': { type: 'object', knowledge: { role: 'metadata', source_kind: 'derived' } } } }),
  ]
  for (const f of fixtures) {
    const before = [...f.graph.warnings]
    await f.append()
    assert.deepEqual(f.graph.warnings, before)
    assert.equal(linkedWarnings(f.graph).length, 1)
    assert.equal(artifactEdges(f.graph).length, 0)
    assert.equal(f.graph.nodes.some(n => n.source), false)
    assert.deepEqual(f.reads, [])
  }
})

test('an artifact does not resolve an explicit canonical collection target', async () => {
  const f = referenceFixture({ target: '#/records' }), before = [...f.graph.warnings]
  await f.append()
  assert.equal(artifactEdges(f.graph).length, 1, 'existing exact file attachment behavior is preserved')
  assert.deepEqual(f.graph.warnings, before)
  assert.equal(linkedWarnings(f.graph).length, 1)
})

test('a readable artifact cannot hide ambiguous canonical identifiers', async () => {
  const shared = 'availability.csv'
  const f = referenceFixture({ linked: shared, artifacts: { ['source/' + shared]: csv }, files: {
    'first/first.json': { records: { [shared]: { title: 'First candidate' } } },
    'second/second.json': { records: { [shared]: { title: 'Second candidate' } } },
  }, schemas: {
    'first/first.json': { type: 'object', properties: { records: records({}) } },
    'second/second.json': { type: 'object', properties: { records: records({}) } },
  } })
  const before = [...f.graph.warnings]
  assert.ok(linkedWarnings(f.graph)[0].includes('多个候选'))
  await f.append()
  assert.equal(artifactEdges(f.graph).length, 1)
  assert.deepEqual(f.graph.warnings, before)
})

test('listed but unreadable artifacts cannot clear a missing-reference warning', async () => {
  const f = referenceFixture({ artifacts: { [artifactPath]: undefined } }), before = [...f.graph.warnings]
  await assert.rejects(f.append(), /missing artifact/)
  assert.deepEqual(f.graph.warnings, before)
  assert.equal(artifactEdges(f.graph).length, 0)
})
