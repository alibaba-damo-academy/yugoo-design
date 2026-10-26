import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeEmittedLoaders, proveKnownFlatBrowserLoaders, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'
import { EXCALIDRAW_REQUIRE_SHIM, ROLLDOWN_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'

// The exact Rolldown initializer contract; retain the upstream MIT notice at
// test-fixtures/pica-worker/source/rolldown/LICENSE.
const memo = `(fn, res, err) => () => {
  if (err) throw err[0];
  try { return fn && (res = fn(fn = 0)), res; }
  catch (e) { throw err = [e], e; }
}`
const forwarded = ROLLDOWN_REQUIRE_SHIM.replaceAll('typeof require', 'typeof __require$1')
  .replaceAll('? require :', '? __require$1 :').replaceAll('return require.apply', 'return __require$1.apply')
const fixture = `var memo = ${memo};
var __require$1 = ${ROLLDOWN_REQUIRE_SHIM};
var __require;
var initialize = memo(() => { __require = ${forwarded}; });
initialize();
var consumer = memo(() => {
  var result = (${BROWSERIFY_DISPATCHER})()({
    1: [function(require,module,exports){module.exports=require('dep')},{dep:2}],
    2: [function(require,module,exports){module.exports=1},{}]
  }, {}, [1])(1);
  ${EXCALIDRAW_REQUIRE_SHIM};
});
consumer();`
const accept = code => {
  const proof = proveKnownFlatBrowserLoaders(code, { fileName: 'fixture.mjs' })
  const result = analyzeEmittedLoaders(code, proof)
  assert.deepEqual(result.loads, []); assert.deepEqual(result.unverified, [])
  assert.equal(result.dynamicClosureVerified, false)
  return { proof, result }
}

test('explicit flat proof checks the binding graph and preserves default rejection', () => {
  assert.ok(analyzeEmittedLoaders(fixture).unverified.length)
  const { proof, result } = accept(fixture)
  assert.equal(proof.proof[0].kind, 'known-flat-browser-loader-chain')
  assert.equal(proof.proof[0].browserExecuted, false)
  assert.equal(proof.skip.length, 3)
  assert.equal(proof.browserifyDispatchers.length, 1)
  assert.equal(result.internalLoads.length, 1)
  for (const range of proof.skip) assert.ok(!fixture.slice(range.start, range.end).includes('var result ='), 'never skip an initializer or factory')
  assert.equal(Object.isFrozen(proof.flatBrowserSource), true)
})

test('alpha-renaming is a bijection of bindings, including helper-local parameters', () => {
  const renamed = fixture.replaceAll('__require$1', 'rootLoader').replaceAll('__require', 'browserLoader')
    .replaceAll('initialize', 'initializeOther').replaceAll('memo', 'initializeOnce')
    .replaceAll('(x)', '(input)').replaceAll('typeof x', 'typeof input')
  // Renaming only one parameter occurrence is deliberately not alpha-equivalent.
  assert.throws(() => accept(renamed))
  accept(fixture.replaceAll('__require$1', 'rootLoader').replaceAll('__require', 'browserLoader')
    .replaceAll('initialize', 'initializeOther').replaceAll('memo', 'initializeOnce'))
  accept(fixture.replace(/\bx\b/g, 'argument'))
})

test('the actual hoisted runtime prefix is inert and the callback may be parenthesized', () => {
  accept(('var create, common;\n' + fixture).replace('memo(() => { __require =',
    'memo((() => { create=Object.create; common=(cb,mod)=>()=>cb(mod); __require =').replace('; });\ninitialize();', '; }));\ninitialize();'))
})

test('an unrelated named CJS function has its own unused private self-name', () => {
  accept(fixture + '\nvar common=(cb,mod)=>function __require(){return mod || cb()};')
  assert.throws(() => accept(fixture + '\nvar common=(cb,mod)=>function __require(){return __require};'), /shadowed/)
})

test('explicit lodash composition uses the same pinned emitted input and preserves its proof', () => {
  // Lodash's retained optional-Node excerpt and full MIT notice live in
  // known-browser-lodash-proof.mjs; this is a finite compatibility fixture.
  const code = fixture + `
  var freeGlobal={};
  var freeExports=typeof exports=='object'&&exports&&!exports.nodeType&&exports;
  var freeModule=freeExports&&typeof module=='object'&&module&&!module.nodeType&&module;
  var freeProcess=freeModule&&freeModule.exports===freeExports&&freeGlobal.process;
  var nodeUtil=(function(){try{
    var types=freeModule&&freeModule.require&&freeModule.require('util').types;
    if(types)return types;
    return freeProcess&&freeProcess.binding&&freeProcess.binding('util');
  }catch(e){}})();`
  const proof = proveKnownFlatBrowserLoaders(code, { includeLodash: true })
  assert.equal(proof.proof.filter(p => p.kind === 'known-browser-lodash-node-util').length, 1)
  assert.deepEqual(analyzeEmittedLoaders(code, proof).loads, [])
  assert.deepEqual(analyzeEmittedLoaders(code, proof).unverified, [])
})

test('serialized proof reparses safely and source mutation cannot reuse a cached AST or ranges', () => {
  const { proof } = accept(fixture)
  assert.deepEqual(analyzeEmittedLoaders(fixture, JSON.parse(JSON.stringify(proof))).unverified, [])
  assert.throws(() => analyzeEmittedLoaders(fixture + '\nvoid 0;', proof), /source pin changed/)
  assert.throws(() => { proof.flatBrowserSource.sha256 = '0'.repeat(64) }, TypeError)
})

test('dispatcher-local names also need alpha-equivalent lexical identities', () => {
  accept(fixture.replace(/\br\b/g, 'dispatch').replace(/\bo\b/g, 'load'))
})

test('renaming loaders does not hide aliases or executable consumers from the producer', () => {
  const renamed = fixture.replaceAll('__require$1', 'rootLoader').replaceAll('__require', 'browserLoader')
  for (const extra of ['var alias=browserLoader;', 'browserLoader("react");', 'function leak(){return rootLoader}']) {
    assert.throws(() => accept(renamed + '\n' + extra), /consumer|escaped/)
  }
})

test('direct eval cannot acquire hidden access to the proved lexical bindings', () => {
  for (const call of ['eval("__require = other")', '(eval)("__require(\\"react\\")")', 'eval(unknownSource)']) {
    assert.throws(() => accept(fixture + '\n' + call), /eval|Dynamic/)
  }
})

test('helper-only proof keeps all factory mapping and Worker escapes visible', () => {
  const worker = fixture.replace('module.exports=1', 'var source=arguments[3],table=arguments[4],cache=arguments[5];module.exports=1')
  const proof = proveKnownFlatBrowserLoaders(worker), result = analyzeEmittedLoaders(worker, proof)
  assert.equal(result.unverified.length, 3)
  assert.ok(result.unverified.every(x => /extra dispatcher arguments/.test(x.reason)))
  for (const code of [fixture.replace('{dep:2}', '{dep:3}'), fixture.replace("require('dep')", 'require(dynamicName)')]) assert.throws(() => accept(code))
})

const hostile = [
  ['base reassignment', s => s + '\n__require$1 = other;'],
  ['base alias', s => s + '\nvar alias = __require$1;'],
  ['base return', s => s + '\nfunction leak(){return __require$1}'],
  ['forward extra write', s => s + '\n__require = other;'],
  ['forward destructuring write', s => s + '\n({value:__require}=other);'],
  ['forward update', s => s + '\n__require++;'],
  ['forward alias', s => s + '\nvar alias=__require;'],
  ['forward export', s => s + '\nexport {__require};'],
  ['unknown consumer', s => s + '\n__require("react");'],
  ['parameter shadow', s => s.replace('memo(() => {\n  var result', 'memo((__require) => {\n  var result')],
  ['destructured parameter shadow', s => s.replace('memo(() => {\n  var result', 'memo(({__require}) => {\n  var result')],
  ['catch shadow', s => s.replace('  var result', 'try{}catch(__require){}\n  var result')],
  ['TDZ shadow', s => s.replace('  var result', 'let __require;\n  var result')],
  ['default parameter shadow', s => s + '\nfunction nested({__require}={}){}'],
  ['global require shadow', s => 'var require = other;\n' + s],
  ['imported Proxy shadow', s => 'import Proxy from "other";\n' + s],
  ['later Error TDZ', s => s + '\nlet Error;'],
  ['runtime port alias', s => s + '\nvar alias=initialize;'],
  ['runtime port overwrite', s => s + '\ninitialize=other;'],
  ['memo helper overwrite', s => s + '\nmemo=other;'],
  ['memo helper alias', s => s + '\nvar alias=memo;'],
  ['missing eager barrier', s => s.replace('initialize();\nvar consumer', 'var consumer')],
  ['conditional barrier', s => s.replace('initialize();\nvar consumer', 'if(ready) initialize();\nvar consumer')],
  ['consumer created before barrier', s => s.replace('initialize();\nvar consumer', 'var consumer') + '\ninitialize();'],
  ['eager initialization before declaration', s => 'initialize();\n' + s],
  ['hoisted consumer function', s => s.replace('var consumer = memo(() => {', 'function consumer(){').replace('});\nconsumer();', '}\nconsumer();')],
  ['unknown call before assignment', s => s.replace('() => { __require =', '() => { unknown(); __require =')],
  ['runtime prefix reentry', s => s.replace('() => { __require =', '() => { initialize(); __require =')],
  ['runtime throws after assignment', s => s.replace('; });\ninitialize()', '; throw failure; });\ninitialize()')],
  ['changed lazy initializer', s => s.replace('fn(fn = 0)', 'fn()')],
  ['used carrier return', s => s.replace(EXCALIDRAW_REQUIRE_SHIM + ';', 'var escaped = ' + EXCALIDRAW_REQUIRE_SHIM + ';')],
  ['called carrier return', s => s.replace(EXCALIDRAW_REQUIRE_SHIM + ';', '(' + EXCALIDRAW_REQUIRE_SHIM + ')("fs");')],
  ['dispatcher exported instead of applied', s => s.replace(`(${BROWSERIFY_DISPATCHER})()`, `(${BROWSERIFY_DISPATCHER})`).replace('}, {}, [1])(1)', '}, {}, [1])')],
  ['already initialized forward declaration', s => s.replace('var __require;', 'var __require=other;')],
  ['duplicate forward declaration', s => s + '\nvar __require;'],
  ['different throwing fallback', s => s.replace('Dynamic require of', 'Different fallback for')],
]
for (const [name, mutate] of hostile) test('rejects ' + name, () => assert.throws(() => accept(mutate(fixture))))
