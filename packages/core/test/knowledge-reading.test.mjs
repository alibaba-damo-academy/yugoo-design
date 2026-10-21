import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { knowledgeRelationReading } = await import('../src/design-knowledge-reading.ts')
const { queryKnowledgeSnapshot, knowledgeQueryFilters, knowledgeReadResult } = await import('../src/design-knowledge-query.ts')
const { parseSchemaYaml } = await import('../src/schema.ts')
const { KNOWLEDGE_REVIEW_GUIDANCE, knowledgeReviewSchema, splitKnowledgeReviewResult } = await import('../src/design-knowledge-review.ts')
const { assertSupportedJsonSchema } = await import('@deepseek-ai/dsh-tools')
const { officialAdvisoryProfile, OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE } = await import('../src/official-advisory-profiles.ts')
const { compileDesignRelationVocabulary, resolveDesignRelation } = await import('../src/design-relation-vocabulary.ts')
const edge = (id, relationType, producer = 'grounding', extra = {}) => ({id, from:'a', to:'b', relationType, lifecycle:'proposed',
  properties:{}, provenance:{producer, checkpoint:'c', evidence:[]}, ...extra})

test('meaning, origin, direction and lifecycle stay independent without storage mutation', () => {
  for (const [producer, origin] of [['design-file-projection','file'],['grounding','agent'],['human-decision','human'],['source-analysis','unknown']]) {
    const original = edge('x','supports',producer), before = JSON.stringify(original)
    assert.deepEqual(knowledgeRelationReading(original), {...resolveDesignRelation('supports'),origin,lifecycle:'proposed'})
    assert.equal(JSON.stringify(original), before)
  }
  assert.equal(knowledgeRelationReading(edge('e','semantic-similarity','source-analysis',{properties:{projection:'embedding-v1'}})).direction,'symmetric')
  assert.equal(knowledgeRelationReading(edge('e','semantic-similarity','source-analysis',{properties:{projection:'embedding-v1'}})).origin,'embedding')
  for (const name of ['domain-specific','__proto__','constructor']) {
    const reading = knowledgeRelationReading(edge('x', name))
    assert.equal(reading.meaning, 'unknown'); assert.equal(reading.direction, 'unknown'); assert.equal(reading.classification, 'unknown')
  }
  assert.equal(knowledgeRelationReading(edge('x','contradicts')).direction,'symmetric')
})

test('Kit extensions are pinned while unknown raw types remain exact-queryable only', () => {
  const vocabulary = compileDesignRelationVocabulary(`schema_version: 1
relations:
  - type: web_app:validates
    meaning: supports
    direction: forward
    label: { zh: 验证, en: Validates }
    description: { zh: A 的证据验证 B, en: Evidence from A validates B }
`, 'web_app', '1.0')
  const resolved = knowledgeRelationReading(edge('x', 'web_app:validates'), vocabulary)
  assert.equal(resolved.classification, 'kit'); assert.equal(resolved.meaning, 'supports')
  const pinned = edge('x', 'web_app:validates', 'grounding', {properties:{relationSemantics:resolveDesignRelation('web_app:validates', vocabulary)}})
  assert.equal(knowledgeRelationReading(pinned).classification, 'kit', 'saved semantics do not depend on the currently installed Kit')
  assert.equal(knowledgeRelationReading(edge('x','web_app:validates','grounding',{properties:{relationSemantics:{...resolveDesignRelation('web_app:validates', vocabulary),direction:'symmetric'}}})).classification,'unknown', 'tampered pinned semantics degrade safely')
  const graph = {revision:'v1',entities:['a','b'].map(id=>({id,properties:{}})),relations:[edge('x','custom-unregistered')]}
  assert.equal(queryKnowledgeSnapshot(graph,{projectId:'p',limit:10,relationTypes:['custom-unregistered']}).relations.length,1)
  assert.equal(queryKnowledgeSnapshot(graph,{projectId:'p',limit:10,relationMeanings:['custom-unregistered']}).relations.length,0)
  assert.equal(queryKnowledgeSnapshot(graph,{projectId:'p',limit:10,relationMeanings:['unknown']}).relations.length,1)
})

