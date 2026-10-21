/** Explicit settlement of a stopped file executor; never infers liveness from PID/age.
 * Quiescence is an operator prerequisite, not a machine-verified isolation guarantee.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { EXPORT_FILE_BYTE_LIMIT } from './public-snapshot-preflight.mjs'
import { inspectPublicSyncJournal, appendPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'
import { inspectStoppedPublicSyncResumeLease } from './public-sync-resume-lease.mjs'
import { inspectPublicSyncResumeClaimChain, publishPublicSyncResumeClaim } from './public-sync-resume-claim.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => a === null && b === null || !!a && !!b && a.sha256 === b.sha256 && a.mode === b.mode

async function verifyIntent(root, expectedBytes) {
  assert.equal(await realpath(root), root, 'Recovery evidence root changed')
  const path = join(root, 'intent.json'), before = await lstat(path)
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size === expectedBytes.length, 'Recovery intent changed')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await file.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === expectedBytes.length, 'Recovery intent changed while opening')
    assert.ok((await file.readFile()).equals(expectedBytes), 'Recovery intent bytes changed')
  } finally { await file.close() }
}

async function leaseState(root, maximum) {
  const stat = await lstat(root)
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(root) === root, 'Interrupted step lease changed')
  const entries = (await readdir(root)).sort()
  assert.ok(entries.length === 0 || entries.length === 1 && entries[0] === 'replacement', 'Unexpected interrupted step evidence')
  let replacement = null
  if (entries.length) {
    const path = join(root, 'replacement'), before = await lstat(path)
    assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= maximum, 'Interrupted replacement must be bounded regular data')
    const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const actual = await file.stat()
      assert.ok(actual.dev === before.dev && actual.ino === before.ino && actual.size === before.size, 'Interrupted replacement changed on open')
      const bytes = await file.readFile()
      assert.equal(bytes.length, actual.size, 'Interrupted replacement changed on read')
      replacement = { sha256: digest(bytes), mode: actual.mode & 0o111 ? '100755' : '100644' }
    } finally { await file.close() }
  }
  return { dev: stat.dev, ino: stat.ino, replacement }
}

async function inspectPlan(input, archivedLease) {
  const journal = await inspectPublicSyncJournal(input)
  assert.ok(journal.appendable && journal.pending && journal.tailSha256 === input.expectedTailSha256,
    'Interruption settlement requires an accepted complete pending journal')
  const pending = journal.pending
  assert.ok(['install', 'remove', 'restore'].includes(pending.operation), 'Unsupported pending file operation')
  const recovery = await inspectPublicSyncRecovery(input)
  assert.equal(recovery.conflicts.length, 0, 'Interrupted target has conflicts')
  const file = recovery.files.find(item => item.path === pending.path)
  assert.ok(file && ['original', 'possible-applied'].includes(file.state), 'Pending target outcome is unknown')
  const restoring = pending.operation === 'restore'
  if (restoring) {
    const forward = journal.events.filter(event => event.kind === 'intent' && event.path === pending.path && event.operation !== 'restore')
    assert.equal(forward.length, 1, 'Restore settlement requires exactly one prior forward intent')
    assert.ok(journal.events.some(event => event.kind === 'result' && event.intentSequence === forward[0].sequence && event.outcome === 'completed'), 'Restore settlement requires completed forward execution')
  }
  const expectedAfter = restoring ? file.previous : pending.operation === 'remove' ? null : file.replacement
  // Matching original bytes is not causal proof; conservatively record not-applied.
  const outcome = restoring
    ? same(file.current, file.previous) ? 'completed' : same(file.current, file.replacement) ? 'not-applied' : undefined
    : same(file.current, file.previous) ? 'not-applied' : same(file.current, expectedAfter) ? 'completed' : undefined
  assert.ok(outcome, 'Pending target cannot be reconciled with preserved outcomes')
  const originalLease = journal.journalRoot + '.step-lock'
  if (archivedLease) assert.equal(recovery.fileStepLeasePresent, false, 'Another executor lease appeared')
  else assert.equal(recovery.fileStepLeasePresent, true, 'Expected interrupted executor evidence is missing')
  const lease = await leaseState(archivedLease ?? originalLease, pending.path === EXPORT_MANIFEST ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT)
  // A partial temporary file can survive a stopped write. Preserve and hash it,
  // never execute it or infer target application from its presence/content.
  if (lease.replacement) assert.ok(pending.operation === 'install' || restoring && file.previous,
    'Removal operation has unexpected replacement evidence')
  const second = await inspectPublicSyncJournal(input)
  assert.ok(second.tailSha256 === journal.tailSha256 && second.bytes === journal.bytes && second.appendable,
    'Journal changed while inspecting interrupted executor')
  assert.deepEqual(await leaseState(archivedLease ?? originalLease, pending.path === EXPORT_MANIFEST ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT), lease, 'Interrupted lease changed during inspection')
  const plan = { kind: restoring ? 'pending-restore-settlement-plan' : 'pending-forward-settlement-plan', journalRoot: journal.journalRoot,
    headerSha256: journal.headerSha256, journalTailSha256: journal.tailSha256,
    targetRoot: recovery.targetRoot, targetIdentitiesSha256: recovery.targetIdentitiesSha256,
    pending, outcome, lease, forwardContinuationPossible: !restoring && outcome === 'completed' && !journal.events.some(event => event.outcome === 'not-applied') }
  return { ...plan, planSha256: digest(JSON.stringify(plan)), executorLivenessProven: false,
    requiresExplicitExecutorQuiescence: true, targetUpdated: false, lockReleased: false, publicationReady: false }
}

/** Read-only. This plan cannot establish that an executor has stopped. */
export async function inspectPublicSyncInterruption(input) {
  assert.match(input.expectedTailSha256, /^[a-f0-9]{64}$/u, 'Explicit pending journal tail required')
  return inspectPlan(input)
}

