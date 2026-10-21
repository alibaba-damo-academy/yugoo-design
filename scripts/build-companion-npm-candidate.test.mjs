import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { build } from 'tsdown'
import { buildFlowScripts, inspectStagedPayload, verifySameSourceCandidateEvidence, verifyStagedUiCandidateAssociations, recordCompletedBuildOutputs, resolveBundledLicenseSource, parseSameSourceBuildArgs } from './build-companion-npm-candidate.mjs'
import { stageNativeInventoryFixture } from './test-fixtures/companion-native-inventory.mjs'
import { checkEmitted, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'
import { EXCALIDRAW_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'
import { artifactInventory, inventorySha256, sha256 } from './pica-worker-evidence.mjs'

const fixture = fileURLToPath(new URL('./test-fixtures/pica-worker/', import.meta.url))

test('non-fixture build identity requires exact public package and official dependency', () => {
  const args = ['--ladybug-dependency', '0.21.1', '--candidate-mode', 'non-fixture', '--package-name', '@yugoo-design/companion', '--version', '0.1.0']
  assert.deepEqual(parseSameSourceBuildArgs(args), { ladybugDependency: '0.21.1', candidate: { fixture: false, scope: '@yugoo-design', packageName: '@yugoo-design/companion', version: '0.1.0' } })
  assert.equal(parseSameSourceBuildArgs(args.map(value => value === '0.1.0' ? '0.1.0-beta.1' : value)).candidate.version, '0.1.0-beta.1')
  const betaArgs = args.map(value => value === '0.1.0' ? '0.1.0-beta.1' : value)
  assert.equal(parseSameSourceBuildArgs([...betaArgs, '--distribution', 'beta']).candidate.distribution, 'beta')
  assert.equal(parseSameSourceBuildArgs([...args, '--native-git-artifacts', '/pinned/native']).nativeGitArtifactRoot, '/pinned/native')
  assert.throws(() => parseSameSourceBuildArgs([...args, '--native-git-artifacts', './relative']))
  const selected = parseSameSourceBuildArgs([...args, '--release-hosts-file', '/pinned/local-hosts.json', '--release-hosts-sha256', 'a'.repeat(64)])
  assert.equal(selected.releaseHostsFile, '/pinned/local-hosts.json')
  assert.equal(selected.releaseHostsSha256, 'a'.repeat(64))
  for (const extra of [
    ['--release-hosts-file', './relative.json', '--release-hosts-sha256', 'a'.repeat(64)],
    ['--release-hosts-file', '/pinned/local-hosts.json'],
    ['--release-hosts-sha256', 'a'.repeat(64)],
    ['--release-hosts-file', '/pinned/local-hosts.json', '--release-hosts-sha256', 'invalid'],
  ]) assert.throws(() => parseSameSourceBuildArgs([...args, ...extra]))
  for (const input of [[...args, '--distribution', 'beta'], [...betaArgs, '--distribution', 'published'], ['--ladybug-dependency', '0.21.1', '--distribution', 'beta']]) assert.throws(() => parseSameSourceBuildArgs(input))
  const invalid = [
    args.slice(0, -2),
    [...args, '--version', '0.2.0'],
    args.map(value => value === '0.1.0' ? 'latest' : value),
    args.map(value => value === '@yugoo-design/companion' ? '@fixture-design-release/companion' : value),
    args.map(value => value === '0.21.1' ? 'npm:@example/ladybug@0.21.1' : value),
    args.map(value => value === 'non-fixture' ? 'release' : value),
    [...args, '--publish', 'true'],
  ]
  for (const input of invalid) assert.throws(() => parseSameSourceBuildArgs(input))
  assert.deepEqual(parseSameSourceBuildArgs(['--ladybug-dependency', '0.21.1']), { ladybugDependency: '0.21.1', candidate: { fixture: true, scope: '@fixture-design-release' } })
  assert.throws(() => parseSameSourceBuildArgs(args.filter(value => !['--candidate-mode', 'non-fixture'].includes(value))))
})

test('portable ws bundle has only builtin loaders and preserves masking and UTF-8 validation', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-portable-ws-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const require = createRequire(import.meta.url)
  const serverConfig = (await import('../packages/companion/tsdown.server.config.ts')).default
  const options = { config: false, entry: { ws: join(dirname(require.resolve('ws/package.json')), 'wrapper.mjs') }, format: 'esm',
    platform: 'node', target: 'node22', tsconfig: false, dts: false, clean: false, failOnWarn: true,
    deps: { alwaysBundle: [/.*/], onlyBundle: false } }
  const plain = join(root, 'plain'), portable = join(root, 'portable')
  await recordCompletedBuildOutputs('plain-ws', await build({ ...options, outDir: plain }), plain, [])
  await assert.rejects(checkEmitted(plain, new Set(), { knownNodeRuntime: true }), /Undeclared emitted runtime dependency: bufferutil/)
  await recordCompletedBuildOutputs('portable-ws', await build({ ...options, outDir: portable, define: serverConfig.define }), portable, [])
  await checkEmitted(portable, new Set(), { knownNodeRuntime: true })
  const { default: WebSocket, WebSocketServer } = await import(pathToFileURL(join(portable, 'ws.mjs')))
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  t.after(() => { for (const socket of server.clients) socket.terminate(); server.close() })
  server.on('connection', socket => {
    socket.on('error', () => {}) // Invalid UTF-8 must close the connection, not crash the server.
    socket.on('message', (data, binary) => socket.send(data, { binary }))
  })
  await once(server, 'listening')
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}`)
  t.after(() => client.terminate())
  await once(client, 'open')
  for (const payload of ['测试🙂'.repeat(1024), Buffer.alloc(4096, 0xab)]) {
    const pending = once(client, 'message')
    client.send(payload)
    const [bytes, binary] = await pending
    assert.deepEqual(bytes, Buffer.from(payload)); assert.equal(binary, Buffer.isBuffer(payload))
  }
  const pong = once(client, 'pong')
  client.ping('portable-ws-heartbeat')
  assert.deepEqual((await pong)[0], Buffer.from('portable-ws-heartbeat'))
  const closed = once(client, 'close')
  client.send(Buffer.from([0xff, 0xff]), { binary: false })
  assert.equal((await closed)[0], 1007)
})

test('standalone Flow CLIs preserve layout, metrics and search with no exported loader chunks', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'companion-standalone-flow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = fileURLToPath(new URL('../packages/skills-web-app/bundles/flow_design/scripts/', import.meta.url))
  const out = join(root, 'out')
  await buildFlowScripts(source, out)
  assert.deepEqual((await readdir(out)).sort(), ['layout-metrics.mjs', 'layout-search.mjs', 'layout.mjs'])
  const records = await checkEmitted(out, new Set())
  assert.ok(records.every(record => record.unverified.length === 0 && record.knownNodeProofs.length === 0))
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="https://yugoo.test/flow">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="start"/><bpmn:task id="task" name="Review"/><bpmn:endEvent id="end"/>
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="task"/>
    <bpmn:sequenceFlow id="f2" sourceRef="task" targetRef="end"/>
  </bpmn:process>
</bpmn:definitions>`
  const run = (directory, name, args = [], input) => {
    const result = spawnSync(process.execPath, [join(directory, `${name}.mjs`), ...args],
      { cwd: root, input, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  }
  const expected = run(source, 'layout', [], xml)
  assert.match(expected, /BPMNShape/)
  assert.equal(run(out, 'layout', [], xml), expected, 'emitted layout changes the canonical BPMN artifact')
  for (const directory of [source, out]) {
    const invalid = spawnSync(process.execPath, [join(directory, 'layout.mjs'), '--validate'],
      { cwd: root, input: '<invalid', encoding: 'utf8', timeout: 10000 })
    assert.equal(invalid.error, undefined)
    assert.equal(invalid.status, 2)
    assert.equal(invalid.stdout, '', 'invalid BPMN must not produce fallback geometry')
  }
  const input = join(root, 'input.bpmn')
  await writeFile(input, expected)
  const stripTiming = text => JSON.parse(text).map(({ ms, ...record }) => record)
  assert.deepEqual(stripTiming(run(out, 'layout-metrics', ['--json', input])), stripTiming(run(source, 'layout-metrics', ['--json', input])))
  const sourceResult = join(root, 'source-search.bpmn'), emittedResult = join(root, 'emitted-search.bpmn')
  run(source, 'layout-search', [input, sourceResult, '--passes', '1'])
  run(out, 'layout-search', [input, emittedResult, '--passes', '1'])
  assert.deepEqual(await readFile(emittedResult), await readFile(sourceResult))
  const code = await readFile(join(out, 'layout.mjs'), 'utf8')
  assert.ok(code.includes('"web-worker": 4'), 'expected reviewed literal Browserify mapping')
  const broken = join(root, 'broken'); await mkdir(broken)
  for (const invalid of [code.replace('"web-worker": 4', '"web-worker": 999'),
    code.replace('require("web-worker")', 'require(packageName)'), code + '\nconst escaped = __require;']) {
    await writeFile(join(broken, 'layout.mjs'), invalid)
    await assert.rejects(checkEmitted(broken, new Set()), 'mutated standalone loader must be rejected')
  }
  await rm(join(out, 'layout-metrics.mjs'))
  await assert.rejects(checkEmitted(out, new Set()), 'search requires its exact sibling metrics artifact')
})

test('completed fake build outputs are mapped before disposal without promoting acceptance', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'driver-output-map-'))
  t.after(() => rm(outDir, { recursive:true, force:true }))
  const code = 'export const ok = true;\n'; await writeFile(join(outDir, 'client.js'), code)
  let alive = true, disposed = 0
  const output = {type:'chunk',fileName:'client.js',outDir,code,isEntry:true,isDynamicEntry:false,facadeModuleId:null,
    imports:[],dynamicImports:[],moduleIds:['\0opaque-worker'],get modules(){
      assert.equal(alive,true);return {'\0opaque-worker':{code:null,renderedLength:0,renderedExports:[]}}
    }}
  const bundle = {chunks:[output],async [Symbol.asyncDispose](){alive=false;disposed++}}
  const records = [], result = await recordCompletedBuildOutputs('web',[bundle],outDir,records)
  assert.equal(disposed,1);assert.equal(result.diskAssociationVerified,true)
  assert.equal(result.outputs[0].modules[0].codeState,'rendered-code-unavailable')
  assert.equal(result.outputs[0].modules[0].innerInventory,'not-inventoried')
  assert.doesNotThrow(()=>JSON.stringify(records))
  for(const field of ['completeBundledInventory','releaseLicenseAcceptance','actualGetterLifetimeVerified'])assert.equal(result[field],false)
  assert.equal(result.kind,'emitted-output-module-associations')
  assert.equal(Object.hasOwn(result,'candidateAccepted'),false)
})

