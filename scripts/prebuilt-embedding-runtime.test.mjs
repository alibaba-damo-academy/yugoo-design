import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { parse } from 'yaml'
import { PREBUILT_EMBEDDING_INPUTS, prebuiltEmbeddingManifest, projectPrebuiltDependencyManifest, selectEmbeddingMember, verifyEmbeddingArchive, stagePrebuiltEmbedding } from './prebuilt-embedding-runtime.mjs'

test('prebuilt manifest projection removes install lifecycles and records changes without altering runtime metadata', () => {
  const input = PREBUILT_EMBEDDING_INPUTS.find(item => item.name === 'onnxruntime-node')
  const original = { name: input.name, version: input.version, main: 'dist/index.js', license: 'MIT',
    dependencies: { 'onnxruntime-common': '1.21.0' },
    scripts: { preinstall: 'before', install: 'build', postinstall: 'download', prepublish: 'compile',
      preprepare: 'before-compile', prepare: 'compile', postprepare: 'after-compile', test: 'test', build: 'manual-build' } }
  const raw = Buffer.from(JSON.stringify(original)), before = Buffer.from(raw)
  const result = projectPrebuiltDependencyManifest(input, raw), packaged = JSON.parse(result.bytes)
  assert.deepEqual(raw, before)
  assert.deepEqual(packaged, { ...original, scripts: { test: 'test', build: 'manual-build' } })
  assert.deepEqual(Object.keys(result.projection.removedScripts), ['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare'])
  for (const name of Object.keys(result.projection.removedScripts)) assert.equal(result.projection.removedScripts[name], original.scripts[name])
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  assert.equal(result.projection.originalSha256, hash(raw))
  assert.equal(result.projection.packagedSha256, hash(result.bytes))
  assert.throws(() => projectPrebuiltDependencyManifest({ ...input }, raw), /Reviewed registry input/)
  assert.throws(() => projectPrebuiltDependencyManifest(input, Buffer.from(JSON.stringify({ ...original, version: '0.0.0' }))))
  const untouched = Buffer.from(JSON.stringify({ ...original, scripts: { build: 'manual-build' } }, null, 4) + '\n')
  assert.deepEqual(projectPrebuiltDependencyManifest(input, untouched).bytes, untouched)
})

test('npm may rebuild bundled dependencies, but the prebuilt projection cannot run their install hooks', async t => {
  const root = await mkdtemp(join(tmpdir(), 'prebuilt-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const input = PREBUILT_EMBEDDING_INPUTS.find(item => item.name === 'onnxruntime-node')
  const dependency = join(root, 'node_modules', input.name)
  await mkdir(dependency, { recursive: true })
  await writeFile(join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { [input.name]: input.version }, bundledDependencies: [input.name] }))
  const raw = Buffer.from(JSON.stringify({ name: input.name, version: input.version, scripts: { postinstall: 'node -e "process.exit(42)"' } }))
  const manifestPath = join(dependency, 'package.json')
  await writeFile(manifestPath, raw)
  const userconfig = join(root, 'user.npmrc'), globalconfig = join(root, 'global.npmrc')
  await writeFile(userconfig, ''); await writeFile(globalconfig, '')
  const npmCli = process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    : resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  const run = () => spawnSync(process.execPath, [npmCli, 'rebuild', '--offline', '--ignore-scripts=false', '--foreground-scripts', '--no-audit', '--no-fund',
    '--userconfig', userconfig, '--globalconfig', globalconfig, '--cache', join(root, 'cache')], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  })
  const before = run()
  assert.equal(before.status, 42, before.stderr)
  assert.match(before.stdout + before.stderr, /process.exit\(42\)/u)
  await writeFile(manifestPath, projectPrebuiltDependencyManifest(input, raw).bytes)
  const after = run()
  assert.equal(after.status, 0, after.stderr)
  assert.doesNotMatch(after.stdout + after.stderr, /process.exit\(42\)/u)
})

