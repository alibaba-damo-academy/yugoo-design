/**
 * Host-neutral workspace registry for design journals.
 *
 * One registry is the explicit plugin-lifetime owner of its journals: it
 * caches exactly one DesignJournalStorage and one DesignAdvisoryJournal pair
 * per resolved trusted root, and every handle obtained from the same
 * registry shares that pair's per-conversation queue. Independent registries
 * and separate processes are deliberately not synchronized. The root comes
 * from a caller-supplied resolver keyed by a trusted adapter-provided scope:
 * nothing here imports host packages or hardcodes a working directory.
 */
import {
  DesignAdvisoryJournal,
  type DesignAdvisoryActionClaim,
  type ResolvedDesignAdvisoryAction,
} from './design-advisory-journal.ts'
import { DesignExecutionHandoffJournal } from './design-execution-handoff-journal.ts'
import { DesignJournalStorage, type DesignJournalMutator, type DesignJournalMutation, type DesignJournalRead } from './design-journal-storage.ts'
import type { DesignAdvisoryId } from './design-advisory.ts'
import type { DesignAdvisoryActionState, DesignAdvisoryExecutionState, DesignJournalAdvisoryActionEntry, DesignJournalAdvisoryEntry, DesignJournalExecutionHandoffConsumption } from './design-journal.ts'
import type { DesignExecutionInvocationId } from './design-execution-runtime.ts'

/** Maps a trusted adapter-provided workspace scope to one journal root. */
export type DesignJournalRootResolver = (scope: string) => string

/** Shared storage and advisory repository for one resolved journal root. */
interface DesignJournalRegistryEntry {
  readonly storage: DesignJournalStorage
  readonly advisories: DesignAdvisoryJournal
  readonly executionHandoffs: DesignExecutionHandoffJournal
}

/** Listener receiving the advisory entries after each persisted append. */
export type DesignAdvisoryJournalListener = (entries: readonly DesignJournalAdvisoryEntry[]) => void

/** Listener receiving the exact post-append read model. */
export type DesignJournalRegistrySubscriber = (value: DesignJournalRead) => void

/**
 * Explicit owner of per-root design journals for one plugin lifetime.
 * Handles resolved from this registry share per-root storage instances, so
 * per-conversation ordering and atomic compare/fold+append semantics hold
 * across handles. `dispose` releases every subscription and cached pair; a
 * fresh registry over the same root then restarts by folding disk state.
 */
export class DesignJournalRegistry {
  private readonly resolveRoot: DesignJournalRootResolver
  private readonly afterAppend?: (scope: string, file: string) => Promise<void>
  private readonly entries = new Map<string, DesignJournalRegistryEntry>()
  private readonly journalListeners = new Map<string, Set<DesignJournalRegistrySubscriber>>()
  private readonly advisoryListeners = new Map<string, Set<DesignAdvisoryJournalListener>>()
  private readonly journalDisposers = new Map<string, () => void>()
  private readonly advisoryDisposers = new Map<string, () => void>()
  private disposed = false

  /**
   * Bind the registry to one trusted root resolver.
   * @param resolveRoot - maps a trusted workspace scope to a journal root.
   */
  constructor(resolveRoot: DesignJournalRootResolver, afterAppend?: (scope: string, file: string) => Promise<void>) {
    if (typeof resolveRoot !== 'function') {
      throw new Error('design journal registry: root resolver must be a function')
    }
    this.resolveRoot = resolveRoot
    this.afterAppend = afterAppend
  }

  /**
   * Append one journal fact for a conversation.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @param candidate - untrusted fact without an assigned revision.
   * @returns records and snapshot including the persisted append.
   */
  async append(scope: string, conversation: string, candidate: unknown): Promise<DesignJournalRead> {
    return this.entryOf(scope).storage.append(conversation, candidate)
  }

  /**
   * Atomically compare the exact current read model and append for one
   * conversation. The mutator receives the exact current read and returns a
   * fact candidate, or undefined to append nothing; the decision runs inside
   * the storage's per-conversation queue, so it cannot race a concurrent
   * append sharing this registry.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @param mutator - pure decision over the exact current read model.
   * @returns whether an append persisted, with the exact read model either way.
   */
  async atomicMutate(scope: string, conversation: string, mutator: DesignJournalMutator): Promise<DesignJournalMutation> {
    return this.entryOf(scope).storage.atomicMutate(conversation, mutator)
  }

  /**
   * Read and strictly fold one conversation journal.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @returns records and snapshot at the same exact revision.
   */
  async read(scope: string, conversation: string): Promise<DesignJournalRead> {
    return this.entryOf(scope).storage.read(conversation)
  }

