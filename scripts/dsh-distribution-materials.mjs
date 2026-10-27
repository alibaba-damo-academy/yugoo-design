/** Copy bounded original materials for the observed DSH output; never infer a complete SBOM. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareEmbeddedPicaLicenseMaterials, copyEmbeddedPicaLicenseMaterials } from './companion-bundled-license.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const safe = path => typeof path === 'string' && path && !isAbsolute(path)
  && !path.includes('\\') && !path.split('/').some(part => !part || part === '.' || part === '..')

export const FIRST_PARTY_MATERIAL = 'first-party fixed normal-build input; original project license and notice'
export async function readCurrentFirstPartyIdentity({ source, manifestPath, sourceCommit }) {
  assert.ok(safe(manifestPath) && /^packages\/[^/]+\/package\.json$/u.test(manifestPath), 'Current workspace manifest path required')
  assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/u, 'Fixed current source commit required')
  let cursor = source
  for (const part of manifestPath.split('/')) {
    cursor = join(cursor, part)
    assert.ok(!(await lstat(cursor)).isSymbolicLink(), 'Current workspace manifest symlink rejected')
  }
  const bytes = await readFile(cursor), manifest = JSON.parse(bytes)
  const committed = execFileSync('git', ['show', `${sourceCommit}:${manifestPath}`], { cwd: source })
  assert.equal(sha(bytes), sha(committed), 'Current workspace metadata differs from fixed source')
  return { manifestPath, sourceCommit, name: manifest.name, version: manifest.version, packageMetadataSha256: sha(bytes) }
}

export async function copyDshDistributionMaterials({ source, target, sourceName, packageName, observationFile, observationSha256 }) {
  const manifestBytes = await readFile(join(source, 'release/dsh-distribution-materials.json'))
  const manifest = JSON.parse(manifestBytes)
  assert.equal(manifest.schemaVersion, 1)
  let selection = manifest.packages[sourceName]
  if (observationFile !== undefined) {
    assert.ok(isAbsolute(observationFile), 'Absolute current observation receipt required')
    const bytes = await readFile(observationFile)
    assert.equal(sha(bytes), observationSha256, 'Current observation receipt changed')
    const receipt = JSON.parse(bytes)
    assert.equal(receipt.kind, 'dsh-current-normal-observations')
    assert.equal(receipt.sourceManifestSha256, sha(manifestBytes), 'Maintained material authority changed')
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim()
    assert.equal(receipt.sourceCommit, head, 'Observation source commit changed')
    const observed = receipt.packages[sourceName], firstPartyIdentities = {}
    for (const binding of observed?.componentBindings ?? []) {
      if (selection.components[binding.componentIndex]?.correspondence !== FIRST_PARTY_MATERIAL) continue
      assert.ok(binding.currentIdentity, 'Explicit current first-party identity required')
      firstPartyIdentities[binding.componentIndex] = await readCurrentFirstPartyIdentity({ source,
        manifestPath: binding.currentIdentity.manifestPath, sourceCommit: head })
    }
    selection = hydrateDshSelection(selection, observed, { firstPartyIdentities })
  } else assert.equal(observationSha256, undefined, 'Observation hash requires an explicit receipt')
  assert.ok(selection, 'Explicit DSH package material selection required')
  // Bind the recorded module observations to the actual adapted code being packed.
  // Changed output requires a refreshed observation, never a silent old coverage claim.
  for (const [path, expected] of Object.entries(selection.observedOutputSha256)) {
    assert.ok(safe(path), 'Unsafe observed output path')
    let bytes
    try { bytes = await readFile(join(target, path)) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      assert.fail(`DSH material output observation is stale: ${sourceName}/${path} (missing current output)`)
    }
    assert.equal(sha(bytes), expected, `DSH material output observation is stale: ${sourceName}/${path}`)
  }
  // A valid output hash table alone cannot validate references to renamed chunks.
  // Every current correspondence must point into that already verified table.
  const correspondences = [
    ...(selection.components ?? []).flatMap(item => item.outputs ?? []),
    ...(selection.fonts ?? []).flatMap(item => (item.matchingDataUrls ?? []).map(match => match.output)),
    ...(selection.normalBuildMaps ?? []).map(item => item.output),
  ]
  for (const path of correspondences) {
    assert.ok(safe(path) && Object.hasOwn(selection.observedOutputSha256, path),
      `DSH material output correspondence is stale: ${sourceName}/${path}`)
  }
  const pica = (selection.components ?? []).find(item => item.name === 'pica')
  if (pica) assert.equal(pica.version, '7.1.1', 'Unreviewed embedded Pica version')
  const embeddedPicaEntries = pica ? await prepareEmbeddedPicaLicenseMaterials(source) : null
  const copied = {}
  for (const item of selection.materials) {
    assert.ok(safe(item.source) && safe(item.path) && item.path.startsWith('licenses/'), 'Unsafe material path')
    const info = await lstat(join(source, item.source))
    assert.ok(info.isFile() && !info.isSymbolicLink(), 'Original material must be a regular file')
    const bytes = await readFile(join(source, item.source))
    assert.equal(sha(bytes), item.sha256, `Original material changed: ${item.source}`)
    await mkdir(dirname(join(target, item.path)), { recursive: true })
    await writeFile(join(target, item.path), bytes, { flag: 'wx' })
    copied[item.path] = item.sha256
  }
  if (embeddedPicaEntries) {
    const materials = await copyEmbeddedPicaLicenseMaterials(embeddedPicaEntries, target)
    Object.assign(copied, materials.assets)
  }
  const index = {
    schemaVersion: 1, package: packageName,
    scope: 'observed-current-dsh-output-and-selected-original-materials',
    sourceArchiveObserved: selection.observedArchiveSha256,
    outputSha256: selection.observedOutputSha256,
    normalBuildMaps: selection.normalBuildMaps,
    ...(selection.currentBuildAssociation ? { currentBuildAssociation: selection.currentBuildAssociation } : {}),
    components: selection.components, fonts: selection.fonts,
    embeddedBpmnFonts: selection.embeddedBpmnFonts ?? [],
    unresolvedEmbeddedFonts: selection.unresolvedEmbeddedFonts ?? [],
    externalDependencies: selection.externalDependencies, externalPeers: selection.externalPeers,
    copiedMaterials: copied, limitations: selection.limitations,
    ...(pica ? { embeddedPicaMaterials: {
      parent: { name: pica.name, version: pica.version, outputs: pica.outputs },
      sourceNoticeMap: 'licenses/bundled-js/pica-embedded/fixture-notice-map.json',
      scope: 'retained-originals-for-known-pica-prebundle-components-and-historical-runtime',
      currentRuntimeExecutionVerified: false,
    } } : {}),
    completeBundledInventoryVerified: false, releaseLicenseAcceptance: false,
  }
  await mkdir(join(target, 'licenses'), { recursive: true })
  await writeFile(join(target, 'licenses/dsh-distribution.json'), JSON.stringify(index, null, 2) + '\n', { flag: 'wx' })
  const notice = join(target, 'NOTICE')
  await writeFile(notice, (await readFile(notice, 'utf8'))
    + '\nDSH distribution materials for this package: licenses/dsh-distribution.json.\n'
    + 'It lists actual output hashes, selected original texts in this package, and external npm dependencies separately.\n'
    + 'Existing third-party materials retain their individual terms.\n'
    + 'Historical Companion/source observations are not claims of complete coverage for this DSH archive.\n')
  return { copiedMaterials: copied, index: 'licenses/dsh-distribution.json' }
}

/** Hydrate only current associations. Source still owns every component/material/font identity. */
export function hydrateDshSelection(base, observed, { firstPartyIdentities = {} } = {}) {
  assert.ok(observed && typeof observed === 'object')
  for (const [path, hash] of Object.entries(observed.observedOutputSha256)) {
    assert.ok(safe(path)); assert.match(hash, /^[a-f0-9]{64}$/u)
  }
  const components = observed.componentBindings.map(({ componentIndex, outputs, currentIdentity }) => {
    assert.ok(Number.isSafeInteger(componentIndex) && base.components[componentIndex], 'Unknown source component')
    assert.ok(outputs.length && outputs.every(path => Object.hasOwn(observed.observedOutputSha256, path)), 'Unbound component output')
    const component = base.components[componentIndex]
    if (component.correspondence === FIRST_PARTY_MATERIAL) {
      assert.ok(currentIdentity && firstPartyIdentities[componentIndex], 'Verified current first-party identity required')
      assert.deepEqual(currentIdentity, firstPartyIdentities[componentIndex], 'Current first-party identity differs from fixed source')
      assert.equal(currentIdentity.name, component.name)
      assert.equal(currentIdentity.version, component.version)
      return { ...component, outputs, packageMetadataSha256: currentIdentity.packageMetadataSha256, currentSourceIdentity: currentIdentity }
    }
    assert.equal(currentIdentity, undefined, 'Third-party identity cannot use a current workspace override')
    return { ...component, outputs }
  })
  const fonts = observed.fontBindings.map(({ fontIndex, matchingDataUrls }) => {
    const font = base.fonts[fontIndex]; assert.ok(font, 'Unknown source font')
    for (const match of matchingDataUrls) {
      assert.equal(match.sha256, font.sha256)
      assert.ok(Object.hasOwn(observed.observedOutputSha256, match.output), 'Unbound font output')
    }
    return { ...font, matchingDataUrls }
  })
  return { ...base, observedArchiveSha256: null, observedOutputSha256: observed.observedOutputSha256,
    normalBuildMaps: observed.normalBuildMaps, components, fonts, embeddedBpmnFonts: observed.embeddedBpmnFonts,
    currentBuildAssociation: { historicalComponentsWithoutCurrentAssociation: observed.historicalComponentsWithoutCurrentAssociation,
      unassociatedObservedModules: observed.unassociatedObservedModules,
      historicalObservation: base,
      limitation: 'Unassociated prior components remain historical only. Current module observations are bounded; complete inventory and license acceptance remain false.' } }
}
