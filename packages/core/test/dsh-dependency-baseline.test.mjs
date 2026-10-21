import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { valid } from 'semver'
import { host, installedPackage, assertPeer, installedPeer, assertCordisIdentity } from './dsh-dependency-helpers.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const requireFromCore = createRequire(new URL('../package.json', import.meta.url))

test('Core development host pins are exact public versions admitted by their declared peers', () => {
  for (const [name, version] of Object.entries(manifest.devDependencies).filter(([name]) => host(name))) {
    assert.equal(valid(version), version, `${name}: use one exact registry baseline, not a mixed checkout link`)
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.2.0-rc.2', `${name}: Web and Desktop development use the released RC2 SDK`)
    assertPeer(name, version, manifest.peerDependencies[name])
  }
})

test('installed Core host dependencies match pins and share the Cordis declaration/runtime identity', () => {
  const cordis = installedPackage('@deepseek-ai/cordis', requireFromCore)
  for (const [name, version] of Object.entries(manifest.devDependencies).filter(([name]) => host(name))) {
    const installed = installedPackage(name, requireFromCore)
    assert.equal(installed.manifest.version, version, `${name}: installed graph differs from the selected baseline`)
    assertPeer(name, installed.manifest.version, manifest.peerDependencies[name])
    for (const [peer, range] of Object.entries(installed.manifest.peerDependencies ?? {}).filter(([peer]) => host(peer))) {
      const dependency = installedPeer(peer, createRequire(installed.entry), installed.manifest.peerDependenciesMeta?.[peer]?.optional === true)
      if (!dependency) continue
      assertPeer(peer, dependency.manifest.version, range)
    }
    const range = installed.manifest.peerDependencies?.['@deepseek-ai/cordis']
      ?? installed.manifest.dependencies?.['@deepseek-ai/cordis']
    if (!range) continue
    const dependency = installedPackage('@deepseek-ai/cordis', createRequire(installed.entry))
    assertPeer('@deepseek-ai/cordis', dependency.manifest.version, range)
    assertCordisIdentity(cordis.entry, name, dependency.entry)
  }
})

test('a different Cordis identity is refused even if both copies claim the same version', () => {
  assert.throws(() => assertCordisIdentity('/npm-a/cordis/index.js', 'dsh-agent', '/npm-b/cordis/index.js'), /different Cordis identity/)
})

test('only absent optional peers are allowed; required absence and installed version mismatches fail', () => {
  const missing = { resolve() { throw Object.assign(new Error('missing host peer'), { code: 'MODULE_NOT_FOUND' }) } }
  assert.equal(installedPeer('host-peer', missing, true), undefined)
  assert.throws(() => installedPeer('host-peer', missing), /missing host peer/)
  const broken = { resolve() { throw Object.assign(new Error('broken export'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }) } }
  assert.throws(() => installedPeer('host-peer', broken, true), /broken export/)
  assert.throws(() => assertPeer('optional-host-peer', '0.1.3-rc.1', '0.1.2-rc.1'), /does not satisfy/)
})

test('prerelease peers are explicit; a broad stable range must not silently admit an untested prerelease', () => {
  const range = '>=0.1.0-rc.5 <0.2.0'
  assert.throws(() => assertPeer('dsh-agent', '0.1.2-rc.1', range), /does not satisfy/)
  assertPeer('dsh-agent', '0.1.2-rc.1', `${range} || 0.1.2-rc.1`)
  assert.throws(() => assertPeer('dsh-agent', '0.1.3-rc.1', `${range} || 0.1.2-rc.1`), /does not satisfy/)
})

test('current DSH peer admission requires released RC2 and rejects unqualified Host versions', () => {
  const current = '0.2.0-rc.2'
  let changed = 0
  for (const packageName of ['core', 'panel', 'provider-web-app', 'studio-dsh']) {
    const value = JSON.parse(readFileSync(new URL(`../../${packageName}/package.json`, import.meta.url), 'utf8'))
    for (const [name, range] of Object.entries(value.peerDependencies).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))) {
      assert.equal(range, current, `${packageName}/${name}: the current public API requires exact RC2`)
      changed++
      assertPeer(name, current, range)
      for (const unknown of ['0.1.0-rc.5', '0.1.1-rc.2', '0.1.2-alpha.1', '0.1.2-rc.1', '0.1.3-rc.1', '0.2.0-rc.1', '0.2.0-rc.3', '0.2.0', '0.2.1', '0.3.0-rc.1']) {
        assert.throws(() => assertPeer(name, unknown, range), /does not satisfy/, `${packageName}/${name}: unknown ${unknown}`)
      }
    }
    if (packageName !== 'core') {
      assert.equal(value.peerDependencies.react, '^18.2.0')
      assert.equal(value.peerDependencies['react-dom'], '^18.2.0')
      assertPeer('react', '18.3.1', value.peerDependencies.react)
      assert.throws(() => assertPeer('react', '19.0.0', value.peerDependencies.react), /does not satisfy/)
    }
  }
  assert.equal(changed, 29, 'all DSH peers share the qualified current API boundary')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '^4.0.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/schemastery'], '^3.18.1')
})
