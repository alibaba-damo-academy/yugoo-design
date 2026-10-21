import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EXPORT_MANIFEST, inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncRollback, rollbackSettledPublicSync } from './public-sync-rollback.mjs'

async function fixture(t, complete = true) {
  const root = await mkdtemp(join(tmpdir(), 'settled rollback ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['a', 'gone', 'new'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await writeFile(join(source, 'a'), 'old'); await writeFile(join(source, 'gone'), 'deleted original')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target'); await cp(old.target, targetRoot, { recursive: true })
  await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'Git untouched'); await writeFile(join(targetRoot, 'user'), 'user untouched')
  await writeFile(join(source, 'a'), 'new'); await rm(join(source, 'gone')); await writeFile(join(source, 'new'), 'addition')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  const apply = async (operation, path, onCheckpoint) => executePublicSyncFileStep({ ...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256, operation, path, onCheckpoint })
  await apply('install', 'a')
  if (complete) { await apply('install', 'new'); await apply('remove', 'gone'); await apply('install', EXPORT_MANIFEST) }
  const input = { ...journal, expectedTailSha256: (await inspectPublicSyncJournal(journal)).tailSha256 }
  return { root, old, targetRoot, prepared, lock, journal, input, apply }
}

test('explicit settled rollback restores originals/deletions/marker and preserves Git, users, backups and lock', async t => {
  const f = await fixture(t), before = await readFile(join(f.journal.journalRoot, 'journal.jsonl'))
  const plan = await inspectPublicSyncRollback(f.input)
  assert.ok((await readFile(join(f.journal.journalRoot, 'journal.jsonl'))).equals(before))
  assert.equal(plan.actions.at(-1).path, EXPORT_MANIFEST)
  const result = await rollbackSettledPublicSync({ ...f.input, expectedPlanSha256: plan.planSha256 })
  assert.equal(result.managedFilesRestored, true); assert.equal(result.completeRollbackProven, false); assert.equal(result.lockReleased, false)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
  assert.equal(await readFile(join(f.targetRoot, 'gone'), 'utf8'), 'deleted original')
  await assert.rejects(lstat(join(f.targetRoot, 'new')), { code: 'ENOENT' })
  assert.ok((await readFile(join(f.targetRoot, EXPORT_MANIFEST))).equals(await readFile(join(f.old.target, EXPORT_MANIFEST))))
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git untouched')
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user untouched')
  assert.equal(await readFile(join(f.prepared.preparationRoot, 'previous/a'), 'utf8'), 'old')
  assert.ok((await lstat(f.lock.lockRoot)).isDirectory())
  const latest = await inspectPublicSyncJournal(f.journal)
  assert.equal(latest.events.at(-2).operation, 'restore'); assert.equal(latest.events.at(-2).path, EXPORT_MANIFEST)
  const nextInput = { ...f.journal, expectedTailSha256: latest.tailSha256 }
  const repeatPlan = await inspectPublicSyncRollback(nextInput), siblings = (await readdir(f.root)).sort()
  assert.equal((await rollbackSettledPublicSync({ ...nextInput, expectedPlanSha256: repeatPlan.planSha256 })).targetUpdated, false)
  assert.deepEqual((await readdir(f.root)).sort(), siblings)
  await writeFile(join(f.targetRoot, 'a'), 'new') // Matching next bytes cannot authorize a second restore.
  await assert.rejects(inspectPublicSyncRollback(nextInput), /already has a rollback intent/)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'new')
})

test('partly executed but settled transaction restores only applied managed files', async t => {
  const f = await fixture(t, false), plan = await inspectPublicSyncRollback(f.input)
  assert.deepEqual(plan.actions.map(action => action.path), ['a'])
  await rollbackSettledPublicSync({ ...f.input, expectedPlanSha256: plan.planSha256 })
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'old')
  assert.equal(await readFile(join(f.targetRoot, 'gone'), 'utf8'), 'deleted original')
})

