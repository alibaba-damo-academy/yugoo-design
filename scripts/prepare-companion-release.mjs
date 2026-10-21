/** Manual Companion CI preparation. The existing assembler owns package contents. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadNativeDonor, stageNativeDonor } from './companion-release-native-donor.mjs'

export const COMPANION_REPOSITORY = 'git+https://github.com/alibaba-damo-academy/yugoo-design.git'
export function validateReleaseVersion(version) {
  assert.match(version ?? '', /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta\.(?:0|[1-9]\d*)$/u, 'Explicit canonical beta version required')
  return version
}
export function validateReleaseManifest(manifest, version) {
  validateReleaseVersion(version)
  assert.equal(manifest.name, '@yugoo-design/companion')
  assert.equal(manifest.version, version)
  assert.deepEqual(manifest.repository, { type: 'git', url: COMPANION_REPOSITORY })
  assert.deepEqual(manifest.publishConfig, { access: 'public', tag: 'beta' })
  assert.equal(manifest.dependencies['@ladybugdb/wasm-core'], '0.21.1')
  assert.equal(manifest.scripts, undefined, 'Release template lifecycle changes need explicit review')
}
export function validatePackInventory(pack, candidateInputs, version) {
  assert.equal(pack.name, '@yugoo-design/companion'); assert.equal(pack.version, version)
  assert.equal(pack.filename, `yugoo-design-companion-${version}.tgz`)
  assert.deepEqual(pack.files.map(x => x.path).sort(), Object.keys(candidateInputs).sort(), 'npm pack omitted or added candidate files')
  for (const file of pack.files) assert.equal(file.size, candidateInputs[file.path].bytes, 'npm pack file size changed: ' + file.path)
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function npm(args, cwd) {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `npm ${args[0]} failed: ${result.stderr}`)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.length, 1, 'Exactly one Companion archive required')
  return parsed[0]
}
export async function prepareRelease({ version, output, nativeArtifactRoot }) {
  validateReleaseVersion(version)
  assert.ok(isAbsolute(output), 'Absolute external output directory required')
  const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  assert.ok(!output.startsWith(workspace + '/') && output !== workspace, 'Output must be outside source checkout')
  await mkdir(output) // exclusive; no replacement of previous evidence
  const native = nativeArtifactRoot ?? join(output, 'native-artifacts')
  let nativeMaterials
  if (!nativeArtifactRoot) nativeMaterials = await stageNativeDonor({ workspace, destination: native, archive: await downloadNativeDonor() })
  // An explicit artifact root uses the assembler's same current SOURCE gate.
  const { buildSameSourceCandidate, verifyStagedUiCandidateAssociations } = await import('./build-companion-npm-candidate.mjs')
  const build = await buildSameSourceCandidate({ ladybugDependency: '0.21.1', nativeGitArtifactRoot: native,
    candidate: { fixture: false, scope: '@yugoo-design', packageName: '@yugoo-design/companion', version, distribution: 'beta' } })
  await writeFile(join(output, 'build-location.json'), JSON.stringify({ root: build.root, error: build.error }, null, 2) + '\n')
  assert.equal(build.sameSourceBuildCompleted, true, 'Current same-source build failed: ' + JSON.stringify(build.error))
  const buildReportFile = join(build.root, 'build-report.json')
  const buildReportSha256 = sha(await readFile(buildReportFile))
  const associations = await verifyStagedUiCandidateAssociations({ buildReportFile, buildReportSha256 })
  validateReleaseManifest(JSON.parse(await readFile(join(build.candidate, 'package.json'))), version)
  const dryRun = npm(['pack', '--dry-run', '--json'], build.candidate)
  validatePackInventory(dryRun, build.candidateInputs, version)
  const pack = npm(['pack', '--json', '--pack-destination', output], build.candidate)
  validatePackInventory(pack, build.candidateInputs, version)
  assert.deepEqual(pack.files, dryRun.files, 'Pack inventory changed after dry-run')
  const tarball = join(output, pack.filename), bytes = await readFile(tarball)
  assert.equal(pack.size, bytes.length)
  assert.equal(pack.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'), 'Packed archive integrity changed')
  const receipt = { scope: 'companion-same-source-build-and-pack', version, sourceCommit: build.head,
    buildReportFile, buildReportSha256, candidateInventorySha256: build.candidateInventorySha256,
    nativeMaterials: nativeMaterials ?? { artifactRoot: native, artifactInputs: build.nativeGitArtifactInputs },
    associations, tarball, bytes: bytes.length, sha256: sha(bytes), integrity: pack.integrity,
    candidateAccepted: false, publishReady: false, published: false,
    limitations: ['Installed runtime/Host/model acceptance is separate', 'Native donor reuse is not independent binary reproducibility', 'DSH independent publication chain is outside this workflow'] }
  await writeFile(join(output, 'release-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  await writeFile(join(output, 'pack-dry-run.json'), JSON.stringify(dryRun, null, 2) + '\n', { flag: 'wx' })
  // Artifact retention is bounded to the archive and receipts; the build report
  // and snapshots remain attached to their existing assembler-owned directory.
  await writeFile(join(output, 'build-report.json'), await readFile(buildReportFile), { flag: 'wx' })
  return receipt
}
export async function verifyReleaseArchive(receiptFile, { archiveDir = dirname(receiptFile) } = {}) {
  const receipt = JSON.parse(await readFile(receiptFile))
  validateReleaseVersion(receipt.version)
  assert.equal(receipt.scope, 'companion-same-source-build-and-pack')
  assert.equal(receipt.published, false)
  const filename = `yugoo-design-companion-${receipt.version}.tgz`
  assert.equal(basename(receipt.tarball), filename, 'Receipt archive basename changed')
  assert.ok(isAbsolute(archiveDir), 'Absolute archive directory required')
  const tarball = join(archiveDir, filename)
  const bytes = await readFile(tarball)
  assert.equal(bytes.length, receipt.bytes); assert.equal(sha(bytes), receipt.sha256, 'Release archive changed after preparation')
  assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), receipt.integrity)
  return { ...receipt, preparedTarball: receipt.tarball, tarball }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'verify') {
      const verified = await verifyReleaseArchive(resolve(args[0]), args[1] ? { archiveDir: resolve(args[1]) } : {})
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tarball=${verified.tarball}\n`)
      console.log(JSON.stringify({ tarball: verified.tarball, sha256: verified.sha256, integrity: verified.integrity }))
    }
    else {
      assert.equal(command, 'prepare', 'Use prepare VERSION ABS_OUTPUT [ABS_NATIVE_ROOT] or verify RECEIPT [ABS_ARCHIVE_DIR]')
      const [version, output, nativeArtifactRoot] = args
      assert.ok(!nativeArtifactRoot || isAbsolute(nativeArtifactRoot), 'Absolute native artifacts required')
      const receipt = await prepareRelease({ version, output, nativeArtifactRoot })
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tarball=${receipt.tarball}\nreceipt=${join(output, 'release-receipt.json')}\n`)
      console.log(JSON.stringify(receipt, null, 2))
    }
  } catch (error) { console.error(error); process.exitCode = 1 }
}
