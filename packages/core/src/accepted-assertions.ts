/**
 * Project-scoped durable repository for Ground assertions (delivery-plan G1).
 *
 * One repository instance owns exactly one Design Project's assertion ledger.
 * The adapter resolves the root directory per project, exclusively; a root is
 * never shared across projects and this class is not a global store. Storage
 * lives outside the project Git repository, beside the other per-project
 * runtime state. The repository is Kit-neutral: it stores no Kit-specific
 * entity names and never reads Git, Design Files, or host packages. It owns
 * no presentation semantics; consumers such as promotion and advisory query
 * ports read it through the neutral revision-addressed API.
 *
 * Every mutation executes compare-and-set before any write: the caller
 * supplies the checkpoint the candidate evidence was produced against and the
 * checkpoint it observes as current; a mismatch means the candidate is stale
 * and fails loud with zero writes. Mutations also compare-and-set the exact
 * read revision. One JSONL line holds one whole transaction, so every
 * committed revision replays a complete valid state and a torn final line
 * discards only the transaction that never landed.
 *
 * Schema 2 records form a discriminated union. Retention transactions keep
 * advisory output without a human decision. Promotion transactions record one
 * human accept or reject decision: the decided assertion and its binding
 * disposition, with exact candidate and claim digests and optional Kit
 * mapping provenance, land atomically in the same line.
 */
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  GroundAssertionParseError,
  groundAssertionCandidateDigest,
  groundAssertionClaimDigest,
  parseGroundAssertion,
  promoteGroundAssertionCandidate,
  retainGroundAssertionCandidate,
  validateGroundAssertionSet,
  type GroundAssertion,
  type GroundAssertionCandidate,
  type GroundAssertionId,
  type GroundVerifiedAuthorityEvidence,
} from './ground-assertions.ts'
import { requireGroundingPinMatch, type CompiledKitGrounding } from './kit-grounding-mapping.ts'
import { DesignBundleVersion, DesignKitVersion } from './types.ts'

/** Durable schema revision of one transaction record. */
export const ACCEPTED_ASSERTION_SCHEMA_VERSION = 3

/** How an entry entered the ledger: retained advisory output or a promotion. */
export type AcceptedAssertionOrigin = 'retained' | 'accepted' | 'rejected'

/** One assertion change inside a transaction. */
export interface AcceptedAssertionEntry {
  readonly origin: AcceptedAssertionOrigin
  readonly assertion: GroundAssertion
}

/** The human decision one promotion transaction records. */
export type PromotionDecision = 'accepted' | 'rejected'

/**
 * Kit-neutral provenance of the Kit mapping a promoted candidate originated
 * through, persisted so later graph projections can pin rationale nodes to
 * exact Kit, Bundle, and mapping versions.
 */
export interface AssertionMappingProvenance {
  readonly kit: string
  readonly kitVersion: DesignKitVersion
  readonly bundle: string
  readonly bundleVersion: DesignBundleVersion
  readonly mappingRevision: string
  readonly mappingId: string
  readonly recordId: string
}

/**
 * Durable disposition of one human promotion decision. The digests bind the
 * disposition to the exact decided candidate and claim; the mapping
 * provenance is present only for candidates that originated through a
 * compiled Kit grounding.
 */
export interface PromotionDisposition {
  readonly decision: PromotionDecision
  readonly candidateDigest: string
  readonly claimDigest: string
  readonly mapping?: AssertionMappingProvenance
  readonly rejectionReason?: string
}

/** One atomic retention transaction: advisory output kept without a human decision. */
export interface AcceptedRetentionRecord {
  readonly schemaVersion: typeof ACCEPTED_ASSERTION_SCHEMA_VERSION
  readonly kind: 'retention'
  readonly revision: number
  readonly project: string
  readonly checkpoint: string
  readonly entries: readonly AcceptedAssertionEntry[]
}

/** One atomic promotion transaction: a human decision and its disposition. */
export interface AcceptedPromotionRecord {
  readonly schemaVersion: typeof ACCEPTED_ASSERTION_SCHEMA_VERSION
  readonly kind: 'promotion'
  readonly revision: number
  readonly project: string
  readonly checkpoint: string
  readonly entries: readonly AcceptedAssertionEntry[]
  readonly disposition: PromotionDisposition
}

/** One atomic transaction: every entry lands together or none does. */
export type AcceptedAssertionRecord = AcceptedRetentionRecord | AcceptedPromotionRecord

/** Exact read model of the ledger at one transaction revision. */
export interface AcceptedAssertionRead {
  readonly revision: number
  readonly project: string | undefined
  readonly checkpoint: string | undefined
  readonly records: readonly AcceptedAssertionRecord[]
  readonly assertions: readonly GroundAssertion[]
}

/**
 * Compare-and-set pins every mutation must carry. `inputCheckpoint` is the
 * project checkpoint the candidate evidence was produced against and is
 * recorded as the transaction's provenance; `observedCheckpoint` is the
 * checkpoint the caller observes as current now. `expectedRevision` is the
 * exact transaction revision the caller last read.
 */
export interface AcceptedAssertionPin {
  readonly inputProject: string
  readonly observedProject: string
  readonly inputCheckpoint: string
  readonly observedCheckpoint: string
  readonly expectedRevision: number
}

