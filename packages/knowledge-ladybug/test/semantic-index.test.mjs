import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DesignSemanticIndex, MemorySemanticCache, stopEmbeddingChild } from '../lib/semantic-index.js'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const vector = JSON.stringify([1, 0, 0, 0, 0, 0, 0, 0])
const graph = checkpoint => ({ checkpoint, semanticUnits: [
  { id: 'a:chunk:0', nodeId: 'a', file: 'a.json', pointer: '/a', fieldPointers: ['/a/text'], text: 'first', digest: 'first' },
  { id: 'b:chunk:0', nodeId: 'b', file: 'b.json', pointer: '/b', fieldPointers: ['/b/text'], text: 'second', digest: 'second' },
] })
const cache = { readSemanticCache: async () => vector, writeSemanticCache: async () => assert.fail('cache hit must not write') }
const index = () => new DesignSemanticIndex({ provider: 'remote', endpoint: 'https://example.invalid', model: 'test', revision: '1', prefix: '' })
const settled = async (instance, project, input, storage = cache) => {
  for (let i = 0; i < 100; i++) {
    const result = instance.read(project, input, storage === null ? undefined : storage)
    if (result.status.state !== 'indexing') return result
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('queued job did not settle')
}

test('background compute awaits the existing job without polling and rejects partial failures', async () => {
  const instance = index()
  try {
    const result = await instance.compute('p', graph('1'), cache)
    assert.equal(result.status.state, 'ready')
    assert.equal(result.edges.length, 1)
    result.edges.length = 0
    assert.equal((await instance.compute('p', graph('1'), cache)).edges.length, 1)
    instance.remoteBatch = async () => { throw new Error('failed') }
    await assert.rejects(instance.compute('q', graph('2')), /索引失败/)
    const abort = new AbortController(); abort.abort()
    await assert.rejects(instance.compute('r', graph('3'), cache, abort.signal))
  } finally { await instance.close() }
})

test('volatile cache bounds entry count and UTF-8 bytes', async () => {
  assert.throws(() => new MemorySemanticCache(0), /bounds/)
  const memory = new MemorySemanticCache(2, 10)
  await memory.writeSemanticCache('a', '123')
  await memory.writeSemanticCache('b', '123')
  await memory.writeSemanticCache('c', '123')
  assert.equal(await memory.readSemanticCache('a'), undefined)
  await memory.writeSemanticCache('b', '中文')
  assert.equal(await memory.readSemanticCache('c'), undefined)
  assert.equal(await memory.readSemanticCache('b'), '中文')
  await memory.writeSemanticCache('huge', '1234567890')
  assert.equal(await memory.readSemanticCache('huge'), undefined)
})

test('abandoned provider-less work expires even without a Knowledge lease', async () => {
  const instance = new DesignSemanticIndex({ provider: 'remote', endpoint: 'https://example.invalid', model: 'test', revision: '1' }, 30)
  let aborted = false
  instance.remoteBatch = async (_texts, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('expired')) }, { once: true }))
  try {
    instance.read('p', graph('1'))
    await new Promise(resolve => setTimeout(resolve, 70))
    assert.equal(aborted, true)
    assert.equal(instance.jobs.size, 0)
  } finally { await instance.close() }
})

test('absent provider computes edges; cache reuse is project-local and provider recovery starts a new job', async () => {
  const instance = index()
  let calls = 0, reads = 0
  // Deterministic embedding double tests orchestration, not model quality.
  instance.remoteBatch = async texts => { calls++; return texts.map(() => JSON.parse(vector)) }
  try {
    const first = await settled(instance, 'p', graph('1'), null)
    assert.equal(first.status.state, 'ready')
    assert.equal(first.status.cache, 'memory')
    assert.equal(first.edges.length, 1)
    await settled(instance, 'p', graph('2'), null)
    assert.equal(calls, 1, 'unchanged text reuses volatile vectors across checkpoints')
    await settled(instance, 'q', graph('2'), null)
    assert.equal(calls, 2, 'another project cannot reuse project p vectors')
    const recovered = await settled(instance, 'p', graph('2'), { ...cache, readSemanticCache: async () => { reads++; return vector } })
    assert.equal(recovered.status.cache, 'persistent')
    assert.equal(reads, 2, 'same checkpoint is retried against the now available provider')
    instance.cancelProject('q')
    await settled(instance, 'q', graph('2'), null)
    assert.equal(calls, 3, 'project cancellation releases volatile cache')
  } finally { await instance.close() }
  assert.equal(instance.read('p', graph('2')).status.state, 'disabled')
})

test('persistent cache read or write failure does not prevent semantic edges', async () => {
  for (const failure of ['read', 'write']) {
    const instance = index()
    instance.remoteBatch = async texts => texts.map(() => JSON.parse(vector))
    const broken = {
      readSemanticCache: async () => { if (failure === 'read') throw new Error('database unavailable') },
      writeSemanticCache: async () => { throw new Error('database unavailable') },
    }
    try {
      const result = await settled(instance, 'p', graph('1'), broken)
      assert.equal(result.status.state, 'ready')
      assert.equal(result.status.cache, 'memory')
      assert.equal(result.edges.length, 1)
    } finally { await instance.close() }
  }
})

