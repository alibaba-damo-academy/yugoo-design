import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, rm, symlink, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createStudioDraftPorts } from '../src/studio-panel-drafts.mjs'
import { loadStudioKit } from '../../studio/src/load.ts'
import { loadDesignBundle } from '../../core/lib/index.js'
import { companionFs } from '../src/project.mjs'

const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
let kitRoot
before(async () => {
  // Preserve explicit legacy-layout coverage; official content stays independent.
  kitRoot = await mkdtemp(join(tmpdir(), 'studio-legacy-draft-kit-'))
  await cp(join(packageRoot, 'kits/web_app/mindset.md'), join(kitRoot, 'mindset.md'))
  if ((await readdir(join(packageRoot, 'kits/web_app'))).includes('relations.yaml')) {
    await cp(join(packageRoot, 'kits/web_app/relations.yaml'), join(kitRoot, 'relations.yaml'))
  }
  await cp(join(packageRoot, 'bundles'), join(kitRoot, 'skills'), { recursive: true })
})
after(async () => { if (kitRoot) await rm(kitRoot, { recursive: true, force: true }) })
const kit = { name: 'web_app', version: '1.2' }
const bundle = { name: 'business_rules', version: '1.0' }
const sampleSource = JSON.stringify({ schema_version: 4, rules: { r1: { id: 'r1', title: 'A sample rule' } }, rule_order: ['r1'] })

test('independent closure retains mounted source bytes, pins and trusted origins across reopen', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'studio-independent-snapshot-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const ownedKit = join(temporary, 'source/kits/web_app'), ownedBundles = join(temporary, 'source/bundles')
  await cp(join(packageRoot, 'kits/web_app'), ownedKit, { recursive: true })
  await cp(join(packageRoot, 'bundles'), ownedBundles, { recursive: true })
  const locations = await Promise.all((await readdir(ownedBundles)).map(async name => { const rootDir = join(ownedBundles, name), sourceId = 'fixture:trusted-deployment'; const loaded = await loadDesignBundle(companionFs, { rootDir, sourceId }); return { name, version: String(loaded.skill.version), rootDir, sourceId } }))
  const installed = await loadStudioKit(companionFs, ownedKit, { bundles: locations })
  // The trusted port returns Core retained resource roots, not browser-selected paths.
  const options = { stateRoot: join(temporary, 'state'), kitRoot: ownedKit, readInstalledKit: () => installed,
    readInstalledBundle: pin => { const location = locations.find(location => location.name === pin.name && location.version === pin.version); return { resourceRoot: location.rootDir, sourceId: location.sourceId } } }
  const ports = await createStudioDraftPorts(options, 'panel')
  const retained = await ports.sources.capture(kit)
  const snapshot = await ports.sources.open(retained.id)
  assert.match(snapshot.root, /kits\/web_app$/)
  assert.equal(snapshot.loadOptions.bundles.length, installed.skills.length)
  assert.equal(snapshot.loadOptions.bundles.find(entry => entry.name === bundle.name).sourceId, 'fixture:trusted-deployment')
  assert.deepEqual((await loadStudioKit(snapshot.fs, snapshot.root, snapshot.loadOptions)).skills.map(skill => skill.authority), installed.skills.map(skill => skill.authority))
  await symlink(join(ownedKit, 'mindset.md'), join(ownedBundles, bundle.name, 'unexpected-link'))
  await assert.rejects(ports.sources.capture(kit), /symlinks/)
  await rm(join(ownedBundles, bundle.name, 'unexpected-link'))
  assert.equal((await ports.sources.capture({ ...kit, version: 'unpublished' })).id, retained.id, 'version provenance does not lock the current source capture')
  await rm(join(temporary, 'source'), { recursive: true, force: true })
  assert.deepEqual(await snapshot.fs.readText(join(snapshot.root, 'kit.yaml')), await (await ports.sources.open(retained.id)).fs.readText(join(snapshot.root, 'kit.yaml')))
  await assert.rejects(snapshot.fs.readText(join(snapshot.storageRoot, '..', 'outside')), /escapes/)
})

test('authoring store rejects installed-root writes and symlinked storage', async () => {
  await assert.rejects(createStudioDraftPorts({ stateRoot: kitRoot, kitRoot, readInstalledKit: () => kit }, 'panel'), /inside/)
  const root = await mkdtemp(join(tmpdir(), 'yugoo-studio-boundary-'))
  try {
    await symlink(kitRoot, join(root, 'studio-panel-drafts'))
    await assert.rejects(createStudioDraftPorts({ stateRoot: root, kitRoot, readInstalledKit: () => kit }, 'panel'), /symlink/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
