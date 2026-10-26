/** Bounded source-compiled fixtures, not a product build or browser receipt. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { build } from 'tsdown'
import { readStaticPicaInput, compileStaticPicaWorkers } from './pica-static-worker-compiler.mjs'
import { adaptStaticPicaParent } from './pica-static-worker-adapter.mjs'
import { verifyStaticPicaEmission, STATIC_PICA_MANIFEST } from './static-pica-emission-proof.mjs'
import { captureOutputModuleMap } from './companion-output-module-map.mjs'
import { checkEmitted, analyzeEmittedLoaders, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'
import { EXCALIDRAW_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'
import { pendingRuntimeTasks, inspectStagedPayload, verifyStagedUiCandidateAssociations } from './build-companion-npm-candidate.mjs'
import { artifactInventory, inventorySha256, sha256 } from './pica-worker-evidence.mjs'
import { stageNativeInventoryFixture } from './test-fixtures/companion-native-inventory.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const importer = createRequire(createRequire(new URL('../packages/panel/package.json', import.meta.url)).resolve('@excalidraw/excalidraw'))
const names = { standalone: 'pica-current.js', embedded: 'image-current.js', runtime: 'runtime-current.js' }
const directories = Object.fromEntries([['standalone', 'pica'], ['embedded', 'image-blob-reduce']].map(([kind, name]) => [kind, dirname(importer.resolve(name + '/package.json'))]))
const inputs = Object.fromEntries(await Promise.all(Object.entries(directories).map(async ([kind, directory]) => [kind, await readStaticPicaInput({ kind, directory })])))
const compiled = await compileStaticPicaWorkers(inputs)
const parents = Object.fromEntries(Object.keys(inputs).map(kind => [kind, adaptStaticPicaParent(inputs[kind], compiled[kind])]))
const emitted = {}
for (const kind of Object.keys(parents)) {
  const entry = 'fixture-parent.' + (kind === 'standalone' ? 'cjs' : 'mjs')
  const bundles = await build({ config: false, entry: { parent: entry }, outDir: join(tmpdir(), 'unused-pica-test'), write: false,
    clean: false, platform: 'browser', format: 'esm', tsconfig: false, dts: false, target: 'es2024', logLevel: 'silent',
    deps: { alwaysBundle: [/.*/], onlyBundle: false }, outputOptions: { codeSplitting: false }, plugins: [{ name: 'fixture-parent',
      resolveId(id) { if (id === entry) return '\0' + entry }, load(id) { if (id === '\0' + entry) return parents[kind].code } }] })
  try {
    const code = bundles[0].chunks[0].code
    if (kind === 'embedded') emitted[kind] = code
    else {
      const program = parseSync('fixture.js', code).program
      const binding = program.body.at(-1).declaration.callee.name
      const declaration = program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === binding)
      const factory = declaration.init.arguments[0].expression ?? declaration.init.arguments[0]
      // The production split CJS shell uses the retained runtime. Keep the
      // actual compiler-printed parent body and all its notices intact.
      emitted[kind] = 'import {i as __require,t as __commonJSMin} from "./' + names.runtime + '";\n'
        + 'var parent = __commonJSMin((' + factory.params.map(n => n.name).join(',') + ')=>{' + code.slice(factory.body.start + 1, factory.body.end - 1) + '});\nexport default parent();\n'
    }
  } finally { await Promise.all(bundles.map(b => b[Symbol.asyncDispose]())) }
}

async function fixture(t) {
  const container = await realpath(await mkdtemp(join(tmpdir(), 'static-pica-emission-')))
  const candidate = join(container, 'candidate'), root = join(candidate, 'payload/shared/web')
  await mkdir(root, { recursive: true })
  t.after(() => rm(container, { recursive: true, force: true }))
  const manifest = structuredClone({ version: 1, entries: ['client'], sources: ['embedded', 'standalone'].map(kind => ({
    source: { package: parents[kind].manifest.package, version: parents[kind].manifest.version, entry: parents[kind].manifest.entry },
    manifest: parents[kind].manifest, workers: parents[kind].scripts })), browserExecuted: false })
  await writeFile(join(root, STATIC_PICA_MANIFEST), JSON.stringify(manifest))
  for (const kind of Object.keys(emitted)) await writeFile(join(root, names[kind]), emitted[kind])
  await writeFile(join(root, names.runtime), await readFile(new URL('./test-fixtures/pica-worker/rolldown-runtime-CEgmsyvS.js', import.meta.url)))
  const consumer = (await readFile(new URL('./test-fixtures/ui-blob-chain/client-consumer.js', import.meta.url), 'utf8'))
    .replaceAll('pica-DGw4b28J.js', names.standalone).replaceAll('image-blob-reduce.esm-BvXskEpO.js', names.embedded)
  await writeFile(join(root, 'client.js'), 'import {i as __require} from "./' + names.runtime + '";var f$2=' + EXCALIDRAW_REQUIRE_SHIM + ';export {f$2 as W};\n' + consumer)
  await writeFile(join(root, 'consumer.js'), "import {W as f} from './client.js'; function nodeOnly(){f(['fs'].join());f(['path'].join())}")
  await writeFile(join(root, 'elk.js'), 'import {i as __require} from "./' + names.runtime + '";export default (' + BROWSERIFY_DISPATCHER + ')()({1:[function(require,module,exports){module.exports=1},{}]}, {}, [1])(1)')
  const snapshot = async () => {
    const outputs = []
    for (const fileName of (await readdir(root)).sort()) {
      const code = await readFile(join(root, fileName), 'utf8')
      const kind = Object.keys(names).find(kind => names[kind] === fileName)
      const source = kind && kind !== 'runtime' ? join(directories[kind], parents[kind].manifest.entry) : '/fixture/' + fileName
      const id = kind === 'runtime' ? '\0rolldown/runtime.js' : source
      outputs.push(fileName.endsWith('.json') ? { type: 'asset', fileName, outDir: root, source: code }
        : { type: 'chunk', fileName, outDir: root, code, isEntry: fileName === 'client.js', isDynamicEntry: ['standalone', 'embedded'].includes(kind),
          facadeModuleId: kind === 'runtime' ? null : source, moduleIds: [id], modules: { [id]: { code: null, renderedLength: code.length, renderedExports: [], removedExports: [] } }, imports: [], dynamicImports: [] })
    }
    return captureOutputModuleMap('web', outputs, { workspaceRoot: process.cwd(), outputRoot: root })
  }
  const map = await snapshot()
  return { container, candidate, root, map, snapshot, manifest, saveManifest: () => writeFile(join(root, STATIC_PICA_MANIFEST), JSON.stringify(manifest)) }
}

