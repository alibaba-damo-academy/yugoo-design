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
