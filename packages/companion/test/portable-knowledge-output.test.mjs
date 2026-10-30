import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { packageKnowledge } from '../package-knowledge.mjs'
import { readOfficialDshJsonInput } from '../../../scripts/official-dsh-json-input.mjs'

const dependencies = () => ({ '@ladybugdb/wasm-core': 'npm:@fixture-design-release/ladybug-wasm-core@0.19.1-walfix.1', '@huggingface/transformers': '3.8.1', 'onnxruntime-common': '1.21.0', undici: '8.10.2' })
async function setup(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'portable knowledge output '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const calls = []
  const buildImpl = async config => {
    calls.push(config)
    for (const name of Object.keys(config.entry)) await writeFile(join(config.outDir, `${name}.mjs`), `export const fixture = ${JSON.stringify(name)}\n`)
  }
  return { root, calls, buildImpl, options: { mode: 'portable', outputDirectory: join(root, 'new explicit output with spaces'), runtimeDependencies: dependencies(), buildImpl } }
}

test('portable mode compiles runtime and worker through the build adapter and records an external closure without copying packages', async t => {
  const { calls, options } = await setup(t)
  const result = await packageKnowledge(undefined, options)
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(c => Object.keys(c.entry)), [['runtime'], ['embedding-worker'], ['cli-lifecycle']])
  for (const call of calls) assert.equal(call.outDir, options.outputDirectory)
  const input = await readOfficialDshJsonInput()
  assert.equal(calls[0].plugins[0].resolveId('@deepseek-ai/dsh-session'), input.jsonPath)
  assert.throws(() => calls[0].plugins[0].resolveId('@deepseek-ai/dsh-tools'), /must not load DSH runtime/u)
  assert.ok(calls[0].deps.neverBundle.some(pattern => pattern.test('@ladybugdb/wasm-core/nodejs')))
  for (const name of ['@huggingface/transformers', 'undici']) assert.ok(calls[1].deps.neverBundle.some(pattern => pattern.test(name)))
  assert.ok(calls[2].entry['cli-lifecycle'].endsWith('/companion/src/cli-lifecycle.mjs'))
  assert.ok(calls[2].deps.neverBundle.some(pattern => pattern.test('@ladybugdb/wasm-core/nodejs')))
  assert.deepEqual((await readdir(result.destination)).sort(), ['cli-lifecycle.mjs', 'embedding-worker.js', 'embedding-worker.mjs', 'package.json', 'runtime-manifest.json', 'runtime.mjs'].sort())
  assert.deepEqual(await readFile(join(result.destination, 'embedding-worker.js')), await readFile(join(result.destination, 'embedding-worker.mjs')))
  assert.deepEqual(result.manifest.runtimeDependencies, options.runtimeDependencies)
  assert.equal(result.manifest.buildAdapter, 'injected')
  assert.equal(result.manifest.copiedNodeModules, false)
  assert.equal(result.manifest.publishReady, false)
  assert.equal(result.manifest.nativeDependenciesVerified, false)
  assert.equal(result.manifest.dependencyLicensesVerified, false)
  assert.deepEqual(result.manifest.platformsVerified, [])
  for (const [name, expected] of Object.entries(result.manifest.assets)) assert.equal(createHash('sha256').update(await readFile(join(result.destination, name))).digest('hex'), expected)
  assert.deepEqual(JSON.parse(await readFile(join(result.destination, 'runtime-manifest.json'))), result.manifest)
})

test('portable official dependency remains exact in the recorded closure', async t => {
  const { options } = await setup(t)
  const runtimeDependencies = { ...dependencies(), '@ladybugdb/wasm-core': '0.21.1' }
  const result = await packageKnowledge(undefined, { ...options, runtimeDependencies })
  assert.deepEqual(result.manifest.runtimeDependencies, runtimeDependencies)
  assert.equal(result.manifest.copiedNodeModules, false)
  assert.equal(result.manifest.publishReady, false)
  assert.deepEqual(JSON.parse(await readFile(join(result.destination, 'runtime-manifest.json'))).runtimeDependencies, runtimeDependencies)
})

test('portable product closure preserves the template system-trash pin without copying its package', async t => {
  const { options, calls } = await setup(t)
  const original = JSON.parse(await readFile(new URL('../../../release/product-package-template.json', import.meta.url))).dependencies
  const expected = { ...original }
  const pending = packageKnowledge(undefined, { ...options, runtimeDependencies: original })
  original.trash = 'latest'
  const result = await pending
  assert.deepEqual(result.manifest.runtimeDependencies, expected)
  assert.equal(result.manifest.copiedNodeModules, false)
  assert.equal(calls.length, 3)
  for (const trash of [undefined, null, 'latest', '^' + expected.trash, '0.0.0']) {
    await assert.rejects(packageKnowledge(undefined, { ...options, runtimeDependencies: { ...expected, trash } }), /Unsupported portable dependency version: trash/)
  }
  assert.equal(calls.length, 3, 'invalid declarations stop before compilation')
})