/** The candidate belongs to a different Design Project than the observed selection. */
export class AcceptedAssertionProjectMismatchError extends Error {
  readonly inputProject: string
  readonly observedProject: string

  /**
   * @param inputProject - project the candidate and evidence were produced against.
   * @param observedProject - project the caller observes as selected now.
   */
  constructor(inputProject: string, observedProject: string) {
    super(`accepted assertion repository: candidate project ${JSON.stringify(inputProject)} is stale against observed project ${JSON.stringify(observedProject)}`)
    this.name = 'AcceptedAssertionProjectMismatchError'
    this.inputProject = inputProject
    this.observedProject = observedProject
  }
}

/** A mutation raced a concurrent transaction: the read revision moved on. */
export class AcceptedAssertionStaleRevisionError extends Error {
  readonly expected: number
  readonly actual: number

  /**
   * @param expected - revision the caller pinned from its last read.
   * @param actual - revision the ledger holds at mutation time.
   */
  constructor(expected: number, actual: number) {
    super(`accepted assertion repository: expected revision ${expected} but the ledger is at ${actual}`)
    this.name = 'AcceptedAssertionStaleRevisionError'
    this.expected = expected
    this.actual = actual
  }
}

/** The candidate's checkpoint no longer matches the observed project state. */
export class AcceptedAssertionCheckpointMismatchError extends Error {
  readonly inputCheckpoint: string
  readonly observedCheckpoint: string

  /**
   * @param inputCheckpoint - checkpoint the candidate evidence was produced against.
   * @param observedCheckpoint - checkpoint the caller observes as current.
   */
  constructor(inputCheckpoint: string, observedCheckpoint: string) {
    super(`accepted assertion repository: candidate checkpoint ${JSON.stringify(inputCheckpoint)} is stale against observed checkpoint ${JSON.stringify(observedCheckpoint)}`)
    this.name = 'AcceptedAssertionCheckpointMismatchError'
    this.inputCheckpoint = inputCheckpoint
    this.observedCheckpoint = observedCheckpoint
  }
}

/** Another process retained the project ledger lock past the configured wait. */
export class AcceptedAssertionLockTimeoutError extends Error {
  readonly lockPath: string
  readonly timeoutMs: number

  /**
   * @param lockPath - project-scoped lock directory that remained owned.
   * @param timeoutMs - configured maximum lock wait.
   */
  constructor(lockPath: string, timeoutMs: number) {
    super(`accepted assertion repository: timed out after ${timeoutMs}ms waiting for lock ${JSON.stringify(lockPath)}; verify that its recorded owner is no longer running before removing it`)
    this.name = 'AcceptedAssertionLockTimeoutError'
    this.lockPath = lockPath
    this.timeoutMs = timeoutMs
  }
}

/** A completed or failed mutation could not release its project ledger lock. */
export class AcceptedAssertionLockReleaseError extends Error {
  readonly lockPath: string

  /**
   * @param lockPath - project-scoped lock directory that could not be removed.
   * @param cause - filesystem failure raised while removing the lock.
   */
  constructor(lockPath: string, cause: unknown) {
    super(`accepted assertion repository: failed to release lock ${JSON.stringify(lockPath)}; the mutation may already be committed and callers must reread before retrying`, { cause })
    this.name = 'AcceptedAssertionLockReleaseError'
    this.lockPath = lockPath
  }
}

/** Resource bounds applied before ledger data is returned or appended. */
export interface AcceptedAssertionRepositoryLimits {
  readonly maxRecords?: number
  readonly maxRecordBytes?: number
  readonly maxFileBytes?: number
  readonly lockTimeoutMs?: number
  readonly lockRetryMs?: number
}

const DEFAULT_LIMITS = Object.freeze({
  maxRecords: 10_000,
  maxRecordBytes: 1_048_576,
  maxFileBytes: 67_108_864,
  lockTimeoutMs: 10_000,
  lockRetryMs: 25,
})

const RETENTION_KEYS = ['schemaVersion', 'kind', 'revision', 'project', 'checkpoint', 'entries'] as const
const PROMOTION_KEYS = ['schemaVersion', 'kind', 'revision', 'project', 'checkpoint', 'entries', 'disposition'] as const
const DISPOSITION_KEYS = ['decision', 'candidateDigest', 'claimDigest', 'mapping', 'rejectionReason'] as const
const MAPPING_PROVENANCE_KEYS = ['kit', 'kitVersion', 'bundle', 'bundleVersion', 'mappingRevision', 'mappingId', 'recordId'] as const
const DECISIONS = new Set<PromotionDecision>(['accepted', 'rejected'])
const ENTRY_KEYS = ['origin', 'assertion'] as const
const ORIGINS = new Set<AcceptedAssertionOrigin>(['retained', 'accepted', 'rejected'])
const LIFECYCLE_TRANSITIONS: ReadonlyMap<GroundAssertion['lifecycle'], readonly GroundAssertion['lifecycle'][]> = new Map([
  ['proposed', ['accepted', 'rejected']],
  ['accepted', ['superseded']],
  ['rejected', []],
  ['superseded', []],
])

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`accepted assertion repository: ${name} must be a positive safe integer`)
  }
  return resolved
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new GroundAssertionParseError(path, 'expected a plain object')
  }
  return value as Record<string, unknown>
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new GroundAssertionParseError(path, `unknown field ${JSON.stringify(unknown[0])}`)
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new GroundAssertionParseError(path, 'expected a non-empty string')
  return value
}

