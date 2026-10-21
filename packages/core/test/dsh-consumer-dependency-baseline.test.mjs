import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { valid } from 'semver'
import { host, installedPackage, assertPeer, installedPeer, assertCordisIdentity } from './dsh-dependency-helpers.mjs'

const coreRequire = createRequire(new URL('../package.json', import.meta.url))
const core = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// Run this workspace-level check after building Core and its consumers. It is a
// separate script so a Core-only installed source can still run its own baseline.
for (const consumer of ['panel', 'provider-web-app', 'studio-dsh']) {
  const location = new URL(`../../${consumer}/package.json`, import.meta.url)
  const manifest = JSON.parse(readFileSync(location, 'utf8'))
  const requireFrom = createRequire(location)

  test(`${manifest.name}: exact host pins, required peers and Core share one Cordis identity`, () => {
    const expected = installedPackage('@deepseek-ai/cordis', coreRequire).entry
    assertCordisIdentity(expected, manifest.name, installedPackage('@deepseek-ai/cordis', requireFrom).entry)
    const installedCore = installedPackage('dsh-design-core', requireFrom)
    assert.equal(installedCore.manifest.version, core.version)
    assertCordisIdentity(expected, `${manifest.name} -> Core`, installedPackage('@deepseek-ai/cordis', createRequire(installedCore.entry)).entry)

    for (const [name, version] of Object.entries(manifest.devDependencies).filter(([name]) => host(name))) {
      assert.equal(valid(version), version, `${manifest.name}: ${name} must be one exact registry pin`)
      if (core.devDependencies[name]) assert.equal(version, core.devDependencies[name], `${manifest.name}: baseline differs from Core`)
      else assert.equal(version, core.devDependencies['@deepseek-ai/dsh-agent'], `${manifest.name}: DSH baseline differs from Core`)
      assertPeer(name, version, manifest.peerDependencies[name])
      const installed = installedPackage(name, requireFrom)
      assert.equal(installed.manifest.version, version, `${manifest.name}: installed ${name} differs from pin`)
      const dependencyRequire = createRequire(installed.entry)
      for (const [peer, range] of Object.entries(installed.manifest.peerDependencies ?? {}).filter(([peer]) => host(peer))) {
        const dependency = installedPeer(peer, dependencyRequire, installed.manifest.peerDependenciesMeta?.[peer]?.optional === true)
        if (dependency) assertPeer(peer, dependency.manifest.version, range)
      }
      const cordisRange = installed.manifest.peerDependencies?.['@deepseek-ai/cordis']
        ?? installed.manifest.dependencies?.['@deepseek-ai/cordis']
      if (cordisRange) {
        const cordis = installedPackage('@deepseek-ai/cordis', dependencyRequire)
        assertPeer('@deepseek-ai/cordis', cordis.manifest.version, cordisRange)
        assertCordisIdentity(expected, `${manifest.name} -> ${name}`, cordis.entry)
      }
    }
    for (const [peer, range] of Object.entries(manifest.peerDependencies).filter(([peer]) => /^(?:@deepseek-ai\/|dsh-design-|react(?:-dom)?$)/u.test(peer))) {
      const dependency = installedPackage(peer, requireFrom)
      assertPeer(peer, dependency.manifest.version, range)
      if (dependency.manifest.peerDependencies?.['@deepseek-ai/cordis']
        ?? dependency.manifest.dependencies?.['@deepseek-ai/cordis']) {
        assertCordisIdentity(expected, `${manifest.name} -> ${peer}`, installedPackage('@deepseek-ai/cordis', createRequire(dependency.entry)).entry)
      }
    }
  })
}
