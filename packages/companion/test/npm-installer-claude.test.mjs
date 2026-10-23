import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createClaudeNativeAdapter, planClaudeInstallation, applyClaudeInstallation, recoverClaudeInstallation } from '../src/npm-installer-claude.mjs'
import { installerMain } from '../src/npm-installer.mjs'
import { checkRuntime } from '../src/npm-runtime-check.mjs'
import { stageNativeInventoryFixture } from '../../../scripts/test-fixtures/companion-native-inventory.mjs'

const encode=value=>JSON.stringify(value,null,2)+'\n'
const MARKET='yugoo-design-local',SELECTOR='yugoo-design@'+MARKET
async function fixture(t,{retainKnownMarketplace=false}={}) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'yugoo claude '))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const npmRoot=join(root,'retained npm'),userRoot=join(root,'home'),receiptDirectory=join(root,'receipts')
  const exe=join(root,'claude'),exeBytes='isolated Claude transport fixture\n'
  const put=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,value)}
  await mkdir(userRoot);await put(exe,exeBytes)
  await put(join(npmRoot,'package.json'),encode({name:'@fixture/design-system',version:'1.0.0','x-design-release-review':{fixture:true}}))
  await put(join(npmRoot,'payload/shared/scripts/design.mjs'),'export const fixture=true\n')
  const overlay=join(npmRoot,'payload/overlays/claude-code')
  await put(join(overlay,'.claude-plugin/plugin.json'),encode({name:'yugoo-design',version:'1.0.0'}))
  await put(join(overlay,'.mcp.json'),encode({mcpServers:{'design-system':{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs','mcp']}}}))
  for(const file of ['scripts/design.mjs','skills/yugoo/SKILL.md','skills/design-panel/SKILL.md'])await put(join(overlay,file),'fixture source\n')
  await put(join(overlay,'hooks/hooks.json'),encode({hooks:{SessionStart:[{hooks:[{type:'command',command:'node',args:['${CLAUDE_PLUGIN_ROOT}/scripts/claude-context.mjs']}]}]}}))
  const config=join(userRoot,'.claude'),target=join(userRoot,'.local/share/yugoo-design/claude-code')
  const foreignMarket={name:'other-market',source:'directory',path:join(root,'foreign'),installLocation:join(root,'foreign')}
  const foreignPlugin={id:'other@other-market',scope:'user',version:'9',enabled:true,installPath:join(root,'foreign-cache')}
  const settingsFile=join(config,'settings.json'),foreignSettings={theme:'dark',enabledPlugins:{'other@other-market':true}}
  await put(settingsFile,encode(foreignSettings))
  const native={markets:[foreignMarket],plugins:[foreignPlugin],commands:[],calls:[],after:async()=>{}}
  const run=async(_exe,args,options)=>{
    native.commands.push([...args]);let stdout=''
    native.calls.push({args:[...args],...options,env:{...options.env}})
    if(args[0]==='--version')stdout='2.1.209 (Claude Code)\n'
    else if(args[1]==='marketplace'&&args[2]==='list')stdout=encode(native.markets)
    else if(args[1]==='list')stdout=encode(native.plugins)
    else if(args[1]==='marketplace'&&args[2]==='add') {
      native.markets.push({name:MARKET,source:'directory',path:target,installLocation:target})
      const settings=JSON.parse(await readFile(settingsFile,'utf8'))
      await put(settingsFile,encode({...settings,extraKnownMarketplaces:{...settings.extraKnownMarketplaces,
        [MARKET]:{source:{source:'directory',path:target}}}}))
    }
    else if(args[1]==='install') {
      const cache=join(config,'plugins/cache',MARKET,'yugoo-design','1.0.0')
      await mkdir(dirname(cache),{recursive:true});await cp(join(target,'plugins/yugoo-design'),cache,{recursive:true})
      native.plugins.push({id:SELECTOR,scope:'user',version:'1.0.0',enabled:true,installPath:cache})
      const settings=JSON.parse(await readFile(settingsFile,'utf8'))
      await put(settingsFile,encode({...settings,enabledPlugins:{...settings.enabledPlugins,[SELECTOR]:true}}))
    } else if(args[1]==='uninstall') {
      const owned=native.plugins.find(row=>row.id===args[2])
      await put(join(owned.installPath,'.orphaned_at'),'fixture orphan\n')
      native.plugins=native.plugins.filter(row=>row.id!==args[2])
      const settings=JSON.parse(await readFile(settingsFile,'utf8'))
      delete settings.enabledPlugins[args[2]]
      await put(settingsFile,encode(settings))
    } else if(args[1]==='marketplace'&&args[2]==='remove') {
      assert.deepEqual(args,['plugin','marketplace','remove',MARKET,'--scope','user'])
      const settings=JSON.parse(await readFile(settingsFile,'utf8'))
      if(settings.extraKnownMarketplaces) {
        delete settings.extraKnownMarketplaces[MARKET]
        if(!Object.keys(settings.extraKnownMarketplaces).length)delete settings.extraKnownMarketplaces
      }
      await put(settingsFile,encode(settings))
      // A declaration and the known-market list are separate mock state. This option
      // exercises the observed partial boundary; it does not prove vendor semantics.
      if(!retainKnownMarketplace)native.markets=native.markets.filter(row=>row.name!==MARKET)
    }
    else assert.fail('Unexpected native command '+args.join(' '))
    await native.after(args)
    return {stdout}
  }
  const make=(options={})=>createClaudeNativeAdapter({executable:exe,userRoot,nativeCwd:npmRoot,scope:'isolated-test-contract',run,...options})
  const adapter=await make()
  const options={npmRoot,userRoot,receiptDirectory,adapter,disableEmbedding:true}
  const runtimeReceipt=await checkRuntime({npmRoot,host:'claude-code',disableEmbedding:true,receiptDirectory:join(root,'runtime')})
  const mutations=()=>native.commands.filter(args=>args[1]==='install'||args[1]==='uninstall'||(args[1]==='marketplace'&&['add','remove'].includes(args[2])))
  return {root,npmRoot,userRoot,receiptDirectory,exe,exeBytes,put,target,native,adapter,make,options,runtimeReceipt,mutations,foreignMarket,foreignPlugin,foreignSettings,settingsFile,overlay}
}

async function treeSnapshot(root) {
  const result={}
  for(const name of (await readdir(root,{recursive:true})).sort()) {
    const file=join(root,name)
    result[name]=(await lstat(file)).isDirectory()?null:createHash('sha256').update(await readFile(file)).digest('hex')
  }
  return result
}

test('declared library Git rejects missing or failed Git receipts before Claude registration with embedding disabled',async t=>{
  for(const kind of ['missing','failed'])await t.test(kind,async t=>{
    const f=await fixture(t),path=join(f.npmRoot,'package.json'),manifest=JSON.parse(await readFile(path,'utf8'))
    manifest['x-design-release-review'].nativeGit='shared-core-library'
    await f.put(path,encode(manifest))
    await stageNativeInventoryFixture(join(f.npmRoot,'payload/shared'))
    const supplied=await checkRuntime({npmRoot:f.npmRoot,host:'claude-code',disableEmbedding:true,receiptDirectory:join(f.root,'git-check')})
    assert.equal(supplied.git.status,'failed')
    if(kind==='missing')delete supplied.git
    const plan=await planClaudeInstallation(f.options),settings=await readFile(f.settingsFile)
    await assert.rejects(applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:supplied}),/Required (Git receipt missing|library Git check did not pass)/)
    assert.equal(f.mutations().length,0);assert.deepEqual(await readFile(f.settingsFile),settings)
    await assert.rejects(lstat(f.target),{code:'ENOENT'})
    await assert.rejects(lstat(join(f.receiptDirectory,'claude-install.lock')),{code:'ENOENT'})
  })
})

test('Claude user install, repeat and uninstall preserve foreign state and retained npm',async t=>{
  const f=await fixture(t),project=join(f.userRoot,'project/data.json')
  await f.put(project,'user data\n')
  const plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  assert.equal(receipt.phase,'verified');assert.equal(receipt.releaseValidated,false)
  assert.equal(receipt.plan.protocol.nativeCwd,f.npmRoot)
  const launcher=await readFile(join(f.target,'plugins/yugoo-design/scripts/design.mjs'),'utf8')
  assert.ok(launcher.includes('/retained%20npm/payload/shared/scripts/design.mjs'))
  const before=f.mutations().length
  const repeat=await planClaudeInstallation(f.options)
  assert.equal((await applyClaudeInstallation(repeat,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})).idempotent,true)
  assert.equal(f.mutations().length,before)
  const result=await recoverClaudeInstallation(receipt,{adapter:await f.make(),uninstall:true})
  assert.equal(result.phase,'rolled-back')
  assert.deepEqual(f.native.markets,[f.foreignMarket]);assert.deepEqual(f.native.plugins,[f.foreignPlugin])
  assert.deepEqual(JSON.parse(await readFile(f.settingsFile)),f.foreignSettings)
  assert.equal(await readFile(project,'utf8'),'user data\n')
  assert.ok(await readFile(join(f.npmRoot,'package.json')))
  await assert.rejects(readdir(f.target),{code:'ENOENT'})
  const orphan=join(receipt.plan.paths.config,'plugins/cache',MARKET,'yugoo-design','1.0.0','.orphaned_at')
  assert.equal(await readFile(orphan,'utf8'),'fixture orphan\n')
})

test('Claude observed install failure compensates and a reconstructed adapter reads persisted recovery',async t=>{
  const f=await fixture(t),plan=await planClaudeInstallation(f.options)
  let failed
  await assert.rejects(applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt,
    checkpoint:async phase=>{if(phase==='verified')throw Error('controlled post-install failure')}}),error=>{failed=error.receipt;return /controlled/.test(error.message)})
  assert.equal(failed.phase,'rolled-back')
  const persisted=JSON.parse(await readFile(failed.receiptFile))
  assert.equal((await recoverClaudeInstallation(persisted,{adapter:await f.make()})).phase,'rolled-back')
  assert.deepEqual(f.native.markets,[f.foreignMarket]);assert.deepEqual(f.native.plugins,[f.foreignPlugin])
})

