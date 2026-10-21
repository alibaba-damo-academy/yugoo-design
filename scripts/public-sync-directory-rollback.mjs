/** Explicit empty-directory rollback after managed-file restoration. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { inspectPublicSync } from './public-snapshot-stage.mjs'
import { inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'
import { inspectPublicSyncDirectoryRecovery } from './public-sync-directory-recovery.mjs'
import { inspectPublicSyncResumeClaimChain, publishPublicSyncResumeClaim } from './public-sync-resume-claim.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const physicalIdentity = stat => ({ dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o7777 })
async function boundedBytes(path, maximum = 32 * 1024 * 1024) {
  const before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, 'Invalid bounded rollback evidence')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const actual = await file.stat()
    assert.deepEqual(physicalIdentity(actual), physicalIdentity(before), 'Rollback evidence changed on open')
    assert.equal(actual.size, before.size)
    const bytes = await file.readFile()
    assert.equal(bytes.length, actual.size)
    const after = await lstat(path)
    assert.deepEqual(physicalIdentity(after), physicalIdentity(before), 'Rollback evidence changed on read')
    assert.equal(after.size, before.size)
    return { bytes, identity: physicalIdentity(actual) }
  } finally { await file.close() }
}
async function canonicalIdentity(path) {
  assert.equal(await realpath(path), path, 'Rollback physical path changed')
  const stat = await lstat(path)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Rollback physical directory changed')
  return physicalIdentity(stat)
}
async function syncDirectory(path) {
  const file = await open(path, 'r')
  try { await file.sync() } finally { await file.close() }
}
async function originalFiles(input, ownedStepLease) {
  const journal = await inspectPublicSyncJournal(input)
  assert.ok(journal.appendable && !journal.pending && journal.tailSha256 === input.expectedTailSha256, 'Directory rollback requires the accepted settled journal')
  const recovery = await inspectPublicSyncRecovery(input)
  assert.ok(!recovery.pending && !recovery.conflicts.length && recovery.files.every(file => file.state === 'original') && !recovery.candidateActions.length, 'Managed files must be restored before directory rollback')
  if (ownedStepLease) {
    const root = journal.journalRoot + '.step-lock', stat = await lstat(root)
    assert.ok(recovery.fileStepLeasePresent && stat.isDirectory() && !stat.isSymbolicLink()
      && stat.dev === ownedStepLease.dev && stat.ino === ownedStepLease.ino && await realpath(root) === root, 'Directory rollback executor lease changed')
    assert.deepEqual(await readdir(root), [], 'Unexpected directory rollback executor evidence')
  } else assert.ok(recovery.applicable, 'Another executor prevents directory rollback')
  const record = journal.header.record
  const current = await inspectPublicSync({ stageRoot: record.stageRoot, targetRoot: record.targetRoot })
  assert.ok(current.applicable && current.targetStateSha256 === record.targetStateSha256
    && current.stageManifestSha256 === record.stageManifestSha256 && current.revision === record.revision, 'Original whole-target files changed')
  return { journal, current }
}
async function directoryIdentity(path) {
  assert.equal(await realpath(dirname(path)), dirname(path), 'Directory rollback ancestor changed')
  const stat = await lstat(path)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path, 'Directory rollback target changed')
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 }
}
async function evidenceHash(root) {
  assert.equal(await realpath(root), root, 'Directory rollback evidence root changed')
  assert.deepEqual(await readdir(root), ['directories.jsonl'], 'Directory evidence changed')
  const path = join(root, 'directories.jsonl'), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 32 * 1024 * 1024, 'Invalid directory evidence')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Directory evidence changed on open')
    const bytes = await file.readFile(); assert.equal(bytes.length, stat.size)
    return digest(bytes)
  } finally { await file.close() }
}

async function inspectPlan(input, ownedStepLease) {
  assert.match(input.expectedTailSha256, /^[a-f0-9]{64}$/u, 'Explicit rollback journal tail required')
  const { journal } = await originalFiles(input, ownedStepLease), record = journal.header.record
  const directories = await inspectPublicSyncDirectoryRecovery(input)
  assert.ok(directories.directoryPhaseCompleted && !directories.conflicts.length, 'Directory creation must be fully recorded and unchanged')
  const created = directories.directories.filter(entry => entry.creationRecorded)
  for (const entry of created) {
    const full = entry.path ? join(record.targetRoot, entry.path) : record.targetRoot
    const allowed = created.filter(child => child.path && dirname(child.path) === (entry.path || '.')).map(child => child.path.split('/').at(-1)).sort()
    assert.deepEqual((await readdir(full)).sort(), allowed, 'Created directory has unowned content')
    assert.deepEqual(await directoryIdentity(full), entry.recordedIdentity, 'Created directory identity changed')
  }
  const fresh = await originalFiles(input, ownedStepLease)
  assert.equal(fresh.journal.bytes, journal.bytes, 'Journal changed during directory rollback inspection')
  assert.equal(await evidenceHash(directories.evidenceRoot), directories.evidenceSha256, 'Directory evidence changed')
  const repeated = await inspectPublicSyncDirectoryRecovery(input)
  assert.deepEqual(repeated.directories, directories.directories, 'Directory observations changed')
  const plan = { kind: 'recorded-empty-directory-rollback-plan', journalRoot: journal.journalRoot,
    headerSha256: journal.headerSha256, journalTailSha256: journal.tailSha256, targetRoot: record.targetRoot,
    originalTargetExists: record.targetExists, originalTargetStateSha256: record.targetStateSha256,
    directoryEvidenceRoot: directories.evidenceRoot, directoryEvidenceSha256: directories.evidenceSha256,
    directories: created.map(({ path, recordedIdentity }) => ({ path, identity: recordedIdentity })).reverse(),
    originalDirectories: directories.directories.filter(entry => entry.phase === 'pre-existing').map(({ path, recordedIdentity }) => ({ path, identity: recordedIdentity })) }
  return { ...plan, planSha256: digest(JSON.stringify(plan)), targetUpdated: false, lockReleaseAuthorized: false, publicationReady: false }
}

export async function inspectPublicSyncDirectoryRollback(input) { return inspectPlan(input) }

/** Errors retain cleanup intent evidence; never removes unrecorded or nonempty directories. */
export async function rollbackRecordedPublicSyncDirectories({ journalRoot, headerSha256, expectedTailSha256,
  expectedPlanSha256, expectedDirectoryPlanSha256, onCheckpoint }) {
  const input = { journalRoot, headerSha256, expectedTailSha256, expectedPlanSha256: expectedDirectoryPlanSha256 }
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit directory rollback plan required')
  const plan = await inspectPublicSyncDirectoryRollback(input)
  assert.equal(plan.planSha256, expectedPlanSha256, 'Directory rollback plan changed')
  const root = plan.journalRoot + '.directory-rollback-lease'
  assert.equal(await realpath(dirname(root)), dirname(root), 'Directory rollback evidence parent changed')
  await mkdir(root, { mode: 0o700 }) // Never takes over an interrupted cleanup.
  const stepRoot = plan.journalRoot + '.step-lock'
  await mkdir(stepRoot, { mode: 0o700 }) // Same exclusion as forward and file rollback.
  const ownedStepLease = await lstat(stepRoot)
  assert.equal((await inspectPlan(input, ownedStepLease)).planSha256, expectedPlanSha256, 'Directory rollback changed under lease')
  const file = await open(join(root, 'rollback.jsonl'), 'wx', 0o600)
  const identity = await file.stat(), logHash = createHash('sha256')
  const recoveryAnchor = { schemaVersion: 1, kind: 'directory-rollback-recovery-anchor',
    evidenceRootIdentity: await canonicalIdentity(root), parentIdentity: await canonicalIdentity(dirname(root)),
    logIdentity: physicalIdentity(identity), stepLeaseIdentity: physicalIdentity(ownedStepLease),
    journalSha256: digest((await boundedBytes(join(plan.journalRoot, 'journal.jsonl'), 8 * 1024 * 1024)).bytes),
    directoryPlanSha256: expectedDirectoryPlanSha256 }
  let previousSha256, sequence = 0, writtenBytes = 0, success = false
  async function append(row) {
    const bytes = Buffer.from(JSON.stringify(row) + '\n')
    assert.ok(bytes.length <= 2 * 1024 * 1024 && writtenBytes + bytes.length <= 32 * 1024 * 1024, 'Directory rollback log exceeds bound')
    await file.writeFile(bytes); await file.sync(); previousSha256 = digest(bytes)
    writtenBytes += bytes.length; logHash.update(bytes)
  }
  async function verifyLog() {
    assert.deepEqual(await canonicalIdentity(root), recoveryAnchor.evidenceRootIdentity, 'Directory rollback lease changed')
    assert.deepEqual(await canonicalIdentity(dirname(root)), recoveryAnchor.parentIdentity, 'Directory rollback evidence parent changed')
    assert.deepEqual(await canonicalIdentity(stepRoot), recoveryAnchor.stepLeaseIdentity, 'Directory rollback executor lease changed')
    assert.equal(digest((await boundedBytes(join(plan.journalRoot, 'journal.jsonl'), 8 * 1024 * 1024)).bytes), recoveryAnchor.journalSha256, 'Directory rollback journal bytes changed')
    assert.deepEqual(await readdir(root), ['rollback.jsonl'], 'Unexpected directory rollback evidence')
    const check = await open(join(root, 'rollback.jsonl'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await check.stat()
      assert.ok(stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino && stat.size === writtenBytes, 'Directory rollback log changed')
      const bytes = await check.readFile()
      assert.ok(bytes.length === writtenBytes && digest(bytes) === logHash.copy().digest('hex'), 'Directory rollback log bytes changed')
    } finally { await check.close() }
  }
  try {
    await append({ kind: 'directory-rollback-header', plan, recoveryAnchor })
    await syncDirectory(root); await syncDirectory(stepRoot); await syncDirectory(dirname(root))
    await verifyLog()
    for (const entry of plan.directories) {
      const full = entry.path ? join(plan.targetRoot, entry.path) : plan.targetRoot
      await originalFiles(input, ownedStepLease)
      assert.equal(await evidenceHash(plan.directoryEvidenceRoot), plan.directoryEvidenceSha256, 'Directory evidence changed before removal')
      assert.deepEqual(await directoryIdentity(full), entry.identity, 'Directory identity changed before removal')
      assert.deepEqual(await readdir(full), [], 'Directory is no longer empty')
      await append({ kind: 'directory-removal-intent', sequence: ++sequence, path: entry.path, identity: entry.identity, previousSha256 })
      await onCheckpoint?.({ stage: 'directory-removal-intent-durable', path: entry.path, evidenceRoot: root })
      await verifyLog()
      await originalFiles(input, ownedStepLease)
      assert.equal(await evidenceHash(plan.directoryEvidenceRoot), plan.directoryEvidenceSha256, 'Directory evidence changed after removal intent')
      assert.deepEqual(await directoryIdentity(full), entry.identity, 'Directory identity changed after removal intent')
      assert.deepEqual(await readdir(full), [], 'Directory is no longer empty after intent')
      await rmdir(full) // Empty only, never recursive; races adding content fail closed.
      await onCheckpoint?.({ stage: 'directory-removed', path: entry.path, evidenceRoot: root })
      await verifyLog()
      await append({ kind: 'directory-removal-completed', sequence: ++sequence, path: entry.path, previousSha256 })
    }
    const { current } = await originalFiles(input, ownedStepLease)
    assert.equal(current.targetExists, plan.originalTargetExists, 'Original target existence was not restored')
    for (const entry of plan.originalDirectories) assert.deepEqual(await directoryIdentity(entry.path ? join(plan.targetRoot, entry.path) : plan.targetRoot), entry.identity, 'Original directory changed')
    assert.equal(await evidenceHash(plan.directoryEvidenceRoot), plan.directoryEvidenceSha256, 'Directory evidence changed after rollback')
    await append({ kind: 'directory-rollback-completed', sequence: ++sequence, previousSha256 })
    await verifyLog()
    success = true
    return { evidenceRoot: root, tailSha256: previousSha256, removedPaths: plan.directories.map(entry => entry.path),
      targetFilesAndDirectoriesRestored: true, targetUpdated: plan.directories.length > 0, lockReleased: false, publicationReady: false }
  } finally {
    await file.close()
    if (success) {
      const stat = await lstat(stepRoot)
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && stat.dev === ownedStepLease.dev && stat.ino === ownedStepLease.ino, 'Directory rollback lease changed before release')
      await rmdir(stepRoot) // Empty only; never releases the original transaction lock.
    }
  }
}