function isSafelyTornJsonObject(line: string, error: SyntaxError): boolean {
  if (!line.startsWith('{')) return false
  if (/Unexpected end of JSON input|Unterminated string/.test(error.message)) return true
  const position = /at position ([0-9]+)/.exec(error.message)?.[1]
  return position !== undefined && Number(position) >= line.length
}

function parseEntry(value: unknown, path: string): AcceptedAssertionEntry {
  const input = plainRecord(value, path)
  exactKeys(input, ENTRY_KEYS, path)
  if (typeof input.origin !== 'string' || !ORIGINS.has(input.origin as AcceptedAssertionOrigin)) {
    throw new GroundAssertionParseError(`${path}.origin`, `unsupported value ${JSON.stringify(input.origin)}`)
  }
  const entry = Object.freeze({
    origin: input.origin as AcceptedAssertionOrigin,
    assertion: parseGroundAssertion(input.assertion, `${path}.assertion`),
  })
  validateEntryOrigin(entry, path)
  return entry
}

function validateEntryOrigin(entry: AcceptedAssertionEntry, path: string): void {
  const { authority, lifecycle } = entry.assertion
  if (entry.origin === 'retained') {
    if (authority !== 'agent_proposed' || (lifecycle !== 'proposed' && lifecycle !== 'rejected')) {
      throw new GroundAssertionParseError(`${path}.origin`, 'retained entries must be agent-proposed assertions with proposed or rejected lifecycle')
    }
    return
  }
  if (entry.origin === 'rejected') {
    if (authority !== 'agent_proposed' || lifecycle !== 'rejected') {
      throw new GroundAssertionParseError(`${path}.origin`, 'rejected entries must be agent-proposed assertions with rejected lifecycle')
    }
    return
  }
  if (authority === 'agent_proposed' || (lifecycle !== 'accepted' && lifecycle !== 'superseded')) {
    throw new GroundAssertionParseError(`${path}.origin`, 'accepted entries must carry trusted authority with accepted or superseded lifecycle')
  }
}

function brandedText<T>(value: unknown, path: string, brand: (text: string) => T): T {
  const text = nonEmptyString(value, path)
  try {
    return brand(text)
  } catch (error) {
    throw new GroundAssertionParseError(path, error instanceof Error ? error.message : String(error))
  }
}

function parseMappingProvenance(value: unknown, path: string): AssertionMappingProvenance {
  const input = plainRecord(value, path)
  exactKeys(input, MAPPING_PROVENANCE_KEYS, path)
  return Object.freeze({
    kit: nonEmptyString(input.kit, `${path}.kit`),
    kitVersion: brandedText(input.kitVersion, `${path}.kitVersion`, DesignKitVersion),
    bundle: nonEmptyString(input.bundle, `${path}.bundle`),
    bundleVersion: brandedText(input.bundleVersion, `${path}.bundleVersion`, DesignBundleVersion),
    mappingRevision: nonEmptyString(input.mappingRevision, `${path}.mappingRevision`),
    mappingId: nonEmptyString(input.mappingId, `${path}.mappingId`),
    recordId: nonEmptyString(input.recordId, `${path}.recordId`),
  })
}

function parseDisposition(value: unknown, path: string): PromotionDisposition {
  const input = plainRecord(value, path)
  exactKeys(input, DISPOSITION_KEYS, path)
  const decision = input.decision
  if (typeof decision !== 'string' || !DECISIONS.has(decision as PromotionDecision)) {
    throw new GroundAssertionParseError(`${path}.decision`, `unsupported value ${JSON.stringify(decision)}`)
  }
  const disposition: PromotionDisposition = Object.freeze({
    decision: decision as PromotionDecision,
    candidateDigest: nonEmptyString(input.candidateDigest, `${path}.candidateDigest`),
    claimDigest: nonEmptyString(input.claimDigest, `${path}.claimDigest`),
    ...(input.mapping !== undefined ? { mapping: parseMappingProvenance(input.mapping, `${path}.mapping`) } : {}),
    ...(input.rejectionReason !== undefined ? { rejectionReason: nonEmptyString(input.rejectionReason, `${path}.rejectionReason`) } : {}),
  })
  if (disposition.decision === 'rejected' && disposition.rejectionReason === undefined) {
    throw new GroundAssertionParseError(`${path}.rejectionReason`, 'a rejected disposition requires a rejection reason')
  }
  if (disposition.decision === 'accepted' && disposition.rejectionReason !== undefined) {
    throw new GroundAssertionParseError(`${path}.rejectionReason`, 'an accepted disposition cannot carry a rejection reason')
  }
  return disposition
}

