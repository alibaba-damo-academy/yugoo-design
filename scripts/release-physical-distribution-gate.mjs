/**
 * Release gate for a physical Design System installation outside the workspace.
 *
 * Packs the distribution and every selected own physical package it composes.
 * Registry mode additionally requires an explicit official Ladybug version and
 * sha512 integrity; it never reads or packs the development vendor runtime.
 * Installs that selection into an isolated consumer, then proves the generic browser
 * shell and concrete provider remain independently discoverable package-root
 * plugins. The linked-profile gate owns compatibility with the checked-out dsh
 * release; this packaging gate never selects a different dsh release from npm.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { satisfies } from 'semver'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { withReleaseEvidence } from './release-evidence.mjs'
import { RELEASE_PACKAGES, releasePackagesFor, parsePhysicalGateOptions, candidateArchiveName, createReleaseConsumerConfig, assertCandidatePeerReport } from './release-consumer-config.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

/** Shared by the generated consumer verifier and its focused contract regression. */
export function assertWebAppContentManifest(manifest) {
  assert.deepEqual(manifest.files, ['README.md', 'kits', 'bundles', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'],
    'content package must publish separate Kit and Bundle roots with license materials, excluding engineering files')
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.exports, undefined)
}

/** This controlled upstream-derived package retains its own original license. */
export function assertNativeGitManifest(manifest) {
  assert.equal(manifest.name, 'yugoo-design-git-native')
  assert.equal(manifest.license, 'MIT', 'Native Git must retain its upstream license')
  assert.equal(manifest.main, 'index.cjs')
  assert.equal(manifest.types, 'index.d.ts')
  for (const file of ['native/*.node', 'LICENSE', 'NOTICE', 'SOURCE.json', 'native-source/**', 'third-party/**', 'scripts/*.cjs']) {
    assert.ok(manifest.files.includes(file), 'Native Git must publish ' + file)
  }
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    assert.equal(manifest.scripts?.[hook], undefined, 'Native Git must not compile or download on user installation')
  }
}

