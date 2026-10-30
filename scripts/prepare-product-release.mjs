/** Unified product preparation and read-only guards. Publication lives only in Actions. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { appendFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { DSH_AGGREGATE_SOURCE, releasePackagesFor } from './release-consumer-config.mjs'
import { PRODUCT_NAME, readProductRelease, validateProductRelease, validateReleaseVersion, selectProductRelease, productReleaseHosts } from './product-release.mjs'
export { selectProductRelease } from './product-release.mjs'

export const DSH_SOURCE_PACKAGES = Object.freeze(Object.keys(releasePackagesFor({ ladybugSource: 'registry' })))
export const REGISTRY = 'https://registry.npmjs.org'
export const REPOSITORY = 'alibaba-damo-academy/yugoo-design'
export const RELEASE_SOURCE_PACKAGES = Object.freeze([...DSH_SOURCE_PACKAGES, PRODUCT_NAME])
export const PRODUCT_WORKFLOW = '.github/workflows/publish-product.yml'
export const ARTIFACT_STEPS = Object.freeze({
  prepare: 'Build the fixed source once, bind current observations and pack eleven archives',
  seal: 'Seal fourteen files for immutable product recovery',
  upload: 'Retain the prepared product archives before any publication',
})
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024
export const packageNameFor = sourceName => sourceName === PRODUCT_NAME || sourceName === DSH_AGGREGATE_SOURCE ? sourceName : '@yugoo-design/' + sourceName
export const archiveNameFor = (sourceName, version) => packageNameFor(sourceName).replace(/^@/u, '').replace('/', '-') + '-' + version + '.tgz'
const workspace = fileURLToPath(new URL('../', import.meta.url))
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const git = args => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' }).trim()

/** Verify the actual projected npm metadata before building or packing a release. */
export function assertDshPublicationMetadata(manifests, mapping) {
  assert.deepEqual(Object.keys(manifests).sort(), [...DSH_SOURCE_PACKAGES].sort(), 'Exactly ten DSH publication manifests required')
  assert.deepEqual(Object.keys(mapping).sort(), [...DSH_SOURCE_PACKAGES].sort(), 'Existing DSH candidate mapping required')
  for (const name of DSH_SOURCE_PACKAGES) {
    assert.equal(manifests[name].name, packageNameFor(name), 'DSH publication identity changed')
    assert.deepEqual(manifests[name].repository, {
      type: 'git', url: `git+https://github.com/${REPOSITORY}.git`, directory: mapping[name].directory,
    }, `DSH publication repository metadata must match the public source: ${name}`)
  }
}
export function validateProductManifest(manifest, version) {
  validateReleaseVersion(version)
  assert.equal(manifest.name, PRODUCT_NAME); assert.equal(manifest.version, version)
  assert.deepEqual(manifest.repository, { type: 'git', url: `git+https://github.com/${REPOSITORY}.git` })
  assert.deepEqual(manifest.bin, { [PRODUCT_NAME]: 'bin/yugoo-design.mjs' })
  assert.deepEqual(manifest.publishConfig, { access: 'public', tag: 'latest' })
  assert.equal(manifest.engines?.node, '>=22.19.0', 'Maintained product Node minimum required')
  assert.equal(manifest.dependencies?.['@ladybugdb/wasm-core'], '0.21.1')
  assert.equal(manifest.scripts, undefined, 'Product release lifecycle scripts require explicit review')
}
export function validatePackInventory(pack, inputs, version) {
  assert.equal(pack.name, PRODUCT_NAME); assert.equal(pack.version, version)
  assert.equal(pack.filename, archiveNameFor(PRODUCT_NAME, version))
  assert.deepEqual(pack.files.map(x => x.path).sort(), Object.keys(inputs).sort(), 'Product pack omitted or added files')
  for (const file of pack.files) assert.equal(file.size, inputs[file.path].bytes, 'Product pack file size changed')
}

const decimalId = value => {
  assert.match(value ?? '', /^[1-9][0-9]*$/u, 'Canonical positive Actions ID required')
  return value
}
function assertActionsOrigin(origin, version) {
  assert.equal(origin.repository, REPOSITORY)
  decimalId(origin.repositoryId); decimalId(origin.runId); decimalId(origin.runAttempt)
  assert.equal(origin.workflowPath, PRODUCT_WORKFLOW)
  assert.ok(['dryrun', 'publish'].includes(origin.job), 'Known DSH preparation job required')
  assert.ok(['push', 'workflow_dispatch'].includes(origin.eventName), 'Untrusted Actions event')
  assert.ok(origin.ref === 'refs/heads/main' && origin.eventName === 'workflow_dispatch'
    || origin.ref === `refs/tags/v${version}`, 'Reviewed main or matching fixed DSH tag required')
}
export function productActionsContext(env = process.env) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'DSH artifact operations run only in Actions')
  assert.equal(env.GITHUB_REPOSITORY, REPOSITORY)
  assert.equal(env.GITHUB_WORKFLOW_REF, `${REPOSITORY}/${PRODUCT_WORKFLOW}@${env.GITHUB_REF}`)
  assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/u)
  return { repository: env.GITHUB_REPOSITORY, repositoryId: decimalId(env.GITHUB_REPOSITORY_ID),
    workflowPath: PRODUCT_WORKFLOW, runId: decimalId(env.GITHUB_RUN_ID), runAttempt: decimalId(env.GITHUB_RUN_ATTEMPT),
    ref: env.GITHUB_REF, eventName: env.GITHUB_EVENT_NAME, job: env.GITHUB_JOB, sourceCommit: env.GITHUB_SHA }
}
export function productArtifactName(version, sourceCommit, origin) {
  validateReleaseVersion(version); assert.match(sourceCommit, /^[a-f0-9]{40}$/u); assertActionsOrigin(origin, version)
  return `product-release-${version}-${sourceCommit}-${origin.runId}-${origin.runAttempt}`
}
export function productArtifactPaths(version) {
  validateReleaseVersion(version)
  return ['release-receipt.json', 'material-observations.json', 'pnpm-lock.yaml', ...RELEASE_SOURCE_PACKAGES.map(name =>
    `distribution/tarballs/${archiveNameFor(name, version)}`)].sort()
}
async function regularFile(path, root) {
  let cursor = resolve(root)
  assert.ok(!(await lstat(cursor)).isSymbolicLink(), 'Artifact root symlink refused')
  const parts = path.split('/')
  assert.ok(parts.every(part => part && part !== '.' && part !== '..' && !part.includes('\\')), 'Unsafe artifact path')
  for (const part of parts) {
    cursor = join(cursor, part)
    assert.ok(!(await lstat(cursor)).isSymbolicLink(), 'Artifact symlink refused')
  }
  assert.ok((await lstat(cursor)).isFile(), 'Regular artifact file required')
  return cursor
}
async function payloadFiles(root, prefix = '') {
  const files = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name
    assert.ok(!entry.isSymbolicLink(), 'Artifact symlink refused')
    if (entry.isDirectory()) {
      assert.ok(['distribution', 'distribution/tarballs'].includes(path), 'Unexpected artifact directory')
      files.push(...await payloadFiles(root, path + '/'))
    } else { assert.ok(entry.isFile(), 'Regular artifact file required'); files.push(path) }
  }
  return files.sort()
}
function outsideWorkspace(path) {
  assert.ok(isAbsolute(path) && resolve(path) !== resolve(workspace)
    && !resolve(path).startsWith(resolve(workspace) + '/'), 'Absolute external artifact directory required')
}

