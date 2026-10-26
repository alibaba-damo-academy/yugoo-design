/** Complete file projection into the existing Knowledge service, independent of UI budgets. */
import { createHash } from 'node:crypto'
import type { DesignFilesStore } from './design-files.ts'
import type { DesignProjectId } from './design-project.ts'
import type { SchemaSpec } from './schema.ts'
import { readDesignGraph } from './design-graph.ts'
import { readCompleteDesignKnowledge } from './design-knowledge-snapshot.ts'
import { appendReferencedKnowledgeArtifacts } from './design-knowledge-artifacts.ts'
import { designEvidenceSignatures } from './design-knowledge-evidence.ts'
import { resolveDesignRelation } from './design-relation-vocabulary.ts'
import type { CompiledDesignOntologyContract } from './design-ontology.ts'
import {
  DesignKnowledgeEntityId, DesignKnowledgeRelationId, DesignKnowledgeMutationId,
  type DesignKnowledgeService, type DesignKnowledgeEntity, type DesignKnowledgeRelation,
  type DesignKnowledgeDeltaEntity, type DesignKnowledgeDeltaRelation,
} from './design-knowledge.ts'

const projection = 'design-files-v1'
const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const owns = (record: DesignKnowledgeEntity | DesignKnowledgeRelation) => record.provenance.producer === 'design-file-projection' && record.properties.projection === projection

interface ProjectionSource {
  readonly store: DesignFilesStore
  readonly schemas?: Record<string, SchemaSpec>
  readonly ontology?: CompiledDesignOntologyContract
  readonly signal?: AbortSignal
  /** Original source pin; equivalent current commits are verified by the host. */
  readonly checkpoint?: string
}

/** The same pure source read defines both writes and source-only read proof. */
async function prepareSourceProjection(options: ProjectionSource) {
  const { store, signal } = options
  const checkpoint = options.checkpoint ?? await store.head(signal)
  if (!checkpoint) throw new Error('Knowledge projection requires a published checkpoint')
  const graph = await readDesignGraph(store, checkpoint, signal, options.schemas, { purpose: 'storage', ontology: options.ontology })
  await appendReferencedKnowledgeArtifacts(store, graph, signal, options.ontology, options.schemas)
  const entities: DesignKnowledgeDeltaEntity[] = graph.nodes.map(node => ({
    id: DesignKnowledgeEntityId(node.id), entityType: node.recordKind ?? (node.source ? 'design-artifact' : node.record ? 'design-record' : 'design-content'),
    label: node.label, lifecycle: 'observed',
    properties: { projection, file: node.file, pointer: node.pointer, owner: node.owner,
      recordKind: node.recordKind ?? (node.source ? 'design-artifact' : node.record ? 'design-record' : 'design-content'),
      ontologyType: node.ontologyType ?? (node.source ? 'design/artifact#file' : `unscoped/${node.owner}#${node.record ? 'untyped-record' : 'untyped-content'}`),
      identityQuality: node.identityQuality ?? (node.source ? 'stable' : 'structural'),
      ...(node.schemaPointer !== undefined ? { schemaPointer: node.schemaPointer } : {}),
      ...(node.ontologyRevision !== undefined ? { ontologyRevision: node.ontologyRevision } : {}),
      ...(node.contentKind ? { contentKind: node.contentKind } : {}),
      ...(node.sourceLabel ? { sourceLabel: node.sourceLabel } : {}),
      contentRevision: digest({ fields: node.fields ?? [], source: node.source }),
      ...(node.source ? { source: { ...node.source } } : {}),
      recordId: node.recordId ?? node.id, ...(node.parentId ? { parentId: node.parentId } : {}),
      fields: (node.fields ?? []).map(field => ({ ...field })) },
    provenance: { producer: 'design-file-projection', checkpoint,
      evidence: [{ source: node.file, revision: checkpoint, locator: node.pointer }] },
  }))
  const nodes = new Map(entities.map(node => [String(node.id), node]))
  const relations: DesignKnowledgeDeltaRelation[] = graph.edges.map(edge => ({
    id: DesignKnowledgeRelationId(edge.id), from: DesignKnowledgeEntityId(edge.from), to: DesignKnowledgeEntityId(edge.to),
    relationType: edge.relationType ?? (edge.id.startsWith('artifact-ref:') ? 'references-artifact' : edge.kind), lifecycle: edge.kind === 'contains' || edge.relationType === 'references' || edge.id.startsWith('artifact-ref:') ? 'observed' : 'proposed',
    properties: { projection, label: edge.label, evidence: edge.evidence,
      relationSemantics: { ...resolveDesignRelation(edge.relationType ?? (edge.id.startsWith('artifact-ref:') ? 'references-artifact' : edge.kind)) } },
    provenance: { producer: 'design-file-projection', checkpoint,
      evidence: [...nodes.get(edge.from)!.provenance.evidence, ...nodes.get(edge.to)!.provenance.evidence] },
  }))
  return { checkpoint, entities, relations, warnings: graph.warnings }
}