async function readRollbackLog(root) {
  assert.equal((await canonicalIdentity(root)).mode & 0o077, 0, 'Unsafe rollback evidence permissions')
  assert.deepEqual(await readdir(root), ['rollback.jsonl'], 'Unexpected directory rollback evidence')
  const log = await boundedBytes(join(root, 'rollback.jsonl'))
  assert.equal(log.identity.mode & 0o077, 0, 'Unsafe rollback log permissions')
  const text = log.bytes.toString('utf8')
  assert.ok(Buffer.from(text).equals(log.bytes) && text.endsWith('\n'), 'Truncated or invalid rollback log')
  const lines = text.slice(0, -1).split('\n')
  assert.ok(lines.length && lines.length <= 40002 && lines.every(line => line && Buffer.byteLength(line + '\n') <= 2 * 1024 * 1024), 'Invalid rollback log rows')
  const rows = lines.map(line => JSON.parse(line)), header = rows[0]
  assert.ok(header.recoveryAnchor, 'Missing directory rollback recovery anchor; historical evidence cannot authorize takeover')
  assert.deepEqual(Object.keys(header).sort(), ['kind', 'plan', 'recoveryAnchor'])
  assert.equal(header.kind, 'directory-rollback-header')
  const plan = header.plan
  assert.deepEqual(Object.keys(plan).sort(), ['directories', 'directoryEvidenceRoot', 'directoryEvidenceSha256', 'headerSha256',
    'journalRoot', 'journalTailSha256', 'kind', 'lockReleaseAuthorized', 'originalDirectories', 'originalTargetExists',
    'originalTargetStateSha256', 'planSha256', 'publicationReady', 'targetRoot', 'targetUpdated'])
  const { planSha256, targetUpdated, lockReleaseAuthorized, publicationReady, ...hashInput } = plan
  assert.equal(plan.kind, 'recorded-empty-directory-rollback-plan')
  assert.equal(digest(JSON.stringify(hashInput)), planSha256, 'Original rollback plan hash changed')
  assert.equal(targetUpdated, false); assert.equal(lockReleaseAuthorized, false); assert.equal(publicationReady, false)
  const anchor = header.recoveryAnchor
  assert.deepEqual(Object.keys(anchor).sort(), ['directoryPlanSha256', 'evidenceRootIdentity', 'journalSha256', 'kind',
    'logIdentity', 'parentIdentity', 'schemaVersion', 'stepLeaseIdentity'])
  assert.equal(anchor.schemaVersion, 1); assert.equal(anchor.kind, 'directory-rollback-recovery-anchor')
  for (const identity of [anchor.evidenceRootIdentity, anchor.parentIdentity, anchor.logIdentity, anchor.stepLeaseIdentity]) {
    assert.deepEqual(Object.keys(identity).sort(), ['dev', 'ino', 'mode'])
    assert.ok(Number.isSafeInteger(identity.dev) && identity.dev >= 0 && Number.isSafeInteger(identity.ino) && identity.ino >= 0
      && Number.isInteger(identity.mode) && identity.mode >= 0 && identity.mode <= 0o7777, 'Invalid recovery physical identity')
  }
  for (const hash of [anchor.directoryPlanSha256, anchor.journalSha256]) assert.match(hash, /^[a-f0-9]{64}$/u)
  assert.equal(anchor.stepLeaseIdentity.mode & 0o077, 0, 'Unsafe anchored step lease')
  assert.deepEqual(await canonicalIdentity(root), anchor.evidenceRootIdentity, 'Rollback evidence root replaced')
  assert.deepEqual(await canonicalIdentity(dirname(root)), anchor.parentIdentity, 'Rollback evidence parent replaced')
  assert.deepEqual(log.identity, anchor.logIdentity, 'Rollback log replaced')
  let index = 1, sequence = 0, previousSha256 = digest(lines[0] + '\n'), completedCount = 0, pending = false
  for (const entry of plan.directories) {
    if (index === rows.length) break
    assert.deepEqual(rows[index], { kind: 'directory-removal-intent', sequence: ++sequence,
      path: entry.path, identity: entry.identity, previousSha256 }, 'Invalid ordered removal intent')
    previousSha256 = digest(lines[index++] + '\n')
    if (index === rows.length) { pending = true; break }
    assert.deepEqual(rows[index], { kind: 'directory-removal-completed', sequence: ++sequence,
      path: entry.path, previousSha256 }, 'Invalid ordered removal result')
    previousSha256 = digest(lines[index++] + '\n'); completedCount++
  }
  let completed = false
  if (index < rows.length) {
    assert.equal(completedCount, plan.directories.length, 'Early rollback completion')
    assert.deepEqual(rows[index], { kind: 'directory-rollback-completed', sequence: ++sequence, previousSha256 })
    previousSha256 = digest(lines[index++] + '\n'); completed = true
  }
  assert.equal(index, rows.length, 'Unexpected rollback log suffix')
  return { ...log, plan, anchor, completedCount, pending, completed, sequence, tailSha256: previousSha256 }
}

