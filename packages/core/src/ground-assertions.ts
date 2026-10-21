/**
 * Pure domain rules for evidence-anchored GROUND assertions. Model and worker
 * output parses only as a candidate without authority. Trusted ingestion may
 * promote a candidate using a logged authority event. The durable assertion
 * ledger is authoritative; `ground.json` is a deterministic compatibility
 * projection.
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { createHash } from 'node:crypto'

/** JSON data accepted at durable and model-output boundaries. */
export type GroundJsonValue = null | boolean | number | string | GroundJsonValue[] | { [key: string]: GroundJsonValue }

/** What an assertion claims about its semantic subject. */
export type GroundAssertionKind = 'fact' | 'requirement' | 'constraint' | 'decision' | 'assumption' | 'question' | 'recommendation'

/** Authority recorded only by trusted ingestion. */
export type GroundAssertionAuthority = 'source_attested' | 'agent_selected_under_policy' | 'human_confirmed'

/** Explicit durable lifecycle. */
export type GroundAssertionLifecycle = 'proposed' | 'accepted' | 'rejected' | 'superseded'

/** Opaque stable identity of one assertion across lifecycle transitions. */
export type GroundAssertionId = Branded<'GroundAssertionId'>

/** Exact evidence location from which a candidate was derived. */
export interface GroundSourceAnchor {
  kind: 'design_file' | 'session_event' | 'research_artifact' | 'external_evidence'
  id: string
  revision: string
  locator?: string
}

/** Durable Grounding result and run that produced a candidate. */
export interface GroundProducedByRef {
  kind: 'grounding_result'
  resultId: string
  runId: string
  revision: string
}

/** Canonical semantic claim independent of the legacy JSON layout. */
export interface GroundSemanticClaim {
  subject: string
  predicate: string
  value: GroundJsonValue
  summary: string
}

/** Optional mapping into the legacy `ground.json` object. */
export interface GroundLegacyProjection {
  path: string
}

/**
 * Untrusted Grounding output. Authority and lifecycle are deliberately absent:
 * a model or worker cannot claim confirmation, delegation, or acceptance.
 */
export interface GroundAssertionCandidate {
  schemaVersion: 1
  id: GroundAssertionId
  kind: GroundAssertionKind
  claim: GroundSemanticClaim
  sources: readonly GroundSourceAnchor[]
  producedBy: GroundProducedByRef
  productAnchors: readonly string[]
  projection?: GroundLegacyProjection
  supersedes: readonly GroundAssertionId[]
}

/** Exact policy scope that authorized one agent-selected assertion. */
export interface GroundDelegationPolicyScope {
  assertionKind: GroundAssertionKind
  subject: string
  predicate: string
  productAnchors: readonly string[]
}

/** Logged evidence granting authority to a trusted promotion. */
export type GroundAuthorityEvidenceRef =
  | { kind: 'user_decision_event'; eventId: string; eventRevision: string; candidateDigest: string; claimDigest: string; decision: 'confirmed' }
  | { kind: 'delegation_policy_event'; eventId: string; eventRevision: string; candidateDigest: string; claimDigest: string; policyId: string; policyRevision: string; scope: GroundDelegationPolicyScope }
  | { kind: 'source_attestation_event'; eventId: string; eventRevision: string; candidateDigest: string; claimDigest: string; sourceId: string; sourceRevision: string }

/** Evidence verified against a candidate at the trusted event-ingestion seam. */
export interface GroundVerifiedAuthorityEvidence {
  readonly authority: GroundAssertionAuthority
  readonly evidence: GroundAuthorityEvidenceRef
}

/** One durable assertion after trusted ingestion or candidate retention. */
export interface GroundAssertion extends GroundAssertionCandidate {
  authority: 'agent_proposed' | GroundAssertionAuthority
  lifecycle: GroundAssertionLifecycle
  authorityEvidence?: GroundAuthorityEvidenceRef
}