async function associationFixture(t) {
  const f = await fixture(t), shared = dirname(f.root)
  await stageNativeInventoryFixture(shared)
  for (const directory of ['knowledge', 'bundles/flow_design/scripts']) await mkdir(join(shared, directory), { recursive: true })
  await writeFile(join(shared, 'scripts/design.mjs'), 'export default 1')
  await writeFile(join(shared, 'knowledge/runtime.mjs'), 'export default 1')
  await writeFile(join(shared, 'bundles/flow_design/scripts/layout.mjs'), 'export default 1')
  await writeFile(join(f.candidate, 'package.json'), '{"private":true,"dependencies":{}}')
  const emitted = await inspectStagedPayload(shared, {}, { webModuleMap: f.map })
  const inventory = await artifactInventory(f.candidate), pending = pendingRuntimeTasks(emitted)
  const report = { kind: 'same-source-exploratory-build', candidateAccepted: false, sameSourceBuildCompleted: true, sourceStable: true,
    workerTaskGate: 'runtime-evidence-required', dynamicClosureVerified: false, candidate: f.candidate, candidateInputs: inventory,
    candidateInventorySha256: inventorySha256(inventory), runtimeDependencies: {}, emittedModuleMaps: [f.map],
    pendingTasks: structuredClone(pending), staticUnknown: structuredClone(pending) }
  const options = { buildReportFile: join(f.container, 'synthetic-report.json') }
  const save = async () => { const bytes = JSON.stringify(report); await writeFile(options.buildReportFile, bytes); options.buildReportSha256 = sha256(bytes) }
  await save()
  return { ...f, report, options, save }
}

test('normal source-compiled parents use actual routes and retain two unexecuted runtime tasks', async t => {
  const f = await fixture(t)
  const web = await checkEmitted(f.root, new Set(), { knownBrowserShims: true, picaWorkerEvidenceRequired: true,
    embeddedImageEvidenceRequired: true, staticPicaModuleMap: f.map })
  const tasks = pendingRuntimeTasks({ web })
  assert.deepEqual(tasks.map(x => x.sourceKind).sort(), ['embedded', 'standalone'])
  assert.ok(tasks.every(x => x.parentWorkerBindingVerified && !x.browserExecutionVerified && !x.boundedWorkerTaskVerified && !x.dynamicClosureVerified))
  assert.ok(web.every(record => record.unverified.length === 0))
})

test('missing/duplicate source roles, status-only claims and Worker tampering reject even with fresh file hashes', async t => {
  for (const mutate of [
    f => f.manifest.sources.pop(),
    f => f.manifest.sources.splice(1, 1, f.manifest.sources[0]),
    f => { f.manifest.browserExecuted = true },
    f => { f.manifest.sources[0].manifest.installedHostAccepted = true },
    f => { f.manifest.sources[0].workers.task.code += '\nfetch("outside")' },
  ]) {
    const f = await fixture(t); mutate(f); await f.saveManifest()
    await assert.rejects(verifyStaticPicaEmission(f.root, { moduleMap: await f.snapshot() }))
  }
})

