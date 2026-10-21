import assert from 'node:assert/strict'
import { execFileSync, fork } from 'node:child_process'
import { once } from 'node:events'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncInterruption, settleStoppedPublicSyncForward, settleStoppedPublicSyncRestore,
  inspectPublicSyncSettlementResume, resumeStoppedPublicSyncSettlement } from './public-sync-interruption.mjs'
import { inspectPublicSyncRollback, rollbackSettledPublicSync } from './public-sync-rollback.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'explicit interruption ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: [{ kind: 'file', path: 'a', action: 'include', reason: 'fixture' }] }
  await writeFile(join(source, 'a'), 'old')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target'); await cp(old.target, targetRoot, { recursive: true })
  await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'Git kept'); await writeFile(join(targetRoot, 'user'), 'user kept')
  await writeFile(join(source, 'a'), 'next')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const step = { ...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256, operation: 'install', path: 'a' }
  return { root, targetRoot, prepared, lock, journal, step }
}
async function stoppedByHook(f, stage) {
  await assert.rejects(executePublicSyncFileStep({ ...f.step, onCheckpoint: event => { if (event.stage === stage) throw Error('owned fixture interruption') } }), /owned fixture interruption/)
  return { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
}

test('explicit stopped settlement distinguishes before/after file outcomes, archives lease and enables bounded rollback', async t => {
  for (const stage of ['intent-durable', 'file-applied']) {
    const f = await fixture(t), input = await stoppedByHook(f, stage), plan = await inspectPublicSyncInterruption(input)
    const bytes = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
    assert.equal(plan.executorLivenessProven, false)
    assert.equal(plan.outcome, stage === 'intent-durable' ? 'not-applied' : 'completed')
    assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(bytes))
    await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256 }), /quiescence acknowledgment/)
    if (stage === 'intent-durable') await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true }), /rollback-only acknowledgment/)
    const settled = await settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true, notAppliedRollbackOnlyAcknowledged: true })
    assert.equal(settled.targetUpdated, false); assert.equal(settled.lockReleased, false)
    assert.equal(JSON.parse(await readFile(join(settled.evidenceRoot, 'intent.json'), 'utf8')).notAppliedRollbackOnlyAcknowledged, stage === 'intent-durable')
    assert.ok((await lstat(join(settled.evidenceRoot, 'previous-step-lock'))).isDirectory())
    await assert.rejects(lstat(f.journal.journalRoot + '.step-lock'), { code: 'ENOENT' })
    const rollbackInput = { ...f.journal, expectedTailSha256: settled.tailSha256 }
    const rollback = await inspectPublicSyncRollback(rollbackInput)
    await rollbackSettledPublicSync({ ...rollbackInput, expectedPlanSha256: rollback.planSha256 })
    assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
    assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
    assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  }
})

test('real owned child SIGKILL is confirmed before explicit settlement, not inferred from lock age', { timeout: 15000 }, async t => {
  for (const stage of ['intent-durable', 'file-applied']) {
    const f = await fixture(t)
    const child = fork(fileURLToPath(new URL('./test-fixtures/public-sync-interruption-child.mjs', import.meta.url)), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
    const checkpoint = once(child, 'message'), exit = once(child, 'exit')
    child.send({ input: f.step, stage })
    const [message] = await checkpoint; assert.equal(message.stage, stage)
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
    child.kill('SIGKILL')
    const [code, signal] = await exit; assert.equal(code, null); assert.equal(signal, 'SIGKILL')
    const input = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
    const plan = await inspectPublicSyncInterruption(input)
    const settled = await settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true, notAppliedRollbackOnlyAcknowledged: true })
    assert.equal(settled.outcome, stage === 'intent-durable' ? 'not-applied' : 'completed')
    assert.equal((await inspectPublicSyncJournal(f.journal)).pending, undefined)
  }
})

