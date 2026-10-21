import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

async function fixture(t, existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'rollback completion ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(join(source, 'docs'), { recursive: true }); await writeFile(join(source, 'docs/a'), 'source')
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false']); git(['add', '-A']); git(['commit', '-qm', 'fixture'])
  const policy = { version: 1, rules: [{ kind: 'file', path: 'docs/a', action: 'include', reason: 'fixture' }] }
  const stage = await stagePublicSnapshot({ source, revision: git(['rev-parse', 'HEAD']), policy, destination: join(root, 'stage') }), targetRoot = join(root, 'target')
  if (existing) { await mkdir(join(targetRoot, '.git'), { recursive: true }); await writeFile(join(targetRoot, '.git/config'), 'Git kept'); await writeFile(join(targetRoot, 'user'), 'user kept') }
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock }), directory = await inspectPublicSyncDirectories(journal)
  const input = { ...journal, expectedTailSha256: journal.headerSha256, expectedDirectoryPlanSha256: directory.planSha256 }
  await createPublicSyncDirectories({ ...journal, expectedPlanSha256: directory.planSha256 })
  const cleanup = async () => {
    const plan = await inspectPublicSyncDirectoryRollback({ ...input, expectedPlanSha256: directory.planSha256 })
    await rollbackRecordedPublicSyncDirectories({ ...input, expectedPlanSha256: plan.planSha256 })
  }
  return { root, targetRoot, prepared, lock, journal, input, cleanup }
}

test('verified rollback completion releases only its original lock and retains backups/journal/Git/user data', async t => {
  for (const existing of [false, true]) {
    const f = await fixture(t, existing)
    await assert.rejects(inspectPublicSyncRollbackCompletion(f.input), /inputs changed|not been removed/)
    await f.cleanup()
    const plan = await inspectPublicSyncRollbackCompletion(f.input), result = await finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256 })
    assert.equal(result.originalStateRestored, true); assert.equal(result.lockReleased, true); assert.equal(result.publicationReady, false)
    await assert.rejects(lstat(f.lock.lockRoot), { code: 'ENOENT' }); await assert.rejects(lstat(f.journal.journalRoot + '.step-lock'), { code: 'ENOENT' })
    assert.ok((await lstat(f.journal.journalRoot)).isDirectory()); assert.ok((await lstat(f.prepared.preparationRoot)).isDirectory())
    if (existing) { assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept'); assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept') }
    else await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' })
    const next = await acquirePublicSyncLock(f.prepared)
    await assert.rejects(finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256 }))
    assert.ok((await lstat(next.lockRoot)).isDirectory())
  }
})

test('wrong approval and post-receipt target/evidence edits cannot release the original lock', async t => {
  const first = await fixture(t, true); await first.cleanup()
  const initial = await inspectPublicSyncRollbackCompletion(first.input)
  await assert.rejects(finalizePublicSyncRollback({ ...first.input, expectedPlanSha256: '0'.repeat(64) }), /plan changed/)
  assert.ok((await lstat(first.lock.lockRoot)).isDirectory())
  for (const edit of ['target', 'receipt', 'unexpected-release']) {
    const f = await fixture(t, true); await f.cleanup(); const plan = await inspectPublicSyncRollbackCompletion(f.input)
    await assert.rejects(finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256,
      onCheckpoint: async event => {
        if (edit === 'target') await writeFile(join(f.targetRoot, 'user'), 'external edit')
        else if (edit === 'receipt') await writeFile(join(event.evidenceRoot, 'completed.json'), '{}')
        else await writeFile(join(event.evidenceRoot, 'released.json'), 'unexpected evidence')
      } }))
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory()); assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
    if (edit === 'target') assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'external edit')
  }
})

