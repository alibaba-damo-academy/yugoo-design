import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { runPublicExportRecovery } from './public-export-recovery.mjs'
import { inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncDirectories, createPublicSyncDirectories } from './public-sync-directories.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncRollback, rollbackSettledPublicSync } from './public-sync-rollback.mjs'
import { inspectPublicSyncInterruption, settleStoppedPublicSyncForward,
  inspectPublicSyncSettlementResume, resumeStoppedPublicSyncSettlement } from './public-sync-interruption.mjs'
import { inspectPublicSyncDirectoryRollback, rollbackRecordedPublicSyncDirectories } from './public-sync-directory-rollback.mjs'
import { inspectPublicSyncRollbackCompletion, finalizePublicSyncRollback } from './public-sync-rollback-completion.mjs'

const cliPath = fileURLToPath(new URL('./public-export-recovery.mjs', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function cli(command, options) {
  const args = Object.entries(options).flatMap(([key, value]) => [`--${key}`, String(value)])
  return JSON.parse(execFileSync(process.execPath, [cliPath, command, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
}
async function fixture(t, existing = true) {
  const root = await mkdtemp(join(tmpdir(), 'recovery CLI with spaces '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  await mkdir(join(source, 'docs'), { recursive: true })
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: [{ kind: 'file', path: 'docs/a', action: 'include', reason: 'synthetic fixture' }] }
  await writeFile(join(source, 'docs/a'), 'old')
  if (existing) {
    const initial = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old stage') })
    await cp(initial.target, target, { recursive: true })
    await mkdir(join(target, '.git')); await writeFile(join(target, '.git/config'), 'preserve Git')
    await writeFile(join(target, 'user'), 'preserve user')
  }
  await writeFile(join(source, 'docs/a'), 'next')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'new stage') })
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot: target }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const plan = await inspectPublicSyncDirectories(journal)
  const created = await createPublicSyncDirectories({ ...journal, expectedPlanSha256: plan.planSha256 })
  const base = { journal: journal.journalRoot, 'header-sha256': journal.headerSha256 }
  const step = { ...journal, expectedTailSha256: journal.headerSha256, operation: 'install', path: 'docs/a',
    directoryPhase: { ...journal, expectedPlanSha256: plan.planSha256, expectedTailSha256: created.tailSha256 } }
  return { root, target, existing, prepared, lock, journal, base, directoryPlan: plan.planSha256, step }
}
async function rollbackAndFinalize(f, tail) {
  const options = { ...f.base, 'tail-sha256': tail }
  const plan = cli('inspect-rollback', options)
  const restored = cli('rollback-files', { ...options, 'plan-sha256': plan.planSha256 })
  const directoryOptions = { ...f.base, 'tail-sha256': restored.journalTailSha256, 'directory-plan-sha256': f.directoryPlan }
  const directories = cli('inspect-directory-rollback', directoryOptions)
  cli('rollback-directories', { ...directoryOptions, 'plan-sha256': directories.planSha256 })
  const completion = cli('inspect-finalize-rollback', directoryOptions)
  await assert.rejects(runPublicExportRecovery(['finalize-rollback', ...Object.entries({ ...directoryOptions, 'plan-sha256': '0'.repeat(64) }).flatMap(([key, value]) => [`--${key}`, value])]), /plan changed/)
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  const final = cli('finalize-rollback', { ...directoryOptions, 'plan-sha256': completion.planSha256 })
  assert.equal(final.originalStateRestored, true); assert.equal(final.lockReleased, true); assert.equal(final.publicationReady, false)
  await assert.rejects(lstat(f.lock.lockRoot), { code: 'ENOENT' })
  assert.ok((await lstat(f.prepared.preparationRoot)).isDirectory())
  assert.ok((await lstat(f.journal.journalRoot)).isDirectory())
  if (f.existing) {
    assert.equal(await readFile(join(f.target, 'docs/a'), 'utf8'), 'old')
    assert.equal(await readFile(join(f.target, '.git/config'), 'utf8'), 'preserve Git')
    assert.equal(await readFile(join(f.target, 'user'), 'utf8'), 'preserve user')
  } else await assert.rejects(lstat(f.target), { code: 'ENOENT' })
}

test('actual CLI restores first and existing targets, then removes only created directories and releases original lock', async t => {
  for (const existing of [false, true]) {
    const f = await fixture(t, existing), applied = await executePublicSyncFileStep(f.step)
    const report = cli('inspect-files', f.base)
    assert.equal(report.pending, undefined)
    const directories = cli('inspect-directories', { ...f.base, 'directory-plan-sha256': f.directoryPlan })
    assert.equal(directories.directoryPhaseCompleted, true); assert.equal(directories.directoryRemovalAuthorized, false)
    await rollbackAndFinalize(f, applied.tailSha256)
  }
})

test('actual CLI finishes a half-released original lock only with explicit completion/plan approval', async t => {
  const f = await fixture(t), input = { ...f.journal, expectedTailSha256: f.journal.headerSha256, expectedDirectoryPlanSha256: f.directoryPlan }
  const cleanup = await inspectPublicSyncDirectoryRollback({ ...input, expectedPlanSha256: f.directoryPlan })
  await rollbackRecordedPublicSyncDirectories({ ...input, expectedPlanSha256: cleanup.planSha256 })
  const completion = await inspectPublicSyncRollbackCompletion(input)
  await assert.rejects(finalizePublicSyncRollback({ ...input, expectedPlanSha256: completion.planSha256,
    onCheckpoint: event => { if (event.stage === 'rollback-original-owner-removed') throw Error('finalizer ended') } }), /finalizer ended/)
  const options = { ...f.base, 'tail-sha256': f.journal.headerSha256, 'directory-plan-sha256': f.directoryPlan,
    'completion-sha256': sha(await readFile(join(f.journal.journalRoot + '.rollback-completion-lease', 'completed.json'))) }
  const plan = cli('inspect-rollback-release', options)
  assert.equal(plan.lockState, 'owner-removed'); assert.equal(plan.executorLivenessProven, false)
  const args = stopped => ['resume-rollback-release', ...Object.entries({ ...options, 'plan-sha256': plan.planSha256,
    'executor-stopped': stopped }).flatMap(([key, value]) => [`--${key}`, value])]
  await assert.rejects(runPublicExportRecovery(args('no')), /quiescence/)
  const result = cli('resume-rollback-release', { ...options, 'plan-sha256': plan.planSha256, 'executor-stopped': 'yes' })
  assert.equal(result.lockReleased, true); assert.equal(result.targetUpdated, false)
  assert.equal(await readFile(join(f.target, 'docs/a'), 'utf8'), 'old')
  assert.equal(await readFile(join(f.target, 'user'), 'utf8'), 'preserve user')
  assert.equal(await readFile(join(f.target, '.git/config'), 'utf8'), 'preserve Git')
  await assert.rejects(lstat(f.lock.lockRoot), { code: 'ENOENT' })
})

test('actual CLI settlement requires explicit stopped and rollback-only decisions, preserves archived evidence', async t => {
  for (const stage of ['intent-durable', 'file-applied']) {
    const f = await fixture(t)
    await assert.rejects(executePublicSyncFileStep({ ...f.step, onCheckpoint: event => {
      if (event.stage === stage) throw Error('test executor ended')
    } }), /test executor ended/)
    const journal = await inspectPublicSyncJournal(f.journal), options = { ...f.base, 'tail-sha256': journal.tailSha256 }
    const plan = cli('inspect-interruption', options)
    const mutation = { ...options, 'plan-sha256': plan.planSha256, 'executor-stopped': 'yes', 'not-applied-rollback-only': 'yes' }
    const args = values => ['settle-forward', ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value])]
    await assert.rejects(runPublicExportRecovery(args({ ...mutation, 'executor-stopped': 'no' })), /quiescence/)
    if (stage === 'intent-durable') await assert.rejects(runPublicExportRecovery(args({ ...mutation, 'not-applied-rollback-only': 'no' })), /rollback-only/)
    const settled = cli('settle-forward', mutation)
    assert.equal(settled.executorLivenessProven, false); assert.equal(settled.targetUpdated, false)
    assert.ok((await lstat(join(settled.evidenceRoot, 'previous-step-lock'))).isDirectory())
    await rollbackAndFinalize(f, settled.tailSha256)
  }
})

