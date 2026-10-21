import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitVersioning } from '../src/git.ts'
import { executeNativeGit } from '../src/git-native.ts'
import { nodeDesignProjectSpawn } from '../src/design-project.ts'

const execute = promisify(execFile)

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-library-route-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const operations = []
  const spawn = Object.assign(async () => { assert.fail('native product path launched external Git') }, {
    native: async request => {
      operations.push(request.operation.kind)
      return executeNativeGit(root, request.operation, request.signal)
    },
  })
  const git = new GitVersioning(spawn, root, 'design_files', false, 'native')
  await git.ensureRepo()
  await mkdir(join(root, 'design_files'), { recursive: true })
  const write = async (text, message) => {
    await writeFile(join(root, 'design_files', 'state.json'), text)
    return git.commitExactReceipt(message, new Map([['state.json', text]]), await git.head())
  }
  return { root, git, operations, write, spawn }
}

test('native facade publishes from unborn HEAD, reads history/diff/status and maintains index with zero Git commands', async t => {
  const f = await fixture(t)
  assert.equal(await f.git.head(), undefined)
  const first = await f.write('{"value":1}\n', 'initial checkpoint')
  assert.equal(first.indexMaintenance, undefined)
  const second = await f.write('{"value":2}\n', 'second checkpoint marker')
  assert.equal(second.indexMaintenance, undefined)
  assert.equal(await f.git.objectFormat(), 'sha1')
  assert.equal(await f.git.latestCommitWithMessage(second.commit, 'checkpoint marker'), second.commit)
  assert.equal(await f.git.commitMessageAt(second.commit), 'second checkpoint marker\n\n')
  assert.equal(await f.git.isAncestor(first.commit, second.commit), true)
  assert.equal(await f.git.isAncestor(second.commit, first.commit), false)
  assert.equal((await f.git.history(2, 'state.json')).length, 2)
  assert.match(await f.git.diffCommit(second.commit), /\+\{"value":2\}/u)
  assert.equal(await f.git.diffBetween(first.commit, second.commit), await f.git.diffSince(first.commit))
  assert.deepEqual(await f.git.listWorkingPaths(), ['state.json'])
  await f.git.assertCleanIndex()
  await f.git.assertCleanWorktree()
  const entries = await f.git.listEntriesAt(second.commit, undefined, 2 << 20)
  assert.deepEqual(entries.map(({ path, mode, type }) => ({ path, mode, type })), [{ path: 'state.json', mode: 0o100644, type: 'blob' }])
  assert.ok(f.operations.includes('index-update'))
})

test('unsupported ordinary index stays byte-exact while native publication returns an explicit deferred receipt', async t => {
  const f = await fixture(t)
  await f.write('{}\n', 'baseline')
  const path = join(f.root, '.git', 'index')
  const bytes = await readFile(path)
  const body = Buffer.concat([bytes.subarray(0, -20), Buffer.from('XUSR'), Buffer.alloc(4)])
  const opaque = Buffer.concat([body, createHash('sha1').update(body).digest()])
  await writeFile(path, opaque)
  const receipt = await f.write('{"revised":true}\n', 'revision')
  assert.match(receipt.commit, /^[a-f0-9]{40}$/u)
  assert.equal(receipt.indexMaintenance.state, 'deferred')
  assert.equal(await f.git.head(), receipt.commit)
  assert.deepEqual(await readFile(path), opaque)
  await assert.rejects(readFile(join(f.root, '.git', 'index.lock')), { code: 'ENOENT' })
})