test('Claude scoped declaration removal retains source when the known marketplace row remains',async t=>{
  const f=await fixture(t,{retainKnownMarketplace:true}),plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const source=await treeSnapshot(f.target),npm=await treeSnapshot(f.npmRoot),markets=structuredClone(f.native.markets)
  assert.ok(JSON.parse(await readFile(f.settingsFile)).extraKnownMarketplaces[MARKET])
  const before=f.mutations().length
  await assert.rejects(recoverClaudeInstallation(receipt,{adapter:f.adapter,uninstall:true}),/Claude marketplace removal not observed/)
  const persisted=JSON.parse(await readFile(receipt.receiptFile))
  assert.equal(persisted.phase,'market-remove-intent');assert.equal(persisted.rollbackCompleted,false)
  assert.equal(JSON.parse(await readFile(f.settingsFile)).extraKnownMarketplaces?.[MARKET],undefined)
  assert.deepEqual(f.native.markets,markets);assert.deepEqual(f.native.plugins,[f.foreignPlugin])
  assert.deepEqual(await treeSnapshot(f.target),source);assert.deepEqual(await treeSnapshot(f.npmRoot),npm)
  assert.deepEqual(f.mutations().slice(before),[
    ['plugin','uninstall',SELECTOR,'--scope','user','--keep-data'],
    ['plugin','marketplace','remove',MARKET,'--scope','user'],
  ])
})

