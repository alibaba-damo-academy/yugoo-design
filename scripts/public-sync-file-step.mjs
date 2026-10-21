/** One journaled managed-file operation. No whole-sync authorization or automatic recovery. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { EXPORT_FILE_BYTE_LIMIT } from './public-snapshot-preflight.mjs'
import { appendPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => a === null && b === null || !!a && !!b && a.sha256 === b.sha256 && a.mode === b.mode
async function readRegular(root, path, maximum) {
  assert.ok(typeof path === 'string' && path && !/[\\\0\r\n]/u.test(path)
    && path.split('/').every(part => part && !['.', '..', '.git'].includes(part)), 'Invalid managed path')
  assert.equal(await realpath(root), root, 'Root must remain canonical')
  let current = root
  const parts = path.split('/')
  for (let i = 0; i < parts.length - 1; i++) {
    current = join(current, parts[i])
    const stat = await lstat(current)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Managed parent must be a regular directory')
  }
  assert.equal(await realpath(current), current, 'Managed parent changed')
  const target = join(current, parts.at(-1))
  let before
  try { before = await lstat(target) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, 'Managed input must be bounded regular data')
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Managed input changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Managed input changed while reading')
    return { bytes, sha256: hash(bytes), mode: stat.mode & 0o111 ? '100755' : '100644' }
  } finally { await file.close() }
}

/** Caller must supply the inspected tail. Existing parents only; full executor owns directory lifecycle. */
export async function executePublicSyncFileStep({ journalRoot, headerSha256, expectedTailSha256, operation, path, directoryPhase, onCheckpoint }) {
  const handle = { journalRoot, headerSha256 }
  const initial = await inspectPublicSyncJournal(handle)
  assert.ok(initial.appendable && !initial.pending, 'Unresolved or interrupted transaction requires recovery')
  assert.equal(initial.tailSha256, expectedTailSha256, 'Journal tail changed')
  const { record, lock } = initial.header
  assert.ok(operation === 'install' || operation === 'remove', 'Unsupported forward file operation')
  const marker = path === EXPORT_MANIFEST
  assert.ok(operation === 'install' ? record.writes.includes(path) || marker : record.deletes.includes(path), 'Operation is not a prepared change')
  assert.ok(!initial.events.some(event => event.kind === 'intent' && event.path === path), 'Managed path already has an intent; use explicit recovery')
  if (marker) {
    for (const managed of [...record.writes, ...record.deletes]) {
      const intent = initial.events.find(event => event.kind === 'intent' && event.path === managed)
      assert.ok(intent && initial.events.some(event => event.kind === 'result' && event.intentSequence === intent.sequence && event.outcome === 'completed'), 'Provenance must be installed last')
    }
  }
  const maximum = marker ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT
  const old = marker ? record.previousManifest : Object.hasOwn(record.backups, path) ? record.backups[path] : null
  const next = operation === 'remove' ? null : marker ? record.nextManifestIdentity : record.replacements[path]
  assert.ok(operation === 'remove' || next, 'Missing prepared replacement')
  const lease = initial.journalRoot + '.step-lock'
  assert.equal(await realpath(dirname(lease)), dirname(lease), 'Step lease parent changed')
  await mkdir(lease, { mode: 0o700 }) // Existing/crashed executor is never stolen automatically.
  let success = false
  try {
    const current = await inspectPublicSyncJournal(handle)
    assert.ok(current.appendable && !current.pending && current.tailSha256 === expectedTailSha256, 'Transaction changed before file step')
    if (!current.events.length) await verifyPreparedPublicSync({ ...lock, directoryPhase })
    assert.ok(equal(await readRegular(record.targetRoot, path, maximum), old), 'Target changed before file intent')
    const replacement = next ? await readRegular(lock.preparationRoot, marker ? 'next-manifest.json' : `next/${path}`, maximum) : null
    assert.ok(equal(replacement, next), 'Prepared replacement changed')
    if (old) assert.ok(equal(await readRegular(lock.preparationRoot, marker ? 'previous-manifest.json' : `previous/${path}`, maximum), old), 'Prepared backup changed')
    if (marker) {
      const manifest = JSON.parse(replacement.bytes.toString('utf8'))
      for (const [managed, expected] of Object.entries(manifest.files)) {
        assert.ok(equal(await readRegular(record.targetRoot, managed, EXPORT_FILE_BYTE_LIMIT), expected), 'Managed target changed before provenance')
      }
      for (const managed of record.deletes) assert.equal(await readRegular(record.targetRoot, managed, EXPORT_FILE_BYTE_LIMIT), null, 'Deleted target reappeared before provenance')
    }
    const intended = await appendPublicSyncJournal({ ...handle, expectedTailSha256,
      event: { kind: 'intent', operation, path } })
    await onCheckpoint?.({ stage: 'intent-durable', path, operation, sequence: intended.pending.sequence })
    if (replacement) {
      const temporary = join(lease, 'replacement')
      const file = await open(temporary, 'wx', replacement.mode === '100755' ? 0o755 : 0o644)
      try {
        await file.writeFile(replacement.bytes)
        await file.chmod(replacement.mode === '100755' ? 0o755 : 0o644)
        await file.sync()
      } finally { await file.close() }
      assert.ok(equal(await readRegular(lease, 'replacement', maximum), next), 'Temporary replacement changed')
      assert.ok(equal(await readRegular(record.targetRoot, path, maximum), old), 'Target changed before install')
      await rename(temporary, join(record.targetRoot, path))
    } else {
      assert.ok(equal(await readRegular(record.targetRoot, path, maximum), old), 'Target changed before remove')
      await unlink(join(record.targetRoot, path))
    }
    assert.ok(equal(await readRegular(record.targetRoot, path, maximum), next), 'Target does not match applied outcome')
    await onCheckpoint?.({ stage: 'file-applied', path, operation, sequence: intended.pending.sequence })
    const completed = await appendPublicSyncJournal({ ...handle, expectedTailSha256: intended.tailSha256,
      event: { kind: 'result', intentSequence: intended.pending.sequence, outcome: 'completed' } })
    success = true
    return { journalRoot: completed.journalRoot, headerSha256, tailSha256: completed.tailSha256,
      path, operation, targetUpdated: true, wholeSyncCompleted: false, publicationReady: false }
  } finally {
    // Retain lease, temp and pending intent on any failure, including preflight
    // errors after lease acquisition. No inference that a failed call did nothing.
    if (success) await rmdir(lease)
  }
}
