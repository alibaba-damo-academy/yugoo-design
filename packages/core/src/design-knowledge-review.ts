/** Optional evidence-backed graph observations from existing G/R/A reviews. */
import { isRecord } from './design-graph-content.ts'
import { semanticDigest } from './design-semantic.ts'
import { readCompleteDesignKnowledge } from './design-knowledge-snapshot.ts'
import { DesignKnowledgeEntityId, DesignKnowledgeRelationId, DesignKnowledgeMutationId,
  type DesignKnowledgeService, type DesignKnowledgeQueryResult, type DesignKnowledgeDeltaRelation, type DesignKnowledgeDeltaEntity } from './design-knowledge.ts'
import type { DesignProjectId } from './design-project.ts'
import { DESIGN_RELATION_TYPE_PATTERN, designRelationEndpointIssue, renderDesignRelationVocabulary, resolveDesignRelation, type CompiledDesignRelationVocabulary } from './design-relation-vocabulary.ts'

const KNOWLEDGE_REVIEW_BOUNDARIES = 'You may additionally return knowledgeRelations for relationships directly supported by the supplied stored Design KAG and published Design Files. Use exact existing endpoint IDs and quote saved field evidence for BOTH endpoints. Similarity is only a candidate, not causation/dependency. Do not create facts from unanswered questions, recommendations, external claims not yet researched or your own prior findings. Return an empty list when no justified relationship is available; empty output does not clear existing relationships. Clarity does not maintain graph relationships. Evidence-backed corrections may use knowledgeRetractions with exact relationId, reason and quotes for BOTH current endpoints, only for this same profile\'s own proposed review-v1 relations. Retraction is not inferred from empty results. A not-found conclusion is limited to this review scope/checkpoint, never a permanent missing-design edge; new source content requires reassessment.'
/** Direction is from -> to unless explicitly symmetric; provenance is independent. */
export const KNOWLEDGE_RELATION_VOCABULARY = renderDesignRelationVocabulary()
export function knowledgeReviewGuidance(vocabulary?: CompiledDesignRelationVocabulary): string {
  return KNOWLEDGE_REVIEW_BOUNDARIES + '\n' + renderDesignRelationVocabulary(vocabulary)
    + '\nBoth endpoint quotes must justify the asserted relationship, not merely mention the endpoints. Explain that reasoning in summary. Agent observations remain proposed, not user-accepted facts. Isolated nodes are not by themselves design defects. Do not impose mandatory node roles or ordered layers.'
}
export const KNOWLEDGE_REVIEW_GUIDANCE = knowledgeReviewGuidance()
const text = { type: 'string' }
export function knowledgeReviewSchema(schema: Readonly<Record<string, unknown>>, vocabulary?: CompiledDesignRelationVocabulary) {
  // The host structured-capture subset supports shapes, not length/pattern
  // keywords. Keep those constraints authoritative in splitKnowledgeReviewResult.
  return { ...schema, properties: { ...(schema.properties as object), knowledgeRelations: { type: 'array', description: 'At most 32 evidence-backed relationships.',
    items: { type: 'object', additionalProperties: false, required: ['from', 'to', 'relationType', 'summary', 'evidence'], properties: {
      from: text, to: text, relationType: { ...text, description: `Must match ${DESIGN_RELATION_TYPE_PATTERN}.\n${renderDesignRelationVocabulary(vocabulary)}` }, summary: text,
      evidence: { type: 'array', description: 'Between 2 and 16 saved field quotes, covering both endpoints.', items: { type: 'object', additionalProperties: false,
        required: ['source', 'locator', 'quote'], properties: { source: text, locator: text, quote: text } } },
    } } }, knowledgeRetractions: { type:'array', description:'At most 32 evidence-backed retractions.', items:{type:'object',additionalProperties:false,
      required:['relationId','reason','evidence'], properties:{relationId:text,reason:text,evidence:{type:'array',description:'Between 2 and 16 saved field quotes, covering both endpoints.',
        items:{type:'object',additionalProperties:false,required:['source','locator','quote'],properties:{source:text,locator:text,quote:text}}}}} } } }
}
export interface KnowledgeReviewRetraction { relationId:string; reason:string; evidence:KnowledgeReviewObservation['evidence'] }
export interface KnowledgeReviewObservation {
  from: string; to: string; relationType: string; summary: string
  evidence: { source: string; locator: string; quote: string }[]
}
export function splitKnowledgeReviewResult(value: unknown): {advisory:Record<string,unknown>;observations:KnowledgeReviewObservation[];retractions?:KnowledgeReviewRetraction[]} {
  if (!isRecord(value)) throw new Error('Review result must be an object')
  if (Buffer.byteLength(JSON.stringify(value)) > 262_144) throw new Error('Knowledge review result exceeds output limit')
  const { knowledgeRelations = [], knowledgeRetractions, ...advisory } = value
  if (!Array.isArray(knowledgeRelations) || knowledgeRelations.length > 32) throw new Error('Invalid Knowledge review observations')
  const requireText = (value: unknown, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid Knowledge review text')
    return value
  }
  const observations = knowledgeRelations.map(value => {
    if (!isRecord(value) || Object.keys(value).some(k => !['from', 'to', 'relationType', 'summary', 'evidence'].includes(k))
      || !Array.isArray(value.evidence) || value.evidence.length < 2 || value.evidence.length > 16) throw new Error('Invalid Knowledge relationship')
    const relationType = requireText(value.relationType, 80)
    if (!new RegExp(DESIGN_RELATION_TYPE_PATTERN, 'u').test(relationType)) throw new Error('Invalid Knowledge relation type')
    return { from: requireText(value.from, 256), to: requireText(value.to, 256), relationType, summary: requireText(value.summary, 8192),
      evidence: value.evidence.map(e => {
        if (!isRecord(e) || Object.keys(e).some(k => !['source', 'locator', 'quote'].includes(k))) throw new Error('Invalid Knowledge evidence')
        return { source: requireText(e.source, 1024), locator: requireText(e.locator, 2048), quote: requireText(e.quote, 8192) }
      }) }
  })
  let retractions: KnowledgeReviewRetraction[] | undefined
  if (knowledgeRetractions !== undefined) {
    if (!Array.isArray(knowledgeRetractions) || knowledgeRetractions.length>32) throw new Error('Invalid Knowledge retractions')
    retractions = knowledgeRetractions.map(item=>{
      if (!isRecord(item) || Object.keys(item).some(k=>!['relationId','reason','evidence'].includes(k))) throw new Error('Invalid Knowledge retraction')
      const checked = splitKnowledgeReviewResult({knowledgeRelations:[{from:'validate',to:'evidence',relationType:'validation',summary:'validation',evidence:item.evidence}]}).observations[0]!
      return {relationId:requireText(item.relationId,256),reason:requireText(item.reason,8192),evidence:checked.evidence}
    })
  }
  return { advisory, observations, ...(retractions ? {retractions} : {}) }
}