/** Call from the existing per-project mutation queue. Never accepts a partial UI graph. */
export async function materializeDesignFilesKnowledge(options: ProjectionSource & {
  readonly service: DesignKnowledgeService
  readonly projectId: DesignProjectId
  readonly pageSize?: number
}) {
  const { store, service, projectId, signal } = options
  const { checkpoint, entities, relations, warnings } = await prepareSourceProjection(options)
  const { revision, entities: beforeEntities, relations: beforeRelations } = await readCompleteDesignKnowledge(service, { projectId, limit: options.pageSize ?? 100 }, signal)
  const nextEntities = new Set(entities.map(node => String(node.id)))
  const nextRelations = new Set(relations.map(edge => String(edge.id)))
  const removeEntities = beforeEntities.filter(node => owns(node) && !nextEntities.has(node.id)).map(node => node.id)
  const removed = new Set<string>(removeEntities)
  const previousNodes = new Map(beforeEntities.map(node => [String(node.id), node]))
  const previousEdges = new Map(beforeRelations.map(edge => [String(edge.id), edge]))
  // Derived relationships cannot survive changes to the evidence they analyzed.
  // A new checkpoint alone does not invalidate them; changed content does.
  // Removal retires the current version, retaining the provider's version history.
  // A grouping change can retire a child node without changing its parent's
  // source evidence. Compare file/locator content, not representation membership.
  const evidenceSignature = designEvidenceSignatures(store, signal)
  const projectedFiles = new Set([...beforeEntities.filter(owns), ...entities].map(node => node.properties.file))
  const changedEvidence = new Set<string>()
  for (const edge of beforeRelations) if (!owns(edge) && !removed.has(edge.from) && !removed.has(edge.to)) {
    for (const evidence of edge.provenance.evidence) {
      // External source-analysis evidence is not owned by the file projection.
      if (!projectedFiles.has(evidence.source)) continue
      const before = await evidenceSignature(evidence.revision, evidence.source, evidence.locator)
      const after = await evidenceSignature(checkpoint, evidence.source, evidence.locator)
      if (before === undefined || after === undefined || before !== after) {
        changedEvidence.add(edge.id)
        if (before === undefined || after === undefined) {
          const warning = `Knowledge evidence unavailable: ${evidence.source}#${evidence.locator ?? ''}; derived relation retired`
          if (!warnings.includes(warning)) warnings.push(warning)
        }
        break
      }
    }
  }
  // Only this projection's edges or dangling non-authoritative edges may be retired.
  // Legacy accepted records remain protected by the existing provider validator.
  const removeRelations = beforeRelations.filter(edge => (owns(edge) && !nextRelations.has(edge.id))
    || removed.has(edge.from) || removed.has(edge.to)
    || changedEvidence.has(edge.id)).map(edge => edge.id)
  for (const record of [...entities, ...relations]) {
    const previous = 'entityType' in record ? previousNodes.get(record.id) : previousEdges.get(record.id)
    if (previous && !owns(previous)) throw new Error(`Knowledge identity ownership conflict: ${record.id}`)
  }
  const upsertEntities = entities.filter(node => canonical(node) !== canonical(previousNodes.get(node.id)))
  const upsertRelations = relations.filter(edge => canonical(edge) !== canonical(previousEdges.get(edge.id)))
  signal?.throwIfAborted()
  const current = await store.head(signal)
  if (current !== checkpoint && (!current || !await store.sameDesignEvidenceAt?.(checkpoint, current, signal))) {
    throw new Error('Design checkpoint changed during Knowledge projection')
  }
  if (!upsertEntities.length && !upsertRelations.length && !removeEntities.length && !removeRelations.length) {
    return { checkpoint, revision, changed: false, nodes: entities.length, relations: relations.length, warnings }
  }
  const changes = { upsertEntities, upsertRelations, removeEntities, removeRelations }
  const result = await service.applyDelta({ ...changes,
    mutationId: DesignKnowledgeMutationId(`${projection}:${digest({ projectId, checkpoint, revision, changes })}`),
    pin: { projectId, inputCheckpoint: checkpoint, observedCheckpoint: checkpoint, expectedRevision: revision },
  })
  return { checkpoint, revision: result.revision, changed: true, nodes: entities.length, relations: relations.length, warnings }
}

