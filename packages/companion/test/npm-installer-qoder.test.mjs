import assert from 'node:assert/strict'
import {test} from 'node:test'
import {execFile} from 'node:child_process'
import {cp,mkdir,mkdtemp,readFile,readdir,rename,rm,symlink,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname,join} from 'node:path'
import {promisify} from 'node:util'
import {installQoderPlugin} from '../src/npm-installer-qoder.mjs'
import {installerMain} from '../src/npm-installer.mjs'

test('public install routes to persistent Qoder registration and rejects unrelated options before invocation',async()=>{
  let calls=0
  const qoderInstaller=async options=>{calls++;assert.equal(options.stageRoot,'/external/receipts');assert.equal(options.cwd,process.cwd());return {status:'registered',hostRegistered:true}}
  const args=['install','--host','qoder','--receipt-dir','/external/receipts']
  const result=await installerMain(args,{npmRoot:'/package',qoderInstaller})
  assert.equal(result.hostRegistered,true);assert.match(result.next,/No --plugin-dir/)
  for(const extra of [['--dry-run'],['--disable-embedding'],['--user-root','/profile'],['--codex-executable','/codex']])
    await assert.rejects(installerMain([...args,...extra],{npmRoot:'/package',qoderInstaller}),/accepts only/)
  assert.equal(calls,1)
})

const execute=promisify(execFile)

test('missing Qoder native execution method rejects before any native invocation or staging',async()=>{
  const f=await fixture()
  try {
    await rm(join(f.overlay,'skills/yugoo/native-execution.md'))
    let calls=0
    await assert.rejects(installQoderPlugin({...f,run:async()=>{calls++;throw Error('Native must not be invoked')}}),/native-execution\.md/)
    assert.equal(calls,0)
    await assert.rejects(readFile(join(f.stageRoot,'receipt.json')),{code:'ENOENT'})
  } finally { await rm(f.root,{recursive:true,force:true}) }
})
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'qoder-persistent-'))
  const npmRoot=join(root,'npm package'),overlay=join(npmRoot,'payload/overlays/qoder')
  const put=async(path,body)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,body)}
  await cp(new URL('../plugin-qoder/design-system/',import.meta.url),overlay,{recursive:true})
  const manifest=JSON.parse(await readFile(join(overlay,'.qoder-plugin/plugin.json')))
  // The installer fixture remains independent of a concurrently updated overlay.
  manifest.name='yugoo-design'
  await put(join(overlay,'.qoder-plugin/plugin.json'),JSON.stringify(manifest))
  try {await rename(join(overlay,'skills/design'),join(overlay,'skills/yugoo'))} catch(error) {if(error.code!=='ENOENT')throw error}
  try {await rename(join(overlay,'commands/design.md'),join(overlay,'commands/yugoo.md'))} catch(error) {if(error.code!=='ENOENT')throw error}
  await put(join(npmRoot,'package.json'),JSON.stringify({name:'@fixture/qoder-registration',version:manifest.version}))
  await put(join(overlay,'skills/yugoo/native-execution.md'),'Fixture execution reference\n')
  for(const file of ['qoder-connection.mjs','qoder-hook-transport.mjs','native-hook-transport.mjs','windows-private-storage.mjs','windows-native-platform.mjs'])
    await cp(new URL('../src/'+file,import.meta.url),join(overlay,'scripts',file))
  await put(join(overlay,'scripts/design.mjs'),"await import('../../../shared/scripts/design.mjs')\n")
  await put(join(npmRoot,'payload/shared/scripts/design.mjs'),"console.log(JSON.stringify({entry:import.meta.url,args:process.argv.slice(2)}))\n")
  const cwd=join(root,'workspace'),configDir=join(root,'profile'),stageRoot=join(root,'receipts')
  await mkdir(cwd);await mkdir(configDir)
  return {root,npmRoot,overlay,cwd,configDir,stageRoot,put}
}
function nativeFixture(f,{fail=false,mutateForeign=false}={}) {
  const calls=[],rows=[]
  const run=async(_exe,args)=>{
    calls.push(args)
    if(args.includes('list'))return {stdout:JSON.stringify(rows)}
    assert.ok(args.includes('install'));assert.ok(args.includes('user'))
    if(fail)throw new Error('native fixture failed')
    const path=join(f.configDir,'native-cache')
    await cp(args[args.indexOf('install')+1],path,{recursive:true})
    rows.push({id:'yugoo-design@local',name:'yugoo-design',version:'0.1.0',scope:'user',enabled:true,installPath:path})
    if(mutateForeign)rows.find(row=>row.id==='foreign@market').enabled=false
    return {stdout:JSON.stringify({ok:true,pluginId:'yugoo-design@local',path})}
  }
  return {run,calls,rows}
}

