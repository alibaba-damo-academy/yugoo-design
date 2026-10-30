/** Explicit in-memory DSH Fs-port fixture plus real Core/S2; not an installed Host. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDesignBundle, loadDesignKit } from 'dsh-design-core'
import { createStudioInstances, createStudioDraftPorts } from 'dsh-design-studio/node'
import { createDshStudioInstanceAdapters, registerDshStudioCurrentKitSource } from '../src/authoring-sources.ts'
import { openInstalledSourceFiles } from '../src/kit-files.ts'

const B = '/installed/exact-bundle', K = '/installed/old-kit', BAD = '/installed/unrelated-broken'

test('new-project source port uses current library objects and releases its Host registration', async () => {
  const original = { name: 'library_kit', version: '1.0' }, current = { ...original, mindset: 'Current saved method' }
  let records = [], port, stopped = 0, edits = 0
  const loads = []
  const stop = registerDshStudioCurrentKitSource({
    listKits: () => [original],
    registerCurrentKitSource(value) { port = value; return () => { stopped++ } },
  }, {
    list: async input => { assert.deepEqual(input, { kind: 'kit', includeReadiness: false }); return records },
    editCurrent: async request => {
      assert.deepEqual(request, { kind: 'kit', kit: original }); edits++
      const record = { id: 'current-library-object', revision: 2, kit: original, current: true }
      records = [record]; return record
    },
    loadKit: async request => { loads.push(request); return current },
  })
  assert.equal(await port.load('missing'), undefined)
  assert.equal(await port.load('library_kit'), current)
  assert.equal(await port.load('library_kit'), current)
  assert.equal(edits, 1, 'subsequent project copies read the same current library identity')
  assert.deepEqual(loads, [{ id: 'current-library-object', expectedRevision: 2 }, { id: 'current-library-object', expectedRevision: 2 }])
  assert.deepEqual(await port.list(), [original])
  records[0].title = { zh: 'P3 客户反馈工作台', en: 'P3 Feedback Kit' }
  records[0].description = 'Preserve confirmed feedback.'
  assert.deepEqual(await port.list(), [{ ...original, description: 'P3 客户反馈工作台 · P3 Feedback Kit · Preserve confirmed feedback.' }])
  assert.equal(current.mindset, 'Current saved method', 'display title projection does not rewrite saved source')
  stop(); assert.equal(stopped, 1)
})
const pin = { name: 'fork_alpha', version: '1.0' }, kitPin = { name: 'demo_kit', version: '1.0' }
const binary = Buffer.from([0, 255, 128, 10]), sourceId = 'package:trusted-exact'
const bundleFiles = {
  'SKILL.md': '---\nname: alpha\ndescription: Preserve supplied facts and exact source references.\n---\n\nRead reference/method.md before proposing changes.\n',
  'skill.yaml': 'name: alpha\nidentity: fork_alpha\nversion: "1.0"\ntitle: {zh: 事实, en: Facts}\nlabel: {zh: 事实, en: Facts}\nexecution: {handoff: none}\npresentation: {mode: none}\n',
  'schema.yaml': 'type: object\nproperties:\n  summary: {type: string}\n',
  'validation.yaml': 'skill: alpha\nrules:\n  - id: summary\n    scope: [completion]\n    code: alpha.summary\n    message: Required\n    check: {non_empty_string: summary}\n',
  'reference/method.md': 'Retain observations, sources and failure handling.\r\n',
  'assets/opaque.bin': binary,
  'NOTICE': 'Third-party provenance and license notices.\n',
}
const kitFiles = {
  'kit.yaml': 'version: 1\nmounts:\n  - {bindingKey: alpha, name: fork_alpha, version: "1.0"}\n',
  'mindset.md': '---\nname: demo_kit\nversion: "1.0"\ndescription: Judge supplied evidence.\n---\n\n# Mindset\n\n<design_skills>\n## alpha\n\nPreserve facts.\n</design_skills>\n',
  'reference/kit-method.md': 'Kit-owned instructions.\r\n', 'assets/kit.bin': binary, 'LICENSE': 'Kit license bytes.\n',
}

/** Backend-only maps give targets opaque keys; no consumer can use keys as paths. */
function memoryFs(seed) {
  const files = new Map(Object.entries(seed).map(([path, value]) => [path, Buffer.from(value)])), directories = new Set()
  for (const path of files.keys()) for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) directories.add(path.slice(0, i))
  const targets = new Map(), paths = new Map(), aliases = new Map(), versions = new Map(), calls = []
  const error = code => Object.assign(new Error(code), { code })
  const target = path => {
    path = aliases.get(path) ?? path
    if (!targets.has(path)) { const value = { targetKey: `opaque-id-${targets.size}`, displayPath: 'display://not-a-local-path' }; targets.set(path, value); paths.set(value.targetKey, path) }
    return targets.get(path)
  }
  const pathOf = t => { const path = paths.get(t.targetKey); assert.ok(path, 'backend-issued opaque target required'); return path }
  const fs = {
    files, directories, aliases, calls, versions, target,
    async resolve(path) { calls.push(['resolve', path]); const actual = aliases.get(path) ?? path; if (!files.has(actual) && !directories.has(actual)) throw error('FS_NOT_FOUND'); return target(path) },
    contains(parent, child) { const a = pathOf(parent), b = pathOf(child); return b === a || b.startsWith(a + '/') },
    async stat(t) { const path = pathOf(t); calls.push(['stat', path]); return files.has(path) ? { type: 'file', size: files.get(path).length, version: versions.get(path) ?? 'v1' } : directories.has(path) ? { type: 'directory', version: versions.get(path) ?? 'v1' } : undefined },
    async listDir(t) {
      const path = pathOf(t); calls.push(['listDir', path]); const prefix = path + '/', names = new Set()
      for (const key of [...files.keys(), ...directories]) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0])
      return [...names].reverse().map(name => { const child = aliases.get(prefix + name) ?? prefix + name; return { name, type: directories.has(child) ? 'directory' : 'file', target: target(prefix + name) } })
    },
    async readBytes(t, _signal, maxBytes) { const path = pathOf(t); calls.push(['readBytes', path, maxBytes]); const bytes = files.get(path); if (!bytes) throw error('FS_NOT_FOUND'); if (bytes.length > maxBytes) throw error('FS_TOO_LARGE'); return Buffer.from(bytes) },
    async readText() { throw new Error('source capture must use the Fs byte port') },
  }
  const loader = { readText: async path => files.get(path)?.toString('utf8'), readBytes: async path => files.get(path),
    listDir: async path => (await fs.listDir(target(path))).map(entry => entry.name), isDirectory: async path => directories.has(path), realPath: async path => path }
  return { fs, loader }
}
async function fixture({ bad = false } = {}) {
  const seed = Object.fromEntries([...Object.entries(bundleFiles).map(([p, b]) => [B + '/' + p, b]), ...Object.entries(kitFiles).map(([p, b]) => [K + '/' + p, b])])
  const { fs, loader } = memoryFs(seed)
  const content = await loadDesignBundle(loader, { rootDir: B, sourceId }, pin)
  const kit = await loadDesignKit(loader, K, { sourceId: 'package:kit-source', resolveBundle: async requested => { assert.deepEqual({ name: requested.name, version: requested.version }, pin); return content } })
  const contents = new Map([[pin.name + '@' + pin.version, content]]), kits = new Map([[kitPin.name + '@' + kitPin.version, kit]])
  kits.set(kitPin.name + '@2.0', { ...kit, version: '2.0', sourceRoot: '/installed/latest-kit' })
  if (bad) contents.set('bad@1.0', { ...content, resourceRoot: BAD, skill: { ...content.skill, name: 'bad', catalogName: 'bad' } })
  const lookups = []
  const design = {
    listBundles: () => [...contents.values()].map(value => value.skill).concat([{ ...content.skill, name: 'legacy', catalogName: 'legacy' }]),
    resolveBundle: requested => { lookups.push(['bundle', { ...requested }]); return contents.get(requested.name + '@' + requested.version) },
    resolveKit: requested => { lookups.push(['kit', { ...requested }]); return kits.get(requested.kit + '@' + requested.version) },
    listKits: () => { throw new Error('latest Kit list is not an exact resolver') },
  }
  fs.calls.length = 0
  return { fs, design, contents, kits, lookups, content, kit, adapters: createDshStudioInstanceAdapters({ design, fs }) }
}
const bytesAt = (capture, path) => Buffer.from(capture.files.find(entry => entry.path === path).base64, 'base64')
async function state(t) { const root = await realpath(await mkdtemp(join(tmpdir(), 'ygd-dsh-sources-'))); t.after(() => rm(root, { recursive: true, force: true })); return root }

