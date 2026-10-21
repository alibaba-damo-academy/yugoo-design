/** Durable one-shot must-edit dispositions over one DesignJournalStorage. */
import {
  parseDesignJournalExecutionHandoffConsumption,
  type DesignJournalExecutionHandoffConsumption,
  type DesignJournalRecord,
} from './design-journal.ts'
import type { DesignJournalStorage } from './design-journal-storage.ts'

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function matchingChange(
  record: DesignJournalRecord,
  consumption: DesignJournalExecutionHandoffConsumption,
  origin: 'agent' | 'panel',
  commit: string,
): boolean {
  return record.type === 'design/changed'
    && record.data.kit === consumption.pin.kitName
    && record.data.version === consumption.pin.kitVersion
    && record.data.skill === consumption.pin.skillName
    && record.data.origin === origin
    && record.data.commit === commit
}

function assertAuthority(
  records: readonly DesignJournalRecord[],
  consumption: DesignJournalExecutionHandoffConsumption,
): void {
  const agentIndex = records.findIndex((record) => matchingChange(record, consumption, 'agent', consumption.pin.stateRevision))
  if (agentIndex < 0) {
    throw new Error('design execution handoff journal: missing authoritative agent Design change for the gated revision')
  }
  const panelIndex = records.findIndex((record, index) => (
    index > agentIndex && matchingChange(record, consumption, 'panel', consumption.panelStateRevision)
  ))
  if (panelIndex < 0) {
    throw new Error('design execution handoff journal: missing authoritative later panel Design change for the released revision')
  }
}

function findDisposition(
  records: readonly DesignJournalExecutionHandoffConsumption[],
  candidate: DesignJournalExecutionHandoffConsumption,
): DesignJournalExecutionHandoffConsumption | undefined {
  const existing = records.find((entry) => entry.invocationId === candidate.invocationId)
  if (existing !== undefined && canonical(existing) !== canonical(candidate)) {
    throw new Error(`design execution handoff journal: invocation ${JSON.stringify(candidate.invocationId)} was consumed with different authority`)
  }
  return existing
}

/** Async repository for must-edit dispositions keyed by one journal conversation. */
export class DesignExecutionHandoffJournal {
  private readonly storage: DesignJournalStorage

  /** @param storage - durable per-conversation DesignJournal owner. */
  constructor(storage: DesignJournalStorage) {
    this.storage = storage
  }

  /**
   * Test whether one exact gate-to-panel handoff has already been consumed.
   * Both referenced Design changes must exist in the journal; absent authority
   * fails instead of being treated as an unconsumed gate.
   * @param conversation - opaque caller-owned conversation identity.
   * @param candidate - exact gate pin and authoritative panel HEAD revision.
   * @returns true only for the exact persisted disposition.
   */
  async isConsumed(conversation: string, candidate: unknown): Promise<boolean> {
    const parsed = parseDesignJournalExecutionHandoffConsumption(candidate)
    const current = await this.storage.read(conversation)
    assertAuthority(current.records, parsed)
    return findDisposition(current.snapshot.consumedExecutionHandoffs, parsed) !== undefined
  }

  /**
   * Persist one successful gate release exactly once. Exact retries append
   * nothing; changed pins or panel authority for the same invocation fail.
   * @param conversation - opaque caller-owned conversation identity.
   * @param candidate - exact gate pin and authoritative panel HEAD revision.
   */
  async consume(conversation: string, candidate: unknown): Promise<void> {
    const parsed = parseDesignJournalExecutionHandoffConsumption(candidate)
    await this.storage.atomicMutate(conversation, (current) => {
      assertAuthority(current.records, parsed)
      if (findDisposition(current.snapshot.consumedExecutionHandoffs, parsed) !== undefined) return undefined
      return { type: 'design/execution-handoff-consumed', data: parsed }
    })
  }
}
