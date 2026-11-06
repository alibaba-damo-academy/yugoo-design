import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { parse } from 'yaml'
import { PREBUILT_EMBEDDING_INPUTS, prebuiltEmbeddingManifest, selectEmbeddingMember, verifyEmbeddingArchive, stagePrebuiltEmbedding } from './prebuilt-embedding-runtime.mjs'

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