/** Versioned durable assertion collection. */
export interface GroundAssertionDocument {
  schemaVersion: 1
  assertions: readonly GroundAssertion[]
}

/** One unresolved collision between confirmed assertions. */
export interface GroundAssertionConflict {
  firstId: GroundAssertionId
  secondId: GroundAssertionId
  reason: 'semantic_value_mismatch' | 'same_projection_path_different_value' | 'overlapping_projection_paths'
}

/** Strict parse failure carrying the rejected field path. */
export class GroundAssertionParseError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'GroundAssertionParseError'
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const CANDIDATE_KEYS = ['schemaVersion', 'id', 'kind', 'claim', 'sources', 'producedBy', 'productAnchors', 'projection', 'supersedes'] as const
const DURABLE_KEYS = [...CANDIDATE_KEYS, 'authority', 'lifecycle', 'authorityEvidence'] as const
const CLAIM_KEYS = ['subject', 'predicate', 'value', 'summary'] as const
const SOURCE_KEYS = ['kind', 'id', 'revision', 'locator'] as const
const PRODUCED_BY_KEYS = ['kind', 'resultId', 'runId', 'revision'] as const
const PROJECTION_KEYS = ['path'] as const
const EVIDENCE_BASE_KEYS = ['kind', 'eventId', 'eventRevision', 'candidateDigest', 'claimDigest'] as const
const POLICY_SCOPE_KEYS = ['assertionKind', 'subject', 'predicate', 'productAnchors'] as const
const ASSERTION_KINDS = new Set<GroundAssertionKind>(['fact', 'requirement', 'constraint', 'decision', 'assumption', 'question', 'recommendation'])
const DURABLE_AUTHORITIES = new Set<GroundAssertion['authority']>(['agent_proposed', 'source_attested', 'agent_selected_under_policy', 'human_confirmed'])
const LIFECYCLES = new Set<GroundAssertionLifecycle>(['proposed', 'accepted', 'rejected', 'superseded'])
const SOURCE_KINDS = new Set<GroundSourceAnchor['kind']>(['design_file', 'session_event', 'research_artifact', 'external_evidence'])
const ASSERTION_ID_RE = /^ground:[a-z0-9][a-z0-9._:-]{0,126}$/
const SHA256_RE = /^[a-f0-9]{64}$/
const verifiedAuthorityEvidence = new WeakSet<object>()

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

/** Validate and brand a stable assertion identity. */
export function GroundAssertionId(value: string, path = 'ground assertion id'): GroundAssertionId {
  if (!ASSERTION_ID_RE.test(value)) throw new GroundAssertionParseError(path, 'expected ground:<stable-id>')
  return value as GroundAssertionId
}

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new GroundAssertionParseError(path, 'expected a plain object')
  }
  return value as UnknownRecord
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort(compareCodePoints)
  if (unknown.length > 0) throw new GroundAssertionParseError(path, `unknown field ${JSON.stringify(unknown[0])}`)
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new GroundAssertionParseError(path, 'expected a non-empty string')
  return value
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, path: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) throw new GroundAssertionParseError(path, `unsupported value ${JSON.stringify(value)}`)
  return value as T
}

function isUnsafeToken(token: string): boolean {
  return token === '__proto__' || token === 'prototype' || token === 'constructor'
}

function jsonValue(value: unknown, path: string): GroundJsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new GroundAssertionParseError(path, 'numbers must be finite')
    return value
  }
  if (Array.isArray(value)) return value.map((item, index) => jsonValue(item, `${path}[${index}]`))
  const input = record(value, path)
  const output: Record<string, GroundJsonValue> = {}
  for (const key of Object.keys(input).sort(compareCodePoints)) {
    if (isUnsafeToken(key)) throw new GroundAssertionParseError(`${path}.${key}`, 'unsafe object key')
    output[key] = jsonValue(input[key], `${path}.${key}`)
  }
  return output
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new GroundAssertionParseError(path, 'expected an array')
  const result = value.map((item, index) => nonEmptyString(item, `${path}[${index}]`))
  if (new Set(result).size !== result.length) throw new GroundAssertionParseError(path, 'duplicate values are not allowed')
  return result
}

