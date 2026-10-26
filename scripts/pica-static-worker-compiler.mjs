import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const semver = require('semver')
const nodeEngine = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).engines.node
const compilerRequire = createRequire(require.resolve('tsdown'))
const { parseSync } = await import(pathToFileURL(compilerRequire.resolve('rolldown/utils')))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const pins = Object.freeze({
  standalone: { name: 'pica', version: '7.1.1', entry: 'dist/pica.js',
    source: '236fb295eb3089e7a95daf40ec8ea5512411591b7a71bd571bc90bcc4c0dcc5a',
    manifest: 'd3c4978a27b8df70dd4df5db0b02551844f1d22d31b432fea1504b5f2af0d0ff',
    license: '55c3dde19ab8a9b9b23c576375fb7a48423124d76530a3ddeeb897a3c47223aa' },
  embedded: { name: 'image-blob-reduce', version: '3.0.1', entry: 'dist/image-blob-reduce.esm.mjs',
    source: '0871855722bc66efe6c9d9d23cda97732c2ce08b938f21912994fd4dfdc95da4',
    manifest: '8fb21f9331d74fdafdfd05203c753cb691265ea487255713b8b41b7041e68c8f',
    license: '23620d4179e5deb477db18c09c07f5bc2bd9ffd6ccd0839a3da79d156694b980' },
})
const expectedDeps = {
  1: { './mm_resize': 4, './mm_unsharp_mask': 9, inherits: 19, multimath: 20 },
  2: {}, 3: {}, 4: { './convolve_wasm_base64': 3, './resize': 5, './resize_wasm': 8 },
  5: { './convolve': 2, './resize_filter_gen': 6 }, 6: { './resize_filter_info': 7 }, 7: {},
  8: { './resize_filter_gen': 6 }, 9: { './unsharp_mask': 10, './unsharp_mask_wasm': 11, './unsharp_mask_wasm_base64': 12 },
  10: { 'glur/mono16': 18 }, 11: {}, 12: {}, 17: { './mathlib': 1 }, 18: {}, 19: {},
  20: { './lib/base64decode': 21, './lib/wa_detect': 22, 'object-assign': 23 }, 21: {}, 22: {}, 23: {},
}
const expectedGlobals = {
  1: [], 2: [], 3: [], 4: [], 5: ['Uint8Array'], 6: ['Float32Array', 'Int16Array', 'Math'], 7: ['Math'],
  8: ['Math', 'Uint32Array', 'Uint8Array'], 9: [], 10: ['Math', 'Uint16Array'], 11: ['Math', 'Uint32Array'], 12: [],
  17: ['Boolean', 'ImageData', 'OffscreenCanvas', 'Uint8ClampedArray', 'createImageBitmap', 'onmessage', 'postMessage'],
  18: ['Float32Array', 'Math', 'Uint16Array'], 19: ['Object'],
  20: ['Error', 'Math', 'Object', 'Promise', 'Uint32Array', 'Uint8Array', 'WebAssembly'],
  21: ['Uint8Array'], 22: ['Uint8Array', 'WebAssembly'], 23: ['Object', 'String', 'TypeError', 'undefined'],
}
const parentDeps = { './lib/mathlib': 1, './lib/pool': 13, './lib/stepper': 14, './lib/tiler': 15,
  './lib/utils': 16, './lib/worker': 17, 'object-assign': 23, webworkify: 24 }
const graphIds = Object.keys(expectedDeps).map(Number)
const serializerHash = 'dd4bb93de1147b4ca0b4ecdecfe077dbd9bb5169c80d8416adfc3fe901bdbf96'
const functionTypes = new Set(['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'])
const forbiddenCalls = new Set(['require', 'importScripts', 'fetch', 'eval', 'Function', 'Worker', 'SharedWorker'])
const nativeGlobals = new Set([...Object.values(expectedGlobals).flat(), 'self'])
const notices = [
  ['pica', 'LICENSE', '55c3dde19ab8a9b9b23c576375fb7a48423124d76530a3ddeeb897a3c47223aa'],
  ['glur', 'LICENSE', 'b6138f8837c5776c0760cb5a711e593dacd423b11195f6365ab17be69e715fcc'],
  ['inherits', 'LICENSE', '5ffe28e7ade7d8f10d85d5337a73fd793dac5c462fb9a28fbf8c5046c7fbca3b'],
  ['multimath', 'LICENSE', '87ce65401af04f9a31e681276faeb166e0de56cc483751d6ca99a7dcb353dd7f'],
  ['object-assign', 'license', '6fb9754611c20f6649f68805e8c990e83261f29316e29de9e6cedae607b8634c'],
  ['rolldown', 'LICENSE', '23ecfff35a5a2e80d92142f75228912c3b1abc4b5a8337a821ff4397e2f9f734'],
  ['rolldown', 'THIRD-PARTY-LICENSE', 'a877291d800ed43692f3f9ae09d8e01cc6f7293ad39d43896059c188ffbb8b7c'],
]
const children = node => Object.values(node).flatMap(value => Array.isArray(value)
  ? value.filter(child => child?.type) : value?.type ? [value] : [])
