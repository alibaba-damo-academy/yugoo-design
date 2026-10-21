import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readLibraryIndex, updateLibraryIndex } from '../src/git-index-library.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-library-index-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = (args, options = {}) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, ...options })
  git(['init', '-q']); git(['config', 'index.version', '2'])
  for (const name of ['owned.json', 'foreign.txt', '中文.txt']) await writeFile(join(root, name), name)
  git(['add', '--', '.']); git(['write-tree']) // Include Git's ordinary derived TREE cache.
  git(['update-index', '--assume-unchanged', 'foreign.txt'])
  const replacement = git(['hash-object', '-w', '--stdin'], { input: 'replacement' }).toString().trim()
  return { root, git, replacement, index: join(root, '.git/index') }
}

test('real index: cacheinfo preserves foreign staging, stat, assume-valid and merge stages', async t => {
  const f = await fixture(t)
  const base = f.git(['hash-object', '-w', '--stdin'], { input: 'base' }).toString().trim()
  f.git(['update-index', '--index-info'], { input: [1, 2, 3].map(stage => `100644 ${base} ${stage}\tconflict.txt\n`).join('') })
  const before = await readFile(f.index)
  const foreign = f.git(['ls-files', '--debug', '--', 'foreign.txt']).toString()
  const conflicts = f.git(['ls-files', '--stage', '--', 'conflict.txt']).toString()
  const owned = f.git(['ls-files', '--stage', '--', 'owned.json']).toString()
  const snapshot = await readLibraryIndex(before, ['owned.json', 'foreign.txt', 'conflict.txt', '中文.txt'])
  assert.equal(snapshot['conflict.txt'], conflicts)
  assert.equal(snapshot['中文.txt'], f.git(['ls-files', '--stage', '--', '中文.txt']).toString())
  await writeFile(f.index, await updateLibraryIndex(before, [{ path: 'owned.json', oid: f.replacement, mode: 0o100755 }]))
  assert.equal(f.git(['ls-files', '--debug', '--', 'foreign.txt']).toString(), foreign)
  assert.equal(f.git(['ls-files', '--stage', '--', 'conflict.txt']).toString(), conflicts)
  assert.equal(f.git(['ls-files', '--stage', '--', 'owned.json']).toString(), `100755 ${f.replacement} 0\towned.json\n`)
  assert.equal(snapshot['owned.json'], owned)
  assert.notEqual(snapshot['owned.json'], f.git(['ls-files', '--stage', '--', 'owned.json']).toString())
})

test('fresh snapshots have no shared cache and absent directory deletion preserves descendants', async t => {
  const f = await fixture(t)
  const before = await readFile(f.index)
  const nested = await updateLibraryIndex(before, [{ path: 'dir/child', oid: f.replacement, mode: 0o100644 }])
  const removed = await updateLibraryIndex(nested, [{ path: 'dir' }])
  assert.equal((await readLibraryIndex(before, ['dir'])).dir, '')
  assert.equal((await readLibraryIndex(removed, ['dir'])).dir, `100644 ${f.replacement} 0\tdir/child\n`)
  await assert.rejects(updateLibraryIndex(nested, [{ path: 'dir', oid: f.replacement, mode: 0o100644 }]))
  const replaced = await updateLibraryIndex(nested, [{ path: 'dir/child' }, { path: 'dir', oid: f.replacement, mode: 0o100644 }])
  assert.equal((await readLibraryIndex(replaced, ['dir'])).dir, `100644 ${f.replacement} 0\tdir\n`)
})

function rehash(body) { return Buffer.concat([body, createHash('sha1').update(body).digest()]) }

test('unsupported versions, extensions, corrupt bytes and lossy paths fail without changing the input', async t => {
  const f = await fixture(t)
  const before = await readFile(f.index)
  const saved = Buffer.from(before)
  const opaque = Buffer.alloc(8); opaque.write('XTRA'); opaque.writeUInt32BE(0, 4)
  const unknown = rehash(Buffer.concat([before.subarray(0, -20), opaque]))
  const update = [{ path: 'owned.json', oid: f.replacement, mode: 0o100644 }]
  await assert.rejects(updateLibraryIndex(unknown, update))
  const highBitAlias = Buffer.from([0xd4, 0xd2, 0xc5, 0xc5, 0, 0, 0, 0])
  const empty = await updateLibraryIndex(undefined, [])
  await assert.rejects(updateLibraryIndex(rehash(Buffer.concat([empty.subarray(0, -20), highBitAlias])), update))
  const corrupt = Buffer.from(before); corrupt[15] ^= 1
  await assert.rejects(readLibraryIndex(corrupt, ['owned.json']), error => error.code === undefined)
  const lossy = Buffer.from(before.subarray(0, -20)); lossy[lossy.indexOf(Buffer.from('foreign.txt'))] = 0xff
  await assert.rejects(updateLibraryIndex(rehash(lossy), update))
  f.git(['update-index', '--index-version', '4'])
  await assert.rejects(updateLibraryIndex(await readFile(f.index), update), { code: 'unsupported-index' })
  assert.deepEqual(before, saved)
  await assert.rejects(updateLibraryIndex(Buffer.alloc(0), update))
  await assert.rejects(updateLibraryIndex(undefined, [{ path: '../escape', oid: f.replacement, mode: 0o100644 }]))
})

test('the empty index is encoded by the library and accepted by Git', async t => {
  const f = await fixture(t)
  const empty = await updateLibraryIndex(undefined, [])
  assert.equal(empty.length, 32)
  await writeFile(f.index, await updateLibraryIndex(empty, [{ path: 'new.json', oid: f.replacement, mode: 0o100644 }]))
  assert.equal(f.git(['ls-files', '--stage']).toString(), `100644 ${f.replacement} 0\tnew.json\n`)
})
