import { resolveNodeRuntime } from '../src/npm-node-runtime.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectRuntime, checkRuntime } from '../src/npm-runtime-check.mjs'
import { installerMain } from '../src/npm-installer.mjs'

async function fixture(t,{addon=true,source="module.exports={versions:{fixture:'only'}}"}={}) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'runtime-check-test-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const npmRoot=join(root,'node_modules/@fixture/companion'),receiptDirectory=join(root,'receipts')
  const put=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,value)}
  await put(join(npmRoot,'package.json'),JSON.stringify({name:'@fixture/companion',version:'1.0.0'}))
  await put(join(npmRoot,'payload/shared/knowledge/runtime.mjs'),'// fixture runtime, never evaluated\n')
  await put(join(npmRoot,'payload/shared/scripts/design.mjs'),'// fixture CLI\n')
  const label=`${process.platform==='linux'&&!process.report.getReport().header.glibcVersionRuntime?'linuxmusl':process.platform}-${process.arch}`
  const sharp=join(root,'node_modules/sharp'),native=join(root,`node_modules/@img/sharp-${label}/lib/sharp-${label}.node`)
  await put(join(sharp,'package.json'),JSON.stringify({name:'sharp',version:'1.0.0',main:'index.js',optionalDependencies:{[`@img/sharp-${label}`]:'1.0.0'}}))
  await put(join(sharp,'index.js'),source)
  if(addon) {
    await put(join(dirname(dirname(native)),'package.json'),JSON.stringify({name:`@img/sharp-${label}`,version:'1.0.0'}))
    await put(native,'not a native binary: fixture')
  }
  return {root,npmRoot,receiptDirectory,put,sharp,native,label}
}
const fakePass=(f,transform=x=>x)=>async(command,args,options)=>{
  assert.equal(command,process.execPath);assert.equal(options.timeout,15000)
  for(const name of ['NODE_PATH','NODE_OPTIONS','HTTPS_PROXY','HF_TOKEN'])assert.equal(options.env[name],undefined)
  assert.ok(options.cwd.startsWith(f.receiptDirectory))
  return {stdout:JSON.stringify(transform({execPath:process.execPath,node:process.versions.node,native:[f.native],versions:{fixture:'only'}})),stderr:''}
}

test('missing platform dependency fails default local; explicit disable is separate from server configuration',async t=>{
  const f=await fixture(t,{addon:false})
  const missing=await inspectRuntime(f)
  assert.equal(missing.status,'missing');assert.match(missing.reason,/Missing installed dependency/)
  const disabled=await checkRuntime({...f,disableEmbedding:true})
  assert.equal(disabled.status,'disabled');assert.equal(disabled.embedding.selection,'explicit-cli')
  assert.equal(disabled.embedding.runningServerConfigurationVerified,false)
  assert.equal(disabled.semanticKagVerified,false);assert.equal(disabled.load.status,'not-run')
  assert.equal((await inspectRuntime({...f,host:'dsh'})).status,'not-applicable')
})

test('dry-run only inspects and check-runtime writes external receipt without native host commands',async t=>{
  const f=await fixture(t,{addon:false});await mkdir(join(f.root,'home'))
  const options={npmRoot:f.npmRoot,userRoot:join(f.root,'home'),adapter:{probe:()=>{throw Error('must not probe host')}}}
  const plan=await installerMain(['install','--dry-run','--host','qwenwork','--receipt-dir',f.receiptDirectory],options)
  assert.equal(plan.runtimePrerequisites.status,'missing');assert.equal(plan.hostRegistered,false)
  const receipt=await installerMain(['check-runtime','--host','codex','--disable-embedding','--receipt-dir',f.receiptDirectory],options)
  assert.equal(JSON.parse(await readFile(receipt.receiptFile)).status,'disabled')
  assert.equal(receipt.releaseValidated,false)
  await assert.rejects(installerMain(['check-runtime','--host','codex','--apply','--receipt-dir',f.receiptDirectory],options),/does not install/)
  await assert.rejects(installerMain(['install','--apply'],options),/plan-only/)
})

test('presence does not establish load; real child exits without loading expected addon',async t=>{
  const f=await fixture(t),before=await readFile(f.native)
  assert.equal((await inspectRuntime(f)).status,'present')
  const receipt=await checkRuntime(f)
  assert.equal(receipt.status,'failed');assert.match(receipt.load.reason,/addon was not loaded/)
  assert.equal(receipt.load.childAbsent,true);assert.deepEqual(await readFile(f.native),before)
  assert.equal(receipt.transformersVerified,false);assert.equal(receipt.licenseObligationsAccepted,false)
})