test('failed output mapping disposes every returned fake bundle and appends no evidence', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'driver-output-map-failed-'))
  t.after(()=>rm(outDir,{recursive:true,force:true}))
  let disposed=0
  const records=[],bundles=[
    {chunks:[{type:'asset',fileName:'missing.bin',outDir,source:new Uint8Array([1])}],[Symbol.asyncDispose](){disposed++}},
    {chunks:[],[Symbol.asyncDispose](){disposed++}},
  ]
  await assert.rejects(recordCompletedBuildOutputs('web',bundles,outDir,records),{code:'ENOENT'})
  assert.equal(disposed,2);assert.deepEqual(records,[])
  bundles[0][Symbol.asyncDispose]=()=>{disposed++;throw new Error('dispose failed')}
  await assert.rejects(recordCompletedBuildOutputs('web',bundles,outDir,records),/dispose failed/)
  assert.equal(disposed,4)
})
async function setup(t, { legacy = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'companion-driver-gate-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidate = join(root, 'candidate'), shared = join(candidate, 'payload/shared'), web = join(shared, 'web')
  for (const directory of ['web', 'scripts', 'knowledge', 'bundles/flow_design/scripts']) await mkdir(join(shared, directory), { recursive: true })
  for (const name of ['pica-DGw4b28J.js', 'rolldown-runtime-CEgmsyvS.js']) await cp(join(fixture, name), join(web, name))
  await writeFile(join(web, 'client.js'), `import {i as __require} from './rolldown-runtime-CEgmsyvS.js'; var f$2=${EXCALIDRAW_REQUIRE_SHIM}; export {f$2 as W}`)
  if (!legacy) {
    await cp(new URL('./test-fixtures/embedded-image-loader/image-blob-reduce.esm.js',import.meta.url),join(web,'image-blob-reduce.esm-BvXskEpO.js'))
    await writeFile(join(web,'client.js'),(await readFile(join(web,'client.js'),'utf8'))+'\n'+await readFile(new URL('./test-fixtures/ui-blob-chain/client-consumer.js',import.meta.url),'utf8'))
  }
  await writeFile(join(web, 'consumer.js'), "import {W as f} from './client.js'; function nodeOnly(){f(['fs'].join());f(['path'].join())}")
  await writeFile(join(web, 'elk.js'), `import {i as __require} from './rolldown-runtime-CEgmsyvS.js'; export default (${BROWSERIFY_DISPATCHER})()({1:[function(require,module,exports){module.exports=1},{}]}, {}, [1])(1)`)
  await writeFile(join(shared, 'scripts/design.mjs'), "export const load = () => import('../knowledge/runtime.mjs')")
  await stageNativeInventoryFixture(shared)
  await writeFile(join(shared, 'knowledge/runtime.mjs'), 'export default 1')
  await writeFile(join(shared, 'bundles/flow_design/scripts/layout.mjs'), "import path from 'node:path'; export default path")
  await writeFile(join(candidate, 'package.json'), '{"name":"synthetic-driver-fixture","private":true,"dependencies":{}}')
  return { root, candidate, shared, web }
}

test('strict default still rejects pica; driver staging preserves the exact unknown', async t => {
  const f = await setup(t)
  await assert.rejects(checkEmitted(f.web, new Set(), { picaWorkerEvidenceRequired: true }), /forwarding-chain/)
  await assert.rejects(checkEmitted(f.web, new Set(), { knownBrowserShims: true }), /Unverified/)
  const result = await inspectStagedPayload(f.shared, {})
  const pending = result.web.filter(r => r.runtimeEvidenceRequired)
  assert.equal(pending.length, 2); assert.ok(pending.every(r=>r.unverified.length===3))
  const image=pending.find(r=>r.runtimeEvidenceRequired.kind==='injected-ui-blob-chain')
  assert.deepEqual(image.unverified.map(r=>r.start),[42916,42948,42978])
  assert.equal(image.runtimeEvidenceRequired.embeddedDefaultWorkerStatus,'unresolved')
  assert.equal(image.runtimeEvidenceRequired.browserExecutionVerified,false)
  assert.equal(pending.find(r=>r.runtimeEvidenceRequired.rule).runtimeEvidenceRequired.boundedWorkerTaskVerified, false)
  assert.equal(pending[0].dynamicClosureVerified, false)
})

test('staging rejects changed pica, unrelated loaders, missing assets and extra consumers', async t => {
  const mutations = [
    async f => { const path = join(f.web, 'pica-DGw4b28J.js'); await writeFile(path, (await readFile(path, 'utf8')) + '\n') },
    f => writeFile(join(f.web, 'unknown.js'), "const alias=require;alias('unknown')"),
    f => writeFile(join(f.shared, 'scripts/unknown.mjs'), "import './missing.mjs'"),
    f => writeFile(join(f.shared, 'bundles/flow_design/scripts/unknown.mjs'), 'require(dynamicName)'),
    f => rm(join(f.web, 'rolldown-runtime-CEgmsyvS.js')),
    f => cp(join(f.web, 'pica-DGw4b28J.js'), join(f.web, 'duplicate-pica.js')),
    f => rm(join(f.web,'image-blob-reduce.esm-BvXskEpO.js')),
    f => cp(join(f.web,'image-blob-reduce.esm-BvXskEpO.js'),join(f.web,'duplicate-image.js')),
    async f => {const p=join(f.web,'client.js');await writeFile(p,(await readFile(p,'utf8')).replace('[\"js\", \"wasm\"]','[\"js\", \"ww\"]'))},
    f => writeFile(join(f.web, 'escape.js'), "import('./rolldown-runtime-CEgmsyvS.js').then(m=>m.i('unknown'))"),
  ]
  for (const mutate of mutations) { const f = await setup(t); await mutate(f); await assert.rejects(inspectStagedPayload(f.shared, {})) }
})

test('real server and Knowledge compilation preserve the empty server dependency set', {timeout:30000}, async t => {
  const f = await setup(t)
  await rm(join(f.shared, 'knowledge'), {recursive:true})
  const program = `
    const {build} = await import(process.argv[1])
    const {packageKnowledge} = await import(process.argv[2])
    const {default:server} = await import(process.argv[3])
    const {resolve,join} = await import('node:path')
    const shared=process.argv[4],companion=process.argv[5]
    const compile=async config=>{const bundles=await build(config);for(const bundle of bundles)await bundle[Symbol.asyncDispose]()}
    await compile({...server,config:false,entry:Object.fromEntries(Object.entries(server.entry).map(([name,path])=>[name,resolve(companion,path)])),outDir:join(shared,'scripts'),clean:false})
    await packageKnowledge(undefined,{mode:'portable',outputDirectory:join(shared,'knowledge'),runtimeDependencies:{'@ladybugdb/wasm-core':'0.21.1','@huggingface/transformers':'3.8.1','onnxruntime-common':'1.21.0',undici:'8.10.0'},buildImpl:compile})
  `
  const env={...process.env};delete env.NODE_TEST_CONTEXT
  const compiled=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',program,import.meta.resolve('tsdown'),
    new URL('../packages/companion/package-knowledge.mjs',import.meta.url).href,
    new URL('../packages/companion/tsdown.server.config.ts',import.meta.url).href,f.shared,
    fileURLToPath(new URL('../packages/companion/',import.meta.url))],{env,encoding:'utf8',maxBuffer:4_000_000})
  assert.ifError(compiled.error)
  assert.equal(compiled.status,0,compiled.stderr||compiled.stdout)
  const manifest=JSON.parse(await readFile(join(f.shared,'knowledge/runtime-manifest.json'),'utf8'))
  const asset=join(f.shared,'knowledge/cli-lifecycle.mjs'),bytes=await readFile(asset)
  assert.equal(manifest.assets['cli-lifecycle.mjs'],sha256(bytes))
  const emitted=await inspectStagedPayload(f.shared,manifest.runtimeDependencies)
  assert.ok(emitted.server.flatMap(record=>record.loads).some(load=>load.source==='../knowledge/cli-lifecycle.mjs'))
  assert.ok(!emitted.server.flatMap(record=>record.loads).some(load=>load.source.startsWith('@ladybugdb/')))
  assert.ok(emitted.knowledge.flatMap(record=>record.loads).some(load=>load.source==='@ladybugdb/wasm-core/nodejs'))
  await rm(asset)
  await assert.rejects(inspectStagedPayload(f.shared,manifest.runtimeDependencies),/ENOENT/)
  await writeFile(asset,bytes)
  const badServer=join(f.shared,'scripts/unreviewed.mjs')
  await writeFile(badServer,"import {createRequire} from 'node:module'; createRequire(import.meta.url)('@ladybugdb/wasm-core/nodejs')")
  await assert.rejects(inspectStagedPayload(f.shared,manifest.runtimeDependencies),/Undeclared emitted runtime dependency/)
  await writeFile(badServer,"export const load=()=>import('../knowledge/unreviewed.mjs')")
  await writeFile(join(f.shared,'knowledge/unreviewed.mjs'),'export default 1')
  await assert.rejects(inspectStagedPayload(f.shared,manifest.runtimeDependencies),/Import escapes output/)
})

