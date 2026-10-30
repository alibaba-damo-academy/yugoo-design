/** Assemble public DSH archives from already built own packages. Never builds or publishes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import { parse, stringify } from 'yaml'
import { DSH_AGGREGATE_SOURCE, RELEASE_PACKAGES } from './release-consumer-config.mjs'
import { readNpmCandidates } from './release-npm-candidates.mjs'
import { OWN_LICENSE_FILES } from './release-own-license.mjs'
import { copyDshDistributionMaterials } from './dsh-distribution-materials.mjs'
import { assertNativeGitManifest } from './release-physical-distribution-gate.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
export function mapOwnSpecifier(value, mapping) {
  for (const [name, item] of Object.entries(mapping)) {
    if (value === name || value.startsWith(name + '/')) return item.name + value.slice(name.length)
  }
  return value
}
/** Rewrite package resolution, browser registration and Typert ownership; never RPC/plugin/service IDs. */
export function projectDistributionCode(code, mapping, file) {
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true)
  const edits = []
  function visit(node) {
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent
      const call = ts.isCallExpression(parent) && parent.arguments.includes(node)
      const importRef = (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node
      const importType = ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)
      const resolver = call && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || /(?:^|\.)(?:require|resolve|resolveBundleDir)$/.test(parent.expression.getText(ast)))
      const loadId = ts.isPropertyAssignment(parent) && parent.name.getText(ast) === 'id'
        && ts.isObjectLiteralExpression(parent.parent) && ts.isCallExpression(parent.parent.parent)
        && parent.parent.parent.expression.getText(ast) === 'window.__ModuleLoader__.load'
      // The official loader requires TYPERT.package to equal the exporting
      // npm package. This is ownership metadata, not the stable wire IDs in
      // descriptors/typeSymbol. Recognize the contribution shape rather than
      // rewriting arbitrary `package` fields or relying on minified names.
      const typertOwner = ts.isPropertyAssignment(parent) && parent.name.getText(ast).replace(/^['"]|['"]$/g, '') === 'package'
        && ts.isObjectLiteralExpression(parent.parent)
        && parent.parent.properties.some(property => ts.isPropertyAssignment(property)
          && ['descriptors', 'invocations'].includes(property.name.getText(ast).replace(/^['"]|['"]$/g, '')))
      const declaration = ts.isLiteralTypeNode(parent) ? parent.parent : undefined
      const typertOwnerType = declaration && ts.isPropertySignature(declaration)
        && declaration.name.getText(ast).replace(/^['"]|['"]$/g, '') === 'package'
        && ts.isTypeLiteralNode(declaration.parent)
        && declaration.parent.members.some(member => ts.isPropertySignature(member)
          && ['descriptors', 'invocations'].includes(member.name.getText(ast).replace(/^['"]|['"]$/g, '')))
      if (importRef || importType || resolver || loadId || typertOwner || typertOwnerType) {
        const value = mapOwnSpecifier(node.text, mapping)
        if (value !== node.text) edits.push({ start: node.getStart(ast), end: node.end, value: JSON.stringify(value) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.value + code.slice(edit.end)
  // An adapted artifact must not advertise its pre-adaptation source map.
  if (edits.length) code = code.replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '')
  return { code, replacements: edits.length }
}

/** Preserve native build inputs and original licensing; own-code uses its existing material authority. */
export async function prepareDshPackageMaterials({ source, target, sourceName, manifest, observationFile, observationSha256 }) {
  if (sourceName === 'yugoo-design-git-native') {
    assert.match(manifest.name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?yugoo-design-git-native$/u)
    // The release mapping owns the scoped npm identity. All source/build inputs
    // retain the binding's original recorded identity and bytes.
    assertNativeGitManifest({ ...manifest, name: sourceName })
    const original = join(source, 'packages/git-native')
    for (const file of ['LICENSE', 'NOTICE', 'SOURCE.json']) {
      assert.deepEqual(await readFile(join(target, file)), await readFile(join(original, file)), 'Native Git material changed: ' + file)
    }
    // Assembly suppresses lifecycle scripts, so explicitly run the package's
    // own prepack guard against staged source inputs and both prebuilds.
    execFileSync(process.execPath, [join(target, 'scripts/check-artifacts.cjs')], { cwd: target, env: { ...process.env, PATH: '' } })
    return
  }
  for (const name of OWN_LICENSE_FILES) {
    try { await readFile(join(target, name)) }
    catch (error) { if (error.code !== 'ENOENT') throw error; await cp(join(source, name), join(target, name)) }
  }
  await copyDshDistributionMaterials({ source, target, sourceName, packageName: manifest.name, observationFile, observationSha256 })
}
/** One manifest projection shared by selection checks and actual staging. */
export function createDshDistributionManifest(report, sourceName) {
  assert.ok(Object.hasOwn(report.mapping, sourceName), 'Unknown distribution package')
  const manifest = structuredClone(report.candidates[sourceName])
  if (manifest.dsh?.client?.inject) manifest.dsh.client.inject = manifest.dsh.client.inject.map(value => mapOwnSpecifier(value, report.mapping))
  // The source manifest owns the dependency graph. Release inventory membership
  // is not permission to install every artifact as an aggregate dependency.
  if (sourceName === DSH_AGGREGATE_SOURCE) {
    // DSH disables automatic peer installation. Supply only required own peers
    // reached from the actual runtime closure, leaving host peers to the host.
    const own = new Map(Object.values(report.candidates).map(candidate => [candidate.name, candidate]))
    const reachable = new Set()
    function collectPhysical(name) {
      if (!own.has(name) || reachable.has(name)) return
      reachable.add(name)
      const candidate = own.get(name)
      for (const field of ['dependencies', 'optionalDependencies']) {
        for (const dependency of Object.keys(candidate[field] ?? {})) collectPhysical(dependency)
      }
    }
    collectPhysical(manifest.name)
    for (const name of reachable) {
      const candidate = own.get(name)
      for (const [peer, version] of Object.entries(candidate.peerDependencies ?? {})) {
        if (!own.has(peer) || reachable.has(peer) || candidate.peerDependenciesMeta?.[peer]?.optional === true) continue
        manifest.dependencies = { ...manifest.dependencies, [peer]: version }
        collectPhysical(peer)
      }
    }
  }
  delete manifest.devDependencies
  if (sourceName !== 'yugoo-design-git-native') manifest.files = [...new Set([...(manifest.files ?? []), 'licenses'])]
  return manifest
}

/** Manifest contracts admit a subset; archive/source provenance is verified separately. */
export function selectDshDistributionPackages(report, { packageNames = Object.keys(report.mapping), retainedManifests = {} } = {}) {
  assert.ok(Array.isArray(packageNames) && packageNames.length > 0, 'Nonempty distribution package selection required')
  assert.equal(new Set(packageNames).size, packageNames.length, 'Duplicate distribution package selection')
  for (const name of packageNames) assert.ok(Object.hasOwn(report.mapping, name), 'Unknown distribution package selection')
  assert.ok(retainedManifests && typeof retainedManifests === 'object' && !Array.isArray(retainedManifests), 'Retained manifests object required')
  const omitted = Object.keys(report.mapping).filter(name => !packageNames.includes(name))
  assert.deepEqual(Object.keys(retainedManifests).sort(), [...omitted].sort(), 'Selected and retained packages must form a complete disjoint partition')
  // Compare discovery, resolution, platform admission and install behavior.
  // Documentation/publishing metadata and source-only test/build scripts do
  // not retarget a retained archive and need not force a new package version.
  const fields = ['name', 'version', 'type', 'main', 'types', 'exports', 'dsh', 'designSystem',
    'engines', 'engineStrict', 'bin', 'imports', 'browser', 'module', 'os', 'cpu', 'libc', 'typesVersions', 'sideEffects',
    'directories', 'config', 'gypfile', 'workspaces', 'dependencies', 'optionalDependencies', 'peerDependencies',
    'peerDependenciesMeta', 'dependenciesMeta', 'bundleDependencies', 'bundledDependencies', 'overrides', 'resolutions', 'pnpm']
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare']
  const contract = manifest => {
    const result = Object.fromEntries(fields.filter(field => Object.hasOwn(manifest, field)).map(field => [field, manifest[field]]))
    const scripts = Object.fromEntries(lifecycle.filter(name => Object.hasOwn(manifest.scripts ?? {}, name)).map(name => [name, manifest.scripts[name]]))
    if (Object.keys(scripts).length) result.scripts = scripts
    return result
  }
  const retained = omitted.map(name => {
    const previous = retainedManifests[name]
    assert.ok(previous && typeof previous === 'object' && !Array.isArray(previous), 'Retained manifest object required')
    assert.deepEqual(contract(previous), contract(createDshDistributionManifest(report, name)), `Retained manifest contract changed: ${name}`)
    return { sourceName: name, ...report.mapping[name], manifestContractVerified: true, archiveVerified: false }
  })
  return { packageNames: [...packageNames], retained }
}

/** Stage only a known physical source package; retain exclusive leaf creation. */
export async function createDshPackageStage(packagesRoot, sourceName) {
  assert.ok(isAbsolute(packagesRoot) && Object.hasOwn(RELEASE_PACKAGES, sourceName), 'Known package and absolute stage root required')
  const root = await lstat(packagesRoot)
  assert.ok(root.isDirectory() && !root.isSymbolicLink(), 'Nonregular package stage root')
  const target = join(packagesRoot, sourceName), parent = dirname(target)
  await mkdir(parent, { recursive: true })
  const directory = await lstat(parent)
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink(), 'Nonregular package stage parent')
  await mkdir(target)
  return target
}

export async function assembleDshDistribution({ source, destination, npmCli, scope = '@yugoo-design', version, versions, packageNames, retainedManifests, observationFile, observationSha256 }) {
  source = resolve(source); destination = resolve(destination)
  assert.ok(isAbsolute(npmCli), 'Absolute npm CLI required')
  assert.ok(destination !== source && !relative(source, destination).startsWith('.' + '/') && !destination.startsWith(source + '/'), 'Output must be outside source')
  const report = await readNpmCandidates(source, { scope, version: version === undefined && versions === undefined ? '0.1.0' : version, versions, ladybugVersion: '0.21.1', ladybugSource: 'registry' })
  const selection = selectDshDistributionPackages(report, { packageNames, retainedManifests })
  await mkdir(destination) // Exclusive; never overwrite earlier evidence.
  const packagesRoot = join(destination, 'packages'), archiveRoot = join(destination, 'tarballs')
  await mkdir(packagesRoot); await mkdir(archiveRoot)
  const records = [], mutations = []
  for (const originalName of selection.packageNames) {
    const item = report.mapping[originalName]
    const original = join(source, item.directory), target = await createDshPackageStage(packagesRoot, originalName)
    // npm owns package file selection; scripts are intentionally not invoked by assembly.
    const inventory = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: original, encoding: 'utf8' }))[0]
    const manifest = createDshDistributionManifest(report, originalName)
    for (const entry of inventory.files) {
      const path = entry.path
      assert.ok(!isAbsolute(path) && !path.split('/').includes('..') && !path.split('/').includes('node_modules'), 'Unsafe npm member')
      if (path === 'package.json' || path.endsWith('.map')) continue
      const output = join(target, path)
      await mkdir(dirname(output), { recursive: true })
      if (originalName === 'yugoo-design-git-native') {
        // These bytes are covered by SOURCE.json; never project or rewrite them.
        await cp(join(original, path), output)
      } else if (/\.(?:[cm]?js|d\.ts)$/.test(path)) {
        const result = projectDistributionCode(await readFile(join(original, path), 'utf8'), report.mapping, path)
        await writeFile(output, result.code)
        if (result.replacements) mutations.push({ package: originalName, path, replacements: result.replacements })
      } else if (originalName === DSH_AGGREGATE_SOURCE && path === 'cordis.patch.yml') {
        const data = parse(await readFile(join(original, path), 'utf8'))
        function project(value) {
          if (Array.isArray(value)) return value.map(project)
          if (!value || typeof value !== 'object') return value
          return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, typeof child === 'string' && ['name', 'packageName'].includes(key) ? mapOwnSpecifier(child, report.mapping) : project(child)]))
        }
        await writeFile(output, stringify(project(data)))
      } else await cp(join(original, path), output)
    }
    await prepareDshPackageMaterials({ source, target, sourceName: originalName, manifest, observationFile, observationSha256 })
    await writeFile(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    const packed = JSON.parse(execFileSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', archiveRoot], { cwd: target, encoding: 'utf8' }))[0]
    assert.equal(packed.name, item.name); assert.equal(packed.version, item.version)
    const archive = join(archiveRoot, packed.filename)
    records.push({ sourceName: originalName, name: item.name, version: item.version, archive, sha256: sha(await readFile(archive)), files: packed.files })
  }
  const result = { kind: 'dsh-distribution-archives', version: report.mapping[DSH_AGGREGATE_SOURCE].version, mapping: report.mapping, archives: records,
    packageNames: selection.packageNames, retained: selection.retained, codeProjections: mutations, aggregate: report.mapping[DSH_AGGREGATE_SOURCE].name, registry: 'https://registry.npmjs.org', published: false, installed: false }
  await writeFile(join(destination, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination, npmCli] = process.argv.slice(2)
  assert.ok(source && destination && npmCli && process.argv.length === 5, 'Usage: node assemble-dsh-distribution.mjs SOURCE NEW_OUTPUT ABSOLUTE_NPM_CLI')
  const result = await assembleDshDistribution({ source, destination, npmCli })
  console.log(JSON.stringify({ result: join(resolve(destination), 'RESULT.json'), packages: result.archives.length, published: false }))
}
