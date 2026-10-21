import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { satisfies } from 'semver'
import { RELEASE_PACKAGES, parsePhysicalGateOptions, candidateArchiveName, createReleaseConsumerConfig, assertRequiredPeers, assertCandidatePeerReport } from './release-consumer-config.mjs'
import { assertWebAppContentManifest, assertNativeGitManifest } from './release-physical-distribution-gate.mjs'

const candidates = () => Object.fromEntries(Object.keys(RELEASE_PACKAGES).map(name => {
  const version = name.startsWith('@') ? '0.19.1-walfix.1' : '0.0.0'
  return [name, { version, archive: candidateArchiveName(name, version) }]
}))

test('registry consumer includes the native Git tarball and exact official Ladybug without vendor archive', () => {
  const input = candidates(); delete input['@ladybugdb/wasm-core']
  const before = structuredClone(input)
  const options = { ladybugSource: 'registry', ladybugVersion: '0.21.1' }
  const config = createReleaseConsumerConfig(input, options)
  assert.deepEqual(input, before)
  assert.equal(Object.keys(config.manifest.dependencies).length, 11)
  assert.equal(config.manifest.dependencies['@ladybugdb/wasm-core'], '0.21.1')
  assert.deepEqual(config.workspace.overrides, config.manifest.dependencies)
  assert.equal(Object.values(config.manifest.dependencies).filter(spec => spec.startsWith('file:')).length, 10)
  assert.equal(config.manifest.dependencies['yugoo-design-git-native'], 'file:../tarballs/yugoo-design-git-native-0.0.0.tgz')
  for (const version of [undefined, null, '^0.21.1', 'latest']) {
    assert.throws(() => createReleaseConsumerConfig(input, { ...options, ladybugVersion: version }), /Ladybug version/)
  }
  assert.throws(() => createReleaseConsumerConfig(candidates(), options), /candidate packages/)
  assert.throws(() => createReleaseConsumerConfig(input, { ...options, ladybugSource: 'guess' }), /Ladybug source/)
})

test('physical registry selection requires exact version and integrity before any packaging action', () => {
  const integrity = 'sha512-' + Buffer.alloc(64, 1).toString('base64')
  const args = ['--ladybug-source', 'registry', '--ladybug-version', '0.21.1', '--ladybug-integrity', integrity]
  assert.deepEqual(parsePhysicalGateOptions(args), { ladybugSource: 'registry', ladybugVersion: '0.21.1', ladybugIntegrity: integrity, evidenceArgs: [] })
  assert.deepEqual(parsePhysicalGateOptions([...args, '--evidence-dir', '/synthetic/evidence']).evidenceArgs, ['--evidence-dir', '/synthetic/evidence'])
  for (const bad of [args.slice(0, 4), ['--ladybug-source', 'guess'],
    ['--ladybug-source', 'registry', '--ladybug-version', '^0.21.1', '--ladybug-integrity', integrity],
    [...args, '--ladybug-source', 'registry'], ['--publish', 'yes'], ['--ladybug-version', '0.21.1'],
    ['--ladybug-source', 'registry', '--ladybug-version', '0.21.1', '--ladybug-integrity', 'sha512-not-a-digest']]) {
    assert.throws(() => parsePhysicalGateOptions(bad))
  }
  assert.equal(parsePhysicalGateOptions([]).ladybugSource, 'vendored')
})

test('pnpm11 gets workspace overrides and every explicit tarball dependency, including native Git and peer-only Studio', () => {
  const { manifest, workspace } = createReleaseConsumerConfig(candidates())
  assert.equal(Object.keys(manifest.dependencies).length, 11)
  assert.equal(manifest.pnpm, undefined)
  assert.deepEqual(workspace.overrides, manifest.dependencies)
  assert.equal(workspace.autoInstallPeers, false)
  assert.equal(workspace.ignoreScripts, true)
  assert.equal(manifest.dependencies['dsh-design-studio'], 'file:../tarballs/dsh-design-studio-0.0.0.tgz')
  assert.equal(manifest.dependencies['dsh-design-studio-ui'], 'file:../tarballs/dsh-design-studio-ui-0.0.0.tgz')
  assert.equal(manifest.dependencies['@ladybugdb/wasm-core'], 'file:../tarballs/ladybugdb-wasm-core-0.19.1-walfix.1.tgz')
  assert.deepEqual(JSON.parse(JSON.stringify(workspace)), workspace)
})

