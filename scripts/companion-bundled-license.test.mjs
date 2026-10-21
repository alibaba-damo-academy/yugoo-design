import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { prepareBundledJsLicenseMaterials, copyBundledJsLicenseMaterials, BUNDLED_JS_LICENSE_NOTICE, prepareEmbeddedPicaLicenseMaterials, copyEmbeddedPicaLicenseMaterials, EMBEDDED_PICA_LICENSE_SOURCE_PATHS } from './companion-bundled-license.mjs'
import { BUNDLED_LICENSE_PINS, prepareBundledLicenseMaterials, copyBundledLicenseMaterials, inspectBundledModuleLicense } from './companion-bundled-license.mjs'

const workspace = fileURLToPath(new URL('../', import.meta.url))
test('victory-vendor preserves exact local README and thirteen vendor license texts', async t => {
  const target = await mkdtemp(join(tmpdir(), 'victory-material-test-'))
  t.after(() => rm(target, { recursive: true, force: true }))
  const entries = await prepareBundledJsLicenseMaterials(workspace)
  const inventory = await copyBundledJsLicenseMaterials(entries, target)
  const prefix = 'victory-vendor@37.3.6'
  const source = JSON.parse(await readFile(join(target, 'licenses/bundled-js', prefix, 'SOURCE.json'), 'utf8'))
  assert.equal(source.package, 'victory-vendor')
  assert.equal(source.version, '37.3.6')
  assert.equal(source.declaredLicense, 'MIT AND ISC')
  assert.equal(source.topLevelLicenseFilePresent, false)
  assert.equal(source.releaseLicenseAcceptance, false)
  assert.equal(source.completeBundledInventoryVerified, false)
  assert.equal(Object.keys(source.originalFiles).length, 14)
  assert.equal(Object.keys(source.originalFiles).filter(path => path.startsWith('lib-vendor/') && path.endsWith('/LICENSE')).length, 13)
  for (const [file, expectedSha] of Object.entries(source.originalFiles)) {
    const path = `${prefix}/${file}`
    const actual = await readFile(join(target, 'licenses/bundled-js', path))
    assert.equal(createHash('sha256').update(actual).digest('hex'), expectedSha)
    assert.deepEqual(actual, await readFile(join(workspace, 'third-party/companion/bundled-js', path)))
    assert.equal(inventory.assets[`licenses/bundled-js/${path}`], expectedSha)
  }
  assert.match(BUNDLED_JS_LICENSE_NOTICE, /victory-vendor 37\.3\.6/)
  assert.doesNotMatch(JSON.stringify(source), /\/home\/|\/tmp\//)
})
test('rolldown Flow helper original texts and bounded association are staged unchanged', async t => {
  const target = await mkdtemp(join(tmpdir(), 'rolldown-material-test-'))
  t.after(() => rm(target, { recursive: true, force: true }))
  const entries = await prepareBundledJsLicenseMaterials(workspace)
  const inventory = await copyBundledJsLicenseMaterials(entries, target)
  const source = JSON.parse(await readFile(join(target, 'licenses/bundled-js/rolldown@1.2.12/SOURCE.json'), 'utf8'))
  assert.equal(source.scope, 'observed-flow-runtime-helper-only')
  assert.equal(source.moduleId, '\0rolldown/runtime.js')
  assert.equal(source.releaseLicenseAcceptance, false)
  assert.equal(source.completeBundledInventoryVerified, false)
  const index = JSON.parse(await readFile(join(target, 'licenses/bundled-js/emitted-originals-index.json'), 'utf8'))
  const rows = index.materials.filter(row => row.package === 'rolldown')
  assert.equal(rows.length, 2)
  for (const [file, expectedSha] of Object.entries(source.originalFiles)) {
    const path = `rolldown@1.2.12/${file}`
    const bytes = await readFile(join(target, 'licenses/bundled-js', path))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha)
    assert.deepEqual(bytes, await readFile(join(workspace, 'third-party/companion/bundled-js', path)))
    assert.equal(inventory.assets[`licenses/bundled-js/${path}`], expectedSha)
    const row = rows.find(item => item.path === path)
    assert.equal(row.sha256, expectedSha)
    assert.equal(row.version, source.version)
    assert.equal(row.correspondence, 'rolldown@1.2.12/SOURCE.json')
    assert.ok(row.members.includes(`package/${source.observedOutput}`))
  }
  assert.match(BUNDLED_JS_LICENSE_NOTICE, /historical Flow rolldown runtime helper observation used rolldown 1\.2\.12/)
  assert.match(BUNDLED_JS_LICENSE_NOTICE, /retained Pica runtime observation used rolldown 1\.2\.4/)
  assert.doesNotMatch(JSON.stringify(source), /\/home\/|\/tmp\//)
})
test('embedded Pica materials reuse reviewed originals and reject missing, altered or prepared-byte changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pica-original-material-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  for (const path of EMBEDDED_PICA_LICENSE_SOURCE_PATHS) {
    await mkdir(dirname(join(source, path)), { recursive: true })
    await cp(join(workspace, path), join(source, path))
  }
  const prepared = await prepareEmbeddedPicaLicenseMaterials(source)
  assert.equal(prepared.length, 8, 'Five embedded components, two runtime texts and the existing source map')
  const materials = await copyEmbeddedPicaLicenseMaterials(prepared, target)
  assert.equal(Object.keys(materials.assets).length, 8)
  assert.deepEqual(await readFile(join(target, 'licenses/bundled-js/pica-embedded/fixture-notice-map.json')),
    await readFile(join(workspace, 'scripts/test-fixtures/fixture-notice-map.json')))
  for (const path of ['glur/LICENSE', 'inherits/LICENSE', 'multimath/LICENSE', 'object-assign/license', 'webworkify/LICENSE', 'rolldown/LICENSE', 'rolldown/THIRD-PARTY-LICENSE']) {
    const expected = await readFile(join(workspace, 'scripts/test-fixtures/pica-worker/source', path))
    assert.deepEqual(await readFile(join(target, 'licenses/bundled-js/pica-embedded', path)), expected)
  }
  await assert.rejects(copyEmbeddedPicaLicenseMaterials(prepared.slice(1), join(root, 'missing')), /Incomplete embedded Pica/)
  prepared[1].bytes[0] ^= 1
  await assert.rejects(copyEmbeddedPicaLicenseMaterials(prepared, join(root, 'changed')), /Prepared embedded Pica material changed/)
  const original = join(source, 'scripts/test-fixtures/pica-worker/source/glur/LICENSE')
  await writeFile(original, 'changed')
  await assert.rejects(prepareEmbeddedPicaLicenseMaterials(source), /Embedded Pica material changed/)
  await rm(original)
  await assert.rejects(prepareEmbeddedPicaLicenseMaterials(source), { code: 'ENOENT' })
})
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'bundled-notice-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), target = join(root, 'target')
  await mkdir(join(source, 'third-party'), { recursive: true })
  await cp(join(workspace, 'third-party/companion'), join(source, 'third-party/companion'), { recursive: true })
  await mkdir(join(source, 'scripts'))
  await cp(join(workspace, 'scripts/graph-layout-worker.ts'), join(source, 'scripts/graph-layout-worker.ts'))
  await mkdir(join(target, 'licenses'), { recursive: true })
  return { source, target }
}