test('restore settlement CLI never substitutes forward settlement for a stopped rollback', async t => {
  const f = await fixture(t), applied = await executePublicSyncFileStep(f.step)
  const input = { ...f.journal, expectedTailSha256: applied.tailSha256 }
  const rollback = await inspectPublicSyncRollback(input)
  await assert.rejects(rollbackSettledPublicSync({ ...input, expectedPlanSha256: rollback.planSha256,
    onCheckpoint: event => { if (event.stage === 'rollback-file-restored') throw Error('restore executor ended') } }), /restore executor ended/)
  const journal = await inspectPublicSyncJournal(f.journal), options = { ...f.base, 'tail-sha256': journal.tailSha256 }
  const plan = cli('inspect-interruption', options)
  assert.equal(plan.pending.operation, 'restore')
  const values = { ...options, 'plan-sha256': plan.planSha256, 'executor-stopped': 'yes' }
  await assert.rejects(runPublicExportRecovery(['settle-forward', ...Object.entries({ ...values, 'not-applied-rollback-only': 'yes' }).flatMap(([key, value]) => [`--${key}`, value])]), /operation family/)
  const settled = cli('settle-restore', values)
  assert.equal(settled.outcome, 'completed'); assert.equal(await readFile(join(f.target, 'docs/a'), 'utf8'), 'old')
  await rollbackAndFinalize(f, settled.tailSha256)
})

