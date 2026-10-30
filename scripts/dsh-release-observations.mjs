/** Current normal-build associations; maintained original materials remain the authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { verifyOutputModuleFiles } from './companion-output-module-map.mjs'
import { projectDistributionCode } from './assemble-dsh-distribution.mjs'
import { FIRST_PARTY_MATERIAL, readCurrentFirstPartyIdentity } from './dsh-distribution-materials.mjs'
import { DSH_AGGREGATE_SOURCE } from './release-consumer-config.mjs'
import { isDeclarationOutput } from './normal-build-module-evidence.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const safe = path => typeof path === 'string' && path && !isAbsolute(path) && !path.includes('\\') && !path.split('/').some(x => !x || x === '.' || x === '..')
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

async function filesUnder(root, prefix = '') {
  const result = []
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name
    const info = await lstat(join(root, path))
    assert.ok(!info.isSymbolicLink(), 'Normal output symlink rejected')
    if (info.isDirectory()) result.push(...await filesUnder(root, path))
    else { assert.ok(info.isFile()); result.push(path) }
  }
  return result
}
async function moduleIdentity(rawId, workspace, cache, sourceCommit) {
  if (!isAbsolute(rawId) || rawId.includes('\0') || rawId.includes('?')) return null
  if (cache.has(rawId)) return cache.get(rawId)
  const bytes = await readFile(rawId)
  let packageRoot
  const match = rawId.replaceAll('\\', '/').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)(?:\/|$)/u)
  if (match) packageRoot = match[1]
  else {
    const path = relative(workspace, rawId).replaceAll('\\', '/')
    const own = /^(packages\/[^/]+)\//u.exec(path)
    if (own) packageRoot = join(workspace, own[1])
  }
  const identity = { path: relative(workspace, rawId).replaceAll('\\', '/'), sha256: sha(bytes) }
  if (packageRoot) {
    const metadataKey = 'metadata:' + packageRoot
    if (!cache.has(metadataKey)) {
      const metadataBytes = await readFile(join(packageRoot, 'package.json')), manifest = JSON.parse(metadataBytes)
      const metadata = { name: manifest.name, version: manifest.version, packageMetadataSha256: sha(metadataBytes), firstParty: !match }
      if (!match) metadata.currentSourceIdentity = await readCurrentFirstPartyIdentity({ source: workspace,
        manifestPath: relative(workspace, join(packageRoot, 'package.json')).replaceAll('\\', '/'), sourceCommit })
      cache.set(metadataKey, metadata)
    }
    Object.assign(identity, cache.get(metadataKey))
  }
  cache.set(rawId, identity)
  return identity
}
export function bindObservedComponents(selection, modulesByOutput) {
  const records = selection.components ?? [], outputs = records.map(() => new Set()), unassociated = [], currentIdentities = {}
  for (const [output, modules] of Object.entries(modulesByOutput)) {
    for (const module of modules) {
      if (!module.name) continue
      const matching = records.map((record, index) => ({ record, index })).filter(({ record }) => record.name === module.name)
      if (!matching.length) { unassociated.push({ output, ...module }); continue }
      const exact = matching.find(({ record }) => record.version === module.version
        && (record.correspondence === FIRST_PARTY_MATERIAL ? module.firstParty === true
          : record.packageMetadataSha256 === module.packageMetadataSha256))
      assert.ok(exact, `Observed component identity changed: ${module.name}@${module.version} (${output})`)
      if (exact.record.correspondence === FIRST_PARTY_MATERIAL) {
        const current = module.currentSourceIdentity
        assert.ok(current, 'Explicit current first-party identity required')
        assert.equal(current.name, module.name); assert.equal(current.version, module.version)
        assert.equal(current.packageMetadataSha256, module.packageMetadataSha256)
        if (currentIdentities[exact.index]) assert.deepEqual(currentIdentities[exact.index], current, 'Conflicting current first-party identities')
        currentIdentities[exact.index] = current
      }
      outputs[exact.index].add(output)
    }
  }
  return {
    componentBindings: outputs.flatMap((paths, componentIndex) => paths.size ? [{ componentIndex, outputs: [...paths].sort(),
      ...(currentIdentities[componentIndex] ? { currentIdentity: currentIdentities[componentIndex] } : {}) }] : []),
    historicalComponentsWithoutCurrentAssociation: records.flatMap((record, index) => outputs[index].size ? [] : [{ componentIndex: index, name: record.name, version: record.version, previousOutputs: record.outputs }]),
    unassociatedObservedModules: unassociated,
  }
}
export function dataUrls(code) {
  const result = []
  let cursor = 0
  while (cursor < code.length) {
    const start = code.indexOf('data:', cursor)
    if (start < 0) break
    const typeStart = start + 5
    let typeEnd = typeStart
    while (typeEnd < code.length && !/[;,\s'"()]/u.test(code[typeEnd])) typeEnd++
    cursor = typeEnd + 1
    if (typeEnd === typeStart || !code.startsWith(';base64,', typeEnd)) continue
    const bodyStart = typeEnd + 8
    let bodyEnd = bodyStart
    // A quantified Unicode regexp can exhaust V8's stack on large data URLs
    // in a bundle containing non-ASCII UI text. Scan the ASCII body directly.
    while (bodyEnd < code.length) {
      const char = code.charCodeAt(bodyEnd)
      if (!(char >= 65 && char <= 90 || char >= 97 && char <= 122
        || char >= 48 && char <= 57 || char === 43 || char === 47)) break
      bodyEnd++
    }
    cursor = bodyEnd
    if (bodyEnd === bodyStart) continue
    for (let padding = 0; padding < 2 && code[bodyEnd] === '='; padding++) bodyEnd++
    cursor = bodyEnd
    const bytes = Buffer.from(code.slice(bodyStart, bodyEnd), 'base64')
    result.push({ mediaType: code.slice(typeStart, typeEnd), bytes: bytes.length, sha256: sha(bytes) })
  }
  return result
}
export async function observeDshBuild({ workspace, report, evidenceDirectory, sourceCommit }) {
  const manifestFile = join(workspace, 'release/dsh-distribution-materials.json')
  const manifestBytes = await readFile(manifestFile), manifest = JSON.parse(manifestBytes)
  const observations = { kind: 'dsh-current-normal-observations', sourceCommit, sourceManifestSha256: sha(manifestBytes), packages: {} }
  const evidenceFiles = (await readdir(evidenceDirectory)).filter(name => /^dsh-release-.*-output-modules\.json$/u.test(name)).sort()
  const snapshots = []
  for (const file of evidenceFiles) {
    const snapshot = await readJson(join(evidenceDirectory, file))
    await verifyOutputModuleFiles(snapshot)
    snapshots.push({ file, snapshot, sha256: sha(await readFile(join(evidenceDirectory, file))) })
  }
  const cache = new Map()
  for (const [sourceName, item] of Object.entries(report.mapping)) {
    if (sourceName === 'yugoo-design-git-native') continue
    const selection = manifest.packages[sourceName]
    assert.ok(selection, `Maintained material selection missing: ${sourceName}`)
    const packageRoot = join(workspace, item.directory), modulesByOutput = {}, normalBuildMaps = [], hashes = {}, normalHashes = {}, urls = {}
    const packageSnapshots = snapshots.filter(({ snapshot }) => resolve(snapshot.outputRoot) === join(packageRoot, 'lib'))
    // Content and aggregate have no compiler. Every package with lib has observed normal configs.
    if (sourceName !== 'dsh-design-skills-web-app' && sourceName !== DSH_AGGREGATE_SOURCE) assert.ok(packageSnapshots.length, `Normal build receipt missing: ${sourceName}`)
    const outputFiles = sourceName === 'dsh-design-skills-web-app'
      ? Object.keys(selection.observedOutputSha256)
      : sourceName === DSH_AGGREGATE_SOURCE ? [] : (await filesUnder(join(packageRoot, 'lib'))).map(path => 'lib/' + path)
    for (const path of outputFiles) {
      assert.ok(safe(path))
      if (path.endsWith('.map') || isDeclarationOutput(path) || /pica-static-workers-(?:client|interpreter)\.json$/u.test(path)) continue
      const bytes = await readFile(join(packageRoot, path))
      const projected = /\.(?:[cm]?js|d\.ts)$/u.test(path) ? Buffer.from(projectDistributionCode(bytes.toString('utf8'), report.mapping, path).code) : bytes
      hashes[path] = sha(projected); normalHashes[path] = sha(bytes)
      if (/\.(?:[cm]?js|css)$/u.test(path)) urls[path] = dataUrls(projected.toString('utf8'))
    }
    for (const { snapshot, file, sha256: evidenceSha256 } of packageSnapshots) {
      for (const output of snapshot.outputs) {
        const path = 'lib/' + output.fileName
        if (!Object.hasOwn(hashes, path)) continue
        assert.equal(output.sha256, normalHashes[path], 'Normal output changed after build receipt')
        const identities = []
        for (const module of output.modules ?? []) {
          if (module.renderedLength === 0) continue
          const identity = await moduleIdentity(module.rawId, workspace, cache, sourceCommit)
          if (identity) {
            assert.equal(identity.sha256, snapshot.inputFileSha256?.[module.rawId], `Normal module input changed or was not captured: ${identity.path}`)
            identities.push(identity)
          }
        }
        modulesByOutput[path] = [...(modulesByOutput[path] ?? []), ...identities]
        const own = identities.filter(x => x.firstParty)
        normalBuildMaps.push({ output: path, observation: 'normal-build-done-module-membership', evidenceFile: file, evidenceSha256,
          normalOutputSha256: normalHashes[path], packedOutputSha256: hashes[path], projectOwnedSources: own.map(x => x.path),
          projectOwnedSourceSha256: Object.fromEntries(own.map(x => [x.path, x.sha256])), sourceCount: own.length,
          sourceContentsVerified: false, moduleInputsReadAndHashed: true, actualArchiveOutputBindingVerified: false,
          limitations: 'Bundler-reported membership and current input bytes; no complete retained-code, nested prebundle or license acceptance claim' })
      }
    }
    const bindings = bindObservedComponents(selection, modulesByOutput)
    const fontBindings = (selection.fonts ?? []).map((font, fontIndex) => ({ fontIndex,
      matchingDataUrls: Object.entries(urls).flatMap(([output, matches]) => matches.filter(x => x.sha256 === font.sha256).map(x => ({ output, ...x }))) }))
    const embeddedBpmnFonts = (selection.embeddedBpmnFonts ?? []).flatMap(font => Object.entries(urls).flatMap(([output, matches]) => matches.filter(x => x.sha256 === font.sha256).map(x => ({ ...font, output, ...x }))))
    observations.packages[sourceName] = { observedOutputSha256: hashes, normalBuildMaps, ...bindings, fontBindings, embeddedBpmnFonts }
  }
  return observations
}
