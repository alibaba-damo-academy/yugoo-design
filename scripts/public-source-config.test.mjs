import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { proposePublicSourceConfig } from './public-source-config.mjs'
import { satisfies } from 'semver'
import YAML from 'yaml'

function fixture() {
  return {
    root: { name: 'source', private: true, scripts: { build: 'pnpm -r build', dogfood: './start.sh' },
      main: 'index.js', repository: { url: 'private' }, devDependencies: { typescript: '^6.0.3' } },
    workspace: { packages: ['packages/*'], allowBuilds: { sharp: false } },
    packages: {
      'packages/core/package.json': { name: 'core', peerDependencies: { '@deepseek-ai/dsh-agent': '>=0.1.0-rc.5 <0.2.0' },
        devDependencies: { '@deepseek-ai/dsh-agent': 'link:../../deepseek-harness/packages/core/agent' } },
      'packages/panel/package.json': { name: 'panel', devDependencies: { core: 'link:../core' } },
      'packages/knowledge-ladybug/package.json': { name: 'knowledge', dependencies: { '@ladybugdb/wasm-core': 'file:../../vendor/ladybug/runtime' } },
    },
    officialVersions: { '@deepseek-ai/dsh-agent': '0.1.2-rc.1' }, ladybugVersion: '0.21.1', rootScripts: ['build'],
  }
}

test('reviewed development-only test exclusions are exact, immutable and recorded in the root change ledger', () => {
  const input = fixture()
  input.root.scripts.contracts = 'node --test scripts/dev-env.test.mjs scripts/core.test.mjs scripts/dev-env.test.mjs-extra.mjs'
  input.rootScripts.push('contracts')
  input.rootScriptFileExclusions = { contracts: ['scripts/dev-env.test.mjs'] }
  const before = structuredClone(input), result = proposePublicSourceConfig(input)
  assert.deepEqual(input, before)
  assert.equal(result.root.scripts.contracts, 'node --test scripts/core.test.mjs scripts/dev-env.test.mjs-extra.mjs')
  const change = result.changes.find(item => item.path === 'package.json' && item.field === 'scripts')
  assert.equal(change.before.contracts, before.root.scripts.contracts)
  assert.equal(change.after.contracts, result.root.scripts.contracts)
  for (const mutate of [
    x => { x.rootScriptFileExclusions.contracts = ['scripts/missing.test.mjs'] },
    x => { x.rootScriptFileExclusions.contracts.push('scripts/dev-env.test.mjs') },
    x => { x.rootScriptFileExclusions.contracts = null },
    x => { x.rootScriptFileExclusions.unselected = [] },
    x => { x.rootScriptFileExclusions.contracts = ['scripts/dev-env.test.mjs', 'scripts/core.test.mjs', 'scripts/dev-env.test.mjs-extra.mjs'] },
    x => { x.root.scripts.contracts += ' && echo bypass' },
    x => { x.root.scripts.contracts = 'node --test scripts/*.mjs' },
    x => { x.root.scripts.contracts = 'vitest run scripts/dev-env.test.mjs scripts/core.test.mjs' },
    x => { x.root.scripts.contracts = 'jest --ci scripts/dev-env.test.mjs scripts/core.test.mjs' },
    x => { x.rootScriptFileExclusions = [] },
  ]) { const bad = structuredClone(before); mutate(bad); assert.throws(() => proposePublicSourceConfig(bad)) }
})

