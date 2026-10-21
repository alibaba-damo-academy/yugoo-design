import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync, EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncDirectories, createPublicSyncDirectories } from './public-sync-directories.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncRollback, rollbackSettledPublicSync } from './public-sync-rollback.mjs'
import { inspectPublicSyncDirectoryRollback, rollbackRecordedPublicSyncDirectories,
  inspectStoppedPublicSyncDirectoryRollback, resumeStoppedPublicSyncDirectoryRollback } from './public-sync-directory-rollback.mjs'
import { inspectPublicSyncRollbackCompletion } from './public-sync-rollback-completion.mjs'

async function fixture(t, existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'directory rollback ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['a', 'docs/deep/new'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await writeFile(join(source, 'a'), 'old')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target')
  if (existing) {
    await cp(old.target, targetRoot, { recursive: true }); await mkdir(join(targetRoot, '.git'))
    await writeFile(join(targetRoot, '.git/config'), 'Git kept'); await writeFile(join(targetRoot, 'user'), 'user kept')
  }
  await writeFile(join(source, 'a'), 'next'); await mkdir(join(source, 'docs/deep'), { recursive: true }); await writeFile(join(source, 'docs/deep/new'), 'new')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const directory = await inspectPublicSyncDirectories(journal), created = await createPublicSyncDirectories({ ...journal, expectedPlanSha256: directory.planSha256 })
  const input = { ...journal, expectedPlanSha256: directory.planSha256, expectedTailSha256: journal.headerSha256 }
  const run = plan => rollbackRecordedPublicSyncDirectories({ ...journal, expectedTailSha256: input.expectedTailSha256,
    expectedDirectoryPlanSha256: directory.planSha256, expectedPlanSha256: plan.planSha256 })
  return { root, targetRoot, journal, input, created, directory, prepared, lock, run }
}

