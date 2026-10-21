/**
 * Host-neutral persistent facts and folds for one design conversation.
 *
 * The journal is an append-only coordination record and read model. Design
 * Files remain authoritative for design content; folding a `design/changed`
 * fact never writes or replaces a Design File. `design/kit-selected` is an
 * audit fact only: Kit selection authority lives in the committed project
 * pin, and the fold never clears or rejects other facts on Kit identity.
 */
import {
  DesignAdvisoryId,
  parseDesignAdvisory,
  type DesignAdvisory,
  type DesignAdvisoryDecision,
} from './design-advisory.ts'
import { parseDesignClarityReported } from './design-clarity-report.ts'
import { MAX_CHECKPOINT_BYTES } from './design-clarity-authority.ts'
import {
  parseDesignChange,
  parseKitSelection,
  type DesignKitPin,
  type DesignJournalValue,
} from './design-journal-payloads.ts'
import { DesignBundleVersion, DesignKitVersion, type DesignChangedPayload, type DesignClarityReportedPayload, type DesignKitSelectedPayload } from './types.ts'
import { DesignExecutionInvocationId, type DesignExecutionPin } from './design-execution-runtime.ts'
import { DesignProjectId } from './design-project.ts'
import { DesignKnowledgeProposalDigest, DesignKnowledgeProposalId, DesignKnowledgeRevision } from './design-knowledge.ts'

/** Current serialized journal record version. */
export const DESIGN_JOURNAL_SCHEMA_VERSION = 3 as const

/** Advisory decision stored as a journal fact. */
export interface DesignJournalAdvisoryDecision {
  readonly advisoryId: DesignAdvisoryId
  readonly decision: DesignAdvisoryDecision
}

export type DesignAdvisoryInvalidationReason = 'resolved' | 'superseded'
export type DesignAdvisoryExecutionState = 'accepted' | 'queued' | 'running' | 'failed' | 'needs-user-input' | 'completed'
export type DesignAdvisoryActionState = 'ready' | 'running' | 'failed' | 'needs-user-input' | 'completed'
export type DesignAdvisoryExecutionAggregate = 'not-applicable' | DesignAdvisoryActionState

/** Evidence-backed invalidation emitted only by one complete advisory audit. */
export interface DesignJournalAdvisoryInvalidation {
  readonly advisoryId: DesignAdvisoryId
  readonly reason: DesignAdvisoryInvalidationReason
  readonly evidenceRevision: string
  readonly validationReceipt: string
}

/** One complete, atomically published advisory audit result (including an empty result). */
export interface DesignJournalAdvisorySet {
  readonly setId: string
  readonly advisories: readonly DesignAdvisory[]
  readonly invalidations: readonly DesignJournalAdvisoryInvalidation[]
}

/** Durable acceptance/execution receipt for an actionable advisory. */
export interface DesignJournalAdvisoryExecution {
  readonly advisoryId: DesignAdvisoryId
  readonly receiptId: string
  readonly state: DesignAdvisoryExecutionState
}

/** Exact Bundle authority minted atomically when a v2 advisory is accepted. */
export interface DesignAdvisoryActionTarget {
  readonly kitName: string
  readonly kitVersion: DesignKitVersion
  readonly skillName: string
  readonly bundleVersion: DesignBundleVersion
  readonly entityRefs: readonly string[]
}

/** One action receipt definition inside the atomic advisory acceptance fact. */
export interface DesignJournalAdvisoryActionReceipt {
  readonly actionId: string
  readonly receiptId: string
  readonly target: DesignAdvisoryActionTarget
}

/** Atomic human acceptance plus every executable action resolved from actionSpec. */
export interface DesignJournalAdvisoryAccepted {
  readonly advisoryId: DesignAdvisoryId
  readonly acceptanceReceiptId: string
  readonly actions: readonly DesignJournalAdvisoryActionReceipt[]
}

/** Agent follow-up choice; only a selected Bundle receives a scoped receipt. */
export type DesignAdvisorySelectionKind = 'bundle' | 'host-question' | 'host-research' | 'no-action'

/** Immutable choice bound to one already recorded human acceptance. */
export interface DesignJournalAdvisorySelection extends DesignJournalAdvisoryAccepted {
  readonly kind: DesignAdvisorySelectionKind
  /** Concise user-visible rationale, not hidden reasoning. */
  readonly reason: string
}

/** Choice plus its durable audit revision; attempts do not rewrite the choice. */
export interface DesignJournalAdvisorySelectionEntry extends DesignJournalAdvisorySelection {
  readonly journalRevision: number
}

/** One CAS transition for a logical advisory action execution attempt. */
export interface DesignJournalAdvisoryActionAttempt {
  readonly advisoryId: DesignAdvisoryId
  readonly receiptId: string
  readonly attemptId: string
  readonly logicalInvocationId: DesignExecutionInvocationId
  readonly state: Exclude<DesignAdvisoryActionState, 'ready'>
  /** Required only when atomically replacing an orphaned running attempt. */
  readonly supersedesAttemptId?: string
}

/** Folded state of one exact executable action receipt. */
export interface DesignJournalAdvisoryActionEntry extends DesignJournalAdvisoryActionReceipt {
  readonly state: DesignAdvisoryActionState
  readonly logicalInvocationId?: DesignExecutionInvocationId
  readonly attemptId?: string
}

/** Durable disposition of one exact must-edit gate after an authoritative panel commit. */
export interface DesignJournalExecutionHandoffConsumption {
  readonly invocationId: DesignExecutionInvocationId
  readonly pin: DesignExecutionPin
  readonly panelStateRevision: string
}

/** One human disposition for an exact Design Knowledge proposal. */
export interface DesignJournalKnowledgeDecision {
  readonly projectId: DesignProjectId
  readonly proposalId: DesignKnowledgeProposalId
  readonly proposalRevision: DesignKnowledgeRevision
  readonly proposalDigest: DesignKnowledgeProposalDigest
  readonly decision: 'accepted' | 'rejected' | 'deferred'
  readonly checkpoint: string
}

/** One knowledge decision together with its authoritative journal revision. */
export interface DesignJournalKnowledgeDecisionEntry extends DesignJournalKnowledgeDecision {
  readonly journalRevision: number
}

/**
 * One completed advisory review pass against an exact published Design
 * revision. An empty findings list is still a completion: it is the durable
 * evidence that the profile examined that revision. Failed, cancelled, or
 * stale runs are never recorded here. `knowledgeUsed` and `fallbackReason`
 * describe the actual KAG read path of the run, never its availability.
 */
export interface DesignJournalAdvisoryReviewCompletion {
  readonly profile: string
  /** Stable caller request identity for an explicit same-revision recheck. */
  readonly attemptId?: string
  readonly designRevision: number
  readonly commit: string
  readonly itemCount: number
  readonly knowledgeUsed: boolean
  /** Original KAG publication commit when a source-equivalent snapshot was used. */
  readonly knowledgeSourceCheckpoint?: string
  readonly fallbackReason?: string
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly vocabularyRevision: string
}

