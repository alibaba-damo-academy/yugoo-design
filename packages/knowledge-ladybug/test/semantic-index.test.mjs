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

test('local resource preparation failure prevents inference and keeps a failed generation failed', async () => {
  const instance = new DesignSemanticIndex({ localOnly: true }); let prepare = 0, inference = 0
  instance.prepareLocalAssets = async () => { prepare++; throw Error('resource fixture failure') }
  instance.localBatch = async () => { inference++; assert.fail('inference cannot precede verified resources') }
  try {
    await assert.rejects(instance.compute('assets', graph('assets-1')))
    await assert.rejects(instance.compute('assets', graph('assets-1')))
    assert.equal(prepare, 1); assert.equal(inference, 0)
    assert.equal(instance.read('assets', graph('assets-1')).status.state, 'error')
  } finally { await instance.close() }
})

test('built resource preparation preserves bounded missing, download, integrity and busy reasons in status', async t => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { lock } = await import('proper-lockfile')
  for (const [failure, expected] of [
    ['missing', /资源缺失或不完整/], ['download', /资源下载未完成/],
    ['integrity', /资源校验失败/], ['busy', /资源正由另一进程准备/],
  ]) await t.test(failure, { skip: failure === 'integrity' && process.platform === 'win32' }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'PRIVATE_ASSET_CACHE-'))
    const modelRoot = join(root, 'Xenova/multilingual-e5-small/761b726dd34fb83930e26aab4e9ac3899aa1fa78')
    await mkdir(modelRoot, { recursive: true })
    const instance = new DesignSemanticIndex({ cacheDir: root, localOnly: failure !== 'download' })
    const names = ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY']
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
    let release
    try {
      if (failure === 'download') {
        // Invalid syntax is rejected by the real dispatcher before any socket/request.
        for (const name of names) delete process.env[name]
        process.env.https_proxy = 'http://[PRIVATE_INVALID_PROXY'
      }
      if (failure === 'busy') release = await lock(modelRoot, { retries: 0 })
      if (failure === 'integrity') {
        const outside = join(root, 'PRIVATE_OUTSIDE')
        await writeFile(outside, 'PRIVATE_CONTENT')
        await symlink(outside, join(modelRoot, 'config.json'))
      }
      await assert.rejects(instance.compute(failure, graph(failure)), expected)
      const before = instance.read(failure, graph(failure))
      assert.equal(before.status.state, 'error')
      assert.match(before.status.message, expected)
      assert.match(before.status.message, /不自动上传或重试/)
      assert.doesNotMatch(before.status.message, /PRIVATE|https?:|\/Users\/|\/tmp\//)
      await assert.rejects(instance.compute(failure, graph(failure)), expected)
      assert.deepEqual(instance.read(failure, graph(failure)), before)
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name]
        else process.env[name] = previous[name]
      }
      await release?.(); await instance.close(); await rm(root, { recursive: true, force: true })
    }
  })
})

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
      for (const name of ['embedding-worker.mjs', 'embedding-text.mjs', 'embedding-diagnostic.ts']) await copyFile(new URL('../src/' + name, import.meta.url), join(root, name))
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
      assert.deepEqual(await result, { error: phase, diagnostic: {
        ...(phase === 'runtime' ? {} : { localOnly: true, remoteAllowed: false }), name: 'Error',
      } })
    } finally { if (worker) await stopEmbeddingChild(worker); await rm(root, { recursive: true, force: true }) }
  }
})

