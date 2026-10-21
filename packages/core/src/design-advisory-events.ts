/**
 * DSH inbox projection, wire parsers, and staleness read model for Design
 * System advisories. Durable publications and human dispositions live in
 * DesignJournal; this module only detects Design-sourced built-in inbox
 * events, validates the review UI read model, and derives advisory staleness
 * from current project-journal and Kit facts. Nothing here writes Design Files,
 * mutates the journal, or owns advisory persistence.
 */
import {
  DesignAdvisoryId,
  parseDesignAdvisory,
  type DesignAdvisory,
  type DesignAdvisoryDecision,
} from './design-advisory.ts'
import {
  parseDesignJournalAdvisoryActionEntry,
  parseDesignJournalAdvisorySelection,
  type DesignJournalAdvisorySelectionEntry,
  deriveAdvisoryExecutionStatus,
  type DesignAdvisoryExecutionAggregate,
  type DesignJournalAdvisoryActionEntry,
} from './design-journal.ts'

/** Human disposition recorded by the Design review UI. */
export interface DesignAdvisoryDecisionPayload {
  readonly advisoryId: DesignAdvisoryId
  readonly decision: DesignAdvisoryDecision
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Revision counter bumped when the Design plugin splices advisory notices into the inbox. */
    designAdvisoryInbox: number
  }
  interface SessionProjectionStateMap {
    /** Fold state for `designAdvisoryInbox`: the revision counter itself. */
    designAdvisoryInbox: number
  }
}

/** Producer identity stamped on Yugoo-authored inbox notices. */
export const DESIGN_ADVISORY_SOURCE_KIND = 'yugoo-design'

/** Minimal shape of one spliced user message source. */
interface InboxMessageLike {
  readonly source?: { readonly kind?: string }
}

/**
 * Fold one built-in inbox splice event into the advisory revision counter.
 * Only splices inserting Design-sourced notices bump the revision.
 * @param revision - current revision counter.
 * @param event - session event (other types are ignored).
 * @returns the next revision counter.
 */
export function applyAdvisoryInboxEvent(revision: number, event: { readonly type: string; readonly data: unknown }): number {
  if (event.type !== 'agent/inbox/spliced') return revision
  if (typeof event.data !== 'object' || event.data === null) return revision
  const inserted = (event.data as { inserted?: unknown }).inserted
  if (!Array.isArray(inserted)) return revision
  const touched = inserted.some((message) => {
    if (typeof message !== 'object' || message === null) return false
    return (message as InboxMessageLike).source?.kind === DESIGN_ADVISORY_SOURCE_KIND
  })
  return touched ? revision + 1 : revision
}

/** One advisory projected for the Design review UI. */
export interface SessionDesignAdvisory {
  readonly selection?: DesignJournalAdvisorySelectionEntry
  readonly publishedAt?: number
  readonly publishedRevision?: number
  readonly advisory: DesignAdvisory
  readonly status: 'pending' | DesignAdvisoryDecision | 'queued' | 'running' | 'failed' | 'needs-user-input' | 'completed' | 'invalidated'
  /** Durable id of an accepted advisory; also serves as the dispatch correlation key. */
  readonly acceptanceReceiptId?: string
  /** Exact tool authority minted from a v2 actionSpec; absent for legacy entries. */
  readonly actionReceipts?: readonly DesignJournalAdvisoryActionEntry[]
  /** Aggregate of action receipts, independent from the human disposition. */
  readonly executionStatus?: DesignAdvisoryExecutionAggregate
  /** Read-model derivation: inputs need revalidation; this is never a visibility or terminal flag. */
  readonly stale: boolean
}

/** Current Design facts against which advisory input pins are compared. */
export interface DesignAdvisoryCurrency {
  /** Journal revision of the most recent authoritative Design change. */
  readonly designRevision: number | undefined
  /** Currently effective exact Kit pin; absent before any Kit selection. */
  readonly kit?: { readonly name: string; readonly version: string }
}

