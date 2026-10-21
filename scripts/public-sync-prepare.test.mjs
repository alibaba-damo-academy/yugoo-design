import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile, cp, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync, EXPORT_MANIFEST } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'

async function fixture(t, { prototypeFile = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'prepare public sync '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q'])
  git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(source, 'a.txt'), 'old managed')
  await writeFile(join(source, 'removed.txt'), 'old removed')
  if (prototypeFile) await writeFile(join(source, '__proto__'), 'old prototype file')
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: ['a.txt', 'removed.txt', 'new.txt'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  if (prototypeFile) policy.rules.push({ kind: 'file', path: '__proto__', action: 'include', reason: 'fixture' })
  const first = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'first') })
  const target = join(root, 'target'); await cp(first.target, target, { recursive: true })
  await mkdir(join(target, '.git')); await writeFile(join(target, '.git', 'config'), 'opaque Git contents')
  await writeFile(join(target, 'user.txt'), 'unmanaged content')
  await writeFile(join(source, 'a.txt'), 'new managed')
  if (prototypeFile) await writeFile(join(source, '__proto__'), 'new prototype file')
  await rm(join(source, 'removed.txt')); await writeFile(join(source, 'new.txt'), 'new addition')
  const next = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'next') })
  const approvedPlan = await inspectPublicSync({ stageRoot: next.target, targetRoot: target })
  return { root, target, next, approvedPlan }
}

test('preparation preserves target/Git and stores verified change/delete backups plus replacements', async t => {
  const f = await fixture(t)
  const oldMarker = await readFile(join(f.target, EXPORT_MANIFEST))
  const result = await preparePublicSync({ approvedPlan: f.approvedPlan, preparationRoot: join(f.root, 'prepared') })
  assert.equal(result.targetUpdated, false)
  assert.equal(result.record.applyImplemented, false)
  assert.deepEqual(result.record.writes, ['a.txt', 'new.txt'])
  assert.deepEqual(result.record.deletes, ['removed.txt'])
  assert.equal(await readFile(join(result.preparationRoot, 'previous/a.txt'), 'utf8'), 'old managed')
  assert.equal(await readFile(join(result.preparationRoot, 'previous/removed.txt'), 'utf8'), 'old removed')
  assert.equal(await readFile(join(result.preparationRoot, 'next/a.txt'), 'utf8'), 'new managed')
  assert.equal(await readFile(join(result.preparationRoot, 'next/new.txt'), 'utf8'), 'new addition')
  assert.equal(await readFile(join(f.target, 'a.txt'), 'utf8'), 'old managed')
  assert.equal(await readFile(join(f.target, 'user.txt'), 'utf8'), 'unmanaged content')
  assert.equal(await readFile(join(f.target, '.git/config'), 'utf8'), 'opaque Git contents')
  assert.deepEqual(await readFile(join(f.target, EXPORT_MANIFEST)), oldMarker)
  assert.deepEqual(JSON.parse(await readFile(join(result.preparationRoot, 'prepared.json'))), result.record)
  await assert.rejects(preparePublicSync({ approvedPlan: f.approvedPlan, preparationRoot: result.preparationRoot }), { code: 'EEXIST' })
})

test('stale approved target/stage fences refuse before preparing output', async t => {
  const f = await fixture(t)
  const destination = join(f.root, 'blocked')
  await writeFile(join(f.target, 'user.txt'), 'user changed after approval')
  await assert.rejects(preparePublicSync({ approvedPlan: f.approvedPlan, preparationRoot: destination }), /plan changed/)
  await assert.rejects(access(destination), { code: 'ENOENT' })
  await writeFile(join(f.target, 'user.txt'), 'unmanaged content')
  await writeFile(join(f.next.target, 'a.txt'), 'changed after stage')
  await assert.rejects(preparePublicSync({ approvedPlan: f.approvedPlan, preparationRoot: destination }), /Staged files differ/)
  await assert.rejects(access(destination), { code: 'ENOENT' })
})

test('preparation refuses overlapping outputs and inapplicable plans', async t => {
  const f = await fixture(t)
  for (const preparationRoot of [join(f.target, 'prepared'), join(f.next.target, 'prepared'), f.root]) {
    await assert.rejects(preparePublicSync({ approvedPlan: f.approvedPlan, preparationRoot }), /must not overlap/)
  }
  await assert.rejects(preparePublicSync({ approvedPlan: { ...f.approvedPlan, applicable: false }, preparationRoot: join(f.root, 'invalid') }), /accepted applicable/)
})

test('initial missing target stays absent while preparing complete new files and provenance', async t => {
  const f = await fixture(t)
  const target = join(f.root, 'missing public checkout')
  const approvedPlan = await inspectPublicSync({ stageRoot: f.next.target, targetRoot: target })
  const result = await preparePublicSync({ approvedPlan, preparationRoot: join(f.root, 'initial prep') })
  assert.equal(result.record.targetExists, false)
  assert.deepEqual(result.record.backups, {})
  assert.equal(result.record.previousManifest, null)
  await assert.rejects(access(target), { code: 'ENOENT' })
  assert.equal(await readFile(join(result.preparationRoot, 'next/a.txt'), 'utf8'), 'new managed')
})

test('prototype-named managed paths retain explicit backup/replacement identities', async t => {
  const f = await fixture(t, { prototypeFile: true })
  const result = await preparePublicSync({ approvedPlan: f.approvedPlan, preparationRoot: join(f.root, 'prototype prep') })
  for (const map of [result.record.backups, result.record.replacements]) {
    assert.equal(Object.hasOwn(map, '__proto__'), true)
    assert.equal(Object.getPrototypeOf(map), Object.prototype)
    assert.match(map.__proto__.sha256, /^[a-f0-9]{64}$/)
  }
  assert.equal(await readFile(join(result.preparationRoot, 'previous/__proto__'), 'utf8'), 'old prototype file')
  assert.equal(await readFile(join(f.target, '__proto__'), 'utf8'), 'old prototype file')
})
