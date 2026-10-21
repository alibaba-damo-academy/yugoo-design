import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { designEvidenceSignatures } = await import('../src/design-knowledge-evidence.ts')
const { materializeDesignFilesKnowledge } = await import('../src/design-knowledge-projection.ts')

test('source evidence preserves types, empty structures, exact pointers and byte identity', async () => {
  const before = { bool: true, number: 0, shape: {}, nullable: null, empty: null, stable: { a: 1, b: 2 }, array: [1, 2], 'a/b': { '~key': false } }
  const after = { bool: 'true', number: '0', shape: [], nullable: '', stable: { b: 2, a: 1 }, array: [2, 1], 'a/b': { '~key': false } }
  const values = { c1: JSON.stringify(before), c2: JSON.stringify(after), c3: JSON.stringify(before, null, 2), broken: '{bad' }
  let reads = 0
  const signatures = designEvidenceSignatures({ listPathsAt: async revision => revision === 'missing' ? [] : ['a.json', 'a.png'],
    readTextAt: async revision => { reads++; return values[revision] },
    readBytesAt: async revision => Buffer.from(revision === 'c1' ? [0, 255] : [0, 254]) })
  for (const pointer of ['/bool', '/number', '/shape', '/nullable', '/empty', '/array']) {
    assert.notEqual(await signatures('c1', 'a.json', pointer), await signatures('c2', 'a.json', pointer), pointer)
  }
  for (const pointer of ['/stable', '/a~1b/~0key']) {
    assert.equal(await signatures('c1', 'a.json', pointer), await signatures('c2', 'a.json', pointer), pointer)
  }
  for (const pointer of ['/missing', '/array/01', '/array/length', '/array/-', '/a~2b', 'not-a-pointer']) {
    assert.equal(await signatures('c1', 'a.json', pointer), undefined, pointer)
  }
  assert.equal(await signatures('c1', 'a.json', ''), await signatures('c3', 'a.json', ''), 'JSON root ignores formatting')
  assert.notEqual(await signatures('c1', 'a.json'), await signatures('c3', 'a.json'), 'Unspecified locator is byte-level whole-file evidence')
  assert.equal(await signatures('missing', 'a.json', ''), undefined)
  assert.equal(await signatures('broken', 'a.json', ''), undefined)
  assert.equal(reads, 4, 'Files read once per immutable revision; absent paths not read')
  assert.notEqual(await signatures('c1', 'a.png', ''), await signatures('c2', 'a.png', ''))
  assert.equal(await signatures('c1', 'a.png', '/pixels'), undefined)
  const failed = designEvidenceSignatures({ listPathsAt: async () => ['a.json'], readTextAt: async () => { throw new Error('temporary IO failure') } })
  await assert.rejects(failed('c1', 'a.json', ''), /temporary IO/)
  const missingBlob = designEvidenceSignatures({ listPathsAt: async () => ['a.json'], readTextAt: async () => undefined })
  await assert.rejects(missingBlob('c1', 'a.json', ''), /blob unreadable/)
})

function memoryService() {
  const entities = new Map(), relations = new Map()
  let revision = 0, writes = 0
  return { entities, relations, get writes() { return writes }, revision: async () => String(revision),
    query: async ({ offset = 0, limit }) => ({ revision: String(revision), entities: [...entities.values()].slice(offset, offset + limit),
      relations: [...relations.values()].slice(offset, offset + limit), page: { offset, totalEntities: entities.size, totalRelations: relations.size,
        nextOffset: offset + limit < Math.max(entities.size, relations.size) ? offset + limit : null } }),
    applyDelta: async delta => {
      assert.equal(delta.pin.expectedRevision, String(revision)); writes++
      for (const id of delta.removeRelations) relations.delete(id)
      for (const id of delta.removeEntities) entities.delete(id)
      for (const value of delta.upsertEntities) entities.set(value.id, value)
      for (const value of delta.upsertRelations) relations.set(value.id, value)
      return { revision: String(++revision) }
    } }
}

test('projection retires lossy-value changes but preserves exact unchanged evidence and stops publication on IO errors', async () => {
  const file = 'demo/demo.json'
  const value = payload => JSON.stringify({ entries: { a: { name: 'Alpha', payload }, b: { name: 'Beta' } } })
  for (const [oldValue, newValue] of [[true, 'true'], [0, '0'], [{}, []], [null, '']]) {
    let checkpoint = 'c1', fail = false
    const texts = { c1: value(oldValue), c2: value(newValue) }
    const service = memoryService()
    const store = { head: async () => checkpoint, listPathsAt: async revision => Object.hasOwn(texts, revision) ? [file] : [], readTextAt: async revision => {
      if (fail && revision === 'c1') throw new Error('temporary history IO failure')
      return texts[revision]
    } }
    const run = () => materializeDesignFilesKnowledge({ projectId: 'test', store, service })
    await run()
    assert.ok([...service.relations.values()].every(relation => relation.properties.relationSemantics?.definitionDigest), 'file projection pins relation semantics')
    const settledWrites = service.writes
    assert.equal((await run()).changed, false, 'pinned semantics participate in stable idempotence')
    assert.equal(service.writes, settledWrites)
    const from = [...service.entities.values()].find(n => n.properties.pointer === '/entries/a')
    const to = [...service.entities.values()].find(n => n.properties.pointer === '/entries/b')
    for (const [id, locator, revision] of [['changed', '/entries/a/payload', 'c1'], ['stable', '/entries/a/name', 'c1'],
      ['unresolved', '/entries/a/missing', 'c1'], ['missing-history', '/entries/a/name', 'unknown']]) {
      service.relations.set(id, { id, from: from.id, to: to.id, properties: {}, provenance: { producer: 'grounding', checkpoint: 'c1', evidence: [{ source: file, locator, revision }] } })
    }
    checkpoint = 'c2'; fail = true
    const writes = service.writes
    await assert.rejects(run(), /temporary history IO/)
    assert.equal(service.writes, writes, 'Read errors preserve the previous graph without publication')
    assert.ok(service.relations.has('changed'))
    fail = false
    const result = await run()
    assert.deepEqual([...service.relations.keys()].filter(id => !id.startsWith('contains:')), ['stable'])
    assert.ok(result.warnings.some(w => w.includes('evidence unavailable')))
  }
})

test('source file removal retires its evidence without deleting unrelated graph endpoints', async () => {
  const file = 'demo/demo.json', evidenceFile = 'evidence/evidence.json'
  const revisions = { c1: { [file]: '{"entries":{"a":{"name":"Alpha"},"b":{"name":"Beta"}}}', [evidenceFile]: '{"name":"Source"}' } }
  revisions.c2 = { [file]: revisions.c1[file] }
  let checkpoint = 'c1'
  const store = { head: async () => checkpoint, listPathsAt: async rev => Object.keys(revisions[rev]), readTextAt: async (rev, path) => revisions[rev]?.[path] }
  const service = memoryService()
  const run = () => materializeDesignFilesKnowledge({ projectId: 'test', store, service })
  await run()
  const from = [...service.entities.values()].find(n => n.properties.pointer === '/entries/a')
  const to = [...service.entities.values()].find(n => n.properties.pointer === '/entries/b')
  service.relations.set('gra', { id: 'gra', from: from.id, to: to.id, properties: {}, provenance: { producer: 'grounding', checkpoint: 'c1', evidence: [{ source: evidenceFile, revision: 'c1' }] } })
  checkpoint = 'c2'; await run()
  assert.equal(service.relations.has('gra'), false)
  assert.ok(service.entities.has(from.id) && service.entities.has(to.id))
})