  /**
   * Atomically publish one advisory for a conversation.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @param advisory - untrusted advisory value validated before persistence.
   * @returns frozen entries in publication order after the operation.
   */
  async publish(scope: string, conversation: string, advisory: unknown): Promise<readonly DesignJournalAdvisoryEntry[]> {
    return this.entryOf(scope).advisories.publish(conversation, advisory)
  }

  /**
   * Atomically record one human disposition for a conversation advisory.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @param decision - untrusted disposition validated before persistence.
   * @returns frozen entries in publication order after the operation.
   */
  async decide(
    scope: string,
    conversation: string,
    decision: unknown,
    resolvedActions: readonly ResolvedDesignAdvisoryAction[] = [],
  ): Promise<readonly DesignJournalAdvisoryEntry[]> {
    return this.entryOf(scope).advisories.decide(conversation, decision, resolvedActions)
  }

  /** Atomically record the Agent's choice for an accepted review advisory. */
  async selectReviewAction(
    scope: string,
    conversation: string,
    request: Parameters<DesignAdvisoryJournal['selectReviewAction']>[1],
    action?: ResolvedDesignAdvisoryAction,
  ): Promise<DesignJournalAdvisoryEntry> {
    return this.entryOf(scope).advisories.selectReviewAction(conversation, request, action)
  }

  /** Atomically record one completed advisory review pass (empty findings included). */
  async recordAdvisoryReviewCompletion(
    scope: string,
    conversation: string,
    completion: unknown,
  ): Promise<{ readonly recorded: boolean; readonly entry: import('./design-journal.ts').DesignJournalAdvisoryReviewCompletionEntry | undefined }> {
    return this.entryOf(scope).advisories.recordReviewCompletion(conversation, completion)
  }

  /** Advance one durable advisory acceptance/execution receipt. */
  async advanceAdvisoryExecution(
    scope: string,
    conversation: string,
    value: { readonly advisoryId: DesignAdvisoryId; readonly receiptId: string; readonly state: Exclude<DesignAdvisoryExecutionState, 'accepted'> },
  ): Promise<readonly DesignJournalAdvisoryEntry[]> {
    return this.entryOf(scope).advisories.advanceExecution(conversation, value)
  }

  /** Atomically claim one accepted receipt; only the first concurrent executor wins. */
  async claimAdvisoryExecution(
    scope: string,
    conversation: string,
    receiptId: string,
  ): Promise<{ readonly claimed: boolean; readonly entry: DesignJournalAdvisoryEntry }> {
    return this.entryOf(scope).advisories.claimExecution(conversation, receiptId)
  }

  /** Atomically claim one exact v2 action receipt attempt. */
  async claimAdvisoryActionExecution(
    scope: string,
    conversation: string,
    request: {
      readonly receiptId: string
      readonly proposedInvocationId: DesignExecutionInvocationId
      readonly allowOrphanedRunning?: boolean
    },
  ): Promise<DesignAdvisoryActionClaim> {
    return this.entryOf(scope).advisories.claimActionExecution(conversation, request)
  }

  /** Settle the exact current v2 action attempt. */
  async settleAdvisoryActionExecution(
    scope: string,
    conversation: string,
    request: {
      readonly receiptId: string
      readonly attemptId: string
      readonly state: Exclude<DesignAdvisoryActionState, 'ready' | 'running'>
    },
  ): Promise<DesignJournalAdvisoryActionEntry> {
    return this.entryOf(scope).advisories.settleActionExecution(conversation, request)
  }

  /**
   * List one conversation's advisories and dispositions.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @returns frozen entries in publication order at the latest revision.
   */
  async list(scope: string, conversation: string): Promise<readonly DesignJournalAdvisoryEntry[]> {
    return this.entryOf(scope).advisories.list(conversation)
  }

  /** Test whether one exact must-edit disposition is already durable. */
  async isExecutionHandoffConsumed(
    scope: string,
    conversation: string,
    candidate: DesignJournalExecutionHandoffConsumption,
  ): Promise<boolean> {
    return this.entryOf(scope).executionHandoffs.isConsumed(conversation, candidate)
  }

  /** Persist one successful must-edit release exactly once. */
  async consumeExecutionHandoff(
    scope: string,
    conversation: string,
    candidate: DesignJournalExecutionHandoffConsumption,
  ): Promise<void> {
    await this.entryOf(scope).executionHandoffs.consume(conversation, candidate)
  }

