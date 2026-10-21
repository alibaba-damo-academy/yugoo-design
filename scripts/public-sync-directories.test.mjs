import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, rmdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { stagePublicSnapshot, inspectPublicSync } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'
import { acquirePublicSyncLock } from './public-sync-lock.mjs'
import { createPublicSyncJournal } from './public-sync-journal.mjs'
import { inspectPublicSyncDirectories, createPublicSyncDirectories, verifyPublicSyncDirectoryPhase } from './public-sync-directories.mjs'

async function fixture(t, existing = false) {
  const root = await mkdtemp(join(tmpdir(), 'public directory phase ')); t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'); await mkdir(join(source, 'docs/deep'), { recursive: true })
  await writeFile(join(source, 'docs/deep/a.md'), 'fixed source')
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git(['init', '-q']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'commit.gpgsign', 'false'])
  git(['add', '-A']); git(['commit', '-qm', 'fixture'])
  const policy = { version: 1, rules: [{ kind: 'file', path: 'docs/deep/a.md', action: 'include', reason: 'fixture' }] }
  const stage = await stagePublicSnapshot({ source, revision: git(['rev-parse', 'HEAD']), policy, destination: join(root, 'stage') })
  const targetRoot = join(root, 'target')
  if (existing) { await mkdir(join(targetRoot, '.git'), { recursive: true }); await writeFile(join(targetRoot, '.git/config'), 'opaque'); await writeFile(join(targetRoot, 'user'), 'untouched') }
  const prepared = await preparePublicSync({ approvedPlan: await inspectPublicSync({ stageRoot: stage.target, targetRoot }), preparationRoot: join(root, 'prepared') })
  const journal = await createPublicSyncJournal({ lock: await acquirePublicSyncLock(prepared) })
  const plan = await inspectPublicSyncDirectories(journal)
  const input = { ...journal, expectedPlanSha256: plan.planSha256 }
  return { root, targetRoot, plan, input, prepared }
}

test('first export creates exactly the planned root and parents, but no design files', async t => {
  const f = await fixture(t)
  assert.deepEqual(f.plan.directories.map(d => [d.path, d.before]), [['', null], ['docs', null], ['docs/deep', null]])
  const result = await createPublicSyncDirectories(f.input)
  assert.deepEqual(result.createdDirectories, ['', 'docs', 'docs/deep'])
  assert.equal(result.wholeSyncCompleted, false); assert.equal(result.directoryRemovalAuthorized, false)
  assert.deepEqual(await readdir(join(f.targetRoot, 'docs/deep')), [])
  const rows = (await readFile(join(result.evidenceRoot, 'directories.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(rows.map(row => row.kind), ['directory-phase-header', 'directory-intent', 'directory-created', 'directory-intent', 'directory-created', 'directory-intent', 'directory-created', 'directory-phase-completed'])
})

test('new directory permissions are exactly 0755 under permissive and restrictive child umasks', async t => {
  for (const mask of [0o000, 0o077]) {
    const f = await fixture(t)
    const script = `import { createPublicSyncDirectories, verifyPublicSyncDirectoryPhase } from ${JSON.stringify(new URL('./public-sync-directories.mjs', import.meta.url).href)};
      process.umask(Number(process.argv[1]));
      const input = JSON.parse(process.argv[2]);
      const created = await createPublicSyncDirectories(input);
      const verified = await verifyPublicSyncDirectoryPhase({...input, expectedTailSha256:created.tailSha256});
      console.log(JSON.stringify(verified.identities));`
    const identities = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, String(mask), JSON.stringify(f.input)], { encoding: 'utf8' }))
    assert.deepEqual(identities.map(entry => entry.identity.mode), [0o755, 0o755, 0o755])
    for (const path of ['', 'docs', 'docs/deep']) assert.equal((await lstat(join(f.targetRoot, path))).mode & 0o777, 0o755)
  }
})

test('existing directory permissions are preserved and later permission drift rejects verification', async t => {
  const f = await fixture(t, true)
  await chmod(f.targetRoot, 0o750)
  const plan = await inspectPublicSyncDirectories(f.input), input = { ...f.input, expectedPlanSha256: plan.planSha256 }
  const created = await createPublicSyncDirectories(input)
  assert.equal((await lstat(f.targetRoot)).mode & 0o777, 0o750)
  const verifyInput = { ...input, expectedTailSha256: created.tailSha256 }
  assert.equal((await verifyPublicSyncDirectoryPhase(verifyInput)).verified, true)
  await chmod(join(f.targetRoot, 'docs'), 0o700)
  await assert.rejects(verifyPublicSyncDirectoryPhase(verifyInput), /identity changed/)
  assert.equal((await lstat(join(f.targetRoot, 'docs'))).mode & 0o777, 0o700)
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'untouched')
})