test('cancelling a provider-less job aborts inference and permits a clean replacement', async () => {
  const instance = index()
  let started
  const running = new Promise(resolve => { started = resolve })
  let aborted = false
  instance.remoteBatch = async (_texts, signal) => {
    started()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')) }, { once: true }))
  }
  instance.read('p', graph('old'))
  await running
  instance.cancelProject('p')
  instance.remoteBatch = async texts => texts.map(() => JSON.parse(vector))
  try {
    const result = await settled(instance, 'p', graph('new'), null)
    assert.equal(aborted, true)
    assert.equal(result.status.state, 'ready')
    assert.equal(JSON.parse(result.edges[0].evidence).checkpoint, 'new')
  } finally { await instance.close() }
})

test('abort interrupts IPC wait and escalates a child ignoring SIGTERM', { timeout: 7000 }, async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});process.on('message',()=>{});process.send('ready')"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  const instance = index(), abort = new AbortController()
  try {
    await once(child, 'message')
    const pending = instance.localBatch(child, ['test'], { abort, status: {} })
    const rejected = assert.rejects(pending, /stopped/)
    const started = Date.now()
    abort.abort()
    await rejected
    assert.ok(Date.now() - started < 500, 'abort must not wait for the 180s batch timeout')
    await stopEmbeddingChild(child)
    assert.equal(child.signalCode, 'SIGKILL')
    assert.ok(Date.now() - started < 5000)
    assert.equal(child.listenerCount('message'), 0)
  } finally { child.kill('SIGKILL'); await instance.close() }
})

test('queued cross-project evidence survives caller stripping and mutating graph', async () => {
  const instance = index()
  let release
  const gate = new Promise(resolve => { release = resolve })
  try {
    instance.read('first', graph('1'), { ...cache, readSemanticCache: async () => { await gate; return vector } })
    const input = graph('2'), expected = graph('2')
    instance.read('second', input, cache)
    input.semanticUnits[0].file = 'b.json'
    input.semanticUnits[0].fieldPointers.push('/wrong/field')
    input.checkpoint = 'wrong'
    delete input.semanticUnits
    release()
    const result = await settled(instance, 'second', expected)
    assert.equal(result.status.state, 'ready')
    assert.equal(result.status.completed, 2)
    assert.equal(result.edges.length, 1)
    assert.equal(JSON.parse(result.edges[0].evidence).checkpoint, '2')
    assert.deepEqual(JSON.parse(result.edges[0].evidence).sources[0].fields, ['/a/text'])
    assert.equal(result.edges[0].from, 'a')
  } finally { release(); await instance.close() }
})

test('new same-project revision supersedes queued old revision without losing units', async () => {
  const instance = index()
  let release
  const gate = new Promise(resolve => { release = resolve })
  try {
    instance.read('p', graph('old'), { ...cache, readSemanticCache: async () => { await gate; return vector } })
    await new Promise(resolve => setImmediate(resolve))
    const input = graph('new')
    instance.read('p', input, cache)
    delete input.semanticUnits
    release()
    const result = await settled(instance, 'p', graph('new'))
    assert.equal(result.status.completed, 2)
    assert.equal(result.edges.length, 1)
    assert.equal(JSON.parse(result.edges[0].evidence).checkpoint, 'new')
  } finally { release(); await instance.close() }
})

test('cancelling one background consumer does not cancel shared inference for another review', async () => {
  const instance = index(), abort = new AbortController()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const sharedCache = { ...cache, readSemanticCache: async () => { await gate; return vector } }
  try {
    const cancelled = instance.compute('p', graph('same'), sharedCache, abort.signal)
    const surviving = instance.compute('p', graph('same'), sharedCache)
    const rejected = assert.rejects(cancelled, /abort/i)
    abort.abort()
    await rejected
    release()
    assert.equal((await surviving).status.state, 'ready')
  } finally { release(); await instance.close() }
})

test('local failures distinguish dependency, model and inference phases without leaking raw errors', async () => {
  for (const [phase, expected] of [['runtime', /运行依赖/], ['model', /模型加载/], ['inference', /推理失败/], ['constructor', /语义索引失败/]]) {
    const instance = new DesignSemanticIndex({ localOnly: true })
    instance.localBatch = async () => { throw Object.assign(new Error('PRIVATE_INPUT_AND_PATH'), { embeddingFailure: phase }) }
    try {
      await assert.rejects(instance.compute('p', graph('1')), expected)
      const result = instance.read('p', graph('1'))
      assert.equal(result.status.state, 'error')
      assert.doesNotMatch(result.status.message, /PRIVATE_INPUT_AND_PATH/)
      assert.match(result.status.message, /不自动上传或重试/)
    } finally { await instance.close() }
  }
})

