import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDesignKit, loadDesignBundle } from '../src/kit-loader.ts'
import { contentNodeFs, DesignContentStore } from '../src/content-store.ts'
import { ensureProjectKit, loadProjectKit } from '../src/project-kit-source.ts'
import { composeProjectKit, projectKitContentHash } from '../src/project-content.ts'
import { apply as applyKitLoader } from '../src/kit-loader-plugin.ts'
import { writeContentCatalog, writeContentBundle } from './fixtures/content-catalog.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'project-current-kit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = await writeContentCatalog(join(root, 'library'), { bundles: [{ name: 'alpha', files: { 'reference/a.bin': Buffer.from([0,255,128]) } }] })
  const options = { sourceId: 'trusted:project-source-fixture' }
  const kit = await loadDesignKit(contentNodeFs, source.root, options)
  const project = join(root, 'project')
  await mkdir(project)
  return { root, source, options, kit, project }
}

test('native Kit loading and project copying share binary resource semantics', async t => {
  const f = await fixture(t)
  let loaded
  await applyKitLoader({
    design: {
      assertKitInstallable() {},
      registerBundleContent() {},
      registerKitSource(kit) { loaded = kit; return { dispose() {} } },
    },
    effect(operation) { t.after(operation()) },
  }, {
    kitDir: f.kit.sourceRoot,
    bundleRoots: [{ rootDir: f.source.bundlesRoot, sourceId: `directory:${f.kit.sourceRoot}` }],
    watch: false,
  })
  assert.ok(loaded)
  const copied = await ensureProjectKit(f.project, { loadSource: async () => loaded })
  assert.equal(projectKitContentHash(copied.kit), projectKitContentHash(loaded))
  assert.deepEqual(await readFile(join(copied.kit.skills[0].resourceRoot, 'reference/a.bin')), Buffer.from([0,255,128]))
  assert.equal(loaded.resources['alpha/reference/a.bin'], undefined)
  assert.equal(loaded.skills[0].metadata.opaqueResources['reference/a.bin'].byteLength, 3)
})

test('project copying still rejects a real library change after source loading', async t => {
  const f = await fixture(t)
  await writeFile(join(f.source.bundlesRoot, 'alpha/reference/a.bin'), Buffer.from([1,2,3,4]))
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => f.kit }),
    /project Kit: source changed while copying; retry from the current source/)
})

test('project copying still detects physical source changes during copying', async t => {
  const f = await fixture(t)
  const original = f.kit.skills[0]
  const skill = { ...original }
  let changed = false
  Object.defineProperty(skill, 'sourceFs', { get() {
    // The Kit root is copied before the first Bundle. Change an unprojected
    // source file then, so this checks physical bytes rather than semantic refs.
    if (!changed) {
      changed = true
      writeFileSync(join(f.kit.sourceRoot, 'changed-during-copy.txt'), 'changed source bytes')
    }
    return original.sourceFs
  } })
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => ({ ...f.kit, skills: [skill] }) }),
    /project Kit: source changed while copying; retry from current source/)
  assert.equal(changed, true)
})

test('project owns full current sources and resources, independent from later library edits', async t => {
  const f = await fixture(t)
  const initial = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  assert.equal(initial.kit.sourceRoot, join(f.project, 'design_kit/kit'))
  const skill = initial.kit.skills[0], bundleRoot = join(f.project, 'design_kit/bundles/alpha')
  assert.equal(skill.resourceRoot, bundleRoot)
  assert.equal(skill.authority, f.kit.skills[0].authority)
  assert.deepEqual(await readFile(join(bundleRoot, 'reference/a.bin')), Buffer.from([0,255,128]))
  await writeFile(join(f.source.bundlesRoot, 'alpha/SKILL.md'), 'broken library now')
  assert.equal((await ensureProjectKit(f.project, { loadSource: () => { throw new Error('must not consult library') } })).revision, initial.revision)
  const method = await readFile(join(bundleRoot, 'SKILL.md'), 'utf8')
  await writeFile(join(bundleRoot, 'SKILL.md'), method + '\nCurrent project instruction.\n')
  const next = await loadProjectKit(f.project)
  assert.notEqual(next.revision, initial.revision)
  assert.match(next.kit.skills[0].content, /Current project instruction/)
  assert.equal(next.kit.skills[0].resourceRoot, bundleRoot)
  await writeFile(join(bundleRoot, 'skill.yaml'), (await readFile(join(bundleRoot, 'skill.yaml'), 'utf8')).replace('0.1', '99.0'))
  assert.equal((await loadProjectKit(f.project)).kit.skills[0].version, '99.0', 'source version is provenance, not a mount lock')
  await writeFile(join(bundleRoot, 'skill.yaml'), (await readFile(join(bundleRoot, 'skill.yaml'), 'utf8')).replace(/^version:.*\n/m, ''))
  assert.ok((await loadProjectKit(f.project)).kit.skills[0], 'current source does not require release metadata')
})

