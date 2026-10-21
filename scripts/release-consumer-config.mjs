import assert from 'node:assert/strict'
import { valid } from 'semver'

export const RELEASE_PACKAGES = Object.freeze({
  '@ladybugdb/wasm-core': 'vendor/ladybug/runtime',
  'yugoo-design-git-native': 'packages/git-native',
  'dsh-design-core': 'packages/core',
  'dsh-design-knowledge-ladybug': 'packages/knowledge-ladybug',
  'dsh-design-panel': 'packages/panel',
  'dsh-design-provider-web-app': 'packages/provider-web-app',
  'dsh-design-skills-web-app': 'packages/skills-web-app',
  'dsh-design-studio': 'packages/studio',
  'dsh-design-studio-ui': 'packages/studio-ui',
  'dsh-design-studio-dsh': 'packages/studio-dsh',
  'dsh-design-system-dsh': 'packages/dsh',
})

export function releasePackagesFor({ ladybugSource = 'vendored' } = {}) {
  assert.ok(['vendored', 'registry'].includes(ladybugSource), 'Explicit supported Ladybug source required')
  return ladybugSource === 'vendored' ? RELEASE_PACKAGES
    : Object.freeze(Object.fromEntries(Object.entries(RELEASE_PACKAGES).filter(([name]) => name !== '@ladybugdb/wasm-core')))
}

/** Separate physical-gate selection from the retained-evidence directory arguments. */
export function parsePhysicalGateOptions(args) {
  const flags = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    assert.ok(['--evidence-dir', '--ladybug-source', '--ladybug-version', '--ladybug-integrity'].includes(key)
      && !Object.hasOwn(flags, key), 'Unknown or duplicate physical gate option')
    assert.ok(typeof value === 'string' && value && !value.startsWith('--') && !/[\0\r\n]/u.test(value), 'Missing or invalid physical gate option')
    flags[key] = value
  }
  const ladybugSource = flags['--ladybug-source'] ?? 'vendored'
  releasePackagesFor({ ladybugSource })
  const ladybugVersion = flags['--ladybug-version'], ladybugIntegrity = flags['--ladybug-integrity']
  if (ladybugSource === 'registry') {
    assert.ok(typeof ladybugVersion === 'string' && valid(ladybugVersion) === ladybugVersion, 'Exact canonical registry Ladybug version required')
    assert.match(ladybugIntegrity ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/u, 'Explicit registry Ladybug integrity required')
  } else {
    assert.equal(ladybugVersion, undefined, 'Vendored version comes from the selected physical manifest')
    assert.equal(ladybugIntegrity, undefined, 'Registry integrity cannot describe a vendored candidate')
  }
  return { ladybugSource, ladybugVersion, ladybugIntegrity,
    evidenceArgs: flags['--evidence-dir'] ? ['--evidence-dir', flags['--evidence-dir']] : [] }
}

export function candidateArchiveName(name, version) {
  assert.ok(Object.hasOwn(RELEASE_PACKAGES, name), 'Unknown candidate package')
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u, 'Invalid candidate version')
  return `${name.replace(/^@/u, '').replace('/', '-')}-${version}.tgz`
}

// JSON is a YAML subset; no extra serializer/runtime dependency is needed.
export function createReleaseConsumerConfig(candidates, { ladybugSource = 'vendored', ladybugVersion } = {}) {
  const packages = releasePackagesFor({ ladybugSource })
  if (ladybugSource === 'registry') {
    assert.ok(typeof ladybugVersion === 'string' && valid(ladybugVersion) === ladybugVersion, 'Exact canonical registry Ladybug version required')
  }
  assert.deepEqual(Object.keys(candidates).sort(), Object.keys(packages).sort(), `Exactly ${Object.keys(packages).length} candidate packages required`)
  const dependencies = Object.fromEntries(Object.keys(packages).sort().map(name => {
    const candidate = candidates[name]
    assert.equal(candidate.archive, candidateArchiveName(name, candidate.version), 'Archive must match exact candidate identity')
    return [name, `file:../tarballs/${candidate.archive}`]
  }))
  if (ladybugSource === 'registry') dependencies['@ladybugdb/wasm-core'] = ladybugVersion
  return {
    manifest: { name: 'dsh-design-release-consumer', private: true, type: 'module', dependencies },
    workspace: { overrides: { ...dependencies }, autoInstallPeers: false, strictPeerDependencies: false, ignoreScripts: true },
  }
}

export async function assertRequiredPeers(manifest, resolvePeerVersion, satisfies) {
  assert.equal(typeof satisfies, 'function', 'A standard semver range validator is required')
  const issues = []
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    let version
    try { version = await resolvePeerVersion(name) } catch (error) {
      if (error.code !== 'PEER_NOT_FOUND') throw error
      if (manifest.peerDependenciesMeta?.[name]?.optional !== true) issues.push(`unresolved required peer ${name}@${range}`)
      continue
    }
    assert.equal(typeof version, 'string', `${manifest.name}: peer ${name} has no valid package version`)
    if (!satisfies(version, range)) issues.push(`incompatible peer ${name}@${version}; required ${range}`)
  }
  assert.equal(issues.length, 0, `${manifest.name}: ${issues.join(', ')}; provide an explicit compatible public host environment; do not auto-install latest`)
}

export async function assertCandidatePeerReport(candidates, report, satisfies) {
  assert.ok(Array.isArray(report), 'Peer report must be an array')
  assert.deepEqual(report.map(item => item.name).sort(), Object.keys(candidates).sort(), 'Peer report must contain every candidate exactly once')
  for (const item of report) {
    const candidate = candidates[item.name]
    assert.deepEqual(Object.keys(item.peers ?? {}).sort(), Object.keys(candidate.peerDependencies ?? {}).sort(), 'Peer report must contain every declared peer exactly once')
    await assertRequiredPeers({ name: item.name, peerDependencies: candidate.peerDependencies, peerDependenciesMeta: candidate.peerDependenciesMeta }, name => {
      const peer = item.peers[name]
      assert.ok(peer && typeof peer === 'object', 'Invalid peer report entry')
      if (peer.missing === true) {
        assert.deepEqual(Object.keys(peer), ['missing'], 'Ambiguous peer report entry')
        throw Object.assign(new Error('Peer is absent'), { code: 'PEER_NOT_FOUND' })
      }
      assert.deepEqual(Object.keys(peer), ['version'], 'Unknown peer report entry')
      return peer.version
    }, satisfies)
  }
}