test('registry inputs remain exactly bound to the checked-in dependency lock', async () => {
  const lock = parse(await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'))
  for (const input of PREBUILT_EMBEDDING_INPUTS)
    assert.equal(input.integrity, lock.packages[input.name + '@' + input.version].resolution.integrity)
})

test('release projection owns scripts while preserving unrelated dependency and package metadata', () => {
  const original = { name: 'example', dependencies: { '@huggingface/transformers': '3.8.1', existing: '2.0.0' },
    peerDependencies: { host: '^4.0.0' }, files: ['lib'], optionalDependencies: { existing: '1.0.0' } }
  const before = structuredClone(original), result = prebuiltEmbeddingManifest(original)
  assert.deepEqual(original, before)
  assert.equal(result.dependencies.existing, '2.0.0')
  assert.deepEqual(result.peerDependencies, before.peerDependencies)
  assert.equal(result.optionalDependencies.existing, '1.0.0')
  assert.equal(result.optionalDependencies['@img/sharp-win32-x64'], '0.34.5')
  assert.equal(result.optionalDependencies['@img/sharp-libvips-darwin-arm64'], '1.2.4')
  assert.equal(result.dependencies['onnxruntime-common'], '1.21.0')
  assert.deepEqual(result.bundledDependencies, ['@huggingface/transformers', 'onnxruntime-node', 'sharp'])
  assert.equal(result.dependencies['onnxruntime-web'], undefined)
  assert.equal(result.dependencies.protobufjs, undefined)
  assert.equal(result.scripts, undefined)
  assert.throws(() => prebuiltEmbeddingManifest({ dependencies: { '@huggingface/transformers': '4.0.0' } }), /reviewed/i)
  assert.throws(() => prebuiltEmbeddingManifest({ dependencies: { '@huggingface/transformers': '3.8.1', 'onnxruntime-common': '2.0.0' } }), /Conflicting/)
})

test('prebuilt selection keeps the Node entry and three CPU platforms, excludes browser/CUDA acquisition paths', () => {
  for (const path of ['package.json', 'LICENSE', 'README.md', 'types/models.d.ts', 'dist/transformers.node.mjs', 'dist/transformers.node.cjs.map'])
    assert.equal(selectEmbeddingMember('@huggingface/transformers', 'package/' + path), true)
  for (const path of ['src/transformers.js', 'dist/transformers.web.js', 'dist/ort-wasm.wasm'])
    assert.equal(selectEmbeddingMember('@huggingface/transformers', 'package/' + path), false)
  for (const platform of ['linux/x64', 'win32/x64', 'darwin/arm64'])
    assert.equal(selectEmbeddingMember('onnxruntime-node', 'package/bin/napi-v3/' + platform + '/onnxruntime_binding.node'), true)
  for (const platform of ['darwin/x64', 'linux/arm64', 'win32/arm64'])
    assert.equal(selectEmbeddingMember('onnxruntime-node', 'package/bin/napi-v3/' + platform + '/onnxruntime_binding.node'), false)
  assert.equal(selectEmbeddingMember('onnxruntime-node', 'package/dist/index.js'), true)
  assert.equal(selectEmbeddingMember('sharp', 'package/LICENSE'), true)
  for (const path of ['/package/escape', 'package/../escape', 'package/dir/../../escape', 'package\\escape'])
    assert.throws(() => selectEmbeddingMember('sharp', path), /archive/)
})

test('corrupt registry inputs and an existing local installation cannot enter release staging', async t => {
  for (const input of PREBUILT_EMBEDDING_INPUTS) assert.throws(() => verifyEmbeddingArchive(input, Buffer.from('changed')), /integrity differs/)
  assert.throws(() => verifyEmbeddingArchive({ ...PREBUILT_EMBEDDING_INPUTS[0] }, Buffer.alloc(0)), /Reviewed registry/)
  const target = await mkdtemp(join(tmpdir(), 'embedding-staging-test-'))
  t.after(() => rm(target, { recursive: true, force: true }))
  await mkdir(join(target, 'node_modules'))
  await assert.rejects(stagePrebuiltEmbedding({ target }), { code: 'EEXIST' })
})
