import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EXCALIDRAW_REQUIRE_SHIM, ROLLDOWN_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'

// Rolldown's memoized ESM initializer, under the retained Rolldown MIT notice
// in test-fixtures/pica-worker/source/rolldown/LICENSE. This is an AST contract,
// not an executable replacement for the emitted runtime.
const esmInitializer = `(fn, res, err) => () => {
  if (err) throw err[0];
  try { return fn && (res = fn(fn = 0)), res; }
  catch (e) { throw err = [e], e; }
}`
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
const ignored = new Set(['start', 'end', 'loc', 'raw', 'comments', 'leadingComments', 'trailingComments'])
const unparen = node => node?.type === 'ParenthesizedExpression' ? unparen(node.expression) : node
const contains = (outer, node) => outer.start <= node.start && node.end <= outer.end
const hash = code => createHash('sha256').update(code).digest('hex')
function eachChild(node, visit) {
  for (const key of Object.keys(node)) {
    if (key === 'parent' || ignored.has(key)) continue
    const value = node[key]
    if (Array.isArray(value)) { for (const child of value) if (child?.type) visit(child) }
    else if (value?.type) visit(value)
  }
}

/** Lexical identity, including TDZ declarations and separate default parameters.
 * Nothing is resolved by a loader spelling or an emitted source-region comment. */
function lexical(program) {
  const parents = new WeakMap(), scopes = new WeakMap(), bindingIds = new WeakSet()
  const identifiers = new Map(), declarators = [], assignments = [], shims = [], dispatchers = []
  const root = { parent: null, node: program, variable: true, bindings: new Map() }
  const make = (parent, node, variable = false) => ({ parent, node, variable, bindings: new Map() })
  function declare(scope, pattern, declaration, kind) {
    if (!pattern) return
    if (pattern.type === 'Identifier') {
      let token = scope.bindings.get(pattern.name)
      if (!token) scope.bindings.set(pattern.name, token = { name: pattern.name, scope, kind, declarations: [] })
      token.declarations.push({ id: pattern, declaration, kind }); bindingIds.add(pattern)
    } else if (pattern.type === 'RestElement') declare(scope, pattern.argument, declaration, kind)
    else if (pattern.type === 'AssignmentPattern') declare(scope, pattern.left, declaration, kind)
    else if (pattern.type === 'ArrayPattern') pattern.elements.forEach(p => declare(scope, p, declaration, kind))
    else if (pattern.type === 'ObjectPattern') pattern.properties.forEach(p => declare(scope, p.type === 'RestElement' ? p.argument : p.value, declaration, kind))
  }
  function walk(node, current, parent) {
    if (parent) parents.set(node, parent)
    assert.notEqual(node.type, 'WithStatement', 'Dynamic with scope cannot prove flat loader bindings')
    // Direct eval can read/write module bindings without Identifier references.
    // Global Function constructors remain in the ordinary classifier's separate
    // code-evaluation inventory; they cannot close over this ESM lexical scope.
    assert.ok(!(node.type === 'CallExpression' && unparen(node.callee)?.type === 'Identifier' && unparen(node.callee).name === 'eval'),
      'Direct eval cannot prove flat lexical loader consumers')
    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') declare(current, node.id, node, 'declaration')
    if (functions.has(node.type)) {
      const params = make(current, node, true)
      if (node.type !== 'ArrowFunctionExpression') params.bindings.set('arguments', { name: 'arguments', scope: params, kind: 'arguments', declarations: [] })
      if (node.type === 'FunctionExpression') declare(params, node.id, node, 'function-name')
      node.params.forEach(p => declare(params, p, node, 'parameter'))
      if (node.id) walk(node.id, node.type === 'FunctionExpression' ? params : current, node)
      node.params.forEach(p => walk(p, params, node))
      // Body var declarations do not bind references in default parameters.
      const body = node.params.every(p => p.type === 'Identifier') ? params : make(params, node.body, true)
      walk(node.body, body, node)
      if (node.type === 'FunctionExpression' && node.params.length === 0 && node.body.type === 'BlockStatement' && node.body.body[0]?.type === 'FunctionDeclaration') dispatchers.push(node)
      return
    }
    if (node.type === 'SwitchStatement') {
      walk(node.discriminant, current, node)
      const cases = make(current, node)
      node.cases.forEach(c => walk(c, cases, node)); return
    }
    if (['BlockStatement', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'ClassExpression', 'ClassDeclaration', 'StaticBlock'].includes(node.type)) {
      current = make(current, node, node.type === 'StaticBlock')
      if (node.type === 'CatchClause') declare(current, node.param, node, 'catch')
      if (['ClassExpression', 'ClassDeclaration'].includes(node.type)) declare(current, node.id, node, 'class-name')
    }
    if (node.type === 'VariableDeclaration') {
      let owner = current
      if (node.kind === 'var') while (!owner.variable) owner = owner.parent
      node.declarations.forEach(d => declare(owner, d.id, d, node.kind))
    }
    if (node.type === 'ImportDeclaration') node.specifiers.forEach(s => declare(current, s.local, s, 'import'))
    if (node.type === 'Identifier') {
      scopes.set(node, current)
      let list = identifiers.get(node.name)
      if (!list) identifiers.set(node.name, list = [])
      list.push(node)
    }
    if (node.type === 'VariableDeclarator') declarators.push(node)
    if (node.type === 'AssignmentExpression') assignments.push(node)
    if (node.type === 'CallExpression' && unparen(node.callee)?.type === 'ArrowFunctionExpression'
      && node.arguments.length === 1 && node.arguments[0].type === 'FunctionExpression') shims.push(node)
    eachChild(node, child => walk(child, current, node))
  }
  walk(program, root)
  const binding = node => {
    for (let scope = scopes.get(node); scope; scope = scope.parent) if (scope.bindings.has(node.name)) return scope.bindings.get(node.name)
  }
  const keyOnly = node => {
    const p = parents.get(node)
    return p?.type === 'MemberExpression' && !p.computed && p.property === node
      || ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(p?.type) && !p.computed && p.key === node && !p.shorthand
      || ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(p?.type) && p.label === node
      || p?.type === 'ExportSpecifier' && p.exported === node && p.local !== node
  }
  const refs = token => (identifiers.get(token.name) ?? []).filter(n => !bindingIds.has(n) && !keyOnly(n) && binding(n) === token)
  const top = node => { while (parents.get(node) && parents.get(node) !== program) node = parents.get(node); return node }
  const wrapped = node => { while (parents.get(node)?.type === 'ParenthesizedExpression') node = parents.get(node); return node }
  return { program, root, parents, binding, refs, keyOnly, top, wrapped, identifiers, declarators, assignments, shims, dispatchers }
}