/** The existing receipt remains the single archive authority; fourteen files only. */
export async function sealProductRelease(receiptFile, destination, { context = productActionsContext(), lockFile = join(workspace, 'pnpm-lock.yaml'), sourceRoot = workspace } = {}) {
  outsideWorkspace(destination)
  const receipt = await verifyProductReceipt(receiptFile, { sourceCommit: context.sourceCommit })
  assertActionsOrigin(context, receipt.version)
  const { sourceCommit, ...origin } = context
  const observations = await readFile(await regularFile('material-observations.json', dirname(receiptFile)))
  assert.equal(sha256(observations), receipt.observationSha256, 'Prepared observation changed')
  const lock = await readFile(lockFile)
  receipt.actionsOrigin = origin; receipt.publicLockSha256 = sha256(lock)
  await mkdir(destination)
  await mkdir(join(destination, 'distribution/tarballs'), { recursive: true })
  for (const entry of receipt.entries) await cp(await regularFile(`distribution/tarballs/${entry.filename}`, dirname(receiptFile)),
    join(destination, 'distribution/tarballs', entry.filename), { errorOnExist: true, force: false })
  await writeFile(join(destination, 'release-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  await writeFile(join(destination, 'material-observations.json'), observations, { flag: 'wx' })
  await writeFile(join(destination, 'pnpm-lock.yaml'), lock, { flag: 'wx' })
  await verifyProductArtifactPayload(destination, { sourceCommit, version: receipt.version, sourceRoot })
  return { name: productArtifactName(receipt.version, sourceCommit, origin), receiptSha256: sha256(await readFile(join(destination, 'release-receipt.json'))) }
}

export async function verifyProductArtifactPayload(root, { sourceCommit, version, sourceRoot = workspace }) {
  assert.deepEqual(await payloadFiles(root), productArtifactPaths(version), 'Exactly fourteen DSH artifact files required')
  for (const path of productArtifactPaths(version)) await regularFile(path, root)
  const receipt = await verifyProductReceipt(join(root, 'release-receipt.json'), { sourceCommit })
  assert.equal(receipt.version, version); assertActionsOrigin(receipt.actionsOrigin, version)
  const observations = await readFile(join(root, 'material-observations.json'))
  assert.equal(sha256(observations), receipt.observationSha256, 'Artifact observation changed')
  const observed = JSON.parse(observations)
  assert.equal(observed.kind, 'dsh-current-normal-observations'); assert.equal(observed.sourceCommit, sourceCommit)
  assert.equal(sha256(await readFile(join(root, 'pnpm-lock.yaml'))), receipt.publicLockSha256, 'Artifact public lock changed')
  const manifests = {}
  const mapping = {}
  for (const entry of receipt.entries) {
    let bytes
    try { bytes = execFileSync('tar', ['-xOf', join(root, 'distribution/tarballs', entry.filename), 'package/package.json'],
      { maxBuffer: 2 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) }
    catch { assert.fail('Prepared archive package metadata unavailable') }
    manifests[entry.sourceName] = JSON.parse(bytes)
    assert.equal(manifests[entry.sourceName].name, entry.name); assert.equal(manifests[entry.sourceName].version, version)
    if (entry.sourceName === PRODUCT_NAME) {
      validateProductManifest(manifests[entry.sourceName], version)
      const product = await readProductRelease(sourceRoot)
      assert.equal(product.version, version)
      let hosts
      try { hosts = JSON.parse(execFileSync('tar', ['-xOf', join(root, 'distribution/tarballs', entry.filename), 'package/release-hosts.json'],
        { maxBuffer: 2 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })) }
      catch { assert.fail('Product exact host mapping unavailable') }
      assert.deepEqual(hosts, productReleaseHosts(product, await json(join(sourceRoot, 'release/release-hosts.json'))), 'Product exact host mapping changed')
    } else {
    const directory = manifests[entry.sourceName].repository?.directory
    assert.match(directory ?? '', /^packages\/[a-z0-9-]+$/u, 'Safe source package directory required')
    const source = await json(join(sourceRoot, directory, 'package.json'))
    assert.equal(source.name, entry.sourceName, 'Artifact directory differs from fixed source package')
    assert.deepEqual(source.repository, manifests[entry.sourceName].repository, 'Artifact repository differs from fixed source')
    mapping[entry.sourceName] = { directory }
    }
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, value] of Object.entries(manifests[entry.sourceName][field] ?? {})) {
        if (name.startsWith('@yugoo-design/')) assert.equal(value, version, 'Prepared own dependency version changed')
      }
    }
    const ownDependencies = Object.keys({ ...manifests[entry.sourceName].dependencies, ...manifests[entry.sourceName].optionalDependencies,
      ...manifests[entry.sourceName].peerDependencies }).filter(name => name.startsWith('@yugoo-design/')).sort()
    assert.deepEqual(ownDependencies, [...entry.dependencies].sort(), 'Prepared archive publication graph changed')
  }
  assertDshPublicationMetadata(Object.fromEntries(DSH_SOURCE_PACKAGES.map(name => [name, manifests[name]])), mapping)
  return receipt
}