function parseRecord(value: unknown, expectedRevision: number): AcceptedAssertionRecord {
  const path = `transaction ${expectedRevision}`
  const input = plainRecord(value, path)
  if (input.schemaVersion !== ACCEPTED_ASSERTION_SCHEMA_VERSION) {
    throw new GroundAssertionParseError(`${path}.schemaVersion`, `expected ${ACCEPTED_ASSERTION_SCHEMA_VERSION}`)
  }
  const kind = input.kind
  if (kind !== 'retention' && kind !== 'promotion') throw new GroundAssertionParseError(`${path}.kind`, `unsupported value ${JSON.stringify(kind)}`)
  exactKeys(input, kind === 'retention' ? RETENTION_KEYS : PROMOTION_KEYS, path)
  if (typeof input.revision !== 'number' || input.revision !== expectedRevision) {
    throw new GroundAssertionParseError(`${path}.revision`, `expected sequential revision ${expectedRevision}`)
  }
  if (typeof input.project !== 'string' || input.project.trim() === '') throw new GroundAssertionParseError(`${path}.project`, 'expected a non-empty string')
  if (typeof input.checkpoint !== 'string' || input.checkpoint.trim() === '') throw new GroundAssertionParseError(`${path}.checkpoint`, 'expected a non-empty string')
  if (!Array.isArray(input.entries) || input.entries.length === 0) throw new GroundAssertionParseError(`${path}.entries`, 'expected a non-empty array')
  const entries = Object.freeze(input.entries.map((entry, index) => parseEntry(entry, `${path}.entries[${index}]`)))
  if (kind === 'retention') {
    validateRetentionEntries(entries, path)
    return Object.freeze({ schemaVersion: ACCEPTED_ASSERTION_SCHEMA_VERSION, kind, revision: expectedRevision, project: input.project, checkpoint: input.checkpoint, entries })
  }
  const disposition = parseDisposition(input.disposition, `${path}.disposition`)
  validatePromotionEntries(entries, disposition, path)
  return Object.freeze({ schemaVersion: ACCEPTED_ASSERTION_SCHEMA_VERSION, kind, revision: expectedRevision, project: input.project, checkpoint: input.checkpoint, entries, disposition })
}

function validateRetentionEntries(entries: readonly AcceptedAssertionEntry[], path: string): void {
  if (entries.some((entry) => entry.origin !== 'retained')) {
    throw new GroundAssertionParseError(`${path}.entries`, 'retention transactions may contain only retained advisory entries')
  }
}

function validatePromotionEntries(entries: readonly AcceptedAssertionEntry[], disposition: PromotionDisposition, path: string): void {
  const decidedOrigin: AcceptedAssertionOrigin = disposition.decision === 'accepted' ? 'accepted' : 'rejected'
  const decided = entries.filter((entry) => entry.origin === decidedOrigin && entry.assertion.lifecycle === disposition.decision)
  if (decided.length !== 1) {
    throw new GroundAssertionParseError(`${path}.entries`, `a ${disposition.decision} promotion requires exactly one ${disposition.decision} entry`)
  }
  const assertion = (decided[0] as AcceptedAssertionEntry).assertion
  if (disposition.candidateDigest !== groundAssertionCandidateDigest(assertion)) {
    throw new GroundAssertionParseError(`${path}.disposition.candidateDigest`, 'disposition does not bind the decided assertion')
  }
  if (disposition.claimDigest !== groundAssertionClaimDigest(assertion.claim)) {
    throw new GroundAssertionParseError(`${path}.disposition.claimDigest`, 'disposition does not bind the decided claim')
  }
  for (const entry of entries) {
    if (entry === decided[0]) continue
    if (disposition.decision !== 'accepted' || entry.origin !== 'accepted' || entry.assertion.lifecycle !== 'superseded') {
      throw new GroundAssertionParseError(`${path}.entries`, 'promotion entries besides the decided assertion must be accepted supersession marks')
    }
  }
}

interface ParsedLedger {
  readonly revision: number
  readonly records: readonly AcceptedAssertionRecord[]
  readonly validBytes: number
  readonly needsDelimiter: boolean
}

function emptyParsedLedger(): ParsedLedger {
  return Object.freeze({ revision: 0, records: Object.freeze([]), validBytes: 0, needsDelimiter: false })
}

/**
 * Append-only JSONL ledger of accepted Ground assertions for one Design
 * Project. Each line is one whole atomic transaction at a sequential revision.
 * Reads are serialized in one per-instance queue. Every mutation additionally
 * owns a project-scoped filesystem lock while it rereads the ledger, checks
 * its compare-and-set pins, appends, and synchronizes the file. Separate
 * instances and processes therefore share the same mutation order. A lock is
 * never stolen automatically: an orphaned lock times out with its owner record
 * intact so an operator can verify that the owner is dead before removing it.
 * A syntactically torn unterminated final line is ignored on read and truncated
 * before append; malformed complete lines and semantically invalid values fail
 * loud. The root and its existing files are trusted caller-controlled storage
 * and must not be writable by untrusted processes.
 */
export class AcceptedAssertionRepository {
  private readonly root: string
  private readonly file: string
  private readonly lockDirectory: string
  private readonly maxRecords: number
  private readonly maxRecordBytes: number
  private readonly maxFileBytes: number
  private readonly lockTimeoutMs: number
  private readonly lockRetryMs: number
  private queue: Promise<void> = Promise.resolve()

