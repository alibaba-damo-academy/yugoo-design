import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkEmitted, BROWSERIFY_DISPATCHER } from './emitted-loader-check.mjs'
import { EXCALIDRAW_REQUIRE_SHIM, ROLLDOWN_REQUIRE_SHIM } from './known-browser-loader-proof.mjs'

async function fixture(t, changes={}) {
  const root=await mkdtemp(join(tmpdir(),'browser-loader-chain-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const browserify=`import {i as __require} from './runtime.js'; export default (${BROWSERIFY_DISPATCHER})()({1:[function(require,module,exports){module.exports=1},{}]}, {}, [1])(1)`
  const files={
    'runtime.js':`var __require=${ROLLDOWN_REQUIRE_SHIM};export {__require as i}`,
    'client.js':`import {i as __require} from './runtime.js'; var f$2=${EXCALIDRAW_REQUIRE_SHIM}; export {f$2 as W}`,
    'elk.js':browserify,
    'pica.js':browserify,
    'consumer.js':`import {W as f} from './client.js'; function nodeOnly(){f(['fs'].join());f(['path'].join())}`,
  }
  Object.assign(files,changes)
  for(const [name,code] of Object.entries(files))await writeFile(join(root,name),code)
  return root
}

test('known complete forwarding chain records only two builtin loads',async t=>{
  const root=await fixture(t),records=await checkEmitted(root,new Set(),{knownBrowserShims:true})
  const leaf=records.find(x=>x.file==='consumer.js')
  assert.deepEqual(leaf.loads.filter(x=>x.kind==='known-shim-builtin').map(x=>x.source),['fs','path'])
  assert.equal(leaf.knownBrowserProofs.length,1)
  assert.equal(leaf.dynamicClosureVerified,false)
  assert.equal(leaf.knownBrowserProofs[0].browserExecuted,false)
})

test('exact discarded upstream shim is inert but consuming it remains blocked',async t=>{
  const root=await fixture(t,{'client.js':"import {i as __require} from './runtime.js';"+EXCALIDRAW_REQUIRE_SHIM+';', 'consumer.js':'export const noLoaderConsumer=true'})
  const file=join(root,'client.js')
  const binding="import {i as __require} from './runtime.js';"
  await writeFile(file,`${binding}${EXCALIDRAW_REQUIRE_SHIM};`)
  const [record]=await checkEmitted(root,new Set(),{knownBrowserShims:true})
  assert.deepEqual(record.loads,[{kind:'esm',source:'./runtime.js'}])
  assert.equal(record.dynamicClosureVerified,false)
  for (const code of [`(${EXCALIDRAW_REQUIRE_SHIM})('fs')`, `const alias=${EXCALIDRAW_REQUIRE_SHIM};alias('fs')`, `${EXCALIDRAW_REQUIRE_SHIM};__require('fs')`]) {
    await writeFile(file,binding+code)
    await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),/loader|Rolldown|Unverified/i)
  }
})

test('a discarded shim does not make unrelated module exports into loader entries',async t=>{
  const discarded="import {i as __require} from './runtime.js';"+EXCALIDRAW_REQUIRE_SHIM+';'
  const root=await fixture(t,{
    'client.js':discarded+'const math={renderToString:()=>"mathml"};export {math as kn}',
    'consumer.js':"export const math=()=>import('./client.js').then(n=>n.kn)",
  })
  const records=await checkEmitted(root,new Set(),{knownBrowserShims:true})
  assert.ok(records.find(row=>row.file==='consumer.js').loads.some(load=>load.kind==='dynamic-import'&&load.source==='./client.js'))
  assert.ok(records.find(row=>row.file==='client.js').knownBrowserProofs.some(proof=>proof.discardedCarrier))
  for(const code of [discarded+'export {__require as kn}',discarded+'const alias=__require;export {alias as kn}']){
    await writeFile(join(root,'client.js'),code)
    await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),/Discarded Excalidraw loader has another reference/)
  }
  await writeFile(join(root,'client.js'),discarded+'export const kn=1')
  await writeFile(join(root,'consumer.js'),"const target='./client.js';export const math=()=>import(target)")
  await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),/Unverified emitted loader/)
})

test('actual loader module entries remain rejected with file and location diagnostics',async t=>{
  const root=await fixture(t,{'consumer.js':"import {W as f} from './client.js';function nodeOnly(){f(['fs'].join());f(['path'].join())}",
    'extra.js':"\nimport('./runtime.js').then(m=>m.i('missing'))"})
  await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),error=>{
    assert.match(error.message,/Dynamic or non-static known-loader module entry is unverified/)
    assert.ok(error.message.includes(join(root,'extra.js')+':2:1'))
    assert.match(error.message,/ImportExpression, "\.\/runtime\.js"/)
    return true
  })
})

test('consumer reassignment, shadow binding, aliases and escapes fail closed',async t=>{
  for(const body of ["f=other", "const alias=f;alias(['fs'].join())", "sink(f)", "function nested(f){f(['fs'].join())}","export {f}", "f(['missing'].join())", "f(name)", "f(['fs','path'].join())", "f(['fs'].join());f(['fs'].join());f(['path'].join())"]){
    const root=await fixture(t,{'consumer.js':`import {W as f} from './client.js'; f(['fs'].join());f(['path'].join());${body}`})
    await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),/loader|Excalidraw|builtin/)
  }
})

test('changed carrier, export alias and extra consumer are not silently accepted',async t=>{
  const carrier=`import {i as __require} from './runtime.js'; var f$2=${EXCALIDRAW_REQUIRE_SHIM}; export {f$2 as W}`
  const cases=[
    {'client.js':carrier+';f$2=external'},
    {'client.js':carrier+';const alias=f$2'},
    {'client.js':carrier.replace('as W','as Changed')},
    {'extra.js':"import {W as f} from './client.js';f(['fs'].join())"},
    {'extra.js':"import {i as __require} from './runtime.js';__require('missing')"},
    {'extra.js':"const m=await import('./client.js');m.W('missing')"},
    {'extra.js':"import('./runtime.js').then(m=>m.i('missing'))"},
    {'extra.js':"const m=require('./client.js');m.W('missing')"},
    {'extra.js':"import {createRequire} from 'node:module';const m=createRequire(import.meta.url)('./runtime.js');m.i('missing')"},
    {'extra.js':"const m=loader.require('./client.js');m.W('missing')"},
    {'extra.js':"const p=require.resolve('./runtime.js'); const m=acquire(p);m.i('missing')"},
    {'client.js':carrier.replace('typeof __require < "u"','typeof differentLoader < "u"')},
    {'pica.js':"import {i as __require} from './runtime.js';const alias=__require;alias('missing')"},
  ]
  for(const changes of cases){const root=await fixture(t,changes);await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),/loader|Rolldown|Excalidraw|Unverified/i)}
})

test('factory missing mapping or dynamic load remains blocked beyond the known shim',async t=>{
  for(const factory of ["module.exports=require('missing')", "module.exports=require(dynamicName)", "var bundleFn=arguments[3],sources=arguments[4],cache=arguments[5];module.exports=bundleFn"]){
    const root=await fixture(t,{'pica.js':`import {i as __require} from './runtime.js'; export default (${BROWSERIFY_DISPATCHER})()({1:[function(require,module,exports){${factory}},{}]}, {}, [1])(1)`})
    await assert.rejects(checkEmitted(root,new Set(),{knownBrowserShims:true}),/Unverified/)
  }
})
