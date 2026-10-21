import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { designKnowledgeProposalDigest } from 'dsh-design-core'
import { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } from '../lib/index.js'

const sourceRoot = await mkdtemp(join(tmpdir(), 'ladybug-full-source-'))
const targetRoot = await mkdtemp(join(tmpdir(), 'ladybug-full-target-'))
const invalidRoot = await mkdtemp(join(tmpdir(), 'ladybug-full-invalid-'))
const projectId = 'project:full-service'
const config = (databaseRoot) => ({ databaseRoot, writerAttempts: 8, writerRetryMs: 1, projectLockRetries: 0, projectLockMinTimeoutMs: 1, projectLockStaleMs: 2_000, maxQueryLimit: 20, maxFilterValues: 4, maxTextBytes: 128, maxImpactDepth: 2, maxImpactSeeds: 4, maxArchiveRecords: 20 })
const provenance = { producer: 'grounding', checkpoint: 'cp-1', evidence: [{ source: 'design:test', revision: 'cp-1' }] }
const proposedEntity = (id) => ({ id, entityType: 'claim', label: id, lifecycle: 'proposed', properties: { id }, provenance })
const proposedRelation = (id, from, to) => ({ id, relationType: 'supports', from, to, lifecycle: 'proposed', properties: {}, provenance })
const pin = (expectedRevision) => ({ projectId, inputCheckpoint: 'cp-1', observedCheckpoint: 'cp-1', expectedRevision })
const proposal = {
  id: 'proposal:one', projectId, checkpoint: 'cp-1', summary: 'Retain two related claims.',
  entities: [proposedEntity('entity:p1'), proposedEntity('entity:p2')],
  relations: [proposedRelation('relation:p1-p2', 'entity:p1', 'entity:p2')],
}
const proposalDigest = designKnowledgeProposalDigest(proposal)
const decision = (disposition, journalRevision, proposalRevision = 'rev:3') => ({ projectId, proposalId: proposal.id, proposalRevision, proposalDigest, decision: disposition, journal: 'journal:human', journalRevision, checkpoint: 'cp-1' })