test('recorded empty directory rollback restores initial target existence and preserves existing Git/user content', async t => {
  for (const existing of [false, true]) {
    const f = await fixture(t, existing), plan = await inspectPublicSyncDirectoryRollback(f.input), result = await f.run(plan)
    assert.equal(result.targetFilesAndDirectoriesRestored, true); assert.equal(result.lockReleased, false)
    assert.deepEqual(result.removedPaths, existing ? ['docs/deep', 'docs'] : ['docs/deep', 'docs', ''])
    if (existing) {
      assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
      assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
      assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
    } else await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' })
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
    assert.ok((await lstat(f.prepared.preparationRoot)).isDirectory())
    const rows = (await readFile(join(result.evidenceRoot, 'rollback.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(rows.at(-1).kind, 'directory-rollback-completed')
  }
})

test('files must first be restored; completed file rollback then permits recorded directory cleanup', async t => {
  const f = await fixture(t, true)
  let tail = f.journal.headerSha256
  for (const path of ['a', 'docs/deep/new', EXPORT_MANIFEST]) {
    const result = await executePublicSyncFileStep({ ...f.journal, expectedTailSha256: tail, operation: 'install', path,
      directoryPhase: tail === f.journal.headerSha256 ? { ...f.journal, expectedPlanSha256: f.directory.planSha256, expectedTailSha256: f.created.tailSha256 } : undefined })
    tail = result.tailSha256
  }
  f.input.expectedTailSha256 = tail
  await assert.rejects(inspectPublicSyncDirectoryRollback(f.input), /files must be restored/)
  const filePlan = await inspectPublicSyncRollback({ ...f.journal, expectedTailSha256: tail })
  await rollbackSettledPublicSync({ ...f.journal, expectedTailSha256: tail, expectedPlanSha256: filePlan.planSha256 })
  f.input.expectedTailSha256 = (await inspectPublicSyncJournal(f.journal)).tailSha256
  await f.run(await inspectPublicSyncDirectoryRollback(f.input))
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
  await assert.rejects(lstat(join(f.targetRoot, 'docs')), { code: 'ENOENT' })
})

test('unowned contents and wrong approval cannot be removed', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncDirectoryRollback(f.input)
  await assert.rejects(f.run({ ...plan, planSha256: '0'.repeat(64) }), /plan changed/)
  await mkdir(join(f.targetRoot, 'docs/deep/user-directory'))
  await assert.rejects(inspectPublicSyncDirectoryRollback(f.input), /unowned content/)
  assert.ok((await lstat(join(f.targetRoot, 'docs/deep/user-directory'))).isDirectory())
})

test('post-intent user edits and altered cleanup evidence stop removal with preserved evidence', async t => {
  for (const edit of ['user-file', 'empty-child', 'log']) {
    const f = await fixture(t), plan = await inspectPublicSyncDirectoryRollback(f.input)
    await assert.rejects(rollbackRecordedPublicSyncDirectories({ ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
      expectedDirectoryPlanSha256: f.directory.planSha256, expectedPlanSha256: plan.planSha256,
      onCheckpoint: async event => {
        if (event.stage === 'directory-removal-intent-durable') {
          if (edit === 'user-file') await writeFile(join(f.targetRoot, 'docs/deep/user'), 'keep')
          else if (edit === 'empty-child') await mkdir(join(f.targetRoot, 'docs/deep/user-directory'))
          else await writeFile(join(event.evidenceRoot, 'rollback.jsonl'), '{}')
        }
      } }), edit === 'user-file' ? /Original whole-target files changed/
      : edit === 'empty-child' ? /Directory is no longer empty after intent/
      : /Directory rollback log (?:bytes )?changed/)
    assert.ok((await lstat(join(f.targetRoot, 'docs/deep'))).isDirectory())
    if (edit === 'user-file') assert.equal(await readFile(join(f.targetRoot, 'docs/deep/user'), 'utf8'), 'keep')
    if (edit === 'empty-child') assert.ok((await lstat(join(f.targetRoot, 'docs/deep/user-directory'))).isDirectory())
  }
})

test('cleanup interruption preserves removed-directory intent and remaining directories, not a false success', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncDirectoryRollback(f.input)
  await assert.rejects(rollbackRecordedPublicSyncDirectories({ ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
    expectedDirectoryPlanSha256: f.directory.planSha256, expectedPlanSha256: plan.planSha256,
    onCheckpoint: event => { if (event.stage === 'directory-removed') throw Error('cleanup stopped') } }), /cleanup stopped/)
  await assert.rejects(lstat(join(f.targetRoot, 'docs/deep')), { code: 'ENOENT' })
  assert.ok((await lstat(join(f.targetRoot, 'docs'))).isDirectory())
  const rows = (await readFile(join(f.journal.journalRoot + '.directory-rollback-lease', 'rollback.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(rows.at(-1).kind, 'directory-removal-intent')
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  const log = join(f.journal.journalRoot + '.directory-rollback-lease', 'rollback.jsonl')
  const before = await readFile(log)
  await assert.rejects(f.run(plan), /Another executor prevents directory rollback/)
  assert.deepEqual(await readFile(log), before)
  assert.ok((await lstat(join(f.targetRoot, 'docs'))).isDirectory())
})

test('same-mode directory replacement after durable intent is refused by identity, preserving replacement', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncDirectoryRollback(f.input)
  const originalPath = join(f.targetRoot, 'docs/deep'), twinPath = join(f.root, 'replacement')
  const original = await lstat(originalPath)
  await mkdir(twinPath, { mode: original.mode & 0o777 })
  const twin = await lstat(twinPath)
  assert.notEqual(twin.ino, original.ino, 'Twin exists concurrently, so cannot reuse the original inode')
  await assert.rejects(rollbackRecordedPublicSyncDirectories({ ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
    expectedDirectoryPlanSha256: f.directory.planSha256, expectedPlanSha256: plan.planSha256,
    onCheckpoint: async event => {
      if (event.stage === 'directory-removal-intent-durable' && event.path === 'docs/deep') {
        await rmdir(originalPath)
        await rename(twinPath, originalPath)
      }
    } }), /Directory identity changed after removal intent/)
  assert.equal((await lstat(originalPath)).ino, twin.ino)
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})

test('recreated empty target prevents completed rollback evidence', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncDirectoryRollback(f.input)
  await assert.rejects(rollbackRecordedPublicSyncDirectories({ ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
    expectedDirectoryPlanSha256: f.directory.planSha256, expectedPlanSha256: plan.planSha256,
    onCheckpoint: async event => {
      if (event.stage === 'directory-removed' && event.path === '') await mkdir(f.targetRoot)
    } }), /Original target existence was not restored/)
  const rows = (await readFile(join(f.journal.journalRoot + '.directory-rollback-lease', 'rollback.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(rows.some(row => row.kind === 'directory-rollback-completed'), false)
  assert.ok((await lstat(f.targetRoot)).isDirectory())
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})

test('directory cleanup excludes concurrent and forward executors with the shared step lease', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncDirectoryRollback(f.input)
  const outcomes = await Promise.allSettled([f.run(plan), f.run(plan)])
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1)
  const g = await fixture(t), next = await inspectPublicSyncDirectoryRollback(g.input)
  await mkdir(g.journal.journalRoot + '.step-lock')
  await assert.rejects(g.run(next), /Another executor/)
  assert.ok((await lstat(join(g.targetRoot, 'docs/deep'))).isDirectory())
  const h = await fixture(t), last = await inspectPublicSyncDirectoryRollback(h.input)
  await assert.rejects(rollbackRecordedPublicSyncDirectories({ ...h.journal, expectedTailSha256: h.input.expectedTailSha256,
    expectedDirectoryPlanSha256: h.directory.planSha256, expectedPlanSha256: last.planSha256,
    onCheckpoint: async event => {
      if (event.stage === 'directory-removal-intent-durable') {
        await assert.rejects(executePublicSyncFileStep({ ...h.journal, expectedTailSha256: h.input.expectedTailSha256, operation: 'install', path: 'a' }), /EEXIST/)
        throw Error('paused cleanup')
      }
    } }), /paused cleanup/)
  assert.ok((await lstat(h.journal.journalRoot + '.step-lock')).isDirectory())
})

async function interruptedCleanup(t, stage = 'directory-removal-intent-durable', existing = true) {
  const f = await fixture(t, existing), plan = await inspectPublicSyncDirectoryRollback(f.input)
  await assert.rejects(rollbackRecordedPublicSyncDirectories({ ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
    expectedDirectoryPlanSha256: f.directory.planSha256, expectedPlanSha256: plan.planSha256,
    onCheckpoint: event => { if (event.stage === stage) throw Error('explicitly stopped fixture') } }), /explicitly stopped fixture/)
  const input = { ...f.journal, expectedTailSha256: f.input.expectedTailSha256, expectedDirectoryPlanSha256: f.directory.planSha256 }
  const root = f.journal.journalRoot + '.directory-rollback-lease', logPath = join(root, 'rollback.jsonl')
  const resumePlan = await inspectStoppedPublicSyncDirectoryRollback(input)
  return { ...f, resumeInput: input, resumePlan, cleanupRoot: root, logPath,
    resume: (approved = resumePlan, onCheckpoint) => resumeStoppedPublicSyncDirectoryRollback({ ...input,
      expectedPlanSha256: approved.planSha256, executorStoppedAcknowledged: true, onCheckpoint }) }
}
function directoryCli(f, command, extra = []) {
  const result = execFileSync(process.execPath, [fileURLToPath(new URL('./public-export-recovery.mjs', import.meta.url)), command,
    '--journal', f.journal.journalRoot, '--header-sha256', f.journal.headerSha256,
    '--tail-sha256', f.resumeInput.expectedTailSha256, '--directory-plan-sha256', f.directory.planSha256, ...extra],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return JSON.parse(result)
}

test('actual SIGKILL during directory cleanup resumes through CLI and preserves original evidence', { timeout: 30000 }, async t => {
  for (const stage of ['directory-removal-intent-durable', 'directory-removed']) {
    const f = await fixture(t, true), plan = await inspectPublicSyncDirectoryRollback(f.input)
    const input = { ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
      expectedDirectoryPlanSha256: f.directory.planSha256, expectedPlanSha256: plan.planSha256 }
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { rollbackRecordedPublicSyncDirectories } from ${JSON.stringify(new URL('./public-sync-directory-rollback.mjs', import.meta.url).href)};
      process.on('message', async input => {
        try {
          await rollbackRecordedPublicSyncDirectories({ ...input, onCheckpoint: async event => {
            if (event.stage === ${JSON.stringify(stage)}) {
              process.send({ stage: event.stage });
              await new Promise(() => {});
            }
          }});
          process.exit(2);
        } catch { process.exit(3); }
      });
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
    const checkpoint = once(child, 'message'), terminal = once(child, 'exit')
    child.send(input)
    const [event] = await checkpoint
    assert.equal(event.stage, stage)
    assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
    child.kill('SIGKILL')
    const [code, signal] = await terminal
    assert.equal(code, null); assert.equal(signal, 'SIGKILL')
    f.resumeInput = { ...f.journal, expectedTailSha256: f.input.expectedTailSha256,
      expectedDirectoryPlanSha256: f.directory.planSha256 }
    const logPath = join(f.journal.journalRoot + '.directory-rollback-lease', 'rollback.jsonl')
    const before = await readFile(logPath), backup = await readFile(join(f.prepared.preparationRoot, 'previous/a'))
    assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
    const approval = directoryCli(f, 'inspect-directory-rollback-resume')
    const result = directoryCli(f, 'resume-directory-rollback', ['--plan-sha256', approval.planSha256, '--executor-stopped', 'yes'])
    assert.equal(result.targetFilesAndDirectoriesRestored, true)
    assert.equal(result.stepLeaseReleased, true); assert.equal(result.lockReleased, false); assert.equal(result.publicationReady, false)
    assert.ok((await readFile(logPath)).subarray(0, before.length).equals(before))
    assert.deepEqual(await readFile(join(f.prepared.preparationRoot, 'previous/a')), backup)
    assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
    assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
    assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
    await assert.rejects(lstat(join(f.targetRoot, 'docs')), { code: 'ENOENT' })
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
    const completed = directoryCli(f, 'inspect-directory-rollback-resume')
    assert.equal(completed.completed, true); assert.equal(completed.stepLeasePresent, false)
    const retained = await readFile(logPath)
    const repeated = directoryCli(f, 'resume-directory-rollback', ['--plan-sha256', completed.planSha256, '--executor-stopped', 'yes'])
    assert.equal(repeated.alreadyCompleted, true); assert.equal(repeated.targetUpdated, false)
    assert.deepEqual(await readFile(logPath), retained)
  }
})

test('stopped directory cleanup resumes both durable hook boundaries through the actual CLI and leaves finalize usable', async t => {
  for (const existing of [false, true]) for (const stage of ['directory-removal-intent-durable', 'directory-removed']) {
    const f = await interruptedCleanup(t, stage, existing)
    const oldLog = await readFile(f.logPath), oldRoot = await lstat(f.cleanupRoot)
    const creationPath = join(f.journal.journalRoot + '.directory-lease', 'directories.jsonl'), creation = await readFile(creationPath)
    const backup = existing ? await readFile(join(f.prepared.preparationRoot, 'previous/a')) : undefined
    const approval = directoryCli(f, 'inspect-directory-rollback-resume')
    assert.equal(approval.planSha256, f.resumePlan.planSha256)
    const result = directoryCli(f, 'resume-directory-rollback', ['--plan-sha256', approval.planSha256, '--executor-stopped', 'yes'])
    assert.equal(result.stepLeaseReleased, true); assert.equal(result.lockReleased, false); assert.equal(result.publicationReady, false)
    assert.equal(result.targetFilesAndDirectoriesRestored, true)
    assert.deepEqual(result.recordedAbsentPaths, stage === 'directory-removed' ? ['docs/deep'] : [])
    assert.ok((await readFile(f.logPath)).subarray(0, oldLog.length).equals(oldLog), 'Immutable original log prefix remains')
    assert.equal((await lstat(f.cleanupRoot)).ino, oldRoot.ino)
    assert.deepEqual(await readFile(creationPath), creation)
    await assert.rejects(lstat(f.journal.journalRoot + '.step-lock'), { code: 'ENOENT' })
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
    assert.ok((await lstat(f.prepared.preparationRoot)).isDirectory())
    if (existing) {
      assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
      assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
      assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
      assert.deepEqual(await readFile(join(f.prepared.preparationRoot, 'previous/a')), backup)
    } else await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' })
    const final = await inspectPublicSyncRollbackCompletion(f.resumeInput)
    assert.equal(final.lockReleaseAuthorized, false); assert.equal(final.publicationReady, false)
    const completed = directoryCli(f, 'inspect-directory-rollback-resume')
    assert.equal(completed.completed, true); assert.equal(completed.stepLeasePresent, false)
  }
})

test('stopped directory cleanup completed-log release can resume and then confirms read-only', async t => {
  const f = await interruptedCleanup(t)
  await assert.rejects(f.resume(f.resumePlan, event => {
    if (event.stage === 'directory-resume-completed-durable') throw Error('stopped before step release')
  }), /stopped before step release/)
  const completed = await inspectStoppedPublicSyncDirectoryRollback(f.resumeInput)
  assert.equal(completed.completed, true); assert.equal(completed.stepLeasePresent, true)
  const result = await f.resume(completed)
  assert.equal(result.stepLeaseReleased, true); assert.deepEqual(result.removedPaths, [])
  assert.equal(result.lockReleased, false); assert.equal(result.publicationReady, false)
  const log = await readFile(f.logPath), confirmed = await inspectStoppedPublicSyncDirectoryRollback(f.resumeInput)
  const confirmation = await f.resume(confirmed)
  assert.equal(confirmation.alreadyCompleted, true); assert.equal(confirmation.targetUpdated, false)
  assert.equal(confirmation.stepLeaseReleased, false); assert.equal(confirmation.lockReleased, false)
  assert.deepEqual(await readFile(f.logPath), log)
  assert.equal((await inspectStoppedPublicSyncDirectoryRollback(f.resumeInput)).claimGeneration, 2)
})

test('stopped directory cleanup same approved plan has one generation winner', async t => {
  const f = await interruptedCleanup(t)
  const results = await Promise.allSettled([f.resume(), f.resume()])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  const final = await inspectStoppedPublicSyncDirectoryRollback(f.resumeInput)
  assert.equal(final.claimGeneration, 1); assert.equal(final.completed, true)
  assert.equal(final.stepLeasePresent, false)
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
})

test('stopped directory cleanup refuses old unanchored logs, truncation, changed identities and user content without deletion', async t => {
  for (const change of ['legacy', 'truncated', 'step', 'log', 'directory', 'user']) {
    const f = await interruptedCleanup(t)
    await assert.rejects(f.resume({ planSha256: '0'.repeat(64) }), /approval changed/)
    await assert.rejects(resumeStoppedPublicSyncDirectoryRollback({ ...f.resumeInput,
      expectedPlanSha256: f.resumePlan.planSha256, executorStoppedAcknowledged: false }), /explicitly stopped/)
    if (change === 'legacy') {
      const rows = (await readFile(f.logPath, 'utf8')).trimEnd().split('\n'), header = JSON.parse(rows[0])
      delete header.recoveryAnchor; rows[0] = JSON.stringify(header)
      await writeFile(f.logPath, rows.join('\n') + '\n')
    } else if (change === 'truncated') {
      const bytes = await readFile(f.logPath); await writeFile(f.logPath, bytes.subarray(0, -1))
    } else if (change === 'step') {
      await rename(f.journal.journalRoot + '.step-lock', join(f.root, 'retained-old-step'))
      await mkdir(f.journal.journalRoot + '.step-lock', { mode: 0o700 })
    } else if (change === 'log') {
      const bytes = await readFile(f.logPath)
      await rename(f.logPath, join(f.root, 'retained-old-log'))
      await writeFile(f.logPath, bytes, { mode: 0o600 })
    } else if (change === 'directory') {
      await rename(join(f.targetRoot, 'docs/deep'), join(f.root, 'retained-old-directory'))
      await mkdir(join(f.targetRoot, 'docs/deep'), { mode: 0o755 })
    } else await writeFile(join(f.targetRoot, 'docs/deep/user'), 'keep')
    const before = await readFile(f.logPath), directory = await lstat(join(f.targetRoot, 'docs/deep'))
    await assert.rejects(f.resume())
    assert.deepEqual(await readFile(f.logPath), before)
    assert.equal((await lstat(join(f.targetRoot, 'docs/deep'))).ino, directory.ino)
    assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git kept')
    assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user kept')
    assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
    if (change === 'user') assert.equal(await readFile(join(f.targetRoot, 'docs/deep/user'), 'utf8'), 'keep')
  }
  const f = await interruptedCleanup(t), log = await readFile(f.logPath)
  await assert.rejects(f.resume(f.resumePlan, async event => {
    if (event.stage === 'directory-resume-claimed') {
      await rename(f.journal.journalRoot + '.step-lock', join(f.root, 'old-step-after-claim'))
      await mkdir(f.journal.journalRoot + '.step-lock', { mode: 0o700 })
    }
  }), /Anchored step lease replaced/)
  assert.deepEqual(await readFile(f.logPath), log)
  assert.ok((await lstat(join(f.targetRoot, 'docs/deep'))).isDirectory())
  assert.ok((await lstat(f.cleanupRoot + '.resume-generation-1.json')).isFile(), 'Failed claimed attempt retains its evidence')
})
