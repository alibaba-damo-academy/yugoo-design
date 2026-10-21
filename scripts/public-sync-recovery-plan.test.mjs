import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { appendPublicSyncJournal, createPublicSyncJournal, inspectPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'public recovery plan '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['a.txt', 'removed.txt', 'new.txt'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await writeFile(join(source, 'a.txt'), 'old'); await writeFile(join(source, 'removed.txt'), 'preserved removed')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target'); await cp(old.target, targetRoot, { recursive: true })
  await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'Git preserved')
  await writeFile(join(targetRoot, 'user.txt'), 'user preserved')
  await writeFile(join(source, 'a.txt'), 'next'); await rm(join(source, 'removed.txt')); await writeFile(join(source, 'new.txt'), 'added')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const approvedPlan = await inspectPublicSync({ stageRoot: stage.target, targetRoot })
  const prepared = await preparePublicSync({ approvedPlan, preparationRoot: join(root, 'prepared') })
  const lock = await acquirePublicSyncLock(prepared), journal = await createPublicSyncJournal({ lock })
  return { root, targetRoot, prepared, lock, journal }
}
async function intent(f, operation, path) {
  const before = await inspectPublicSyncJournal(f.journal)
  return appendPublicSyncJournal({ ...f.journal, expectedTailSha256: before.tailSha256, event: { kind: 'intent', operation, path } })
}
async function result(f, state) {
  return appendPublicSyncJournal({ ...f.journal, expectedTailSha256: state.tailSha256, event: { kind: 'result', intentSequence: state.pending.sequence, outcome: 'completed' } })
}

test('unexecuted intent yields no recovery action; installed bytes yield only bounded original restore', async t => {
  const f = await fixture(t); await intent(f, 'install', 'a.txt')
  let plan = await inspectPublicSyncRecovery(f.journal)
  assert.equal(plan.applicable, true); assert.deepEqual(plan.candidateActions, [])
  await writeFile(join(f.targetRoot, 'a.txt'), 'next') // Fixture simulates crash after actual install, before result.
  plan = await inspectPublicSyncRecovery(f.journal)
  assert.deepEqual(plan.candidateActions.map(item => [item.path, item.action]), [['a.txt', 'restore-original']])
  assert.equal(plan.pending.path, 'a.txt'); assert.equal(plan.rollbackAuthorized, false)
  assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), 'next')
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git preserved')
  assert.equal(await readFile(join(f.targetRoot, 'user.txt'), 'utf8'), 'user preserved')
})

test('deleted originals and added files are classified without performing rollback', async t => {
  const f = await fixture(t)
  let state = await intent(f, 'remove', 'removed.txt'); await rm(join(f.targetRoot, 'removed.txt')); await result(f, state)
  state = await intent(f, 'install', 'new.txt'); await writeFile(join(f.targetRoot, 'new.txt'), 'added'); await result(f, state)
  const plan = await inspectPublicSyncRecovery(f.journal)
  assert.equal(plan.applicable, true)
  assert.deepEqual(plan.candidateActions.map(item => [item.path, item.action]), [['new.txt', 'remove-added'], ['removed.txt', 'restore-original']])
  assert.equal(plan.completeRollbackProven, false)
  assert.equal(await readFile(join(f.targetRoot, 'new.txt'), 'utf8'), 'added')
})

test('externally changed files or matching replacement without intent block recovery', async t => {
  const f = await fixture(t); await intent(f, 'install', 'a.txt')
  await writeFile(join(f.targetRoot, 'a.txt'), 'user edit after interruption')
  let plan = await inspectPublicSyncRecovery(f.journal)
  assert.equal(plan.applicable, false); assert.deepEqual(plan.candidateActions, [])
  assert.equal(plan.conflicts[0].reason, 'Target differs from both preserved outcomes')
  await writeFile(join(f.targetRoot, 'a.txt'), 'old'); await writeFile(join(f.targetRoot, 'new.txt'), 'added')
  plan = await inspectPublicSyncRecovery(f.journal)
  assert.equal(plan.applicable, false)
  assert.equal(plan.conflicts[0].reason, 'Target changed without a recorded intent')
  assert.equal(await readFile(join(f.targetRoot, 'new.txt'), 'utf8'), 'added')
})

test('backup byte changes and target symlinks are not followed or repaired', async t => {
  const f = await fixture(t); await intent(f, 'install', 'a.txt')
  await writeFile(join(f.prepared.preparationRoot, 'previous/a.txt'), 'changed backup')
  await assert.rejects(inspectPublicSyncRecovery(f.journal), /backup changed/)
  await writeFile(join(f.prepared.preparationRoot, 'previous/a.txt'), 'old')
  const outside = join(f.root, 'outside.txt'); await writeFile(outside, 'outside preserved')
  await rm(join(f.targetRoot, 'a.txt')); await symlink(outside, join(f.targetRoot, 'a.txt'))
  const plan = await inspectPublicSyncRecovery(f.journal)
  assert.equal(plan.applicable, false)
  assert.equal(await readFile(outside, 'utf8'), 'outside preserved')
})