test('wrong plan, external edits, changed backups and symlinks never authorize restoration', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncRollback(f.input)
  await assert.rejects(rollbackSettledPublicSync({ ...f.input, expectedPlanSha256: '0'.repeat(64) }), /plan changed/)
  await writeFile(join(f.targetRoot, 'a'), 'user edit')
  await assert.rejects(rollbackSettledPublicSync({ ...f.input, expectedPlanSha256: plan.planSha256 }), /content conflicts/)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'user edit')
  await writeFile(join(f.targetRoot, 'a'), 'new'); await writeFile(join(f.prepared.preparationRoot, 'previous/a'), 'tampered')
  await assert.rejects(inspectPublicSyncRollback(f.input), /backup changed/)
  await writeFile(join(f.prepared.preparationRoot, 'previous/a'), 'old')
  const outside = join(f.root, 'outside'); await writeFile(outside, 'outside untouched'); await rm(join(f.targetRoot, 'a')); await symlink(outside, join(f.targetRoot, 'a'))
  await assert.rejects(inspectPublicSyncRollback(f.input), /content conflicts/)
  assert.equal(await readFile(outside, 'utf8'), 'outside untouched')
})

test('pending/crashed executor is not stolen and rollback interruption preserves lease and intent', async t => {
  const f = await fixture(t, false)
  await assert.rejects(f.apply('install', 'new', event => { if (event.stage === 'intent-durable') throw Error('forward interruption') }), /forward interruption/)
  const current = await inspectPublicSyncJournal(f.journal)
  await assert.rejects(inspectPublicSyncRollback({ ...f.journal, expectedTailSha256: current.tailSha256 }), /settled journal/)
  assert.ok((await lstat(f.journal.journalRoot + '.step-lock')).isDirectory())
  const g = await fixture(t), plan = await inspectPublicSyncRollback(g.input)
  await assert.rejects(rollbackSettledPublicSync({ ...g.input, expectedPlanSha256: plan.planSha256,
    onCheckpoint: event => { if (event.stage === 'rollback-file-restored') throw Error('rollback interruption') } }), /rollback interruption/)
  const interrupted = await inspectPublicSyncJournal(g.journal)
  assert.equal(interrupted.pending.operation, 'restore'); assert.equal(interrupted.pending.path, 'a')
  assert.equal(await readFile(join(g.targetRoot, 'a'), 'utf8'), 'old')
  assert.ok((await lstat(g.journal.journalRoot + '.step-lock')).isDirectory())
  await assert.rejects(inspectPublicSyncRollback({ ...g.journal, expectedTailSha256: interrupted.tailSha256 }), /settled journal/)
})

test('concurrent rollback only permits one executor and checkpoint target edits remain intact', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncRollback(f.input)
  const settled = await Promise.allSettled([1, 2].map(() => rollbackSettledPublicSync({ ...f.input, expectedPlanSha256: plan.planSha256 })))
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1)
  const g = await fixture(t), next = await inspectPublicSyncRollback(g.input)
  await assert.rejects(rollbackSettledPublicSync({ ...g.input, expectedPlanSha256: next.planSha256, onCheckpoint: async event => {
    if (event.stage === 'rollback-intent-durable') await writeFile(join(g.targetRoot, event.path), 'external edit')
  } }), /Target changed before restoration/)
  assert.equal(await readFile(join(g.targetRoot, 'a'), 'utf8'), 'external edit')
})

test('stale tail, existing settled lease and backup change after intent remain fail-closed', async t => {
  const f = await fixture(t), plan = await inspectPublicSyncRollback(f.input)
  await assert.rejects(inspectPublicSyncRollback({ ...f.input, expectedTailSha256: '0'.repeat(64) }), /settled journal/)
  await mkdir(f.journal.journalRoot + '.step-lock')
  await assert.rejects(inspectPublicSyncRollback(f.input), /executor lease/)
  assert.equal(await readFile(join(f.targetRoot, 'a'), 'utf8'), 'new')
  const g = await fixture(t), next = await inspectPublicSyncRollback(g.input)
  await assert.rejects(rollbackSettledPublicSync({ ...g.input, expectedPlanSha256: next.planSha256, onCheckpoint: async event => {
    if (event.stage === 'rollback-intent-durable') await writeFile(join(g.prepared.preparationRoot, 'previous/a'), 'changed after intent')
  } }), /backup changed after intent/)
  assert.equal(await readFile(join(g.targetRoot, 'a'), 'utf8'), 'new')
  assert.ok((await lstat(g.journal.journalRoot + '.step-lock')).isDirectory())
  assert.equal(plan.lockReleaseAuthorized, false)
})
