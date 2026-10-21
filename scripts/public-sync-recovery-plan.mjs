/** Read-only managed-file recovery analysis; never restores or deletes target data. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { EXPORT_FILE_BYTE_LIMIT } from './public-snapshot-preflight.mjs'
import { inspectPublicSyncJournal } from './public-sync-journal.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => a === null && b === null || !!a && !!b && a.sha256 === b.sha256 && a.mode === b.mode
function safePath(path) {
  assert.ok(typeof path === 'string' && path && !/[\\\0\r\n]/u.test(path)
    && path.split('/').every(part => part && !['.', '..', '.git'].includes(part)), 'Invalid recovery path')
}
async function identity(root, path, maximum = EXPORT_FILE_BYTE_LIMIT) {
  safePath(path)
  let current = root
  const parts = path.split('/')
  try {
    const base = await lstat(root)
    assert.ok(base.isDirectory() && !base.isSymbolicLink() && await realpath(root) === root, 'Recovery root changed')
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index])
      const info = await lstat(current)
      assert.ok(!info.isSymbolicLink() && (index === parts.length - 1 ? info.isFile() : info.isDirectory()), 'Recovery input must remain regular')
    }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  assert.equal(await realpath(dirname(current)), dirname(current), 'Recovery parent changed')
  const before = await lstat(current)
  assert.ok(before.size <= maximum, 'Recovery input exceeds byte bound')
  const file = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Recovery input changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Recovery input changed while reading')
    return { sha256: digest(bytes), mode: stat.mode & 0o111 ? '100755' : '100644' }
  } finally { await file.close() }
}

/** Byte equality identifies possible outcomes, not proof that this process made a change. */
export async function inspectPublicSyncRecovery(input) {
  const journal = await inspectPublicSyncJournal(input), { record, lock } = journal.header
  const paths = [...new Set([...record.writes, ...record.deletes, EXPORT_MANIFEST])].sort()
  const touched = new Set(journal.events.filter(event => event.kind === 'intent').map(event => event.path))
  const files = [], conflicts = [], candidateActions = []
  for (const path of paths) {
    const marker = path === EXPORT_MANIFEST
    const previous = marker ? record.previousManifest : Object.hasOwn(record.backups, path) ? record.backups[path] : null
    const replacement = marker ? record.nextManifestIdentity : Object.hasOwn(record.replacements, path) ? record.replacements[path] : null
    // A trusted receipt identifies bytes, but recovery also needs the actual
    // preserved data to remain available. Never accept a stale backup identity.
    if (previous) assert.ok(equal(await identity(lock.preparationRoot, marker ? 'previous-manifest.json' : `previous/${path}`, marker ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT), previous), 'Recovery backup changed')
    if (replacement) assert.ok(equal(await identity(lock.preparationRoot, marker ? 'next-manifest.json' : `next/${path}`, marker ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT), replacement), 'Recovery replacement changed')
    let current
    try { current = await identity(record.targetRoot, path, marker ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT) }
    catch {
      conflicts.push({ path, reason: 'Target path is not a stable bounded regular file' })
      files.push({ path, previous, replacement, state: 'conflict' }); continue
    }
    const isPrevious = equal(current, previous), isReplacement = equal(current, replacement)
    let state
    if (isPrevious) state = 'original'
    else if (isReplacement && touched.has(path)) {
      state = 'possible-applied'
      candidateActions.push({ path, action: previous ? 'restore-original' : 'remove-added', expectedCurrent: current, restoreIdentity: previous })
    } else {
      state = 'conflict'
      conflicts.push({ path, reason: touched.has(path) ? 'Target differs from both preserved outcomes' : 'Target changed without a recorded intent' })
    }
    files.push({ path, previous, replacement, current, state })
  }
  const latest = await inspectPublicSyncJournal(input)
  assert.ok(latest.tailSha256 === journal.tailSha256 && latest.bytes === journal.bytes
    && latest.writerActive === journal.writerActive, 'Journal changed during recovery inspection')
  for (const file of files.filter(file => file.state !== 'conflict')) {
    const actual = await identity(record.targetRoot, file.path, file.path === EXPORT_MANIFEST ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT)
    assert.ok(equal(actual, file.current), 'Target changed during recovery inspection')
  }
  const targetIdentitiesSha256 = digest(JSON.stringify(files.map(({ path, current, state }) => ({ path, current, state }))))
  let fileStepLeasePresent = false
  try { await lstat(journal.journalRoot + '.step-lock'); fileStepLeasePresent = true }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  return { kind: 'managed-file-recovery-plan', journalRoot: journal.journalRoot, headerSha256: journal.headerSha256,
    journalTailSha256: journal.tailSha256, targetRoot: record.targetRoot, targetIdentitiesSha256,
    applicable: !conflicts.length && !journal.interrupted && !journal.writerActive && !fileStepLeasePresent && !journal.events.some(event => event.outcome === 'ambiguous'),
    fileStepLeasePresent,
    candidateActions, files, conflicts, pending: journal.pending,
    initialTargetDirectoryRequiresSeparateOwnershipCheck: !record.targetExists,
    targetUpdated: false, rollbackAuthorized: false, completeRollbackProven: false }
}