  /**
   * Subscribe to persisted journal appends for one conversation.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @param listener - callback receiving an exact post-append read model.
   * @returns a disposer for this listener.
   */
  subscribe(scope: string, conversation: string, listener: DesignJournalRegistrySubscriber): () => void {
    const { root, entry } = this.checkedEntryOf(scope)
    return this.track(this.journalListeners, this.journalDisposers, root, conversation, listener, (dispatch) => (
      entry.storage.subscribe(conversation, dispatch)
    ))
  }

  /**
   * Subscribe to persisted advisory changes for one conversation.
   * @param scope - trusted adapter-provided workspace key.
   * @param conversation - opaque caller-owned conversation identity.
   * @param listener - callback receiving entries after each persisted append.
   * @returns a disposer for this listener.
   */
  subscribeAdvisories(scope: string, conversation: string, listener: DesignAdvisoryJournalListener): () => void {
    const { root, entry } = this.checkedEntryOf(scope)
    return this.track(this.advisoryListeners, this.advisoryDisposers, root, conversation, listener, (dispatch) => (
      entry.advisories.subscribe(conversation, dispatch)
    ))
  }

  /**
   * Release every subscription and cached journal pair owned by this
   * registry. Later operations fail loud; a fresh registry over the same
   * roots restarts by folding persisted state.
   */
  dispose(): void {
    this.disposed = true
    for (const dispose of this.journalDisposers.values()) dispose()
    for (const dispose of this.advisoryDisposers.values()) dispose()
    this.journalDisposers.clear()
    this.advisoryDisposers.clear()
    this.journalListeners.clear()
    this.advisoryListeners.clear()
    this.entries.clear()
  }

  /**
   * Release the cached journal pair for one resolved root after disposing
   * its subscriptions. Handles resolving the same root later create a fresh
   * pair that restarts from persisted state.
   * @param scope - trusted adapter-provided workspace key.
   */
  release(scope: string): void {
    const root = this.rootOf(scope)
    if (!this.entries.has(root)) return
    this.dropRoot(this.journalListeners, this.journalDisposers, root)
    this.dropRoot(this.advisoryListeners, this.advisoryDisposers, root)
    this.entries.delete(root)
  }

  private dropRoot<TListener>(
    listenersByConversation: Map<string, Set<TListener>>,
    disposers: Map<string, () => void>,
    root: string,
  ): void {
    const prefix = `${root}\u0000`
    for (const key of [...disposers.keys()]) {
      if (!key.startsWith(prefix)) continue
      disposers.get(key)?.()
      disposers.delete(key)
      listenersByConversation.delete(key)
    }
  }

  private entryOf(scope: string): DesignJournalRegistryEntry {
    return this.checkedEntryOf(scope).entry
  }

  private checkedEntryOf(scope: string): { readonly root: string; readonly entry: DesignJournalRegistryEntry } {
    if (this.disposed) throw new Error('design journal registry: registry is disposed')
    const root = this.rootOf(scope)
    const existing = this.entries.get(root)
    if (existing !== undefined) return { root, entry: existing }
    const storage = new DesignJournalStorage(root, {}, this.afterAppend === undefined ? undefined : {
      projectRoot: scope, afterAppend: file => this.afterAppend!(scope, file),
    })
    const created = Object.freeze({
      storage,
      advisories: new DesignAdvisoryJournal(storage),
      executionHandoffs: new DesignExecutionHandoffJournal(storage),
    })
    this.entries.set(root, created)
    return { root, entry: created }
  }

  private rootOf(scope: string): string {
    if (typeof scope !== 'string' || scope.length === 0) {
      throw new Error('design journal registry: workspace scope must be a non-empty string')
    }
    const root = this.resolveRoot(scope)
    if (typeof root !== 'string' || root.length === 0) {
      throw new Error(`design journal registry: root resolver returned no root for scope ${JSON.stringify(scope)}`)
    }
    return root
  }

  private track<TListener extends (value: never) => void>(
    listenersByConversation: Map<string, Set<TListener>>,
    disposers: Map<string, () => void>,
    root: string,
    conversation: string,
    listener: TListener,
    open: (dispatch: TListener) => () => void,
  ): () => void {
    const key = `${root}\u0000${conversation}`
    const listeners = listenersByConversation.get(key) ?? new Set<TListener>()
    listeners.add(listener)
    if (listeners.size === 1) {
      listenersByConversation.set(key, listeners)
      disposers.set(key, open(((value: never) => {
        for (const target of listeners) target(value)
      }) as TListener))
    }
    let released = false
    return () => {
      if (released) return
      released = true
      listeners.delete(listener)
      if (listeners.size !== 0) return
      if (listenersByConversation.get(key) !== listeners) return
      listenersByConversation.delete(key)
      disposers.get(key)?.()
      disposers.delete(key)
    }
  }
}