/** One review completion together with its authoritative journal revision. */
export interface DesignJournalAdvisoryReviewCompletionEntry extends DesignJournalAdvisoryReviewCompletion {
  readonly journalRevision: number
}

/**
 * Persisted audit wrapper for one clarity promotion: the report plus the
 * exact checkpoint it assessed. Replays repair the authority from this
 * checkpoint and never re-read the current HEAD.
 */
export interface DesignClarityAuditPayload {
  readonly assessedCheckpoint: string
  readonly report: DesignClarityReportedPayload
}

/** Audit read model of the latest clarity fact; current assessment authority is the project clarity.json, not this fold. */
export interface DesignJournalClarityEntry extends DesignClarityAuditPayload {
  readonly journalRevision: number
}

/** Minimal read-model entry for the latest Design Files change. */
export interface DesignJournalChangeEntry {
  readonly journalRevision: number
  readonly kit: string
  readonly version: DesignKitVersion
  readonly skill: string
  readonly commit?: string
}

/** The facts understood by the current journal fold. */
export type DesignJournalFact =
  | { readonly type: 'design/kit-selected'; readonly data: DesignKitSelectedPayload }
  | { readonly type: 'design/changed'; readonly data: DesignChangedPayload }
  | { readonly type: 'design/advisory-published'; readonly data: DesignAdvisory }
  | { readonly type: 'design/advisory-set-published'; readonly data: DesignJournalAdvisorySet }
  | { readonly type: 'design/advisory-decided'; readonly data: DesignJournalAdvisoryDecision }
  | { readonly type: 'design/advisory-execution'; readonly data: DesignJournalAdvisoryExecution }
  | { readonly type: 'design/advisory-accepted'; readonly data: DesignJournalAdvisoryAccepted }
  | { readonly type: 'design/advisory-action-selected'; readonly data: DesignJournalAdvisorySelection }
  | { readonly type: 'design/advisory-action-attempt'; readonly data: DesignJournalAdvisoryActionAttempt }
  | { readonly type: 'design/execution-handoff-consumed'; readonly data: DesignJournalExecutionHandoffConsumption }
  | { readonly type: 'design/knowledge-decided'; readonly data: DesignJournalKnowledgeDecision }
  | { readonly type: 'design/clarity-reported'; readonly data: DesignClarityAuditPayload }
  | { readonly type: 'design/advisory-review-completed'; readonly data: DesignJournalAdvisoryReviewCompletion }

/** One versioned, exactly positioned JSONL journal record. */
export type DesignJournalRecord = DesignJournalFact & {
  readonly schemaVersion: typeof DESIGN_JOURNAL_SCHEMA_VERSION
  readonly revision: number
  readonly publishedAt?: number
}

/** One advisory and its latest explicit disposition. */
export interface DesignJournalAdvisoryEntry {
  readonly publishedAt?: number
  readonly publishedRevision?: number
  readonly advisory: DesignAdvisory
  readonly status: 'pending' | DesignAdvisoryDecision | DesignAdvisoryExecutionState | 'invalidated'
  readonly setId?: string
  readonly acceptanceReceiptId?: string
  readonly selection?: DesignJournalAdvisorySelectionEntry
  readonly actionReceipts?: readonly DesignJournalAdvisoryActionEntry[]
  readonly executionStatus?: DesignAdvisoryExecutionAggregate
  readonly invalidation?: DesignJournalAdvisoryInvalidation
}

/** Latest complete audit envelope. It never implicitly disposes older entries. */
export interface DesignJournalAdvisorySetEntry {
  readonly setId: string
  readonly advisoryIds: readonly DesignAdvisoryId[]
  readonly journalRevision: number
}

/** Immutable read model derived from one conversation's journal. */
export interface DesignJournalSnapshot {
  readonly schemaVersion: typeof DESIGN_JOURNAL_SCHEMA_VERSION
  readonly revision: number
  /** Latest `design/kit-selected` audit fact. Selection authority lives in the committed project pin, never here. */
  readonly latestKitSelection?: DesignKitPin
  readonly design: Readonly<Record<string, DesignJournalValue>>
  readonly advisories: readonly DesignJournalAdvisoryEntry[]
  readonly latestAdvisorySet?: DesignJournalAdvisorySetEntry
  readonly consumedExecutionHandoffs: readonly DesignJournalExecutionHandoffConsumption[]
  readonly knowledgeDecisions: readonly DesignJournalKnowledgeDecisionEntry[]
  readonly latestClarity?: DesignJournalClarityEntry
  readonly latestDesignChange?: DesignJournalChangeEntry
  /** Latest completion per advisory profile; older passes are superseded. */
  readonly reviewCompletions: readonly DesignJournalAdvisoryReviewCompletionEntry[]
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${path}: expected a plain object`)
  }
  return value as Record<string, unknown>
}

function exactFields(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value)
  const missing = expected.filter((field) => !Object.hasOwn(value, field))
  const extra = actual.filter((field) => !expected.includes(field))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`${path}: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
}

function parseAdvisoryDecision(value: unknown): DesignJournalAdvisoryDecision {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['advisoryId', 'decision'], '$.data')
  if (typeof data.advisoryId !== 'string') throw new Error('$.data.advisoryId: expected a string')
  if (data.decision !== 'accepted' && data.decision !== 'rejected' && data.decision !== 'deferred') {
    throw new Error('$.data.decision: expected accepted, rejected, or deferred')
  }
  return Object.freeze({ advisoryId: DesignAdvisoryId(data.advisoryId), decision: data.decision })
}

function parseAdvisoryInvalidation(value: unknown, path: string): DesignJournalAdvisoryInvalidation {
  const data = plainRecord(value, path)
  exactFields(data, ['advisoryId', 'reason', 'evidenceRevision', 'validationReceipt'], path)
  if (typeof data.advisoryId !== 'string') throw new Error(`${path}.advisoryId: expected a string`)
  if (data.reason !== 'resolved' && data.reason !== 'superseded') {
    throw new Error(`${path}.reason: expected resolved or superseded`)
  }
  return Object.freeze({
    advisoryId: DesignAdvisoryId(data.advisoryId),
    reason: data.reason,
    evidenceRevision: boundedText(data.evidenceRevision, `${path}.evidenceRevision`, 512),
    validationReceipt: boundedText(data.validationReceipt, `${path}.validationReceipt`, 512),
  })
}

function parseAdvisorySet(value: unknown): DesignJournalAdvisorySet {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['setId', 'advisories', 'invalidations'], '$.data')
  const setId = boundedText(data.setId, '$.data.setId', 256)
  if (!Array.isArray(data.advisories)) throw new Error('$.data.advisories: expected an array')
  if (!Array.isArray(data.invalidations)) throw new Error('$.data.invalidations: expected an array')
  const advisories = data.advisories.map(parseDesignAdvisory)
  const invalidations = data.invalidations.map((item, index) => parseAdvisoryInvalidation(item, `$.data.invalidations[${index}]`))
  if (new Set(advisories.map(advisory => advisory.id)).size !== advisories.length) {
    throw new Error('$.data.advisories: duplicate advisory ids are not allowed')
  }
  if (new Set(invalidations.map(item => item.advisoryId)).size !== invalidations.length) {
    throw new Error('$.data.invalidations: duplicate advisory ids are not allowed')
  }
  return Object.freeze({ setId, advisories: Object.freeze(advisories), invalidations: Object.freeze(invalidations) })
}

