import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectDistributionCode, prepareDshPackageMaterials } from './assemble-dsh-distribution.mjs'
import * as assembly from './assemble-dsh-distribution.mjs'
import { readNpmCandidates } from './release-npm-candidates.mjs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { satisfies } from 'semver'
import { assertRequiredPeers } from './release-consumer-config.mjs'

const mapping = { 'dsh-design-core': { name: '@yugoo-design/dsh-design-core' } }

test('scoped package stages create safe parents and exclusively create their leaf', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-scoped-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const packages = join(root, 'packages'); await mkdir(packages)
  const name = '@yugoo-design/dsh-design-system-dsh'
  assert.equal(await assembly.createDshPackageStage(packages, name), join(packages, name))
  await assert.rejects(assembly.createDshPackageStage(packages, name), { code: 'EEXIST' })
  for (const unknown of ['@foreign/aggregate', '../outside', '@yugoo-design/../../outside']) {
    await assert.rejects(assembly.createDshPackageStage(packages, unknown), /Known package/)
  }
  const linked = join(root, 'linked-packages'), outside = join(root, 'outside')
  await mkdir(linked); await mkdir(outside)
  await symlink(outside, join(linked, '@yugoo-design'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(assembly.createDshPackageStage(linked, name), /Nonregular package stage parent/)
  assert.deepEqual(await readdir(outside), [])
  await assert.rejects(assembly.createDshPackageStage(join(linked, '@yugoo-design'), name), /Nonregular package stage root/)
})

test('controlled rc3 trial admits only the exact Host version while retaining rc2 development SDK pins', async () => {
  const source = fileURLToPath(new URL('../', import.meta.url))
  const report = await readNpmCandidates(source, { scope: '@yugoo-design', version: '0.1.0-r2mac.3', ladybugVersion: '0.21.1', ladybugSource: 'registry' })
  for (const directory of ['core', 'panel', 'provider-web-app', 'studio-dsh']) {
    const original = JSON.parse(await readFile(join(source, 'packages', directory, 'package.json'), 'utf8'))
    const packed = assembly.createDshDistributionManifest(report, original.name)
    const peers = Object.fromEntries(Object.entries(packed.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-')))
    assert.ok(Object.keys(peers).length > 0)
    for (const [name, range] of Object.entries(peers)) {
      assert.equal(range, '0.2.1-rc.3')
      assert.equal(original.devDependencies[name], '0.2.0-rc.2', 'trial metadata does not replace the development SDK')
    }
    const hostContract = { name: packed.name, peerDependencies: peers }
    await assertRequiredPeers(hostContract, () => '0.2.1-rc.3', satisfies)
    for (const wrongVersion of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.4', '0.2.1']) {
      await assert.rejects(assertRequiredPeers(hostContract, () => wrongVersion, satisfies), /incompatible peer/)
    }
    if (original.peerDependencies.react) assert.equal(packed.peerDependencies.react, '^18.2.0')
    assert.equal(packed.peerDependencies['@deepseek-ai/cordis'], original.peerDependencies['@deepseek-ai/cordis'])
  }
})

async function selectiveFixture() {
  const source = fileURLToPath(new URL('../', import.meta.url))
  const options = { scope: '@yugoo-design', version: '0.1.0-beta.2', ladybugVersion: '0.21.1', ladybugSource: 'registry' }
  const previous = await readNpmCandidates(source, options)
  const versions = Object.fromEntries(Object.keys(previous.mapping).map(name => [name, '0.1.0-beta.2']))
  const packageNames = ['dsh-design-panel', 'dsh-design-provider-web-app', 'dsh-design-studio-dsh', '@yugoo-design/dsh-design-system-dsh']
  for (const name of packageNames) versions[name] = '0.1.0-r1-local.20261017.1'
  const report = await readNpmCandidates(source, { ...options, version: undefined, versions })
  const retainedManifests = Object.fromEntries(Object.keys(previous.mapping).filter(name => !packageNames.includes(name))
    .map(name => [name, assembly.createDshDistributionManifest(previous, name)]))
  return { source, options, previous, versions, report, packageNames, retainedManifests }
}

test('selected distribution packs four packages while preserving six explicit manifest contracts', async () => {
  const f = await selectiveFixture()
  const before = structuredClone(f.report)
  const selection = assembly.selectDshDistributionPackages(f.report, f)
  assert.deepEqual(selection.packageNames, f.packageNames)
  assert.equal(selection.retained.length, 6)
  for (const item of selection.retained) {
    assert.equal(item.version, '0.1.0-beta.2')
    assert.equal(item.manifestContractVerified, true)
    assert.equal(item.archiveVerified, false, 'Manifest data does not establish retained archive bytes')
  }
  const aggregate = assembly.createDshDistributionManifest(f.report, '@yugoo-design/dsh-design-system-dsh')
  assert.equal(Object.keys(aggregate.dependencies).length, 8)
  assert.deepEqual(aggregate.dependencies, {
    ...f.report.candidates['@yugoo-design/dsh-design-system-dsh'].dependencies,
    [f.report.mapping['dsh-design-studio'].name]: f.versions['dsh-design-studio'],
    [f.report.mapping['dsh-design-studio-ui'].name]: f.versions['dsh-design-studio-ui'],
  })
  assert.equal(aggregate.dependencies[f.report.mapping['yugoo-design-git-native'].name], undefined, 'Core owns its physical Git dependency')
  const provider = assembly.createDshDistributionManifest(f.report, 'dsh-design-provider-web-app')
  assert.equal(provider.peerDependencies[f.report.mapping['dsh-design-panel'].name], f.versions['dsh-design-panel'])
  assert.deepEqual(provider.dsh.client.inject, [f.report.mapping['dsh-design-panel'].name])
  assert.equal(provider.devDependencies, undefined)
  assert.deepEqual(f.report, before)
})

test('a changed exact Panel peer prevents retaining the previous Studio DSH manifest', async () => {
  const f = await selectiveFixture()
  const name = 'dsh-design-studio-dsh'
  assert.throws(() => assembly.selectDshDistributionPackages(f.report, {
    packageNames: f.packageNames.filter(item => item !== name),
    retainedManifests: { ...f.retainedManifests, [name]: assembly.createDshDistributionManifest(f.previous, name) },
  }), /Retained manifest contract changed: dsh-design-studio-dsh/)
})

test('default composition excludes internal Kits without promoting unrelated release artifacts', async () => {
  const { report } = await selectiveFixture()
  const aggregate = assembly.createDshDistributionManifest(report, '@yugoo-design/dsh-design-system-dsh')
  const internalKit = 'dsh-design-skills-decision-modeling'
  assert.equal(report.mapping[internalKit], undefined)
  assert.equal(aggregate.dependencies['@yugoo-design/' + internalKit], undefined)
  const patch = parse(await readFile(new URL('../packages/dsh/cordis.patch.yml', import.meta.url), 'utf8'))
  const rows = patch.flatMap(entry => entry.insert ?? [])
  assert.equal(rows.length, 11)
  assert.deepEqual(rows.filter(row => row.name === 'dsh-design-core/kit-loader').map(row => row.config.packageName), ['dsh-design-skills-web-app'])
  const byName = new Map(Object.entries(report.candidates).map(([name, manifest]) => [manifest.name, name]))
  const visited = new Set()
  function visit(name) {
    if (visited.has(name)) return
    visited.add(name)
    const manifest = assembly.createDshDistributionManifest(report, name)
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dep of Object.keys(manifest[field] ?? {})) if (byName.has(dep)) visit(byName.get(dep))
    }
  }
  visit('@yugoo-design/dsh-design-system-dsh')
  assert.deepEqual([...visited].sort(), Object.keys(report.mapping).sort(), 'all public runtime packages remain reachable')
  report.mapping['unrelated-extension'] = { name: '@fixture/unrelated-extension', version: '1.0.0' }
  report.candidates['unrelated-extension'] = { name: '@fixture/unrelated-extension', version: '1.0.0' }
  report.candidates['dsh-design-core'].peerDependencies['@fixture/unrelated-extension'] = '1.0.0'
  report.candidates['dsh-design-core'].peerDependenciesMeta = {
    ...report.candidates['dsh-design-core'].peerDependenciesMeta,
    '@fixture/unrelated-extension': { optional: true },
  }
  assert.deepEqual(assembly.createDshDistributionManifest(report, '@yugoo-design/dsh-design-system-dsh'), aggregate)
})

test('selected distribution requires a complete disjoint partition and refuses stale retained pins', async () => {
  const f = await selectiveFixture()
  // The former three-package selection leaves StudioDSH's exact Panel peer
  // stale. Keep that original scenario as a refusal rather than manufacturing
  // a new retained manifest from the changed report.
  const legacyReport = await readNpmCandidates(f.source, { ...f.options, version: undefined,
    versions: { ...f.versions, 'dsh-design-studio-dsh': '0.1.0-beta.2' } })
  assert.throws(() => assembly.selectDshDistributionPackages(legacyReport, {
    packageNames: f.packageNames.filter(name => name !== 'dsh-design-studio-dsh'),
    retainedManifests: { ...f.retainedManifests,
      'dsh-design-studio-dsh': assembly.createDshDistributionManifest(f.previous, 'dsh-design-studio-dsh') },
  }), /Retained manifest contract changed: dsh-design-studio-dsh/)
  for (const mutate of [
    value => { value.packageNames.push(value.packageNames[0]) },
    value => { value.packageNames.push('unknown-package') },
    value => { value.packageNames = [] },
    value => { delete value.retainedManifests['dsh-design-core'] },
    value => { value.retainedManifests['dsh-design-panel'] = {} },
    value => { value.retainedManifests['dsh-design-core'].version = '0.1.0-beta.1' },
    value => { value.retainedManifests['dsh-design-core'].dependencies = {} },
  ]) {
    const bad = structuredClone({ packageNames: f.packageNames, retainedManifests: f.retainedManifests }); mutate(bad)
    assert.throws(() => assembly.selectDshDistributionPackages(f.report, bad))
  }
  const staleProvider = assembly.createDshDistributionManifest(f.previous, 'dsh-design-provider-web-app')
  assert.throws(() => assembly.selectDshDistributionPackages(f.report, {
    packageNames: f.packageNames.filter(name => name !== 'dsh-design-provider-web-app'),
    retainedManifests: { ...f.retainedManifests, 'dsh-design-provider-web-app': staleProvider },
  }), /retained.*contract|Retained.*contract/)
  const defaultSelection = assembly.selectDshDistributionPackages(f.previous)
  assert.deepEqual(defaultSelection.packageNames, Object.keys(f.previous.mapping))
  assert.deepEqual(defaultSelection.retained, [])
})

test('invalid selected assembly fails before output creation or invoking npm', async t => {
  const f = await selectiveFixture(), root = await mkdtemp(join(tmpdir(), 'dsh-selection-refusal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const options = { source: f.source, npmCli: join(root, 'nonexistent-npm-cli'), destination: join(root, 'output'), versions: f.versions,
    packageNames: f.packageNames, retainedManifests: f.retainedManifests }
  await assert.rejects(assembly.assembleDshDistribution({ ...options, retainedManifests: {} }), /complete disjoint partition/)
  await assert.rejects(assembly.assembleDshDistribution({ ...options, version: null }), /version or versions/)
  await assert.rejects(readFile(join(options.destination, 'RESULT.json')), { code: 'ENOENT' })
  assert.deepEqual(await readdir(root), [])
})

test('retained contracts cover Kit discovery, runtime resolution and installation without requiring metadata parity', async () => {
  const f = await selectiveFixture()
  for (const [name, field, value] of [
    ['dsh-design-skills-web-app', 'designSystem', { kit: { root: './missing-kit', manifest: './missing-kit' } }],
    ['yugoo-design-git-native', 'engines', { node: '<1' }],
    ...['bin', 'imports', 'browser', 'module', 'os', 'cpu', 'libc', 'typesVersions', 'sideEffects', 'directories', 'config', 'engineStrict', 'dependenciesMeta']
      .map(field => ['dsh-design-core', field, { changed: true }]),
  ]) {
    const retainedManifests = structuredClone(f.retainedManifests)
    retainedManifests[name][field] = value
    assert.throws(() => assembly.selectDshDistributionPackages(f.report, { ...f, retainedManifests }), /Retained manifest contract changed/, field)
  }
  const changedInstall = structuredClone(f.retainedManifests)
  changedInstall['dsh-design-core'].scripts = { ...changedInstall['dsh-design-core'].scripts, install: 'node changed-install.js' }
  assert.throws(() => assembly.selectDshDistributionPackages(f.report, { ...f, retainedManifests: changedInstall }), /Retained manifest contract changed/)
  const metadataOnly = structuredClone(f.retainedManifests)
  Object.assign(metadataOnly['dsh-design-core'], {
    description: 'New documentation only', repository: { type: 'git', url: 'https://example.invalid/docs' },
    author: 'New maintainer metadata', publishConfig: { access: 'public', tag: 'future' }, files: ['new-packaging-list'],
  })
  metadataOnly['dsh-design-core'].scripts.test = 'node another-source-test.mjs'
  assert.equal(assembly.selectDshDistributionPackages(f.report, { ...f, retainedManifests: metadataOnly }).retained.length, 6)
})

test('scoped Typert ownership changes without changing the Host/browser wire contract', () => {
  const source = `const remote = {
    package: 'dsh-design-core',
    descriptors: [{ id: 'dsh-design-core#designPanel/readWorkspace',
      typeSymbol: 'dsh-design-core#designPanel/readWorkspace:result' }]
  }; const host = { package: remote.package, face: 'host', invocations: remote.descriptors };
  const plugin = { package: 'dsh-design-core', id: 'dsh-design-core' };
  return { remote, host, plugin };`
  const projected = projectDistributionCode(source, mapping, 'typert.remote-client.js')
  assert.equal(projected.replacements, 1)
  const { remote, host, plugin } = Function(projected.code)()
  assert.equal(remote.package, mapping['dsh-design-core'].name)
  assert.equal(host.package, remote.package)
  assert.equal(host.invocations, remote.descriptors)
  assert.equal(remote.descriptors[0].id, 'dsh-design-core#designPanel/readWorkspace')
  assert.equal(remote.descriptors[0].typeSymbol, 'dsh-design-core#designPanel/readWorkspace:result')
  assert.deepEqual(plugin, { package: 'dsh-design-core', id: 'dsh-design-core' })
  assert.equal(projectDistributionCode(projected.code, mapping, 'client.js').replacements, 0)
})

test('quoted/minified Host ownership is mapped, external package ownership is untouched', () => {
  const projected = projectDistributionCode(`return [
    { "package": "dsh-design-core", "invocations": [] },
    { package: '@deepseek-ai/other', descriptors: [] }
  ];`, mapping, 'chunk.js')
  const [host, external] = Function(projected.code)()
  assert.equal(host.package, '@yugoo-design/dsh-design-core')
  assert.equal(external.package, '@deepseek-ai/other')
  assert.equal(projected.replacements, 1)
})

test('exported Host and Remote declarations match scoped runtime ownership without rewriting RPC literal types', () => {
  const source = `declare const TYPERT: { readonly package: "dsh-design-core";
    readonly invocations: readonly [{ readonly id: "dsh-design-core#designPanel/readWorkspace" }] };
  declare const TYPERT_REMOTE: { readonly package: "dsh-design-core";
    readonly descriptors: readonly [{ readonly typeSymbol: "dsh-design-core#designPanel/readWorkspace:result" }] };
  declare const unrelated: { readonly package: "dsh-design-core" };`
  const projected = projectDistributionCode(source, mapping, 'typert.d.ts')
  assert.equal(projected.replacements, 2)
  assert.equal(projected.code.match(/readonly package: "@yugoo-design\/dsh-design-core"/g)?.length, 2)
  assert.ok(projected.code.includes('readonly id: "dsh-design-core#designPanel/readWorkspace"'))
  assert.ok(projected.code.includes('readonly typeSymbol: "dsh-design-core#designPanel/readWorkspace:result"'))
  assert.ok(projected.code.includes('unrelated: { readonly package: "dsh-design-core" }'))
  assert.equal(projectDistributionCode(projected.code, mapping, 'typert.d.ts').replacements, 0)
})

test('formal native assembly preserves original materials and rejects changed staged build inputs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'native-distribution-materials-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), original = join(source, 'packages/git-native'), target = join(root, 'stage')
  await mkdir(join(original, 'native'), { recursive: true })
  await mkdir(join(original, 'scripts'))
  const manifest = JSON.parse(await readFile(new URL('../packages/git-native/package.json', import.meta.url), 'utf8'))
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const checker = await readFile(new URL('../packages/git-native/scripts/check-artifacts.cjs', import.meta.url))
  // Synthetic bytes test the inventory boundary only; actual native loading is
  // verified separately with the normal Linux/Windows package.
  const artifact = Buffer.from('synthetic prebuild inventory fixture')
  const index = Buffer.from('fixed loader input')
  await writeFile(join(original, 'LICENSE'), 'Original upstream MIT fixture\n')
  await writeFile(join(original, 'NOTICE'), 'Original separate third-party terms\n')
  await writeFile(join(original, 'index.cjs'), index)
  await writeFile(join(original, 'scripts/check-artifacts.cjs'), checker)
  await writeFile(join(original, 'native/fixture.node'), artifact)
  await writeFile(join(original, 'SOURCE.json'), JSON.stringify({
    artifacts: [{ path: 'native/fixture.node', bytes: artifact.length, sha256: hash(artifact) }],
    inputs: [{ path: 'index.cjs', sha256: hash(index) }],
  }))
  await cp(original, target, { recursive: true })
  const options = { source, target, sourceName: 'yugoo-design-git-native', manifest: { ...manifest, name: '@yugoo-design/yugoo-design-git-native' } }
  await prepareDshPackageMaterials(options)
  for (const file of ['LICENSE', 'NOTICE', 'SOURCE.json']) {
    assert.deepEqual(await readFile(join(target, file)), await readFile(join(original, file)))
  }
  assert.deepEqual((await readdir(target)).sort(), ['LICENSE', 'NOTICE', 'SOURCE.json', 'index.cjs', 'native', 'scripts'])
  await writeFile(join(target, 'index.cjs'), 'tampered loader')
  await assert.rejects(prepareDshPackageMaterials(options), /Native Git build input changed/)
  await writeFile(join(target, 'index.cjs'), index)
  await writeFile(join(target, 'native/fixture.node'), 'tampered prebuild')
  await assert.rejects(prepareDshPackageMaterials(options), /Native Git prebuild does not match/)
  await assert.rejects(prepareDshPackageMaterials({ ...options, manifest: { ...manifest, license: 'Apache-2.0' } }), /upstream license/)
  await assert.rejects(prepareDshPackageMaterials({ ...options, manifest: { ...manifest, name: '@fixture/unrelated' } }))
})
