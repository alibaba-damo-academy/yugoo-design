/** Read-only verification of a prepared sync receipt. Not apply authorization. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { EXPORT_MANIFEST, inspectPublicSync } from './public-snapshot-stage.mjs'
import { EXPORT_FILE_BYTE_LIMIT } from './public-snapshot-preflight.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const equal = (a, b) => a?.sha256 === b?.sha256 && a?.mode === b?.mode
function disjoint(a, b) {
  const delta = relative(a, b)
  return delta && (isAbsolute(delta) || delta === '..' || delta.startsWith(`..${sep}`))
}
async function readRegular(root, path, maximum = EXPORT_FILE_BYTE_LIMIT) {
  let full = root
  const parts = path.split('/')
  for (const [index, part] of parts.entries()) {
    assert.ok(part && !['.', '..'].includes(part) && !/[\\\0]/u.test(part), 'Invalid receipt file path')
    full = join(full, part)
    const info = await lstat(full)
    assert.ok(!info.isSymbolicLink() && (index === parts.length - 1 ? info.isFile() : info.isDirectory()), 'Receipt input must be regular')
  }
  assert.equal(await realpath(dirname(full)), dirname(full), 'Receipt input parent changed')
  const before = await lstat(full)
  assert.ok(before.size <= maximum, 'Receipt file exceeds bound')
  const file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Receipt input changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Receipt input changed while reading')
    return { bytes, sha256: digest(bytes), mode: stat.mode & 0o111 ? '100755' : '100644' }
  } finally { await file.close() }
}
async function optionalFile(root, path, maximum = EXPORT_FILE_BYTE_LIMIT) {
  try { return await readRegular(root, path, maximum) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function matchesFence(plan, record) {
  return plan.applicable && ['stageRoot', 'targetRoot', 'targetExists', 'revision', 'stageManifestSha256', 'targetStateSha256']
    .every(key => plan[key] === record[key])
}

/** Re-derives the plan and compares every byte identity; does not touch the target. */
export async function verifyPreparedPublicSync({ preparationRoot, preparedSha256, directoryPhase }) {
  assert.match(preparedSha256, /^[a-f0-9]{64}$/u, 'Expected prepared receipt SHA-256 required')
  const root = resolve(preparationRoot)
  assert.ok((await lstat(root)).isDirectory(), 'Preparation root must be a directory')
  assert.equal(await realpath(root), root, 'Preparation root must be canonical')
  const receipt = await readRegular(root, 'prepared.json', 2 * 1024 * 1024)
  assert.equal(receipt.sha256, preparedSha256, 'Prepared receipt changed')
  let record
  try { record = JSON.parse(receipt.bytes.toString('utf8')) }
  catch { throw new Error('Invalid prepared receipt') }
  assert.ok(record?.schemaVersion === 1 && record.kind === 'prepared-managed-public-sync'
    && record.targetUpdated === false && record.applyImplemented === false && record.releaseApproved === false, 'Invalid prepared receipt shape')
  for (const key of ['stageRoot', 'targetRoot']) {
    assert.ok(typeof record[key] === 'string' && isAbsolute(record[key]) && resolve(record[key]) === record[key], 'Receipt paths must be absolute and canonical')
    assert.ok(disjoint(root, record[key]) && disjoint(record[key], root), 'Preparation overlaps sync inputs')
  }
  const plan = await inspectPublicSync({ stageRoot: record.stageRoot, targetRoot: record.targetRoot })
  let directoryPhaseVerified = false
  async function verifyDirectoryBridge() {
    const { verifyPublicSyncDirectoryPhase } = await import('./public-sync-directories.mjs')
    const result = await verifyPublicSyncDirectoryPhase(directoryPhase)
    assert.equal(result.preparationRoot, root, 'Directory phase preparation differs')
    assert.equal(result.preparedSha256, preparedSha256, 'Directory phase receipt differs')
    assert.equal(result.targetRoot, record.targetRoot, 'Directory phase target differs')
    return result
  }
  if (directoryPhase !== undefined) {
    await verifyDirectoryBridge()
    directoryPhaseVerified = true
  }
  const effectiveFence = directoryPhaseVerified && record.targetExists === false && plan.targetExists === true
    ? { ...record, targetExists: true } : record
  assert.ok(matchesFence(plan, effectiveFence), 'Prepared sync inputs changed')
  assert.deepEqual(record.writes, plan.writes, 'Prepared writes differ from current plan')
  assert.deepEqual(record.deletes, plan.deletes, 'Prepared deletes differ from current plan')
  assert.ok(record.backups && typeof record.backups === 'object' && !Array.isArray(record.backups), 'Invalid backup identities')
  assert.ok(record.replacements && typeof record.replacements === 'object' && !Array.isArray(record.replacements), 'Invalid replacement identities')
  const expected = new Set(['prepared.json', 'next-manifest.json'])
  const nextMarker = await readRegular(root, 'next-manifest.json', 2 * 1024 * 1024)
  assert.ok(equal(nextMarker, record.nextManifestIdentity) && equal(nextMarker, await readRegular(record.stageRoot, EXPORT_MANIFEST, 2 * 1024 * 1024)), 'Prepared next marker changed')
  const previousMarker = await optionalFile(record.targetRoot, EXPORT_MANIFEST, 2 * 1024 * 1024)
  if (previousMarker) {
    expected.add('previous-manifest.json')
    assert.ok(equal(previousMarker, record.previousManifest) && equal(previousMarker, await readRegular(root, 'previous-manifest.json', 2 * 1024 * 1024)), 'Prepared previous marker changed')
  } else assert.equal(record.previousManifest, null, 'Unexpected previous marker identity')
  const backupPaths = []
  for (const path of [...new Set([...plan.writes, ...plan.deletes])].sort()) {
    const previous = await optionalFile(record.targetRoot, path)
    if (!previous) continue
    backupPaths.push(path); expected.add(`previous/${path}`)
    assert.ok(Object.hasOwn(record.backups, path) && equal(previous, record.backups[path])
      && equal(previous, await readRegular(root, `previous/${path}`)), 'Prepared backup changed')
  }
  assert.deepEqual(Object.keys(record.backups).sort(), backupPaths, 'Unexpected backup identity')
  assert.deepEqual(Object.keys(record.replacements).sort(), [...plan.writes].sort(), 'Unexpected replacement identity')
  for (const path of plan.writes) {
    expected.add(`next/${path}`)
    const staged = await readRegular(record.stageRoot, path)
    assert.ok(equal(staged, record.replacements[path]) && equal(staged, await readRegular(root, `next/${path}`)), 'Prepared replacement changed')
  }
  let entries = 0
  const directories = new Set()
  for (const path of expected) {
    const parts = path.split('/')
    for (let index = 1; index < parts.length; index++) directories.add(parts.slice(0, index).join('/'))
  }
  async function checkTree(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      assert.ok(++entries <= 20000, 'Preparation entry bound exceeded')
      const path = prefix + name, info = await lstat(join(directory, name))
      assert.ok(!info.isSymbolicLink(), 'Preparation symlink rejected')
      if (info.isDirectory()) {
        assert.ok(directories.has(path), 'Unexpected preparation directory')
        await checkTree(join(directory, name), path + '/')
      } else assert.ok(info.isFile() && expected.delete(path), 'Unexpected preparation file')
    }
  }
  await checkTree(root)
  assert.equal(expected.size, 0, 'Prepared files missing')
  assert.ok(matchesFence(await inspectPublicSync({ stageRoot: record.stageRoot, targetRoot: record.targetRoot }), plan), 'Sync inputs changed during receipt verification')
  assert.equal((await readRegular(root, 'prepared.json', 2 * 1024 * 1024)).sha256, preparedSha256, 'Receipt changed during verification')
  if (directoryPhaseVerified) await verifyDirectoryBridge()
  return { preparationRoot: root, record, preparedSha256, verified: true, directoryPhaseVerified, targetUpdated: false, applyAuthorized: false }
}