// Exercise the built parent and built child together, replacing only the model
// dependency in a disposable package. Never run the installed model or fetch it.
async function diagnosticFixture(t, transformer, workerSource) {
  const { mkdtemp, mkdir, readdir, copyFile, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fork } = await import('node:child_process')
  const root = await mkdtemp(join(tmpdir(), 'embedding-diagnostic-'))
  const lib = join(root, 'lib'), dependencies = join(root, 'node_modules/@huggingface/transformers')
  await mkdir(lib); await mkdir(dependencies, { recursive: true })
  await writeFile(join(root, 'package.json'), '{"type":"module"}')
  for (const name of await readdir(new URL('../lib/', import.meta.url))) {
    if (name.endsWith('.js')) await copyFile(new URL('../lib/' + name, import.meta.url), join(lib, name))
  }
  await writeFile(join(dependencies, 'package.json'), '{"type":"module","exports":"./index.js"}')
  await writeFile(join(dependencies, 'index.js'), transformer)
  if (workerSource) await writeFile(join(lib, 'embedding-worker.js'), workerSource)
  t.after(() => rm(root, { recursive: true, force: true }))
  const env = { ...process.env }
  for (const name of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','ALL_PROXY','all_proxy','NO_PROXY','no_proxy']) delete env[name]
  return () => fork(join(lib, 'embedding-worker.js'), { env, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
}
function useDiagnosticWorker(instance, spawnWorker, observations = []) {
  // This fixture replaces the model dependency; resource transfer is tested separately.
  instance.prepareLocalAssets = async () => {}
  const localBatch = instance.localBatch
  let calls = 0
  instance.localBatch = async (_unused, texts, job) => {
    calls++
    const worker = spawnWorker()
    worker.on('message', value => observations.push(value))
    try { return await localBatch.call(instance, worker, texts, job) }
    finally { await stopEmbeddingChild(worker) }
  }
  return () => calls
}
const fakeEnvironment = 'export const env={backends:{onnx:{wasm:{}}}}; '

test('built worker diagnostics survive parent compute/read and do not expose exception text', async t => {
  const cases = [
    ['DNS', 'model', 'throw new TypeError("PRIVATE_URL?token=PRIVATE_TOKEN", {cause:Object.assign(new Error("PRIVATE_HOST"),{code:"ENOTFOUND"})})', /causeCode=ENOTFOUND/],
    ['TLS depth three', 'model', 'throw new TypeError("PRIVATE_URL", {cause:new Error("PRIVATE_PATH",{cause:Object.assign(new Error("PRIVATE_CERT"),{code:"UNABLE_TO_VERIFY_LEAF_SIGNATURE"})})})', /causeCode=UNABLE_TO_VERIFY_LEAF_SIGNATURE/],
    ['cache permission', 'model', 'throw Object.assign(new Error("PRIVATE_CACHE_PATH"),{code:"EACCES"})', /code=EACCES/],
    ['JSON', 'model', 'throw new SyntaxError("PRIVATE_MODEL_CONTENT")', /name=SyntaxError/],
    ['ONNX session unknown', 'model', 'throw new Error("invalid protobuf PRIVATE_MODEL_PATH")', /name=Error/],
    ['native import', 'runtime', 'throw Object.assign(new Error("PRIVATE_NATIVE_PATH"),{code:"ERR_DLOPEN_FAILED"})', /code=ERR_DLOPEN_FAILED/],
    ['inference', 'inference', 'throw Object.assign(new RangeError("PRIVATE_DESIGN_TEXT"),{code:"UNKNOWN_PRIVATE_CODE"})', /name=RangeError/],
    ['hostile fields', 'model', 'throw Object.assign(new Error("https://user:password@PRIVATE_HOST/?token=PRIVATE_TOKEN"),{name:"PRIVATE_NAME",code:"PRIVATE_CODE",stack:"PRIVATE_STACK",headers:{Authorization:"Bearer PRIVATE_TOKEN"},body:"PRIVATE_DESIGN_TEXT",apiKey:"PRIVATE_SECRET"})', /localOnly=false; remoteAllowed=true|remoteAllowed=true/],
    ['cycle', 'model', 'const a=new Error("PRIVATE_A"),b=new Error("PRIVATE_B");a.cause=b;b.cause=a;throw a', /name=Error/],
    ['too-deep cause', 'model', 'throw new Error("PRIVATE_1",{cause:new Error("PRIVATE_2",{cause:new Error("PRIVATE_3",{cause:Object.assign(new Error("PRIVATE_4"),{code:"ENOTFOUND"})})})})', /name=Error/],
    ['broken getter', 'model', 'const e=new Error("PRIVATE_MESSAGE");Object.defineProperty(e,"code",{get(){throw Error("PRIVATE_GETTER")}});throw e', /name=Error/],
  ]
  for (const [name, phase, failure, expected] of cases) await t.test(name, async t => {
    const code = phase === 'runtime' ? fakeEnvironment + failure : fakeEnvironment + `export async function pipeline(){${phase === 'model' ? failure : `return Object.assign(async()=>{${failure}},{tokenizer:{encode:()=>[1]}})`}}`
    const spawnWorker = await diagnosticFixture(t, code), observations = []
    const instance = new DesignSemanticIndex({ localOnly: false })
    const calls = useDiagnosticWorker(instance, spawnWorker, observations)
    try {
      await assert.rejects(instance.compute('p', graph('1')), expected)
      const result = instance.read('p', graph('1'))
      assert.equal(result.status.state, 'error'); assert.deepEqual(result.edges, [])
      assert.match(result.status.message, expected)
      assert.match(result.status.message, /不自动上传或重试/)
      assert.doesNotMatch(JSON.stringify([observations, result]), /PRIVATE_|user:password|token=|https:\/\//)
      const diagnostic = observations.find(value => value.error)?.diagnostic
      assert.equal(observations.at(-1).error, phase)
      if (phase === 'runtime') assert.equal(diagnostic.remoteAllowed, undefined)
      else { assert.equal(diagnostic.localOnly, false); assert.equal(diagnostic.remoteAllowed, true) }
      if (['ONNX session unknown', 'hostile fields', 'cycle', 'too-deep cause', 'broken getter'].includes(name)) {
        assert.equal(diagnostic.code, undefined); assert.equal(diagnostic.causeCode, undefined)
      }
      await assert.rejects(instance.compute('p', graph('1')))
      for (let i = 0; i < 10; i++) instance.read('p', graph('1'))
      assert.equal(calls(), 1, 'a failed unchanged job cannot silently retry')
      assert.ok(result.status.message.slice(result.status.message.indexOf(' [embedding:')).length <= 256)
    } finally { await instance.close() }
  })
})

test('child reports download policy only after actually applying it', async t => {
  for (const localOnly of [false, true]) await t.test(String(localOnly), async t => {
    const spawnWorker = await diagnosticFixture(t, fakeEnvironment + `export async function pipeline(){if(env.allowRemoteModels!==${!localOnly})throw new SyntaxError('wrong effective policy');throw Object.assign(new Error('PRIVATE_PATH'),{code:'ENOENT'})}`)
    const instance = new DesignSemanticIndex({ localOnly }), observations = []
    useDiagnosticWorker(instance, spawnWorker, observations)
    try {
      await assert.rejects(instance.compute('p', graph('1')), /code=ENOENT/)
      assert.deepEqual(observations.at(-1).diagnostic, { localOnly, remoteAllowed: !localOnly, name: 'Error', code: 'ENOENT' })
    } finally { await instance.close() }
  })
  await t.test('configuration setter failed before policy was applied', async t => {
    const spawnWorker = await diagnosticFixture(t, fakeEnvironment + `Object.defineProperty(env,'cacheDir',{set(){throw Object.assign(new Error('PRIVATE_CACHE_PATH'),{code:'EACCES'})}});export async function pipeline(){throw Error('not reached')}`)
    const instance = new DesignSemanticIndex({ localOnly: false }), observations = []
    useDiagnosticWorker(instance, spawnWorker, observations)
    try {
      await assert.rejects(instance.compute('p', graph('1')), /code=EACCES/)
      assert.deepEqual(observations.at(-1).diagnostic, { name: 'Error', code: 'EACCES' })
    } finally { await instance.close() }
  })
})

test('pinned Hub text yields only exact library-derived HTTP tokens', async t => {
  const prefixes = [
    [400, 'Bad request error occurred while trying to load file'], [401, 'Unauthorized access to file'],
    [403, 'Forbidden access to file'], [404, 'Could not locate file'],
    [408, 'Request timeout error occurred while trying to load file'], [500, 'Internal server error error occurred while trying to load file'],
    [502, 'Bad gateway error occurred while trying to load file'], [503, 'Service unavailable error occurred while trying to load file'],
    [504, 'Gateway timeout error occurred while trying to load file'],
  ]
  for (const [status, prefix] of prefixes) await t.test(String(status), async t => {
    const errorText = prefix + ': "https://user:password@PRIVATE_HOST/file?token=PRIVATE_TOKEN".'
    const spawnWorker = await diagnosticFixture(t, fakeEnvironment + `export async function pipeline(){throw Error(${JSON.stringify(errorText)})}`)
    const instance = new DesignSemanticIndex({ localOnly: false }); useDiagnosticWorker(instance, spawnWorker)
    try {
      await assert.rejects(instance.compute('p', graph('1')), new RegExp(`hubText=hf3.8.1-http-${status}`))
      assert.doesNotMatch(instance.read('p', graph('1')).status.message, /PRIVATE_|https|password|token=/)
    } finally { await instance.close() }
  })
  for (const text of ['noise Unauthorized access to file: "PRIVATE_URL".', 'unauthorized access to file: "PRIVATE_URL".', 'Unauthorized access to file: "PRIVATE_URL". suffix', 'fetch network PRIVATE_URL', 'Error (418) occurred while trying to load file: "PRIVATE_URL".']) await t.test(text.split('PRIVATE')[0], async t => {
    const spawnWorker = await diagnosticFixture(t, fakeEnvironment + `export async function pipeline(){throw Error(${JSON.stringify(text)})}`)
    const instance = new DesignSemanticIndex({ localOnly: true }); useDiagnosticWorker(instance, spawnWorker)
    try { await assert.rejects(instance.compute('p', graph('1'))); assert.doesNotMatch(instance.read('p', graph('1')).status.message, /hubText|PRIVATE|network/) }
    finally { await instance.close() }
  })
  await t.test('inference text cannot masquerade as a Hub load failure', async t => {
    const spawnWorker = await diagnosticFixture(t, fakeEnvironment + 'export async function pipeline(){return Object.assign(async()=>{throw Error(\'Unauthorized access to file: "PRIVATE_INPUT".\')},{tokenizer:{encode:()=>[1]}})}')
    const instance = new DesignSemanticIndex({ localOnly: true }); useDiagnosticWorker(instance, spawnWorker)
    try { await assert.rejects(instance.compute('p', graph('1'))); assert.doesNotMatch(instance.read('p', graph('1')).status.message, /hubText|PRIVATE/) }
    finally { await instance.close() }
  })
})

test('parent validates hostile IPC and keeps the exact legacy phase-only message', async t => {
  const legacy = '本地 embedding 模型加载失败；请检查固定版本模型缓存，离线模式需要先准备完整模型文件。 保留结构图，不自动上传或重试。'
  for (const diagnostic of [undefined, { name:'PRIVATE_NAME', code:'PRIVATE_TOKEN', causeCode:'ECONNRESET', hubText:'PRIVATE_URL', localOnly:'false', remoteAllowed:true, message:'PRIVATE_MESSAGE', stack:'PRIVATE_STACK' }, { name:'PRIVATE', code:'PRIVATE' }, { name:'AggregateError', code:'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', causeCode:'UNABLE_TO_VERIFY_LEAF_SIGNATURE', hubText:'hf3.8.1-http-504', remoteAllowed:true }]) await t.test(diagnostic ? JSON.stringify(Object.keys(diagnostic)) : 'legacy', async t => {
    const payload = { error: 'model', ...(diagnostic ? { diagnostic } : {}), unexpected: 'PRIVATE_INPUT' }
    const spawnWorker = await diagnosticFixture(t, '', `process.on('message',()=>process.send(${JSON.stringify(payload)}))`)
    const instance = new DesignSemanticIndex({ localOnly: true }); useDiagnosticWorker(instance, spawnWorker)
    try {
      await assert.rejects(instance.compute('p', graph('1')))
      const message = instance.read('p', graph('1')).status.message
      assert.doesNotMatch(message, /PRIVATE_|localOnly=/)
      if (diagnostic?.causeCode) { assert.match(message, new RegExp('causeCode=' + diagnostic.causeCode)); assert.match(message, /remoteAllowed=true/); assert.ok(message.slice(legacy.length).length <= 256) }
      else assert.equal(message, legacy)
    } finally { await instance.close() }
  })
})

test('child exit, abort and the unchanged 180-second deadline remain failures', async t => {
  for (const mode of ['exit', 'abort', 'timeout']) await t.test(mode, async t => {
    if (mode === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] })
    const spawnWorker = await diagnosticFixture(t, '', `process.on('message',()=>${mode === 'exit' ? 'process.exit(9)' : 'process.send({progress:"waiting-fixture"})'})`)
    const instance = new DesignSemanticIndex({ localOnly: true }), abort = new AbortController()
    const calls = useDiagnosticWorker(instance, spawnWorker)
    try {
      const pending = instance.compute('p', graph('1'), undefined, abort.signal)
      const rejected = assert.rejects(pending)
      if (mode !== 'exit') {
        const before = Date.now()
        while (instance.read('p', graph('1')).status.message !== 'waiting-fixture') {
          assert.ok(Date.now() - before < 10000, 'fixture child did not start'); await new Promise(resolve => setImmediate(resolve))
        }
        if (mode === 'abort') abort.abort()
        else { t.mock.timers.tick(179999); assert.equal(instance.read('p', graph('1')).status.state, 'indexing'); t.mock.timers.tick(1) }
      }
      await rejected
      const result = instance.read('p', graph('1'))
      assert.notEqual(result.status.state, 'ready'); assert.deepEqual(result.edges, [])
      assert.doesNotMatch(result.status.message, /code=|causeCode=|remoteAllowed=/)
      assert.equal(calls(), 1)
    } finally { await instance.close(); t.mock.timers.reset() }
  })
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
  for (const name of ['embedding-worker.mjs', 'embedding-text.mjs', 'embedding-diagnostic.ts']) {
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
