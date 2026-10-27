import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { copyDshDistributionMaterials } from './dsh-distribution-materials.mjs'
import { EMBEDDED_PICA_LICENSE_SOURCE_PATHS } from './companion-bundled-license.mjs'
import { parse } from 'yaml'
import { satisfies, subset, valid, validRange } from 'semver'
import { releasePackagesFor } from './release-consumer-config.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')

test('observed DSH Pica prebundle receives original embedded notices without weakening output or version guards', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pica-materials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  await mkdir(join(source, 'release'), { recursive: true })
  await mkdir(join(target, 'lib'), { recursive: true })
  for (const path of EMBEDDED_PICA_LICENSE_SOURCE_PATHS) {
    await mkdir(dirname(join(source, path)), { recursive: true })
    await cp(new URL('../' + path, import.meta.url), join(source, path))
  }
  const fixtureCode = '// material staging fixture; no Pica execution\n'
  await writeFile(join(target, 'lib/client.js'), fixtureCode)
  await writeFile(join(target, 'NOTICE'), 'Project notice\n')
  const selection = { observedOutputSha256: { 'lib/client.js': sha(fixtureCode) },
    components: [{ name: 'pica', version: '7.1.1', outputs: ['lib/client.js'] }], materials: [] }
  const manifest = { schemaVersion: 1, packages: { example: selection } }
  const path = join(source, 'release/dsh-distribution-materials.json')
  await writeFile(path, JSON.stringify(manifest))
  const result = await copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@example/panel' })
  assert.equal(Object.keys(result.copiedMaterials).length, 8)
  const index = JSON.parse(await readFile(join(target, result.index)))
  assert.deepEqual(index.embeddedPicaMaterials.parent, selection.components[0])
  assert.equal(index.embeddedPicaMaterials.currentRuntimeExecutionVerified, false)
  assert.equal(index.completeBundledInventoryVerified, false)
  for (const file of ['glur/LICENSE', 'inherits/LICENSE', 'multimath/LICENSE', 'object-assign/license', 'webworkify/LICENSE']) {
    const bytes = await readFile(new URL('../scripts/test-fixtures/pica-worker/source/' + file, import.meta.url))
    assert.deepEqual(await readFile(join(target, 'licenses/bundled-js/pica-embedded', file)), bytes)
    assert.equal(index.copiedMaterials['licenses/bundled-js/pica-embedded/' + file], sha(bytes))
  }
  selection.components[0].version = '99.0.0'
  await writeFile(path, JSON.stringify(manifest))
  await assert.rejects(copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@example/panel' }), /Unreviewed embedded Pica version/)
  selection.components[0].version = '7.1.1'
  await writeFile(path, JSON.stringify(manifest))
  await writeFile(join(target, 'lib/client.js'), 'changed')
  await assert.rejects(copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@example/panel' }), /observation is stale/)
})

test('Studio source observations stay bound to registered outputs and repository-relative sources', async () => {
  const manifest = JSON.parse(await readFile(new URL('../release/dsh-distribution-materials.json', import.meta.url)))
  for (const name of ['dsh-design-studio', 'dsh-design-studio-ui']) {
    const selection = manifest.packages[name]
    assert.equal(selection.normalBuildMaps.length, 1)
    const map = selection.normalBuildMaps[0]
    assert.equal(map.packedOutputSha256, selection.observedOutputSha256[map.output])
    assert.equal(map.sourceCount, map.projectOwnedSources.length)
    assert.equal(new Set(map.projectOwnedSources).size, map.sourceCount)
    assert.equal(map.actualArchiveOutputBindingVerified, false, 'new archive association is recorded only after packing')
    assert.ok(selection.historicalObservation.normalBuildMaps.some(previous => previous.actualArchiveOutputBindingVerified === true), 'retain the prior archive observation as history')
    assert.equal(map.sourceContentsVerified, true)
    for (const path of map.projectOwnedSources) {
      assert.ok(path.startsWith('packages/') && !path.includes('..') && !path.includes('\\'))
      assert.ok((await readFile(new URL('../' + path, import.meta.url))).length > 0)
    }
    assert.deepEqual(map.projectOwnedMaterials, ['LICENSE', 'NOTICE'])
  }
})

test('material packaging retains diagnostic observations but rejects changed output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yugoo-material-index-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  await mkdir(join(source, 'release'), { recursive: true })
  await mkdir(join(target, 'lib'), { recursive: true })
  await writeFile(join(target, 'lib/index.js'), 'export const example = 1;\n')
  await writeFile(join(target, 'NOTICE'), 'Project notice\n')
  const observation = { output: 'lib/index.js', sourceCount: 1, projectOwnedSources: ['packages/example/src/index.ts'] }
  const selection = {
    observedArchiveSha256: 'historical-archive',
    observedOutputSha256: { 'lib/index.js': sha('export const example = 1;\n') },
    normalBuildMaps: [observation], materials: [],
    components: [{ name: 'example', outputs: ['lib/index.js'] }],
    fonts: [{ matchingDataUrls: [{ output: 'lib/index.js' }] }],
    externalDependencies: {}, externalPeers: {}, limitations: ['bounded observation'],
  }
  await writeFile(join(source, 'release/dsh-distribution-materials.json'), JSON.stringify({ schemaVersion: 1, packages: { example: selection } }))
  await copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@yugoo-design/example' })
  const index = JSON.parse(await readFile(join(target, 'licenses/dsh-distribution.json')))
  assert.deepEqual(index.normalBuildMaps, [observation])
  assert.equal(index.completeBundledInventoryVerified, false)
  assert.equal(index.releaseLicenseAcceptance, false)
  assert.deepEqual(index.components, selection.components)
  assert.deepEqual(index.fonts, selection.fonts)
  for (const mutate of [
    value => { value.components[0].outputs = ['lib/old-chunk.js'] },
    value => { value.fonts[0].matchingDataUrls[0].output = 'lib/old-chunk.js' },
    value => { value.normalBuildMaps[0].output = 'lib/old-chunk.js' },
  ]) {
    const stale = structuredClone(selection)
    mutate(stale)
    await writeFile(join(source, 'release/dsh-distribution-materials.json'), JSON.stringify({ schemaVersion: 1, packages: { example: stale } }))
    await assert.rejects(copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@yugoo-design/example' }), /correspondence is stale/)
  }
  await writeFile(join(source, 'release/dsh-distribution-materials.json'), JSON.stringify({ schemaVersion: 1, packages: { example: selection } }))
  await writeFile(join(target, 'lib/index.js'), 'export const example = 2;\n')
  await assert.rejects(copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@yugoo-design/example' }), /observation is stale/)
  // A renamed chunk is a stale observation too; do not silently select a glob
  // match or copy another output just because the recorded member is absent.
  await rm(join(target, 'lib/index.js'))
  await assert.rejects(copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@yugoo-design/example' }), /observation is stale: example\/lib\/index\.js \(missing current output\)/)
  await writeFile(join(target, 'lib/renamed-current.js'), 'export const example = 1;\n')
  await assert.rejects(copyDshDistributionMaterials({ source, target, sourceName: 'example', packageName: '@yugoo-design/example' }), /observation is stale: example\/lib\/index\.js \(missing current output\)/)
})


test('reviewed direct runtime ranges are pinned compatibly without forcing unrelated major versions', async () => {
  const readJson = async path => JSON.parse(await readFile(new URL('../' + path, import.meta.url)))
  const materials = await readJson('release/dsh-distribution-materials.json')
  const config = parse(await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
  const reviewed = new Map()
  for (const [owner, selection] of Object.entries(materials.packages)) {
    if (owner.includes('decision-modeling')) continue
    for (const component of selection.components ?? []) {
      const versions = reviewed.get(component.name) ?? new Set()
      versions.add(component.version); reviewed.set(component.name, versions)
    }
  }
  const effectivePin = (name, specifier) => config.overrides[name] ?? Object.entries(config.overrides).find(([selector]) => {
    const at = selector.lastIndexOf('@')
    return at > 0 && selector.slice(0, at) === name && validRange(selector.slice(at + 1)) && subset(specifier, selector.slice(at + 1))
  })?.[1]
  let checked = 0
  for (const directory of Object.values(releasePackagesFor({ ladybugSource: 'registry' }))) {
    const manifest = await readJson(directory + '/package.json')
    for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
      const approved = reviewed.get(name)
      if (!approved || valid(specifier) || !validRange(specifier) || ![...approved].some(version => satisfies(version, specifier))) continue
      const pin = effectivePin(name, specifier)
      assert.ok(valid(pin) === pin && approved.has(pin), `Exact reviewed runtime pin required: ${name}@${specifier}`)
      assert.ok(satisfies(pin, specifier), `Pin cannot override the declared compatibility floor: ${name}`)
      checked++
    }
  }
  assert.ok(checked > 20)
  assert.equal(effectivePin('clsx', '1.1.1'), undefined)
  assert.equal(effectivePin('react', '^19.0.0'), undefined)
  const zod = materials.packages['dsh-design-core'].components.find(row => row.name === 'zod')
  assert.equal(config.overrides.zod, zod.version)
})

test('new Radix targets retain exact archive provenance and existing original grant, preserving prior versions', async () => {
  const materials = JSON.parse(await readFile(new URL('../release/dsh-distribution-materials.json', import.meta.url)))
  const lock = parse(await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'))
  for (const owner of ['dsh-design-panel', 'dsh-design-provider-web-app']) {
    const selection = materials.packages[owner]
    for (const [name, previousVersion, version] of [['@radix-ui/react-popover', '1.1.6', '1.1.23'], ['@radix-ui/react-arrow', '1.1.2', '1.1.15']]) {
      assert.ok(selection.components.find(row => row.name === name && row.version === previousVersion), 'prior target provenance must remain')
      const current = selection.components.find(row => row.name === name && row.version === version)
      assert.ok(current)
      assert.deepEqual(current.outputs, [], 'current output membership must come from the normal build receipt')
      assert.equal(current.source.integrity, lock.packages[name + '@' + version].resolution.integrity)
      assert.match(current.source.archiveSha256, /^[a-f0-9]{64}$/u)
      assert.equal(current.source.manifestMember, 'package/package.json')
      assert.equal(current.source.licenseMember, 'package/LICENSE')
      assert.equal(current.source.gitHead, undefined)
      for (const grant of current.materials) {
        const copied = selection.materials.find(row => row.path === grant.path)
        assert.ok(copied)
        assert.equal(sha(await readFile(new URL('../' + copied.source, import.meta.url))), grant.sha256)
        assert.equal(copied.sha256, grant.sha256)
      }
    }
  }
})

test('exact new metadata binds the new target while third-party drift remains rejected', async () => {
  const { bindObservedComponents } = await import('./dsh-release-observations.mjs')
  const materials = JSON.parse(await readFile(new URL('../release/dsh-distribution-materials.json', import.meta.url)))
  const selection = materials.packages['dsh-design-provider-web-app']
  for (const name of ['@radix-ui/react-popover', '@radix-ui/react-arrow']) {
    const component = selection.components.find(row => row.name === name && row.source?.manifestMember === 'package/package.json')
    const input = { name, version: component.version, packageMetadataSha256: component.packageMetadataSha256 }
    const bound = bindObservedComponents(selection, { 'lib/current.js': [input] })
    assert.equal(selection.components[bound.componentBindings[0].componentIndex], component)
    assert.throws(() => bindObservedComponents(selection, { 'lib/current.js': [{ ...input, packageMetadataSha256: 'f'.repeat(64) }] }), /component identity changed/)
  }
  assert.throws(() => bindObservedComponents(materials.packages['dsh-design-core'], {
    'lib/client.js': [{ name: 'zod', version: '4.6.7', packageMetadataSha256: 'f'.repeat(64) }],
  }), /component identity changed/)
})
