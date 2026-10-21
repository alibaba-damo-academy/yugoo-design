/** Durable human Design Knowledge decisions over one DesignJournalStorage. */
import { DesignKnowledgeProposalDigest, DesignKnowledgeProposalId, DesignKnowledgeRevision } from './design-knowledge.ts'
import { DesignProjectId } from './design-project.ts'
import type { DesignJournalKnowledgeDecision, DesignJournalKnowledgeDecisionEntry } from './design-journal.ts'
import type { DesignJournalStorage } from './design-journal-storage.ts'

function parseDecision(value: unknown): DesignJournalKnowledgeDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('design knowledge decision journal: decision must be a plain object')
  }
  const record = value as Record<string, unknown>
  const keys = ['projectId', 'proposalId', 'proposalRevision', 'proposalDigest', 'decision', 'checkpoint']
  const missing = keys.filter((key) => !Object.hasOwn(record, key))
  const extra = Object.keys(record).filter((key) => !keys.includes(key))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`design knowledge decision journal: invalid fields (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
  }
  if (typeof record.projectId !== 'string') throw new Error('design knowledge decision journal: projectId must be text')
  if (typeof record.proposalId !== 'string') throw new Error('design knowledge decision journal: proposalId must be text')
  if (typeof record.proposalRevision !== 'string') throw new Error('design knowledge decision journal: proposalRevision must be text')
  if (typeof record.proposalDigest !== 'string') throw new Error('design knowledge decision journal: proposalDigest must be text')
  if (record.decision !== 'accepted' && record.decision !== 'rejected' && record.decision !== 'deferred') {
    throw new Error('design knowledge decision journal: decision must be accepted, rejected, or deferred')
  }
  if (typeof record.checkpoint !== 'string' || record.checkpoint.trim() === '' || Buffer.byteLength(record.checkpoint, 'utf8') > 512) {
    throw new Error('design knowledge decision journal: checkpoint must be 1–512 UTF-8 bytes')
  }
  return Object.freeze({
    projectId: DesignProjectId(record.projectId),
    proposalId: DesignKnowledgeProposalId(record.proposalId),
    proposalRevision: DesignKnowledgeRevision(record.proposalRevision),
    proposalDigest: DesignKnowledgeProposalDigest(record.proposalDigest),
    decision: record.decision,
    checkpoint: record.checkpoint,
  })
}

/**
 * Per-conversation repository for `Promote`, `Reject`, and `Later` decisions.
 * It records authority only; a separate projector materializes the decision in
 * the selected Design Knowledge provider.
 */
export class DesignKnowledgeDecisionJournal {
  readonly #storage: DesignJournalStorage

  /** @param storage - durable project-scoped DesignJournal storage. */
  constructor(storage: DesignJournalStorage) {
    this.#storage = storage
  }

  /** Record one idempotent human decision. */
  async decide(journal: string, candidate: unknown): Promise<readonly DesignJournalKnowledgeDecisionEntry[]> {
    const decision = parseDecision(candidate)
    const { read } = await this.#storage.atomicMutate(journal, (current) => {
      const existing = [...current.snapshot.knowledgeDecisions].reverse().find((entry) => entry.proposalId === decision.proposalId)
      if (existing?.decision === 'accepted' || existing?.decision === 'rejected') {
        if (existing.projectId === decision.projectId && existing.proposalRevision === decision.proposalRevision && existing.proposalDigest === decision.proposalDigest && existing.checkpoint === decision.checkpoint && existing.decision === decision.decision) return undefined
        throw new Error(`design knowledge decision journal: terminal decision for ${JSON.stringify(decision.proposalId)} cannot change`)
      }
      if (existing !== undefined && existing.projectId !== decision.projectId) {
        throw new Error(`design knowledge decision journal: proposal ${JSON.stringify(decision.proposalId)} cannot move between projects`)
      }
      if (existing !== undefined && existing.decision === decision.decision && existing.proposalRevision === decision.proposalRevision && existing.proposalDigest === decision.proposalDigest && existing.checkpoint === decision.checkpoint) return undefined
      return { type: 'design/knowledge-decided', data: decision }
    })
    return read.snapshot.knowledgeDecisions
  }

  /** Read decisions in authoritative journal order. */
  async list(journal: string): Promise<readonly DesignJournalKnowledgeDecisionEntry[]> {
    return (await this.#storage.read(journal)).snapshot.knowledgeDecisions
  }
}
