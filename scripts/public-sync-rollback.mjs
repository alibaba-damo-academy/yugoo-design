/** Explicit managed-file rollback. Unsettled/crashed leases require separate recovery. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { EXPORT_FILE_BYTE_LIMIT } from './public-snapshot-preflight.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'
import { appendPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => a === null && b === null || !!a && !!b && a.sha256 === b.sha256 && a.mode === b.mode

async function readRegular(root, path) {
  assert.ok(typeof path === 'string' && path && !/[\\\0\r\n]/u.test(path)
    && path.split('/').every(part => part && !['.', '..', '.git'].includes(part)), 'Invalid rollback path')
  assert.equal(await realpath(root), root, 'Rollback root changed')
  const parts = path.split('/'); let parent = root
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part)
    const stat = await lstat(parent)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Rollback parent changed')
  }
  assert.equal(await realpath(parent), parent, 'Rollback parent is not canonical')
  const target = join(parent, parts.at(-1)); let before
  try { before = await lstat(target) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  const maximum = path === EXPORT_MANIFEST || ['previous-manifest.json', 'next-manifest.json'].includes(path) ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, 'Rollback data must be bounded and regular')
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Rollback data changed during open')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Rollback data changed during read')
    return { bytes, sha256: digest(bytes), mode: stat.mode & 0o111 ? '100755' : '100644' }
  } finally { await file.close() }
}

async function inspectPlan(input, ownedLease) {
  const journal = await inspectPublicSyncJournal(input)
  assert.ok(journal.appendable && !journal.pending && journal.tailSha256 === input.expectedTailSha256, 'Rollback requires an explicitly accepted settled journal')
  const recovery = await inspectPublicSyncRecovery(input)
  assert.ok(!recovery.conflicts.length && !recovery.pending && recovery.journalTailSha256 === journal.tailSha256, 'Rollback has content conflicts')
  if (ownedLease) {
    const stat = await lstat(journal.journalRoot + '.step-lock')
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === ownedLease.dev && stat.ino === ownedLease.ino, 'Rollback lease changed')
  } else assert.equal(recovery.fileStepLeasePresent, false, 'Existing executor lease requires separate recovery')
  const actions = [...recovery.candidateActions].sort((a, b) => a.path === EXPORT_MANIFEST ? 1 : b.path === EXPORT_MANIFEST ? -1 : a.path.localeCompare(b.path))
  for (const action of actions) {
    for (const attempt of journal.events.filter(event => event.kind === 'intent' && event.operation === 'restore' && event.path === action.path)) {
      assert.ok(journal.events.some(event => event.kind === 'result' && event.intentSequence === attempt.sequence && event.outcome === 'not-applied'),
        'Path already has a rollback intent not explicitly settled as not-applied')
    }
    const forward = journal.events.filter(event => event.kind === 'intent' && event.path === action.path && event.operation !== 'restore')
    assert.equal(forward.length, 1, 'Rollback requires exactly one prior forward intent')
    assert.ok(journal.events.some(event => event.kind === 'result' && event.intentSequence === forward[0].sequence && event.outcome === 'completed'), 'Rollback requires completed forward execution')
  }
  const plan = { kind: 'settled-managed-file-rollback-plan', journalRoot: journal.journalRoot,
    headerSha256: journal.headerSha256, journalTailSha256: journal.tailSha256,
    targetRoot: recovery.targetRoot, targetIdentitiesSha256: recovery.targetIdentitiesSha256, actions }
  return { ...plan, planSha256: digest(JSON.stringify(plan)), targetUpdated: false,
    completeRollbackProven: false, lockReleaseAuthorized: false }
}

/** No file changes or lease acquisition. Caller must explicitly accept this plan hash. */
export async function inspectPublicSyncRollback(input) {
  assert.match(input.expectedTailSha256, /^[a-f0-9]{64}$/u, 'Explicit rollback tail required')
  return inspectPlan(input)
}