function pointerTokens(pointer: string, path: string): string[] {
  if (!pointer.startsWith('/') || pointer === '/') throw new GroundAssertionParseError(path, 'expected a non-root RFC 6901 pointer')
  const tokens = pointer.slice(1).split('/').map((token) => {
    if (/~(?:[^01]|$)/.test(token)) throw new GroundAssertionParseError(path, 'invalid RFC 6901 escape')
    return token.replace(/~1/g, '/').replace(/~0/g, '~')
  })
  for (const token of tokens) {
    if (token === '') throw new GroundAssertionParseError(path, 'empty path segments are not supported')
    if (isUnsafeToken(token)) throw new GroundAssertionParseError(path, `unsafe path segment ${JSON.stringify(token)}`)
  }
  return tokens
}

function parseSource(value: unknown, path: string): GroundSourceAnchor {
  const input = record(value, path)
  exactKeys(input, SOURCE_KEYS, path)
  const source: GroundSourceAnchor = {
    kind: enumValue(input.kind, SOURCE_KINDS, `${path}.kind`),
    id: nonEmptyString(input.id, `${path}.id`),
    revision: nonEmptyString(input.revision, `${path}.revision`),
  }
  if (input.locator !== undefined) source.locator = nonEmptyString(input.locator, `${path}.locator`)
  return source
}

function parseProducedBy(value: unknown, path: string): GroundProducedByRef {
  const input = record(value, path)
  exactKeys(input, PRODUCED_BY_KEYS, path)
  if (input.kind !== 'grounding_result') throw new GroundAssertionParseError(`${path}.kind`, 'expected grounding_result')
  return {
    kind: 'grounding_result',
    resultId: nonEmptyString(input.resultId, `${path}.resultId`),
    runId: nonEmptyString(input.runId, `${path}.runId`),
    revision: nonEmptyString(input.revision, `${path}.revision`),
  }
}

function parseClaim(value: unknown, path: string): GroundSemanticClaim {
  const input = record(value, path)
  exactKeys(input, CLAIM_KEYS, path)
  return {
    subject: nonEmptyString(input.subject, `${path}.subject`),
    predicate: nonEmptyString(input.predicate, `${path}.predicate`),
    value: jsonValue(input.value, `${path}.value`),
    summary: nonEmptyString(input.summary, `${path}.summary`),
  }
}

function parseProjection(value: unknown, path: string): GroundLegacyProjection {
  const input = record(value, path)
  exactKeys(input, PROJECTION_KEYS, path)
  const pointer = nonEmptyString(input.path, `${path}.path`)
  pointerTokens(pointer, `${path}.path`)
  return { path: pointer }
}

function parseCandidateFields(input: UnknownRecord, path: string): GroundAssertionCandidate {
  if (input.schemaVersion !== 1) throw new GroundAssertionParseError(`${path}.schemaVersion`, 'expected 1')
  if (!Array.isArray(input.sources) || input.sources.length === 0) throw new GroundAssertionParseError(`${path}.sources`, 'expected at least one source anchor')
  const candidate: GroundAssertionCandidate = {
    schemaVersion: 1,
    id: GroundAssertionId(nonEmptyString(input.id, `${path}.id`), `${path}.id`),
    kind: enumValue(input.kind, ASSERTION_KINDS, `${path}.kind`),
    claim: parseClaim(input.claim, `${path}.claim`),
    sources: input.sources.map((source, index) => parseSource(source, `${path}.sources[${index}]`)),
    producedBy: parseProducedBy(input.producedBy, `${path}.producedBy`),
    productAnchors: stringArray(input.productAnchors, `${path}.productAnchors`),
    supersedes: stringArray(input.supersedes, `${path}.supersedes`).map((id, index) => GroundAssertionId(id, `${path}.supersedes[${index}]`)),
  }
  if (input.projection !== undefined) candidate.projection = parseProjection(input.projection, `${path}.projection`)
  return candidate
}