test('Claude fresh recovery of market-remove-intent does not repeat plugin uninstall or delete retained source',async t=>{
  const f=await fixture(t,{retainKnownMarketplace:true}),plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  await assert.rejects(recoverClaudeInstallation(receipt,{adapter:f.adapter,uninstall:true}),/Claude marketplace removal not observed/)
  const persisted=JSON.parse(await readFile(receipt.receiptFile)),source=await treeSnapshot(f.target),npm=await treeSnapshot(f.npmRoot)
  const before=f.mutations().length,fresh=await f.make()
  assert.notEqual(fresh,f.adapter)
  await assert.rejects(recoverClaudeInstallation(persisted,{adapter:fresh}),/Claude marketplace removal not observed/)
  assert.deepEqual(f.mutations().slice(before),[['plugin','marketplace','remove',MARKET,'--scope','user']])
  assert.equal(f.native.commands.filter(args=>args[1]==='uninstall').length,1)
  assert.deepEqual(JSON.parse(await readFile(receipt.receiptFile)),persisted)
  assert.ok(f.native.markets.some(row=>row.name===MARKET));assert.deepEqual(f.native.plugins,[f.foreignPlugin])
  assert.deepEqual(await treeSnapshot(f.target),source);assert.deepEqual(await treeSnapshot(f.npmRoot),npm)
})

