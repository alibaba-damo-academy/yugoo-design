/** Finish an explicitly stopped rollback's lock release. Never changes target files. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { publicSyncTransactionRoot, verifyPublicSyncLock } from './public-sync-lock.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const identity = stat => ({ dev: stat.dev, ino: stat.ino })
async function directory(path, expected) {
  const stat = await lstat(path)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, 'Release directory is noncanonical')
  if (expected) assert.deepEqual(identity(stat), expected, 'Release directory identity changed')
  return stat
}
async function optionalStat(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function readRegular(root, name, maximum) {
  await directory(root)
  const path = join(root, name), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, 'Release evidence must be bounded regular data')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Release evidence changed on open')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Release evidence changed on read')
    return bytes
  } finally { await file.close() }
}
function validIdentity(value) {
  assert.deepEqual(Object.keys(value).sort(), ['dev', 'ino'])
  for (const key of ['dev', 'ino']) assert.ok(Number.isSafeInteger(value[key]) && value[key] >= 0, 'Invalid release identity')
}

async function inspect(input, ownedGate) {
  for (const key of ['headerSha256', 'expectedTailSha256', 'expectedDirectoryPlanSha256', 'expectedCompletionSha256'])
    assert.match(input[key], /^[a-f0-9]{64}$/u, 'Explicit release evidence hashes required')
  const journalRoot = resolve(input.journalRoot), root = journalRoot + '.rollback-completion-lease'
  const bytes = await readRegular(root, 'completed.json', 2 * 1024 * 1024)
  assert.equal(digest(bytes), input.expectedCompletionSha256, 'Completion receipt changed')
  const completed = JSON.parse(bytes), { plan, lock, recoveryAnchor: anchor } = completed
  assert.equal(completed.schemaVersion, 1); assert.equal(completed.kind, 'original-state-restored-release-pending')
  assert.equal(completed.lockReleased, false); assert.equal(completed.publicationReady, false)
  assert.ok(anchor && anchor.schemaVersion === 1 && anchor.kind === 'rollback-release-recovery-anchor', 'Completion lacks durable release identity; not recoverable by inference')
  validIdentity(anchor.completionRootIdentity); validIdentity(anchor.stepLeaseIdentity)
  await directory(root, anchor.completionRootIdentity)
  assert.equal(publicSyncTransactionRoot(lock), journalRoot, 'Completion belongs to another transaction')
  assert.equal(lock.lockRoot, join(dirname(lock.targetRoot), `.${basename(lock.targetRoot)}.yugoo-sync-lock`), 'Unexpected original lock path')
  const { planSha256, targetUpdated, lockReleaseAuthorized, publicationReady, ...hashInput } = plan
  assert.equal(digest(JSON.stringify(hashInput)), planSha256, 'Original completion plan changed')
  assert.equal(targetUpdated, false); assert.equal(lockReleaseAuthorized, false); assert.equal(publicationReady, false)
  assert.equal(plan.kind, 'verified-original-state-rollback-completion')
  assert.equal(plan.journalRoot, journalRoot); assert.equal(plan.headerSha256, input.headerSha256)
  assert.equal(plan.journalTailSha256, input.expectedTailSha256)
  assert.equal(plan.directoryPlanSha256, input.expectedDirectoryPlanSha256)
  assert.equal(plan.targetRoot, lock.targetRoot); assert.equal(plan.preparedSha256, lock.preparedSha256)
  // This immutable, previously checked journal remains inspectable after its lock is gone.
  // It is NOT returned as appendable or passed to any forward executor.
  assert.deepEqual(await readdir(journalRoot), ['journal.jsonl'], 'Unexpected release journal evidence')
  const journalBytes = await readRegular(journalRoot, 'journal.jsonl', 8 * 1024 * 1024)
  assert.equal(digest(journalBytes), anchor.journalSha256, 'Completed journal bytes changed')
  const journalText = journalBytes.toString('utf8')
  assert.ok(Buffer.from(journalText).equals(journalBytes) && journalText.endsWith('\n'), 'Invalid completed journal bytes')
  const lines = journalText.slice(0, -1).split('\n')
  assert.equal(digest(lines[0] + '\n'), input.headerSha256)
  assert.equal(digest(lines.at(-1) + '\n'), input.expectedTailSha256)
  const header = JSON.parse(lines[0])
  assert.equal(header.kind, 'public-sync-intent-journal'); assert.equal(header.schemaVersion, 1)
  assert.deepEqual(header.lock, lock)
  const verified = await verifyPreparedPublicSync(lock)
  assert.deepEqual(header.record, verified.record, 'Release journal preparation changed')
  assert.equal(plan.originalTargetExists, verified.record.targetExists)
  assert.equal(plan.originalTargetStateSha256, verified.record.targetStateSha256)
  const directoryRoot = journalRoot + '.directory-lease'
  assert.deepEqual(await readdir(directoryRoot), ['directories.jsonl'])
  const directoryBytes = await readRegular(directoryRoot, 'directories.jsonl', 32 * 1024 * 1024)
  assert.equal(digest(directoryBytes), plan.directoryEvidenceSha256, 'Completed directory evidence changed')
  const directoryText = directoryBytes.toString('utf8')
  assert.ok(Buffer.from(directoryText).equals(directoryBytes) && directoryText.endsWith('\n'), 'Invalid completed directory bytes')
  const rows = directoryText.slice(0, -1).split('\n').map(line => JSON.parse(line))
  const directoryPlan = rows[0].plan
  assert.equal(rows[0].kind, 'directory-phase-header')
  assert.equal(rows.at(-1).kind, 'directory-phase-completed')
  assert.equal(directoryPlan.planSha256, input.expectedDirectoryPlanSha256)
  const { planSha256: directoryHash, targetUpdated: directoryUpdated, publicationReady: directoryReady, ...directoryHashInput } = directoryPlan
  assert.equal(digest(JSON.stringify(directoryHashInput)), directoryHash)
  assert.equal(directoryUpdated, false); assert.equal(directoryReady, false)
  assert.equal(directoryPlan.journalRoot, journalRoot); assert.equal(directoryPlan.headerSha256, input.headerSha256)
  assert.equal(directoryPlan.targetRoot, lock.targetRoot)
  assert.deepEqual(anchor.restoredDirectories, directoryPlan.directories.map(entry => ({ path: entry.path,
    creationRecorded: entry.before === null, originalIdentity: entry.before })), 'Release directory anchor differs')
  for (const entry of anchor.restoredDirectories) {
    assert.ok(typeof entry.path === 'string' && !/[\\\0\r\n]/u.test(entry.path)
      && (!entry.path || entry.path.split('/').every(part => part && !['.', '..', '.git'].includes(part))), 'Invalid release directory path')
    const path = entry.path ? join(lock.targetRoot, entry.path) : lock.targetRoot
    const stat = await optionalStat(path)
    if (entry.creationRecorded) assert.equal(stat, null, 'Created directory has reappeared')
    else {
      assert.ok(entry.originalIdentity, 'Original directory identity missing')
      const { mode, ...expected } = entry.originalIdentity
      const observed = await directory(path, expected)
      assert.equal(observed.mode & 0o777, mode, 'Original directory permissions changed')
    }
  }
  const evidence = (await readdir(root)).sort()
  assert.ok(evidence.length === 1 && evidence[0] === 'completed.json'
    || evidence.length === 2 && evidence[0] === 'completed.json' && evidence[1] === 'released.json', 'Unknown release completion evidence')
  let releasedSha256 = null
  if (evidence.includes('released.json')) {
    const releasedBytes = await readRegular(root, 'released.json', 2 * 1024 * 1024), released = JSON.parse(releasedBytes)
    assert.deepEqual(released, { schemaVersion: 1, kind: 'rollback-original-lock-released', completionSha256: input.expectedCompletionSha256,
      transactionId: lock.transactionId, ownerSha256: lock.ownerSha256, lockReleased: true, publicationReady: false }, 'Release receipt changed')
    releasedSha256 = digest(releasedBytes)
  }
  let lockState = 'absent'
  if (await optionalStat(lock.lockRoot)) {
    await directory(lock.lockRoot, { dev: lock.dev, ino: lock.ino })
    const entries = await readdir(lock.lockRoot)
    if (!entries.length) lockState = 'owner-removed'
    else { await verifyPublicSyncLock(lock); lockState = 'owner-present' }
  }
  assert.ok(!releasedSha256 || lockState === 'absent', 'Release receipt conflicts with present original lock')
  const stepRoot = journalRoot + '.step-lock', step = await optionalStat(stepRoot)
  if (step) { await directory(stepRoot, anchor.stepLeaseIdentity); assert.deepEqual(await readdir(stepRoot), [], 'Unknown executor evidence') }
  else assert.ok(releasedSha256 && lockState === 'absent', 'Executor lease vanished without recorded release')
  const gateRoot = journalRoot + '.release-resume-lease'
  if (ownedGate) { await directory(gateRoot, ownedGate); assert.deepEqual(await readdir(gateRoot), []) }
  else assert.equal(await optionalStat(gateRoot), null, 'Another release recovery or interrupted resume requires separate settlement')
  assert.ok((await readRegular(root, 'completed.json', 2 * 1024 * 1024)).equals(bytes), 'Completion changed during inspection')
  await verifyPreparedPublicSync(lock)
  const observation = { kind: 'stopped-rollback-release-plan', journalRoot, completionSha256: input.expectedCompletionSha256,
    journalSha256: anchor.journalSha256, lockState, stepLeasePresent: !!step, releasedSha256,
    completionRootIdentity: anchor.completionRootIdentity, stepLeaseIdentity: anchor.stepLeaseIdentity,
    lock, targetRoot: lock.targetRoot }
  return { ...observation, planSha256: digest(JSON.stringify(observation)), targetUpdated: false,
    publicationReady: false, executorLivenessProven: false, alreadyReleased: !step }
}

export async function inspectPublicSyncRollbackRelease(input) { return inspect(input) }

/** Stop acknowledgement is supplied by the caller, never inferred from PID, time or locks. */
export async function resumePublicSyncRollbackRelease(input) {
  assert.equal(input.executorStopped, true, 'Explicit stopped-executor acknowledgement required')
  assert.match(input.expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit release recovery plan required')
  const plan = await inspect(input)
  assert.equal(plan.planSha256, input.expectedPlanSha256, 'Release recovery plan changed')
  if (plan.alreadyReleased) return { alreadyReleased: true, lockReleased: true, targetUpdated: false, publicationReady: false }
  const gate = plan.journalRoot + '.release-resume-lease'
  assert.equal(await realpath(dirname(gate)), dirname(gate))
  await mkdir(gate, { mode: 0o700 })
  const ownedGate = identity(await lstat(gate)), root = plan.journalRoot + '.rollback-completion-lease'
  try {
    assert.equal((await inspect(input, ownedGate)).planSha256, plan.planSha256, 'Release changed under recovery lease')
    await input.onCheckpoint?.({ stage: 'release-resume-fenced' })
    let current = await inspect(input, ownedGate)
    assert.equal(current.planSha256, plan.planSha256, 'Release changed after recovery checkpoint')
    if (current.lockState === 'owner-present') {
      await verifyPublicSyncLock(plan.lock)
      await unlink(join(plan.lock.lockRoot, 'owner.json'))
      await input.onCheckpoint?.({ stage: 'release-resume-owner-removed' })
      current = await inspect(input, ownedGate)
      assert.equal(current.lockState, 'owner-removed')
    }
    if (current.lockState === 'owner-removed') {
      await directory(plan.lock.lockRoot, { dev: plan.lock.dev, ino: plan.lock.ino })
      assert.deepEqual(await readdir(plan.lock.lockRoot), [])
      await rmdir(plan.lock.lockRoot)
      await input.onCheckpoint?.({ stage: 'release-resume-lock-removed' })
      current = await inspect(input, ownedGate)
      assert.equal(current.lockState, 'absent')
    }
    if (!current.releasedSha256) {
      const value = { schemaVersion: 1, kind: 'rollback-original-lock-released', completionSha256: input.expectedCompletionSha256,
        transactionId: plan.lock.transactionId, ownerSha256: plan.lock.ownerSha256, lockReleased: true, publicationReady: false }
      const file = await open(join(root, 'released.json'), 'wx', 0o600)
      try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync() } finally { await file.close() }
      await input.onCheckpoint?.({ stage: 'release-resume-receipt-durable' })
    }
    current = await inspect(input, ownedGate)
    assert.ok(current.releasedSha256 && current.lockState === 'absent')
    const step = plan.journalRoot + '.step-lock'
    await directory(step, plan.stepLeaseIdentity); assert.deepEqual(await readdir(step), [])
    await rmdir(step)
    return { completionSha256: plan.completionSha256, releaseSha256: current.releasedSha256,
      originalStateRestored: true, lockReleased: true, targetUpdated: false, publicationReady: false }
  } finally {
    await directory(gate, ownedGate)
    assert.deepEqual(await readdir(gate), [], 'Foreign release recovery evidence retained')
    await rmdir(gate) // Controlled failures are re-inspectable; process-killed gates are not stolen.
  }
}