/**
 * Parse model or worker output. Authority-bearing fields are unknown and fail
 * strict parsing, so this entry point cannot forge a confirmed assertion.
 */
export function parseGroundAssertionCandidate(value: unknown, path = '$'): GroundAssertionCandidate {
  const input = record(value, path)
  exactKeys(input, CANDIDATE_KEYS, path)
  return parseCandidateFields(input, path)
}

function parseAuthorityEvidence(value: unknown, path: string): GroundAuthorityEvidenceRef {
  const input = record(value, path)
  const kind = nonEmptyString(input.kind, `${path}.kind`)
  const base = {
    eventId: nonEmptyString(input.eventId, `${path}.eventId`),
    eventRevision: nonEmptyString(input.eventRevision, `${path}.eventRevision`),
    candidateDigest: digestString(input.candidateDigest, `${path}.candidateDigest`),
    claimDigest: digestString(input.claimDigest, `${path}.claimDigest`),
  }
  if (kind === 'user_decision_event') {
    exactKeys(input, [...EVIDENCE_BASE_KEYS, 'decision'], path)
    if (input.decision !== 'confirmed') throw new GroundAssertionParseError(`${path}.decision`, 'expected confirmed')
    return { kind, ...base, decision: 'confirmed' }
  }
  if (kind === 'delegation_policy_event') {
    exactKeys(input, [...EVIDENCE_BASE_KEYS, 'policyId', 'policyRevision', 'scope'], path)
    return {
      kind,
      ...base,
      policyId: nonEmptyString(input.policyId, `${path}.policyId`),
      policyRevision: nonEmptyString(input.policyRevision, `${path}.policyRevision`),
      scope: parseDelegationPolicyScope(input.scope, `${path}.scope`),
    }
  }
  if (kind === 'source_attestation_event') {
    exactKeys(input, [...EVIDENCE_BASE_KEYS, 'sourceId', 'sourceRevision'], path)
    return {
      kind,
      ...base,
      sourceId: nonEmptyString(input.sourceId, `${path}.sourceId`),
      sourceRevision: nonEmptyString(input.sourceRevision, `${path}.sourceRevision`),
    }
  }
  throw new GroundAssertionParseError(`${path}.kind`, `unsupported value ${JSON.stringify(kind)}`)
}

function digestString(value: unknown, path: string): string {
  const digest = nonEmptyString(value, path)
  if (!SHA256_RE.test(digest)) throw new GroundAssertionParseError(path, 'expected a lowercase SHA-256 digest')
  return digest
}

function parseDelegationPolicyScope(value: unknown, path: string): GroundDelegationPolicyScope {
  const input = record(value, path)
  exactKeys(input, POLICY_SCOPE_KEYS, path)
  return {
    assertionKind: enumValue(input.assertionKind, ASSERTION_KINDS, `${path}.assertionKind`),
    subject: nonEmptyString(input.subject, `${path}.subject`),
    predicate: nonEmptyString(input.predicate, `${path}.predicate`),
    productAnchors: stringArray(input.productAnchors, `${path}.productAnchors`),
  }
}

function evidenceMatchesAuthority(authority: GroundAssertionAuthority, evidence: GroundAuthorityEvidenceRef): boolean {
  return (authority === 'human_confirmed' && evidence.kind === 'user_decision_event')
    || (authority === 'agent_selected_under_policy' && evidence.kind === 'delegation_policy_event')
    || (authority === 'source_attested' && evidence.kind === 'source_attestation_event')
}

function equalStrings(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index])
}

