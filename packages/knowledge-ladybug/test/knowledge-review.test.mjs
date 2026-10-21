import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { LadybugDesignKnowledgeProvider, shutdownLadybugKnowledgeRuntime } = await import('../src/provider.ts')
const { materializeDesignFilesKnowledge } = await import('../../core/src/design-knowledge-projection.ts')
const { readCompleteDesignKnowledge } = await import('../../core/src/design-knowledge-snapshot.ts')
const { publishKnowledgeReview, splitKnowledgeReviewResult } = await import('../../core/src/design-knowledge-review.ts')
const { compileDesignOntologyContract } = await import('../../core/src/design-ontology.ts')
const { compileDesignRelationVocabulary } = await import('../../core/src/design-relation-vocabulary.ts')
const { designKnowledgeProposalDigest } = await import('../../core/src/design-knowledge.ts')
after(() => shutdownLadybugKnowledgeRuntime())

test('stable endpoints can cross the human authority transition but anonymous evidence endpoints cannot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-anonymous-authority-'))
  let service
  try {
    const projectId = 'anonymous-authority', checkpoint = 'c1'
    service = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
    const provenance = { producer: 'design-file-projection', checkpoint, evidence: [{ source: 'notes/notes.json', revision: checkpoint }] }
    const entity = (id, identityQuality) => ({ id, entityType: 'design-content', label: id, lifecycle: 'observed',
      properties: { identityQuality }, provenance })
    await service.applyDelta({ mutationId: 'seed-anonymous-authority', pin: { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: 'rev:0' },
      upsertEntities: [entity('stable', 'stable'), entity('anonymous', 'anonymous')], upsertRelations: [], removeEntities: [], removeRelations: [] })
    const proposal = { id: 'proposal:anonymous-authority', projectId, checkpoint, summary: 'Link anonymous evidence.', entities: [],
      relations: [{ id: 'relation:anonymous-authority', relationType: 'supports', from: 'anonymous', to: 'stable', lifecycle: 'proposed', properties: {},
        provenance: { producer: 'grounding', checkpoint, evidence: provenance.evidence } }] }
    await service.propose(proposal, { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: 'rev:1' })
    const base = { projectId, proposalId: proposal.id, proposalRevision: 'rev:2', proposalDigest: designKnowledgeProposalDigest(proposal),
      journal: 'journal:human', checkpoint }
    for (const [decision, journalRevision] of [['accepted', 1], ['rejected', 2]]) {
      await assert.rejects(service.applyDecision({ ...base, decision, journalRevision },
        { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: 'rev:2' }), /cannot use anonymous endpoint/)
    }
    assert.equal(await service.revision(projectId), 'rev:2')
    const stableProposal = { ...proposal, id: 'proposal:stable-authority', summary: 'Link stable evidence.',
      relations: [{ ...proposal.relations[0], id: 'relation:stable-authority', from: 'stable', to: 'stable-2' }] }
    await service.applyDelta({ mutationId: 'seed-second-stable', pin: { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: 'rev:2' },
      upsertEntities: [entity('stable-2', 'stable')], upsertRelations: [], removeEntities: [], removeRelations: [] })
    await service.propose(stableProposal, { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: 'rev:3' })
    const stableDecision = { projectId, proposalId: stableProposal.id, proposalRevision: 'rev:4', proposalDigest: designKnowledgeProposalDigest(stableProposal),
      decision: 'accepted', journal: 'journal:human', journalRevision: 3, checkpoint }
    await service.applyDecision(stableDecision, { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: 'rev:4' })
    assert.equal((await service.query({ projectId, relationIds: ['relation:stable-authority'], limit: 1 })).relations[0].lifecycle, 'accepted')
  } finally {
    await service?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

for (const auxiliaryHead of [false, true]) test(`GRA ${auxiliaryHead ? 'after auxiliary Git records' : 'at the source checkpoint'} maintains only existing endpoints with source evidence`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-review-'))
  let service
  try {
    service = await LadybugDesignKnowledgeProvider.open('review', { databaseRoot: directory })
    let checkpoint = 'c1', caption = '论文需要实验结果'
    const store = { head: async () => checkpoint, listPathsAt: async () => ['a/a.json', 'b/b.json'],
      readTextAt: async (_revision, file) => JSON.stringify({ records: { item: { caption: file === 'a/a.json' ? caption : '实验输出测量结果' } } }) }
    await materializeDesignFilesKnowledge({ service, projectId: 'review', store })
    const reviewed = await readCompleteDesignKnowledge(service, { projectId: 'review', limit: 100 })
    const [a,b] = ['a/a.json','b/b.json'].map(file => reviewed.entities.find(n => n.properties.file === file && n.entityType === 'design-record'))
    const observation = { from: a.id, to: b.id, relationType: 'uses-result', summary: '写作消费实验结果', evidence: [
      { source: 'a/a.json', locator: '/records/item/caption', quote: caption },
      { source: 'b/b.json', locator: '/records/item/caption', quote: '实验输出测量结果' },
    ] }
    const options = { service, projectId: 'review', checkpoint: auxiliaryHead ? 'c1-archive' : checkpoint,
      ...(auxiliaryHead ? { sourceCheckpoint: checkpoint } : {}), reviewed, producer: 'grounding', observations: [observation] }
    if (auxiliaryHead) {
      await assert.rejects(publishKnowledgeReview({ ...options, sourceCheckpoint: undefined }), /stale/, 'An auxiliary review pin is not a projection source pin')
      await assert.rejects(publishKnowledgeReview({ ...options, sourceCheckpoint: 'foreign-source' }), /stale/)
    }
    const published = await publishKnowledgeReview(options)
    assert.equal(published.changed, true)
    assert.equal((await publishKnowledgeReview(options)).changed, false)
    assert.equal((await publishKnowledgeReview({ ...options, reviewed: { ...reviewed, entities: [] } })).changed, false, 'Queried endpoints outside the initial context resolve at the reviewed revision')
    await assert.rejects(publishKnowledgeReview({ ...options, reviewed: { revision: 'rev:0', entities: [], relations: [] } }), /missing|stale/, 'A node created after the reviewed revision cannot be backfilled from the latest graph')
    assert.equal((await publishKnowledgeReview({ ...options, observations: [] })).revision, published.revision)
    const graph = await readCompleteDesignKnowledge(service, { projectId: 'review', limit: 100 })
    assert.equal(graph.entities.length, reviewed.entities.length)
    assert.ok(graph.relations.some(r => r.relationType === 'uses-result' && r.lifecycle === 'proposed'))
    for (const bad of [
      { ...observation, from: 'invented-node' },
      { ...observation, evidence: observation.evidence.map(e => ({ ...e, quote: '模型编造的事实' })) },
      { ...observation, evidence: [observation.evidence[0], observation.evidence[0]] },
    ]) await assert.rejects(publishKnowledgeReview({ ...options, observations: [bad] }))
    await assert.rejects(publishKnowledgeReview({ ...options, producer: 'clarity' }), /cannot maintain/)
    assert.equal(await service.revision('review'), published.revision)
    const relation = graph.relations.find(r=>r.relationType==='uses-result')
    assert.equal(relation.provenance.checkpoint, options.checkpoint, 'Relation history records this review, not the older projection pin')
    assert.ok(relation.provenance.evidence.every(e=>e.revision===options.checkpoint))
    assert.ok(graph.entities.every(n=>n.provenance.checkpoint===checkpoint), 'Publishing does not rewrite source provenance')
    const retraction = {relationId:relation.id,reason:'原引用仅表达关联，不足以支持依赖解释',evidence:observation.evidence}
    const retractOptions = {...options,checkpoint:auxiliaryHead ? 'c1-another-archive' : checkpoint,reviewed:graph,observations:[],retractions:[retraction]}
    if (auxiliaryHead) await assert.rejects(publishKnowledgeReview({...retractOptions,sourceCheckpoint:undefined}),/cite/)
    await assert.rejects(publishKnowledgeReview({...retractOptions,producer:'alignment'}),/ownership/)
    await assert.rejects(publishKnowledgeReview({...retractOptions,retractions:[{...retraction,evidence:retraction.evidence.map(e=>({...e,quote:'编造理由'}))}]}),/cite/)
    const withdrawn = await publishKnowledgeReview(retractOptions)
    assert.equal(withdrawn.changed,true)
    const afterWithdrawal = await readCompleteDesignKnowledge(service,{projectId:'review',limit:100})
    assert.ok(!afterWithdrawal.relations.some(r=>r.id===relation.id))
    assert.ok(afterWithdrawal.entities.some(n=>n.entityType==='design-review-event' && n.properties.reason===retraction.reason))
    assert.equal(afterWithdrawal.entities.find(n=>n.entityType==='design-review-event').provenance.checkpoint, retractOptions.checkpoint)
    assert.ok((await service.query({projectId:'review',revision:graph.revision,relationIds:[relation.id],entityIds:[],limit:1})).relations.length,'withdrawn relation remains in pinned history')
    await assert.rejects(publishKnowledgeReview(retractOptions),/mismatch/,'a completed retraction cannot remove a different future relationship')
    checkpoint = 'c2'; caption = '论文不需要实验结果'
    await materializeDesignFilesKnowledge({ service, projectId: 'review', store })
    await assert.rejects(publishKnowledgeReview({ ...options, checkpoint }), /stale/)
    assert.deepEqual(splitKnowledgeReviewResult({ schemaVersion: 1, inconsistencies: [] }), { advisory: { schemaVersion: 1, inconsistencies: [] }, observations: [] })
  } finally {
    await service?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('GRA Kit relations enforce compiled ontology endpoint constraints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kag-review-ontology-'))
  let service
  try {
    const projectId = 'review-ontology', checkpoint = 'c1'
    service = await LadybugDesignKnowledgeProvider.open(projectId, { databaseRoot: directory })
    const sourceFile = 'source/source.json', targetFile = 'target/target.json'
    const recordSchema = title => ({ type: 'object', properties: { [title]: { type: 'map', value: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } } } })
    const schemas = { [sourceFile]: recordSchema('sources'), [targetFile]: recordSchema('targets') }
    const relationVocabulary = compileDesignRelationVocabulary(`schema_version: 1
relations:
  - type: fixture:validates
    meaning: supports
    direction: forward
    label: { zh: 验证, en: Validates }
    description: { zh: 来源验证目标, en: Source validates target }
    domain: [fixture/source#/properties/sources/value]
    range: [fixture/target#/properties/targets/value]
`, 'fixture', '1.0')
    const ontology = compileDesignOntologyContract({ kit: 'fixture', kitVersion: '1.0', schemas, relationVocabulary })
    const values = { [sourceFile]: { sources: { a: { title: '来源证据' } } }, [targetFile]: { targets: { b: { title: '目标结论' } } } }
    const store = { head: async () => checkpoint, listPathsAt: async () => Object.keys(values), readTextAt: async (_revision, file) => JSON.stringify(values[file]) }
    await materializeDesignFilesKnowledge({ service, projectId, store, schemas, ontology })
    const reviewed = await readCompleteDesignKnowledge(service, { projectId, limit: 100 })
    const source = reviewed.entities.find(node => node.properties.file === sourceFile && node.properties.pointer === '/sources/a')
    const target = reviewed.entities.find(node => node.properties.file === targetFile && node.properties.pointer === '/targets/b')
    const evidence = [
      { source: sourceFile, locator: '/sources/a/title', quote: '来源证据' },
      { source: targetFile, locator: '/targets/b/title', quote: '目标结论' },
    ]
    const publish = (from, to) => publishKnowledgeReview({ service, projectId, checkpoint, reviewed, producer: 'grounding', relationVocabulary,
      observations: [{ from, to, relationType: 'fixture:validates', summary: '来源验证目标', evidence }] })
    await assert.rejects(publish(target.id, source.id), /outside declared domain/)
    assert.equal((await publish(source.id, target.id)).changed, true)
  } finally {
    await service?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