test('stages original component texts and local source with explicit incomplete release states', async t => {
  const { source, target } = await setup(t)
  await writeFile(join(target, 'NOTICE'), 'existing project notice')
  const inventory = await copyBundledLicenseMaterials(await prepareBundledLicenseMaterials(source), target)
  for (const path of Object.keys(BUNDLED_LICENSE_PINS)) {
    assert.deepEqual(await readFile(join(target, 'licenses/third-party', path)), await readFile(join(source, 'third-party/companion', path)))
  }
  assert.equal(await readFile(join(target, 'NOTICE'), 'utf8'), 'existing project notice')
  assert.equal(inventory.elkPreferredSourceCorrespondenceVerified, false)
  assert.equal(inventory.bpmnWatermarkRuntimeVerified, false)
  assert.equal(inventory.releaseLicenseAcceptance, false)
  assert.equal(inventory.completeBundledInventory, false)
  const sourceText = await readFile(join(target, 'licenses/third-party/elkjs-0.10.2/SOURCE.md'), 'utf8')
  assert.match(sourceText, /f64a4813dcab63c30fe67a32470cd1c05f4f7031/)
  assert.match(sourceText, /28e5173243cab0cf4e2c9816c803bc0d5c47ab24/)
  assert.match(sourceText, /independent regeneration has NOT been verified/)
  const index = JSON.parse(await readFile(join(target, 'licenses/third-party/index.json'), 'utf8'))
  assert.equal(index.components[0].upstreamDeclaredJavaSourceIdentityLocated, true)
  assert.equal(index.components[0].independentRegenerationVerified, false)
  assert.equal(index.releaseLicenseAcceptance, false)
  const binding = JSON.parse(await readFile(join(target, 'licenses/third-party/elkjs-0.10.2/release-source-binding.json'), 'utf8'))
  assert.equal(binding.upstreamJavaCommit, index.components[0].upstreamJavaCommit)
  assert.equal(binding.independentRegenerationVerified, false)
  assert.equal(binding.artifactComparisons.length, 5)
  assert.ok(binding.artifactComparisons.every(row => row.matchesOfficialFixedCommit))
  assert.doesNotMatch(JSON.stringify(binding), /\/tmp\/|\/home\//)
  for (const [name, version] of [['pako', '2.0.3'], ['dompurify', '3.4.16']]) {
    const component = index.components.find(row => row.name === name)
    assert.equal(component.version, version)
    assert.equal(component.independentUpstreamRetrievalVerified, false)
    assert.equal(component.originalLicenseFiles.length, 2)
    const text = await readFile(join(target, 'licenses/third-party', `${name}-${version}/SOURCE.md`), 'utf8')
    assert.doesNotMatch(text, /\/tmp\/|\/home\//)
    assert.match(text, /did not independently retrieve upstream bytes/)
  }
  assert.equal(index.components.find(row => row.name === 'dompurify').licenseRouteSelected, false)
})

test('rejects missing or altered license inputs before staging', async t => {
  for (const mode of ['missing', 'changed']) {
    const { source, target } = await setup(t)
    const path = join(source, 'third-party/companion/bpmn-js-18.24.0/LICENSE')
    if (mode === 'missing') await rm(path)
    else await writeFile(path, 'incorrect license')
    await assert.rejects(prepareBundledLicenseMaterials(source))
    await assert.rejects(readFile(join(target, 'licenses/third-party/index.json')), { code: 'ENOENT' })
  }
})

test('rejects symlink material directory and stale local transformation', async t => {
  const { source } = await setup(t)
  await writeFile(join(source, 'scripts/graph-layout-worker.ts'), '// stale source')
  await assert.rejects(prepareBundledLicenseMaterials(source), /transformation source is stale/)
  await cp(join(workspace, 'scripts/graph-layout-worker.ts'), join(source, 'scripts/graph-layout-worker.ts'))
  const component = join(source, 'third-party/companion/bpmn-js-18.24.0')
  await rm(component, { recursive: true })
  await symlink(join(workspace, 'third-party/companion/bpmn-js-18.24.0'), component)
  await assert.rejects(prepareBundledLicenseMaterials(source), /Non-regular license material/)
})

test('prepared-byte mutation and existing destination cannot overwrite materials', async t => {
  const { source, target } = await setup(t)
  const entries = await prepareBundledLicenseMaterials(source)
  entries[0].bytes[0] ^= 1
  await assert.rejects(copyBundledLicenseMaterials(entries, target), /Prepared license material changed/)
  const clean = await prepareBundledLicenseMaterials(source)
  await mkdir(join(target, 'licenses/third-party'))
  await writeFile(join(target, 'licenses/third-party/sentinel'), 'retain')
  await assert.rejects(copyBundledLicenseMaterials(clean, target), { code: 'EEXIST' })
  assert.equal(await readFile(join(target, 'licenses/third-party/sentinel'), 'utf8'), 'retain')
})

test('caller mutation immediately after copy starts cannot alter validated output', async t => {
  const { source, target } = await setup(t)
  const entries = await prepareBundledLicenseMaterials(source)
  const copy = copyBundledLicenseMaterials(entries, target)
  for (const entry of entries) {
    entry.bytes.fill(0)
    entry.path = '../caller-controlled'
  }
  entries.length = 0
  await copy
  for (const path of Object.keys(BUNDLED_LICENSE_PINS)) {
    assert.deepEqual(await readFile(join(target, 'licenses/third-party', path)), await readFile(join(source, 'third-party/companion', path)))
  }
})

test('actual resolved package version and original license must match staged authority', async t => {
  const { target } = await setup(t)
  for (const [name, version, license, material] of [
    ['elkjs', '0.10.2', 'LICENSE.md', 'elkjs-0.10.2/LICENSE.md'],
    ['bpmn-js', '18.24.0', 'LICENSE', 'bpmn-js-18.24.0/LICENSE'],
  ]) {
    const root = join(target, 'node_modules', name)
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name, version }))
    await cp(join(workspace, 'third-party/companion', material), join(root, license))
    const module = join(root, 'lib/source.js')
    assert.equal((await inspectBundledModuleLicense(module)).version, version)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '99.0.0' }))
    await assert.rejects(inspectBundledModuleLicense(module), /Unreviewed bundled/)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name, version }))
    await writeFile(join(root, license), 'changed license')
    await assert.rejects(inspectBundledModuleLicense(module), /license bytes differ/)
  }
  assert.equal(await inspectBundledModuleLicense('\0virtual-module'), null)
})

