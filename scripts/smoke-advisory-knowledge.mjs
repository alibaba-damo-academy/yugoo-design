/** Keyless smoke for the shared read-only KAG snapshot used by every review loop. */
import assert from 'node:assert/strict'
import {
  impactAdvisoryKnowledge,
  advisoryKnowledgeModelContext,
  ADVISORY_KNOWLEDGE_MODEL_CONTEXT_MAX_BYTES,
  readAdvisoryDesignKnowledge,
  sameAdvisoryDesignKnowledge,
  traceAdvisoryKnowledge,
} from '../packages/core/src/advisory-knowledge.ts'

const selection = { project: '11111111-1111-4111-8111-111111111111', checkpoint: 'a'.repeat(40) }
const entity = {
  id: 'product:root', entityType: 'product', label: 'Product', lifecycle: 'accepted', properties: {},
  provenance: { producer: 'projector', checkpoint: selection.checkpoint, evidence: [] },
}
let revision = 'rev:4'
const requests = []
const port = {
  async revision(project) { assert.equal(project, selection.project); return revision },
  async query(request) { requests.push(request); return { revision: request.revision, entities: [entity], relations: [] } },
  async trace(request) { return { revision: request.revision, evidence: [] } },
  async impact(request) { return { revision: request.revision, entities: [entity], relations: [] } },
}

const snapshot = await readAdvisoryDesignKnowledge(selection, port, 20)
assert.equal(snapshot.documentRef, `design-knowledge:${encodeURIComponent(selection.project)}@rev:4`)
assert.deepEqual(snapshot.pins, [
  { source: `design-project:${selection.project}`, revision: selection.checkpoint },
  { source: `design-knowledge:${selection.project}`, revision: 'rev:4' },
])
assert.deepEqual(JSON.parse(snapshot.context), {
  schemaVersion: 2,
  project: selection.project,
  checkpoint: selection.checkpoint,
  sourceCheckpoint: selection.checkpoint,
  knowledgeRevision: 'rev:4',
  entities: [entity],
  relations: [],
  coverage: { status: 'unknown', note: 'Bounded retrieval; absence does not prove a record or relationship is missing.' },
})
assert.equal(requests[0].revision, 'rev:4')
assert.equal(requests[0].offset, 0)
const page = { offset: 0, nextOffset: 20, totalEntities: 100, totalRelations: 80 }
const partial = await readAdvisoryDesignKnowledge(selection, {
  ...port,
  async query(request) { return { revision: request.revision, entities: [entity], relations: [], page } },
}, 20)
assert.deepEqual(JSON.parse(partial.context).coverage, page)
assert.equal(advisoryKnowledgeModelContext(snapshot), snapshot.context, 'small context retains its exact bytes')
assert.equal(advisoryKnowledgeModelContext(partial), partial.context, 'bounded provider coverage is not rewritten')
const boundaryGraph = { revision: 'rev:4', entities: [{ ...entity, properties: { text: '' } }], relations: [] }
const boundaryPort = { ...port, query: async () => boundaryGraph }
const boundaryEmpty = await readAdvisoryDesignKnowledge(selection, boundaryPort, 20)
boundaryGraph.entities[0].properties.text = 'x'.repeat(ADVISORY_KNOWLEDGE_MODEL_CONTEXT_MAX_BYTES - Buffer.byteLength(boundaryEmpty.context))
const boundary = await readAdvisoryDesignKnowledge(selection, boundaryPort, 20)
assert.equal(Buffer.byteLength(boundary.context), ADVISORY_KNOWLEDGE_MODEL_CONTEXT_MAX_BYTES)
assert.equal(advisoryKnowledgeModelContext(boundary), boundary.context)
boundaryGraph.entities[0].properties.text += 'x'
const beyondBoundary = await readAdvisoryDesignKnowledge(selection, boundaryPort, 20)
assert.equal(JSON.parse(advisoryKnowledgeModelContext(beyondBoundary)).coverage.status, 'not-inlined')