test('exact independent Bundle capture retains raw bytes/method/assets/notices and trusted sourceId', async () => {
  const f = await fixture({ bad: true }), captured = await f.adapters.catalog.captureBundle(pin)
  assert.equal(captured.sourceId, sourceId); assert.equal(captured.runtimeName, 'alpha')
  for (const [path, bytes] of Object.entries(bundleFiles)) assert.deepEqual(bytesAt(captured, path), Buffer.from(bytes))
  assert.deepEqual(captured.files.map(file => file.path), Object.keys(bundleFiles).sort())
  assert.ok(!f.fs.calls.some(([, path]) => path.startsWith(BAD)))
  captured.files[0].base64 = 'mutated'
  assert.notEqual((await f.adapters.catalog.captureBundle(pin)).files[0].base64, 'mutated')
  assert.ok(f.lookups.every(([kind, requested]) => kind === 'bundle' && requested.name === pin.name && requested.version === pin.version))
})

test('old exact Kit capture uses resolveKit, keeps only Kit-owned bytes and exact mounts', async () => {
  const f = await fixture({ bad: true }), captured = await f.adapters.catalog.captureKit(kitPin)
  for (const [path, bytes] of Object.entries(kitFiles)) assert.deepEqual(bytesAt(captured, path), Buffer.from(bytes))
  assert.deepEqual(captured.mounts, [{ bindingKey: 'alpha', ...pin }])
  assert.ok(f.lookups.some(([kind, value]) => kind === 'kit' && value.kit === kitPin.name && value.version === '1.0'))
  assert.ok(!f.fs.calls.some(([, path]) => path.startsWith(BAD)))
  assert.ok(!f.fs.calls.some(([, path]) => path.startsWith('/installed/latest-kit')))
})

