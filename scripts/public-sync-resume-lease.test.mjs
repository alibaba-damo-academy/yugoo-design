import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chmod, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {inspectPublicSync, stagePublicSnapshot} from './public-snapshot-stage.mjs'
import {preparePublicSync} from './public-sync-prepare.mjs'
import {acquirePublicSyncLock} from './public-sync-lock.mjs'
import {createPublicSyncJournal, inspectPublicSyncJournal} from './public-sync-journal.mjs'
import {executePublicSyncFileStep} from './public-sync-file-step.mjs'
import {inspectPublicSyncInterruption, settleStoppedPublicSyncForward,
  inspectPublicSyncSettlementResume, resumeStoppedPublicSyncSettlement, takeoverStoppedPublicSyncSettlement} from './public-sync-interruption.mjs'
import {inspectStoppedPublicSyncResumeLease} from './public-sync-resume-lease.mjs'
import {inspectPublicSyncResumeClaimChain} from './public-sync-resume-claim.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'resume lease inspection '))
  t.after(() => rm(root, {recursive: true, force: true}))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => {git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD'])}
  const policy = {version: 1, rules: [{kind: 'file', path: 'a', action: 'include', reason: 'fixture'}]}
  await writeFile(join(source, 'a'), 'old')
  const old = await stagePublicSnapshot({source, revision: commit(), policy, destination: join(root, 'old')})
  const targetRoot = join(root, 'target'); await cp(old.target, targetRoot, {recursive: true})
  await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'Git kept')
  await writeFile(join(source, 'a'), 'next')
  const stage = await stagePublicSnapshot({source, revision: commit(), policy, destination: join(root, 'stage')})
  const prepared = await preparePublicSync({approvedPlan: await inspectPublicSync({stageRoot: stage.target, targetRoot}), preparationRoot: join(root, 'prepared')})
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({lock})
  const step = {...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256, operation: 'install', path: 'a'}
  await assert.rejects(executePublicSyncFileStep({...step, onCheckpoint: e => {if (e.stage === 'file-applied') throw Error('owned stop')}}), /owned stop/)
  const input = {...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256}
  const plan = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncForward({...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: e => {if (e.stage === 'interruption-intent-durable') throw Error('owned settlement stop')}}), /owned settlement stop/)
  const evidenceRoot = journal.journalRoot + '.interruption-lease'
  const resumeInput = {...input, evidenceRoot, expectedIntentSha256: createHash('sha256').update(await readFile(join(evidenceRoot, 'intent.json'))).digest('hex')}
  const resume = await inspectPublicSyncSettlementResume(resumeInput)
  await assert.rejects(resumeStoppedPublicSyncSettlement({...resumeInput, expectedResumePlanSha256: resume.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: e => {if (e.stage === 'resumed-lease-archived') throw Error('owned resume stop')}}), /owned resume stop/)
  return {root, targetRoot, prepared, lock, journal, resumeInput, lease: join(evidenceRoot, '.resume-lock')}
}

test('retained resume lease inspection pins identity without touching target, journal or lease', async t => {
  const f = await fixture(t), before = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  const plan = await inspectStoppedPublicSyncResumeLease(f.resumeInput)
  assert.equal(plan.kind, 'stopped-settlement-resume-lease-plan')
  assert.equal(plan.resume.phase, 'lease-archived')
  const stat = await lstat(f.lease)
  assert.deepEqual(plan.lease, {root: f.lease, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o7777})
  for (const flag of ['leaseArchived', 'executorStoppedAcknowledged', 'executorLivenessProven', 'targetUpdated', 'lockReleased', 'publicationReady']) assert.equal(plan[flag], false)
  assert.deepEqual(await inspectStoppedPublicSyncResumeLease(f.resumeInput), plan)
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(before))
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'next')
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})

test('retained lease inspector rejects unsafe permissions and unknown contents without clearing them', async t => {
  const f = await fixture(t)
  await chmod(f.lease, 0o777)
  await assert.rejects(inspectStoppedPublicSyncResumeLease(f.resumeInput), /permissions are unsafe/)
  assert.equal((await lstat(f.lease)).mode & 0o777, 0o777)
  await chmod(f.lease, 0o700); await writeFile(join(f.lease, 'foreign'), 'keep')
  await assert.rejects(inspectStoppedPublicSyncResumeLease(f.resumeInput), /Unknown resume lease evidence/)
  assert.equal(await readFile(join(f.lease, 'foreign'), 'utf8'), 'keep')
})

const recoveryArgs = (command, f) => [command, '--journal', f.journal.journalRoot,
  '--header-sha256', f.resumeInput.headerSha256, '--tail-sha256', f.resumeInput.expectedTailSha256,
  '--evidence', f.resumeInput.evidenceRoot, '--intent-sha256', f.resumeInput.expectedIntentSha256]