test('both original notices bind each added package, including secondary notice failures', async t => {
  const { target } = await setup(t)
  for (const [name, version, files] of [
    ['pako', '2.0.3', [['LICENSE', 'LICENSE'], ['lib/zlib/README', 'zlib-README']]],
    ['pako', '1.0.11', [['LICENSE', 'LICENSE'], ['lib/zlib/README', 'zlib-README']]],
    ['dompurify', '3.4.16', [['LICENSE', 'LICENSE'], ['LICENSE-MPL', 'LICENSE-MPL']]],
  ]) {
    const root = join(target, 'node_modules', name)
    await mkdir(root, { recursive: true })
    const manifest = { name, version }
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    for (const [path, material] of files) {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await cp(join(workspace, 'third-party/companion', `${name}-${version}`, material), join(root, path))
    }
    const module = join(root, 'dist/input.mjs')
    const result = await inspectBundledModuleLicense(module)
    assert.equal(result.version, version)
    assert.equal(Object.keys(result.licenseFiles).length, 2)
    assert.equal(result.licenseSha256, BUNDLED_LICENSE_PINS[`${name}-${version}/LICENSE`])
    for (const [path, material] of files) {
      assert.equal(result.licenseFiles[path].sha256, BUNDLED_LICENSE_PINS[`${name}-${version}/${material}`])
      await writeFile(join(root, path), 'changed notice')
      await assert.rejects(inspectBundledModuleLicense(module), /license bytes differ/)
      await rm(join(root, path))
      await assert.rejects(inspectBundledModuleLicense(module), { code: 'ENOENT' })
      await cp(join(workspace, 'third-party/companion', `${name}-${version}`, material), join(root, path))
    }
    if (name === 'dompurify') {
      await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '3.4.15' }))
      await assert.rejects(inspectBundledModuleLicense(module), /Unreviewed bundled/)
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({ name, version: '99.0.0' }))
    await assert.rejects(inspectBundledModuleLicense(module), /Unreviewed bundled/)
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'copied-id', version }))
    await assert.rejects(inspectBundledModuleLicense(module), /identity mismatch/)
    await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    const [secondaryPath, secondaryMaterial] = files[1]
    await rm(join(root, secondaryPath))
    await symlink(join(workspace, 'third-party/companion', `${name}-${version}`, secondaryMaterial), join(root, secondaryPath))
    await assert.rejects(inspectBundledModuleLicense(module), /Non-regular license material/)
  }
})

test('added secondary materials cannot be omitted or altered before staging', async t => {
  for (const path of ['pako-2.0.3/zlib-README', 'dompurify-3.4.16/LICENSE-MPL']) {
    for (const mode of ['missing', 'changed']) {
      const { source, target } = await setup(t)
      const input = join(source, 'third-party/companion', path)
      if (mode === 'missing') await rm(input)
      else await writeFile(input, 'changed second license')
      await assert.rejects(prepareBundledLicenseMaterials(source))
      await assert.rejects(readFile(join(target, 'licenses/third-party/index.json')), { code: 'ENOENT' })
    }
  }
})