let source
let target
let invalid
try {
  source = await LadybugDesignKnowledgeProvider.open(projectId, config(sourceRoot))
  await source.applyDelta({ mutationId: 'mutation:temporary-add', pin: pin('rev:0'), upsertEntities: [{ ...proposedEntity('entity:temporary'), lifecycle: 'observed' }], upsertRelations: [], removeRelations: [], removeEntities: [] })
  await source.applyDelta({ mutationId: 'mutation:temporary-remove', pin: pin('rev:1'), upsertEntities: [], upsertRelations: [], removeRelations: [], removeEntities: ['entity:temporary'] })

  const observedProposal = { ...proposal, id: 'proposal:observed-invalid', entities: [{ ...proposal.entities[0], lifecycle: 'observed' }], relations: [] }
  await assert.rejects(source.propose(observedProposal, pin('rev:2')), /proposal entity is not proposed/u)
  assert.equal(await source.revision(projectId), 'rev:2')
  await assert.rejects(source.propose(proposal, pin('rev:1')), /expected revision/u)
  assert.equal(await source.revision(projectId), 'rev:2')
  assert.deepEqual(await source.propose(proposal, pin('rev:2')), { revision: 'rev:3', replayed: false })
  assert.deepEqual(await source.propose(proposal, pin('rev:2')), { revision: 'rev:3', replayed: true })
  await assert.rejects(source.propose(proposal, pin('rev:3')), /replayed with different content/u)
  assert.deepEqual((await source.query({ projectId, lifecycles: ['proposed'], limit: 20 })).entities.map((value) => value.id), ['entity:p1', 'entity:p2'])

  const deferred = decision('deferred', 7)
  await assert.rejects(source.applyDecision({ ...deferred, proposalRevision: 'rev:2' }, pin('rev:3')), /does not bind/u)
  assert.equal(await source.revision(projectId), 'rev:3')
  assert.deepEqual(await source.applyDecision(deferred, pin('rev:3')), { revision: 'rev:4', replayed: false })
  const derivedName = (await readdir(sourceRoot)).find(name => name.endsWith('.lbdb.visible-v1.gz'))
  assert.ok(derivedName, 'a deferred decision retains a derived visible snapshot')
  assert.equal(JSON.parse(gunzipSync(await readFile(join(sourceRoot, derivedName))).toString('utf8')).revision, 4,
    'a no-fact decision advances the derived snapshot without a historical rescan')
  assert.deepEqual(await source.applyDecision(deferred, pin('rev:3')), { revision: 'rev:4', replayed: true })
  assert.deepEqual((await source.query({ projectId, lifecycles: ['proposed'], limit: 20 })).entities.map((value) => value.id), ['entity:p1', 'entity:p2'])

  const accepted = decision('accepted', 8)
  assert.deepEqual(await source.applyDecision(accepted, pin('rev:4')), { revision: 'rev:5', replayed: false })
  assert.deepEqual(await source.applyDecision(accepted, pin('rev:4')), { revision: 'rev:5', replayed: true })
  await assert.rejects(source.applyDecision(decision('rejected', 9), pin('rev:5')), /terminal decision/u)
  assert.equal(await source.revision(projectId), 'rev:5')
  assert.deepEqual((await source.query({ projectId, lifecycles: ['accepted'], limit: 20 })).entities.map((value) => value.id), ['entity:p1', 'entity:p2'])

  const trace = await source.trace({ projectId, target: 'entity', entityId: 'entity:p1' })
  assert.equal(trace.revision, 'rev:5')
  assert.ok(trace.evidence.some((value) => value.source === 'journal:human' && value.revision === '8'))
  const impact = await source.impact({ projectId, entityIds: ['entity:p1'], relationIds: [], depth: 1, limit: 20 })
  assert.deepEqual(impact.entities.map((value) => value.id), ['entity:p1', 'entity:p2'])
  assert.deepEqual(impact.relations.map((value) => value.id), ['relation:p1-p2'])
  await assert.rejects(source.impact({ projectId, entityIds: [], relationIds: [], depth: 3, limit: 1 }), /impact depth/u)

  const proposalBatch = {
    mutationId: 'mutation:proposal-batch',
    pin: pin('rev:5'),
    proposals: [
      { ...proposal, id: 'proposal:batch-a', summary: 'Batch A', entities: [proposedEntity('entity:batch-a')], relations: [] },
      { ...proposal, id: 'proposal:batch-b', summary: 'Batch B', entities: [proposedEntity('entity:batch-b')], relations: [] },
    ],
  }
  const batchResult = await source.proposeBatch(proposalBatch)
  assert.equal(batchResult.revision, 'rev:6')
  assert.equal(batchResult.replayed, false)
  assert.deepEqual(batchResult.receipts.map((value) => value.proposalRevision), ['rev:6', 'rev:6'])
  assert.deepEqual(await source.proposeBatch(proposalBatch), { ...batchResult, replayed: true })
  await assert.rejects(source.proposeBatch({ ...proposalBatch, proposals: [{ ...proposalBatch.proposals[0], summary: 'changed' }, proposalBatch.proposals[1]] }), /different content/u)
  assert.equal(await source.revision(projectId), 'rev:6')
  await assert.rejects(source.proposeBatch({
    mutationId: 'mutation:proposal-batch-invalid',
    pin: pin('rev:6'),
    proposals: [
      { ...proposalBatch.proposals[0], id: 'proposal:invalid-a', entities: [proposedEntity('entity:duplicate')] },
      { ...proposalBatch.proposals[1], id: 'proposal:invalid-b', entities: [proposedEntity('entity:duplicate')] },
    ],
  }), /duplicate proposal entity/u)
  assert.equal(await source.revision(projectId), 'rev:6')

  const historical = await source.exportProject(projectId, 'rev:4')
  assert.deepEqual(historical.entities.map((value) => value.lifecycle), ['proposed', 'proposed'])
  assert.deepEqual(historical.decisions.map((value) => value.decision), ['deferred'])
  const archive = await source.exportProject(projectId)
  assert.equal(archive.revision, 'rev:6')
  assert.deepEqual(archive.entities.map((value) => value.lifecycle), ['proposed', 'proposed', 'accepted', 'accepted'])
  await source.close(); source = undefined

  invalid = await LadybugDesignKnowledgeProvider.open(projectId, config(invalidRoot))
  const badDigest = { ...archive, proposals: [{ ...archive.proposals[0], proposalDigest: '0'.repeat(64) }] }
  await assert.rejects(invalid.importProject(badDigest), /proposal digest/u)
  const badEndpoint = { ...archive, relations: [{ ...archive.relations[0], to: 'entity:absent' }] }
  await assert.rejects(invalid.importProject(badEndpoint), /absent endpoint/u)
  const badDecision = { ...archive, decisions: [{ ...archive.decisions[0], proposalId: 'proposal:absent' }] }
  await assert.rejects(invalid.importProject(badDecision), /does not bind/u)
  const badLifecycle = { ...archive, entities: archive.entities.map((value) => value.id === 'entity:p1' ? { ...value, lifecycle: 'proposed' } : value) }
  await assert.rejects(invalid.importProject(badLifecycle), /terminal entity lifecycle/u)
  assert.equal(await invalid.revision(projectId), 'rev:0')
  await invalid.close(); invalid = undefined

  target = await LadybugDesignKnowledgeProvider.open(projectId, config(targetRoot))
  const report = await target.importProject(archive)
  assert.equal(report.revision, 'rev:4')
  assert.deepEqual(report.sourceToTargetRevisions, { 'rev:3': 'rev:1', 'rev:6': 'rev:2' })
  assert.deepEqual((await target.query({ projectId, lifecycles: ['accepted'], limit: 20 })).entities.map((value) => value.id), ['entity:p1', 'entity:p2'])
  const importedArchive = await target.exportProject(projectId)
  assert.equal(importedArchive.proposals[0].proposalRevision, 'rev:1')
  assert.ok(importedArchive.decisions.every((value) => value.proposalRevision === 'rev:1'))
  await assert.rejects(target.importProject(archive), /empty project namespace/u)
  assert.equal(await target.revision(projectId), 'rev:4')

  await target.close(); target = undefined
  target = await LadybugDesignKnowledgeProvider.open(projectId, config(targetRoot))
  assert.equal(await target.revision(projectId), 'rev:4')
  assert.deepEqual((await target.query({ projectId, limit: 20 })).relations.map((value) => value.id), ['relation:p1-p2'])
  console.log('LADYBUG FULL DESIGN KNOWLEDGE SERVICE GATE OK')
} finally {
  await source?.close().catch(() => {})
  await target?.close().catch(() => {})
  await invalid?.close().catch(() => {})
  await shutdownLadybugKnowledgeRuntime()
  await Promise.all([sourceRoot, targetRoot, invalidRoot].map((path) => rm(path, { recursive: true, force: true })))
}
