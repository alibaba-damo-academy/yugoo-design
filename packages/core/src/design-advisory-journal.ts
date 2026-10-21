/**
 * Host-neutral durable advisory repository over one DesignJournalStorage.
 *
 * Individual publications, human decisions, and execution receipts persist as
 * journal facts, so restarts restore the exact review state. Historical audit
 * set facts remain readable through the journal fold but have no live writer.
 * Nothing here writes Design Files or grants authority to apply advice.
 */
import { randomUUID } from 'node:crypto'
import { DesignAdvisoryId, parseDesignAdvisory, type DesignAdvisoryDecision } from './design-advisory.ts'
import { DesignExecutionInvocationId } from './design-execution-runtime.ts'
import {
  parseAdvisoryReviewCompletion,
  parseDesignJournalFact,
  parseDesignJournalAdvisorySelection,
  type DesignAdvisoryActionState,
  type DesignAdvisoryActionTarget,
  type DesignAdvisoryExecutionState,
  type DesignAdvisorySelectionKind,
  type DesignJournalAdvisoryActionEntry,
  type DesignJournalAdvisoryEntry,
  type DesignJournalAdvisoryReviewCompletionEntry,
} from './design-journal.ts'
import type { DesignJournalStorage } from './design-journal-storage.ts'
import { suppressRepeatedAdvisoryItems } from './advisory-review-memory.ts'

/** Canonical advisory JSON used to detect conflicting republishes. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

/** Strictly parse one human disposition at the repository boundary. */
function parseDecision(value: unknown): { readonly advisoryId: DesignAdvisoryId; readonly decision: DesignAdvisoryDecision } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('design advisory journal: decision must be a plain object')
  }
  const record = value as Record<string, unknown>
  const fields = Object.keys(record)
  if (fields.length !== 2 || !fields.includes('advisoryId') || !fields.includes('decision')) {
    throw new Error('design advisory journal: decision requires exactly advisoryId and decision')
  }
  if (typeof record.advisoryId !== 'string') throw new Error('design advisory journal: advisoryId must be text')
  if (record.decision !== 'accepted' && record.decision !== 'rejected' && record.decision !== 'deferred') {
    throw new Error('design advisory journal: decision must be accepted, rejected, or deferred')
  }
  return Object.freeze({ advisoryId: DesignAdvisoryId(record.advisoryId), decision: record.decision })
}

/** Trusted action target resolved from one v2 actionSpec against an exact Kit. */
export interface ResolvedDesignAdvisoryAction {
  readonly actionId: string
  readonly target: DesignAdvisoryActionTarget
}

/** Caller-selected follow-up; the Host validates current pins before this API. */
export interface DesignAdvisorySelectionRequest {
  readonly advisoryId: DesignAdvisoryId
  readonly acceptanceReceiptId: string
  readonly kind: DesignAdvisorySelectionKind
  readonly reason: string
  readonly expectedJournalRevision?: number
}

/** Result of atomically claiming one action receipt attempt. */
export interface DesignAdvisoryActionClaim {
  readonly claimed: boolean
  readonly advisoryId: DesignAdvisoryId
  readonly action: DesignJournalAdvisoryActionEntry
  readonly attemptId: string
  readonly effectiveInvocationId: DesignExecutionInvocationId
}

/**
 * Async advisory repository keyed by the journal's opaque conversation
 * identity. All operations serialize per conversation inside the underlying
 * storage queue, and every read model comes from the strict journal fold.
 */
export class DesignAdvisoryJournal {
  private readonly storage: DesignJournalStorage

  /**
   * Bind the repository to one trusted journal storage.
   * @param storage - durable per-conversation design journal owner.
   */
  constructor(storage: DesignJournalStorage) {
    this.storage = storage
  }

  /**
   * Persist one advisory publication for a conversation.
   * The duplicate-id comparison and the append run as one atomic
   * per-conversation operation. Republishing an id with identical content
   * appends nothing; different content for the same id fails loud.
   * @param conversation - opaque caller-owned conversation identity.
   * @param advisory - untrusted advisory value validated before persistence.
   * @returns frozen entries in publication order after the operation.
   */
  async publish(conversation: string, advisory: unknown): Promise<readonly DesignJournalAdvisoryEntry[]> {
    const parsed = parseDesignAdvisory(advisory)
    const { read } = await this.storage.atomicMutate(conversation, (current) => {
      const existing = current.snapshot.advisories.find((entry) => entry.advisory.id === parsed.id)
      if (existing !== undefined) {
        if (canonical(existing.advisory) !== canonical(parsed)) {
          throw new Error(`design advisory journal: id ${JSON.stringify(parsed.id)} was republished with different content`)
        }
        return undefined
      }
      const filtered = suppressRepeatedAdvisoryItems(parsed, current.snapshot.advisories)
      if (parsed.items.length > 0 && filtered.items.length === 0) return undefined
      return { type: 'design/advisory-published', data: filtered }
    })
    return read.snapshot.advisories
  }

