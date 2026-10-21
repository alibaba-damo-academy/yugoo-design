/**
 * Deterministic DesignGraph projection: a pure, read-only fold of accepted
 * ground assertions, their promotion records, and fully pinned relationship
 * candidates into the two node domains and one traceability relationship
 * layer. The graph is a rebuildable projection, never an authority: it
 * performs no I/O, infers no node or edge the inputs do not carry, and never
 * writes back into Design Files, the assertion ledger, or any Kit state.
 * Rebuilding from the same pinned inputs yields the identical graph and
 * revision digest.
 */
import { createHash } from 'node:crypto'
import { GroundAssertionParseError, type GroundAssertion, type GroundAssertionId, type GroundProducedByRef, type GroundSourceAnchor } from './ground-assertions.ts'
import { GroundingPinMismatchError, requireGroundingPinMatch, type CompiledKitGrounding, type GroundRelation, type GroundRelationshipCandidate } from './kit-grounding-mapping.ts'
import type { AcceptedAssertionRecord, AssertionMappingProvenance } from './accepted-assertions.ts'

/** One graph node domain: designed-product entities or design rationale. */
export type DesignGraphNodeDomain = 'product' | 'rationale'

/**
 * The human promotion that accepted one rationale node: the exact ledger
 * transaction identity plus the persisted disposition digests and, when the
 * candidate originated through a Kit grounding mapping, its mapping pins.
 */
export interface RationalePromotionReference {
  readonly revision: number
  readonly candidateDigest: string
  readonly claimDigest: string
  readonly mapping?: AssertionMappingProvenance
}

/** One node of the projected DesignGraph. */
export interface DesignGraphNode {
  /** Stable deterministic identity; rationale nodes reuse the assertion id. */
  readonly id: string
  readonly domain: DesignGraphNodeDomain
  /** Semantic subject the node is anchored to. */
  readonly subject: string
  /** The accepted assertion this rationale node materializes, if any. */
  readonly assertionId?: GroundAssertionId
  /** The promotion transaction and persisted provenance behind an accepted assertion, if any. */
  readonly promotion?: RationalePromotionReference
  /** Evidence locations the node materializes from. */
  readonly sources: readonly GroundSourceAnchor[]
  /** Durable Grounding result and run the node materializes from. */
  readonly producedBy: GroundProducedByRef
}

/** One traceability edge; exactly one edge per relationship candidate. */
export interface DesignGraphEdge {
  /** The relationship candidate identity. */
  readonly id: string
  /** Closed seven-word traceability vocabulary, never extended here. */
  readonly relation: GroundRelation
  /** Origin product-node subject. */
  readonly from: string
  /** Target product-node subject. */
  readonly to: string
  readonly recordId: string
  readonly mappingId: string
  readonly source: GroundSourceAnchor
  readonly producedBy: GroundProducedByRef
  readonly kit: string
  readonly kitVersion: string
  readonly bundle: string
  readonly bundleVersion: string
  readonly mappingRevision: string
}

/** Pinned inputs of one DesignGraph projection; all values come from trusted reads. */
export interface DesignGraphProjectionInput {
  /** Design Project identity recorded by the accepted-assertion ledger. */
  readonly project: string
  /** Accepted-assertion ledger transaction revision the assertions fold from. */
  readonly assertionRevision: number
  /** Ledger checkpoint the caller observed alongside the assertions. */
  readonly checkpoint: string
  /** Full assertion read model; only lifecycle 'accepted' reaches the graph. */
  readonly assertions: readonly GroundAssertion[]
  /** Complete ledger transactions locating each accepted assertion's promotion. */
  readonly records: readonly AcceptedAssertionRecord[]
  /** Projected relationship candidates carrying complete mapping provenance. */
  readonly relationships: readonly GroundRelationshipCandidate[]
  /** Compiled Kit grounding every relationship candidate must pin against. */
  readonly grounding: CompiledKitGrounding
}

/** One complete deterministic graph projection. */
export interface DesignGraphProjection {
  /** SHA-256 binding project, revision, checkpoint, and canonical content. */
  readonly graphRevision: string
  /** Product and rationale nodes sorted by identity. */
  readonly nodes: readonly DesignGraphNode[]
  /** Traceability edges sorted by identity. */
  readonly edges: readonly DesignGraphEdge[]
  /** Assertions excluded by the lifecycle gate. */
  readonly skippedAssertions: number
}

/**
 * Project pinned inputs into one deterministic DesignGraph. Only lifecycle
 * 'accepted' assertions become rationale nodes, and each must be located in
 * exactly one promotion transaction whose persisted mapping pins, when
 * present, must still match the compiled grounding; every other lifecycle is
 * counted in skippedAssertions and never enters the graph. Product nodes
 * materialize from relationship endpoints and accepted claim subjects, and
 * duplicate subjects fold into one node. Every relationship candidate must
 * pin exactly against the compiled grounding or the projection fails loud
 * before producing any output. The result is pure: permuted inputs produce
 * the identical nodes, edges, and graph revision digest.
 * @param input - project, ledger pins, assertions, records, relationship candidates, and grounding.
 * @returns the complete sorted projection with its content-bound revision digest.
 */
