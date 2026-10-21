import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { executeNativeGit } from '../src/git-native.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-inspection-'))
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
  const { createHash } = await import('node:crypto')
  const oid = createHash('sha1').update('blob 9\0baseline\n').digest('hex')
  const published = (await run({ kind: 'publish', message: 'initial', stagingRoot,
    files: [{ path: 'project.json', source, oid, mode: 0o100644 }] })).value
  assert.match(published.commit, /^[0-9a-f]{40}$/u)
  assert.equal((await run({ kind: 'inspect' })).value.head, published.commit)
  assert.equal((await run({ kind: 'ancestor', ancestor: published.commit, descendant: published.commit })).value.isAncestor, true)
  await assert.rejects(run({ kind: 'publish', message: 'stale initial', stagingRoot, files: [] }), /stale-publication/u)
  assert.equal((await run({ kind: 'inspect' })).value.head, published.commit)
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
