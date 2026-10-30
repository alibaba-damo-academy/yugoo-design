/** Existing private-directory rules, isolated leaf creation and fault/retry barriers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareStudioAuthoringDirectory } from '../src/authoring-reference-store.ts'

const WINDOWS = process.platform === 'win32'

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'studio-private-directory-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, leaf: join(root, 'private-leaf') }
}

test('one private canonical leaf reopens without creating a store, marker or clearing content', async t => {
  const { leaf } = await fixture(t)
  assert.equal(await prepareStudioAuthoringDirectory(leaf), leaf)
  if (!WINDOWS) assert.equal((await fs.stat(leaf)).mode & 0o7777, 0o700)
  assert.deepEqual(await fs.readdir(leaf), [])
  await fs.writeFile(join(leaf, 'retained.txt'), 'existing Host content')
  assert.equal(await prepareStudioAuthoringDirectory(leaf), leaf)
  assert.equal(await fs.readFile(join(leaf, 'retained.txt'), 'utf8'), 'existing Host content')
  assert.deepEqual(await fs.readdir(leaf), ['retained.txt'])
})

test('invalid paths, missing parents and aliases reject; POSIX private modes are not repaired', async t => {
  const { root, leaf } = await fixture(t)
  for (const path of [undefined, 'relative', root + '/other/../leaf']) await assert.rejects(prepareStudioAuthoringDirectory(path), /canonical/)
  await assert.rejects(prepareStudioAuthoringDirectory(join(root, 'missing', 'leaf')), { code: 'ENOENT' })
  await assert.rejects(fs.stat(join(root, 'missing')), { code: 'ENOENT' })
  await fs.mkdir(leaf, { mode: 0o755 })
  if (WINDOWS) assert.equal(await prepareStudioAuthoringDirectory(leaf), leaf)
  else {
    await assert.rejects(prepareStudioAuthoringDirectory(leaf), /private/)
    assert.equal((await fs.stat(leaf)).mode & 0o7777, 0o755)
  }
  await fs.writeFile(join(root, 'file'), 'retained')
  await assert.rejects(prepareStudioAuthoringDirectory(join(root, 'file')), /private/)
  await fs.symlink(leaf, join(root, 'alias'), WINDOWS ? 'junction' : 'dir')
  await assert.rejects(prepareStudioAuthoringDirectory(join(root, 'alias')), /private/)
  await assert.rejects(prepareStudioAuthoringDirectory(join(root, 'alias', 'child')), /symlink/)
  await assert.rejects(fs.stat(join(leaf, 'child')), { code: 'ENOENT' })
})

test('a failed leaf or parent sync remains rejected and reopening completes both barriers again', { skip: WINDOWS && 'POSIX directory-sync contract' }, async t => {
  for (const stage of ['leaf', 'parent']) await t.test(stage, async t => {
    const { root, leaf } = await fixture(t), failure = new Error('injected ' + stage + ' sync failure')
    const open = fs.open, failed = stage === 'leaf' ? leaf : root
    const mock = t.mock.method(fs, 'open', async (path, ...args) => {
      const handle = await open(path, ...args)
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync' && path === failed) return async () => { throw failure }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    await assert.rejects(prepareStudioAuthoringDirectory(leaf), error => error === failure)
    assert.deepEqual(await fs.readdir(leaf), [])
    mock.mock.restore()
    const synchronized = []
    t.mock.method(fs, 'open', async (path, ...args) => {
      const handle = await open(path, ...args)
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync') return async () => { synchronized.push(path); await target.sync() }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    })
    assert.equal(await prepareStudioAuthoringDirectory(leaf), leaf)
    assert.deepEqual(synchronized, [leaf, root])
  })
})

test('replacement during a sync is diagnosed and preserves the displaced original directory', { skip: WINDOWS && 'POSIX directory-sync contract' }, async t => {
  const { root, leaf } = await fixture(t), backup = join(root, 'displaced-original')
  await fs.mkdir(leaf, { mode: 0o700 }); await fs.writeFile(join(leaf, 'retained.txt'), 'original content')
  const open = fs.open
  let replaced = false
  t.mock.method(fs, 'open', async (path, ...args) => {
    const handle = await open(path, ...args)
    return new Proxy(handle, { get(target, key) {
      if (key === 'sync' && path === leaf && !replaced) return async () => {
        replaced = true; await fs.rename(leaf, backup); await fs.mkdir(leaf, { mode: 0o700 }); await target.sync()
      }
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  })
  await assert.rejects(prepareStudioAuthoringDirectory(leaf), /identity/)
  assert.equal(await fs.readFile(join(backup, 'retained.txt'), 'utf8'), 'original content')
  assert.deepEqual(await fs.readdir(leaf), [])
})

// Windows has no POSIX directory-open/sync prerequisite. Metadata checks still
// reject an object replacement before admitting the directory.
test('Windows directory preparation uses inherited access without directory handles', { skip: !WINDOWS }, async t => {
  const { leaf } = await fixture(t)
  await fs.mkdir(leaf, { mode: 0o755 })
  t.mock.method(fs, 'open', async () => { throw new Error('directory handles must not be opened on Windows') })
  assert.equal(await prepareStudioAuthoringDirectory(leaf), leaf)
})

test('Windows directory identity checks reject replacement before admission', { skip: !WINDOWS }, async t => {
  const { leaf } = await fixture(t), backup = leaf + '-old'
  const realpath = fs.realpath
  let replaced = false
  t.mock.method(fs, 'realpath', async (path, ...args) => {
    const canonical = await realpath(path, ...args)
    if (path === leaf && !replaced) {
      replaced = true; await fs.rename(leaf, backup); await fs.mkdir(leaf)
    }
    return canonical
  })
  await assert.rejects(prepareStudioAuthoringDirectory(leaf), /identity|replaced/)
  assert.equal(replaced, true)
})
