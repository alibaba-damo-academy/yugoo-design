import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareEmbeddingAssetSet, modelProxyOptions, embeddingChildEnvironment, EmbeddingAssetError } from '../src/embedding-model-assets.ts'

const bytes = Buffer.from('0123456789')
const asset = { path: 'model.bin', bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), kind: 'sha256' }
const response = (body, status = 200, range) => ({ status, headers: new Headers(range ? { 'content-range': range } : {}), body: (async function* () { yield body })() })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'embedding-assets-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, asset.path)
  const run = (request, localOnly = false, signal = new AbortController().signal) => prepareEmbeddingAssetSet(root, [asset], localOnly, { signal, fetch: request, baseUrl: 'https://model.invalid/fixed' })
  return { root, target, run }
}
const code = expected => error => error instanceof EmbeddingAssetError && error.code === expected

test('verified offline assets do not create a network dispatcher or request', async t => {
  const f = await fixture(t); await writeFile(f.target, bytes)
  await f.run(() => assert.fail('verified cache must stay offline'), true)
  assert.deepEqual(await readFile(f.target), bytes)
})

test('small configuration assets use their pinned Git blob hash rather than raw-byte SHA-1', async t => {
  const f = await fixture(t); await writeFile(f.target, bytes)
  const gitAsset = { ...asset, kind: 'git-blob-sha1', hash: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') }
  await prepareEmbeddingAssetSet(f.root, [gitAsset], true, { signal: new AbortController().signal, baseUrl: 'https://model.invalid/fixed', fetch: () => assert.fail('verified Git blob must stay offline') })
})

test('offline missing/partial resources fail before any model or network work', async t => {
  for (const value of [undefined, bytes.subarray(0, 4)]) await t.test(String(value?.length), async t => {
    const f = await fixture(t); if (value) await writeFile(f.target, value)
    await assert.rejects(f.run(() => assert.fail('offline must not fetch'), true), code('missing'))
    if (value) assert.deepEqual(await readFile(f.target), value)
  })
})

test('interrupted transfer preserves canonical bytes and resumes only on an explicit new pass', async t => {
  const f = await fixture(t); await writeFile(f.target, bytes.subarray(0, 4))
  let requests = 0
  await assert.rejects(f.run(async (_url, options) => {
    requests++; assert.equal(options.headers.Range, 'bytes=4-')
    return { status: 206, headers: new Headers({ 'content-range': 'bytes 4-9/10' }), body: (async function* () { yield bytes.subarray(4, 6); throw Error('PRIVATE_URL?token=PRIVATE') })() }
  }), code('download'))
  assert.equal(requests, 1)
  assert.deepEqual(await readFile(f.target), bytes.subarray(0, 4))
  assert.deepEqual(await readFile(f.target + '.yugoo-download.part'), bytes.subarray(0, 6))
  await f.run(async (_url, options) => {
    requests++; assert.equal(options.headers.Range, 'bytes=6-')
    return response(bytes.subarray(6), 206, 'bytes 6-9/10')
  })
  assert.equal(requests, 2); assert.deepEqual(await readFile(f.target), bytes)
  const rejected = (await readdir(f.root)).find(name => name.includes('.rejected-'))
  assert.deepEqual(await readFile(join(f.root, rejected)), bytes.subarray(0, 4))
  await assert.rejects(readFile(f.target + '.yugoo-download.part'), { code: 'ENOENT' })
})

test('a server ignoring Range restarts staging, then promotes only checksum-verified bytes', async t => {
  const f = await fixture(t); await writeFile(f.target, bytes.subarray(0, 3))
  await f.run(async (_url, options) => { assert.equal(options.headers.Range, 'bytes=3-'); return response(bytes) })
  assert.deepEqual(await readFile(f.target), bytes)
})

test('wrong Content-Range, excess bytes and wrong checksum never publish or retry', async t => {
  for (const [name, value, expected] of [
    ['range', response(bytes.subarray(3), 206, 'bytes 2-9/10'), 'download'],
    ['size', response(Buffer.alloc(11)), 'integrity'],
    ['hash', response(Buffer.from('XXXXXXXXXX')), 'integrity'],
  ]) await t.test(name, async t => {
    const f = await fixture(t); await writeFile(f.target, bytes.subarray(0, 3)); let requests = 0
    await assert.rejects(f.run(async () => { requests++; return value }), code(expected))
    assert.equal(requests, 1); assert.deepEqual(await readFile(f.target), bytes.subarray(0, 3))
  })
})

test('same-sized corrupt cached bytes are replaced only after full verification', async t => {
  const f = await fixture(t); const bad = Buffer.from('XXXXXXXXXX'); await writeFile(f.target, bad)
  await f.run(async (_url, options) => { assert.equal(options.headers.Range, undefined); return response(bytes) })
  assert.deepEqual(await readFile(f.target), bytes)
  const rejected = (await readdir(f.root)).find(name => name.includes('.rejected-'))
  assert.deepEqual(await readFile(join(f.root, rejected)), bad)
})

test('abort keeps staging for a later explicit pass and never promotes it', async t => {
  const f = await fixture(t); const abort = new AbortController()
  await assert.rejects(f.run(async () => ({ status: 200, headers: new Headers(), body: (async function* () { yield bytes.subarray(0, 4); abort.abort(); yield bytes.subarray(4) })() }), false, abort.signal), { name: 'AbortError' })
  await assert.rejects(readFile(f.target), { code: 'ENOENT' })
  assert.deepEqual(await readFile(f.target + '.yugoo-download.part'), bytes.subarray(0, 4))
})

test('a concurrent owner cannot start a second resource request', async t => {
  const f = await fixture(t)
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const first = f.run(async () => { entered(); await gate; return response(bytes) })
  await started
  try { await assert.rejects(f.run(() => assert.fail('second owner must not fetch')), code('busy')) }
  finally { release(); await first }
})

test('a cache-file symlink cannot redirect a model write', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t); const outside = join(f.root, 'untouched')
  await writeFile(outside, 'private'); await symlink(outside, f.target)
  await assert.rejects(f.run(() => assert.fail('unsafe cache must not fetch')), code('integrity'))
  assert.equal(await readFile(outside, 'utf8'), 'private')
})

