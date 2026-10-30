/** Provider-neutral Design Knowledge capability used by G/R/A and Studio. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { createHash } from 'node:crypto'
import type { DesignProjectId } from './design-project.ts'

/** Opaque revision returned by one knowledge provider. */
export type DesignKnowledgeRevision = Branded<'DesignKnowledgeRevision'>

/** Stable Design System identity of one knowledge entity. */
export type DesignKnowledgeEntityId = Branded<'DesignKnowledgeEntityId'>

/** Stable Design System identity of one knowledge relation. */
export type DesignKnowledgeRelationId = Branded<'DesignKnowledgeRelationId'>

/** Stable identity of one advisory proposal. */
export type DesignKnowledgeProposalId = Branded<'DesignKnowledgeProposalId'>

/** Provider-neutral SHA-256 identity of one immutable proposal body. */
export type DesignKnowledgeProposalDigest = Branded<'DesignKnowledgeProposalDigest'>

/** Stable idempotency identity of one mutation request. */
export type DesignKnowledgeMutationId = Branded<'DesignKnowledgeMutationId'>

function knowledgeId(value: string, name: string): string {
  if (value.trim() === '' || Buffer.byteLength(value, 'utf8') > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`invalid ${name} ${JSON.stringify(value)}`)
  }
  return value
}

/** Validate and brand a provider revision. */
export function DesignKnowledgeRevision(value: string): DesignKnowledgeRevision {
  return knowledgeId(value, 'Design Knowledge revision') as DesignKnowledgeRevision
}

/** Validate and brand a stable entity id. */
export function DesignKnowledgeEntityId(value: string): DesignKnowledgeEntityId {
  return knowledgeId(value, 'Design Knowledge entity id') as DesignKnowledgeEntityId
}

/** Validate and brand a stable relation id. */
export function DesignKnowledgeRelationId(value: string): DesignKnowledgeRelationId {
  return knowledgeId(value, 'Design Knowledge relation id') as DesignKnowledgeRelationId
}

/** Validate and brand a stable proposal id. */
export function DesignKnowledgeProposalId(value: string): DesignKnowledgeProposalId {
  return knowledgeId(value, 'Design Knowledge proposal id') as DesignKnowledgeProposalId
}

/** Validate and brand a serialized proposal digest. */
export function DesignKnowledgeProposalDigest(value: string): DesignKnowledgeProposalDigest {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new Error(`invalid Design Knowledge proposal digest ${JSON.stringify(value)}`)
  return value as DesignKnowledgeProposalDigest
}

/** Validate and brand an idempotent mutation id. */
export function DesignKnowledgeMutationId(value: string): DesignKnowledgeMutationId {
  return knowledgeId(value, 'Design Knowledge mutation id') as DesignKnowledgeMutationId
}

/** JSON value accepted at the provider boundary. */
export type DesignKnowledgeValue = null | boolean | number | string | readonly DesignKnowledgeValue[] | { readonly [key: string]: DesignKnowledgeValue }

/** Lifecycle of knowledge projected from Design evidence and human decisions. */
export type DesignKnowledgeLifecycle = 'observed' | 'proposed' | 'accepted' | 'rejected' | 'superseded'

/** Revision-addressed evidence behind an entity, relation, or proposal. */
export interface DesignKnowledgeEvidence {
  /** Provider-neutral source identifier, normally a Design File or journal. */
  readonly source: string
  /** Exact source revision or project checkpoint. */
  readonly revision: string
  /** Optional JSON pointer, artifact anchor, or other source-local locator. */
  readonly locator?: string
}

/** Provenance shared by graph records. */
export interface DesignKnowledgeProvenance {
  /** Component that produced this record. */
  readonly producer: 'grounding' | 'reflection' | 'alignment' | 'design-file-projection' | 'human-decision' | 'source-analysis'
  /** Exact Design Project checkpoint observed by the producer. */
  readonly checkpoint: string
  /** Evidence sufficient to trace or rebuild the record. */
  readonly evidence: readonly DesignKnowledgeEvidence[]
}

/** One dynamically typed design entity. Kits and free-canvas Bundles own type names. */
export interface DesignKnowledgeEntity {
  readonly id: DesignKnowledgeEntityId
  readonly entityType: string
  readonly label: string
  readonly lifecycle: DesignKnowledgeLifecycle
  readonly properties: Readonly<Record<string, DesignKnowledgeValue>>
  readonly provenance: DesignKnowledgeProvenance
}

