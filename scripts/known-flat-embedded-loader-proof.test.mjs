import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { analyzeEmittedLoaders, proveKnownFlatEmbeddedLoaders, proveKnownFlatBrowserLoaders, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'
import { esmInitializer } from './known-flat-browser-loader-proof.mjs'
import { ROLLDOWN_REQUIRE_SHIM, EXCALIDRAW_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'

const dispatch = BROWSERIFY_DISPATCHER.replaceAll('__require', 'fail')
// Finite synthetic framework, with different names/IDs and two factories. It
// deliberately does not duplicate any pica algorithm or Worker implementation.
const fixture = `function fail(specifier) {
  throw new Error("Could not dynamically require \\"" + specifier + "\\". Please configure the dynamicRequireTargets option of @rollup/plugin-commonjs appropriately for this require call to behave properly.");
}
function create(fn) { var owner={exports:{}}; return fn(owner,owner.exports),owner.exports; }
var retained = create(function(owner, exported) {
  (function(run){owner.exports=run()})(function(){
    return (${dispatch})()({
      start:[function(_dereq_,module,exports){module.exports=_dereq_('dep')},{dep:'other'}],
      other:[function(_dereq_,module,exports){module.exports=2},{}]
    },{},[])('start');
  });
});`
const accept = code => {
  const proof = proveKnownFlatEmbeddedLoaders(code, { fileName: 'embedded.mjs' })
  const result = analyzeEmittedLoaders(code, proof)
  assert.deepEqual(result.loads, []); assert.deepEqual(result.unverified, [])
  return { proof, result }
}
const hoisted = fixture.replace('var retained =', `var memo=${esmInitializer};var retained;var initialize=memo((()=>{ retained =`) + '\n}));initialize();'

test('explicit B proof recognizes a differently named two-module framework without skips', () => {
  assert.ok(analyzeEmittedLoaders(fixture).unverified.length)
  const { proof, result } = accept(fixture), record = proof.proof[0]
  assert.deepEqual(proof.skip, []); assert.deepEqual(proof.definitions, [])
  assert.equal(record.tables[0].modules.length, 2); assert.equal(result.internalLoads.length, 1)
  assert.equal(record.tables[0].modules[0].loader.name, '_dereq_')
  assert.equal(record.tables[0].modules[0].loads[0].target, 'other')
  assert.equal(record.dynamicClosureVerified, false); assert.equal(record.runtimeExecuted, false)
  assert.match(record.scope, /factory algorithms.*not proved/)
})

test('alpha binding identities preserve framework names and supported factory loader spelling', () => {
  accept(fixture.replaceAll('fail', 'rejectFallback').replaceAll('create', 'ownModule').replaceAll('retained', 'resultValue'))
  accept(fixture.replaceAll('_dereq_', 'require'))
  accept(fixture.replaceAll('owner', 'localRecord').replaceAll('exported', 'localExports').replaceAll('specifier', 'request'))
})

test('a factory closure may retain the same finite loader without aliasing it', () => {
  accept(fixture.replace("module.exports=_dereq_('dep')", "module.exports=function(){return _dereq_('dep')}"))
})

test('a hoisted value has one assignment owned by the exact memoized module initializer', () => {
  const { proof } = accept(hoisted)
  assert.equal(proof.proof[0].tables[0].resultBinding, 'retained')
  for (const code of [hoisted.replace('var retained;', 'var retained=other;'), hoisted + '\nretained=other;',
    hoisted.replace('fn(fn = 0)', 'fn()'), hoisted + '\nvar alias=initialize;', hoisted + '\nmemo=other;',
    hoisted.replace('retained = create(', 'if(ready) retained = create('), hoisted.replace('((()=>{ retained', '((async()=>{ retained')]) {
    assert.throws(() => accept(code))
  }
})

test('the proof pins its parsed source; serialized copies safely reparse', () => {
  const { proof } = accept(fixture)
  assert.equal(Object.isFrozen(proof.embeddedBrowserSource), true)
  assert.throws(() => analyzeEmittedLoaders(fixture + '\nvoid 0;', proof), /source pin changed/)
  assert.deepEqual(analyzeEmittedLoaders(fixture, JSON.parse(JSON.stringify(proof))).unverified, [])
})

test('explicit A+B composition shares the source and preserves both independent framework records', () => {
  const forwarded = ROLLDOWN_REQUIRE_SHIM.replaceAll('typeof require', 'typeof source')
    .replaceAll('? require :', '? source :').replaceAll('return require.apply', 'return source.apply')
  const prefix = `var memo=${esmInitializer};var source=${ROLLDOWN_REQUIRE_SHIM};var forwarded;
    var initialize=memo(()=>{forwarded=${forwarded}}); initialize();
    var consumer=memo(()=>{
      var value=(${BROWSERIFY_DISPATCHER.replaceAll('__require', 'forwarded')})()({1:[function(require,module,exports){module.exports=1},{}]},{},[])(1);
      ${EXCALIDRAW_REQUIRE_SHIM.replaceAll('__require', 'forwarded')};
    });consumer();`
  const code = prefix + fixture
  assert.ok(analyzeEmittedLoaders(code, proveKnownFlatBrowserLoaders(code)).unverified.length)
  const proof = proveKnownFlatBrowserLoaders(code, { includeEmbedded: true, includeLodash: true })
  const result = analyzeEmittedLoaders(code, proof)
  assert.deepEqual(result.loads, []); assert.deepEqual(result.unverified, [])
  assert.equal(proof.flatBrowserSource.sha256, proof.embeddedBrowserSource.sha256)
  assert.ok(proof.proof.some(p => p.kind === 'known-flat-browser-loader-chain'))
  assert.ok(proof.proof.some(p => p.kind === 'known-flat-embedded-loader-framework'))
  assert.deepEqual(analyzeEmittedLoaders(code, JSON.parse(JSON.stringify(proof))).unverified, [])
})

test('all factory bodies remain visited, including arbitrary extra dispatcher arguments', () => {
  for (const code of [fixture.replace('module.exports=2', 'var a=arguments[3],b=arguments[4],c=arguments[5];module.exports=2'),
    fixture.replace('module.exports=2', 'module.exports=arguments[9]')]) {
    const proof = proveKnownFlatEmbeddedLoaders(code), result = analyzeEmittedLoaders(code, proof)
    assert.ok(result.unverified.length)
    assert.ok(result.unverified.every(x => /extra dispatcher arguments/.test(x.reason)))
    assert.deepEqual(proof.skip, [])
  }
})

test('framework recognition does not certify changed algorithm bodies or third-party source retention', () => {
  const changed = fixture.replace('module.exports=2', 'module.exports=3'), { proof } = accept(changed)
  assert.match(proof.proof[0].scope, /framework/)
  assert.equal(proof.proof[0].dynamicClosureVerified, false)
})

test('B-only prototype and async checks preserve the ordinary recognizer default', () => {
  const ordinary = `(${BROWSERIFY_DISPATCHER})()({
    1:[async function(require,module,exports){module.exports=1},{toLocaleString:2}],
    2:[function(require,module,exports){module.exports=2},{}],
    toString:[function(require,module,exports){module.exports=3},{}]
  },{},[])(1)`
  // This is the existing static recognizer boundary, not an executed runtime
  // or endorsement of asynchronous CJS semantics. B rejects both extra forms.
  const result = analyzeEmittedLoaders(ordinary)
  assert.equal(result.browserify.length, 1); assert.deepEqual(result.unverified, [])
  assert.throws(() => accept(fixture.replace('start:[function', 'start:[async function')))
  assert.throws(() => accept(fixture.replace('other:[function', 'toString:[function')))
})

test('an emitted embedded fixture stays a static framework with its real Worker boundary', async () => {
  const code = await readFile(new URL('./test-fixtures/embedded-image-loader/image-blob-reduce.esm.js', import.meta.url), 'utf8')
  const proof = proveKnownFlatEmbeddedLoaders(code), result = analyzeEmittedLoaders(code, proof)
  assert.equal(result.internalLoads.length, 29)
  assert.equal(result.unverified.length, 3)
  assert.ok(result.unverified.every(x => /extra dispatcher arguments/.test(x.reason)))
  assert.deepEqual(proof.skip, [])
})

const hostile = [
  ['changed throwing helper', s => s.replace('throw new Error', 'return new Error')],
  ['throw helper target alias', s => s.replace('throw new Error', 'specifier=other;throw new Error')],
  ['throw helper shadowed Error', s => s + '\nlet Error;'],
  ['throw helper escaped', s => s + '\nvar leak=fail;'],
  ['throw helper reassigned', s => s + '\nfail=other;'],
  ['throw helper unknown call', s => s + '\nfail("missing");'],
  ['wrapper helper changed', s => s.replace('fn(owner,owner.exports)', 'fn(owner.exports,owner)')],
  ['wrapper alias', s => s + '\nvar alias=create;'],
  ['wrapper exported', s => s + '\nexport {create};'],
  ['wrapper reassigned', s => s + '\ncreate=other;'],
  ['wrapper nonliteral callback', s => s + '\ncreate(other);'],
  ['wrapper callback extra write', s => s.replace('(function(run){owner.exports=run()}', '(function(run){owner.exports=run();owner.exports=other}')],
  ['wrapper callback changed result', s => s.replace('owner.exports=run()', 'exported.exports=run()')],
  ['result reassignment', s => s + '\nretained=other;'],
  ['result destructuring write', s => s + '\n({value:retained}=other);'],
  ['result update', s => s + '\nretained++;'],
  ['result duplicate var', s => s + '\nvar retained;'],
  ['missing mapped target', s => s.replace("dep:'other'", "dep:'missing'")],
  ['duplicate mapping key', s => s.replace("dep:'other'", "dep:'other',dep:'other'")],
  ['prototype mapping key', s => s.replace("dep:'other'", "dep:'other',__proto__:'other'")],
  ['constructor mapping key', s => s.replace("dep:'other'", "dep:'other',constructor:'other'")],
  ['inherited mapping key', s => s.replace("dep:'other'", "dep:'other',toLocaleString:'other'")],
  ['prototype module ID', s => s.replace('other:[function', '__proto__:[function')],
  ['inherited module ID', s => s.replace('other:[function', 'toString:[function')],
  ['valueOf module ID', s => s.replace('other:[function', 'valueOf:[function')],
  ['duplicate module ID', s => s.replace('other:[function', 'start:[function')],
  ['computed module ID', s => s.replace('other:[function', '[other]:[function')],
  ['spread module table', s => s.replace('other:[function', '...outside,other:[function')],
  ['nonempty cache', s => s.replace('},{},[])', '},{outside:{}},[])')],
  ['missing entry', s => s.replace(")('start')", ")('missing')")],
  ['nonliteral entry', s => s.replace(")('start')", ')(entryName)')],
  ['unmapped literal call', s => s.replace("_dereq_('dep')", "_dereq_('missing')")],
  ['nonliteral call', s => s.replace("_dereq_('dep')", '_dereq_(dynamicName)')],
  ['loader alias', s => s.replace("module.exports=_dereq_('dep')", "var load=_dereq_;module.exports=load('dep')")],
  ['loader returned', s => s.replace("module.exports=_dereq_('dep')", 'module.exports=_dereq_')],
  ['loader reassigned', s => s.replace("module.exports=_dereq_('dep')", "_dereq_=other;module.exports=_dereq_('dep')")],
  ['loader member apply', s => s.replace("_dereq_('dep')", "_dereq_.call(null,'dep')")],
  ['loader parameter shadow', s => s.replace("module.exports=_dereq_('dep')", "module.exports=function(_dereq_){return _dereq_('dep')}")],
  ['loader TDZ shadow', s => s.replace("module.exports=_dereq_('dep')", "{module.exports=_dereq_('dep');let _dereq_;}")],
  ['loader catch shadow', s => s.replace("module.exports=_dereq_('dep')", "try{}catch(_dereq_){module.exports=_dereq_('dep')}")],
  ['loader destructuring shadow', s => s.replace("module.exports=_dereq_('dep')", "function nested({_dereq_}){return _dereq_('dep')}module.exports=nested")],
  ['async factory', s => s.replace('start:[function', 'start:[async function')],
  ['generator factory', s => s.replace('start:[function', 'start:[function*')],
  ['destructured factory parameter', s => s.replace('start:[function(_dereq_', 'start:[function({_dereq_}')],
  ['extra factory parameter', s => s.replace('start:[function(_dereq_,module,exports)', 'start:[function(_dereq_,module,exports,extra)')],
  ['dynamic dispatcher changed', s => s.replace('return o(n || r)', 'return outside(n || r)')],
  ['direct eval', s => s + '\neval("retained=other");'],
]
for (const [name, mutate] of hostile) test('rejects ' + name, () => {
  const code = mutate(fixture); assert.notEqual(code, fixture)
  assert.throws(() => accept(code))
})