const unparen = node => node?.type === 'ParenthesizedExpression' ? unparen(node.expression) : node
const key = property => property.computed ? undefined : property.key.value ?? property.key.name
const parse = code => {
  assert.equal(typeof code, 'string'); assert.ok(Buffer.byteLength(code) <= 256 * 1024, 'Worker source budget exceeded')
  const result = parseSync('pica-worker.js', code)
  assert.equal(result.errors.length, 0, 'Cannot parse Worker JavaScript')
  return result.program
}

// A finite lexical index for the fixed ES5 factories and compiler wrappers.
// Block/catch/function/arrow bindings are distinct; all declarations are indexed
// before references resolve, so a shadow or TDZ spelling never becomes a global.
function lexical(root) {
  const parents = new WeakMap(), scopes = new WeakMap(), ids = new WeakSet(), nodes = []
  const scope = (parent, variable = false) => ({ parent, variable, bindings: new Map() })
  const outer = scope(null, true)
  function declare(s, id) {
    assert.equal(id?.type, 'Identifier', 'Unsupported Worker binding pattern')
    let token = s.bindings.get(id.name)
    if (!token) s.bindings.set(id.name, token = { name: id.name, declarations: [] })
    token.declarations.push(id); ids.add(id); return token
  }
  function walk(node, current, parent) {
    nodes.push(node); if (parent) parents.set(node, parent)
    assert.ok(!['WithStatement', 'ClassDeclaration', 'ClassExpression'].includes(node.type), 'Unsupported Worker scope')
    if (node.type === 'FunctionDeclaration') declare(current, node.id)
    if (functionTypes.has(node.type)) {
      current = scope(current, true)
      if (node.type !== 'ArrowFunctionExpression') current.bindings.set('arguments', { name: 'arguments', declarations: [] })
      if (node.type === 'FunctionExpression' && node.id) declare(current, node.id)
      node.params.forEach(id => declare(current, id))
    } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement'].includes(node.type)) {
      current = scope(current)
      if (node.type === 'CatchClause') declare(current, node.param)
    }
    if (node.type === 'VariableDeclaration') {
      let owner = current
      if (node.kind === 'var') while (!owner.variable) owner = owner.parent
      node.declarations.forEach(d => declare(owner, d.id))
    }
    scopes.set(node, current)
    for (const child of children(node)) walk(child, current, node)
  }
  walk(root, outer)
  const keyOnly = node => {
    const parent = parents.get(node)
    return parent?.type === 'MemberExpression' && !parent.computed && parent.property === node
      || parent?.type === 'Property' && !parent.computed && parent.key === node && !parent.shorthand
      || ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type) && parent.label === node
  }
  const binding = node => {
    for (let s = scopes.get(node); s; s = s.parent) if (s.bindings.has(node.name)) return s.bindings.get(node.name)
  }
  const references = nodes.filter(n => n.type === 'Identifier' && !ids.has(n) && !keyOnly(n))
  const refs = token => references.filter(n => binding(n) === token)
  return { nodes, parents, scopes, binding, refs, references, free: references.filter(n => !binding(n)) }
}
const span = (code, node) => ({ start: node.start, end: node.end, bytes: Buffer.byteLength(code.slice(node.start, node.end)), sha256: hash(code.slice(node.start, node.end)) })
const bindingRecord = (code, token, index) => ({ name: token.name,
  declarations: token.declarations.map(id => span(code, id)), references: index.refs(token).map(id => span(code, id)) })
