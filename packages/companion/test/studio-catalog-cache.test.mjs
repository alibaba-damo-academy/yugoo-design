import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { companionFs } from '../src/project.mjs'
import { createCompanionContentLibrary } from '../src/content-library.mjs'
import { createCompanionStudio } from '../src/studio.mjs'

test('retained catalog detail/file reads reuse compilation; refresh and host changes invalidate it', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-catalog-cache-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const kitRoot = resolve('packages/skills-web-app')
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot })
  let kit = await library.loadInstalled()
  const counts = { kits: 0, bundles: 0 }
  const counted = { store: {
    listKits: () => library.store.listKits(), listBundles: () => library.store.listBundles(),
    loadRetainedKit: pin => { counts.kits++; return library.store.loadRetainedKit(pin) },
    resolveBundle: pin => { counts.bundles++; return library.store.resolveBundle(pin) },
  } }
  const studio = await createCompanionStudio(() => kit, kitRoot, stateRoot, counted)
  const pin = { name: 'smart_questions', version: '1.0' }
  const workspace = await studio.workspace({})
  const warm = { ...counts }
  assert.ok(warm.kits > 0 && warm.bundles > 0)
  const detail = await studio.readBundleWorkspace(pin)
  assert.deepEqual(detail.diagnostics, [])
  const first = await studio.readBundleFile({ ...pin, path: 'SKILL.md' })
  const second = await studio.readBundleFile({ ...pin, path: 'skill.yaml' })
  assert.deepEqual(first.diagnostics, [])
  assert.deepEqual(second.diagnostics, [])
  assert.ok(first.file.content.includes('# Smart Questions'))
  assert.deepEqual(counts, warm, 'opening a Bundle and its files must not reload all installed definitions')
  const forbidden = await studio.readBundleFile({ ...pin, path: '../../project.json' })
  assert.equal(forbidden.file, undefined)
  assert.ok(forbidden.diagnostics.length > 0)
  const wrongPin = await studio.readBundleWorkspace({ ...pin, version: 'missing' })
  assert.equal(wrongPin.workspace, undefined)
  assert.ok(wrongPin.diagnostics.length > 0)
  assert.deepEqual((await studio.workspace({})).bundles, workspace.bundles)
  assert.ok(counts.kits > warm.kits && counts.bundles > warm.bundles, 'explicit refresh reloads the installed index')
  const refreshed = { ...counts }
  kit = { ...kit }
  await studio.readBundleWorkspace(pin)
  assert.ok(counts.kits > refreshed.kits && counts.bundles > refreshed.bundles, 'host Kit replacement invalidates compiled catalog')
})

test('failed retained catalog loads can be retried instead of poisoning the cache', async () => {
  const root = resolve('packages/skills-web-app/kits/web_app')
  let attempts = 0
  const library = { store: {
    listKits: async () => [],
    listBundles: async () => { if (++attempts === 1) throw new Error('Transient catalog failure'); return [] },
  } }
  const studio = await createCompanionStudio({ name: 'empty', version: '1.0', skills: [], mindsetSource: '', sourceRoot: root }, root, undefined, library)
  await assert.rejects(studio.workspace({}), /Transient catalog failure/)
  assert.deepEqual((await studio.workspace({})).bundles, [])
  assert.equal(attempts, 2)
})

test('adopting a validated Bundle invalidates a warm catalog before its new pin is read', async t => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'studio-catalog-adopt-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const kitRoot = resolve('packages/skills-web-app')
  const sourceLibrary = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot: join(stateRoot, 'source') })
  const sourceKit = await sourceLibrary.loadInstalled()
  const source = await createCompanionStudio(sourceKit, kitRoot, join(stateRoot, 'source'), sourceLibrary)
  const pin = { name: 'smart_questions', version: '1.0' }
  const archive = await source.exportContentArchive({ kind: 'bundle', pin,
    provenance: { source: 'fixture:catalog-invalidation', license: 'Apache-2.0' } })
  const targetRoot = join(stateRoot, 'target')
  await mkdir(targetRoot)
  const library = createCompanionContentLibrary({ fs: companionFs, kitRoot, stateRoot: targetRoot })
  let resolutions = 0
  const counted = { adoptPrepared: prepared => library.adoptPrepared(prepared), store: {
    listKits: () => library.store.listKits(), listBundles: () => library.store.listBundles(),
    loadRetainedKit: identity => library.store.loadRetainedKit(identity),
    resolveBundle: identity => { resolutions++; return library.store.resolveBundle(identity) },
  } }
  const target = await createCompanionStudio({ name: 'empty', version: '1.0', skills: [], mindsetSource: '',
    sourceRoot: resolve('packages/skills-web-app/kits/web_app') }, kitRoot, targetRoot, counted)
  assert.deepEqual((await target.workspace({})).bundles, [])
  assert.equal(resolutions, 0)
  const receipt = await target.prepareContentImport({ source: archive })
  const adopted = await target.adoptContentImport({ id: receipt.id })
  assert.equal(adopted.executionGranted, false)
  assert.deepEqual((await target.readBundleWorkspace(pin)).diagnostics, [])
  assert.equal(resolutions, 1, 'the first post-adoption detail read resolves the newly registered pin')
  assert.deepEqual((await target.readBundleFile({ ...pin, path: 'SKILL.md' })).diagnostics, [])
  assert.equal(resolutions, 1, 'subsequent file reads reuse the refreshed definition')
})
