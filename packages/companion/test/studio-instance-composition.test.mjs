import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, lstat, realpath, stat } from 'node:fs/promises'
import { join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { loadDesignBundle, deriveDesignBundleAuthorityId, parseFrontmatter } from 'dsh-design-core'
import { createStudioInstanceAdapters } from '../src/studio-instance-composition.mjs'
import { prepareStudioPanelPreview } from '../../studio/src/panel-preview.ts'

const packageRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))
const originalPin = { name: 'business_rules', version: '1.0' }
const otherPin = { name: 'smart_questions', version: '1.0' }
const kitPin = { name: 'web_app', version: '1.1' }
const sourceId = 'trusted:studio-adapter-test'
const entry = (path, text) => ({ path, base64: Buffer.from(text).toString('base64') })
const textOf = (files, path) => Buffer.from(files.find(file => file.path === path).base64, 'base64').toString('utf8')
async function captureDirectory(root) {
  const entries = []
  async function walk(path) {
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name), info = await lstat(file)
      assert.equal(info.isSymbolicLink(), false)
      if (info.isDirectory()) await walk(file)
      else entries.push({ path: relative(root, file).replaceAll('\\', '/'), base64: (await readFile(file)).toString('base64') })
    }
  }
  await walk(root); return entries
}
async function fixture() {
  const bundleFiles = new Map(await Promise.all([originalPin, otherPin].map(async pin => [pin.name, await captureDirectory(join(packageRoot, 'bundles', pin.name))])))
  const owned = await captureDirectory(join(packageRoot, 'kits/web_app'))
  let projected
  const trusted = {
    async listBundles() { return [originalPin, otherPin] },
    async captureBundle(pin) {
      if (pin.version !== '1.0' || !bundleFiles.has(pin.name)) throw new Error('Missing exact fixture source')
      return { files: structuredClone(bundleFiles.get(pin.name)), sourceId }
    },
    async captureKit(pin) { assert.deepEqual(pin, kitPin); return { files: projected } },
  }
  const adapters = createStudioInstanceAdapters(trusted)
  projected = await adapters.composition.projectMounts({ kit: kitPin, kitFiles: owned, mounts: [{ bindingKey: originalPin.name, ...originalPin }] })
  return { ...adapters, trusted, owned, projected, bundleFiles }
}
const mountsFor = (...pins) => pins.map(pin => ({ bindingKey: pin.runtimeName ?? pin.name, bundle: { name: pin.name, version: pin.version } }))

test('real Core catalog captures independent Bundle titles, runtime names and exact Kit mounts', async () => {
  const f = await fixture(), before = structuredClone([...f.bundleFiles])
  const catalog = await f.catalog.listBundles()
  assert.deepEqual(catalog.map(item => item.name), [originalPin.name, otherPin.name])
  assert.deepEqual(catalog[0].title, { zh: '业务规则', en: 'Business Rules' })
  assert.equal(catalog[0].runtimeName, originalPin.name)
  const captured = await f.catalog.captureKit(kitPin)
  assert.deepEqual(captured.mounts, [{ bindingKey: originalPin.name, ...originalPin }])
  assert.ok(captured.files.every(file => !file.path.startsWith('skills/')))
  await f.composition.validateKit({ kit: kitPin, kitFiles: captured.files, mounts: mountsFor(originalPin), resolveBundle: pin => f.catalog.captureBundle(pin) })
  assert.deepEqual([...f.bundleFiles], before)
  assert.equal(typeof f.composition.preview, 'function', 'retained preview uses the actual Core loaders by default')
})

