import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { valid, validRange, satisfies } from 'semver'
import { releasePackagesFor } from './release-consumer-config.mjs'

const LADYBUG = '@ladybugdb/wasm-core'
const FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
const local = value => /^(?:file:|link:|workspace:|portal:|\.\.?\/|\/)/u.test(value)

export function createNpmCandidates(manifests, { scope, version, versions, ladybugVersion, ladybugSource = 'vendored' }) {
  assert.match(scope ?? '', /^@[a-z0-9][a-z0-9._-]*$/u, 'Explicit lowercase npm scope required')
  for (const [label, value] of Object.entries({ ladybugVersion, ...(versions === undefined ? { version } : {}) })) {
    assert.equal(typeof value, 'string', `Explicit ${label} required`)
    assert.ok(valid(value) === value, `Invalid canonical ${label}`)
  }
  const packages = releasePackagesFor({ ladybugSource })
  if (versions !== undefined) {
    assert.equal(version, undefined, 'Select either version or versions, not both')
    assert.ok(versions && typeof versions === 'object' && !Array.isArray(versions), 'Complete per-package versions object required')
    const ownNames = Object.keys(packages).filter(name => name !== LADYBUG)
    assert.deepEqual(Object.keys(versions).sort(), ownNames.sort(), 'Exactly the owned package versions required')
    for (const [name, value] of Object.entries(versions)) {
      assert.ok(typeof value === 'string' && valid(value) === value, `${name}: canonical exact version required`)
    }
  }
  assert.deepEqual(Object.keys(manifests).sort(), Object.keys(packages).sort(), 'Exactly the physical release packages required')
  if (ladybugSource === 'registry') {
    assert.equal(manifests['dsh-design-knowledge-ladybug'].dependencies?.[LADYBUG], ladybugVersion, 'Knowledge must declare selected registry Ladybug exactly')
  }
  const mapping = Object.fromEntries(Object.keys(packages).map(name => [name, {
    name: `${scope}/${name === LADYBUG ? 'ladybug-wasm-core' : name}`,
    version: name === LADYBUG ? ladybugVersion : versions?.[name] ?? version,
    directory: packages[name],
  }]))
  assert.equal(new Set(Object.values(mapping).map(item => item.name)).size, Object.keys(mapping).length, 'Duplicate candidate names')
  const candidates = {}
  const changes = []
  const externalPeers = []
  const edges = []
  for (const [sourceName, original] of Object.entries(manifests)) {
    assert.equal(original.name, sourceName, 'Source manifest identity mismatch')
    assert.notEqual(original.private, true, `${sourceName}: private package cannot enter the public release`)
    const manifest = structuredClone(original)
    manifest.name = mapping[sourceName].name
    manifest.version = mapping[sourceName].version
    delete manifest.private
    manifest.publishConfig = { ...manifest.publishConfig, access: 'public' }
    for (const field of FIELDS) {
      if (!original[field]) continue
      manifest[field] = {}
      for (const [dependency, spec] of Object.entries(original[field])) {
        assert.equal(typeof spec, 'string', `${sourceName}: invalid ${field}.${dependency}`)
        let targetName = dependency
        let targetSpec = spec
        if (dependency === LADYBUG && ladybugSource === 'registry') {
          assert.ok(field === 'peerDependencies'
            ? typeof spec === 'string' && validRange(spec) && satisfies(ladybugVersion, spec)
            : spec === ladybugVersion, `${sourceName}: selected registry Ladybug required in ${field}`)
        } else if (mapping[dependency]) {
          if (local(spec) && !spec.startsWith('workspace:')) {
            const match = /^(?:file:|link:)(.+)$/u.exec(spec)
            assert.ok(match, `${sourceName}: unsupported local reference ${dependency}`)
            assert.equal(resolve(packages[sourceName], match[1]), resolve(packages[dependency]), `${sourceName}: local path does not match ${dependency}`)
          } else if (!local(spec)) {
            assert.ok(validRange(spec), `${sourceName}: invalid internal range ${dependency}`)
          } else {
            const range = spec.slice('workspace:'.length)
            assert.ok(['^', '~', '*'].includes(range) || validRange(range), 'Unsupported workspace reference')
          }
          if (dependency === LADYBUG) {
            assert.notEqual(field, 'peerDependencies', 'Ladybug alias is a dependency candidate, not a peer alias')
            targetSpec = `npm:${mapping[dependency].name}@${mapping[dependency].version}`
          } else {
            targetName = mapping[dependency].name
            targetSpec = mapping[dependency].version
          }
          if (field !== 'devDependencies') edges.push({ from: manifest.name, to: mapping[dependency].name, field })
        } else if (local(spec)) {
          // Preserve external host peer contracts; never invent a public version for a local-only dependency.
          const peerRange = original.peerDependencies?.[dependency]
          assert.ok(field === 'devDependencies' && typeof peerRange === 'string' && validRange(peerRange), `${sourceName}: unresolved external local reference ${field}.${dependency}: ${spec}`)
          targetSpec = peerRange
        }
        assert.ok(!local(targetSpec), `${sourceName}: residual local reference`)
        assert.ok(!Object.hasOwn(manifest[field], targetName), 'Dependency name collision')
        manifest[field][targetName] = targetSpec
        if (field === 'peerDependencies' && !mapping[dependency]) externalPeers.push({ package: manifest.name, name: dependency, range: spec, optional: original.peerDependenciesMeta?.[dependency]?.optional === true })
        if (targetName !== dependency || targetSpec !== spec) changes.push({ package: sourceName, field, from: { name: dependency, spec }, to: { name: targetName, spec: targetSpec } })
      }
    }
    if (original.peerDependenciesMeta) manifest.peerDependenciesMeta = Object.fromEntries(Object.entries(original.peerDependenciesMeta).map(([name, meta]) => [mapping[name]?.name ?? name, structuredClone(meta)]))
    // These mechanisms can override converted references or bind old package names. Do not silently discard them.
    for (const key of ['overrides', 'resolutions', 'pnpm', 'bundleDependencies', 'bundledDependencies']) {
      assert.ok(!Object.hasOwn(original, key), `${sourceName}: ${key} requires an explicit migration policy`)
    }
    candidates[sourceName] = manifest
  }
  const pending = new Set(Object.values(mapping).map(item => item.name))
  const publishLayers = []
  while (pending.size) {
    const layer = [...pending].filter(name => !edges.some(edge => edge.from === name && pending.has(edge.to))).sort()
    assert.ok(layer.length, 'Internal dependency/peer publication cycle')
    publishLayers.push(layer)
    for (const name of layer) pending.delete(name)
  }
  return {
    kind: 'npm-candidate-dry-run', schemaVersion: 1,
    ladybugSource,
    publishReady: false, registryChecked: false, scopeOwnershipChecked: false,
    mapping, candidates, changes, edges, publishLayers, externalPeers,
    blockers: [
      'Fixture scope ownership and exact registry versions are unverified.',
      'Renamed own-package imports, plugin registrations and distribution descriptors require a coordinated artifact rewrite before packing; these manifests alone are not runnable.',
      'External host peer availability and actual compatible host installation are unverified.',
      ladybugSource === 'vendored'
        ? 'Ladybug alias installation, runtime paths and source-to-binary provenance require verification.'
        : 'Selected official Ladybug integrity, installed runtime paths and provider compatibility require verification.',
      'Companion npm manifest and platform payloads are outside this slice.',
    ],
  }
}

export async function readNpmCandidates(workspace, options) {
  const manifests = Object.fromEntries(await Promise.all(Object.entries(releasePackagesFor(options)).map(async ([name, directory]) => [name, JSON.parse(await readFile(resolve(workspace, directory, 'package.json'), 'utf8'))])))
  return createNpmCandidates(manifests, options)
}

export async function runNpmCandidateCli(args, workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const flags = {}
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    assert.ok(['--scope', '--version', '--versions-file', '--ladybug-version', '--ladybug-source'].includes(name) && !Object.hasOwn(flags, name), 'Unknown or duplicate CLI option')
    assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), `Missing value for ${name}`)
    flags[name] = args[index + 1]
  }
  const versions = flags['--versions-file'] === undefined ? undefined : JSON.parse(await readFile(resolve(workspace, flags['--versions-file']), 'utf8'))
  return readNpmCandidates(workspace, { scope: flags['--scope'], version: flags['--version'], versions, ladybugVersion: flags['--ladybug-version'], ladybugSource: flags['--ladybug-source'] })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await runNpmCandidateCli(process.argv.slice(2)), null, 2) + '\n') }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