function mapping(node) {
  assert.equal(node?.type, 'ObjectExpression', 'Expected literal dependency mapping')
  const pairs = node.properties.map(property => {
    const name = key(property)
    assert.equal(property.type, 'Property'); assert.equal(property.kind, 'init')
    assert.ok(typeof name === 'string' && !['__proto__', 'constructor', 'prototype'].includes(name), 'Unsafe mapping key')
    assert.equal(property.value.type, 'Literal'); assert.ok(Number.isSafeInteger(property.value.value))
    return [name, property.value.value]
  })
  assert.equal(new Set(pairs.map(([name]) => name)).size, pairs.length, 'Duplicate mapping')
  return Object.fromEntries(pairs)
}
function literalLoads(factory, deps) {
  const index = lexical(factory), loader = index.binding(factory.params[0]), loads = []
  for (const ref of index.refs(loader)) {
    const call = index.parents.get(ref)
    assert.ok(call?.type === 'CallExpression' && call.callee === ref && call.arguments.length === 1
      && call.arguments[0].type === 'Literal' && typeof call.arguments[0].value === 'string', 'Factory loader escaped or is not literal')
    assert.ok(Object.hasOwn(deps, call.arguments[0].value), 'Missing literal dependency mapping')
    loads.push({ node: call, source: call.arguments[0].value, target: deps[call.arguments[0].value] })
  }
  const argumentToken = index.scopes.get(factory).bindings.get('arguments')
  assert.equal(index.refs(argumentToken).length, 0, 'Factory extra arguments escaped')
  return { index, loads }
}

export async function readStaticPicaInput({ kind, directory }) {
  assert.ok(Object.hasOwn(pins, kind), 'Unknown Pica input role')
  const [source, manifest, license] = await Promise.all([readFile(join(directory, pins[kind].entry), 'utf8'),
    readFile(join(directory, 'package.json'), 'utf8'), readFile(join(directory, 'LICENSE'), 'utf8')])
  return { kind, source, manifest, license }
}