test('fork changes only identity; real loader preserves runtime paths and cannot inherit original authority', async () => {
  const f = await fixture(), original = f.bundleFiles.get(originalPin.name)
  const binary = { path: 'reference/preserved.bin', base64: Buffer.from([0, 255, 128, 13, 10]).toString('base64') }
  const files = [...original, binary, entry('scripts/never-run.mjs', 'throw new Error("Studio must not execute Bundle scripts")\n')], forkPin = { name: 'local_bundle_storage_test', version: '1.0' }
  const fork = await f.composition.forkBundle({ files, from: originalPin, to: forkPin, runtimeName: originalPin.name })
  for (const file of files) if (file.path !== 'skill.yaml') assert.deepEqual(fork.find(item => item.path === file.path), file)
  const manifest = parse(textOf(fork, 'skill.yaml'))
  assert.equal(manifest.name, originalPin.name)
  assert.equal(manifest.identity, forkPin.name)
  assert.ok(textOf(fork, 'skill.yaml').endsWith(textOf(original, 'skill.yaml').slice(textOf(original, 'skill.yaml').indexOf('name:'))))
  const root = resolve('/adapter-fork-test'), map = new Map(fork.map(file => [resolve(root, file.path), Buffer.from(file.base64, 'base64')]))
  const fs = {
    async readText(path) { return map.get(path)?.toString('utf8') },
    async listDir(path) { const prefix = `${path}/`; return [...new Set([...map.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length).split('/')[0]))] },
    async isDirectory(path) { return [...map.keys()].some(key => key.startsWith(`${path}/`)) },
  }
  const compiled = await loadDesignBundle(fs, { rootDir: root, sourceId: `local:bundle:${forkPin.name}` }, forkPin)
  assert.equal(compiled.skill.name, originalPin.name)
  assert.equal(compiled.skill.catalogName, forkPin.name)
  assert.notEqual(compiled.skill.authority, deriveDesignBundleAuthorityId(sourceId, originalPin.name))
  const projected = await f.composition.projectMounts({ kit: kitPin, kitFiles: f.projected, mounts: [{ bindingKey: originalPin.name, ...forkPin }] })
  await f.composition.validateKit({ kit: kitPin, kitFiles: projected, mounts: mountsFor({ ...forkPin, runtimeName: originalPin.name }),
    resolveBundle: async () => ({ files: fork, sourceId: `local:bundle:${forkPin.name}` }) })
  const second = await f.composition.forkBundle({ files: fork, from: forkPin, to: { name: 'local_bundle_second', version: '1.0' }, runtimeName: originalPin.name })
  assert.equal(parse(textOf(second, 'skill.yaml')).identity, 'local_bundle_second')
  assert.equal(textOf(second, 'SKILL.md'), textOf(original, 'SKILL.md'))
})

test('Kit projection changes only declared identity/catalog slots and Core rejects mismatches', async () => {
  const f = await fixture(), original = textOf(f.owned, 'mindset.md')
  const newKit = { name: 'x', version: '1.0' }
  const projected = await f.composition.projectMounts({ kit: newKit, kitFiles: f.owned, mounts: [{ bindingKey: otherPin.name, ...otherPin }, { bindingKey: originalPin.name, ...originalPin }] })
  const body = textOf(projected, 'mindset.md')
  const stripOwned = text => text.replace(/^name:.*$/m, '').replace(/^version:.*$/m, '').replace(/<design_skills>[\s\S]*?<\/design_skills>/, '')
  assert.equal(stripOwned(body), stripOwned(original))
  assert.ok(body.includes('Maintain the coherent product background'))
  assert.ok(body.includes('Define testable preconditions'))
  await f.composition.validateKit({ kit: newKit, kitFiles: projected, mounts: mountsFor(otherPin, originalPin), resolveBundle: pin => f.catalog.captureBundle(pin) })
  await assert.rejects(f.composition.validateKit({ kit: newKit, kitFiles: projected, mounts: mountsFor(originalPin), resolveBundle: pin => f.catalog.captureBundle(pin) }), /authoritative kit.yaml/)
  const staleXml = projected.map(file => file.path === 'mindset.md' ? entry(file.path, body.replace('## smart_questions', '## absent_bundle')) : file)
  await assert.rejects(f.composition.validateKit({ kit: newKit, kitFiles: staleXml, mounts: mountsFor(otherPin, originalPin), resolveBundle: pin => f.catalog.captureBundle(pin) }), /catalog differs/)
  await assert.rejects(f.composition.projectMounts({ kit: newKit, kitFiles: f.projected, mounts: [{ bindingKey: 'wrong_runtime', ...originalPin }] }), /bindingKey must preserve/)
  await assert.rejects(f.composition.projectMounts({ kit: newKit, kitFiles: f.projected, mounts: [] }), /nonempty/)
})