  /**
   * Bind the repository to one project-exclusive ledger file.
   * @param root - adapter-resolved directory owned by exactly one Design Project.
   * @param limits - optional deployment resource limits.
   */
  constructor(root: string, limits: AcceptedAssertionRepositoryLimits = {}) {
    if (root.length === 0) throw new Error('accepted assertion repository: root must not be empty')
    this.root = root
    this.file = join(root, 'accepted-assertions.jsonl')
    this.lockDirectory = join(root, '.accepted-assertions.lock')
    this.maxRecords = positiveLimit(limits.maxRecords, DEFAULT_LIMITS.maxRecords, 'maxRecords')
    this.maxRecordBytes = positiveLimit(limits.maxRecordBytes, DEFAULT_LIMITS.maxRecordBytes, 'maxRecordBytes')
    this.maxFileBytes = positiveLimit(limits.maxFileBytes, DEFAULT_LIMITS.maxFileBytes, 'maxFileBytes')
    this.lockTimeoutMs = positiveLimit(limits.lockTimeoutMs, DEFAULT_LIMITS.lockTimeoutMs, 'lockTimeoutMs')
    this.lockRetryMs = positiveLimit(limits.lockRetryMs, DEFAULT_LIMITS.lockRetryMs, 'lockRetryMs')
  }

  /**
   * Read the latest ledger state, folding every committed transaction.
   * @returns records and current assertions at the same exact revision.
   */
  async read(): Promise<AcceptedAssertionRead> {
    return this.enqueue(() => this.readLatest())
  }

  /**
   * Read the ledger at one exact committed transaction revision. The replayed
   * state stays readable after later commits and always folds complete
   * transactions; a revision that was never committed fails loud.
   * @param revision - committed revision to replay, from 0 (empty) to current.
   * @returns records and assertions exactly as of that revision.
   */
  async readAt(revision: number): Promise<AcceptedAssertionRead> {
    return this.enqueue(() => this.readLatest(revision))
  }

  /**
   * Retain untrusted advisory output as a non-authoritative proposed or
   * rejected assertion in a retention transaction. The compare-and-set pins
   * are enforced before any write.
   * @param candidate - parsed advisory candidate without authority.
   * @param lifecycle - retention outcome for the untrusted output.
   * @param pin - checkpoint and revision compare-and-set inputs.
   * @returns the exact post-append read model.
   */
  async retainCandidate(candidate: GroundAssertionCandidate, lifecycle: 'proposed' | 'rejected', pin: AcceptedAssertionPin): Promise<AcceptedAssertionRead> {
    const assertion = retainGroundAssertionCandidate(candidate, lifecycle)
    return this.enqueue(() => this.withMutationLock(async () => {
      const current = await this.readLatest()
      this.requirePin(current, pin)
      return this.writeTransaction(current, 'retention', [{ origin: 'retained', assertion }], pin)
    }))
  }

  /**
   * Retain one parsed advisory candidate batch in a single transaction. An
   * exact retry of an already committed batch is a zero-write success; any
   * other revision race or same-id content change fails loud.
   * @param candidates - one parsed advisory output batch.
   * @param pin - project, checkpoint, and read-revision compare-and-set inputs.
   * @returns the exact post-append or already-committed read model.
   */
  async retainCandidates(
    candidates: readonly GroundAssertionCandidate[],
    pin: AcceptedAssertionPin,
  ): Promise<AcceptedAssertionRead> {
    const entries = Object.freeze(candidates.map((candidate) => Object.freeze({
      origin: 'retained' as const,
      assertion: retainGroundAssertionCandidate(candidate, 'proposed'),
    })))
    return this.enqueue(() => this.withMutationLock(async () => {
      const current = await this.readLatest()
      this.requireProject(current, pin)
      this.requireCheckpoint(pin)
      this.requireExpectedRevision(pin)
      if (this.retentionAlreadyCommitted(current, entries, pin)) return current
      this.requirePin(current, pin)
      if (entries.length === 0) return current
      return this.writeTransaction(current, 'retention', entries, pin)
    }))
  }

  /**
   * Accept one candidate through a human decision as a promotion transaction:
   * the promoted assertion, its supersession marks, and the binding
   * disposition land atomically in one line. The compare-and-set pins and the
   * disposition digest binding are enforced before any write.
   * @param candidate - parsed advisory candidate without authority.
   * @param verified - evidence minted at the trusted event-ingestion seam.
   * @param pin - checkpoint and revision compare-and-set inputs.
   * @param disposition - accepted decision record with exact digests and optional mapping provenance.
   * @param currentGrounding - current compiled grounding required when the disposition carries mapping provenance.
   * @returns the exact post-append read model.
   */
  async acceptCandidate(
    candidate: GroundAssertionCandidate,
    verified: GroundVerifiedAuthorityEvidence,
    pin: AcceptedAssertionPin,
    disposition: PromotionDisposition,
    currentGrounding?: CompiledKitGrounding,
  ): Promise<AcceptedAssertionRead> {
    const accepted = promoteGroundAssertionCandidate(candidate, verified)
    if (accepted.authority !== 'human_confirmed') {
      throw new GroundAssertionParseError('$.authorityEvidence', 'a human promotion requires human-confirmed authority evidence')
    }
    return this.enqueue(() => this.withMutationLock(async () => {
      const current = await this.readLatest()
      this.requirePin(current, pin)
      const normalizedDisposition = this.requireDecision(disposition, 'accepted', accepted, currentGrounding)
      return this.writeTransaction(current, 'promotion', this.promotionEntries(current, accepted), pin, normalizedDisposition)
    }))
  }

