import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, symlink, writeFile, rm, cp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EXCALIDRAW_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'
import { analyzeEmittedLoaders, checkEmitted, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'

const bundle = (factory, map = "{'web-worker':4}", target = '4') =>
  `(${BROWSERIFY_DISPATCHER})()({3:[function(require,module,exports){${factory}},${map}],${target}:[function(require,module,exports){module.exports=typeof Worker!=='undefined'?Worker:undefined},{}]}, {}, [3])(3);`

for (const mode of ['emitted-leaf', 'dependency-leaf', 'root-alias']) {
  test(`filesystem gate rejects ${mode} symlink in ordinary and known-loader modes`, async t => {
    const fixture = await mkdtemp(join(tmpdir(), 'emitted-boundary-'))
    t.after(() => rm(fixture, { recursive: true, force: true }))
    const output = join(fixture, 'output'); await mkdir(output)
    const foreign = join(fixture, 'foreign.js')
    await writeFile(foreign, 'export const foreign = true;\n')
    let root = output
    if (mode === 'emitted-leaf') await symlink(foreign, join(output, 'entry.js'))
    if (mode === 'dependency-leaf') {
      await writeFile(join(output, 'entry.js'), "import './dep.js';\n")
      await symlink(foreign, join(output, 'dep.js'))
    }
    if (mode === 'root-alias') {
      await writeFile(join(output, 'entry.js'), 'export const ok = true;\n')
      root = join(fixture, 'alias'); await symlink(output, root)
    }
    for (const options of [{}, { knownNodeRuntime: true }, { knownBrowserShims: true }]) {
      await assert.rejects(checkEmitted(root, new Set(), options), /symlink|regular|canonical/i)
    }
  })
}

test('closed Browserify module maps are internal; factories continue to be inspected', () => {
  const result = analyzeEmittedLoaders(bundle("require.resolve('web-worker'); module.exports=require('web-worker')"))
  assert.equal(result.unverified.length, 0)
  assert.deepEqual(result.loads, [])
  assert.equal(result.internalLoads[0].target, '4')
  assert.equal(result.resolveOnly[0].target, '4')
  assert.equal(result.browserify.length, 1)
  assert.equal(result.dynamicClosureVerified, false)
  assert.ok(analyzeEmittedLoaders(bundle("module.exports=__require('missing')")).loads.some(x => x.source === 'missing'))
})

test('derequire factory parameter remains bound to checked dispatcher mappings', () => {
  const code = bundle("module.exports=require('web-worker')").replaceAll('function(require,module,exports)', 'function(_dereq_,module,exports)').replace("require('web-worker')", "_dereq_('web-worker')")
  assert.equal(analyzeEmittedLoaders(code).unverified.length,0)
  assert.equal(analyzeEmittedLoaders(code).internalLoads[0].target,'4')
  assert.ok(analyzeEmittedLoaders(code.replace("_dereq_('web-worker')", "_dereq_('missing')")).unverified.length)
  assert.ok(analyzeEmittedLoaders('(function(_dereq_){_dereq_(name)})(externalRequire)').unverified.length)
})

test('literal string module entry must exist in the checked table', () => {
  const code=bundle("module.exports=require('web-worker')").replace('3:[function', "'/index.js':[function").replace('[3])(3)', "[] )('/index.js')")
  assert.equal(analyzeEmittedLoaders(code).unverified.length,0)
  assert.throws(()=>analyzeEmittedLoaders(code.replace(")('/index.js')", ")('/missing.js')")),/Missing Browserify entry/)
})

test('missing mapping, missing target and modified dispatcher cannot be accepted', () => {
  assert.ok(analyzeEmittedLoaders(bundle("require('missing')")).unverified.length)
  assert.throws(() => analyzeEmittedLoaders(bundle("require('web-worker')", "{'web-worker':5}")), /Missing Browserify mapping target/)
  assert.ok(analyzeEmittedLoaders(bundle("require('web-worker')").replace('return o(n || r)', 'return __require(r)')).unverified.length)
})

test('global, runtime helper and inline createRequire loads remain external', () => {
  const result = analyzeEmittedLoaders("require('missing'); __require('other'); import {createRequire} from 'node:module'; createRequire(import.meta.url)('third'); require.resolve('fourth')")
  assert.deepEqual(result.loads.map(x => x.source), ['missing', 'other', 'node:module', 'third'])
  assert.deepEqual(result.resolveOnly.map(x => x.source), ['fourth'])
  assert.equal(result.unverified.length, 0)
})

test('shadow loader forwarding, aliases and nonliteral calls block acceptance', () => {
  for (const code of ["(function(require){require('missing')})(externalRequire)", "const req=require; req('missing')", "require(name)", "import(name)", bundle('require(name)'), bundle('require.resolve=externalResolve'), bundle('arguments[3](5)'), "function f(createRequire){createRequire(import.meta.url)('missing')}"]) {
    assert.ok(analyzeEmittedLoaders(code).unverified.length, code)
  }
})

test('filesystem gate rejects actual missing imports, resolve-only probes and unverified calls', async t => {
  const root = await mkdtemp(join(tmpdir(), 'emitted-loader-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'entry.mjs')
  for (const code of ["require('missing')", "__require('missing')", "import {createRequire} from 'node:module'; createRequire(import.meta.url)('missing')", "require.resolve('missing')", "function f(require){require('missing')} f(externalRequire)", bundle('require(name)')]) {
    await writeFile(path, code)
    await assert.rejects(checkEmitted(root, new Set()), /Undeclared|Unverified/)
  }
  await writeFile(path, bundle("require('web-worker')"))
  assert.equal((await checkEmitted(root, new Set()))[0].internalLoads.length, 1)
})

test('prefix-only Node builtins are runtime-owned; bare names and fabricated node names reject', async t => {
  const root = await mkdtemp(join(tmpdir(), 'emitted-prefix-builtin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'entry.mjs')
  await writeFile(path, "export const load = () => import('node:sqlite');\n")
  assert.equal((await checkEmitted(root, new Set()))[0].loads[0].source, 'node:sqlite')
  // This is a runtime capability check, not a blanket acceptance of node:*.
  assert.equal(typeof (await import('node:sqlite')).DatabaseSync, 'function')
  for (const source of ['sqlite', 'node:not-a-real-builtin']) {
    await writeFile(path, `export const load = () => import('${source}');\n`)
    await assert.rejects(checkEmitted(root, new Set()), /Undeclared emitted runtime dependency/)
  }
})

test('actual emitted method/property names and wrapper function ids are not loader references', () => {
  const result = analyzeEmittedLoaders("class Registry { async require(projectId){return projectId} async get(id){return this.require(id)} }; var __commonJS=(cb,mod)=>function __require(){return mod||cb()}; const root=Function('return this')(); const freeModule={}; freeModule.require && freeModule.require('util')")
  assert.equal(result.unverified.length, 0)
  assert.deepEqual(result.loads, [{kind:'member-require', source:'util'}])
  assert.equal(result.codeEvaluations.length, 1)
  assert.equal(result.dynamicClosureVerified, false)
})

test('known Rolldown node loader initializer is checked, but arbitrary aliases still block', () => {
  const source="import {createRequire} from 'node:module'; var __require=(()=>createRequire(import.meta.url))(); __require('missing')"
  assert.equal(analyzeEmittedLoaders(source).unverified.length, 0)
  assert.ok(analyzeEmittedLoaders(source).loads.some(load=>load.source==='missing'))
  assert.ok(analyzeEmittedLoaders(source.replace('(()=>createRequire(import.meta.url))()', 'externalRequire')).unverified.length)
  assert.ok(analyzeEmittedLoaders(source.replace("'node:module'", "'fake-module'")).unverified.length)
  assert.ok(analyzeEmittedLoaders("freeModule.require(name)").unverified.length)
})

async function uiStagingFixture(t) {
  const root=await mkdtemp(join(tmpdir(),'embedded-ui-staging-test-'));t.after(()=>rm(root,{recursive:true,force:true}))
  for(const name of ['pica-DGw4b28J.js','rolldown-runtime-CEgmsyvS.js'])await cp(new URL('./test-fixtures/pica-worker/'+name,import.meta.url),join(root,name))
  await cp(new URL('./test-fixtures/embedded-image-loader/image-blob-reduce.esm.js',import.meta.url),join(root,'image-blob-reduce.esm-BvXskEpO.js'))
  await writeFile(join(root,'client.js'),`import {i as __require} from './rolldown-runtime-CEgmsyvS.js'; var f$2=${EXCALIDRAW_REQUIRE_SHIM}; export {f$2 as W}\n`+await readFile(new URL('./test-fixtures/ui-blob-chain/client-consumer.js',import.meta.url),'utf8'))
  await writeFile(join(root,'elk.js'),`import {i as __require} from './rolldown-runtime-CEgmsyvS.js'; export default (${BROWSERIFY_DISPATCHER})()({1:[function(require,module,exports){module.exports=1},{}]}, {}, [1])(1)`)
  await writeFile(join(root,'consumer.js'),"import {W as f} from './client.js'; function nodeOnly(){f(['fs'].join());f(['path'].join())}")
  return root
}
test('embedded staging is explicit and retains exact unknowns with pinned injected consumer',async t=>{
  const root=await uiStagingFixture(t)
  await assert.rejects(checkEmitted(root,new Set(),{embeddedImageEvidenceRequired:true}),/forwarding-chain/)
  await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true,picaWorkerEvidenceRequired:true}),/Unverified/)
  const result=await checkEmitted(root,new Set(),{knownBrowserShims:true,picaWorkerEvidenceRequired:true,embeddedImageEvidenceRequired:true})
  const image=result.find(r=>r.runtimeEvidenceRequired?.kind==='injected-ui-blob-chain')
  assert.deepEqual(image.unverified.map(r=>r.start),[42916,42948,42978]);assert.equal(image.internalLoads.length,29)
  assert.equal(image.browserify[0].modules.length,25);assert.equal(image.dynamicClosureVerified,false)
  assert.equal(image.runtimeEvidenceRequired.embeddedDefaultWorkerStatus,'unresolved')
  assert.deepEqual(image.runtimeEvidenceRequired.consumer.configuredFeatures,['js','wasm'])
})
test('embedded staging never admits changed code/config, additional unknowns or missing imports',async t=>{
  for(const mutate of [
    async root=>{const p=join(root,'client.js');await writeFile(p,(await readFile(p,'utf8')).replace('["js", "wasm"]','["js", "ww"]'))},
    async root=>{const p=join(root,'client.js');await writeFile(p,(await readFile(p,'utf8')).replace('r({ pica: n({ features: ["js", "wasm"] }) })','r()'))},
    async root=>{const p=join(root,'image-blob-reduce.esm-BvXskEpO.js');await writeFile(p,(await readFile(p,'utf8'))+';require(dynamicName)')},
    root=>writeFile(join(root,'unrelated.js'),'const alias=require;alias(dynamicName)'),
    root=>writeFile(join(root,'missing.js'),"import './absent.js'"),
    root=>rm(join(root,'pica-DGw4b28J.js')),
  ]){const root=await uiStagingFixture(t);await mutate(root);await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true,picaWorkerEvidenceRequired:true,embeddedImageEvidenceRequired:true}))}
})