test('real loader failures, unsafe captures, pin mismatch and absent authority are never successful validation', async () => {
  const f = await fixture(), files = f.bundleFiles.get(originalPin.name), target = { name: 'local_bundle_rejected', version: '1.0' }
  await assert.rejects(f.composition.forkBundle({ files, from: { ...originalPin, version: '99.0' }, to: { ...target, version: '99.0' }, runtimeName: originalPin.name }), /exact pin/)
  await assert.rejects(f.composition.forkBundle({ files, from: originalPin, to: target, runtimeName: 'wrong' }), /runtime name/)
  const invalid = files.map(file => file.path === 'schema.yaml' ? entry(file.path, 'properties: [') : file)
  await assert.rejects(f.composition.forkBundle({ files: invalid, from: originalPin, to: target, runtimeName: originalPin.name }))
  for (const bad of [[...files, entry('../escape', 'x')], [...files, files[0]], [...files, { path: 'invalid', base64: '!!!' }]]) {
    await assert.rejects(f.composition.forkBundle({ files: bad, from: originalPin, to: target, runtimeName: originalPin.name }), /path|base64/)
  }
  const noTrust = createStudioInstanceAdapters({ ...f.trusted, captureBundle: async () => ({ files }) })
  await assert.rejects(noTrust.catalog.captureBundle(originalPin), /source identity/)
  const absent = createStudioInstanceAdapters({ ...f.trusted, captureBundle: async () => ({ files: [], sourceId }) })
  await assert.rejects(absent.catalog.captureBundle(originalPin), /Missing/)
  const duplicated = createStudioInstanceAdapters({ ...f.trusted, listBundles: async () => [originalPin, originalPin] })
  await assert.rejects(duplicated.catalog.listBundles(), /Ambiguous/)
  await assert.rejects(f.composition.forkBundle({ files: Array.from({ length: 4097 }, (_, index) => entry(`f${index}`, '')), from: originalPin, to: target, runtimeName: originalPin.name }), /4096 files/)
})

test('identity-only YAML edit supports document directives, CRLF and flow mappings without rewriting methods', async () => {
  const f = await fixture(), original = f.bundleFiles.get(originalPin.name), manifest = textOf(original, 'skill.yaml')
  for (const source of [`%YAML 1.2\r\n---\r\n${manifest.replaceAll('\n', '\r\n')}`, JSON.stringify(parse(manifest))]) {
    const input = original.map(file => file.path === 'skill.yaml' ? entry(file.path, source) : file)
    const fork = await f.composition.forkBundle({ files: input, from: originalPin, to: { name: 'local_format_fork', version: '1.0' }, runtimeName: originalPin.name })
    assert.equal(parse(textOf(fork, 'skill.yaml')).identity, 'local_format_fork')
    assert.equal(textOf(fork, 'SKILL.md'), textOf(original, 'SKILL.md'))
    assert.equal(textOf(fork, 'validation.yaml'), textOf(original, 'validation.yaml'))
    assert.deepEqual(fork.filter(file => file.path !== 'skill.yaml'), input.filter(file => file.path !== 'skill.yaml'))
  }
})

test('new runtime catalog sections include real retained method descriptions; native-only forks reject', async () => {
  const f = await fixture(), original = f.bundleFiles.get(originalPin.name), forkPin = { name: 'local_described_fork', version: '1.0' }
  const fork = await f.composition.forkBundle({ files: original, from: originalPin, to: forkPin, runtimeName: originalPin.name })
  const withoutRules = await f.composition.projectMounts({ kit: kitPin, kitFiles: f.owned, mounts: [{ bindingKey: otherPin.name, ...otherPin }] })
  let resolves = 0
  const withFork = await f.composition.projectMounts({ kit: kitPin, kitFiles: withoutRules, mounts: [{ bindingKey: otherPin.name, ...otherPin }, { bindingKey: originalPin.name, ...forkPin }],
    resolveBundle: async pin => { resolves++; assert.deepEqual(pin, forkPin); return { files: fork, sourceId: `local:bundle:${forkPin.name}` } } })
  assert.equal(resolves, 1, 'unchanged authored sections are preserved, only newly mounted descriptions resolved')
  const description = parseFrontmatter(textOf(original, 'SKILL.md'), 'SKILL.md').meta.description
  assert.ok(textOf(withFork, 'mindset.md').includes(description))
  await f.composition.validateKit({ kit: kitPin, kitFiles: withFork, mounts: mountsFor(otherPin, { ...forkPin, runtimeName: originalPin.name }),
    resolveBundle: pin => pin.name === forkPin.name ? Promise.resolve({ files: fork, sourceId: `local:bundle:${forkPin.name}` }) : f.catalog.captureBundle(pin) })
  const malformed = f.projected.map(file => file.path === 'mindset.md' ? entry(file.path, textOf(f.projected, file.path).replace(/<design_skills>[\s\S]*?<\/design_skills>/, '<design_skills></design_skills>')) : file)
  await assert.rejects(f.composition.projectMounts({ kit: kitPin, kitFiles: malformed, mounts: [{ bindingKey: originalPin.name, ...originalPin }] }), /empty|malformed/)
  const nativeManifest = parse(textOf(original, 'skill.yaml'))
  nativeManifest.presentation = { mode: 'native', renderer: 'test.native-panel/v1' }
  delete nativeManifest.summary
  const native = original.filter(file => file.path !== 'panel.yaml' && !file.path.startsWith('locales/')).map(file => file.path === 'skill.yaml' ? entry(file.path, stringify(nativeManifest)) : file)
  await assert.rejects(f.composition.forkBundle({ files: native, from: originalPin, to: forkPin, runtimeName: originalPin.name }), /Native-only Bundles cannot be forked/)
})

