import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { inspectStaticPicaInput, readStaticPicaInput, compileStaticPicaWorker,
  analyzeStaticPicaWorker, assertStaticPicaToolchain } from './pica-static-worker-compiler.mjs'
import { indexBrowserBindings, sameBrowserBindings, unparen } from './known-flat-browser-loader-proof.mjs'

const require = createRequire(import.meta.url)
const { parseSync } = await import(pathToFileURL(createRequire(require.resolve('tsdown')).resolve('rolldown/utils')))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const parse = code => {
  const result = parseSync('pica-parent-seam.js', code)
  assert.equal(result.errors.length, 0, 'Cannot parse fixed Pica adapter seam')
  return result.program
}
const span = (source, node, offset = 0) => ({ start: node.start + offset, end: node.end + offset,
  bytes: Buffer.byteLength(source.slice(node.start, node.end)), sha256: sha(source.slice(node.start, node.end)) })

/** Only parse the already source-pinned module16, not another whole Pica parser. */
function auxiliary(input, retention) {
  const source = input.source.slice(retention.auxiliaryFactory.start, retention.auxiliaryFactory.end)
  const program = parse(`(${source})`), index = indexBrowserBindings(program)
  const calls = []
  function walk(node) {
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed
      && node.callee.property.name === 'toString' && node.callee.object.type === 'Identifier') calls.push(node)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.filter(x => x?.type).forEach(walk)
      else if (value?.type) walk(value)
    }
  }
  walk(program)
  assert.equal(calls.length, 1, 'Unknown auxiliary source serialization seam')
  const toString = calls[0], token = index.binding(toString.callee.object)
  assert.ok(token?.declarations.length === 1, 'Auxiliary payload binding drift')
  const payload = token.declarations[0].declaration
  assert.ok(payload.type === 'FunctionDeclaration' && !payload.async && !payload.generator && payload.params.length === 1,
    'Unknown auxiliary payload definition')
  assert.deepEqual(index.refs(token), [toString.callee.object], 'Auxiliary payload escaped')
  const concat = index.parents.get(toString), encode = index.parents.get(concat), declaration = index.parents.get(encode)
  const expected = parse('btoa("(".concat(payload.toString(), ")(self);"))')
  assert.ok(sameBrowserBindings(encode, expected.body[0].expression, index, indexBrowserBindings(expected), new Map([['payload', token]])),
    'Auxiliary btoa/payload expression changed')
  assert.ok(declaration?.type === 'VariableDeclarator' && declaration.init === encode && declaration.id.type === 'Identifier',
    'Auxiliary encoding has an unknown owner')
  const codeToken = index.binding(declaration.id), references = index.refs(codeToken)
  assert.equal(codeToken.declarations.length, 1); assert.equal(references.length, 1, 'Auxiliary encoded value escaped')
  const data = index.parents.get(references[0]), worker = index.parents.get(data)
  const ctor = parse('new Worker("data:text/javascript;base64,".concat(encoded))')
  assert.ok(sameBrowserBindings(worker, ctor.body[0].expression, index, indexBrowserBindings(ctor), new Map([['encoded', codeToken]])),
    'Auxiliary Worker URL/constructor changed')
  const wrapped = `(${source})`, payloadText = wrapped.slice(payload.start, payload.end)
  const script = '(' + payloadText + ')(self);'
  assert.ok([...script].every(c => c.codePointAt(0) <= 255), 'Auxiliary source exceeds original btoa character domain')
  const base64 = Buffer.from(script, 'latin1').toString('base64')
  const offset = retention.auxiliaryFactory.start - 1
  return { code: script, base64, payload: span(wrapped, payload, offset), expression: span(wrapped, encode, offset) }
}

/** Validate actual auxiliary JavaScript, not a manifest status or encoded string. */
export function analyzeStaticPicaAuxiliary(code, { input }) {
  const retention = inspectStaticPicaInput(input), expected = auxiliary(input, retention)
  assert.equal(code, expected.code, 'Auxiliary actual script drift')
  const program = parse(code), index = indexBrowserBindings(program), globals = new Set()
  for (const list of index.identifiers.values()) for (const node of list) {
    if (!index.keyOnly(node) && !index.binding(node)) globals.add(node.name)
  }
  assert.deepEqual([...globals].sort(), ['OffscreenCanvas', 'Promise', 'createImageBitmap', 'self'], 'Auxiliary free binding drift')
  return { role: 'auxiliary-offscreen', bytes: Buffer.byteLength(code), sha256: sha(code), freeGlobals: [...globals].sort(),
    parsedActualScript: true, payloadSource: expected.payload, externalLoads: [], staticModuleEscapes: [],
    taskWorker: false, browserExecuted: false }
}

