import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { analyzeEmittedLoaders, proveKnownBrowserLodash } from './emitted-loader-check.mjs'

// The retained lodash optional-Node contract, also embedded in Mermaid. The
// original detection expression retains the upstream MIT notice in
// known-browser-lodash-proof.mjs beside its AST contract.
const fixture = `var freeGlobal = {};
var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
var freeProcess = freeModule && freeModule.exports === freeExports && freeGlobal.process;
var nodeUtil = (function() {
  try {
    var types = freeModule && freeModule.require && freeModule.require("util").types;
    if (types) return types;
    return freeProcess && freeProcess.binding && freeProcess.binding("util");
  } catch (e) {}
})();
export {nodeUtil};`
const accept = code => {
  const proof = proveKnownBrowserLodash(code, { fileName: 'fixture.mjs' })
  const result = analyzeEmittedLoaders(code, proof)
  assert.deepEqual(result.loads, [], 'unknown/executable loads must still reject')
  assert.deepEqual(result.unverified, [], 'unverified loader aliases must still reject')
  return proof
}
const body = fixture.replace('export {nodeUtil};', 'return nodeUtil;')

test('default classification stays strict; opt-in exact proof pins source and call ranges', () => {
  assert.deepEqual(analyzeEmittedLoaders(fixture).loads, [{ kind: 'member-require', source: 'util' }])
  const proof = accept(fixture)
  assert.equal(proof.skip.length, 1)
  assert.equal(proof.proof[0].kind, 'known-browser-lodash-node-util')
  assert.equal(proof.proof[0].sha256, createHash('sha256').update(fixture).digest('hex'))
  assert.equal(fixture.slice(proof.skip[0].start, proof.skip[0].end), 'freeModule.require("util")')
  assert.equal(proof.proof[0].browserExecuted, false)
})

test('a proof cannot be reused after its pinned emitted bytes change', () => {
  const proof = proveKnownBrowserLodash(fixture)
  assert.throws(() => analyzeEmittedLoaders(fixture.replace('require("util")', 'require("evil")'), proof), /source pin changed/u)
})

test('hoisted assignments and harmless sibling CJS factories preserve lexical distinction', () => {
  const assigned = body.replaceAll('var freeExports =', 'freeExports =').replaceAll('var freeModule =', 'freeModule =')
    .replaceAll('var freeProcess =', 'freeProcess =').replaceAll('var nodeUtil =', 'nodeUtil =')
  const code = `var freeExports, freeModule, freeProcess, nodeUtil;
  function initGraph() { ${assigned} }
  function unrelated(exports, module) { return module.exports; }`
  assert.equal(accept(code).skip.length, 1)
})

test('separate lexical bindings and emitted renaming each need their own proof', () => {
  const renamed = body.replaceAll('freeExports', 'out$4').replaceAll('freeModule', 'mod$3').replaceAll('freeProcess', 'proc$2')
    .replaceAll('freeGlobal', 'global$1').replaceAll('nodeUtil', 'util$9')
  assert.equal(accept(`function first(){${body}} function second(){${renamed}}`).skip.length, 2)
})

const mutations = [
  ['different target', s => s.replace('require("util")', 'require("fs")')],
  ['missing module guard', s => s.replace('freeModule && freeModule.require && ', '')],
  ['missing exports guard', s => s.replace('typeof exports == "object" && ', '')],
  ['extra call inside helper', s => s.replace('if (types)', 'freeModule.require("util"); if (types)')],
  ['aliased loader', s => s.replace('var types =', 'var load = freeModule.require; var types =')],
  ['guard alias escapes', s => s + '\nconst alias = freeModule;'],
  ['guard reassigned', s => s + '\nfreeModule = {};'],
  ['guard property reassigned', s => s + '\nfreeModule.require = other;'],
  ['guard declared twice', s => s + '\nvar freeModule;'],
  ['local module', s => 'const module = {};\n' + s],
  ['local exports', s => 'const exports = {};\n' + s],
  ['module parameter', () => `function injected(module){${body}}`],
  ['exports parameter', () => `const injected = (exports) => {${body}}`],
  ['destructured module', () => `function injected({module}){${body}}`],
  ['catch exports', () => `try {} catch(exports) {${body.replace('return nodeUtil;', '')}}`],
  ['later lexical module', () => `{${body.replace('return nodeUtil;', '')} let module;}`],
  ['named function module', () => `const injected = function module(){${body}}`],
  ['imported module', s => 'import module from "elsewhere";\n' + s],
  ['injected window module', s => 'window.module = {};\n' + s],
  ['injected global exports', s => 'globalThis.exports = {};\n' + s],
  ['aliased global injection', s => 'const root = globalThis; const alias = root; alias.module = {};\n' + s],
  ['additional unproved call', s => s + '\nother.require("util");'],
]
for (const [name, mutate] of mutations) test('rejects ' + name, () => assert.throws(() => accept(mutate(fixture))))

test('bare util names and unrelated guarded calls do not acquire a proof', () => {
  for (const code of ['freeModule.require("util")', 'freeModule && freeModule.require && freeModule.require("util")', 'const load = () => require("react")']) {
    assert.equal(proveKnownBrowserLodash(code).skip.length, 0)
    assert.ok(analyzeEmittedLoaders(code).loads.length)
  }
})