  /**
   * Persist one explicit human disposition for a conversation advisory.
   * Validation and the append run as one atomic per-conversation operation.
   * Repeating the recorded terminal decision appends nothing; deciding an
   * unknown or next-boundary advisory, or changing a terminal decision,
   * fails loud.
   * @param conversation - opaque caller-owned conversation identity.
   * @param decision - untrusted disposition validated before persistence.
   * @returns frozen entries in publication order after the operation.
   */
  async decide(
    conversation: string,
    decision: unknown,
    resolvedActions: readonly ResolvedDesignAdvisoryAction[] = [],
  ): Promise<readonly DesignJournalAdvisoryEntry[]> {
    const parsed = parseDecision(decision)
    const receiptId = randomUUID()
    const { read } = await this.storage.atomicMutate(conversation, (current) => {
      const entry = current.snapshot.advisories.find((candidate) => candidate.advisory.id === parsed.advisoryId)
      if (entry === undefined) {
        throw new Error(`design advisory journal: decision references unknown advisory ${JSON.stringify(parsed.advisoryId)}`)
      }
      if (entry.advisory.attention !== 'human-review') {
        throw new Error(`design advisory journal: next-boundary advisory ${JSON.stringify(parsed.advisoryId)} cannot receive a decision`)
      }
      if (parsed.decision === 'accepted') {
        if (entry.acceptanceReceiptId !== undefined) return undefined
        if (entry.status === 'rejected' || entry.status === 'invalidated' || entry.status === 'completed') {
          throw new Error(`design advisory journal: disposed advisory ${JSON.stringify(parsed.advisoryId)} cannot be accepted`)
        }
        if (entry.advisory.schemaVersion === 2) {
          return {
            type: 'design/advisory-accepted',
            data: {
              advisoryId: parsed.advisoryId,
              acceptanceReceiptId: receiptId,
              actions: resolvedActions.map(action => ({ ...action, receiptId: randomUUID() })),
            },
          }
        }
        if (resolvedActions.length > 0) {
          throw new Error(`design advisory journal: legacy advisory ${JSON.stringify(parsed.advisoryId)} cannot resolve action receipts`)
        }
        return { type: 'design/advisory-execution', data: { advisoryId: parsed.advisoryId, receiptId, state: 'accepted' } }
      }
      if (entry.status === 'accepted' || entry.status === 'queued' || entry.status === 'running'
        || entry.status === 'failed' || entry.status === 'needs-user-input' || entry.status === 'completed'
        || entry.status === 'invalidated' || entry.status === 'rejected') {
        if (entry.status === parsed.decision) return undefined
        throw new Error(`design advisory journal: terminal decision for ${JSON.stringify(parsed.advisoryId)} cannot change`)
      }
      return { type: 'design/advisory-decided', data: parsed }
    })
    return read.snapshot.advisories
  }

  /**
   * Atomically select one accepted review follow-up. Discovery declarations are
   * not an allowlist. The trusted Host resolves current exact Bundle pins; this
   * repository binds the choice to the immutable acceptance and entity scope.
   * Identical replay appends nothing, and a recorded choice cannot be replaced.
   */
  async selectReviewAction(
    conversation: string,
    request: DesignAdvisorySelectionRequest,
    resolvedAction?: ResolvedDesignAdvisoryAction,
  ): Promise<DesignJournalAdvisoryEntry> {
    const { expectedJournalRevision, ...selection } = request
    if (expectedJournalRevision !== undefined && (!Number.isSafeInteger(expectedJournalRevision) || expectedJournalRevision < 0)) {
      throw new Error('design advisory journal: expectedJournalRevision must be a non-negative safe integer')
    }
    const parsed = parseDesignJournalAdvisorySelection({
      ...selection,
      actions: resolvedAction === undefined ? [] : [{ ...resolvedAction, receiptId: randomUUID() }],
    })
    const { read } = await this.storage.atomicMutate(conversation, current => {
      const entry = current.snapshot.advisories.find(candidate => candidate.advisory.id === parsed.advisoryId)
      if (entry?.selection !== undefined) {
        if (entry.status !== 'accepted') throw new Error('design advisory journal: disposed selection cannot be reused')
        const prior = entry.selection
        const stripReceipt = (actions: readonly { readonly actionId: string; readonly target: DesignAdvisoryActionTarget }[]) =>
          actions.map(action => ({ actionId: action.actionId, target: action.target }))
        if (prior.acceptanceReceiptId !== parsed.acceptanceReceiptId || prior.kind !== parsed.kind
          || prior.reason !== parsed.reason || canonical(stripReceipt(prior.actions)) !== canonical(stripReceipt(parsed.actions))) {
          throw new Error('design advisory journal: selected advisory cannot change choice or target')
        }
        return undefined
      }
      if (expectedJournalRevision !== undefined && current.snapshot.revision !== expectedJournalRevision) {
        throw new Error('design advisory journal: journal revision changed before selection')
      }
      return { type: 'design/advisory-action-selected', data: parsed }
    })
    const entry = read.snapshot.advisories.find(candidate => candidate.advisory.id === parsed.advisoryId)
    if (entry === undefined) throw new Error('design advisory journal: selected advisory disappeared')
    return entry
  }

