import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { isBuiltin } from 'node:module'
import { dirname, resolve } from 'node:path'

export const NODE_REQUIRE_INITIALIZER = '(() => createRequire(import.meta.url))()'
const children = node => Object.values(node).flatMap(v => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : [])
const contains = (outer, node) => outer.start <= node.start && node.end <= outer.end

/** Static export/import closure for one exact Node initializer, never a name whitelist. */
export function proveKnownNodeLoaders(files, { parse, shape }) {
  const expected = shape(parse(NODE_REQUIRE_INITIALIZER).body[0].expression)
  const modules = new Map(), bases = []
  for (const [path, code] of files) {
    const program = parse(code), nodes = [], parents = new WeakMap()
    function walk(node) { nodes.push(node); for (const child of children(node)) { parents.set(child, node); walk(child) } }
    walk(program)
    const module = { path, code, program, nodes, parents, skip: [], definitions: [], trackedLoads: [], proof: [] }
    modules.set(path, module)
    for (const node of nodes) if (node.type === 'VariableDeclarator' && node.id.name === '__require' && shape(node.init) === expected) {
      // Standalone bundled Node helpers without an export stay under ordinary checks.
      if (program.body.some(s => s.type === 'ExportNamedDeclaration' && !s.source && s.specifiers.some(p => p.local.name === '__require'))) bases.push({ module, node })
    }
  }
  if (!bases.length) return modules
  assert.equal(bases.length, 1, 'Expected one Node loader forwarding base')
  const base = bases[0], consumers = [], calls = []
  function references(module, name) {
    return module.nodes.filter(node => {
      if (node.type !== 'Identifier' || node.name !== name) return false
      const parent = module.parents.get(node)
      if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) return false
      if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && parent.key === node && !parent.computed && !parent.shorthand) return false
      return true
    })
  }
  const declaration = base.module.parents.get(base.node)
  assert.ok(declaration.type === 'VariableDeclaration' && base.module.program.body.includes(declaration), 'Node loader must be a top-level declaration')
  const imports = base.module.program.body.filter(s => s.type === 'ImportDeclaration' && s.source.value === 'node:module')
    .flatMap(s => s.specifiers).filter(s => s.type === 'ImportSpecifier' && s.imported.name === 'createRequire' && s.local.name === 'createRequire')
  assert.equal(imports.length, 1, 'Expected exact node:module createRequire import')
  for (const node of references(base.module, 'createRequire')) {
    assert.ok(base.module.parents.get(node) === imports[0] || contains(base.node.init, node), 'createRequire binding changed, shadowed or escaped')
  }
  const exports = []
  for (const node of references(base.module, '__require')) {
    if (node === base.node.id) continue
    const parent = base.module.parents.get(node), owner = base.module.parents.get(parent)
    assert.ok(parent?.type === 'ExportSpecifier' && parent.local === node && parent.exported.type === 'Identifier' && owner?.type === 'ExportNamedDeclaration' && !owner.source, 'Node loader binding changed, shadowed or escaped')
    exports.push(parent)
  }
  assert.equal(exports.length, 1, 'Expected one Node loader export')
  const loaderExport = exports[0].exported.name
  base.module.skip.push(base.node.init); base.module.definitions.push(base.node.id)

  for (const module of modules.values()) for (const node of module.nodes) {
    let source
    if (node.type === 'ImportExpression') source = node.source?.value
    if (node.type === 'CallExpression') {
      const callee = node.callee
      const direct = callee.type === 'Identifier' && /^(?:require|_dereq_|__require(?:\$\d+)?)$/u.test(callee.name)
      const member = callee.type === 'MemberExpression' && ['require', 'resolve'].includes(callee.property.name ?? callee.property.value)
      const created = callee.type === 'CallExpression' && callee.callee.type === 'Identifier' && /^createRequire(?:\$\d+)?$/u.test(callee.callee.name)
      if (direct || member || created) source = node.arguments[0]?.value
    }
    if (typeof source === 'string' && resolve(dirname(module.path), source) === base.module.path) throw new Error('Dynamic or non-static Node loader module entry rejected')
  }
  for (const module of modules.values()) for (const statement of module.program.body) {
    if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(statement.type) || !statement.source) continue
    if (resolve(dirname(module.path), statement.source.value) !== base.module.path) continue
    assert.equal(statement.type, 'ImportDeclaration', 'Node loader re-export rejected')
    for (const specifier of statement.specifiers) {
      assert.equal(specifier.type, 'ImportSpecifier', 'Node loader namespace/default import rejected')
      if (specifier.imported.name !== loaderExport) continue
      assert.equal(specifier.local.name, '__require', 'Node loader renamed consumer rejected')
      consumers.push({ module, specifier })
    }
  }
  assert.ok(consumers.length > 0, 'Missing Node loader consumer')
  assert.equal(new Set(consumers.map(c => c.module.path)).size, consumers.length, 'Repeated Node loader binding')
  for (const { module, specifier } of consumers) {
    let count = 0
    for (const node of references(module, '__require')) {
      if (module.parents.get(node) === specifier) continue
      const parent = module.parents.get(node)
      assert.ok(parent?.type === 'CallExpression' && parent.callee === node && parent.arguments.length === 1, 'Node loader consumer alias, reassignment, shadowing or escape rejected')
      assert.ok(parent.arguments[0].type === 'Literal' && typeof parent.arguments[0].value === 'string' && isBuiltin(parent.arguments[0].value), 'Node loader consumer must call a literal builtin')
      calls.push({ file: module.path, start: parent.start, source: parent.arguments[0].value }); count++
    }
    assert.ok(count > 0, 'Unused Node loader consumer')
  }
  const proof = { kind: 'known-node-loader-chain', files: [base.module, ...consumers.map(c => c.module)].map(m => ({ file: m.path, sha256: createHash('sha256').update(m.code).digest('hex') })),
    builtinCalls: calls, runtimeExecuted: false, dynamicClosureVerified: false }
  for (const module of [base.module, ...consumers.map(c => c.module)]) module.proof.push(proof)
  return modules
}