test('independent filters run before paging; symmetric meaning does not alter storage direction', () => {
  const graph = {revision:'v1',entities:['a','b'].map(id=>({id, properties:{}})),
    relations:[edge('r0','contains','design-file-projection'),edge('r1','supports'),edge('r2','supports','human-decision'),edge('r3','supports'),edge('r4','similar')]}
  const query = opts => queryKnowledgeSnapshot(graph,{projectId:'p',limit:1,offset:0,...opts})
  const first = query({relationMeanings:['supports'],relationOrigins:['agent']})
  assert.equal(first.page.totalRelations,2); assert.equal(first.relations[0].id,'r1')
  assert.equal(query({relationMeanings:['supports'],relationOrigins:['agent'],offset:1,revision:'v1'}).relations[0].id,'r3')
  assert.equal(query({relationMeanings:['similar'],incidentTo:['b'],direction:'outgoing'}).page.totalRelations,0)
  assert.equal(query({relationMeanings:['similar'],incidentTo:['b'],direction:'both'}).relations[0].id,'r4')
  for (const relationMeanings of [[],['unrecognized']]) assert.equal(query({relationMeanings}).page.totalRelations,0)
  assert.equal(query({relationOrigins:[]}).page.totalRelations,0)
  assert.equal(query({relationTypes:['supports'],relationMeanings:['similar']}).page.totalRelations,0)
  for (const field of ['relationMeanings','relationOrigins']) {
    assert.throws(()=>knowledgeQueryFilters({[field]:'bad'}),/Invalid/)
    assert.deepEqual(knowledgeQueryFilters({[field]:[]}),{[field]:[]})
  }
  const read = knowledgeReadResult('p','c',first)
  assert.equal(read.relations[0].reading.origin,'agent')
  assert.equal(graph.relations[1].reading,undefined)
})

test('ontology filters select generated type, record kind and identity quality independently', () => {
  const entities = [
    { id: 'stable', entityType: 'design-record', lifecycle: 'observed', properties: { ontologyType: 'kit/tasks#/properties/tasks/value', recordKind: 'design-record', identityQuality: 'stable' }, provenance: { producer: 'design-file-projection', checkpoint: 'c', evidence: [] } },
    { id: 'anonymous', entityType: 'design-content', lifecycle: 'observed', properties: { ontologyType: 'kit/tasks#/properties/notes/items', recordKind: 'design-content', identityQuality: 'anonymous' }, provenance: { producer: 'design-file-projection', checkpoint: 'c', evidence: [] } },
  ]
  const graph = { revision: 'v1', entities, relations: [] }
  assert.deepEqual(queryKnowledgeSnapshot(graph, { projectId: 'p', limit: 10, ontologyTypes: ['kit/tasks#/properties/tasks/value'] }).entities.map(node => node.id), ['stable'])
  assert.deepEqual(queryKnowledgeSnapshot(graph, { projectId: 'p', limit: 10, recordKinds: ['design-content'], identityQualities: ['anonymous'] }).entities.map(node => node.id), ['anonymous'])
  assert.throws(() => knowledgeQueryFilters({ recordKinds: ['invalid'] }), /recordKinds/)
  assert.throws(() => knowledgeQueryFilters({ identityQualities: ['invented'] }), /identityQualities/)
})

test('Kit schema does not introduce designRoles as a supported concept', () => {
  assert.throws(() => parseSchemaYaml('type: object\ndesignRoles: [custom]'), /unsupported schema key/)
})

test('shared GRA guidance defines evidence-bound vocabulary without changing proposed authority', () => {
  assert.match(KNOWLEDGE_REVIEW_GUIDANCE,/realizes/)
  assert.match(KNOWLEDGE_REVIEW_GUIDANCE,/unknown:related-context/)
  assert.doesNotMatch(KNOWLEDGE_REVIEW_GUIDANCE,/Core vocabulary: contains/)
  assert.match(KNOWLEDGE_REVIEW_GUIDANCE,/remain proposed/)
  assert.match(KNOWLEDGE_REVIEW_GUIDANCE,/BOTH endpoints/)
  const schema = knowledgeReviewSchema({ type: 'object', properties: {} })
  assert.doesNotThrow(() => assertSupportedJsonSchema(schema), 'GRA extensions must reach the real host structured-capture boundary')
  for (const id of [OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE]) {
    const extended = knowledgeReviewSchema(officialAdvisoryProfile(id).outputSchema)
    assert.doesNotThrow(() => assertSupportedJsonSchema(extended), `${id}: complete output schema is supported`)
    const prior = structuredClone(extended)
    prior.properties.knowledgeRelations.maxItems = 32
    prior.properties.knowledgeRelations.items.properties.relationType.pattern = '^[a-z][a-z0-9._:-]{0,79}$'
    assert.throws(() => assertSupportedJsonSchema(prior), /unsupported JSON schema/, 'the original failing constraints still fail at the host boundary')
  }
  const relationType = schema.properties.knowledgeRelations.items.properties.relationType
  assert.match(relationType.description,/symmetric/)
  assert.match(relationType.description, /\^\[a-z\]/)
  const evidence = [0, 1].map(i => ({ source: 'saved.json', locator: `/fields/${i}`, quote: 'saved evidence' }))
  const relation = { from: 'a', to: 'b', relationType: 'supports', summary: 'Both saved fields support the relation.', evidence }
  assert.equal(splitKnowledgeReviewResult({ knowledgeRelations: [relation] }).observations.length, 1)
  assert.throws(() => splitKnowledgeReviewResult({ knowledgeRelations: Array(33).fill(relation) }), /Invalid Knowledge review observations/)
  for (const count of [1, 17]) {
    assert.throws(() => splitKnowledgeReviewResult({ knowledgeRelations: [{ ...relation, evidence: Array(count).fill(evidence[0]) }] }), /Invalid Knowledge relationship/)
    assert.throws(() => splitKnowledgeReviewResult({ knowledgeRetractions: [{ relationId: 'r', reason: 'saved correction', evidence: Array(count).fill(evidence[0]) }] }), /Invalid Knowledge relationship/)
  }
  assert.throws(() => splitKnowledgeReviewResult({ knowledgeRelations: [{ ...relation, relationType: 'INVALID TYPE' }] }), /Invalid Knowledge relation type/)
  assert.throws(() => splitKnowledgeReviewResult({ knowledgeRetractions: Array(33).fill({ relationId: 'r', reason: 'saved correction', evidence }) }), /Invalid Knowledge retractions/)
})

