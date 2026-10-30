import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createNpmCandidates, readNpmCandidates, runNpmCandidateCli } from './release-npm-candidates.mjs'
import { RELEASE_PACKAGES } from './release-consumer-config.mjs'

const options = { scope: '@fixture-design-release', version: '0.1.0-review.1', ladybugVersion: '0.19.1-walfix.1' }
const registryOptions = { ...options, ladybugSource: 'registry', ladybugVersion: '0.21.1' }
const workspace = fileURLToPath(new URL('../', import.meta.url))
async function sources() {
  // Actual own manifests; legacy vendoring is synthetic test data, not a
  // requirement to redistribute the excluded development WASM checkout.
  const own = Object.fromEntries(await Promise.all(Object.entries(RELEASE_PACKAGES)
    .filter(([name]) => name !== '@ladybugdb/wasm-core')
    .map(async ([name, directory]) => [name, JSON.parse(await readFile(new URL(`../${directory}/package.json`, import.meta.url), 'utf8'))])))
  return { ...own, '@ladybugdb/wasm-core': {
    name: '@ladybugdb/wasm-core', version: '0.19.1-walfix.1', license: 'MIT',
    dependencies: { threads: '1.7.0', 'tiny-worker': '2.3.0', uuid: '11.1.1' },
  } }
}

