/** Read-only planning/verification. Tag mutation is confined to the official Actions jobs. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_SOURCE_PACKAGES, REGISTRY, packageNameFor, verifyProductReceipt, readProductRegistryState, publicationOrder } from './prepare-product-release.mjs'
import { readProductRelease, selectProductRelease, validateReleaseVersion } from './product-release.mjs'
const workspace = fileURLToPath(new URL('../', import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const packages = RELEASE_SOURCE_PACKAGES.map(packageNameFor)
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
  validateReleaseVersion(releaseVersion)
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
  for (const [tag,value] of Object.entries(tags)) assert.ok(versions.includes(value), `Published ${tag} version required`)
  const stable = versions.filter(version => semver.prerelease(version) === null)
  assert.ok(stable.length, 'Published stable version required')
  const latestVersion = stable.sort((a,b) => semver.rcompare(a,b) || a.localeCompare(b))[0]
  return { name, releaseVersion, latestVersion, previousLatest: tags.latest ?? null, otherTags: Object.fromEntries(Object.entries(tags).filter(([key]) => key !== 'latest')),
    action: tags.latest === latestVersion ? 'skip' : 'update' }
}
export function verifyLatest(plan, metadata, { semver = semverFor() } = {}) {
  const current = latestPlan({ name: plan.name, releaseVersion: plan.releaseVersion, metadata, semver })
  assert.equal(current.action, 'skip', 'latest must equal the highest currently published version, excluding prereleases')
  assert.ok(semver.gte(current.latestVersion, plan.latestVersion), 'An old release retry must not roll latest back')
  assert.deepEqual(current.otherTags, plan.otherTags, 'Updating latest must preserve unrelated tags')
  return current
}
export function assertCompleteProductPublication(receipt, complete, head, releaseVersion) {
  assert.equal(receipt.sourceCommit, head); assert.equal(complete.sourceCommit, head)
  publicationOrder(receipt.entries)
  assert.deepEqual(complete.states.map(x => ({name:x.name,version:x.version,state:x.state})),
    receipt.entries.map(x=>({name:x.name,version:releaseVersion,state:'identical'})), 'Complete eleven-archive publication verification required before tags')
}
async function releaseSelection(index) {
  assert.equal(process.env.RELEASE_CHAIN, 'product')
  const releaseVersion=process.env.RELEASE_VERSION
  const head=execFileSync('git',['rev-parse','HEAD'],{cwd:workspace,encoding:'utf8'}).trim()
  assert.equal(head,process.env.GITHUB_SHA,'Fixed Actions source commit required')
  selectProductRelease({product:await readProductRelease(workspace),expectedVersion:releaseVersion,releaseRef:process.env.RELEASE_REF,requireTag:true})
  const receiptFile=process.env.RELEASE_RECEIPT
  assert.ok(isAbsolute(receiptFile??''),'Product receipt required')
  const receipt=await verifyProductReceipt(receiptFile,{sourceCommit:head})
  assert.equal(receipt.version,releaseVersion)
  const complete=await readProductRegistryState(receiptFile,'complete-registry.json')
  assertCompleteProductPublication(receipt,complete,head,releaseVersion)
  assert.ok(Number.isInteger(index)&&index>=0&&index<RELEASE_SOURCE_PACKAGES.length)
  return {name:receipt.entries[index].name,releaseVersion}
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, indexText, planFile, ...extra] = process.argv.slice(2)
    assert.ok(['plan', 'confirm'].includes(command)); assert.deepEqual(extra, [])
    assert.match(indexText ?? '', /^(?:[0-9]|10)$/u)
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
        console.log(JSON.stringify(plan))
    }
  } catch (error) { console.error(error); process.exitCode = 1 }
}