  /**
   * Persist one completed advisory review pass for a conversation. An empty
   * findings list is a real completion and is recorded like any other; failed,
   * cancelled, or stale runs must never reach this method. Repeating an
   * identical completion appends nothing; a different pass for the same
   * profile appends and the fold's latest-wins read model supersedes the
   * previous one.
   * @param conversation - opaque caller-owned conversation identity.
   * @param completion - untrusted completion validated before persistence.
   * @returns whether a fact was appended, plus the exact post-operation
   *   completion entry for the profile.
   */
  async recordReviewCompletion(
    conversation: string,
    completion: unknown,
  ): Promise<{ readonly recorded: boolean; readonly entry: DesignJournalAdvisoryReviewCompletionEntry | undefined }> {
    const parsed = parseAdvisoryReviewCompletion(completion)
    const mutation = await this.storage.atomicMutate(conversation, (current) => {
      if (parsed.attemptId !== undefined) {
        const prior = current.records.find((record) => {
          if (record.type !== 'design/advisory-review-completed') return false
          return record.data.attemptId === parsed.attemptId && record.data.profile === parsed.profile
        })
        if (prior !== undefined) {
          if (prior.type !== 'design/advisory-review-completed') throw new Error('design advisory journal: invalid completion identity')
          if (prior.data.designRevision !== parsed.designRevision || prior.data.commit !== parsed.commit) {
            throw new Error(`design advisory journal: request ${JSON.stringify(parsed.attemptId)} cannot change target`)
          }
          return undefined
        }
      }
      const existing = current.snapshot.reviewCompletions.find((entry) => entry.profile === parsed.profile)
      if (existing !== undefined) {
        // A late pass for an older Design revision appends nothing: the newer
        // completion remains the profile's read-model truth.
        if (existing.designRevision > parsed.designRevision) return undefined
        const { journalRevision: _existingRevision, ...existingCompletion } = existing
        if (canonical(existingCompletion) === canonical(parsed)) return undefined
      }
      return { type: 'design/advisory-review-completed', data: parsed }
    })
    const entry = mutation.read.snapshot.reviewCompletions.find((candidate) => candidate.profile === parsed.profile)
    return { recorded: mutation.changed, entry }
  }

  /** Advance one accepted receipt with compare-and-set lifecycle semantics. */
  async advanceExecution(
    conversation: string,
    value: { readonly advisoryId: DesignAdvisoryId; readonly receiptId: string; readonly state: Exclude<DesignAdvisoryExecutionState, 'accepted'> },
  ): Promise<readonly DesignJournalAdvisoryEntry[]> {
    void conversation
    void value
    throw new Error('design advisory journal: legacy acceptance receipts are disposition evidence, not tool authority')
  }

  /** Atomically claim an accepted receipt for one executor. */
  async claimExecution(conversation: string, receiptId: string): Promise<{ readonly claimed: boolean; readonly entry: DesignJournalAdvisoryEntry }> {
    void conversation
    void receiptId
    throw new Error('design advisory journal: legacy acceptance receipts are disposition evidence, not tool authority')
  }