for (const representation of ['v3', 'v4', 'intent-to-add']) {
  test(`valid ${representation} index defers maintenance after one exact native publication and preserves a foreign lock`, async t => {
    const f = await fixture(t)
    const first = await f.write('{}\n', 'baseline')
    const globalConfig = join(f.root, 'empty-fixture.gitconfig')
    await writeFile(globalConfig, '')
    const oracle = async argv => (await execute('git', argv, {
      cwd: f.root,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8', maxBuffer: 1 << 20,
    })).stdout
    if (representation === 'v3') {
      // A genuine extended skip-worktree entry requires index v3; simply
      // changing the four-byte version header would not be a valid fixture.
      await oracle(['update-index', '--skip-worktree', '--', 'design_files/state.json'])
    } else if (representation === 'v4') {
      await oracle(['update-index', '--index-version=4'])
    } else {
      await writeFile(join(f.root, 'outside-intent.txt'), 'user-owned untracked content\n')
      await oracle(['add', '-N', '--', 'outside-intent.txt'])
      // Intent is not staged content, even though the native status binding
      // alone would describe it as an ordinary index addition.
      await oracle(['diff', '--cached', '--quiet'])
    }
    const path = join(f.root, '.git', 'index'), lock = join(f.root, '.git', 'index.lock')
    const original = await readFile(path)
    assert.equal(original.readUInt32BE(4), representation === 'v4' ? 4 : 3)
    assert.deepEqual(createHash('sha1').update(original.subarray(0, -20)).digest(), original.subarray(-20))
    assert.match(await oracle(['ls-files', '--stage']), /100644 [a-f0-9]{40} 0\tdesign_files\/state.json/u, 'Git itself accepts the real index representation')
    const foreignLock = Buffer.from(`foreign writer owns ${representation} index\n`)
    await writeFile(lock, foreignLock, { flag: 'wx' })
    const before = f.operations.length
    const receipt = await f.write('{"revised":true}\n', `${representation} revision`)
    const publicationOperations = f.operations.slice(before)
    assert.equal(publicationOperations.filter(kind => kind === 'publish').length, 1)
    assert.equal(publicationOperations.includes('index-update'), false)
    assert.match(receipt.commit, /^[a-f0-9]{40}$/u)
    assert.equal(receipt.change, 'changed')
    assert.equal(receipt.indexMaintenance?.state, 'deferred')
    assert.equal(await f.git.head(), receipt.commit)
    assert.equal((await oracle(['rev-parse', `${receipt.commit}^`])).trim(), first.commit)
    assert.equal((await oracle(['rev-list', '--count', 'HEAD'])).trim(), '2', 'one real commit was added after the baseline')
    assert.equal(await oracle(['show', `${receipt.commit}:design_files/state.json`]), '{"revised":true}\n')
    assert.deepEqual(await readFile(path), original, 'unsupported user index remains byte-exact')
    assert.deepEqual(await readFile(lock), foreignLock, 'an existing writer lock is neither replaced nor removed')
  })
}

test('native index I/O failure is not reclassified as unsupported and cannot publish', async t => {
  const f = await fixture(t)
  const first = await f.write('{}\n', 'baseline')
  const path = join(f.root, '.git', 'index')
  await rm(path)
  await mkdir(path)
  const before = f.operations.filter(kind => kind === 'publish').length
  await assert.rejects(f.write('{"revised":true}\n', 'must not publish'))
  assert.equal(f.operations.filter(kind => kind === 'publish').length, before)
  assert.equal(await f.git.head(), first.commit)
})

test('scoped tree metadata applies its byte cap during traversal and excludes unrelated facts', async t => {
  const f = await fixture(t)
  const first = await f.write('{}\n', 'baseline')
  const stagingRoot = join(f.root, 'prepared')
  await mkdir(stagingRoot)
  const source = join(stagingRoot, 'bytes')
  await writeFile(source, 'x')
  const oid = createHash('sha1').update('blob 1\0x').digest('hex')
  const published = (await executeNativeGit(f.root, { kind: 'publish', expectedHead: first.commit,
    message: 'unrelated files', stagingRoot, files: Array.from({ length: 20 }, (_, i) => ({ path: `unrelated-${i}.txt`, mode: 0o100644, oid, source })) })).value
  const expected = await f.git.listEntriesAt(published.commit)
  assert.equal(expected.length, 1)
  const entry = expected[0]
  const cap = Buffer.byteLength(`100644 blob ${entry.oid}\tdesign_files/state.json\0`)
  assert.deepEqual(await f.git.listEntriesAt(published.commit, undefined, cap), expected)
  await assert.rejects(f.git.listEntriesAt(published.commit, undefined, cap - 1))
})