function serializerFactory(source, retention, task, probe) {
  const original = source.slice(retention.serializer.start, retention.serializer.end)
  const factory = unparen(parse(`(${original})`).body[0].expression)
  assert.equal(factory.type, 'FunctionExpression'); assert.equal(factory.params.length, 3)
  assert.ok(factory.params.every(p => p.type === 'Identifier'))
  const module = factory.params[1].name
  // Two private fixed role closures, never webworkify(fn) or a user-supplied
  // source. Pool and probe callers continue to own the returned native Worker.
  return `function(${factory.params.map(p => p.name).join(',')}) {
    function fixedWorker(script) {
      var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;
      var blob = new Blob([script], { type: 'text/javascript' });
      var url = URL.createObjectURL(blob);
      var worker;
      try { worker = new Worker(url); }
      catch (error) { try { URL.revokeObjectURL(url); } finally { throw error; } }
      worker.objectURL = url;
      return worker;
    }
    ${module}.exports = {
      task: function() { return fixedWorker(${JSON.stringify(task)}); },
      probe: function() { return fixedWorker(${JSON.stringify(probe)}); }
    };
  }`
}

/** Four approved ranges; every other input character is retained verbatim. */
export function adaptStaticPicaParent(input, compiled) {
  const retention = inspectStaticPicaInput(input)
  assert.equal(compiled?.kind, input.kind, 'Compiled Worker belongs to another Pica source')
  assert.deepEqual(compiled.retention, retention, 'Compiled Worker retention/source association drift')
  assertStaticPicaToolchain(compiled.toolchain)
  const scripts = {}
  for (const role of ['task', 'probe']) {
    const worker = compiled[role]
    assert.ok(worker?.compilerClosed, 'Worker compiler did not close')
    const analysis = analyzeStaticPicaWorker(worker.code, { role, input })
    assert.equal(analysis.sha256, worker.sha256, 'Worker actual source/hash drift')
    scripts[role] = { code: worker.code, ...analysis }
  }
  const aux = auxiliary(input, retention)
  scripts.auxiliary = { code: aux.code, ...analyzeStaticPicaAuxiliary(aux.code, { input }) }
  const edits = [
    { role: 'serializer-factory', ...retention.serializer, replacement: serializerFactory(input.source, retention, scripts.task.code, scripts.probe.code) },
    { role: 'task-call', ...retention.callers.task, replacement: retention.callers.taskAdapterBinding.name + '.task()' },
    { role: 'probe-call', ...retention.callers.probe, replacement: retention.callers.loaderBinding.name + '("webworkify").probe()' },
    { role: 'auxiliary-code', ...aux.expression, replacement: JSON.stringify(aux.base64) },
  ].sort((a, b) => a.start - b.start)
  const unchanged = [], parts = []
  let position = 0, outputPosition = 0
  for (const edit of edits) {
    assert.ok(edit.start >= position && edit.end > edit.start, 'Overlapping or invalid Parent patches')
    assert.equal(sha(input.source.slice(edit.start, edit.end)), edit.sha256, 'Parent patch source range drift')
    const retained = input.source.slice(position, edit.start)
    parts.push(retained, edit.replacement)
    unchanged.push({ start: position, end: edit.start, outputStart: outputPosition, outputEnd: outputPosition + retained.length,
      bytes: Buffer.byteLength(retained), sha256: sha(retained) })
    edit.outputStart = outputPosition + retained.length; edit.outputEnd = edit.outputStart + edit.replacement.length
    outputPosition = edit.outputEnd
    position = edit.end
  }
  const suffix = input.source.slice(position); parts.push(suffix)
  unchanged.push({ start: position, end: input.source.length, outputStart: outputPosition, outputEnd: outputPosition + suffix.length,
    bytes: Buffer.byteLength(suffix), sha256: sha(suffix) })
  const code = parts.join('')
  parse(code)
  return { code, scripts, manifest: { kind: input.kind, package: retention.package, version: retention.version,
    source: retention.source, retention, toolchain: compiled.toolchain,
    notices: compiled.notices.map(({ name, file, sha256 }) => ({ package: name,
      file: file ? file.replaceAll('\\', '/').split('/').at(-1) : 'LICENSE', sha256 })),
    entry: input.kind === 'standalone' ? 'dist/pica.js' : 'dist/image-blob-reduce.esm.mjs', wasm: retention.wasm,
    parent: { inputBytes: Buffer.byteLength(input.source), inputSha256: sha(input.source), outputBytes: Buffer.byteLength(code), outputSha256: sha(code),
      patches: edits.map(({ replacement, ...edit }) => ({ ...edit, outputBytes: Buffer.byteLength(replacement), outputSha256: sha(replacement) })),
      unchanged, outsideApprovedRangesBytePreserved: true },
    scripts: Object.fromEntries(Object.entries(scripts).map(([role, { code: _code, ...record }]) => [role, record])),
    lifecycle: { taskPoolUnchanged: true, constructorFailureRevokeAttempt: true, probeTerminationUnchanged: true,
      originalProbeObjectUrlLeakPreserved: true, originalAuxiliaryTerminationPolicyPreserved: true },
    runtimeSourceSerializer: false, browserExecuted: false, poolBehaviorVerified: false, installedHostAccepted: false } }
}

/** Build-time only; callers cache per actually loaded package entry. */
export async function prepareStaticPicaParent({ kind, directory }) {
  const input = await readStaticPicaInput({ kind, directory })
  return adaptStaticPicaParent(input, await compileStaticPicaWorker(input))
}