// Importing a release tool must never start packing, installing or writing evidence.
export async function runPhysicalDistributionGate(args = process.argv.slice(2)) {
const selection = parsePhysicalGateOptions(args)
const selectedPackages = releasePackagesFor(selection)
if (selection.ladybugSource === 'registry') {
  const knowledge = JSON.parse(await readFile(join(workspace, 'packages/knowledge-ladybug/package.json'), 'utf8'))
  assert.equal(knowledge.dependencies?.['@ladybugdb/wasm-core'], selection.ladybugVersion, 'Knowledge must use selected registry Ladybug before packing')
}

// Optional: --evidence-dir /absolute/new-directory (local, unreviewed evidence).
// Public-source selection: --ladybug-source registry --ladybug-version <exact>
// --ladybug-integrity <sha512-SRI>. Defaults retain the legacy vendored diagnostic.
await withReleaseEvidence({ args: selection.evidenceArgs, workspace, scriptPath: fileURLToPath(import.meta.url), pnpm }, async ({ temporaryRoot, run, phase }) => {
  const tarballs = join(temporaryRoot, 'tarballs')
  const consumer = join(temporaryRoot, 'consumer')
  await mkdir(tarballs, { recursive: true })
  await mkdir(consumer, { recursive: true })

  const candidates = {}
  for (const [name, packageDirectory] of Object.entries(selectedPackages)) {
    const manifest = JSON.parse(await readFile(join(workspace, packageDirectory, 'package.json'), 'utf8'))
    assert.equal(manifest.name, name)
    if (name === 'yugoo-design-git-native') {
      assertNativeGitManifest(manifest)
      // Packing normally verifies these inputs via prepack. This gate disables
      // lifecycle scripts globally, so run that exact check explicitly.
      run('native-git-artifacts', process.execPath, ['scripts/check-artifacts.cjs'], { cwd: join(workspace, packageDirectory) })
    }
    const archive = candidateArchiveName(name, manifest.version)
    run('pack', pnpm, ['--dir', join(workspace, packageDirectory), '--config.ignore-scripts=true', '--config.ignore-pnpmfile=true', 'pack', '--pack-destination', tarballs])
    candidates[name] = { version: manifest.version, archive,
      peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {},
      integrity: 'sha512-' + createHash('sha512').update(await readFile(join(tarballs, archive))).digest('base64') }
  }
  assert.deepEqual((await readdir(tarballs)).sort(), Object.values(candidates).map(item => item.archive).sort(), 'Only current candidate archives may enter the gate')

  phase('prepare-consumer')
  const config = createReleaseConsumerConfig(candidates, selection)
  await writeFile(join(consumer, 'package.json'), JSON.stringify(config.manifest, null, 2) + '\n')
  await writeFile(join(consumer, 'pnpm-workspace.yaml'), JSON.stringify(config.workspace, null, 2) + '\n')
  run('install', pnpm, ['install', '--prod', '--ignore-scripts', '--config.ignore-pnpmfile=true', '--config.auto-install-peers=false'], { cwd: consumer })

  phase('prepare-verifier')
  const verifier = join(consumer, 'verify.mjs')
  await writeFile(verifier, `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const consumer = dirname(fileURLToPath(import.meta.url))
const modules = await realpath(resolve(consumer, 'node_modules'))
const workspace = ${JSON.stringify(workspace)}
const distributionPackage = fileURLToPath(import.meta.resolve('dsh-design-system-dsh/package.json'))
const distributionRequire = createRequire(distributionPackage)
const candidates = ${JSON.stringify(candidates)}
const config = ${JSON.stringify(config)}
const ladybugSelection = ${JSON.stringify(selection)}
const coreRequire = createRequire(await realpath(resolve(consumer, 'node_modules/dsh-design-core/package.json')))
const { parse } = await import(pathToFileURL(coreRequire.resolve('yaml')).href)
const lock = parse(await readFile(resolve(consumer, 'pnpm-lock.yaml'), 'utf8'))
assert.deepEqual(lock.overrides, config.workspace.overrides, 'lock must retain current candidate overrides')
const peerChecks = []
for (const [name, candidate] of Object.entries(candidates)) {
  const root = await realpath(resolve(consumer, 'node_modules', name))
  const location = relative(modules, root)
  assert.ok(location !== '..' && !location.startsWith('..' + sep), name + ' must be physically installed in consumer')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  assert.equal(manifest.version, candidate.version)
  assert.deepEqual(manifest.peerDependencies ?? {}, candidate.peerDependencies, name + ' candidate peer declarations changed')
  assert.deepEqual(manifest.peerDependenciesMeta ?? {}, candidate.peerDependenciesMeta, name + ' candidate peer policy changed')
  const ref = config.manifest.dependencies[name]
  assert.equal(lock.importers['.'].dependencies[name].specifier, ref, name + ' must use the selected candidate')
  const resolution = lock.packages[name + '@' + ref]?.resolution
  assert.equal(resolution?.tarball, ref, name + ' must not come from a registry or source directory')
  assert.equal(resolution?.integrity, candidate.integrity, name + ' candidate archive integrity mismatch')
  const requirePackage = createRequire(resolve(root, 'package.json'))
  const peers = {}
  for (const peer of Object.keys(candidate.peerDependencies)) {
    let entry
    try { entry = requirePackage.resolve(peer + '/package.json') }
    catch {
      try { entry = requirePackage.resolve(peer) }
      catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error
        peers[peer] = { missing: true }
        continue
      }
    }
    let folder = dirname(await realpath(entry))
    let found = false
    while (true) {
      const fromModules = relative(modules, folder)
      assert.ok(fromModules !== '..' && !fromModules.startsWith('..' + sep), 'Peer escaped consumer')
      try {
        const peerManifest = JSON.parse(await readFile(resolve(folder, 'package.json'), 'utf8'))
        if (peerManifest.name === peer) {
          peers[peer] = { version: peerManifest.version }
          found = true
          break
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (folder === modules) break
      folder = dirname(folder)
    }
    assert.ok(found, 'Cannot establish installed peer version: ' + peer)
  }
  peerChecks.push({ name, peers })
}
await writeFile(resolve(consumer, 'peer-versions.json'), JSON.stringify(peerChecks, null, 2) + '\\n')
const installedDistribution = JSON.parse(await readFile(distributionPackage, 'utf8'))
assert.equal(installedDistribution.dsh?.client, undefined, 'distribution tarball must not publish a combined client')
assert.equal(installedDistribution.exports?.['./client'], undefined, 'distribution tarball must not facade provider browser code')
const installedProvider = JSON.parse(await readFile(distributionRequire.resolve('dsh-design-provider-web-app/package.json'), 'utf8'))
assert.equal(installedProvider.dsh?.client?.platform, 'web', 'provider tarball must declare its own browser plugin')
assert.equal(installedProvider.exports?.['./client']?.default ?? installedProvider.exports?.['./client'], './lib/client.js')
const installedKit = JSON.parse(await readFile(distributionRequire.resolve('dsh-design-skills-web-app/package.json'), 'utf8'))
assert.throws(() => distributionRequire.resolve('dsh-design-skills-decision-modeling/package.json'),
  { code: 'MODULE_NOT_FOUND' }, 'internal validation Kit must not be installed by the default distribution')
const knowledgeRequire = createRequire(distributionRequire.resolve('dsh-design-knowledge-ladybug'))
const ladybugEntry = await realpath(knowledgeRequire.resolve('@ladybugdb/wasm-core'))
assert.ok(relative(modules, ladybugEntry).split(sep)[0] !== '..', 'Ladybug runtime must resolve within the consumer')
if (ladybugSelection.ladybugSource === 'registry') {
  let ladybugRoot = dirname(ladybugEntry)
  let installedLadybug
  while (true) {
    const location = relative(modules, ladybugRoot)
    assert.ok(location !== '..' && !location.startsWith('..' + sep), 'Ladybug package escaped consumer')
    try {
      const found = JSON.parse(await readFile(resolve(ladybugRoot, 'package.json'), 'utf8'))
      if (found.name === '@ladybugdb/wasm-core') { installedLadybug = found; break }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    assert.notEqual(ladybugRoot, modules, 'Ladybug package identity missing')
    ladybugRoot = dirname(ladybugRoot)
  }
  assert.equal(installedLadybug.version, ladybugSelection.ladybugVersion)
  assert.equal(installedLadybug.license, 'MIT')
  assert.equal(lock.importers['.'].dependencies['@ladybugdb/wasm-core'].specifier, ladybugSelection.ladybugVersion)
  const resolution = lock.packages['@ladybugdb/wasm-core@' + ladybugSelection.ladybugVersion]?.resolution
  assert.equal(resolution?.integrity, ladybugSelection.ladybugIntegrity, 'Official Ladybug registry integrity mismatch')
  assert.equal(resolution?.tarball, undefined, 'Official Ladybug must not use a local tarball alias')
} else {
const ladybugRoot = dirname(dirname(ladybugEntry))
const ladybugManifest = JSON.parse(await readFile(resolve(ladybugRoot, 'build-manifest.json'), 'utf8'))
for (const [file, hash] of Object.entries(ladybugManifest.sha256)) {
  // pnpm pack normalizes manifest whitespace; executable/runtime bytes stay exact.
  if (file === 'package.json') continue
  assert.equal(createHash('sha256').update(await readFile(resolve(ladybugRoot, file))).digest('hex'), hash, 'vendored byte mismatch: ' + file)
}
assert.deepEqual(JSON.parse(await readFile(resolve(ladybugRoot, 'package.json'), 'utf8')), ${selection.ladybugSource === 'vendored' ? JSON.stringify(JSON.parse(await readFile(join(workspace, 'vendor/ladybug/runtime/package.json'), 'utf8'))) : 'null'})
assert.match(await readFile(resolve(ladybugRoot, 'LICENSE'), 'utf8'), /MIT/)
}
(${assertWebAppContentManifest.toString()})(installedKit)
const nativeGitRoot = dirname(coreRequire.resolve('yugoo-design-git-native/package.json'))
const nativeGitLocation = relative(modules, await realpath(nativeGitRoot))
assert.ok(nativeGitLocation !== '..' && !nativeGitLocation.startsWith('..' + sep), 'Core native Git must resolve inside consumer')
const nativeGitManifest = JSON.parse(await readFile(resolve(nativeGitRoot, 'package.json'), 'utf8'))
;(${assertNativeGitManifest.toString()})(nativeGitManifest)
const nativeGitMaterials = ${JSON.stringify(Object.fromEntries(await Promise.all(['LICENSE', 'NOTICE', 'SOURCE.json'].map(async name => [name, await readFile(join(workspace, 'packages/git-native', name), 'utf8')]))))}
for (const [file, expected] of Object.entries(nativeGitMaterials)) {
  assert.equal(await readFile(resolve(nativeGitRoot, file), 'utf8'), expected, 'Native Git source/license mismatch: ' + file)
}
execFileSync(process.execPath, [resolve(nativeGitRoot, 'scripts/check-artifacts.cjs')], { cwd: consumer, env: { ...process.env, PATH: '' } })
const nativeGit = await import(pathToFileURL(coreRequire.resolve('yugoo-design-git-native')).href)
assert.equal(typeof nativeGit.Repository?.prototype.readObjectHeader, 'function', 'Installed native Git must load its object-header API')
const ownLicenseMaterials = ${JSON.stringify(Object.fromEntries(await Promise.all(['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'].map(async name => [name, await readFile(join(workspace, name), 'utf8')]))))}
for (const name of ${JSON.stringify(Object.keys(RELEASE_PACKAGES).filter(name => !['@ladybugdb/wasm-core', 'yugoo-design-git-native'].includes(name)))}) {
  // Knowledge exposes its lib entry, but intentionally has no package.json export.
  const root = name === 'dsh-design-knowledge-ladybug'
    ? resolve(dirname(distributionRequire.resolve(name)), '..')
    : dirname(distributionRequire.resolve(name + '/package.json'))
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, name)
  assert.equal(manifest.license, 'Apache-2.0', name + ' project-owned license metadata')
  for (const [file, expected] of Object.entries(ownLicenseMaterials)) {
    assert.ok(manifest.files.includes(file), name + ' must explicitly publish ' + file)
    assert.equal(await readFile(resolve(root, file), 'utf8'), expected, name + ' license material mismatch: ' + file)
  }
}
for (const entry of ${JSON.stringify([
  { specifier: 'dsh-design-system-dsh', load: true },
  { specifier: 'dsh-design-core', load: false },
  { specifier: 'dsh-design-core/kit-loader', load: false },
  { specifier: 'dsh-design-core/advisory-scheduler', load: false },
  { specifier: 'dsh-design-core/execution', load: false },
  { specifier: 'dsh-design-core/panel-remote', load: false },
  { specifier: 'dsh-design-panel', load: false },
  { specifier: 'dsh-design-panel/client', load: false },
  { specifier: 'dsh-design-provider-web-app', load: false },
  { specifier: 'dsh-design-provider-web-app/client', load: false },
  { specifier: 'dsh-design-studio-dsh', load: false },
  { specifier: 'dsh-design-studio-dsh/studio-page', load: false },
])}) {
  const { specifier, load } = entry
  const resolved = await realpath(specifier === 'dsh-design-system-dsh'
    ? fileURLToPath(import.meta.resolve(specifier))
    : distributionRequire.resolve(specifier))
  const fromModules = relative(modules, resolved)
  assert.ok(fromModules !== '' && !fromModules.startsWith('..' + sep) && fromModules !== '..', specifier + ' must resolve inside isolated node_modules')
  const fromWorkspace = relative(workspace, resolved)
  assert.ok(fromWorkspace === '..' || fromWorkspace.startsWith('..' + sep), specifier + ' must not resolve through the workspace')
  if (load) await import(pathToFileURL(resolved).href)
}
`)
  run('verify', process.execPath, [verifier], { cwd: consumer })
  phase('verify')
  // Tooling uses the declared root semver dependency; consumer runtime resolution
  // stays isolated. No official host injection path is provided by this gate yet.
  await assertCandidatePeerReport(candidates, JSON.parse(await readFile(join(consumer, 'peer-versions.json'), 'utf8')), satisfies)
})
console.log('RELEASE PHYSICAL DISTRIBUTION OK')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runPhysicalDistributionGate()
}
