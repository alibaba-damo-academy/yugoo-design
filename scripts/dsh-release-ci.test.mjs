import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import YAML from 'yaml'
import { DSH_SOURCE_PACKAGES, REGISTRY, REPOSITORY, integrity, sha256, selectDshRelease, assertDshPublicationMetadata, publicationOrder, registryState, preflight, nextPublication, confirmPublication, verifyDshReceipt } from './prepare-dsh-release.mjs'
import { readNpmCandidates } from './release-npm-candidates.mjs'
import { createDshDistributionManifest } from './assemble-dsh-distribution.mjs'
import { ARTIFACT_STEPS, DSH_WORKFLOW, dshActionsContext, dshArtifactName, dshArtifactPaths, sealDshRelease,
  verifyDshArtifactPayload, extractDshArtifactZip, selectDshArtifactRoute, verifyDshArtifactProvenance,
  restoreDshArtifact, recordDshUploadedArtifact, dshActionsApi, dshOidcDiagnostics, dshRegistryStateDirectory } from './prepare-dsh-release.mjs'

const version = JSON.parse(await readFile(new URL('../release/release-hosts.json', import.meta.url), 'utf8')).hosts.dsh.aggregateVersion
const bytes = Buffer.from('synthetic archive; no product/Host acceptance')
const entries = () => DSH_SOURCE_PACKAGES.map((sourceName, index) => ({ sourceName, name: '@yugoo-design/' + sourceName, version,
  filename: 'yugoo-design-' + sourceName + '-' + version + '.tgz', bytes: bytes.length, sha256: sha256(bytes), integrity: integrity(bytes),
  dependencies: index ? ['@yugoo-design/' + DSH_SOURCE_PACKAGES[index - 1]] : [] }))