function validateAuthorityEvidenceBinding(candidate: GroundAssertionCandidate, evidence: GroundAuthorityEvidenceRef, path: string): void {
  if (evidence.candidateDigest !== groundAssertionCandidateDigest(candidate)) {
    throw new GroundAssertionParseError(`${path}.candidateDigest`, 'authority event does not bind this candidate')
  }
  if (evidence.claimDigest !== groundAssertionClaimDigest(candidate.claim)) {
    throw new GroundAssertionParseError(`${path}.claimDigest`, 'authority event does not bind this claim')
  }
  if (evidence.kind === 'source_attestation_event') {
    const sourceMatches = candidate.sources.some((source) => source.id === evidence.sourceId && source.revision === evidence.sourceRevision)
    if (!sourceMatches) throw new GroundAssertionParseError(`${path}.sourceId`, 'attested source and revision are not a candidate source anchor')
  }
  if (evidence.kind === 'delegation_policy_event') {
    const scope = evidence.scope
    const scopeMatches = scope.assertionKind === candidate.kind
      && scope.subject === candidate.claim.subject
      && scope.predicate === candidate.claim.predicate
      && equalStrings(scope.productAnchors, candidate.productAnchors)
    if (!scopeMatches) throw new GroundAssertionParseError(`${path}.scope`, 'delegation policy scope does not match the candidate')
  }
}

/**
 * Verify a durable authority event against one candidate. The caller owns
 * resolving the input from its trusted event store; model output must never be
 * passed to this function as event evidence.
 */
export function verifyTrustedGroundAuthorityEvent(candidate: GroundAssertionCandidate, value: unknown): GroundVerifiedAuthorityEvidence {
  const normalized = parseGroundAssertionCandidate(candidate)
  const evidence = parseAuthorityEvidence(value, '$.authorityEvent')
  validateAuthorityEvidenceBinding(normalized, evidence, '$.authorityEvent')
  const authority: GroundAssertionAuthority = evidence.kind === 'user_decision_event'
    ? 'human_confirmed'
    : evidence.kind === 'delegation_policy_event'
      ? 'agent_selected_under_policy'
      : 'source_attested'
  const verified: GroundVerifiedAuthorityEvidence = Object.freeze({ authority, evidence: Object.freeze(evidence) })
  verifiedAuthorityEvidence.add(verified)
  return verified
}

/**
 * Promote a candidate using evidence minted at the trusted event-ingestion
 * seam. Plain objects and evidence verified for another candidate fail loud.
 */
export function promoteGroundAssertionCandidate(candidate: GroundAssertionCandidate, verified: GroundVerifiedAuthorityEvidence): GroundAssertion {
  const normalized = parseGroundAssertionCandidate(candidate)
  if (!verifiedAuthorityEvidence.has(verified)) throw new GroundAssertionParseError('$.authorityEvidence', 'expected evidence from trusted event verification')
  const evidence = parseAuthorityEvidence(verified.evidence, '$.authorityEvidence')
  if (!evidenceMatchesAuthority(verified.authority, evidence)) throw new GroundAssertionParseError('$.authority', 'authority does not match logged evidence kind')
  validateAuthorityEvidenceBinding(normalized, evidence, '$.authorityEvidence')
  if (normalized.kind === 'assumption' || normalized.kind === 'question' || normalized.kind === 'recommendation') {
    throw new GroundAssertionParseError('$.kind', `${normalized.kind} cannot become a confirmed public fact`)
  }
  return { ...normalized, authority: verified.authority, lifecycle: 'accepted', authorityEvidence: evidence }
}

/** Retain untrusted output as a non-authoritative proposed or rejected record. */
export function retainGroundAssertionCandidate(candidate: GroundAssertionCandidate, lifecycle: 'proposed' | 'rejected'): GroundAssertion {
  return { ...parseGroundAssertionCandidate(candidate), authority: 'agent_proposed', lifecycle }
}