async function association(t) {
  const f = await setup(t, {legacy:true}), evidence = join(f.root, 'evidence')
  await mkdir(evidence); await cp(f.web, join(evidence, 'web'), { recursive: true })
  const report = JSON.parse(await readFile(join(fixture, 'report-template.json'))); delete report.fixtureOnly
  for (const b of report.blobs) await cp(join(fixture, b.file), join(evidence, b.file))
  for (const phase of ['js-worker', 'default-worker']) await cp(join(fixture, phase + '-offscreen-support.js'), join(evidence, phase + '-offscreen-support.js'))
  const emitted = await inspectStagedPayload(f.shared, {}, {embeddedImageEvidenceRequired:false}), candidateInputs = await artifactInventory(f.candidate)
  const inventoryHash = inventorySha256(candidateInputs), runnerHash = sha256(await readFile(new URL('./probe-companion-pica-worker.mjs', import.meta.url)))
  const buildReport = { kind: 'same-source-exploratory-build', candidateAccepted: false, sameSourceBuildCompleted: true, sourceStable: true,
    workerTaskGate: 'runtime-evidence-required', dynamicClosureVerified: false, candidate: f.candidate, candidateInputs,
    candidateInventorySha256: inventoryHash, runtimeDependencies: {},
    staticUnknown: emitted.web.filter(r => r.runtimeEvidenceRequired).map(r => ({ file: r.file, ...r.runtimeEvidenceRequired })) }
  Object.assign(report, { kind: 'candidate-relocated-pica-worker-probe', root: evidence, source: f.web, picaFile: 'pica-DGw4b28J.js',
    candidateDirectory: f.candidate, candidateInputs, candidateInventorySha256: inventoryHash, runnerSha256: runnerHash,
    inputs: await artifactInventory(f.web), inputsUnchanged: true, copyUnchanged: true, candidateUnchanged: true })
  const options = { buildReportFile: join(f.root, 'build-report.json'), evidenceDirectory: evidence, runnerSha256: runnerHash,
    sourceInputs: { picaDirectory: join(fixture, 'source/pica'), webworkifyDirectory: join(fixture, 'source/webworkify') },
    versions: { browserVersion: '149.0.7827.55', playwrightVersion: '1.61.1', nodeVersion: '22.22.3' } }
  async function save() {
    const b = JSON.stringify(buildReport), r = JSON.stringify(report)
    await writeFile(options.buildReportFile, b); await writeFile(join(evidence, 'report.json'), r)
    options.buildReportSha256 = sha256(b); options.reportSha256 = sha256(r)
  }
  await save(); return { ...f, buildReport, report, options, save }
}