function inspect(input) {
  assert.ok(input && Object.hasOwn(pins, input.kind), 'Unknown Pica input role')
  const pin = pins[input.kind], manifest = JSON.parse(input.manifest)
  assert.equal(manifest.name, pin.name, 'Source package identity drift'); assert.equal(manifest.version, pin.version, 'Source version drift')
  assert.equal(hash(input.manifest), pin.manifest, 'Source manifest drift'); assert.equal(hash(input.license), pin.license, 'Source notice drift')
  const { source } = input, program = parse(source), index = lexical(program)
  const tables = index.nodes.filter(n => n.type === 'ObjectExpression' && n.properties.length === 25
    && n.properties.some(property => key(property) === 17))
  assert.equal(tables.length, 1, 'Expected one fixed Pica table')
  const table = tables[0], models = new Map()
  assert.deepEqual(table.properties.map(key), [...Array.from({ length: 24 }, (_, i) => i + 1), '/index.js'], 'Pica module table drift')
  for (const property of table.properties) {
    assert.equal(property.type, 'Property'); assert.equal(property.value.type, 'ArrayExpression')
    assert.equal(property.value.elements.length, 2)
    const [factory, map] = property.value.elements
    assert.equal(factory.type, 'FunctionExpression'); assert.equal(factory.params.length, 3)
    assert.ok(factory.params.every(p => p.type === 'Identifier'))
    models.set(key(property), { id: key(property), factory, deps: mapping(map) })
  }
  const tableCall = index.parents.get(table)
  assert.ok(tableCall.type === 'CallExpression' && tableCall.arguments[0] === table
    && tableCall.callee.type === 'CallExpression' && unparen(tableCall.callee.callee).type === 'FunctionExpression', 'Pica dispatcher shape drift')
  assert.ok(tableCall.arguments[1].type === 'ObjectExpression' && tableCall.arguments[1].properties.length === 0
    && tableCall.arguments[2].type === 'ArrayExpression' && tableCall.arguments[2].elements.length === 0, 'Pica initial cache/entry drift')
  const modules = graphIds.map(id => {
    const model = models.get(id)
    assert.deepEqual(model.deps, expectedDeps[id], 'Task literal dependency mapping drift')
    const { index: local, loads } = literalLoads(model.factory, model.deps)
    const globals = [...new Set(local.free.map(n => n.name))].sort()
    assert.deepEqual(globals, expectedGlobals[id], `Unknown free binding in factory ${id}`)
    model.local = local
    return { id, factory: span(source, model.factory), deps: model.deps, freeGlobals: globals,
      literalLoads: loads.map(load => ({ source: load.source, target: load.target, ...span(source, load.node) })) }
  })
  const parent = models.get('/index.js')
  assert.deepEqual(parent.deps, parentDeps, 'Parent dependency mapping drift')
  const { index: parentIndex, loads } = literalLoads(parent.factory, parent.deps)
  const workerLoads = loads.filter(load => load.source === 'webworkify')
  assert.equal(workerLoads.length, 2, 'Unknown webworkify role')
  const aliasLoad = workerLoads.find(load => parentIndex.parents.get(load.node)?.type === 'VariableDeclarator')
  assert.ok(aliasLoad, 'Task webworkify binding missing')
  const aliasDecl = parentIndex.parents.get(aliasLoad.node), alias = parentIndex.binding(aliasDecl.id)
  const aliasRefs = parentIndex.refs(alias)
  assert.equal(aliasRefs.length, 1, 'Task webworkify alias escaped')
  const taskCall = parentIndex.parents.get(aliasRefs[0])
  assert.ok(taskCall.type === 'CallExpression' && taskCall.callee === aliasRefs[0] && taskCall.arguments.length === 1
    && taskCall.arguments[0].type === 'Identifier', 'Unknown task Worker role')
  const workerToken = parentIndex.binding(taskCall.arguments[0]), workerRefs = parentIndex.refs(workerToken)
  assert.ok(workerToken && workerRefs.length === 1 && workerRefs[0] === taskCall.arguments[0], 'Task factory binding escaped')
  const workerDecl = parentIndex.parents.get(workerToken.declarations[0])
  assert.ok(workerDecl.type === 'VariableDeclarator' && loads.some(load => load.node === workerDecl.init && load.target === 17), 'Task factory is not original module17')
  const probeLoad = workerLoads.find(load => load !== aliasLoad), probeCall = parentIndex.parents.get(probeLoad.node)
  assert.ok(probeCall.type === 'CallExpression' && probeCall.callee === probeLoad.node && probeCall.arguments.length === 1, 'Unknown probe Worker role')
  const probe = probeCall.arguments[0]
  assert.ok(probe.type === 'FunctionExpression' && probe.params.length === 0 && probe.body.body.length === 0, 'Probe must be the original empty function')
  const serializer = models.get(24)
  assert.equal(hash(source.slice(serializer.factory.start, serializer.factory.end)), serializerHash, 'Runtime serializer source drift')
  const wasm = [3, 12].map(id => {
    const statements = models.get(id).factory.body.body
    const value = statements.find(n => n.expression?.type === 'AssignmentExpression')?.expression.right
    assert.ok(value?.type === 'Literal' && typeof value.value === 'string' && /^[A-Za-z0-9+/]+={0,2}$/u.test(value.value), 'WASM must stay inline base64')
    const bytes = Buffer.from(value.value, 'base64')
    assert.equal(bytes.subarray(0, 8).toString('hex'), '0061736d01000000')
    return { module: id, base64Sha256: hash(value.value), bytes: bytes.length, sha256: hash(bytes) }
  })
  assert.equal(hash(source), pin.source, 'Unreviewed Pica source bytes')
  const result = { kind: input.kind, package: pin.name, version: pin.version,
    source: { bytes: Buffer.byteLength(source), sha256: pin.source, manifestSha256: pin.manifest, licenseSha256: pin.license },
    table: span(source, table), dispatcher: span(source, tableCall.callee.callee), serializer: span(source, serializer.factory),
    auxiliaryFactory: span(source, models.get(16).factory), parentFactory: span(source, parent.factory),
    modules, wasm, callers: { task: span(source, taskCall), probe: span(source, probeCall), probeFunction: span(source, probe),
      loaderBinding: bindingRecord(source, parentIndex.binding(parent.factory.params[0]), parentIndex),
      taskAdapterBinding: bindingRecord(source, alias, parentIndex), taskFactoryBinding: bindingRecord(source, workerToken, parentIndex) },
    boundaries: ['Task and empty probe only; module16 OffscreenCanvas payload belongs to the later parent integration.',
      'No parent Pool/concurrency/idle/cancel/UI or installed-Host acceptance.'] }
  return { result, models, probe }
}

/** Exact source identity, original-factory retention and caller binding evidence. */
export function inspectStaticPicaInput(input) { return inspect(input).result }

// Compare real local binding identities, not identifier spellings. Rolldown
// expands shorthand and renames module/exports; property keys remain semantic.
function alphaShape(root) {
  const index = lexical(root), tokens = new Map()
  function shape(node, parent, field) {
    if (Array.isArray(node)) return node.map(child => shape(child, parent, field))
    if (!node || typeof node !== 'object') return node
    if (node.type === 'ParenthesizedExpression') return shape(node.expression, parent, field)
    if (node.type === 'Identifier') {
      const property = field === 'key' && parent?.type === 'Property' && !parent.computed
        || field === 'property' && parent?.type === 'MemberExpression' && !parent.computed
      const token = !property && index.binding(node)
      if (token) { if (!tokens.has(token)) tokens.set(token, tokens.size); return { type: 'Identifier', binding: tokens.get(token) } }
    }
    return Object.fromEntries(Object.entries(node).filter(([key]) =>
      !['start', 'end', 'loc', 'raw', 'comments', 'leadingComments', 'trailingComments', 'shorthand'].includes(key))
      .map(([key, value]) => [key, shape(value, node, key)]))
  }
  return JSON.stringify(shape(root))
}
const expression = code => unparen(parse(`(${code});`).body[0].expression)
const commonJsShape = alphaShape(expression('(cb,mod)=>()=>(mod||(cb((mod={exports:{}}).exports,mod),cb=null),mod.exports)'))
const probeShape = alphaShape(parse('(function(){(function(){})(self);})();'))

