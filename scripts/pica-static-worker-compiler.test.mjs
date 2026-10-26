import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { test } from 'node:test'
import { readStaticPicaInput, inspectStaticPicaInput, compileStaticPicaWorkers, compileStaticPicaWorker,
  analyzeStaticPicaWorker, assertStaticPicaToolchain } from './pica-static-worker-compiler.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const inputs = Object.fromEntries(await Promise.all([
  ['standalone', 'pica@7.1.1/node_modules/pica'],
  ['embedded', 'image-blob-reduce@3.0.1/node_modules/image-blob-reduce'],
].map(async ([kind, relative]) => [kind, await readStaticPicaInput({ kind,
  directory: fileURLToPath(new URL('../node_modules/.pnpm/' + relative, import.meta.url)) })])))
const compiled = await compileStaticPicaWorkers(inputs)
const replaceSpan = (text, span, replacement) => text.slice(0, span.start) + replacement + text.slice(span.end)

test('single-input compiler preserves plural bytes and rejects unknown input without another package', async () => {
  for (const [kind, input] of Object.entries(inputs)) {
    const single = await compileStaticPicaWorker(input)
    for (const role of ['task', 'probe']) {
      assert.equal(single[role].code, compiled[kind][role].code)
      assert.equal(single[role].sha256, compiled[kind][role].sha256)
    }
    assert.deepEqual(single.retention, compiled[kind].retention)
  }
  await assert.rejects(compileStaticPicaWorker({ ...inputs.standalone, kind: 'other' }), /Unknown Pica input role/)
  await assert.rejects(compileStaticPicaWorker(undefined), /Unknown Pica input role/)
  await assert.rejects(compileStaticPicaWorker({ ...inputs.standalone, source: inputs.standalone.source + '\n' }), /Unreviewed Pica source/)
})

test('fixed sources retain distinct factory graphs, caller bindings, notices and embedded WASM', () => {
  const a = inspectStaticPicaInput(inputs.standalone), b = inspectStaticPicaInput(inputs.embedded)
  assert.equal(a.modules.length, 19); assert.equal(b.modules.length, 19)
  assert.deepEqual(a.modules.map(m => m.id), [...Array.from({ length: 12 }, (_, i) => i + 1), 17, 18, 19, 20, 21, 22, 23])
  assert.notEqual(a.source.sha256, b.source.sha256)
  assert.ok(a.modules.every((m, i) => m.factory.sha256 !== b.modules[i].factory.sha256))
  assert.deepEqual(a.wasm, b.wasm); assert.deepEqual(a.wasm.map(w => w.bytes), [662, 1869])
  for (const result of [a, b]) {
    assert.equal(result.callers.taskAdapterBinding.references.length, 1)
    assert.equal(result.callers.taskFactoryBinding.references.length, 1)
    assert.equal(result.callers.loaderBinding.references.length, 9)
    assert.equal(result.serializer.sha256, 'dd4bb93de1147b4ca0b4ecdecfe077dbd9bb5169c80d8416adfc3fe901bdbf96')
    for (const record of [result.table, result.serializer, result.auxiliaryFactory, result.parentFactory, result.callers.task, result.callers.probe]) {
      const input = inputs[result.kind]
      assert.equal(hash(input.source.slice(record.start, record.end)), record.sha256)
    }
  }
})