test('proposal keeps source immutable, internal names/edges and workspace safeguards', () => {
  const input = fixture(), before = structuredClone(input), result = proposePublicSourceConfig(input)
  assert.deepEqual(input, before)
  assert.deepEqual(result.root.scripts, { build: 'pnpm -r build' })
  assert.equal(result.root.private, true)
  assert.equal(Object.hasOwn(result.root, 'repository'), false)
  assert.equal(Object.hasOwn(result.root, 'main'), false)
  assert.deepEqual(result.workspace, input.workspace)
  assert.deepEqual(result.packages['packages/panel/package.json'], input.packages['packages/panel/package.json'])
  const core = result.packages['packages/core/package.json']
  assert.equal(core.devDependencies['@deepseek-ai/dsh-agent'], '0.1.2-rc.1')
  assert.ok(satisfies('0.1.2-rc.1', core.peerDependencies['@deepseek-ai/dsh-agent']))
  assert.ok(satisfies('0.1.0-rc.5', core.peerDependencies['@deepseek-ai/dsh-agent']))
  assert.ok(!satisfies('0.1.2-rc.2', core.peerDependencies['@deepseek-ai/dsh-agent']))
  assert.equal(result.packages['packages/knowledge-ladybug/package.json'].dependencies['@ladybugdb/wasm-core'], '0.21.1')
  assert.equal(result.releaseApproved, false); assert.equal(result.installed, false); assert.equal(result.built, false)
  assert.equal(result.changes.length, 6)
})

test('unknown or wrongly placed local dependencies and missing/unused versions cannot disappear', () => {
  const mutations = [
    input => { input.officialVersions = {} },
    input => { input.officialVersions['@deepseek-ai/dsh-tools'] = '0.1.2-rc.1' },
    input => { input.officialVersions['@deepseek-ai/dsh-agent'] = '^0.1.2' },
    input => { input.officialVersions['@deepseek-ai/dsh-agent'] = null },
    input => { input.ladybugVersion = null },
    input => { input.packages['packages/core/package.json'].dependencies = input.packages['packages/core/package.json'].devDependencies },
    input => { input.packages['packages/panel/package.json'].devDependencies.other = 'link:../other' },
    input => { input.packages['packages/panel/package.json'].devDependencies.core = 'link:../wrong' },
    input => { input.packages['packages/panel/package.json'].devDependencies.core = 'workspace:../../outside' },
    input => { input.packages['packages/panel/package.json'].dependencies = { '@ladybugdb/wasm-core': '0.21.1' } },
    input => { input.packages['packages/core/package.json'].peerDependencies = {} },
  ]
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => proposePublicSourceConfig(input)) }
})

test('already selected exact registry Ladybug and explicitly reviewed registry overrides are preserved', () => {
  const input = fixture()
  input.packages['packages/knowledge-ladybug/package.json'].dependencies['@ladybugdb/wasm-core'] = '0.21.1'
  input.workspace.overrides = { dompurify: '3.4.16' }
  input.reviewedWorkspaceOverrides = { dompurify: '3.4.16' }
  const before = structuredClone(input), result = proposePublicSourceConfig(input)
  assert.deepEqual(input, before)
  assert.deepEqual(result.workspace.overrides, before.workspace.overrides)
  assert.equal(result.packages['packages/knowledge-ladybug/package.json'].dependencies['@ladybugdb/wasm-core'], '0.21.1')
  assert.ok(!result.changes.some(change => change.path === 'packages/knowledge-ladybug/package.json'))
  for (const mutate of [
    x => { x.reviewedWorkspaceOverrides = {} },
    x => { x.reviewedWorkspaceOverrides.dompurify = '3.4.15' },
    x => { x.workspace.overrides = x.reviewedWorkspaceOverrides = { dompurify: '^3.4.16' } },
    x => { x.workspace.overrides = x.reviewedWorkspaceOverrides = { dompurify: 'file:../private' } },
    x => { x.workspace.overrides = x.reviewedWorkspaceOverrides = { '@deepseek-ai/dsh-agent': '0.1.2-rc.1' } },
    x => { x.workspace.overrides = x.reviewedWorkspaceOverrides = { core: '0.1.0' } },
    x => { x.packages['packages/knowledge-ladybug/package.json'].dependencies['@ladybugdb/wasm-core'] = '^0.21.1' },
  ]) { const bad = structuredClone(before); mutate(bad); assert.throws(() => proposePublicSourceConfig(bad)) }
})