test('a real retained closure with effective Bundle override materializes after library removal', async t => {
  const f = await fixture(t), store = new DesignContentStore(join(f.root, 'old-host'))
  const base = await store.retainKitClosure(f.source.root, f.options)
  const replacement = await writeContentBundle(join(f.root, 'replacement'), { name: 'alpha', version: '0.2', files: { 'reference/override.bin': Buffer.from([1,2,255]) } })
  const target = await store.retainBundle(replacement.root, f.options)
  const effective = composeProjectKit({ name: base.name, version: base.version, bundles: { alpha: '0.2' } }, base, [target])
  await rm(f.source.root, { recursive: true })
  await rm(replacement.root, { recursive: true })
  const result = await ensureProjectKit(f.project, { loadSource: async () => effective })
  assert.equal(result.kit.skills[0].version, '0.2')
  assert.deepEqual(await readFile(join(result.kit.skills[0].resourceRoot, 'reference/override.bin')), Buffer.from([1,2,255]))
})

test('existing empty or malformed project source reports actual errors without fallback', async t => {
  const f = await fixture(t)
  await mkdir(join(f.project, 'design_kit'))
  let fallback = 0
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => { fallback++; return f.kit } }), /source.json/)
  assert.equal(fallback, 0)
  await rm(join(f.project, 'design_kit'), { recursive: true })
  const saved = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  await writeFile(join(saved.kit.skills[0].resourceRoot, 'schema.yaml'), 'type: [\n')
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => { fallback++; return f.kit } }))
  assert.equal(fallback, 0)
})

test('source copying rejects symlinks and keeps project data intact on failure', async t => {
  const f = await fixture(t)
  await writeFile(join(f.project, 'human-data.json'), '{"keep":true}')
  await symlink(join(f.project, 'human-data.json'), join(f.source.bundlesRoot, 'alpha/reference/symlink'))
  await assert.rejects(ensureProjectKit(f.project, { loadSource: async () => f.kit }), /symlink/)
  assert.equal(await readFile(join(f.project, 'human-data.json'), 'utf8'), '{"keep":true}')
})

test('unchanged project source reuses its parsed snapshot and still observes local edits', async t => {
  const f = await fixture(t)
  const first = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  assert.equal(await loadProjectKit(f.project, first), first)
  assert.equal(await ensureProjectKit(f.project, {
    previous: first, loadSource: () => { throw new Error('must not consult library') },
  }), first)
  const path = join(first.kit.skills[0].resourceRoot, 'reference/a.bin')
  await writeFile(path, Buffer.from([0, 65, 128]))
  const changed = await loadProjectKit(f.project, first)
  assert.notEqual(changed, first)
  assert.notEqual(changed.revision, first.revision)
  assert.notEqual(projectKitContentHash(changed.kit), projectKitContentHash(first.kit))
  await writeFile(join(changed.kit.skills[0].resourceRoot, 'schema.yaml'), 'type: [\n')
  await assert.rejects(loadProjectKit(f.project, changed), /YAML|parse|flow|sequence/i)
})

test('file-backed snapshot fingerprints do not serialize their captured resources again', async t => {
  const f = await fixture(t)
  const snapshot = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  const digest = projectKitContentHash(snapshot.kit)
  const resources = snapshot.kit.resources
  let reads = 0
  Object.defineProperty(snapshot.kit, 'resources', { get() { reads++; return resources } })
  assert.equal(projectKitContentHash(snapshot.kit), digest)
  assert.equal(projectKitContentHash(snapshot.kit), digest)
  assert.equal(reads, 0, 'an already captured snapshot needs no new resource traversal')
  const mutable = { ...snapshot.kit }
  const before = projectKitContentHash(mutable)
  mutable.mindset += '\nCaller-owned replacement.\n'
  assert.notEqual(projectKitContentHash(mutable), before, 'arbitrary caller objects are not memoized')
})

test('a cached snapshot cannot supply another project resource root', async t => {
  const f = await fixture(t)
  const first = await ensureProjectKit(f.project, { loadSource: async () => f.kit })
  const otherRoot = join(f.root, 'other-project')
  await mkdir(otherRoot)
  const other = await ensureProjectKit(otherRoot, { loadSource: async () => f.kit })
  assert.equal(first.revision, other.revision)
  const loaded = await loadProjectKit(otherRoot, first)
  assert.notEqual(loaded.kit, first.kit)
  assert.equal(loaded.kit.sourceRoot, join(otherRoot, 'design_kit/kit'))
})
