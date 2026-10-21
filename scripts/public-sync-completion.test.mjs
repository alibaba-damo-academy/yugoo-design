import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EXPORT_MANIFEST, inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock, releaseUnusedPublicSyncLock, verifyPublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncCompletion, finalizePublicSyncCompletion } from './public-sync-completion.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'sync completion ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['a', 'gone', 'added'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await writeFile(join(source, 'a'), 'old'); await writeFile(join(source, 'gone'), 'original deleted')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target'); await cp(old.target, targetRoot, { recursive: true })
  await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'opaque Git')
  await writeFile(join(targetRoot, 'user'), 'untouched')
  await writeFile(join(source, 'a'), 'new'); await rm(join(source, 'gone')); await writeFile(join(source, 'added'), 'new addition')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const input = async () => ({ ...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256 })
  const step = async (operation, path) => executePublicSyncFileStep({ ...await input(), operation, path })
  const completeFiles = async () => { await step('install', 'a'); await step('install', 'added'); await step('remove', 'gone'); await step('install', EXPORT_MANIFEST) }
  return { root, targetRoot, prepared, stage, lock, journal, input, step, completeFiles }
}

test('actual completed files and provenance produce only a read-only completion plan', async t => {
  const f = await fixture(t); await f.completeFiles()
  const before = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  const plan = await inspectPublicSyncCompletion(await f.input())
  assert.equal(plan.verified, true); assert.equal(plan.lockReleaseAuthorized, false)
  assert.equal(plan.completionReceiptWritten, false); assert.equal(plan.publicationReady, false)
  assert.deepEqual(plan.completedPaths, ['a', 'added', 'gone', EXPORT_MANIFEST])
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(before))
  assert.equal((await verifyPublicSyncLock(f.lock)).verified, true)
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'opaque Git')
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'untouched')
})

test('partial operations and stale completion tails cannot be certified', async t => {
  const f = await fixture(t), original = await f.input()
  await assert.rejects(inspectPublicSyncCompletion(original), /every planned/)
  await f.step('install', 'a')
  await assert.rejects(inspectPublicSyncCompletion(await f.input()), /every planned/)
  await f.step('install', 'added'); await f.step('remove', 'gone'); await f.step('install', EXPORT_MANIFEST)
  await assert.rejects(inspectPublicSyncCompletion(original), /accepted tail/)
  assert.equal((await inspectPublicSyncCompletion(await f.input())).verified, true)
})

test('external changes to completed target, stage and retained backups still block completion', async t => {
  for (const changed of ['target', 'stage', 'backup']) {
    const f = await fixture(t); await f.completeFiles()
    const path = changed === 'target' ? join(f.targetRoot, 'a') : changed === 'stage' ? join(f.stage.target, 'a') : join(f.prepared.preparationRoot, 'previous/a')
    await writeFile(path, 'external changed bytes')
    await assert.rejects(inspectPublicSyncCompletion(await f.input()))
    assert.equal(await readFile(path, 'utf8'), 'external changed bytes')
    assert.equal((await verifyPublicSyncLock(f.lock)).verified, true)
  }
})

test('unfinished execution lease blocks completion even when file bytes match', async t => {
  const f = await fixture(t); await f.completeFiles()
  await mkdir(f.journal.journalRoot + '.step-lock')
  await assert.rejects(inspectPublicSyncCompletion(await f.input()), /unresolved execution/)
  assert.equal((await verifyPublicSyncLock(f.lock)).verified, true)
})

test('explicit finalization retains original evidence and releases only its verified owner lock', async t => {
  const f = await fixture(t); await f.completeFiles()
  const input = await f.input(), plan = await inspectPublicSyncCompletion(input)
  const journalBytes = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  const result = await finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256 })
  assert.equal(result.wholeSyncCompleted, true); assert.equal(result.lockReleased, true); assert.equal(result.publicationReady, false)
  await assert.rejects(lstat(f.lock.lockRoot), { code: 'ENOENT' })
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(journalBytes))
  assert.equal(await readFile(join(f.prepared.preparationRoot, 'previous/a'), 'utf8'), 'old')
  const receipt = JSON.parse(await readFile(join(result.evidenceRoot, 'completed.json'), 'utf8'))
  const release = JSON.parse(await readFile(join(result.evidenceRoot, 'released.json'), 'utf8'))
  assert.equal(receipt.lockReleased, false); assert.equal(release.completionSha256, result.completionSha256)
  assert.equal(release.lockReleased, true); assert.deepEqual(receipt.lock, f.lock)
  const next = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: f.stage.target, targetRoot: f.targetRoot }), preparationRoot: join(f.root, 'prepared-next') })
  const nextLock = await acquirePublicSyncLock(next)
  assert.equal((await releaseUnusedPublicSyncLock(nextLock)).released, true)
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'opaque Git')
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'untouched')
})

test('failure after durable completion receipt preserves original lock and does not infer release', async t => {
  const f = await fixture(t); await f.completeFiles()
  const input = await f.input(), plan = await inspectPublicSyncCompletion(input)
  await assert.rejects(finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256,
    onCheckpoint: () => { throw Error('interrupted completion fixture') } }), /interrupted completion/)
  assert.equal((await verifyPublicSyncLock(f.lock)).verified, true)
  const root = f.journal.journalRoot + '.completion-lease'
  assert.equal(JSON.parse(await readFile(join(root, 'completed.json'), 'utf8')).lockReleased, false)
  await assert.rejects(lstat(join(root, 'released.json')), { code: 'ENOENT' })
  await assert.rejects(finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256 }), { code: 'EEXIST' })
})

test('a target edit after durable receipt refuses lock release and preserves the edit', async t => {
  const f = await fixture(t); await f.completeFiles()
  const input = await f.input(), plan = await inspectPublicSyncCompletion(input)
  await assert.rejects(finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256,
    onCheckpoint: () => writeFile(join(f.targetRoot, 'a'), 'external edit') }))
  assert.equal((await verifyPublicSyncLock(f.lock)).verified, true)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'external edit')
  await assert.rejects(lstat(join(f.journal.journalRoot + '.completion-lease', 'released.json')), { code: 'ENOENT' })
})

test('concurrent finalizers have one winner and cannot delete a newer transaction lock', async t => {
  const f = await fixture(t); await f.completeFiles()
  const input = await f.input(), plan = await inspectPublicSyncCompletion(input)
  const attempts = await Promise.allSettled([0, 1].map(() => finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256 })))
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1)
  const next = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: f.stage.target, targetRoot: f.targetRoot }), preparationRoot: join(f.root, 'new-prepared') })
  const nextLock = await acquirePublicSyncLock(next)
  await assert.rejects(finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256 }))
  assert.equal((await verifyPublicSyncLock(nextLock)).verified, true)
})

test('completion evidence changed after durable write cannot authorize lock release', async t => {
  const f = await fixture(t); await f.completeFiles()
  const input = await f.input(), plan = await inspectPublicSyncCompletion(input)
  await assert.rejects(finalizePublicSyncCompletion({ ...input, expectedPlanSha256: plan.planSha256,
    onCheckpoint: event => writeFile(join(event.evidenceRoot, 'completed.json'), 'altered evidence') }), /receipt changed before lock release/)
  assert.equal((await verifyPublicSyncLock(f.lock)).verified, true)
  assert.equal(await readFile(join(f.journal.journalRoot + '.completion-lease', 'completed.json'), 'utf8'), 'altered evidence')
})