test('development scripts, ambiguous root/workspace policies and invalid identities fail explicitly', () => {
  const mutations = [
    input => { input.rootScripts = ['dogfood'] },
    input => { input.rootScripts = ['build', 'build'] },
    input => { input.rootScripts = ['missing'] },
    input => { input.root.scripts.build = 'pnpm --dir deepseek-harness build' },
    input => { input.root.devDependencies.foo = 'link:../foo' },
    input => { input.workspace.autoInstallPeers = false },
    input => { input.workspace.strictPeerDependencies = false },
    input => { input.workspace.overrides = { foo: '1.0.0' } },
    input => { input.root.pnpm = {} },
    input => { input.workspace.packages.push('deepseek-harness/**') },
    input => { input.workspace.peerDependencyRules = { ignoreMissing: ['*'] } },
    input => { input.packages['packages/core/package.json'].pnpm = { overrides: {} } },
    input => { input.packages['packages/panel/package.json'].name = 'core' },
    input => { input.packages['../outside/package.json'] = { name: 'outside' } },
  ]
  for (const mutate of mutations) { const input = fixture(); mutate(input); assert.throws(() => proposePublicSourceConfig(input)) }
})

test('current source inventory proposes official edges, not dogfood or host source distribution', () => {
  const repo = new URL('../', import.meta.url), packages = {}
  for (const name of readdirSync(new URL('packages/', repo))) {
    const path = `packages/${name}/package.json`
    try { packages[path] = JSON.parse(readFileSync(new URL(path, repo), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const root = JSON.parse(readFileSync(new URL('package.json', repo), 'utf8'))
  const workspace = YAML.parse(readFileSync(new URL('pnpm-workspace.yaml', repo), 'utf8'))
  const baseline = JSON.parse(readFileSync(new URL('release/public-source-baseline.json', repo), 'utf8'))
  const { officialVersions, ladybugVersion, rootScripts, reviewedWorkspaceOverrides } = baseline
  const result = proposePublicSourceConfig({ root, workspace, packages, officialVersions, ladybugVersion, rootScripts, reviewedWorkspaceOverrides })
  assert.equal(Object.keys(officialVersions).length, 28)
  const projectedCore = result.packages['packages/core/package.json']
  const scopeVersion = officialVersions['@deepseek-ai/dsh-scope']
  assert.ok(satisfies(scopeVersion, projectedCore.peerDependencies['@deepseek-ai/dsh-scope']))
  assert.equal(projectedCore.devDependencies['@deepseek-ai/dsh-scope'], scopeVersion)
  assert.equal(officialVersions['@deepseek-ai/dsh-subprocess-local'], '0.2.0-rc.2')
  assert.equal(projectedCore.devDependencies['@deepseek-ai/dsh-subprocess-local'], '0.2.0-rc.2')
  assert.ok(!JSON.stringify(result.packages).includes('deepseek-harness'))
  assert.deepEqual(result.workspace.allowBuilds, workspace.allowBuilds)
  assert.equal(result.workspace.overrides.undici,
    packages['packages/knowledge-ladybug/package.json'].dependencies.undici,
    'Public source must retain the reviewed undici security version for transitive consumers')
  const missingSecurityOverride = { ...reviewedWorkspaceOverrides }
  delete missingSecurityOverride.undici
  assert.throws(() => proposePublicSourceConfig({ root, workspace, packages, officialVersions,
    ladybugVersion, rootScripts, reviewedWorkspaceOverrides: missingSecurityOverride }),
  /Workspace overrides require exact explicit review/)
  assert.equal(result.lockAction, 'regenerate-in-isolated-source-candidate')
  assert.equal(projectedCore.devDependencies['@deepseek-ai/dsh-agent'], officialVersions['@deepseek-ai/dsh-agent'])
  const selection = JSON.parse(readFileSync(new URL('release/public-source-test-selection.json', repo), 'utf8'))
  const selected = proposePublicSourceConfig({ root, workspace, packages, officialVersions, ladybugVersion,
    rootScripts, rootScriptFileExclusions: selection.rootScriptFileExclusions, reviewedWorkspaceOverrides })
  const beforeTests = root.scripts['test:public-contracts'].split(/\s+/u).slice(2)
  const afterTests = selected.root.scripts['test:public-contracts'].split(/\s+/u).slice(2)
  assert.deepEqual(afterTests, beforeTests.filter(file => file !== 'scripts/public-env-template.test.mjs'))
  assert.equal(beforeTests.length - afterTests.length, 1)
  assert.equal(selected.root.scripts.build, root.scripts.build)
})