test('isolated runner records fixture scope, removes ambient environment and rejects Node mismatch',async t=>{
  const f=await fixture(t)
  await assert.rejects(checkRuntime({...f,testRunner:fakePass(f)}),/isolated test scope/)
  const receipt=await checkRuntime({...f,scope:'isolated-test-contract',testRunner:fakePass(f)})
  assert.equal(receipt.status,'load-verified');assert.equal(receipt.scope,'isolated-test-contract')
  assert.equal(receipt.load.childAbsent,null);assert.equal(receipt.semanticKagVerified,false)
  for(const transform of [x=>({...x,node:'different'}),x=>({...x,execPath:'/different/node'})]) {
    const bad=await checkRuntime({...f,scope:'isolated-test-contract',testRunner:fakePass(f,transform)})
    assert.equal(bad.status,'failed');assert.match(bad.load.reason,/Node/)
  }
})

test('checked native and package pins cannot drift during load',async t=>{
  for(const which of ['native','package'])await t.test(which,async t=>{
    const f=await fixture(t),runner=fakePass(f)
    const receipt=await checkRuntime({...f,scope:'isolated-test-contract',testRunner:async(...args)=>{
      const output=await runner(...args)
      await f.put(which==='native'?f.native:join(f.npmRoot,'new-content'),'changed')
      return output
    }})
    assert.equal(receipt.status,'failed');assert.match(receipt.load.reason,/changed during/)
  })
})

test('workspace, NODE_PATH and symlink dependency fallback are rejected',async t=>{
  const f=await fixture(t,{addon:false})
  const foreign=join(f.root,'foreign'),original=process.env.NODE_PATH
  await f.put(join(foreign,`@img/sharp-${f.label}/package.json`),JSON.stringify({name:`@img/sharp-${f.label}`,version:'1.0.0'}))
  process.env.NODE_PATH=foreign
  try { assert.equal((await inspectRuntime(f)).status,'missing') }
  finally { if(original===undefined)delete process.env.NODE_PATH;else process.env.NODE_PATH=original }
  const path=join(f.root,`node_modules/@img/sharp-${f.label}`)
  await mkdir(dirname(path),{recursive:true});await symlink(join(foreign,`@img/sharp-${f.label}`),path)
  const bad=await inspectRuntime(f);assert.equal(bad.status,'failed');assert.match(bad.reason,/symlink/)
})

test('real stalled loader is killed within the production bound and leaves no child',async t=>{
  const f=await fixture(t,{source:"module.exports={versions:{fixture:'only'}};setInterval(()=>{},1000)"})
  const start=Date.now(),receipt=await checkRuntime(f)
  assert.equal(receipt.status,'failed');assert.equal(receipt.load.signal,'SIGKILL')
  assert.equal(receipt.load.childAbsent,true);assert.ok(Date.now()-start<20000)
})


test('runtime inspection and loader use the selected Node, and reject a changed executable pin',async t=>{
  const f=await fixture(t)
  const selected=await resolveNodeRuntime({nodeExecutable:process.env.YUGOO_TEST_ALTERNATE_NODE??process.execPath})
  const bad={...selected,sha256:'0'.repeat(64)}
  await assert.rejects(inspectRuntime({...f,nodeRuntime:bad}),/changed/)
  const receipt=await checkRuntime({...f,nodeRuntime:selected,scope:'isolated-test-contract',testRunner:async(command,_args,options)=>{
    assert.equal(command,selected.executable)
    // Real selected process; fixture JSON is not native addon acceptance.
    return promisify(execFile)(command,['--input-type=commonjs','--eval',
      'console.log(JSON.stringify({execPath:process.execPath,node:process.versions.node,native:'+JSON.stringify([f.native])+',versions:{fixture:true}}))'],options)
  }})
  assert.equal(receipt.status,'load-verified');assert.equal(receipt.scope,'isolated-test-contract')
  assert.equal(receipt.observation.execPath,selected.executable);assert.equal(receipt.observation.node,selected.version)
  assert.equal(receipt.load.observation.execPath,selected.executable);assert.equal(receipt.load.observation.node,selected.version)
  if(process.env.YUGOO_TEST_ALTERNATE_NODE)assert.notEqual(selected.version,process.versions.node)
})