/** Verify the actual downloaded ZIP before bounded, whitelist-only extraction. */
export async function extractProductArtifactZip(bytes, digest, destination, version) {
  assert.match(digest ?? '', /^sha256:[a-f0-9]{64}$/u)
  assert.ok(bytes.length > 0 && bytes.length <= MAX_ARTIFACT_BYTES, 'Artifact ZIP size exceeds bound')
  assert.equal('sha256:' + sha256(bytes), digest, 'Downloaded artifact ZIP digest differs')
  outsideWorkspace(destination)
  const temporary = await mkdtemp(join(tmpdir(), 'product-artifact-zip-'))
  try {
    const archive = join(temporary, 'artifact.zip'); await writeFile(archive, bytes, { mode: 0o600, flag: 'wx' })
    execFileSync('python3', ['-c', String.raw`
import json, os, stat, sys, zipfile
archive, target, expected_json, bound = sys.argv[1:]
expected = set(json.loads(expected_json)); bound = int(bound)
with zipfile.ZipFile(archive) as source:
    infos = source.infolist()
    assert len(infos) <= 16, 'Unexpected ZIP entries'
    files = []; seen = set(); total = 0
    for item in infos:
        name = item.filename
        assert name not in seen, 'Duplicate ZIP member'
        seen.add(name)
        mode = stat.S_IFMT(item.external_attr >> 16)
        if item.is_dir():
            assert name in ('distribution/', 'distribution/tarballs/') and mode in (0, stat.S_IFDIR), 'Unsafe ZIP directory'
            continue
        assert name in expected and mode in (0, stat.S_IFREG), 'Unsafe ZIP member'
        assert item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and not item.flag_bits & 1, 'Unsupported ZIP member'
        assert 0 <= item.file_size <= bound, 'ZIP member exceeds bound'
        if not name.endswith('.tgz'):
            assert item.file_size <= 16 * 1024 * 1024, 'Metadata exceeds bound'
        total += item.file_size; files.append(item)
    assert {item.filename for item in files} == expected and len(files) == 14 and total <= bound, 'Incomplete ZIP payload'
    os.mkdir(target, 0o700)
    for item in files:
        output = os.path.join(target, *item.filename.split('/'))
        os.makedirs(os.path.dirname(output), mode=0o700, exist_ok=True)
        count = 0
        with source.open(item) as src, open(output, 'xb') as dst:
            while True:
                chunk = src.read(65536)
                if not chunk: break
                count += len(chunk)
                assert count <= item.file_size, 'ZIP content exceeds declared size'
                dst.write(chunk)
        assert count == item.file_size, 'Truncated ZIP member'
`, archive, destination, JSON.stringify(productArtifactPaths(version)), String(MAX_ARTIFACT_BYTES)],
    { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4096 })
  } catch { assert.fail('DSH artifact ZIP extraction refused') }
  finally { await rm(temporary, { recursive: true, force: true }) }
}

