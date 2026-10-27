import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, access, realpath, cp, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { NATIVE_DONOR, DARWIN_NATIVE_INPUT, stageNativeDonor, verifyNativeDonorInheritance, downloadDarwinNativeInput, acquireNativeInputs } from './companion-release-native-donor.mjs'
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
test('product runtime consumer rejects outputs inside the checkout', () => {
 const helper=fileURLToPath(new URL('./check-product-node-runtime.mjs',import.meta.url));
 for(const output of [fileURLToPath(new URL('../',import.meta.url)),fileURLToPath(new URL('../..consumer-fixture',import.meta.url))]){
  const result=spawnSync(process.execPath,[helper,fileURLToPath(import.meta.url),'0.1.0',output],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/Install output must be outside the checkout/u);
 }
})
test('only reviewed exact native dependency versions are permitted; denials survive', async () => {
  const { allowBuilds } = YAML.parse(await read('pnpm-workspace.yaml'))
  for (const name of ['@deepseek-ai/dsh-subprocess-local@0.2.0-rc.2', 'koffi@3.1.1', 'node-pty@1.2.0-beta.15', 'esbuild@0.28.2']) assert.equal(allowBuilds[name], true)
  for (const name of ['@deepseek-ai/dsh-subprocess-local', 'koffi', 'node-pty', 'koffi@3.1.2', 'node-pty@1.2.0-beta.16', '@deepseek-ai/dsh-subprocess-local@0.2.0-rc.3']) assert.equal(allowBuilds[name], undefined)
  for (const name of ['onnxruntime-node', 'protobufjs', 'sharp']) assert.equal(allowBuilds[name], false)
})

