/** Verified original-state rollback completion; retains all transaction evidence. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'
import { inspectPublicSyncDirectoryRecovery } from './public-sync-directory-recovery.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'
import { verifyPublicSyncLock } from './public-sync-lock.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function journalIdentity(root) {
  assert.equal(await realpath(root), root, 'Completion journal root changed')
  const path = join(root, 'journal.jsonl'), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 8 * 1024 * 1024, 'Invalid completion journal evidence')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Completion journal changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Completion journal changed while reading')
    return digest(bytes)
  } finally { await file.close() }
}
async function inspectPlan(input, ownedLease) {
  const journal = await inspectPublicSyncJournal(input)
  assert.ok(journal.appendable && !journal.pending && journal.tailSha256 === input.expectedTailSha256, 'Rollback completion requires an accepted settled journal')
  const recovery = await inspectPublicSyncRecovery(input)
  assert.ok(!recovery.pending && !recovery.conflicts.length && recovery.files.every(file => file.state === 'original'), 'Original managed files are not restored')
  if (ownedLease) {
    const root = journal.journalRoot + '.step-lock', stat = await lstat(root)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === ownedLease.dev && stat.ino === ownedLease.ino && await realpath(root) === root, 'Rollback completion executor lease changed')
    assert.deepEqual(await readdir(root), [], 'Unexpected rollback completion executor evidence')
  } else assert.ok(recovery.applicable, 'Another executor prevents rollback completion')
  const verified = await verifyPreparedPublicSync(journal.header.lock)
  const directories = await inspectPublicSyncDirectoryRecovery({ ...input, expectedPlanSha256: input.expectedDirectoryPlanSha256 })
  assert.ok(directories.directoryPhaseCompleted, 'Unrecorded directory phase prevents rollback completion')
  for (const entry of directories.directories) {
    const full = entry.path ? join(verified.record.targetRoot, entry.path) : verified.record.targetRoot
    if (entry.creationRecorded) {
      let absent = false
      try { await lstat(full) } catch (error) { if (error.code === 'ENOENT') absent = true; else throw error }
      assert.ok(absent, 'Created directory has not been removed')
    } else assert.ok(entry.phase === 'pre-existing' && entry.state === 'pre-existing', 'Original directory identity changed')
  }
  const fresh = await inspectPublicSyncJournal(input)
  assert.ok(fresh.tailSha256 === journal.tailSha256 && fresh.bytes === journal.bytes && fresh.appendable, 'Rollback journal changed during completion inspection')
  await verifyPreparedPublicSync(journal.header.lock)
  const repeated = await inspectPublicSyncDirectoryRecovery({ ...input, expectedPlanSha256: input.expectedDirectoryPlanSha256 })
  assert.deepEqual(repeated, directories, 'Directory evidence changed during rollback completion inspection')
  const plan = { kind: 'verified-original-state-rollback-completion', journalRoot: journal.journalRoot,
    headerSha256: journal.headerSha256, journalTailSha256: journal.tailSha256, targetRoot: verified.record.targetRoot,
    preparedSha256: journal.header.lock.preparedSha256, directoryPlanSha256: directories.planSha256,
    directoryEvidenceSha256: directories.evidenceSha256, originalTargetExists: verified.record.targetExists,
    originalTargetStateSha256: verified.record.targetStateSha256 }
  return { ...plan, planSha256: digest(JSON.stringify(plan)), targetUpdated: false, lockReleaseAuthorized: false, publicationReady: false }
}

export async function inspectPublicSyncRollbackCompletion(input) {
  assert.match(input.expectedTailSha256, /^[a-f0-9]{64}$/u, 'Explicit rollback completion tail required')
  return inspectPlan(input)
}

/** Errors retain completion/lease evidence. Half-released locks need separate recovery. */
export async function finalizePublicSyncRollback({ journalRoot, headerSha256, expectedTailSha256,
  expectedDirectoryPlanSha256, expectedPlanSha256, onCheckpoint }) {
  const input = { journalRoot, headerSha256, expectedTailSha256, expectedDirectoryPlanSha256 }
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit rollback completion plan required')
  const plan = await inspectPublicSyncRollbackCompletion(input)
  assert.equal(plan.planSha256, expectedPlanSha256, 'Rollback completion plan changed')
  const root = plan.journalRoot + '.rollback-completion-lease', stepRoot = plan.journalRoot + '.step-lock'
  assert.equal(await realpath(dirname(root)), dirname(root), 'Rollback completion evidence parent changed')
  await mkdir(root, { mode: 0o700 }); await mkdir(stepRoot, { mode: 0o700 })
  const ownedLease = await lstat(stepRoot)
  assert.equal((await inspectPlan(input, ownedLease)).planSha256, expectedPlanSha256, 'Rollback completion changed under lease')
  const journal = await inspectPublicSyncJournal(input), lock = journal.header.lock
  const completionIdentity = await lstat(root)
  const directories = await inspectPublicSyncDirectoryRecovery({ ...input, expectedPlanSha256: expectedDirectoryPlanSha256 })
  assert.equal(directories.evidenceSha256, plan.directoryEvidenceSha256, 'Completion directory evidence changed')
  const recoveryAnchor = { schemaVersion: 1, kind: 'rollback-release-recovery-anchor',
    completionRootIdentity: { dev: completionIdentity.dev, ino: completionIdentity.ino },
    stepLeaseIdentity: { dev: ownedLease.dev, ino: ownedLease.ino },
    journalSha256: await journalIdentity(journal.journalRoot),
    restoredDirectories: directories.directories.map(entry => ({ path: entry.path,
      creationRecorded: entry.creationRecorded, originalIdentity: entry.creationRecorded ? null : entry.recordedIdentity })) }
  async function save(name, value) {
    assert.equal(await realpath(root), root, 'Rollback completion evidence root changed')
    const bytes = Buffer.from(JSON.stringify(value) + '\n'); assert.ok(bytes.length <= 2 * 1024 * 1024, 'Rollback completion receipt exceeds bound')
    const file = await open(join(root, name), 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    return digest(bytes)
  }
  async function verifyReceipt(name, hash) {
    assert.equal(await realpath(root), root, 'Rollback completion evidence root changed')
    const file = await open(join(root, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await file.stat(); assert.ok(stat.isFile() && stat.size <= 2 * 1024 * 1024, 'Invalid rollback completion receipt')
      const bytes = await file.readFile(); assert.ok(bytes.length === stat.size && digest(bytes) === hash, 'Rollback completion receipt changed')
    } finally { await file.close() }
  }
  const completionSha256 = await save('completed.json', { schemaVersion: 1, kind: 'original-state-restored-release-pending', plan, lock,
    recoveryAnchor, lockReleased: false, publicationReady: false })
  await onCheckpoint?.({ stage: 'rollback-completion-receipt-durable', evidenceRoot: root })
  assert.equal((await inspectPlan(input, ownedLease)).planSha256, expectedPlanSha256, 'Rollback state changed before lock release')
  assert.deepEqual(await readdir(root), ['completed.json'], 'Unexpected rollback completion evidence')
  await verifyReceipt('completed.json', completionSha256); await verifyPublicSyncLock(lock)
  assert.equal(await journalIdentity(journal.journalRoot), recoveryAnchor.journalSha256, 'Completion journal changed before release')
  await unlink(join(lock.lockRoot, 'owner.json'))
  await onCheckpoint?.({ stage: 'rollback-original-owner-removed', evidenceRoot: root, completionSha256 })
  const originalLock = await lstat(lock.lockRoot)
  assert.ok(originalLock.isDirectory() && !originalLock.isSymbolicLink() && originalLock.dev === lock.dev && originalLock.ino === lock.ino,
    'Original lock directory changed after owner removal')
  assert.equal(await realpath(lock.lockRoot), lock.lockRoot, 'Original lock became noncanonical')
  assert.deepEqual(await readdir(lock.lockRoot), [], 'Unexpected original lock evidence after owner removal')
  await rmdir(lock.lockRoot)
  await onCheckpoint?.({ stage: 'rollback-original-lock-removed', evidenceRoot: root, completionSha256 })
  const releaseSha256 = await save('released.json', { schemaVersion: 1, kind: 'rollback-original-lock-released', completionSha256,
    transactionId: lock.transactionId, ownerSha256: lock.ownerSha256, lockReleased: true, publicationReady: false })
  await verifyReceipt('released.json', releaseSha256)
  await onCheckpoint?.({ stage: 'rollback-release-receipt-durable', evidenceRoot: root, completionSha256, releaseSha256 })
  const step = await lstat(stepRoot)
  assert.ok(step.isDirectory() && !step.isSymbolicLink() && step.dev === ownedLease.dev && step.ino === ownedLease.ino, 'Rollback executor lease changed before release')
  await rmdir(stepRoot)
  return { evidenceRoot: root, completionSha256, releaseSha256, originalStateRestored: true,
    lockReleased: true, targetUpdated: false, publicationReady: false }
}
