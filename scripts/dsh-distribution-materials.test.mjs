import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { copyDshDistributionMaterials } from './dsh-distribution-materials.mjs'
import { EMBEDDED_PICA_LICENSE_SOURCE_PATHS } from './companion-bundled-license.mjs'

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
