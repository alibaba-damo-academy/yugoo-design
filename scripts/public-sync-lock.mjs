/** Cooperative exporter lock. No checkout mutation, stale-lock stealing or apply authorization. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const OWNER_FILE = 'owner.json'
function disjoint(a, b) {
  const delta = relative(a, b)
  return delta && (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`))
}
function lockPath(targetRoot) {
  const target = resolve(targetRoot)
  assert.notEqual(target, dirname(target), 'Filesystem root cannot be an export target')
  return join(dirname(target), `.${basename(target)}.yugoo-sync-lock`)
}

export function publicSyncTransactionRoot(handle) {
  assert.match(handle.transactionId, /^[a-f0-9-]{36}$/u, 'Invalid transaction identity')
  return join(dirname(handle.targetRoot), `.${basename(handle.targetRoot)}.yugoo-sync-${handle.transactionId}`)
}

/** Must be called again before a future transaction mutates any managed file. */
export async function verifyPublicSyncLock(handle) {
  assert.ok(handle && /^[a-f0-9]{64}$/u.test(handle.ownerSha256), 'Expected lock identity required')
  assert.equal(handle.lockRoot, lockPath(handle.targetRoot), 'Unexpected lock path')
  assert.equal(await realpath(handle.lockRoot), handle.lockRoot, 'Lock root must remain canonical')
  const directory = await lstat(handle.lockRoot)
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink()
    && directory.dev === handle.dev && directory.ino === handle.ino, 'Lock directory changed')
  assert.deepEqual((await readdir(handle.lockRoot)).sort(), [OWNER_FILE], 'Lock contains transaction or unexpected evidence')
  const path = join(handle.lockRoot, OWNER_FILE), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 8192, 'Lock owner must be bounded regular data')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Lock owner changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Lock owner changed while reading')
    assert.equal(digest(bytes), handle.ownerSha256, 'Lock owner identity changed')
    const owner = JSON.parse(bytes.toString('utf8'))
    assert.ok(owner.schemaVersion === 1 && owner.kind === 'unused-public-sync-lock'
      && owner.transactionId === handle.transactionId && owner.targetRoot === handle.targetRoot
      && owner.preparationRoot === handle.preparationRoot && owner.preparedSha256 === handle.preparedSha256,
    'Lock owner does not match handle')
    return { owner, verified: true, targetUpdated: false, applyAuthorized: false }
  } finally { await file.close() }
}

/** Acquires only after receipt verification, then verifies the receipt under the lock. */
export async function acquirePublicSyncLock({ preparationRoot, preparedSha256 }) {
  const verified = await verifyPreparedPublicSync({ preparationRoot, preparedSha256 })
  const targetRoot = verified.record.targetRoot, lockRoot = lockPath(targetRoot)
  assert.equal(await realpath(dirname(lockRoot)), dirname(lockRoot), 'Lock parent must be canonical')
  for (const other of [verified.preparationRoot, verified.record.stageRoot, targetRoot]) {
    assert.ok(disjoint(other, lockRoot) && disjoint(lockRoot, other), 'Lock overlaps sync input')
  }
  await mkdir(lockRoot, { mode: 0o700 }) // EEXIST always blocks; no PID/age-based takeover.
  const directory = await lstat(lockRoot)
  const owner = { schemaVersion: 1, kind: 'unused-public-sync-lock', transactionId: randomUUID(),
    targetRoot, preparationRoot: verified.preparationRoot, preparedSha256,
    targetStateSha256: verified.record.targetStateSha256,
    stageManifestSha256: verified.record.stageManifestSha256, pid: process.pid }
  const bytes = Buffer.from(JSON.stringify(owner, null, 2) + '\n')
  const file = await open(join(lockRoot, OWNER_FILE), 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  // Any error after mkdir retains the owned evidence for explicit recovery.
  // This is process exclusion, not a claim of power-loss durability on every OS.
  const handle = { lockRoot, targetRoot, preparationRoot: verified.preparationRoot, preparedSha256,
    transactionId: owner.transactionId, ownerSha256: digest(bytes), dev: directory.dev, ino: directory.ino }
  await verifyPublicSyncLock(handle)
  await verifyPreparedPublicSync({ preparationRoot: verified.preparationRoot, preparedSha256 })
  return handle
}

/** Only an unused lock can be released. Future transaction journals require recovery first. */
export async function releaseUnusedPublicSyncLock(handle) {
  await verifyPublicSyncLock(handle)
  try {
    await lstat(publicSyncTransactionRoot(handle))
    throw new Error('Lock has a transaction journal; explicit recovery required')
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await unlink(join(handle.lockRoot, OWNER_FILE))
  await rmdir(handle.lockRoot) // Never recursive; unknown evidence cannot be deleted.
  return { released: true, targetUpdated: false, applyAuthorized: false }
}
