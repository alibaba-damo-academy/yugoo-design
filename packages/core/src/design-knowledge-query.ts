/** Shared native/DSH/Panel query contract. No filesystem access or mutation. */
import { DesignKnowledgeEntityId, DesignKnowledgeRelationId, type DesignKnowledgeQuery } from './design-knowledge.ts'
import type { DesignKnowledgeQueryResult, DesignKnowledgeRelation } from './design-knowledge.ts'
import { knowledgeRelationReading, type KnowledgeRelationReading } from './design-knowledge-reading.ts'

export interface KnowledgeReadArguments {
  project?: string; checkpoint?: string; revision?: string
  text?: string; entityIds?: string[]; relationIds?: string[]; offset?: number; limit?: number
  incidentTo?: string[]; direction?: 'incoming' | 'outgoing' | 'both'
  sourceFiles?: string[]; relationTypes?: string[]
  relationMeanings?: string[]; relationOrigins?: string[]
  ontologyTypes?: string[]; recordKinds?: ('design-record' | 'design-content' | 'design-artifact')[]
  identityQualities?: ('stable' | 'structural' | 'anonymous')[]
}

export interface KnowledgeReadResult extends DesignKnowledgeQueryResult {
  relations: readonly (DesignKnowledgeRelation & { reading: KnowledgeRelationReading })[]
  project: string; checkpoint: string
  evidence: { format: 'projected-fields'; truncated: false; sourceReadRequired: true }
}

/** Identical projection for the database and an immutable review read replica. */
export function queryKnowledgeSnapshot(snapshot: DesignKnowledgeQueryResult, request: DesignKnowledgeQuery): DesignKnowledgeQueryResult {
  if (request.revision !== undefined && request.revision !== snapshot.revision) throw new Error('Knowledge snapshot revision mismatch')
  let entities = [...snapshot.entities], relations = [...snapshot.relations]
  if (request.entityIds !== undefined) entities = entities.filter(n => request.entityIds!.includes(n.id))
  if (request.relationIds !== undefined) relations = relations.filter(n => request.relationIds!.includes(n.id))
  if (request.entityTypes !== undefined) entities = entities.filter(n => request.entityTypes!.includes(n.entityType))
  if (request.ontologyTypes !== undefined) entities = entities.filter(n => typeof n.properties.ontologyType === 'string' && request.ontologyTypes!.includes(n.properties.ontologyType))
  if (request.recordKinds !== undefined) entities = entities.filter(n => typeof n.properties.recordKind === 'string' && request.recordKinds!.includes(n.properties.recordKind as 'design-record' | 'design-content' | 'design-artifact'))
  if (request.identityQualities !== undefined) entities = entities.filter(n => typeof n.properties.identityQuality === 'string' && request.identityQualities!.includes(n.properties.identityQuality as 'stable' | 'structural' | 'anonymous'))
  if (request.relationTypes !== undefined) relations = relations.filter(n => request.relationTypes!.includes(n.relationType))
  if (request.relationMeanings !== undefined) relations = relations.filter(n => request.relationMeanings!.includes(knowledgeRelationReading(n).meaning))
  if (request.relationOrigins !== undefined) relations = relations.filter(n => request.relationOrigins!.includes(knowledgeRelationReading(n).origin))
  if (request.lifecycles !== undefined) {
    entities = entities.filter(n => request.lifecycles!.includes(n.lifecycle))
    relations = relations.filter(n => request.lifecycles!.includes(n.lifecycle))
  }
  if (request.text !== undefined) {
    const needle = request.text.toLowerCase()
    entities = entities.filter(n => JSON.stringify(n).toLowerCase().includes(needle))
    relations = relations.filter(n => JSON.stringify(n).toLowerCase().includes(needle))
  }
  if (request.sourceFiles !== undefined) {
    entities = entities.filter(n => n.provenance.evidence.some(e => request.sourceFiles!.includes(e.source)))
    relations = relations.filter(n => n.provenance.evidence.some(e => request.sourceFiles!.includes(e.source)))
  }
  if (request.incidentTo !== undefined) {
    const seeds = new Set(request.incidentTo), direction = request.direction ?? 'both'
    relations = relations.filter(r => direction === 'outgoing' ? seeds.has(r.from) : direction === 'incoming' ? seeds.has(r.to) : seeds.has(r.from) || seeds.has(r.to))
    const endpoints = new Set([...seeds, ...relations.flatMap(r => [r.from, r.to])])
    entities = entities.filter(n => endpoints.has(n.id))
  }
  const offset = request.offset ?? 0
  return Object.freeze({ revision:snapshot.revision, entities:Object.freeze(entities.slice(offset, offset + request.limit)), relations:Object.freeze(relations.slice(offset, offset + request.limit)),
    ...(snapshot.generation ? { generation: snapshot.generation } : {}),
    ...(request.offset === undefined ? {} : {page:Object.freeze({offset, nextOffset:offset + request.limit < Math.max(entities.length,relations.length) ? offset + request.limit : null,
      totalEntities:entities.length,totalRelations:relations.length})}) })
}

export function knowledgeReadResult(project: string, checkpoint: string, graph: DesignKnowledgeQueryResult): KnowledgeReadResult {
  const result: KnowledgeReadResult = { project, checkpoint, ...graph, relations: graph.relations.map(edge => ({ ...edge, reading: knowledgeRelationReading(edge) })),
    evidence: { format: 'projected-fields', truncated: false, sourceReadRequired: true } }
  if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024) throw new Error('Knowledge query exceeds response budget; narrow IDs/limit or read the pinned source file. No partial result was returned.')
  return result
}