export function projectDesignGraph(input: DesignGraphProjectionInput): DesignGraphProjection {
  requirePins(input)
  const promotionByAssertion = indexAcceptedPromotions(input.records, input.grounding)
  let skippedAssertions = 0
  const rationale: DesignGraphNode[] = []
  const accepted: GroundAssertion[] = []
  for (const assertion of input.assertions) {
    if (assertion.lifecycle !== 'accepted') {
      skippedAssertions += 1
      continue
    }
    if (assertion.claim.subject.trim() === '') {
      throw new GroundAssertionParseError(`assertion ${JSON.stringify(assertion.id)}.claim.subject`, 'an accepted assertion must anchor a non-empty subject')
    }
    const promotion = promotionByAssertion.get(assertion.id)
    if (promotion === undefined) {
      throw new GroundAssertionParseError(`assertion ${JSON.stringify(assertion.id)}`, 'an accepted assertion requires exactly one promotion transaction in the ledger records')
    }
    accepted.push(assertion)
    rationale.push(Object.freeze({
      id: assertion.id,
      domain: 'rationale',
      subject: assertion.claim.subject,
      assertionId: assertion.id,
      promotion,
      sources: Object.freeze([...assertion.sources]),
      producedBy: assertion.producedBy,
    }))
  }
  const edgeById = new Map<string, DesignGraphEdge>()
  for (const [index, candidate] of input.relationships.entries()) {
    requireCandidatePinMatch(input.grounding, candidate, `relationships[${index}]`)
    if (edgeById.has(candidate.id)) {
      throw new GroundAssertionParseError(`relationships[${index}].id`, `duplicate relationship identity ${JSON.stringify(candidate.id)}`)
    }
    edgeById.set(candidate.id, Object.freeze({
      id: candidate.id,
      relation: candidate.relation,
      from: candidate.from,
      to: candidate.to,
      recordId: candidate.recordId,
      mappingId: candidate.mappingId,
      source: candidate.source,
      producedBy: candidate.producedBy,
      kit: candidate.kit,
      kitVersion: candidate.kitVersion,
      bundle: candidate.bundle,
      bundleVersion: candidate.bundleVersion,
      mappingRevision: candidate.mappingRevision,
    }))
  }
  const edges = [...edgeById.values()].sort((first, second) => compareCodePoints(first.id, second.id))
  const productEvidence = new Map<string, { readonly sources: readonly GroundSourceAnchor[]; readonly producedBy: GroundProducedByRef }>()
  for (const assertion of accepted.sort((first, second) => compareCodePoints(first.id, second.id))) {
    if (!productEvidence.has(assertion.claim.subject)) {
      productEvidence.set(assertion.claim.subject, { sources: assertion.sources, producedBy: assertion.producedBy })
    }
  }
  for (const edge of edges) {
    for (const subject of [edge.from, edge.to]) {
      if (!productEvidence.has(subject)) productEvidence.set(subject, { sources: [edge.source], producedBy: edge.producedBy })
    }
  }
  const product: DesignGraphNode[] = [...productEvidence.entries()]
    .map(([subject, evidence]) => Object.freeze({
      id: productNodeId(subject),
      domain: 'product',
      subject,
      sources: Object.freeze([...evidence.sources]),
      producedBy: evidence.producedBy,
    }))
  const nodes = [...product, ...rationale].sort((first, second) => compareCodePoints(first.id, second.id))
  const graphRevision = sha256Hex(canonicalJson({
    assertionRevision: input.assertionRevision,
    assertions: [...input.assertions].sort((first, second) => compareCodePoints(first.id, second.id)).map(canonicalAssertion),
    checkpoint: input.checkpoint,
    project: input.project,
    records: [...input.records].sort((first, second) => first.revision - second.revision).map(canonicalRecord),
    relationships: [...input.relationships].sort((first, second) => compareCodePoints(first.id, second.id)).map(canonicalRelationship),
  }))
  return Object.freeze({ graphRevision, nodes: Object.freeze(nodes), edges: Object.freeze(edges), skippedAssertions })
}

function requirePins(input: DesignGraphProjectionInput): void {
  if (typeof input.project !== 'string' || input.project.trim() === '') {
    throw new GroundAssertionParseError('$.project', 'expected a non-empty string')
  }
  if (!Number.isSafeInteger(input.assertionRevision) || input.assertionRevision < 0) {
    throw new GroundAssertionParseError('$.assertionRevision', 'expected a non-negative safe integer')
  }
  if (typeof input.checkpoint !== 'string' || input.checkpoint.trim() === '') {
    throw new GroundAssertionParseError('$.checkpoint', 'expected a non-empty string')
  }
}

/**
 * Index every accepted assertion to its single promotion transaction. A
 * promotion whose persisted mapping provenance contradicts the compiled
 * grounding fails loud here, before any node is produced; a mapping-less
 * promotion stays mapping-less because semantic-mapping pins are optional.
 */