test('existing S2 list compiles independent sources, excludes legacy and diagnoses broken independent registrations', async () => {
  const healthy = await fixture(); assert.deepEqual((await healthy.adapters.catalog.listBundles()).map(({ name, version }) => ({ name, version })), [pin])
  const f = await fixture({ bad: true })
  await assert.rejects(f.adapters.catalog.listBundles(), /FS_NOT_FOUND/)
  f.contents.delete('bad@1.0') // Isolate the next failure instead of masking it behind the first broken pin.
  for (const value of [undefined, '']) {
    f.contents.set(pin.name + '@' + pin.version, { ...f.content, sourceId: value })
    await assert.rejects(f.adapters.catalog.listBundles(), /sourceId/)
  }
})

test('missing, mismatched or invalid pins/sourceId/root fail without guessing another source', async () => {
  const f = await fixture()
  await assert.rejects(f.adapters.catalog.captureBundle({ ...pin, version: '2.0' }), /not registered/)
  await assert.rejects(f.adapters.catalog.captureKit({ ...kitPin, version: '9.0' }), /not registered/)
  for (const change of [{ sourceId: undefined }, { sourceId: '' }, { resourceRoot: undefined }, { resourceRoot: 'relative' },
    { skill: { ...f.content.skill, version: '9.0' } }]) {
    f.contents.set(pin.name + '@' + pin.version, { ...f.content, ...change })
    await assert.rejects(f.adapters.catalog.captureBundle(pin), /sourceId|resourceRoot|absolute|pin/)
  }
  f.kits.set(kitPin.name + '@' + kitPin.version, { ...f.kit, sourceRoot: undefined })
  await assert.rejects(f.adapters.catalog.captureKit(kitPin), /sourceRoot/)
})

test('real S2 Bundle copy/read/reopen retains opaque bytes independently of installed source and unrelated bad root', async t => {
  const f = await fixture({ bad: true }), stateRoot = await state(t)
  const instances = await createStudioInstances({ stateRoot, ...f.adapters }), copied = await instances.copy({ kind: 'bundle', bundle: pin })
  assert.deepEqual((await instances.read(copied.id)).source.bundle, pin)
  assert.equal((await instances.read(copied.id)).files.find(file => file.path === 'assets/opaque.bin').editable, false)
  const ports = await createStudioDraftPorts({ stateRoot }, 'instance'), snapshot = await ports.sources.open(copied.baseSnapshot)
  assert.deepEqual(await snapshot.fs.readBytes(join(snapshot.root, 'assets/opaque.bin')), binary)
  assert.equal((await instances.readFile({ id: copied.id, path: 'reference/method.md' })).content, bundleFiles['reference/method.md'])
  f.fs.files.clear(); f.fs.calls.length = 0
  const fresh = await createStudioInstances({ stateRoot, ...f.adapters })
  assert.equal((await fresh.read(copied.id)).revision, 0)
  assert.equal((await fresh.readFile({ id: copied.id, path: 'NOTICE' })).content, bundleFiles.NOTICE)
  assert.equal(f.fs.calls.length, 0, 'retained Bundle reads do not return to installed sources')
})