for (const [kind, input] of Object.entries(inputs)) {
  const record = inspectStaticPicaInput(input), bundle = compiled[kind]
  test(`${kind}: actual classic scripts prove original ASTs and every finite loader binding`, () => {
    for (const role of ['task', 'probe']) {
      const result = analyzeStaticPicaWorker(bundle[role].code, { role, input })
      assert.equal(result.sha256, bundle[role].sha256)
      assert.equal(result.parsedActualScript, true); assert.equal(result.closure.allLoaderBindingsVerified, true)
      assert.equal(result.closure.factoryCount, role === 'task' ? 19 : 0)
      assert.equal(result.closure.literalMappings.length, role === 'task' ? 19 : 0)
      assert.deepEqual(result.externalLoads, []); assert.deepEqual(result.staticModuleEscapes, [])
      assert.equal(bundle[role].compilerClosed, true)
      assert.ok(bundle[role].code.includes('Copyright'))
    }
    assert.equal(bundle.compilation.parentIntegrated, false)
    assert.equal(bundle.notices.length, kind === 'embedded' ? 8 : 7)
  })

  test(`${kind}: source/version/notice drift, missing or redirected deps and unknown roles reject`, async t => {
    const mutations = [
      ['version', { manifest: input.manifest.replace('"version": "' + record.version + '"', '"version": "99.0.0"') }, /version drift/],
      ['source bytes', { source: input.source + '\n// drift' }, /Unreviewed Pica source/],
      ['notice', { license: input.license + '\n' }, /notice drift/],
      ['missing mapping', { source: input.source.replace('"./mathlib":1', '') }, /mapping drift/],
      ['redirected mapping', { source: input.source.replace('"./mathlib":1', '"./mathlib":2') }, /mapping drift/],
      ['unknown native binding', { source: replaceSpan(input.source, record.modules.find(m => m.id === 17).factory,
        input.source.slice(record.modules.find(m => m.id === 17).factory.start, record.modules.find(m => m.id === 17).factory.end).replace('{', '{ unreviewedNative;')) }, /Unknown free binding/],
      ['extra webworkify role', { source: replaceSpan(input.source, record.callers.probe,
        input.source.slice(record.callers.probe.start, record.callers.probe.end) + ';' + input.source.slice(record.callers.probe.start, record.callers.probe.end)) }, /webworkify role/],
      ['nonempty probe', { source: replaceSpan(input.source, record.callers.probeFunction, 'function(){ postMessage(1) }') }, /original empty/],
      ['loader alias', { source: input.source.replace("var MathLib = _dereq_('./mathlib');", "var alias = _dereq_; var MathLib = alias('./mathlib');") }, /loader escaped/],
      ['external WASM', { source: input.source.replace(/AGFzbQE[A-Za-z0-9+/=]+/u, 'https://invalid.example/asset.wasm') }, /inline base64/],
    ]
    for (const [name, change, expected] of mutations) await t.test(name, () => {
      assert.notEqual(JSON.stringify({ ...input, ...change }), JSON.stringify(input), 'Mutation must affect fixed input')
      assert.throws(() => inspectStaticPicaInput({ ...input, ...change }), expected)
    })
    assert.throws(() => inspectStaticPicaInput({ ...input, kind: 'other' }), /Unknown Pica input role/)
  })

  test(`${kind}: emitted mapping/cache/receiver/alias/extra-source mutations reject`, async t => {
    const code = bundle.task.code
    const mutations = [
      ['redirected cache binding', code.replace('case "./mathlib": return require__1();', 'case "./mathlib": return require__3();')],
      ['loader alias', code.replace('case "./mathlib": return require__1();', 'case "./mathlib": var alias = require__1; return alias();')],
      ['computed case', code.replace('case "./mathlib":', 'case ["./mathlib"][0]:')],
      ['extra case', code.replace('case "./mathlib":', 'case "/extra": return require__3(); case "./mathlib":')],
      ['receiver', code.replace('}).call(module.exports,', '}).call({},')],
      ['cache implementation', code.replace('mod || (cb(', 'mod && (cb(')],
      ['extra source', code.replace('var f = require__17();', 'var escape = require__17; var f = require__17();')],
      ['native capture', code.replace('(function() {', '(function() { var Math = {};')],
    ]
    for (const [name, candidate] of mutations) await t.test(name, () => {
      assert.notEqual(candidate, code, 'Mutation must affect the actual emitted script')
      assert.throws(() => analyzeStaticPicaWorker(candidate, { role: 'task', input }))
    })
  })

  test(`${kind}: generated wrapper flags and initialization barriers are explicit`, async t => {
    const code = bundle.task.code, program = parseSync('worker.js', code).program
    let iife = program.body[0].expression.callee
    while (iife.type === 'ParenthesizedExpression') iife = iife.expression
    const statements = iife.body.body
    const moveAfterEntry = statement => {
      const text = code.slice(statement.start, statement.end)
      const removed = replaceSpan(code, statement, '')
      const tail = removed.lastIndexOf('})();')
      return removed.slice(0, tail) + text + '\n' + removed.slice(tail)
    }
    const mutations = [
      ['async IIFE', code.replace('(function() {', '(async function() {')],
      ['generator IIFE', code.replace('(function() {', '(function*() {')],
      ['async mapper', code.replace('function(specifier) {', 'async function(specifier) {')],
      ['generator mapper', code.replace('function(specifier) {', 'function*(specifier) {')],
      ['async CJS callback', code.replace('__commonJSMin(((exports, module) => {', '__commonJSMin((async (exports, module) => {')],
      ['optional dependency call', code.replace('case "./mathlib": return require__1();', 'case "./mathlib": return require__1?.();')],
      ['late cache initialization', moveAfterEntry(statements[0])],
      ['late dependency initialization', moveAfterEntry(statements[1])],
    ]
    for (const [name, candidate] of mutations) await t.test(name, () => {
      assert.notEqual(candidate, code)
      assert.throws(() => analyzeStaticPicaWorker(candidate, { role: 'task', input }))
    })
    // Lazy module callbacks can refer forward to another already-admitted
    // module variable; only the cache-before-modules-before-entry barrier matters.
    const [a, b] = statements.slice(1, 3)
    const swapped = code.slice(0, a.start) + code.slice(b.start, b.end) + code.slice(a.end, b.start)
      + code.slice(a.start, a.end) + code.slice(b.end)
    assert.equal(analyzeStaticPicaWorker(swapped, { role: 'task', input }).closure.factoryCount, 19)
  })

  test(`${kind}: global aliases, computed resources, JSON-hidden code and unknown modules cannot claim closure`, async t => {
    for (const code of [
      "onmessage=function(){const f=self['fetch'];f('/x')}",
      "onmessage=function(){self['fe'+'tch']('/x')}",
      JSON.stringify(bundle.task.code),
      'onmessage=function(){};' + JSON.stringify(bundle.task.code),
      'import "https://invalid.example/worker.js"; onmessage=function(){};',
      bundle.task.code.replace('var mathLib;', "var mathLib; self['fe'+'tch']('/x');"),
      bundle.task.code + ';self["fetch"]("https://invalid.example/x");',
    ]) await t.test(code.slice(0, 65), () => assert.throws(() => analyzeStaticPicaWorker(code, { role: 'task', input })))
    assert.throws(() => analyzeStaticPicaWorker(bundle.task.code, { role: 'task' }), /Unknown Pica input role/)
    assert.throws(() => analyzeStaticPicaWorker(bundle.probe.code, { role: 'task', input }), /message-handler/)
    assert.throws(() => analyzeStaticPicaWorker(bundle.probe.code + ';self["fetch"]("/x");', { role: 'probe', input }), /empty-probe/)
  })
}