test('native copy uses retained absolute shared entry, fresh readback and same-version no-op',async()=>{
  const f=await fixture(),n=nativeFixture(f)
  const before=await readFile(join(f.overlay,'scripts/design.mjs'),'utf8')
  const result=await installQoderPlugin({...f,run:n.run})
  assert.equal(result.status,'registered');assert.equal(result.hostRegistered,true)
  assert.equal(result.modelLaunched,false);assert.equal(result.runtimeAcceptance,false)
  assert.equal(await readFile(join(f.overlay,'scripts/design.mjs'),'utf8'),before)
  const invoked=JSON.parse((await execute(process.execPath,[join(result.installedPath,'scripts/design.mjs'),'help'])).stdout)
  assert.ok(invoked.entry.endsWith('/payload/shared/scripts/design.mjs'));assert.deepEqual(invoked.args,['help'])
  const again=await installQoderPlugin({...f,run:n.run})
  assert.equal(again.status,'already-registered')
  assert.equal(n.calls.filter(args=>args.includes('install')).length,1)
  assert.ok(n.calls.every(args=>args[0]==='--config-dir'&&args[1]===f.configDir))
  await writeFile(join(f.overlay,'commands/yugoo.md'),'changed npm overlay at same version')
  await assert.rejects(installQoderPlugin({...f,run:n.run}),/Packaged overlay changed/)
  assert.equal(n.calls.filter(args=>args.includes('install')).length,1)
})

test('foreign same-name registration and other scopes are refused before staging/install',async()=>{
  const f=await fixture(),n=nativeFixture(f)
  n.rows.push({id:'yugoo-design@local',name:'yugoo-design',scope:'project',enabled:true})
  await assert.rejects(installQoderPlugin({...f,run:n.run}),/not user scoped/)
  assert.equal(n.calls.filter(args=>args.includes('install')).length,0)
  n.rows[0]={...n.rows[0],scope:'user',version:'0.1.0',installPath:f.configDir}
  await assert.rejects(installQoderPlugin({...f,run:n.run}),/not owned/)
  assert.deepEqual(await readdir(f.configDir),[])
})

test('modified owned plugin refuses repeat; native failure keeps own receipt and does not uninstall',async()=>{
  const f=await fixture(),n=nativeFixture(f),result=await installQoderPlugin({...f,run:n.run})
  await writeFile(join(result.installedPath,'commands/yugoo.md'),'modified user file')
  await assert.rejects(installQoderPlugin({...f,run:n.run}),/modified/)
  const g=await fixture(),bad=nativeFixture(g,{fail:true})
  let error
  try {await installQoderPlugin({...g,run:bad.run})} catch(value){error=value}
  assert.ok(error.receiptFile)
  assert.equal(JSON.parse(await readFile(error.receiptFile)).status,'failed')
  assert.ok(bad.calls.every(args=>!args.includes('uninstall')))
})

test('omitted profile passes no guessed config root to native CLI',async()=>{
  const f=await fixture(),n=nativeFixture(f)
  await installQoderPlugin({...f,configDir:undefined,run:n.run})
  assert.ok(n.calls.every(args=>args[0]==='plugin'&&!args.includes('--config-dir')))
})

