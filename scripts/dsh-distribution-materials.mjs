/** Copy bounded original materials for the observed DSH output; never infer a complete SBOM. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { dirname, join, isAbsolute } from 'node:path'
import { prepareEmbeddedPicaLicenseMaterials, copyEmbeddedPicaLicenseMaterials } from './companion-bundled-license.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const safe = path => typeof path === 'string' && path && !isAbsolute(path)
  && !path.includes('\\') && !path.split('/').some(part => !part || part === '.' || part === '..')

export async function copyDshDistributionMaterials({ source, target, sourceName, packageName }) {
  const manifest = JSON.parse(await readFile(join(source, 'release/dsh-distribution-materials.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  const selection = manifest.packages[sourceName]
  assert.ok(selection, 'Explicit DSH package material selection required')
  // Bind the recorded module observations to the actual adapted code being packed.
  // Changed output requires a refreshed observation, never a silent old coverage claim.
  for (const [path, expected] of Object.entries(selection.observedOutputSha256)) {
    assert.ok(safe(path), 'Unsafe observed output path')
    assert.equal(sha(await readFile(join(target, path))), expected, `DSH material output observation is stale: ${sourceName}/${path}`)
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