export function knowledgeQueryFilters(args: KnowledgeReadArguments): Omit<DesignKnowledgeQuery, 'projectId' | 'revision' | 'limit'> {
  const result: Record<string, unknown> = {}
  for (const name of ['entityIds', 'relationIds', 'incidentTo', 'sourceFiles', 'relationTypes', 'relationMeanings', 'relationOrigins', 'ontologyTypes', 'recordKinds', 'identityQualities'] as const) {
    const values = args[name]
    if (values === undefined) continue
    if (!Array.isArray(values) || values.length > 64 || values.some(value => typeof value !== 'string' || !value || value.length > 2048)) throw new Error(`Invalid Knowledge ${name}`)
    result[name] = values.map(value => name === 'entityIds' || name === 'incidentTo' ? DesignKnowledgeEntityId(value) : name === 'relationIds' ? DesignKnowledgeRelationId(value) : value)
  }
  if (args.recordKinds?.some(value => !['design-record', 'design-content', 'design-artifact'].includes(value))) throw new Error('Invalid Knowledge recordKinds')
  if (args.identityQualities?.some(value => !['stable', 'structural', 'anonymous'].includes(value))) throw new Error('Invalid Knowledge identityQualities')
  if (args.direction !== undefined) {
    if (args.incidentTo === undefined || !['incoming', 'outgoing', 'both'].includes(args.direction)) throw new Error('Knowledge direction requires incidentTo')
    result.direction = args.direction
  }
  if (args.text !== undefined) {
    if (typeof args.text !== 'string' || args.text.length > 8192) throw new Error('Invalid Knowledge text')
    result.text = args.text
  }
  if (args.offset !== undefined) {
    if (!Number.isSafeInteger(args.offset) || args.offset < 0 || args.offset > 0 && !args.revision) throw new Error('Knowledge continuation requires a nonnegative offset and pinned revision')
    result.offset = args.offset
  }
  if (args.limit !== undefined && (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 100)) throw new Error('Knowledge query limit must be 1–100')
  return result
}

export const KNOWLEDGE_AGENTIC_GUIDANCE = `The shared Design KAG is a read-only evidence aid for ordinary generation and revision as well as review. Main Agents, Producers and Workers can use design_query_knowledge when the Host exposes it.
Consider a focused query when a task spans several Design Files, a changed object or rule may affect other outputs, evidence conflicts, or a relevant dependency is unclear. It can locate related records, constraints and impact neighborhoods before synthesis. A self-contained task with sufficient current evidence need not query.
On DSH the main Agent can begin with a bounded text/sourceFiles query and pass the returned project, checkpoint and revision plus relevant evidence to a Producer; descendants require those exact pins. On Companion, design_knowledge_context supplies pins before design_query_knowledge. Forward supplied pins to Workers only for the same task/source snapshot. Never invent pins or bypass ancestry checks; if pins or the tool are unavailable, use scoped source reads. Do not demand a fresh index or GRA run before generation. Unsaved working-copy changes are not in the published graph: compare relevant current source files before applying older graph evidence.
Use the shared Design KAG to answer a current design question, not to inspect or connect every node.
Start from the current task, changed sourceFiles or exact record IDs. Pin project, checkpoint and graph revision; page with unchanged filters.
Use ontologyTypes to select schema-derived kinds, recordKinds to separate records/content/artifacts, and identityQualities to distinguish stable anchors from structural or anonymous instances. These are generated projection facts, not manually assigned domain roles. Use incidentTo and direction for one-hop neighborhoods; relationTypes can narrow purpose. Expand only as needed, deduplicate and stop when the question is supported or the bounded search cannot resolve it.
Relation reading separates meaning, origin, semantic direction and lifecycle. relationMeanings/relationOrigins filter before pagination; relationTypes still matches exact stored types. direction incoming/outgoing is STORAGE from/to, even for symmetric similar/contradicts; use both to recall both sides. Unknown types keep their raw name and unknown semantic direction: do not infer meaning from producer, labels or visual proximity.
A heavily cited shared style is not necessarily a central business capability; choose relation meaning for the question instead of ranking every edge together. Do not infer mandatory node layers from schema names or visual positions.
Read the cited Design Files at the pinned checkpoint to verify object, role, conditions and version. Schema-derived type/property shapes describe allowed structure, not confirmed business truth. Contains/reference edges locate evidence; embedding similarity only recalls candidates; prior Agent relations are interpretations, not self-proving facts.
Distinguish source containers (properties.contentKind=container), design units (unit) and their field evidence. Properties such as size, color and states remain on their unit with exact pointers; equal values alone do not establish a design relationship. Contract labels describe grouping, not new source facts. Use the most specific evidenced unit/field, not the enclosing config as a substitute endpoint.
An unloaded endpoint, partial page, unfinished index or isolated node is not proof of missing design. Report scope/unknowns and consider the current design stage before recommending action.
Return the answer, source evidence, unresolved scope and an actionable next step or reason to defer. Ordinary queries may stay read-only; do not spawn a reviewer merely to write a relation.
Design changes use the existing Bundle workflow. GRA may maintain evidence-backed relations through its existing result path; graph writes must not trigger an unbounded review loop.
If the graph is unavailable or stale, use bounded source-file reading without claiming complete graph coverage. Do not repeatedly retry or block foreground work.`
