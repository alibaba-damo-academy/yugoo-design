import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { indexBrowserBindings, sameBrowserBindings, unparen, contains, esmInitializer } from './known-flat-browser-loader-proof.mjs'

// Exact framework contracts retained from the reviewed embedded prebundle.
// Algorithm bodies, licenses and provenance remain at their original owners.
const fallbackSource = `function fallback(target) {
  throw new Error("Could not dynamically require \\"" + target + "\\". Please configure the dynamicRequireTargets option of @rollup/plugin-commonjs appropriately for this require call to behave properly.");
}`
const wrapperSource = `function wrap(fn) {
  var module = { exports: {} };
  return fn(module, module.exports), module.exports;
}`
const callbackSource = `(function(module, exports) {
  (function(f) { module.exports = f(); })(function() { return __finiteEntry; });
})`
const sha = code => createHash('sha256').update(code).digest('hex')

/** Framework proof only: no factory/wrapper skips and no Worker acceptance. */
export function proveKnownFlatEmbeddedLoaders(code, { parse, dispatcher, validateTable, fileName = 'emitted.js', bindingIndex }) {
  const program = parse(code), index = bindingIndex ?? indexBrowserBindings(program)
  assert.equal(index.program, program, 'Embedded binding index belongs to another parsed source')
  const { binding, parents, refs, top, wrapped } = index
  const contract = source => {
    const p = parse(source), node = unparen(p.body[0].type === 'ExpressionStatement' ? p.body[0].expression : p.body[0])
    return { node, index: indexBrowserBindings(p) }
  }
  const fallback = contract(fallbackSource), wrapper = contract(wrapperSource), callback = contract(callbackSource)
  const dispatch = contract(`(${dispatcher})`), lazy = contract(`(${esmInitializer})`)
  const match = (node, expected, free, roots, slots) => sameBrowserBindings(node, expected.node, index, expected.index, free, roots, slots)
  const rootFunction = (node, expected) => {
    if (node.type !== 'FunctionDeclaration' || !node.id) return false
    const token = binding(node.id)
    return token?.scope === index.root && token.declarations.length === 1
      && match(node, expected, undefined, new Map([[expected.index.binding(expected.node.id), token]]))
  }
  const declarations = program.body.filter(n => n.type === 'FunctionDeclaration')
  const fallbacks = declarations.filter(n => rootFunction(n, fallback)), wrappers = declarations.filter(n => rootFunction(n, wrapper))
  assert.equal(fallbacks.length, 1, 'Expected one exact hoisted throwing fallback')
  assert.equal(wrappers.length, 1, 'Expected one exact hoisted CommonJS wrapper')
  const fallbackNode = fallbacks[0], wrapperNode = wrappers[0], fallbackToken = binding(fallbackNode.id), wrapperToken = binding(wrapperNode.id)
  const candidates = index.dispatchers.filter(n => match(n, dispatch, new Map([['__require', fallbackToken]])))
  assert.ok(candidates.length, 'Missing embedded dispatcher bound to the throwing fallback')
  for (const ref of refs(fallbackToken)) assert.ok(candidates.some(n => contains(n, ref)), 'Embedded fallback escaped, was reassigned or has an unknown consumer')
  const wrapperCalls = new Set()
  for (const ref of refs(wrapperToken)) {
    const call = parents.get(wrapped(ref)), fn = unparen(call?.arguments?.[0])
    assert.ok(call?.type === 'CallExpression' && unparen(call.callee) === ref && call.arguments.length === 1
      && fn?.type === 'FunctionExpression' && !fn.async && !fn.generator
      && fn.params.length >= 1 && fn.params.length <= 2 && fn.params.every(p => p.type === 'Identifier'),
    'CommonJS wrapper escaped, was reassigned or has a nonliteral callback')
    wrapperCalls.add(call)
  }
  const ordinaryVar = token => {
    assert.ok(token?.scope === index.root && token.declarations.length === 1, 'Embedded value needs one root binding')
    const record = token.declarations[0], declaration = record.declaration, statement = parents.get(declaration)
    assert.ok(record.kind === 'var' && declaration.type === 'VariableDeclarator' && declaration.id === record.id
      && statement?.type === 'VariableDeclaration' && parents.get(statement) === program, 'Embedded value is shadowed or not an ordinary root var')
    return declaration
  }
  function writes(ref) {
    let node = ref, parent = parents.get(node)
    while (['ObjectPattern', 'ArrayPattern', 'AssignmentPattern', 'RestElement', 'Property'].includes(parent?.type)) {
      if (parent.type === 'Property' && parent.value !== node || parent.type === 'AssignmentPattern' && parent.left !== node) return false
      node = parent; parent = parents.get(node)
    }
    return parent?.type === 'AssignmentExpression' && parent.left === node
      || parent?.type === 'UpdateExpression' && parent.argument === node
      || ['ForInStatement', 'ForOfStatement'].includes(parent?.type) && parent.left === node
  }
  function initializedValue(call) {
    const owner = parents.get(call)
    if (owner?.type === 'VariableDeclarator' && owner.init === call && owner.id.type === 'Identifier') {
      const token = binding(owner.id); assert.equal(ordinaryVar(token), owner)
      assert.ok(refs(token).every(ref => !writes(ref)), 'Embedded result was reassigned')
      return { token, assignment: owner, initializer: null }
    }
    assert.ok(owner?.type === 'AssignmentExpression' && owner.operator === '=' && owner.right === call && owner.left.type === 'Identifier', 'Embedded result has an unknown initialization owner')
    const token = binding(owner.left), declaration = ordinaryVar(token)
    assert.equal(declaration.init, null, 'Embedded result already has an initializer')
    assert.ok(refs(token).every(ref => ref === owner.left || !writes(ref)), 'Embedded result has another write')
    const statement = parents.get(owner), body = parents.get(statement), fn = parents.get(body), invocation = parents.get(wrapped(fn))
    const init = parents.get(invocation), initStatement = parents.get(init)
    assert.ok(statement?.type === 'ExpressionStatement' && body?.type === 'BlockStatement' && fn?.type === 'ArrowFunctionExpression'
      && !fn.async && fn.params.length === 0 && invocation?.type === 'CallExpression' && invocation.arguments.length === 1
      && unparen(invocation.arguments[0]) === fn && invocation.callee.type === 'Identifier'
      && init?.type === 'VariableDeclarator' && init.init === invocation && init.id.type === 'Identifier'
      && initStatement?.type === 'VariableDeclaration' && parents.get(initStatement) === program,
    'Embedded assignment is not a direct memoized module initializer statement')
    const initToken = binding(init.id), memoToken = binding(invocation.callee), memo = ordinaryVar(memoToken)
    assert.equal(ordinaryVar(initToken), init)
    assert.ok(memo.init && match(memo.init, lazy), 'Embedded module initializer changed or is shadowed')
    assert.ok(parents.get(memo).end < initStatement.start && declaration.end < initStatement.start, 'Embedded initializer dependencies are declared too late')
    for (const ref of refs(memoToken)) {
      const use = parents.get(wrapped(ref))
      assert.ok(use?.type === 'CallExpression' && unparen(use.callee) === ref && use.arguments.length === 1
        && ['FunctionExpression', 'ArrowFunctionExpression'].includes(unparen(use.arguments[0]).type), 'Embedded memo runtime escaped or was reassigned')
    }
    for (const ref of refs(initToken)) {
      const use = parents.get(wrapped(ref))
      assert.ok(use?.type === 'CallExpression' && unparen(use.callee) === ref && use.arguments.length === 0
        && top(use).start >= initStatement.end, 'Embedded initialization port escaped or is available before its declaration')
    }
    return { token, assignment: owner, initializer: init }
  }
  const ranges = [], tables = []
  for (const node of candidates) {
    const construct = parents.get(wrapped(node)), tableCall = parents.get(construct), entry = parents.get(tableCall)
    assert.ok(construct?.type === 'CallExpression' && unparen(construct.callee) === node && construct.arguments.length === 0
      && tableCall?.type === 'CallExpression' && tableCall.callee === construct && entry?.type === 'CallExpression' && entry.callee === tableCall
      && !construct.optional && !tableCall.optional && !entry.optional, 'Embedded dispatcher is not an applied finite table')
    const modules = validateTable(tableCall, entry, { strict: true })
    let fn, call
    for (let current = entry; current; current = parents.get(current)) {
      if (current.type !== 'FunctionExpression') continue
      const owner = parents.get(wrapped(current))
      if (wrapperCalls.has(owner) && unparen(owner.arguments[0]) === current) { fn = current; call = owner; break }
    }
    assert.ok(fn && match(fn, callback, undefined, undefined, new Map([['__finiteEntry', entry]])), 'Embedded module wrapper or callback result changed')
    const value = initializedValue(call), records = []
    for (const [id, { factory, map }] of modules) {
      const loader = binding(factory.params[0]), loads = []
      assert.ok(loader && loader.declarations.length === 1 && loader.kind === 'parameter', 'Embedded factory loader has an ambiguous binding')
      for (const ident of index.identifiers.get(loader.name) ?? []) if (contains(factory, ident) && !index.keyOnly(ident)) {
        assert.equal(binding(ident), loader, 'Embedded factory loader is lexically shadowed')
      }
      for (const ref of refs(loader)) {
        const use = parents.get(wrapped(ref)), target = use?.arguments?.[0]?.value
        assert.ok(use?.type === 'CallExpression' && unparen(use.callee) === ref && !use.optional && use.arguments.length === 1
          && typeof target === 'string' && map.has(target), 'Embedded factory loader escaped or lacks a literal mapping')
        loads.push({ start: use.start, end: use.end, source: target, target: map.get(target) })
      }
      records.push({ id, factory: { start: factory.start, end: factory.end }, loader: { name: loader.name, start: factory.params[0].start, end: factory.params[0].end }, mapping: Object.fromEntries(map), loads })
    }
    ranges.push({ start: wrapped(node).start, end: wrapped(node).end })
    tables.push({ dispatcher: ranges.at(-1), table: { start: tableCall.arguments[0].start, end: tableCall.arguments[0].end },
      wrapperCall: { start: call.start, end: call.end }, resultBinding: value.token.name,
      initialization: { start: value.assignment.start, end: value.assignment.end },
      valueReferences: refs(value.token).map(n => ({ start: n.start, end: n.end })),
      entries: [...tableCall.arguments[2].elements, ...entry.arguments].map(n => n.value), modules: records })
  }
  const source = Object.freeze({ file: fileName, sha256: sha(code) })
  return { skip: [], definitions: [], trackedLoads: [], browserifyDispatchers: ranges, embeddedBrowserSource: source,
    proof: [{ kind: 'known-flat-embedded-loader-framework', file: fileName, sha256: source.sha256,
      fallback: { start: fallbackNode.start, end: fallbackNode.end }, wrapper: { start: wrapperNode.start, end: wrapperNode.end }, tables,
      scope: 'lexical-wrapper-and-finite-mapping-framework; factory algorithms and generated Worker semantics are not proved',
      runtimeExecuted: false, browserExecuted: false, dynamicClosureVerified: false }] }
}