function parseAdvisoryExecution(value: unknown): DesignJournalAdvisoryExecution {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['advisoryId', 'receiptId', 'state'], '$.data')
  if (typeof data.advisoryId !== 'string') throw new Error('$.data.advisoryId: expected a string')
  if (data.state !== 'accepted' && data.state !== 'queued' && data.state !== 'running'
    && data.state !== 'failed' && data.state !== 'needs-user-input' && data.state !== 'completed') {
    throw new Error('$.data.state: unsupported advisory execution state')
  }
  return Object.freeze({
    advisoryId: DesignAdvisoryId(data.advisoryId),
    receiptId: boundedText(data.receiptId, '$.data.receiptId', 256),
    state: data.state,
  })
}

export function parseDesignAdvisoryActionTarget(value: unknown, path = '$'): DesignAdvisoryActionTarget {
  const data = plainRecord(value, path)
  exactFields(data, ['kitName', 'kitVersion', 'skillName', 'bundleVersion', 'entityRefs'], path)
  if (!Array.isArray(data.entityRefs)) throw new Error(`${path}.entityRefs: expected an array`)
  const entityRefs = data.entityRefs.map((item, index) => boundedText(item, `${path}.entityRefs[${index}]`, 512))
  if (new Set(entityRefs).size !== entityRefs.length) throw new Error(`${path}.entityRefs: duplicate values are not allowed`)
  return Object.freeze({
    kitName: boundedText(data.kitName, `${path}.kitName`, 256),
    kitVersion: DesignKitVersion(boundedText(data.kitVersion, `${path}.kitVersion`, 64)),
    skillName: boundedText(data.skillName, `${path}.skillName`, 256),
    bundleVersion: DesignBundleVersion(boundedText(data.bundleVersion, `${path}.bundleVersion`, 64)),
    entityRefs: Object.freeze(entityRefs),
  })
}

/** Strict wire parser for one folded action receipt. */
export function parseDesignJournalAdvisoryActionEntry(value: unknown, path = '$'): DesignJournalAdvisoryActionEntry {
  const data = plainRecord(value, path)
  const hasAttempt = data.logicalInvocationId !== undefined || data.attemptId !== undefined
  exactFields(data, ['actionId', 'receiptId', 'target', 'state', ...(hasAttempt ? ['logicalInvocationId', 'attemptId'] : [])], path)
  if (data.state !== 'ready' && data.state !== 'running' && data.state !== 'failed'
    && data.state !== 'needs-user-input' && data.state !== 'completed') {
    throw new Error(`${path}.state: unsupported advisory action state`)
  }
  if (hasAttempt && (data.logicalInvocationId === undefined || data.attemptId === undefined)) {
    throw new Error(`${path}: logicalInvocationId and attemptId must be present together`)
  }
  if (data.state === 'ready' && hasAttempt) throw new Error(`${path}: ready action cannot carry an attempt`)
  if (data.state !== 'ready' && !hasAttempt) throw new Error(`${path}: attempted action requires invocation and attempt ids`)
  return Object.freeze({
    actionId: boundedText(data.actionId, `${path}.actionId`, 256),
    receiptId: boundedText(data.receiptId, `${path}.receiptId`, 256),
    target: parseDesignAdvisoryActionTarget(data.target, `${path}.target`),
    state: data.state,
    ...(hasAttempt ? {
      logicalInvocationId: DesignExecutionInvocationId(boundedText(data.logicalInvocationId, `${path}.logicalInvocationId`, 256)),
      attemptId: boundedText(data.attemptId, `${path}.attemptId`, 256),
    } : {}),
  })
}

function parseAdvisoryAccepted(value: unknown): DesignJournalAdvisoryAccepted {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['advisoryId', 'acceptanceReceiptId', 'actions'], '$.data')
  if (typeof data.advisoryId !== 'string') throw new Error('$.data.advisoryId: expected a string')
  if (!Array.isArray(data.actions)) throw new Error('$.data.actions: expected an array')
  const actions = data.actions.map((candidate, index) => {
    const action = plainRecord(candidate, `$.data.actions[${index}]`)
    exactFields(action, ['actionId', 'receiptId', 'target'], `$.data.actions[${index}]`)
    return Object.freeze({
      actionId: boundedText(action.actionId, `$.data.actions[${index}].actionId`, 256),
      receiptId: boundedText(action.receiptId, `$.data.actions[${index}].receiptId`, 256),
      target: parseDesignAdvisoryActionTarget(action.target, `$.data.actions[${index}].target`),
    })
  })
  if (new Set(actions.map(action => action.actionId)).size !== actions.length) {
    throw new Error('$.data.actions: duplicate actionId values are not allowed')
  }
  if (new Set(actions.map(action => action.receiptId)).size !== actions.length) {
    throw new Error('$.data.actions: duplicate receiptId values are not allowed')
  }
  return Object.freeze({
    advisoryId: DesignAdvisoryId(data.advisoryId),
    acceptanceReceiptId: boundedText(data.acceptanceReceiptId, '$.data.acceptanceReceiptId', 256),
    actions: Object.freeze(actions),
  })
}

/** Strict parser shared by the durable fact and host selection projection. */
export function parseDesignJournalAdvisorySelection(value: unknown): DesignJournalAdvisorySelection {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['advisoryId', 'acceptanceReceiptId', 'kind', 'reason', 'actions'], '$.data')
  if (data.kind !== 'bundle' && data.kind !== 'host-question'
    && data.kind !== 'host-research' && data.kind !== 'no-action') {
    throw new Error('$.data.kind: unsupported advisory selection kind')
  }
  const accepted = parseAdvisoryAccepted({
    advisoryId: data.advisoryId, acceptanceReceiptId: data.acceptanceReceiptId, actions: data.actions,
  })
  if (accepted.actions.length !== (data.kind === 'bundle' ? 1 : 0)) {
    throw new Error('$.data.actions: Bundle selection requires exactly one action; Host/no-action choices require none')
  }
  return Object.freeze({ ...accepted, kind: data.kind, reason: boundedText(data.reason, '$.data.reason', 2048) })
}