test('wrong plan, edited target, corrupt backup or unknown lease evidence are never settled', async t => {
  const f = await fixture(t), input = await stoppedByHook(f, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: '0'.repeat(64), executorStoppedAcknowledged: true }), /plan changed/)
  await writeFile(join(f.targetRoot, 'a'), 'user changed')
  await assert.rejects(inspectPublicSyncInterruption(input), /conflicts/)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'user changed')
  await writeFile(join(f.targetRoot, 'a'), 'next'); await writeFile(join(f.prepared.preparationRoot, 'previous/a'), 'bad backup')
  await assert.rejects(inspectPublicSyncInterruption(input), /backup changed/)
  await writeFile(join(f.prepared.preparationRoot, 'previous/a'), 'old')
  await writeFile(join(f.journal.journalRoot + '.step-lock', 'unknown'), 'keep evidence')
  await assert.rejects(inspectPublicSyncInterruption(input), /Unexpected interrupted step evidence/)
  assert.equal(await readFile(join(f.journal.journalRoot + '.step-lock', 'unknown'), 'utf8'), 'keep evidence')
})

test('recovery interruption preserves archived evidence and pending journal rather than claiming a completed recovery', async t => {
  const f = await fixture(t), input = await stoppedByHook(f, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: event => { if (event.stage === 'interrupted-lease-archived') throw Error('recovery interrupted') } }), /recovery interrupted/)
  assert.ok((await lstat(join(f.journal.journalRoot + '.interruption-lease', 'previous-step-lock'))).isDirectory())
  assert.equal((await inspectPublicSyncJournal(f.journal)).pending.path, 'a')
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'next')
})

test('concurrent settlement has one winner and a checkpoint external edit prevents archive', async t => {
  const f = await fixture(t), input = await stoppedByHook(f, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
  const results = await Promise.allSettled([1, 2].map(() => settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true })))
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1)
  const g = await fixture(t), nextInput = await stoppedByHook(g, 'file-applied'), next = await inspectPublicSyncInterruption(nextInput)
  await assert.rejects(settleStoppedPublicSyncForward({ ...nextInput, expectedPlanSha256: next.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: async event => { if (event.stage === 'interruption-intent-durable') await writeFile(join(g.targetRoot, 'a'), 'external edit') } }), /conflicts/)
  assert.deepEqual(await readdir(g.journal.journalRoot + '.step-lock'), [])
  assert.equal(await readFile(join(g.targetRoot, 'a'), 'utf8'), 'external edit')
})

test('a partial temporary replacement is preserved, never treated as proof that target was installed', async t => {
  const f = await fixture(t), input = await stoppedByHook(f, 'intent-durable')
  await writeFile(join(f.journal.journalRoot + '.step-lock', 'replacement'), 'part')
  const plan = await inspectPublicSyncInterruption(input)
  assert.equal(plan.outcome, 'not-applied'); assert.equal(plan.forwardContinuationPossible, false)
  const settled = await settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256,
    executorStoppedAcknowledged: true, notAppliedRollbackOnlyAcknowledged: true })
  assert.equal(await readFile(join(settled.evidenceRoot, 'previous-step-lock/replacement'), 'utf8'), 'part')
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
})

test('altered durable recovery intent cannot authorize archiving a lease or resolving pending state', async t => {
  const f = await fixture(t), input = await stoppedByHook(f, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: async event => { if (event.stage === 'interruption-intent-durable') await writeFile(join(event.evidenceRoot, 'intent.json'), '{}') } }), /Recovery intent changed/)
  assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
  assert.equal((await inspectPublicSyncJournal(f.journal)).pending.path, 'a')
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'next')
})

test('stopped restore before/after mutation is explicitly settled, then bounded rollback can finish', async t => {
  for (const checkpoint of ['rollback-intent-durable', 'rollback-file-restored']) {
    const f = await fixture(t)
    await executePublicSyncFileStep(f.step)
    const input = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
    const rollback = await inspectPublicSyncRollback(input)
    await assert.rejects(rollbackSettledPublicSync({ ...input, expectedPlanSha256: rollback.planSha256,
      onCheckpoint: event => { if (event.stage === checkpoint) throw Error('restore executor stopped') } }), /restore executor stopped/)
    const interrupted = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
    if (checkpoint === 'rollback-intent-durable') await writeFile(join(f.journal.journalRoot + '.step-lock', 'replacement'), 'partial restore bytes')
    const plan = await inspectPublicSyncInterruption(interrupted)
    assert.equal(plan.kind, 'pending-restore-settlement-plan'); assert.equal(plan.forwardContinuationPossible, false)
    assert.equal(plan.outcome, checkpoint === 'rollback-file-restored' ? 'completed' : 'not-applied')
    await assert.rejects(settleStoppedPublicSyncRestore({ ...interrupted, expectedPlanSha256: plan.planSha256 }), /quiescence acknowledgment/)
    await assert.rejects(settleStoppedPublicSyncForward({ ...interrupted, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true }), /operation family/)
    const settled = await settleStoppedPublicSyncRestore({ ...interrupted, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true })
    assert.equal(settled.targetUpdated, false); assert.equal(settled.lockReleased, false)
    assert.equal(settled.forwardContinuationPossible, false)
    assert.equal((await inspectPublicSyncJournal(f.journal)).pending, undefined)
    assert.ok((await lstat(join(settled.evidenceRoot, 'previous-step-lock'))).isDirectory())
    if (checkpoint === 'rollback-intent-durable') assert.equal(await readFile(join(settled.evidenceRoot, 'previous-step-lock/replacement'), 'utf8'), 'partial restore bytes')
    const next = { ...f.journal, expectedTailSha256: settled.tailSha256 }, approved = await inspectPublicSyncRollback(next)
    await rollbackSettledPublicSync({ ...next, expectedPlanSha256: approved.planSha256 })
    assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
    assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
    assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  }
})