  /**
   * Reject one candidate through a human decision as a promotion transaction:
   * the rejected assertion and the binding disposition land atomically in one
   * line. The compare-and-set pins and the disposition digest binding are
   * enforced before any write.
   * @param candidate - parsed advisory candidate without authority.
   * @param pin - checkpoint and revision compare-and-set inputs.
   * @param disposition - rejected decision record with exact digests and a required reason.
   * @param currentGrounding - current compiled grounding required when the disposition carries mapping provenance.
   * @returns the exact post-append read model.
   */
  async rejectCandidate(
    candidate: GroundAssertionCandidate,
    pin: AcceptedAssertionPin,
    disposition: PromotionDisposition,
    currentGrounding?: CompiledKitGrounding,
  ): Promise<AcceptedAssertionRead> {
    const rejected = retainGroundAssertionCandidate(candidate, 'rejected')
    return this.enqueue(() => this.withMutationLock(async () => {
      const current = await this.readLatest()
      this.requirePin(current, pin)
      const normalizedDisposition = this.requireDecision(disposition, 'rejected', rejected, currentGrounding)
      return this.writeTransaction(current, 'promotion', [{ origin: 'rejected', assertion: rejected }], pin, normalizedDisposition)
    }))
  }

  private promotionEntries(current: AcceptedAssertionRead, accepted: GroundAssertion): AcceptedAssertionEntry[] {
    const entries: AcceptedAssertionEntry[] = []
    for (const targetId of accepted.supersedes) {
      const target = current.assertions.find((assertion) => assertion.id === targetId)
      if (target === undefined) {
        throw new GroundAssertionParseError('$.supersedes', `supersession target ${JSON.stringify(targetId)} is absent from the ledger`)
      }
      if (target.lifecycle !== 'accepted') {
        throw new GroundAssertionParseError('$.supersedes', `supersession target ${JSON.stringify(targetId)} is ${target.lifecycle}, not accepted`)
      }
      entries.push(Object.freeze({ origin: 'accepted', assertion: { ...target, lifecycle: 'superseded' } as GroundAssertion }))
    }
    entries.push(Object.freeze({ origin: 'accepted', assertion: accepted }))
    return entries
  }

  private requireDecision(
    disposition: PromotionDisposition,
    decision: PromotionDecision,
    assertion: GroundAssertion,
    currentGrounding: CompiledKitGrounding | undefined,
  ): PromotionDisposition {
    const normalized = parseDisposition(disposition, '$.disposition')
    if (normalized.decision !== decision) {
      throw new GroundAssertionParseError('$.disposition.decision', `expected ${decision} but the disposition records ${normalized.decision}`)
    }
    if (normalized.candidateDigest !== groundAssertionCandidateDigest(assertion)) {
      throw new GroundAssertionParseError('$.disposition.candidateDigest', 'disposition does not bind the decided candidate')
    }
    if (normalized.claimDigest !== groundAssertionClaimDigest(assertion.claim)) {
      throw new GroundAssertionParseError('$.disposition.claimDigest', 'disposition does not bind the decided claim')
    }
    if (normalized.mapping !== undefined) {
      if (currentGrounding === undefined) {
        throw new GroundAssertionParseError('$.disposition.mapping', 'current compiled Kit grounding is required for mapping provenance')
      }
      requireGroundingPinMatch(currentGrounding, normalized.mapping)
    }
    return normalized
  }

  private retentionAlreadyCommitted(
    current: AcceptedAssertionRead,
    entries: readonly AcceptedAssertionEntry[],
    pin: AcceptedAssertionPin,
  ): boolean {
    if (entries.length === 0) return false
    const serialized = JSON.stringify(entries)
    return current.records.some((record) => record.kind === 'retention'
      && record.revision === pin.expectedRevision + 1
      && record.project === pin.inputProject
      && record.checkpoint === pin.inputCheckpoint
      && JSON.stringify(record.entries) === serialized)
  }

  private requirePin(current: AcceptedAssertionRead, pin: AcceptedAssertionPin): void {
    this.requireProject(current, pin)
    this.requireCheckpoint(pin)
    this.requireExpectedRevision(pin)
    if (pin.expectedRevision !== current.revision) {
      throw new AcceptedAssertionStaleRevisionError(pin.expectedRevision, current.revision)
    }
  }

  private requireExpectedRevision(pin: AcceptedAssertionPin): void {
    if (!Number.isSafeInteger(pin.expectedRevision) || pin.expectedRevision < 0) {
      throw new Error('accepted assertion repository: expectedRevision must be a non-negative safe integer')
    }
  }

  private requireProject(current: AcceptedAssertionRead, pin: AcceptedAssertionPin): void {
    if (typeof pin.inputProject !== 'string' || pin.inputProject.trim() === '') {
      throw new Error('accepted assertion repository: inputProject must be a non-empty string')
    }
    if (typeof pin.observedProject !== 'string' || pin.observedProject.trim() === '') {
      throw new Error('accepted assertion repository: observedProject must be a non-empty string')
    }
    if (pin.inputProject !== pin.observedProject) {
      throw new AcceptedAssertionProjectMismatchError(pin.inputProject, pin.observedProject)
    }
    if (current.project !== undefined && pin.inputProject !== current.project) {
      throw new AcceptedAssertionProjectMismatchError(pin.inputProject, current.project)
    }
  }