/** One dynamically typed directed relation between Design System entity ids. */
export interface DesignKnowledgeRelation {
  readonly id: DesignKnowledgeRelationId
  readonly relationType: string
  readonly from: DesignKnowledgeEntityId
  readonly to: DesignKnowledgeEntityId
  readonly lifecycle: DesignKnowledgeLifecycle
  readonly properties: Readonly<Record<string, DesignKnowledgeValue>>
  readonly provenance: DesignKnowledgeProvenance
}

/** Entity state that a source projection or advisory Agent may write directly. */
export type DesignKnowledgeDeltaEntity = Omit<DesignKnowledgeEntity, 'lifecycle'> & {
  readonly lifecycle: 'observed' | 'proposed'
}

/** Relation state that a source projection or advisory Agent may write directly. */
export type DesignKnowledgeDeltaRelation = Omit<DesignKnowledgeRelation, 'lifecycle'> & {
  readonly lifecycle: 'observed' | 'proposed'
}

/** Proposed entity that has no accepted authority before a journal decision. */
export type DesignKnowledgeProposedEntity = Omit<DesignKnowledgeEntity, 'lifecycle'> & {
  readonly lifecycle: 'proposed'
}

/** Proposed relation that has no accepted authority before a journal decision. */
export type DesignKnowledgeProposedRelation = Omit<DesignKnowledgeRelation, 'lifecycle'> & {
  readonly lifecycle: 'proposed'
}

/** Exact provider state observed before a mutation. */
export interface DesignKnowledgePin {
  readonly projectId: DesignProjectId
  /** Project checkpoint against which the Agent produced the mutation. */
  readonly inputCheckpoint: string
  /** Project checkpoint observed immediately before committing the mutation. */
  readonly observedCheckpoint: string
  readonly expectedRevision: DesignKnowledgeRevision
}

/** A mutation raced another committed knowledge revision. */
export class DesignKnowledgeRevisionConflictError extends Error {
  readonly expected: DesignKnowledgeRevision
  readonly actual: DesignKnowledgeRevision

  constructor(expected: DesignKnowledgeRevision, actual: DesignKnowledgeRevision) {
    super(`design knowledge: expected revision ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`)
    this.name = 'DesignKnowledgeRevisionConflictError'
    this.expected = expected
    this.actual = actual
  }
}

/** A Design change made an AI-authored mutation stale before commit. */
export class DesignKnowledgeCheckpointConflictError extends Error {
  readonly input: string
  readonly observed: string

  constructor(input: string, observed: string) {
    super(`design knowledge: input checkpoint ${JSON.stringify(input)} is stale against ${JSON.stringify(observed)}`)
    this.name = 'DesignKnowledgeCheckpointConflictError'
    this.input = input
    this.observed = observed
  }
}

/** An idempotency identity was replayed with different mutation content. */
export class DesignKnowledgeMutationConflictError extends Error {
  readonly mutationId: DesignKnowledgeMutationId

  constructor(mutationId: DesignKnowledgeMutationId) {
    super(`design knowledge: mutation ${JSON.stringify(mutationId)} was replayed with different content`)
    this.name = 'DesignKnowledgeMutationConflictError'
    this.mutationId = mutationId
  }
}

/** One atomic source-projection or AI-authored graph change. */
export interface DesignKnowledgeDelta {
  readonly mutationId: DesignKnowledgeMutationId
  readonly pin: DesignKnowledgePin
  readonly upsertEntities: readonly DesignKnowledgeDeltaEntity[]
  readonly upsertRelations: readonly DesignKnowledgeDeltaRelation[]
  readonly removeRelations: readonly DesignKnowledgeRelationId[]
  readonly removeEntities: readonly DesignKnowledgeEntityId[]
}

/** Result of one committed or exactly replayed mutation. */
export interface DesignKnowledgeMutationResult {
  readonly revision: DesignKnowledgeRevision
  readonly replayed: boolean
}

/** Provider-neutral query filters; provider query languages never cross this API. */
export interface DesignKnowledgeQuery {
  readonly projectId: DesignProjectId
  readonly revision?: DesignKnowledgeRevision
  /** Case-insensitive literal substring of serialized entities/relations; spaces are literal, without tokenization or query-vector search. */
  readonly text?: string
  /** Exact ID lookup in the same snapshot, including endpoints outside a loaded page. */
  readonly entityIds?: readonly DesignKnowledgeEntityId[]
  readonly relationIds?: readonly DesignKnowledgeRelationId[]
  /** One-hop neighborhood; does not recursively expand newly discovered endpoints. */
  readonly incidentTo?: readonly DesignKnowledgeEntityId[]
  readonly direction?: 'incoming' | 'outgoing' | 'both'
  /** Exact provenance.evidence[].source values. Use recorded Design-Files-relative paths without adding a host root or design_files/ prefix. */
  readonly sourceFiles?: readonly string[]
  readonly entityTypes?: readonly string[]
  /** Schema-derived ontology instance types stored independently from physical record kinds. */
  readonly ontologyTypes?: readonly string[]
  readonly recordKinds?: readonly ('design-record' | 'design-content' | 'design-artifact')[]
  readonly identityQualities?: readonly ('stable' | 'structural' | 'anonymous')[]
  readonly relationTypes?: readonly string[]
  /** Shared reading facets, independent of exact storage types and lifecycle. */
  readonly relationMeanings?: readonly string[]
  readonly relationOrigins?: readonly string[]
  readonly lifecycles?: readonly DesignKnowledgeLifecycle[]
  readonly limit: number
  /** Opt into pagination. Continue with the returned revision and unchanged filters. */
  readonly offset?: number
}