/**
 * Derive staleness of one published advisory from its input pins.
 * Compares the advisory's `design-revision` journal pin and `kit:` pin against
 * the current Design facts; either mismatch marks the advisory stale. The
 * revision pin must equal the stringified current revision exactly; neither
 * pin participates in any numeric coercion. An advisory carrying neither pin
 * predates this derivation and stays current; no other pin source
 * participates.
 * @param advisory - the published advisory with its input pins.
 * @param current - latest DesignJournal change revision and exact Kit pin.
 * @returns whether the advisory's input revision is no longer current.
 */
export function deriveAdvisoryStaleness(advisory: DesignAdvisory, current: DesignAdvisoryCurrency): boolean {
  const designPin = advisory.inputs.find((pin) => pin.source === 'design-revision')
  const kitPin = advisory.inputs.find((pin) => pin.source.startsWith('kit:'))
  if (designPin === undefined && kitPin === undefined) return false
  if (designPin !== undefined) {
    if (current.designRevision === undefined || designPin.revision !== String(current.designRevision)) return true
  }
  if (kitPin !== undefined) {
    if (current.kit === undefined) return true
    if (current.kit.name !== kitPin.source.slice('kit:'.length)) return true
    if (current.kit.version !== kitPin.revision) return true
  }
  return false
}

/** Strictly parse a human advisory decision. */
export function parseDesignAdvisoryDecision(value: unknown): DesignAdvisoryDecisionPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('design advisory decision: expected an object')
  }
  const record = value as Record<string, unknown>
  const fields = Object.keys(record)
  if (fields.length !== 2 || !fields.includes('advisoryId') || !fields.includes('decision')) {
    throw new Error('design advisory decision: expected advisoryId and decision')
  }
  if (record.decision !== 'accepted' && record.decision !== 'rejected' && record.decision !== 'deferred') {
    throw new Error('design advisory decision: unsupported decision')
  }
  if (typeof record.advisoryId !== 'string') {
    throw new Error('design advisory decision: advisoryId must be text')
  }
  return Object.freeze({
    advisoryId: DesignAdvisoryId(record.advisoryId),
    decision: record.decision,
  })
}