// Synthetic projections exercise the shared reading boundary, not an installed
// Kit, a real model handoff or permission to implement inferred requirements.
for (const fixture of [
  { kit: 'web_app', source: 'design_files/function_modules/function_modules.json', locator: '/modules/reservations/functions/create' },
  { kit: 'lab_workflow', source: 'design_files/protocols/protocols.json', locator: '/protocols/sample-intake/actions/register' },
]) {
  test(`${fixture.kit}: task-scoped handoff reads preserve source pins and proposed authority`, () => {
    const evidence = [{ source: fixture.source, revision: 'published-checkpoint', locator: fixture.locator }]
    const provenance = { producer: 'design-file-projection', checkpoint: 'published-checkpoint', evidence }
    const entities = ['task', 'constraint'].map(id => ({ id, entityType: `${fixture.kit}:record`, label: id,
      lifecycle: 'observed', properties: { recordKind: 'design-record', identityQuality: 'stable' }, provenance }))
    const relations = [
      edge('file-link', 'references', 'design-file-projection', { from: 'task', to: 'constraint', lifecycle: 'observed', provenance }),
      edge('suggestion', 'supports', 'grounding', { from: 'task', to: 'constraint', provenance: { ...provenance, producer: 'grounding' } }),
      edge('similarity', 'semantic-similarity', 'source-analysis', { from: 'task', to: 'constraint',
        properties: { projection: 'embedding-v1' }, provenance: { ...provenance, producer: 'source-analysis' } }),
    ]
    const graph = { revision: 'graph-revision', entities, relations }
    const original = JSON.stringify(graph)
    const filters = knowledgeQueryFilters({ sourceFiles: [fixture.source], incidentTo: ['task'],
      direction: 'both', offset: 0, revision: 'graph-revision', limit: 10 })
    const result = knowledgeReadResult('selected-project', 'published-checkpoint',
      queryKnowledgeSnapshot(graph, { projectId: 'selected-project', revision: 'graph-revision', limit: 10, ...filters }))
    assert.equal(result.project, 'selected-project')
    assert.equal(result.checkpoint, 'published-checkpoint')
    assert.equal(result.revision, 'graph-revision')
    assert.equal(result.evidence.sourceReadRequired, true)
    assert.deepEqual(result.entities.map(node => node.provenance.evidence), [evidence, evidence])
    assert.deepEqual(result.relations.map(link => [link.id, link.reading.origin, link.lifecycle]),
      [['file-link', 'file', 'observed'], ['suggestion', 'agent', 'proposed'], ['similarity', 'embedding', 'proposed']])
    assert.equal(result.page.nextOffset, null)
    assert.equal(JSON.stringify(graph), original, 'Reading cannot promote decisions or alter source evidence')
    assert.throws(() => queryKnowledgeSnapshot(graph, { projectId: 'selected-project', revision: 'other-revision', limit: 10 }), /revision mismatch/)
    assert.deepEqual(queryKnowledgeSnapshot(graph, { projectId: 'selected-project', limit: 10,
      sourceFiles: ['design_files/unrelated/state.json'] }).entities, [])
  })
}