test('macOS manual proxy applies only when an explicit process proxy is absent', () => {
  const system = '<dictionary> {\n HTTPSEnable : 1\n HTTPSProxy : 127.0.0.1\n HTTPSPort : 7890\n ExceptionsList : <array> {\n 0 : *.local\n 1 : localhost\n }\n}'
  assert.deepEqual(modelProxyOptions('darwin', {}, system), { httpsProxy: 'http://127.0.0.1:7890', noProxy: '*.local,localhost' })
  assert.equal(modelProxyOptions('darwin', { HTTPS_PROXY: 'explicit' }, system), undefined)
  assert.equal(modelProxyOptions('linux', {}, system), undefined)
  assert.equal(modelProxyOptions('darwin', {}, 'HTTPSEnable : 0'), undefined)
  assert.deepEqual(modelProxyOptions('darwin', { NO_PROXY: '*' }, system), { httpsProxy: 'http://127.0.0.1:7890' })
  assert.throws(() => modelProxyOptions('darwin', {}, system.replace('127.0.0.1', 'user:PRIVATE@host')), code('download'))
})

test('system proxy is inherited only by the model child without mutating its parent environment', async () => {
  const env = { KEEP: 'unchanged', NO_PROXY: 'explicit.local' }
  const system = 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890\n'
  const child = await embeddingChildEnvironment({ platform: 'darwin', env, readSystem: async () => system })
  assert.deepEqual(env, { KEEP: 'unchanged', NO_PROXY: 'explicit.local' })
  assert.deepEqual(child, { ...env, HTTPS_PROXY: 'http://127.0.0.1:7890' })
  const unreachable = async () => assert.fail('explicit proxy and non-Mac do not inspect OS proxy settings')
  assert.equal(await embeddingChildEnvironment({ platform: 'darwin', env: { HTTPS_PROXY: 'explicit' }, readSystem: unreachable }), undefined)
  assert.equal(await embeddingChildEnvironment({ platform: 'linux', env: {}, readSystem: unreachable }), undefined)
  await assert.rejects(embeddingChildEnvironment({ platform: 'darwin', env: {}, readSystem: async () => { throw Error('PRIVATE_PATH') } }), code('download'))
})

test('explicit empty proxy values preserve Undici lowercase-nullish precedence without reading macOS settings', async t => {
  const system = 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890\n'
  for (const env of [
    { https_proxy: '' }, { HTTPS_PROXY: '' }, { http_proxy: '' }, { HTTP_PROXY: '' },
    { https_proxy: '', HTTPS_PROXY: 'http://upper.invalid' },
    { http_proxy: '', HTTP_PROXY: 'http://upper.invalid' },
    { https_proxy: 'http://lower.invalid', HTTPS_PROXY: '' },
  ]) await t.test(JSON.stringify(env), async () => {
    const before = { ...env }
    assert.equal(modelProxyOptions('darwin', env, system), undefined)
    assert.equal(await embeddingChildEnvironment({ platform: 'darwin', env, readSystem: async () => assert.fail('explicit empty is configured') }), undefined)
    assert.deepEqual(env, before)
  })
})

test('downloader and model child retain identical explicit empty and mixed-case bypass values', async t => {
  const system = 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7890\nExceptionsList : <array> {\n0 : *.local\n}\n'
  for (const env of [
    { no_proxy: '' }, { NO_PROXY: '' },
    { no_proxy: '', NO_PROXY: '*.upper.invalid' },
    { no_proxy: '*.lower.invalid', NO_PROXY: '' },
    {},
  ]) await t.test(JSON.stringify(env), async () => {
    const before = { ...env }, options = modelProxyOptions('darwin', env, system)
    const child = await embeddingChildEnvironment({ platform: 'darwin', env, readSystem: async () => system })
    // The exact nullish precedence in Undici 8.10.2 EnvHttpProxyAgent.
    const downloadBypass = options.noProxy ?? env.no_proxy ?? env.NO_PROXY ?? ''
    const childBypass = child.no_proxy ?? child.NO_PROXY ?? ''
    assert.equal(downloadBypass, childBypass)
    assert.equal(options.httpsProxy ?? env.https_proxy ?? env.HTTPS_PROXY, child.https_proxy ?? child.HTTPS_PROXY)
    assert.deepEqual(env, before)
  })
})