/** Bounded graph query result. */
export interface DesignKnowledgeQueryResult {
  /** Persisted storage incarnation. Absent only for original/legacy providers. */
  readonly generation?: string
  readonly revision: DesignKnowledgeRevision
  readonly entities: readonly DesignKnowledgeEntity[]
  readonly relations: readonly DesignKnowledgeRelation[]
  /** Present for paginated queries; counts cover the full filtered snapshot, not the UI. */
  readonly page?: {
    readonly offset: number
    readonly nextOffset: number | null
    readonly totalEntities: number
    readonly totalRelations: number
  }
}

/** Trace one record back to its revision-addressed evidence. */
export type DesignKnowledgeTraceRequest = {
  readonly projectId: DesignProjectId
  readonly revision?: DesignKnowledgeRevision
} & (
  | { readonly target: 'entity'; readonly entityId: DesignKnowledgeEntityId }
  | { readonly target: 'relation'; readonly relationId: DesignKnowledgeRelationId }
)

/** Trace result for exactly one entity or relation. */
export interface DesignKnowledgeTraceResult {
  readonly revision: DesignKnowledgeRevision
  readonly evidence: readonly DesignKnowledgeEvidence[]
}

/** Select a bounded affected neighborhood around changed graph records. */
export interface DesignKnowledgeImpactRequest {
  readonly projectId: DesignProjectId
  readonly revision?: DesignKnowledgeRevision
  readonly entityIds: readonly DesignKnowledgeEntityId[]
  readonly relationIds: readonly DesignKnowledgeRelationId[]
  readonly depth: number
  readonly limit: number
}

/** One AI-authored proposal retained without human authority. */
export interface DesignKnowledgeProposal {
  readonly id: DesignKnowledgeProposalId
  readonly projectId: DesignProjectId
  readonly checkpoint: string
  readonly summary: string
  readonly entities: readonly DesignKnowledgeProposedEntity[]
  readonly relations: readonly DesignKnowledgeProposedRelation[]
}

/** One atomic group of independently decidable AI-authored proposals. */
export interface DesignKnowledgeProposalBatch {
  /** Idempotency identity for the whole all-or-nothing retention request. */
  readonly mutationId: DesignKnowledgeMutationId
  readonly proposals: readonly DesignKnowledgeProposal[]
  readonly pin: DesignKnowledgePin
}

/** Immutable identity and provider revision of one retained proposal. */
export interface DesignKnowledgeProposalReceipt {
  readonly proposalId: DesignKnowledgeProposalId
  readonly proposalRevision: DesignKnowledgeRevision
  readonly proposalDigest: DesignKnowledgeProposalDigest
}

/** Result of one committed or exactly replayed proposal batch. */
export interface DesignKnowledgeProposalBatchResult extends DesignKnowledgeMutationResult {
  /** Every receipt shares {@link revision}; the batch becomes visible at one revision. */
  readonly receipts: readonly DesignKnowledgeProposalReceipt[]
}

function canonicalKnowledgeJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('design knowledge: proposal numbers must be finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalKnowledgeJson).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('design knowledge: proposal must contain only JSON values')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalKnowledgeJson(record[key])}`).join(',')}}`
}

/** Compute the provider-neutral digest that binds review, replay, and migration. */
export function designKnowledgeProposalDigest(proposal: DesignKnowledgeProposal): DesignKnowledgeProposalDigest {
  return DesignKnowledgeProposalDigest(createHash('sha256').update(canonicalKnowledgeJson(proposal)).digest('hex'))
}