test('Claude scoped removal keeps exact transport context and foreign project/local declarations',async t=>{
  const f=await fixture(t,{retainKnownMarketplace:true}),project=join(f.root,'workspace')
  f.foreignSettings.extraKnownMarketplaces={'other-market':{source:{source:'directory',path:f.foreignMarket.path}}}
  await f.put(f.settingsFile,encode(f.foreignSettings))
  const foreignFiles=[join(f.userRoot,'.claude/settings.local.json'),
    join(project,'.claude/settings.json'),join(project,'.claude/settings.local.json')]
  for(const [index,file] of foreignFiles.entries())await f.put(file,encode({extraKnownMarketplaces:{
    [MARKET]:{source:{source:'directory',path:join(f.root,'foreign-scope-'+index)}}},foreignScope:index}))
  const foreignBytes=await Promise.all(foreignFiles.map(file=>readFile(file)))
  const plan=await planClaudeInstallation(f.options),receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  await assert.rejects(recoverClaudeInstallation(receipt,{adapter:f.adapter,uninstall:true}),/Claude marketplace removal not observed/)
  assert.deepEqual(await Promise.all(foreignFiles.map(file=>readFile(file))),foreignBytes)
  assert.deepEqual(JSON.parse(await readFile(f.settingsFile)),f.foreignSettings)
  const removals=f.native.calls.filter(call=>call.args[1]==='marketplace'&&call.args[2]==='remove')
  assert.equal(removals.length,1)
  assert.deepEqual(removals[0].args,['plugin','marketplace','remove',MARKET,'--scope','user'])
  for(const call of f.native.calls) {
    assert.equal(call.cwd,f.npmRoot)
    assert.deepEqual(call.env,{HOME:f.userRoot,CLAUDE_CONFIG_DIR:join(f.userRoot,'.claude'),
      PATH:dirname(process.execPath)+':/usr/bin:/bin',XDG_CONFIG_HOME:join(f.userRoot,'.config'),
      XDG_CACHE_HOME:join(f.userRoot,'.cache'),XDG_DATA_HOME:join(f.userRoot,'.local/share'),
      TMPDIR:join(f.userRoot,'.claude/tmp'),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',
      DISABLE_AUTOUPDATER:'1',NODE_OPTIONS:'',NODE_PATH:''})
    assert.equal(call.timeout,30000);assert.equal(call.maxBuffer,1048576)
  }
  // The retained npm working directory avoids the HOME/project alias. These
  // declaration files are byte sentinels, not a native scope resolver.
  assert.notEqual(join(removals[0].cwd,'.claude/settings.json'),f.settingsFile)
})

test('Claude recovery refuses foreign marketplace users and edited or foreign-scope ownership',async t=>{
  const f=await fixture(t),plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const before=f.mutations().length
  f.native.plugins.push({id:'foreign@'+MARKET,scope:'project',version:'9'})
  await assert.rejects(recoverClaudeInstallation(receipt,{adapter:f.adapter,uninstall:true}),/Foreign plugin shares/)
  assert.equal(f.mutations().length,before)
  f.native.plugins.pop();f.native.plugins.find(row=>row.id===SELECTOR).scope='project'
  await assert.rejects(recoverClaudeInstallation(receipt,{adapter:f.adapter,uninstall:true}),/Foreign plugin scope/)
  assert.equal(f.mutations().length,before)
})

test('Claude plan, disabled runtime and executable drift reject before further native mutation',async t=>{
  const f=await fixture(t),plan=await planClaudeInstallation(f.options)
  await assert.rejects(applyClaudeInstallation({...plan,extra:true},{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt}),/digest mismatch/)
  await assert.rejects(applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:{...f.runtimeReceipt,identitySha256:'changed'}}),/identity drift/)
  await assert.rejects(readdir(f.receiptDirectory),{code:'ENOENT'})
  assert.equal(f.mutations().length,0)
  await writeFile(f.exe,'changed before apply')
  await assert.rejects(applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt}),/executable changed/)
  assert.equal(f.mutations().length,0)
  await writeFile(f.exe,f.exeBytes)
  f.native.after=async args=>{if(args[1]==='marketplace'&&args[2]==='add')await writeFile(f.exe,'changed between native commands')}
  let failed
  await assert.rejects(applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt}),error=>{failed=error.receipt;return /executable changed/.test(error.message)})
  assert.equal(failed.phase,'recovery-required');assert.equal(f.mutations().length,1)
  assert.equal(f.native.commands.some(args=>args[1]==='install'),false)
  await writeFile(f.exe,f.exeBytes);f.native.after=async()=>{}
  const persisted=JSON.parse(await readFile(failed.receiptFile))
  assert.equal((await recoverClaudeInstallation(persisted,{adapter:await f.make()})).phase,'rolled-back')
  assert.deepEqual(f.native.markets,[f.foreignMarket])
})

test('public Claude help and invalid cross-host arguments never construct a native adapter',async()=>{
  let calls=0
  const options={npmRoot:'/missing/npm',userRoot:'/missing/profile',claudeAdapterFactory:async()=>{calls++;assert.fail('Unexpected native factory')}}
  assert.equal((await installerMain(['install','--help','--host','claude-code'],options)).kind,'installer-help')
  for(const args of [
    ['install','--dry-run','--host','codex','--claude-executable','/missing/claude'],
    ['install','--dry-run','--host','claude-code','--codex-executable','/missing/codex'],
    ['install','--dry-run','--host','claude-code','--claude-executable','/missing/claude','--unknown'],
    ['install','--dry-run','--host','claude-code','--claude-executable','/missing/claude','--native-cwd','/missing/cwd'],
    ['install','--apply','--host','claude-code','--claude-executable','/missing/claude','--receipt-dir','/missing/receipt']
  ])await assert.rejects(installerMain(args,options))
  assert.equal(calls,0)
})