function proveCompiledTask(code, index, input) {
  const { models } = inspect(input), program = index.nodes[0]
  assert.equal(program.body.length, 1, 'Unknown Worker top-level source')
  const entry = program.body[0]
  assert.ok(entry.type === 'ExpressionStatement' && entry.expression.type === 'CallExpression'
    && !entry.expression.optional && entry.expression.arguments.length === 0, 'Worker must be a classic IIFE')
  const iife = unparen(entry.expression.callee)
  assert.ok(iife.type === 'FunctionExpression' && iife.params.length === 0 && !iife.id
    && !iife.async && !iife.generator, 'Unknown Worker IIFE flags')
  const statements = new Set(), loaderUses = new Map(), modules = new Map()
  const shapes = new Map(graphIds.map(id => [alphaShape(models.get(id).factory), id]))
  assert.equal(shapes.size, graphIds.length, 'Ambiguous original factory shapes')
  const calls = index.nodes.filter(node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    && !node.callee.computed && node.callee.property.name === 'call'
    && unparen(node.callee.object).type === 'FunctionExpression' && unparen(node.callee.object).params.length === 3)
  assert.equal(calls.length, graphIds.length, 'Compiled task factory set drift')
  let cacheToken, cacheDeclaration
  const permittedCacheUses = []
  const variableStatement = declarator => {
    const statement = index.parents.get(declarator)
    assert.ok(statement.type === 'VariableDeclaration' && statement.kind === 'var' && statement.declarations.length === 1
      && index.parents.get(statement) === iife.body, 'CJS binding escaped its IIFE')
    statements.add(statement); return statement
  }
  const isExports = (node, token) => node?.type === 'MemberExpression' && !node.computed
    && !node.optional && node.property.name === 'exports' && node.object.type === 'Identifier' && index.binding(node.object) === token
  for (const call of calls) {
    const factory = unparen(call.callee.object), id = shapes.get(alphaShape(factory))
    assert.ok(id && !modules.has(id), 'Compiled factory does not retain its original binding-aware AST')
    const original = models.get(id), local = literalLoads(factory, original.deps)
    // A free native name in the factory must still resolve globally; an outer
    // wrapper parameter named Math/Object/etc cannot capture that binding.
    for (const ref of local.index.free) assert.equal(index.binding(ref), undefined, 'Native factory binding captured by compiler wrapper')
    const expressionStatement = index.parents.get(call), body = index.parents.get(expressionStatement)
    assert.ok(expressionStatement.type === 'ExpressionStatement' && body.type === 'BlockStatement'
      && body.body.length === 1, 'Unknown source in CJS factory callback')
    const callback = index.parents.get(body)
    assert.ok(callback.type === 'ArrowFunctionExpression' && !callback.async && callback.params.length === 2, 'Unknown CJS callback flags')
    let wrapped = callback
    while (index.parents.get(wrapped)?.type === 'ParenthesizedExpression') wrapped = index.parents.get(wrapped)
    const cacheCall = index.parents.get(wrapped)
    assert.ok(cacheCall.type === 'CallExpression' && cacheCall.arguments.length === 1
      && !cacheCall.optional && cacheCall.arguments[0] === wrapped && cacheCall.callee.type === 'Identifier', 'Unknown CJS cache invocation')
    const token = index.binding(cacheCall.callee)
    assert.ok(token && (!cacheToken || cacheToken === token), 'Multiple or unknown CJS cache bindings')
    cacheToken = token; permittedCacheUses.push(cacheCall.callee)
    const declaration = index.parents.get(cacheCall)
    assert.ok(declaration.type === 'VariableDeclarator' && declaration.init === cacheCall && declaration.id.type === 'Identifier')
    variableStatement(declaration)
    const moduleToken = index.binding(callback.params[1]), exportsToken = index.binding(callback.params[0])
    assert.equal(index.refs(exportsToken).length, 0, 'CJS callback exports escaped')
    assert.ok(!call.optional && !call.callee.optional && call.arguments.length === 4 && isExports(call.arguments[0], moduleToken)
      && call.arguments[2].type === 'Identifier' && index.binding(call.arguments[2]) === moduleToken
      && isExports(call.arguments[3], moduleToken), 'Factory receiver/module/exports changed')
    assert.equal(index.refs(moduleToken).length, 3, 'CJS callback module escaped')
    const mapper = call.arguments[1]
    assert.ok(mapper.type === 'FunctionExpression' && !mapper.id && !mapper.async && !mapper.generator
      && mapper.params.length === 1 && mapper.body.body.length === 1, 'Unknown literal mapper flags')
    const switchNode = mapper.body.body[0], parameter = index.binding(mapper.params[0])
    assert.ok(switchNode.type === 'SwitchStatement' && switchNode.discriminant.type === 'Identifier'
      && index.binding(switchNode.discriminant) === parameter && index.refs(parameter).length === 1, 'Mapper parameter escaped')
    const cases = switchNode.cases, names = Object.keys(original.deps)
    assert.equal(cases.length, names.length + 1, 'Mapper has extra or missing sources')
    const targets = []
    for (const [position, name] of names.entries()) {
      const arm = cases[position], returned = arm.consequent[0]?.argument
      assert.ok(arm.test?.type === 'Literal' && arm.test.value === name && arm.consequent.length === 1
        && arm.consequent[0].type === 'ReturnStatement' && returned.type === 'CallExpression'
        && !returned.optional && returned.callee.type === 'Identifier' && returned.arguments.length === 0, 'Mapper is not an exact literal cache call')
      targets.push({ source: name, target: original.deps[name], callee: returned.callee })
    }
    const fallback = cases.at(-1), thrown = fallback.consequent[0]?.argument
    assert.ok(fallback.test === null && fallback.consequent.length === 1 && fallback.consequent[0].type === 'ThrowStatement'
      && thrown.type === 'NewExpression' && thrown.callee.type === 'Identifier' && thrown.callee.name === 'Error'
      && !index.binding(thrown.callee) && thrown.arguments.length === 1 && thrown.arguments[0].value === 'Unknown fixed Pica dependency', 'Mapper fallback escaped')
    const loaderToken = index.binding(declaration.id)
    modules.set(id, { id, loaderToken, declaration, targets, factory: span(code, factory) })
    loaderUses.set(loaderToken, [])
  }
  assert.ok(cacheToken?.declarations.length === 1, 'CJS cache reassigned')
  cacheDeclaration = index.parents.get(cacheToken.declarations[0])
  assert.ok(cacheDeclaration.type === 'VariableDeclarator' && alphaShape(cacheDeclaration.init) === commonJsShape, 'CJS lazy-cache implementation changed')
  const cacheStatement = variableStatement(cacheDeclaration)
  assert.equal(iife.body.body.indexOf(cacheStatement), 0, 'CJS cache initialization must precede every module initializer')
  assert.deepEqual(index.refs(cacheToken), permittedCacheUses, 'CJS cache alias or unknown consumer')
  for (const module of modules.values()) for (const target of module.targets) {
    const token = modules.get(target.target)?.loaderToken
    assert.ok(token && index.binding(target.callee) === token, 'Literal mapper points at another module binding')
    loaderUses.get(token).push(target.callee)
  }
  const remaining = iife.body.body.filter(statement => !statements.has(statement))
  assert.equal(remaining.length, 2, 'Unknown Worker entry statements')
  assert.ok(iife.body.body.at(-2) === remaining[0] && iife.body.body.at(-1) === remaining[1],
    'All module initializers must precede task entry initialization')
  const entryDeclaration = remaining[0]?.declarations?.[0]
  assert.ok(remaining[0].type === 'VariableDeclaration' && remaining[0].kind === 'var' && remaining[0].declarations.length === 1
    && entryDeclaration.id.type === 'Identifier' && entryDeclaration.init.type === 'CallExpression'
    && !entryDeclaration.init.optional && entryDeclaration.init.arguments.length === 0 && entryDeclaration.init.callee.type === 'Identifier'
    && index.binding(entryDeclaration.init.callee) === modules.get(17).loaderToken, 'Task entry is not original module17')
  loaderUses.get(modules.get(17).loaderToken).push(entryDeclaration.init.callee)
  const f = index.binding(entryDeclaration.id), invoke = remaining[1]?.expression
  const choice = invoke?.type === 'CallExpression' && unparen(invoke.callee)
  const isDefault = node => node?.type === 'MemberExpression' && !node.computed && !node.optional && node.property.name === 'default'
    && node.object.type === 'Identifier' && index.binding(node.object) === f
  assert.ok(remaining[1].type === 'ExpressionStatement' && !invoke.optional && invoke.arguments.length === 1 && invoke.arguments[0].type === 'Identifier'
    && invoke.arguments[0].name === 'self' && !index.binding(invoke.arguments[0]) && choice.type === 'ConditionalExpression'
    && isDefault(choice.test) && isDefault(choice.consequent) && choice.alternate.type === 'Identifier'
    && index.binding(choice.alternate) === f && index.refs(f).length === 3, 'Original task default-export/self invocation changed')
  for (const [token, allowed] of loaderUses) {
    assert.equal(token.declarations.length, 1, 'CJS loader has extra declarations')
    const refs = index.refs(token)
    assert.ok(refs.length === allowed.length && refs.every(ref => allowed.includes(ref)), 'CJS loader alias or unknown consumer')
  }
  return { factoryCount: modules.size, literalMappings: [...modules.values()].flatMap(module => module.targets.map(target =>
    ({ module: module.id, source: target.source, target: target.target }))),
    originalFactoryAsts: [...modules.values()].map(({ id, factory }) => ({ id, ...factory })), allLoaderBindingsVerified: true }
}