test('normal portable compilation bundles the private diagnostic helper inside the existing assets', async t => {
  const { checkEmitted } = await import('../../../scripts/emitted-loader-check.mjs')
  const root = await mkdtemp(join(await realpath(tmpdir()), 'portable diagnostic build '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const runtimeDependencies = { ...dependencies(), '@ladybugdb/wasm-core': '0.21.1' }
  const result = await packageKnowledge(undefined, { mode: 'portable', outputDirectory: join(root, 'knowledge'), runtimeDependencies })
  assert.equal(result.manifest.buildAdapter, 'tsdown')
  assert.deepEqual(Object.keys(result.manifest.assets).sort(), ['cli-lifecycle.mjs', 'embedding-worker.js', 'embedding-worker.mjs', 'package.json', 'runtime.mjs'].sort())
  for (const name of ['runtime.mjs', 'embedding-worker.js', 'embedding-worker.mjs']) {
    const code = await readFile(join(result.destination, name), 'utf8')
    assert.match(code, /UNABLE_TO_VERIFY_LEAF_SIGNATURE/)
  }
  const records = await checkEmitted(result.destination, new Set(Object.keys(runtimeDependencies)))
  assert.ok(records.length >= 4)
  assert.ok(records.every(record => record.unverified.length === 0))
  // Inspect parsed loader nodes: bundled dependency JSDoc may contain import('*.d.ts').
  assert.ok(records.every(record => [...record.loads, ...record.resolveOnly].every(load =>
    typeof load.source !== 'string' || (!load.source.includes('embedding-diagnostic') && !/\.tsx?$/.test(load.source)))),
  'private helpers must not become runtime source loaders')
  assert.equal(result.manifest.modelIncluded, false)
  assert.equal(result.manifest.publishReady, false)
})

test('portable destinations are exclusive, absolute, outside source and cannot be mixed with a directory target', async t => {
  const { options } = await setup(t)
  await packageKnowledge(undefined, options)
  await assert.rejects(packageKnowledge(undefined, options), { code: 'EEXIST' })
  await assert.rejects(packageKnowledge('some-target', options), /only its explicit outputDirectory/u)
  await assert.rejects(packageKnowledge(undefined, { ...options, outputDirectory: 'relative-output' }), /absolute outputDirectory/u)
  await assert.rejects(packageKnowledge(undefined, { ...options, outputDirectory: join(fileURLToPath(new URL('../', import.meta.url)), 'should-not-write') }), /outside the source workspace/u)
})

test('missing, unknown or unpinned runtime deps are rejected before calling the build adapter', async t => {
  const { options, calls } = await setup(t)
  const bad = [undefined, {}, { ...dependencies(), unknown: '1.0.0' }, { ...dependencies(), undici: '8.10.0' }, { ...dependencies(), undici: '^8.10.2' }, { ...dependencies(), 'onnxruntime-common': 'latest' }, { ...dependencies(), '@ladybugdb/wasm-core': 'file:../../vendor/ladybug/runtime' }, { ...dependencies(), '@ladybugdb/wasm-core': 'npm:@fixture/ladybug@^0.19.1' }]
  for (const runtimeDependencies of bad) await assert.rejects(packageKnowledge(undefined, { ...options, runtimeDependencies }))
  assert.equal(calls.length, 0)
})

test('declared dependencies are snapshotted before asynchronous compilation', async t => {
  const { options, buildImpl } = await setup(t)
  const original = dependencies()
  const result = await packageKnowledge(undefined, { ...options, runtimeDependencies: original, buildImpl: async config => { original.undici = 'latest'; await buildImpl(config) } })
  assert.equal(result.manifest.runtimeDependencies.undici, '8.10.2')
})

test('default directory mode retains its knowledge subdirectory and rejects portable-only overrides', async t => {
  const { root, options } = await setup(t)
  const target = join(root, 'existing-format'); await mkdir(target)
  let observed
  await assert.rejects(packageKnowledge(target, { buildImpl: async config => { observed = config; throw new Error('stop before real compilation or dependency copying') } }), /stop before real compilation/u)
  assert.equal(observed.outDir, join(target, 'knowledge'))
  assert.deepEqual(await readdir(target), ['knowledge'])
  await assert.rejects(packageKnowledge(target, { outputDirectory: options.outputDirectory }), /does not accept outputDirectory/u)
  await assert.rejects(packageKnowledge(target, { runtimeDependencies: dependencies() }), /retains its installed dependency closure/u)
  await assert.rejects(packageKnowledge(target, { mode: 'unknown' }), /Unknown knowledge output mode/u)
})

test('directory packaging emits the same standalone lifecycle asset before dependency copying', async t => {
  const { root, buildImpl } = await setup(t)
  const target = join(root, 'directory asset boundary'); await mkdir(target)
  const entries = []
  await assert.rejects(packageKnowledge(target, {buildImpl:async config => {
    entries.push(Object.keys(config.entry))
    await buildImpl(config)
    if (Object.hasOwn(config.entry, 'cli-lifecycle')) throw Error('stop before dependency copying')
  }}), /stop before dependency copying/)
  assert.deepEqual(entries, [['runtime'], ['embedding-worker'], ['cli-lifecycle']])
  assert.match(await readFile(join(target, 'knowledge/cli-lifecycle.mjs'), 'utf8'), /cli-lifecycle/)
  await assert.rejects(readFile(join(target, 'knowledge/node_modules/@ladybugdb/wasm-core/package.json')), {code:'ENOENT'})
})

test('portable compilation failure or unexpected dependency directories never produces a success manifest', async t => {
  const { options, buildImpl } = await setup(t)
  await assert.rejects(packageKnowledge(undefined, { ...options, buildImpl: async () => { throw new Error('compiler failure') } }), /compiler failure/u)
  await assert.rejects(readFile(join(options.outputDirectory, 'runtime-manifest.json')), { code: 'ENOENT' })
  await rm(options.outputDirectory, { recursive: true })
  await assert.rejects(packageKnowledge(undefined, { ...options, buildImpl: async config => { await buildImpl(config); await mkdir(join(config.outDir, 'node_modules'), { recursive: true }) } }), /no copied dependency directories/u)
  await assert.rejects(readFile(join(options.outputDirectory, 'runtime-manifest.json')), { code: 'ENOENT' })
})