const manifest = { schemaVersion: 1, hosts: { dsh: { aggregatePackage: '@yugoo-design/dsh-design-system-dsh', aggregateVersion: version, registry: REGISTRY } } }
test('all ten projected publication manifests preserve their public source repository and package directory', async () => {
  const workspace = fileURLToPath(new URL('../', import.meta.url))
  const report = await readNpmCandidates(workspace, { scope: '@yugoo-design', version, ladybugSource: 'registry', ladybugVersion: '0.21.1' })
  const before = structuredClone(report)
  const manifests = Object.fromEntries(DSH_SOURCE_PACKAGES.map(name => [name, createDshDistributionManifest(report, name)]))
  assertDshPublicationMetadata(manifests, report.mapping)
  assert.deepEqual(report, before)
  for (const name of DSH_SOURCE_PACKAGES) {
    const source = JSON.parse(await readFile(new URL(`../${report.mapping[name].directory}/package.json`, import.meta.url), 'utf8'))
    assert.deepEqual(manifests[name].repository, source.repository, 'Projection must preserve source-owned repository metadata')
    for (const repository of [undefined, null, source.repository.url,
      { ...source.repository, type: 'svn' },
      { ...source.repository, url: 'git+https://github.com/example/yugoo-design.git' },
      { ...source.repository, url: 'git+https://github.com/Alibaba-Damo-Academy/yugoo-design.git' },
      { ...source.repository, directory: 'packages/wrong' },
      { ...source.repository, directory: '../outside' },
    ]) {
      const bad = structuredClone(manifests)
      bad[name].repository = repository
      assert.throws(() => assertDshPublicationMetadata(bad, report.mapping), /repository metadata/, name)
    }
  }
  const missing = structuredClone(manifests)
  delete missing[DSH_SOURCE_PACKAGES[0]]
  assert.throws(() => assertDshPublicationMetadata(missing, report.mapping), /Exactly ten/)
  const changedIdentity = structuredClone(manifests)
  changedIdentity[DSH_SOURCE_PACKAGES[0]].name = '@other/wrong'
  assert.throws(() => assertDshPublicationMetadata(changedIdentity, report.mapping), /identity changed/)
})
function registry(states = new Map(), mutate = {}) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push(String(url)); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit')
    assert.ok(options.signal instanceof AbortSignal)
    const entry = entries().find(x => String(url).includes(encodeURIComponent(x.name)) || String(url).includes('/' + x.name + '/-/'))
    assert.ok(entry, String(url))
    if (String(url).endsWith('.tgz')) return { status: mutate.tarStatus ?? 200, body: (async function* () { yield mutate.bytes ?? bytes })() }
    const state = states.get(entry.name) ?? 'absent'
    if (state === 'error') throw Error('network failed')
    if (state === 'absent') return { status: 404 }
    return { status: mutate.status ?? 200, json: async () => ({ name: mutate.name ?? entry.name, version: mutate.version ?? version,
      dist: { integrity: mutate.integrity ?? entry.integrity, tarball: mutate.tarball ?? `${REGISTRY}/${entry.name}/-/${entry.sourceName}-${version}.tgz` } }) }
  }
  return { fetchImpl, calls }
}
test('DSH version comes only from the existing host manifest and exact DSH tag', () => {
  assert.deepEqual(selectDshRelease({ manifest }), { version })
  assert.deepEqual(selectDshRelease({ manifest, expectedVersion: version, releaseRef: `refs/tags/dsh-v${version}`, requireTag: true }), { version })
  for (const releaseRef of [undefined, 'refs/heads/main', `refs/tags/v${version}`, 'refs/tags/dsh-v0.1.0-beta.8', `refs/tags/dsh-v${version}\n`]) assert.throws(() => selectDshRelease({ manifest, releaseRef, requireTag: true }))
  for (const expectedVersion of ['latest', '0.1.0-beta.8', '$(id)', version + '\n']) assert.throws(() => selectDshRelease({ manifest, expectedVersion }))
  assert.throws(() => selectDshRelease({ manifest: { ...manifest, hosts: { dsh: { ...manifest.hosts.dsh, registry: 'https://example.invalid' } } } }))
})
test('all ten form a strict dependency DAG and aggregate is last', () => {
  assert.deepEqual(publicationOrder([...entries()].reverse()), entries())
  for (const rows of [entries().slice(1), [...entries(), entries()[0]], entries().map((x, i) => i ? x : { ...x, dependencies: [entries().at(-1).name] }), entries().map((x, i) => i ? x : { ...x, version: '0.1.0-beta.8' })]) assert.throws(() => publicationOrder(rows))
})
test('only 404 means absent; skip requires metadata AND actual tarball integrity', async () => {
  const entry = entries()[0]
  assert.equal(await registryState(entry, registry()), 'absent')
  const states = new Map([[entry.name, 'identical']])
  const normal = registry(states)
  assert.equal(await registryState(entry, normal), 'identical'); assert.equal(normal.calls.length, 2)
  for (const mutate of [{ status: 403 }, { status: 503 }, { name: '@other/a' }, { version: '0.1.0-beta.8' },
    { integrity: integrity(Buffer.from('other')) }, { bytes: Buffer.alloc(bytes.length) }, { bytes: Buffer.alloc(bytes.length - 1) },
    { bytes: Buffer.alloc(bytes.length + 1) }, { tarStatus: 404 }, { tarball: 'https://example.invalid/package.tgz' },
    { tarball: `${REGISTRY}/@yugoo-design/yugoo-design-git-native/-/other.tgz` },
    { tarball: `${REGISTRY}/${entry.name}/-/${entry.sourceName}-${version}.tgz?token=unexpected` }]) {
    await assert.rejects(registryState(entry, registry(states, mutate)))
  }
  await assert.rejects(registryState(entry, registry(new Map([[entry.name, 'error']]))), /network failed/)
})
test('partial publication preflights all ten before returning a plan', async () => {
  const rows = entries(), states = new Map(rows.slice(0, 4).map(x => [x.name, 'identical']))
  const normal = registry(states)
  const plan = await preflight(rows, normal)
  assert.equal(plan.filter(x => x.state === 'identical').length, 4)
  assert.equal(plan.filter(x => x.state === 'absent').length, 6)
  assert.equal(normal.calls.length, 14)
  states.set(rows[9].name, 'error')
  await assert.rejects(preflight(rows, registry(states)), /network failed/)
})
test('a dependent cannot publish until exact dependencies are visible; retries skip identical entries', async () => {
  const rows = entries(), receipt = { entries: rows }, states = new Map()
  await assert.rejects(nextPublication(receipt, 1, registry(states)), /Required dependency is not published/)
  assert.equal((await nextPublication(receipt, 0, registry(states))).action, 'publish')
  states.set(rows[0].name, 'identical')
  assert.equal((await nextPublication(receipt, 0, registry(states))).action, 'skip')
  assert.equal((await nextPublication(receipt, 1, registry(states))).action, 'publish')
  let waits = 0
  await confirmPublication(rows[1], { ...registry(states), wait: async () => { waits++; states.set(rows[1].name, 'identical') } })
  assert.equal(waits, 1)
  await assert.rejects(confirmPublication(rows[2], { ...registry(states), attempts: 2, wait: async () => {} }), /stop without republishing/)
})
test('archive receipt rejects changed source, bytes, paths or publication order', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ci-guard-')); t.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'distribution/tarballs'); await mkdir(folder, { recursive: true })
  const sourceCommit = 'a'.repeat(40), rows = entries()
  for (const entry of rows) await writeFile(join(folder, entry.filename), bytes)
  const receipt = { kind: 'dsh-same-source-release', sourceCommit, registry: REGISTRY, version, entries: rows, published: false }
  const file = join(root, 'release-receipt.json'); await writeFile(file, JSON.stringify(receipt))
  await verifyDshReceipt(file, { sourceCommit })
  await assert.rejects(verifyDshReceipt(file, { sourceCommit: 'b'.repeat(40) }), /source commit changed/)
  for (const bad of [{ ...receipt, entries: [...rows].reverse() }, { ...receipt, entries: rows.map((x, i) => i ? x : { ...x, filename: '../bad.tgz' }) }]) {
    await writeFile(file, JSON.stringify(bad)); await assert.rejects(verifyDshReceipt(file, { sourceCommit }))
  }
  await writeFile(file, JSON.stringify(receipt)); await writeFile(join(folder, rows[0].filename), Buffer.alloc(bytes.length))
  await assert.rejects(verifyDshReceipt(file, { sourceCommit }), /Prepared tarball changed/)
})
test('DSH workflow has independent triggers, fixed-source fences and GHA-only OIDC publication', async () => {
  const text = await readFile(new URL('../.github/workflows/publish-dsh.yml', import.meta.url), 'utf8')
  const flow = YAML.parse(text)
  assert.deepEqual(flow.on.push.tags, ['dsh-v*-beta.*'])
  assert.deepEqual(flow.permissions, { contents: 'read', actions: 'read' })
  assert.equal(flow.jobs.dryrun.permissions, undefined)
  assert.deepEqual(flow.jobs.publish.permissions, { contents: 'read', actions: 'read', 'id-token': 'write' })
  assert.match(flow.jobs.publish.if, new RegExp(REPOSITORY))
  for (const repository of [REPOSITORY, 'example/fork']) for (const ref of ['refs/heads/main', `refs/tags/dsh-v${version}`, `refs/tags/v${version}`, 'refs/tags/dsh-v999.0.0-beta.1']) {
    for (const event_name of ['push', 'workflow_dispatch', 'pull_request']) for (const publish of [undefined, false, true]) {
      const selected = Object.entries(flow.jobs).filter(([, job]) => new Function('github', 'inputs', 'startsWith', `return (${job.if})`)({ repository, ref, event_name }, { publish }, (value, prefix) => value.startsWith(prefix))).map(([id]) => id)
      const expected = repository !== REPOSITORY ? [] : event_name === 'workflow_dispatch'
        ? [publish && ref.startsWith('refs/tags/dsh-v') ? 'publish' : 'dryrun'] : event_name === 'push' && ref.startsWith('refs/tags/dsh-v') ? ['publish'] : []
      assert.deepEqual(selected, expected)
    }
  }
  assert.equal(flow.jobs.publish.steps, flow.jobs.dryrun.steps)
  const steps = flow.jobs.publish.steps
  const selector = steps.findIndex(x => x.id === 'release'), fence = steps.findIndex(x => x.run?.includes('merge-base --is-ancestor HEAD origin/main'))
  const install = steps.findIndex(x => x.run?.includes('pnpm install')), preflightStep = steps.findIndex(x => x.run?.includes('prepare-dsh-release.mjs preflight'))
  const publish = steps.findIndex(x => x.run?.includes('npm publish'))
  assert.ok(selector < fence && fence < install && install < preflightStep && preflightStep < publish)
  assert.match(steps[fence].run, /GITHUB_SHA/)
  assert.equal(steps[publish].if, "github.job == 'publish'")
  assert.match(steps[publish].run, /npm publish "\$tarball" --ignore-scripts --access public --tag beta --registry=https:\/\/registry.npmjs.org/)
  assert.match(steps[publish].run, /prepare-dsh-release.mjs next/)
  assert.match(steps[publish].run, /prepare-dsh-release.mjs confirm/)
  const prepare = steps.findIndex(x => x.name === ARTIFACT_STEPS.prepare)
  const seal = steps.findIndex(x => x.name === ARTIFACT_STEPS.seal)
  const upload = steps.findIndex(x => x.name === ARTIFACT_STEPS.upload)
  const record = steps.findIndex(x => x.run?.includes('prepare-dsh-release.mjs uploaded'))
  const restore = steps.findIndex(x => x.run?.includes('prepare-dsh-release.mjs restore'))
  assert.ok(prepare < seal && seal < upload && upload < record && record < preflightStep && preflightStep < publish)
  assert.ok(restore < install)
  for (const index of [prepare, seal, upload, record]) assert.equal(steps[index].if, "steps.route.outputs.mode == 'prepare'")
  assert.equal(steps[restore].if, "steps.route.outputs.mode == 'restore'")
  assert.equal(steps[upload].uses, 'actions/upload-artifact@v7.0.2')
  assert.equal(steps[upload].with['retention-days'], 7)
  assert.equal(steps[upload].with['compression-level'], 0)
  assert.equal(steps[upload].with['if-no-files-found'], 'error')
  assert.ok(!steps[upload].with.overwrite)
  assert.match(steps[record].env.UPLOADED_ARTIFACT_ID, /archive.outputs.artifact-id/)
  assert.match(steps[record].env.UPLOADED_ARTIFACT_DIGEST, /archive.outputs.artifact-digest/)
  assert.match(steps[publish].run, /prepare-dsh-release.mjs diagnostics/)
  assert.ok(flow.on.workflow_dispatch.inputs.resume_run_id && flow.on.workflow_dispatch.inputs.resume_artifact_id)
  assert.ok(steps.findIndex(x => x.run?.includes('DSH_REGISTRY_STATE_DIR=')) < preflightStep)
  assert.doesNotMatch(JSON.stringify(flow.jobs.publish.env), /runner\.temp/u)
  assert.doesNotMatch(text, /NODE_AUTH_TOKEN|NPM_TOKEN|dist-tag rm|unpublish|continue-on-error/)
  const companion = YAML.parse(await readFile(new URL('../.github/workflows/publish-companion.yml', import.meta.url), 'utf8'))
  assert.deepEqual(companion.on.push.tags, ['v*-beta.*'])
  assert.match(companion.jobs.publish.steps.find(x => x.run?.includes('npm publish')).run, /RELEASE_TARBALL/)
  const helper = await readFile(new URL('./prepare-dsh-release.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(helper, /spawnSync\([^\n]+['"]publish['"]|execFileSync\([^\n]+['"]publish['"]/)
})

const artifactContext = changes => ({ repository: REPOSITORY, repositoryId: '42', workflowPath: DSH_WORKFLOW,
  runId: '100', runAttempt: '1', ref: `refs/tags/dsh-v${version}`, eventName: 'push', job: 'publish', sourceCommit: 'a'.repeat(40), ...changes })
async function artifactFixture(t, context = artifactContext()) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-original-artifacts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const prepared = join(root, 'prepared'), payload = join(root, 'payload'), stage = join(root, 'stage')
  await mkdir(join(prepared, 'distribution/tarballs'), { recursive: true }); await mkdir(join(stage, 'package'), { recursive: true })
  const report = await readNpmCandidates(fileURLToPath(new URL('../', import.meta.url)),
    { scope: '@yugoo-design', version, ladybugSource: 'registry', ladybugVersion: '0.21.1' })
  const rows = []
  for (const sourceName of DSH_SOURCE_PACKAGES) {
    const manifest = createDshDistributionManifest(report, sourceName), name = manifest.name
    await writeFile(join(stage, 'package/package.json'), JSON.stringify(manifest))
    const filename = 'yugoo-design-' + sourceName + '-' + version + '.tgz'
    execFileSync('tar', ['-czf', join(prepared, 'distribution/tarballs', filename), '-C', stage, 'package/package.json'])
    const data = await readFile(join(prepared, 'distribution/tarballs', filename))
    rows.push({ sourceName, name, version, filename, bytes: data.length, sha256: sha256(data), integrity: integrity(data),
      dependencies: Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }).filter(name => name.startsWith('@yugoo-design/')) })
  }
  const observation = Buffer.from(JSON.stringify({ kind: 'dsh-current-normal-observations', sourceCommit: context.sourceCommit, packages: {} }))
  await writeFile(join(prepared, 'material-observations.json'), observation)
  const lockFile = join(root, 'public-lock.yaml'); await writeFile(lockFile, "lockfileVersion: '9.0'\n")
  await writeFile(join(prepared, 'release-receipt.json'), JSON.stringify({ kind: 'dsh-same-source-release', sourceCommit: context.sourceCommit,
    version, registry: REGISTRY, published: false, entries: publicationOrder(rows), observationSha256: sha256(observation) }))
  const sealed = await sealDshRelease(join(prepared, 'release-receipt.json'), payload, { context, lockFile })
  const receipt = JSON.parse(await readFile(join(payload, 'release-receipt.json')))
  return { root, prepared, payload, context, sealed, receipt }
}
function artifactZip(f, options = {}) {
  return execFileSync('python3', ['-c', String.raw`
import io, json, os, stat, sys, zipfile
root, paths, options = sys.argv[1], json.loads(sys.argv[2]), json.loads(sys.argv[3])
output = io.BytesIO()
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in paths:
        if path == options.get('omit'): continue
        if path == options.get('symlink'):
            info = zipfile.ZipInfo(path); info.create_system = 3; info.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(info, '../escape'); continue
        archive.write(os.path.join(root, path), path)
    if options.get('extra'): archive.writestr(options['extra'], 'unexpected')
    if options.get('duplicate'): archive.writestr(paths[0], 'duplicate')
sys.stdout.buffer.write(output.getvalue())
`, f.payload, JSON.stringify(dshArtifactPaths(version)), JSON.stringify(options)], { maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
function artifactProvenance(f, zip) {
  const origin = f.receipt.actionsOrigin, artifactId = '900'
  return { receipt: f.receipt, artifactId, runId: origin.runId, context: artifactContext({ runAttempt: '2' }),
    artifact: { id: 900, name: f.sealed.name, expired: false, expires_at: '2099-01-01T00:00:00Z',
      size_in_bytes: zip.length, digest: 'sha256:' + sha256(zip), workflow_run: { id: 100, repository_id: 42, head_repository_id: 42, head_sha: f.context.sourceCommit } },
    sourceRun: { id: 100, repository: { id: 42, full_name: REPOSITORY }, head_repository: { id: 42, full_name: REPOSITORY },
      path: DSH_WORKFLOW, workflow_id: 7, head_sha: f.context.sourceCommit, head_branch: 'dsh-v' + version, event: 'push', run_attempt: 2, conclusion: 'failure' },
    workflow: { id: 7, path: DSH_WORKFLOW }, jobs: [{ name: 'publish', head_sha: f.context.sourceCommit, status: 'completed', run_attempt: 1,
      steps: Object.values(ARTIFACT_STEPS).map(name => ({ name, conclusion: 'success' })), conclusion: 'failure' }] }
}

test('sealing retains exactly thirteen files, real archive metadata and unchanged raw bytes', async t => {
  const f = await artifactFixture(t)
  assert.equal(dshArtifactPaths(version).length, 13)
  assert.match(f.sealed.name, /-100-1$/u)
  assert.deepEqual(await verifyDshArtifactPayload(f.payload, { version, sourceCommit: f.context.sourceCommit }), f.receipt)
  for (const entry of f.receipt.entries) assert.deepEqual(await readFile(join(f.prepared, 'distribution/tarballs', entry.filename)), await readFile(join(f.payload, 'distribution/tarballs', entry.filename)))
  for (const path of ['material-observations.json', 'pnpm-lock.yaml', 'distribution/tarballs/' + f.receipt.entries[0].filename]) {
    const file = join(f.payload, path), original = await readFile(file)
    await writeFile(file, Buffer.concat([original, Buffer.from('changed')]))
    await assert.rejects(verifyDshArtifactPayload(f.payload, { version, sourceCommit: f.context.sourceCommit }))
    await writeFile(file, original)
  }
  await writeFile(join(f.payload, 'unexpected.txt'), 'extra')
  await assert.rejects(verifyDshArtifactPayload(f.payload, { version, sourceCommit: f.context.sourceCommit }), /thirteen/)
})

test('actual ZIP digest, whitelist, duplicate, symlink and complete-set checks run before admission', async t => {
  const f = await artifactFixture(t), zip = artifactZip(f)
  const destination = join(f.root, 'restored')
  await extractDshArtifactZip(zip, 'sha256:' + sha256(zip), destination, version)
  await verifyDshArtifactPayload(destination, { version, sourceCommit: f.context.sourceCommit })
  await assert.rejects(extractDshArtifactZip(zip, 'sha256:' + '0'.repeat(64), join(f.root, 'digest'), version), /digest differs/)
  const corrupt = zip.subarray(0, zip.length - 12)
  await assert.rejects(extractDshArtifactZip(corrupt, 'sha256:' + sha256(corrupt), join(f.root, 'corrupt'), version), /extraction refused/)
  const oversized = Buffer.from(zip)
  oversized.writeUInt32LE(0xffffffff, oversized.indexOf(Buffer.from('504b0102', 'hex')) + 24)
  await assert.rejects(extractDshArtifactZip(oversized, 'sha256:' + sha256(oversized), join(f.root, 'oversized'), version), /extraction refused/)
  let index = 0
  for (const options of [{ omit: 'pnpm-lock.yaml' }, { extra: '../escape' }, { extra: '/absolute' },
    { extra: 'node_modules/private' }, { duplicate: true }, { symlink: 'pnpm-lock.yaml' }]) {
    const unsafe = artifactZip(f, options)
    await assert.rejects(extractDshArtifactZip(unsafe, 'sha256:' + sha256(unsafe), join(f.root, 'unsafe-' + index++), version), /extraction refused/)
  }
})

test('provenance permits a partial-failed run but refuses wrong source, origin, attempt or unsuccessful seal/upload', async t => {
  const f = await artifactFixture(t), valid = artifactProvenance(f, artifactZip(f))
  await verifyDshArtifactProvenance(valid)
  const explicit = structuredClone(valid); explicit.context.runId = '200'; explicit.context.runAttempt = '1'
  await verifyDshArtifactProvenance(explicit)
  const main = structuredClone(explicit)
  Object.assign(main.receipt.actionsOrigin, { ref: 'refs/heads/main', eventName: 'workflow_dispatch', job: 'dryrun' })
  Object.assign(main.sourceRun, { head_branch: 'main', event: 'workflow_dispatch' }); main.jobs[0].name = 'dryrun'
  await verifyDshArtifactProvenance(main)
  for (const mutate of [
    x => { x.artifact.expired = true }, x => { x.artifact.expires_at = '2000-01-01T00:00:00Z' },
    x => { x.artifact.id = 901 }, x => { x.artifact.name += '-wrong' }, x => { x.artifact.digest = null },
    x => { x.artifact.workflow_run.head_repository_id = 43 }, x => { x.sourceRun.head_repository.id = 43 },
    x => { x.sourceRun.head_sha = 'b'.repeat(40) }, x => { x.sourceRun.path = '.github/workflows/other.yml' },
    x => { x.sourceRun.workflow_id = 8 }, x => { x.sourceRun.event = 'pull_request' },
    x => { x.sourceRun.head_branch = 'unreviewed' }, x => { x.receipt.actionsOrigin.ref = 'refs/heads/feature' },
    x => { x.receipt.actionsOrigin.runAttempt = '2' }, x => { x.jobs = [] },
    x => { x.jobs[0].run_attempt = 2 }, x => { x.jobs[0].status = 'in_progress' },
    x => { x.jobs[0].steps[0].conclusion = 'failure' }, x => { x.jobs[0].steps[1].conclusion = 'skipped' },
    x => { x.jobs[0].steps[2].conclusion = 'failure' }, x => { x.jobs[0].steps.pop() },
  ]) { const bad = structuredClone(valid); mutate(bad); await assert.rejects(verifyDshArtifactProvenance(bad)) }
})

test('route pairing and rerun uniqueness refuse silent rebuilds; fresh preparation requires all ten 404s', async t => {
  const f = await artifactFixture(t), valid = artifactProvenance(f, artifactZip(f))
  const api = { get: async () => ({ total_count: 1, artifacts: [valid.artifact] }) }
  assert.equal((await selectDshArtifactRoute({ version, context: valid.context, api })).mode, 'restore')
  for (const artifacts of [[], [valid.artifact, { ...valid.artifact, id: 901 }], [{ ...valid.artifact, expired: true }]]) {
    await assert.rejects(selectDshArtifactRoute({ version, context: valid.context, api: { get: async () => ({ total_count: artifacts.length, artifacts }) } }))
  }
  await assert.rejects(selectDshArtifactRoute({ version, context: f.context, api, resumeRunId: '100' }), /paired/)
  await assert.rejects(selectDshArtifactRoute({ version, context: f.context, api, resumeRunId: '001', resumeArtifactId: '900' }), /Canonical/)
  const explicit = await selectDshArtifactRoute({ version, context: artifactContext({ runId: '200' }), resumeRunId: '100', resumeArtifactId: '900', api: { get: async () => valid.artifact } })
  assert.equal(explicit.artifactId, '900')
  let calls = 0
  assert.equal((await selectDshArtifactRoute({ version, context: f.context, api, fetchImpl: async () => { calls++; return { status: 404 } } })).mode, 'prepare')
  assert.equal(calls, 10)
  for (const status of [200, 403, 500]) await assert.rejects(selectDshArtifactRoute({ version, context: f.context, api, fetchImpl: async () => ({ status }) }), /Fresh preparation/)
})

test('restore fetches fixed original archives and validates failed-run preparation without build or pack', async t => {
  const f = await artifactFixture(t), zip = artifactZip(f), valid = artifactProvenance(f, zip), calls = []
  const api = { get: async path => {
    calls.push(path)
    if (path === 'actions/artifacts/900') return valid.artifact
    if (path === 'actions/runs/100') return valid.sourceRun
    if (path === 'actions/workflows/publish-dsh.yml') return valid.workflow
    if (path === 'actions/runs/100/attempts/1/jobs?per_page=100&page=1') return { total_count: 1, jobs: valid.jobs }
    throw Error('Unexpected API path')
  }, download: async id => { assert.equal(id, '900'); return zip } }
  const destination = join(f.root, 'api-restored')
  const result = await restoreDshArtifact({ version, destination, runId: '100', artifactId: '900', context: valid.context, api })
  assert.equal(result.artifactId, '900'); assert.equal(result.digest, valid.artifact.digest)
  assert.equal(calls.length, 4)
  await assert.rejects(recordDshUploadedArtifact({ directory: f.payload, artifactId: '900', digest: '0'.repeat(64), context: f.context,
    api: { get: async () => valid.artifact } }), /digest differs/)
  assert.equal((await recordDshUploadedArtifact({ directory: f.payload, artifactId: '900', digest: sha256(zip), context: f.context,
    api: { get: async () => valid.artifact } })).artifactId, '900')
})

test('signed ZIP download never forwards the API credential, and diagnostics contain only booleans', async () => {
  const token = 'SYNTHETIC_SECRET_MUST_NOT_LEAK', zip = Buffer.from('zip fixture'), calls = []
  const api = dshActionsApi({ token, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (String(url).startsWith('https://api.github.com/')) return { status: 302, headers: new Map([['location', 'https://storage.example/artifact?signature=synthetic']]) }
    assert.equal(options.headers, undefined)
    return { status: 200, body: (async function* () { yield zip })() }
  } })
  assert.deepEqual(await api.download('900'), zip)
  assert.equal(calls[0].options.headers.authorization, 'Bearer ' + token)
  const diagnostics = dshOidcDiagnostics({ ACTIONS_ID_TOKEN_REQUEST_URL: token, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token })
  assert.equal(diagnostics.idTokenRequestUrlPresent, true); assert.equal(diagnostics.idTokenRequestTokenPresent, true)
  assert.ok(!JSON.stringify(diagnostics).includes(token))
  assert.throws(() => dshActionsContext({ GITHUB_ACTIONS: 'false' }))
  assert.equal(dshRegistryStateDirectory('/tmp/payload/release-receipt.json', { DSH_REGISTRY_STATE_DIR: '/tmp/registry' }), '/tmp/registry')
  for (const path of ['/tmp/payload', '/tmp/payload/nested', 'relative']) assert.throws(() =>
    dshRegistryStateDirectory('/tmp/payload/release-receipt.json', { DSH_REGISTRY_STATE_DIR: path }))
})

test('pre-install CLI selection and recovery imports use only Node builtins without node_modules', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-builtins-bootstrap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'release'))
  const pending = ['prepare-dsh-release.mjs'], copied = new Set()
  while (pending.length) {
    const file = pending.pop()
    if (copied.has(file)) continue; copied.add(file)
    const text = await readFile(new URL(file, import.meta.url), 'utf8')
    await writeFile(join(root, 'scripts', file), text)
    for (const match of text.matchAll(/^import[^\n]+from ['"]\.\/([^'"]+)['"]/gmu)) pending.push(match[1])
  }
  await writeFile(join(root, 'release/release-hosts.json'), await readFile(new URL('../release/release-hosts.json', import.meta.url)))
  const selected = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/prepare-dsh-release.mjs'), 'select'],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' }))
  assert.equal(selected.version, version)
  const loaded = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m=await import(${JSON.stringify(new URL('file://' + join(root, 'scripts/prepare-dsh-release.mjs')).href)});process.stdout.write([typeof m.selectDshArtifactRoute,typeof m.restoreDshArtifact].join(','))`],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' })
  assert.equal(loaded, 'function,function')
  await assert.rejects(readFile(join(root, 'node_modules/semver/package.json')), { code: 'ENOENT' })
  // Execute both recovery commands in the same dependency-free checkout. The
  // network boundary is a synthetic GitHub API; ZIP/tar bytes and CLI are real.
  const report = await readNpmCandidates(fileURLToPath(new URL('../', import.meta.url)),
    { scope: '@yugoo-design', version, ladybugSource: 'registry', ladybugVersion: '0.21.1' })
  for (const item of Object.values(report.mapping)) {
    await mkdir(join(root, item.directory), { recursive: true })
    await writeFile(join(root, item.directory, 'package.json'), await readFile(new URL('../' + item.directory + '/package.json', import.meta.url)))
  }
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, 'add', '.'])
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic bootstrap source'])
  const sourceCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const f = await artifactFixture(t, artifactContext({ sourceCommit })), zip = artifactZip(f), valid = artifactProvenance(f, zip)
  await writeFile(join(root, 'original.zip'), zip)
  await writeFile(join(root, 'api.json'), JSON.stringify({ ...valid, payload: f.payload }))
  const stub = join(root, 'api.mjs')
  await writeFile(stub, `import fs from 'node:fs';const v=JSON.parse(fs.readFileSync(new URL('./api.json',import.meta.url)));globalThis.fetch=async url=>{
    const path=new URL(url).pathname+new URL(url).search;
    if(new URL(url).origin==='https://registry.npmjs.org'){
      const decoded=decodeURIComponent(path);
      const entry=v.receipt.entries.find(x=>[ '/'+x.name, '/'+x.name+'/'+x.version,
        '/'+x.name+'/-/'+x.sourceName+'-'+x.version+'.tgz' ].includes(decoded));
      if(!entry)throw Error('Unexpected synthetic registry package');
      if(path.endsWith('.tgz'))return new Response(fs.readFileSync(v.payload+'/distribution/tarballs/'+entry.filename));
      const published={name:entry.name,version:entry.version,dist:{integrity:entry.integrity,tarball:'https://registry.npmjs.org/'+entry.name+'/-/'+entry.sourceName+'-'+entry.version+'.tgz'}};
      return new Response(JSON.stringify(path.endsWith('/'+entry.version)?published:{name:entry.name,versions:{[entry.version]:published},'dist-tags':{latest:entry.version,beta:entry.version}}));
    }
    if(String(url).startsWith('https://storage.example/')) return new Response(fs.readFileSync(new URL('./original.zip',import.meta.url)));
    if(path.endsWith('/actions/artifacts/900/zip')) return new Response(null,{status:302,headers:{location:'https://storage.example/artifact'}});
    let data;
    if(path.endsWith('/actions/artifacts/900')) data=v.artifact;
    else if(path.endsWith('/actions/runs/100')) data=v.sourceRun;
    else if(path.endsWith('/actions/workflows/publish-dsh.yml')) data=v.workflow;
    else if(path.endsWith('/actions/runs/100/artifacts?per_page=100&page=1')) data={total_count:1,artifacts:[v.artifact]};
    else if(path.endsWith('/actions/runs/100/attempts/1/jobs?per_page=100&page=1')) data={total_count:1,jobs:v.jobs};
    else throw Error('Unexpected synthetic API request');
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  };`)
  const env = { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: '42',
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/${DSH_WORKFLOW}@refs/tags/dsh-v${version}`, GITHUB_SHA: sourceCommit,
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2', GITHUB_REF: `refs/tags/dsh-v${version}`, GITHUB_EVENT_NAME: 'push',
    GITHUB_JOB: 'publish', GITHUB_TOKEN: 'synthetic-only', REQUIRE_RELEASE_TAG: 'true', RELEASE_REF: `refs/tags/dsh-v${version}`,
    GITHUB_OUTPUT: join(root, 'outputs'), GITHUB_STEP_SUMMARY: join(root, 'summary'), SELECTED_RUN_ID: '100', SELECTED_ARTIFACT_ID: '900' }
  const cli = join(root, 'scripts/prepare-dsh-release.mjs')
  const route = JSON.parse(execFileSync(process.execPath, ['--import', stub, cli, 'route', version], { env, encoding: 'utf8' }))
  assert.equal(route.mode, 'restore')
  const restored = JSON.parse(execFileSync(process.execPath, ['--import', stub, cli, 'restore', version, join(f.root, 'bootstrap-restored')], { env, encoding: 'utf8' }))
  assert.equal(restored.artifactId, '900'); assert.match(await readFile(join(root, 'summary'), 'utf8'), /attempt 1, artifact 900/)
  const verified = JSON.parse(execFileSync(process.execPath, [cli, 'verify-artifact', join(f.root, 'bootstrap-restored')], { env, encoding: 'utf8' }))
  assert.equal(verified.files, 13)
  await assert.rejects(readFile(join(root, 'node_modules/semver/package.json')), { code: 'ENOENT' })
  const receiptFile = join(f.root, 'bootstrap-restored/release-receipt.json'), state = join(f.root, 'registry-results')
  const completed = JSON.parse(execFileSync(process.execPath, ['--import', stub, cli, 'complete', receiptFile],
    { env: { ...env, DSH_REGISTRY_STATE_DIR: state }, encoding: 'utf8' }))
  assert.equal(completed.length, 10); assert.ok(completed.every(x => x.state === 'identical'))
  await assert.rejects(readFile(join(f.root, 'bootstrap-restored/complete-registry.json')), { code: 'ENOENT' })
  await writeFile(join(root, 'scripts/npm-release-tags.mjs'), await readFile(new URL('./npm-release-tags.mjs', import.meta.url)))
  await mkdir(join(root, 'node_modules'))
  await symlink(fileURLToPath(new URL('../node_modules/semver', import.meta.url)), join(root, 'node_modules/semver'), 'dir')
  const npmCli = join(root, 'synthetic-npm-cli.cjs')
  await writeFile(npmCli, '// Never executed: planner reads semver from this dependency tree.\n')
  const tagEnv = { ...env, DSH_REGISTRY_STATE_DIR: state, RELEASE_CHAIN: 'dsh', RELEASE_VERSION: version,
    RELEASE_RECEIPT: receiptFile, NPM_CLI: npmCli }
  const tagCli = join(root, 'scripts/npm-release-tags.mjs')
  const plan = JSON.parse(execFileSync(process.execPath, ['--import', stub, tagCli, 'plan', '0'], { env: tagEnv, encoding: 'utf8' }))
  assert.equal(plan.action, 'skip'); assert.equal(plan.releaseVersion, version)
  const directoryLink = join(f.root, 'state-link'); await symlink(state, directoryLink, 'dir')
  assert.throws(() => dshRegistryStateDirectory(receiptFile, { DSH_REGISTRY_STATE_DIR: directoryLink }), /symlink/)
  assert.throws(() => dshRegistryStateDirectory(receiptFile, { DSH_REGISTRY_STATE_DIR: join(directoryLink, 'child') }), /symlink/)
  const completeFile = join(state, 'complete-registry.json'), retained = join(f.root, 'retained-complete.json')
  await writeFile(retained, await readFile(completeFile)); await rm(completeFile); await symlink(retained, completeFile)
  const rejected = (() => { try { execFileSync(process.execPath, ['--import', stub, tagCli, 'plan', '0'], { env: tagEnv, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (error) { return error } })()
  assert.equal(rejected.status, 1); assert.match(rejected.stderr.toString(), /symlink refused/)
})