/** Only fixed GitHub API paths receive the ephemeral token; redirects never do. */
export function productActionsApi({ token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  assert.ok(typeof token === 'string' && token.length, 'Actions read token required')
  const request = async path => {
    assert.match(path, /^actions\/[a-zA-Z0-9_./?=&-]+$/u)
    return fetchImpl(`https://api.github.com/repos/${REPOSITORY}/${path}`, { redirect: 'manual',
      credentials: 'omit', signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  }
  return {
    get: async path => {
      const response = await request(path)
      assert.equal(response.status, 200, `Actions API lookup failed (HTTP ${response.status})`)
      return response.json()
    },
    download: async id => {
      const redirect = await request(`actions/artifacts/${decimalId(id)}/zip`)
      assert.equal(redirect.status, 302, 'Artifact download redirect unavailable')
      let url
      try { url = new URL(redirect.headers.get('location')) } catch { assert.fail('Artifact redirect is invalid') }
      assert.ok(url.protocol === 'https:' && !(url.username || url.password || url.hash), 'Unsafe artifact redirect')
      let response
      try { response = await fetchImpl(url.href, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(60000) }) }
      catch { assert.fail('Artifact download failed') }
      assert.equal(response.status, 200, `Artifact download failed (HTTP ${response.status})`)
      const chunks = []; let size = 0
      for await (const chunk of response.body) {
        size += chunk.length; assert.ok(size <= MAX_ARTIFACT_BYTES, 'Artifact ZIP exceeds download bound'); chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    },
  }
}
async function actionPages(api, path, field) {
  const rows = []
  for (let page = 1; page <= 10; page++) {
    const data = await api.get(`${path}?per_page=100&page=${page}`)
    assert.ok(Array.isArray(data[field]) && Number.isSafeInteger(data.total_count), 'Invalid paged Actions response')
    rows.push(...data[field])
    if (rows.length >= data.total_count) return rows
    assert.ok(data[field].length, 'Incomplete Actions pagination')
  }
  assert.fail('Actions pagination exceeds recovery bound')
}
function assertArtifactRecord(artifact, { runId, sourceCommit, context }) {
  decimalId(String(artifact.id)); assert.equal(String(artifact.workflow_run?.id), runId)
  assert.equal(String(artifact.workflow_run?.repository_id), context.repositoryId)
  assert.equal(String(artifact.workflow_run?.head_repository_id), context.repositoryId, 'Fork artifact refused')
  assert.equal(artifact.workflow_run?.head_sha, sourceCommit)
  assert.equal(artifact.expired, false, 'Artifact expired')
  assert.ok(Number.isFinite(Date.parse(artifact.expires_at)) && Date.parse(artifact.expires_at) > Date.now(), 'Artifact expired')
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0
    && artifact.size_in_bytes <= MAX_ARTIFACT_BYTES, 'Artifact size exceeds bound')
  assert.match(artifact.digest ?? '', /^sha256:[a-f0-9]{64}$/u, 'Artifact server digest required')
}

/** Select one prior artifact. Missing/ambiguous rerun state never becomes a rebuild. */
export async function selectProductArtifactRoute({ version, context = productActionsContext(), resumeRunId = '', resumeArtifactId = '',
  api = productActionsApi(), fetchImpl = fetch }) {
  assertActionsOrigin(context, version)
  assert.equal(Boolean(resumeRunId), Boolean(resumeArtifactId), 'Resume run and artifact IDs must be paired')
  if (resumeRunId) {
    decimalId(resumeRunId); decimalId(resumeArtifactId)
    const artifact = await api.get(`actions/artifacts/${resumeArtifactId}`)
    assert.equal(String(artifact.id), resumeArtifactId)
    assertArtifactRecord(artifact, { runId: resumeRunId, sourceCommit: context.sourceCommit, context })
    return { mode: 'restore', runId: resumeRunId, artifactId: resumeArtifactId, digest: artifact.digest }
  }
  if (BigInt(context.runAttempt) > 1n) {
    const artifacts = await actionPages(api, `actions/runs/${context.runId}/artifacts`, 'artifacts')
    const prefix = `product-release-${version}-${context.sourceCommit}-${context.runId}-`
    const candidates = artifacts.filter(item => item.name?.startsWith(prefix) && /^[1-9][0-9]*$/u.test(item.name.slice(prefix.length))
      && BigInt(item.name.slice(prefix.length)) < BigInt(context.runAttempt))
    assert.equal(candidates.length, 1, 'Exactly one original artifact required; missing or ambiguous recovery cannot rebuild')
    const artifact = candidates[0]
    assertArtifactRecord(artifact, { runId: context.runId, sourceCommit: context.sourceCommit, context })
    return { mode: 'restore', runId: context.runId, artifactId: String(artifact.id), digest: artifact.digest }
  }
  // Without original bytes, even a fresh runner cannot recreate a partial release.
  for (const sourceName of RELEASE_SOURCE_PACKAGES) {
    const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(packageNameFor(sourceName))}/${version}`,
      { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } })
    assert.equal(response.status, 404, 'Fresh preparation requires all exact versions absent; use the original artifact for a retry')
  }
  return { mode: 'prepare' }
}

export async function verifyProductArtifactProvenance({ receipt, artifact, sourceRun, workflow, jobs, context, runId, artifactId }) {
  assert.equal(String(artifact.id), artifactId)
  assertArtifactRecord(artifact, { runId, sourceCommit: context.sourceCommit, context })
  assert.equal(receipt.sourceCommit, context.sourceCommit)
  const origin = receipt.actionsOrigin; assertActionsOrigin(origin, receipt.version)
  assert.equal(origin.repositoryId, context.repositoryId); assert.equal(origin.runId, runId)
  assert.equal(artifact.name, productArtifactName(receipt.version, receipt.sourceCommit, origin))
  assert.equal(String(sourceRun.id), runId); assert.equal(sourceRun.head_sha, context.sourceCommit)
  assert.equal(String(sourceRun.repository?.id), context.repositoryId)
  assert.equal(String(sourceRun.head_repository?.id), context.repositoryId, 'Fork preparation refused')
  assert.equal(sourceRun.repository?.full_name, REPOSITORY)
  assert.equal(sourceRun.head_repository?.full_name, REPOSITORY)
  assert.equal(sourceRun.path, PRODUCT_WORKFLOW)
  decimalId(String(workflow.id))
  assert.equal(workflow.path, PRODUCT_WORKFLOW); assert.equal(String(sourceRun.workflow_id), String(workflow.id))
  assert.equal(sourceRun.event, origin.eventName)
  assert.equal(sourceRun.head_branch, origin.ref.replace(/^refs\/(?:heads|tags)\//u, ''))
  assert.ok(BigInt(origin.runAttempt) <= BigInt(String(sourceRun.run_attempt)), 'Unknown preparation attempt')
  if (runId === context.runId) assert.ok(BigInt(origin.runAttempt) < BigInt(context.runAttempt), 'Rerun must restore an earlier attempt')
  const sourceJobs = jobs.filter(job => job.name === origin.job && job.head_sha === context.sourceCommit)
  assert.equal(sourceJobs.length, 1, 'Exactly one original preparation job required')
  assert.equal(String(sourceJobs[0].run_attempt), origin.runAttempt, 'Original attempt job required')
  assert.equal(sourceJobs[0].status, 'completed', 'Original preparation job must have completed')
  for (const name of Object.values(ARTIFACT_STEPS)) {
    const steps = sourceJobs[0].steps?.filter(step => step.name === name) ?? []
    assert.equal(steps.length, 1, 'Original preparation step unavailable')
    assert.equal(steps[0].conclusion, 'success', 'Original preparation, seal and upload must have succeeded')
  }
  // Overall failure is expected after a partial publication; original step
  // success, source identity and archive bytes are the recovery boundary.
}

export async function restoreProductArtifact({ version, destination, runId, artifactId, context = productActionsContext(), api = productActionsApi(), sourceRoot = workspace }) {
  decimalId(runId); decimalId(artifactId); assertActionsOrigin(context, version)
  const artifact = await api.get(`actions/artifacts/${artifactId}`)
  assert.equal(String(artifact.id), artifactId)
  assertArtifactRecord(artifact, { runId, sourceCommit: context.sourceCommit, context })
  const sourceRun = await api.get(`actions/runs/${runId}`)
  const workflow = await api.get('actions/workflows/publish-product.yml')
  // Check basic API source admission before downloading any potentially large ZIP.
  assert.equal(sourceRun.head_sha, context.sourceCommit); assert.equal(sourceRun.path, PRODUCT_WORKFLOW)
  assert.equal(String(sourceRun.repository?.id), context.repositoryId); assert.equal(String(sourceRun.head_repository?.id), context.repositoryId)
  assert.equal(String(sourceRun.workflow_id), String(workflow.id))
  assert.ok(['push', 'workflow_dispatch'].includes(sourceRun.event), 'Untrusted source event')
  const prefix = `product-release-${version}-${context.sourceCommit}-${runId}-`
  assert.ok(artifact.name?.startsWith(prefix) && /^[1-9][0-9]*$/u.test(artifact.name.slice(prefix.length)), 'Unexpected source artifact name')
  const bytes = await api.download(artifactId)
  await extractProductArtifactZip(bytes, artifact.digest, destination, version)
  const receipt = await verifyProductArtifactPayload(destination, { version, sourceCommit: context.sourceCommit, sourceRoot })
  const jobs = await actionPages(api, `actions/runs/${runId}/attempts/${decimalId(receipt.actionsOrigin.runAttempt)}/jobs`, 'jobs')
  await verifyProductArtifactProvenance({ receipt, artifact, sourceRun, workflow, jobs, context, runId, artifactId })
  return { artifactId, runId, runAttempt: receipt.actionsOrigin.runAttempt, digest: artifact.digest,
    receiptSha256: sha256(await readFile(join(destination, 'release-receipt.json'))) }
}

export async function recordProductUploadedArtifact({ directory, artifactId, digest, context = productActionsContext(), api = productActionsApi(), sourceRoot = workspace }) {
  decimalId(artifactId); assert.match(digest ?? '', /^[a-f0-9]{64}$/u)
  const receipt = await json(join(directory, 'release-receipt.json'))
  await verifyProductArtifactPayload(directory, { sourceCommit: context.sourceCommit, version: receipt.version, sourceRoot })
  const { sourceCommit, ...origin } = context
  assert.deepEqual(receipt.actionsOrigin, origin)
  const artifact = await api.get(`actions/artifacts/${artifactId}`)
  assert.equal(String(artifact.id), artifactId)
  assertArtifactRecord(artifact, { runId: context.runId, sourceCommit, context })
  assert.equal(artifact.name, productArtifactName(receipt.version, sourceCommit, origin))
  assert.equal(artifact.digest, 'sha256:' + digest, 'Upload/server artifact digest differs')
  return { runId: context.runId, runAttempt: context.runAttempt, artifactId, digest: artifact.digest,
    receiptSha256: sha256(await readFile(join(directory, 'release-receipt.json'))) }
}

export function productOidcDiagnostics(env = process.env) {
  return { node: process.version, registry: REGISTRY,
    idTokenRequestUrlPresent: Boolean(env.ACTIONS_ID_TOKEN_REQUEST_URL),
    idTokenRequestTokenPresent: Boolean(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) }
}

async function writeActionOutputs(values) {
  if (process.env.GITHUB_OUTPUT) for (const [key, value] of Object.entries(values)) {
    assert.match(String(value), /^[a-zA-Z0-9:._-]+$/u, 'Safe scalar Actions output required')
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}
async function recordArtifactSummary(record) {
  assert.ok(process.env.GITHUB_STEP_SUMMARY, 'Artifact identity summary required before publication')
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `DSH original archives: run ${record.runId}, attempt ${record.runAttempt}, artifact ${record.artifactId}, digest ${record.digest}, receipt SHA256 ${record.receiptSha256}.\n`)
}
export function productRegistryStateDirectory(receiptFile, env = process.env) {
  if (!env.PRODUCT_REGISTRY_STATE_DIR) return dirname(receiptFile)
  assert.ok(isAbsolute(env.PRODUCT_REGISTRY_STATE_DIR), 'Absolute registry state directory required')
  const directory = resolve(env.PRODUCT_REGISTRY_STATE_DIR)
  outsideWorkspace(directory)
  assert.ok(directory !== dirname(receiptFile) && !directory.startsWith(dirname(receiptFile) + '/'), 'Registry state must be outside immutable payload')
  for (let cursor = directory; ; cursor = dirname(cursor)) {
    try { assert.ok(!lstatSync(cursor).isSymbolicLink(), 'Registry state symlink refused') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    if (cursor === dirname(cursor)) break
  }
  return directory
}
export async function readProductRegistryState(receiptFile, filename) {
  assert.ok(['preflight-registry.json', 'complete-registry.json'].includes(filename), 'Known DSH registry state required')
  if ((await json(receiptFile)).actionsOrigin) assert.ok(process.env.PRODUCT_REGISTRY_STATE_DIR, 'Sealed payload requires separate registry state')
  return json(await regularFile(filename, productRegistryStateDirectory(receiptFile)))
}

/** Required peers participate; the DSH aggregate follows internals, product is last. */
export function publicationOrder(entries, { internalOnly = false } = {}) {
  const sourceNames = internalOnly ? DSH_SOURCE_PACKAGES : RELEASE_SOURCE_PACKAGES
  assert.deepEqual(entries.map(x => x.sourceName).sort(), [...sourceNames].sort(), 'Exactly the complete product package set required')
  const byName = new Map(entries.map(x => [x.name, x]))
  assert.equal(byName.size, sourceNames.length)
  for (const entry of entries) {
    assert.equal(entry.name, packageNameFor(entry.sourceName))
    validateReleaseVersion(entry.version)
    assert.equal(entry.version, entries[0].version, 'DSH release versions must be uniform')
    assert.ok(Array.isArray(entry.dependencies) && new Set(entry.dependencies).size === entry.dependencies.length)
    for (const dependency of entry.dependencies) assert.ok(byName.has(dependency) && dependency !== entry.name, 'Unknown or self dependency')
  }
  const aggregate = '@yugoo-design/dsh-design-system-dsh'
  const pending = new Set(byName.keys()), ordered = []
  while (pending.size) {
    const next = [...pending].sort().find(name => (name !== PRODUCT_NAME || pending.size === 1)
      && (name !== aggregate || [...pending].every(value => value === aggregate || value === PRODUCT_NAME))
      && byName.get(name).dependencies.every(dep => !pending.has(dep)))
    assert.ok(next, 'Cyclic DSH publication graph')
    ordered.push(byName.get(next)); pending.delete(next)
  }
  return ordered
}

export async function verifyProductReceipt(receiptFile, { sourceCommit = git(['rev-parse', 'HEAD']) } = {}) {
  const receipt = await json(receiptFile)
  assert.equal(receipt.kind, 'yugoo-design-product-release')
  assert.equal(receipt.sourceCommit, sourceCommit, 'Prepared source commit changed')
  assert.equal(receipt.registry, REGISTRY)
  assert.equal(receipt.published, false)
  validateReleaseVersion(receipt.version)
  const ordered = publicationOrder(receipt.entries)
  assert.deepEqual(receipt.entries, ordered, 'Receipt publication order changed')
  for (const entry of ordered) {
    assert.equal(entry.version, receipt.version)
    assert.equal(entry.filename, archiveNameFor(entry.sourceName, entry.version))
    assert.equal(basename(entry.filename), entry.filename)
    const path = join(dirname(receiptFile), 'distribution/tarballs', entry.filename)
    assert.ok((await lstat(path)).isFile() && !(await lstat(path)).isSymbolicLink(), 'Regular prepared archive required')
    const bytes = await readFile(path)
    assert.equal(bytes.length, entry.bytes)
    assert.equal(sha256(bytes), entry.sha256, 'Prepared tarball changed')
    assert.equal(integrity(bytes), entry.integrity, 'Prepared integrity changed')
  }
  return receipt
}

/** Compare metadata AND downloaded bytes. No error except a version 404 means absent. */
export async function registryState(entry, options) {
  return compareRegistryArchive(entry, { ...options, allowPendingTarball: false })
}
async function compareRegistryArchive(entry, { fetchImpl = fetch, maxBytes = 128 * 1024 * 1024, allowPendingTarball = false, signal } = {}) {
  assert.ok(RELEASE_SOURCE_PACKAGES.includes(entry.sourceName))
  assert.equal(entry.name, packageNameFor(entry.sourceName))
  validateReleaseVersion(entry.version)
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u)
  const requestSignal = () => signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  const options = { redirect: 'error', credentials: 'omit', signal: requestSignal() }
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(entry.name)}/${entry.version}`, { ...options, headers: { accept: 'application/json' } })
  if (response.status === 404) return 'absent'
  assert.equal(response.status, 200, `Registry lookup failed for ${entry.name}: HTTP ${response.status}`)
  const data = await response.json()
  assert.equal(data.name, entry.name); assert.equal(data.version, entry.version)
  assert.equal(data.dist?.integrity, entry.integrity, `Published integrity differs: ${entry.name}@${entry.version}`)
  const url = new URL(data.dist.tarball)
  assert.equal(url.origin, REGISTRY, 'Official registry tarball required')
  assert.equal(url.username + url.password + url.search + url.hash, '', 'Unexpected tarball URL credentials/query/fragment')
  assert.equal(url.pathname, `/${entry.name}/-/${entry.name.split('/').at(-1)}-${entry.version}.tgz`, 'Unexpected registry tarball path')
  assert.ok(entry.bytes > 0 && entry.bytes <= maxBytes, 'Archive exceeds registry comparison bound')
  const tar = await fetchImpl(url.href, { ...options, signal: requestSignal() })
  // Only post-publication confirmation may wait after exact metadata/SRI matched.
  // Preflight, publication planning and completion still reject a tarball 404.
  if (tar.status === 404 && allowPendingTarball) {
    await tar.body?.cancel?.().catch(() => {})
    return 'pending'
  }
  assert.equal(tar.status, 200, `Registry tarball failed: HTTP ${tar.status}`)
  const hash = createHash('sha512'); let size = 0
  try {
    for await (const chunk of tar.body) {
      size += chunk.length
      assert.ok(size <= entry.bytes && size <= maxBytes, 'Registry tarball exceeds expected size')
      hash.update(chunk)
    }
  } finally { if (size > entry.bytes) await tar.body?.cancel?.().catch(() => {}) }
  assert.equal(size, entry.bytes, 'Published tarball size differs')
  assert.equal('sha512-' + hash.digest('base64'), entry.integrity, 'Actual published tarball integrity differs')
  return 'identical'
}

/** npm publish uses latest: an older missing archive must never move it backwards. */
export async function assertLatestPublicationAllowed(entry, { fetchImpl = fetch } = {}) {
  validateReleaseVersion(entry.version)
  assert.ok(RELEASE_SOURCE_PACKAGES.map(packageNameFor).includes(entry.name), 'Official product package required')
  const response = await fetchImpl(`${REGISTRY}/${encodeURIComponent(entry.name)}`, {
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' },
  })
  if (response.status === 404) return // Only an actual missing package permits first publication.
  assert.equal(response.status, 200, `Package history lookup failed: HTTP ${response.status}`)
  const metadata = await response.json()
  assert.equal(metadata.name, entry.name, 'Published package history identity changed')
  assert.ok(metadata.versions && typeof metadata.versions === 'object' && !Array.isArray(metadata.versions), 'Published versions required')
  const versions = Object.keys(metadata.versions)
  assert.ok(versions.length, 'Published versions required')
  // Loaded only at the publication boundary, after the frozen dependency install.
  const { default: semver } = await import('semver')
  for (const version of versions) {
    assert.equal(semver.valid(version), version, 'Canonical published version required')
    assert.equal(metadata.versions[version]?.name, entry.name)
    assert.equal(metadata.versions[version]?.version, version)
  }
  const tags = metadata['dist-tags']
  assert.ok(tags && typeof tags === 'object' && !Array.isArray(tags), 'Published dist-tags required')
  for (const value of Object.values(tags)) assert.ok(versions.includes(value), 'Published dist-tag version required')
  for (const version of versions.filter(version => semver.prerelease(version) === null)) {
    assert.ok(!semver.gt(version, entry.version), `Refusing latest downgrade: ${entry.name}@${version} is newer than missing ${entry.version}`)
  }
}

export async function preflight(entries, options) {
  publicationOrder(entries)
  const states = []
  for (const entry of entries) {
    const state = await registryState(entry, options)
    if (state === 'absent') await assertLatestPublicationAllowed(entry, options)
    states.push({ name: entry.name, version: entry.version, state })
  }
  return states // write only after all eleven succeed; no publication callback exists
}
export async function nextPublication(receipt, index, options) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < RELEASE_SOURCE_PACKAGES.length, 'DSH package index required')
  publicationOrder(receipt.entries)
  const entry = receipt.entries[index]
  const state = await registryState(entry, options)
  if (state === 'identical') return { action: 'skip', entry }
  for (const name of entry.dependencies) {
    assert.equal(await registryState(receipt.entries.find(x => x.name === name), options), 'identical', `Required dependency is not published: ${name}`)
  }
  await assertLatestPublicationAllowed(entry, options)
  return { action: 'publish', entry }
}
/** Read-only post-publish visibility: at most 15 minutes per package, not a new publish attempt.
 * npm scanning can outlast this budget. The existing Actions job budget also applies.
 * Only version 404 or an exact-metadata tarball 404 waits; every other failure propagates.
 */