/** Full structural equality with a bijection of real local bindings. */
function alpha(actual, expected, index, contract, free = new Map(), roots = new Map(), slots = new Map()) {
  const forward = new Map(roots), reverse = new Map([...roots].map(([a, b]) => [b, a])), outer = actual
  function equal(a, b) {
    a = unparen(a); b = unparen(b)
    if (b?.type === 'Identifier' && !contract.binding(b) && slots.has(b.name)) return a === slots.get(b.name)
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]))
    if (a.type !== b.type) return false
    if (a.type === 'Identifier') {
      if (index.keyOnly(a) || contract.keyOnly(b)) return index.keyOnly(a) === contract.keyOnly(b) && a.name === b.name
      const target = index.binding(a), token = contract.binding(b)
      if (!token) return free.has(b.name) ? target === free.get(b.name) : !target && a.name === b.name
      if (forward.has(token)) return forward.get(token) === target
      if (!target || token.kind !== target.kind || !contains(outer, target.scope.node)) return false
      if (reverse.has(target)) return false
      forward.set(token, target); reverse.set(target, token); return true
    }
    const keys = Object.keys(a).filter(k => !ignored.has(k)), other = Object.keys(b).filter(k => !ignored.has(k))
    return keys.length === other.length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]))
  }
  return equal(actual, expected)
}

/** Only the emitted two-level browser shim with an eager, proven initialization
 * barrier. General lazy call graphs, executable helper consumers and Worker
 * construction remain outside this proof. */