/** Inspect actual script AST, never a JSON manifest or serialized JS string. */
export function analyzeStaticPicaWorker(code, { role, input }) {
  assert.ok(role === 'task' || role === 'probe', 'Unknown static Worker role')
  inspect(input)
  const index = lexical(parse(code)), globals = [...new Set(index.free.map(n => n.name))].sort()
  assert.ok(globals.every(name => nativeGlobals.has(name)), `Unknown Worker free global: ${globals.filter(n => !nativeGlobals.has(n)).join(', ')}`)
  const handlers = index.nodes.filter(n => n.type === 'AssignmentExpression' && n.left.type === 'Identifier'
    && n.left.name === 'onmessage' && !index.binding(n.left))
  assert.equal(handlers.length, role === 'task' ? 1 : 0, 'Task requires a real global message-handler AST')
  const closure = role === 'task' ? proveCompiledTask(code, index, input)
    : (assert.equal(alphaShape(index.nodes[0]), probeShape, 'Unknown empty-probe script'), { factoryCount: 0, literalMappings: [], allLoaderBindingsVerified: true })
  for (const node of index.nodes) {
    assert.ok(!['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration', 'MetaProperty'].includes(node.type), 'Static module escaped Worker')
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee
      const name = callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression'
        ? callee.computed ? callee.property.value : callee.property.name : undefined
      assert.ok(!forbiddenCalls.has(name), `Forbidden Worker loader/resource call: ${name}`)
      assert.ok(name !== 'constructor', 'Dynamic constructor escaped Worker')
    }
    if (node.type === 'Literal' && typeof node.value === 'string') {
      assert.ok(!/^(?:[a-z][a-z0-9+.-]*:\/\/|(?:data|blob|file):|\/\/)/iu.test(node.value), `Unknown Worker resource URL: ${node.value.slice(0, 80)}`)
    }
  }
  return { role, bytes: Buffer.byteLength(code), sha256: hash(code), freeGlobals: globals,
    messageHandlers: handlers.length, externalLoads: [], staticModuleEscapes: [], parsedActualScript: true, closure }
}

