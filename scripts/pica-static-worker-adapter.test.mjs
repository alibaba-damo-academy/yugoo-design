import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import { mkdtemp, mkdir, symlink, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { readStaticPicaInput, compileStaticPicaWorker, inspectStaticPicaInput } from './pica-static-worker-compiler.mjs'
import { adaptStaticPicaParent, analyzeStaticPicaAuxiliary } from './pica-static-worker-adapter.mjs'
import { canvasBrowserDependencies } from './canvas-browser-dependencies.ts'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const sha = value => createHash('sha256').update(value).digest('hex')
const inputs = {}, compiled = {}, adapted = {}
for (const [kind, relative] of [['standalone', 'pica@7.1.1/node_modules/pica'], ['embedded', 'image-blob-reduce@3.0.1/node_modules/image-blob-reduce']]) {
  inputs[kind] = await readStaticPicaInput({ kind, directory: fileURLToPath(new URL('../node_modules/.pnpm/' + relative, import.meta.url)) })
  compiled[kind] = await compileStaticPicaWorker(inputs[kind])
  adapted[kind] = adaptStaticPicaParent(inputs[kind], compiled[kind])
}
function outputPosition(manifest, position) {
  return position + manifest.parent.patches.filter(p => p.end <= position)
    .reduce((sum, p) => sum + (p.outputEnd - p.outputStart) - (p.end - p.start), 0)
}
function runtime(kind, options = {}) {
  const result = adapted[kind], events = [], blobs = [], workers = []
  const URL = { createObjectURL(blob) { const url = 'blob:owned/' + (blobs.length + 1); blobs.push({ blob, url }); events.push(['create', url]); return url },
    revokeObjectURL(url) { events.push(['revoke', url]); if (options.revokeError) throw options.revokeError } }
  class Blob { constructor(parts, init) { this.parts = parts; this.type = init.type } }
  class Worker {
    constructor(url) { events.push(['construct', url]); if (options.constructorError) throw options.constructorError; this.url = url; workers.push(this) }
    terminate() { events.push(['terminate', this.url]) }
  }
  const patch = result.manifest.parent.patches.find(p => p.role === 'serializer-factory')
  const globals = { window: options.webkit ? { webkitURL: URL } : { URL }, Blob, Worker }
  const factory = vm.runInNewContext('(' + result.code.slice(patch.outputStart, patch.outputEnd) + ')', globals)
  const module = { exports: {} }; factory(undefined, module, module.exports)
  return { api: module.exports, globals, events, blobs, workers, Worker }
}
function factoryText(kind, originalSpan) {
  const { code, manifest } = adapted[kind]
  return code.slice(outputPosition(manifest, originalSpan.start), outputPosition(manifest, originalSpan.end))
}

for (const kind of ['standalone', 'embedded']) {
  test(`${kind}: four exact source seams preserve every other input byte and original algorithm/WASM graph`, () => {
    const input = inputs[kind], result = adapted[kind], m = result.manifest
    assert.equal(m.parent.inputSha256, sha(input.source)); assert.equal(m.parent.outputSha256, sha(result.code))
    assert.equal(m.parent.patches.length, 4)
    assert.deepEqual(m.parent.patches.map(p => p.role).sort(), ['auxiliary-code', 'probe-call', 'serializer-factory', 'task-call'])
    for (const range of m.parent.unchanged) {
      assert.equal(result.code.slice(range.outputStart, range.outputEnd), input.source.slice(range.start, range.end))
      assert.equal(sha(input.source.slice(range.start, range.end)), range.sha256)
    }
    for (const original of compiled[kind].retention.modules) assert.equal(sha(factoryText(kind, original.factory)), original.factory.sha256)
    assert.deepEqual(m.wasm, compiled[kind].retention.wasm)
    assert.equal(m.lifecycle.taskPoolUnchanged, true); assert.equal(m.browserExecuted, false)
    assert.doesNotMatch(result.code, /workerPayload\.toString\(\)/)
    assert.doesNotMatch(result.code, /var bundleFn = arguments\[3\]/)
  })

  test(`${kind}: relocation changes no shipped Parent/manifest bytes or notice/source pins`, () => {
    const moved = { ...compiled[kind], notices: compiled[kind].notices.map(n => n.file
      ? { ...n, file: 'C:\\relocated-clone\\notices\\' + n.file.replaceAll('\\', '/').split('/').at(-1) } : n) }
    const result = adaptStaticPicaParent(inputs[kind], moved)
    assert.equal(result.code, adapted[kind].code)
    assert.deepEqual(result.manifest, adapted[kind].manifest)
    assert.doesNotMatch(JSON.stringify(result.manifest), /\/home\/|\/tmp\/|[A-Za-z]:\\/)
  })

  test(`${kind}: real role adapter uses fixed script bytes and returns the native Worker`, () => {
    const r = runtime(kind), task = r.api.task()
    assert.ok(task instanceof r.Worker); assert.equal(task.objectURL, r.blobs[0].url)
    assert.equal(r.blobs[0].blob.parts[0], compiled[kind].task.code)
    assert.equal(r.blobs[0].blob.type, 'text/javascript')
    assert.deepEqual(Object.keys(r.api), ['task', 'probe'])
    let called = false; const probe = r.api.probe(() => { called = true })
    assert.equal(called, false); assert.ok(probe instanceof r.Worker)
    assert.equal(r.blobs[1].blob.parts[0], compiled[kind].probe.code)
    assert.throws(() => r.api(() => {}), TypeError)
    assert.equal(r.api.unknown, undefined)
  })

  test(`${kind}: original workerFabric destruction still terminates and revokes the task URL`, () => {
    const r = runtime(kind, { webkit: true }), retention = compiled[kind].retention
    const source = inputs[kind].source.slice(retention.parentFactory.start, retention.parentFactory.end)
    const parsed = parseSync('index.js', '(' + source + ')').program
    let fabric
    function walk(n, stack = []) {
      if (n.type === 'CallExpression' && n.start - 1 + retention.parentFactory.start === retention.callers.task.start) {
        fabric = [...stack].reverse().find(n => n.type === 'FunctionDeclaration')
      }
      for (const value of Object.values(n)) {
        if (Array.isArray(value)) value.filter(x => x?.type).forEach(c => walk(c, [...stack, n]))
        else if (value?.type) walk(value, [...stack, n])
      }
    }
    walk(parsed); assert.ok(fabric)
    const original = { start: fabric.start - 1 + retention.parentFactory.start, end: fabric.end - 1 + retention.parentFactory.start }
    const create = vm.runInNewContext('(' + factoryText(kind, original) + ')', { ...r.globals, [retention.callers.taskAdapterBinding.name]: r.api })
    const holder = create(); holder.destroy()
    assert.deepEqual(r.events.slice(-2), [['terminate', holder.value.objectURL], ['revoke', holder.value.objectURL]])
  })

  test(`${kind}: constructor failure attempts URL revocation and preserves the original error`, () => {
    const error = new Error('Worker denied'), r = runtime(kind, { constructorError: error })
    assert.throws(() => r.api.task(), e => e === error)
    assert.equal(r.events.filter(x => x[0] === 'revoke').length, 1)
    assert.equal(r.workers.length, 0)
    const failedCleanup = runtime(kind, { constructorError: error, revokeError: new Error('cleanup') })
    assert.throws(() => failedCleanup.api.probe(), e => e === error)
    assert.equal(failedCleanup.events.filter(x => x[0] === 'revoke').length, 1)
  })

  test(`${kind}: the original empty probe URL cleanup policy remains explicit`, () => {
    const r = runtime(kind), worker = r.api.probe(); worker.terminate()
    assert.equal(r.events.filter(x => x[0] === 'revoke').length, 0)
    assert.equal(adapted[kind].manifest.lifecycle.originalProbeObjectUrlLeakPreserved, true)
  })

  test(`${kind}: actual auxiliary script preserves capability true/false behavior`, async () => {
    const script = adapted[kind].scripts.auxiliary.code
    const noBitmap = []; vm.runInNewContext(script, { self: { postMessage: x => noBitmap.push(x) } })
    assert.deepEqual(noBitmap, [false])
    for (const fail of [false, true]) {
      const messages = []
      class OffscreenCanvas { getContext() { return { rect() {} } } }
      vm.runInNewContext(script, { self: { postMessage: x => messages.push(x) }, OffscreenCanvas,
        createImageBitmap: async () => { if (fail) throw new Error('unsupported'); return {} }, Promise })
      for (let n = 0; n < 8; n++) await Promise.resolve()
      assert.deepEqual(messages, [!fail])
    }
    assert.equal(analyzeStaticPicaAuxiliary(script, { input: inputs[kind] }).taskWorker, false)
    assert.throws(() => analyzeStaticPicaAuxiliary(script + '\nfetch("outside");', { input: inputs[kind] }), /script drift/)
  })

  test(`${kind}: Parent auxiliary data URL and failure fallback remain the original path`, async () => {
    const retention = compiled[kind].retention, source = factoryText(kind, retention.auxiliaryFactory), urls = []
    for (const mode of ['missing', 'message', 'error', 'constructor']) {
      const module = { exports: {} }
      class Worker {
        constructor(url) {
          urls.push(url); if (mode === 'constructor') throw new Error('denied')
          queueMicrotask(() => mode === 'error' ? this.onerror(new Error('failed')) : this.onmessage({ data: true }))
        }
      }
      const globals = { Worker, Promise, OffscreenCanvas: mode === 'missing' ? undefined : class {}, queueMicrotask }
      const factory = vm.runInNewContext('(' + source + ')', globals)
      factory(undefined, module, module.exports)
      assert.equal(await module.exports.worker_offscreen_canvas_support(), mode === 'message')
    }
    const expected = 'data:text/javascript;base64,' + Buffer.from(adapted[kind].scripts.auxiliary.code, 'latin1').toString('base64')
    assert.ok(urls.length && urls.every(url => url === expected))
    assert.equal(adapted[kind].manifest.lifecycle.originalAuxiliaryTerminationPolicyPreserved, true)
  })

  test(`${kind}: source/caller/payload/role drift rejects before Parent adaptation`, () => {
    const input = inputs[kind], retention = inspectStaticPicaInput(input)
    const third = input.source.slice(retention.callers.task.start, retention.callers.task.end)
    const badSource = { ...input, source: input.source.slice(0, retention.callers.task.start) + third + ';' + third + input.source.slice(retention.callers.task.end) }
    for (const candidate of [{ ...input, source: input.source + '\n' }, badSource,
      { ...input, manifest: JSON.stringify({ ...JSON.parse(input.manifest), version: '99.0.0' }) },
      { ...input, source: input.source.replace('function workerPayload(self)', 'function workerPayload(other)') }, { ...input, kind: 'unknown' }]) {
      assert.throws(() => adaptStaticPicaParent(candidate, compiled[kind]))
    }
    const other = compiled[kind === 'standalone' ? 'embedded' : 'standalone']
    assert.throws(() => adaptStaticPicaParent(input, other), /another Pica source/)
    assert.throws(() => adaptStaticPicaParent(input, { ...compiled[kind], task: compiled[kind].probe }))
    assert.throws(() => adaptStaticPicaParent(input, { ...compiled[kind], probe: { ...compiled[kind].probe, code: compiled[kind].probe.code + '\nfetch("outside")' } }))
  })
}

test('the browser plugin is lazy for unrelated modules and one exact importer needs only its own package', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pica-adapter-importer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'node_modules'))
  const panelRequire = createRequire(new URL('../packages/panel/package.json', import.meta.url))
  const sourceRoot = dirname(createRequire(panelRequire.resolve('@excalidraw/excalidraw')).resolve('pica/package.json'))
  await symlink(sourceRoot, join(root, 'node_modules/pica'), 'dir')
  const plugin = canvasBrowserDependencies(new URL('../packages/panel/tsdown.config.ts', import.meta.url).href), assets = []
  const context = { resolve() { assert.fail('unexpected fallback resolution') } }
  assert.equal(await plugin.load('/unrelated/nonexistent.js'), null)
  assert.equal(await plugin.load('\0virtual'), null)
  plugin.generateBundle.call({ emitFile: value => assets.push(value) }, {}, { 'one.js': { type: 'chunk', isEntry: true, name: 'one', fileName: 'one.js' } })
  assert.equal(assets.length, 0)
  const entry = plugin.resolveId.call(context, 'pica', join(root, 'entry.js'))
  const [a, b] = await Promise.all([plugin.load(entry), plugin.load(entry)])
  assert.equal(a.code, adapted.standalone.code); assert.equal(a.code, b.code)
  plugin.generateBundle.call({ emitFile: value => assets.push(value) }, {}, { 'one.js': { type: 'chunk', isEntry: true, name: 'one', fileName: 'one.js' } })
  assert.equal(assets.length, 1)
  const inventory = JSON.parse(assets[0].source)
  assert.equal(inventory.sources.length, 1); assert.equal(inventory.sources[0].manifest.kind, 'standalone')
  assert.deepEqual(inventory.sources[0].source, { package: 'pica', version: '7.1.1', entry: 'dist/pica.js' })
  assert.doesNotMatch(assets[0].source, /\/home\/jeff|C:\\\\relocated|pica-adapter-importer-/)
  for (const role of ['task', 'probe', 'auxiliary']) {
    const script = inventory.sources[0].workers[role]
    assert.equal(sha(script.code), script.sha256)
    assert.equal(script.parsedActualScript, true)
  }
  // Relocate just the three pinned package inputs, not a dependency tree.
  const relocated = join(root, 'relocated'), pkg = join(relocated, 'node_modules/pica')
  await mkdir(join(pkg, 'dist'), { recursive: true })
  await writeFile(join(pkg, 'dist/pica.js'), inputs.standalone.source)
  await writeFile(join(pkg, 'package.json'), inputs.standalone.manifest)
  await writeFile(join(pkg, 'LICENSE'), inputs.standalone.license)
  const other = canvasBrowserDependencies(new URL('../packages/panel/tsdown.config.ts', import.meta.url).href), movedAssets = []
  const movedEntry = other.resolveId.call(context, 'pica', join(relocated, 'entry.js'))
  await other.load(movedEntry)
  const output = { 'one.js': { type: 'chunk', isEntry: true, name: 'one', fileName: 'one.js' } }
  other.generateBundle.call({ emitFile: value => movedAssets.push(value) }, {}, output)
  assert.equal(movedAssets[0].source, assets[0].source, 'shipped manifest must be relocatable')
  await writeFile(join(pkg, 'LICENSE'), inputs.standalone.license + '\n')
  assert.throws(() => other.generateBundle.call({ emitFile() {} }, {}, output), /input drift after loading/)
})
