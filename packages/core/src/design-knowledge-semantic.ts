/** Embedding reads the stored graph and contributes candidates to that same graph. */
import type { DesignGraph, DesignGraphEdge } from './design-graph.ts'
import { isRecord } from './design-graph-content.ts'
import { semanticRecordUnits, semanticDigest, semanticNodeContext } from './design-semantic.ts'
import { readCompleteDesignKnowledge } from './design-knowledge-snapshot.ts'
import {
  DesignKnowledgeMutationId, DesignKnowledgeRelationId, DesignKnowledgeEntityId,
  type DesignKnowledgeService, type DesignKnowledgeQueryResult, type DesignKnowledgeDeltaRelation,
} from './design-knowledge.ts'
import type { DesignProjectId } from './design-project.ts'
import { knowledgeRelationReading } from './design-knowledge-reading.ts'
import { resolveDesignRelation } from './design-relation-vocabulary.ts'

const projection = 'embedding-v1'
export function knowledgeSemanticInput(snapshot: DesignKnowledgeQueryResult, checkpoint: string, index = true): DesignGraph {
  const graph: DesignGraph = { checkpoint, nodes: [], edges: [], warnings: [], semanticUnits: [] }
  if (snapshot.generation) graph.generation = snapshot.generation
  for (const entity of snapshot.entities) {
    if (entity.provenance.producer !== 'design-file-projection' || entity.properties.projection !== 'design-files-v1') continue
    const p = entity.properties
    if (entity.provenance.checkpoint !== checkpoint) throw new Error('Knowledge file projection is stale')
    if (typeof p.file !== 'string' || typeof p.pointer !== 'string' || typeof p.recordId !== 'string' || !Array.isArray(p.fields)) throw new Error('Invalid stored Design record')
    const fields = p.fields.map(field => {
      if (!isRecord(field) || typeof field.pointer !== 'string' || typeof field.text !== 'string') throw new Error('Invalid stored Design field')
      return { pointer: field.pointer, text: field.text }
    })
    graph.nodes.push({ id: entity.id, file: p.file, pointer: p.pointer, recordId: p.recordId,
      ...(typeof p.parentId === 'string' ? { parentId: p.parentId } : {}),
      ...(p.contentKind === 'container' || p.contentKind === 'unit' ? { contentKind: p.contentKind } : {}),
      ...(typeof p.sourceLabel === 'string' ? { sourceLabel: p.sourceLabel } : {}),
      ...(typeof p.ontologyType === 'string' ? { ontologyType: p.ontologyType } : {}),
      ...(p.identityQuality === 'stable' || p.identityQuality === 'structural' || p.identityQuality === 'anonymous' ? { identityQuality: p.identityQuality } : {}),
      ...(typeof p.schemaPointer === 'string' ? { schemaPointer: p.schemaPointer } : {}),
      ...(typeof p.ontologyRevision === 'string' ? { ontologyRevision: p.ontologyRevision } : {}),
      ...(p.recordKind === 'design-record' || p.recordKind === 'design-content' || p.recordKind === 'design-artifact' ? { recordKind: p.recordKind } : {}),
      // Semantic content can own a complete design tree. Root identity is stored
      // in recordId; the entity's semantic kind does not determine its UI level.
      record: p.recordId === entity.id, owner: String(p.owner ?? ''), label: entity.label, context: '', fields })
  }
  if (!index) return graph
  const owners = new Map<string, string>()
  for (const node of [...graph.nodes].sort((a, b) => a.pointer.length - b.pointer.length)) {
    for (const field of node.fields ?? []) owners.set(JSON.stringify([node.file, field.pointer]), node.id)
  }
  const byId = new Map(graph.nodes.map(node => [node.id, node]))
  for (const node of graph.nodes) {
    const own = node.fields!.filter(field => owners.get(JSON.stringify([node.file, field.pointer])) === node.id)
    graph.semanticUnits!.push(...semanticRecordUnits(node.id, node.file, node.pointer, semanticNodeContext(node, byId), own, { complete: true }).units)
  }
  return graph
}

/** A view of persisted identities/relationships, never a second graph builder. */
export function storedKnowledgeGraph(snapshot: DesignKnowledgeQueryResult, checkpoint: string): DesignGraph {
  const graph = knowledgeSemanticInput(snapshot, checkpoint, false)
  delete graph.semanticUnits
  const ids = new Set(graph.nodes.map(node => node.id))
  for (const node of graph.nodes) node.context = node.fields!.map(field => field.pointer + ': ' + field.text).join('\n').slice(0, 12000)
  let unresolved = 0
  for (const edge of snapshot.relations) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) { unresolved++; continue }
    const kind = edge.properties.projection === 'embedding-v1' ? 'semantic'
      : edge.provenance.producer === 'design-file-projection' && edge.relationType === 'contains' ? 'contains'
        : edge.provenance.producer === 'design-file-projection' && edge.relationType === 'identifier-match' ? 'identifier-match' : 'knowledge'
    graph.edges.push({ id: edge.id, from: edge.from, to: edge.to, kind, reading: knowledgeRelationReading(edge),
      label: String(edge.properties.label ?? edge.properties.summary ?? edge.relationType),
      evidence: JSON.stringify({ ...edge.properties, provenance: edge.provenance, lifecycle: edge.lifecycle, knowledgeRevision: snapshot.revision }) })
  }
  if (unresolved) graph.warnings.push(`${unresolved} 条存储关系的端点不在当前设计记录视图中；未展示不代表不存在。`)
  if (snapshot.page?.nextOffset !== null && snapshot.page?.nextOffset !== undefined) graph.warnings.push('当前为部分存储快照，请继续分页获取剩余关系和端点。')
  return graph
}