test('concurrent finalizers have one winner; interrupted completion keeps owned evidence for recovery', async t => {
  const f = await fixture(t); await f.cleanup(); const plan = await inspectPublicSyncRollbackCompletion(f.input)
  const outcomes = await Promise.allSettled([1, 2].map(() => finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256 })))
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1)
  const g = await fixture(t); await g.cleanup(); const next = await inspectPublicSyncRollbackCompletion(g.input)
  await assert.rejects(finalizePublicSyncRollback({ ...g.input, expectedPlanSha256: next.planSha256,
    onCheckpoint: () => { throw Error('owned interruption') } }), /owned interruption/)
  assert.ok((await lstat(g.lock.lockRoot)).isDirectory())
  assert.equal(JSON.parse(await readFile(join(g.journal.journalRoot + '.rollback-completion-lease', 'completed.json'))).lockReleased, false)
})

test('durable completion anchor pins actual journal and original executor/directory identities', async t => {
  const f = await fixture(t, true); await f.cleanup()
  const plan = await inspectPublicSyncRollbackCompletion(f.input)
  let anchor
  await assert.rejects(finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256,
    onCheckpoint: async event => {
      const record = JSON.parse(await readFile(join(event.evidenceRoot, 'completed.json')))
      anchor = record.recoveryAnchor
      const evidence = await lstat(event.evidenceRoot), step = await lstat(f.journal.journalRoot + '.step-lock')
      assert.deepEqual(anchor.completionRootIdentity, { dev: evidence.dev, ino: evidence.ino })
      assert.deepEqual(anchor.stepLeaseIdentity, { dev: step.dev, ino: step.ino })
      assert.equal(anchor.journalSha256, createHash('sha256').update(await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).digest('hex'))
      const original = await lstat(f.targetRoot)
      assert.deepEqual(anchor.restoredDirectories, [
        { path: '', creationRecorded: false, originalIdentity: { dev: original.dev, ino: original.ino, mode: original.mode & 0o777 } },
        { path: 'docs', creationRecorded: true, originalIdentity: null },
      ])
      throw Error('stop after durable anchor')
    } }), /stop after durable anchor/)
  assert.equal(anchor.kind, 'rollback-release-recovery-anchor')
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
})

test('each lock release boundary retains a durable anchor and its actual half-release state', async t => {
  for (const stage of ['rollback-original-owner-removed', 'rollback-original-lock-removed', 'rollback-release-receipt-durable']) {
    await t.test(stage, async t => {
      const f = await fixture(t, true); await f.cleanup()
      const plan = await inspectPublicSyncRollbackCompletion(f.input)
      await assert.rejects(finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256,
        onCheckpoint: event => { if (event.stage === stage) throw Error('release boundary interruption') } }), /release boundary interruption/)
      const root = f.journal.journalRoot + '.rollback-completion-lease'
      const record = JSON.parse(await readFile(join(root, 'completed.json')))
      assert.equal(record.recoveryAnchor.kind, 'rollback-release-recovery-anchor')
      await assert.rejects(lstat(join(f.lock.lockRoot, 'owner.json')), { code: 'ENOENT' })
      if (stage === 'rollback-original-owner-removed') assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
      else await assert.rejects(lstat(f.lock.lockRoot), { code: 'ENOENT' })
      if (stage === 'rollback-release-receipt-durable') assert.equal(JSON.parse(await readFile(join(root, 'released.json'))).lockReleased, true)
      else await assert.rejects(lstat(join(root, 'released.json')), { code: 'ENOENT' })
      assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
      assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
      assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
    })
  }
})

test('unexpected evidence after owner removal prevents deleting the original lock directory', async t => {
  const f = await fixture(t, true); await f.cleanup()
  const plan = await inspectPublicSyncRollbackCompletion(f.input)
  await assert.rejects(finalizePublicSyncRollback({ ...f.input, expectedPlanSha256: plan.planSha256,
    onCheckpoint: async event => {
      if (event.stage === 'rollback-original-owner-removed') await writeFile(join(f.lock.lockRoot, 'external-note'), 'preserve')
    } }), /Unexpected original lock evidence/)
  assert.equal(await readFile(join(f.lock.lockRoot, 'external-note'), 'utf8'), 'preserve')
  assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
})