/** Strictly parse the complete advisory list at its wire boundary. */
export function parseSessionDesignAdvisories(value: unknown): readonly SessionDesignAdvisory[] {
  if (!Array.isArray(value)) throw new Error('design advisories: expected an array')
  const parsed = value.map((candidate, index) => {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new Error(`design advisories: entry ${index} must be an object`)
    }
    const record = candidate as Record<string, unknown>
    const expectedFields = [
      'advisory', 'status', 'stale',
      ...(record.acceptanceReceiptId === undefined ? [] : ['acceptanceReceiptId']),
      ...(record.actionReceipts === undefined ? [] : ['actionReceipts']),
      ...(record.executionStatus === undefined ? [] : ['executionStatus']),
      ...(record.selection === undefined ? [] : ['selection']),
    ]
    if (Object.keys(record).length !== expectedFields.length
      || Object.keys(record).some(field => !expectedFields.includes(field))
      || expectedFields.some(field => !Object.hasOwn(record, field))) {
      throw new Error(`design advisories: entry ${index} has invalid fields`)
    }
    if (record.status !== 'pending' && record.status !== 'accepted'
      && record.status !== 'rejected' && record.status !== 'deferred' && record.status !== 'queued'
      && record.status !== 'running' && record.status !== 'failed' && record.status !== 'needs-user-input'
      && record.status !== 'completed' && record.status !== 'invalidated') {
      throw new Error(`design advisories: entry ${index} has an unsupported status`)
    }
    if (typeof record.stale !== 'boolean') {
      throw new Error(`design advisories: entry ${index} stale flag must be boolean`)
    }
    if (record.acceptanceReceiptId !== undefined && (typeof record.acceptanceReceiptId !== 'string' || record.acceptanceReceiptId.length === 0)) {
      throw new Error(`design advisories: entry ${index} acceptanceReceiptId must be non-empty text`)
    }
    if (record.actionReceipts !== undefined && !Array.isArray(record.actionReceipts)) {
      throw new Error(`design advisories: entry ${index} actionReceipts must be an array`)
    }
    const actionReceipts = record.actionReceipts === undefined
      ? undefined
      : record.actionReceipts.map((action, actionIndex) => parseDesignJournalAdvisoryActionEntry(action, `design advisories: entry ${index}.actionReceipts[${actionIndex}]`))
    if (actionReceipts !== undefined && new Set(actionReceipts.map(action => action.receiptId)).size !== actionReceipts.length) {
      throw new Error(`design advisories: entry ${index} has duplicate action receipt ids`)
    }
    if (record.executionStatus !== undefined && record.executionStatus !== 'not-applicable'
      && record.executionStatus !== 'ready' && record.executionStatus !== 'running'
      && record.executionStatus !== 'failed' && record.executionStatus !== 'needs-user-input'
      && record.executionStatus !== 'completed') {
      throw new Error(`design advisories: entry ${index} has an unsupported executionStatus`)
    }
    if ((actionReceipts === undefined) !== (record.executionStatus === undefined)) {
      throw new Error(`design advisories: entry ${index} actionReceipts and executionStatus must be present together`)
    }
    if (actionReceipts !== undefined) {
      if (record.acceptanceReceiptId === undefined) {
        throw new Error(`design advisories: entry ${index} action receipts require an acceptance receipt`)
      }
      if (deriveAdvisoryExecutionStatus(actionReceipts) !== record.executionStatus) {
        throw new Error(`design advisories: entry ${index} executionStatus does not match its action receipts`)
      }
    }
    let selection: DesignJournalAdvisorySelectionEntry | undefined
    if (record.selection !== undefined) {
      if (typeof record.selection !== 'object' || record.selection === null || Array.isArray(record.selection)) {
        throw new Error('design advisories: invalid selection')
      }
      const { journalRevision, ...value } = record.selection as Record<string, unknown>
      if (!Number.isSafeInteger(journalRevision) || (journalRevision as number) < 1) throw new Error('design advisories: invalid selection revision')
      const parsedSelection = parseDesignJournalAdvisorySelection(value)
      const advisory = parseDesignAdvisory(record.advisory)
      if (parsedSelection.advisoryId !== advisory.id || parsedSelection.acceptanceReceiptId !== record.acceptanceReceiptId
        || advisory.schemaVersion !== 2 || advisory.actionSpec.kind !== 'review-choice') {
        throw new Error('design advisories: selection identity mismatch')
      }
      if ((parsedSelection.kind === 'host-question' && advisory.actionSpec.profile !== 'alignment')
        || (parsedSelection.kind === 'host-research' && advisory.actionSpec.profile !== 'reflection')) {
        throw new Error('design advisories: selection profile mismatch')
      }
      if (parsedSelection.actions.length !== actionReceipts?.length || parsedSelection.actions.some(selected => {
        const action = actionReceipts?.find(item => item.receiptId === selected.receiptId)
        return !action || action.actionId !== selected.actionId
          || action.target.kitName !== selected.target.kitName || action.target.kitVersion !== selected.target.kitVersion
          || action.target.skillName !== selected.target.skillName || action.target.bundleVersion !== selected.target.bundleVersion
          || JSON.stringify(action.target.entityRefs) !== JSON.stringify(selected.target.entityRefs)
          || JSON.stringify(selected.target.entityRefs) !== JSON.stringify(advisory.actionSpec.kind === 'review-choice' ? advisory.actionSpec.entityRefs : [])
      })) throw new Error('design advisories: selection action mismatch')
      selection = Object.freeze({ ...parsedSelection, journalRevision: journalRevision as number })
    }
    return Object.freeze({
      advisory: parseDesignAdvisory(record.advisory),
      status: record.status,
      stale: record.stale,
      ...(record.acceptanceReceiptId === undefined ? {} : { acceptanceReceiptId: record.acceptanceReceiptId }),
      ...(actionReceipts === undefined ? {} : { actionReceipts: Object.freeze(actionReceipts) }),
      ...(record.executionStatus === undefined ? {} : { executionStatus: record.executionStatus }),
      ...(selection === undefined ? {} : { selection }),
    })
  })
  if (new Set(parsed.map((entry) => entry.advisory.id)).size !== parsed.length) {
    throw new Error('design advisories: duplicate advisory ids are not allowed')
  }
  return Object.freeze(parsed)
}
