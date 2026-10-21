import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const { register } = await import('tsx/esm/api')
register()
const { GitVersioning } = await import('../src/git.ts')
const exec = promisify(execFile)

async function fixture(t, files = { 'design.txt': 'base\n' }) {
  const root = await mkdtemp(join(tmpdir(), 'design-git-transaction-cost-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const command = (...args) => exec('git', args, { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
  await command('init', '--quiet')
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), bytes)
  }
  let head
  if (Object.keys(files).length) {
    await command('add', '--all')
    await command('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', 'commit', '--quiet', '-m', 'base')
    head = (await command('rev-parse', 'HEAD')).stdout.trim()
  }
  const calls = []
  let after
  const spawn = async request => {
    calls.push({ argv: [...request.argv], env: request.env })
    let result
    try {
      const value = await exec(request.argv[0], request.argv.slice(1), {
        cwd: request.cwd, signal: request.signal,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', ...request.env }, encoding: 'utf8',
      })
      result = { exitCode: 0, ...value }
    } catch (error) {
      result = { exitCode: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
    await after?.(request, result)
    return result
  }
  return { root, command, head, calls, git: new GitVersioning(spawn, root), intercept(callback) { after = callback } }
}

test('a changed one-file transaction reads its immutable baseline tree once', async t => {
  const f = await fixture(t)
  const result = await f.git.commitExactReceipt('changed', new Map([['design.txt', 'next\n']]), f.head)
  assert.ok(result.commit)
  assert.equal(result.indexMaintenance, undefined)
  assert.equal((await f.command('show', ':design.txt')).stdout, 'next\n')
  const probes = f.calls.filter(c => c.argv[1] === 'ls-tree')
  assert.equal(probes.length, 1, 'one transaction must not respawn Git for a tree entry it already verified or constructed')
  const cas = f.calls.findIndex(c => c.argv[1] === 'update-ref')
  assert.equal(f.calls.slice(cas + 1).filter(c => c.argv[1] === 'ls-tree').length, 0,
    'ordinary-index maintenance can reuse the exact accepted transaction entries')
  assert.equal(f.calls.slice(cas + 1).filter(c => c.argv[1] === 'rev-parse' && c.argv.at(-1) === 'HEAD').length, 2,
    'both live HEAD fences remain even when immutable tree probes disappear')
})

test('a first commit needs no tree lookup for its fully constructed regular blobs', async t => {
  const f = await fixture(t, {})
  const binary = Buffer.from([0, 255, 128, 13, 10])
  const result = await f.git.commitExactReceipt('first', new Map([['new.bin', binary]]), undefined)
  assert.ok(result.commit)
  assert.equal(result.indexMaintenance, undefined)
  assert.deepEqual((await exec('git', ['show', ':new.bin'], { cwd: f.root, encoding: 'buffer' })).stdout, binary)
  assert.equal(f.calls.filter(c => c.argv[1] === 'ls-tree').length, 0)
})

test('transaction-local tree reuse preserves executable mode, deletion, binary bytes and unrelated staging', async t => {
  const f = await fixture(t, { 'run.sh': 'old\n', 'remove.txt': 'remove\n', 'foreign.txt': 'base\n' })
  await f.command('update-index', '--chmod=+x', '--', 'run.sh')
  await f.command('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', 'commit', '--quiet', '-m', 'executable')
  const baseline = (await f.command('rev-parse', 'HEAD')).stdout.trim()
  await writeFile(join(f.root, 'foreign.txt'), 'user staged\n')
  await f.command('add', '--', 'foreign.txt')
  const binary = Buffer.from([255, 0, 128, 13, 10])
  const result = await f.git.commitExactReceipt('mixed', new Map([
    ['run.sh', 'next\n'], ['remove.txt', undefined], ['new.bin', binary],
  ]), baseline)
  assert.ok(result.commit)
  assert.equal(result.indexMaintenance, undefined)
  assert.match((await f.command('ls-tree', result.commit, '--', 'run.sh')).stdout, /^100755 blob /)
  assert.equal((await f.command('ls-tree', result.commit, '--', 'remove.txt')).stdout, '')
  assert.deepEqual((await exec('git', ['show', ':new.bin'], { cwd: f.root, encoding: 'buffer' })).stdout, binary)
  assert.equal((await f.command('show', ':foreign.txt')).stdout, 'user staged\n')
  assert.equal((await f.command('show', `${result.commit}:foreign.txt`)).stdout, 'base\n')
  const probes = f.calls.filter(c => c.argv[1] === 'ls-tree')
  assert.equal(probes.length, 3, 'each changed path needs at most its initial immutable baseline entry')
  assert(probes.every(c => c.argv[2] === baseline))
})

test('tree reuse expires with the transaction and a later update uses its own baseline', async t => {
  const f = await fixture(t)
  const first = await f.git.commitExactReceipt('first update', new Map([['design.txt', 'one\n']]), f.head)
  f.calls.length = 0
  const second = await f.git.commitExactReceipt('second update', new Map([['design.txt', 'two\n']]), first.commit)
  assert.notEqual(second.commit, first.commit)
  assert.equal((await f.command('show', ':design.txt')).stdout, 'two\n')
  const probes = f.calls.filter(c => c.argv[1] === 'ls-tree')
  assert.equal(probes.length, 1)
  assert.equal(probes[0].argv[2], first.commit)
})

test('HEAD advancing after temporary-index maintenance still defers without replacing the ordinary index', async t => {
  const f = await fixture(t)
  const indexBefore = await readFile(join(f.root, '.git/index'))
  let competing
  f.intercept(async (request, result) => {
    if (request.argv[1] !== 'update-index' || !request.env?.GIT_INDEX_FILE?.endsWith('maintenance-index') || result.exitCode !== 0) return
    const head = (await f.command('rev-parse', 'HEAD')).stdout.trim()
    const tree = (await f.command('rev-parse', `${head}^{tree}`)).stdout.trim()
    competing = (await f.command('-c', 'user.name=fixture', '-c', 'user.email=fixture@local', 'commit-tree', tree, '-p', head, '-m', 'competing')).stdout.trim()
    await f.command('update-ref', 'HEAD', competing, head)
  })
  const result = await f.git.commitExactReceipt('publish', new Map([['design.txt', 'next\n']]), f.head)
  assert.ok(result.commit)
  assert.notEqual(result.commit, competing)
  assert.equal(result.indexMaintenance?.state, 'deferred')
  assert.match(result.indexMaintenance.message, /HEAD advanced/)
  assert.equal((await f.command('rev-parse', 'HEAD')).stdout.trim(), competing)
  assert.deepEqual(await readFile(join(f.root, '.git/index')), indexBefore)
  await assert.rejects(readFile(join(f.root, '.git/index.lock')), { code: 'ENOENT' })
})

test('file-to-directory replacement retains the published non-regular-entry maintenance guard', async t => {
  const f = await fixture(t)
  const indexBefore = await readFile(join(f.root, '.git/index'))
  const result = await f.git.commitExactReceipt('replace parent', new Map([
    ['design.txt', undefined], ['design.txt/child.txt', 'child\n'],
  ]), f.head)
  assert.ok(result.commit)
  assert.equal(result.indexMaintenance?.state, 'deferred')
  assert.match(result.indexMaintenance.message, /invalid published tree entry/)
  assert.equal((await f.command('show', `${result.commit}:design.txt/child.txt`)).stdout, 'child\n')
  assert.deepEqual(await readFile(join(f.root, '.git/index')), indexBefore)
  const probes = f.calls.filter(c => c.argv[1] === 'ls-tree')
  assert.equal(probes.length, 3, 'only the structural path requires a post-publication lookup')
  assert.equal(probes.at(-1).argv[2], result.commit)
  assert.equal(probes.at(-1).argv.at(-1), 'design.txt')
  await assert.rejects(readFile(join(f.root, '.git/index.lock')), { code: 'ENOENT' })
})

test('conflicting regular parent and child entries fail before HEAD CAS', async t => {
  const f = await fixture(t)
  const indexBefore = await readFile(join(f.root, '.git/index'))
  await assert.rejects(f.git.commitExactReceipt('conflict', new Map([
    ['design.txt', 'parent\n'], ['design.txt/child.txt', 'child\n'],
  ]), f.head), /update-index/)
  assert.equal(f.calls.some(c => c.argv[1] === 'update-ref'), false)
  assert.equal((await f.command('rev-parse', 'HEAD')).stdout.trim(), f.head)
  assert.deepEqual(await readFile(join(f.root, '.git/index')), indexBefore)
})

test('a blob hash mismatch cannot enter the reused transaction evidence', async t => {
  const f = await fixture(t)
  f.intercept(async (request, result) => {
    if (request.argv[1] === 'hash-object') result.stdout = '0'.repeat(40) + '\n'
  })
  await assert.rejects(f.git.commitExactReceipt('mismatch', new Map([
    ['design.txt', 'next\n'],
  ]), f.head), /frozen blob hash mismatch/)
  assert.equal(f.calls.some(c => c.argv[1] === 'update-ref'), false)
  assert.equal((await f.command('rev-parse', 'HEAD')).stdout.trim(), f.head)
})
