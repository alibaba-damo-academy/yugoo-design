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
    listKits: async () => { counts.kits++; return [] }, listBundles: async () => { counts.bundles++; return [] },
    loadRetainedKit: pin => { counts.kits++; return library.store.loadRetainedKit(pin) },
    resolveBundle: pin => { counts.bundles++; return library.store.resolveBundle(pin) },
  } }
  let reads = 0
  const studio = await createCompanionStudio(() => { reads++; return kit }, kitRoot, stateRoot, counted)
  const pin = { name: 'smart_questions', version: '1.0' }
  const workspace = await studio.workspace({})
  const warm = { ...counts }
  assert.equal(warm.kits, 0); assert.equal(warm.bundles, 0)
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
  assert.equal(counts.kits, 0); assert.equal(counts.bundles, 0)
  const refreshed = { ...counts }
  kit = { ...kit }
  await studio.readBundleWorkspace(pin)
  assert.ok(reads > 0)
})

test('failed retained catalog loads can be retried instead of poisoning the cache', async () => {
  const root = resolve('packages/skills-web-app/kits/web_app')
  let attempts = 0
  const kit = { name: 'empty', version: '1.0', skills: [], mindsetSource: '', sourceRoot: root }
  const studio = await createCompanionStudio(async () => { if (++attempts === 1) throw new Error('Transient catalog failure'); return kit }, root)
  await assert.rejects(studio.workspace({}), /Transient catalog failure/)
  assert.deepEqual((await studio.workspace({})).bundles, [])
  assert.ok(attempts >= 2)
})