test('durable settlement resume CLI checks intent and plan hashes and supports result-only confirmation', async t => {
  const f = await fixture(t)
  await assert.rejects(executePublicSyncFileStep({ ...f.step, onCheckpoint: event => { if (event.stage === 'file-applied') throw Error('ended') } }), /ended/)
  const journal = await inspectPublicSyncJournal(f.journal), input = { ...f.journal, expectedTailSha256: journal.tailSha256 }
  const plan = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256,
    executorStoppedAcknowledged: true, onCheckpoint: event => { if (event.stage === 'interrupted-lease-archived') throw Error('settlement ended') } }), /settlement ended/)
  const evidence = f.journal.journalRoot + '.interruption-lease'
  const options = { ...f.base, 'tail-sha256': journal.tailSha256, evidence, 'intent-sha256': sha(await readFile(join(evidence, 'intent.json'))) }
  const observed = cli('inspect-settlement-resume', options)
  assert.equal(observed.phase, 'lease-archived')
  const attempt = values => ['resume-settlement', ...Object.entries(values).flatMap(([key, value]) => [`--${key}`, value])]
  const approval = { ...options, 'resume-plan-sha256': observed.planSha256, 'executor-stopped': 'yes' }
  await assert.rejects(runPublicExportRecovery(attempt({ ...approval, 'resume-plan-sha256': '0'.repeat(64) })), /plan changed/)
  await assert.rejects(runPublicExportRecovery(attempt({ ...approval, 'intent-sha256': '0'.repeat(64) })), /intent/i)
  await assert.rejects(runPublicExportRecovery(attempt({ ...approval, 'executor-stopped': 'no' })), /quiescence/)
  assert.equal((await inspectPublicSyncJournal(f.journal)).pending.path, 'docs/a')
  const resumed = cli('resume-settlement', { ...options, 'resume-plan-sha256': observed.planSha256, 'executor-stopped': 'yes' })
  assert.equal(resumed.settlementCompleted, true); assert.equal(resumed.publicationReady, false)
  const recorded = { ...options, 'tail-sha256': resumed.journalTailSha256 }
  const confirmed = cli('inspect-settlement-resume', recorded)
  const before = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  cli('resume-settlement', { ...recorded, 'resume-plan-sha256': confirmed.planSha256, 'executor-stopped': 'yes' })
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(before))
  await rollbackAndFinalize(f, resumed.journalTailSha256)
})