test('synthetic post-probe association cannot promote runtime or candidate acceptance', async t => {
  const f = await association(t), result = await verifySameSourceCandidateEvidence(f.options)
  assert.equal(result.evidenceAssociationsVerified, true)
  assert.equal(result.browserExecutionVerified, false)
  assert.equal(result.candidateAccepted, false); assert.equal(result.boundedWorkerTaskVerified, false)
  assert.equal(result.dynamicClosureVerified, false); assert.equal(result.publishReady, false)
  assert.equal(result.bundlePanelGraKagVerified, false); assert.equal(result.staticUnknown.length, 1)
  // Verification is read-only: the staged report remains unaccepted.
  assert.equal(JSON.parse(await readFile(f.options.buildReportFile)).candidateAccepted, false)
})

test('no candidate promotion on old/missing evidence, report drift or newly broken ordinary imports', async t => {
  const mutations = [
    async f => { f.report.kind = 'retained-relocated-pica-worker-probe'; await f.save() },
    f => rm(join(f.options.evidenceDirectory, 'report.json')),
    async f => { f.buildReport.sourceStable = false; await f.save() },
    async f => { f.buildReport.candidateAccepted = true; await f.save() },
    f => writeFile(f.options.buildReportFile, '{}'),
    async f => {
      await writeFile(join(f.shared, 'scripts/new-loader.mjs'), 'require(dynamicName)')
      f.buildReport.candidateInputs = await artifactInventory(f.candidate)
      f.buildReport.candidateInventorySha256 = inventorySha256(f.buildReport.candidateInputs)
      await f.save()
    },
  ]
  for (const mutate of mutations) { const f = await association(t); await mutate(f); await assert.rejects(verifySameSourceCandidateEvidence(f.options)) }
})

