import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionStudio } from '../src/studio.mjs'
import { loadDesignKit, createDirectoryBundleResolver } from '../../core/lib/index.js'

test('installed-source previews retain only registered synthetic chart bytes from the selected Kit', async () => {
  const packageRoot = fileURLToPath(new URL('../../skills-decision-modeling/', import.meta.url))
  const fs = { readText: async path => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error }), listDir: path => readdir(path) }
  const installed = await loadDesignKit(fs, packageRoot, { sourceId: 'companion:synthetic-preview-test' })
  const service = await createCompanionStudio(installed, packageRoot)
  const kit = { name: installed.name, version: String(installed.version) }
  for (const name of ['decision_results', 'decision_comparison']) {
    const skill = installed.skills.find(entry => entry.name === name)
    const result = await service.previewInstalledPanel({ kit, bundle: { name, version: String(skill.version) }, revision: 2 })
    assert.deepEqual(result.diagnostics, [])
    const mapping = JSON.parse(await readFile(join(packageRoot, 'bundles', name, 'reference/preview-artifacts.json'), 'utf8'))
    assert.equal(Object.keys(result.preview.artifacts).length, Object.keys(mapping.files).length)
    for (const [path, resource] of Object.entries(mapping.files)) {
      assert.equal(result.preview.artifacts[path], await readFile(join(packageRoot, 'bundles', name, resource), 'utf8'))
    }
    assert.deepEqual(result.preview.sample, JSON.parse(await readFile(join(packageRoot, 'bundles', name, 'reference/preview.json'), 'utf8')))
  }
})

test('official declarative Bundle previews load without caller-authored JSON', async () => {
  const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
  const root = join(packageRoot, 'kits/web_app')
  const metadata = parse((await readFile(join(root, 'mindset.md'), 'utf8')).split('---')[1])
  const kit = { name: metadata.name, version: String(metadata.version) }
  const fs = { readText: async path => readFile(path, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error }), listDir: path => readdir(path) }
  const installed = await loadDesignKit(fs, root, { sourceId: 'companion:explicit-kit', resolveBundle: createDirectoryBundleResolver(fs, [{ rootDir: join(packageRoot, 'bundles'), sourceId: 'companion:explicit-kit' }]) })
  const service = await createCompanionStudio(installed, root)
  let count = 0
  for (const name of await readdir(join(packageRoot, 'bundles'))) {
    const manifest = parse(await readFile(join(packageRoot, 'bundles', name, 'skill.yaml'), 'utf8'))
    if (manifest.presentation?.mode !== 'declarative') continue
    const result = await service.previewInstalledPanel({ kit, bundle: { name, version: String(manifest.version) }, revision: 1 })
    assert.deepEqual(result.diagnostics, [], `${name}: default preview must compile`)
    assert.ok(result.preview, `${name}: no manual JSON prerequisite`)
    count++
  }
  assert.equal(count, 15, 'cover all official declarative Bundles explicitly')
})

test('Studio reuses installed Kit catalog and byte-exact sources through authenticated read-only methods', async () => {
  const f = await fixture()
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const catalog = await call('studioWorkspace', { query: '' })
    assert.equal(catalog.kits[0].name, 'web_app')
    const kit = await call('studioKit', { name: catalog.kits[0].name, version: catalog.kits[0].version })
    assert.equal(kit.workspace.mindsetSource, await readFile(join(f.options.kitRoot, 'mindset.md'), 'utf8'))
    const bundle = await call('studioBundle', { name: 'smart_questions' })
    assert.equal(bundle.diagnostics.length, 0)
    const file = await call('studioFile', { name: 'smart_questions', path: 'SKILL.md' })
    assert.equal(file.file.content, await readFile(join(f.options.kitRoot, 'skills/smart_questions/SKILL.md'), 'utf8'))
    const forbidden = await call('studioFile', { name: 'smart_questions', path: '../../project.json' })
    assert.ok(forbidden.diagnostics.length > 0)
    for (const name of ['..', '../smart_questions', '/smart_questions', 'skills/smart_questions', 'unknown']) {
      for (const path of ['package.json', 'mindset.md']) {
        const result = await call('studioFile', { name, path })
        assert.equal(result.file, undefined)
        assert.ok(result.diagnostics.length > 0)
      }
      const result = await call('studioBundle', { name })
      assert.equal(result.workspace, undefined)
      assert.ok(result.diagnostics.length > 0)
    }
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})