/** Operator must stop all executors first. Preserves lease evidence and never alters target files. */
export async function settleStoppedPublicSyncForward({ journalRoot, headerSha256, expectedTailSha256,
  expectedPlanSha256, executorStoppedAcknowledged, notAppliedRollbackOnlyAcknowledged, onCheckpoint }) {
  return settleStoppedFile({ journalRoot, headerSha256, expectedTailSha256, expectedPlanSha256,
    executorStoppedAcknowledged, notAppliedRollbackOnlyAcknowledged, onCheckpoint }, false)
}

/** Reconciles only a stopped restore intent; continuing rollback needs a fresh approved plan. */
export async function settleStoppedPublicSyncRestore(input) {
  return settleStoppedFile(input, true)
}

async function settleStoppedFile({ journalRoot, headerSha256, expectedTailSha256,
  expectedPlanSha256, executorStoppedAcknowledged, notAppliedRollbackOnlyAcknowledged, onCheckpoint }, restoreOnly) {
  assert.equal(executorStoppedAcknowledged, true, 'Explicit executor quiescence acknowledgment required; PID/age is not proof')
  assert.match(expectedPlanSha256, /^[a-f0-9]{64}$/u, 'Explicit settlement plan required')
  const input = { journalRoot, headerSha256, expectedTailSha256 }, initial = await inspectPublicSyncInterruption(input)
  assert.equal(initial.pending.operation === 'restore', restoreOnly, 'Settlement API does not match pending operation family')
  assert.equal(initial.planSha256, expectedPlanSha256, 'Interrupted recovery plan changed')
  if (!restoreOnly && initial.outcome === 'not-applied') assert.equal(notAppliedRollbackOnlyAcknowledged, true,
    'Not-applied irreversibly prevents forward completion; explicit rollback-only acknowledgment required')
  const evidenceRoot = initial.journalRoot + (restoreOnly ? `.restore-interruption-${initial.pending.sequence}-lease` : '.interruption-lease')
  assert.equal(await realpath(dirname(evidenceRoot)), dirname(evidenceRoot), 'Recovery evidence parent changed')
  await mkdir(evidenceRoot, { mode: 0o700 }) // Never steals an earlier recovery attempt.
  const fresh = await inspectPublicSyncInterruption(input)
  assert.equal(fresh.planSha256, expectedPlanSha256, 'Interrupted recovery changed under lease')
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: restoreOnly ? 'stopped-restore-recovery-intent' : 'stopped-forward-recovery-intent',
    plan: fresh, executorStoppedAcknowledged: true,
    notAppliedRollbackOnlyAcknowledged: !restoreOnly && initial.outcome === 'not-applied',
    executorLivenessProven: false, targetUpdated: false }) + '\n')
  assert.ok(bytes.length <= 2 * 1024 * 1024, 'Recovery intent exceeds bound')
  const receipt = await open(join(evidenceRoot, 'intent.json'), 'wx', 0o600)
  try { await receipt.writeFile(bytes); await receipt.sync() } finally { await receipt.close() }
  await onCheckpoint?.({ stage: 'interruption-intent-durable', evidenceRoot })
  await verifyIntent(evidenceRoot, bytes)
  assert.equal((await inspectPublicSyncInterruption(input)).planSha256, expectedPlanSha256, 'Interrupted inputs changed before archive')
  const archivedLease = join(evidenceRoot, 'previous-step-lock')
  await rename(initial.journalRoot + '.step-lock', archivedLease)
  await onCheckpoint?.({ stage: 'interrupted-lease-archived', evidenceRoot })
  await verifyIntent(evidenceRoot, bytes)
  assert.equal((await inspectPlan(input, archivedLease)).planSha256, expectedPlanSha256, 'Interrupted inputs changed after archive')
  const settled = await appendPublicSyncJournal({ journalRoot, headerSha256, expectedTailSha256,
    event: { kind: 'result', intentSequence: initial.pending.sequence, outcome: initial.outcome } })
  assert.equal(settled.pending, undefined, 'Interrupted forward intent remains unresolved')
  return { journalRoot: settled.journalRoot, headerSha256, tailSha256: settled.tailSha256, evidenceRoot,
    outcome: initial.outcome, forwardContinuationPossible: initial.forwardContinuationPossible,
    intentSha256: digest(bytes), executorLivenessProven: false,
    targetUpdated: false, lockReleased: false, publicationReady: false }
}