test('standalone retained Bundle preview has no invented Kit and uses retained sample/compiled translations', async () => {
  const f = await fixture(), forkPin = { name: 'local_standalone_preview', version: '1.0' }
  const original = f.bundleFiles.get(originalPin.name)
  const fork = await f.composition.forkBundle({ files: original, from: originalPin, to: forkPin, runtimeName: originalPin.name })
  const sample = { schema_version: 4, rules: { r1: { id: 'r1', title: 'Retained sample' } }, rule_order: ['r1'] }
  const retained = fork.map(file => file.path === 'reference/preview.json' ? entry(file.path, JSON.stringify(sample)) : file)
  const input = { kind: 'bundle', bundle: forkPin, runtimeName: originalPin.name, sourceId: `local:bundle:${forkPin.name}`, bundleFiles: retained, revision: 7 }
  const result = await f.composition.preview(input)
  assert.deepEqual(result.diagnostics, [])
  assert.equal(result.preview.revision, 7)
  assert.equal(Object.hasOwn(result.preview, 'kit'), false)
  assert.deepEqual(result.preview.bundle, forkPin)
  assert.deepEqual(result.preview.sample, sample)
  assert.match(result.preview.panelYaml, /messages:/)
  assert.deepEqual(f.bundleFiles.get(originalPin.name), original)
  const explicit = await f.composition.preview({ ...input, sampleSource: JSON.stringify({ ...sample, rule_order: [] }) })
  assert.deepEqual(explicit.preview.sample.rule_order, [])
  const kitLie = await f.composition.preview({ ...input, kit: kitPin })
  assert.equal(kitLie.preview, undefined)
  assert.equal(kitLie.diagnostics[0].code, 'preview.request')
  const mismatch = await f.composition.preview({ ...input, bundle: { ...forkPin, version: '9.9' } })
  assert.equal(mismatch.preview, undefined)
  const wrongRuntime = await f.composition.preview({ ...input, runtimeName: 'wrong_runtime' })
  assert.equal(wrongRuntime.diagnostics[0].code, 'preview.bundle_pin')
  const invalidPanel = retained.map(file => file.path === 'panel.yaml' ? entry(file.path, 'components: [') : file)
  assert.equal((await f.composition.preview({ ...input, bundleFiles: invalidPanel })).preview, undefined)
  const oversized = retained.map(file => file.path === 'panel.yaml' ? entry(file.path, 'x'.repeat(1_048_577)) : file)
  assert.equal((await f.composition.preview({ ...input, bundleFiles: oversized })).diagnostics[0].code, 'preview.size')
})

