import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const children = node => Object.entries(node).flatMap(([key, value]) => key === 'parent' ? []
  : Array.isArray(value) ? value.filter(child => child?.type) : value?.type ? [value] : [])
const unparen = node => node?.type === 'ParenthesizedExpression' ? unparen(node.expression) : node
const contains = (outer, node) => outer.start <= node.start && outer.end >= node.end
const hash = code => createHash('sha256').update(code).digest('hex')
/* The AST contract and test excerpt retain lodash's optional-Node detection.
 * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
 * Based on Underscore.js, copyright Jeremy Ashkenas, DocumentCloud and
 * Investigative Reporters & Editors <http://underscorejs.org/>.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */
const template = `var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
var freeProcess = freeModule && freeModule.exports === freeExports && freeGlobal.process;
var nodeUtil = (function() {
  try {
    var types = freeModule && freeModule.require && freeModule.require("util").types;
    if (types) return types;
    return freeProcess && freeProcess.binding && freeProcess.binding("util");
  } catch (e) {}
})();`

/** Index real lexical bindings; unrelated CJS factory parameters are not globals. */
function lexical(program) {
  const parents = new WeakMap(), scopes = new WeakMap(), nodes = []
  const root = { parent: null, kind: 'function', bindings: new Map() }
  const names = node => {
    if (!node) return []
    if (node.type === 'Identifier') return [node]
    if (node.type === 'RestElement') return names(node.argument)
    if (node.type === 'AssignmentPattern') return names(node.left)
    if (node.type === 'ObjectPattern') return node.properties.flatMap(p => names(p.type === 'RestElement' ? p.argument : p.value))
    if (node.type === 'ArrayPattern') return node.elements.flatMap(names)
    return []
  }
  const declare = (scope, pattern, declaration) => {
    for (const id of names(pattern)) {
      let binding = scope.bindings.get(id.name)
      if (!binding) scope.bindings.set(id.name, binding = { scope, name: id.name, declarations: [] })
      binding.declarations.push({ id, declaration })
    }
  }
  function walk(node, current) {
    nodes.push(node)
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') declare(current, node.id, node)
    if (functions.has(node.type)) {
      current = { parent: current, kind: 'function', bindings: new Map() }
      if (node.type === 'FunctionExpression') declare(current, node.id, node)
      for (const param of node.params) declare(current, param, node)
    } else if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement', 'ClassExpression'].includes(node.type)) {
      current = { parent: current, kind: 'block', bindings: new Map() }
      if (node.type === 'CatchClause') declare(current, node.param, node)
      if (node.type === 'ClassExpression') declare(current, node.id, node)
    }
    scopes.set(node, current)
    if (node.type === 'VariableDeclaration') {
      let owner = current
      if (node.kind === 'var') while (owner.kind !== 'function') owner = owner.parent
      for (const declaration of node.declarations) declare(owner, declaration.id, declaration)
    }
    if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers) declare(current, specifier.local, specifier)
    for (const child of children(node)) { parents.set(child, node); walk(child, current) }
  }
  walk(program, root)
  const binding = (node, name = node.name) => {
    for (let scope = scopes.get(node); scope; scope = scope.parent) if (scope.bindings.has(name)) return scope.bindings.get(name)
  }
  const reference = node => {
    const parent = parents.get(node)
    if (parent?.type === 'MemberExpression' && !parent.computed && parent.property === node) return false
    if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) && !parent.computed && parent.key === node && !parent.shorthand) return false
    if (['VariableDeclarator', 'ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(parent?.type) && (parent.id === node || parent.local === node)) return false
    if (functions.has(parent?.type) && (parent.id === node || parent.params.includes(node))) return false
    if (parent?.type === 'CatchClause' && parent.param === node) return false
    return true
  }
  return { nodes, parents, binding, reference }
}

function definition(statement) {
  if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
    const declaration = statement.declarations[0]
    if (declaration.id.type === 'Identifier') return { id: declaration.id, init: declaration.init, declaration }
  }
  const expression = statement.type === 'ExpressionStatement' ? statement.expression : undefined
  if (expression?.type === 'AssignmentExpression' && expression.operator === '=' && expression.left.type === 'Identifier') {
    return { id: expression.left, init: expression.right, assignment: expression }
  }
}

const canonical = (node, names) => JSON.stringify(node, (key, value) => {
  if (['start', 'end', 'loc', 'raw', 'comments', 'leadingComments', 'trailingComments'].includes(key)) return undefined
  if (value?.type === 'ParenthesizedExpression') return value.expression
  if (value?.type === 'Identifier' && names.has(value.name)) return { ...value, name: names.get(value.name) }
  return value
})

/**
 * Opt-in proof for lodash's exact optional Node helper in a standalone browser
 * ESM graph. This does not make Node globals safe or allow a runtime dependency.
 * Returned source hashes/ranges are evidence pins, not a package-name whitelist.
 */