test('installed preview is confined sample-only inspection, not a retained draft or native request', async () => {
  const f = await fixture()
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const workspace = await call('studioWorkspace', { query: '' })
    const kit = { name: workspace.kits[0].name, version: workspace.kits[0].version }
    const entry = workspace.bundles.find(bundle => bundle.name === 'smart_questions')
    const bundle = { name: entry.name, version: entry.version }
    const sourceFile = join(f.options.kitRoot, 'skills/smart_questions/panel.yaml')
    const original = await readFile(sourceFile, 'utf8')
    const previewFile = join(f.options.kitRoot, 'skills/smart_questions/reference/preview.json')
    // This is the fixture's private Kit copy, never the installed source.
    await rm(previewFile, { force: true })
    const before = await readdir(f.options.stateRoot)
    const projectBefore = await readdir(join(f.options.projectRoot, 'design_files'))
    const missing = await call('studioInstalledPreview', { kit, bundle, revision: 2 })
    assert.equal(missing.preview, undefined)
    assert.equal(missing.diagnostics[0].code, 'preview.sample_missing')
    const input = { kit, bundle, revision: 3, sampleSource: '{"questions":{}}' }
    const result = await call('studioInstalledPreview', input)
    assert.deepEqual(result.diagnostics, [])
    assert.equal(result.preview.revision, 3)
    assert.deepEqual(result.preview.kit, kit)
    assert.deepEqual(result.preview.bundle, bundle)
    const sample = { questions: { user: { prompt: 'Isolated sample', kind: 'text', answer: '' } } }
    const edited = await call('studioInstalledPreview', { ...input, revision: 4, sampleSource: JSON.stringify(sample) })
    assert.deepEqual(edited.diagnostics, [])
    assert.deepEqual(edited.preview.sample, sample)
    // Fresh default requests cannot inherit edits to a previous preview.
    assert.deepEqual((await call('studioInstalledPreview', input)).preview.sample, result.preview.sample)
    for (const patch of [
      { kit: { ...kit, version: 'missing' } }, { bundle: { ...bundle, version: 'missing' } },
      { bundle: { ...bundle, name: '../smart_questions' } }, { revision: -1 },
      { sampleSource: '[' }, { sampleSource: '[]' }, { sampleSource: '{"questions":{"invalid":{}}}' },
      { sampleSource: ' '.repeat(262_145) },
    ]) {
      const failed = await call('studioInstalledPreview', { ...input, ...patch })
      assert.equal(failed.preview, undefined)
      assert.ok(failed.diagnostics.length > 0)
    }
    assert.equal(await readFile(sourceFile, 'utf8'), original)
    assert.deepEqual(await readdir(f.options.stateRoot), before)
    assert.deepEqual(await readdir(join(f.options.projectRoot, 'design_files')), projectBefore)
    assert.equal(f.messages.length, 0)
    // This path works without any draft storage configuration.
    const service = await createCompanionStudio(() => ({ ...kit, skills: [] }), f.options.kitRoot)
    assert.deepEqual((await service.previewInstalledPanel(input)).diagnostics, [])
    // Existing declared initialization is used, not a guessed Bundle-name fixture.
    await writeFile(sourceFile, `${original}\ninitial_values: {}\n`)
    const initialized = await service.previewInstalledPanel({ kit, bundle, revision: 5 })
    assert.deepEqual(initialized.diagnostics, [])
    assert.deepEqual(initialized.preview.sample, {})
    const authoredSample = { questions: { demo: { prompt: 'Authored preview question', kind: 'text', answer: '' } } }
    await writeFile(previewFile, JSON.stringify(authoredSample))
    const authored = await service.previewInstalledPanel({ kit, bundle, revision: 6 })
    assert.deepEqual(authored.diagnostics, [])
    assert.deepEqual(authored.preview.sample, authoredSample, 'preview sample takes precedence over runtime initialization')
    assert.deepEqual((await service.previewInstalledPanel(input)).preview.sample, { questions: {} }, 'explicit isolated input takes precedence over authored sample')
    await writeFile(previewFile, '{')
    assert.equal((await service.previewInstalledPanel({ kit, bundle, revision: 7 })).diagnostics[0].code, 'preview.sample_json', 'invalid authored data never falls back silently')
    await writeFile(previewFile, '{"questions":{"invalid":{}}}')
    assert.equal((await service.previewInstalledPanel({ kit, bundle, revision: 8 })).diagnostics[0].code, 'preview.sample_schema')
    await writeFile(previewFile, ' '.repeat(262_145))
    assert.equal((await service.previewInstalledPanel({ kit, bundle, revision: 9 })).diagnostics[0].code, 'preview.size')
    await writeFile(previewFile, Buffer.from([0, 255, 0]))
    const binarySample = await service.previewInstalledPanel({ kit, bundle, revision: 10 })
    assert.equal(binarySample.preview, undefined)
    assert.equal(binarySample.diagnostics[0].code, 'preview.definition', 'the existing resource loader rejects binary JSON before sample selection')
    await writeFile(previewFile, JSON.stringify(authoredSample))
    assert.deepEqual(await readdir(f.options.stateRoot), before)
    assert.deepEqual(await readdir(join(f.options.projectRoot, 'design_files')), projectBefore)
    assert.equal(f.messages.length, 0)
    await writeFile(sourceFile, original)
  } finally { await f.close() }
})
