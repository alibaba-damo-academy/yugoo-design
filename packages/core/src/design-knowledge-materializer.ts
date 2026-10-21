/** Replay authoritative DesignJournal decisions into Design Knowledge. */
import type { DesignJournalRecord } from './design-journal.ts'
import { projectDesignKnowledgeDecisions } from './design-knowledge-journal.ts'
import type { DesignKnowledgeArchivedProposal, DesignKnowledgeDecision, DesignKnowledgeMutationResult, DesignKnowledgeService } from './design-knowledge.ts'
import type { DesignProjectId } from './design-project.ts'

/** Result of one ordered journal materialization pass. */
export interface DesignKnowledgeMaterializationResult {
  readonly considered: number
  readonly committed: number
  readonly replayed: number
  readonly revision: Awaited<ReturnType<DesignKnowledgeService['revision']>>
}

/**
 * Materialize every decision for one project in journal order. Exported
 * decisions retain each journal event independently of provider-local revision
 * remapping, so a restored cache may safely replay the original journal.
 *
 * @param service - acquired provider-neutral Design Knowledge service.
 * @param projectId - selected Design Project receiving the decisions.
 * @param journal - opaque DesignJournal identity.
 * @param records - complete strictly parsed journal records.
 * @returns counts and the final provider revision.
 */
export async function materializeDesignKnowledgeJournal(
  service: DesignKnowledgeService,
  projectId: DesignProjectId,
  journal: string,
  records: readonly DesignJournalRecord[],
): Promise<DesignKnowledgeMaterializationResult> {
  const decisions = projectDesignKnowledgeDecisions(journal, records).filter((decision) => decision.projectId === projectId)
  let committed = 0
  let replayed = 0
  const retained = new Map<string, DesignKnowledgeDecision>()
  const proposals = new Map<string, DesignKnowledgeArchivedProposal>()
  const eventKey = (decision: DesignKnowledgeDecision) => JSON.stringify([decision.journal, decision.journalRevision])
  if (decisions.length > 0) {
    const archive = await service.exportProject(projectId)
    if (archive.projectId !== projectId) throw new Error('design knowledge materializer: archived project identity conflicts with the selected project')
    for (const item of archive.proposals) {
      if (proposals.has(item.proposal.id)) throw new Error('design knowledge materializer: duplicate archived proposal')
      proposals.set(item.proposal.id, item)
    }
    for (const decision of archive.decisions) {
      const key = eventKey(decision)
      if (retained.has(key)) throw new Error('design knowledge materializer: duplicate archived journal decision')
      retained.set(key, decision)
    }
  }
  for (const decision of decisions) {
    const key = eventKey(decision), existing = retained.get(key)
    if (existing) {
      // proposalRevision belongs to a provider incarnation. The immutable
      // proposal id/digest and the authoritative journal event must still match.
      if (existing.projectId !== decision.projectId || existing.proposalId !== decision.proposalId || existing.proposalDigest !== decision.proposalDigest
        || existing.decision !== decision.decision || existing.checkpoint !== decision.checkpoint) {
        throw new Error(`design knowledge materializer: journal decision ${decision.journalRevision} conflicts with the retained decision`)
      }
      replayed += 1
      continue
    }
    const proposal = proposals.get(decision.proposalId)
    if (!proposal || proposal.proposal.projectId !== projectId || proposal.proposalDigest !== decision.proposalDigest) {
      throw new Error('design knowledge materializer: journal decision does not bind a retained immutable proposal')
    }
    // A journal event may have settled after the archived snapshot. Bind it to
    // the same immutable proposal's current cache revision without rewriting
    // the original journal record.
    const projected = { ...decision, proposalRevision: proposal.proposalRevision }
    const expectedRevision = await service.revision(projectId)
    const result: DesignKnowledgeMutationResult = await service.applyDecision(projected, {
      projectId,
      inputCheckpoint: decision.checkpoint,
      observedCheckpoint: decision.checkpoint,
      expectedRevision,
    })
    retained.set(key, projected)
    if (result.replayed) replayed += 1
    else committed += 1
  }
  const revision = await service.revision(projectId)
  return Object.freeze({ considered: decisions.length, committed, replayed, revision })
}