test('repeated stopped restore attempts retain distinct intent archives; wrong family and user edits refuse', async t => {
  const f = await fixture(t)
  await executePublicSyncFileStep(f.step)
  const archives = []
  for (let attempt = 0; attempt < 2; attempt++) {
    const input = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
    const plan = await inspectPublicSyncRollback(input)
    await assert.rejects(rollbackSettledPublicSync({ ...input, expectedPlanSha256: plan.planSha256,
      onCheckpoint: event => { if (event.stage === 'rollback-intent-durable') throw Error('stopped') } }), /stopped/)
    const pending = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
    const approved = await inspectPublicSyncInterruption(pending)
    const result = await settleStoppedPublicSyncRestore({ ...pending, expectedPlanSha256: approved.planSha256, executorStoppedAcknowledged: true })
    archives.push(result.evidenceRoot)
  }
  assert.equal(new Set(archives).size, 2)
  for (const root of archives) assert.ok((await lstat(join(root, 'previous-step-lock'))).isDirectory())
  const final = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
  await rollbackSettledPublicSync({ ...final, expectedPlanSha256: (await inspectPublicSyncRollback(final)).planSha256 })
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
  const g = await fixture(t), input = await stoppedByHook(g, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
  await assert.rejects(settleStoppedPublicSyncRestore({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true }), /operation family/)
  assert.ok((await lstat(g.journal.journalRoot + '.step-lock')).isDirectory())
  const h = await fixture(t); await executePublicSyncFileStep(h.step)
  const rollbackInput = { ...h.journal, expectedTailSha256: (await inspectPublicSyncJournal(h.journal)).tailSha256 }
  await assert.rejects(rollbackSettledPublicSync({ ...rollbackInput, expectedPlanSha256: (await inspectPublicSyncRollback(rollbackInput)).planSha256,
    onCheckpoint: event => { if (event.stage === 'rollback-intent-durable') throw Error('stopped restore') } }), /stopped restore/)
  const stopped = { ...h.journal, expectedTailSha256: (await inspectPublicSyncJournal(h.journal)).tailSha256 }
  await writeFile(join(h.targetRoot, 'a'), 'external user edit')
  await assert.rejects(inspectPublicSyncInterruption(stopped), /conflicts/)
  assert.equal(await readFile(join(h.targetRoot, 'a'), 'utf8'), 'external user edit')
  assert.ok((await lstat(h.journal.journalRoot + '.step-lock')).isDirectory())
})

test('durable settlement can resume before/after lease archive and confirm a recorded result without replay', async t => {
  for (const checkpoint of ['interruption-intent-durable', 'interrupted-lease-archived']) {
    const f = await fixture(t), input = await stoppedByHook(f, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
    let evidenceRoot
    await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true,
      onCheckpoint: event => { if (event.stage === checkpoint) { evidenceRoot = event.evidenceRoot; throw Error('settlement stopped') } } }), /settlement stopped/)
    const expectedIntentSha256 = createHash('sha256').update(await readFile(join(evidenceRoot, 'intent.json'))).digest('hex')
    const resumeInput = { ...input, evidenceRoot, expectedIntentSha256 }
    const approved = await inspectPublicSyncSettlementResume(resumeInput)
    assert.equal(approved.phase, checkpoint === 'interruption-intent-durable' ? 'intent-durable' : 'lease-archived')
    await assert.rejects(resumeStoppedPublicSyncSettlement({ ...resumeInput, expectedResumePlanSha256: approved.planSha256 }), /quiescence acknowledgment/)
    const result = await resumeStoppedPublicSyncSettlement({ ...resumeInput, expectedResumePlanSha256: approved.planSha256, executorStoppedAcknowledged: true })
    assert.equal(result.settlementCompleted, true); assert.equal(result.targetUpdated, false); assert.equal(result.lockReleased, false)
    const after = await inspectPublicSyncJournal(f.journal), beforeBytes = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
    const finalInput = { ...resumeInput, expectedTailSha256: after.tailSha256 }
    const finalPlan = await inspectPublicSyncSettlementResume(finalInput)
    const repeated = await resumeStoppedPublicSyncSettlement({ ...finalInput, expectedResumePlanSha256: finalPlan.planSha256, executorStoppedAcknowledged: true })
    assert.equal(repeated.phase, 'result-recorded')
    assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(beforeBytes))
    await assert.rejects(lstat(join(evidenceRoot, '.resume-lock')), { code: 'ENOENT' })
    const next = { ...f.journal, expectedTailSha256: after.tailSha256 }
    await rollbackSettledPublicSync({ ...next, expectedPlanSha256: (await inspectPublicSyncRollback(next)).planSha256 })
    assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
  }
})