test('configuration is deterministic and portable, without source/host paths', () => {
  const entries = Object.entries(candidates())
  const a = createReleaseConsumerConfig(Object.fromEntries(entries))
  const b = createReleaseConsumerConfig(Object.fromEntries(entries.reverse()))
  assert.deepEqual(a, b)
  for (const ref of Object.values(a.manifest.dependencies)) assert.match(ref, /^file:\.\.\/tarballs\/[^/]+\.tgz$/u)
  assert.ok(!JSON.stringify(a).includes('deepseek-harness'))
})

test('missing, extra, mismatched version and ambiguous Studio-prefix candidates are rejected', () => {
  const missing = candidates(); delete missing['dsh-design-studio']
  assert.throws(() => createReleaseConsumerConfig(missing), /candidate packages/u)
  assert.throws(() => createReleaseConsumerConfig({ ...candidates(), rogue: {} }), /candidate packages/u)
  for (const archive of ['dsh-design-studio-ui-0.0.0.tgz', 'dsh-design-studio-1.0.0.tgz', '../../source.tgz']) {
    const inputs = candidates(); inputs['dsh-design-studio'].archive = archive
    assert.throws(() => createReleaseConsumerConfig(inputs), /exact candidate/u)
  }
  assert.throws(() => candidateArchiveName('dsh-design-core', '../bad'), /version/u)
})

test('required official peer absence fails with package/range, never treated as a host PASS', async () => {
  await assert.rejects(assertRequiredPeers({ name: 'fixture', peerDependencies: { '@deepseek-ai/dsh-agent': '0.1.0' } }, () => { throw Object.assign(new Error('not found'), { code: 'PEER_NOT_FOUND' }) }, satisfies), /unresolved required peer @deepseek-ai\/dsh-agent@0.1.0/u)
})

test('required peer checks use the package resolver; explicitly optional peers may be absent', async () => {
  const seen = []
  await assertRequiredPeers({ name: 'fixture', peerDependencies: { required: '1.0.0', optional: '2.0.0' }, peerDependenciesMeta: { optional: { optional: true } } }, name => {
    seen.push(name)
    if (name === 'optional') throw Object.assign(new Error('missing'), { code: 'PEER_NOT_FOUND' })
    return '1.0.0'
  }, satisfies)
  assert.deepEqual(seen, ['required', 'optional'])
})

test('resolved wrong versions and incompatible present optional peers fail', async () => {
  for (const optional of [false, true]) {
    await assert.rejects(assertRequiredPeers({ name: 'fixture', peerDependencies: { peer: '^1.2.0' }, peerDependenciesMeta: { peer: { optional } } }, () => '2.0.0', satisfies), /incompatible peer peer@2.0.0; required \^1.2.0/u)
  }
})

test('prerelease ranges use standard semver admission, not numeric-only comparison', async () => {
  const manifest = { name: 'fixture', peerDependencies: { peer: '>=0.1.0-rc.5 <0.2.0' } }
  await assertRequiredPeers(manifest, () => '0.1.0-rc.6', satisfies)
  await assert.rejects(assertRequiredPeers(manifest, () => '0.1.1-alpha.1', satisfies), /incompatible peer/u)
  await assert.rejects(assertRequiredPeers(manifest, () => '0.2.0', satisfies), /incompatible peer/u)
})

test('optional resolution errors other than actual absence are never swallowed', async () => {
  const manifest = { name: 'fixture', peerDependencies: { peer: '*' }, peerDependenciesMeta: { peer: { optional: true } } }
  await assert.rejects(assertRequiredPeers(manifest, () => { throw Object.assign(new Error('outside consumer'), { code: 'ESCAPE' }) }, satisfies), /outside consumer/u)
})

