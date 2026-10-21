/** Append-only transaction intent evidence. Does not execute or recover file changes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rmdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'
import { verifyPublicSyncLock, publicSyncTransactionRoot } from './public-sync-lock.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const encode = value => Buffer.from(JSON.stringify(value) + '\n')
const FILE = 'journal.jsonl', MAX_BYTES = 8 * 1024 * 1024
async function readJournalFile(root) {
  assert.equal(await realpath(root), root, 'Journal must remain canonical')
  const entries = (await readdir(root)).sort(), writerActive = entries.includes('.append-lock')
  assert.deepEqual(entries, writerActive ? ['.append-lock', FILE] : [FILE], 'Unexpected journal evidence')
  if (writerActive) {
    const path = join(root, '.append-lock'), stat = await lstat(path)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, 'Append lock changed')
    assert.deepEqual(await readdir(path), [], 'Unexpected append lock evidence')
  }
  const path = join(root, FILE), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= MAX_BYTES, 'Journal must be bounded regular data')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.isFile() && stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Journal changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Journal changed while reading')
    return { bytes, stat, writerActive }
  } finally { await file.close() }
}
async function readPreparedReceipt(root) {
  assert.equal(await realpath(root), root, 'Preparation root changed')
  const path = join(root, 'prepared.json'), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 2 * 1024 * 1024, 'Prepared receipt must be bounded regular data')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Prepared receipt changed while opening')
    const bytes = await file.readFile()
    assert.equal(bytes.length, stat.size, 'Prepared receipt changed while reading')
    return bytes
  } finally { await file.close() }
}
function eventPaths(record) {
  return { allowed: new Set([...record.writes, ...record.deletes, EXPORT_MANIFEST]),
    installs: new Set([...record.writes, EXPORT_MANIFEST]), removes: new Set(record.deletes) }
}
function validateEvent(event, record, sequence, previousSha256, pending, paths = eventPaths(record)) {
  assert.ok(event.sequence === sequence && event.previousSha256 === previousSha256, 'Journal sequence or hash chain changed')
  if (event.kind === 'intent') {
    assert.equal(pending, undefined, 'Previous intent is unresolved')
    assert.ok(paths.allowed.has(event.path), 'Intent path is not a prepared managed change')
    assert.ok(['install', 'remove', 'restore'].includes(event.operation), 'Unsupported journal operation')
    if (event.operation === 'install') assert.ok(paths.installs.has(event.path), 'Install not in prepared writes')
    if (event.operation === 'remove') assert.ok(paths.removes.has(event.path), 'Remove not in prepared deletes')
    return event
  }
  assert.ok(event.kind === 'result' && pending && event.intentSequence === pending.sequence
    && ['completed', 'not-applied', 'ambiguous'].includes(event.outcome), 'Result does not resolve a known intent')
  // Ambiguous state is retained as pending; no subsequent operation is allowed.
  return event.outcome === 'ambiguous' ? pending : undefined
}

/** A truncated final line is retained and reported; it can never be appended over. */
export async function inspectPublicSyncJournal({ journalRoot, headerSha256 }) {
  assert.match(headerSha256, /^[a-f0-9]{64}$/u, 'Expected journal header hash required')
  const root = resolve(journalRoot), input = await readJournalFile(root)
  const text = input.bytes.toString('utf8'), split = text.split('\n'), interruptedTail = split.pop()
  assert.ok(split.length > 0 && split.length <= 40001, 'Missing or oversized journal sequence')
  const headerBytes = Buffer.from(split[0] + '\n')
  assert.equal(digest(headerBytes), headerSha256, 'Journal header changed')
  const header = JSON.parse(split[0])
  assert.ok(header.schemaVersion === 1 && header.kind === 'public-sync-intent-journal'
    && header.targetUpdated === false && header.applyAuthorized === false, 'Invalid journal header')
  assert.equal(root, publicSyncTransactionRoot(header.lock), 'Journal path does not match transaction')
  await verifyPublicSyncLock(header.lock)
  const prepared = await readPreparedReceipt(header.lock.preparationRoot)
  assert.ok(prepared.length <= 2 * 1024 * 1024 && digest(prepared) === header.lock.preparedSha256, 'Original prepared receipt changed')
  assert.deepEqual(JSON.parse(prepared.toString('utf8')), header.record, 'Journal prepared plan changed')
  let previousSha256 = headerSha256, pending
  const events = []
  // Per-inspection lookup only: no cache survives fresh receipt verification.
  const paths = eventPaths(header.record)
  for (let index = 1; index < split.length; index++) {
    assert.ok(Buffer.byteLength(split[index]) <= 8192, 'Journal event exceeds bound')
    const event = JSON.parse(split[index])
    pending = validateEvent(event, header.record, index, previousSha256, pending, paths)
    previousSha256 = digest(Buffer.from(split[index] + '\n')); events.push(event)
  }
  return { journalRoot: root, headerSha256, header, events, pending,
    interrupted: interruptedTail.length > 0, writerActive: input.writerActive,
    appendable: !input.writerActive && !interruptedTail.length && !events.some(event => event.outcome === 'ambiguous'),
    nextSequence: split.length, tailSha256: previousSha256, bytes: input.bytes.length,
    fileIdentity: { dev: input.stat.dev, ino: input.stat.ino },
    targetUpdated: false, applyAuthorized: false }
}