async function stagedAssociation(t) {
  const f=await setup(t),emitted=await inspectStagedPayload(f.shared,{}),candidateInputs=await artifactInventory(f.candidate)
  const report={kind:'same-source-exploratory-build',candidateAccepted:false,sameSourceBuildCompleted:true,sourceStable:true,
    workerTaskGate:'runtime-evidence-required',dynamicClosureVerified:false,candidate:f.candidate,candidateInputs,
    candidateInventorySha256:inventorySha256(candidateInputs),runtimeDependencies:{},
    staticUnknown:emitted.web.filter(r=>r.runtimeEvidenceRequired).map(r=>({file:r.file,...r.runtimeEvidenceRequired}))}
  const options={buildReportFile:join(f.root,'build-report.json')}
  const save=async()=>{const bytes=JSON.stringify(report);await writeFile(options.buildReportFile,bytes);options.buildReportSha256=sha256(bytes)}
  await save();return {...f,report,options,save}
}
test('two-task staged associations retain unknowns and never establish execution or acceptance',async t=>{
  const f=await stagedAssociation(t),r=await verifyStagedUiCandidateAssociations(f.options)
  assert.equal(r.evidenceAssociationsVerified,true);assert.equal(r.staticUnknown.length,2)
  for(const field of ['browserExecutionVerified','injectedUiBlobChainVerified','embeddedDefaultWorkerVerified','candidateAccepted','dynamicClosureVerified','bundlePanelGraKagVerified','publishReady'])assert.equal(r[field],false)
  await assert.rejects(verifySameSourceCandidateEvidence(f.options),/Legacy single-Pica verifier/)
  assert.equal(JSON.parse(await readFile(f.options.buildReportFile)).candidateAccepted,false)
})
test('two-task association rejects missing/extra groups, report/config/artifact and inventory drift',async t=>{
  for(const mutate of [
    f=>{f.report.staticUnknown.pop()},f=>{f.report.staticUnknown.push(f.report.staticUnknown[0])},
    f=>{f.report.staticUnknown.find(r=>r.kind==='injected-ui-blob-chain').consumer.sliceSha256='0'.repeat(64)},
    f=>{f.report.sourceStable=false},f=>{f.report.candidateAccepted=true},
    async f=>{await writeFile(join(f.web,'unknown.js'),'require(dynamicName)');f.report.candidateInputs=await artifactInventory(f.candidate);f.report.candidateInventorySha256=inventorySha256(f.report.candidateInputs)},
    f=>writeFile(join(f.web,'client.js'),'changed'),
  ]){const f=await stagedAssociation(t);await mutate(f);await f.save();await assert.rejects(verifyStagedUiCandidateAssociations(f.options))}
})