test('created directory cannot be blessed by rehashing a matching permissive identity record', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  const evidence = join(created.evidenceRoot, 'directories.jsonl')
  const rows = (await readFile(evidence, 'utf8')).trim().split('\n').map(JSON.parse)
  await chmod(join(f.targetRoot, 'docs'), 0o777)
  rows.find(row => row.kind === 'directory-created' && row.path === 'docs').identity.mode = 0o777
  // Supply a consistent chain and accepted tail so only the permission contract
  // can reject this record; a stale hash or disk/record mismatch is not enough.
  let previousSha256
  const lines = rows.map((row, index) => {
    if (index) row.previousSha256 = previousSha256
    const line = JSON.stringify(row) + '\n'
    previousSha256 = createHash('sha256').update(line).digest('hex')
    return line
  })
  await writeFile(evidence, lines.join(''))
  await assert.rejects(verifyPublicSyncDirectoryPhase({ ...f.input, expectedTailSha256: previousSha256 }), /Created directory permissions differ/)
  assert.equal((await lstat(join(f.targetRoot, 'docs'))).mode & 0o777, 0o777)
  assert.equal(await readFile(evidence, 'utf8'), lines.join(''))
})

test('pre-existing directory permission drift is rejected and restoration remains verifiable', async t => {
  const f = await fixture(t, true)
  await chmod(f.targetRoot, 0o750)
  const plan = await inspectPublicSyncDirectories(f.input)
  const input = { ...f.input, expectedPlanSha256: plan.planSha256 }
  const created = await createPublicSyncDirectories(input)
  const verification = { ...input, expectedTailSha256: created.tailSha256 }
  await chmod(f.targetRoot, 0o700)
  await assert.rejects(verifyPublicSyncDirectoryPhase(verification), /Directory identity changed/)
  await chmod(f.targetRoot, 0o750)
  assert.equal((await verifyPublicSyncDirectoryPhase(verification)).verified, true)
})

test('existing target Git and unmanaged files are never moved or rewritten', async t => {
  const f = await fixture(t, true), result = await createPublicSyncDirectories(f.input)
  assert.deepEqual(result.createdDirectories, ['docs', 'docs/deep'])
  assert.equal(await readFile(join(f.targetRoot, '.git/config'), 'utf8'), 'opaque')
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'untouched')
  await assert.rejects(createPublicSyncDirectories(f.input), /plan changed/)
})

test('changed directory state and symlink conflicts block before creating an evidence phase', async t => {
  const f = await fixture(t, true)
  await mkdir(join(f.targetRoot, 'docs'))
  await assert.rejects(createPublicSyncDirectories(f.input), /plan changed/)
  await rmdir(join(f.targetRoot, 'docs')); await symlink(f.root, join(f.targetRoot, 'docs'))
  await assert.rejects(createPublicSyncDirectories(f.input), /symlink|canonical/)
  assert.ok(!(await readdir(f.root)).some(name => name.endsWith('.directory-lease')))
})