export async function createPublicSyncJournal({ lock }) {
  await verifyPublicSyncLock(lock)
  const verified = await verifyPreparedPublicSync(lock)
  const root = publicSyncTransactionRoot(lock)
  assert.equal(await realpath(dirname(root)), dirname(root), 'Journal parent must be canonical')
  await mkdir(root, { mode: 0o700 })
  const header = { schemaVersion: 1, kind: 'public-sync-intent-journal', lock,
    record: verified.record, targetUpdated: false, applyAuthorized: false }
  const bytes = encode(header)
  assert.ok(bytes.length <= 4 * 1024 * 1024, 'Journal header exceeds bound')
  const file = await open(join(root, FILE), 'wx', 0o600)
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  const handle = { journalRoot: root, headerSha256: digest(bytes) }
  await inspectPublicSyncJournal(handle)
  return handle
}

/** Explicit tail fence; concurrent or stale append callers must inspect again. */
export async function appendPublicSyncJournal({ journalRoot, headerSha256, expectedTailSha256, event }) {
  const root = resolve(journalRoot)
  const initial = await inspectPublicSyncJournal({ journalRoot: root, headerSha256 })
  assert.ok(initial.appendable, 'Interrupted, busy or ambiguous journal requires recovery')
  assert.equal(initial.tailSha256, expectedTailSha256, 'Journal tail changed')
  const writerRoot = join(root, '.append-lock')
  await mkdir(writerRoot, { mode: 0o700 }) // Atomic append exclusion; interrupted writers retain it.
  try {
    const before = await inspectPublicSyncJournal({ journalRoot: root, headerSha256 })
    assert.ok(!before.interrupted && !before.events.some(event => event.outcome === 'ambiguous'), 'Interrupted or ambiguous journal requires recovery')
    assert.equal(before.tailSha256, expectedTailSha256, 'Journal tail changed')
    const next = { ...event, sequence: before.nextSequence, previousSha256: before.tailSha256 }
    validateEvent(next, before.header.record, before.nextSequence, before.tailSha256, before.pending)
    const bytes = encode(next)
    assert.ok(bytes.length <= 8192 && before.bytes + bytes.length <= MAX_BYTES, 'Journal capacity exceeded')
    const file = await open(join(before.journalRoot, FILE), constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await file.stat()
      assert.ok(stat.dev === before.fileIdentity.dev && stat.ino === before.fileIdentity.ino && stat.size === before.bytes, 'Journal changed before append')
      await file.writeFile(bytes); await file.sync()
    } finally { await file.close() }
  } finally { await rmdir(writerRoot) } // Never recursive; extra evidence blocks cleanup.
  return inspectPublicSyncJournal({ journalRoot: root, headerSha256 })
}