test('resume rejects stale approval, intent drift, foreign archive and external target edits', async t => {
  for (const mutation of ['intent', 'target', 'archive']) {
    const f = await fixture(t), input = await stoppedByHook(f, 'file-applied'), plan = await inspectPublicSyncInterruption(input)
    let evidenceRoot
    await assert.rejects(settleStoppedPublicSyncForward({ ...input, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true,
      onCheckpoint: event => { if (event.stage === 'interrupted-lease-archived') { evidenceRoot = event.evidenceRoot; throw Error('stopped') } } }), /stopped/)
    const resumeInput = { ...input, evidenceRoot, expectedIntentSha256: createHash('sha256').update(await readFile(join(evidenceRoot, 'intent.json'))).digest('hex') }
    await assert.rejects(resumeStoppedPublicSyncSettlement({ ...resumeInput, expectedResumePlanSha256: '0'.repeat(64), executorStoppedAcknowledged: true }), /plan changed/)
    if (mutation === 'intent') await writeFile(join(evidenceRoot, 'intent.json'), '{}')
    if (mutation === 'target') await writeFile(join(f.targetRoot, 'a'), 'user edited')
    if (mutation === 'archive') await writeFile(join(evidenceRoot, 'previous-step-lock/unknown'), 'keep')
    await assert.rejects(inspectPublicSyncSettlementResume(resumeInput))
    assert.equal((await inspectPublicSyncJournal(f.journal)).pending.operation, 'install')
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  }
})

test('restore settlement resumes its own archive, while a concurrently attempted resume has one winner', async t => {
  const f = await fixture(t); await executePublicSyncFileStep(f.step)
  const input = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }
  await assert.rejects(rollbackSettledPublicSync({ ...input, expectedPlanSha256: (await inspectPublicSyncRollback(input)).planSha256,
    onCheckpoint: event => { if (event.stage === 'rollback-file-restored') throw Error('restore stopped') } }), /restore stopped/)
  const pending = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256 }, plan = await inspectPublicSyncInterruption(pending)
  let evidenceRoot
  await assert.rejects(settleStoppedPublicSyncRestore({ ...pending, expectedPlanSha256: plan.planSha256, executorStoppedAcknowledged: true,
    onCheckpoint: event => { if (event.stage === 'interrupted-lease-archived') { evidenceRoot = event.evidenceRoot; throw Error('settlement stopped') } } }), /settlement stopped/)
  const resumeInput = { ...pending, evidenceRoot, expectedIntentSha256: createHash('sha256').update(await readFile(join(evidenceRoot, 'intent.json'))).digest('hex') }
  const approved = await inspectPublicSyncSettlementResume(resumeInput)
  const results = await Promise.allSettled([1, 2].map(() => resumeStoppedPublicSyncSettlement({ ...resumeInput, expectedResumePlanSha256: approved.planSha256, executorStoppedAcknowledged: true })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await inspectPublicSyncJournal(f.journal)).pending, undefined)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})