async function inspectResume(input) {
  const journal = await inspectPublicSyncJournal(input)
  assert.ok(journal.appendable && journal.tailSha256 === input.expectedTailSha256, 'Resume requires an accepted complete journal')
  assert.match(input.expectedIntentSha256, /^[a-f0-9]{64}$/u, 'Explicit durable recovery intent hash required')
  const root = input.evidenceRoot
  assert.equal(await realpath(root), root, 'Resume evidence must remain canonical')
  const entries = (await readdir(root)).sort()
  assert.ok(entries.includes('intent.json') && entries.every(name => ['intent.json', 'previous-step-lock', '.resume-lock'].includes(name)), 'Unexpected resume evidence')
  if (entries.includes('.resume-lock')) {
    const lease = join(root, '.resume-lock'), stat = await lstat(lease)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(lease) === lease, 'Resume lease changed')
    assert.deepEqual(await readdir(lease), [], 'Unknown resume lease evidence')
  }
  const before = await lstat(join(root, 'intent.json'))
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 2 * 1024 * 1024, 'Resume intent must be bounded regular data')
  const descriptor = await open(join(root, 'intent.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let bytes
  try {
    const stat = await descriptor.stat()
    assert.ok(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'Resume intent changed on open')
    bytes = await descriptor.readFile(); assert.equal(bytes.length, stat.size)
  } finally { await descriptor.close() }
  assert.equal(digest(bytes), input.expectedIntentSha256, 'Durable recovery intent changed')
  const receipt = JSON.parse(bytes), plan = receipt.plan, restoring = plan.pending.operation === 'restore'
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.kind, restoring ? 'stopped-restore-recovery-intent' : 'stopped-forward-recovery-intent')
  assert.equal(receipt.executorStoppedAcknowledged, true); assert.equal(receipt.executorLivenessProven, false); assert.equal(receipt.targetUpdated, false)
  assert.equal(receipt.notAppliedRollbackOnlyAcknowledged, !restoring && plan.outcome === 'not-applied')
  assert.equal(plan.journalRoot, journal.journalRoot); assert.equal(plan.headerSha256, journal.headerSha256)
  assert.equal(root, journal.journalRoot + (restoring ? `.restore-interruption-${plan.pending.sequence}-lease` : '.interruption-lease'))
  const archived = entries.includes('previous-step-lock')
  let phase
  if (journal.pending) {
    assert.equal(journal.tailSha256, plan.journalTailSha256, 'Original pending journal changed')
    const fresh = await inspectPlan({ ...input, expectedTailSha256: plan.journalTailSha256 }, archived ? join(root, 'previous-step-lock') : undefined)
    assert.deepEqual(fresh, plan, 'Recovery plan differs from current outcomes')
    phase = archived ? 'lease-archived' : 'intent-durable'
  } else {
    assert.ok(archived, 'Completed settlement is missing its archive')
    const result = journal.events.at(-1), intent = journal.events.at(-2)
    assert.deepEqual(intent, plan.pending, 'Completed settlement is not the accepted pending intent')
    assert.ok(result.kind === 'result' && result.intentSequence === plan.pending.sequence && result.previousSha256 === plan.journalTailSha256 && result.outcome === plan.outcome, 'Unexpected settlement result')
    const recovery = await inspectPublicSyncRecovery(input)
    assert.equal(recovery.fileStepLeasePresent, false, 'Another executor appeared')
    assert.equal(recovery.conflicts.length, 0); assert.equal(recovery.targetIdentitiesSha256, plan.targetIdentitiesSha256, 'Settled target changed')
    assert.deepEqual(await leaseState(join(root, 'previous-step-lock'), plan.pending.path === EXPORT_MANIFEST ? 2 * 1024 * 1024 : EXPORT_FILE_BYTE_LIMIT), plan.lease)
    phase = 'result-recorded'
  }
  await verifyIntent(root, bytes)
  const latest = await inspectPublicSyncJournal(input)
  assert.ok(latest.tailSha256 === journal.tailSha256 && latest.appendable, 'Journal changed during resume inspection')
  const observation = { kind: 'settlement-resume-plan', journalRoot: journal.journalRoot, headerSha256: journal.headerSha256,
    journalTailSha256: journal.tailSha256, evidenceRoot: root, intentSha256: digest(bytes), phase, settlementPlanSha256: plan.planSha256 }
  return { observation, plan, bytes, planSha256: digest(JSON.stringify(observation)) }
}