test('direct Claude CLI install persistently registers using the existing transaction',async t=>{
  const f=await fixture(t);let factoryOptions
  const result=await installerMain(['install','--host','claude-code','--claude-executable',f.exe,
    '--receipt-dir',f.receiptDirectory,'--disable-embedding'],{
    npmRoot:f.npmRoot,userRoot:f.userRoot,claudeAdapterFactory:async options=>{factoryOptions=options;return f.adapter},
  })
  assert.equal(result.phase,'verified');assert.equal(result.hostRegistered,true)
  assert.equal(result.installationScope,'user')
  assert.equal(factoryOptions.nativeCwd,f.npmRoot)
  assert.ok(f.native.plugins.some(p=>p.id===SELECTOR&&p.scope==='user'))
  assert.match(result.next,/No --plugin-dir argument is needed/)
})

test('Claude capability admission accepts other native versions and rejects missing interface before mutation',async t=>{
  const f=await fixture(t),calls=[]
  const run=async(_exe,args)=>{
    calls.push(args)
    return {stdout:args[0]==='--version'?'2.2.0 (Claude Code)':'--scope --json --keep-data'}
  }
  const native=await createClaudeNativeAdapter({executable:f.exe,userRoot:f.userRoot,nativeCwd:f.npmRoot,scope:'isolated-acceptance',run})
  assert.equal(native.identity.version,'2.2.0')
  assert.equal(calls.length,7)
  assert.ok(calls.every(a=>a.includes('--help')||a[0]==='--version'))
  await assert.rejects(createClaudeNativeAdapter({executable:f.exe,userRoot:f.userRoot,nativeCwd:f.npmRoot,scope:'isolated-acceptance',
    run:async(_exe,args)=>({stdout:args[0]==='--version'?'2.2.0 (Claude Code)':'unsupported'})}),/capability missing/)
})

test('Claude native working directory rejects missing, HOME, noncanonical and configured contexts before commands',async t=>{
  const f=await fixture(t),link=join(f.root,'npm-link'),project=join(f.root,'configured-project'),local=join(f.root,'configured-local')
  await symlink(f.npmRoot,link)
  await f.put(join(project,'.claude/settings.json'),'{}\n')
  await f.put(join(local,'.claude/settings.local.json'),'{}\n')
  const before=f.native.commands.length,settings=await readFile(f.settingsFile),npm=await treeSnapshot(f.npmRoot)
  for(const [nativeCwd,pattern] of [
    [undefined,/Explicit.*working directory/],[f.userRoot,/working directory.*HOME/],
    [f.exe,/working directory.*directory/],[join(f.root,'missing'),/ENOENT/],
    [f.npmRoot+'/.',/canonical.*working directory/],[link,/symlink/i],
    [project,/working directory.*configuration/],[local,/working directory.*configuration/],
  ])await assert.rejects(f.make({nativeCwd}),pattern)
  assert.equal(f.native.commands.length,before);assert.deepEqual(await readFile(f.settingsFile),settings)
  assert.deepEqual(await treeSnapshot(f.npmRoot),npm)
})

test('Claude native working directory allows plugin metadata and remains read-only with ancestor HOME configuration',async t=>{
  const f=await fixture(t),cwd=join(f.userRoot,'retained-npm')
  await f.put(join(cwd,'.claude-plugin/marketplace.json'),'{}\n')
  const home=await treeSnapshot(f.userRoot),npm=await treeSnapshot(f.npmRoot)
  const adapter=await f.make({nativeCwd:cwd}),plan=await planClaudeInstallation({...f.options,adapter})
  assert.equal(adapter.identity.nativeCwd,cwd);assert.equal(plan.protocol.nativeCwd,cwd)
  assert.deepEqual(await treeSnapshot(f.userRoot),home);assert.deepEqual(await treeSnapshot(f.npmRoot),npm)
  assert.equal(f.mutations().length,0)
  await assert.rejects(lstat(f.target),{code:'ENOENT'})
  await assert.rejects(lstat(f.receiptDirectory),{code:'ENOENT'})
})