test('native evidence fingerprint includes project metadata beyond the facade scope and excludes derived experiences', async t => {
  const f = await fixture(t)
  const first = await f.write('{}\n', 'baseline')
  const cli = new GitVersioning(nodeDesignProjectSpawn, f.root, 'design_files', false, 'cli')
  const before = await f.git.designEvidenceRevisionAt(first.commit)
  assert.equal(before, await cli.designEvidenceRevisionAt(first.commit))
  const stagingRoot = join(f.root, 'prepared')
  await mkdir(stagingRoot)
  const source = join(stagingRoot, 'bytes')
  async function publish(parent, path, text) {
    await writeFile(source, text)
    const bytes = Buffer.from(text)
    const oid = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    return (await executeNativeGit(f.root, { kind: 'publish', expectedHead: parent, message: 'evidence boundary', stagingRoot,
      files: [{ path, mode: 0o100644, oid, source }] })).value.commit
  }
  const metadataOnly = await publish(first.commit, 'project.json', '{"kit":"new-kit"}\n')
  const revised = await f.git.designEvidenceRevisionAt(metadataOnly)
  assert.notEqual(revised, before)
  assert.equal(revised, await cli.designEvidenceRevisionAt(metadataOnly))
  assert.deepEqual(await f.git.listPathsAt(metadataOnly), ['state.json'])
  const derivedOnly = await publish(metadataOnly, 'design_files/_experiences/preview.html', '<p>derived</p>')
  assert.equal(await f.git.designEvidenceRevisionAt(derivedOnly), revised)
  assert.equal(await cli.designEvidenceRevisionAt(derivedOnly), revised)
})

test('native list entry subranges apply the cap before unrelated traversal and retain facade-relative literal paths', async t => {
  const f = await fixture(t)
  const first = await f.write('{}\n', 'baseline')
  const stagingRoot = join(f.root, 'prepared')
  await mkdir(stagingRoot)
  const source = join(stagingRoot, 'bytes')
  await writeFile(source, 'x')
  const oid = createHash('sha1').update('blob 1\0x').digest('hex')
  const paths = ['design_files/slice/a[1].json', 'design_files/slice/a1.json',
    'design_files/slice/literal*.json', 'design_files/slice/nested/z.txt',
    ...Array.from({ length: 20 }, (_, i) => `design_files/unrelated/record-${i}.json`)]
  const published = (await executeNativeGit(f.root, { kind: 'publish', expectedHead: first.commit,
    message: 'scoped query fixture', stagingRoot, files: paths.map(path => ({ path, mode: 0o100644, oid, source })) })).value
  const cli = new GitVersioning(nodeDesignProjectSpawn, f.root, 'design_files', false, 'cli')
  const recordBytes = entries => entries.reduce((size, entry) =>
    size + Buffer.byteLength(`${entry.mode.toString(8).padStart(6, '0')} ${entry.type} ${entry.oid}\tdesign_files/${entry.path}\0`), 0)
  const expected = await cli.listEntriesAt(published.commit, undefined, undefined, 'slice')
  assert.deepEqual(expected.map(entry => entry.path), ['slice/a1.json', 'slice/a[1].json', 'slice/literal*.json', 'slice/nested/z.txt'])
  const cap = recordBytes(expected)
  await assert.rejects(f.git.listEntriesAt(published.commit, undefined, cap))
  assert.deepEqual(await f.git.listEntriesAt(published.commit, undefined, cap, 'slice'), expected)
  assert.deepEqual(await cli.listEntriesAt(published.commit, undefined, cap, 'slice'), expected)
  await assert.rejects(f.git.listEntriesAt(published.commit, undefined, cap - 1, 'slice'))
  for (const path of ['slice/a[1].json', 'slice/literal*.json']) {
    const exact = await cli.listEntriesAt(published.commit, undefined, undefined, path)
    assert.deepEqual(exact.map(entry => entry.path), [path])
    assert.deepEqual(await f.git.listEntriesAt(published.commit, undefined, recordBytes(exact), path), exact)
  }
  const nested = new GitVersioning(f.spawn, f.root, 'design_files/slice', false, 'native')
  const nestedCli = new GitVersioning(nodeDesignProjectSpawn, f.root, 'design_files/slice', false, 'cli')
  const nestedExpected = await nestedCli.listEntriesAt(published.commit, undefined, undefined, 'nested')
  assert.deepEqual(nestedExpected.map(entry => entry.path), ['nested/z.txt'])
  assert.deepEqual(await nested.listEntriesAt(published.commit, undefined, cap, 'nested'), nestedExpected)
  assert.deepEqual(await f.git.listEntriesAt(published.commit, undefined, 0, 'missing'), [])
})

test('native list entry subranges reject unsafe paths before any Git operation', async t => {
  const f = await fixture(t)
  const first = await f.write('{}\n', 'baseline')
  const before = f.operations.length
  for (const path of ['', '../escape', 'slice/../escape', '/absolute', '.git/config', 'bad\\name', 'bad\0name']) {
    await assert.rejects(f.git.listEntriesAt(first.commit, undefined, 1024, path), /unsafe path/u)
  }
  assert.equal(f.operations.length, before)
})