test('failure after mkdir preserves unresolved directory intent and never removes external additions', async t => {
  const f = await fixture(t)
  await assert.rejects(createPublicSyncDirectories({ ...f.input, onCheckpoint: async event => {
    if (event.stage === 'directory-created') { await writeFile(join(f.targetRoot, 'user-after-create'), 'preserved'); throw Error('fixture interruption') }
  } }), /fixture interruption/)
  assert.equal(await readFile(join(f.targetRoot, 'user-after-create'), 'utf8'), 'preserved')
  const rows = (await readFile(join(f.plan.journalRoot + '.directory-lease', 'directories.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.deepEqual(rows.map(row => row.kind), ['directory-phase-header', 'directory-intent'])
  await assert.rejects(createPublicSyncDirectories(f.input), /changed/)
})

test('an ancestor replaced by a symlink after durable intent is not followed', async t => {
  const f = await fixture(t, true), outside = join(f.root, 'outside')
  await mkdir(outside)
  await assert.rejects(createPublicSyncDirectories({ ...f.input, onCheckpoint: async event => {
    if (event.stage === 'directory-intent-durable' && event.path === 'docs/deep') {
      await rmdir(join(f.targetRoot, 'docs')); await symlink(outside, join(f.targetRoot, 'docs'))
    }
  } }), /ancestor changed/)
  assert.deepEqual(await readdir(outside), [])
  assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'untouched')
})

test('completed directory evidence is verified without relaxing original receipt or writing files', async t => {
  for (const existing of [false, true]) {
    const f = await fixture(t, existing), created = await createPublicSyncDirectories(f.input)
    const result = await verifyPublicSyncDirectoryPhase({ ...f.input, expectedTailSha256: created.tailSha256 })
    assert.equal(result.verified, true); assert.equal(result.scope, 'completed-directory-phase-only')
    assert.equal(result.applyAuthorized, false); assert.equal(result.directoryRemovalAuthorized, false)
    assert.equal(result.targetUpdated, false)
    assert.deepEqual(result.identities.map(entry => entry.path), ['', 'docs', 'docs/deep'])
    assert.deepEqual(await readdir(join(f.targetRoot, 'docs/deep')), [])
    if (existing) assert.equal(await readFile(join(f.targetRoot, 'user'), 'utf8'), 'untouched')
  }
})

test('directory evidence rejects foreign approvals, tampering, truncation and extra evidence', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  const input = { ...f.input, expectedTailSha256: created.tailSha256 }, path = join(created.evidenceRoot, 'directories.jsonl')
  const original = await readFile(path)
  await assert.rejects(verifyPublicSyncDirectoryPhase({ ...input, expectedPlanSha256: '0'.repeat(64) }))
  await assert.rejects(verifyPublicSyncDirectoryPhase({ ...input, expectedTailSha256: '0'.repeat(64) }), /tail changed/)
  await writeFile(path, original.subarray(0, -1))
  await assert.rejects(verifyPublicSyncDirectoryPhase(input), /truncated/)
  const rows = original.toString().trim().split('\n').map(JSON.parse)
  rows[2].identity.ino += 1
  await writeFile(path, rows.map(row => JSON.stringify(row) + '\n').join(''))
  await assert.rejects(verifyPublicSyncDirectoryPhase(input), /identity changed/)
  await writeFile(path, original)
  await writeFile(join(created.evidenceRoot, 'unknown'), 'preserved')
  await assert.rejects(verifyPublicSyncDirectoryPhase(input), /Unexpected directory evidence/)
  assert.equal(await readFile(join(created.evidenceRoot, 'unknown'), 'utf8'), 'preserved')
})

test('directory verification refuses unresolved intents and leaves all partial evidence intact', async t => {
  const f = await fixture(t)
  await assert.rejects(createPublicSyncDirectories({ ...f.input, onCheckpoint: event => {
    if (event.stage === 'directory-created') throw Error('interrupted fixture')
  } }), /interrupted fixture/)
  const path = join(f.plan.journalRoot + '.directory-lease', 'directories.jsonl'), before = await readFile(path)
  await assert.rejects(verifyPublicSyncDirectoryPhase({ ...f.input, expectedTailSha256: '0'.repeat(64) }), /creation result missing/)
  assert.ok((await readFile(path)).equals(before))
})

test('directory verification rejects external target files and changed directory ancestors', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  const input = { ...f.input, expectedTailSha256: created.tailSha256 }
  await writeFile(join(f.targetRoot, 'external'), 'preserved')
  await assert.rejects(verifyPublicSyncDirectoryPhase(input), /Non-directory sync inputs changed/)
  assert.equal(await readFile(join(f.targetRoot, 'external'), 'utf8'), 'preserved')
  const g = await fixture(t), second = await createPublicSyncDirectories(g.input), outside = join(g.root, 'outside')
  await mkdir(outside); await rmdir(join(g.targetRoot, 'docs/deep')); await symlink(outside, join(g.targetRoot, 'docs/deep'))
  await assert.rejects(verifyPublicSyncDirectoryPhase({ ...g.input, expectedTailSha256: second.tailSha256 }), /canonical/)
  assert.deepEqual(await readdir(outside), [])
})

test('initial directory bridge verifies the complete original preparation, not a fake approval', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  await assert.rejects(verifyPreparedPublicSync(f.prepared), /inputs changed/)
  const directoryPhase = { ...f.input, expectedTailSha256: created.tailSha256 }
  const verified = await verifyPreparedPublicSync({ ...f.prepared, directoryPhase })
  assert.equal(verified.verified, true); assert.equal(verified.directoryPhaseVerified, true)
  assert.equal(verified.record.targetExists, false); assert.equal(verified.applyAuthorized, false)
  await assert.rejects(verifyPreparedPublicSync({ ...f.prepared, directoryPhase: { verified: true } }))
  await writeFile(join(f.prepared.preparationRoot, 'next/docs/deep/a.md'), 'tampered replacement')
  await assert.rejects(verifyPreparedPublicSync({ ...f.prepared, directoryPhase }), /replacement changed/)
  assert.deepEqual(await readdir(join(f.targetRoot, 'docs/deep')), [])
})

test('directory bridge is tied to this preparation and cannot bless external file changes', async t => {
  const f = await fixture(t), created = await createPublicSyncDirectories(f.input)
  const g = await fixture(t), other = await createPublicSyncDirectories(g.input)
  await assert.rejects(verifyPreparedPublicSync({ ...f.prepared,
    directoryPhase: { ...g.input, expectedTailSha256: other.tailSha256 } }), /preparation differs/)
  await writeFile(join(f.targetRoot, 'external'), 'preserved')
  await assert.rejects(verifyPreparedPublicSync({ ...f.prepared,
    directoryPhase: { ...f.input, expectedTailSha256: created.tailSha256 } }), /Non-directory sync inputs changed/)
  assert.equal(await readFile(join(f.targetRoot, 'external'), 'utf8'), 'preserved')
})