async function observeRollbackPath(root, path) {
  // Do not treat ENOENT beneath a noncanonical ancestor as trustworthy absence.
  assert.equal(await realpath(dirname(root)), dirname(root), 'Rollback target ancestor changed')
  let full = root
  for (const part of ['', ...path.split('/').filter(Boolean)]) {
    if (part) full = join(full, part)
    let stat
    try { stat = await lstat(full) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(full) === full, 'Rollback directory is noncanonical')
  }
  const identity = await directoryIdentity(full), entries = (await readdir(full)).sort()
  assert.ok(entries.length <= 20000, 'Rollback directory observation exceeds bound')
  assert.deepEqual(await directoryIdentity(full), identity, 'Rollback directory changed during observation')
  return { identity, entries }
}

async function inspectStoppedRollback(input) {
  assert.match(input.expectedTailSha256, /^[a-f0-9]{64}$/u, 'Exact settled journal tail required')
  assert.match(input.expectedDirectoryPlanSha256, /^[a-f0-9]{64}$/u, 'Exact original directory plan required')
  const journal = await inspectPublicSyncJournal(input), root = journal.journalRoot + '.directory-rollback-lease'
  const log = await readRollbackLog(root), { plan, anchor } = log
  assert.equal(anchor.directoryPlanSha256, input.expectedDirectoryPlanSha256, 'Original directory approval changed')
  for (const [key, value] of Object.entries({ journalRoot: journal.journalRoot, headerSha256: journal.headerSha256,
    journalTailSha256: input.expectedTailSha256, targetRoot: journal.header.record.targetRoot,
    originalTargetExists: journal.header.record.targetExists, originalTargetStateSha256: journal.header.record.targetStateSha256,
    directoryEvidenceRoot: journal.journalRoot + '.directory-lease' })) assert.equal(plan[key], value, 'Rollback log belongs to another transaction')
  const stepRoot = journal.journalRoot + '.step-lock'
  let stepLeasePresent = true
  try {
    assert.deepEqual(await canonicalIdentity(stepRoot), anchor.stepLeaseIdentity, 'Anchored step lease replaced')
    assert.deepEqual(await readdir(stepRoot), [], 'Unexpected anchored step lease evidence')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    assert.ok(log.completed, 'Missing step lease before durable cleanup completion'); stepLeasePresent = false
  }
  const files = await originalFiles(input, stepLeasePresent ? anchor.stepLeaseIdentity : undefined)
  assert.equal(digest((await boundedBytes(join(journal.journalRoot, 'journal.jsonl'), 8 * 1024 * 1024)).bytes), anchor.journalSha256, 'Anchored file journal changed')
  const directories = await inspectPublicSyncDirectoryRecovery({ ...input, expectedPlanSha256: input.expectedDirectoryPlanSha256 })
  assert.ok(directories.directoryPhaseCompleted && !directories.truncatedDirectoryTail, 'Incomplete original directory creation evidence')
  assert.equal(directories.evidenceSha256, plan.directoryEvidenceSha256, 'Original directory creation evidence changed')
  assert.deepEqual(plan.directories, directories.directories.filter(entry => entry.creationRecorded)
    .map(({ path, recordedIdentity }) => ({ path, identity: recordedIdentity })).reverse(), 'Rollback owned paths differ from creation evidence')
  assert.deepEqual(plan.originalDirectories, directories.directories.filter(entry => entry.phase === 'pre-existing')
    .map(({ path, recordedIdentity }) => ({ path, identity: recordedIdentity })), 'Rollback original directories differ')
  const observations = []
  for (let index = 0; index < plan.directories.length; index++) {
    const entry = plan.directories[index], observed = await observeRollbackPath(plan.targetRoot, entry.path)
    let state
    if (index < log.completedCount) {
      assert.equal(observed, null, 'Completed removal path reappeared'); state = 'completed-absent'
    } else if (index === log.completedCount && log.pending && !observed) state = 'pending-absent'
    else {
      assert.ok(observed, 'Unstarted owned directory disappeared')
      assert.deepEqual(observed.identity, entry.identity, 'Owned directory identity changed')
      const allowed = plan.directories.filter(child => child.path && dirname(child.path) === (entry.path || '.')
        && !observations.some(prior => prior.path === child.path && prior.observed === null))
        .map(child => child.path.split('/').at(-1)).sort()
      assert.deepEqual(observed.entries, allowed, 'Owned directory has unowned contents')
      state = index === log.completedCount && log.pending ? 'pending-empty' : 'not-started'
      if (state === 'pending-empty') assert.deepEqual(observed.entries, [], 'Pending directory is not empty')
    }
    const fact = directories.directories.find(fact => fact.path === entry.path)
    if (observed) assert.equal(fact.state, 'created-recorded', 'Unexpected creation observation conflict')
    else assert.ok(fact.state === 'conflict' && fact.observedIdentity === null, 'Removal absence differs from creation observation')
    observations.push({ path: entry.path, state, observed })
  }
  for (const entry of plan.originalDirectories) {
    assert.deepEqual(await directoryIdentity(entry.path ? join(plan.targetRoot, entry.path) : plan.targetRoot), entry.identity, 'Original directory changed')
    assert.equal(directories.directories.find(fact => fact.path === entry.path).state, 'pre-existing', 'Original directory observation conflicts')
  }
  const allowedAbsent = new Set(observations.filter(entry => !entry.observed).map(entry => entry.path))
  assert.ok(directories.conflicts.every(conflict => allowedAbsent.has(conflict.path)), 'Unrelated directory conflict')
  if (log.completed) assert.equal(files.current.targetExists, plan.originalTargetExists, 'Original target existence was not restored')
  const chain = await inspectPublicSyncResumeClaimChain({ evidenceRoot: root })
  const repeated = await readRollbackLog(root)
  assert.ok(repeated.bytes.equals(log.bytes), 'Rollback log changed during inspection')
  assert.deepEqual(repeated.identity, log.identity)
  for (const entry of observations) assert.deepEqual(await observeRollbackPath(plan.targetRoot, entry.path), entry.observed, 'Owned directory changed during inspection')
  await originalFiles(input, stepLeasePresent ? anchor.stepLeaseIdentity : undefined)
  assert.equal(digest((await boundedBytes(join(journal.journalRoot, 'journal.jsonl'), 8 * 1024 * 1024)).bytes), anchor.journalSha256, 'File journal changed during inspection')
  assert.equal(await evidenceHash(plan.directoryEvidenceRoot), plan.directoryEvidenceSha256, 'Creation evidence changed during inspection')
  assert.deepEqual(await inspectPublicSyncResumeClaimChain({ evidenceRoot: root }), chain, 'Recovery claim changed during inspection')
  // Exact identities and observations are approved, not inferred executor liveness.
  const resumePlan = { kind: 'stopped-directory-rollback-resume-plan', evidenceRoot: root, rollbackPlan: plan,
    recoveryAnchor: anchor, rollbackLogSha256: digest(log.bytes), rollbackTailSha256: log.tailSha256,
    completedCount: log.completedCount, pending: log.pending, completed: log.completed, sequence: log.sequence,
    stepLeasePresent, observations, claimGeneration: chain.generation, claimTipSha256: chain.tipSha256,
    claimChainSha256: chain.planSha256 }
  return { ...resumePlan, planSha256: digest(JSON.stringify(resumePlan)), targetUpdated: false,
    executorLivenessProven: false, stepLeaseReleased: false, lockReleased: false, publicationReady: false }
}