test('toolchain drift and input-role substitution reject without selecting an arbitrary compiler', async () => {
  assertStaticPicaToolchain({ node: 'v22.22.3', tsdown: '0.22.14', rolldown: '1.2.4' })
  for (const change of [{ tsdown: '0.22.15' }, { rolldown: '1.2.5' }]) {
    assert.throws(() => assertStaticPicaToolchain({ node: 'v22.22.3', tsdown: '0.22.14', rolldown: '1.2.4', ...change }), /toolchain drift/)
  }
  await assert.rejects(compileStaticPicaWorkers({ standalone: inputs.embedded, embedded: inputs.standalone }))
})

test('Node compatibility follows root engines while artifact records keep the actual runtime pin', () => {
  // Version-policy fixtures; these are not claims of running those runtimes.
  for (const node of ['v22.19.0', 'v22.22.3', 'v23.0.0', 'v24.0.0', 'v26.1.0', 'v99.0.0']) {
    assertStaticPicaToolchain({ node, tsdown: '0.22.14', rolldown: '1.2.4' })
  }
  for (const node of ['v22.18.0', 'v20.19.0', '', 'garbage', '24', 'v24.0.0\n', null, 24]) {
    assert.throws(() => assertStaticPicaToolchain({ node, tsdown: '0.22.14', rolldown: '1.2.4' }), /Node version/)
  }
  assert.equal(compiled.standalone.toolchain.node, process.version)
  assert.equal(compiled.standalone.compilation.nodeEngine, '>=22.19.0')
})