test('Claude native working directory fences directory replacement and direct configuration drift',async t=>{
  for(const kind of ['replacement','settings','settings-symlink'])await t.test(kind,async t=>{
    const f=await fixture(t),cwd=join(f.root,'native-cwd');await mkdir(cwd)
    const adapter=await f.make({nativeCwd:cwd}),before=f.native.commands.length
    if(kind==='replacement'){await rename(cwd,cwd+'-retained');await mkdir(cwd)}
    else if(kind==='settings')await f.put(join(cwd,'.claude/settings.json'),'{}\n')
    else {await mkdir(join(cwd,'.claude'));await symlink(f.settingsFile,join(cwd,'.claude/settings.local.json'))}
    await assert.rejects(planClaudeInstallation({...f.options,adapter}),/working directory|symlink/i)
    assert.equal(f.native.commands.length,before);assert.equal(f.mutations().length,0)
  })
})

test('Claude native working directory is checked again after each native command',async t=>{
  const f=await fixture(t),cwd=join(f.root,'factory-cwd'),before=f.native.commands.length
  await mkdir(cwd)
  // In isolated-test-contract mode --version is the factory's last native call,
  // so only the post-command fence can reject this drift before it returns.
  f.native.after=async args=>{if(args[0]==='--version')await f.put(join(cwd,'.claude/settings.local.json'),'{}\n')}
  await assert.rejects(f.make({nativeCwd:cwd}),/working directory.*configuration/)
  assert.equal(f.native.commands.length,before+1);assert.equal(f.mutations().length,0)
  await assert.rejects(lstat(f.target),{code:'ENOENT'})
  await assert.rejects(lstat(f.receiptDirectory),{code:'ENOENT'})
})

test('Claude persisted protocol strictly rejects another native working directory before recovery',async t=>{
  const f=await fixture(t),plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const source=await treeSnapshot(f.target),bytes=await readFile(receipt.receiptFile),cwd=join(f.root,'other-native-cwd')
  await mkdir(cwd);const adapter=await f.make({nativeCwd:cwd}),before=f.mutations().length
  await assert.rejects(recoverClaudeInstallation(receipt,{adapter}),/protocol|nativeCwd/)
  await assert.rejects(planClaudeInstallation({...f.options,adapter}),/Previous Claude protocol changed/)
  await assert.rejects(applyClaudeInstallation(plan,{adapter,runtimeReceipt:f.runtimeReceipt}),/Previous Claude protocol changed/)
  assert.equal(f.mutations().length,before);assert.deepEqual(await readFile(receipt.receiptFile),bytes)
  assert.deepEqual(await treeSnapshot(f.target),source)
})

test('Claude old protocol without nativeCwd is rejected without rewriting its receipt or plan',async t=>{
  const f=await fixture(t),plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const old=structuredClone(receipt);delete old.plan.protocol.nativeCwd
  const {planSha256,...body}=old.plan
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
  old.plan.planSha256=createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex')
  const bytes=encode(old);await f.put(receipt.receiptFile,bytes)
  const source=await treeSnapshot(f.target),npm=await treeSnapshot(f.npmRoot),before=f.mutations().length
  for(const uninstall of [false,true])await assert.rejects(recoverClaudeInstallation(old,{adapter:f.adapter,uninstall}),/nativeCwd.*retained installed implementation/)
  await assert.rejects(applyClaudeInstallation(old.plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt}),/nativeCwd.*retained installed implementation/)
  await assert.rejects(planClaudeInstallation(f.options),/nativeCwd.*retained installed implementation/)
  assert.equal(f.mutations().length,before);assert.equal(await readFile(receipt.receiptFile,'utf8'),bytes)
  assert.deepEqual(await treeSnapshot(f.target),source);assert.deepEqual(await treeSnapshot(f.npmRoot),npm)
})


