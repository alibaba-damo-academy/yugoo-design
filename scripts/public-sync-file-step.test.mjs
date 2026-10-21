import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync, EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'public file step '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['a.txt', 'gone.txt', 'new.txt'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await writeFile(join(source, 'a.txt'), 'old'); await writeFile(join(source, 'gone.txt'), 'gone original')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target'); await cp(old.target, targetRoot, { recursive: true })
  await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'opaque Git')
  await writeFile(join(targetRoot, 'user.txt'), 'unmanaged')
  await writeFile(join(source, 'a.txt'), 'next'); await rm(join(source, 'gone.txt')); await writeFile(join(source, 'new.txt'), 'added')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const step = async (operation, path) => executePublicSyncFileStep({ ...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256, operation, path })
  return { root, targetRoot, prepared, journal, step, stage }
}

test('actual install, addition and deletion are journaled; marker last preserves Git/unmanaged data', async t => {
  const f = await fixture(t), marker = await readFile(join(f.targetRoot, EXPORT_MANIFEST))
  await assert.rejects(f.step('install', EXPORT_MANIFEST), /installed last/)
  await f.step('install', 'a.txt'); await f.step('install', 'new.txt'); await f.step('remove', 'gone.txt')
  assert.deepEqual(await readFile(join(f.targetRoot, EXPORT_MANIFEST)), marker)
  assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), 'next')
  assert.equal(await readFile(join(f.targetRoot, 'new.txt'), 'utf8'), 'added')
  await assert.rejects(lstat(join(f.targetRoot, 'gone.txt')), { code: 'ENOENT' })
  const applied = await f.step('install', EXPORT_MANIFEST)
  assert.equal(applied.wholeSyncCompleted, false); assert.equal(applied.publicationReady, false)
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'opaque Git')
  assert.equal(await readFile(join(f.targetRoot, 'user.txt'), 'utf8'), 'unmanaged')
  const journal = await inspectPublicSyncJournal(f.journal)
  assert.equal(journal.events.length, 8); assert.equal(journal.pending, undefined)
  assert.equal((await inspectPublicSync({ stageRoot: f.stage.target, targetRoot: f.targetRoot })).writes.length, 0)
  const recovery = await inspectPublicSyncRecovery(f.journal)
  assert.equal(recovery.applicable, true); assert.equal(recovery.candidateActions.length, 4)
})

test('manual target drift and changed replacement refuse without overwriting and retain step evidence', async t => {
  for (const changed of ['target', 'replacement']) {
    const f = await fixture(t)
    await writeFile(changed === 'target' ? join(f.targetRoot, 'a.txt') : join(f.prepared.preparationRoot, 'next/a.txt'), 'external change')
    await assert.rejects(f.step('install', 'a.txt'), /changed/)
    assert.equal((await inspectPublicSyncJournal(f.journal)).events.length, 0)
    assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), changed === 'target' ? 'external change' : 'old')
    assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
    if (changed === 'target') {
      const recovery = await inspectPublicSyncRecovery(f.journal)
      assert.equal(recovery.fileStepLeasePresent, true); assert.equal(recovery.applicable, false)
    }
    await assert.rejects(f.step('install', 'a.txt'), { code: 'EEXIST' })
  }
})

test('concurrent steps have one winner and replay does not modify an applied file', async t => {
  const f = await fixture(t), tail = (await inspectPublicSyncJournal(f.journal)).tailSha256
  const input = { ...f.journal, expectedTailSha256: tail, operation: 'install', path: 'a.txt' }
  const outcomes = await Promise.allSettled([executePublicSyncFileStep(input), executePublicSyncFileStep(input)])
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1)
  await assert.rejects(f.step('install', 'a.txt'), /already has an intent/)
  assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), 'next')
  assert.equal((await inspectPublicSyncJournal(f.journal)).events.length, 2)
})

test('target symlinks and unprepared paths cannot escape the managed plan', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside')
  await writeFile(outside, 'preserved'); await rm(join(f.targetRoot, 'a.txt')); await symlink(outside, join(f.targetRoot, 'a.txt'))
  await assert.rejects(f.step('install', '../outside'), /not a prepared/)
  await assert.rejects(f.step('install', 'a.txt'), /symlink|regular/)
  assert.equal(await readFile(outside, 'utf8'), 'preserved')
  assert.equal((await inspectPublicSyncJournal(f.journal)).events.length, 0)
})

test('provenance refuses to certify a completed file subsequently edited externally', async t => {
  const f = await fixture(t), oldMarker = await readFile(join(f.targetRoot, EXPORT_MANIFEST))
  await f.step('install', 'a.txt'); await f.step('install', 'new.txt'); await f.step('remove', 'gone.txt')
  await writeFile(join(f.targetRoot, 'a.txt'), 'user changed after completed step')
  await assert.rejects(f.step('install', EXPORT_MANIFEST), /changed before provenance/)
  assert.deepEqual(await readFile(join(f.targetRoot, EXPORT_MANIFEST)), oldMarker)
  assert.equal((await inspectPublicSyncJournal(f.journal)).events.length, 6)
  assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), 'user changed after completed step')
})

test('real child SIGKILL before and after mutation preserves intent, lease and original backup', async t => {
  for (const stage of ['intent-durable', 'file-applied']) {
    const f = await fixture(t)
    const input = { ...f.journal, expectedTailSha256: (await inspectPublicSyncJournal(f.journal)).tailSha256, operation: 'install', path: 'a.txt' }
    const code = `import { executePublicSyncFileStep } from ${JSON.stringify(new URL('./public-sync-file-step.mjs', import.meta.url).href)};
      await executePublicSyncFileStep({ ...JSON.parse(process.env.STEP_FIXTURE_INPUT), onCheckpoint: async event => {
        if (event.stage === process.env.STEP_FIXTURE_STAGE) {
          process.send(event); await new Promise(() => { setInterval(() => {}, 1000) });
        }
      } });`
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, STEP_FIXTURE_INPUT: JSON.stringify(input), STEP_FIXTURE_STAGE: stage }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
    let diagnostic = ''; child.stderr.on('data', bytes => { diagnostic += bytes })
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Child checkpoint missing: ' + diagnostic)), 10000)
      child.once('message', event => { clearTimeout(timer); assert.equal(event.stage, stage); resolve() })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Child exited before checkpoint: ' + diagnostic)) })
    })
    child.kill('SIGKILL'); assert.equal((await exited).signal, 'SIGKILL')
    const journal = await inspectPublicSyncJournal(f.journal)
    assert.equal(journal.pending.path, 'a.txt'); assert.equal(journal.events.length, 1)
    assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), stage === 'intent-durable' ? 'old' : 'next')
    assert.equal(await readFile(join(f.prepared.preparationRoot, 'previous/a.txt'), 'utf8'), 'old')
    assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
    const recovery = await inspectPublicSyncRecovery(f.journal)
    assert.equal(recovery.applicable, false); assert.equal(recovery.fileStepLeasePresent, true)
    assert.equal(recovery.candidateActions.length, stage === 'intent-durable' ? 0 : 1)
    await assert.rejects(f.step('install', 'a.txt'), /Unresolved/)
  }
})
