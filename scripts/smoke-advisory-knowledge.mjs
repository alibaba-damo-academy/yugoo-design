/** Keyless smoke for the shared read-only KAG snapshot used by every review loop. */
import assert from 'node:assert/strict'
import {
  impactAdvisoryKnowledge,
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