function parseAdvisoryActionAttempt(value: unknown): DesignJournalAdvisoryActionAttempt {
  const data = plainRecord(value, '$.data')
  const optional = data.supersedesAttemptId === undefined ? [] : ['supersedesAttemptId']
  exactFields(data, ['advisoryId', 'receiptId', 'attemptId', 'logicalInvocationId', 'state', ...optional], '$.data')
  if (typeof data.advisoryId !== 'string') throw new Error('$.data.advisoryId: expected a string')
  if (data.state !== 'running' && data.state !== 'failed'
    && data.state !== 'needs-user-input' && data.state !== 'completed') {
    throw new Error('$.data.state: unsupported advisory action attempt state')
  }
  return Object.freeze({
    advisoryId: DesignAdvisoryId(data.advisoryId),
    receiptId: boundedText(data.receiptId, '$.data.receiptId', 256),
    attemptId: boundedText(data.attemptId, '$.data.attemptId', 256),
    logicalInvocationId: DesignExecutionInvocationId(boundedText(data.logicalInvocationId, '$.data.logicalInvocationId', 256)),
    state: data.state,
    ...(data.supersedesAttemptId === undefined
      ? {}
      : { supersedesAttemptId: boundedText(data.supersedesAttemptId, '$.data.supersedesAttemptId', 256) }),
  })
}

function parseKnowledgeDecision(value: unknown): DesignJournalKnowledgeDecision {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['projectId', 'proposalId', 'proposalRevision', 'proposalDigest', 'decision', 'checkpoint'], '$.data')
  if (typeof data.projectId !== 'string') throw new Error('$.data.projectId: expected a string')
  if (typeof data.proposalId !== 'string') throw new Error('$.data.proposalId: expected a string')
  if (typeof data.proposalRevision !== 'string') throw new Error('$.data.proposalRevision: expected a string')
  if (typeof data.proposalDigest !== 'string') throw new Error('$.data.proposalDigest: expected a string')
  if (data.decision !== 'accepted' && data.decision !== 'rejected' && data.decision !== 'deferred') {
    throw new Error('$.data.decision: expected accepted, rejected, or deferred')
  }
  return Object.freeze({
    projectId: DesignProjectId(data.projectId),
    proposalId: DesignKnowledgeProposalId(data.proposalId),
    proposalRevision: DesignKnowledgeRevision(data.proposalRevision),
    proposalDigest: DesignKnowledgeProposalDigest(data.proposalDigest),
    decision: data.decision,
    checkpoint: boundedText(data.checkpoint, '$.data.checkpoint', 512),
  })
}

/**
 * Strictly parse one advisory review completion.
 * A completion without Knowledge must name the actual fallback reason; a
 * completion that used Knowledge must not carry one.
 * @param value - untrusted `design/advisory-review-completed` fact data.
 * @returns the frozen completion payload.
 */
export function parseAdvisoryReviewCompletion(value: unknown): DesignJournalAdvisoryReviewCompletion {
  const data = plainRecord(value, '$.data')
  if (data.attemptId !== undefined && (typeof data.attemptId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(data.attemptId))) {
    throw new Error('$.data.attemptId: expected a portable request identity')
  }
  const optional = [
    ...(data.fallbackReason === undefined ? [] : ['fallbackReason']),
    ...(data.attemptId === undefined ? [] : ['attemptId']),
    ...(data.knowledgeSourceCheckpoint === undefined ? [] : ['knowledgeSourceCheckpoint']),
  ]
  exactFields(data, ['profile', 'designRevision', 'commit', 'itemCount', 'knowledgeUsed', 'kit', 'kitVersion', 'vocabularyRevision', ...optional], '$.data')
  if (!Number.isSafeInteger(data.designRevision) || (data.designRevision as number) < 1) {
    throw new Error('$.data.designRevision: expected a positive safe integer')
  }
  if (!Number.isSafeInteger(data.itemCount) || (data.itemCount as number) < 0) {
    throw new Error('$.data.itemCount: expected a non-negative safe integer')
  }
  if (typeof data.knowledgeUsed !== 'boolean') throw new Error('$.data.knowledgeUsed: expected a boolean')
  if (data.knowledgeSourceCheckpoint !== undefined) {
    boundedText(data.knowledgeSourceCheckpoint, '$.data.knowledgeSourceCheckpoint', MAX_CHECKPOINT_BYTES)
    if (!data.knowledgeUsed) throw new Error('$.data.knowledgeSourceCheckpoint: requires knowledgeUsed')
  }
  if (data.fallbackReason !== undefined) {
    boundedText(data.fallbackReason, '$.data.fallbackReason', 256)
    if (data.knowledgeUsed) throw new Error('$.data.fallbackReason: a completion that used Knowledge carries no fallback reason')
  } else if (!data.knowledgeUsed) {
    throw new Error('$.data.fallbackReason: required when knowledgeUsed is false')
  }
  return Object.freeze({
    profile: boundedText(data.profile, '$.data.profile', 256),
    ...(data.attemptId === undefined ? {} : { attemptId: boundedText(data.attemptId, '$.data.attemptId', 64) }),
    designRevision: data.designRevision as number,
    commit: boundedText(data.commit, '$.data.commit', MAX_CHECKPOINT_BYTES),
    itemCount: data.itemCount as number,
    knowledgeUsed: data.knowledgeUsed,
    ...(data.knowledgeSourceCheckpoint === undefined ? {} : { knowledgeSourceCheckpoint: data.knowledgeSourceCheckpoint as string }),
    ...(data.fallbackReason === undefined ? {} : { fallbackReason: data.fallbackReason as string }),
    kit: boundedText(data.kit, '$.data.kit', 256),
    kitVersion: DesignKitVersion(boundedText(data.kitVersion, '$.data.kitVersion', 64)),
    vocabularyRevision: boundedText(data.vocabularyRevision, '$.data.vocabularyRevision', 256),
  })
}

/**
 * Strictly parse one clarity audit wrapper.
 * @param value - untrusted `design/clarity-reported` fact data.
 * @returns the frozen wrapper of assessed checkpoint plus validated report.
 */
