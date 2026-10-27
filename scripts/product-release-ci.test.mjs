import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import YAML from 'yaml'
import { DSH_SOURCE_PACKAGES, RELEASE_SOURCE_PACKAGES, packageNameFor, archiveNameFor, REGISTRY, REPOSITORY, integrity, sha256, selectProductRelease, assertDshPublicationMetadata, publicationOrder, registryState, assertLatestPublicationAllowed, preflight, nextPublication, confirmPublication, verifyProductReceipt } from './prepare-product-release.mjs'
import { readNpmCandidates } from './release-npm-candidates.mjs'
import { createDshDistributionManifest } from './assemble-dsh-distribution.mjs'
import { PRODUCT_NAME, productReleaseHosts, validateReleaseVersion } from './product-release.mjs'
import { ARTIFACT_STEPS, PRODUCT_WORKFLOW, productActionsContext, productArtifactName, productArtifactPaths, sealProductRelease,
  verifyProductArtifactPayload, extractProductArtifactZip, selectProductArtifactRoute, verifyProductArtifactProvenance,
  restoreProductArtifact, recordProductUploadedArtifact, productActionsApi, productOidcDiagnostics, productRegistryStateDirectory } from './prepare-product-release.mjs'

const product = JSON.parse(await readFile(new URL('../release/product.json', import.meta.url), 'utf8')), version = product.version
const bytes = Buffer.from('synthetic archive; no product/Host acceptance')
const entries = () => RELEASE_SOURCE_PACKAGES.map((sourceName, index) => ({ sourceName, name: packageNameFor(sourceName), version,
  filename: archiveNameFor(sourceName, version), bytes: bytes.length, sha256: sha256(bytes), integrity: integrity(bytes),
  dependencies: index ? [packageNameFor(RELEASE_SOURCE_PACKAGES[index - 1])] : [] }))