test('retained preview sample fallback is explicit and never hides invalid reference or native definitions', async () => {
  const f = await fixture(), files = f.bundleFiles.get(originalPin.name)
  const input = { kind: 'bundle', bundle: originalPin, runtimeName: originalPin.name, sourceId, bundleFiles: files, revision: 1 }
  const missingReference = files.filter(file => file.path !== 'reference/preview.json')
  const initial = await f.composition.preview({ ...input, bundleFiles: missingReference })
  assert.deepEqual(initial.diagnostics, [])
  assert.deepEqual(initial.preview.sample, { schema_version: 4 })
  const invalidReference = files.map(file => file.path === 'reference/preview.json' ? entry(file.path, '{') : file)
  assert.equal((await f.composition.preview({ ...input, bundleFiles: invalidReference })).diagnostics[0].code, 'preview.sample_json')
  for (const [sampleSource, code] of [['[]', 'preview.sample_json'], ['{"schema_version":999}', 'preview.sample_schema'], ['x'.repeat(262145), 'preview.size']]) {
    const result = await f.composition.preview({ ...input, sampleSource })
    assert.equal(result.preview, undefined)
    assert.equal(result.diagnostics[0].code, code)
  }
  const panel = parse(textOf(files, 'panel.yaml')); delete panel.initial_values
  const withoutSample = missingReference.map(file => file.path === 'panel.yaml' ? entry(file.path, stringify(panel)) : file)
  assert.equal((await f.composition.preview({ ...input, bundleFiles: withoutSample })).diagnostics[0].code, 'preview.sample_missing')
  const nativeManifest = parse(textOf(files, 'skill.yaml')); nativeManifest.presentation = { mode: 'native', renderer: 'test.preview-native/v1' }; delete nativeManifest.summary
  const native = files.filter(file => file.path !== 'panel.yaml').map(file => file.path === 'skill.yaml' ? entry(file.path, stringify(nativeManifest)) : file)
  assert.equal((await f.composition.preview({ ...input, bundleFiles: native })).diagnostics[0].code, 'preview.not_declarative')
  assert.equal((await f.composition.preview({ ...input, revision: -1 })).diagnostics[0].code, 'preview.request')
})

test('retained Kit preview verifies real Kit and mount pins and captures revision before awaits', async () => {
  const f = await fixture(), retained = structuredClone(f.bundleFiles.get(originalPin.name))
  let reads = 0
  const input = { kind: 'kit', kit: { ...kitPin }, kitFiles: f.projected, bundle: { ...originalPin }, mounts: mountsFor(originalPin), revision: 8,
    resolveBundle: async pin => { reads++; assert.deepEqual(pin, originalPin); return { files: retained, sourceId } } }
  const pending = f.composition.preview(input)
  input.revision = 99; input.kit.name = 'other_kit'; input.bundle.version = '9.9'; input.sampleSource = '{}'
  const result = await pending
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.preview.kit, kitPin)
  assert.deepEqual(result.preview.bundle, originalPin)
  assert.equal(result.preview.revision, 8)
  assert.equal(reads, 1, 'compiled Panel and default sample use the same retained selected source')
  const base = { ...input, kit: kitPin, bundle: originalPin, revision: 9, sampleSource: undefined }
  assert.equal((await f.composition.preview({ ...base, kit: { ...kitPin, version: '9.9' } })).preview, undefined)
  assert.equal((await f.composition.preview({ ...base, bundle: otherPin })).diagnostics[0].code, 'preview.bundle_pin')
})

test('existing shared Kit preview keeps exact pin checks and compiles independent Panel overlays', async () => {
  const f = await fixture(), kitRoot = join(packageRoot, 'kits/web_app'), bundleRoot = join(packageRoot, 'bundles', originalPin.name)
  const overrides = new Map(f.projected.map(file => [join(kitRoot, file.path), Buffer.from(file.base64, 'base64').toString('utf8')]))
  const source = {
    async readText(path) { if (overrides.has(path)) return overrides.get(path); try { return await readFile(path, 'utf8') } catch (error) { if (error.code === 'ENOENT') return undefined; throw error } },
    listDir: path => readdir(path), isDirectory: async path => (await stat(path)).isDirectory(), realPath: path => realpath(path),
  }
  const options = { bundles: [{ ...originalPin, rootDir: bundleRoot, sourceId }] }
  const request = { kit: kitPin, bundle: originalPin, revision: 2, panelSource: textOf(f.bundleFiles.get(originalPin.name), 'panel.yaml'), sampleSource: '{"schema_version":4}' }
  const result = await prepareStudioPanelPreview(source, kitRoot, request, options)
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.preview.kit, kitPin)
  assert.equal((await prepareStudioPanelPreview(source, kitRoot, { ...request, kit: { ...kitPin, version: '9.9' } }, options)).diagnostics[0].code, 'preview.kit_pin')
  assert.equal((await prepareStudioPanelPreview(source, kitRoot, { ...request, bundle: { ...originalPin, version: '9.9' } }, options)).diagnostics[0].code, 'preview.bundle_pin')
  assert.equal((await prepareStudioPanelPreview(source, kitRoot, { ...request, panelSource: 'components: [' }, options)).diagnostics[0].code, 'preview.definition')
})
