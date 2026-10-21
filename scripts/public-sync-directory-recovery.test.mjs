import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncDirectories, createPublicSyncDirectories } from './public-sync-directories.mjs'
import { executePublicSyncFileStep } from './public-sync-file-step.mjs'
import { inspectPublicSyncDirectoryRecovery } from './public-sync-directory-recovery.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'directory recovery ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(join(source, 'docs/deep'), { recursive: true })
  await writeFile(join(source, 'docs/deep/a.md'), 'fixed source')
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  git(['add', '-A']); git(['commit', '-qm', 'fixture'])
  const policy = { version: 1, rules: [{ kind: 'file', path: 'docs/deep/a.md', action: 'include', reason: 'fixture' }] }
  const stage = await stagePublicSnapshot({ source, revision: git(['rev-parse', 'HEAD']), policy, destination: join(root, 'stage') })
  const targetRoot = join(root, 'target')
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const journal = await createPublicSyncJournal({ lock: await acquirePublicSyncLock(prepared) })
  const plan = await inspectPublicSyncDirectories(journal), input = { ...journal, expectedPlanSha256: plan.planSha256 }
  return { root, targetRoot, journal, input, prepared }
}

test('durable intent before mkdir is classified absent without changing target or evidence', async t => {
  const f = await fixture(t)
  await assert.rejects(createPublicSyncDirectories({ ...f.input, onCheckpoint: event => { if (event.stage === 'directory-intent-durable') throw Error('stopped') } }), /stopped/)
  const path = join(f.journal.journalRoot + '.directory-lease', 'directories.jsonl'), before = await readFile(path)
  const result = await inspectPublicSyncDirectoryRecovery(f.input)
  assert.equal(result.pendingPath, ''); assert.equal(result.directories[0].state, 'intended-directory-absent')
  assert.deepEqual(result.directories.slice(1).map(item => item.state), ['not-created', 'not-created'])
  assert.equal(result.executorLivenessProven, false); assert.equal(result.directoryRemovalAuthorized, false)
  assert.equal(result.targetUpdated, false); assert.ok((await readFile(path)).equals(before))
})

test('mkdir before durable created result is unattributed, including user additions', async t => {
  const f = await fixture(t)
  await assert.rejects(createPublicSyncDirectories({ ...f.input, onCheckpoint: async event => {
    if (event.stage === 'directory-created') { await writeFile(join(f.targetRoot, 'user'), 'preserve'); throw Error('stopped') }
  } }), /stopped/)
  const result = await inspectPublicSyncDirectoryRecovery(f.input), root = result.directories[0]
  assert.equal(root.state, 'unrecorded-existing-directory'); assert.equal(root.creationRecorded, false)
  assert.equal(root.entryCount, 1); assert.equal(root.observedIdentity.mode, 0o755); assert.equal(root.removalAuthorized, false)
  assert.equal(result.directoryPhaseCompleted, false); assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'preserve')
})

test('completed directory ownership remains observable after file journal events, without authorizing cleanup', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  await executePublicSyncFileStep({ ...f.journal, expectedTailSha256: f.journal.headerSha256,
    operation: 'install', path: 'docs/deep/a.md', directoryPhase: { ...f.input, expectedTailSha256: created.tailSha256 } })
  const result = await inspectPublicSyncDirectoryRecovery(f.input)
  assert.equal(result.directoryPhaseCompleted, true)
  assert.ok(result.directories.every(item => item.state === 'created-recorded' && !item.removalAuthorized))
  assert.equal(result.directories[2].entryCount, 1); assert.equal(result.conflicts.length, 0)
  assert.equal(await readFile(join(f.targetRoot, 'docs/deep/a.md'), 'utf8'), 'fixed source')
})

test('changed mode/ancestor and incomplete tail are explicit conflicts or incomplete evidence, never repair', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  await chmod(join(f.targetRoot, 'docs'), 0o700)
  assert.equal((await inspectPublicSyncDirectoryRecovery(f.input)).conflicts.length, 1)
  await chmod(join(f.targetRoot, 'docs'), 0o755)
  const path = join(created.evidenceRoot, 'directories.jsonl'), original = await readFile(path)
  await writeFile(path, Buffer.concat([original, Buffer.from('{"partial":')]))
  const partial = await inspectPublicSyncDirectoryRecovery(f.input)
  assert.equal(partial.truncatedDirectoryTail, true); assert.equal(partial.directoryPhaseCompleted, false)
  await writeFile(path, original)
  await rmdir(join(f.targetRoot, 'docs/deep')); await symlink(f.root, join(f.targetRoot, 'docs/deep'))
  assert.equal((await inspectPublicSyncDirectoryRecovery(f.input)).directories[2].state, 'conflict')
})

test('wrong plan, corrupt chain and extra evidence refuse without rewriting preserved data', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input), path = join(created.evidenceRoot, 'directories.jsonl')
  await assert.rejects(inspectPublicSyncDirectoryRecovery({ ...f.input, expectedPlanSha256: '0'.repeat(64) }), /plan/)
  const original = await readFile(path), rows = original.toString().trim().split('\n').map(JSON.parse)
  rows[1].previousSha256 = '0'.repeat(64); await writeFile(path, rows.map(row => JSON.stringify(row) + '\n').join(''))
  await assert.rejects(inspectPublicSyncDirectoryRecovery(f.input)); await writeFile(path, original)
  await writeFile(join(created.evidenceRoot, 'unknown'), 'preserve')
  await assert.rejects(inspectPublicSyncDirectoryRecovery(f.input), /Unexpected/)
  assert.equal(await readFile(join(created.evidenceRoot, 'unknown'), 'utf8'), 'preserve')
  assert.ok((await readFile(path)).equals(original))
})
