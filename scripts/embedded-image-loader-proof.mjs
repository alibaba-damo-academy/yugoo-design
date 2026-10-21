import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
// A separate reviewed-byte proposal. Never replaces standalone pica pins.
export const EMBEDDED_IMAGE_PINS = Object.freeze({
  artifact: '85145597b769e8beebe8590fbdfd0092a4109a55d5643cd7114a22e29c196a38',
  dispatcher: 'ed4debbf804a2e062b75ff52b7e4b84ab2aebe068104e413d8fb7ef6c990c6b4',
  table: 'aa7afe4edf62dcc8397e3f7876d15736c5cfd0f8d8fe372be8508c6be2edbf5e',
  factory: '4879a5a0d856e53feb132bd8540aa5e6844cf7c131261b15f0e3b19d576d350e',
  wrapper: 'bb5cee444aeaca53496319a35ae69f5c351fcf985e3f4377eaf3333d842d68ba',
  throwHelper: '4cd7dc84d18869f764a251139444c7f16661fd9b6821258bed9fd6ecf596fcb1',
  wrapperHelper: '40006e458ef7c122a7a07168c82e8f0cf30810985ffba02d936a195a1f848297',
})
const children = node => Object.values(node).flatMap(v => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : [])
const unwrap = node => node?.type === 'ParenthesizedExpression' ? unwrap(node.expression) : node
const contains = (outer, node) => outer.start <= node.start && node.end <= outer.end

/** Recognize this static table only; dynamic Worker arguments MUST still fail. */
export function proveEmbeddedImageLoader(code, { parse, shape, dispatcher }) {
  assert.equal(sha256(code), EMBEDDED_IMAGE_PINS.artifact, 'Unreviewed embedded image artifact bytes')
  const program = parse(code), nodes = [], parents = new WeakMap()
  function walk(node) { nodes.push(node); for (const child of children(node)) { parents.set(child, node); walk(child) } }
  walk(program)
  const select = (predicate, name) => {
    const matches = nodes.filter(predicate); assert.equal(matches.length, 1, `Expected one ${name}`); return matches[0]
  }
  const call = select(n => n.type === 'CallExpression' && n.callee.type === 'CallExpression' && n.arguments[0]?.type === 'ObjectExpression' && n.arguments[0].properties.length === 25, 'embedded table call')
  const table = call.arguments[0], dispatcherNode = call.callee.callee
  const factory = table.properties.find(p => p.key.value === 24)?.value.elements[0]
  const wrapper = select(n => n.type === 'VariableDeclarator' && n.id.name === 'pica', 'embedded wrapper')
  const throwHelper = select(n => n.type === 'FunctionDeclaration' && n.id.name === 'commonjsRequire', 'throwing fallback')
  const wrapperHelper = select(n => n.type === 'FunctionDeclaration' && n.id.name === 'createCommonjsModule', 'module wrapper helper')
  const slices = {}
  for (const [name, node] of Object.entries({ dispatcher: dispatcherNode, table, factory, wrapper, throwHelper, wrapperHelper })) {
    assert.ok(node)
    const bytes = code.slice(node.start, node.end)
    assert.equal(sha256(bytes), EMBEDDED_IMAGE_PINS[name], `Changed embedded ${name}`)
    slices[name] = { start: node.start, end: node.end, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) }
  }
  // The sole dispatcher difference is its local throwing fallback binding.
  const expected = unwrap(parse('(' + dispatcher.replaceAll('__require', 'commonjsRequire') + ')').body[0].expression)
  assert.equal(shape(unwrap(dispatcherNode)), shape(expected), 'Changed embedded dispatcher')
  assert.deepEqual(table.properties.map(p => String(p.key.value ?? p.key.name)), [...Array.from({ length: 24 }, (_, i) => String(i + 1)), '/index.js'])
  assert.ok(contains(wrapper, call) && wrapper.init.type === 'CallExpression' && wrapper.init.callee.name === 'createCommonjsModule')
  assert.equal(throwHelper.body.body.length, 1)
  assert.equal(throwHelper.body.body[0].type, 'ThrowStatement')
  assert.equal(throwHelper.body.body[0].argument.callee.name, 'Error')
  for (const node of nodes.filter(n => n.type === 'Identifier' && n.name === 'commonjsRequire')) {
    assert.ok(node === throwHelper.id || contains(dispatcherNode, node), 'Embedded fallback alias escaped')
  }
  const extraArguments = nodes.filter(n => n.type === 'Identifier' && n.name === 'arguments' && contains(factory, n))
  assert.equal(extraArguments.length, 3)
  assert.deepEqual(extraArguments.map(n => parents.get(n).property.value), [3, 4, 5])
  const staticUnknown = extraArguments.map(n => ({ start: n.start, reason: 'Browserify factory extra dispatcher arguments may escape' }))
  const proof = { kind: 'known-embedded-image-loader', artifactSha256: EMBEDDED_IMAGE_PINS.artifact, slices,
    status: 'static-table-recognized-runtime-boundary-unresolved', staticUnknown, runtimeExecuted: false,
    boundedImageTaskVerified: false, dynamicClosureVerified: false }
  // No skip range: every factory and surrounding statement remains inspected.
  return { browserifyDispatchers: [{ start: dispatcherNode.start, end: dispatcherNode.end }],
    skip: [], definitions: [], trackedLoads: [], proof: [proof] }
}