test('worker catches native import, model load and inference errors at the IPC boundary', async () => {
  const { mkdtemp, mkdir, copyFile, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fork } = await import('node:child_process')
  for (const phase of ['runtime', 'model', 'inference']) {
    const root = await mkdtemp(join(tmpdir(), 'embedding-phase-'))
    let worker
    try {
      for (const name of ['embedding-worker.mjs', 'embedding-text.mjs']) await copyFile(new URL('../src/' + name, import.meta.url), join(root, name))
      const moduleRoot = join(root, 'node_modules/@huggingface/transformers')
      await mkdir(moduleRoot, { recursive: true })
      await writeFile(join(moduleRoot, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
      const code = phase === 'runtime' ? 'throw Error("PRIVATE_NATIVE_PATH")' : `export const env={backends:{onnx:{wasm:{}}}}; export async function pipeline(){${phase === 'model' ? 'throw Error("PRIVATE_MODEL_PATH")' : 'return Object.assign(async()=>{throw Error("PRIVATE_INPUT")},{tokenizer:{encode:()=>[1]}})'}}`
      await writeFile(join(moduleRoot, 'index.js'), code)
      const env = { ...process.env }
      for (const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']) delete env[key]
      worker = fork(join(root, 'embedding-worker.mjs'), { env, execArgv: [], windowsHide: true, stdio: ['ignore','ignore','ignore','ipc'] })
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('worker result timed out')), 10000)
        worker.once('message', value => { clearTimeout(timer); resolve(value) })
        worker.once('error', error => { clearTimeout(timer); reject(error) })
      })
      worker.send({ texts: ['PRIVATE_INPUT'], config: { prefix: 'query: ', localOnly: true, cacheDir: root } })
      assert.deepEqual(await result, { error: phase })
    } finally { if (worker) await stopEmbeddingChild(worker); await rm(root, { recursive: true, force: true }) }
  }
})

test('embedding model fetch honors the installed proxy agent and NO_PROXY on Node 22', { timeout: 15000 }, async t => {
  const { createServer, request: forward } = await import('node:http')
  const { mkdtemp, mkdir, copyFile, writeFile, rm, symlink } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join, dirname } = await import('node:path')
  const { createRequire } = await import('node:module')
  const { fork } = await import('node:child_process')
  const root = await mkdtemp(join(tmpdir(), 'embedding-proxy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const originRequests = [], proxyRequests = [], sockets = new Set()
  const origin = createServer((request, response) => {
    originRequests.push(request.url)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{}')
  })
  const track = socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) }
  const proxy = createServer((request, response) => {
    proxyRequests.push(request.url)
    const path = new URL(request.url).pathname
    const upstream = forward({ hostname: '127.0.0.1', port: origin.address().port, path }, incoming => {
      response.writeHead(incoming.statusCode, incoming.headers)
      incoming.pipe(response)
    })
    upstream.on('socket', track)
    upstream.on('error', () => { response.writeHead(502); response.end() })
    upstream.end()
  })
  origin.on('connection', track)
  proxy.on('connection', track)
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all([origin, proxy].map(server => new Promise(resolve => server.close(resolve))))
  })
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve))
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  for (const name of ['embedding-worker.mjs', 'embedding-text.mjs']) {
    await copyFile(new URL('../src/' + name, import.meta.url), join(root, name))
  }
  const transformers = join(root, 'node_modules/@huggingface/transformers')
  await mkdir(transformers, { recursive: true })
  await writeFile(join(transformers, 'package.json'), JSON.stringify({ type: 'module', exports: './index.js' }))
  // Only inference is stubbed. Model preparation uses real fetch and the installed
  // Undici EnvHttpProxyAgent in an isolated child; no external model is downloaded.
  await writeFile(join(transformers, 'index.js'), `
    export const env = { backends: { onnx: { wasm: {} } } };
    export async function pipeline(_task, model) {
      const response = await fetch(model);
      if (!response.ok) throw Error('model fetch failed');
      await response.json();
      return Object.assign(async inputs => ({ tolist: () => inputs.map(() => [1, 0]) }),
        { tokenizer: { encode: () => [1] } });
    }
  `)
  const require = createRequire(import.meta.url)
  await symlink(dirname(require.resolve('undici/package.json')), join(root, 'node_modules/undici'), 'dir')
  const run = async (model, noProxy) => {
    const env = { ...process.env }
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy']) delete env[key]
    env.HTTP_PROXY = `http://127.0.0.1:${proxy.address().port}`
    if (noProxy) env.NO_PROXY = noProxy
    const worker = fork(join(root, 'embedding-worker.mjs'), { env, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
    try {
      const message = once(worker, 'message', { signal: AbortSignal.timeout(5000) })
      worker.send({ texts: ['fixture text'], config: { model, prefix: '', localOnly: false, cacheDir: root } })
      assert.deepEqual((await message)[0], { vectors: [[1, 0]] })
    } finally { await stopEmbeddingChild(worker) }
  }
  const port = origin.address().port
  const model = `http://model-download.invalid:${port}/proxied-model.json`
  await run(model)
  assert.deepEqual(proxyRequests, [model])
  assert.deepEqual(originRequests, ['/proxied-model.json'])
  await run(`http://127.0.0.1:${port}/local-model.json`, '127.0.0.1')
  assert.deepEqual(proxyRequests, [model], 'NO_PROXY must bypass the proxy')
  assert.deepEqual(originRequests, ['/proxied-model.json', '/local-model.json'])
})