test('real S2 Kit copy/read retains Kit and mounted opaque bytes with healthy catalog', async t => {
  const f = await fixture(), stateRoot = await state(t), instances = await createStudioInstances({ stateRoot, ...f.adapters })
  const copied = await instances.copy({ kind: 'kit', kit: kitPin })
  assert.deepEqual(copied.source.kit, kitPin); assert.equal(copied.mounts.length, 1)
  const ports = await createStudioDraftPorts({ stateRoot }, 'instance'), snapshot = await ports.sources.open(copied.baseSnapshot)
  assert.deepEqual(await snapshot.fs.readBytes(join(snapshot.root, 'assets/kit.bin')), binary)
  const mount = await ports.sources.open(copied.mounts[0].bundle.source.snapshot)
  assert.deepEqual(await mount.fs.readBytes(join(mount.root, 'assets/opaque.bin')), binary)
  assert.ok(!(await instances.read(copied.id)).files.some(file => file.path.startsWith('skills/')))
  const before = await instances.readFile({ id: copied.id, path: 'mindset.md' })
  // An unrelated broken installation must not prevent reading a saved source.
  f.contents.set('bad@1.0', { ...f.content, resourceRoot: BAD, skill: { ...f.content.skill, name: 'bad', catalogName: 'bad' } })
  assert.equal((await instances.read(copied.id)).revision, copied.revision)
  assert.equal((await instances.readFile({ id: copied.id, path: 'mindset.md' })).content, before.content)
})

test('capture shares containment, rejects escape instead of viewer skipping, and preserves viewer UTF-8/1MiB limit', async () => {
  const f = await fixture(), outside = '/outside/secret'; f.fs.files.set(outside, Buffer.from('secret'))
  f.fs.files.set(B + '/escape.md', Buffer.from('alias')); f.fs.aliases.set(B + '/escape.md', outside)
  const source = await openInstalledSourceFiles(f.fs, B)
  assert.ok(!(await source.listFiles(B)).includes('escape.md'), 'existing viewer behavior remains')
  await assert.rejects(source.captureTree(), /source_forbidden/)
  assert.ok(!f.fs.calls.some(([op, path]) => op === 'readBytes' && path === outside))
  f.fs.files.delete(B + '/escape.md'); f.fs.aliases.clear()
  f.fs.files.set(B + '/big.bin', Buffer.alloc(1024 * 1024 + 1, 255))
  const captured = await source.captureTree(); assert.equal(bytesAt({ files: captured }, 'big.bin').length, 1024 * 1024 + 1)
  await assert.rejects(source.readFile('big.bin'), /kit_file.too_large/)
  await assert.rejects(source.readFile('assets/opaque.bin'), /kit_file.binary/)
  await assert.rejects(source.readFile('../secret'), /kit_file.path_forbidden/)
  assert.equal((await source.readFile('reference/method.md')).content, bundleFiles['reference/method.md'])
})

test('technical directories are excluded for Kit and Bundle captures without losing authored hidden files', async () => {
  for (const kind of ['Kit', 'Bundle']) {
    const { fs } = memoryFs({ '/root/.git/config': 'git', '/root/Node_Modules/pkg/a': 'dependency', '/root/.authored': 'keep', '/root/method.md': 'method' })
    const source = await openInstalledSourceFiles(fs, '/root', kind), files = await source.captureTree()
    assert.deepEqual(files.map(file => file.path), ['.authored', 'method.md'])
    assert.ok(!fs.calls.some(([op, path]) => op === 'readBytes' && /config|dependency/.test(path)))
  }
})

test('capture rejects invalid entries, special files and repeated directory identity without partial success', async t => {
  for (const kind of ['traversal', 'duplicate', 'other', 'cycle']) await t.test(kind, async () => {
    const { fs } = memoryFs({ '/root/a': 'a' }), source = await openInstalledSourceFiles(fs, '/root')
    const original = fs.listDir
    fs.listDir = async target => kind === 'traversal' ? [{ name: '../outside', type: 'file', target: fs.target('/root/a') }]
      : kind === 'duplicate' ? [...await original(target), ...await original(target)]
      : kind === 'cycle' ? [{ name: 'loop', type: 'directory', target: fs.target('/root') }]
      : [{ name: 'special', type: 'other', target: fs.target('/root/a') }]
    if (kind === 'other') { const stat = fs.stat; fs.stat = async target => { const info = await stat(target); return info?.type === 'file' ? { ...info, type: 'other' } : info } }
    await assert.rejects(source.captureTree(), /source_invalid/)
  })
})