test('virtual CSS preserves physical license origin and refuses missing or forged path metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'css-license-origin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'bpmn.css'); await writeFile(file, '/* actual CSS */')
  const id = '\0dsh-design-css:owned:stable-hash.mjs'
  assert.equal(await resolveBundledLicenseSource(id, { meta: { dshDesignCssSource: file } }), file)
  for (const meta of [undefined, {}, { dshDesignCssSource: 'relative.css' }, { dshDesignCssSource: '\0bad.css' }, { dshDesignCssSource: root }]) {
    await assert.rejects(resolveBundledLicenseSource(id, { meta }), /physical CSS source/)
  }
  assert.equal(await resolveBundledLicenseSource('/actual/javascript.js', undefined), '/actual/javascript.js')
  await assert.rejects(resolveBundledLicenseSource(id, { meta: { dshDesignCssSource: join(root, 'missing.css') } }), /ENOENT/)
})

test('virtual CSS rejects directory and symlink source metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'css-license-origin-filetype-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const directory = join(root, 'directory.css'); await mkdir(directory)
  const file = join(root, 'actual.css'); await writeFile(file, '/* real */')
  const link = join(root, 'linked.css'); await (await import('node:fs/promises')).symlink(file, link)
  for (const origin of [directory, link]) await assert.rejects(resolveBundledLicenseSource('\0dsh-design-css:owned:opaque.mjs', { meta: { dshDesignCssSource: origin } }), /regular non-symlink/)
})
