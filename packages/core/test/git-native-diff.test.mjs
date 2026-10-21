import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Repository } from 'yugoo-design-git-native'
import { nativeDiffCommit, nativeDiffBetween, nativeDiffSince } from '../src/git-native-diff.ts'

const execute = promisify(execFile)
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-native-diff-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = join(root, 'empty.gitconfig')
  await writeFile(config, '')
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@invalid',
    LC_ALL: 'C.UTF-8', GIT_OPTIONAL_LOCKS: '0' }
  const git = async argv => (await execute('git', argv, { cwd: root, env, encoding: 'utf8', maxBuffer: 2 << 20 })).stdout
  await git(['init', '--quiet'])
  // libgit2 has no find-similar method in this binding. These fixtures compare
  // unified content/mode changes rather than optional rename presentation.
  await git(['config', 'diff.renames', 'false'])
  const commit = async (files, parents = []) => {
    await git(['read-tree', '--empty'])
    for (const [path, bytes] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), bytes)
      await chmod(join(root, path), path.endsWith('.sh') ? 0o755 : 0o644)
      await git(['add', '--', `:(literal)${path}`])
    }
    const tree = (await git(['write-tree'])).trim()
    const id = (await git(['commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'fixture'])).trim()
    await git(['update-ref', 'HEAD', id])
    return id
  }
  const show = (id, path) => git(['show', '--format=', '--no-ext-diff', id, ...(path === undefined ? [] : ['--', `:(literal)${path}`])])
  const between = (a, b, path) => git(['diff', '--no-ext-diff', a, b, ...(path === undefined ? [] : ['--', `:(literal)${path}`])])
  return { root, git, commit, show, between, repo: () => new Repository(root) }
}

async function assertParentViews(f, merge, parents, prefix) {
  const actual = nativeDiffCommit(f.repo(), merge, prefix)
  const comparisons = await Promise.all(parents.map(parent => f.between(parent, merge, prefix)))
  if (comparisons.every(patch => patch === '')) {
    assert.equal(actual, '')
    return actual
  }
  const expected = parents.map((parent, index) =>
    `Merge parent ${index + 1}/${parents.length}: ${parent} -> ${merge}\n${comparisons[index] || '(No changes in the selected scope.)\n'}`).join('\n')
  assert.equal(actual, expected, 'every parent/result input has its own exact-ID label and accurate unified patch')
  return actual
}

test('native root and ordinary commit patches preserve text, empty files, binary, deletion and modes', async t => {
  const f = await fixture(t)
  const initial = { 'design_files/text.txt': 'one\ntwo\nthree\n', 'design_files/remove.txt': 'old\n',
    'design_files/raw.bin': Buffer.from([1, 0, 2]), 'design_files/empty': '', 'outside.txt': 'outside\n' }
  const a = await f.commit(initial)
  assert.equal(nativeDiffCommit(f.repo(), a), await f.show(a))
  const b = await f.commit({ 'design_files/text.txt': 'one\nchanged\nthree\n', 'design_files/raw.bin': Buffer.from([1, 0, 3]),
    'design_files/empty': '', 'design_files/tool.sh': '#!/bin/sh\necho ok\n', 'outside.txt': 'changed outside\n' }, [a])
  assert.equal(nativeDiffCommit(f.repo(), b), await f.show(b))
  assert.equal(nativeDiffBetween(f.repo(), a, b, 'design_files'), await f.between(a, b, 'design_files'))
  assert.equal(nativeDiffBetween(f.repo(), b, b), '')
  assert.equal(nativeDiffBetween(f.repo(), b, a), await f.between(b, a))
})

test('native literal child/subtree selection accepts filename metacharacters without widening scope', async t => {
  const f = await fixture(t)
  const paths = ['design_files/a[1].txt', 'design_files/a1.txt', 'design_files/*.txt', 'design_files/子目录/说明.txt',
    'design_files/with space.txt', 'design_files/quote".txt', 'design_files-other/leak.txt']
  const a = await f.commit(Object.fromEntries(paths.map(path => [path, 'before\n'])))
  const b = await f.commit(Object.fromEntries(paths.map(path => [path, 'after\n'])), [a])
  for (const path of paths.slice(0, -1)) {
    const child = path.slice('design_files/'.length)
    assert.equal(nativeDiffBetween(f.repo(), a, b, 'design_files', child), await f.between(a, b, path), path)
  }
  assert.equal(nativeDiffBetween(f.repo(), a, b, 'design_files', '子目录'), await f.between(a, b, 'design_files/子目录'))
  assert.equal(nativeDiffCommit(f.repo(), b, 'design_files'), await f.show(b, 'design_files'))
  assert.equal(nativeDiffBetween(f.repo(), a, b, 'missing'), '')
  for (const path of ['', '../x', '/tmp/x', '.git/config', 'x\\y', 'x\ny']) {
    assert.throws(() => nativeDiffBetween(f.repo(), a, b, 'design_files', path), /invalid-request/u)
  }
})

test('native since pins HEAD and selects explicit or first-parent baseline without worktree/index writes', async t => {
  const f = await fixture(t)
  const a = await f.commit({ 'design_files/a': 'a\n' })
  const b = await f.commit({ 'design_files/a': 'b\n' }, [a])
  const c = await f.commit({ 'design_files/a': 'c\n' }, [b])
  const index = await readFile(join(f.root, '.git/index'))
  await writeFile(join(f.root, 'design_files/a'), 'unpublished\n')
  assert.equal(nativeDiffSince(f.repo(), undefined, 'design_files'), await f.between(b, c, 'design_files'))
  assert.equal(nativeDiffSince(f.repo(), a), await f.between(a, c))
  assert.equal(nativeDiffSince(f.repo(), 'HEAD~2'), await f.between(a, c))
  assert.equal(nativeDiffSince(f.repo(), 'HEAD^1'), await f.between(b, c))
  assert.equal(nativeDiffSince(f.repo(), 'HEAD'), '')
  assert.deepEqual(await readFile(join(f.root, '.git/index')), index)
  assert.equal(await readFile(join(f.root, 'design_files/a'), 'utf8'), 'unpublished\n')
  assert.throws(() => nativeDiffBetween(f.repo(), '1'.repeat(40), c), /commit-not-found/u)
  assert.throws(() => nativeDiffCommit(f.repo(), '1'.repeat(64)), /unsupported-object-format/u)
})

test('native merge views label every exact parent/result and show their distinct changes', async t => {
  const f = await fixture(t)
  const a = await f.commit({ 'design_files/a': 'one\ntwo\nthree\nfour\nfive\n' })
  const b = await f.commit({ 'design_files/a': 'ONE\ntwo\nthree\nfour\nfive\n' }, [a])
  const c = await f.commit({ 'design_files/a': 'one\ntwo\nthree\nfour\nFIVE\n' }, [a])
  const merge = await f.commit({ 'design_files/a': 'ONE\ntwo\nthree\nfour\nFIVE\n' }, [b, c])
  const clean = await assertParentViews(f, merge, [b, c])
  assert.match(clean, /\+ONE/u)
  assert.match(clean, /\+FIVE/u)
  const novel = await f.commit({ 'design_files/a': 'new\ntwo\nthree\nfour\nFIVE\n' }, [b, c])
  await assertParentViews(f, novel, [b, c])
  await assertParentViews(f, novel, [b, c], 'missing')
  assert.equal(nativeDiffBetween(f.repo(), b, merge), await f.between(b, merge), 'two-tree comparison still uses ordinary unified diff')
  const inherited = await f.commit({ 'design_files/a': 'ONE\ntwo\nthree\nfour\nfive\n' }, [b, c])
  assert.match(await assertParentViews(f, inherited, [b, c]), /No changes in the selected scope/u)
})

test('native merge parent views preserve deletion, binary and octopus inputs', async t => {
  const f = await fixture(t)
  const a = await f.commit({ 'a': 'same\nA\n' })
  const b = await f.commit({ 'a': 'same\nB\n' })
  const c = await f.commit({ 'a': 'same\nC\n' })
  for (const files of [{ a: 'new\n' }, { a: '' }, { a: Buffer.from([0, 1, 2]) }, {}]) {
    const merge = await f.commit(files, [a, b, c])
    await assertParentViews(f, merge, [a, b, c])
  }
})

test('native merge parent patches retain separate hunk coordinates and final lines without newlines', async t => {
  const f = await fixture(t)
  const middle = Array.from({ length: 20 }, (_, index) => `context-${index}\n`).join('')
  const a = await f.commit({ a: `first-A\n${middle}last-A` })
  const b = await f.commit({ a: `first-B\n${middle}last-B` })
  const merge = await f.commit({ a: `first-result\n${middle}last-result` }, [a, b])
  await assertParentViews(f, merge, [a, b])
})

test('native merge parent mode-only patches preserve file metadata', async t => {
  const f = await fixture(t)
  const a = await f.commit({ a: 'same\n' })
  const b = await f.commit({ a: 'same\n' }, [a])
  await f.git(['update-index', '--chmod=+x', '--', 'a'])
  const tree = (await f.git(['write-tree'])).trim()
  const merge = (await f.git(['commit-tree', tree, '-p', a, '-p', b, '-m', 'executable resolution'])).trim()
  const patch = await assertParentViews(f, merge, [a, b])
  assert.match(patch, /old mode 100644\nnew mode 100755/u)
})

test('native diff calls work when no Git executable can be found', async t => {
  const f = await fixture(t)
  const a = await f.commit({ a: 'old\n' })
  const b = await f.commit({ a: 'new\n' }, [a])
  const expected = await f.show(b), repo = f.repo(), previous = process.env.PATH
  try {
    process.env.PATH = join(f.root, 'no-executables')
    assert.equal(nativeDiffCommit(repo, b), expected)
    assert.equal(nativeDiffBetween(repo, a, b), expected)
    assert.equal(nativeDiffSince(repo), expected)
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
  }
})

test('native merge parent views preserve the previously ambiguous inherited-deletion boundary', async t => {
  const f = await fixture(t)
  const a = await f.commit({ a: 'B\nA\n\nC\n' })
  const b = await f.commit({ a: 'A\n\nC\n' })
  const merge = await f.commit({ a: 'A\n\nC\nB\n' }, [a, b])
  await assertParentViews(f, merge, [a, b])
})

test('native merge parent views preserve repeated blank lines without hand-combined alignment', async t => {
  const f = await fixture(t)
  const a = await f.commit({ a: 'A\n\n' })
  const b = await f.commit({ a: 'C\n\nA\nB\n\nA\n\n' })
  const merge = await f.commit({ a: 'A\n' }, [a, b])
  await assertParentViews(f, merge, [a, b])
})