export async function confirmPublication(entry, { timeoutMs = 15 * 60_000, pollIntervalMs = 15_000,
  now = () => performance.now(), wait = ms => delay(ms), ...options } = {}) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15 * 60_000, 'Confirmation budget must be within 15 minutes')
  assert.ok(Number.isInteger(pollIntervalMs) && pollIntervalMs > 0, 'Positive confirmation poll interval required')
  const deadline = now() + timeoutMs, budgetSignal = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, budgetSignal]) : budgetSignal
  while (now() < deadline) {
    const state = await compareRegistryArchive(entry, { ...options, allowPendingTarball: true, signal })
    const remaining = deadline - now()
    if (state === 'identical' && remaining >= 0) return
    if (remaining <= 0) break
    await wait(Math.min(pollIntervalMs, remaining))
  }
  assert.fail(`Published archive is not visible within ${timeoutMs}ms; stop without republishing: ${entry.name}@${entry.version}`)
}

export async function prepareProductArchive({ version, output, nativeArtifactRoot, npmCli }) {
  const { buildSameSourceCandidate, verifyStagedUiCandidateAssociations } = await import('./build-companion-npm-candidate.mjs')
  const build = await buildSameSourceCandidate({ ladybugDependency: '0.21.1', nativeGitArtifactRoot: nativeArtifactRoot,
    candidate: { fixture: false, scope: '@yugoo-design', packageName: PRODUCT_NAME, version, distribution: 'stable' } })
  const buildReportFile = join(build.root, 'build-report.json')
  assert.equal(build.sameSourceBuildCompleted, true, `Product same-source build failed: ${JSON.stringify({
    buildReportFile, buildCompleted: build.buildCompleted, error: build.error, snapshotError: build.snapshotError,
    failedSteps: build.steps?.filter(step => step.status === 'failed'),
    sourceStable: build.sourceStable, sourceDrift: build.sourceDrift,
  })}`)
  assert.equal(build.head, git(['rev-parse', 'HEAD']), 'Product builder source differs')
  const buildReportSha256 = sha256(await readFile(buildReportFile))
  const associations = await verifyStagedUiCandidateAssociations({ buildReportFile, buildReportSha256 })
  const manifest = await json(join(build.candidate, 'package.json'))
  validateProductManifest(manifest, version)
  const pack = args => {
    const result = spawnSync(process.execPath, [npmCli, 'pack', '--ignore-scripts', '--json', ...args],
      { cwd: build.candidate, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    if (result.error) throw result.error
    assert.equal(result.status, 0, 'Product pack failed')
    const records = JSON.parse(result.stdout); assert.equal(records.length, 1); return records[0]
  }
  const dry = pack(['--dry-run']); validatePackInventory(dry, build.candidateInputs, version)
  const packed = pack(['--pack-destination', output]); validatePackInventory(packed, build.candidateInputs, version)
  assert.deepEqual(packed.files, dry.files, 'Product pack inventory changed after dry-run')
  const archive = join(output, packed.filename), bytes = await readFile(archive)
  assert.equal(packed.size, bytes.length); assert.equal(packed.integrity, integrity(bytes))
  return { manifest, archive, bytes, buildEvidence: { buildReportSha256,
    candidateInventorySha256: build.candidateInventorySha256, associations,
    completeBundledInventoryVerified: false, installedHostAccepted: false } }
}

export async function prepareProductRelease({ version, output, npmCli }) {
  validateReleaseVersion(version)
  selectProductRelease({ product: await readProductRelease(workspace), expectedVersion: version })
  assert.ok(isAbsolute(output) && !resolve(output).startsWith(resolve(workspace) + '/') && resolve(output) !== resolve(workspace), 'Absolute external output required')
  assert.ok(isAbsolute(npmCli), 'Absolute npm CLI required')
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Clean tracked source required before preparation')
  const sourceCommit = git(['rev-parse', 'HEAD'])
  if (process.env.GITHUB_SHA) assert.equal(sourceCommit, process.env.GITHUB_SHA, 'Actions checkout differs from fixed source')
  await mkdir(output)
  const { acquireNativeInputs } = await import('./companion-release-native-donor.mjs')
  const native = await acquireNativeInputs({ workspace, destination: join(output, 'native-artifacts') })
  const nativeSource = await json(join(workspace, 'packages/git-native/SOURCE.json'))
  for (const item of nativeSource.artifacts) {
    const destination = join(workspace, 'packages/git-native', item.path)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(output, 'native-artifacts', item.path), destination, { force: false, errorOnExist: true })
  }
  const { readNpmCandidates } = await import('./release-npm-candidates.mjs')
  const { assembleDshDistribution, createDshDistributionManifest } = await import('./assemble-dsh-distribution.mjs')
  const report = await readNpmCandidates(workspace, { scope: '@yugoo-design', version, ladybugVersion: '0.21.1', ladybugSource: 'registry' })
  const manifests = Object.fromEntries(DSH_SOURCE_PACKAGES.map(name => [name, createDshDistributionManifest(report, name)]))
  assertDshPublicationMetadata(manifests, report.mapping)
  const graph = DSH_SOURCE_PACKAGES.map(sourceName => ({ sourceName, name: manifests[sourceName].name, version, dependencies: Object.keys({ ...manifests[sourceName].dependencies, ...manifests[sourceName].optionalDependencies, ...manifests[sourceName].peerDependencies }).filter(name => name.startsWith('@yugoo-design/')) }))
  const ordered = publicationOrder(graph, { internalOnly: true })
  const buildSteps = []
  for (const entry of ordered) {
    const directory = join(workspace, releasePackagesFor({ ladybugSource: 'registry' })[entry.sourceName])
    const manifest = await json(join(directory, 'package.json'))
    if (!manifest.scripts?.build) continue
    const result = spawnSync('pnpm', ['--dir', directory, 'run', 'build'], { cwd: workspace, stdio: 'inherit', env: { ...process.env, YUGOO_BUILD_MODULE_EVIDENCE_DIR: join(output, 'normal-build') } })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `Normal build failed: ${entry.sourceName}`)
    buildSteps.push(entry.sourceName)
  }
  const { observeDshBuild } = await import('./dsh-release-observations.mjs')
  const observationFile = join(output, 'material-observations.json')
  const observations = await observeDshBuild({ workspace, report, evidenceDirectory: join(output, 'normal-build'), sourceCommit })
  await writeFile(observationFile, JSON.stringify(observations, null, 2) + '\n', { flag: 'wx' })
  const distribution = await assembleDshDistribution({ source: workspace, destination: join(output, 'distribution'), npmCli, scope: '@yugoo-design', version, observationFile, observationSha256: sha256(await readFile(observationFile)) })
  const entries = []
  for (const entry of ordered) {
    const packed = distribution.archives.find(x => x.name === entry.name)
    const bytes = await readFile(packed.archive)
    entries.push({ ...entry, filename: basename(packed.archive), bytes: bytes.length, sha256: sha256(bytes), integrity: integrity(bytes) })
  }
  const product = await prepareProductArchive({ version, output: join(output, 'distribution/tarballs'),
    nativeArtifactRoot: join(output, 'native-artifacts'), npmCli })
  entries.push({ sourceName: PRODUCT_NAME, name: PRODUCT_NAME, version,
    dependencies: Object.keys({ ...product.manifest.dependencies, ...product.manifest.optionalDependencies, ...product.manifest.peerDependencies })
      .filter(name => name.startsWith('@yugoo-design/')),
    filename: basename(product.archive), bytes: product.bytes.length, sha256: sha256(product.bytes), integrity: integrity(product.bytes) })
  const completeEntries = publicationOrder(entries)
  assert.equal(git(['rev-parse', 'HEAD']), sourceCommit)
  assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Build changed tracked source')
  const receipt = { kind: 'yugoo-design-product-release', version, sourceCommit, registry: REGISTRY, nativeMaterials: native, buildSteps,
    observationSha256: sha256(await readFile(observationFile)), entries: completeEntries, productBuild: product.buildEvidence,
    published: false, installedHostAccepted: false, completeBundledInventoryVerified: false, releaseLicenseAcceptance: false }
  await writeFile(join(output, 'release-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' })
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, file, argument] = process.argv.slice(2)
    if (command === 'select') {
      assert.equal(file, undefined)
      const requireTag = process.env.REQUIRE_RELEASE_TAG ?? 'false'
      assert.ok(['true', 'false'].includes(requireTag))
      const selected = selectProductRelease({ product: await readProductRelease(workspace), expectedVersion: process.env.EXPECTED_RELEASE_VERSION, releaseRef: process.env.RELEASE_REF, requireTag: requireTag === 'true' })
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${selected.version}\n`)
      console.log(JSON.stringify(selected))
    } else if (command === 'route') {
      const context = productActionsContext()
      assert.equal(context.sourceCommit, git(['rev-parse', 'HEAD']))
      selectProductRelease({ product: await readProductRelease(workspace), expectedVersion: file,
        releaseRef: context.ref, requireTag: process.env.REQUIRE_RELEASE_TAG === 'true' })
      const route = await selectProductArtifactRoute({ version: file, context,
        resumeRunId: process.env.RESUME_RUN_ID ?? '', resumeArtifactId: process.env.RESUME_ARTIFACT_ID ?? '' })
      await writeActionOutputs(route); console.log(JSON.stringify(route))
    } else if (command === 'seal') {
      const result = await sealProductRelease(resolve(file), resolve(argument))
      await writeActionOutputs(result); console.log(JSON.stringify(result))
    } else if (command === 'restore') {
      const result = await restoreProductArtifact({ version: file, destination: resolve(argument),
        runId: process.env.SELECTED_RUN_ID, artifactId: process.env.SELECTED_ARTIFACT_ID })
      await recordArtifactSummary(result); console.log(JSON.stringify(result))
    } else if (command === 'uploaded') {
      const result = await recordProductUploadedArtifact({ directory: resolve(file), artifactId: process.env.UPLOADED_ARTIFACT_ID,
        digest: process.env.UPLOADED_ARTIFACT_DIGEST })
      await recordArtifactSummary(result); console.log(JSON.stringify(result))
    } else if (command === 'verify-artifact') {
      const context = productActionsContext()
      assert.equal(git(['rev-parse', 'HEAD']), context.sourceCommit, 'Fixed artifact checkout changed')
      assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '', 'Artifact checkout tracked source changed')
      const receipt = await json(join(resolve(file), 'release-receipt.json'))
      await verifyProductArtifactPayload(resolve(file), { sourceCommit: context.sourceCommit, version: receipt.version })
      console.log(JSON.stringify({ sourceCommit: receipt.sourceCommit, version: receipt.version, files: 14 }))
    } else if (command === 'diagnostics') {
      console.log(JSON.stringify(productOidcDiagnostics()))
    } else if (command === 'prepare') {
      const receipt = await prepareProductRelease({ version: file, output: resolve(argument), npmCli: process.env.NPM_CLI })
      console.log(JSON.stringify(receipt))
    } else {
      assert.ok(['preflight', 'next', 'confirm', 'complete'].includes(command), 'Unknown DSH release command; no local publish command')
      const receiptFile = resolve(file), receipt = await verifyProductReceipt(receiptFile)
      selectProductRelease({ product: await readProductRelease(workspace), expectedVersion: receipt.version, releaseRef: process.env.RELEASE_REF, requireTag: process.env.REQUIRE_RELEASE_TAG === 'true' })
      if (command === 'preflight' || command === 'complete') {
        if (receipt.actionsOrigin) assert.ok(process.env.PRODUCT_REGISTRY_STATE_DIR, 'Sealed payload requires separate registry state')
        const states = await preflight(receipt.entries)
        if (command === 'complete') assert.ok(states.every(x => x.state === 'identical'), 'Incomplete DSH publication')
        const stateDirectory = productRegistryStateDirectory(receiptFile); await mkdir(stateDirectory, { recursive: true })
        await writeFile(join(stateDirectory, `${command}-registry.json`), JSON.stringify({ sourceCommit: receipt.sourceCommit, states }, null, 2) + '\n', { flag: 'wx' })
        console.log(JSON.stringify(states))
      } else {
        const index = Number(argument)
        assert.match(argument ?? '', /^(?:[0-9]|10)$/u, 'Product package index from 0 through 10 required')
        if (command === 'confirm') await confirmPublication(receipt.entries[index])
        else {
          const checked = await readProductRegistryState(receiptFile, 'preflight-registry.json')
          assert.equal(checked.sourceCommit, receipt.sourceCommit)
          assert.deepEqual(checked.states.map(x => x.name), receipt.entries.map(x => x.name), 'Full preflight required')
          const next = await nextPublication(receipt, index)
          console.log(JSON.stringify({ action: next.action, tarball: join(dirname(receiptFile), 'distribution/tarballs', next.entry.filename) }))
        }
      }
    }
  } catch (error) { console.error(error); process.exitCode = 1 }
}