test('parent binding, consumer configuration, byte drift, missing files and duplicate artifacts remain guarded', async t => {
  const changes = [
    async f => { const p = join(f.root, names.standalone), before = await readFile(p, 'utf8'), after = before.replace('.task()', '.probe()'); assert.notEqual(before, after); await writeFile(p, after) },
    async f => {
      const p = join(f.root, names.standalone), code = await readFile(p, 'utf8'), found = []
      const walk = node => { if (node.type === 'Literal' && node.value === parents.standalone.scripts.task.code) found.push(node)
        for (const v of Object.values(node)) { if (Array.isArray(v)) v.filter(x => x?.type).forEach(walk); else if (v?.type) walk(v) } }
      walk(parseSync('mutated.js', code).program); assert.equal(found.length, 1)
      await writeFile(p, code.slice(0, found[0].start) + JSON.stringify(found[0].value + '\nfetch("outside")') + code.slice(found[0].end))
    },
    async f => { const p = join(f.root, 'client.js'); await writeFile(p, (await readFile(p, 'utf8')).replace('["js", "wasm"]', '["js", "ww"]')) },
    f => rm(join(f.root, names.embedded)),
    async f => writeFile(join(f.root, 'duplicate.js'), await readFile(join(f.root, names.standalone))),
  ]
  for (const mutate of changes) {
    const f = await fixture(t); await mutate(f)
    await assert.rejects(verifyStaticPicaEmission(f.root, { moduleMap: await f.snapshot() }))
  }
  const f = await fixture(t); await writeFile(join(f.root, names.standalone), emitted.standalone + '\n')
  await assert.rejects(verifyStaticPicaEmission(f.root, { moduleMap: f.map }), /drift/)
  await assert.rejects(verifyStaticPicaEmission(f.root), /module map/)
})

test('static pending tasks reject missing/duplicate/mixed legacy roles and fabricated runtime acceptance', async () => {
  const task = sourceKind => ({ file: sourceKind, unverified: [], runtimeEvidenceRequired: {
    kind: 'static-pica-worker-task', rule: 'pica-static-source-compiler-v1', sourceKind,
    parentWorkerBindingVerified: true, browserExecutionVerified: false, boundedWorkerTaskVerified: false, dynamicClosureVerified: false } })
  for (const web of [[task('standalone')], [task('standalone'), task('standalone')], [task('standalone'), { runtimeEvidenceRequired: { kind: 'injected-ui-blob-chain' } }]]) assert.throws(() => pendingRuntimeTasks({ web }))
  const web = [task('standalone'), task('embedded')]; web[0].runtimeEvidenceRequired.browserExecutionVerified = true
  assert.throws(() => pendingRuntimeTasks({ web }))
  assert.throws(() => pendingRuntimeTasks({ web: [task('standalone'), task('embedded')] }, false), /Legacy/)
})

test('source-bound dispatcher proof cannot authorize different bytes or unrelated unknown imports', async t => {
  const f = await fixture(t), proof = await verifyStaticPicaEmission(f.root, { moduleMap: f.map })
  const code = await readFile(join(f.root, names.embedded), 'utf8')
  assert.throws(() => analyzeEmittedLoaders(code + '\n', proof.loaderProofs[names.embedded]), /source changed/)
  await writeFile(join(f.root, 'unknown.js'), 'const loader = require; loader(dynamicName)')
  await assert.rejects(checkEmitted(f.root, new Set(), { knownBrowserShims: true, picaWorkerEvidenceRequired: true,
    embeddedImageEvidenceRequired: true, staticPicaModuleMap: await f.snapshot() }), /Unverified/)
})

test('a static emission cannot mix in a legacy embedded artifact', async t => {
  const f = await fixture(t)
  await writeFile(join(f.root, 'legacy-image.js'), await readFile(new URL('./test-fixtures/embedded-image-loader/image-blob-reduce.esm.js', import.meta.url)))
  await assert.rejects(checkEmitted(f.root, new Set(), { knownBrowserShims: true, picaWorkerEvidenceRequired: true,
    embeddedImageEvidenceRequired: true, staticPicaModuleMap: await f.snapshot() }), /Static Pica cannot mix/)
})

test('the release post-build association entry reuses its captured map without promoting runtime acceptance', async t => {
  const f = await associationFixture(t), result = await verifyStagedUiCandidateAssociations(f.options)
  assert.equal(result.evidenceAssociationsVerified, true)
  assert.deepEqual(result.pendingTasks, result.staticUnknown)
  assert.deepEqual(result.pendingTasks.map(task => task.sourceKind).sort(), ['embedded', 'standalone'])
  for (const key of ['browserExecutionVerified', 'candidateAccepted', 'dynamicClosureVerified', 'publishReady']) assert.equal(result[key], false)
})

test('post-build associations reject map/projection drift, duplicate maps and missing map even after a new report hash', async t => {
  for (const [mutate, expected] of [
    [f => { f.report.pendingTasks[0].artifactSha256 = '0'.repeat(64) }, /Pending task association drift/],
    [f => { f.report.emittedModuleMaps[0].outputs.find(row => row.fileName === names.standalone).sha256 = '0'.repeat(64) }, /Emitted output hash drift/],
    [f => { f.report.emittedModuleMaps.push(structuredClone(f.map)) }, /Duplicate web module map/],
    [f => { f.report.emittedModuleMaps = [] }, /captured web module map/],
  ]) {
    const f = await associationFixture(t); mutate(f); await f.save()
    await assert.rejects(verifyStagedUiCandidateAssociations(f.options), expected)
  }
})