test('explicit CLI stopped resume takeover records the pending result and preserves all retained evidence', async t => {
  const cli = args => JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL('./public-export-recovery.mjs', import.meta.url)), ...args], {encoding: 'utf8'}))
  const f = await fixture(t), plan = cli(recoveryArgs('inspect-resume-lease', f))
  const intent = await readFile(join(f.resumeInput.evidenceRoot, 'intent.json')), lease = await lstat(f.lease)
  const backup = await readFile(join(f.prepared.preparationRoot, 'previous/a'))
  const archived = await lstat(join(f.resumeInput.evidenceRoot, 'previous-step-lock'))
  const original = await inspectPublicSyncJournal(f.journal)
  await assert.rejects(resumeStoppedPublicSyncSettlement({...f.resumeInput,
    expectedResumePlanSha256: plan.resume.planSha256, executorStoppedAcknowledged: true}), {code: 'EEXIST'})
  const result = cli([...recoveryArgs('takeover-stopped-resume', f),
    '--stopped-resume-plan-sha256', plan.planSha256, '--executor-stopped', 'yes'])
  assert.equal(result.phase, 'result-recorded'); assert.equal(result.settlementCompleted, true)
  for (const flag of ['targetUpdated', 'lockReleased', 'executorLivenessProven', 'publicationReady']) assert.equal(result[flag], false)
  const settled = await inspectPublicSyncJournal(f.journal)
  assert.equal(settled.events.length, original.events.length + 1)
  assert.equal(settled.events.at(-1).kind, 'result')
  assert.equal((await inspectPublicSyncSettlementResume({...f.resumeInput, expectedTailSha256: result.journalTailSha256})).phase, 'result-recorded')
  assert.ok((await readFile(join(f.resumeInput.evidenceRoot, 'intent.json'))).equals(intent))
  assert.ok((await readFile(join(f.prepared.preparationRoot, 'previous/a'))).equals(backup))
  assert.equal((await lstat(f.lease)).ino, lease.ino)
  assert.equal((await lstat(join(f.resumeInput.evidenceRoot, 'previous-step-lock'))).ino, archived.ino)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'next')
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  const chain = await inspectPublicSyncResumeClaimChain({evidenceRoot: f.resumeInput.evidenceRoot})
  assert.equal(chain.generation, 1); assert.equal(chain.tipSha256, result.resumeClaimSha256)
  assert.equal(chain.claims[0].record.acceptedPlanSha256, plan.planSha256)
})

test('same accepted stopped resume plan has exactly one generation winner', async t => {
  const f = await fixture(t), plan = await inspectStoppedPublicSyncResumeLease(f.resumeInput)
  const input = {...f.resumeInput, expectedStoppedResumePlanSha256: plan.planSha256, executorStoppedAcknowledged: true}
  const attempts = await Promise.allSettled([takeoverStoppedPublicSyncSettlement(input), takeoverStoppedPublicSyncSettlement(input)])
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(attempts.filter(r => r.status === 'rejected').length, 1)
  const chain = await inspectPublicSyncResumeClaimChain({evidenceRoot: f.resumeInput.evidenceRoot})
  assert.equal(chain.generation, 1)
  const journal = await inspectPublicSyncJournal(f.journal)
  assert.equal(journal.events.filter(e => e.kind === 'result').length, 1)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'next')
})

test('stopped resume takeover rejects wrong approval and replaced lease before settlement side effects', async t => {
  const f = await fixture(t), plan = await inspectStoppedPublicSyncResumeLease(f.resumeInput)
  const before = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  const input = {...f.resumeInput, expectedStoppedResumePlanSha256: plan.planSha256, executorStoppedAcknowledged: true}
  await assert.rejects(takeoverStoppedPublicSyncSettlement({...input, executorStoppedAcknowledged: false}), /acknowledgment/)
  await assert.rejects(takeoverStoppedPublicSyncSettlement({...input, expectedStoppedResumePlanSha256: '0'.repeat(64)}), /plan changed/)
  assert.equal((await inspectPublicSyncResumeClaimChain({evidenceRoot: f.resumeInput.evidenceRoot})).generation, 0)
  await assert.rejects(takeoverStoppedPublicSyncSettlement({...input, onCheckpoint: async e => {
    if (e.stage !== 'stopped-resume-claimed') return
    await rename(f.lease, join(f.resumeInput.evidenceRoot, 'retained-fixture-lease'))
    await mkdir(f.lease, {mode: 0o700})
  }}), /lease identity changed/)
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(before))
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'next')
  assert.ok((await lstat(join(f.resumeInput.evidenceRoot, 'retained-fixture-lease'))).isDirectory())
})
