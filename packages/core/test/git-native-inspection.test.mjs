import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeNativeGit } from '../src/git-native.ts'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-inspection-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, run: operation => executeNativeGit(root, operation) }
}

test('native init and fresh inspection work without any Git command', async t => {
  const { root, run } = await fixture(t)
  const initial = (await run({ kind: 'init' })).value
  assert.equal(initial.format, 'sha1')
  assert.equal(initial.head, undefined)
  assert.equal(initial.gitDir, join(root, '.git'))
  assert.equal(initial.indexPath, join(root, '.git', 'index'))
  assert.equal(initial.workdir, root)
  const stagingRoot = join(root, 'prepared')
  await mkdir(stagingRoot)
  const source = join(stagingRoot, 'bytes')
  await writeFile(source, 'baseline\n')
  const oid = createHash('sha1').update('blob 9\0baseline\n').digest('hex')
  const published = (await run({ kind: 'publish', message: 'initial', stagingRoot,
    files: [{ path: 'project.json', source, oid, mode: 0o100644 }] })).value
  assert.match(published.commit, /^[0-9a-f]{40}$/u)
  assert.equal((await run({ kind: 'inspect' })).value.head, published.commit)
  assert.equal((await run({ kind: 'ancestor', ancestor: published.commit, descendant: published.commit })).value.isAncestor, true)
  await assert.rejects(run({ kind: 'publish', message: 'stale initial', stagingRoot, files: [] }), /stale-publication/u)
  assert.equal((await run({ kind: 'inspect' })).value.head, published.commit)
})

async function stagedFixture(t) {
  const f = await fixture(t)
  await f.run({ kind: 'init' })
  const stagingRoot = join(f.root, 'prepared'), alias = join(f.root, 'prepared-alias')
  await mkdir(stagingRoot)
  await symlink(stagingRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const bytes = Buffer.from('{"saved":"exact staged bytes"}\n')
  await writeFile(join(stagingRoot, 'bytes'), bytes)
  const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  return { ...f, stagingRoot, alias, bytes, oid }
}

test('native publication accepts canonical staging directory aliases and retains exact bytes', async t => {
  const f = await stagedFixture(t)
  let expectedHead
  for (const [index, [stagingRoot, source]] of [
    [f.alias, join(f.alias, 'bytes')],
    [f.stagingRoot, join(f.alias, 'bytes')],
    [f.alias, join(f.stagingRoot, 'bytes')],
  ].entries()) {
    const path = `design_files/evidence-${index}.json`
    const published = (await f.run({ kind: 'publish', expectedHead, message: 'directory alias', stagingRoot,
      files: [{ path, source, oid: f.oid, mode: 0o100644 }] })).value
    assert.match(published.commit, /^[a-f0-9]{40}$/u)
    assert.equal((await f.run({ kind: 'inspect' })).value.head, published.commit)
    assert.equal((await f.run({ kind: 'entry', commit: published.commit, path })).value.entry.oid, f.oid)
    expectedHead = published.commit
  }
  const blob = await f.run({ kind: 'blob', oid: f.oid, size: f.bytes.length })
  assert.deepEqual(Buffer.from(blob.bytes), f.bytes)
})

test('native publication rejects a source outside the canonical staging directory, including a directory alias', async t => {
  const f = await stagedFixture(t)
  const outside = join(f.root, 'prepared-outside'), alias = join(f.root, 'outside-alias')
  await mkdir(outside)
  await writeFile(join(outside, 'bytes'), f.bytes)
  await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')
  for (const source of [join(outside, 'bytes'), join(alias, 'bytes')]) {
    await assert.rejects(f.run({ kind: 'publish', message: 'outside staging', stagingRoot: f.alias,
      files: [{ path: 'project.json', source, oid: f.oid, mode: 0o100644 }] }), /invalid-request/u)
    assert.equal((await f.run({ kind: 'head' })).value.head, undefined)
  }
})

test('native publication rejects file symlinks even when their parent resolves to the staging directory', async t => {
  const f = await stagedFixture(t)
  const outside = join(f.root, 'outside-bytes')
  await writeFile(outside, f.bytes)
  for (const [index, target] of [join(f.stagingRoot, 'bytes'), outside].entries()) {
    const name = `link-${index}`
    await symlink(target, join(f.stagingRoot, name), 'file')
    await assert.rejects(f.run({ kind: 'publish', message: 'file symlink', stagingRoot: f.stagingRoot,
      files: [{ path: 'project.json', source: join(f.alias, name), oid: f.oid, mode: 0o100644 }] }), /invalid-request/u)
    assert.equal((await f.run({ kind: 'head' })).value.head, undefined)
  }
})

test('native inspection never discovers an ancestor repository', async t => {
  const { root, run } = await fixture(t)
  await run({ kind: 'init' })
  const child = join(root, 'nested')
  await mkdir(child)
  await assert.rejects(executeNativeGit(child, { kind: 'inspect' }))
})

test('native status confines worktree changes while index cleanliness stays repository-wide', async t => {
  const { root, run } = await fixture(t)
  await run({ kind: 'init' })
  await mkdir(join(root, 'design_files'))
  await writeFile(join(root, 'design_files', 'draft.json'), '{}')
  await writeFile(join(root, 'outside.txt'), 'outside')
  const scoped = (await run({ kind: 'status', pathPrefix: 'design_files' })).value
  assert.deepEqual(scoped.paths, ['design_files/draft.json'])
  assert.equal(scoped.cleanWorktree, false)
  assert.equal(scoped.cleanIndex, true)
  assert.equal((await run({ kind: 'status', pathPrefix: 'absent' })).value.cleanWorktree, true)
})
