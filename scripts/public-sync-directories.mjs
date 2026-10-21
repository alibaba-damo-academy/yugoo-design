/** Explicit creation of prepared managed-file parents; never removes directories. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspectPublicSync } from './public-snapshot-stage.mjs'
import { inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function neededDirectories(record) {
  const needed = new Set([''])
  for (const path of record.writes) {
    assert.ok(path && !/[\\\0\r\n]/u.test(path) && path.split('/').every(part => part && !['.', '..', '.git'].includes(part)), 'Invalid prepared directory path')
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) needed.add(parts.slice(0, i).join('/'))
  }
  assert.ok(needed.size <= 20000, 'Directory plan exceeds bound')
  return [...needed].sort((a, b) => a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length || a.localeCompare(b))
}
async function directoryState(root, path) {
  let current = root
  for (const part of ['', ...path.split('/').filter(Boolean)]) {
    if (part) current = join(current, part)
    let stat
    try { stat = await lstat(current) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(current) === current, 'Managed parent is not a canonical directory')
  }
  const stat = await lstat(current)
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 }
}

export async function inspectPublicSyncDirectories(handle) {
  const journal = await inspectPublicSyncJournal(handle)
  assert.ok(journal.appendable && !journal.pending && !journal.events.length, 'Directory creation must precede file operations')
  const { record, lock } = journal.header
  await verifyPreparedPublicSync(lock)
  const parent = dirname(record.targetRoot)
  assert.equal(await realpath(parent), parent, 'Target parent changed')
  assert.ok((await lstat(parent)).isDirectory(), 'Target parent is not a directory')
  const paths = neededDirectories(record)
  const directories = []
  for (const path of paths) directories.push({ path, before: await directoryState(record.targetRoot, path) })
  const plan = { kind: 'prepared-directory-creation-plan', journalRoot: journal.journalRoot,
    headerSha256: journal.headerSha256, tailSha256: journal.tailSha256, targetRoot: record.targetRoot,
    preparationRoot: lock.preparationRoot, preparedSha256: lock.preparedSha256, directories }
  return { ...plan, planSha256: digest(JSON.stringify(plan)), targetUpdated: false, publicationReady: false }
}

async function readDirectoryEvidence(root) {
  assert.equal(await realpath(root), root, 'Directory evidence root changed')
  const rootStat = await lstat(root)
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Directory evidence must be canonical')
  assert.deepEqual(await readdir(root), ['directories.jsonl'], 'Unexpected directory evidence')
  const path = join(root, 'directories.jsonl'), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 32 * 1024 * 1024, 'Directory evidence must be bounded regular data')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Directory evidence changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Directory evidence changed while reading')
    return bytes
  } finally { await file.close() }
}

/** Only proves a completed directory phase before files run; never authorizes deletion or apply. */
export async function verifyPublicSyncDirectoryPhase({ journalRoot, headerSha256, expectedPlanSha256, expectedTailSha256 }) {
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit directory plan hash required')
  assert.match(expectedTailSha256, /^[a-f0-9]{64}$/u, 'Explicit directory tail hash required')
  const handle = { journalRoot, headerSha256 }, journal = await inspectPublicSyncJournal(handle)
  assert.ok(journal.appendable && !journal.pending && !journal.events.length, 'Directory verification must precede file operations')
  const evidenceRoot = journal.journalRoot + '.directory-lease', bytes = await readDirectoryEvidence(evidenceRoot)
  const text = bytes.toString('utf8')
  assert.ok(Buffer.from(text).equals(bytes) && text.endsWith('\n'), 'Directory evidence is truncated or invalid UTF-8')
  const lines = text.slice(0, -1).split('\n')
  assert.ok(lines.length >= 2 && lines.length <= 40002 && lines.every(line => Buffer.byteLength(line + '\n') <= 2 * 1024 * 1024), 'Directory evidence row bound exceeded')
  const rows = lines.map(line => JSON.parse(line)), header = rows[0], plan = header.plan
  assert.deepEqual(Object.keys(header).sort(), ['directoryRemovalAuthorized', 'kind', 'plan'])
  assert.equal(header.kind, 'directory-phase-header'); assert.equal(header.directoryRemovalAuthorized, false)
  assert.ok(plan && Array.isArray(plan.directories), 'Missing directory plan')
  assert.deepEqual(Object.keys(plan).sort(), ['directories', 'headerSha256', 'journalRoot', 'kind', 'planSha256', 'preparationRoot', 'preparedSha256', 'publicationReady', 'tailSha256', 'targetRoot', 'targetUpdated'])
  const { planSha256, targetUpdated, publicationReady, ...hashInput } = plan
  assert.equal(planSha256, expectedPlanSha256); assert.equal(digest(JSON.stringify(hashInput)), expectedPlanSha256, 'Directory plan hash changed')
  assert.equal(targetUpdated, false); assert.equal(publicationReady, false)
  const { record, lock } = journal.header
  assert.equal(plan.kind, 'prepared-directory-creation-plan')
  for (const [key, value] of Object.entries({ journalRoot: journal.journalRoot, headerSha256: journal.headerSha256,
    tailSha256: journal.tailSha256, targetRoot: record.targetRoot, preparationRoot: lock.preparationRoot, preparedSha256: lock.preparedSha256 })) {
    assert.equal(plan[key], value, 'Directory evidence belongs to another transaction')
  }
  assert.deepEqual(plan.directories.map(entry => entry.path), neededDirectories(record), 'Directory paths differ from prepared writes')
  assert.equal(Boolean(plan.directories[0].before), record.targetExists, 'Original target existence differs')
  let index = 1, previousSha256 = digest(lines[0] + '\n'), sequence = 0
  const identities = []
  for (const entry of plan.directories) {
    assert.deepEqual(Object.keys(entry).sort(), ['before', 'path'])
    let identity = entry.before
    if (!identity) {
      assert.deepEqual(rows[index], { kind: 'directory-intent', sequence: ++sequence, path: entry.path, previousSha256 })
      previousSha256 = digest(lines[index++] + '\n')
      const created = rows[index]
      assert.ok(created && created.identity, 'Directory creation result missing')
      identity = created.identity
      assert.deepEqual(created, { kind: 'directory-created', sequence: ++sequence, path: entry.path, identity, previousSha256 })
      previousSha256 = digest(lines[index++] + '\n')
    }
    assert.deepEqual(Object.keys(identity).sort(), ['dev', 'ino', 'mode'])
    assert.ok(Number.isSafeInteger(identity.dev) && identity.dev >= 0 && Number.isSafeInteger(identity.ino) && identity.ino >= 0, 'Invalid directory identity')
    assert.ok(Number.isInteger(identity.mode) && identity.mode >= 0 && identity.mode <= 0o777, 'Invalid directory permissions')
    if (!entry.before) assert.equal(identity.mode, 0o755, 'Created directory permissions differ')
    assert.deepEqual(await directoryState(plan.targetRoot, entry.path), identity, 'Directory identity changed')
    identities.push({ path: entry.path, identity })
  }
  assert.deepEqual(rows[index], { kind: 'directory-phase-completed', sequence: ++sequence, previousSha256 })
  assert.equal(index, rows.length - 1, 'Unexpected events after directory completion')
  assert.equal(digest(lines[index] + '\n'), expectedTailSha256, 'Directory tail changed')
  const current = await inspectPublicSync({ stageRoot: record.stageRoot, targetRoot: record.targetRoot })
  assert.ok(current.applicable && current.targetExists && ['revision', 'stageManifestSha256', 'targetStateSha256'].every(key => current[key] === record[key]), 'Non-directory sync inputs changed')
  assert.deepEqual(current.writes, record.writes); assert.deepEqual(current.deletes, record.deletes)
  const fresh = await inspectPublicSyncJournal(handle)
  assert.ok(fresh.appendable && !fresh.pending && !fresh.events.length && fresh.tailSha256 === journal.tailSha256, 'Journal changed during directory verification')
  assert.ok((await readDirectoryEvidence(evidenceRoot)).equals(bytes), 'Directory evidence changed during verification')
  for (const entry of identities) assert.deepEqual(await directoryState(plan.targetRoot, entry.path), entry.identity, 'Directory changed during verification')
  return { verified: true, scope: 'completed-directory-phase-only', evidenceRoot, planSha256, tailSha256: expectedTailSha256,
    identities, preparationRoot: lock.preparationRoot, preparedSha256: lock.preparedSha256, targetRoot: record.targetRoot,
    targetUpdated: false, applyAuthorized: false, directoryRemovalAuthorized: false, publicationReady: false }
}