/** Read-only state classification; existing locks never prove executor quiescence. */
export async function inspectPublicSyncSettlementResume(input) {
  const checked = await inspectResume(input)
  return { ...checked.observation, planSha256: checked.planSha256, targetUpdated: false, lockReleased: false, executorLivenessProven: false, publicationReady: false }
}

async function completeSettlementResume(input, onCheckpoint, verifyOwnership) {
  let current = await inspectResume(input)
  if (current.observation.phase === 'intent-durable') {
    await verifyOwnership()
    await rename(current.plan.journalRoot + '.step-lock', join(input.evidenceRoot, 'previous-step-lock'))
    await onCheckpoint?.({ stage: 'resumed-lease-archived', evidenceRoot: input.evidenceRoot })
  }
  current = await inspectResume(input)
  assert.equal(current.observation.phase, 'lease-archived')
  await verifyOwnership()
  const settled = await appendPublicSyncJournal({ ...input, event: { kind: 'result', intentSequence: current.plan.pending.sequence, outcome: current.plan.outcome } })
  await onCheckpoint?.({ stage: 'resumed-result-durable', evidenceRoot: input.evidenceRoot })
  const final = await inspectResume({ ...input, expectedTailSha256: settled.tailSha256 })
  await verifyOwnership()
  assert.equal(final.observation.phase, 'result-recorded')
  return { ...final.observation, settlementCompleted: true, targetUpdated: false, lockReleased: false, executorLivenessProven: false, publicationReady: false }
}

