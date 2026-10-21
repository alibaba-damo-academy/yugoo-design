/** Replay adapter from authoritative DesignJournal decisions to Design Knowledge. */
import type { DesignKnowledgeDecision } from './design-knowledge.ts'
import type { DesignJournalRecord } from './design-journal.ts'

/**
 * Project all knowledge decisions from one journal in authoritative revision order.
 * @param journal - opaque DesignJournal identity, normally the conversation id.
 * @param records - complete, strictly parsed journal records.
 * @returns provider-neutral decisions ready for idempotent materialization.
 */
export function projectDesignKnowledgeDecisions(
  journal: string,
  records: readonly DesignJournalRecord[],
): readonly DesignKnowledgeDecision[] {
  if (journal.trim() === '' || Buffer.byteLength(journal, 'utf8') > 512) {
    throw new Error('design knowledge journal: journal identity must be 1–512 UTF-8 bytes')
  }
  return Object.freeze(records.flatMap((record): readonly DesignKnowledgeDecision[] => {
    if (record.type !== 'design/knowledge-decided') return []
    return [Object.freeze({
      ...record.data,
      journal,
      journalRevision: record.revision,
    })]
  }))
}
