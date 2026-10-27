import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bindObservedComponents, dataUrls, observeDshBuild } from './dsh-release-observations.mjs'
import { copyDshDistributionMaterials, hydrateDshSelection, FIRST_PARTY_MATERIAL } from './dsh-distribution-materials.mjs'
import { captureOutputModuleMap, verifyOutputModuleFiles } from './companion-output-module-map.mjs'
import { withNormalBuildEvidence } from './normal-build-module-evidence.mjs'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const component = { name: 'example', version: '1.2.3', packageMetadataSha256: 'a'.repeat(64), outputs: ['lib/old.js'], correspondence: 'bounded source material selection' }

test('current component associations require actual identity; absent old associations remain historical', () => {
  const selection = { components: [component, { ...component, name: 'historical-only' }] }
  const bound = bindObservedComponents(selection, { 'lib/new.js': [{ name: 'example', version: '1.2.3', packageMetadataSha256: 'a'.repeat(64) }] })
  assert.deepEqual(bound.componentBindings, [{ componentIndex: 0, outputs: ['lib/new.js'] }])
  assert.equal(bound.historicalComponentsWithoutCurrentAssociation[0].name, 'historical-only')
  for (const module of [{ name: 'example', version: '1.2.4', packageMetadataSha256: 'a'.repeat(64) }, { name: 'example', version: '1.2.3', packageMetadataSha256: 'b'.repeat(64) }, { name: 'example', version: '1.2.3', packageMetadataSha256: 'b'.repeat(64), firstParty: true }]) assert.throws(() => bindObservedComponents(selection, { 'lib/new.js': [module] }), /component identity changed/)
  assert.equal(bindObservedComponents(selection, { 'lib/new.js': [{ name: 'unrecorded', version: '1.0.0' }] }).unassociatedObservedModules.length, 1)
})
test('fonts are associated by actual decoded data bytes, not old chunk names', () => {
  const font = Buffer.from('font fixture'), code = 'x="data:font/woff2;base64,' + font.toString('base64') + '"'
  assert.deepEqual(dataUrls(code), [{ mediaType: 'font/woff2', bytes: font.length, sha256: sha(font) }])
})
test('large embedded resources in a bundle with non-ASCII UI text retain their decoded identity', () => {
  const bytes = Buffer.alloc(8 * 1024 * 1024, 42)
  const code = '// 中文界面\nconst font="data:font/woff2;base64,' + bytes.toString('base64') + '";'
  assert.deepEqual(dataUrls(code), [{ mediaType: 'font/woff2', bytes: bytes.length, sha256: sha(bytes) }])
})
test('data URL scanning preserves multiple resources, padding and unsupported header boundaries', () => {
  const code = `data:;base64,eA== data:text/plain;charset=utf8;base64,eA==
    data:text/plain;BASE64,eA== data:text/plain;base64,!
    "data:text/plain;base64,eA===" 'data:font/woff2;base64,+/8='
    data:text/plain;base64,eA`
  const text = Buffer.from('x'), binary = Buffer.from([251, 255])
  assert.deepEqual(dataUrls(code), [
    { mediaType: 'text/plain', bytes: text.length, sha256: sha(text) },
    { mediaType: 'font/woff2', bytes: binary.length, sha256: sha(binary) },
    { mediaType: 'text/plain', bytes: text.length, sha256: sha(text) },
  ])
})
test('hydration keeps maintained identities/materials and rejects forged component/font bindings', () => {
  const base = { components: [component], fonts: [{ sha256: 'b'.repeat(64), licensePath: 'original/OFL.txt' }], materials: [{ path: 'licenses/example', sha256: 'c'.repeat(64) }], limitations: ['existing limitation'], historicalObservation: { retained: true } }
  const observed = { observedOutputSha256: { 'lib/new.js': 'd'.repeat(64) }, componentBindings: [{ componentIndex: 0, outputs: ['lib/new.js'] }],
    fontBindings: [{ fontIndex: 0, matchingDataUrls: [{ output: 'lib/new.js', sha256: 'b'.repeat(64) }] }], normalBuildMaps: [] }
  const current = hydrateDshSelection(base, observed)
  assert.deepEqual(current.materials, base.materials); assert.deepEqual(current.limitations, base.limitations)
  assert.equal(current.components[0].packageMetadataSha256, component.packageMetadataSha256)
  assert.equal(current.components[0].correspondence, component.correspondence)
  assert.deepEqual(current.currentBuildAssociation.historicalObservation, base)
  for (const bad of [{ ...observed, componentBindings: [{ componentIndex: 2, outputs: ['lib/new.js'] }] },
    { ...observed, componentBindings: [{ componentIndex: 0, outputs: ['lib/old.js'] }] },
    { ...observed, fontBindings: [{ fontIndex: 0, matchingDataUrls: [{ output: 'lib/new.js', sha256: 'e'.repeat(64) }] }] }]) assert.throws(() => hydrateDshSelection(base, bad))
})
test('normal observer preserves existing configs and is inert when disabled', () => {
  const previous = process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR
  delete process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR
  try {
    const config = { entry: ['src/index.ts'], clean: true }
    assert.equal(withNormalBuildEvidence('example', config), config)
    const configs = [config, { entry: ['src/client.ts'] }]
    assert.equal(withNormalBuildEvidence('example', configs), configs)
  } finally { if (previous === undefined) delete process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR; else process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR = previous }
})
test('real changed first-party metadata binds current identity, keeps prior hash historical and rejects missing or forged identity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-current-observation-')); t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'source'), packageRoot = join(workspace, 'packages/example'), output = join(packageRoot, 'lib'), evidence = join(root, 'normal-build')
  await mkdir(output, { recursive: true }); await mkdir(evidence)
  const moduleFile = join(packageRoot, 'src/index.ts'); await mkdir(join(packageRoot, 'src'))
  const metadata = Buffer.from(JSON.stringify({ name: 'example', version: '1.2.3' }))
  const currentMetadata = Buffer.from(JSON.stringify({ name: 'example', version: '1.2.3', peerDependencies: { react: '^18.2.0' } }))
  await writeFile(join(packageRoot, 'package.json'), currentMetadata); await writeFile(moduleFile, 'export const value = 1\n')
  const normalCode = 'export const value = 1;\n'; await writeFile(join(output, 'new.js'), normalCode)
  const chunk = { type: 'chunk', fileName: 'new.js', outDir: output, code: normalCode, isEntry: true, isDynamicEntry: false, facadeModuleId: moduleFile,
    imports: [], dynamicImports: [], moduleIds: [moduleFile], modules: { [moduleFile]: { code: 'const value = 1;', renderedLength: 16, renderedExports: ['value'] } } }
  // Keep the fixture's rendered-length invariant equal to its code string.
  chunk.modules[moduleFile].renderedLength = chunk.modules[moduleFile].code.length
  const snapshot = await verifyOutputModuleFiles(captureOutputModuleMap('dsh-release-example-0', [chunk], { workspaceRoot: workspace, outputRoot: output }))
  snapshot.inputFileSha256 = { [moduleFile]: sha(await readFile(moduleFile)) }
  await writeFile(join(evidence, 'dsh-release-example-0-output-modules.json'), JSON.stringify(snapshot))
  await mkdir(join(workspace, 'release')); await writeFile(join(workspace, 'NOTICE'), 'Project notice\n')
  await writeFile(join(workspace, 'LICENSE'), 'original fixture license')
  const base = { observedOutputSha256: { 'lib/old.js': '0'.repeat(64) }, components: [{ ...component, packageMetadataSha256: sha(metadata), correspondence: FIRST_PARTY_MATERIAL }], fonts: [],
    materials: [{ source: 'LICENSE', path: 'licenses/example/LICENSE', sha256: sha('original fixture license') }], limitations: ['bounded observation'], normalBuildMaps: [] }
  await writeFile(join(workspace, 'release/dsh-distribution-materials.json'), JSON.stringify({ schemaVersion: 1, packages: { example: base } }))
  execFileSync('git', ['init', '-q', workspace]); execFileSync('git', ['-C', workspace, 'add', '.'])
  execFileSync('git', ['-C', workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'])
  const sourceCommit = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const observations = await observeDshBuild({ workspace, report: { mapping: { example: { name: '@yugoo-design/example', directory: 'packages/example' } } }, evidenceDirectory: evidence, sourceCommit })
  assert.deepEqual(Object.keys(observations.packages.example.observedOutputSha256), ['lib/new.js'])
  const binding = observations.packages.example.componentBindings[0]
  assert.deepEqual(binding.outputs, ['lib/new.js'])
  assert.equal(binding.currentIdentity.packageMetadataSha256, sha(currentMetadata))
  assert.equal(binding.currentIdentity.sourceCommit, sourceCommit)
  assert.equal(observations.packages.example.normalBuildMaps[0].projectOwnedSourceSha256['packages/example/src/index.ts'], sha('export const value = 1\n'))
  const receiptFile = join(root, 'material-observations.json'); await writeFile(receiptFile, JSON.stringify(observations))
  const target = join(root, 'target'); await mkdir(join(target, 'lib'), { recursive: true })
  await writeFile(join(target, 'lib/new.js'), normalCode); await writeFile(join(target, 'NOTICE'), 'Project notice\n')
  const args = { source: workspace, target, sourceName: 'example', packageName: '@yugoo-design/example', observationFile: receiptFile, observationSha256: sha(await readFile(receiptFile)) }
  await copyDshDistributionMaterials(args)
  const index = JSON.parse(await readFile(join(target, 'licenses/dsh-distribution.json')))
  assert.equal(index.completeBundledInventoryVerified, false); assert.equal(index.releaseLicenseAcceptance, false)
  assert.deepEqual(index.components[0].outputs, ['lib/new.js'])
  assert.equal(index.components[0].packageMetadataSha256, sha(currentMetadata))
  assert.equal(index.currentBuildAssociation.historicalObservation.components[0].packageMetadataSha256, sha(metadata))
  const currentIdentity = structuredClone(binding.currentIdentity)
  delete binding.currentIdentity; await writeFile(receiptFile, JSON.stringify(observations))
  await assert.rejects(copyDshDistributionMaterials({ ...args, observationSha256: sha(await readFile(receiptFile)) }), /Explicit current first-party identity required/)
  binding.currentIdentity = { ...currentIdentity, packageMetadataSha256: 'e'.repeat(64) }; await writeFile(receiptFile, JSON.stringify(observations))
  await assert.rejects(copyDshDistributionMaterials({ ...args, observationSha256: sha(await readFile(receiptFile)) }), /first-party identity differs from fixed source/)
  binding.currentIdentity = currentIdentity; await writeFile(receiptFile, JSON.stringify(observations))
  await writeFile(join(packageRoot, 'package.json'), Buffer.from(JSON.stringify({ name: 'example', version: '1.2.3', changed: true })))
  await assert.rejects(copyDshDistributionMaterials(args), /workspace metadata differs from fixed source/)
  await writeFile(join(packageRoot, 'package.json'), currentMetadata)
  assert.deepEqual(index.currentBuildAssociation.historicalObservation, base)
  await assert.rejects(copyDshDistributionMaterials({ ...args, observationSha256: 'f'.repeat(64) }), /receipt changed/)
  const sourceManifestFile = join(workspace, 'release/dsh-distribution-materials.json'), sourceManifestBytes = await readFile(sourceManifestFile)
  await writeFile(sourceManifestFile, Buffer.concat([sourceManifestBytes, Buffer.from('\n')]))
  await assert.rejects(copyDshDistributionMaterials(args), /material authority changed/)
  await writeFile(sourceManifestFile, sourceManifestBytes)
  observations.sourceCommit = 'f'.repeat(40); await writeFile(receiptFile, JSON.stringify(observations))
  await assert.rejects(copyDshDistributionMaterials({ ...args, observationSha256: sha(await readFile(receiptFile)) }), /source commit changed/)
  observations.sourceCommit = sourceCommit; await writeFile(receiptFile, JSON.stringify(observations))
  await writeFile(join(target, 'lib/new.js'), 'changed normal output')
  await assert.rejects(copyDshDistributionMaterials({ ...args, observationSha256: sha(await readFile(receiptFile)) }), /observation is stale/)
  await writeFile(moduleFile, 'changed after normal build hook')
  await assert.rejects(observeDshBuild({ workspace, report: { mapping: { example: { name: '@yugoo-design/example', directory: 'packages/example' } } }, evidenceDirectory: evidence, sourceCommit }), /Normal module input changed/)
  await writeFile(join(output, 'new.js'), 'changed after normal build hook')
  await assert.rejects(observeDshBuild({ workspace, report: { mapping: { example: { name: '@yugoo-design/example', directory: 'packages/example' } } }, evidenceDirectory: evidence, sourceCommit }), /Output file.*changed|Emitted output|Output.*mismatch|changed|identity/u)
})