test('independent Claude recovery processes cannot remove an active recovery lease', {timeout:15000}, async t=>{
  const f=await fixture(t),plan=await planClaudeInstallation(f.options)
  const receipt=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const stateFile=join(f.root,'native-state.json'),worker=join(f.root,'recovery-worker.mjs')
  await f.put(stateFile,encode({markets:f.native.markets,plugins:f.native.plugins}))
  // Simulate the original transaction exiting with its persisted receipt and lease.
  await f.put(join(f.receiptDirectory,'claude-install.lock'),encode({id:receipt.id,pid:2147483647}))
  const moduleURL=new URL('../src/npm-installer-claude.mjs',import.meta.url).href
  const workerSource=`import { readFile,writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createClaudeNativeAdapter,recoverClaudeInstallation } from ${JSON.stringify(moduleURL)}
const input=JSON.parse(process.argv[2]), receipt=JSON.parse(await readFile(input.receiptFile))
const run=async(_exe,args)=>{
  if(args[0]==='--version')return {stdout:'2.1.209 (Claude Code)'}
  const state=JSON.parse(await readFile(input.stateFile))
  if(args[1]==='list')return {stdout:JSON.stringify(state.plugins)}
  if(args[1]==='marketplace'&&args[2]==='list')return {stdout:JSON.stringify(state.markets)}
  if(args[1]==='uninstall') {
    process.send({event:'mutation'});await once(process,'message')
    state.plugins=state.plugins.filter(row=>row.id!==receipt.plan.selector)
    await writeFile(input.settingsFile,JSON.stringify(input.foreignSettings))
  } else if(args[1]==='marketplace'&&args[2]==='remove')state.markets=state.markets.filter(row=>row.name!=='yugoo-design-local')
  else throw Error('Unexpected recovery command')
  await writeFile(input.stateFile,JSON.stringify(state));return {stdout:''}
}
try {
  const adapter=await createClaudeNativeAdapter({executable:input.exe,userRoot:input.userRoot,nativeCwd:receipt.npmRoot,scope:'isolated-test-contract',run})
  const result=await recoverClaudeInstallation(receipt,{adapter})
  process.send({event:'done',phase:result.phase})
} catch(error) { process.send({event:'error',code:error.code,message:error.message}) }
process.disconnect()
`
  await f.put(worker,workerSource)
  const input=JSON.stringify({receiptFile:receipt.receiptFile,stateFile,settingsFile:f.settingsFile,foreignSettings:f.foreignSettings,exe:f.exe,userRoot:f.userRoot})
  const first=fork(worker,[input],{stdio:['ignore','pipe','pipe','ipc']}),firstExit=once(first,'exit')
  t.after(()=>{if(first.exitCode===null)first.kill('SIGKILL')})
  assert.deepEqual((await once(first,'message'))[0],{event:'mutation'})
  const second=fork(worker,[input],{stdio:['ignore','pipe','pipe','ipc']}),secondExit=once(second,'exit')
  t.after(()=>{if(second.exitCode===null)second.kill('SIGKILL')})
  const blocked=(await once(second,'message'))[0]
  assert.equal(blocked.event,'error');assert.equal(blocked.code,'EEXIST')
  await secondExit
  const lease=JSON.parse(await readFile(join(f.receiptDirectory,'claude-install.lock')))
  assert.equal(lease.pid,first.pid);assert.equal(lease.id,receipt.id)
  const completed=once(first,'message');first.send({continue:true})
  assert.deepEqual((await completed)[0],{event:'done',phase:'rolled-back'});await firstExit
  assert.deepEqual(JSON.parse(await readFile(stateFile)),{markets:[f.foreignMarket],plugins:[f.foreignPlugin]})
})

async function legacyClaudeReceipt(t) {
  const f=await fixture(t),planned=await planClaudeInstallation(f.options)
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
  const digest=value=>hash(JSON.stringify(canonical(value)))
  async function inventory(root) {
    const result={}
    async function walk(dir) {
      for(const name of (await readdir(dir)).sort()) {
        const file=join(dir,name),key=relative(root,file)
        if((await lstat(file)).isDirectory()){result[key]=null;await walk(file)}
        else result[key]=hash(await readFile(file))
      }
    }
    await walk(root);return result
  }
  await f.put(join(f.overlay,'.claude-plugin/plugin.json'),encode({name:'design-system',version:'1.0.0'}))
  await rename(join(f.overlay,'skills/yugoo'),join(f.overlay,'skills/design'))
  const {planSha256:unused,nodeRuntime:removedNodeSelection,...body}=planned
  const plan={...body,selector:'design-system@'+MARKET,paths:{...body.paths,plugin:join(f.target,'plugins/design-system')},
    packageInventorySha256:digest(await inventory(f.npmRoot)),overlayInventory:await inventory(f.overlay)}
  assert.equal(plan.nodeRuntime,undefined,'Legacy receipt predates explicit Node binding')
  plan.planSha256=digest(plan)
  const id='0c5f0ecb-131c-4a0e-a076-3590bfe6a941',receiptFile=join(f.receiptDirectory,id+'.claude-receipt.json')
  await mkdir(dirname(plan.paths.plugin),{recursive:true});await cp(f.overlay,plan.paths.plugin,{recursive:true})
  const owner={id,npmRoot:f.npmRoot,package:plan.package,userRoot:f.userRoot,receiptDirectory:f.receiptDirectory}
  await f.put(join(f.target,'.yugoo-claude-owner.json'),encode(owner))
  await f.put(plan.paths.marketplace,encode({name:MARKET,owner:{name:'yugoo-design'},plugins:[{name:'design-system',source:'./plugins/design-system'}]}))
  const cache=join(plan.paths.config,'plugins/cache',MARKET,'design-system','1.0.0')
  await mkdir(dirname(cache),{recursive:true});await cp(plan.paths.plugin,cache,{recursive:true})
  f.native.markets.push({name:MARKET,source:'directory',path:f.target,installLocation:f.target})
  f.native.plugins.push({id:plan.selector,scope:'user',version:'1.0.0',enabled:true,installPath:cache})
  await f.put(f.settingsFile,encode({...f.foreignSettings,enabledPlugins:{...f.foreignSettings.enabledPlugins,[plan.selector]:true}}))
  const receipt={schemaVersion:1,id,host:'claude-code',npmRoot:f.npmRoot,userRoot:f.userRoot,package:plan.package,plan,receiptFile,phase:'verified',
    sourceFiles:await inventory(f.target),cacheFiles:await inventory(cache),publicationCompleted:true,marketAttempted:true,installAttempted:true,rollbackCompleted:false}
  await f.put(receiptFile,encode(receipt))
  return {...f,receipt,cache}
}