  /**
   * Atomically claim a new attempt for one exact v2 action receipt.
   * `allowOrphanedRunning` is process-owner evidence supplied by DesignService;
   * the journal still CASes the exact persisted attempt before replacement.
   */
  async claimActionExecution(
    conversation: string,
    request: {
      readonly receiptId: string
      readonly proposedInvocationId: DesignExecutionInvocationId
      readonly allowOrphanedRunning?: boolean
    },
  ): Promise<DesignAdvisoryActionClaim> {
    const nextAttemptId = randomUUID()
    let advisoryId: DesignAdvisoryId | undefined
    const mutation = await this.storage.atomicMutate(conversation, (current) => {
      const entry = current.snapshot.advisories.find(candidate => candidate.actionReceipts?.some(action => action.receiptId === request.receiptId))
      const action = entry?.actionReceipts?.find(candidate => candidate.receiptId === request.receiptId)
      if (entry === undefined || action === undefined) {
        throw new Error(`design advisory journal: unknown action receipt ${JSON.stringify(request.receiptId)}`)
      }
      advisoryId = entry.advisory.id
      if (action.state === 'completed') return undefined
      if (action.state === 'running' && request.allowOrphanedRunning !== true) return undefined
      const logicalInvocationId = action.logicalInvocationId ?? request.proposedInvocationId
      return {
        type: 'design/advisory-action-attempt',
        data: {
          advisoryId,
          receiptId: request.receiptId,
          attemptId: nextAttemptId,
          logicalInvocationId,
          state: 'running',
          ...(action.state === 'running' ? { supersedesAttemptId: action.attemptId } : {}),
        },
      }
    })
    const entry = mutation.read.snapshot.advisories.find(candidate => candidate.advisory.id === advisoryId)
    const action = entry?.actionReceipts?.find(candidate => candidate.receiptId === request.receiptId)
    if (entry === undefined || action?.attemptId === undefined || action.logicalInvocationId === undefined) {
      throw new Error(`design advisory journal: action receipt ${JSON.stringify(request.receiptId)} disappeared`)
    }
    return Object.freeze({
      claimed: mutation.changed,
      advisoryId: entry.advisory.id,
      action,
      attemptId: action.attemptId,
      effectiveInvocationId: action.logicalInvocationId,
    })
  }

  /** Settle the exact current attempt; repeated identical settlement is idempotent. */
  async settleActionExecution(
    conversation: string,
    request: {
      readonly receiptId: string
      readonly attemptId: string
      readonly state: Exclude<DesignAdvisoryActionState, 'ready' | 'running'>
    },
  ): Promise<DesignJournalAdvisoryActionEntry> {
    let advisoryId: DesignAdvisoryId | undefined
    const mutation = await this.storage.atomicMutate(conversation, (current) => {
      const entry = current.snapshot.advisories.find(candidate => candidate.actionReceipts?.some(action => action.receiptId === request.receiptId))
      const action = entry?.actionReceipts?.find(candidate => candidate.receiptId === request.receiptId)
      if (entry === undefined || action === undefined) {
        throw new Error(`design advisory journal: unknown action receipt ${JSON.stringify(request.receiptId)}`)
      }
      advisoryId = entry.advisory.id
      if (action.attemptId !== request.attemptId || action.logicalInvocationId === undefined) {
        throw new Error(`design advisory journal: action settlement does not own current attempt ${JSON.stringify(request.attemptId)}`)
      }
      if (action.state === request.state) return undefined
      return {
        type: 'design/advisory-action-attempt',
        data: {
          advisoryId,
          receiptId: request.receiptId,
          attemptId: request.attemptId,
          logicalInvocationId: action.logicalInvocationId,
          state: request.state,
        },
      }
    })
    const entry = mutation.read.snapshot.advisories.find(candidate => candidate.advisory.id === advisoryId)
    const action = entry?.actionReceipts?.find(candidate => candidate.receiptId === request.receiptId)
    if (action === undefined) throw new Error(`design advisory journal: action receipt ${JSON.stringify(request.receiptId)} disappeared`)
    return action
  }

  /**
   * List one conversation's advisories and dispositions.
   * @param conversation - opaque caller-owned conversation identity.
   * @returns frozen entries in publication order at the latest revision.
   */
  async list(conversation: string): Promise<readonly DesignJournalAdvisoryEntry[]> {
    return (await this.storage.read(conversation)).snapshot.advisories
  }

  /**
   * Subscribe to persisted advisory changes for one conversation.
   * @param conversation - opaque caller-owned conversation identity.
   * @param listener - callback receiving entries after each persisted append.
   * @returns a disposer for this listener.
   */
  subscribe(conversation: string, listener: (entries: readonly DesignJournalAdvisoryEntry[]) => void): () => void {
    return this.storage.subscribe(conversation, (value) => listener(value.snapshot.advisories))
  }
}