  private requireCheckpoint(pin: AcceptedAssertionPin): void {
    if (typeof pin.inputCheckpoint !== 'string' || pin.inputCheckpoint.trim() === '') {
      throw new Error('accepted assertion repository: inputCheckpoint must be a non-empty string')
    }
    if (typeof pin.observedCheckpoint !== 'string' || pin.observedCheckpoint.trim() === '') {
      throw new Error('accepted assertion repository: observedCheckpoint must be a non-empty string')
    }
    if (pin.inputCheckpoint !== pin.observedCheckpoint) {
      throw new AcceptedAssertionCheckpointMismatchError(pin.inputCheckpoint, pin.observedCheckpoint)
    }
  }

  /**
   * Validate and persist one transaction as one line. Runs inside the queue
   * only; the whole transaction lands as one append or nothing lands at all.
   */
  private async writeTransaction(
    current: AcceptedAssertionRead,
    kind: AcceptedAssertionRecord['kind'],
    entries: readonly AcceptedAssertionEntry[],
    pin: AcceptedAssertionPin,
    disposition?: PromotionDisposition,
  ): Promise<AcceptedAssertionRead> {
    const normalizedEntries = Object.freeze(entries.map((entry, index) => parseEntry(entry, `transaction ${current.revision + 1}.entries[${index}]`)))
    const normalizedDisposition = disposition === undefined ? undefined : parseDisposition(disposition, `transaction ${current.revision + 1}.disposition`)
    if (kind === 'promotion') {
      if (normalizedDisposition === undefined) throw new GroundAssertionParseError(`transaction ${current.revision + 1}`, 'a promotion transaction requires a disposition')
      validatePromotionEntries(normalizedEntries, normalizedDisposition, `transaction ${current.revision + 1}`)
    } else if (normalizedDisposition !== undefined) {
      throw new GroundAssertionParseError(`transaction ${current.revision + 1}`, 'a retention transaction cannot carry a disposition')
    } else {
      validateRetentionEntries(normalizedEntries, `transaction ${current.revision + 1}`)
    }
    const record: AcceptedAssertionRecord = kind === 'promotion'
      ? Object.freeze({
        schemaVersion: ACCEPTED_ASSERTION_SCHEMA_VERSION,
        kind,
        revision: current.revision + 1,
        project: pin.inputProject,
        checkpoint: pin.inputCheckpoint,
        entries: normalizedEntries,
        disposition: normalizedDisposition as PromotionDisposition,
      })
      : Object.freeze({
        schemaVersion: ACCEPTED_ASSERTION_SCHEMA_VERSION,
        kind,
        revision: current.revision + 1,
        project: pin.inputProject,
        checkpoint: pin.inputCheckpoint,
        entries: normalizedEntries,
      })
    const next = this.fold([...current.records, record])
    validateGroundAssertionSet(next.assertions)
    if (next.records.length > this.maxRecords) {
      throw new Error(`accepted assertion repository: ledger reached the ${this.maxRecords} transaction limit`)
    }
    const line = `${JSON.stringify(record)}\n`
    if (Buffer.byteLength(line, 'utf8') > this.maxRecordBytes) {
      throw new Error(`accepted assertion repository: transaction exceeds ${this.maxRecordBytes} bytes`)
    }
    await mkdir(this.root, { recursive: true })
    const existing = await this.readParsed()
    if (existing.revision !== current.revision) {
      throw new AcceptedAssertionStaleRevisionError(current.revision, existing.revision)
    }
    if (JSON.stringify(existing.records) !== JSON.stringify(current.records)) {
      throw new Error('accepted assertion repository: ledger contents changed without advancing the transaction revision')
    }
    const prefix = existing.needsDelimiter ? '\n' : ''
    if (existing.validBytes + Buffer.byteLength(prefix + line, 'utf8') > this.maxFileBytes) {
      throw new Error(`accepted assertion repository: ledger exceeds ${this.maxFileBytes} bytes`)
    }
    const fileBytes = await this.sizeOf()
    const handle = await open(this.file, 'a+')
    try {
      if (existing.validBytes < fileBytes) await handle.truncate(existing.validBytes)
      await handle.appendFile(prefix + line, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    return next
  }

  private async readLatest(upTo?: number): Promise<AcceptedAssertionRead> {
    const parsed = await this.readParsed()
    if (upTo !== undefined) {
      if (!Number.isSafeInteger(upTo) || upTo < 0 || upTo > parsed.revision) {
        throw new Error(`accepted assertion repository: revision ${JSON.stringify(upTo)} was never committed (ledger is at ${parsed.revision})`)
      }
      return this.fold(parsed.records.filter((record) => record.revision <= upTo))
    }
    return this.fold(parsed.records)
  }

  private fold(records: readonly AcceptedAssertionRecord[]): AcceptedAssertionRead {
    const project = records[0]?.project
    if (records.some((record) => record.project !== project)) {
      throw new GroundAssertionParseError('$.records', 'all accepted assertion transactions must belong to one Design Project')
    }
    const byId = new Map<GroundAssertionId, GroundAssertion>()
    for (const record of records) {
      for (const entry of record.entries) {
        const existing = byId.get(entry.assertion.id)
        if (existing !== undefined) {
          if (groundAssertionCandidateDigest(existing) !== groundAssertionCandidateDigest(entry.assertion)) {
            throw new GroundAssertionParseError(`transaction ${record.revision}`, `conflicting rewrite of assertion ${JSON.stringify(entry.assertion.id)}`)
          }
          const allowed = LIFECYCLE_TRANSITIONS.get(existing.lifecycle) ?? []
          if (!allowed.includes(entry.assertion.lifecycle)) {
            throw new GroundAssertionParseError(`transaction ${record.revision}`, `illegal lifecycle transition ${existing.lifecycle} -> ${entry.assertion.lifecycle} for ${JSON.stringify(entry.assertion.id)}`)
          }
        }
        byId.set(entry.assertion.id, entry.assertion)
      }
    }
    const assertions = [...byId.values()]
    validateGroundAssertionSet(assertions)
    const last = records[records.length - 1]
    return Object.freeze({
      revision: last?.revision ?? 0,
      project,
      checkpoint: last?.checkpoint,
      records: Object.freeze(records),
      assertions: Object.freeze(assertions),
    })
  }

  private async readParsed(): Promise<ParsedLedger> {
    const size = await this.sizeOf()
    if (size > this.maxFileBytes) {
      throw new Error(`accepted assertion repository: ledger exceeds ${this.maxFileBytes} bytes`)
    }
    let bytes: Buffer
    try {
      bytes = await readFile(this.file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return emptyParsedLedger()
    }
    if (bytes.byteLength === 0) return emptyParsedLedger()
    const text = bytes.toString('utf8')
    const terminated = text.endsWith('\n')
    const segments = text.split('\n')
    if (terminated) segments.pop()
    let validBytes = 0
    let needsDelimiter = false
    const records: AcceptedAssertionRecord[] = []
    for (const [index, line] of segments.entries()) {
      const finalUnterminated = !terminated && index === segments.length - 1
      const lineBytes = Buffer.byteLength(line, 'utf8')
      if (lineBytes + 1 > this.maxRecordBytes) {
        throw new Error(`accepted assertion repository: line ${index + 1} exceeds ${this.maxRecordBytes} bytes`)
      }
      let decoded: unknown
      try {
        decoded = JSON.parse(line)
      } catch (error) {
        if (finalUnterminated && error instanceof SyntaxError && isSafelyTornJsonObject(line, error)) break
        throw new Error(`accepted assertion repository: malformed JSON on complete line ${index + 1}`, { cause: error })
      }
      let record: AcceptedAssertionRecord
      try {
        record = parseRecord(decoded, records.length + 1)
      } catch (error) {
        throw new Error(`accepted assertion repository: invalid transaction on line ${index + 1}`, { cause: error })
      }
      records.push(record)
      validBytes += lineBytes
      if (!finalUnterminated) validBytes += 1
      else needsDelimiter = true
      if (records.length > this.maxRecords) {
        throw new Error(`accepted assertion repository: ledger exceeds the ${this.maxRecords} transaction limit`)
      }
    }
    this.fold(records)
    return Object.freeze({ revision: records.length, records: Object.freeze(records), validBytes, needsDelimiter })
  }

  private async sizeOf(): Promise<number> {
    try {
      return (await stat(this.file)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireMutationLock()
    let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }
    try {
      outcome = { ok: true, value: await operation() }
    } catch (error) {
      outcome = { ok: false, error }
    }
    try {
      await release()
    } catch (releaseError) {
      const failure = new AcceptedAssertionLockReleaseError(this.lockDirectory, releaseError)
      if (!outcome.ok) {
        throw new AggregateError([outcome.error, failure], 'accepted assertion repository: mutation and lock release both failed')
      }
      throw failure
    }
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }

  private async acquireMutationLock(): Promise<() => Promise<void>> {
    await mkdir(this.root, { recursive: true })
    const startedAt = Date.now()
    while (true) {
      try {
        await mkdir(this.lockDirectory)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const elapsed = Date.now() - startedAt
        if (elapsed >= this.lockTimeoutMs) {
          throw new AcceptedAssertionLockTimeoutError(this.lockDirectory, this.lockTimeoutMs)
        }
        await delay(Math.min(this.lockRetryMs, this.lockTimeoutMs - elapsed))
      }
    }
    try {
      await writeFile(join(this.lockDirectory, 'owner.json'), `${JSON.stringify({ schemaVersion: 1, pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      try {
        await rm(this.lockDirectory, { recursive: true })
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `accepted assertion repository: failed to initialize or release lock ${JSON.stringify(this.lockDirectory)}`)
      }
      throw error
    }
    let released = false
    return async () => {
      if (released) throw new Error(`accepted assertion repository: lock ${JSON.stringify(this.lockDirectory)} was released more than once`)
      await rm(this.lockDirectory, { recursive: true })
      released = true
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.queue = settled
    return result
  }
}
