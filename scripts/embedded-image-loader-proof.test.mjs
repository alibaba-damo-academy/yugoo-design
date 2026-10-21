import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyzeEmittedLoaders, BROWSERIFY_DISPATCHER, checkEmitted } from './emitted-loader-check.mjs'
import { proveEmbeddedImageLoader } from './embedded-image-loader-proof.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const fixture = new URL('./test-fixtures/embedded-image-loader/image-blob-reduce.esm.js', import.meta.url)
const parse = code => { const result = parseSync('image.js', code); assert.equal(result.errors.length, 0); return result.program }
const shape = node => JSON.stringify(node, (key, value) => ['start', 'end', 'loc', 'raw', 'comments', 'leadingComments', 'trailingComments'].includes(key) ? undefined : value)
const tools = { parse, shape, dispatcher: BROWSERIFY_DISPATCHER }

test('fixed embedded table maps resolve while all three dynamic Worker findings remain', async () => {
  const code = await readFile(fixture, 'utf8')
  assert.equal(analyzeEmittedLoaders(code).unverified.length, 29)
  const proof = proveEmbeddedImageLoader(code, tools)
  assert.deepEqual(proof.skip, [])
  const result = analyzeEmittedLoaders(code, proof)
  assert.equal(result.browserify.length, 1); assert.equal(result.browserify[0].modules.length, 25)
  assert.equal(result.internalLoads.length, 29)
  assert.deepEqual(result.unverified, proof.proof[0].staticUnknown)
  assert.equal(result.unverified.length, 3)
  assert.equal(result.knownEmbeddedImageProofs[0].boundedImageTaskVerified, false)
  assert.equal(result.dynamicClosureVerified, false)
})

test('changed fallback, wrapper, factory, mapping and surrounding escapes never match pins', async () => {
  const code = await readFile(fixture, 'utf8')
  const mutations = [
    code.replace('throw new Error("Could not dynamically require', 'return fetch("Could not dynamically require'),
    code.replace('return fn(module, module.exports)', 'return malicious(module, module.exports)'),
    code.replace('arguments[3]', 'arguments[6]'),
    code.replace('"./mathlib": 1', '"./mathlib": 2'),
    code + ';const alias=commonjsRequire', code + ';__require(unknown)',
    code.replace('commonjsRequire && commonjsRequire', 'externalRequire && externalRequire'),
  ]
  for (const changed of mutations) {
    assert.notEqual(changed, code)
    assert.throws(() => proveEmbeddedImageLoader(changed, tools), /Unreviewed embedded/)
  }
})

test('staging errors name the actual unknown file instead of misattributing it to pica', async t => {
  const root = await mkdtemp(join(tmpdir(), 'embedded-image-error-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'image-blob-reduce.esm.js')
  await writeFile(file, await readFile(fixture))
  await assert.rejects(checkEmitted(root, new Set(), { knownBrowserShims: true, picaWorkerEvidenceRequired: true }), error => {
    assert.ok(error.message.includes(file))
    assert.match(error.message, /Unknown locally bound loader/)
    assert.ok(!error.message.includes('Unreviewed pica artifact'))
    return true
  })
  await writeFile(file, "const alias=require;alias('unknown')")
  await assert.rejects(checkEmitted(root, new Set(), { knownBrowserShims: true, picaWorkerEvidenceRequired: true }), error => error.message.includes(file) && error.message.includes('Unverified emitted loader'))
})
