import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'

export const EXCALIDRAW_REQUIRE_SHIM = `((b) => typeof __require < "u" ? __require : typeof Proxy < "u" ? new Proxy(b, { get: (a, c) => (typeof __require < "u" ? __require : a)[c] }) : b)(function(b) {
  if (typeof __require < "u") return __require.apply(this, arguments);
  throw Error("Dynamic require of \\"" + b + "\\" is not supported");
})`
export const ROLLDOWN_REQUIRE_SHIM = `((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, { get: (a, b) => (typeof require !== "undefined" ? require : a)[b] }) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error("Calling \u0060require\u0060 for \\"" + x + "\\" in an environment that doesn't expose the \u0060require\u0060 function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.");
})`

const children = node => Object.values(node).flatMap(value => Array.isArray(value) ? value.filter(x => x?.type) : value?.type ? [value] : [])
const contains = (outer, node) => outer.start <= node.start && outer.end >= node.end
const unparen = node => node?.type === 'ParenthesizedExpression' ? unparen(node.expression) : node

/** One deliberately narrow emitted-module proof, not a JavaScript interpreter. */
export function proveKnownBrowserLoaders(files, { parse, shape, dispatcher }) {
  const expectedExcalidraw = shape(parse(EXCALIDRAW_REQUIRE_SHIM).body[0].expression)
  const expectedRolldown = shape(parse(ROLLDOWN_REQUIRE_SHIM).body[0].expression)
  const expectedDispatcher = shape(unparen(parse(`(${dispatcher})`).body[0].expression))
  const modules = new Map(), carriers = [], bases = []
  for (const [path, code] of files) {
    const program = parse(code), parents = new WeakMap(), nodes = []
    function walk(node) { nodes.push(node); for (const child of children(node)) { parents.set(child, node); walk(child) } }
    walk(program)
    const module = { path, code, program, parents, nodes, skip: [], definitions: [], trackedLoads: [], proof: [] }
    modules.set(path, module)
    // Font transformation can remove the last consumer of this upstream
    // helper. Only its exact top-level, discarded return value is inert;
    // assigned helpers and loader references elsewhere still require proof.
    for (const statement of program.body) {
      if (statement.type === 'ExpressionStatement' && shape(statement.expression) === expectedExcalidraw) {
        assert.ok(references(module, '__require').every(node => {
          const parent = module.parents.get(node)
          return contains(statement.expression, node) || (parent?.type === 'ImportSpecifier' && parent.local === node)
        }), 'Discarded Excalidraw loader has another reference or consumer')
        module.skip.push(statement.expression)
        carriers.push({ module, node: { init: statement.expression }, discarded: true })
      }
    }
    for (const node of nodes) if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression' && unparen(node.init.callee).type === 'ArrowFunctionExpression' && node.init.arguments.length === 1 && node.init.arguments[0].type === 'FunctionExpression') {
      if (shape(node.init) === expectedExcalidraw) carriers.push({ module, node })
      if (shape(node.init) === expectedRolldown) bases.push({ module, node })
    }
  }
  if (!carriers.length) return modules
  assert.equal(carriers.length, 1, 'Unexpected additional Excalidraw loader carrier')
  assert.equal(bases.length, 1, 'Missing or additional Rolldown loader source')
  const carrier = carriers[0], base = bases[0]
  assert.equal(base.node.id.name, '__require', 'Unexpected Rolldown loader binding')
  const loaderModules = [base.module.path, ...(carrier.discarded ? [] : [carrier.module.path])]
  // A namespace obtained dynamically can expose the loader without a static
  // import binding. A proven discarded shim exposes no loader to such an entry.
  for (const module of modules.values()) for (const node of module.nodes) {
    let source
    if (node.type === 'ImportExpression') source = node.source?.value
    if (node.type === 'CallExpression') {
      const callee = node.callee
      const direct = callee.type === 'Identifier' && /^(?:require|_dereq_|__require(?:\$\d+)?)$/u.test(callee.name)
      const member = callee.type === 'MemberExpression' && (callee.property.name ?? callee.property.value) && ['require', 'resolve'].includes(callee.property.name ?? callee.property.value)
      const created = callee.type === 'CallExpression' && callee.callee.type === 'Identifier' && /^createRequire(?:\$\d+)?$/u.test(callee.callee.name)
      if (direct || member || created) source = node.arguments[0]?.value
    }
    if (typeof source === 'string' && loaderModules.includes(resolve(dirname(module.path), source))) {
      const prefix = module.code.slice(0, node.start)
      throw new Error(`Dynamic or non-static known-loader module entry is unverified in ${module.path}:${prefix.split('\n').length}:${node.start - prefix.lastIndexOf('\n')} (${node.type}, ${JSON.stringify(source)})`)
    }
  }
  function references(module, name) {
    return module.nodes.filter(node => {
      if (node.type !== 'Identifier' || node.name !== name) return false
      const parent = module.parents.get(node)
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return false
      if (parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return false
      return true
    })
  }
  function exported(module, declaration, alias) {
    assert.ok(module.program.body.includes(module.parents.get(declaration)), 'Known loader must have a unique top-level binding')
    const name = declaration.id.name, exports = []
    for (const node of references(module, name)) {
      if (node === declaration.id || contains(declaration.init, node)) continue
      const parent = module.parents.get(node), owner = module.parents.get(parent)
      assert.ok(parent?.type === 'ExportSpecifier' && parent.local === node && owner?.type === 'ExportNamedDeclaration' && !owner.source && parent.exported.name === alias, `Loader binding escaped or reassigned: ${name}`)
      exports.push(parent)
    }
    assert.equal(exports.length, 1, `Expected one static loader export: ${name}`)
    module.skip.push(declaration.init); module.definitions.push(declaration.id)
  }
  exported(base.module, base.node, 'i')
  if (!carrier.discarded) exported(carrier.module, carrier.node, 'W')
  const baseConsumers = [], leafConsumers = []
  for (const module of modules.values()) for (const statement of module.program.body) {
    if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(statement.type) || !statement.source) continue
    const target = resolve(dirname(module.path), statement.source.value)
    if (!loaderModules.includes(target)) continue
    assert.notEqual(statement.type, 'ExportAllDeclaration', 'Loader export star is unverified')
    for (const specifier of statement.specifiers) {
      assert.equal(specifier.type, 'ImportSpecifier', 'Loader namespace/re-export is unverified')
      if (target === base.module.path && specifier.imported.name === 'i') baseConsumers.push({ module, specifier })
      if (!carrier.discarded && target === carrier.module.path && specifier.imported.name === 'W') leafConsumers.push({ module, specifier })
    }
  }
  assert.equal(baseConsumers.length, 3, 'Unexpected Rolldown loader consumers')
  assert.equal(new Set(baseConsumers.map(x => x.module.path)).size, 3, 'Repeated Rolldown loader consumer')
  assert.equal(baseConsumers.filter(x => x.module === carrier.module).length, 1, 'Excalidraw carrier does not import proven Rolldown loader')
  for (const { module, specifier } of baseConsumers) {
    assert.equal(specifier.local.name, '__require', 'Rolldown loader alias is unverified')
    const dispatchers = module.nodes.filter(node => node.type === 'FunctionExpression' && node.params.length === 0 && node.body.body[0]?.type === 'FunctionDeclaration' && node.body.body[0].id?.name === 'r' && shape(node) === expectedDispatcher)
    for (const node of references(module, '__require')) {
      const parent = module.parents.get(node)
      if (parent === specifier) continue
      const isCarrier = module === carrier.module && contains(carrier.node.init, node)
      assert.ok(isCarrier || dispatchers.some(dispatcher => contains(dispatcher, node)), 'Rolldown loader consumer escaped or changed')
    }
    if (module !== carrier.module) assert.equal(dispatchers.length, 1, 'Expected one checked Browserify dispatcher')
  }
  assert.equal(leafConsumers.length, carrier.discarded ? 0 : 1, 'Unexpected additional Excalidraw shim consumer')
  const leaf = leafConsumers[0], loads = []
  for (const node of leaf ? references(leaf.module, leaf.specifier.local.name) : []) {
    const parent = leaf.module.parents.get(node)
    if (parent === leaf.specifier) continue
    assert.ok(parent?.type === 'CallExpression' && parent.callee === node && parent.arguments.length === 1, 'Excalidraw loader alias, reassignment or escape')
    const argument = parent.arguments[0], callee = argument.callee
    assert.ok(argument.type === 'CallExpression' && argument.arguments.length === 0 && callee?.type === 'MemberExpression' && !callee.computed && callee.property.name === 'join' && callee.object.type === 'ArrayExpression' && callee.object.elements.length === 1, 'Excalidraw loader argument is not a literal single-element join')
    const source = callee.object.elements[0]?.value
    assert.ok(['fs', 'path'].includes(source), 'Unexpected Excalidraw runtime dependency')
    loads.push({ kind: 'known-shim-builtin', source, start: parent.start, provenance: 'precise Excalidraw/Rolldown export-import chain', browserExecuted: false })
  }
  assert.deepEqual(loads.map(load => load.source).sort(), carrier.discarded ? [] : ['fs', 'path'], 'Unexpected Excalidraw builtin calls')
  if (leaf) leaf.module.trackedLoads.push(...loads)
  const proofModules = [base.module, carrier.module, ...(leaf ? [leaf.module] : [])]
  const proof = { kind: 'known-browser-loader-chain', discardedCarrier: Boolean(carrier.discarded), files: proofModules.map(module => ({ file: module.path, sha256: createHash('sha256').update(module.code).digest('hex') })), builtinCalls: loads, browserExecuted: false, dynamicClosureVerified: false }
  for (const module of proofModules) module.proof.push(proof)
  return modules
}
