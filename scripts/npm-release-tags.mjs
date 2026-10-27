/** Read-only planning/verification. Tag mutation is confined to the official Actions jobs. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_SOURCE_PACKAGES, REGISTRY, selectDshRelease, verifyDshReceipt } from './prepare-dsh-release.mjs'
import { selectCompanionRelease, verifyReleaseArchive } from './prepare-companion-release.mjs'
const workspace = fileURLToPath(new URL('../', import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const packages = [...DSH_SOURCE_PACKAGES.map(name => '@yugoo-design/' + name), '@yugoo-design/companion']
const require = createRequire(import.meta.url)
// An existing-publication retry needs no workspace dependency installation.
// Use semver shipped inside the already installed, explicit npm 11.21.0 CLI.
function semverFor(npmCli) {
  if (npmCli !== undefined) { assert.ok(isAbsolute(npmCli)); return createRequire(npmCli)('semver') }
  return require('semver')
}
function validatePackage(name) { assert.ok(packages.includes(name), 'Official package required') }
export async function readPublishedMetadata(name, { fetchImpl = fetch } = {}) {
  validatePackage(name)
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(name)}`, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } })
  assert.equal(response.status, 200, `Published package lookup failed: HTTP ${response.status}`)
  const metadata = await response.json()
  assert.equal(metadata.name, name)
  return metadata
}
export function latestPlan({ name, releaseVersion, metadata, semver = semverFor() }) {
  validatePackage(name); assert.equal(metadata.name, name)
  assert.ok(metadata.versions && typeof metadata.versions === 'object' && !Array.isArray(metadata.versions))
  const versions = Object.keys(metadata.versions)
  assert.ok(versions.length)
  for (const version of versions) {
    assert.equal(semver.valid(version), version, 'Canonical published version required')
    assert.equal(metadata.versions[version].name, name); assert.equal(metadata.versions[version].version, version)
  }
  assert.ok(versions.includes(releaseVersion), 'Release must be published before changing latest')
  const tags = metadata['dist-tags']
  assert.ok(tags && typeof tags === 'object' && !Array.isArray(tags))
  for (const tag of ['latest', 'beta']) if (tags[tag] !== undefined) assert.ok(versions.includes(tags[tag]), `Published ${tag} version required`)
  assert.ok(tags.beta, 'Retain the existing beta channel')
  const latestVersion = [...versions].sort((a, b) => semver.rcompare(a, b) || a.localeCompare(b))[0]
  return { name, releaseVersion, latestVersion, previousLatest: tags.latest ?? null, beta: tags.beta,
    action: tags.latest === latestVersion ? 'skip' : 'update' }
}
export function verifyLatest(plan, metadata, { semver = semverFor() } = {}) {
  const current = latestPlan({ name: plan.name, releaseVersion: plan.releaseVersion, metadata, semver })
  assert.equal(current.action, 'skip', 'latest must equal the highest currently published version, including prereleases')
  assert.ok(semver.gte(current.latestVersion, plan.latestVersion), 'An old release retry must not roll latest back')
  assert.equal(current.beta, plan.beta, 'Updating latest must preserve beta')
  return current
}
/** Companion skip/recovery verifies public bytes without rebuilding or republishing. */
export async function verifyPublicCompanion(metadata, releaseVersion, { expected, fetchImpl = fetch } = {}) {
  const entry = metadata.versions[releaseVersion]
  assert.equal(entry.name, '@yugoo-design/companion'); assert.equal(entry.version, releaseVersion)
  assert.match(entry.dist?.integrity ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/u)
  if (expected) assert.equal(entry.dist.integrity, expected.integrity, 'Published Companion integrity differs from prepared receipt')
  assert.equal(entry.dist.tarball, `${REGISTRY}/@yugoo-design/companion/-/companion-${releaseVersion}.tgz`, 'Official Companion archive required')
  const response = await fetchImpl(entry.dist.tarball, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200, `Published Companion archive failed: HTTP ${response.status}`)
  const hash = createHash('sha512'); let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length; assert.ok(bytes <= 128 * 1024 * 1024, 'Companion archive exceeds comparison bound')
    hash.update(chunk)
  }
  assert.ok(bytes > 0)
  if (expected) assert.equal(bytes, expected.bytes, 'Published Companion archive size differs')
  assert.equal('sha512-' + hash.digest('base64'), entry.dist.integrity, 'Actual published Companion integrity differs')
}
export function assertCompleteDshPublication(receipt, complete, head, releaseVersion) {
  assert.equal(complete.sourceCommit, head)
  assert.equal(receipt.entries.length, 10)
  assert.deepEqual(complete.states.map(x => ({ name: x.name, version: x.version, state: x.state })), receipt.entries.map(x => ({ name: x.name, version: releaseVersion, state: 'identical' })), 'Complete ten-archive publication verification required before tags')
}
async function releaseSelection(index) {
  const chain = process.env.RELEASE_CHAIN, releaseVersion = process.env.RELEASE_VERSION
  assert.ok(['companion', 'dsh'].includes(chain))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8' }).trim()
  assert.equal(head, process.env.GITHUB_SHA, 'Fixed Actions source commit required')
  const releaseRef = process.env.RELEASE_REF
  if (chain === 'companion') {
    assert.equal(index, 0)
    await selectCompanionRelease({ manifest: await json(join(workspace, 'release/companion-version.json')), expectedVersion: releaseVersion, releaseRef, requireTag: true })
    assert.ok(['true', 'false'].includes(process.env.SKIP_RELEASE_BUILD))
    let expected
    if (process.env.SKIP_RELEASE_BUILD !== 'true') {
      expected = await verifyReleaseArchive(process.env.RELEASE_RECEIPT)
      assert.equal(expected.sourceCommit, head)
      assert.equal(expected.version, releaseVersion)
    }
    return { name: '@yugoo-design/companion', releaseVersion, expected }
  }
  selectDshRelease({ manifest: await json(join(workspace, 'release/release-hosts.json')), expectedVersion: releaseVersion, releaseRef, requireTag: true })
  const receiptFile = process.env.RELEASE_RECEIPT
  assert.ok(isAbsolute(receiptFile ?? ''), 'DSH receipt required')
  const receipt = await verifyDshReceipt(receiptFile, { sourceCommit: head })
  assert.equal(receipt.version, releaseVersion)
  const complete = await json(join(dirname(receiptFile), 'complete-registry.json'))
  assertCompleteDshPublication(receipt, complete, head, releaseVersion)
  assert.ok(Number.isInteger(index) && index >= 0 && index < 10)
  return { name: receipt.entries[index].name, releaseVersion }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, indexText, planFile, ...extra] = process.argv.slice(2)
    assert.ok(['plan', 'confirm'].includes(command)); assert.deepEqual(extra, [])
    assert.match(indexText ?? '', /^[0-9]$/u)
    assert.ok(isAbsolute(process.env.NPM_CLI ?? ''), 'Explicit installed npm CLI required')
    const semver = semverFor(process.env.NPM_CLI), selection = await releaseSelection(Number(indexText))
    const metadata = await readPublishedMetadata(selection.name)
    const plan = latestPlan({ ...selection, metadata, semver })
    if (command === 'confirm') {
      const previous = await json(planFile)
      assert.equal(previous.name, selection.name); assert.equal(previous.releaseVersion, selection.releaseVersion)
      console.log(JSON.stringify(verifyLatest(previous, metadata, { semver })))
    } else {
      assert.equal(planFile, undefined)
      if (process.env.RELEASE_CHAIN === 'companion') await verifyPublicCompanion(metadata, selection.releaseVersion, { expected: selection.expected })
      console.log(JSON.stringify(plan))
    }
  } catch (error) { console.error(error); process.exitCode = 1 }
}
