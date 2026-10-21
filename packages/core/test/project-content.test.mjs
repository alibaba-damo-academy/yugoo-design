import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeContentBundle } from './fixtures/content-catalog.mjs'
import DesignService, {
  DesignContentStore, contentNodeFs, loadDesignBundle,
  composeProjectKit, projectKitContentHash, projectBundleOverrides, parseDesignProjectMetadata,
  groupContentVersions, latestInstalledKit, DesignBundleContributionRegistry,
} from '../lib/index.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'project-versions-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const kitRoot = join(root, 'kit'), bundleRoot = join(root, 'bundles'), name = 'alpha'
  await mkdir(kitRoot); await mkdir(bundleRoot)
  const sourceId = 'fixture:trusted-source'
  for (const version of ['1.0', '1.1']) {
    const path = join(bundleRoot, version)
    await writeContentBundle(path, { name, version })
    if (version === '1.1') {
      await writeFile(join(path, 'SKILL.md'), `${await readFile(join(path, 'SKILL.md'), 'utf8')}\nVersion-specific professional method.\n`)
      await writeFile(join(path, 'reference/version.txt'), 'target resource 1.1')
    }
  }
  await writeFile(join(kitRoot, 'mindset.md'), '---\nname: version_fixture\nversion: "1.0"\n---\n<design_skills>\n\n## alpha\n\nFixture method.\n\n</design_skills>\n')
  await writeFile(join(kitRoot, 'kit.yaml'), 'version: 1\nmounts: [{bindingKey: alpha, name: alpha, version: "1.0"}]\n')
  const resolver = pin => pin.name === name && ['1.0', '1.1'].includes(pin.version)
    ? loadDesignBundle(contentNodeFs, { rootDir: join(bundleRoot, pin.version), sourceId }, pin) : undefined
  const store = new DesignContentStore(join(root, 'state'))
  const kit = await store.retainKitClosure(kitRoot, { sourceId, resolveBundle: resolver })
  const target = await store.retainBundle(join(bundleRoot, '1.1'), { sourceId })
  return { root, kitRoot, bundleRoot, store, kit, target, sourceId, resolver, name }
}

test('project resolves one whole exact closure for method, schema, Panel, summary and resources after reopen', async t => {
  const f = await fixture(t), basePin = { name: f.kit.name, version: f.kit.version }
  const pin = { ...basePin, bundles: { [f.name]: '1.1' } }
  const effective = await f.store.resolveProjectKit(pin)
  const target = effective.skills[0]
  assert.equal(target.version, '1.1')
  assert.match(target.content, /Version-specific professional method/)
  assert.equal(target.metadata.schemaYaml, f.target.skill.metadata.schemaYaml)
  assert.equal(target.metadata.panelYaml, f.target.skill.metadata.panelYaml)
  assert.deepEqual(target.metadata.skillManifest.summary, f.target.skill.metadata.skillManifest.summary)
  assert.equal(effective.resources[`${f.name}/reference/version.txt`], 'target resource 1.1')
  assert.equal((await f.store.resolveProjectKit(basePin)).skills[0].version, '1.0', 'other projects stay on the Kit composition')
  await rm(f.kitRoot, { recursive: true }); await rm(f.bundleRoot, { recursive: true })
  const reopened = await new DesignContentStore(join(f.root, 'state')).resolveProjectKit({ ...pin, contentHash: projectKitContentHash(effective) })
  assert.equal(reopened.skills[0].version, '1.1')
  assert.equal(projectKitContentHash(reopened), projectKitContentHash(effective))
})

test('unmounted identity, unavailable exact version and definition drift fail closed', async t => {
  const f = await fixture(t), pin = { name: f.kit.name, version: f.kit.version }
  await assert.rejects(f.store.resolveProjectKit({ ...pin, bundles: { invented: '1.1' } }), /not mounted/)
  await assert.rejects(f.store.resolveProjectKit({ ...pin, bundles: { [f.name]: '9.9' } }), /unavailable exact/)
  await assert.rejects(f.store.resolveProjectKit({ ...pin, contentHash: '0'.repeat(64) }), /pinned definitions changed/)
  assert.deepEqual(projectBundleOverrides({ ...pin, bundles: { [f.name]: '1.0' } }, f.kit), [])
})

test('replacement cannot change runtime path or acquire another source authority', async t => {
  const f = await fixture(t), pin = { name: f.kit.name, version: f.kit.version, bundles: { [f.name]: '1.1' } }
  assert.throws(() => composeProjectKit(pin, f.kit, [{ ...f.target, skill: { ...f.target.skill, name: 'different_path' } }]), /exact Bundle|runtime binding/)
  const alien = await loadDesignBundle(contentNodeFs, { rootDir: join(f.bundleRoot, '1.1'), sourceId: 'untrusted:copied-identity' })
  assert.throws(() => composeProjectKit(pin, f.kit, [alien]), /trusted Bundle provenance/)
})

test('metadata pins accept only bounded exact overrides and stable fingerprints', async t => {
  const f = await fixture(t)
  const metadata = { kind: 'dsh-design-project', formatVersion: 3, id: '11111111-1111-4111-8111-111111111111',
    name: 'fixture', createdAt: '2026-10-08T00:00:00.000Z', knowledge: { provider: 'ladybug-wasm' },
    kit: { name: f.kit.name, version: f.kit.version, bundles: { [f.name]: '1.1' }, contentHash: projectKitContentHash(f.kit) } }
  assert.deepEqual(parseDesignProjectMetadata(metadata).kit, metadata.kit)
  assert.throws(() => parseDesignProjectMetadata({ ...metadata, kit: { ...metadata.kit, bundles: { [f.name]: '^1.1' } } }), /expected major.minor/)
  assert.throws(() => parseDesignProjectMetadata({ ...metadata, kit: { ...metadata.kit, bundles: { '../x': '1.1' } } }), /invalid catalog/)
  assert.throws(() => parseDesignProjectMetadata({ ...metadata, kit: { ...metadata.kit, contentHash: 'guess' } }), /fingerprint/)
})

test('service exact project resolution rejects unsupported native runtime and never falls back to another Bundle', async t => {
  const f = await fixture(t)
  const design = Object.create(DesignService.prototype)
  design.kits = new Map(); design.retainedKits = new Map(); design.independentBundles = new Map()
  design.contributions = new DesignBundleContributionRegistry()
  design.registerRetainedKit(f.kit); design.registerBundleContent(f.target, { retained: true })
  const pin = { name: f.kit.name, version: f.kit.version, bundles: { [f.name]: '1.1' } }
  assert.equal(design.resolveProjectKit(pin).skills[0].version, '1.1')
  const unsupported = { ...f.target, skill: { ...f.target.skill, version: '1.2', metadata: { ...f.target.skill.metadata,
    skillManifest: { ...f.target.skill.metadata.skillManifest, runtime: { driver: 'fixture/missing' } } } } }
  design.registerBundleContent(unsupported, { retained: true })
  assert.throws(() => design.resolveProjectKit({ ...pin, bundles: { [f.name]: '1.2' } }), /missing|runtime/i)
})

test('catalog groups versions within one identity, keeps forks distinct, and orders numeric versions', () => {
  const items = [{ name: 'original', version: '1.9' }, { name: 'original', version: '1.10' }, { name: 'my_fork', version: '1.9' }]
  const groups = groupContentVersions(items)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].latest.version, '1.10')
  assert.deepEqual(groups[0].versions.map(item => item.version), ['1.10', '1.9'])
  assert.equal(latestInstalledKit(items, 'original').version, '1.10')
})