/** Verify a source-only view against the complete source set at its existing pin.
 * No projection, cache pointer or semantic publication is created by this read. */
export async function readSourceDesignKnowledge(options: ProjectionSource & {
  readonly service: Pick<DesignKnowledgeService, 'revision' | 'query'>
  readonly projectId: DesignProjectId
  readonly revision?: import('./design-knowledge.ts').DesignKnowledgeRevision
}) {
  const { store, signal } = options
  const checkpoint = options.checkpoint ?? await store.head(signal)
  if (!checkpoint) throw new Error('Knowledge source read requires a published checkpoint')
  const snapshot = await readCompleteDesignKnowledge(options.service, {
    projectId: options.projectId, revision: options.revision, limit: 100,
  }, signal)
  const entities = snapshot.entities.filter(owns), relations = snapshot.relations.filter(owns)
  if (!entities.length) throw new Error('Knowledge source projection is not available')
  const sourceCheckpoint = entities[0].provenance.checkpoint
  if (!sourceCheckpoint || [...entities, ...relations].some(record => record.provenance.checkpoint !== sourceCheckpoint)) {
    throw new Error('Knowledge source projection has mixed checkpoints')
  }
  if (sourceCheckpoint !== checkpoint && !await store.sameDesignEvidenceAt?.(sourceCheckpoint, checkpoint, signal)) {
    throw new Error('Knowledge source projection is stale; read the current Design Files')
  }
  const expected = await prepareSourceProjection({ ...options, checkpoint: sourceCheckpoint })
  const sameRecords = (actual: readonly (DesignKnowledgeEntity | DesignKnowledgeRelation)[], wanted: readonly (DesignKnowledgeDeltaEntity | DesignKnowledgeDeltaRelation)[]) => {
    const byId = new Map(actual.map(record => [String(record.id), canonical(record)]))
    return byId.size === actual.length && actual.length === wanted.length
      && wanted.every(record => byId.get(String(record.id)) === canonical(record))
  }
  if (!sameRecords(entities, expected.entities) || !sameRecords(relations, expected.relations)) {
    throw new Error('Knowledge source projection does not match the complete pinned source set')
  }
  signal?.throwIfAborted()
  const current = await store.head(signal)
  if (current !== checkpoint && (!current || !await store.sameDesignEvidenceAt?.(checkpoint, current, signal))) {
    throw new Error('Design checkpoint changed during Knowledge source read')
  }
  return { sourceCheckpoint, sourceFiles: [...new Set(entities.map(entity => String(entity.properties.file)))].sort(), warnings: expected.warnings,
    graph: { revision: snapshot.revision, entities, relations, ...(snapshot.generation ? { generation: snapshot.generation } : {}) } }
}
