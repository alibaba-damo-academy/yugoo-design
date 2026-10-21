import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { saveDesignKnowledgeRecords, restoreDesignKnowledgeRecords, DESIGN_KNOWLEDGE_RECORDS_PATH } = await import('../../core/src/design-knowledge-records.ts')
const { readDesignKnowledgePublication } = await import('../../core/src/design-knowledge-refresh.ts')
const { designKnowledgeProposalDigest } = await import('../../core/src/design-knowledge.ts')
const { materializeDesignKnowledgeJournal } = await import('../../core/src/design-knowledge-materializer.ts')
after(() => shutdownLadybugKnowledgeRuntime())

test('project archive replaces Ladybug cache, restores decisions, survives reopen and follows an older file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ladybug-project-archive-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projectId = '0198e58d-2fd4-7a45-b667-620f71dba9df', projectRoot = join(root, 'project')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(projectRoot)
  await writeFile(join(projectRoot, 'project.json'), JSON.stringify({ kind: 'dsh-design-project', formatVersion: 3, id: projectId, name: 'Knowledge archive', createdAt: '2026-10-19T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' } }))
  const provenance = { producer: 'grounding', checkpoint: 'cp-1', evidence: [{ source: 'design_files/research/source.md', revision: 'cp-1' }] }
  const proposal = { id: 'proposal:source', projectId, checkpoint: 'cp-1', summary: 'Retain source decision', entities: [
    { id: 'entity:source', entityType: 'claim', label: 'Original evidence', lifecycle: 'proposed', properties: {}, provenance },
    { id: 'entity:anchor', entityType: 'source', label: 'Source anchor', lifecycle: 'proposed', properties: {}, provenance },
  ], relations: [{ id: 'relation:supports', relationType: 'supports', from: 'entity:anchor', to: 'entity:source', lifecycle: 'proposed', properties: {}, provenance }] }
  const pin = expectedRevision => ({ projectId, inputCheckpoint: 'cp-1', observedCheckpoint: 'cp-1', expectedRevision })
  let provider
  const config = { databaseRoot: join(root, 'cache'), projectLockRetries: 0 }
  try {
    provider = await LadybugDesignKnowledgeProvider.open(projectId, config)
    await provider.propose(proposal, pin('rev:0'))
    await provider.applyDecision({ projectId, proposalId: proposal.id, proposalRevision: 'rev:1', proposalDigest: designKnowledgeProposalDigest(proposal), decision: 'accepted', journal: 'design_records/journal/events.json', journalRevision: 3, checkpoint: 'cp-1' }, pin('rev:1'))
    const publication = { schemaVersion: 1, key: 'inputs', edges: 'edges', checkpoint: 'cp-1', revision: 'rev:2', warnings: [] }
    const location = { projectRoot, projectId }
    await saveDesignKnowledgeRecords({ ...location, service: provider, publication })
    const original = await readFile(join(projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH))
    await assert.rejects(provider.importProject(JSON.parse(original).archive), /empty project namespace/)
    const vectorKey = 'b'.repeat(64)
    await provider.writeSemanticCache(vectorKey, 'disposable vector bytes')
    const options = () => ({ ...location, service: provider, cache: provider, resetCache: () => provider.resetCache(projectId) })
    assert.equal((await restoreDesignKnowledgeRecords(options())).restored, true)
    assert.equal(await provider.readSemanticCache(vectorKey), undefined)
    assert.equal((await readDesignKnowledgePublication(provider)).revision, await provider.revision(projectId))
    let restored = await provider.exportProject(projectId)
    assert.equal(restored.entities[0].lifecycle, 'accepted')
    assert.equal(restored.relations[0].lifecycle, 'accepted')
    assert.equal(restored.decisions[0].journalRevision, 3)
    assert.equal(restored.proposals[0].proposal.summary, proposal.summary)
    assert.ok(restored.entities[0].provenance.evidence.some(value => value.source === 'design_records/journal/events.json'))
    await provider.close(); provider = await LadybugDesignKnowledgeProvider.open(projectId, config)
    assert.equal((await restoreDesignKnowledgeRecords(options())).restored, false)
    const newer = { id: 'entity:newer', entityType: 'claim', label: 'Only in newer archive', lifecycle: 'observed', properties: {}, provenance }
    await provider.applyDelta({ mutationId: 'newer', pin: pin(await provider.revision(projectId)), upsertEntities: [newer], upsertRelations: [], removeEntities: [], removeRelations: [] })
    await saveDesignKnowledgeRecords({ ...location, service: provider, cache: provider })
    await writeFile(join(projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH), original)
    assert.equal((await restoreDesignKnowledgeRecords(options())).restored, true)
    restored = await provider.exportProject(projectId)
    assert.deepEqual(restored.entities.map(value => value.id), ['entity:anchor', 'entity:source'])
    await assert.rejects(provider.resetCache('project:wrong'), /project/)
    assert.equal((await provider.exportProject(projectId)).entities.length, 2)
    await rm(join(projectRoot, DESIGN_KNOWLEDGE_RECORDS_PATH))
    await restoreDesignKnowledgeRecords(options())
    assert.equal(await provider.revision(projectId), 'rev:0')
    assert.deepEqual((await provider.exportProject(projectId)).entities, [])
    assert.equal(await readDesignKnowledgePublication(provider), undefined)
    await provider.close(); provider = await LadybugDesignKnowledgeProvider.open(projectId, config)
    assert.equal((await restoreDesignKnowledgeRecords(options())).restored, false)
  } finally { await provider?.close() }
})