/** Called inside the existing project mutation queue after inference, never while
 * holding that queue throughout model execution. Only this complete candidate set
 * is replaced; file facts and GRA relationships have separate provenance. */
export async function publishKnowledgeSemantic(options: {
  service: DesignKnowledgeService; projectId: DesignProjectId; input: DesignGraph;
  edges: readonly DesignGraphEdge[]; currentCheckpoint: string; signal?: AbortSignal;
}) {
  const { service, projectId, input, currentCheckpoint, signal } = options
  signal?.throwIfAborted()
  if (currentCheckpoint !== input.checkpoint) throw new Error('Design checkpoint changed during semantic indexing')
  const snapshot = await readCompleteDesignKnowledge(service, { projectId, limit: 100 }, signal)
  const fresh = knowledgeSemanticInput(snapshot, currentCheckpoint)
  if (fresh.generation !== input.generation) throw new Error('Knowledge generation changed during semantic indexing')
  const key = (graph: DesignGraph) => JSON.stringify(graph.semanticUnits!.map(unit => [unit.id, unit.digest, unit.fieldPointers]))
  if (key(fresh) !== key(input)) throw new Error('Knowledge content changed during semantic indexing')
  const nodes = new Map(fresh.nodes.map(node => [node.id, node]))
  const relations: DesignKnowledgeDeltaRelation[] = options.edges.map(edge => {
    const from = nodes.get(edge.from), to = nodes.get(edge.to)
    if (edge.kind !== 'semantic' || !from || !to || from.id === to.id || from.file === to.file) throw new Error('Invalid semantic endpoints')
    const metadata = JSON.parse(edge.evidence)
    if (!isRecord(metadata) || metadata.checkpoint !== currentCheckpoint || typeof metadata.model !== 'string'
      || typeof metadata.similarity !== 'number' || !Number.isFinite(metadata.similarity)
      || !Array.isArray(metadata.sources) || metadata.sources.length !== 2) throw new Error('Invalid semantic provenance')
    const sources = metadata.sources
    const evidence = [from, to].flatMap((node, index) => {
      const source = sources[index]
      if (!isRecord(source) || source.file !== node.file || source.pointer !== node.pointer
        || !Array.isArray(source.fields) || source.fields.length === 0
        || !source.fields.every(pointer => typeof pointer === 'string' && node.fields!.some(field => field.pointer === pointer))) throw new Error('Semantic evidence is not present in the stored graph')
      return source.fields.map(locator => ({ source: node.file, revision: currentCheckpoint, locator: String(locator) }))
    })
    return { id: DesignKnowledgeRelationId(edge.id), from: DesignKnowledgeEntityId(from.id), to: DesignKnowledgeEntityId(to.id),
      relationType: 'semantic-similarity', lifecycle: 'proposed',
      properties: { projection, label: edge.label, model: metadata.model, similarity: metadata.similarity, evidence: edge.evidence,
        relationSemantics: { ...resolveDesignRelation('semantic-similarity') } },
      provenance: { producer: 'source-analysis', checkpoint: currentCheckpoint, evidence } }
  })
  if (new Set(relations.map(edge => edge.id)).size !== relations.length) throw new Error('Duplicate semantic relationship identity')
  const owns = (edge: typeof snapshot.relations[number]) => edge.provenance.producer === 'source-analysis' && edge.properties.projection === projection
  const previous = new Map(snapshot.relations.map(edge => [edge.id, edge]))
  for (const edge of relations) if (previous.has(edge.id) && !owns(previous.get(edge.id)!)) throw new Error('Semantic relationship identity ownership conflict')
  const next = new Set(relations.map(edge => edge.id))
  const removeRelations = snapshot.relations.filter(edge => owns(edge) && !next.has(edge.id)).map(edge => edge.id)
  const stable = (value: unknown) => JSON.stringify(value, (_key, v) => isRecord(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
  const upsertRelations = relations.filter(edge => stable(previous.get(edge.id)) !== stable(edge))
  if (!removeRelations.length && !upsertRelations.length) return { revision: snapshot.revision, changed: false }
  signal?.throwIfAborted()
  const result = await service.applyDelta({ mutationId: DesignKnowledgeMutationId(projection + ':' + semanticDigest(stable([projectId, snapshot.revision, currentCheckpoint, upsertRelations, removeRelations]))),
    pin: { projectId, inputCheckpoint: currentCheckpoint, observedCheckpoint: currentCheckpoint, expectedRevision: snapshot.revision },
    upsertEntities: [], removeEntities: [], upsertRelations, removeRelations })
  return { revision: result.revision, changed: true }
}