test('legacy Claude recovery and uninstall retain old identity and preserve unrelated state',async t=>{
  for(const uninstall of [false,true])await t.test(uninstall?'uninstall':'recover',async t=>{
    const f=await legacyClaudeReceipt(t)
    const result=await recoverClaudeInstallation(f.receipt,{adapter:await f.make(),uninstall})
    assert.equal(result.phase,'rolled-back')
    assert.equal(result.plan.selector,'design-system@'+MARKET)
    assert.ok(f.native.commands.some(args=>args[1]==='uninstall'&&args[2]==='design-system@'+MARKET))
    assert.deepEqual(f.native.plugins,[f.foreignPlugin]);assert.deepEqual(f.native.markets,[f.foreignMarket])
    assert.deepEqual(JSON.parse(await readFile(f.settingsFile)),f.foreignSettings)
    assert.equal(await readFile(join(f.cache,'.orphaned_at'),'utf8'),'fixture orphan\n')
    assert.equal((await recoverClaudeInstallation(result,{adapter:await f.make(),uninstall})).phase,'rolled-back')
  })
})

test('legacy Claude owned cache edits are refused before native removal',async t=>{
  const f=await legacyClaudeReceipt(t),before=f.mutations().length
  await f.put(join(f.cache,'user-note'),'retain')
  await assert.rejects(recoverClaudeInstallation(f.receipt,{adapter:f.adapter,uninstall:true}),/cached overlay changed/)
  assert.equal(f.mutations().length,before)
  assert.equal(await readFile(join(f.cache,'user-note'),'utf8'),'retain')
})

test('Claude new install rejects legacy and mixed registrations before staging',async t=>{
  for(const mixed of [false,true])await t.test(mixed?'mixed':'legacy',async t=>{
    const f=await fixture(t)
    f.native.plugins.push({id:'design-system@old-market',scope:'user',version:'1.0.0',enabled:true})
    if(mixed)f.native.plugins.push({id:SELECTOR,scope:'user',version:'1.0.0',enabled:true})
    const before=structuredClone(f.native.plugins),settings=await readFile(f.settingsFile,'utf8')
    await assert.rejects(planClaudeInstallation(f.options),/Legacy design-system plugin.*original receipt/)
    assert.deepEqual(f.native.plugins,before);assert.equal(await readFile(f.settingsFile,'utf8'),settings)
    assert.equal(f.mutations().length,0)
    await assert.rejects(lstat(f.target),{code:'ENOENT'})
  })
})


test('Claude MCP and Hook bind the same verified Node while retained inputs stay unchanged',async t=>{
  const f=await fixture(t),mcpBefore=await readFile(join(f.overlay,'.mcp.json')),hooksBefore=await readFile(join(f.overlay,'hooks/hooks.json'))
  const plan=await planClaudeInstallation({...f.options,nodeExecutable:process.execPath})
  const result=await applyClaudeInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const plugin=join(f.target,'plugins/yugoo-design')
  const mcp=JSON.parse(await readFile(join(plugin,'.mcp.json'),'utf8')),hooks=JSON.parse(await readFile(join(plugin,'hooks/hooks.json'),'utf8'))
  assert.equal(mcp.mcpServers['design-system'].command,plan.nodeRuntime.executable)
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].command,plan.nodeRuntime.executable)
  assert.deepEqual(hooks.hooks.SessionStart[0].hooks[0].args,['${CLAUDE_PLUGIN_ROOT}/scripts/claude-context.mjs'])
  assert.deepEqual(await readFile(join(f.overlay,'.mcp.json')),mcpBefore);assert.deepEqual(await readFile(join(f.overlay,'hooks/hooks.json')),hooksBefore)
  await recoverClaudeInstallation(result,{adapter:f.adapter,uninstall:true})
})
