/** Read-only directory lifecycle evidence. Unrecorded existence is never ownership. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectPublicSyncJournal } from './public-sync-journal.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function validateIdentity(value) {
  assert.deepEqual(Object.keys(value).sort(), ['dev', 'ino', 'mode'])
  assert.ok(Number.isSafeInteger(value.dev) && value.dev >= 0 && Number.isSafeInteger(value.ino) && value.ino >= 0, 'Invalid directory identity')
  assert.ok(Number.isInteger(value.mode) && value.mode >= 0 && value.mode <= 0o777, 'Invalid directory mode')
}
function pathsFor(record) {
  const paths = new Set([''])
  for (const path of record.writes) {
    assert.ok(typeof path === 'string' && path && !/[\\\0\r\n]/u.test(path) && path.split('/').every(part => part && !['.', '..', '.git'].includes(part)), 'Invalid directory recovery path')
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) paths.add(parts.slice(0, i).join('/'))
  }
  assert.ok(paths.size <= 20000, 'Directory recovery plan exceeds bound')
  return [...paths].sort((a, b) => a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length || a.localeCompare(b))
}
async function readEvidence(root) {
  const stat = await lstat(root)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(root) === root, 'Directory evidence root changed')
  assert.deepEqual(await readdir(root), ['directories.jsonl'], 'Unexpected directory recovery evidence')
  const path = join(root, 'directories.jsonl'), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 32 * 1024 * 1024, 'Directory evidence must be bounded regular data')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Directory evidence changed on open')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Directory evidence changed on read')
    return bytes
  } finally { await file.close() }
}
async function observe(root, path) {
  let current = root
  for (const part of ['', ...path.split('/').filter(Boolean)]) {
    if (part) current = join(current, part)
    let stat
    try { stat = await lstat(current) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) return { conflict: 'noncanonical-directory' }
  }
  const before = await lstat(current), entries = await readdir(current), after = await lstat(current)
  assert.ok(before.dev === after.dev && before.ino === after.ino && before.mode === after.mode, 'Directory changed while observing')
  assert.ok(entries.length <= 20000, 'Directory entry count exceeds recovery bound')
  return { identity: { dev: after.dev, ino: after.ino, mode: after.mode & 0o777 }, entries: entries.sort() }
}

/** No takeover, deletion, permission changes or execution authorization. */
export async function inspectPublicSyncDirectoryRecovery({ journalRoot, headerSha256, expectedPlanSha256 }) {
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit directory plan hash required')
  const handle = { journalRoot, headerSha256 }, journal = await inspectPublicSyncJournal(handle)
  const evidenceRoot = journal.journalRoot + '.directory-lease', bytes = await readEvidence(evidenceRoot)
  const text = bytes.toString('utf8')
  assert.ok(Buffer.from(text).equals(bytes), 'Invalid directory evidence UTF-8')
  const lines = text.split('\n'), interruptedTail = lines.pop()
  assert.ok(lines.length && lines.length <= 40002 && lines.every(line => Buffer.byteLength(line + '\n') <= 2 * 1024 * 1024), 'Invalid directory evidence rows')
  const rows = lines.map(line => JSON.parse(line)), header = rows[0], plan = header.plan
  assert.deepEqual(Object.keys(header).sort(), ['directoryRemovalAuthorized', 'kind', 'plan'])
  assert.equal(header.kind, 'directory-phase-header'); assert.equal(header.directoryRemovalAuthorized, false)
  assert.ok(plan && Array.isArray(plan.directories), 'Missing directory plan')
  assert.deepEqual(Object.keys(plan).sort(), ['directories', 'headerSha256', 'journalRoot', 'kind', 'planSha256', 'preparationRoot', 'preparedSha256', 'publicationReady', 'tailSha256', 'targetRoot', 'targetUpdated'])
  const { planSha256, targetUpdated, publicationReady, ...hashInput } = plan
  assert.equal(planSha256, expectedPlanSha256, 'Directory plan approval changed'); assert.equal(digest(JSON.stringify(hashInput)), expectedPlanSha256, 'Directory plan changed')
  assert.equal(targetUpdated, false); assert.equal(publicationReady, false)
  const { record, lock } = journal.header
  assert.equal(plan.kind, 'prepared-directory-creation-plan')
  for (const [key, value] of Object.entries({ journalRoot: journal.journalRoot, headerSha256: journal.headerSha256,
    tailSha256: journal.headerSha256, targetRoot: record.targetRoot, preparationRoot: lock.preparationRoot, preparedSha256: lock.preparedSha256 })) {
    assert.equal(plan[key], value, 'Directory recovery belongs to another transaction')
  }
  assert.deepEqual(plan.directories.map(entry => entry.path), pathsFor(record), 'Directory paths differ from prepared writes')
  assert.equal(Boolean(plan.directories[0].before), record.targetExists, 'Original target existence differs')
  let index = 1, sequence = 0, previousSha256 = digest(lines[0] + '\n'), pendingPath, ended = false
  const facts = []
  for (const entry of plan.directories) {
    assert.deepEqual(Object.keys(entry).sort(), ['before', 'path'])
    let phase = 'not-started', identity = entry.before
    if (identity) { validateIdentity(identity); phase = 'pre-existing' }
    else if (!ended && index < rows.length) {
      assert.deepEqual(rows[index], { kind: 'directory-intent', sequence: ++sequence, path: entry.path, previousSha256 })
      previousSha256 = digest(lines[index++] + '\n'); phase = 'pending-intent'
      if (index < rows.length) {
        identity = rows[index].identity; assert.ok(identity, 'Missing created identity'); validateIdentity(identity)
        assert.equal(identity.mode, 0o755, 'Created directory permissions differ')
        assert.deepEqual(rows[index], { kind: 'directory-created', sequence: ++sequence, path: entry.path, identity, previousSha256 })
        previousSha256 = digest(lines[index++] + '\n'); phase = 'created-recorded'
      } else { pendingPath = entry.path; ended = true }
    } else ended = true
    facts.push({ path: entry.path, phase, recordedIdentity: identity })
  }
  let completed = false
  if (index < rows.length) {
    assert.ok(!ended, 'Unexpected event after incomplete directory phase')
    assert.deepEqual(rows[index], { kind: 'directory-phase-completed', sequence: ++sequence, previousSha256 })
    previousSha256 = digest(lines[index++] + '\n'); completed = true
  }
  assert.equal(index, rows.length, 'Unexpected directory recovery events')
  const observations = [], directories = [], conflicts = []
  for (const fact of facts) {
    const current = await observe(plan.targetRoot, fact.path); observations.push(current)
    let state
    if (current?.conflict) state = 'conflict'
    else if (fact.recordedIdentity) state = current && same(current.identity, fact.recordedIdentity) ? fact.phase : 'conflict'
    else if (fact.phase === 'pending-intent') state = current ? 'unrecorded-existing-directory' : 'intended-directory-absent'
    else state = current ? 'unattributed-existing-directory' : 'not-created'
    if (state === 'conflict') conflicts.push({ path: fact.path, reason: 'Recorded directory identity or canonical path changed' })
    directories.push({ ...fact, state, observedIdentity: current?.identity ?? null, entryCount: current?.entries?.length ?? null,
      creationRecorded: fact.phase === 'created-recorded', removalAuthorized: false })
  }
  const fresh = await inspectPublicSyncJournal(handle)
  assert.ok(fresh.tailSha256 === journal.tailSha256 && fresh.bytes === journal.bytes && fresh.writerActive === journal.writerActive, 'Journal changed during directory recovery inspection')
  assert.ok((await readEvidence(evidenceRoot)).equals(bytes), 'Directory evidence changed during recovery inspection')
  for (let i = 0; i < facts.length; i++) assert.deepEqual(await observe(plan.targetRoot, facts[i].path), observations[i], 'Directory changed during recovery inspection')
  return { kind: 'directory-recovery-observation', evidenceRoot, evidenceSha256: digest(bytes), planSha256,
    journalTailSha256: journal.tailSha256, directoryTailSha256: previousSha256, directoryPhaseCompleted: completed && !interruptedTail,
    truncatedDirectoryTail: !!interruptedTail, pendingPath, directories, conflicts,
    executorLivenessProven: false, targetUpdated: false, applyAuthorized: false, directoryRemovalAuthorized: false, publicationReady: false }
}