async function fixtureWorkspace(t, manifests) {
  const root = await mkdtemp(join(tmpdir(), 'release-npm-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const [name, manifest] of Object.entries(manifests)) {
    const directory = join(root, RELEASE_PACKAGES[name])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
  }
  return root
}

async function registrySources() {
  const manifests = await sources()
  delete manifests['@ladybugdb/wasm-core']
  manifests['dsh-design-knowledge-ladybug'].dependencies['@ladybugdb/wasm-core'] = registryOptions.ladybugVersion
  return manifests
}

test('only the canonical scoped aggregate receives the selected target scope once', async () => {
  const original = await registrySources(), before = structuredClone(original)
  const aggregate = '@yugoo-design/dsh-design-system-dsh'
  assert.equal(original[aggregate].name, aggregate)
  for (const scope of ['@yugoo-design', '@fixture-design-release']) {
    const report = createNpmCandidates(original, { ...registryOptions, scope })
    const manifest = report.candidates[aggregate]
    assert.equal(report.mapping[aggregate].name, scope + '/dsh-design-system-dsh')
    assert.equal(manifest.name, scope + '/dsh-design-system-dsh')
    assert.deepEqual(manifest.repository, { type: 'git', url: 'git+https://github.com/alibaba-damo-academy/yugoo-design.git', directory: 'packages/dsh' })
    assert.deepEqual(manifest.dsh, original[aggregate].dsh)
    assert.equal(Object.keys(manifest.dependencies).length, 6)
    assert.ok(Object.keys(manifest.dependencies).every(name => name.startsWith(scope + '/') && !name.includes('/@')))
  }
  assert.deepEqual(original, before)
  for (const mutate of [
    value => { value['@foreign/design-core'] = value['dsh-design-core']; delete value['dsh-design-core'] },
    value => { value[aggregate].name = '@foreign/dsh-design-system-dsh' },
    value => { value['dsh-design-core'].name = '@foreign/design-core' },
  ]) {
    const bad = structuredClone(original); mutate(bad)
    assert.throws(() => createNpmCandidates(bad, registryOptions), /physical release packages|Source manifest identity mismatch/)
  }
  const collision = structuredClone(original)
  collision['dsh-design-core'].dependencies[registryOptions.scope + '/yugoo-design-git-native'] = '1.0.0'
  assert.throws(() => createNpmCandidates(collision, registryOptions), /Dependency name collision/)
})

test('registry Ladybug stays an exact external dependency without a vendor publication candidate', async () => {
  const original = await registrySources(), before = structuredClone(original)
  const report = createNpmCandidates(original, registryOptions)
  assert.deepEqual(original, before)
  assert.equal(report.ladybugSource, 'registry')
  assert.equal(Object.keys(report.candidates).length, 10)
  assert.equal(report.mapping['@ladybugdb/wasm-core'], undefined)
  assert.equal(report.candidates['@ladybugdb/wasm-core'], undefined)
  assert.equal(report.candidates['dsh-design-knowledge-ladybug'].dependencies['@ladybugdb/wasm-core'], '0.21.1')
  assert.equal(report.edges.some(edge => edge.to.includes('ladybug-wasm-core')), false)
  assert.equal(report.publishLayers.flat().length, 10)
  assert.equal(report.registryChecked, false)
  assert.equal(report.publishReady, false)
})

test('internal packages cannot be promoted into public releases', async () => {
  const original = await registrySources()
  // Private-package admission is a general rule, independent of any internal Kit files.
  const internal = { name: 'synthetic-internal-kit', version: '1.0.0', private: true }
  assert.equal(internal.private, true)
  assert.equal(RELEASE_PACKAGES[internal.name], undefined)
  assert.equal(RELEASE_PACKAGES['dsh-design-skills-decision-modeling'], undefined)
  assert.throws(() => createNpmCandidates({ ...original, [internal.name]: internal }, registryOptions), /physical release packages/)
  original['dsh-design-core'].private = true
  assert.throws(() => createNpmCandidates(original, registryOptions), /private package cannot enter the public release/)
})

test('registry mode rejects vendor input, aliases, local references and unselected Ladybug versions', async () => {
  const original = await registrySources()
  assert.throws(() => createNpmCandidates(withVendor(original), registryOptions), /physical release packages/)
  for (const spec of ['file:../../vendor/ladybug/runtime', 'npm:@fixture/ladybug@0.21.1', '^0.21.1', '0.21.0']) {
    const bad = structuredClone(original)
    bad['dsh-design-knowledge-ladybug'].dependencies['@ladybugdb/wasm-core'] = spec
    assert.throws(() => createNpmCandidates(bad, registryOptions), /selected registry Ladybug/)
  }
  assert.throws(() => createNpmCandidates(original, { ...registryOptions, ladybugSource: 'guess' }), /Ladybug source/)
  const peer = structuredClone(original)
  peer['dsh-design-core'].peerDependencies = { ...peer['dsh-design-core'].peerDependencies, '@ladybugdb/wasm-core': '^0.21.0' }
  assert.equal(createNpmCandidates(peer, registryOptions).externalPeers.find(item => item.name === '@ladybugdb/wasm-core').range, '^0.21.0')
  peer['dsh-design-core'].peerDependencies['@ladybugdb/wasm-core'] = '^0.20.0'
  assert.throws(() => createNpmCandidates(peer, registryOptions), /selected registry Ladybug/)
  function withVendor(manifests) {
    return { ...manifests, '@ladybugdb/wasm-core': { name: '@ladybugdb/wasm-core', version: '0.21.1' } }
  }
})

test('registry mode rejects an omitted official Ladybug dependency before mapping candidates', async () => {
  const original = await registrySources()
  for (const wholeField of [false, true]) {
    const bad = structuredClone(original)
    if (wholeField) delete bad['dsh-design-knowledge-ladybug'].dependencies
    else delete bad['dsh-design-knowledge-ladybug'].dependencies['@ladybugdb/wasm-core']
    assert.throws(() => createNpmCandidates(bad, registryOptions), /Knowledge must declare selected registry Ladybug exactly/)
  }
})

test('registry source reader works without any vendored runtime directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'release-registry-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = await registrySources()
  for (const [name, manifest] of Object.entries(original)) {
    const directory = join(root, RELEASE_PACKAGES[name])
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
  }
  assert.deepEqual(await readNpmCandidates(root, registryOptions), createNpmCandidates(original, registryOptions))
  await assert.rejects(readNpmCandidates(root, options), /ENOENT/)
})