test('capture bounds total bytes/file count/entries/depth and detects changing files', async t => {
  for (const kind of ['bytes', 'files', 'entries', 'depth', 'changed']) await t.test(kind, async () => {
    const seed = kind === 'files' ? Object.fromEntries(Array.from({ length: 4097 }, (_, i) => ['/root/f' + i, '']))
      : kind === 'depth' ? { ['/root/' + 'd/'.repeat(32) + 'a']: 'a' } : { '/root/a': 'a' }
    const { fs } = memoryFs(seed), source = await openInstalledSourceFiles(fs, '/root')
    if (kind === 'bytes') { const stat = fs.stat; fs.stat = async target => { const info = await stat(target); return info?.type === 'file' ? { ...info, size: 16 * 1024 * 1024 + 1 } : info } }
    if (kind === 'entries') fs.listDir = async () => Array.from({ length: 20001 }, (_, i) => ({ name: 'f' + i, type: 'file', target: fs.target('/root/a') }))
    if (kind === 'changed') { const read = fs.readBytes; fs.readBytes = async (...args) => { const bytes = await read(...args); fs.versions.set('/root/a', 'v2'); return bytes } }
    await assert.rejects(source.captureTree(), kind === 'changed' ? /source_changed/ : /source_limit/)
  })
})

test('listed metadata rejects known file/directory drift before returning a capture', async t => {
  for (const kind of ['file-version', 'file-size', 'directory-version', 'directory-after-first-stat', 'size-without-stat-size']) await t.test(kind, async () => {
    const directory = kind.startsWith('directory'), file = directory ? '/root/d/a' : '/root/a'
    const { fs } = memoryFs({ [file]: 'new' }), source = await openInstalledSourceFiles(fs, '/root')
    const list = fs.listDir, stat = fs.stat
    fs.listDir = async target => (await list(target)).map(entry => {
      if (directory && entry.type === 'directory' && kind !== 'directory-after-first-stat') return { ...entry, version: 'v1' }
      if (!directory && entry.type === 'file') return { ...entry, ...(kind === 'file-version' ? { version: 'v1' } : { size: 2 }) }
      return entry
    })
    if (kind === 'file-version') fs.versions.set(file, 'v2')
    if (kind === 'directory-version') fs.versions.set('/root/d', 'v2')
    if (kind === 'directory-after-first-stat') {
      let first = true
      fs.stat = async target => {
        const info = await stat(target)
        if (first && target.targetKey === fs.target('/root/d').targetKey) { first = false; fs.versions.set('/root/d', 'v2') }
        return info
      }
    }
    if (kind === 'size-without-stat-size') fs.stat = async target => { const info = await stat(target); if (info?.type !== 'file') return info; const { size, ...unknownSize } = info; return unknownSize }
    await assert.rejects(source.captureTree(), error => error.code === 'studio.source_changed')
    if (['file-version', 'file-size', 'directory-version'].includes(kind)) assert.ok(!fs.calls.some(([op]) => op === 'readBytes'), 'known listing/first-stat conflicts fail before byte reads')
  })
})

test('listed optional metadata accepts absent/matching values and an unknown stat size without inventing values', async t => {
  for (const kind of ['absent', 'matching', 'listed-size-stat-unknown']) await t.test(kind, async () => {
    const { fs } = memoryFs({ '/root/d/a': binary }), source = await openInstalledSourceFiles(fs, '/root'), list = fs.listDir, stat = fs.stat
    if (kind !== 'absent') fs.listDir = async target => (await list(target)).map(entry => ({ ...entry,
      ...(kind === 'matching' ? { version: 'v1' } : {}), ...(entry.type === 'file' ? { size: binary.length } : {}) }))
    if (kind === 'listed-size-stat-unknown') fs.stat = async target => { const info = await stat(target); if (info?.type !== 'file') return info; const { size, ...unknownSize } = info; return unknownSize }
    assert.deepEqual(bytesAt({ files: await source.captureTree() }, 'd/a'), binary)
  })
})