/** Explicit stopped-resume takeover. Retain the old lease; a new immutable claim gates settlement only. */
export async function takeoverStoppedPublicSyncSettlement({expectedStoppedResumePlanSha256, executorStoppedAcknowledged, onCheckpoint, ...input}) {
  assert.equal(executorStoppedAcknowledged, true, 'Explicit executor quiescence acknowledgment required')
  assert.match(expectedStoppedResumePlanSha256, /^[a-f0-9]{64}$/u, 'Exact stopped resume plan required')
  const accepted = await inspectStoppedPublicSyncResumeLease(input)
  assert.equal(accepted.planSha256, expectedStoppedResumePlanSha256, 'Stopped resume plan changed')
  if (accepted.resume.phase === 'result-recorded') return {...accepted.resume, settlementCompleted: true,
    targetUpdated: false, lockReleased: false, executorLivenessProven: false, publicationReady: false}
  const claim = await publishPublicSyncResumeClaim({evidenceRoot: input.evidenceRoot,
    generation: accepted.claims.generation + 1, previousClaimSha256: accepted.claims.tipSha256,
    acceptedPlanSha256: accepted.planSha256, purpose: 'archive-stopped', executorStoppedAcknowledged: true})
  const verifyOwnership = async () => {
    const chain = await inspectPublicSyncResumeClaimChain({evidenceRoot: input.evidenceRoot})
    assert.equal(chain.generation, claim.record.generation, 'Stopped resume claim superseded')
    assert.equal(chain.tipSha256, claim.claimSha256, 'Stopped resume claim changed')
    assert.deepEqual(chain.rootIdentity, accepted.claims.rootIdentity, 'Resume evidence root changed')
    assert.deepEqual(chain.parentIdentity, accepted.claims.parentIdentity, 'Resume evidence parent changed')
    const stat = await lstat(accepted.lease.root)
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(accepted.lease.root) === accepted.lease.root,
      'Retained resume lease changed')
    assert.deepEqual({root: accepted.lease.root, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o7777}, accepted.lease,
      'Retained resume lease identity changed')
    assert.deepEqual(await readdir(accepted.lease.root), [], 'Unknown retained resume lease evidence')
  }
  await onCheckpoint?.({stage: 'stopped-resume-claimed', evidenceRoot: input.evidenceRoot, generation: claim.record.generation})
  await verifyOwnership()
  assert.equal((await inspectPublicSyncSettlementResume(input)).planSha256, accepted.resume.planSha256,
    'Settlement changed after stopped claim')
  return {...await completeSettlementResume(input, onCheckpoint, verifyOwnership),
    resumeGeneration: claim.record.generation, resumeClaimSha256: claim.claimSha256, retainedResumeLease: accepted.lease.root}
}

/** Resume only a durably recorded settlement. No target writes or transaction-lock release. */
export async function resumeStoppedPublicSyncSettlement({ expectedResumePlanSha256, executorStoppedAcknowledged, onCheckpoint, ...input }) {
  assert.equal(executorStoppedAcknowledged, true, 'Explicit executor quiescence acknowledgment required')
  assert.match(expectedResumePlanSha256, /^[a-f0-9]{64}$/u, 'Explicit resume plan required')
  let current = await inspectResume(input)
  assert.equal(current.planSha256, expectedResumePlanSha256, 'Resume plan changed')
  if (current.observation.phase === 'result-recorded') return { ...current.observation, settlementCompleted: true, targetUpdated: false, lockReleased: false, executorLivenessProven: false, publicationReady: false }
  const lease = join(input.evidenceRoot, '.resume-lock')
  await mkdir(lease, { mode: 0o700 }) // A crashed resume retains this lease; no automatic takeover.
  const owned = await lstat(lease); let success = false
  try {
    current = await inspectResume(input)
    assert.equal(current.planSha256, expectedResumePlanSha256, 'Resume inputs changed under lease')
    const result = await completeSettlementResume(input, onCheckpoint, async () => {
      const actual = await lstat(lease)
      assert.ok(actual.isDirectory() && !actual.isSymbolicLink() && actual.dev === owned.dev && actual.ino === owned.ino,
        'Resume lease changed')
    })
    success = true
    return result
  } finally {
    if (success) {
      const actual = await lstat(lease)
      assert.ok(actual.isDirectory() && !actual.isSymbolicLink() && actual.dev === owned.dev && actual.ino === owned.ino, 'Resume lease changed')
      await rmdir(lease)
    }
  }
}
