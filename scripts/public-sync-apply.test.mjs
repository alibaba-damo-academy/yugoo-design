import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EXPORT_MANIFEST, inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { applyPreparedPublicSync } from './public-sync-apply.mjs'

async function fixture(t, initial = false) {
  const root = await mkdtemp(join(tmpdir(), 'prepared apply ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(join(source, 'docs'), { recursive: true })
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['docs/a', 'gone', 'deep/new'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await writeFile(join(source, 'docs/a'), 'old'); await writeFile(join(source, 'gone'), 'deleted original')
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target')
  if (!initial) { await cp(old.target, targetRoot, { recursive: true }); await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'Git untouched'); await writeFile(join(targetRoot, 'user'), 'user untouched') }
  await writeFile(join(source, 'docs/a'), 'new'); await rm(join(source, 'gone')); await mkdir(join(source, 'deep')); await writeFile(join(source, 'deep/new'), 'addition')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'stage') })
  const plan = await inspectPublicSync({ stageRoot: stage.target, targetRoot })
  const prepared = await preparePublicSync({ approvedPlan: plan, preparationRoot: join(root, 'prepared') })
  const input = { ...prepared, expectedStageManifestSha256: plan.stageManifestSha256, expectedTargetStateSha256: plan.targetStateSha256 }
  return { root, source, stage, targetRoot, input }
}

test('initial and existing targets complete through directory, files, provenance and verified lock release', async t => {
  for (const initial of [true, false]) {
    const f = await fixture(t, initial), result = await applyPreparedPublicSync(f.input)
    assert.equal(result.wholeSyncCompleted, true); assert.equal(result.lockReleased, true); assert.equal(result.publicationReady, false)
    assert.equal(await readFile(join(f.targetRoot, 'docs/a'), 'utf8'), 'new')
    assert.equal(await readFile(join(f.targetRoot, 'deep/new'), 'utf8'), 'addition')
    await assert.rejects(lstat(join(f.targetRoot, 'gone')), { code: 'ENOENT' })
    assert.ok((await readFile(join(f.targetRoot, EXPORT_MANIFEST))).equals(await readFile(join(f.stage.target, EXPORT_MANIFEST))))
    const rows = (await readFile(join(result.journalRoot, 'journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(rows.at(-2).path, EXPORT_MANIFEST); assert.equal(rows.at(-1).outcome, 'completed')
    if (!initial) { assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'Git untouched'); assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user untouched') }
  }
})

test('repeat with an equivalent prepared snapshot is a no-op without new locks or evidence', async t => {
  const f = await fixture(t); await applyPreparedPublicSync(f.input)
  const plan = await inspectPublicSync({ stageRoot: f.stage.target, targetRoot: f.targetRoot })
  const next = await preparePublicSync({ approvedPlan: plan, preparationRoot: join(f.root, 'next-prepared') })
  const before = (await readdir(f.root)).sort()
  const result = await applyPreparedPublicSync({ ...next, expectedStageManifestSha256: plan.stageManifestSha256, expectedTargetStateSha256: plan.targetStateSha256 })
  assert.equal(result.noChanges, true); assert.equal(result.targetUpdated, false)
  assert.deepEqual((await readdir(f.root)).sort(), before)
})

test('wrong approval fences fail before target changes or transaction creation', async t => {
  const f = await fixture(t, true), before = (await readdir(f.root)).sort()
  await assert.rejects(applyPreparedPublicSync({ ...f.input, expectedStageManifestSha256: '0'.repeat(64) }), /Accepted source differs/)
  assert.deepEqual((await readdir(f.root)).sort(), before)
  await assert.rejects(lstat(f.targetRoot), { code: 'ENOENT' })
})

test('mid-file failure preserves actual partial changes, unresolved intent, lock and original backup', async t => {
  const f = await fixture(t)
  await assert.rejects(applyPreparedPublicSync({ ...f.input, onCheckpoint: event => {
    if (event.stage === 'file-applied') throw Error('fixture interruption')
  } }), /fixture interruption/)
  const transaction = (await readdir(f.root)).find(name => name.startsWith('.target.yugoo-sync-') && !name.endsWith('lock') && !name.endsWith('lease'))
  const rows = (await readFile(join(f.root, transaction, 'journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(rows.at(-1).kind, 'intent'); assert.equal(await readFile(join(f.targetRoot, rows.at(-1).path), 'utf8'), 'addition')
  assert.ok((await lstat(join(f.root, '.target.yugoo-sync-lock'))).isDirectory())
  assert.equal(await readFile(join(f.input.preparationRoot, 'previous/docs/a'), 'utf8'), 'old')
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'user untouched')
})