/** Restores prepared original bytes only; does not release the transaction or remove directories. */
export async function rollbackSettledPublicSync({ journalRoot, headerSha256, expectedTailSha256, expectedPlanSha256, onCheckpoint }) {
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit rollback plan required')
  const handle = { journalRoot, headerSha256 }, input = { ...handle, expectedTailSha256 }
  const initial = await inspectPublicSyncRollback(input)
  assert.equal(initial.planSha256, expectedPlanSha256, 'Rollback plan changed')
  if (!initial.actions.length) return { ...initial, managedFilesRestored: true, targetUpdated: false, lockReleased: false, publicationReady: false }
  const lease = initial.journalRoot + '.step-lock'
  assert.equal(await realpath(dirname(lease)), dirname(lease), 'Rollback lease parent changed')
  await mkdir(lease, { mode: 0o700 }) // Same exclusion as forward execution; never steals a lease.
  const ownedLease = await lstat(lease); let success = false
  try {
    assert.equal((await inspectPlan(input, ownedLease)).planSha256, expectedPlanSha256, 'Rollback changed under lease')
    let tail = expectedTailSha256
    for (const action of initial.actions) {
      const current = await inspectPlan({ ...handle, expectedTailSha256: tail }, ownedLease)
      const fresh = current.actions.find(item => item.path === action.path)
      assert.deepEqual(fresh, action, 'Rollback action changed')
      const journal = await inspectPublicSyncJournal(handle), { record, lock } = journal.header
      const marker = action.path === EXPORT_MANIFEST
      const original = marker ? record.previousManifest : Object.hasOwn(record.backups, action.path) ? record.backups[action.path] : null
      assert.ok(same(original, action.restoreIdentity), 'Rollback original is not the prepared backup')
      const backup = original ? await readRegular(lock.preparationRoot, marker ? 'previous-manifest.json' : `previous/${action.path}`) : null
      assert.ok(same(backup, original), 'Rollback backup changed')
      assert.ok(same(await readRegular(record.targetRoot, action.path), action.expectedCurrent), 'Target changed before rollback intent')
      const intent = await appendPublicSyncJournal({ ...handle, expectedTailSha256: tail, event: { kind: 'intent', operation: 'restore', path: action.path } })
      await onCheckpoint?.({ stage: 'rollback-intent-durable', path: action.path })
      if (original) assert.ok(same(await readRegular(lock.preparationRoot, marker ? 'previous-manifest.json' : `previous/${action.path}`), original), 'Rollback backup changed after intent')
      assert.ok(same(await readRegular(record.targetRoot, action.path), action.expectedCurrent), 'Target changed before restoration')
      if (backup) {
        const temporary = join(lease, 'replacement'), mode = backup.mode === '100755' ? 0o755 : 0o644
        const file = await open(temporary, 'wx', mode)
        try { await file.writeFile(backup.bytes); await file.chmod(mode); await file.sync() } finally { await file.close() }
        assert.ok(same(await readRegular(lease, 'replacement'), original), 'Rollback temporary changed')
        assert.ok(same(await readRegular(record.targetRoot, action.path), action.expectedCurrent), 'Target changed before restoration')
        await rename(temporary, join(record.targetRoot, action.path))
      } else {
        assert.ok(action.expectedCurrent, 'Rollback removal requires a proven added file')
        await unlink(join(record.targetRoot, action.path))
      }
      assert.ok(same(await readRegular(record.targetRoot, action.path), original), 'Restoration outcome differs')
      await onCheckpoint?.({ stage: 'rollback-file-restored', path: action.path })
      const completed = await appendPublicSyncJournal({ ...handle, expectedTailSha256: intent.tailSha256,
        event: { kind: 'result', intentSequence: intent.pending.sequence, outcome: 'completed' } })
      tail = completed.tailSha256
    }
    const final = await inspectPlan({ ...handle, expectedTailSha256: tail }, ownedLease)
    assert.equal(final.actions.length, 0, 'Managed rollback remains incomplete')
    success = true
    return { ...final, restoredPaths: initial.actions.map(action => action.path), managedFilesRestored: true,
      targetUpdated: true, completeRollbackProven: false, lockReleased: false, publicationReady: false }
  } finally {
    if (success) {
      const current = await lstat(lease)
      assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === ownedLease.dev && current.ino === ownedLease.ino, 'Rollback lease changed before release')
      await rmdir(lease) // Empty only; errors retain pending evidence, never recursive cleanup.
    }
  }
}