export function proveKnownBrowserLodash(code, { parse, fileName = 'emitted.js' }) {
  const program = parse(code), expected = parse(template).body.map(definition)
  const index = lexical(program), { nodes, parents, binding, reference } = index
  const sourceHash = hash(code)
  const proof = { skip: [], definitions: [], trackedLoads: [], proof: [],
    browserLodashSource: { file: fileName, sha256: sourceHash } }
  const nodeGlobal = node => node?.type === 'Identifier' && ['module', 'exports'].includes(node.name) && binding(node) === undefined
  const globalObject = node => node?.type === 'Identifier' && ['globalThis', 'window', 'self', 'global'].includes(node.name) && binding(node) === undefined
  const globalRoots = new Set(), globalAliases = new Map(), aliasResults = new Map()
  for (const node of nodes) if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
    const token = binding(node.id)
    if (globalObject(node.init)) globalRoots.add(token)
    else if (node.init?.type === 'Identifier') globalAliases.set(token, binding(node.init))
  }
  const isGlobalAlias = (token, seen = new Set()) => {
    if (!token || seen.has(token)) return false
    if (globalRoots.has(token)) return true
    if (aliasResults.has(token)) return aliasResults.get(token)
    seen.add(token)
    const result = isGlobalAlias(globalAliases.get(token), seen)
    aliasResults.set(token, result)
    return result
  }
  const globalTarget = node => globalObject(node) || node?.type === 'Identifier' && isGlobalAlias(binding(node))
  const nodeProperty = node => node?.type === 'MemberExpression' && globalTarget(node.object)
    && ['module', 'exports'].includes(node.computed ? node.property.value : node.property.name)
  const injectedGlobals = nodes.some(node => ['AssignmentExpression', 'UpdateExpression'].includes(node.type)
    && (nodeGlobal(node.left ?? node.argument) || nodeProperty(node.left ?? node.argument)))
  const candidates = nodes.filter(node => node.type === 'CallExpression' && node.callee.type === 'MemberExpression'
    && !node.callee.computed && node.callee.property.name === 'require' && node.callee.object.type === 'Identifier')
  for (const call of candidates) {
    // Recognize the guard block by its complete four-statement structure, never
    // by a freeModule identifier or the require target alone.
    let group
    for (let current = parents.get(call); current; current = parents.get(current)) {
      if (!['VariableDeclarator', 'AssignmentExpression'].includes(current.type)) continue
      const statement = parents.get(current)
      if (!['VariableDeclaration', 'ExpressionStatement'].includes(statement?.type)) continue
      const body = parents.get(statement)?.body
      const position = Array.isArray(body) ? body.indexOf(statement) : -1
      if (position < 3) continue
      const statements = body.slice(position - 3, position + 1), defs = statements.map(definition)
      if (defs.some(value => !value?.init)) continue
      // A discovery hint only: acceptance below compares the full AST.
      if (!code.slice(defs[0].init.start, defs[0].init.end).includes('typeof exports')) continue
      group = { statements, defs }; break
    }
    if (!group) continue // The base classifier still rejects this unknown call.
    const { statements, defs } = group
    assert.equal(injectedGlobals, false, 'Browser module/exports globals are explicitly injected')
    const aliases = new Map(defs.map((value, i) => [value.id.name, expected[i].id.name]))
    const processInit = unparen(defs[2].init)
    const global = processInit.type === 'LogicalExpression' && processInit.right.type === 'MemberExpression' && !processInit.right.computed
      && processInit.right.property.name === 'process' && processInit.right.object.type === 'Identifier' ? processInit.right.object : undefined
    assert.ok(global, 'Unknown lodash optional Node process guard')
    aliases.set(global.name, 'freeGlobal')
    assert.equal(new Set(defs.map(value => value.id.name)).size, 4, 'Lodash guard bindings overlap')
    for (let i = 0; i < defs.length; i++) assert.equal(canonical(unparen(defs[i].init), aliases), canonical(unparen(expected[i].init), new Map()), 'Lodash optional Node guard or helper changed')
    for (const name of ['module', 'exports']) {
      const references = nodes.filter(node => node.type === 'Identifier' && node.name === name && reference(node) && statements.some(s => contains(s, node)))
      assert.ok(references.length && references.every(node => binding(node) === undefined), `Lodash browser ${name} must be an unbound browser global`)
    }
    for (const def of defs.slice(0, 3)) {
      const token = binding(def.id)
      assert.ok(token && token.declarations.length === 1 && token.declarations[0].declaration.type === 'VariableDeclarator', 'Lodash guard must have one ordinary lexical declaration')
      assert.ok(!token.declarations[0].declaration.init || token.declarations[0].declaration === def.declaration, 'Hoisted lodash guard already has an initializer')
      for (const node of nodes) if (node.type === 'Identifier' && node.name === token.name && reference(node) && binding(node) === token) {
        assert.ok(statements.some(s => contains(s, node)), 'Lodash guard binding escaped, aliased or reassigned')
      }
    }
    assert.equal(call.arguments.length, 1)
    assert.equal(call.arguments[0]?.value, 'util', 'Lodash optional Node target changed')
    proof.skip.push({ start: call.start, end: call.end })
    proof.proof.push({ kind: 'known-browser-lodash-node-util', file: fileName, sha256: sourceHash,
      start: call.start, end: call.end, guardStart: statements[0].start, guardEnd: statements.at(-1).end,
      source: 'util', browserExecuted: false, contract: hash(template) })
  }
  return proof
}