/** Strict parser for one durable assertion from trusted storage, not model output. */
export function parseGroundAssertion(value: unknown, path = '$'): GroundAssertion {
  const input = record(value, path)
  exactKeys(input, DURABLE_KEYS, path)
  const candidate = parseCandidateFields(input, path)
  const authority = enumValue(input.authority, DURABLE_AUTHORITIES, `${path}.authority`)
  const lifecycle = enumValue(input.lifecycle, LIFECYCLES, `${path}.lifecycle`)
  const assertion: GroundAssertion = { ...candidate, authority, lifecycle }
  if (input.authorityEvidence !== undefined) assertion.authorityEvidence = parseAuthorityEvidence(input.authorityEvidence, `${path}.authorityEvidence`)
  return assertion
}

/** Strict parser for the trusted durable assertion ledger, not model output. */
export function parseTrustedGroundAssertionDocument(value: string | unknown): GroundAssertionDocument {
  let decoded: unknown = value
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value) as unknown
    } catch (error) {
      throw new GroundAssertionParseError('$', `invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const document = record(decoded, '$')
  exactKeys(document, ['schemaVersion', 'assertions'], '$')
  if (document.schemaVersion !== 1) throw new GroundAssertionParseError('$.schemaVersion', 'expected 1')
  if (!Array.isArray(document.assertions)) throw new GroundAssertionParseError('$.assertions', 'expected an array')
  const assertions = document.assertions.map((value, index) => parseGroundAssertion(value, `$.assertions[${index}]`))
  validateGroundAssertionSet(assertions)
  return { schemaVersion: 1, assertions }
}

function canonicalJson(value: GroundJsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort(compareCodePoints).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as GroundJsonValue)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: GroundJsonValue): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

/** Return the canonical digest bound by an authority event. */
export function groundAssertionClaimDigest(claim: GroundSemanticClaim): string {
  const normalized = parseClaim(claim, '$.claim')
  return sha256({
    predicate: normalized.predicate,
    subject: normalized.subject,
    summary: normalized.summary,
    value: normalized.value,
  })
}

/** Return the canonical digest of all authority-relevant candidate fields. */
export function groundAssertionCandidateDigest(candidate: GroundAssertionCandidate): string {
  const candidateValue: UnknownRecord = {
    schemaVersion: candidate.schemaVersion,
    id: candidate.id,
    kind: candidate.kind,
    claim: candidate.claim,
    sources: candidate.sources,
    producedBy: candidate.producedBy,
    productAnchors: candidate.productAnchors,
    supersedes: candidate.supersedes,
  }
  if (candidate.projection !== undefined) candidateValue.projection = candidate.projection
  const normalized = parseGroundAssertionCandidate(candidateValue)
  const sources: GroundJsonValue[] = normalized.sources.map((source) => {
    const value: Record<string, GroundJsonValue> = { id: source.id, kind: source.kind, revision: source.revision }
    if (source.locator !== undefined) value.locator = source.locator
    return value
  })
  const value: Record<string, GroundJsonValue> = {
    claim: {
      predicate: normalized.claim.predicate,
      subject: normalized.claim.subject,
      summary: normalized.claim.summary,
      value: normalized.claim.value,
    },
    id: normalized.id,
    kind: normalized.kind,
    producedBy: {
      kind: normalized.producedBy.kind,
      resultId: normalized.producedBy.resultId,
      revision: normalized.producedBy.revision,
      runId: normalized.producedBy.runId,
    },
    productAnchors: [...normalized.productAnchors],
    schemaVersion: normalized.schemaVersion,
    sources,
    supersedes: [...normalized.supersedes],
  }
  if (normalized.projection !== undefined) value.projection = { path: normalized.projection.path }
  return sha256(value)
}

function isConfirmed(assertion: GroundAssertion): boolean {
  return assertion.lifecycle === 'accepted' && assertion.authority !== 'agent_proposed'
}

function pathsOverlap(first: string[], second: string[]): boolean {
  const shared = Math.min(first.length, second.length)
  for (let index = 0; index < shared; index += 1) if (first[index] !== second[index]) return false
  return true
}

/** Find semantic and compatibility-projection conflicts among confirmed assertions. */
export function findGroundAssertionConflicts(assertions: readonly GroundAssertion[]): GroundAssertionConflict[] {
  const candidates = assertions.filter(isConfirmed).toSorted((first, second) => compareCodePoints(first.id, second.id))
  const conflicts: GroundAssertionConflict[] = []
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = candidates[firstIndex] as GroundAssertion
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = candidates[secondIndex] as GroundAssertion
      const valuesDiffer = canonicalJson(first.claim.value) !== canonicalJson(second.claim.value)
      if (first.claim.subject === second.claim.subject && first.claim.predicate === second.claim.predicate && valuesDiffer) {
        conflicts.push({ firstId: first.id, secondId: second.id, reason: 'semantic_value_mismatch' })
        continue
      }
      if (first.projection === undefined || second.projection === undefined) continue
      const firstTokens = pointerTokens(first.projection.path, `assertion ${first.id}`)
      const secondTokens = pointerTokens(second.projection.path, `assertion ${second.id}`)
      if (!pathsOverlap(firstTokens, secondTokens)) continue
      if (first.projection.path === second.projection.path && !valuesDiffer) continue
      conflicts.push({
        firstId: first.id,
        secondId: second.id,
        reason: first.projection.path === second.projection.path ? 'same_projection_path_different_value' : 'overlapping_projection_paths',
      })
    }
  }
  return conflicts
}

function sameSemanticSlot(first: GroundAssertion, second: GroundAssertion): boolean {
  return first.claim.subject === second.claim.subject && first.claim.predicate === second.claim.predicate
}

/**
 * Validate authority evidence, linear supersession history, and confirmed
 * conflicts. Superseded records may point to their predecessor, permitting a
 * complete A -> B -> C chain; branching and cycles fail loud.
 */
export function validateGroundAssertionSet(assertions: readonly GroundAssertion[]): void {
  const byId = new Map<GroundAssertionId, GroundAssertion>()
  for (const assertion of assertions) {
    if (byId.has(assertion.id)) throw new GroundAssertionParseError('$.assertions', `duplicate assertion id ${JSON.stringify(assertion.id)}`)
    byId.set(assertion.id, assertion)
    if (assertion.supersedes.includes(assertion.id)) throw new GroundAssertionParseError(`assertion ${assertion.id}.supersedes`, 'an assertion cannot supersede itself')
    if (assertion.supersedes.length > 1) throw new GroundAssertionParseError(`assertion ${assertion.id}.supersedes`, 'an assertion may supersede at most one predecessor')
    const confirmedLifecycle = assertion.lifecycle === 'accepted' || assertion.lifecycle === 'superseded'
    if (confirmedLifecycle) {
      if (assertion.authority === 'agent_proposed') throw new GroundAssertionParseError(`assertion ${assertion.id}.authority`, `${assertion.lifecycle} assertion needs trusted authority`)
      if (assertion.authorityEvidence === undefined) throw new GroundAssertionParseError(`assertion ${assertion.id}.authorityEvidence`, 'confirmed assertion needs logged authority evidence')
      if (!evidenceMatchesAuthority(assertion.authority, assertion.authorityEvidence)) throw new GroundAssertionParseError(`assertion ${assertion.id}.authorityEvidence`, 'evidence kind does not match authority')
      validateAuthorityEvidenceBinding(assertion, assertion.authorityEvidence, `assertion ${assertion.id}.authorityEvidence`)
      if (assertion.kind === 'assumption' || assertion.kind === 'question' || assertion.kind === 'recommendation') throw new GroundAssertionParseError(`assertion ${assertion.id}.kind`, `${assertion.kind} cannot become a confirmed public fact`)
    } else if (assertion.authority !== 'agent_proposed' || assertion.authorityEvidence !== undefined) {
      throw new GroundAssertionParseError(`assertion ${assertion.id}.authority`, `${assertion.lifecycle} assertion must remain agent_proposed without authority evidence`)
    }
  }
  const replacements = new Map<GroundAssertionId, GroundAssertionId[]>()
  for (const assertion of assertions) {
    for (const targetId of assertion.supersedes) {
      const target = byId.get(targetId)
      if (target === undefined) throw new GroundAssertionParseError(`assertion ${assertion.id}.supersedes`, `unknown assertion ${JSON.stringify(targetId)}`)
      if (!sameSemanticSlot(assertion, target)) throw new GroundAssertionParseError(`assertion ${assertion.id}.supersedes`, 'replacement and target must use the same semantic subject and predicate')
      if (assertion.projection?.path !== target.projection?.path) throw new GroundAssertionParseError(`assertion ${assertion.id}.supersedes`, 'replacement and target must use the same legacy projection mapping')
      // Proposed and rejected candidates retain replacement intent without
      // changing the target's lifecycle. Only confirmation activates it.
      if (assertion.lifecycle !== 'accepted' && assertion.lifecycle !== 'superseded') continue
      const current = replacements.get(targetId) ?? []
      current.push(assertion.id)
      replacements.set(targetId, current)
    }
  }
  for (const assertion of assertions) {
    const replacementIds = replacements.get(assertion.id) ?? []
    if (assertion.lifecycle === 'superseded' && replacementIds.length === 0) throw new GroundAssertionParseError(`assertion ${assertion.id}.lifecycle`, 'superseded assertion has no confirmed replacement')
    if (assertion.lifecycle !== 'superseded' && replacementIds.length > 0) throw new GroundAssertionParseError(`assertion ${assertion.id}.lifecycle`, `superseded by ${replacementIds.join(', ')} but lifecycle is ${assertion.lifecycle}`)
    if (replacementIds.length > 1) throw new GroundAssertionParseError(`assertion ${assertion.id}`, `multiple replacements supersede one assertion: ${replacementIds.sort(compareCodePoints).join(', ')}`)
  }
  for (const assertion of assertions) {
    if (assertion.lifecycle !== 'superseded') continue
    const visited = new Set<GroundAssertionId>([assertion.id])
    let cursor = assertion.id
    while (true) {
      const replacement = replacements.get(cursor)?.[0]
      if (replacement === undefined) break
      if (visited.has(replacement)) throw new GroundAssertionParseError(`assertion ${assertion.id}`, 'supersession chain contains a cycle')
      visited.add(replacement)
      cursor = replacement
    }
  }
  const conflict = findGroundAssertionConflicts(assertions)[0]
  if (conflict !== undefined) throw new GroundAssertionParseError('$.assertions', `confirmed assertions ${conflict.firstId} and ${conflict.secondId} conflict (${conflict.reason})`)
}

function setProjectedValue(root: Record<string, GroundJsonValue>, pointer: string, value: GroundJsonValue): void {
  const tokens = pointerTokens(pointer, pointer)
  let current = root
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as string
    const existing = current[token]
    if (existing !== undefined && (existing === null || typeof existing !== 'object' || Array.isArray(existing))) {
      throw new GroundAssertionParseError(pointer, `cannot traverse non-object projection value at ${JSON.stringify(token)}`)
    }
    const next: Record<string, GroundJsonValue> = existing ?? {}
    if (existing === undefined) current[token] = next
    current = next
  }
  current[tokens[tokens.length - 1] as string] = value
}

/** Project confirmed assertions with mappings into legacy `ground.json`. */
export function projectLegacyGround(assertions: readonly GroundAssertion[]): Record<string, GroundJsonValue> {
  validateGroundAssertionSet(assertions)
  const projected: Record<string, GroundJsonValue> = {}
  const candidates = assertions
    .filter((assertion) => isConfirmed(assertion) && assertion.projection !== undefined)
    .toSorted((first, second) => compareCodePoints((first.projection as GroundLegacyProjection).path, (second.projection as GroundLegacyProjection).path) || compareCodePoints(first.id, second.id))
  for (const assertion of candidates) setProjectedValue(projected, (assertion.projection as GroundLegacyProjection).path, jsonValue(assertion.claim.value, assertion.claim.subject))
  return projected
}
