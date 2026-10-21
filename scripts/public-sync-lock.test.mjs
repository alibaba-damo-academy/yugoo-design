import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, access, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { acquirePublicSyncLock, verifyPublicSyncLock, releaseUnusedPublicSyncLock } from './public-sync-lock.mjs'

async function fixture(t, { initial = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'public lock '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  await writeFile(join(source, 'a.txt'), 'old')
  const commit = () => { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const policy = { version: 1, rules: [{ kind: 'file', path: 'a.txt', action: 'include', reason: 'fixture' }] }
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const targetRoot = join(root, 'target')
  if (!initial) {
    await cp(old.target, targetRoot, { recursive: true })
    await mkdir(join(targetRoot, '.git')); await writeFile(join(targetRoot, '.git/config'), 'opaque Git')
    await writeFile(join(targetRoot, 'user.txt'), 'unmanaged')
  }
  await writeFile(join(source, 'a.txt'), 'next')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'next') })
  const approvedPlan = await inspectPublicSync({ stageRoot: stage.target, targetRoot })
  const prepared = await preparePublicSync({ approvedPlan, preparationRoot: join(root, 'prepared') })
  return { root, targetRoot, prepared, stage }
}

test('lock verifies real prepared fences without modifying target, Git or unmanaged files', async t => {
  const f = await fixture(t), handle = await acquirePublicSyncLock(f.prepared)
  assert.equal((await verifyPublicSyncLock(handle)).applyAuthorized, false)
  const owner = JSON.parse(await readFile(join(handle.lockRoot, 'owner.json'), 'utf8'))
  assert.equal(owner.preparedSha256, f.prepared.preparedSha256)
  assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), 'old')
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'opaque Git')
  assert.equal(await readFile(join(f.targetRoot, 'user.txt'), 'utf8'), 'unmanaged')
  assert.equal((await releaseUnusedPublicSyncLock(handle)).released, true)
  await assert.rejects(access(handle.lockRoot), { code: 'ENOENT' })
})

test('concurrent acquisitions yield one owner and never steal even an aged lock', async t => {
  const f = await fixture(t)
  const results = await Promise.allSettled([acquirePublicSyncLock(f.prepared), acquirePublicSyncLock(f.prepared)])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'EEXIST')
  const handle = results.find(result => result.status === 'fulfilled').value
  const bytes = await readFile(join(handle.lockRoot, 'owner.json'))
  await utimes(handle.lockRoot, new Date(0), new Date(0))
  await utimes(join(handle.lockRoot, 'owner.json'), new Date(0), new Date(0))
  await assert.rejects(acquirePublicSyncLock(f.prepared), { code: 'EEXIST' })
  assert.deepEqual(await readFile(join(handle.lockRoot, 'owner.json')), bytes)
  await releaseUnusedPublicSyncLock(handle)
})

test('stale receipt and missing initial target never create a target', async t => {
  const f = await fixture(t, { initial: true }), handle = await acquirePublicSyncLock(f.prepared)
  await assert.rejects(access(f.targetRoot), { code: 'ENOENT' })
  await releaseUnusedPublicSyncLock(handle)
  await writeFile(join(f.stage.target, 'a.txt'), 'changed staged bytes')
  await assert.rejects(acquirePublicSyncLock(f.prepared), /Staged files differ/)
  await assert.rejects(access(handle.lockRoot), { code: 'ENOENT' })
  await assert.rejects(access(f.targetRoot), { code: 'ENOENT' })
})

test('tampered owner, wrong identity and unexpected journal prevent release with evidence retained', async t => {
  const f = await fixture(t), handle = await acquirePublicSyncLock(f.prepared)
  await assert.rejects(releaseUnusedPublicSyncLock({ ...handle, transactionId: 'wrong' }), /does not match/)
  const path = join(handle.lockRoot, 'owner.json'), bytes = await readFile(path)
  await writeFile(path, 'tampered')
  await assert.rejects(releaseUnusedPublicSyncLock(handle), /identity changed/)
  assert.equal(await readFile(path, 'utf8'), 'tampered')
  await writeFile(path, bytes)
  await writeFile(join(handle.lockRoot, 'journal.json'), 'recover before release')
  await assert.rejects(releaseUnusedPublicSyncLock(handle), /transaction or unexpected evidence/)
  assert.equal(await readFile(path, 'utf8'), bytes.toString('utf8'))
  assert.equal(await readFile(join(handle.lockRoot, 'journal.json'), 'utf8'), 'recover before release')
})

test('existing lock symlink is not followed or removed', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside')
  await mkdir(outside); await writeFile(join(outside, 'preserve'), 'outside evidence')
  const lock = join(f.root, '.target.yugoo-sync-lock'); await symlink(outside, lock)
  await assert.rejects(acquirePublicSyncLock(f.prepared), { code: 'EEXIST' })
  assert.equal(await readFile(join(outside, 'preserve'), 'utf8'), 'outside evidence')
})

test('real owner process interruption retains its lock and blocks a second exporter', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const module = new URL('./public-sync-lock.mjs', import.meta.url).href
  const code = `import {writeSync} from 'node:fs'; import {acquirePublicSyncLock} from ${JSON.stringify(module)};
    const handle=await acquirePublicSyncLock(${JSON.stringify(f.prepared)});
    writeSync(1,JSON.stringify(handle)); process.kill(process.pid,'SIGKILL');`
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }))
  })
  assert.equal(stderr, '')
  assert.equal(result.signal, 'SIGKILL')
  const handle = JSON.parse(stdout)
  assert.equal((await verifyPublicSyncLock(handle)).verified, true)
  await assert.rejects(acquirePublicSyncLock(f.prepared), { code: 'EEXIST' })
  assert.equal(await readFile(join(f.targetRoot, 'a.txt'), 'utf8'), 'old')
  await releaseUnusedPublicSyncLock(handle) // Explicit unused-lock release, never automatic takeover.
})