export function parseDesignClarityAudit(value: unknown): DesignClarityAuditPayload {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['assessedCheckpoint', 'report'], '$.data')
  const assessedCheckpoint = boundedText(data.assessedCheckpoint, '$.data.assessedCheckpoint', MAX_CHECKPOINT_BYTES)
  return Object.freeze({ assessedCheckpoint, report: parseDesignClarityReported(data.report) })
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path}: expected non-empty text`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`${path}: exceeds ${maxBytes} UTF-8 bytes`)
  return value
}

/** Strictly parse one execution-handoff disposition. */
export function parseDesignJournalExecutionHandoffConsumption(value: unknown): DesignJournalExecutionHandoffConsumption {
  const data = plainRecord(value, '$.data')
  exactFields(data, ['invocationId', 'pin', 'panelStateRevision'], '$.data')
  const invocationId = DesignExecutionInvocationId(boundedText(data.invocationId, '$.data.invocationId', 256))
  const pin = plainRecord(data.pin, '$.data.pin')
  exactFields(pin, ['invocationId', 'projectId', 'kitName', 'kitVersion', 'skillName', 'bundleVersion', 'stateRevision'], '$.data.pin')
  const pinInvocationId = DesignExecutionInvocationId(boundedText(pin.invocationId, '$.data.pin.invocationId', 256))
  if (pinInvocationId !== invocationId) throw new Error('$.data.pin.invocationId: must match $.data.invocationId')
  const stateRevision = boundedText(pin.stateRevision, '$.data.pin.stateRevision', 512)
  const panelStateRevision = boundedText(data.panelStateRevision, '$.data.panelStateRevision', 512)
  if (panelStateRevision === stateRevision) {
    throw new Error('$.data.panelStateRevision: must differ from the gated state revision')
  }
  return Object.freeze({
    invocationId,
    pin: Object.freeze({
      invocationId: pinInvocationId,
      projectId: DesignProjectId(boundedText(pin.projectId, '$.data.pin.projectId', 64)),
      kitName: boundedText(pin.kitName, '$.data.pin.kitName', 256),
      kitVersion: DesignKitVersion(boundedText(pin.kitVersion, '$.data.pin.kitVersion', 64)),
      skillName: boundedText(pin.skillName, '$.data.pin.skillName', 256),
      bundleVersion: DesignBundleVersion(boundedText(pin.bundleVersion, '$.data.pin.bundleVersion', 64)),
      stateRevision,
    }),
    panelStateRevision,
  })
}

function strictPayload(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
  const data = plainRecord(value, '$.data')
  const presentOptional = optional.filter((field) => Object.hasOwn(data, field))
  exactFields(data, [...required, ...presentOptional], '$.data')
}

/**
 * Strictly parse one journal fact at an append or durable boundary.
 * @param value - untrusted fact value.
 * @returns a frozen fact using the existing design payload parsers.
 */
export function parseDesignJournalFact(value: unknown): DesignJournalFact {
  const fact = plainRecord(value, '$')
  exactFields(fact, ['type', 'data'], '$')
  switch (fact.type) {
    case 'design/kit-selected': {
      strictPayload(fact.data, ['kit', 'version', 'operation'], ['adoption'])
      return Object.freeze({ type: fact.type, data: Object.freeze(parseKitSelection(fact.data)) })
    }
    case 'design/changed': {
      strictPayload(fact.data, ['kit', 'version', 'skill', 'state', 'origin'], ['commit', 'panelYaml', 'skillManifest', 'execution'])
      return Object.freeze({ type: fact.type, data: Object.freeze(parseDesignChange(fact.data)) })
    }
    case 'design/advisory-published':
      return Object.freeze({ type: fact.type, data: parseDesignAdvisory(fact.data) })
    case 'design/advisory-set-published':
      return Object.freeze({ type: fact.type, data: parseAdvisorySet(fact.data) })
    case 'design/advisory-decided':
      return Object.freeze({ type: fact.type, data: parseAdvisoryDecision(fact.data) })
    case 'design/advisory-execution':
      return Object.freeze({ type: fact.type, data: parseAdvisoryExecution(fact.data) })
    case 'design/advisory-accepted':
      return Object.freeze({ type: fact.type, data: parseAdvisoryAccepted(fact.data) })
    case 'design/advisory-action-selected':
      return Object.freeze({ type: fact.type, data: parseDesignJournalAdvisorySelection(fact.data) })
    case 'design/advisory-action-attempt':
      return Object.freeze({ type: fact.type, data: parseAdvisoryActionAttempt(fact.data) })
    case 'design/execution-handoff-consumed':
      return Object.freeze({ type: fact.type, data: parseDesignJournalExecutionHandoffConsumption(fact.data) })
    case 'design/knowledge-decided':
      return Object.freeze({ type: fact.type, data: parseKnowledgeDecision(fact.data) })
    case 'design/advisory-review-completed':
      return Object.freeze({ type: fact.type, data: parseAdvisoryReviewCompletion(fact.data) })
    case 'design/clarity-reported': {
      strictPayload(fact.data, ['assessedCheckpoint', 'report'])
      return Object.freeze({ type: fact.type, data: parseDesignClarityAudit(fact.data) })
    }
    default:
      throw new Error(`$.type: unsupported design journal fact ${JSON.stringify(fact.type)}`)
  }
}

/**
 * Strictly parse one versioned journal record.
 * @param value - untrusted decoded JSON value.
 * @returns a frozen record with a positive safe-integer revision.
 */
export function parseDesignJournalRecord(value: unknown): DesignJournalRecord {
  const record = plainRecord(value, '$')
  exactFields(record, ['schemaVersion', 'revision', 'type', 'data', ...(record.publishedAt === undefined ? [] : ['publishedAt'])], '$')
  if (record.publishedAt !== undefined && (!Number.isSafeInteger(record.publishedAt) || (record.publishedAt as number) < 0 || (record.publishedAt as number) > 8640000000000000
    || record.type !== 'design/advisory-published')) throw new Error('$.publishedAt: expected an advisory publication timestamp')
  if (record.schemaVersion !== DESIGN_JOURNAL_SCHEMA_VERSION) {
    throw new Error(`$.schemaVersion: expected ${DESIGN_JOURNAL_SCHEMA_VERSION}`)
  }
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 1) {
    throw new Error('$.revision: expected a positive safe integer')
  }
  const fact = parseDesignJournalFact({ type: record.type, data: record.data })
  return Object.freeze({
    schemaVersion: DESIGN_JOURNAL_SCHEMA_VERSION,
    revision: record.revision as number,
    ...(record.publishedAt === undefined ? {} : { publishedAt: record.publishedAt as number }),
    ...fact,
  }) as DesignJournalRecord
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function initialSnapshot(): DesignJournalSnapshot {
  return Object.freeze({
    schemaVersion: DESIGN_JOURNAL_SCHEMA_VERSION,
    revision: 0,
    design: Object.freeze(Object.create(null) as Record<string, DesignJournalValue>),
    advisories: Object.freeze([]),
    consumedExecutionHandoffs: Object.freeze([]),
    knowledgeDecisions: Object.freeze([]),
    reviewCompletions: Object.freeze([]),
  })
}

/** Derive execution without conflating it with the advisory's human disposition. */
export function deriveAdvisoryExecutionStatus(
  actions: readonly DesignJournalAdvisoryActionEntry[],
): DesignAdvisoryExecutionAggregate {
  if (actions.length === 0) return 'not-applicable'
  if (actions.every(action => action.state === 'completed')) return 'completed'
  if (actions.some(action => action.state === 'running')) return 'running'
  if (actions.some(action => action.state === 'needs-user-input')) return 'needs-user-input'
  if (actions.some(action => action.state === 'failed')) return 'failed'
  return 'ready'
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function requireAcceptedActionsMatchSpec(
  advisory: Extract<DesignAdvisory, { readonly schemaVersion: 2 }>,
  actions: readonly DesignJournalAdvisoryActionReceipt[],
): void {
  if (advisory.actionSpec.kind === 'review-choice') {
    if (actions.length !== 0) throw new Error('design journal: review-choice acceptance cannot mint executable actions before selection')
    return
  }
  if (advisory.actionSpec.kind === 'none') {
    if (actions.length !== 0) throw new Error(`design journal: advisory ${JSON.stringify(advisory.id)} has no executable actions`)
    return
  }
  if (advisory.actionSpec.kind === 'bundle-revisions') {
    if (actions.length !== advisory.actionSpec.targets.length) {
      throw new Error(`design journal: advisory ${JSON.stringify(advisory.id)} resolved an incomplete Bundle action set`)
    }
    for (const target of advisory.actionSpec.targets) {
      const action = actions.find(candidate => candidate.actionId === `bundle:${target.skillName}`)
      if (action === undefined || action.target.skillName !== target.skillName
        || !sameStrings(action.target.entityRefs, target.entityRefs)) {
        throw new Error(`design journal: advisory ${JSON.stringify(advisory.id)} resolved a mismatched Bundle action`)
      }
    }
    return
  }
  if (actions.length > 1) {
    throw new Error(`design journal: advisory ${JSON.stringify(advisory.id)} resolved multiple providers for one semantic capability`)
  }
  const action = actions[0]
  if (action !== undefined && (action.actionId !== `capability:${advisory.actionSpec.capability}`
    || !sameStrings(action.target.entityRefs, advisory.actionSpec.entityRefs))) {
    throw new Error(`design journal: advisory ${JSON.stringify(advisory.id)} resolved a mismatched semantic-capability action`)
  }
}

/**
 * Apply one exactly-next record to a design journal snapshot.
 * @param state - previous immutable snapshot.
 * @param candidate - untrusted next record.
 * @returns the next immutable snapshot.
 */
export function applyDesignJournalRecord(
  state: DesignJournalSnapshot,
  candidate: unknown,
): DesignJournalSnapshot {
  const record = parseDesignJournalRecord(candidate)
  if (record.revision !== state.revision + 1) {
    throw new Error(`design journal: expected revision ${state.revision + 1}, received ${record.revision}`)
  }
  if (record.type === 'design/kit-selected') {
    return Object.freeze({
      ...state,
      revision: record.revision,
      latestKitSelection: Object.freeze({ kit: record.data.kit, version: record.data.version }),
    })
  }
  if (record.type === 'design/changed') {
    const value = Object.freeze({
      state: record.data.state,
      origin: record.data.origin,
      ...(record.data.panelYaml === undefined ? {} : { panelYaml: record.data.panelYaml }),
      ...(record.data.skillManifest === undefined ? {} : { skillManifest: record.data.skillManifest }),
    })
    const design = Object.assign(Object.create(null) as Record<string, DesignJournalValue>, state.design, {
      [record.data.skill]: value,
    })
    return Object.freeze({
      ...state,
      revision: record.revision,
      design: Object.freeze(design),
      latestDesignChange: Object.freeze({
        journalRevision: record.revision,
        kit: record.data.kit,
        version: record.data.version,
        skill: record.data.skill,
        ...(record.data.commit === undefined ? {} : { commit: record.data.commit }),
      }),
    })
  }
  if (record.type === 'design/advisory-set-published') {
    const advisories = [...state.advisories]
    for (const published of record.data.advisories) {
      const existing = advisories.find((entry) => entry.advisory.id === published.id)
      if (existing !== undefined) {
        if (canonical(existing.advisory) !== canonical(published)) {
          throw new Error(`design journal: advisory ${JSON.stringify(published.id)} was republished with different content`)
        }
        continue
      }
      advisories.push(Object.freeze({ advisory: published, status: 'pending' as const, setId: record.data.setId }))
    }
    for (const invalidation of record.data.invalidations) {
      const index = advisories.findIndex(entry => entry.advisory.id === invalidation.advisoryId)
      if (index < 0) {
        throw new Error(`design journal: invalidation references unknown advisory ${JSON.stringify(invalidation.advisoryId)}`)
      }
      const current = advisories[index] as DesignJournalAdvisoryEntry
      if (current.status === 'completed' || current.status === 'rejected') continue
      advisories[index] = Object.freeze({ ...current, status: 'invalidated' as const, invalidation })
    }
    return Object.freeze({
      ...state,
      revision: record.revision,
      advisories: Object.freeze(advisories),
      latestAdvisorySet: Object.freeze({
        setId: record.data.setId,
        advisoryIds: Object.freeze(record.data.advisories.map(advisory => advisory.id)),
        journalRevision: record.revision,
      }),
    })
  }
  if (record.type === 'design/advisory-published') {
    const existing = state.advisories.find((entry) => entry.advisory.id === record.data.id)
    if (existing !== undefined) {
      if (canonical(existing.advisory) !== canonical(record.data)) {
        throw new Error(`design journal: advisory ${JSON.stringify(record.data.id)} was republished with different content`)
      }
      return Object.freeze({ ...state, revision: record.revision })
    }
    return Object.freeze({
      ...state,
      revision: record.revision,
      advisories: Object.freeze([...state.advisories, Object.freeze({ advisory: record.data, status: 'pending' as const,
        publishedRevision: record.revision, ...(record.publishedAt === undefined ? {} : { publishedAt: record.publishedAt }) })]),
    })
  }
  if (record.type === 'design/execution-handoff-consumed') {
    const existing = state.consumedExecutionHandoffs.find((entry) => entry.invocationId === record.data.invocationId)
    if (existing !== undefined) {
      if (canonical(existing) !== canonical(record.data)) {
        throw new Error(`design journal: execution handoff ${JSON.stringify(record.data.invocationId)} was consumed with different authority`)
      }
      return Object.freeze({ ...state, revision: record.revision })
    }
    return Object.freeze({
      ...state,
      revision: record.revision,
      consumedExecutionHandoffs: Object.freeze([...state.consumedExecutionHandoffs, record.data]),
    })
  }
  if (record.type === 'design/clarity-reported') {
    return Object.freeze({
      ...state,
      revision: record.revision,
      latestClarity: Object.freeze({ ...record.data, journalRevision: record.revision }),
    })
  }
  if (record.type === 'design/knowledge-decided') {
    const existing = [...state.knowledgeDecisions].reverse().find((entry) => entry.proposalId === record.data.proposalId)
    if (existing?.decision === 'accepted' || existing?.decision === 'rejected') {
      if (existing.projectId !== record.data.projectId || existing.proposalRevision !== record.data.proposalRevision || existing.proposalDigest !== record.data.proposalDigest || existing.checkpoint !== record.data.checkpoint || existing.decision !== record.data.decision) {
        throw new Error(`design journal: terminal knowledge decision for ${JSON.stringify(record.data.proposalId)} cannot change`)
      }
      return Object.freeze({ ...state, revision: record.revision })
    }
    if (existing !== undefined && existing.projectId !== record.data.projectId) {
      throw new Error(`design journal: knowledge proposal ${JSON.stringify(record.data.proposalId)} cannot move between projects`)
    }
    const entry = Object.freeze({ ...record.data, journalRevision: record.revision })
    return Object.freeze({
      ...state,
      revision: record.revision,
      knowledgeDecisions: Object.freeze([...state.knowledgeDecisions, entry]),
    })
  }
  if (record.type === 'design/advisory-review-completed') {
    // Latest completion per profile supersedes the previous pass; the journal
    // keeps every fact for audit while the fold reads only the newest one.
    const completion = Object.freeze({ ...record.data, journalRevision: record.revision })
    const existing = state.reviewCompletions.find((entry) => entry.profile === completion.profile)
    // A late duplicate of an older pass never supersedes a newer completion;
    // the fact stays durable for audit while the fold keeps the newest pass.
    if (existing !== undefined && completion.designRevision < existing.designRevision) {
      return Object.freeze({ ...state, revision: record.revision })
    }
    const superseded = state.reviewCompletions.filter((entry) => entry.profile !== completion.profile)
    return Object.freeze({
      ...state,
      revision: record.revision,
      reviewCompletions: Object.freeze([...superseded, completion]),
    })
  }
  if (record.type === 'design/advisory-accepted') {
    const index = state.advisories.findIndex(entry => entry.advisory.id === record.data.advisoryId)
    if (index < 0) throw new Error(`design journal: acceptance references unknown advisory ${JSON.stringify(record.data.advisoryId)}`)
    const current = state.advisories[index] as DesignJournalAdvisoryEntry
    if (current.advisory.schemaVersion !== 2) {
      throw new Error(`design journal: legacy advisory ${JSON.stringify(record.data.advisoryId)} cannot mint action receipts`)
    }
    if (current.advisory.attention !== 'human-review') {
      throw new Error(`design journal: next-boundary advisory ${JSON.stringify(record.data.advisoryId)} cannot be accepted`)
    }
    if (current.status === 'rejected' || current.status === 'invalidated') {
      throw new Error(`design journal: disposed advisory ${JSON.stringify(record.data.advisoryId)} cannot be accepted`)
    }
    requireAcceptedActionsMatchSpec(current.advisory, record.data.actions)
    const conflictingAcceptance = state.advisories.find(entry => entry.advisory.id !== current.advisory.id
      && entry.acceptanceReceiptId === record.data.acceptanceReceiptId)
    if (conflictingAcceptance !== undefined) throw new Error('design journal: duplicate acceptance receipt id')
    const existingActionReceipts = new Set(state.advisories.flatMap(entry => entry.actionReceipts?.map(action => action.receiptId) ?? []))
    const existingAcceptanceReceipts = new Set(state.advisories.flatMap(entry => entry.acceptanceReceiptId === undefined ? [] : [entry.acceptanceReceiptId]))
    if (existingActionReceipts.has(record.data.acceptanceReceiptId)
      || record.data.actions.some(action => existingActionReceipts.has(action.receiptId)
        || existingAcceptanceReceipts.has(action.receiptId)
        || action.receiptId === record.data.acceptanceReceiptId)) {
      throw new Error('design journal: duplicate advisory action receipt id')
    }
    const actionReceipts = Object.freeze(record.data.actions.map(action => Object.freeze({ ...action, state: 'ready' as const })))
    if (current.acceptanceReceiptId !== undefined) {
      const same = current.acceptanceReceiptId === record.data.acceptanceReceiptId
        && canonical(current.actionReceipts ?? []) === canonical(actionReceipts)
      if (!same) throw new Error(`design journal: advisory ${JSON.stringify(record.data.advisoryId)} was accepted with different receipts`)
      return Object.freeze({ ...state, revision: record.revision })
    }
    const advisories = [...state.advisories]
    advisories[index] = Object.freeze({
      ...current,
      status: 'accepted' as const,
      acceptanceReceiptId: record.data.acceptanceReceiptId,
      actionReceipts,
      executionStatus: deriveAdvisoryExecutionStatus(actionReceipts),
    })
    return Object.freeze({ ...state, revision: record.revision, advisories: Object.freeze(advisories) })
  }
  if (record.type === 'design/advisory-action-selected') {
    const index = state.advisories.findIndex(entry => entry.advisory.id === record.data.advisoryId)
    const current = state.advisories[index]
    if (current === undefined) throw new Error('design journal: selection references unknown advisory')
    if (current.status !== 'accepted' || current.acceptanceReceiptId !== record.data.acceptanceReceiptId) {
      throw new Error('design journal: selection requires the exact active acceptance receipt')
    }
    if (current.advisory.schemaVersion !== 2 || current.advisory.actionSpec.kind !== 'review-choice') {
      throw new Error('design journal: selection requires a review-choice advisory')
    }
    const action = record.data.actions[0]
    if ((record.data.kind === 'host-question' && current.advisory.actionSpec.profile !== 'alignment')
      || (record.data.kind === 'host-research' && current.advisory.actionSpec.profile !== 'reflection')) {
      throw new Error('design journal: host selection does not match the accepted review profile')
    }
    if (action !== undefined && (action.actionId !== `bundle:${action.target.skillName}`
      || !sameStrings(action.target.entityRefs, current.advisory.actionSpec.entityRefs))) {
      throw new Error('design journal: selection action does not match the accepted entity scope')
    }
    if (current.selection !== undefined) {
      const { journalRevision: _revision, ...selection } = current.selection
      if (canonical(selection) !== canonical(record.data)) throw new Error('design journal: selected advisory cannot change choice or target')
      return Object.freeze({ ...state, revision: record.revision })
    }
    if ((current.actionReceipts?.length ?? 0) !== 0) throw new Error('design journal: selection cannot replace existing actions')
    const usedReceipts = new Set(state.advisories.flatMap(entry => [
      ...(entry.acceptanceReceiptId === undefined ? [] : [entry.acceptanceReceiptId]),
      ...(entry.actionReceipts?.map(receipt => receipt.receiptId) ?? []),
    ]))
    if (action !== undefined && usedReceipts.has(action.receiptId)) throw new Error('design journal: duplicate selected action receipt id')
    const actionReceipts = Object.freeze(record.data.actions.map(receipt => Object.freeze({ ...receipt, state: 'ready' as const })))
    const advisories = [...state.advisories]
    advisories[index] = Object.freeze({
      ...current,
      selection: Object.freeze({ ...record.data, journalRevision: record.revision }),
      actionReceipts,
      executionStatus: deriveAdvisoryExecutionStatus(actionReceipts),
    })
    return Object.freeze({ ...state, revision: record.revision, advisories: Object.freeze(advisories) })
  }
  if (record.type === 'design/advisory-action-attempt') {
    const advisoryIndex = state.advisories.findIndex(entry => entry.advisory.id === record.data.advisoryId)
    if (advisoryIndex < 0) throw new Error(`design journal: action attempt references unknown advisory ${JSON.stringify(record.data.advisoryId)}`)
    const advisory = state.advisories[advisoryIndex] as DesignJournalAdvisoryEntry
    const actionIndex = advisory.actionReceipts?.findIndex(action => action.receiptId === record.data.receiptId) ?? -1
    if (actionIndex < 0) throw new Error(`design journal: unknown action receipt ${JSON.stringify(record.data.receiptId)}`)
    const current = advisory.actionReceipts?.[actionIndex] as DesignJournalAdvisoryActionEntry
    if (record.data.state === 'running') {
      if (advisory.status === 'invalidated' || advisory.status === 'rejected') {
        throw new Error(`design journal: disposed advisory ${JSON.stringify(advisory.advisory.id)} cannot start an action attempt`)
      }
      if (current.state === 'completed') throw new Error(`design journal: completed action receipt ${JSON.stringify(current.receiptId)} cannot be reclaimed`)
      if (current.logicalInvocationId !== undefined && current.logicalInvocationId !== record.data.logicalInvocationId) {
        throw new Error(`design journal: action receipt ${JSON.stringify(current.receiptId)} cannot change logical invocation`)
      }
      if (current.state === 'running') {
        const sameAttempt = current.attemptId === record.data.attemptId
          && current.logicalInvocationId === record.data.logicalInvocationId
          && record.data.supersedesAttemptId === undefined
        if (sameAttempt) return Object.freeze({ ...state, revision: record.revision })
        if (record.data.supersedesAttemptId !== current.attemptId) {
          throw new Error(`design journal: running action receipt ${JSON.stringify(current.receiptId)} requires exact orphan attempt CAS`)
        }
      } else if (record.data.supersedesAttemptId !== undefined) {
        throw new Error(`design journal: action receipt ${JSON.stringify(current.receiptId)} has no running attempt to supersede`)
      }
    } else {
      if (record.data.supersedesAttemptId !== undefined) {
        throw new Error('design journal: only a running orphan reclaim may supersede an attempt')
      }
      if (current.attemptId !== record.data.attemptId || current.logicalInvocationId !== record.data.logicalInvocationId) {
        throw new Error(`design journal: action settlement does not own current attempt ${JSON.stringify(record.data.attemptId)}`)
      }
      if (current.state === record.data.state) return Object.freeze({ ...state, revision: record.revision })
      if (current.state !== 'running') {
        throw new Error(`design journal: action attempt ${JSON.stringify(record.data.attemptId)} cannot move from ${current.state} to ${record.data.state}`)
      }
    }
    const actionReceipts = [...(advisory.actionReceipts ?? [])]
    actionReceipts[actionIndex] = Object.freeze({
      ...current,
      state: record.data.state,
      logicalInvocationId: record.data.logicalInvocationId,
      attemptId: record.data.attemptId,
    })
    const advisories = [...state.advisories]
    advisories[advisoryIndex] = Object.freeze({
      ...advisory,
      actionReceipts: Object.freeze(actionReceipts),
      executionStatus: deriveAdvisoryExecutionStatus(actionReceipts),
    })
    return Object.freeze({ ...state, revision: record.revision, advisories: Object.freeze(advisories) })
  }
  if (record.type === 'design/advisory-execution') {
    const index = state.advisories.findIndex((entry) => entry.advisory.id === record.data.advisoryId)
    if (index < 0) {
      throw new Error(`design journal: execution references unknown advisory ${JSON.stringify(record.data.advisoryId)}`)
    }
    const current = state.advisories[index] as DesignJournalAdvisoryEntry
    if (current.advisory.schemaVersion === 2) {
      throw new Error(`design journal: v2 advisory ${JSON.stringify(record.data.advisoryId)} requires atomic action receipts`)
    }
    if (current.advisory.attention !== 'human-review') {
      throw new Error(`design journal: next-boundary advisory ${JSON.stringify(record.data.advisoryId)} cannot execute`)
    }
    if (current.status === 'rejected' || current.status === 'invalidated') {
      throw new Error(`design journal: disposed advisory ${JSON.stringify(record.data.advisoryId)} cannot execute`)
    }
    if (current.acceptanceReceiptId !== undefined && current.acceptanceReceiptId !== record.data.receiptId) {
      throw new Error(`design journal: advisory ${JSON.stringify(record.data.advisoryId)} has a different acceptance receipt`)
    }
    if (current.status === 'completed') {
      if (record.data.state !== 'completed') throw new Error(`design journal: completed advisory ${JSON.stringify(record.data.advisoryId)} cannot regress`)
      return Object.freeze({ ...state, revision: record.revision })
    }
    const allowed: Readonly<Record<DesignAdvisoryExecutionState, readonly DesignAdvisoryExecutionState[]>> = Object.freeze({
      accepted: ['accepted', 'queued', 'running', 'failed', 'needs-user-input', 'completed'],
      queued: ['queued', 'running', 'failed', 'needs-user-input', 'completed'],
      running: ['running', 'failed', 'needs-user-input', 'completed'],
      failed: ['failed', 'queued', 'running', 'needs-user-input', 'completed'],
      'needs-user-input': ['needs-user-input', 'queued', 'running', 'failed', 'completed'],
      completed: ['completed'],
    })
    if (current.acceptanceReceiptId === undefined && record.data.state !== 'accepted') {
      throw new Error(`design journal: advisory ${JSON.stringify(record.data.advisoryId)} must be accepted before execution advances`)
    }
    if (current.acceptanceReceiptId !== undefined
      && !allowed[current.status as DesignAdvisoryExecutionState]?.includes(record.data.state)) {
      throw new Error(`design journal: advisory ${JSON.stringify(record.data.advisoryId)} cannot move from ${current.status} to ${record.data.state}`)
    }
    const advisories = [...state.advisories]
    advisories[index] = Object.freeze({ ...current, status: record.data.state, acceptanceReceiptId: record.data.receiptId })
    return Object.freeze({ ...state, revision: record.revision, advisories: Object.freeze(advisories) })
  }
  const index = state.advisories.findIndex((entry) => entry.advisory.id === record.data.advisoryId)
  if (index < 0) {
    throw new Error(`design journal: decision references unknown advisory ${JSON.stringify(record.data.advisoryId)}`)
  }
  const current = state.advisories[index] as DesignJournalAdvisoryEntry
  if (current.advisory.schemaVersion === 2 && record.data.decision === 'accepted') {
    throw new Error(`design journal: v2 advisory ${JSON.stringify(record.data.advisoryId)} requires atomic acceptance and action receipts`)
  }
  if (current.advisory.attention !== 'human-review') {
    throw new Error(`design journal: next-boundary advisory ${JSON.stringify(record.data.advisoryId)} cannot receive a decision`)
  }
  if (current.status === 'accepted' || current.status === 'queued' || current.status === 'running'
    || current.status === 'failed' || current.status === 'needs-user-input' || current.status === 'completed'
    || current.status === 'invalidated' || current.status === 'rejected') {
    if (current.status !== record.data.decision) {
      throw new Error(`design journal: terminal decision for ${JSON.stringify(record.data.advisoryId)} cannot change`)
    }
    return Object.freeze({ ...state, revision: record.revision })
  }
  const advisories = [...state.advisories]
  advisories[index] = Object.freeze({ ...current, status: record.data.decision })
  return Object.freeze({ ...state, revision: record.revision, advisories: Object.freeze(advisories) })
}

/**
 * Fold a complete ordered record sequence into its current read model.
 * @param records - records in journal order.
 * @returns the exact latest snapshot, starting at revision zero when empty.
 */
export function foldDesignJournal(records: readonly unknown[]): DesignJournalSnapshot {
  return records.reduce<DesignJournalSnapshot>(applyDesignJournalRecord, initialSnapshot())
}
