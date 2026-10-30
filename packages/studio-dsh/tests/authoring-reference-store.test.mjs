/** Temporary host-private storage only; no Host/SDK/model or source/save authority. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { join, basename } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createStudioAuthoringReferenceStore, STUDIO_AUTHORING_REFERENCE_LIMITS as limits } from '../src/authoring-reference-store.ts'

const WINDOWS = process.platform === 'win32'
const POSIX_ONLY = { skip: WINDOWS && 'POSIX mode/owner/directory-sync contract' }
const STORE_URL = new URL('../src/authoring-reference-store.ts', import.meta.url).href

const ref = (changes = {}) => ({ sessionId: randomUUID(), parentSessionId: 'parent:original', invocationId: randomUUID(),
  epoch: randomUUID(), messageId: randomUUID(), afterSeq: -1,
  scope: { id: randomUUID(), expectedRevision: 3, allowedPaths: ['panel.yaml', 'reference/output-contract.md'], bundle: { name: 'independent', version: '1.2' } }, ...changes })
const key = r => ({ sessionId: r.sessionId, epoch: r.epoch, parentSessionId: r.parentSessionId })
async function fixture(t) {
  // Canonicalize the *test fixture*; the production contract rejects alias parents.
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'ygd-native-reference-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const stateRoot = join(root, 'state'), directory = join(stateRoot, 'studio-authoring-references')
  const store = await createStudioAuthoringReferenceStore({ stateRoot })
  return { root, stateRoot, directory, store }
}
async function recordPath(f) {
  const names = (await fs.readdir(f.directory)).filter(name => name.endsWith('.json'))
  assert.equal(names.length, 1)
  return join(f.directory, names[0])
}
function wrap(handle, overrides) {
  return new Proxy(handle, { get(target, property) {
    if (Object.hasOwn(overrides, property)) return overrides[property]
    const value = Reflect.get(target, property)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

test('retain survives fresh instance reopen, preserves exact scope/pin and returns independent copies', async t => {
  const f = await fixture(t), original = ref(), input = structuredClone(original)
  const pending = f.store.retain(input)
  input.scope.allowedPaths[0] = 'caller-mutated'; input.scope.bundle.version = '9.9'
  await pending
  const reopened = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  assert.deepEqual(await reopened.read(key(original)), original)
  const value = await reopened.read(key(original)); value.scope.allowedPaths.reverse(); value.scope.bundle.name = 'changed'
  const list = await reopened.list({ parentSessionId: original.parentSessionId }); list[0].scope.expectedRevision = 999
  assert.deepEqual(await reopened.read(key(original)), original)
  assert.deepEqual(await f.store.read(key(original)), original)
  assert.equal(await reopened.read({ ...key(original), epoch: 'missing' }), undefined)
  assert.deepEqual(await reopened.list({ parentSessionId: 'not-selected' }), [])
  assert.deepEqual(Object.keys(reopened).sort(), ['list', 'read', 'retain'])
  const envelope = JSON.parse(await fs.readFile(await recordPath(f), 'utf8'))
  assert.deepEqual(Object.keys(envelope).sort(), ['digest', 'format', 'key', 'reference'])
  assert.deepEqual(envelope.reference, original)
})

test('same key is idempotent; changed scope/message/parent conflicts without overwriting', async t => {
  const f = await fixture(t), r = ref()
  await Promise.all([f.store.retain(r), f.store.retain(structuredClone(r))])
  const path = await recordPath(f), bytes = await fs.readFile(path), stat = await fs.stat(path)
  const reopened = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  await reopened.retain(r)
  assert.equal((await fs.stat(path)).ino, stat.ino)
  for (const changed of [{ ...r, messageId: 'another-message' }, { ...r, parentSessionId: 'other-parent' },
    { ...r, scope: { ...r.scope, expectedRevision: 4 } }]) await assert.rejects(reopened.retain(changed), /conflicting/)
  assert.deepEqual(await fs.readFile(path), bytes)
  await assert.rejects(reopened.read({ ...key(r), parentSessionId: 'other-parent' }), /exact parent/)
  assert.deepEqual(await reopened.list({ parentSessionId: 'other-parent' }), [])
  assert.deepEqual(await f.store.read(key(r)), r)
})

test('explicit parent listing is deterministic, isolated and never chooses the latest native session', async t => {
  const f = await fixture(t), a = ref(), b = ref({ parentSessionId: 'other-parent' }), c = ref()
  await f.store.retain(a); await f.store.retain(b); await f.store.retain(c)
  const list = await f.store.list({ parentSessionId: a.parentSessionId })
  assert.equal(list.length, 2)
  assert.deepEqual(new Set(list.map(r => r.sessionId)), new Set([a.sessionId, c.sessionId]))
  const fresh = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  assert.deepEqual(await fresh.list({ parentSessionId: a.parentSessionId }), list)
  assert.deepEqual(await fresh.list({ parentSessionId: b.parentSessionId }), [b])
  await assert.rejects(fresh.list({}), /identity|fields/)
  await assert.rejects(fresh.read({ sessionId: a.sessionId, epoch: a.epoch }), /fields/)
})

test('opaque native ids cannot become filesystem paths; namespace does not claim the shared stateRoot', async t => {
  const f = await fixture(t)
  const sibling = join(f.stateRoot, 'studio-instance-drafts'); await fs.mkdir(sibling, { mode: 0o700 })
  const sentinel = join(sibling, 'keep.txt'); await fs.writeFile(sentinel, 'S2-owned bytes', { mode: 0o600 })
  const r = ref({ sessionId: '../../outside', epoch: '../epoch', parentSessionId: 'parent/with/slashes' })
  await f.store.retain(r)
  assert.deepEqual(await f.store.read(key(r)), r)
  assert.match(basename(await recordPath(f)), /^[a-f0-9]{64}\.json$/)
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'S2-owned bytes')
  assert.ok(!(await fs.readdir(f.stateRoot)).includes('.owner'))
})

test('rejects non-JSON/unknown/oversized reference shapes before any record is written', async t => {
  const f = await fixture(t), r = ref()
  for (const bad of [{ ...r, status: 'completed' }, { ...r, candidate: {} }, { ...r, afterSeq: -2 },
    { ...r, invocationId: '\ud800' }, { ...r, sessionId: 'x'.repeat(1025) },
    { ...r, scope: { ...r.scope, expectedRevision: 1.5 } }, { ...r, scope: { ...r.scope, allowedPaths: [] } },
    { ...r, scope: { ...r.scope, allowedPaths: Array(2) } },
    { ...r, scope: { ...r.scope, allowedPaths: Array(limits.paths + 1).fill('panel.yaml') } },
    { ...r, scope: { ...r.scope, allowedPaths: ['x'.repeat(4097)] } },
    { ...r, scope: { ...r.scope, bundle: { ...r.scope.bundle, source: 'unexpected' } } },
    { ...r, scope: { ...r.scope, bundle: undefined } }]) await assert.rejects(f.store.retain(bad), /fields|integer|text|count|JSON/)
  assert.deepEqual(await f.store.list({ parentSessionId: r.parentSessionId }), [])
})

test('incomplete, duplicate-field, tampered, non-UTF8 and oversized records fail closed', async t => {
  for (const kind of ['truncated', 'duplicate', 'digest', 'utf8', 'oversized', 'unknown']) await t.test(kind, async t => {
    const f = await fixture(t), r = ref(); await f.store.retain(r)
    const path = await recordPath(f), bytes = await fs.readFile(path), data = JSON.parse(bytes)
    const broken = kind === 'truncated' ? bytes.subarray(0, bytes.length - 5)
      : kind === 'duplicate' ? bytes.toString().replace('{', '{"format":"ignored",')
      : kind === 'digest' ? JSON.stringify({ ...data, digest: '0'.repeat(64) }) + '\n'
      : kind === 'utf8' ? Buffer.from([0xff, 0xfe])
      : kind === 'oversized' ? Buffer.alloc(limits.bytes + 1, 32)
      : JSON.stringify({ ...data, status: 'completed' }) + '\n'
    await fs.writeFile(path, broken)
    const reopened = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
    await assert.rejects(reopened.read(key(r)))
    await assert.rejects(reopened.list({ parentSessionId: r.parentSessionId }))
    assert.deepEqual(await fs.readFile(path), Buffer.from(broken), 'no repair or overwrite')
  })
})

test('requires explicit canonical physical root, rejects leaf and parent aliases without repair', async t => {
  const f = await fixture(t)
  for (const stateRoot of [undefined, 'relative', f.stateRoot + '/', f.stateRoot + '/x/..']) {
    await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot }), /explicit absolute canonical/)
  }
  const alias = join(f.root, 'alias'); await fs.symlink(f.stateRoot, alias, WINDOWS ? 'junction' : 'dir')
  await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: alias }), /physical|symlink/)
  const parentAlias = join(f.root, 'parent-alias'); await fs.symlink(f.root, parentAlias, WINDOWS ? 'junction' : 'dir')
  await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: join(parentAlias, 'new-state') }), /symlink/)
  await assert.rejects(fs.stat(join(f.root, 'new-state')), { code: 'ENOENT' })
  assert.equal((await fs.lstat(alias)).isSymbolicLink(), true)
})

test('namespace without ownership marker is preserved, including preexisting unrelated bytes', async t => {
  const f = await fixture(t), stateRoot = join(f.root, 'unowned')
  await fs.mkdir(stateRoot, { mode: 0o700 }); const dir = join(stateRoot, 'studio-authoring-references')
  await fs.mkdir(dir, { mode: 0o700 }); await fs.writeFile(join(dir, 'keep'), 'user bytes', { mode: 0o600 })
  await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot }), /ownership/)
  assert.deepEqual(await fs.readdir(dir), ['keep']); assert.equal(await fs.readFile(join(dir, 'keep'), 'utf8'), 'user bytes')
})

test('private root/namespace/marker/record permission drift is rejected without chmod repair', POSIX_ONLY, async t => {
  for (const target of ['root', 'namespace', 'marker', 'record']) await t.test(target, async t => {
    const f = await fixture(t), r = ref(); await f.store.retain(r)
    const path = target === 'root' ? f.stateRoot : target === 'namespace' ? f.directory : target === 'marker' ? join(f.directory, '.owner') : await recordPath(f)
    const mode = target === 'root' || target === 'namespace' ? 0o755 : 0o644
    await fs.chmod(path, mode)
    await assert.rejects(f.store.read(key(r)), /private|permissions/)
    if (target === 'root' || target === 'namespace' || target === 'marker') await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot }), /private/)
    assert.equal((await fs.stat(path)).mode & 0o777, mode)
  })
})

test('symlink, non-regular and hardlinked record replacements never follow the new target', async t => {
  for (const kind of ['symlink', 'directory', 'hardlink']) await t.test(kind, { skip: WINDOWS && kind === 'symlink' && 'file symlinks require Windows privileges; directory junctions are tested separately' }, async t => {
    const f = await fixture(t), r = ref(); await f.store.retain(r); const path = await recordPath(f)
    const other = join(f.root, 'unrelated'); await fs.writeFile(other, 'private unrelated bytes', { mode: 0o600 })
    if (kind === 'hardlink') await fs.link(path, join(f.root, 'extra-link'))
    else { await fs.unlink(path); if (kind === 'symlink') await fs.symlink(other, path); else await fs.mkdir(path, { mode: 0o700 }) }
    await assert.rejects(f.store.read(key(r)), /private|replaced|unsafe/)
    assert.equal(await fs.readFile(other, 'utf8'), 'private unrelated bytes')
  })
})

test('physical directory/marker/record replacement is detected by the existing store', async t => {
  for (const target of ['namespace', 'marker', 'record']) await t.test(target, async t => {
    const f = await fixture(t), r = ref(); await f.store.retain(r)
    const path = target === 'namespace' ? f.directory : target === 'marker' ? join(f.directory, '.owner') : await recordPath(f)
    if (target === 'namespace') { await fs.rename(path, path + '-old'); await fs.mkdir(path, { mode: 0o700 }) }
    else { const bytes = await fs.readFile(path); await fs.rename(path, path + '-old'); await fs.writeFile(path, bytes, { mode: 0o600 }) }
    await assert.rejects(f.store.read(key(r)), /identity|replaced/)
  })
})

test('replacement during an open read is detected against handle and named identity', async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r); const path = await recordPath(f), bytes = await fs.readFile(path)
  const original = fs.open
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await original(name, ...args)
    if (name !== path) return handle
    await fs.rename(path, path + '-old'); await fs.writeFile(path, bytes, { mode: 0o600 })
    return handle
  })
  await assert.rejects(f.store.read(key(r)), /changed while reading/)
})

test('write or no-clobber publication failure preserves older readable addresses and cleans only owned temporary files', async t => {
  for (const fault of ['file-sync', 'link']) await t.test(fault, async t => {
    const f = await fixture(t), r = ref(); await f.store.retain(r); const path = await recordPath(f), bytes = await fs.readFile(path)
    const next = ref(), original = fs.open
    if (fault === 'link') t.mock.method(fs, 'link', async () => { throw new Error('injected publish failure') })
    else t.mock.method(fs, 'open', async (name, ...args) => {
      const handle = await original(name, ...args)
      return String(name).endsWith('.tmp') ? wrap(handle, { sync: async () => { throw new Error('injected file sync failure') } }) : handle
    })
    await assert.rejects(f.store.retain(next), /injected/)
    t.mock.restoreAll()
    assert.deepEqual(await f.store.read(key(r)), r)
    assert.deepEqual(await fs.readFile(path), bytes)
    assert.equal(await f.store.read(key(next)), undefined)
    assert.deepEqual((await fs.readdir(f.directory)).sort(), ['.owner', basename(path)].sort())
  })
})

test('file sync precedes atomic publication and temporary unlink; POSIX directory sync follows', async t => {
  const f = await fixture(t), events = [], originalOpen = fs.open, originalLink = fs.link, originalUnlink = fs.unlink
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await originalOpen(name, ...args)
    return wrap(handle, { sync: async () => { events.push(['sync', name]); return handle.sync() } })
  })
  t.mock.method(fs, 'link', async (...args) => { events.push(['link', ...args]); return originalLink(...args) })
  t.mock.method(fs, 'unlink', async (...args) => { events.push(['unlink', ...args]); return originalUnlink(...args) })
  await f.store.retain(ref())
  const linked = events.findIndex(e => e[0] === 'link'), temp = events[linked][1]
  assert.ok(events.findIndex(e => e[0] === 'sync' && e[1] === temp) < linked)
  const unlinked = events.findIndex(e => e[0] === 'unlink' && e[1] === temp)
  assert.ok(unlinked > linked)
  if (WINDOWS) assert.equal(events.some(e => e[0] === 'sync' && e[1] === f.directory), false)
  else assert.ok(events.findIndex((e, i) => i > unlinked && e[0] === 'sync' && e[1] === f.directory) > unlinked)
})

test('atomic no-clobber refuses a target that appears at publication without replacing its bytes', async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r)
  const next = ref(), original = fs.link; let competing
  t.mock.method(fs, 'link', async (source, destination) => {
    competing = destination
    await fs.writeFile(destination, 'competing target bytes', { flag: 'wx', mode: 0o600 })
    return original(source, destination)
  })
  await assert.rejects(f.store.retain(next), { code: 'EEXIST' })
  t.mock.restoreAll()
  assert.equal(await fs.readFile(competing, 'utf8'), 'competing target bytes')
  assert.deepEqual(await f.store.read(key(r)), r)
  assert.ok(!(await fs.readdir(f.directory)).some(name => name.endsWith('.tmp') || name === '.write.lock'))
})

test('directory-sync failure rejects retention even after publication; existing addresses stay readable', POSIX_ONLY, async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r)
  const next = ref(), original = fs.open
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await original(name, ...args)
    return name === f.directory ? wrap(handle, { sync: async () => { throw new Error('injected directory sync failure') } }) : handle
  })
  await assert.rejects(f.store.retain(next), /injected directory sync/)
  t.mock.restoreAll()
  assert.deepEqual(await f.store.read(key(r)), r)
  assert.deepEqual(await f.store.read(key(next)), next, 'failure is not proof that an already published address is absent')
  const fresh = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  await fresh.retain(next) // Explicit idempotent call must sync the existing file/directory again.
  assert.deepEqual(await fresh.read(key(next)), next)
})

test('a competing store cannot write through the owned lock; later identical retention is idempotent', async t => {
  const f = await fixture(t), r = ref(), other = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  const original = fs.open
  let notify, release
  const reached = new Promise(resolve => { notify = resolve }), gate = new Promise(resolve => { release = resolve })
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await original(name, ...args)
    return String(name).endsWith('.tmp') ? wrap(handle, { sync: async () => { notify(); await gate; await handle.sync() } }) : handle
  })
  const retaining = f.store.retain(r)
  try {
    await reached
    await assert.rejects(other.retain(r), /being retained elsewhere/)
  } finally { release() }
  await retaining; t.mock.restoreAll()
  await other.retain(r)
  assert.deepEqual(await other.read(key(r)), r)
})

test('namespace and owner symlinks are rejected at fresh open without touching their targets', async t => {
  for (const target of ['namespace', 'owner']) await t.test(target, { skip: WINDOWS && target === 'owner' && 'file symlinks require Windows privileges' }, async t => {
    const f = await fixture(t), path = target === 'namespace' ? f.directory : join(f.directory, '.owner')
    const old = path + '-old'; await fs.rename(path, old); await fs.symlink(old, path, WINDOWS && target === 'namespace' ? 'junction' : undefined)
    await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot }), /private/)
    assert.equal((await fs.lstat(path)).isSymbolicLink(), true)
    assert.equal(await fs.readFile(target === 'namespace' ? join(old, '.owner') : old, 'utf8'), 'studio-authoring-reference/v1\n')
  })
})

test('a different file owner is rejected before opening record contents', POSIX_ONLY, async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r); const path = await recordPath(f)
  const original = fs.lstat
  t.mock.method(fs, 'lstat', async (name, ...args) => {
    const info = await original(name, ...args)
    return name === path ? Object.assign(Object.create(Object.getPrototypeOf(info)), info, { uid: info.uid + 1 }) : info
  })
  await assert.rejects(f.store.read(key(r)), /owned/)
})

test('initialization barriers are completed on fresh reopen after each fail-first sync', async t => {
  for (const failed of ['owner', 'namespace', 'stateRoot', 'parent']) await t.test(failed, { skip: WINDOWS && failed !== 'owner' && 'POSIX directory-sync barrier' }, async t => {
    const f = await fixture(t), stateRoot = join(f.root, 'incomplete-initialization')
    const directory = join(stateRoot, 'studio-authoring-references'), owner = join(directory, '.owner')
    const paths = { owner, namespace: directory, stateRoot, parent: f.root }, barriers = WINDOWS ? [owner] : Object.values(paths)
    const original = fs.open, synced = []; let failFirst = true
    t.mock.method(fs, 'open', async (name, ...args) => {
      const handle = await original(name, ...args)
      return wrap(handle, { sync: async () => {
        synced.push(name)
        if (failFirst && name === paths[failed]) { failFirst = false; throw new Error('injected initialization sync failure') }
        await handle.sync()
      } })
    })
    await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot }), /injected initialization/)
    assert.equal(failFirst, false, 'the selected initial barrier was actually reached')
    const identities = await Promise.all(barriers.slice(0, 3).map(path => fs.stat(path)))
    synced.length = 0
    const reopened = await createStudioAuthoringReferenceStore({ stateRoot })
    const ready = synced.length
    const r = ref(); await reopened.retain(r)
    let prior = -1
    for (const path of barriers) {
      const index = synced.indexOf(path)
      assert.ok(index > prior && index < ready, `required initialization barrier before factory/retain success: ${path}`)
      prior = index
    }
    for (const [i, path] of barriers.slice(0, 3).entries()) {
      const info = await fs.stat(path)
      assert.equal(info.ino, identities[i].ino, 'existing owned marker/namespace/root is not replaced')
      assert.equal(info.dev, identities[i].dev)
    }
    assert.deepEqual(await reopened.read(key(r)), r)
    assert.equal(await fs.readFile(owner, 'utf8'), 'studio-authoring-reference/v1\n')
  })
})

test('adopted namespace verifies ownership before barriers and preserves records across a retry failure', POSIX_ONLY, async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r)
  const path = await recordPath(f), bytes = await fs.readFile(path), info = await fs.stat(path), original = fs.open
  let failed = false
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await original(name, ...args)
    return name === f.stateRoot ? wrap(handle, { sync: async () => { failed = true; throw new Error('injected adoption barrier failure') } }) : handle
  })
  await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot }), /injected adoption/)
  assert.equal(failed, true)
  t.mock.restoreAll()
  const reopened = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  await reopened.retain(r)
  assert.deepEqual(await fs.readFile(path), bytes); assert.equal((await fs.stat(path)).ino, info.ino)
  assert.deepEqual(await reopened.read(key(r)), r)
  const owner = join(f.directory, '.owner'); await fs.writeFile(owner, 'incorrect marker')
  const synced = []
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await original(name, ...args)
    return wrap(handle, { sync: async () => { synced.push(name); return handle.sync() } })
  })
  await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot }), /ownership/)
  assert.deepEqual(synced, [], 'a namespace without a valid marker is not adopted or synced')
  assert.equal(await fs.readFile(owner, 'utf8'), 'incorrect marker')
  assert.deepEqual(await fs.readFile(path), bytes)
})

test('stale write lock fails without reclamation; exact read remains available', async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r)
  const lock = join(f.directory, '.write.lock'); await fs.mkdir(lock, { mode: 0o700 })
  await assert.rejects(f.store.retain(ref()), /no stale lock is reclaimed/)
  assert.deepEqual(await f.store.read(key(r)), r)
  assert.equal((await fs.stat(lock)).isDirectory(), true)
})

test('bounded record and directory counts refuse additional writes without losing the existing set', { timeout: 30000 }, async t => {
  const f = await fixture(t), first = ref(); await f.store.retain(first)
  for (let i = 1; i < limits.references; i++) await f.store.retain(ref())
  await assert.rejects(f.store.retain(ref()), /count budget/)
  assert.equal((await f.store.list({ parentSessionId: first.parentSessionId })).length, limits.references)
  assert.deepEqual(await f.store.read(key(first)), first)
  await f.store.retain(first)
  for (let i = 0; i < 17; i++) await fs.writeFile(join(f.directory, `.${randomUUID()}.tmp`), '', { mode: 0o600 })
  await assert.rejects(f.store.list({ parentSessionId: first.parentSessionId }), /entry budget/)
})

// A separate native Node process consumes the same disk authority. No Host,
// credentials, SDK or model is involved. The only fault hook pauses a writer
// after its file write and before publication, while its real mkdir lock is held.
const CHILD_SOURCE = `
  import fs from 'node:fs/promises'
  import { once } from 'node:events'
  const input = JSON.parse(process.argv[1])
  const { createStudioAuthoringReferenceStore } = await import(input.module)
  const store = await createStudioAuthoringReferenceStore({ stateRoot: input.stateRoot })
  if (input.action === 'read') {
    console.log(JSON.stringify(await store.list({ parentSessionId: input.parentSessionId })))
  } else {
    const open = fs.open
    fs.open = async (path, ...args) => {
      const handle = await open(path, ...args)
      if (!String(path).endsWith('.tmp')) return handle
      return new Proxy(handle, { get(target, key) {
        if (key === 'sync') return async () => {
          const released = once(process, 'message')
          process.send({ event: 'locked' })
          await released
          await target.sync()
        }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    }
    await store.retain(input.reference)
    process.send({ event: 'committed' })
    process.disconnect()
  }
`
function freshProcessList(f, parentSessionId) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', CHILD_SOURCE,
    JSON.stringify({ module: STORE_URL, stateRoot: f.stateRoot, action: 'read', parentSessionId })],
  { encoding: 'utf8', timeout: 15000, windowsHide: true })
  assert.equal(child.error, undefined)
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}
function pausedWriter(t, f, reference) {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', CHILD_SOURCE,
    JSON.stringify({ module: STORE_URL, stateRoot: f.stateRoot, action: 'hold', reference })],
  { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', bytes => { stderr += bytes })
  const exit = once(child, 'exit')
  // Observe both ready and premature exit so a child import/I/O failure fails the
  // test promptly instead of leaving an unbounded wait or orphaned child.
  const ready = Promise.race([
    once(child, 'message').then(([message]) => assert.equal(message.event, 'locked')),
    exit.then(() => { throw new Error('Writer exited before acquiring its lock: ' + stderr) }),
  ])
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exit })
  return { child, ready, exit, stderr: () => stderr }
}

test('a new process reopens complete references and cross-process writers exclude conflicting publication', { timeout: 30000 }, async t => {
  const f = await fixture(t), original = ref(), next = ref()
  await f.store.retain(original)
  assert.deepEqual(freshProcessList(f, original.parentSessionId), [original])
  const writer = pausedWriter(t, f, next)
  await writer.ready
  await assert.rejects(f.store.retain({ ...next, messageId: 'competing-message' }), /being retained elsewhere/)
  assert.deepEqual(await f.store.read(key(original)), original)
  const committed = once(writer.child, 'message')
  writer.child.send('commit')
  assert.equal((await committed)[0].event, 'committed')
  assert.equal((await writer.exit)[0], 0, writer.stderr())
  assert.deepEqual(await f.store.read(key(next)), next, 'warm store reads the other process publication from disk')
  await f.store.retain(next)
  await assert.rejects(f.store.retain({ ...next, messageId: 'conflict-after-reopen' }), /conflicting/)
  assert.deepEqual(new Set(freshProcessList(f, original.parentSessionId).map(r => r.sessionId)), new Set([original.sessionId, next.sessionId]))
})

test('interrupting a writer preserves complete older references and does not reclaim its abandoned lock', { timeout: 30000 }, async t => {
  const f = await fixture(t), original = ref(), interrupted = ref()
  await f.store.retain(original)
  const writer = pausedWriter(t, f, interrupted)
  await writer.ready
  writer.child.kill('SIGKILL')
  await writer.exit
  const reopened = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  assert.deepEqual(await reopened.read(key(original)), original)
  assert.equal(await reopened.read(key(interrupted)), undefined)
  assert.deepEqual(freshProcessList(f, original.parentSessionId), [original])
  await assert.rejects(reopened.retain(interrupted), /no stale lock is reclaimed/)
  assert.ok((await fs.readdir(f.directory)).some(name => name.endsWith('.tmp')))
  assert.ok((await fs.lstat(join(f.directory, '.write.lock'))).isDirectory())
})

test('permission I/O errors propagate unchanged; failed operations release their handles and owned lock', async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r)
  const path = await recordPath(f), original = fs.open
  const denied = Object.assign(new Error('injected access denied'), { code: 'EACCES' })
  const hook = t.mock.method(fs, 'open', async (name, ...args) => {
    if (name === path || String(name).endsWith('.tmp')) throw denied
    return original(name, ...args)
  })
  await assert.rejects(f.store.read(key(r)), error => error === denied)
  await assert.rejects(f.store.retain(r), error => error === denied)
  await assert.rejects(f.store.retain(ref()), error => error === denied)
  assert.equal((await fs.readdir(f.directory)).includes('.write.lock'), false)
  hook.mock.restore()
  assert.deepEqual(await f.store.read(key(r)), r)
  await f.store.retain(r)
})

test('store operations close every opened handle before settling, including file-sync failure and reopen', async t => {
  const f = await fixture(t), original = fs.open, active = new Set()
  let failSync = false
  t.mock.method(fs, 'open', async (name, ...args) => {
    const handle = await original(name, ...args)
    active.add(handle)
    if (WINDOWS) assert.equal((await handle.stat()).isDirectory(), false, 'Windows never opens directory flush handles')
    return wrap(handle, {
      close: async () => { try { await handle.close() } finally { active.delete(handle) } },
      sync: async () => { if (failSync && String(name).endsWith('.tmp')) throw new Error('injected file sync failure'); await handle.sync() },
    })
  })
  const reopened = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  assert.equal(active.size, 0)
  const r = ref(); await reopened.retain(r); assert.equal(active.size, 0)
  await reopened.read(key(r)); assert.equal(active.size, 0)
  await reopened.list({ parentSessionId: r.parentSessionId }); assert.equal(active.size, 0)
  failSync = true
  await assert.rejects(reopened.retain(ref()), /injected file sync/)
  assert.equal(active.size, 0)
  failSync = false
  const fresh = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  assert.deepEqual(await fresh.read(key(r)), r)
  assert.equal(active.size, 0)
})

test('Windows read-only files remain observable and refuse retention or owner flush without changing bytes', { skip: !WINDOWS }, async t => {
  const f = await fixture(t), r = ref(); await f.store.retain(r)
  const path = await recordPath(f), bytes = await fs.readFile(path), owner = join(f.directory, '.owner')
  // chmod on Windows controls the real read-only attribute, not POSIX ACL bits.
  for (const target of [path, owner]) {
    await fs.chmod(target, 0o444)
    try {
      assert.deepEqual(await f.store.read(key(r)), r)
      if (target === path) await assert.rejects(f.store.retain(r), error => ['EACCES', 'EPERM'].includes(error.code))
      else await assert.rejects(createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot }), error => ['EACCES', 'EPERM'].includes(error.code))
      assert.deepEqual(await fs.readFile(path), bytes)
    } finally { await fs.chmod(target, 0o600) }
  }
  await f.store.retain(r)
  assert.deepEqual(await (await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })).read(key(r)), r)
})