const nativeWorkspace = fileURLToPath(new URL('../', import.meta.url))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const historicalSource = () => readFile(new URL('./test-fixtures/native-donor-beta16-SOURCE.json', import.meta.url))
const nativeSource = () => readFile(new URL('../packages/git-native/SOURCE.json', import.meta.url))
async function mockNativeSource(t, body = Buffer.from('mock Darwin bytes; no ABI claim')) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-input-http-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = JSON.parse(await nativeSource())
  Object.assign(source.artifacts.find(item => item.path === DARWIN_NATIVE_INPUT.path), { bytes: body.length, sha256: hash(body) })
  const directory = join(root, 'packages/git-native')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SOURCE.json'), JSON.stringify(source))
  return { root, source, body, destination: join(root, 'artifacts') }
}
test('historical donor SOURCE is an exact archive identity and current artifacts inherit whole declarations', async () => {
  const old = await historicalSource(), current = await nativeSource()
  assert.equal(hash(old), NATIVE_DONOR.sourceSha256)
  const inherited = verifyNativeDonorInheritance(current, old)
  assert.equal(inherited.source.artifacts.length, 3)
  assert.equal(inherited.sourceSha256, hash(current))
  assert.equal(inherited.donorSourceSha256, hash(old))
  for (const mutate of [s => { s.artifacts.pop() }, s => { s.artifacts.push(s.artifacts[0]) },
    s => { s.artifacts.push({ ...s.artifacts[0], path: 'native/unknown.node' }) },
    s => { s.artifacts.find(x => x.path.includes('darwin')).target = 'unknown-target' },
    s => { s.artifacts[0].bytes = -1 }, s => { s.artifacts[0].sha256 = 'unknown' }]) {
    const source = JSON.parse(current); mutate(source)
    assert.throws(() => verifyNativeDonorInheritance(Buffer.from(JSON.stringify(source)), old), /Current native|Invalid current/)
  }
  for (const change of [{ bytes: 1 }, { sha256: '0'.repeat(64) }, { extra: 'unreviewed' }]) {
    const source = JSON.parse(current); Object.assign(source.artifacts.find(x => x.path.includes('linux')), change)
    assert.throws(() => verifyNativeDonorInheritance(Buffer.from(JSON.stringify(source)), old), /Inherited native artifact declaration changed/)
  }
  for (const mutate of [s => { s.artifacts.pop() }, s => { s.artifacts.push(s.artifacts[0]) },
    s => { s.artifacts.push({ path: 'native/unreviewed.node' }) }, s => { s.inputs[0].sha256 = '0'.repeat(64) }]) {
    const source = JSON.parse(old); mutate(source)
    assert.throws(() => verifyNativeDonorInheritance(current, Buffer.from(JSON.stringify(source))), /historical SOURCE changed/)
  }
  assert.throws(() => verifyNativeDonorInheritance(current, Buffer.concat([old, Buffer.from('\n')])), /historical SOURCE changed/)
})
test('Darwin transport accepts only fixed unauthenticated GitHub input and one reviewed HTTPS CDN hop', async t => {
  const f = await mockNativeSource(t), calls = []
  const bytes = await downloadDarwinNativeInput({ workspace: f.root, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?fixture=public' } })
      : new Response(f.body, { headers: { 'content-length': String(f.body.length) } })
  } })
  assert.deepEqual(bytes, f.body); assert.equal(calls.length, 2)
  assert.equal(calls[0].url, DARWIN_NATIVE_INPUT.url)
  for (const { options } of calls) {
    assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit')
    assert.deepEqual(options.headers, { accept: 'application/octet-stream' })
    assert.ok(options.signal instanceof AbortSignal)
  }
  assert.equal(calls[0].options.signal, calls[1].options.signal)
  assert.ok(calls[0].options.signal.aborted, 'Owned deadline/network scope closes after success')
  assert.deepEqual(await downloadDarwinNativeInput({ workspace: f.root, fetchImpl: async () => new Response(f.body) }), f.body)
})
test('Darwin transport rejects foreign/insecure/credentialed/extra redirects without fetching them', async t => {
  const f = await mockNativeSource(t)
  for (const location of ['https://example.invalid/asset', 'http://release-assets.githubusercontent.com/asset',
    'https://release-assets.githubusercontent.com.evil.invalid/asset', 'https://user:secret@release-assets.githubusercontent.com/asset',
    'https://release-assets.githubusercontent.com:444/asset', '/login', 'file:///tmp/input']) {
    let calls = 0
    await assert.rejects(downloadDarwinNativeInput({ workspace: f.root, fetchImpl: async () => {
      calls++; return new Response(null, { status: 302, headers: { location } })
    } }), /reviewed HTTPS GitHub CDN/)
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root, fetchImpl: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://objects.githubusercontent.com/asset' } })
  } }), /Additional native input redirect/)
  assert.equal(calls, 2)
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root,
    fetchImpl: async () => new Response(null, { status: 302 }) }), /Missing native input redirect/)
})
test('Darwin HTTP/body/deadline errors fail closed and never fall back to the large donor', async t => {
  const f = await mockNativeSource(t)
  for (const status of [204, 401, 403, 404, 429, 500]) {
    let calls = 0
    await assert.rejects(acquireNativeInputs({ workspace: f.root, destination: f.destination,
      fetchImpl: async () => { calls++; return new Response(null, { status }) } }), /Darwin native input download failed/)
    assert.equal(calls, 1)
  }
  await assert.rejects(access(f.destination), { code: 'ENOENT' })
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root,
    fetchImpl: async () => { throw Error('network unavailable') } }), /network unavailable/)
  for (const body of [f.body.subarray(1), Buffer.concat([f.body, Buffer.from('extra')]), Buffer.alloc(f.body.length)]) {
    await assert.rejects(downloadDarwinNativeInput({ workspace: f.root,
      fetchImpl: async () => new Response(body) }), /size changed|exceeds pinned size|identity changed/)
  }
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root,
    fetchImpl: async () => new Response(f.body, { headers: { 'content-length': '999' } }) }), /response size changed/)
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root,
    fetchImpl: async () => new Response(null) }), /Missing Darwin native response body/)
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root, fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(0)); controller.close() },
  })) }), /make byte progress/)
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root, timeoutMs: 5,
    fetchImpl: () => new Promise(() => {}) }), /deadline exceeded/)
  let cancelled = false
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root, timeoutMs: 5,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true } })) }), /deadline exceeded/)
  assert.equal(cancelled, true)
  for (const timeoutMs of [0, -1, 30001, Infinity, NaN]) {
    await assert.rejects(downloadDarwinNativeInput({ workspace: f.root, timeoutMs,
      fetchImpl: () => assert.fail('invalid deadline must not fetch') }), /Invalid native input timeout/)
  }
})
test('Darwin acquisition rejects nonregular current SOURCE before network effects', async t => {
  const f = await mockNativeSource(t), source = join(f.root, 'packages/git-native/SOURCE.json')
  const outside = join(f.root, 'outside.json'); await writeFile(outside, await readFile(source)); await rm(source)
  await symlink(outside, source)
  await assert.rejects(downloadDarwinNativeInput({ workspace: f.root,
    fetchImpl: () => assert.fail('source symlink must not fetch') }), /regular source paths/)
})
test('real pinned beta16 and Darwin bytes stage through the unchanged current complete material gate', {
  skip: !process.env.YUGOO_NATIVE_DONOR_TARBALL || !process.env.YUGOO_DARWIN_NATIVE_ARTIFACT ? 'Explicit preserved donor and Darwin bytes required; ordinary mocks are not native material acceptance' : false,
}, async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-input-real-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archive = await readFile(process.env.YUGOO_NATIVE_DONOR_TARBALL), darwinBytes = await readFile(process.env.YUGOO_DARWIN_NATIVE_ARTIFACT)
  const before = await nativeSource(), destination = join(root, 'complete')
  const result = await stageNativeDonor({ workspace: nativeWorkspace, destination, archive, darwinBytes })
  assert.equal(result.sourceSha256, hash(before)); assert.equal(result.donorSourceSha256, NATIVE_DONOR.sourceSha256)
  const source = JSON.parse(before)
  for (const item of source.artifacts) {
    const bytes = await readFile(join(destination, item.path))
    assert.equal(bytes.length, item.bytes); assert.equal(hash(bytes), item.sha256)
  }
  await assert.rejects(access(join(destination, 'donor.tgz')), { code: 'ENOENT' })
  assert.deepEqual(await nativeSource(), before, 'Current source authority remains untouched')
  const requests = []
  const acquired = await acquireNativeInputs({ workspace: nativeWorkspace, destination: join(root, 'acquired'),
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      assert.equal(options.credentials, 'omit')
      assert.equal(new Headers(options.headers).has('authorization'), false)
      assert.equal(new Headers(options.headers).has('cookie'), false)
      if (url === DARWIN_NATIVE_INPUT.url) return new Response(null, { status: 302,
        headers: { location: 'https://release-assets.githubusercontent.com/native-input' } })
      if (url === 'https://release-assets.githubusercontent.com/native-input') return new Response(darwinBytes)
      assert.equal(url, NATIVE_DONOR.url)
      assert.equal(options.redirect, 'error')
      return new Response(archive)
    } })
  assert.equal(acquired.sourceSha256, result.sourceSha256)
  assert.deepEqual(requests.map(request => request.url), [DARWIN_NATIVE_INPUT.url,
    'https://release-assets.githubusercontent.com/native-input', NATIVE_DONOR.url])
  await assert.rejects(stageNativeDonor({ workspace: nativeWorkspace, destination, archive, darwinBytes }), /EEXIST/)
  for (const body of [undefined, darwinBytes.subarray(1), Buffer.concat([darwinBytes, Buffer.from('extra')]), Buffer.alloc(darwinBytes.length)]) {
    await assert.rejects(stageNativeDonor({ workspace: nativeWorkspace, destination: join(root, 'bad'), archive, darwinBytes: body }), /Explicit Darwin native bytes required|Darwin native size changed|Darwin native identity changed/)
  }
  const linked = join(root, 'linked'); await symlink(destination, linked, 'dir')
  await assert.rejects(stageNativeDonor({ workspace: nativeWorkspace, destination: linked, archive, darwinBytes }), /EEXIST/)
  const alias = join(root, 'alias'); await symlink(root, alias, 'dir')
  await assert.rejects(stageNativeDonor({ workspace: nativeWorkspace, destination: join(alias, 'new'), archive, darwinBytes }), /parent must be canonical/)
  for (const mutation of ['source-bytes', 'missing-notice', 'source-link']) {
    const workspace = join(root, mutation), native = join(workspace, 'packages/git-native')
    await mkdir(join(workspace, 'packages'), { recursive: true })
    await cp(join(nativeWorkspace, 'packages/git-native'), native, { recursive: true,
      filter: path => !/(?:^|\/)(?:native|node_modules|target)(?:\/|$)/u.test(path) })
    if (mutation === 'source-bytes') await writeFile(join(native, 'index.cjs'), '// changed source input')
    if (mutation === 'missing-notice') await rm(join(native, 'NOTICE'))
    if (mutation === 'source-link') {
      const file = join(native, 'index.cjs'); await rm(file); await symlink(join(nativeWorkspace, 'packages/git-native/index.cjs'), file)
    }
    await assert.rejects(stageNativeDonor({ workspace, destination: join(root, mutation + '-out'), archive, darwinBytes }),
      mutation === 'source-bytes' ? /source input changed/ : mutation === 'missing-notice' ? /ENOENT/ : /Native Git material symlink rejected/)
  }
})
