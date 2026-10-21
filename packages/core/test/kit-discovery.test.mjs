import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, mkdir, readFile, writeFile, rename, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeContentCatalog } from './fixtures/content-catalog.mjs'
const { register } = await import('tsx/esm/api'); register()
const { apply } = await import('../src/kit-loader-plugin.ts')
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignBundleContributionRegistry } = await import('../src/runtime-drivers.ts')

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'kit-discovery-'))
  const source = await writeContentCatalog(join(root, 'source'))
  const kitContent = source.kitRoot
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'home')
  const design = Object.create(DesignService.prototype)
  design.kits = new Map(); design.contributions = new DesignBundleContributionRegistry()
  design.independentBundles = new Map(); design.retainedKits = new Map()
  const disposers = [], warnings = []
  const ctx = { design, effect: fn => disposers.push(fn()), logger: { warn: message => warnings.push(String(message)) } }
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose?.()
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
    await rm(root, { recursive: true, force: true })
  })
  const roots = join(root, 'kits'); await mkdir(roots)
  const bundles = join(root, 'bundles')
  await cp(source.bundlesRoot, bundles, { recursive: true })
  const applyFixture = config => apply(ctx, { bundleRoots: [{ rootDir: bundles, sourceId: 'package:independent' }], ...config })
  const copy = async (name = 'model', identity = 'catalog_fixture') => {
    const target = join(roots, name)
    await cp(kitContent, target, { recursive: true })
    if (identity !== 'catalog_fixture') {
      const path = join(target, 'mindset.md')
      await writeFile(path, (await readFile(path, 'utf8')).replace('name: catalog_fixture', `name: ${identity}`))
    }
    return target
  }
  return { root, roots, kitContent, ctx, design, warnings, copy, apply: applyFixture }
}
async function waitFor(fn) {
  const deadline = Date.now() + 8000
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('discovery did not converge')
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

test('auto-discovery loads the complete synthetic Kit, ignores unrelated dirs, and isolates conflicts', async t => {
  const f = await setup(t)
  await f.copy('a-model')
  await f.copy('b-duplicate')
  await mkdir(join(f.roots, 'empty'))
  await mkdir(join(f.roots, 'broken'))
  await writeFile(join(f.roots, 'broken', 'mindset.md'), 'not a Kit')
  await symlink(f.kitContent, join(f.roots, 'escape'), 'dir')
  await f.apply({ discoveryRoots: [f.roots, f.roots], watch: false })
  assert.equal(f.design.listKits().length, 1)
  assert.equal(f.design.latestKit('catalog_fixture').skills.length, 2)
  assert.equal(f.design.latestKit('catalog_fixture').sourceRoot, join(f.roots, 'a-model'))
  assert.ok(f.warnings.some(s => s.includes('duplicate Kit identity')))
  assert.ok(f.warnings.some(s => s.includes('broken')))
  assert.ok(!f.warnings.some(s => s.includes('escape')))
})

test('watch discovers additions and updates, retains last-good invalid/deleted source and pinned older version', async t => {
  const f = await setup(t)
  await f.apply({ discoveryRoots: [f.roots], watchUsePolling: true, watchPollIntervalMs: 20, watchStabilityThresholdMs: 40, watchDebounceMs: 20 })
  assert.equal(f.design.listKits().length, 0)
  const target = await f.copy()
  await waitFor(() => f.design.latestKit('catalog_fixture')).catch(error => { throw new Error(`${error.message}; diagnostics=${JSON.stringify(f.warnings)}`) })
  const initial = f.design.latestKit('catalog_fixture')
  const path = join(target, 'mindset.md'), original = await readFile(path, 'utf8')
  await writeFile(path, original.replace('version: "0.1"', 'version: "0.2"'))
  await waitFor(() => f.design.latestKit('catalog_fixture')?.version === '0.2')
  assert.equal(f.design.resolveKit({ kit: 'catalog_fixture', version: '0.1' }), initial)
  await writeFile(path, 'invalid')
  await waitFor(() => f.warnings.some(s => s.includes('rejected')))
  assert.equal(f.design.latestKit('catalog_fixture').version, '0.2')
  await rename(target, join(f.root, 'removed'))
  await waitFor(() => f.warnings.some(s => s.includes('source removed')))
  assert.ok(f.design.listKits().some(kit => kit.name === 'catalog_fixture'), 'last-good remains selectable for this process, not only resolvable by old pins')
  assert.equal(f.design.resolveKit({ kit: 'catalog_fixture', version: '0.1' }), initial)
  await f.copy('other-location')
  await waitFor(() => f.warnings.some(s => s.includes('duplicate Kit identity')))
  assert.equal(f.design.latestKit('catalog_fixture').sourceRoot, target)
  await rename(join(f.root, 'removed'), target)
  await writeFile(path, original.replace('version: "0.1"', 'version: "0.3"'))
  await waitFor(() => f.design.latestKit('catalog_fixture')?.version === '0.3')
  assert.equal(f.design.resolveKit({ kit: 'catalog_fixture', version: '0.1' }), initial)
})

test('explicit directory keeps authority when the same source is also discovered', async t => {
  const f = await setup(t), target = await f.copy()
  await f.apply({ kitDir: target, discoveryRoots: [f.roots], watch: false })
  assert.equal(f.design.listKits().length, 1)
  assert.equal(f.warnings.length, 0)
})

test('discovery without a Kit exposes independent unmounted Bundles with trusted authority', async t => {
  const f = await setup(t), bundles = join(f.root, 'bundles')
  await f.apply({discoveryRoots: [f.roots], watch: false})
  assert.deepEqual(f.design.listKits(), [])
  assert.equal(f.design.listBundles().length, 2)
  for (const skill of f.design.listBundles()) {
    assert.equal(f.design.resolveBundle({name: skill.name, version: String(skill.version)}).sourceId, 'package:independent')
    assert.equal(skill.resourceRoot, join(bundles, skill.name))
  }
})

test('default user root is optional and new Kits need no per-Kit configuration', async t => {
  const f = await setup(t)
  await f.apply({ watch: false })
  assert.equal(f.design.listKits().length, 0)
  const target = join(process.env.DSH_HOME, 'design-system', 'kits', 'model')
  await mkdir(join(target, '..'), { recursive: true })
  await cp(f.kitContent, target, { recursive: true })
  await f.apply({ watch: false })
  assert.equal(f.design.latestKit('catalog_fixture').skills.length, 2)
  await assert.rejects(f.apply({ discoveryRoots: ['relative'] }), /absolute/)
  for (const [key, value] of [['watch', 'yes'], ['watchUsePolling', 1], ['watchDebounceMs', 0], ['watchPollIntervalMs', -1], ['watchStabilityThresholdMs', 1.5]]) {
    await assert.rejects(f.apply({ discoveryRoots: [f.roots], [key]: value }), /must be/, key)
  }
})

test('watch notices a default root created after startup without creating it itself', async t => {
  const f = await setup(t)
  await f.apply({ watchUsePolling: true, watchPollIntervalMs: 20, watchStabilityThresholdMs: 40, watchDebounceMs: 20 })
  const root = join(process.env.DSH_HOME, 'design-system', 'kits')
  await assert.rejects(readFile(join(root, 'mindset.md')), /ENOENT/)
  await mkdir(root, { recursive: true })
  await cp(f.kitContent, join(root, 'model'), { recursive: true })
  await waitFor(() => f.design.latestKit('catalog_fixture'))
})