test('foreign registry sentinel is preserved; changed foreign rows retain a failed receipt without uninstall',async()=>{
  const sentinel={id:'foreign@market',name:'foreign',scope:'user',enabled:true,version:'2.0.0',installedAt:'retained'}
  const f=await fixture(),n=nativeFixture(f)
  n.rows.push({...sentinel})
  assert.equal((await installQoderPlugin({...f,run:n.run})).status,'registered')
  assert.deepEqual(n.rows.find(row=>row.id===sentinel.id),sentinel)
  const g=await fixture(),bad=nativeFixture(g,{mutateForeign:true})
  bad.rows.push({...sentinel})
  let failure
  try {await installQoderPlugin({...g,run:bad.run})} catch(error){failure=error}
  assert.match(failure.message,/Foreign plugin registrations changed/)
  assert.equal(JSON.parse(await readFile(failure.receiptFile)).status,'failed')
  assert.ok(bad.calls.every(args=>!args.includes('uninstall')))
  assert.ok(bad.rows.some(row=>row.id==='yugoo-design@local'))
})

test('receipt staging rejects npm-contained and symlink ancestors without touching foreign directories',async()=>{
  const f=await fixture(),n=nativeFixture(f)
  await assert.rejects(installQoderPlugin({...f,stageRoot:join(f.npmRoot,'receipts'),run:n.run}),/outside/)
  const linked=join(f.root,'linked-profile')
  await symlink(f.configDir,linked)
  await assert.rejects(installQoderPlugin({...f,stageRoot:join(linked,'new-receipts'),run:n.run}),/not a symlink|Symlink/)
  assert.deepEqual(await readdir(f.configDir),[])
  assert.ok(n.calls.every(args=>!args.includes('install')))
})

test('actual installed Qoder CLI: isolated persistent registration and separate-process list',{
  skip:!process.env.QODER_TEST_EXECUTABLE&&'Set QODER_TEST_EXECUTABLE to opt into isolated native registration, no model',
},async()=>{
  const f=await fixture()
  const opts={...f,executable:process.env.QODER_TEST_EXECUTABLE}
  const result=await installQoderPlugin(opts)
  assert.equal(result.status,'registered')
  const listed=JSON.parse((await execute(opts.executable,['--config-dir',f.configDir,'plugin','list','--json'],{cwd:f.cwd})).stdout)
  const row=listed.find(item=>item.id==='yugoo-design@local')
  assert.equal(row.scope,'user');assert.equal(row.enabled,true);assert.equal(row.installPath,result.installedPath)
  assert.ok(row.resources.skills.length>0);assert.ok(row.resources.mcpServers.length>0);assert.ok(row.resources.hooks.length>0)
  const shim=JSON.parse((await execute(process.execPath,[join(row.installPath,'scripts/design.mjs'),'help'])).stdout)
  assert.ok(shim.entry.endsWith('/payload/shared/scripts/design.mjs'))
  assert.equal((await installQoderPlugin(opts)).status,'already-registered')
  console.log(JSON.stringify({scope:'isolated-test',profile:f.configDir,status:result.status,pluginId:result.pluginId,installedPath:result.installedPath,modelLaunched:false,fixtureSharedEntry:true}))
})


test('legacy and mixed Qoder plugin identities require explicit migration before any install',async()=>{
  for(const mixed of [false,true]) {
    const f=await fixture(),n=nativeFixture(f)
    n.rows.push({id:'design-system@local',name:'design-system',scope:'user',enabled:true,version:'0.1.0'})
    if(mixed)n.rows.push({id:'yugoo-design@local',name:'yugoo-design',scope:'user',enabled:true,version:'0.1.0'})
    const before=structuredClone(n.rows)
    await assert.rejects(installQoderPlugin({...f,run:n.run}),/Legacy design-system plugin.*exact old selector/)
    assert.ok(n.calls.every(args=>args.includes('list')))
    assert.deepEqual(n.rows,before)
    assert.deepEqual(await readdir(f.configDir),[])
    await assert.rejects(readdir(f.stageRoot),{code:'ENOENT'})
  }
})
