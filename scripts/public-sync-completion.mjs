/** Read-only completion evidence; no lease release, cleanup or publication. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, realpath, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EXPORT_MANIFEST, inspectPublicSync } from './public-snapshot-stage.mjs'
import { inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'
import { verifyPublicSyncLock } from './public-sync-lock.mjs'

const equal = (a, b) => a === null && b === null || !!a && !!b && a.sha256 === b.sha256 && a.mode === b.mode
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function inspectPublicSyncCompletion({ journalRoot, headerSha256, expectedTailSha256 }) {
  assert.match(expectedTailSha256, /^[a-f0-9]{64}$/u, 'Explicit completion tail required')
  const handle = { journalRoot, headerSha256 }, journal = await inspectPublicSyncJournal(handle)
  assert.ok(journal.appendable && !journal.pending && journal.tailSha256 === expectedTailSha256, 'Completion journal is not settled at the accepted tail')
  const { record, lock } = journal.header
  const expected = new Map([...record.writes.map(path => [path, 'install']), ...record.deletes.map(path => [path, 'remove']), [EXPORT_MANIFEST, 'install']])
  assert.equal(expected.size, record.writes.length + record.deletes.length + 1, 'Duplicate completion paths')
  assert.equal(journal.events.length, expected.size * 2, 'Completion requires every planned file operation')
  for (let index = 0; index < journal.events.length; index += 2) {
    const intent = journal.events[index], result = journal.events[index + 1]
    assert.ok(intent.kind === 'intent' && expected.get(intent.path) === intent.operation, 'Unexpected completion operation')
    assert.ok(result.kind === 'result' && result.intentSequence === intent.sequence && result.outcome === 'completed', 'File operation did not complete')
    if (intent.path === EXPORT_MANIFEST) assert.equal(index, journal.events.length - 2, 'Completion provenance must be last')
    expected.delete(intent.path)
  }
  assert.equal(expected.size, 0, 'Missing completed path')
  const recovery = await inspectPublicSyncRecovery(handle)
  assert.ok(recovery.applicable && !recovery.pending && recovery.journalTailSha256 === expectedTailSha256, 'Completion has unresolved execution or content conflicts')
  for (const file of recovery.files) {
    const final = record.deletes.includes(file.path) ? null : file.replacement
    assert.ok(equal(file.current, final), 'Completed file does not match prepared final identity')
  }
  const current = await inspectPublicSync({ stageRoot: record.stageRoot, targetRoot: record.targetRoot })
  assert.ok(current.applicable && current.targetExists && !current.writes.length && !current.deletes.length
    && current.revision === record.revision && current.stageManifestSha256 === record.stageManifestSha256, 'Completed target is not equivalent to the accepted source')
  const latest = await inspectPublicSyncJournal(handle)
  assert.ok(latest.appendable && !latest.pending && latest.tailSha256 === expectedTailSha256 && latest.bytes === journal.bytes, 'Completion journal changed during inspection')
  const second = await inspectPublicSync({ stageRoot: record.stageRoot, targetRoot: record.targetRoot })
  assert.ok(second.applicable && second.targetStateSha256 === current.targetStateSha256 && second.stageManifestSha256 === current.stageManifestSha256, 'Completion inputs changed during inspection')
  const plan = { kind: 'verified-managed-sync-completion-plan', journalRoot: journal.journalRoot, headerSha256,
    journalTailSha256: expectedTailSha256, preparationRoot: lock.preparationRoot, preparedSha256: lock.preparedSha256,
    targetRoot: record.targetRoot, revision: record.revision, stageManifestSha256: record.stageManifestSha256,
    targetStateSha256: current.targetStateSha256, completedPaths: journal.events.filter(event => event.kind === 'intent').map(event => event.path) }
  return { ...plan, planSha256: createHash('sha256').update(JSON.stringify(plan)).digest('hex'), verified: true,
    targetUpdated: false, lockReleaseAuthorized: false, completionReceiptWritten: false, publicationReady: false }
}

async function saveCompletionEvidence(root, name, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n')
  assert.ok(bytes.length <= 2 * 1024 * 1024, 'Completion receipt exceeds bound')
  assert.equal(await realpath(root), root, 'Completion evidence root changed')
  const path = join(root, name), file = await open(path, 'wx', 0o600)
  let identity
  try { await file.writeFile(bytes); await file.sync(); identity = await file.stat() }
  finally { await file.close() }
  const verify = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await verify.stat()
    assert.ok(stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino && stat.size === bytes.length
      && (await verify.readFile()).equals(bytes), 'Completion receipt changed')
  } finally { await verify.close() }
  return digest(bytes)
}

async function verifyCompletionEvidence(root, name, expectedSha256) {
  assert.equal(await realpath(root), root, 'Completion evidence root changed')
  const file = await open(join(root, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.size <= 2 * 1024 * 1024, 'Completion receipt must remain bounded regular data')
    const bytes = await file.readFile()
    assert.ok(bytes.length === stat.size && digest(bytes) === expectedSha256, 'Completion receipt changed before lock release')
  } finally { await file.close() }
}

/** Explicit completion only. Retains journal, preparation and completion evidence. */
export async function finalizePublicSyncCompletion({ journalRoot, headerSha256, expectedTailSha256, expectedPlanSha256, onCheckpoint }) {
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit completion plan hash required')
  const input = { journalRoot, headerSha256, expectedTailSha256 }
  const plan = await inspectPublicSyncCompletion(input)
  assert.equal(plan.planSha256, expectedPlanSha256, 'Completion plan changed')
  const evidenceRoot = plan.journalRoot + '.completion-lease'
  assert.equal(await realpath(dirname(evidenceRoot)), dirname(evidenceRoot), 'Completion parent changed')
  await mkdir(evidenceRoot, { mode: 0o700 }) // Existing or interrupted completion is never taken over.
  const fresh = await inspectPublicSyncCompletion(input)
  assert.equal(fresh.planSha256, expectedPlanSha256, 'Completion changed under lease')
  const journal = await inspectPublicSyncJournal(input), lock = journal.header.lock
  const completionSha256 = await saveCompletionEvidence(evidenceRoot, 'completed.json', {
    schemaVersion: 1, kind: 'managed-sync-files-completed-release-pending', plan: fresh, lock,
    lockReleased: false, publicationReady: false,
  })
  await onCheckpoint?.({ stage: 'completion-receipt-durable', evidenceRoot, completionSha256 })
  assert.equal((await inspectPublicSyncCompletion(input)).planSha256, expectedPlanSha256, 'Completion changed before lock release')
  await verifyCompletionEvidence(evidenceRoot, 'completed.json', completionSha256)
  await verifyPublicSyncLock(lock)
  // Only the original verified owner file and an empty lock directory are removed.
  // Any failure retains completion evidence, never recursively removes anything.
  await unlink(join(lock.lockRoot, 'owner.json'))
  await rmdir(lock.lockRoot)
  const releaseSha256 = await saveCompletionEvidence(evidenceRoot, 'released.json', {
    schemaVersion: 1, kind: 'managed-sync-lock-released', completionSha256,
    transactionId: lock.transactionId, ownerSha256: lock.ownerSha256, lockReleased: true, publicationReady: false,
  })
  return { evidenceRoot, completionSha256, releaseSha256, lockReleased: true, wholeSyncCompleted: true,
    targetRoot: plan.targetRoot, targetUpdated: false, publicationReady: false }
}