/** Journal-backed human disposition projected into the knowledge service. */
export interface DesignKnowledgeDecision {
  readonly projectId: DesignProjectId
  readonly proposalId: DesignKnowledgeProposalId
  /** Knowledge revision at which the human reviewed the immutable proposal id. */
  readonly proposalRevision: DesignKnowledgeRevision
  /** Provider-neutral digest of the exact proposal reviewed by the human. */
  readonly proposalDigest: DesignKnowledgeProposalDigest
  readonly decision: 'accepted' | 'rejected' | 'deferred'
  /** DesignJournal identity containing the authoritative human decision. */
  readonly journal: string
  readonly journalRevision: number
  readonly checkpoint: string
}

/**
 * Enforce the identity boundary before a human decision grants terminal
 * authority. Anonymous/content-addressed records remain searchable evidence,
 * but cannot silently become endpoints of accepted or rejected relationships.
 * Providers call this at the authority transition, not merely in one UI path.
 */
export function assertDesignKnowledgeDecisionAuthority(
  proposal: DesignKnowledgeProposal,
  decision: DesignKnowledgeDecision,
  visibleEntities: readonly DesignKnowledgeEntity[],
): void {
  if (decision.decision === 'deferred' || proposal.relations.length === 0) return
  const entities = new Map([...visibleEntities, ...proposal.entities].map(entity => [String(entity.id), entity]))
  const anonymousEndpoints = [...new Set(proposal.relations.flatMap(relation => [relation.from, relation.to])
    .filter(id => entities.get(String(id))?.properties.identityQuality === 'anonymous'))]
  if (anonymousEndpoints.length > 0) {
    throw new Error(`design knowledge: ${decision.decision} relationship cannot use anonymous endpoint ${JSON.stringify(anonymousEndpoints[0])}`)
  }
}

/** Neutral project-file archive; provider databases are rebuildable working caches. */
export interface DesignKnowledgeArchive {
  readonly formatVersion: 1
  readonly projectId: DesignProjectId
  readonly revision: DesignKnowledgeRevision
  readonly entities: readonly DesignKnowledgeEntity[]
  readonly relations: readonly DesignKnowledgeRelation[]
  readonly proposals: readonly DesignKnowledgeArchivedProposal[]
  readonly decisions: readonly DesignKnowledgeDecision[]
}

/** One exported proposal with its source-provider revision and neutral digest. */
export interface DesignKnowledgeArchivedProposal {
  readonly proposal: DesignKnowledgeProposal
  readonly proposalRevision: DesignKnowledgeRevision
  readonly proposalDigest: DesignKnowledgeProposalDigest
}

/** Result of importing a neutral archive into an empty provider namespace. */
export interface DesignKnowledgeImportReport {
  readonly revision: DesignKnowledgeRevision
  /** Explicit source-provider to target-provider revision remapping. */
  readonly sourceToTargetRevisions: Readonly<Record<string, DesignKnowledgeRevision>>
}

/**
 * Design Knowledge service definition. Implementations may use embedded or
 * remote graph engines, but must preserve Design System ids, atomic revisions,
 * compare-and-set, idempotency, and bounded results.
 */
export interface DesignKnowledgeService {
  /** Return the current provider revision for one project. */
  revision(projectId: DesignProjectId): Promise<DesignKnowledgeRevision>
  /** Commit observed/proposed records or replay its exact mutation id. Accepted lifecycle is decision-only. */
  applyDelta(delta: DesignKnowledgeDelta): Promise<DesignKnowledgeMutationResult>
  /** Query graph records without exposing a provider query language. */
  query(request: DesignKnowledgeQuery): Promise<DesignKnowledgeQueryResult>
  /** Trace exactly one entity or relation to its evidence. */
  trace(request: DesignKnowledgeTraceRequest): Promise<DesignKnowledgeTraceResult>
  /** Return a bounded affected neighborhood for Reflection and Alignment. */
  impact(request: DesignKnowledgeImpactRequest): Promise<DesignKnowledgeQueryResult>
  /** Retain an AI-authored proposal without granting accepted authority. */
  propose(proposal: DesignKnowledgeProposal, pin: DesignKnowledgePin): Promise<DesignKnowledgeMutationResult>
  /** Retain independently decidable proposals atomically at one visible revision. */
  proposeBatch(batch: DesignKnowledgeProposalBatch): Promise<DesignKnowledgeProposalBatchResult>
  /** Project one already-durable DesignJournal decision. */
  applyDecision(decision: DesignKnowledgeDecision, pin: DesignKnowledgePin): Promise<DesignKnowledgeMutationResult>
  /** Export a provider-neutral recovery and migration archive. */
  exportProject(projectId: DesignProjectId, revision?: DesignKnowledgeRevision): Promise<DesignKnowledgeArchive>
  /** Import one neutral archive into an empty project namespace. */
  importProject(archive: DesignKnowledgeArchive): Promise<DesignKnowledgeImportReport>
}