// A deterministic VM fixture, not a browser, parent Pool or actual Worker run.
// The independent oracle executes each original pinned Browserify table's math
// factory directly, retaining that input's own code rather than copying math.
function mathOracle(input, features) {
  const info = inspectStaticPicaInput(input), context = vm.createContext({})
  const dispatcher = input.source.slice(info.dispatcher.start, info.dispatcher.end)
  const table = input.source.slice(info.table.start, info.table.end)
  const MathLib = vm.runInContext(`(${dispatcher})()(${table},{},[])(1)`, context)
  return new MathLib(features)
}
function sourcePixels(width, height, constant = false) {
  return Uint8Array.from({ length: width * height * 4 }, (_, i) => constant ? [30, 80, 150, 91][i % 4]
    : i % 4 === 3 ? [0, 70, 190, 255][Math.floor(i / 4) % 4] : (i * 17 + Math.floor(i / 4) * 11) % 256)
}
for (const [kind, input] of Object.entries(inputs)) for (const features of [['js'], ['js', 'wasm']]) {
  test(`${kind}: VM task ${features.join('+')} pixels/alpha match original math and transfer uses the result buffer`, () => {
    const posted = [], wasmModules = []
    const wasm = Object.fromEntries(Object.getOwnPropertyNames(WebAssembly).map(name => [name, WebAssembly[name]]))
    wasm.Module = class extends WebAssembly.Module { constructor(bytes) { super(bytes); wasmModules.push(hash(bytes)) } }
    const context = vm.createContext({ self: {}, onmessage: null, WebAssembly: wasm,
      postMessage(payload, transfer) {
        assert.equal(transfer.length, 1); assert.equal(transfer[0], payload.data.buffer)
        const copy = structuredClone(payload, { transfer: Array.from(transfer) })
        assert.equal(payload.data.buffer.byteLength, 0, 'Fixture transfer must detach original result')
        posted.push(new Uint8Array(copy.data))
      } })
    vm.runInContext(compiled[kind].task.code, context)
    const oracle = mathOracle(input, features)
    for (const constant of [false, true]) {
      const opts = { src: sourcePixels(17, 13, constant), width: 17, height: 13, toWidth: 7, toHeight: 5,
        quality: 3, alpha: true, unsharpAmount: 120, unsharpRadius: 1, unsharpThreshold: 0 }
      const expected = oracle.resizeAndUnsharp({ ...opts, src: new Uint8Array(opts.src) })
      context.onmessage({ data: { opts, features } })
      assert.deepEqual(Array.from(posted.at(-1)), Array.from(expected))
      assert.equal(posted.at(-1).length, 7 * 5 * 4)
      if (constant) for (let i = 0; i < posted.at(-1).length; i++) assert.equal(posted.at(-1)[i], [30, 80, 150, 91][i % 4])
    }
    const payloads = inspectStaticPicaInput(input).wasm.map(record => record.sha256)
    assert.equal(payloads.every(pin => wasmModules.includes(pin)), features.includes('wasm'))
    const before = posted.length
    assert.throws(() => context.onmessage({ data: { opts: { src: sourcePixels(2, 2), width: 2, height: 2, toWidth: 1, toHeight: 1, quality: 99 }, features } }))
    assert.equal(posted.length, before, 'A failed task must not report success')
  })
}