/** Historical logs without a durable physical anchor never authorize takeover. */
export async function inspectStoppedPublicSyncDirectoryRollback(input) { return inspectStoppedRollback(input) }

/** Explicit stopped recovery. Retains history, claims, backups and transaction lock. */
export async function resumeStoppedPublicSyncDirectoryRollback({ expectedPlanSha256, executorStoppedAcknowledged, onCheckpoint, ...input }) {
  assert.equal(executorStoppedAcknowledged, true, 'All directory rollback executors must be explicitly stopped')
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Exact inspected stopped directory rollback plan required')
  const approved = await inspectStoppedRollback(input)
  assert.equal(approved.planSha256, expectedPlanSha256, 'Stopped directory rollback approval changed')
  const root = approved.evidenceRoot, stepRoot = approved.rollbackPlan.journalRoot + '.step-lock'
  if (approved.completed && !approved.stepLeasePresent) return { evidenceRoot: root, tailSha256: approved.rollbackTailSha256,
    targetFilesAndDirectoriesRestored: true, targetUpdated: false, alreadyCompleted: true,
    stepLeaseReleased: false, lockReleased: false, publicationReady: false }
  const claim = await publishPublicSyncResumeClaim({ evidenceRoot: root, generation: approved.claimGeneration + 1,
    previousClaimSha256: approved.claimTipSha256, acceptedPlanSha256: expectedPlanSha256,
    purpose: 'archive-stopped', executorStoppedAcknowledged: true })
  let expectedLogSha256 = approved.rollbackLogSha256, removedPaths = [], recordedAbsentPaths = []
  async function verify() {
    const current = await inspectStoppedRollback(input)
    assert.equal(current.claimGeneration, claim.record.generation, 'Directory resume claim superseded')
    assert.equal(current.claimTipSha256, claim.claimSha256, 'Directory resume claim tip changed')
    assert.deepEqual(current.recoveryAnchor, approved.recoveryAnchor, 'Directory resume anchor changed')
    assert.deepEqual(current.rollbackPlan, approved.rollbackPlan, 'Directory resume original plan changed')
    assert.equal(current.rollbackLogSha256, expectedLogSha256, 'Directory resume log changed')
    assert.equal(current.stepLeasePresent, true, 'Directory resume step lease disappeared')
    return current
  }
  async function append(row) {
    await verify()
    const previous = await boundedBytes(join(root, 'rollback.jsonl'))
    assert.equal(digest(previous.bytes), expectedLogSha256, 'Directory resume log changed before append')
    const bytes = Buffer.from(JSON.stringify(row) + '\n')
    assert.ok(bytes.length <= 2 * 1024 * 1024 && previous.bytes.length + bytes.length <= 32 * 1024 * 1024, 'Rollback log exceeds bound')
    const file = await open(join(root, 'rollback.jsonl'), constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await file.stat()
      assert.deepEqual(physicalIdentity(stat), approved.recoveryAnchor.logIdentity, 'Resume log replaced on append')
      assert.equal(stat.size, previous.bytes.length, 'Resume log size changed on append')
      await file.writeFile(bytes); await file.sync()
    } finally { await file.close() }
    expectedLogSha256 = digest(Buffer.concat([previous.bytes, bytes]))
    await verify()
  }
  await onCheckpoint?.({ stage: 'directory-resume-claimed', evidenceRoot: root })
  let current = await verify()
  while (current.completedCount < current.rollbackPlan.directories.length) {
    const entry = current.rollbackPlan.directories[current.completedCount]
    if (!current.pending) {
      await append({ kind: 'directory-removal-intent', sequence: current.sequence + 1,
        path: entry.path, identity: entry.identity, previousSha256: current.rollbackTailSha256 })
      await onCheckpoint?.({ stage: 'directory-removal-intent-durable', path: entry.path, evidenceRoot: root })
    }
    current = await verify()
    const observation = current.observations[current.completedCount]
    if (observation.state === 'pending-empty') {
      await verify()
      const full = entry.path ? join(current.rollbackPlan.targetRoot, entry.path) : current.rollbackPlan.targetRoot
      assert.deepEqual(await directoryIdentity(full), entry.identity, 'Pending empty directory replaced')
      assert.deepEqual(await readdir(full), [], 'Pending directory gained user content')
      await rmdir(full) // Only recorded, same-identity, empty owned directories.
      removedPaths.push(entry.path)
      await onCheckpoint?.({ stage: 'directory-removed', path: entry.path, evidenceRoot: root })
    } else {
      assert.equal(observation.state, 'pending-absent'); recordedAbsentPaths.push(entry.path)
    }
    current = await verify()
    assert.equal(current.observations[current.completedCount].state, 'pending-absent', 'Removed path reappeared')
    await append({ kind: 'directory-removal-completed', sequence: current.sequence + 1,
      path: entry.path, previousSha256: current.rollbackTailSha256 })
    current = await verify()
  }
  if (!current.completed) {
    assert.ok(current.observations.every(entry => entry.state === 'completed-absent'))
    const { current: files } = await originalFiles(input, approved.recoveryAnchor.stepLeaseIdentity)
    assert.equal(files.targetExists, current.rollbackPlan.originalTargetExists, 'Original target existence was not restored')
    await append({ kind: 'directory-rollback-completed', sequence: current.sequence + 1, previousSha256: current.rollbackTailSha256 })
  }
  await onCheckpoint?.({ stage: 'directory-resume-completed-durable', evidenceRoot: root })
  current = await verify()
  assert.ok(current.completed, 'Directory cleanup completion not durable')
  assert.deepEqual(await canonicalIdentity(stepRoot), approved.recoveryAnchor.stepLeaseIdentity, 'Step lease changed before release')
  assert.deepEqual(await readdir(stepRoot), [], 'Step lease is no longer empty')
  await rmdir(stepRoot) // Exact anchored exclusion only; never original transaction lock.
  await syncDirectory(dirname(stepRoot))
  const final = await inspectStoppedRollback(input)
  assert.ok(final.completed && !final.stepLeasePresent && final.rollbackLogSha256 === expectedLogSha256
    && final.claimGeneration === claim.record.generation && final.claimTipSha256 === claim.claimSha256, 'Directory resume changed after step release')
  return { evidenceRoot: root, tailSha256: final.rollbackTailSha256, removedPaths, recordedAbsentPaths,
    targetFilesAndDirectoriesRestored: true, targetUpdated: removedPaths.length > 0,
    stepLeaseReleased: true, lockReleased: false, publicationReady: false }
}
