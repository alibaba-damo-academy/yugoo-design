import type { DesignJournalStorage } from './design-journal-storage.ts'
import type { DesignProjectKitPin } from './design-project.ts'
import type { ProjectContentAdoptionReceipt } from './project-content-transaction.ts'

/** Append to the existing journal exactly once, including crash replay after append. */
export async function recordProjectContentAdoption(storage: Pick<DesignJournalStorage, 'atomicMutate'>,
  conversation: string, receipt: ProjectContentAdoptionReceipt, pin: DesignProjectKitPin): Promise<void> {
  if (receipt.contentHash !== pin.contentHash) throw new Error('content upgrade: journal receipt differs from the committed pin')
  await storage.atomicMutate(conversation, current => {
    const prior = current.records.find(record => record.type === 'design/kit-selected'
      && record.data.adoption?.operationId === receipt.operationId)
    if (prior?.type === 'design/kit-selected') {
      if (JSON.stringify(prior.data.adoption) !== JSON.stringify(receipt)) throw new Error('content upgrade: conflicting journal replay')
      return undefined
    }
    return { type: 'design/kit-selected', data: { kit: pin.name, version: pin.version, operation: 'upgrade', adoption: receipt } }
  })
}
