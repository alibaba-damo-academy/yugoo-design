import { createHash } from 'node:crypto'
import {
  designKnowledgeProposalDigest,
  type DesignKnowledgeDecision,
  type DesignKnowledgeDelta,
  type DesignKnowledgeEntity,
  type DesignKnowledgePin,
  type DesignKnowledgeProposal,
  type DesignKnowledgeProposalBatch,
  type DesignKnowledgeRelation,
} from 'dsh-design-core'

const LIFECYCLES = new Set(['observed', 'proposed', 'accepted', 'rejected', 'superseded'])
const PRODUCERS = new Set(['grounding', 'reflection', 'alignment', 'design-file-projection', 'human-decision', 'source-analysis'])

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Design Knowledge values must contain only finite numbers')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('Design Knowledge values must be JSON serializable')
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/** Stable digest for one provider mutation request. */
export function requestDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** Stable digest binding mutation content and its full Pin. */
export function mutationDigest(delta: DesignKnowledgeDelta): string {
  return requestDigest(delta)
}

/** Bind one proposal replay to its full Pin. */
export function proposalRequestDigest(proposal: DesignKnowledgeProposal, pin: DesignKnowledgePin): string {
  return requestDigest({ proposal, pin })
}

/** Bind one atomic proposal-batch replay to every proposal and its full Pin. */
export function proposalBatchRequestDigest(batch: DesignKnowledgeProposalBatch): string {
  return requestDigest(batch)
}

/** Bind one journal decision replay to its full Pin. */
export function decisionRequestDigest(decision: DesignKnowledgeDecision, pin: DesignKnowledgePin): string {
  return requestDigest({ decision, pin })
}

function parsedRecord(payload: unknown, kind: 'entity' | 'relation'): Record<string, unknown> {
  if (typeof payload !== 'string') throw new Error(`Ladybug knowledge ${kind} payload is not text`)
  const value: unknown = JSON.parse(payload)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Ladybug knowledge ${kind} payload is not an object`)
  return value as Record<string, unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validProvenance(value: unknown): boolean {
  if (!record(value) || typeof value.producer !== 'string' || !PRODUCERS.has(value.producer) || typeof value.checkpoint !== 'string' || !Array.isArray(value.evidence)) return false
  return value.evidence.every((item) => record(item)
    && typeof item.source === 'string'
    && typeof item.revision === 'string'
    && (item.locator === undefined || typeof item.locator === 'string'))
}

function validCommon(value: Record<string, unknown>, expectedId: string): boolean {
  return value.id === expectedId
    && typeof value.lifecycle === 'string'
    && LIFECYCLES.has(value.lifecycle)
    && record(value.properties)
    && validProvenance(value.provenance)
}

/** Decode one provider-owned entity payload and reject corrupt durable bytes. */
export function decodeEntity(payload: unknown, expectedId: string): DesignKnowledgeEntity {
  const value = parsedRecord(payload, 'entity')
  if (!validCommon(value, expectedId) || typeof value.entityType !== 'string' || typeof value.label !== 'string') {
    throw new Error(`Ladybug knowledge entity ${JSON.stringify(expectedId)} has corrupt durable content`)
  }
  return value as unknown as DesignKnowledgeEntity
}

/** Decode one provider-owned relation payload and reject corrupt durable bytes. */
export function decodeRelation(payload: unknown, expectedId: string): DesignKnowledgeRelation {
  const value = parsedRecord(payload, 'relation')
  if (!validCommon(value, expectedId) || typeof value.relationType !== 'string' || typeof value.from !== 'string' || typeof value.to !== 'string') {
    throw new Error(`Ladybug knowledge relation ${JSON.stringify(expectedId)} has corrupt durable content`)
  }
  return value as unknown as DesignKnowledgeRelation
}

/** Encode provider-owned immutable JSON without losing branded ids. */
export function encodeRecord(value: DesignKnowledgeEntity | DesignKnowledgeRelation): string {
  return canonicalJson(value)
}

/** Encode a proposal after verifying its public neutral digest. */
export function encodeProposal(value: DesignKnowledgeProposal): { readonly payload: string; readonly digest: string } {
  const payload = canonicalJson(value)
  return { payload, digest: designKnowledgeProposalDigest(value) }
}

/** Decode one immutable proposal and verify its stored identity and digest. */
export function decodeProposal(payload: unknown, expectedId: string, expectedDigest: string): DesignKnowledgeProposal {
  if (typeof payload !== 'string') throw new Error('Ladybug knowledge proposal payload is not text')
  const value: unknown = JSON.parse(payload)
  if (!record(value) || value.id !== expectedId || typeof value.projectId !== 'string' || typeof value.checkpoint !== 'string'
    || typeof value.summary !== 'string' || !Array.isArray(value.entities) || !Array.isArray(value.relations)) {
    throw new Error(`Ladybug knowledge proposal ${JSON.stringify(expectedId)} has corrupt durable content`)
  }
  const proposal = value as unknown as DesignKnowledgeProposal
  for (const entity of proposal.entities) {
    if (decodeEntity(canonicalJson(entity), entity.id).lifecycle !== 'proposed') throw new Error('Ladybug knowledge proposal entity is not proposed')
  }
  for (const relation of proposal.relations) {
    if (decodeRelation(canonicalJson(relation), relation.id).lifecycle !== 'proposed') throw new Error('Ladybug knowledge proposal relation is not proposed')
  }
  if (designKnowledgeProposalDigest(proposal) !== expectedDigest) throw new Error(`Ladybug knowledge proposal ${JSON.stringify(expectedId)} digest is corrupt`)
  return proposal
}

/** Decode a durable journal decision. */
export function decodeDecision(payload: unknown): DesignKnowledgeDecision {
  if (typeof payload !== 'string') throw new Error('Ladybug knowledge decision payload is not text')
  const value: unknown = JSON.parse(payload)
  if (!record(value) || typeof value.projectId !== 'string' || typeof value.proposalId !== 'string'
    || typeof value.proposalRevision !== 'string' || typeof value.proposalDigest !== 'string'
    || !['accepted', 'rejected', 'deferred'].includes(String(value.decision)) || typeof value.journal !== 'string'
    || !Number.isSafeInteger(value.journalRevision) || Number(value.journalRevision) < 0 || typeof value.checkpoint !== 'string') {
    throw new Error('Ladybug knowledge decision has corrupt durable content')
  }
  return value as unknown as DesignKnowledgeDecision
}
