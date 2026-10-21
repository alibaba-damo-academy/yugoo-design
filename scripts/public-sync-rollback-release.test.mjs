import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncDirectories, createPublicSyncDirectories } from './public-sync-directories.mjs'
import { inspectPublicSyncDirectoryRollback, rollbackRecordedPublicSyncDirectories } from './public-sync-directory-rollback.mjs'
import { inspectPublicSyncRollbackCompletion, finalizePublicSyncRollback } from './public-sync-rollback-completion.mjs'
import { inspectPublicSyncRollbackRelease, resumePublicSyncRollbackRelease } from './public-sync-rollback-release.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture(t, stage, existing = true) {
  const root = await mkdtemp(join(tmpdir(), 'rollback release ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(join(source, 'docs'), { recursive: true }); await writeFile(join(source, 'docs/a'), 'source')
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false']); git(['add', '-A']); git(['commit', '-qm', 'fixture'])
  const policy = { version: 1, rules: [{ kind: 'file', path: 'docs/a', action: 'include', reason: 'fixture' }] }
  const snapshot = await stagePublicSnapshot({ source, revision: git(['rev-parse', 'HEAD']), policy, destination: join(root, 'stage') })
  const targetRoot = join(root, 'target')
  if (existing) { await mkdir(join(targetRoot, '.git'), { recursive: true }); await writeFile(join(targetRoot, '.git/config'), 'Git kept'); await writeFile(join(targetRoot, 'user'), 'user kept') }
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: snapshot.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const directory = await inspectPublicSyncDirectories(journal)
  await createPublicSyncDirectories({ ...journal, expectedPlanSha256: directory.planSha256 })
  const input = { ...journal, expectedTailSha256: journal.headerSha256, expectedDirectoryPlanSha256: directory.planSha256 }
  const cleanup = await inspectPublicSyncDirectoryRollback({ ...input, expectedPlanSha256: directory.planSha256 })
  await rollbackRecordedPublicSyncDirectories({ ...input, expectedPlanSha256: cleanup.planSha256 })
  const completion = await inspectPublicSyncRollbackCompletion(input)
  await assert.rejects(finalizePublicSyncRollback({ ...input, expectedPlanSha256: completion.planSha256,
    onCheckpoint: event => { if (event.stage === stage) throw Error('stopped finalizer') } }), /stopped finalizer/)
  const evidenceRoot = journal.journalRoot + '.rollback-completion-lease'
  input.expectedCompletionSha256 = sha(await readFile(join(evidenceRoot, 'completed.json')))
  return { root, targetRoot, prepared, lock, journal, evidenceRoot, input, existing }
}
const resume = async (f, options = {}) => {
  const plan = await inspectPublicSyncRollbackRelease(f.input)
  return resumePublicSyncRollbackRelease({ ...f.input, expectedPlanSha256: plan.planSha256, executorStopped: true, ...options })
}

test('all original finalizer release boundaries resume without changing target/Git/backups', async t => {
  for (const stage of ['rollback-completion-receipt-durable', 'rollback-original-owner-removed', 'rollback-original-lock-removed', 'rollback-release-receipt-durable'])
    await t.test(stage, async t => {
      const f = await fixture(t, stage), prepared = await readFile(join(f.prepared.preparationRoot, 'prepared.json'))
      const result = await resume(f)
      assert.equal(result.lockReleased, true); assert.equal(result.targetUpdated, false); assert.equal(result.publicationReady, false)
      await assert.rejects(lstat(f.lock.lockRoot), { code: 'ENOENT' })
      await assert.rejects(lstat(f.journal.journalRoot + '.step-lock'), { code: 'ENOENT' })
      assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
      assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
      assert.deepEqual(await readFile(join(f.prepared.preparationRoot, 'prepared.json')), prepared)
      const bytes = await readFile(join(f.evidenceRoot, 'released.json'))
      assert.equal((await resume(f)).alreadyReleased, true)
      assert.deepEqual(await readFile(join(f.evidenceRoot, 'released.json')), bytes)
    })
})

test('first export restoration keeps an absent target absent', async t => {
  const f = await fixture(t, 'rollback-original-owner-removed', false)
  await resume(f)
  await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' })
})

test('controlled recovery interruptions can be re-inspected at each new release boundary', async t => {
  for (const stage of ['release-resume-fenced', 'release-resume-owner-removed', 'release-resume-lock-removed', 'release-resume-receipt-durable'])
    await t.test(stage, async t => {
      const f = await fixture(t, 'rollback-completion-receipt-durable')
      await assert.rejects(resume(f, { onCheckpoint: event => { if (event.stage === stage) throw Error('controlled recovery interruption') } }), /controlled recovery interruption/)
      await assert.rejects(lstat(f.journal.journalRoot + '.release-resume-lease'), { code: 'ENOENT' })
      assert.equal((await resume(f)).lockReleased, true)
    })
})

test('explicit acknowledgement and exact completion/plan pins are required', async t => {
  const f = await fixture(t, 'rollback-original-owner-removed'), plan = await inspectPublicSyncRollbackRelease(f.input)
  await assert.rejects(resumePublicSyncRollbackRelease({ ...f.input, expectedPlanSha256: plan.planSha256 }), /stopped-executor/)
  await assert.rejects(resumePublicSyncRollbackRelease({ ...f.input, expectedPlanSha256: '0'.repeat(64), executorStopped: true }), /plan changed/)
  await assert.rejects(inspectPublicSyncRollbackRelease({ ...f.input, expectedCompletionSha256: '0'.repeat(64) }), /receipt changed/)
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})

test('user edits, journal changes, foreign leases and recreated directories never authorize cleanup', async t => {
  for (const change of ['user', 'journal', 'step-replacement', 'new-directory', 'foreign-resume', 'symlink'])
    await t.test(change, async t => {
      const f = await fixture(t, 'rollback-original-lock-removed')
      if (change === 'user') await writeFile(join(f.targetRoot, 'user'), 'external')
      if (change === 'journal') await writeFile(join(f.journal.journalRoot, 'journal.jsonl'), 'altered')
      if (change === 'step-replacement') { await rename(f.journal.journalRoot + '.step-lock', f.journal.journalRoot + '.old-step'); await mkdir(f.journal.journalRoot + '.step-lock') }
      if (change === 'new-directory') await mkdir(join(f.targetRoot, 'docs'))
      if (change === 'foreign-resume') { await mkdir(f.journal.journalRoot + '.release-resume-lease'); await writeFile(join(f.journal.journalRoot + '.release-resume-lease', 'foreign'), 'kept') }
      if (change === 'symlink') { await rename(f.evidenceRoot, f.evidenceRoot + '.original'); await symlink(f.evidenceRoot + '.original', f.evidenceRoot) }
      await assert.rejects(resume(f))
      assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
      if (change === 'user') assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'external')
      if (change === 'foreign-resume') assert.equal(await readFile(join(f.journal.journalRoot + '.release-resume-lease', 'foreign'), 'utf8'), 'kept')
    })
})

test('an old completion cannot remove a subsequent transaction lock', async t => {
  const f = await fixture(t, 'rollback-original-lock-removed'), next = await acquirePublicSyncLock(f.prepared)
  const owner = await readFile(join(next.lockRoot, 'owner.json'))
  await assert.rejects(resume(f), /identity changed|Lock owner identity changed/)
  assert.deepEqual(await readFile(join(next.lockRoot, 'owner.json')), owner)
})

test('two concurrent recovery callers cannot both release the original executor', async t => {
  const f = await fixture(t, 'rollback-original-owner-removed'), plan = await inspectPublicSyncRollbackRelease(f.input)
  const outcomes = await Promise.allSettled([1, 2].map(() => resumePublicSyncRollbackRelease({ ...f.input,
    expectedPlanSha256: plan.planSha256, executorStopped: true })))
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await inspectPublicSyncRollbackRelease(f.input)).alreadyReleased, true)
})
