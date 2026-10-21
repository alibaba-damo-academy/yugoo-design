import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { companionFs } from '../src/project.mjs'
import { createCompanionContentLibrary } from '../src/content-library.mjs'
import { createCompanionStudio } from '../src/studio.mjs'

test('actual Studio copies, mounts and deletes independent content without losing Bundle methods', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-independent-integration-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const kitRoot = resolve('packages/skills-web-app')
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot })
  const kit = await library.loadInstalled()
  const studio = await createCompanionStudio(kit, kitRoot, stateRoot, library)
  const selected = kit.skills.find(skill => skill.name === 'smart_questions')
  const pin = { name: selected.name, version: String(selected.version) }
  const before = await studio.readBundleFile({ ...pin, path: 'SKILL.md' })
  const independentInstalled = await studio.previewInstalledPanel({ bundle: pin, revision: 0 })
  assert.deepEqual(independentInstalled.diagnostics, [])
  assert.equal(Object.hasOwn(independentInstalled.preview, 'kit'), false)
  assert.deepEqual(independentInstalled.preview.bundle, pin)
  const bundle = await studio.copyInstance({ kind: 'bundle', bundle: pin })
  assert.equal(bundle.runtimeName, selected.name)
  assert.notEqual(bundle.bundle.name, pin.name)
  const standalonePreview = await studio.previewInstance({ id: bundle.id, expectedRevision: bundle.revision })
  assert.deepEqual(standalonePreview.diagnostics, [])
  assert.deepEqual(standalonePreview.preview.bundle, bundle.bundle)
  assert.equal(Object.hasOwn(standalonePreview.preview, 'kit'), false)
  assert.ok(standalonePreview.preview.panelYaml.length > 0)
  assert.equal((await studio.readInstanceFile({ id: bundle.id, path: 'SKILL.md' })).content, before.file.content)
  const copy = await studio.copyInstance({ kind: 'kit', kit: { name: kit.name, version: String(kit.version) } })
  assert.ok(copy.files.every(file => !file.path.startsWith('skills/') && !file.path.startsWith('bundles/')))
  const mounts = copy.mounts.map(mount => mount.bundle.name === pin.name
    ? { ...bundle.bundle, instanceId: bundle.id, revision: bundle.revision }
    : { name: mount.bundle.name, version: mount.bundle.version })
  const mounted = await studio.updateInstanceMounts({ id: copy.id, expectedRevision: copy.revision, bundles: mounts })
  assert.ok(mounted.mounts.some(mount => mount.bundle.instanceId === bundle.id && mount.bindingKey === selected.name))
  const mountedPreview = await studio.previewInstance({ id: mounted.id, expectedRevision: mounted.revision, bundle: bundle.bundle })
  assert.deepEqual(mountedPreview.diagnostics, [])
  assert.deepEqual(mountedPreview.preview.kit, mounted.kit)
  assert.deepEqual(mountedPreview.preview.bundle, bundle.bundle)
  await assert.rejects(studio.removeInstance({ id: bundle.id, expectedRevision: bundle.revision }))
  await studio.removeInstance({ id: mounted.id, expectedRevision: mounted.revision })
  const reopened = await createCompanionStudio(kit, kitRoot, stateRoot, library)
  assert.equal((await reopened.readInstanceFile({ id: bundle.id, path: 'SKILL.md' })).content, before.file.content)
  assert.equal((await reopened.readBundleFile({ ...pin, path: 'SKILL.md' })).file.content, before.file.content)
  const archive = await reopened.exportContentArchive({ kind: 'kit', pin: { name: kit.name, version: String(kit.version) }, provenance: { source: 'fixture:actual-kit', license: 'Apache-2.0' } })
  const targetState = join(stateRoot, 'separate-install')
  const targetLibrary = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot: targetState })
  // Start with no registered content in the target store; source input remains read-only.
  await (await import('node:fs/promises')).mkdir(targetState)
  const target = await createCompanionStudio(kit, kitRoot, targetState, targetLibrary)
  const receipt = await target.prepareContentImport({ source: archive })
  const adoption = await target.adoptContentImport({ id: receipt.id })
  assert.equal(adoption.executionGranted, false)
  assert.equal(adoption.contents.filter(item => item.kind === 'bundle').length, kit.skills.length)
  assert.equal((await targetLibrary.store.listKits()).length, 1)
  assert.equal((await targetLibrary.store.listBundles()).length, kit.skills.length)
  const imported = await targetLibrary.store.loadRetainedKit({ name: kit.name, version: String(kit.version) })
  assert.ok(imported.sourceRoot.startsWith(join(targetState, 'content/kits')))
  assert.ok(imported.skills.every(skill => skill.resourceRoot.startsWith(join(targetState, 'content/bundles'))))
  const repeated = await target.adoptContentImport({ id: receipt.id })
  assert.equal(repeated.executionGranted, false)
  assert.equal((await targetLibrary.store.listBundles()).length, kit.skills.length)
})