test('incomplete, duplicated and unknown candidate reports cannot bypass peer validation', async () => {
  const fixed = { fixture: { peerDependencies: { peer: '^1.0.0' } } }
  const valid = { name: 'fixture', peers: { peer: { version: '1.0.0' } } }
  await assertCandidatePeerReport(fixed, [valid], satisfies)
  for (const report of [[], [valid, valid], [{ ...valid, name: 'unknown' }], [{ name: 'fixture', peers: {} }], [{ name: 'fixture', peers: { peer: { unknown: true } } }]]) {
    await assert.rejects(assertCandidatePeerReport(fixed, report, satisfies))
  }
})

test('optional policy comes from fixed candidate, not a report attempting to waive requirements', async () => {
  const report = [{ name: 'fixture', manifest: { peerDependencies: {} }, peers: { peer: { missing: true } } }]
  await assert.rejects(assertCandidatePeerReport({ fixture: { peerDependencies: { peer: '*' } } }, report, satisfies), /unresolved required peer/u)
  await assertCandidatePeerReport({ fixture: { peerDependencies: { peer: '*' }, peerDependenciesMeta: { peer: { optional: true } } } }, report, satisfies)
})

test('rendered consumer verifier has valid syntax without running pack, install or the verifier', async t => {
  const source = await readFile(new URL('./release-physical-distribution-gate.mjs', import.meta.url), 'utf8')
  const marker = 'await writeFile(verifier, `'
  assert.ok(source.includes(marker))
  const start = source.indexOf(marker) + 'await writeFile(verifier, '.length
  const end = source.indexOf("\n`)\n  run('verify'", start) + 2
  assert.ok(end > start)
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const render = new AsyncFunction('candidates', 'config', 'workspace', 'readFile', 'join', 'RELEASE_PACKAGES', 'selection', 'assertWebAppContentManifest', 'assertNativeGitManifest', 'return ' + source.slice(start, end))
  const inputs = candidates()
  const workspace = fileURLToPath(new URL('../', import.meta.url))
  // Syntax fixtures model the legacy manifest without requiring its excluded
  // runtime checkout. Registry rendering below must never request this input.
  const vendorManifestPath = join(workspace, 'vendor/ladybug/runtime/package.json')
  const vendorManifest = { name: '@ladybugdb/wasm-core', version: '0.19.1-walfix.1', license: 'MIT',
    description: 'Synthetic legacy syntax fixture', type: 'module', main: './index.js',
    exports: { '.': './index.js' }, files: ['index.js', 'LICENSE'] }
  let vendorReads = 0
  const script = await render(inputs, createReleaseConsumerConfig(inputs), workspace, (file, ...args) => {
    if (file === vendorManifestPath) {
      vendorReads += 1
      return Promise.resolve(JSON.stringify(vendorManifest))
    }
    return readFile(file, ...args)
  }, join, RELEASE_PACKAGES, { ladybugSource: 'vendored' }, assertWebAppContentManifest, assertNativeGitManifest)
  assert.equal(vendorReads, 1, 'Vendored template must retain its manifest identity check')
  assert.ok(script.includes(JSON.stringify(vendorManifest)))
  const directory = await mkdtemp(join(tmpdir(), 'release-verifier-syntax-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'verify.mjs')
  await writeFile(path, script)
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const registryInputs = candidates(); delete registryInputs['@ladybugdb/wasm-core']
  const selection = { ladybugSource: 'registry', ladybugVersion: '0.21.1', ladybugIntegrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64') }
  const registryScript = await render(registryInputs, createReleaseConsumerConfig(registryInputs, selection), workspace,
    (file, ...args) => {
      assert.ok(!file.includes('vendor/ladybug'), 'Registry render must not read vendored manifest')
      return readFile(file, ...args)
    }, join, RELEASE_PACKAGES, selection, assertWebAppContentManifest, assertNativeGitManifest)
  await writeFile(path, registryScript)
  assert.equal(spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' }).status, 0)
  assert.ok(registryScript.includes('Official Ladybug registry integrity mismatch'))
})
