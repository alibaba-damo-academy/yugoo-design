import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EXPORT_MANIFEST, inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture(t, { initial = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sync receipt '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(source)
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  const files = ['nested/run.sh', 'deleted.txt', '__proto__']
  const policy = { version: 1, rules: [...files, 'added.txt'].map(path => ({ kind: 'file', path, action: 'include', reason: 'fixture' })) }
  await mkdir(join(source, 'nested'))
  for (const path of files) await writeFile(join(source, path), `old ${path}`)
  await chmod(join(source, 'nested/run.sh'), 0o755)
  function commit() { git(['add', '-A']); git(['commit', '-qm', 'fixture']); return git(['rev-parse', 'HEAD']) }
  const old = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'old') })
  const target = join(root, 'target')
  if (!initial) {
    await cp(old.target, target, { recursive: true })
    await mkdir(join(target, '.git')); await writeFile(join(target, '.git/config'), 'Git untouched')
    await writeFile(join(target, 'user.txt'), 'user untouched')
  }
  for (const path of ['nested/run.sh', '__proto__']) await writeFile(join(source, path), `new ${path}`)
  await rm(join(source, 'deleted.txt')); await writeFile(join(source, 'added.txt'), 'new addition')
  const stage = await stagePublicSnapshot({ source, revision: commit(), policy, destination: join(root, 'new') })
  const approvedPlan = await inspectPublicSync({ stageRoot: stage.target, targetRoot: target })
  const prepared = await preparePublicSync({ approvedPlan, preparationRoot: join(root, 'prepared') })
  return { root, target, stage, prepared, approvedPlan }
}
const verify = f => verifyPreparedPublicSync(f.prepared)

test('receipt verifies actual bytes, executable identities and prototype paths without target/Git writes', async t => {
  const f = await fixture(t)
  const before = await inspectPublicSync({ stageRoot: f.stage.target, targetRoot: f.target })
  const result = await verify(f)
  assert.equal(result.verified, true); assert.equal(result.targetUpdated, false); assert.equal(result.applyAuthorized, false)
  assert.equal(result.record.backups['nested/run.sh'].mode, '100755')
  assert.equal(result.record.replacements['nested/run.sh'].mode, '100755')
  assert.equal(Object.hasOwn(result.record.backups, '__proto__'), true)
  assert.deepEqual(await inspectPublicSync({ stageRoot: f.stage.target, targetRoot: f.target }), before)
  assert.equal(await readFile(join(f.target, '.git/config'), 'utf8'), 'Git untouched')
  assert.equal(await readFile(join(f.target, 'user.txt'), 'utf8'), 'user untouched')
})

test('receipt or replacement/backup/marker mutation fails closed', async t => {
  for (const [path, pattern] of [
    ['prepared.json', /receipt changed/], ['next/nested/run.sh', /replacement changed/],
    ['previous/deleted.txt', /backup changed/], ['next-manifest.json', /next marker changed/],
    ['previous-manifest.json', /previous marker changed/],
  ]) {
    await t.test(path, async t => {
      const f = await fixture(t)
      await writeFile(join(f.prepared.preparationRoot, path), 'tampered bytes')
      await assert.rejects(verify(f), pattern)
      assert.equal(await readFile(join(f.target, 'nested/run.sh'), 'utf8'), 'old nested/run.sh')
    })
  }
})

test('changed target and stage after preparation invalidate original fences', async t => {
  const f = await fixture(t)
  await writeFile(join(f.target, 'user.txt'), 'edited after preparation')
  await assert.rejects(verify(f), /inputs changed/)
  await writeFile(join(f.target, 'user.txt'), 'user untouched')
  await writeFile(join(f.stage.target, 'added.txt'), 'stage edited')
  await assert.rejects(verify(f), /Staged files differ/)
})

test('unrecognized files, directories and symlinks in preparation are rejected', async t => {
  for (const kind of ['file', 'directory', 'symlink']) {
    await t.test(kind, async t => {
      const f = await fixture(t), path = join(f.prepared.preparationRoot, 'unexpected')
      if (kind === 'file') await writeFile(path, 'extra')
      if (kind === 'directory') await mkdir(path)
      if (kind === 'symlink') await symlink(join(f.target, 'user.txt'), path)
      await assert.rejects(verify(f), /Unexpected preparation|symlink rejected/)
    })
  }
})

test('caller-provided receipt hash cannot broaden the actual re-derived plan', async t => {
  const f = await fixture(t)
  const path = join(f.prepared.preparationRoot, 'prepared.json')
  const record = JSON.parse(await readFile(path, 'utf8'))
  record.writes.push('user.txt')
  const bytes = Buffer.from(JSON.stringify(record))
  await writeFile(path, bytes)
  await assert.rejects(verifyPreparedPublicSync({ preparationRoot: f.prepared.preparationRoot, preparedSha256: digest(bytes) }), /writes differ/)
  assert.equal(await readFile(join(f.target, 'user.txt'), 'utf8'), 'user untouched')
})

test('initial missing target is still absent after receipt verification', async t => {
  const f = await fixture(t, { initial: true })
  const result = await verify(f)
  assert.equal(result.record.targetExists, false)
  assert.equal(result.record.previousManifest, null)
  await assert.rejects(access(f.target), { code: 'ENOENT' })
  await assert.rejects(access(join(f.prepared.preparationRoot, 'previous-manifest.json')), { code: 'ENOENT' })
  await assert.rejects(access(join(f.target, EXPORT_MANIFEST)), { code: 'ENOENT' })
})
