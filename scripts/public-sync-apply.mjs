/** Explicit prepared forward transaction. Errors retain evidence; no automatic rollback. */
import assert from 'node:assert/strict'
import { EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncDirectories, createPublicSyncDirectories } from './public-sync-directories.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncCompletion, finalizePublicSyncCompletion } from './public-sync-completion.mjs'

export async function applyPreparedPublicSync({ preparationRoot, preparedSha256, expectedStageManifestSha256, expectedTargetStateSha256, onCheckpoint }) {
  for (const value of [expectedStageManifestSha256, expectedTargetStateSha256]) assert.match(value, /^[a-f0-9]{64}$/u, 'Explicit accepted source/target fences required')
  const prepared = await verifyPreparedPublicSync({ preparationRoot, preparedSha256 }), { record } = prepared
  assert.equal(record.stageManifestSha256, expectedStageManifestSha256, 'Accepted source differs')
  assert.equal(record.targetStateSha256, expectedTargetStateSha256, 'Accepted target differs')
  if (!record.writes.length && !record.deletes.length && record.previousManifest?.sha256 === record.nextManifestIdentity.sha256
    && record.previousManifest.mode === record.nextManifestIdentity.mode) {
    return { targetRoot: record.targetRoot, wholeSyncCompleted: true, noChanges: true, targetUpdated: false, publicationReady: false }
  }
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const directoryPlan = await inspectPublicSyncDirectories(journal)
  const directories = await createPublicSyncDirectories({ ...journal, expectedPlanSha256: directoryPlan.planSha256, onCheckpoint })
  const directoryPhase = { ...journal, expectedPlanSha256: directoryPlan.planSha256, expectedTailSha256: directories.tailSha256 }
  await onCheckpoint?.({ stage: 'directories-completed', journalRoot: journal.journalRoot })
  for (const [operation, path] of [...record.writes.map(path => ['install', path]), ...record.deletes.map(path => ['remove', path]), ['install', EXPORT_MANIFEST]]) {
    const current = await inspectPublicSyncJournal(journal)
    await executePublicSyncFileStep({ ...journal, expectedTailSha256: current.tailSha256, operation, path, directoryPhase, onCheckpoint })
  }
  const expectedTailSha256 = (await inspectPublicSyncJournal(journal)).tailSha256
  const completion = await inspectPublicSyncCompletion({ ...journal, expectedTailSha256 })
  const result = await finalizePublicSyncCompletion({ ...journal, expectedTailSha256, expectedPlanSha256: completion.planSha256, onCheckpoint })
  return { ...result, journalRoot: journal.journalRoot, headerSha256: journal.headerSha256, directoryEvidenceRoot: directories.evidenceRoot,
    writes: record.writes, deletes: record.deletes, noChanges: false, targetUpdated: true, publicationReady: false }
}