function packageVersion(req, name) {
  let file = req.resolve(name)
  for (let i = 0; i < 6; i++) {
    file = dirname(file)
    try { const pkg = JSON.parse(readFileSync(join(file, 'package.json'), 'utf8')); if (pkg.name === name) return pkg.version }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  throw new Error(`Cannot locate toolchain manifest: ${name}`)
}
export function assertStaticPicaToolchain(versions) {
  assert.ok(versions && typeof versions.node === 'string' && semver.valid(versions.node)
    && semver.valid(versions.node) === versions.node.replace(/^v/u, '') && semver.satisfies(versions.node, nodeEngine),
  `Unsupported Worker compiler Node version; expected root engines ${nodeEngine}`)
  const { node: _node, ...compiler } = versions
  assert.deepEqual(compiler, { tsdown: '0.22.14', rolldown: '1.2.4' }, 'Static Worker toolchain drift')
}

async function noticeInputs(input) {
  const result = await Promise.all(notices.map(async ([name, file, sha256]) => {
    const url = new URL(`./test-fixtures/pica-worker/source/${name}/${file}`, import.meta.url)
    const text = await readFile(url, 'utf8')
    assert.equal(hash(text), sha256, 'Worker dependency notice drift')
    return { name, file: url.pathname, sha256, text }
  }))
  if (input.kind === 'embedded') result.push({ name: pins.embedded.name, sha256: pins.embedded.license, text: input.license })
  return result
}

async function compileOne(input, versions, rolldown) {
  const { result: retention, models, probe } = inspect(input), notice = await noticeInputs(input)
  const prefix = `pica-static:${input.kind}/`, virtual = new Map()
  const id = module => `${prefix}${module}.cjs`
  for (const module of graphIds) {
    const { factory, deps } = models.get(module)
    const cases = Object.entries(deps).map(([name, target]) => `case ${JSON.stringify(name)}: return require(${JSON.stringify(id(target))});`).join('\n')
    const loader = `function(specifier) { switch(specifier) { ${cases} default: throw new Error('Unknown fixed Pica dependency'); } }`
    virtual.set(id(module), `(${input.source.slice(factory.start, factory.end)}).call(module.exports, ${loader}, module, module.exports);`)
  }
  virtual.set(id('task'), `var f = require(${JSON.stringify(id(17))}); (f.default ? f.default : f)(self);`)
  virtual.set(id('probe'), `(${input.source.slice(probe.start, probe.end)})(self);`)
  const scripts = {}
  for (const role of ['task', 'probe']) {
    const accessed = new Set()
    const bundle = await rolldown({ input: id(role), platform: 'browser', treeshake: false,
      plugins: [{ name: 'fixed-pica-worker-factories',
        resolveId(source) { assert.ok(virtual.has(source), `Unknown virtual Worker dependency: ${source}`); return '\0' + source },
        load(source) { assert.ok(source.startsWith('\0') && virtual.has(source.slice(1)), 'Unknown Worker source'); accessed.add(source.slice(1)); return virtual.get(source.slice(1)) } }],
      onLog(level, log, handler) { if (level === 'warn') throw new Error(`Worker compiler warning: ${log.message}`); handler(level, log) } })
    let output
    try { output = await bundle.generate({ format: 'iife', minify: false }) }
    finally { await bundle.close() }
    assert.equal(output.output.length, 1, 'Worker must compile to one script')
    const chunk = output.output[0]
    assert.ok(chunk.type === 'chunk' && chunk.imports.length === 0 && chunk.dynamicImports.length === 0, 'Worker external module escaped')
    const expected = role === 'task' ? [...graphIds.map(id), id(role)] : [id(role)]
    assert.deepEqual([...accessed].sort(), expected.sort(), 'Compiled Worker graph drift')
    const header = notice.map(item => `${item.name}\n${item.text}`).join('\n\n')
    assert.ok(!header.includes('*/'))
    const code = `/*! Fixed-source ${input.kind} Pica ${role} Worker.\n${header}\n*/\n${chunk.code}`
    const analysis = analyzeStaticPicaWorker(code, { role, input })
    scripts[role] = { code, sha256: analysis.sha256, analysis,
      virtualInputs: [...accessed].sort().map(name => ({ name, sha256: hash(virtual.get(name)) })), compilerClosed: true }
  }
  return { kind: input.kind, ...scripts, retention, toolchain: versions,
    notices: notice.map(({ text, ...record }) => record),
    compilation: { format: 'iife', platform: 'browser', write: false, minify: false, treeshake: false, nodeEngine,
      factoryExpressionBytesPreservedInVirtualInputs: true, runtimeSourceSerializer: false,
      parentIntegrated: false, browserExecuted: false, poolBehaviorVerified: false } }
}

async function compileInputs(inputs) {
  const versions = { node: process.version, tsdown: packageVersion(require, 'tsdown'), rolldown: packageVersion(compilerRequire, 'rolldown') }
  assertStaticPicaToolchain(versions)
  // Validate every requested source before compiler initialization. A caller
  // compiling one matched package never needs to resolve the other package.
  inputs.forEach(inspect)
  const { rolldown } = await import(pathToFileURL(compilerRequire.resolve('rolldown')))
  const output = []
  for (const input of inputs) output.push(await compileOne(input, versions, rolldown))
  return output
}

/** Build-time only. Compile only the matched, fixed package's two Worker roles. */
export async function compileStaticPicaWorker(input) { return (await compileInputs([input]))[0] }

/** No caller-supplied pin overrides, generic webworkify or pool. */
export async function compileStaticPicaWorkers({ standalone, embedded }) {
  assert.equal(standalone?.kind, 'standalone'); assert.equal(embedded?.kind, 'embedded')
  const [a, b] = await compileInputs([standalone, embedded])
  return { standalone: a, embedded: b }
}