/** Invoke under the host project mutation queue after review freshness checks.
 * No model-controlled file writes, arbitrary product identities or approval flow.
 * Only owned proposed relations may be retracted; history remains queryable. */
export async function publishKnowledgeReview(options: {
  service: DesignKnowledgeService; projectId: DesignProjectId; checkpoint: string;
  /** Projection source pin; callers prove it has the same Design evidence as the review checkpoint. */
  sourceCheckpoint?: string;
  reviewed: DesignKnowledgeQueryResult; producer: 'grounding' | 'reflection' | 'alignment';
  observations: readonly KnowledgeReviewObservation[]; signal?: AbortSignal;
  retractions?: readonly KnowledgeReviewRetraction[];
  relationVocabulary?: CompiledDesignRelationVocabulary;
}) {
  const { service, projectId, checkpoint, reviewed, producer, signal } = options
  const sourceCheckpoint = options.sourceCheckpoint ?? checkpoint
  if (!['grounding', 'reflection', 'alignment'].includes(producer)) throw new Error('This review profile cannot maintain Knowledge relationships')
  const {observations,retractions=[]} = splitKnowledgeReviewResult({ knowledgeRelations: options.observations,
    ...(options.retractions ? {knowledgeRetractions:options.retractions} : {}) })
  const current = await readCompleteDesignKnowledge(service, { projectId, limit: 100 }, signal)
  if (current.generation !== reviewed.generation) throw new Error('Knowledge generation changed during review; old review discarded')
  const nodes = new Map(current.entities.map(n => [String(n.id), n]))
  const input = new Map(reviewed.entities.map(n => [String(n.id), n]))
  const missing = [...new Set(observations.flatMap(item => [item.from, item.to]))].filter(id => !input.has(id))
  if (missing.length) {
    // Reviewers may have queried beyond the initial bounded context. Resolve
    // those endpoints from the exact reviewed revision, never the latest graph.
    const additional = await readCompleteDesignKnowledge(service, { projectId, revision: reviewed.revision,
      entityIds: missing.map(DesignKnowledgeEntityId), relationIds: [], limit: 100 }, signal)
    for (const entity of additional.entities) input.set(entity.id, entity)
  }
  const relations: DesignKnowledgeDeltaRelation[] = observations.map(item => {
    if (item.from === item.to) throw new Error('Self-referential Knowledge observation')
    const endpoints = [item.from, item.to].map(id => {
      const before = input.get(id), now = nodes.get(id)
      if (!before || !now || now.provenance.producer !== 'design-file-projection'
        || now.provenance.checkpoint !== sourceCheckpoint || before.properties.contentRevision !== now.properties.contentRevision
        || typeof now.properties.contentRevision !== 'string') throw new Error('Knowledge review endpoint is missing, stale or not a saved Design record')
      return now
    })
    const matches = (e: KnowledgeReviewObservation['evidence'][number], node: typeof endpoints[number]) =>
      node.properties.file === e.source && Array.isArray(node.properties.fields)
      && node.properties.fields.some(f => isRecord(f) && f.pointer === e.locator && typeof f.text === 'string' && f.text.includes(e.quote))
    if (!endpoints.every(node => item.evidence.some(e => matches(e, node))) || !item.evidence.every(e => endpoints.some(node => matches(e, node)))) throw new Error('Knowledge review evidence must quote saved fields for both endpoints')
    const relationSemantics = resolveDesignRelation(item.relationType, options.relationVocabulary)
    if (relationSemantics.meaning === 'contains') throw new Error('Knowledge reviews cannot publish projection-owned contains relationships')
    const endpointIssue = designRelationEndpointIssue(item.relationType, endpoints[0].properties.ontologyType, endpoints[1].properties.ontologyType, options.relationVocabulary)
    if (endpointIssue) throw new Error(`Knowledge review relation violates ontology contract: ${endpointIssue}`)
    return { id: DesignKnowledgeRelationId('review:' + semanticDigest(JSON.stringify([producer, item.from, item.to, item.relationType]))),
      from: DesignKnowledgeEntityId(item.from), to: DesignKnowledgeEntityId(item.to), relationType: item.relationType, lifecycle: 'proposed',
      properties: { projection: 'review-v1', summary: item.summary, quotes: item.evidence.map(e => ({ ...e })), relationSemantics: { ...relationSemantics } },
      provenance: { producer, checkpoint, evidence: item.evidence.map(e => ({ source: e.source, locator: e.locator, revision: checkpoint })) } }
  })
  if (new Set(relations.map(r => r.id)).size !== relations.length) throw new Error('Duplicate Knowledge review relationship')
  const stable = (v: unknown) => JSON.stringify(v, (_k, value) => isRecord(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value)
  const previous = new Map(current.relations.map(r => [r.id, r]))
  for (const relation of relations) {
    const prior = previous.get(relation.id)
    if (prior && (prior.provenance.producer !== producer || prior.properties.projection !== 'review-v1')) throw new Error('Knowledge review identity ownership conflict')
  }
  const upsertRelations = relations.filter(r => stable(previous.get(r.id)) !== stable(r))
  const audit: DesignKnowledgeDeltaEntity[] = [], removeRelations: ReturnType<typeof DesignKnowledgeRelationId>[] = []
  if (new Set(retractions.map(r=>r.relationId)).size !== retractions.length) throw new Error('Duplicate Knowledge retraction')
  for (const item of retractions) {
    const id = DesignKnowledgeRelationId(item.relationId)
    if (relations.some(r=>r.id===id)) throw new Error('Cannot upsert and retract the same relationship')
    const before = (await service.query({projectId,revision:reviewed.revision,entityIds:[],relationIds:[id],limit:1})).relations[0]
    const now = previous.get(id)
    if (!before || !now || stable(before)!==stable(now) || now.provenance.producer!==producer || now.properties.projection!=='review-v1' || now.lifecycle!=='proposed') {
      throw new Error('Knowledge retraction ownership or reviewed-version mismatch')
    }
    // Apply the same source constraints to current, pinned endpoint quotes.
    const endpoints = [now.from,now.to].map(id=>nodes.get(id))
    const matches = (e:KnowledgeReviewObservation['evidence'][number], n:typeof endpoints[number]) => n
      && n.provenance.producer==='design-file-projection' && n.provenance.checkpoint===sourceCheckpoint
      && n.properties.file===e.source && Array.isArray(n.properties.fields)
      && n.properties.fields.some(f=>isRecord(f) && f.pointer===e.locator && typeof f.text==='string' && f.text.includes(e.quote))
    if (!endpoints.every(n=>item.evidence.some(e=>matches(e,n))) || !item.evidence.every(e=>endpoints.some(n=>matches(e,n)))) throw new Error('Retraction must cite both current saved endpoints')
    const reviewedEndpoints = await service.query({projectId,revision:reviewed.revision,entityIds:[now.from,now.to],relationIds:[],limit:2})
    if (endpoints.some(n=>!n || !reviewedEndpoints.entities.some(old=>old.id===n.id && old.properties.contentRevision===n.properties.contentRevision))) throw new Error('Retraction endpoint evidence changed')
    removeRelations.push(id)
    audit.push({id:DesignKnowledgeEntityId('review-event:'+semanticDigest(stable([producer,id,checkpoint,reviewed.revision,item]))),
      entityType:'design-review-event',label:item.reason,lifecycle:'observed',properties:{projection:'review-maintenance-v1',action:'retract',relationId:id,
        reason:item.reason,reviewedRevision:reviewed.revision,quotes:item.evidence.map(e=>({...e}))},
      provenance:{producer,checkpoint,evidence:item.evidence.map(e=>({source:e.source,locator:e.locator,revision:checkpoint}))}})
  }
  if (!upsertRelations.length && !removeRelations.length) return { revision: current.revision, changed: false }
  signal?.throwIfAborted()
  const result = await service.applyDelta({ mutationId: DesignKnowledgeMutationId('review:' + semanticDigest(stable([projectId, checkpoint, current.revision, upsertRelations,removeRelations,audit]))),
    pin: { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: current.revision },
    upsertEntities: audit, removeEntities: [], removeRelations, upsertRelations })
  return { revision: result.revision, changed: true }
}