test('restored archive and original project journal replay remapped decisions without duplicates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ladybug-journal-replay-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const projectId = '0198e58d-2fd4-7a45-b667-620f71dba9df'
  const location = { projectRoot: root, projectId }, journal = 'project-journal'
  await writeFile(join(root, 'project.json'), JSON.stringify({ kind: 'dsh-design-project', formatVersion: 3, id: projectId, name: 'Journal replay', createdAt: '2026-10-19T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' } }))
  const provenance = { producer: 'grounding', checkpoint: 'cp-1', evidence: [{ source: 'design_files/research/source.md', revision: 'cp-1' }] }
  const entity = { id: 'entity:source', entityType: 'claim', label: 'Original evidence', lifecycle: 'proposed', properties: {}, provenance }
  const proposal = { id: 'proposal:source', projectId, checkpoint: 'cp-1', summary: 'Retain source decision', entities: [entity], relations: [] }
  const pin = expectedRevision => ({ projectId, inputCheckpoint: 'cp-1', observedCheckpoint: 'cp-1', expectedRevision })
  const provider = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: join(root, 'cache'), projectLockRetries: 0 })
  try {
    await provider.applyDelta({ mutationId: 'temporary-add', pin: pin('rev:0'), upsertEntities: [{ ...entity, id: 'temporary', lifecycle: 'observed' }], upsertRelations: [], removeEntities: [], removeRelations: [] })
    await provider.applyDelta({ mutationId: 'temporary-remove', pin: pin('rev:1'), upsertEntities: [], upsertRelations: [], removeEntities: ['temporary'], removeRelations: [] })
    await provider.propose(proposal, pin('rev:2'))
    const decision = { projectId, proposalId: proposal.id, proposalRevision: 'rev:3', proposalDigest: designKnowledgeProposalDigest(proposal), checkpoint: 'cp-1' }
    const records = [
      { type: 'design/knowledge-decided', revision: 7, data: { ...decision, decision: 'deferred' } },
      { type: 'design/knowledge-decided', revision: 8, data: { ...decision, decision: 'accepted' } },
    ]
    await provider.applyDecision({ ...records[0].data, journal, journalRevision: records[0].revision }, pin(await provider.revision(projectId)))
    await saveDesignKnowledgeRecords({ ...location, service: provider })
    const deferredOnlyArchive = await readFile(join(root, DESIGN_KNOWLEDGE_RECORDS_PATH))
    await provider.applyDecision({ ...records[1].data, journal, journalRevision: records[1].revision }, pin(await provider.revision(projectId)))
    await saveDesignKnowledgeRecords({ ...location, service: provider })
    const restored = await restoreDesignKnowledgeRecords({ ...location, service: provider, cache: provider, resetCache: () => provider.resetCache(projectId) })
    assert.equal(restored.report.sourceToTargetRevisions['rev:3'], 'rev:1', 'The restored proposal actually has a different cache revision')
    const before = await provider.exportProject(projectId)
    assert.equal(before.decisions[0].proposalRevision, 'rev:1')
    assert.deepEqual(await materializeDesignKnowledgeJournal(provider, projectId, journal, records), { considered: 2, committed: 0, replayed: 2, revision: before.revision })
    assert.deepEqual(await materializeDesignKnowledgeJournal(provider, projectId, journal, records), { considered: 2, committed: 0, replayed: 2, revision: before.revision })
    assert.deepEqual(await provider.exportProject(projectId), before)
    await assert.rejects(materializeDesignKnowledgeJournal(provider, projectId, journal, [{ ...records[0], data: { ...records[0].data, decision: 'accepted' } }]), /conflict|different|replay/)
    assert.deepEqual(await provider.exportProject(projectId), before, 'A conflicting journal event cannot alter the restored graph')
    // The terminal journal event can be durable while the project archive still
    // contains only the earlier deferred event; rebuild must catch it up once.
    await writeFile(join(root, DESIGN_KNOWLEDGE_RECORDS_PATH), deferredOnlyArchive)
    const pending = await restoreDesignKnowledgeRecords({ ...location, service: provider, cache: provider, resetCache: () => provider.resetCache(projectId) })
    assert.equal(pending.revision, 'rev:2')
    await assert.rejects(materializeDesignKnowledgeJournal(provider, projectId, journal, [{ ...records[1], data: { ...records[1].data, proposalId: 'missing' } }]), /immutable proposal/)
    await assert.rejects(materializeDesignKnowledgeJournal(provider, projectId, journal, [{ ...records[1], data: { ...records[1].data, proposalDigest: '0'.repeat(64) } }]), /immutable proposal/)
    assert.deepEqual(await materializeDesignKnowledgeJournal(provider, projectId, journal, records), { considered: 2, committed: 1, replayed: 1, revision: 'rev:3' })
    assert.equal(records[1].data.proposalRevision, 'rev:3', 'Original authoritative journal bytes are not rewritten')
    const caughtUp = await provider.exportProject(projectId)
    assert.equal(caughtUp.decisions.length, 2)
    assert.equal(caughtUp.decisions[1].proposalRevision, 'rev:1')
    assert.equal(caughtUp.entities[0].lifecycle, 'accepted')
    assert.deepEqual(await materializeDesignKnowledgeJournal(provider, projectId, journal, records), { considered: 2, committed: 0, replayed: 2, revision: 'rev:3' })
    assert.deepEqual(await provider.exportProject(projectId), caughtUp)
  } finally { await provider.close() }
})