export function proveKnownFlatBrowserLoaders(code, { parse, dispatcher, fileName = 'emitted.js', bindingIndex }) {
  const program = parse(code), index = bindingIndex ?? lexical(program), { binding, parents, refs, top } = index
  assert.equal(index.program, program, 'Flat browser binding index belongs to another parsed source')
  const template = source => { const p = parse(`(${source})`); return { node: unparen(p.body[0].expression), index: lexical(p) } }
  const requireContract = template(ROLLDOWN_REQUIRE_SHIM), excalidrawContract = template(EXCALIDRAW_REQUIRE_SHIM)
  const lazyContract = template(esmInitializer), dispatchContract = template(dispatcher)
  const matches = (node, contract, free) => alpha(unparen(node), contract.node, index, contract.index, free)
  const ordinary = token => {
    assert.ok(token && token.scope === index.root && token.declarations.length === 1, 'Flat helper needs one root binding')
    const record = token.declarations[0], statement = parents.get(record.declaration)
    assert.ok(record.kind === 'var' && record.declaration.type === 'VariableDeclarator' && record.declaration.id === record.id
      && statement?.type === 'VariableDeclaration' && parents.get(statement) === program, 'Flat helper binding is shadowed or not an ordinary root var')
    return record.declaration
  }
  const bases = index.declarators.filter(d => d.init && matches(d.init, requireContract))
  assert.equal(bases.length, 1, 'Expected one exact browser require source')
  const base = bases[0], baseToken = binding(base.id)
  ordinary(baseToken)
  const forwards = index.assignments.filter(a => a.operator === '=' && a.left.type === 'Identifier'
    && matches(a.right, requireContract, new Map([['require', baseToken]])))
  assert.equal(forwards.length, 1, 'Expected one exact forwarded browser require initializer')
  const forward = forwards[0], forwardToken = binding(forward.left), forwardDeclaration = ordinary(forwardToken)
  assert.equal(forwardDeclaration.init, null, 'Forwarded browser helper was already initialized')
  const statement = parents.get(forward), body = parents.get(statement), callback = parents.get(body)
  assert.ok(statement?.type === 'ExpressionStatement' && body?.type === 'BlockStatement' && callback?.type === 'ArrowFunctionExpression'
    && callback.body === body && !callback.async && callback.params.length === 0, 'Forwarded helper is not in a plain lazy initializer')
  const call = parents.get(index.wrapped(callback)), owner = parents.get(call), ownerStatement = parents.get(owner)
  assert.ok(call?.type === 'CallExpression' && call.arguments.length === 1 && unparen(call.arguments[0]) === callback && call.callee.type === 'Identifier'
    && owner?.type === 'VariableDeclarator' && owner.init === call && owner.id.type === 'Identifier'
    && ownerStatement?.type === 'VariableDeclaration' && ownerStatement.declarations.length === 1 && parents.get(ownerStatement) === program,
  'Forwarded helper initializer must have one direct root declaration')
  const ownerToken = binding(owner.id), lazyToken = binding(call.callee), lazyDeclaration = ordinary(lazyToken)
  ordinary(ownerToken)
  for (const token of [baseToken, forwardToken, lazyToken, ownerToken]) {
    assert.ok((index.identifiers.get(token.name) ?? []).every(n => {
      if (index.keyOnly(n) || binding(n) === token) return true
      const local = binding(n)
      // A named function expression's unused self-name is private to that
      // function, not a reference to this loader. Its body remains inspected.
      return local?.kind === 'function-name' && local.declarations.length === 1 && refs(local).length === 0
    }), `Flat helper identity is shadowed by another lexical binding: ${token.name}`)
  }
  assert.ok(lazyDeclaration.init && matches(lazyDeclaration.init, lazyContract), 'Lazy ESM initializer changed or is shadowed')
  assert.ok(parents.get(base).end < ownerStatement.start && parents.get(lazyDeclaration).end < ownerStatement.start,
    'Browser helper source or lazy runtime is initialized too late')
  assert.ok(forwardDeclaration.end < ownerStatement.start, 'Forwarded helper declaration is not hoisted before initialization')
  // The initialization prefix cannot execute user code or re-enter a consumer.
  const objectMembers = new Set(['Object.create', 'Object.defineProperty', 'Object.getOwnPropertyDescriptor', 'Object.getOwnPropertyNames', 'Object.getPrototypeOf', 'Object.prototype.hasOwnProperty'])
  function inert(value) {
    value = unparen(value)
    if (['FunctionExpression', 'ArrowFunctionExpression', 'Literal'].includes(value.type)) return true
    let path = '', node = value
    while (node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') { path = '.' + node.property.name + path; node = node.object }
    return node?.type === 'Identifier' && node.name === 'Object' && !binding(node) && objectMembers.has('Object' + path)
  }
  assert.equal(body.body.at(-1), statement, 'Forwarded helper must finish its initializer')
  for (const prefix of body.body.slice(0, -1)) {
    const assignment = prefix.type === 'ExpressionStatement' ? prefix.expression : undefined
    assert.ok(assignment?.type === 'AssignmentExpression' && assignment.operator === '=' && assignment.left.type === 'Identifier'
      && !ordinary(binding(assignment.left)).init && inert(assignment.right), 'Lazy helper initialization can execute or re-enter unknown code')
  }
  for (const ref of refs(lazyToken)) {
    const use = parents.get(ref)
    assert.ok(use?.type === 'CallExpression' && use.callee === ref && use.arguments.length === 1
      && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unparen(use.arguments[0]).type), 'Lazy ESM initializer escaped or was reassigned')
  }
  const eager = []
  for (const ref of refs(ownerToken)) {
    const use = parents.get(ref)
    assert.ok(use?.type === 'CallExpression' && use.callee === ref && use.arguments.length === 0, 'Helper initialization port escaped or changed')
    assert.ok(top(use).start > ownerStatement.end, 'Helper initialization is referenced before its declaration')
    if (parents.get(use)?.type === 'ExpressionStatement' && parents.get(parents.get(use)) === program) eager.push(parents.get(use))
  }
  assert.ok(eager.length, 'Missing unconditional eager helper initialization barrier')
  const barrier = eager.reduce((a, b) => a.start < b.start ? a : b)
  const bound = new Map([['__require', forwardToken]])
  const dispatchers = index.dispatchers.filter(node => matches(node, dispatchContract, bound))
  const discarded = index.shims.filter(node => matches(node, excalidrawContract, bound))
  assert.ok(dispatchers.length && discarded.length, 'Missing exact finite dispatcher or discarded browser carrier')
  for (const node of dispatchers) {
    const construct = parents.get(index.wrapped(node)), table = parents.get(construct), entry = parents.get(table)
    assert.ok(construct?.type === 'CallExpression' && unparen(construct.callee) === node && construct.arguments.length === 0
      && table?.type === 'CallExpression' && table.callee === construct && table.arguments.length === 3
      && entry?.type === 'CallExpression' && entry.callee === table && entry.arguments.length === 1,
    'Browser dispatcher is not an applied finite-table entry; ordinary mapping checks must inspect it')
  }
  for (const node of discarded) assert.ok(parents.get(node)?.type === 'ExpressionStatement', 'Browser carrier result is used instead of discarded')
  for (const consumer of [...dispatchers, ...discarded]) {
    const host = top(consumer)
    assert.ok(host.type === 'VariableDeclaration' || host.type === 'ExpressionStatement', 'Hoisted callable consumer lacks a proven creation barrier')
    assert.ok(host.start > barrier.end, 'Browser consumer can exist before helper initialization')
  }
  for (const ref of refs(baseToken)) assert.ok(contains(forward.right, ref), 'Browser require source escaped, aliased or was reassigned')
  for (const ref of refs(forwardToken)) assert.ok(ref === forward.left || dispatchers.some(d => contains(d, ref)) || discarded.some(d => contains(d, ref)),
    'Forwarded browser helper has an unknown binding consumer or write')
  const source = Object.freeze({ file: fileName, sha256: hash(code) })
  return {
    skip: [base.init, forward.right, ...discarded].map(n => ({ start: n.start, end: n.end })),
    definitions: [base.id, forwardDeclaration.id, forward.left].map(n => ({ name: n.name, start: n.start, end: n.end })),
    browserifyDispatchers: dispatchers.map(n => index.wrapped(n)).map(n => ({ start: n.start, end: n.end })), trackedLoads: [], flatBrowserSource: source,
    proof: [{ kind: 'known-flat-browser-loader-chain', file: fileName, sha256: source.sha256,
      sourceBinding: base.id.name, forwardingBinding: forward.left.name,
      initializationBarrier: { start: barrier.start, end: barrier.end },
      dispatchers: dispatchers.map(n => ({ start: n.start, end: n.end })),
      discardedCarriers: discarded.map(n => ({ start: n.start, end: n.end })),
      browserExecuted: false, dynamicClosureVerified: false }],
  }
}

// Shared by the finite embedded proof. These are AST tools, not caller-provided
// authority: producers bind one index to their actual parsed source object.
export { lexical as indexBrowserBindings, alpha as sameBrowserBindings, unparen, contains, esmInitializer }