/** The caller accepts the exact inspected plan. Errors retain all intent evidence. */
export async function createPublicSyncDirectories({ journalRoot, headerSha256, expectedPlanSha256, onCheckpoint }) {
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit directory plan hash required')
  const handle = { journalRoot, headerSha256 }
  const plan = await inspectPublicSyncDirectories(handle)
  assert.equal(plan.planSha256, expectedPlanSha256, 'Directory plan changed')
  const evidenceRoot = plan.journalRoot + '.directory-lease'
  await mkdir(evidenceRoot, { mode: 0o700 }) // Existing/crashed directory phase is never taken over.
  const file = await open(join(evidenceRoot, 'directories.jsonl'), 'wx', 0o600)
  let tailSha256, events = 0
  async function append(value) {
    const bytes = Buffer.from(JSON.stringify(value) + '\n')
    assert.ok(bytes.length <= 2 * 1024 * 1024, 'Directory evidence row exceeds bound')
    await file.writeFile(bytes); await file.sync()
    tailSha256 = digest(bytes)
  }
  try {
    const fresh = await inspectPublicSyncDirectories(handle)
    assert.equal(fresh.planSha256, expectedPlanSha256, 'Directory plan changed under lease')
    await append({ kind: 'directory-phase-header', plan, directoryRemovalAuthorized: false })
    for (const entry of plan.directories) {
      assert.deepEqual(await directoryState(plan.targetRoot, entry.path), entry.before, 'Directory changed before creation')
      if (entry.before) continue
      const full = entry.path ? join(plan.targetRoot, entry.path) : plan.targetRoot
      assert.equal(await realpath(dirname(full)), dirname(full), 'Directory ancestor changed')
      await append({ kind: 'directory-intent', sequence: ++events, path: entry.path, previousSha256: tailSha256 })
      await onCheckpoint?.({ stage: 'directory-intent-durable', path: entry.path })
      assert.equal(await realpath(dirname(full)), dirname(full), 'Directory ancestor changed after intent')
      assert.equal(await directoryState(plan.targetRoot, entry.path), null, 'Directory appeared after intent')
      await mkdir(full, { mode: 0o755 }) // Nonrecursive; never adopts collisions.
      // mkdir mode is filtered by umask. Normalize only our new directory via
      // a no-follow directory descriptor, never chmod pre-existing parents.
      const createdStat = await lstat(full)
      assert.ok(createdStat.isDirectory() && !createdStat.isSymbolicLink(), 'Created directory changed')
      const directory = await open(full, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0))
      try {
        const opened = await directory.stat()
        assert.ok(opened.isDirectory() && opened.dev === createdStat.dev && opened.ino === createdStat.ino, 'Created directory changed while opening')
        await directory.chmod(0o755)
      } finally { await directory.close() }
      const identity = await directoryState(plan.targetRoot, entry.path)
      assert.ok(identity && identity.dev === createdStat.dev && identity.ino === createdStat.ino && identity.mode === 0o755, 'Created directory disappeared or changed')
      await onCheckpoint?.({ stage: 'directory-created', path: entry.path })
      await append({ kind: 'directory-created', sequence: ++events, path: entry.path, identity, previousSha256: tailSha256 })
    }
    await append({ kind: 'directory-phase-completed', sequence: ++events, previousSha256: tailSha256 })
    return { evidenceRoot, tailSha256, targetRoot: plan.targetRoot,
      createdDirectories: plan.directories.filter(entry => !entry.before).map(entry => entry.path),
      targetUpdated: plan.directories.some(entry => !entry.before), wholeSyncCompleted: false,
      directoryRemovalAuthorized: false, publicationReady: false }
  } finally { await file.close() } // Receipt/lease always retained, including partial or successful phases.
}