test('malformed arguments and raw underlying errors are rejected without disclosing source or choosing recovery', async () => {
  const help = cli('--help', {})
  assert.ok(help.commands['resume-settlement'].includes('--executor-stopped'))
  assert.deepEqual(help.commands['inspect-resume-lease'],
    ['--journal', '--header-sha256', '--tail-sha256', '--evidence', '--intent-sha256'])
  assert.equal(help.targetUpdated, false); assert.equal(help.publicationReady, false)
  const pairs = ['--journal', '/nonexistent', '--header-sha256', 'a'.repeat(64)]
  for (const args of [[], ['__proto__'], ['constructor'], ['inspect-files', ...pairs, '--journal', '/again'],
    ['inspect-files', '--journal', '/nonexistent', '--journal', '/again'],
    ['inspect-files', '--journal', '/nonexistent', '--unknown', 'x'],
    ['inspect-files', '--journal', 'relative', '--header-sha256', 'a'.repeat(64)],
    ['inspect-files', '--journal', '/nonexistent', '--header-sha256', 'bad'], ['inspect-files', ...pairs, '--unknown', 'x']]) {
    await assert.rejects(runPublicExportRecovery(args))
  }
  try {
    execFileSync(process.execPath, [cliPath, 'inspect-files', ...pairs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.fail('Missing evidence must fail')
  } catch (error) {
    assert.equal(error.status, 1)
    assert.equal(error.stderr.includes('/nonexistent'), false)
    assert.match(error.stderr, /Retain target, backups, journal and locks/)
  }
})

test('actual retained resume lease CLI pins evidence without clearing the lease or appending a result', async t => {
  const f = await fixture(t)
  await assert.rejects(executePublicSyncFileStep({ ...f.step, onCheckpoint: event => {
    if (event.stage === 'file-applied') throw Error('owned file stop')
  } }), /owned file stop/)
  const input = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
  const interrupted = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncForward({ ...input,
    expectedPlanSha256: interrupted.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: event => { if (event.stage === 'interruption-intent-durable') throw Error('owned settlement stop') },
  }), /owned settlement stop/)
  const evidence = f.journal.journalRoot + '.interruption-lease'
  const resumeInput = { ...input, evidenceRoot: evidence,
    expectedIntentSha256: sha(await readFile(join(evidence, 'intent.json'))) }
  const resumePlan = await inspectPublicSyncSettlementResume(resumeInput)
  await assert.rejects(resumeStoppedPublicSyncSettlement({ ...resumeInput,
    expectedResumePlanSha256: resumePlan.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: event => { if (event.stage === 'resumed-lease-archived') throw Error('owned resume stop') },
  }), /owned resume stop/)
  const before = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  const lease = join(evidence, '.resume-lock'), identity = await lstat(lease)
  const options = { ...f.base, 'tail-sha256': input.expectedTailSha256, evidence,
    'intent-sha256': resumeInput.expectedIntentSha256 }
  const observed = cli('inspect-resume-lease', options)
  assert.equal(observed.kind, 'stopped-settlement-resume-lease-plan')
  assert.equal(observed.resume.phase, 'lease-archived')
  assert.deepEqual(observed.lease, { root: lease, dev: identity.dev, ino: identity.ino, mode: identity.mode & 0o7777 })
  for (const flag of ['leaseArchived', 'executorStoppedAcknowledged', 'executorLivenessProven',
    'targetUpdated', 'lockReleased', 'publicationReady']) assert.equal(observed[flag], false)
  assert.deepEqual(cli('inspect-resume-lease', options), observed)
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(before))
  assert.equal((await lstat(lease)).ino, identity.ino)
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  assert.equal(await readFile(join(f.target, 'docs/a'), 'utf8'), 'next')
  assert.equal(await readFile(join(f.target, '.git/config'), 'utf8'), 'preserve Git')
  assert.equal(await readFile(join(f.target, 'user'), 'utf8'), 'preserve user')
  for (const patch of [{ evidence: 'relative' }, { 'intent-sha256': '0'.repeat(64) }]) {
    await assert.rejects(runPublicExportRecovery(['inspect-resume-lease',
      ...Object.entries({ ...options, ...patch }).flatMap(([key, value]) => [`--${key}`, value])]))
  }
})

test('an edited managed target is a conflict, not an automatically repaired file', async t => {
  const f = await fixture(t), applied = await executePublicSyncFileStep(f.step)
  await writeFile(join(f.target, 'docs/a'), 'user changed design')
  const options = { ...f.base, 'tail-sha256': applied.tailSha256 }
  await assert.rejects(runPublicExportRecovery(['inspect-rollback', ...Object.entries(options).flatMap(([key, value]) => [`--${key}`, value])]), /conflicts/)
  assert.equal(await readFile(join(f.target, 'docs/a'), 'utf8'), 'user changed design')
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})