for (const text of ['中'.repeat(12000), '\u0000'.repeat(6000)]) {
  const graph = { revision: 'rev:4', entities: [{ ...entity, properties: { text } }], relations: [{
    id: 'link', from: entity.id, to: entity.id, relationType: 'references', lifecycle: 'accepted',
    properties: { text }, provenance: entity.provenance,
  }], page: { offset: 0, nextOffset: null, totalEntities: 1, totalRelations: 1 } }
  const large = await readAdvisoryDesignKnowledge(selection, { ...port, query: async () => graph }, 20, {}, 'rev:4', 'b'.repeat(40))
  const originalGraph = structuredClone(large.graph), originalContext = large.context
  assert.ok(Buffer.byteLength(originalContext) > ADVISORY_KNOWLEDGE_MODEL_CONTEXT_MAX_BYTES)
  const projectedText = advisoryKnowledgeModelContext(large)
  assert.ok(Buffer.byteLength(projectedText) <= ADVISORY_KNOWLEDGE_MODEL_CONTEXT_MAX_BYTES)
  const projected = JSON.parse(projectedText)
  assert.equal(projected.checkpoint, selection.checkpoint)
  assert.equal(projected.sourceCheckpoint, 'b'.repeat(40))
  assert.equal(projected.sourceEquivalence, JSON.parse(originalContext).sourceEquivalence)
  assert.deepEqual(projected.pins, large.pins)
  assert.equal(projected.documentRef, large.documentRef)
  assert.deepEqual(projected.entities, [])
  assert.deepEqual(projected.relations, [])
  assert.equal(projected.coverage.status, 'not-inlined')
  assert.equal(projected.coverage.omittedEntities, 1)
  assert.equal(projected.coverage.omittedRelations, 1)
  assert.equal(projected.coverage.includedEntities, 0)
  assert.deepEqual(projected.sourceCoverage, graph.page, 'complete source page is separate from what the model saw')
  assert.deepEqual({ ...projected.retrieval, guidance: undefined }, { tool: 'design_query_knowledge', project: selection.project,
    checkpoint: selection.checkpoint, revision: 'rev:4', offset: 0, limit: 10, guidance: undefined })
  assert.deepEqual(large.graph, originalGraph, 'full properties and provenance are never trimmed')
  assert.equal(large.context, originalContext, 'ordinary context API stays byte-identical')
  const unknown = JSON.parse(advisoryKnowledgeModelContext({ ...large, graph: { ...large.graph, page: undefined } }))
  assert.equal(unknown.sourceCoverage.status, 'unknown')
  assert.equal(unknown.sourceCoverage.totalEntities, undefined)
}
const empty = await readAdvisoryDesignKnowledge(selection, { ...port, query: async () => ({ revision: 'rev:4', entities: [], relations: [], page: { offset: 0, nextOffset: null, totalEntities: 0, totalRelations: 0 } }) }, 20)
assert.equal(advisoryKnowledgeModelContext(empty), empty.context, 'a real empty graph is distinct from omitted records')
const excessiveMetadata = await readAdvisoryDesignKnowledge(selection, {
  ...port, query: async request => ({ revision: request.revision, entities: [], relations: [] }),
}, 20, {}, 'rev:' + 'x'.repeat(ADVISORY_KNOWLEDGE_MODEL_CONTEXT_MAX_BYTES))
assert.throws(() => advisoryKnowledgeModelContext(excessiveMetadata), /required model context metadata exceeds/)
assert.equal((await traceAdvisoryKnowledge(port, snapshot, { target: 'entity', entityId: entity.id })).revision, 'rev:4')
assert.equal((await impactAdvisoryKnowledge(port, snapshot, { entityIds: [entity.id], relationIds: [], depth: 1, limit: 20 })).revision, 'rev:4')
assert.equal(sameAdvisoryDesignKnowledge(snapshot, await readAdvisoryDesignKnowledge(selection, port, 20)), true)

revision = 'rev:5'
assert.equal(sameAdvisoryDesignKnowledge(snapshot, await readAdvisoryDesignKnowledge(selection, port, 20)), false)
assert.equal(sameAdvisoryDesignKnowledge(snapshot, await readAdvisoryDesignKnowledge({
  ...selection, checkpoint: 'b'.repeat(40),
}, port, 20)), false)

await assert.rejects(readAdvisoryDesignKnowledge(selection, {
  ...port,
  async query() { return { revision: 'rev:unexpected', entities: [], relations: [] } },
}, 20), /did not preserve the pinned revision/)

console.log('ADVISORY KNOWLEDGE OK')