const manifest = product
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
    const path = decodeURIComponent(new URL(url).pathname)
    const entry = entries().find(x => ['/' + x.name, '/' + x.name + '/' + x.version, '/' + x.name + '/-/' + x.sourceName + '-' + x.version + '.tgz'].includes(path))
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
test('product version comes only from product.json and exact formal tag', () => {
  assert.deepEqual(selectProductRelease({ product: manifest }), { version })
  assert.deepEqual(selectProductRelease({ product: manifest, expectedVersion: version, releaseRef: `refs/tags/v${version}`, requireTag: true }), { version })
  for (const releaseRef of [undefined, 'refs/heads/main', `refs/tags/dsh-v${version}`, 'refs/tags/v0.1.0-beta.8', `refs/tags/v${version}\n`]) assert.throws(() => selectProductRelease({ product: manifest, releaseRef, requireTag: true }))
  for (const expectedVersion of ['latest', '0.1.0-beta.8', '$(id)', version + '\n']) assert.throws(() => selectProductRelease({ product: manifest, expectedVersion }))
  assert.throws(() => selectProductRelease({ product: { ...manifest, extra: true } }))
  for (const value of ['0.1.0-beta.1','01.0.0','0.1.0+build','v0.1.0']) assert.throws(()=>validateReleaseVersion(value))
})
test('all eleven form a strict dependency DAG and product is last', () => {
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
test('partial publication preflights all eleven before returning a plan', async () => {
  const rows = entries(), states = new Map(rows.slice(0, 4).map(x => [x.name, 'identical']))
  const normal = registry(states)
  const plan = await preflight(rows, normal)
  assert.equal(plan.filter(x => x.state === 'identical').length, 4)
  assert.equal(plan.filter(x => x.state === 'absent').length, 7)
  assert.equal(normal.calls.length, 22)
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
function packageHistory(entry, versions, latest = versions.at(-1)) {
  return { name: entry.name, versions: Object.fromEntries(versions.map(version => [version, { name: entry.name, version }])),
    'dist-tags': latest === undefined ? {} : { latest } }
}
function historyRegistry(base, historyFor) {
  return { fetchImpl: async (url, options) => {
    const entry = entries().find(entry => String(url) === `${REGISTRY}/${encodeURIComponent(entry.name)}`)
    if (!entry) return base.fetchImpl(url, options)
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.ok(options.signal instanceof AbortSignal)
    return historyFor(entry)
  } }
}
test('old partial recovery refuses a missing archive before any publication when a higher stable exists', async () => {
  const rows = entries(), states = new Map(rows.slice(0, -1).map(entry => [entry.name, 'identical']))
  for (const newer of ['0.1.1', '0.2.0', '0.10.0', '1.0.0']) {
    const productEntry = rows.at(-1)
    const options = historyRegistry(registry(states), entry => ({ status: 200, json: async () => packageHistory(entry, [newer]) }))
    await assert.rejects(preflight(rows, options), /Refusing latest downgrade/)
    await assert.rejects(nextPublication({ entries: rows }, 10, options), /Refusing latest downgrade/)
    assert.equal((await nextPublication({ entries: rows }, 0, options)).action, 'skip', 'Identical original bytes need no publication')
    // A newer stable is unsafe even if the current latest still points at an older version.
    await assert.rejects(assertLatestPublicationAllowed(productEntry, { fetchImpl: async () => ({ status: 200,
      json: async () => packageHistory(productEntry, ['0.0.1', newer], '0.0.1') }) }), /Refusing latest downgrade/)
  }
})
test('publish plan rechecks history after preflight; first stable and identical SRI recovery remain allowed', async () => {
  const rows = entries(), states = new Map(rows.slice(1).map(entry => [entry.name, 'identical']))
  let newer = false, reads = 0
  const options = historyRegistry(registry(states), entry => { reads++; return { status: 200,
    json: async () => packageHistory(entry, newer ? ['0.2.0'] : ['0.0.1', '1.0.0-rc.1']) } })
  assert.equal((await preflight(rows, options))[0].state, 'absent')
  assert.equal((await nextPublication({ entries: rows }, 0, options)).action, 'publish')
  newer = true
  await assert.rejects(nextPublication({ entries: rows }, 0, options), /Refusing latest downgrade/)
  assert.equal(reads, 3)
  states.set(rows[0].name, 'identical')
  assert.ok((await preflight(rows, options)).every(row => row.state === 'identical'))
  assert.equal((await nextPublication({ entries: rows }, 0, options)).action, 'skip')
  assert.equal(reads, 3, 'Existing identical archives do not republish or change latest')
  assert.ok((await preflight(rows, registry())).every(row => row.state === 'absent'), 'Actual package 404 permits first publication')
  assert.equal((await nextPublication({ entries: rows }, 0, registry())).action, 'publish')
})
test('package history failures and malformed metadata never authorize missing archive publication', async () => {
  const entry = entries()[0]
  for (const status of [204, 301, 401, 403, 429, 500]) await assert.rejects(assertLatestPublicationAllowed(entry,
    { fetchImpl: async () => ({ status }) }), /Package history lookup failed/)
  await assert.rejects(assertLatestPublicationAllowed(entry, { fetchImpl: async () => { throw Error('history network failure') } }), /history network failure/)
  await assert.rejects(assertLatestPublicationAllowed(entry, { fetchImpl: async () => ({ status: 200, json: async () => { throw Error('invalid history JSON') } }) }), /invalid history JSON/)
  const valid = packageHistory(entry, ['0.0.1'])
  for (const changed of [{ name: 'other' }, { versions: [] }, { versions: {} }, { versions: { latest: { name: entry.name, version: 'latest' } } },
    { versions: { '0.0.1': { name: 'other', version: '0.0.1' } } }, { 'dist-tags': [] }, { 'dist-tags': { latest: '0.2.0' } }]) {
    await assert.rejects(assertLatestPublicationAllowed(entry, { fetchImpl: async () => ({ status: 200, json: async () => ({ ...valid, ...changed }) }) }))
  }
  const options = historyRegistry(registry(), () => ({ status: 503 }))
  await assert.rejects(preflight(entries(), options), /Package history lookup failed/)
  await assert.rejects(nextPublication({ entries: entries() }, 0, options), /Package history lookup failed/)
})

test('archive receipt rejects changed source, bytes, paths or publication order', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ci-guard-')); t.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'distribution/tarballs'); await mkdir(folder, { recursive: true })
  const sourceCommit = 'a'.repeat(40), rows = entries()
  for (const entry of rows) await writeFile(join(folder, entry.filename), bytes)
  const receipt = { kind: 'yugoo-design-product-release', sourceCommit, registry: REGISTRY, version, entries: rows, published: false }
  const file = join(root, 'release-receipt.json'); await writeFile(file, JSON.stringify(receipt))
  await verifyProductReceipt(file, { sourceCommit })
  await assert.rejects(verifyProductReceipt(file, { sourceCommit: 'b'.repeat(40) }), /source commit changed/)
  for (const bad of [{ ...receipt, entries: [...rows].reverse() }, { ...receipt, entries: rows.map((x, i) => i ? x : { ...x, filename: '../bad.tgz' }) }]) {
    await writeFile(file, JSON.stringify(bad)); await assert.rejects(verifyProductReceipt(file, { sourceCommit }))
  }
  await writeFile(file, JSON.stringify(receipt)); await writeFile(join(folder, rows[0].filename), Buffer.alloc(bytes.length))
  await assert.rejects(verifyProductReceipt(file, { sourceCommit }), /Prepared tarball changed/)
})
test('product workflow has unified triggers, fixed-source fences and GHA-only OIDC publication', async t => {
  const text = await readFile(new URL('../.github/workflows/publish-product.yml', import.meta.url), 'utf8')
  const flow = YAML.parse(text)
  assert.deepEqual(flow.on.push.tags, ['v[0-9]+.[0-9]+.[0-9]+'])
  assert.deepEqual(flow.permissions, { contents: 'read', actions: 'read' })
  assert.equal(flow.jobs.dryrun.permissions, undefined)
  assert.deepEqual(flow.jobs.publish.permissions, { contents: 'read', actions: 'read', 'id-token': 'write' })
  assert.match(flow.jobs.publish.if, new RegExp(REPOSITORY))
  for (const repository of [REPOSITORY, 'example/fork']) for (const ref of ['refs/heads/main', `refs/tags/v${version}`, `refs/tags/v${version}`, 'refs/tags/v999.0.0-beta.1']) {
    for (const event_name of ['push', 'workflow_dispatch', 'pull_request']) for (const publish of [undefined, false, true]) {
      const selected = Object.entries(flow.jobs).filter(([, job]) => new Function('github', 'inputs', 'startsWith', `return (${job.if})`)({ repository, ref, event_name }, { publish }, (value, prefix) => value.startsWith(prefix))).map(([id]) => id)
      const expected = repository !== REPOSITORY ? [] : event_name === 'workflow_dispatch'
        ? [publish && ref.startsWith('refs/tags/v') ? 'publish' : 'dryrun'] : event_name === 'push' && ref.startsWith('refs/tags/v') ? ['publish'] : []
      assert.deepEqual(selected, expected)
    }
  }
  assert.equal(flow.jobs.publish.steps, flow.jobs.dryrun.steps)
  const environmentStep = flow.jobs.publish.steps.find(step => step.name === 'Keep current registry results outside the immutable payload')
  const environmentRoot = await mkdtemp(join(tmpdir(), 'product-workflow-env-'))
  t.after(() => rm(environmentRoot, { recursive: true, force: true }))
  const environmentFile = join(environmentRoot, 'github-env')
  execFileSync('bash', ['-e', '-c', environmentStep.run], { env: { ...process.env, RUNNER_TEMP: environmentRoot, GITHUB_ENV: environmentFile } })
  assert.equal(await readFile(environmentFile, 'utf8'), `PRODUCT_REGISTRY_STATE_DIR=${environmentRoot}/product-registry\n`)
  const steps = flow.jobs.publish.steps
  const selector = steps.findIndex(x => x.id === 'release'), fence = steps.findIndex(x => x.run?.includes('merge-base --is-ancestor HEAD origin/main'))
  const install = steps.findIndex(x => x.run?.includes('pnpm install')), preflightStep = steps.findIndex(x => x.run?.includes('prepare-product-release.mjs preflight'))
  const publish = steps.findIndex(x => x.run?.includes('npm publish'))
  assert.ok(selector < fence && fence < install && install < preflightStep && preflightStep < publish)
  assert.match(steps[fence].run, /GITHUB_SHA/)
  assert.equal(steps[publish].if, "github.job == 'publish'")
  assert.match(steps[publish].run, /npm publish "\$tarball" --ignore-scripts --access public --tag latest --registry=https:\/\/registry.npmjs.org/)
  assert.match(steps[publish].run, /prepare-product-release.mjs next/)
  assert.match(steps[publish].run, /prepare-product-release.mjs confirm/)
  const prepare = steps.findIndex(x => x.name === ARTIFACT_STEPS.prepare)
  const seal = steps.findIndex(x => x.name === ARTIFACT_STEPS.seal)
  const upload = steps.findIndex(x => x.name === ARTIFACT_STEPS.upload)
  const record = steps.findIndex(x => x.run?.includes('prepare-product-release.mjs uploaded'))
  const restore = steps.findIndex(x => x.run?.includes('prepare-product-release.mjs restore'))
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
  assert.match(steps[publish].run, /prepare-product-release.mjs diagnostics/)
  assert.ok(flow.on.workflow_dispatch.inputs.resume_run_id && flow.on.workflow_dispatch.inputs.resume_artifact_id)
  assert.ok(steps.findIndex(x => x.run?.includes('PRODUCT_REGISTRY_STATE_DIR=')) < preflightStep)
  assert.doesNotMatch(JSON.stringify(flow.jobs.publish.env), /runner\.temp/u)
  assert.doesNotMatch(text, /NODE_AUTH_TOKEN|NPM_TOKEN|dist-tag rm|unpublish|continue-on-error/)
  for(const file of ['publish-companion.yml','publish-dsh.yml']) await assert.rejects(readFile(new URL('../.github/workflows/'+file,import.meta.url)),{code:'ENOENT'})
  const helper = await readFile(new URL('./prepare-product-release.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(helper, /spawnSync\([^\n]+['"]publish['"]|execFileSync\([^\n]+['"]publish['"]/)
})

const artifactContext = changes => ({ repository: REPOSITORY, repositoryId: '42', workflowPath: PRODUCT_WORKFLOW,
  runId: '100', runAttempt: '1', ref: `refs/tags/v${version}`, eventName: 'push', job: 'publish', sourceCommit: 'a'.repeat(40), ...changes })
const sourceHosts={schemaVersion:1,hosts:{dsh:{aggregatePackage:'@yugoo-design/dsh-design-system-dsh',registry:REGISTRY}}}
const productManifest=()=>({name:PRODUCT_NAME,version,license:'Apache-2.0',type:'module',
 repository:{type:'git',url:'git+https://github.com/'+REPOSITORY+'.git'},
 bin:{[PRODUCT_NAME]:'bin/yugoo-design.mjs'},publishConfig:{access:'public',tag:'latest'},engines:{node:'>=22.19.0'},dependencies:{'@ladybugdb/wasm-core':'0.21.1'}})
async function artifactFixture(t, context=artifactContext()) {
 const root=await mkdtemp(join(tmpdir(),'product-original-artifacts-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const prepared=join(root,'prepared'),payload=join(root,'payload'),stage=join(root,'stage'),sourceRoot=join(root,'source');
 await mkdir(join(prepared,'distribution/tarballs'),{recursive:true});await mkdir(join(stage,'package'),{recursive:true});await mkdir(join(sourceRoot,'release'),{recursive:true});
 await writeFile(join(sourceRoot,'release/product.json'),JSON.stringify(product));await writeFile(join(sourceRoot,'release/release-hosts.json'),JSON.stringify(sourceHosts));
 const report=await readNpmCandidates(fileURLToPath(new URL('../',import.meta.url)),{scope:'@yugoo-design',version,ladybugSource:'registry',ladybugVersion:'0.21.1'});
 for(const item of Object.values(report.mapping)){
  await mkdir(join(sourceRoot,item.directory),{recursive:true});await writeFile(join(sourceRoot,item.directory,'package.json'),await readFile(new URL('../'+item.directory+'/package.json',import.meta.url)));
 }
 const rows=[];
 for(const sourceName of RELEASE_SOURCE_PACKAGES){
  const manifest=sourceName===PRODUCT_NAME?productManifest():createDshDistributionManifest(report,sourceName),name=manifest.name;
  await writeFile(join(stage,'package/package.json'),JSON.stringify(manifest));
  const members=['package/package.json'];if(sourceName===PRODUCT_NAME){await writeFile(join(stage,'package/release-hosts.json'),JSON.stringify(productReleaseHosts(product,sourceHosts)));members.push('package/release-hosts.json');}
  const filename=archiveNameFor(sourceName,version);execFileSync('tar',['-czf',join(prepared,'distribution/tarballs',filename),'-C',stage,...members]);
  const data=await readFile(join(prepared,'distribution/tarballs',filename));rows.push({sourceName,name,version,filename,bytes:data.length,sha256:sha256(data),integrity:integrity(data),dependencies:Object.keys({...manifest.dependencies,...manifest.optionalDependencies,...manifest.peerDependencies}).filter(name=>name.startsWith('@yugoo-design/'))});
 }
 const observation=Buffer.from(JSON.stringify({kind:'dsh-current-normal-observations',sourceCommit:context.sourceCommit,packages:{}}));await writeFile(join(prepared,'material-observations.json'),observation);
 const lockFile=join(root,'public-lock.yaml');await writeFile(lockFile,"lockfileVersion: '9.0'\n");
 await writeFile(join(prepared,'release-receipt.json'),JSON.stringify({kind:'yugoo-design-product-release',sourceCommit:context.sourceCommit,version,registry:REGISTRY,published:false,entries:publicationOrder(rows),observationSha256:sha256(observation)}));
 const sealed=await sealProductRelease(join(prepared,'release-receipt.json'),payload,{context,lockFile,sourceRoot});const receipt=JSON.parse(await readFile(join(payload,'release-receipt.json')));
 return {root,prepared,payload,context,sealed,receipt,sourceRoot};
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
`, f.payload, JSON.stringify(productArtifactPaths(version)), JSON.stringify(options)], { maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}
function artifactProvenance(f, zip) {
  const origin = f.receipt.actionsOrigin, artifactId = '900'
  return { receipt: f.receipt, artifactId, runId: origin.runId, context: artifactContext({ runAttempt: '2' }),
    artifact: { id: 900, name: f.sealed.name, expired: false, expires_at: '2099-01-01T00:00:00Z',
      size_in_bytes: zip.length, digest: 'sha256:' + sha256(zip), workflow_run: { id: 100, repository_id: 42, head_repository_id: 42, head_sha: f.context.sourceCommit } },
    sourceRun: { id: 100, repository: { id: 42, full_name: REPOSITORY }, head_repository: { id: 42, full_name: REPOSITORY },
      path: PRODUCT_WORKFLOW, workflow_id: 7, head_sha: f.context.sourceCommit, head_branch: 'v' + version, event: 'push', run_attempt: 2, conclusion: 'failure' },
    workflow: { id: 7, path: PRODUCT_WORKFLOW }, jobs: [{ name: 'publish', head_sha: f.context.sourceCommit, status: 'completed', run_attempt: 1,
      steps: Object.values(ARTIFACT_STEPS).map(name => ({ name, conclusion: 'success' })), conclusion: 'failure' }] }
}

test('sealing retains exactly fourteen files, real archive metadata and unchanged raw bytes', async t => {
  const f = await artifactFixture(t)
  assert.equal(productArtifactPaths(version).length, 14)
  assert.match(f.sealed.name, /-100-1$/u)
  assert.deepEqual(await verifyProductArtifactPayload(f.payload, { version, sourceCommit: f.context.sourceCommit, sourceRoot: f.sourceRoot }), f.receipt)
  for (const entry of f.receipt.entries) assert.deepEqual(await readFile(join(f.prepared, 'distribution/tarballs', entry.filename)), await readFile(join(f.payload, 'distribution/tarballs', entry.filename)))
  for (const path of ['material-observations.json', 'pnpm-lock.yaml', 'distribution/tarballs/' + f.receipt.entries[0].filename]) {
    const file = join(f.payload, path), original = await readFile(file)
    await writeFile(file, Buffer.concat([original, Buffer.from('changed')]))
    await assert.rejects(verifyProductArtifactPayload(f.payload, { version, sourceCommit: f.context.sourceCommit, sourceRoot: f.sourceRoot }))
    await writeFile(file, original)
  }
  await writeFile(join(f.payload, 'unexpected.txt'), 'extra')
  await assert.rejects(verifyProductArtifactPayload(f.payload, { version, sourceCommit: f.context.sourceCommit, sourceRoot: f.sourceRoot }), /fourteen/)
})

test('actual ZIP digest, whitelist, duplicate, symlink and complete-set checks run before admission', async t => {
  const f = await artifactFixture(t), zip = artifactZip(f)
  const destination = join(f.root, 'restored')
  await extractProductArtifactZip(zip, 'sha256:' + sha256(zip), destination, version)
  await verifyProductArtifactPayload(destination, { version, sourceCommit: f.context.sourceCommit, sourceRoot: f.sourceRoot })
  await assert.rejects(extractProductArtifactZip(zip, 'sha256:' + '0'.repeat(64), join(f.root, 'digest'), version), /digest differs/)
  const corrupt = zip.subarray(0, zip.length - 12)
  await assert.rejects(extractProductArtifactZip(corrupt, 'sha256:' + sha256(corrupt), join(f.root, 'corrupt'), version), /extraction refused/)
  const oversized = Buffer.from(zip)
  oversized.writeUInt32LE(0xffffffff, oversized.indexOf(Buffer.from('504b0102', 'hex')) + 24)
  await assert.rejects(extractProductArtifactZip(oversized, 'sha256:' + sha256(oversized), join(f.root, 'oversized'), version), /extraction refused/)
  let index = 0
  for (const options of [{ omit: 'pnpm-lock.yaml' }, { extra: '../escape' }, { extra: '/absolute' },
    { extra: 'node_modules/private' }, { duplicate: true }, { symlink: 'pnpm-lock.yaml' }]) {
    const unsafe = artifactZip(f, options)
    await assert.rejects(extractProductArtifactZip(unsafe, 'sha256:' + sha256(unsafe), join(f.root, 'unsafe-' + index++), version), /extraction refused/)
  }
})

test('provenance permits a partial-failed run but refuses wrong source, origin, attempt or unsuccessful seal/upload', async t => {
  const f = await artifactFixture(t), valid = artifactProvenance(f, artifactZip(f))
  await verifyProductArtifactProvenance(valid)
  const explicit = structuredClone(valid); explicit.context.runId = '200'; explicit.context.runAttempt = '1'
  await verifyProductArtifactProvenance(explicit)
  const main = structuredClone(explicit)
  Object.assign(main.receipt.actionsOrigin, { ref: 'refs/heads/main', eventName: 'workflow_dispatch', job: 'dryrun' })
  Object.assign(main.sourceRun, { head_branch: 'main', event: 'workflow_dispatch' }); main.jobs[0].name = 'dryrun'
  await verifyProductArtifactProvenance(main)
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
  ]) { const bad = structuredClone(valid); mutate(bad); await assert.rejects(verifyProductArtifactProvenance(bad)) }
})

test('route pairing and rerun uniqueness refuse silent rebuilds; fresh preparation requires all ten 404s', async t => {
  const f = await artifactFixture(t), valid = artifactProvenance(f, artifactZip(f))
  const api = { get: async () => ({ total_count: 1, artifacts: [valid.artifact] }) }
  assert.equal((await selectProductArtifactRoute({ version, context: valid.context, api, sourceRoot:f.sourceRoot })).mode, 'restore')
  for (const artifacts of [[], [valid.artifact, { ...valid.artifact, id: 901 }], [{ ...valid.artifact, expired: true }]]) {
    await assert.rejects(selectProductArtifactRoute({ version, context: valid.context, api: { get: async () => ({ total_count: artifacts.length, artifacts }) } }))
  }
  await assert.rejects(selectProductArtifactRoute({ version, context: f.context, api, resumeRunId: '100' }), /paired/)
  await assert.rejects(selectProductArtifactRoute({ version, context: f.context, api, resumeRunId: '001', resumeArtifactId: '900' }), /Canonical/)
  const explicit = await selectProductArtifactRoute({ version, context: artifactContext({ runId: '200' }), resumeRunId: '100', resumeArtifactId: '900', api: { get: async () => valid.artifact } })
  assert.equal(explicit.artifactId, '900')
  let calls = 0
  assert.equal((await selectProductArtifactRoute({ version, context: f.context, api, fetchImpl: async () => { calls++; return { status: 404 } } })).mode, 'prepare')
  assert.equal(calls, 11)
  for (const status of [200, 403, 500]) await assert.rejects(selectProductArtifactRoute({ version, context: f.context, api, fetchImpl: async () => ({ status }) }), /Fresh preparation/)
})

test('restore fetches fixed original archives and validates failed-run preparation without build or pack', async t => {
  const f = await artifactFixture(t), zip = artifactZip(f), valid = artifactProvenance(f, zip), calls = []
  const api = { get: async path => {
    calls.push(path)
    if (path === 'actions/artifacts/900') return valid.artifact
    if (path === 'actions/runs/100') return valid.sourceRun
    if (path === 'actions/workflows/publish-product.yml') return valid.workflow
    if (path === 'actions/runs/100/attempts/1/jobs?per_page=100&page=1') return { total_count: 1, jobs: valid.jobs }
    throw Error('Unexpected API path')
  }, download: async id => { assert.equal(id, '900'); return zip } }
  const destination = join(f.root, 'api-restored')
  const result = await restoreProductArtifact({ version, destination, runId: '100', artifactId: '900', context: valid.context, api, sourceRoot:f.sourceRoot })
  assert.equal(result.artifactId, '900'); assert.equal(result.digest, valid.artifact.digest)
  assert.equal(calls.length, 4)
  await assert.rejects(recordProductUploadedArtifact({ directory: f.payload, artifactId: '900', digest: '0'.repeat(64), context: f.context, sourceRoot:f.sourceRoot,
    api: { get: async () => valid.artifact } }), /digest differs/)
  assert.equal((await recordProductUploadedArtifact({ directory: f.payload, artifactId: '900', digest: sha256(zip), context: f.context, sourceRoot:f.sourceRoot,
    api: { get: async () => valid.artifact } })).artifactId, '900')
})

test('signed ZIP download never forwards the API credential, and diagnostics contain only booleans', async () => {
  const token = 'SYNTHETIC_SECRET_MUST_NOT_LEAK', zip = Buffer.from('zip fixture'), calls = []
  const api = productActionsApi({ token, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    if (String(url).startsWith('https://api.github.com/')) return { status: 302, headers: new Map([['location', 'https://storage.example/artifact?signature=synthetic']]) }
    assert.equal(options.headers, undefined)
    return { status: 200, body: (async function* () { yield zip })() }
  } })
  assert.deepEqual(await api.download('900'), zip)
  assert.equal(calls[0].options.headers.authorization, 'Bearer ' + token)
  const diagnostics = productOidcDiagnostics({ ACTIONS_ID_TOKEN_REQUEST_URL: token, ACTIONS_ID_TOKEN_REQUEST_TOKEN: token })
  assert.equal(diagnostics.idTokenRequestUrlPresent, true); assert.equal(diagnostics.idTokenRequestTokenPresent, true)
  assert.ok(!JSON.stringify(diagnostics).includes(token))
  assert.throws(() => productActionsContext({ GITHUB_ACTIONS: 'false' }))
  assert.equal(productRegistryStateDirectory('/tmp/payload/release-receipt.json', { PRODUCT_REGISTRY_STATE_DIR: '/tmp/registry' }), '/tmp/registry')
  for (const path of ['/tmp/payload', '/tmp/payload/nested', 'relative']) assert.throws(() =>
    productRegistryStateDirectory('/tmp/payload/release-receipt.json', { PRODUCT_REGISTRY_STATE_DIR: path }))
})

test('pre-install CLI selection and recovery imports use only Node builtins without node_modules', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-builtins-bootstrap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'release'))
  const pending = ['prepare-product-release.mjs'], copied = new Set()
  while (pending.length) {
    const file = pending.pop()
    if (copied.has(file)) continue; copied.add(file)
    const text = await readFile(new URL(file, import.meta.url), 'utf8')
    await writeFile(join(root, 'scripts', file), text)
    for (const match of text.matchAll(/^import[^\n]+from ['"]\.\/([^'"]+)['"]/gmu)) pending.push(match[1])
  }
  await writeFile(join(root,'release/product.json'),JSON.stringify(product));await writeFile(join(root,'release/release-hosts.json'),JSON.stringify(sourceHosts))
  const selected = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/prepare-product-release.mjs'), 'select'],
    { env: { PATH: process.env.PATH }, encoding: 'utf8' }))
  assert.equal(selected.version, version)
  const loaded = execFileSync(process.execPath, ['--input-type=module', '-e',
    `const m=await import(${JSON.stringify(new URL('file://' + join(root, 'scripts/prepare-product-release.mjs')).href)});process.stdout.write([typeof m.selectProductArtifactRoute,typeof m.restoreProductArtifact].join(','))`],
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
    else if(path.endsWith('/actions/workflows/publish-product.yml')) data=v.workflow;
    else if(path.endsWith('/actions/runs/100/artifacts?per_page=100&page=1')) data={total_count:1,artifacts:[v.artifact]};
    else if(path.endsWith('/actions/runs/100/attempts/1/jobs?per_page=100&page=1')) data={total_count:1,jobs:v.jobs};
    else throw Error('Unexpected synthetic API request');
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  };`)
  const env = { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REPOSITORY_ID: '42',
    GITHUB_WORKFLOW_REF: `${REPOSITORY}/${PRODUCT_WORKFLOW}@refs/tags/v${version}`, GITHUB_SHA: sourceCommit,
    GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2', GITHUB_REF: `refs/tags/v${version}`, GITHUB_EVENT_NAME: 'push',
    GITHUB_JOB: 'publish', GITHUB_TOKEN: 'synthetic-only', REQUIRE_RELEASE_TAG: 'true', RELEASE_REF: `refs/tags/v${version}`,
    GITHUB_OUTPUT: join(root, 'outputs'), GITHUB_STEP_SUMMARY: join(root, 'summary'), SELECTED_RUN_ID: '100', SELECTED_ARTIFACT_ID: '900' }
  const cli = join(root, 'scripts/prepare-product-release.mjs')
  const route = JSON.parse(execFileSync(process.execPath, ['--import', stub, cli, 'route', version], { env, encoding: 'utf8' }))
  assert.equal(route.mode, 'restore')
  const restored = JSON.parse(execFileSync(process.execPath, ['--import', stub, cli, 'restore', version, join(f.root, 'bootstrap-restored')], { env, encoding: 'utf8' }))
  assert.equal(restored.artifactId, '900'); assert.match(await readFile(join(root, 'summary'), 'utf8'), /attempt 1, artifact 900/)
  const verified = JSON.parse(execFileSync(process.execPath, [cli, 'verify-artifact', join(f.root, 'bootstrap-restored')], { env, encoding: 'utf8' }))
  assert.equal(verified.files, 14)
  await assert.rejects(readFile(join(root, 'node_modules/semver/package.json')), { code: 'ENOENT' })
  const receiptFile = join(f.root, 'bootstrap-restored/release-receipt.json'), state = join(f.root, 'registry-results')
  const completed = JSON.parse(execFileSync(process.execPath, ['--import', stub, cli, 'complete', receiptFile],
    { env: { ...env, PRODUCT_REGISTRY_STATE_DIR: state }, encoding: 'utf8' }))
  assert.equal(completed.length, 11); assert.ok(completed.every(x => x.state === 'identical'))
  await assert.rejects(readFile(join(f.root, 'bootstrap-restored/complete-registry.json')), { code: 'ENOENT' })
  await writeFile(join(root, 'scripts/npm-release-tags.mjs'), await readFile(new URL('./npm-release-tags.mjs', import.meta.url)))
  await mkdir(join(root, 'node_modules'))
  await symlink(fileURLToPath(new URL('../node_modules/semver', import.meta.url)), join(root, 'node_modules/semver'), 'dir')
  const npmCli = join(root, 'synthetic-npm-cli.cjs')
  await writeFile(npmCli, '// Never executed: planner reads semver from this dependency tree.\n')
  const tagEnv = { ...env, PRODUCT_REGISTRY_STATE_DIR: state, RELEASE_CHAIN: 'product', RELEASE_VERSION: version,
    RELEASE_RECEIPT: receiptFile, NPM_CLI: npmCli }
  const tagCli = join(root, 'scripts/npm-release-tags.mjs')
  const plan = JSON.parse(execFileSync(process.execPath, ['--import', stub, tagCli, 'plan', '0'], { env: tagEnv, encoding: 'utf8' }))
  assert.equal(plan.action, 'skip'); assert.equal(plan.releaseVersion, version)
  const directoryLink = join(f.root, 'state-link'); await symlink(state, directoryLink, 'dir')
  assert.throws(() => productRegistryStateDirectory(receiptFile, { PRODUCT_REGISTRY_STATE_DIR: directoryLink }), /symlink/)
  assert.throws(() => productRegistryStateDirectory(receiptFile, { PRODUCT_REGISTRY_STATE_DIR: join(directoryLink, 'child') }), /symlink/)
  const completeFile = join(state, 'complete-registry.json'), retained = join(f.root, 'retained-complete.json')
  await writeFile(retained, await readFile(completeFile)); await rm(completeFile); await symlink(retained, completeFile)
  const rejected = (() => { try { execFileSync(process.execPath, ['--import', stub, tagCli, 'plan', '0'], { env: tagEnv, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (error) { return error } })()
  assert.equal(rejected.status, 1); assert.match(rejected.stderr.toString(), /symlink refused/)
})