test('actual own manifests and synthetic legacy vendor become deterministic candidates without dropping fields', async () => {
  const original = await sources()
  const before = structuredClone(original)
  const report = createNpmCandidates(original, options)
  assert.deepEqual(original, before)
  assert.deepEqual(report, createNpmCandidates(original, options))
  assert.equal(Object.keys(report.candidates).length, 11)
  assert.equal(report.publishReady, false)
  assert.equal(report.registryChecked, false)
  assert.equal(report.scopeOwnershipChecked, false)
  for (const [source, candidate] of Object.entries(report.candidates)) {
    assert.equal(candidate.name, report.mapping[source].name)
    assert.equal(candidate.version, report.mapping[source].version)
    assert.equal(candidate.private, undefined)
    assert.equal(candidate.publishConfig.access, 'public')
    for (const [key, value] of Object.entries(original[source])) {
      if (['name', 'version', 'private', 'publishConfig', 'dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'peerDependenciesMeta'].includes(key)) continue
      assert.deepEqual(candidate[key], value, `${source}.${key} preserved`)
    }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      assert.equal(Object.keys(candidate[field] ?? {}).length, Object.keys(original[source][field] ?? {}).length)
      for (const spec of Object.values(candidate[field] ?? {})) assert.doesNotMatch(spec, /^(file:|link:|workspace:)/u)
    }
  }
  assert.equal(report.candidates['dsh-design-knowledge-ladybug'].dependencies['@ladybugdb/wasm-core'], `npm:${options.scope}/ladybug-wasm-core@${options.ladybugVersion}`)
  assert.equal(report.candidates['dsh-design-provider-web-app'].dependencies['@excalidraw/excalidraw'], '0.18.1')
  const nativeName = report.mapping['yugoo-design-git-native'].name
  assert.equal(nativeName, options.scope + '/yugoo-design-git-native')
  assert.equal(report.candidates['dsh-design-core'].dependencies[nativeName], options.version)
  assert.equal(report.candidates['yugoo-design-git-native'].license, 'MIT')
  const nativeLayer = report.publishLayers.findIndex(layer => layer.includes(nativeName))
  const coreLayer = report.publishLayers.findIndex(layer => layer.includes(report.mapping['dsh-design-core'].name))
  assert.ok(nativeLayer >= 0 && nativeLayer < coreLayer, 'Native Git must be published before dependent Core')
  const controller = '@deepseek-ai/dsh-api-session-controller'
  const sourcePanel = original['dsh-design-panel']
  const expectedDevelopment = sourcePanel.devDependencies[controller].startsWith('link:')
    ? sourcePanel.peerDependencies[controller] : sourcePanel.devDependencies[controller]
  assert.equal(report.candidates['dsh-design-panel'].peerDependencies[controller], sourcePanel.peerDependencies[controller])
  assert.equal(report.candidates['dsh-design-panel'].devDependencies[controller], expectedDevelopment)
})

test('native Git follows the same scoped release mapping as its Core consumer', async () => {
  const original = await registrySources()
  for (const scope of ['@fixture-one', '@fixture-two']) {
    const report = createNpmCandidates(original, { ...registryOptions, scope, version: '9.0.0-review.1' })
    const name = scope + '/yugoo-design-git-native'
    assert.equal(report.mapping['yugoo-design-git-native'].name, name)
    assert.equal(report.mapping['yugoo-design-git-native'].version, '9.0.0-review.1')
    assert.equal(report.candidates['dsh-design-core'].dependencies[name], '9.0.0-review.1')
  }
})

test('complete per-package versions preserve unchanged pins and project only the exact changed closure', async t => {
  const original = await registrySources()
  const versions = Object.fromEntries(Object.keys(original).map(name => [name, '0.1.0-beta.2']))
  versions['dsh-design-panel'] = '0.1.0-r1-local.20261017.1'
  versions['dsh-design-provider-web-app'] = versions['dsh-design-panel']
  versions['@yugoo-design/dsh-design-system-dsh'] = '0.1.0-r1-local.20261017.2'
  const selected = { ...registryOptions, versions }
  delete selected.version
  const report = createNpmCandidates(original, selected)
  const name = source => report.mapping[source].name
  assert.deepEqual(Object.fromEntries(Object.entries(report.mapping).map(([key, value]) => [key, value.version])), versions)
  assert.equal(report.candidates['dsh-design-provider-web-app'].peerDependencies[name('dsh-design-panel')], versions['dsh-design-panel'])
  assert.equal(report.candidates['dsh-design-provider-web-app'].peerDependencies[name('dsh-design-core')], '0.1.0-beta.2')
  assert.equal(report.candidates['dsh-design-core'].dependencies[name('yugoo-design-git-native')], '0.1.0-beta.2')
  const before = structuredClone(versions)
  const root = await fixtureWorkspace(t, original), file = join(root, 'versions.json')
  await writeFile(file, JSON.stringify(versions))
  assert.deepEqual(await runNpmCandidateCli(['--scope', selected.scope, '--versions-file', file,
    '--ladybug-version', selected.ladybugVersion, '--ladybug-source', 'registry'], root), report)
  assert.deepEqual(versions, before)
  assert.equal(report.publishReady, false)
})

test('per-package version selection rejects ambiguous, incomplete, extra and ranged identities', async () => {
  const original = await registrySources()
  const versions = Object.fromEntries(Object.keys(original).map(name => [name, '0.1.0-beta.2']))
  const selected = { ...registryOptions, versions }; delete selected.version
  assert.throws(() => createNpmCandidates(original, { ...selected, version: '0.1.0' }), /version.*versions|versions.*version/)
  for (const mutate of [
    value => { delete value['dsh-design-core'] },
    value => { value.unknown = '0.1.0' },
    value => { value['dsh-design-panel'] = '^0.1.0' },
    value => { value['dsh-design-panel'] = 'latest' },
    value => { value['dsh-design-panel'] = 'v0.1.0' },
    value => { value['dsh-design-panel'] = null },
  ]) {
    const bad = structuredClone(versions); mutate(bad)
    assert.throws(() => createNpmCandidates(original, { ...selected, versions: bad }))
  }
  for (const bad of [null, [], '0.1.0']) assert.throws(() => createNpmCandidates(original, { ...selected, versions: bad }))
})

test('public host pins survive independently, while local development links use the declared peer contract', async () => {
  const controller = '@deepseek-ai/dsh-api-session-controller'
  for (const fixture of [
    { peer: '0.1.2-rc.1', dev: '0.1.2-rc.1', expectedDev: '0.1.2-rc.1' },
    { peer: '0.1.2-rc.2', dev: '0.1.2-rc.1', expectedDev: '0.1.2-rc.1' },
    { peer: '0.1.2-rc.1', dev: 'link:../../deepseek-harness/packages/api/session-controller', expectedDev: '0.1.2-rc.1' },
  ]) {
    // Synthetic version contracts, not evidence of registry availability or compatibility.
    const original = await sources()
    original['dsh-design-panel'].peerDependencies[controller] = fixture.peer
    original['dsh-design-panel'].devDependencies[controller] = fixture.dev
    const before = structuredClone(original)
    const candidate = createNpmCandidates(original, options).candidates['dsh-design-panel']
    assert.equal(candidate.peerDependencies[controller], fixture.peer)
    assert.equal(candidate.devDependencies[controller], fixture.expectedDev)
    assert.deepEqual(original, before)
  }
})

test('publication topology includes runtime and internal peer edges, excludes development-only edges', async t => {
  const root = await fixtureWorkspace(t, await sources())
  const report = await readNpmCandidates(root, options)
  const ranks = new Map(report.publishLayers.flatMap((layer, index) => layer.map(name => [name, index])))
  assert.equal(ranks.size, 11)
  for (const edge of report.edges) {
    assert.ok(ranks.get(edge.to) < ranks.get(edge.from))
    assert.notEqual(edge.field, 'devDependencies')
  }
  const name = source => report.mapping[source].name
  assert.ok(ranks.get(name('dsh-design-studio-ui')) < ranks.get(name('dsh-design-studio-dsh')))
  assert.ok(ranks.get(name('@ladybugdb/wasm-core')) < ranks.get(name('dsh-design-knowledge-ladybug')))
  assert.equal(report.publishLayers.at(-1).includes(name('@yugoo-design/dsh-design-system-dsh')), true)
})

test('unknown external dependencies survive, unresolved local references fail instead of disappearing', async () => {
  const original = await sources()
  original['dsh-design-core'].dependencies['unknown-public-package'] = '^2.3.0'
  assert.equal(createNpmCandidates(original, options).candidates['dsh-design-core'].dependencies['unknown-public-package'], '^2.3.0')
  for (const field of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) {
    const bad = structuredClone(original)
    bad['dsh-design-core'][field] = { ...bad['dsh-design-core'][field], 'unknown-local-package': 'file:../unknown' }
    assert.throws(() => createNpmCandidates(bad, options), /unresolved external local reference/u)
  }
})

test('a valid peer range cannot authorize a local runtime or optional dependency', async () => {
  const original = await sources()
  const dependency = 'synthetic-host-peer'
  original['dsh-design-core'].peerDependencies[dependency] = '^1.0.0'
  for (const field of ['dependencies', 'optionalDependencies']) {
    const bad = structuredClone(original)
    bad['dsh-design-core'][field] = { ...bad['dsh-design-core'][field], [dependency]: 'file:../synthetic-host-peer' }
    const before = structuredClone(bad)
    assert.throws(() => createNpmCandidates(bad, options), /unresolved external local reference/u)
    assert.deepEqual(bad, before)
  }
  const development = structuredClone(original)
  development['dsh-design-core'].devDependencies[dependency] = 'file:../synthetic-host-peer'
  assert.equal(createNpmCandidates(development, options).candidates['dsh-design-core'].devDependencies[dependency], '^1.0.0')
})

test('wrong internal path, cycles and unhandled overrides fail loudly', async () => {
  const original = await sources()
  const path = structuredClone(original)
  path['dsh-design-knowledge-ladybug'].dependencies['@ladybugdb/wasm-core'] = 'file:../core'
  assert.throws(() => createNpmCandidates(path, options), /local path does not match/u)
  const cycle = structuredClone(original)
  cycle['dsh-design-core'].peerDependencies['dsh-design-studio'] = '0.0.0'
  assert.throws(() => createNpmCandidates(cycle, options), /publication cycle/u)
  for (const key of ['overrides', 'pnpm', 'resolutions', 'bundleDependencies', 'bundledDependencies']) {
    const bad = structuredClone(original)
    bad['dsh-design-core'][key] = {}
    assert.throws(() => createNpmCandidates(bad, options), /explicit migration policy/u)
  }
})

test('optional internal peers retain metadata and remain publication dependencies', async () => {
  const original = await sources()
  original['dsh-design-studio'].peerDependenciesMeta = { 'dsh-design-core': { optional: true }, 'external-peer': { optional: true } }
  original['dsh-design-studio'].peerDependencies['external-peer'] = '^1.0.0'
  const report = createNpmCandidates(original, options)
  const candidate = report.candidates['dsh-design-studio']
  assert.equal(candidate.peerDependenciesMeta[report.mapping['dsh-design-core'].name].optional, true)
  assert.equal(candidate.peerDependenciesMeta['external-peer'].optional, true)
  assert.equal(report.externalPeers.find(peer => peer.name === 'external-peer').optional, true)
  assert.equal(candidate.peerDependencies[report.mapping['dsh-design-core'].name], options.version)
})

test('scope/version and CLI flags must be explicit and valid; no implicit latest or publish option', async t => {
  const original = await sources()
  for (const bad of [{ ...options, scope: 'fixture' }, { ...options, scope: '@Uppercase' }, { ...options, version: 'latest' }, { ...options, ladybugVersion: undefined }]) {
    assert.throws(() => createNpmCandidates(original, bad))
  }
  for (const args of [[], ['--publish', 'yes'], ['--scope'], ['--scope', '@fixture', '--scope', '@duplicate']]) {
    await assert.rejects(runNpmCandidateCli(args))
  }
  const root = await fixtureWorkspace(t, original)
  assert.deepEqual(await runNpmCandidateCli(['--scope', options.scope, '--version', options.version, '--ladybug-version', options.ladybugVersion], root), createNpmCandidates(original, options))
  const registry = await registrySources()
  const registryRoot = await fixtureWorkspace(t, registry)
  assert.deepEqual(await runNpmCandidateCli(['--scope', registryOptions.scope, '--version', registryOptions.version,
    '--ladybug-version', registryOptions.ladybugVersion, '--ladybug-source', 'registry'], registryRoot), createNpmCandidates(registry, registryOptions))
  await assert.rejects(runNpmCandidateCli(['--scope', options.scope, '--version', options.version,
    '--ladybug-version', options.ladybugVersion], registryRoot), /ENOENT/)
})