function indexAcceptedPromotions(records: readonly AcceptedAssertionRecord[], grounding: CompiledKitGrounding): Map<string, RationalePromotionReference> {
  const byAssertion = new Map<string, RationalePromotionReference>()
  for (const record of records) {
    if (record.kind !== 'promotion' || record.disposition.decision !== 'accepted') continue
    for (const entry of record.entries) {
      if (entry.origin !== 'accepted' || entry.assertion.lifecycle !== 'accepted') continue
      if (byAssertion.has(entry.assertion.id)) {
        throw new GroundAssertionParseError(`transaction ${record.revision}`, `assertion ${JSON.stringify(entry.assertion.id)} is accepted by more than one promotion transaction`)
      }
      if (record.disposition.mapping !== undefined) requireGroundingPinMatch(grounding, record.disposition.mapping)
      byAssertion.set(entry.assertion.id, Object.freeze({
        revision: record.revision,
        candidateDigest: record.disposition.candidateDigest,
        claimDigest: record.disposition.claimDigest,
        ...(record.disposition.mapping === undefined ? {} : { mapping: record.disposition.mapping }),
      }))
    }
  }
  return byAssertion
}

/**
 * Require one relationship candidate's provenance to equal the compiled
 * grounding exactly. Membership is checked against the Bundle's declared
 * relationship mappings, the only mappings that can produce edge candidates.
 */
function requireCandidatePinMatch(compiled: CompiledKitGrounding, candidate: GroundRelationshipCandidate, path: string): void {
  if (candidate.kit !== compiled.kit) throw new GroundingPinMismatchError('kit', compiled.kit, candidate.kit)
  if (candidate.kitVersion !== compiled.kitVersion) throw new GroundingPinMismatchError('kitVersion', compiled.kitVersion, candidate.kitVersion)
  const bundle = compiled.bundles[candidate.bundle]
  if (bundle === undefined) throw new GroundingPinMismatchError('bundle', Object.keys(compiled.bundles).sort().join(', '), candidate.bundle)
  if (candidate.bundleVersion !== bundle.bundleVersion) throw new GroundingPinMismatchError('bundleVersion', bundle.bundleVersion, candidate.bundleVersion)
  if (candidate.mappingRevision !== compiled.mappingRevision) throw new GroundingPinMismatchError('mappingRevision', compiled.mappingRevision, candidate.mappingRevision)
  if (!bundle.relationships.some((mapping) => mapping.id === candidate.mappingId)) {
    throw new GroundingPinMismatchError('mappingId', bundle.relationships.map((mapping) => mapping.id).sort().join(', '), candidate.mappingId)
  }
  if (candidate.id.trim() === '') throw new GroundAssertionParseError(`${path}.id`, 'expected a non-empty string')
  if (candidate.from.trim() === '' || candidate.to.trim() === '') {
    throw new GroundAssertionParseError(`${path}.from`, 'relationship endpoints must be non-empty strings')
  }
}

function productNodeId(subject: string): string {
  return `node:graph.product.${sha256Hex(canonicalJson({ scope: 'product-node', subject })).slice(0, 40)}`
}

function canonicalAssertion(assertion: GroundAssertion): unknown {
  return {
    id: assertion.id,
    kind: assertion.kind,
    claim: { subject: assertion.claim.subject, predicate: assertion.claim.predicate, value: assertion.claim.value, summary: assertion.claim.summary },
    authority: assertion.authority,
    lifecycle: assertion.lifecycle,
    supersedes: assertion.supersedes,
  }
}

function canonicalRecord(record: AcceptedAssertionRecord): unknown {
  return {
    kind: record.kind,
    revision: record.revision,
    project: record.project,
    checkpoint: record.checkpoint,
    entries: record.entries.map((entry) => ({ origin: entry.origin, id: entry.assertion.id, lifecycle: entry.assertion.lifecycle })),
    ...(record.kind === 'promotion' ? { disposition: record.disposition } : {}),
  }
}

function canonicalRelationship(candidate: GroundRelationshipCandidate): unknown {
  return {
    id: candidate.id,
    relation: candidate.relation,
    from: candidate.from,
    to: candidate.to,
    recordId: candidate.recordId,
    mappingId: candidate.mappingId,
    kit: candidate.kit,
    kitVersion: candidate.kitVersion,
    bundle: candidate.bundle,
    bundleVersion: candidate.bundleVersion,
    mappingRevision: candidate.mappingRevision,
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort(compareCodePoints)
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function compareCodePoints(first: string, second: string): number {
  const firstPoints = Array.from(first, (character) => character.codePointAt(0) as number)
  const secondPoints = Array.from(second, (character) => character.codePointAt(0) as number)
  const sharedLength = Math.min(firstPoints.length, secondPoints.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (firstPoints[index] as number) - (secondPoints[index] as number)
    if (difference !== 0) return difference
  }
  return firstPoints.length - secondPoints.length
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
