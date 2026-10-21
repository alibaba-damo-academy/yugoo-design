import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { INSTALL_HOSTS, planInstallation, applyInstallation, recoverInstallation, uninstallInstallation, installerMain } from '../src/npm-installer.mjs'
import { createIsolatedCodexCompensation, createIsolatedCodexInstallerAdapter, probeCodex, inspectCodexNativeProtocol, runPinnedCodexCommand, assertCodexAdmission } from '../src/npm-installer-codex.mjs'
import { checkRuntime, inspectRuntime } from '../src/npm-runtime-check.mjs'
import { createDshInstallerAdapter } from '../src/npm-installer-dsh.mjs'
import { stageNativeInventoryFixture } from '../../../scripts/test-fixtures/companion-native-inventory.mjs'

const json = value => JSON.stringify(value, null, 2)+'\n'
const exists = async path => { try { await readFile(path); return true } catch(e) { if(e.code==='ENOENT')return false;throw e } }
async function fixture(t,prefix='installer isolated ') {
  const root=await mkdtemp(join(await realpath(tmpdir()),prefix))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const npmRoot=join(root,'npm root with spaces'),userRoot=join(root,'home'),receiptDirectory=join(root,'receipts')
  async function put(path,value) { await mkdir(dirname(path),{recursive:true});await writeFile(path,value) }
  await mkdir(userRoot)
  await put(join(npmRoot,'package.json'),json({name:'@fixture/design-system',version:'1.0.0','x-design-release-review':{fixture:true}}))
  await put(join(npmRoot,'payload/shared/scripts/design.mjs'),"console.log(JSON.stringify({entry:import.meta.url,args:process.argv.slice(2)}))\n")
  const overlay=join(npmRoot,'payload/overlays/codex')
  await put(join(overlay,'.codex-plugin/plugin.json'),json({name:'yugoo-design',version:'1.0.0',skills:'./skills/',mcpServers:'./.mcp.json'}))
  await put(join(overlay,'.mcp.json'),json({mcpServers:{'design-system':{command:'node',args:['scripts/design.mjs','mcp'],cwd:'.'}}}))
  await put(join(overlay,'scripts/design.mjs'),'// source launcher\n')
  await put(join(overlay,'skills/yugoo/SKILL.md'),'Fixture method\n')
  await put(join(overlay,'skills/design-panel/SKILL.md'),'Fixture panel method\n')
  await put(join(overlay,'skills/design-panel/native-execution.md'),'Fixture native contract\n')
  // Default-local fixture evidence comes from the existing checker's explicitly
  // isolated runner. It is never production native-load proof.
  await put(join(npmRoot,'payload/shared/knowledge/runtime.mjs'),'// fixture runtime\n')
  const label=`${process.platform==='linux'&&!process.report.getReport().header.glibcVersionRuntime?'linuxmusl':process.platform}-${process.arch}`
  const sharp=join(npmRoot,'node_modules/sharp'),runtimeAddon=join(npmRoot,`node_modules/@img/sharp-${label}`)
  const runtimeNative=join(runtimeAddon,'lib',`sharp-${label}.node`)
  await put(join(sharp,'package.json'),json({name:'sharp',version:'1.0.0',main:'index.js',optionalDependencies:{[`@img/sharp-${label}`]:'1.0.0'}}))
  await put(join(sharp,'index.js'),'module.exports={versions:{fixture:true}}\n')
  await put(join(runtimeAddon,'package.json'),json({name:`@img/sharp-${label}`,version:'1.0.0'}))
  await put(runtimeNative,'fixture binary, never loaded')
  const runtimeReceipt=await checkRuntime({npmRoot,receiptDirectory:join(root,'runtime receipts'),scope:'isolated-test-contract',
    testRunner:async()=>({stdout:JSON.stringify({node:process.versions.node,execPath:process.execPath,native:[runtimeNative],versions:{fixture:true}}),stderr:''})})
  assert.equal(runtimeReceipt.status,'load-verified')
  const native=join(userRoot,'native-state.json')
  const adapter={scope:'isolated-test-contract',nativeCompensationVerified:true,
    probe:async()=>({fixture:true,available:true,nativeCompensationVerified:true}),
    register:async plan=>put(native,json({selector:plan.selector})),
    readback:async()=>exists(native),compensate:async()=>rm(native,{force:true})}
  const options={npmRoot,userRoot,receiptDirectory,host:'codex',adapter}
  const marketplace=join(userRoot,'.agents/plugins/marketplace.json')
  return {root,npmRoot,userRoot,receiptDirectory,overlay,native,adapter,options,marketplace,put,runtimeReceipt,runtimeNative,runtimeAddon,sharp}
}

test('all explicit host plans stay pending and dry-run writes only an external plan',async t=>{
  const f=await fixture(t),before=await readFile(join(f.npmRoot,'package.json'))
  for(const host of INSTALL_HOSTS) {
    const plan=await planInstallation({...f.options,host})
    for(const key of ['hostRegistered','mcpReady','bundleCycleVerified','panelVerified','graVerified','kagVerified','releaseValidated','applySupported'])assert.equal(plan[key],false)
  }
  await assert.rejects(planInstallation({...f.options,host:undefined}),/explicit supported host/)
  const plan=await installerMain(['install','--dry-run','--host','codex','--receipt-dir',f.receiptDirectory],f.options)
  assert.equal(JSON.parse(await readFile(plan.planFile)).planSha256,plan.planSha256)
  assert.equal(await exists(f.marketplace),false)
  assert.deepEqual(await readFile(join(f.npmRoot,'package.json')),before)
  await assert.rejects(installerMain(['install','--apply'],f.options),/plan-only/)
  await assert.rejects(installerMain(['uninstall','--host','codex'],f.options),/verified native protocol adapter/)
  // The CLI response wrapper includes planFile; only the saved body is admissible.
  await assert.rejects(applyInstallation(plan),/Plan body digest mismatch/)
  await assert.rejects(applyInstallation(JSON.parse(await readFile(plan.planFile))),/plan-only/)
})

test('public installer help returns JSON usage without configuration or registration writes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'design-installer-help-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const options={npmRoot:join(root,'missing-package'),userRoot:join(root,'missing-profile')}
  for(const args of [['--help'],['-h'],['install','--help','--apply','--host','codex',
    '--codex-executable',join(root,'must-not-run'),'--user-root',options.userRoot],['check-runtime','--help']]) {
    const result=await installerMain(args,options)
    assert.equal(result.kind,'installer-help')
    assert.equal(result.status,'not-applicable') // The existing public bin treats this as exit 0.
    assert.equal(JSON.parse(JSON.stringify(result)).usage,'design-system <command> [options]')
    assert.deepEqual(Object.keys(result.commands),['prepare-desktop','install','plugin-directory','check-runtime','recover','uninstall'])
    assert.ok(result.options['--help, -h'])
  }
  assert.deepEqual(await readdir(root),[])
})

test('CLI help and remove availability never enable native compensation',async()=>{
  const calls=[]
  const result=await probeCodex({run:async(command,args)=>{calls.push({command,args});return {stdout:args[0]==='--version'?'codex-cli 0.159.0\n':'--json\n'}}})
  assert.equal(result.available,true);assert.equal(result.removeJson,true)
  assert.equal(result.nativeCompensationVerified,false);assert.equal(result.applySupported,false)
  assert.ok(calls.every(c=>c.args.includes('--help')||c.args[0]==='--version'))
})

test('public CLI bridge applies a saved plan and recovers with a reconstructed adapter',async t=>{
  const f=await fixture(t,'dsh-codex-native-'),selector='yugoo-design@personal'
  const source=join(f.userRoot,'.local/share/design-system/registrations/codex')
  const config=join(f.userRoot,'.codex/config.toml')
  const cache=join(f.userRoot,'.codex/plugins/cache/personal/yugoo-design/1.0.0')
  const run=Object.assign(async args=>{
    if(args[1]==='add') {
      await mkdir(dirname(cache),{recursive:true});await cp(source,cache,{recursive:true})
      await f.put(config,`[plugins.${JSON.stringify(selector)}]\nenabled = true\n`)
      return {stdout:'{}'}
    }
    if(args[1]==='remove') {
      await rm(cache,{recursive:true});await f.put(config,'');return {stdout:'{}'}
    }
    const installed=await exists(config)&&(await readFile(config,'utf8')).includes(selector)
    return {stdout:json({available:[],installed:installed?[{pluginId:selector,version:'1.0.0',installed:true,enabled:true,source:{source:'local',path:source}}]:[]})}
  },{scope:'bwrap-isolated-native-test',userRoot:f.userRoot})
  const make=()=>createIsolatedCodexInstallerAdapter({isolationRoot:f.root,userRoot:f.userRoot,run})
  const adapter=await make(),options={...f.options,adapter}
  const plan=await installerMain(['install','--dry-run','--host','codex','--receipt-dir',f.receiptDirectory],options)
  assert.equal(plan.applySupported,true);assert.equal(plan.registrationPending,true);assert.equal(plan.blockedReason,null)
  for(const key of ['hostRegistered','mcpReady','bundleCycleVerified','panelVerified','graVerified','kagVerified','releaseValidated'])assert.equal(plan[key],false)
  const runtimePath=join(f.receiptDirectory,'runtime.json');await f.put(runtimePath,json(f.runtimeReceipt))
  const receipt=await installerMain(['install','--apply','--host','codex','--plan',plan.planFile,'--runtime-receipt',runtimePath],options)
  assert.equal(receipt.phase,'verified');assert.equal(receipt.scope,'codex-native-transaction')
  assert.equal(receipt.releaseValidated,false)
  const repeatPlan=await planInstallation(options)
  const repeat=await applyInstallation(repeatPlan,{adapter,runtimeReceipt:f.runtimeReceipt})
  assert.equal(repeat.idempotent,true);assert.equal(repeat.scope,receipt.scope)
  assert.equal(repeat.releaseValidated,false)
  const restarted=await make()
  const recovered=await installerMain(['recover','--host','codex','--receipt',receipt.receiptPath],{...options,adapter:restarted})
  assert.equal(recovered.rollbackCompleted,true)
  assert.equal(await exists(join(source,'.codex-plugin/plugin.json')),false)
  assert.equal(await exists(join(cache,'.codex-plugin/plugin.json')),false)
  const oldNative=await readFile(join(f.receiptDirectory,receipt.id+'.native.json'),'utf8')
  const next=await installerMain(['install','--apply','--host','codex','--plan',plan.planFile,'--runtime-receipt',runtimePath],{...options,adapter:restarted})
  assert.notEqual(next.id,receipt.id)
  assert.equal(await readFile(join(f.receiptDirectory,receipt.id+'.native.json'),'utf8'),oldNative)
  assert.equal(JSON.parse(await readFile(join(f.receiptDirectory,next.id+'.native.json'),'utf8')).journalIdentity.transactionId,next.id)
  await installerMain(['recover','--host','codex','--receipt',next.receiptPath],{...options,adapter:await make()})
})

async function uninstallFixture(t) {
  const f=await fixture(t,'dsh-codex-native-'),selector='yugoo-design@personal'
  const source=join(f.userRoot,'.local/share/design-system/registrations/codex')
  const config=join(f.userRoot,'.codex/config.toml'),cache=join(f.userRoot,'.codex/plugins/cache/personal/yugoo-design/1.0.0')
  const foreignCache=join(f.userRoot,'.codex/plugins/cache/personal/foreign/9.0.0/keep')
  const project=join(f.userRoot,'Design Projects/example/answer.json')
  await f.put(config,'# user settings\nmodel = "preserved"\n')
  await f.put(foreignCache,'foreign cache');await f.put(project,'project answer')
  await f.put(f.marketplace,json({name:'personal',plugins:[{name:'foreign'}],keep:true}))
  let removes=0
  const owned=`[plugins.${JSON.stringify(selector)}]\nenabled = true\n`
  const run=Object.assign(async args=>{
    if(args[1]==='add') {
      await mkdir(dirname(cache),{recursive:true});await cp(source,cache,{recursive:true})
      await f.put(config,(await readFile(config,'utf8'))+owned);return {stdout:'{}'}
    }
    if(args[1]==='remove') {
      removes++;await rm(cache,{recursive:true});await f.put(config,(await readFile(config,'utf8')).replace(owned,''));return {stdout:'{}'}
    }
    const installed=(await readFile(config,'utf8')).includes(selector)
    return {stdout:json({available:[],installed:installed?[{pluginId:selector,version:'1.0.0',installed:true,enabled:true,source:{source:'local',path:source}}]:[]})}
  },{scope:'bwrap-isolated-native-test',userRoot:f.userRoot})
  const make=()=>createIsolatedCodexInstallerAdapter({isolationRoot:f.root,userRoot:f.userRoot,run})
  const adapter=await make(),options={...f.options,adapter}
  const receipt=await applyInstallation(await planInstallation(options),{adapter,runtimeReceipt:f.runtimeReceipt})
  return {...f,source,config,cache,foreignCache,project,make,adapter,options,receipt,removes:()=>removes}
}

test('uninstall removes only the successful owned installation and repeats through a fresh adapter',async t=>{
  const f=await uninstallFixture(t)
  const npmBefore=await userSnapshot(f.npmRoot)
  const updated=(await readFile(f.config,'utf8')).replace('model = "preserved"','model = "new user setting"')
  await f.put(f.config,updated)
  const result=await installerMain(['uninstall','--host','codex','--receipt',f.receipt.receiptPath],f.options)
  assert.equal(result.phase,'rolled-back');assert.equal(result.uninstallCompleted,true)
  assert.deepEqual(JSON.parse(await readFile(result.receiptPath)),result)
  assert.equal(await readFile(f.config,'utf8'),'# user settings\nmodel = "new user setting"\n')
  assert.deepEqual(JSON.parse(await readFile(f.marketplace)),{name:'personal',plugins:[{name:'foreign'}],keep:true})
  assert.equal(await readFile(f.foreignCache,'utf8'),'foreign cache')
  assert.equal(await readFile(f.project,'utf8'),'project answer')
  assert.deepEqual(await userSnapshot(f.npmRoot),npmBefore)
  await assert.rejects(lstat(f.source),{code:'ENOENT'});await assert.rejects(lstat(f.cache),{code:'ENOENT'})
  const restarted=await f.make()
  assert.deepEqual(await installerMain(['uninstall','--host','codex','--receipt',result.receiptPath],{...f.options,adapter:restarted}),result)
  assert.deepEqual(await recoverInstallation(result,{adapter:restarted}),result)
  assert.equal(f.removes(),1)
})

test('uninstall refuses changed ownership, pending receipts and unadmitted adapters before removal',async t=>{
  for(const kind of ['registration','marketplace','cache','pending','forged','admission'])await t.test(kind,async t=>{
    const f=await uninstallFixture(t),receipt=structuredClone(f.receipt)
    if(kind==='registration')await f.put(join(f.source,'user-note'),'retain')
    if(kind==='marketplace') {
      const value=JSON.parse(await readFile(f.marketplace));value.plugins.find(p=>p.name==='yugoo-design').edited=true
      await f.put(f.marketplace,json(value))
    }
    if(kind==='cache')await f.put(join(f.cache,'user-note'),'retain')
    if(kind==='pending')receipt.phase='configured'
    if(kind==='forged')receipt.target=f.npmRoot
    const before=await userSnapshot(f.userRoot)
    const adapter=kind==='admission'?{...f.adapter}:f.adapter
    await assert.rejects(uninstallInstallation(receipt,{adapter}))
    assert.equal(f.removes(),0);assert.deepEqual(await userSnapshot(f.userRoot),before)
    assert.equal(await readFile(f.project,'utf8'),'project answer')
  })
})

test('uninstall repeat refuses reappearing target, marketplace, native selector or cache',async t=>{
  for(const kind of ['target','marketplace','native','cache'])await t.test(kind,async t=>{
    const f=await uninstallFixture(t),result=await uninstallInstallation(f.receipt,{adapter:f.adapter})
    if(kind==='target')await f.put(join(f.source,'foreign'),'retain')
    if(kind==='marketplace')await f.put(f.marketplace,json({name:'personal',plugins:[{name:'yugoo-design',source:{source:'local',path:'./foreign'}}]}))
    if(kind==='native')await f.put(f.config,(await readFile(f.config,'utf8'))+'[plugins."yugoo-design@personal"]\nenabled = true\n')
    if(kind==='cache')await f.put(join(f.cache,'foreign'),'retain')
    const before=await userSnapshot(f.userRoot)
    await assert.rejects(uninstallInstallation(result,{adapter:await f.make()}),/reappeared|Expected native source|required/i)
    assert.equal(f.removes(),1);assert.deepEqual(await userSnapshot(f.userRoot),before)
  })
})

test('public CLI refuses caller-forged native admission even with a compensation flag',async t=>{
  const f=await fixture(t)
  const adapter={...f.adapter,scope:'codex-native-transaction'}
  await assert.rejects(installerMain(['install','--apply','--host','codex'],{...f.options,adapter}),/verified native protocol adapter/)
  assert.equal(await exists(f.marketplace),false)
})

test('production fixture guard executes actual installer functions with simulated VM admission only',async t=>{
  const f=await fixture(t)
  const installerUrl=new URL('../src/npm-installer.mjs',import.meta.url).href
  // This child evaluates actual installer source. Only admission is simulated in
  // its test-only linker; no production WeakMap, native tuple or factory changes.
  const script=`
    import assert from 'node:assert/strict';
    import {readFile,writeFile,access} from 'node:fs/promises';
    import {join} from 'node:path';
    import {SourceTextModule,SyntheticModule} from 'node:vm';
    const options=${JSON.stringify({npmRoot:f.npmRoot,userRoot:f.userRoot,receiptDirectory:f.receiptDirectory,host:'codex'})};
    const runtime=${JSON.stringify(f.runtimeReceipt)};
    const admissions=new WeakMap();let calls=0;
    const adapter=()=>({scope:'codex-native-transaction',probe:async()=>({available:true,applySupported:true}),
      register:async()=>{calls++;throw Error('Unexpected simulated native mutation')},readback:async()=>false,compensate:async()=>{calls++}});
    const production=adapter(),isolated=adapter();admissions.set(production,'production');admissions.set(isolated,'isolated-acceptance');
    const admission=entry=>{assert.ok(admissions.has(entry),'simulated admission rejects forged adapter');return admissions.get(entry)};
    const module=new SourceTextModule(await readFile(new URL(${JSON.stringify(installerUrl)}),'utf8'),{identifier:${JSON.stringify(installerUrl)}});
    await module.link(async specifier=>{
      const namespace=specifier==='./npm-installer-codex.mjs'
        ? {codexAdapter:{scope:'codex-native-plan-only'},assertCodexAdmission:admission,createCodexNativeAdapter:async()=>{throw Error('Production factory is not used in simulation')}}
        : await import(specifier.startsWith('.')?new URL(specifier,${JSON.stringify(installerUrl)}).href:specifier);
      const keys=Object.keys(namespace);return new SyntheticModule(keys,function(){for(const key of keys)this.setExport(key,namespace[key])});
    });await module.evaluate();const {planInstallation,applyInstallation}=module.namespace;
    await assert.rejects(planInstallation({...options,adapter:production}),/rejects review-fixture/);
    const isolatedPlan=await planInstallation({...options,adapter:isolated});
    assert.equal(isolatedPlan.fixture,true);assert.equal(isolatedPlan.applySupported,true);
    const forged={...isolatedPlan,fixture:false};
    await assert.rejects(applyInstallation(forged,{adapter:production,runtimeReceipt:{...runtime,scope:'installed-runtime-readonly'}}),/Plan body digest mismatch/);
    await assert.rejects(applyInstallation(isolatedPlan,{adapter:production,runtimeReceipt:{...runtime,scope:'installed-runtime-readonly'}}),/rejects review-fixture/);
    await assert.rejects(planInstallation({...options,adapter:adapter()}),/rejects forged adapter/);
    const probeFlags={scope:'isolated-test-contract',nativeCompensationVerified:true,production:true,probe:async()=>({available:true,applySupported:true,production:true})};
    assert.equal((await planInstallation({...options,adapter:probeFlags})).applySupported,false);
    const packagePath=join(options.npmRoot,'package.json'),manifest=JSON.parse(await readFile(packagePath,'utf8'));
    delete manifest['x-design-release-review'];await writeFile(packagePath,JSON.stringify(manifest));
    const ordinary=await planInstallation({...options,adapter:production});
    assert.equal(ordinary.fixture,false);assert.equal(ordinary.applySupported,true);assert.equal(ordinary.hostRegistered,false);
    await assert.rejects(applyInstallation(ordinary,{adapter:production,runtimeReceipt:runtime}),/actual runtime-load receipt/);
    assert.equal(calls,0);
    for(const path of [join(options.userRoot,'.agents/plugins/marketplace.json'),join(options.userRoot,'.local/share/design-system/registrations/codex'),join(options.receiptDirectory,'codex-install.lock')])
      await assert.rejects(access(path),{code:'ENOENT'});
    console.log(JSON.stringify({scope:'simulated-admission-actual-installer-functions',productionEnabled:false,hostInstallationVerified:false}));
  `
  const result=await promisify(execFile)(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],{timeout:15000,maxBuffer:1024*1024})
  assert.deepEqual(JSON.parse(result.stdout),{scope:'simulated-admission-actual-installer-functions',productionEnabled:false,hostInstallationVerified:false})
})

test('fresh-process recovery reads actual pre-publication effects after an abrupt exit',async t=>{
  for(const phase of ['prepared','staged','published-before-journal','target-published','unknown-partial-stage'])await t.test(phase,async t=>{
    const f=await fixture(t),plan=await planInstallation(f.options)
    const moduleURL=new URL('../src/npm-installer.mjs',import.meta.url).href
    const child=`
      import {applyInstallation} from ${JSON.stringify(moduleURL)};
      import {mkdir,rename,writeFile} from 'node:fs/promises';
      import {dirname,join} from 'node:path';
      const plan=${JSON.stringify(plan)},runtimeReceipt=${JSON.stringify(f.runtimeReceipt)};
      const adapter={scope:'isolated-test-contract',nativeCompensationVerified:true,
        probe:async()=>({fixture:true,available:true,nativeCompensationVerified:true}),
        register:async()=>{throw Error('Must not reach native registration')},readback:async()=>false,compensate:async()=>{}};
      await applyInstallation(plan,{adapter,runtimeReceipt,checkpoint:async point=>{
        const chosen=${JSON.stringify(phase)};
        if(chosen==='published-before-journal'&&point==='staged') {
          const {readdir}=await import('node:fs/promises');
          const file=(await readdir(plan.receiptDirectory)).find(name=>name.endsWith('.receipt.json'));
          const {readFile}=await import('node:fs/promises');
          const receipt=JSON.parse(await readFile(join(plan.receiptDirectory,file),'utf8'));
          await mkdir(dirname(plan.target),{recursive:true});await rename(receipt.stage,plan.target);process.exit(91);
        }
        if(chosen==='unknown-partial-stage'&&point==='prepared') {
          const {readdir,readFile}=await import('node:fs/promises');
          const file=(await readdir(plan.receiptDirectory)).find(name=>name.endsWith('.receipt.json'));
          const receipt=JSON.parse(await readFile(join(plan.receiptDirectory,file),'utf8'));
          await mkdir(receipt.stage,{recursive:true});await writeFile(join(receipt.stage,'foreign'),'retain');process.exit(91);
        }
        if(point===chosen)process.exit(91);
      }});
    `
    const run=spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8',timeout:15000})
    assert.equal(run.status,91,run.stderr)
    const name=(await readdir(f.receiptDirectory)).find(name=>name.endsWith('.receipt.json'))
    const receipt=JSON.parse(await readFile(join(f.receiptDirectory,name),'utf8'))
    assert.notEqual(receipt.pid,process.pid)
    if(phase==='unknown-partial-stage') {
      await assert.rejects(recoverInstallation(receipt,{adapter:f.adapter}),/Cleanup inventory changed/)
      assert.equal(await readFile(join(receipt.stage,'foreign'),'utf8'),'retain')
      assert.equal((await lstat(receipt.lock)).isDirectory(),true)
    } else {
      const restored=await recoverInstallation(receipt,{adapter:f.adapter})
      assert.equal(restored.phase,'rolled-back');assert.equal(restored.rollbackCompleted,true)
      await assert.rejects(lstat(receipt.target),{code:'ENOENT'})
      await assert.rejects(lstat(receipt.stage),{code:'ENOENT'})
      await assert.rejects(lstat(receipt.lock),{code:'ENOENT'})
      assert.equal(await exists(f.marketplace),false)
      assert.equal((await recoverInstallation(restored,{adapter:f.adapter})).rollbackCompleted,true)
    }
  })
})

test('fresh-process native prepared journal re-observes partial effects and retains foreign cache',async t=>{
  for(const foreign of [false,true])await t.test(foreign?'foreign-cache-retained':'owned-effects-compensated',async t=>{
    const f=await fixture(t,'dsh-codex-native-'),selector='yugoo-design@personal'
    const source=join(f.userRoot,'.local/share/design-system/registrations/codex')
    const config=join(f.userRoot,'.codex/config.toml'),cache=join(f.userRoot,'.codex/plugins/cache/personal/yugoo-design/1.0.0')
    const driver=Object.assign(async args=>{
      assert.notEqual(args[1],'add','Parent recovery must not retry add')
      if(args[1]==='remove'){await rm(cache,{recursive:true});await f.put(config,'');return {stdout:'{}'}}
      const installed=await exists(config)&&(await readFile(config,'utf8')).includes(selector)
      return {stdout:json({available:[],installed:installed?[{pluginId:selector,version:'1.0.0',installed:true,enabled:true,source:{source:'local',path:source}}]:[]})}
    },{scope:'bwrap-isolated-native-test',userRoot:f.userRoot})
    const adapter=await createIsolatedCodexInstallerAdapter({isolationRoot:f.root,userRoot:f.userRoot,run:driver})
    const plan=await planInstallation({...f.options,adapter})
    const child=`
      import {applyInstallation} from ${JSON.stringify(new URL('../src/npm-installer.mjs',import.meta.url).href)};
      import {createIsolatedCodexInstallerAdapter} from ${JSON.stringify(new URL('../src/npm-installer-codex.mjs',import.meta.url).href)};
      import {mkdir,cp,writeFile} from 'node:fs/promises';import {dirname,join} from 'node:path';
      const plan=${JSON.stringify(plan)},config=${JSON.stringify(config)},cache=${JSON.stringify(cache)};
      const run=Object.assign(async args=>{
        if(args[1]==='add') {
          await mkdir(dirname(cache),{recursive:true});await cp(plan.target,cache,{recursive:true});
          await mkdir(dirname(config),{recursive:true});
          await writeFile(config,'[plugins.'+JSON.stringify(plan.selector)+']\\nenabled = true\\n');
          if(${JSON.stringify(foreign)})await writeFile(join(cache,'foreign'),'retain');
          process.exit(92);
        }
        return {stdout:JSON.stringify({installed:[],available:[]})};
      },{scope:'bwrap-isolated-native-test',userRoot:plan.userRoot});
      const adapter=await createIsolatedCodexInstallerAdapter({isolationRoot:${JSON.stringify(f.root)},userRoot:plan.userRoot,run});
      await applyInstallation(plan,{adapter,runtimeReceipt:${JSON.stringify(f.runtimeReceipt)}});
    `
    const run=spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8',timeout:15000})
    assert.equal(run.status,92,run.stderr)
    const name=(await readdir(f.receiptDirectory)).find(name=>name.endsWith('.receipt.json'))
    const receipt=JSON.parse(await readFile(join(f.receiptDirectory,name),'utf8'))
    assert.equal(receipt.nativeAttempted,true)
    const nativeReceipt=JSON.parse(await readFile(join(f.receiptDirectory,receipt.id+'.native.json'),'utf8'))
    assert.equal(nativeReceipt.phase,'prepared');assert.equal(Object.hasOwn(nativeReceipt,'observedCacheSha256'),false)
    if(foreign) {
      await assert.rejects(recoverInstallation(receipt,{adapter}),/Unknown or edited native cache file retained/)
      assert.equal(await readFile(join(cache,'foreign'),'utf8'),'retain')
      assert.match(await readFile(config,'utf8'),/enabled = true/)
      assert.equal((await lstat(source)).isDirectory(),true)
    } else {
      const recovered=await recoverInstallation(receipt,{adapter})
      assert.equal(recovered.rollbackCompleted,true)
      await assert.rejects(lstat(source),{code:'ENOENT'});await assert.rejects(lstat(cache),{code:'ENOENT'})
      assert.equal(await readFile(config,'utf8'),'')
    }
  })
})

test('manual recovery cannot race a live install owner or another recovery lease',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options)
  let protectedBytes
  const receipt=await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt,checkpoint:async phase=>{
    if(phase!=='configured')return
    const name=(await readdir(f.receiptDirectory)).find(name=>name.endsWith('.receipt.json'))
    const snapshot=JSON.parse(await readFile(join(f.receiptDirectory,name),'utf8'))
    protectedBytes=await readFile(f.marketplace)
    await assert.rejects(recoverInstallation(snapshot,{adapter:f.adapter}),/owner is still running/)
    assert.deepEqual(await readFile(f.marketplace),protectedBytes)
  }})
  const lock=join(f.receiptDirectory,receipt.id+'.recovery.lock');await mkdir(lock)
  await f.put(join(lock,'foreign'),'retain')
  await assert.rejects(recoverInstallation(receipt,{adapter:f.adapter}),{code:'EEXIST'})
  assert.equal(await readFile(join(lock,'foreign'),'utf8'),'retain')
  assert.deepEqual(await readFile(f.marketplace),protectedBytes)
})

test('caller plan mutation immediately after apply cannot redirect paths or protocol identities',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options),original=structuredClone(plan)
  const pending=applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const redirected=join(f.root,'redirected')
  for(const key of ['target','marketplace','receiptDirectory','overlay'])plan[key]=redirected
  plan.protocol.fixture=false;plan.package.version='forged'
  const receipt=await pending
  assert.equal(receipt.target,original.target);assert.equal(receipt.receiptDirectory,original.receiptDirectory)
  assert.deepEqual(receipt.protocol,original.protocol);assert.deepEqual(receipt.planSnapshot,original)
  await assert.rejects(lstat(redirected),{code:'ENOENT'})
  await recoverInstallation(receipt,{adapter:f.adapter})
})

test('caller recovery receipt mutation cannot redirect cleanup after invocation',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options)
  const receipt=await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const original=structuredClone(receipt),foreign=join(f.root,'foreign')
  await f.put(join(foreign,'keep'),'retain')
  const pending=recoverInstallation(receipt,{adapter:f.adapter})
  for(const key of ['target','stage','marketplace','receiptDirectory','receiptPath','lock'])receipt[key]=foreign
  receipt.protocol.fixture=false
  const recovered=await pending
  assert.equal(recovered.target,original.target);assert.equal(recovered.phase,'rolled-back')
  assert.equal(await readFile(join(foreign,'keep'),'utf8'),'retain')
  await assert.rejects(lstat(original.target),{code:'ENOENT'})
})

test('isolated transaction installs and executes the pinned shared entry; repeat is idempotent',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options)
  const receipt=await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  assert.equal(receipt.scope,'isolated-test-transaction');assert.equal(receipt.phase,'verified')
  assert.equal(receipt.releaseValidated,false);assert.equal(receipt.bundleCycleVerified,false)
  assert.equal(receipt.runtimeReadiness.status,'load-verified')
  assert.equal(receipt.runtimeReadiness.scope,'isolated-test-contract')
  assert.equal(receipt.runtimeReadiness.semanticKagVerified,false)
  const run=spawnSync(process.execPath,[join(receipt.target,'scripts/design.mjs'),'mcp'],{cwd:f.root,encoding:'utf8'})
  assert.equal(run.status,0,run.stderr)
  assert.match(JSON.parse(run.stdout).entry,/npm%20root%20with%20spaces\/payload\/shared/)
  const again=await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  assert.equal(again.idempotent,true)
  assert.deepEqual(again.runtimeReadiness,receipt.runtimeReadiness)
  await recoverInstallation(receipt,{adapter:f.adapter})
  assert.equal(await exists(f.marketplace),false);assert.equal(await exists(f.native),false)
  assert.equal(await exists(join(f.npmRoot,'package.json')),true)
})

test('stale configuration or package plans cannot publish a registration',async t=>{
  for(const change of ['configuration','package'])await t.test(change,async t=>{
    const f=await fixture(t),plan=await planInstallation(f.options)
    if(change==='configuration')await f.put(f.marketplace,json({name:'personal',plugins:[],userSetting:true}))
    else await f.put(join(f.npmRoot,'new-file'),'changed')
    await assert.rejects(applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt}),/Stale or modified plan/)
    assert.equal(await exists(f.native),false)
    await assert.rejects(readFile(join(plan.target,'.design-system-registration.json')),{code:'ENOENT'})
  })
})

test('foreign entries, duplicate entries, symlinks and unmanaged targets fail before mutation',async t=>{
  for(const kind of ['foreign','duplicate','symlink','target'])await t.test(kind,async t=>{
    const f=await fixture(t),plan=await planInstallation(f.options)
    if(kind==='foreign'||kind==='duplicate')await f.put(f.marketplace,json({name:'personal',plugins:Array.from({length:kind==='duplicate'?2:1},()=>({name:'yugoo-design',source:{source:'local',path:'./foreign'}}))}))
    if(kind==='symlink')await symlink(f.root,join(f.overlay,'bad-link'))
    if(kind==='target')await f.put(join(plan.target,'user-owned'),'keep')
    await assert.rejects(planInstallation(f.options),/Unmanaged|Duplicate|symlink/i)
    assert.equal(await exists(f.native),false)
  })
})

test('failure at each durable phase restores unrelated data and records compensation',async t=>{
  for(const phase of ['prepared','staged','target-published','configured','verified'])await t.test(phase,async t=>{
    const f=await fixture(t),foreign={name:'personal',plugins:[{name:'other',source:{source:'local',path:'./other'}}],userSetting:17}
    await f.put(f.marketplace,json(foreign));await f.put(join(f.userRoot,'project.txt'),'user project')
    const plan=await planInstallation(f.options)
    let error
    try { await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt,checkpoint:async current=>{if(current===phase)throw Error('injected '+phase)}}) } catch(e){error=e}
    assert.match(error?.message??'',/injected/)
    const receipt=JSON.parse(await readFile(error.receiptPath))
    assert.equal(receipt.phase,'rolled-back');assert.equal(receipt.rollbackCompleted,true)
    assert.deepEqual(JSON.parse(await readFile(f.marketplace)),foreign)
    assert.equal(await readFile(join(f.userRoot,'project.txt'),'utf8'),'user project')
    assert.equal(await exists(f.native),false)
    await assert.rejects(readFile(join(plan.target,'.design-system-registration.json')),{code:'ENOENT'})
  })
})

test('native partial failure preserves concurrent foreign edits during compensation',async t=>{
  const f=await fixture(t)
  const register=f.adapter.register
  f.adapter.register=async plan=>{
    await register(plan)
    const catalog=JSON.parse(await readFile(f.marketplace));catalog.userSetting='new';catalog.plugins.push({name:'concurrent-other'})
    await f.put(f.marketplace,json(catalog));throw Error('native partial failure')
  }
  let error
  try{await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})}catch(e){error=e}
  const receipt=JSON.parse(await readFile(error.receiptPath))
  assert.equal(receipt.rollbackCompleted,true)
  assert.deepEqual(JSON.parse(await readFile(f.marketplace)),{name:'personal',plugins:[{name:'concurrent-other'}],userSetting:'new'})
  assert.equal(await exists(f.native),false)
})

test('failed native compensation leaves a recoverable receipt and owned files intact',async t=>{
  const f=await fixture(t),register=f.adapter.register,compensate=f.adapter.compensate
  f.adapter.register=async plan=>{await register(plan);throw Error('native failure')}
  f.adapter.compensate=async()=>{throw Error('compensation unavailable')}
  let error
  try{await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})}catch(e){error=e}
  const receipt=JSON.parse(await readFile(error.receiptPath))
  assert.equal(receipt.phase,'recovery-required');assert.equal(await exists(f.native),true)
  assert.equal(await exists(join(receipt.target,'.design-system-registration.json')),true)
  f.adapter.compensate=compensate
  await recoverInstallation(receipt,{adapter:f.adapter})
  assert.equal(await exists(f.native),false);assert.equal(await exists(f.marketplace),false)
})

test('recovery refuses modified owned files or entries and forged target paths',async t=>{
  for(const kind of ['file','entry','path'])await t.test(kind,async t=>{
    const f=await fixture(t),receipt=await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
    if(kind==='file')await f.put(join(receipt.target,'scripts/design.mjs'),'user modified')
    if(kind==='entry'){const catalog=JSON.parse(await readFile(f.marketplace));catalog.plugins[0].userChange=true;await f.put(f.marketplace,json(catalog))}
    if(kind==='path')receipt.target=f.npmRoot
    await assert.rejects(recoverInstallation(receipt,{adapter:f.adapter}))
    assert.equal(await exists(f.native),true);assert.equal(await exists(join(f.npmRoot,'package.json')),true)
  })
})

test('an installed version cannot be silently upgraded through an unverified replacement',async t=>{
  const f=await fixture(t),receipt=await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  await f.put(join(f.npmRoot,'package.json'),json({name:'@fixture/design-system',version:'2.0.0'}))
  await f.put(join(f.overlay,'.codex-plugin/plugin.json'),json({name:'yugoo-design',version:'2.0.0',skills:'./skills/',mcpServers:'./.mcp.json'}))
  await assert.rejects(planInstallation(f.options),/Upgrade requires/)
  assert.equal(JSON.parse(await readFile(join(receipt.target,'.design-system-registration.json'))).version,'1.0.0')
})

test('a held transaction lock and a changed package during staging prevent publication',async t=>{
  for(const kind of ['lock','staging'])await t.test(kind,async t=>{
    const f=await fixture(t),plan=await planInstallation(f.options)
    if(kind==='lock')await mkdir(join(f.receiptDirectory,'codex-install.lock'),{recursive:true})
    await assert.rejects(applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt,checkpoint:async phase=>{
      if(kind==='staging'&&phase==='staged')await f.put(join(f.npmRoot,'late-change'),'changed')
    }}),kind==='lock'?{code:'EEXIST'}:/Inputs changed before publication/)
    assert.equal(await exists(f.marketplace),false);assert.equal(await exists(f.native),false)
    await assert.rejects(readFile(join(plan.target,'.design-system-registration.json')),{code:'ENOENT'})
  })
})

test('foreign stage and lease edits are retained and never reported as complete rollback',async t=>{
  for(const kind of ['stage-file','stage-directory','lock-file','replaced-lock'])await t.test(kind,async t=>{
    const f=await fixture(t),plan=await planInstallation(f.options)
    const lock=join(f.receiptDirectory,'codex-install.lock')
    let protectedPath,error
    try {
      await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt,checkpoint:async phase=>{
        if(kind.startsWith('stage-')&&phase==='staged') {
          // Read the durable record, not an invented matching receipt value.
          const {readdir}=await import('node:fs/promises')
          const name=(await readdir(f.receiptDirectory)).find(name=>name.endsWith('.receipt.json'))
          const receipt=JSON.parse(await readFile(join(f.receiptDirectory,name)))
          protectedPath=join(receipt.stage,'external-user-note')
          if(kind==='stage-directory')await mkdir(protectedPath);else await f.put(protectedPath,'external evidence')
          throw Error('stage checkpoint failure')
        }
        if(!kind.startsWith('stage-')&&phase==='prepared') {
          if(kind==='replaced-lock'){await rename(lock,lock+'.original');await mkdir(lock)}
          protectedPath=join(lock,'external-lease-evidence');await f.put(protectedPath,'external evidence')
          throw Error('lock checkpoint failure')
        }
      }})
    }catch(e){error=e}
    assert.match(error?.message??'',/checkpoint failure/)
    if(kind==='stage-directory')assert.equal((await lstat(protectedPath)).isDirectory(),true)
    else assert.equal(await readFile(protectedPath,'utf8'),'external evidence')
    const receipt=JSON.parse(await readFile(error.receiptPath))
    assert.equal(receipt.phase,'recovery-required');assert.equal(receipt.rollbackCompleted,false)
    assert.ok(receipt.cleanupConflicts.some(item=>item.path===(kind.startsWith('stage-')?receipt.stage:lock)))
    assert.equal(await exists(f.native),false);assert.equal(await exists(f.marketplace),false)
  })
})

async function userSnapshot(root) {
  const files={}
  async function walk(dir) {
    for(const name of (await readdir(dir)).sort()) {
      const path=join(dir,name),s=await lstat(path)
      if(s.isDirectory())await walk(path)
      else files[path]=await readFile(path,'utf8')
    }
  }
  await walk(root);return files
}

test('declared library Git rejects missing or failed Git receipts before Codex registration even with embedding disabled',async t=>{
  for(const kind of ['missing','failed'])await t.test(kind,async t=>{
    const f=await fixture(t)
    const path=join(f.npmRoot,'package.json'),manifest=JSON.parse(await readFile(path,'utf8'))
    manifest['x-design-release-review'].nativeGit='shared-core-library'
    await f.put(path,json(manifest))
    await stageNativeInventoryFixture(join(f.npmRoot,'payload/shared'))
    const supplied=await checkRuntime({npmRoot:f.npmRoot,disableEmbedding:true,receiptDirectory:join(f.root,'git-check')})
    assert.equal(supplied.git.status,'failed') // Inventory fixture cannot prove execution.
    if(kind==='missing')delete supplied.git
    const plan=await planInstallation({...f.options,disableEmbedding:true}),before=await userSnapshot(f.userRoot)
    let registered=0
    f.adapter.register=async()=>{registered++}
    await assert.rejects(applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:supplied}),/Required (Git receipt missing|library Git check did not pass)/)
    assert.equal(registered,0);assert.deepEqual(await userSnapshot(f.userRoot),before)
    await assert.rejects(lstat(plan.target),{code:'ENOENT'})
    await assert.rejects(lstat(join(f.receiptDirectory,'codex-install.lock')),{code:'ENOENT'})
  })
})

test('default-local first-install gate rejects missing/failed/timeout/presence evidence before any mutation',async t=>{
  for(const kind of ['missing-receipt','missing-addon','failed-load','timeout','presence-only'])await t.test(kind,async t=>{
    const f=await fixture(t)
    await f.put(f.marketplace,json({name:'personal',plugins:[{name:'foreign'}],keep:true}))
    let supplied=f.runtimeReceipt
    if(kind==='missing-receipt')supplied=undefined
    else if(kind==='missing-addon') {
      await rm(f.runtimeAddon,{recursive:true})
      supplied=await checkRuntime({npmRoot:f.npmRoot,receiptDirectory:join(f.root,'negative-check')})
      assert.equal(supplied.status,'missing')
    } else if(kind==='presence-only')supplied=await inspectRuntime({npmRoot:f.npmRoot})
    else supplied=await checkRuntime({npmRoot:f.npmRoot,receiptDirectory:join(f.root,'negative-check'),scope:'isolated-test-contract',
      testRunner:async()=>{throw Object.assign(Error(kind),{code:kind==='timeout'?null:1,signal:kind==='timeout'?'SIGKILL':null,killed:kind==='timeout'})}})
    const before=await userSnapshot(f.userRoot),plan=await planInstallation(f.options)
    let registered=0,compensated=0
    f.adapter.register=async()=>{registered++};f.adapter.compensate=async()=>{compensated++}
    await assert.rejects(applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:supplied}),/runtime/i)
    assert.deepEqual(await userSnapshot(f.userRoot),before)
    assert.equal(registered,0);assert.equal(compensated,0)
    await assert.rejects(lstat(join(f.receiptDirectory,'codex-install.lock')),{code:'ENOENT'})
    await assert.rejects(lstat(plan.target),{code:'ENOENT'})
  })
})

test('repeat readiness failures retain registration and all foreign configuration bytes',async t=>{
  const f=await fixture(t)
  await f.put(f.marketplace,json({name:'personal',plugins:[{name:'foreign'}],keep:true}))
  await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt})
  const before=await userSnapshot(f.userRoot)
  let registered=0,compensated=0,readbacks=0
  f.adapter.register=async()=>{registered++};f.adapter.compensate=async()=>{compensated++};f.adapter.readback=async()=>{readbacks++;return true}
  const failed={...f.runtimeReceipt,status:'failed',load:{status:'failed'}}
  for(const supplied of [undefined,failed]) {
    await assert.rejects(applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:supplied}),/runtime/i)
    assert.deepEqual(await userSnapshot(f.userRoot),before)
  }
  await rm(f.runtimeAddon,{recursive:true})
  const missing=await checkRuntime({npmRoot:f.npmRoot,receiptDirectory:join(f.root,'missing-repeat')})
  await assert.rejects(applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:missing}),/runtime/i)
  assert.deepEqual(await userSnapshot(f.userRoot),before)
  assert.equal(registered+compensated+readbacks,0)
})

test('runtime receipt root, Node, platform, pins, selection and load path must match the current plan',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options)
  const changes=[
    r=>{r.npmRoot=join(f.root,'other-root')},
    r=>{r.observation.execPath='/other/node'},
    r=>{r.observation.node='different'},
    r=>{r.observation.platform='different'},
    r=>{r.observation.libc='different'},
    r=>{r.pins[0].sha256='0'.repeat(64)},
    r=>{r.embedding.provider='disabled'},
    r=>{r.runtime.sha256='0'.repeat(64)},
    r=>{r.native.path='/other/addon.node'},
    r=>{r.load.observation.native=[]},
    r=>{r.load.observation.node='different'},
    r=>{r.scope='installed-runtime-readonly';r.load.childAbsent=false},
    r=>{r.semanticKagVerified=true},
  ]
  for(const change of changes) {
    const receipt=structuredClone(f.runtimeReceipt);change(receipt)
    await assert.rejects(applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:receipt}),/runtime/i)
    assert.equal(await exists(f.marketplace),false);assert.equal(await exists(f.native),false)
  }
  await assert.rejects(applyInstallation(plan,{runtimeReceipt:f.runtimeReceipt}),/plan-only/)
})

test('explicit disabled receipt only satisfies the matching disabled plan and keeps semantic capabilities unverified',async t=>{
  const f=await fixture(t),disabled=await checkRuntime({npmRoot:f.npmRoot,disableEmbedding:true,receiptDirectory:join(f.root,'disabled-check')})
  assert.equal(typeof disabled.identitySha256,'string')
  await assert.rejects(applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:disabled}),/Runtime/)
  const options={...f.options,disableEmbedding:true},plan=await planInstallation(options)
  const first=await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:disabled})
  assert.equal(first.runtimeReadiness.status,'disabled')
  assert.equal(first.runtimeReadiness.embedding.selection,'explicit-cli')
  assert.equal(first.runtimeReadiness.embedding.runningServerConfigurationVerified,false)
  for(const key of ['transformersVerified','semanticKagVerified','graVerified','licenseObligationsAccepted','releaseValidated'])assert.equal(first.runtimeReadiness[key],false)
  const again=await applyInstallation(await planInstallation(options),{adapter:f.adapter,runtimeReceipt:disabled})
  assert.equal(again.idempotent,true);assert.deepEqual(again.runtimeReadiness,first.runtimeReadiness)
})

test('staged external prerequisite drift rejects publication and retains foreign configuration',async t=>{
  const f=await fixture(t)
  // Keep the runtime package installed physically while moving its external
  // dependency closure outside the Companion package inventory, as npm does.
  const installed=join(f.root,'node_modules/@fixture/companion')
  await mkdir(dirname(installed),{recursive:true});await rename(f.npmRoot,installed)
  await rename(join(installed,'node_modules/sharp'),join(f.root,'node_modules/sharp'))
  await rename(join(installed,'node_modules/@img'),join(f.root,'node_modules/@img'))
  await rm(join(installed,'node_modules'),{recursive:true})
  const runtime=await inspectRuntime({npmRoot:installed}),native=runtime.native.path
  const supplied=await checkRuntime({npmRoot:installed,receiptDirectory:join(f.root,'external-check'),scope:'isolated-test-contract',testRunner:async()=>({stdout:JSON.stringify({node:process.versions.node,execPath:process.execPath,native:[native]}),stderr:''})})
  const foreign={name:'personal',plugins:[{name:'foreign'}],keep:'unchanged'}
  await f.put(f.marketplace,json(foreign))
  const plan=await planInstallation({...f.options,npmRoot:installed})
  let error
  try {
    await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:supplied,checkpoint:async phase=>{
      if(phase!=='staged')return
      await f.put(native,'external native drift')
    }})
  }catch(e){error=e}
  assert.match(error?.message??'',/Inputs changed before publication|Runtime/)
  assert.deepEqual(JSON.parse(await readFile(f.marketplace)),foreign);assert.equal(await exists(f.native),false)
  const receipt=JSON.parse(await readFile(error.receiptPath))
  assert.equal(receipt.phase,'rolled-back');assert.equal(receipt.rollbackCompleted,true)
  await assert.rejects(lstat(receipt.stage),{code:'ENOENT'})
  await assert.rejects(lstat(plan.target),{code:'ENOENT'})
})

test('caller receipt mutations after binding cannot change the decision or recorded evidence',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options)
  const first=await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.runtimeReceipt,checkpoint:async phase=>{
    if(phase==='prepared') {
      f.runtimeReceipt.status='failed';f.runtimeReceipt.embedding.provider='disabled'
      f.runtimeReceipt.pins.length=0
    }
  }})
  assert.equal(first.runtimeReadiness.status,'load-verified')
  assert.equal(first.runtimeReadiness.embedding.provider,'local')
  assert.equal(first.runtimeReadiness.loadStatus,'passed')
  assert.equal(JSON.parse(await readFile(first.receiptPath)).runtimeReadiness.receiptSha256,first.runtimeReadiness.receiptSha256)
})

// Explicit integration entry: ordinary unit runs do not run a native installer.
// The controller must supply the previously verified namespace experiment root.
if(process.env.DESIGN_CODEX_NATIVE_PROBE_ROOT) {
  test('actual isolated Codex failure/compensation preserves user configuration and foreign cache',async t=>{
    const root=await realpath(process.env.DESIGN_CODEX_NATIVE_PROBE_ROOT)
    const blueprint=JSON.parse(await readFile(join(root,'evidence/experiment-plan.json')))
    assert.equal(root,blueprint.root)
    const caseRoot=await mkdtemp(join(root,'compensation-run-'))
    const execute=promisify(execFile),records=[]
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
    async function realConfigs(){return Object.fromEntries(await Promise.all(blueprint.realConfigs.map(async path=>[path,sha(await readFile(path))])))}
    const originalConfigs=await realConfigs()
    let index=0
    async function setupNative(kind) {
      const dir=join(caseRoot,String(++index)+'-'+kind),home=join(dir,'home')
      const source=join(home,'.local/share/design-system/registrations/codex'),config=join(home,'.codex/config.toml')
      const put=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,value)}
      await mkdir(dirname(source),{recursive:true})
      await cp(join(root,'home/.local/share/design-system/registrations/codex'),source,{recursive:true})
      const foreign=join(home,'foreign-plugin')
      await put(join(foreign,'.codex-plugin/plugin.json'),json({name:'foreign',version:'9.0.0'}))
      await put(join(foreign,'keep.txt'),'foreign cache bytes')
      await put(config,'# existing user configuration\nmodel_reasoning_effort = "low"\n')
      await put(join(home,'.agents/plugins/marketplace.json'),json({name:'personal',plugins:[
        {name:'yugoo-design',source:{source:'local',path:'./.local/share/design-system/registrations/codex'}},
        {name:'foreign',source:{source:'local',path:'./foreign-plugin'}}]}))
      const environment={...blueprint.environment}
      for(const [key,value] of Object.entries(environment))if(value.startsWith(join(root,'home')))environment[key]=value.replace(join(root,'home'),home)
      environment.TMPDIR=environment.TEMP=environment.TMP=join(dir,'tmp');await mkdir(environment.TMPDIR)
      let failRemove=false,readOnlyAdd=false
      const run=async args=>{
        const before=await realConfigs();assert.deepEqual(before,originalConfigs)
        const base=[...blueprint.baseArgv]
        if(readOnlyAdd&&args[0]==='plugin'&&args[1]==='add'&&args[2]==='yugoo-design@personal')base.splice(base.length-1,0,'--ro-bind',config,config)
        if(failRemove&&args[1]==='remove')throw Object.assign(Error('controlled runner failure before native remove'),{code:1})
        const argv=[...base.slice(1),'/opt/codex-runtime/bin/codex',...args]
        let result,error,pid
        try{const pending=execute(base[0],argv,{env:environment,timeout:20000,maxBuffer:1024*1024});pid=pending.child.pid;result=await pending}catch(e){error=e}
        const after=await realConfigs();assert.deepEqual(after,before)
        records.push({kind,args,argv,environment,pid,exitCode:error?.code??0,stdout:result?.stdout??error?.stdout??'',stderr:result?.stderr??error?.stderr??'',realConfigBefore:before,realConfigAfter:after})
        if(error)throw error
        if(kind==='unverified-owned-content'&&args[1]==='add'&&args[2]==='yugoo-design@personal')await put(config,(await readFile(config,'utf8'))+'user_note = "external data"\n')
        return result
      }
      run.scope='bwrap-isolated-native-test';run.userRoot=home
      const market=JSON.parse((await run(['plugin','marketplace','list','--json'])).stdout)
      assert.deepEqual(market.marketplaces,[{name:'personal',root:home}])
      await run(['plugin','add','foreign@personal','--json'])
      const foreignCache=join(home,'.codex/plugins/cache/personal/foreign/9.0.0/keep.txt')
      const checkpoint=async phase=>{if(kind==='checkpoint-failure'&&phase==='after-add')throw Error('injected adapter boundary after successful native add')}
      const adapter=await createIsolatedCodexCompensation({isolationRoot:root,userRoot:home,source,version:'0.1.0-review.1',selector:'yugoo-design@personal',run,checkpoint})
      return {dir,home,source,config,put,run,adapter,foreignCache,setRemoveFailure:value=>{failRemove=value},setReadOnlyAdd:value=>{readOnlyAdd=value},
        cache:join(home,'.codex/plugins/cache/personal/yugoo-design/0.1.0-review.1')}
    }
    const outcomes=[]
    for(const kind of ['checkpoint-failure','foreign-config','foreign-cache','edited-cache','edited-selector','foreign-version-cache','unverified-owned-content','remove-failure','native-partial-failure','preexisting','unsupported-config']) {
      await t.test(kind,async()=>{
        const f=await setupNative(kind),foreignBefore=await readFile(f.foreignCache)
        if(kind==='preexisting') {
          await f.put(join(f.cache,'foreign-existing'),'keep')
          await assert.rejects(f.adapter.register(),/Pre-existing native version cache/)
          assert.equal(await readFile(join(f.cache,'foreign-existing'),'utf8'),'keep')
          // Also prove a pre-existing selector isn't adopted as owned.
          await rm(f.cache,{recursive:true});await f.run(['plugin','add','yugoo-design@personal','--json'])
          await assert.rejects(f.adapter.register(),/Pre-existing native selector table/)
          outcomes.push({kind,phase:'preflight-refused'});return
        }
        if(kind==='unsupported-config') {
          await f.put(f.config,'model_reasoning_effort = "low"\ncustom = """unsupported\nmultiline"""\n')
          const before=await readFile(f.config)
          await assert.rejects(f.adapter.register(),/Unsupported multiline/)
          assert.deepEqual(await readFile(f.config),before)
          outcomes.push({kind,phase:'preflight-refused'});return
        }
        if(kind==='native-partial-failure')f.setReadOnlyAdd(true)
        if(['checkpoint-failure','native-partial-failure','unverified-owned-content'].includes(kind))await assert.rejects(f.adapter.register())
        else await f.adapter.register()
        const receipt=JSON.parse(await readFile(f.adapter.receiptPath))
        if(kind==='native-partial-failure') {
          assert.ok(receipt.commands.some(c=>c.args[1]==='add'&&c.exitCode!==0))
          assert.ok(receipt.observedCache,'Fault must actually occur after native cache mutation')
          f.setReadOnlyAdd(false)
        }
        let foreignProtected
        if(kind==='foreign-config')await f.put(f.config,(await readFile(f.config,'utf8')).replace('model_reasoning_effort = "low"','model_reasoning_effort = "high"'))
        if(kind==='foreign-cache'){foreignProtected=join(f.cache,'external-user-note');await f.put(foreignProtected,'external evidence')}
        if(kind==='edited-cache'){foreignProtected=join(f.cache,'scripts/design.mjs');await f.put(foreignProtected,'user-edited bytes')}
        if(kind==='edited-selector')await f.put(f.config,(await readFile(f.config,'utf8')).replace('[plugins."yugoo-design@personal"]\nenabled = true','[plugins."yugoo-design@personal"]\nenabled = false'))
        if(kind==='foreign-version-cache'){foreignProtected=join(dirname(f.cache),'foreign-version/user-file');await f.put(foreignProtected,'external version evidence')}
        if(['foreign-cache','edited-cache','edited-selector','foreign-version-cache','unverified-owned-content'].includes(kind)) {
          const removeCount=records.filter(r=>r.kind===kind&&r.args[1]==='remove').length
          await assert.rejects(f.adapter.compensate(),/retained/)
          assert.equal(records.filter(r=>r.kind===kind&&r.args[1]==='remove').length,removeCount)
          if(foreignProtected)assert.ok((await readFile(foreignProtected,'utf8')).includes(kind==='edited-cache'?'user-edited':'external'))
          if(kind==='edited-selector')assert.match(await readFile(f.config,'utf8'),/enabled = false/)
          if(kind==='unverified-owned-content')assert.match(await readFile(f.config,'utf8'),/user_note = "external data"/)
          if(kind==='foreign-version-cache') {
            const listed=JSON.parse((await f.run(['plugin','list','--json'])).stdout).installed
            assert.equal(listed.find(p=>p.pluginId==='yugoo-design@personal').version,'foreign-version')
            assert.equal((await lstat(f.cache)).isDirectory(),true)
          }
          outcomes.push({kind,phase:JSON.parse(await readFile(f.adapter.receiptPath)).phase,receiptPath:f.adapter.receiptPath})
          return
        }
        if(kind==='remove-failure') {
          f.setRemoveFailure(true);await assert.rejects(f.adapter.compensate(),/controlled runner failure/)
          assert.equal(JSON.parse(await readFile(f.adapter.receiptPath)).phase,'recovery-required')
          assert.equal((await lstat(f.cache)).isDirectory(),true);f.setRemoveFailure(false)
        }
        const result=await f.adapter.compensate()
        assert.equal(result.phase,'compensated');assert.equal(result.nativeCompensationVerified,false)
        assert.deepEqual(await readFile(f.foreignCache),foreignBefore)
        const current=await readFile(f.config,'utf8');assert.match(current,/# existing user configuration/)
        assert.match(current,/model_reasoning_effort = "(?:low|high)"/);assert.match(current,/\[plugins\."foreign@personal"\]/)
        if(kind==='foreign-config')assert.match(current,/model_reasoning_effort = "high"/)
        if(kind==='foreign-version-cache')assert.equal(await readFile(foreignProtected,'utf8'),'external version evidence')
        const listed=JSON.parse((await f.run(['plugin','list','--json'])).stdout).installed
        assert.equal(listed.some(p=>p.pluginId==='yugoo-design@personal'),false);assert.equal(listed.some(p=>p.pluginId==='foreign@personal'&&p.enabled),true)
        outcomes.push({kind,phase:result.phase,receiptPath:f.adapter.receiptPath})
      })
    }
    const reportPath=join(root,'evidence/native-compensation-'+caseRoot.split('/').at(-1)+'.json')
    await writeFile(reportPath,json({scope:'actual-isolated-native-compensation-tests',caseRoot,outcomes,records,nativeCompensationVerified:false,releaseValidated:false}))
    t.diagnostic(`Native compensation evidence: ${reportPath}; SHA256 ${sha(await readFile(reportPath))}`)
    assert.deepEqual(await realConfigs(),originalConfigs)
  })
}

async function upgradeFixture(t) {
  const f=await fixture(t,'dsh-codex-native-'),selector='yugoo-design@personal'
  const source=join(f.userRoot,'.local/share/design-system/registrations/codex')
  const config=join(f.userRoot,'.codex/config.toml'),cacheRoot=join(f.userRoot,'.codex/plugins/cache/personal/yugoo-design')
  const foreign=join(f.userRoot,'.codex/plugins/cache/personal/foreign/9.0.0/keep'),project=join(f.userRoot,'Design Projects/fixture/answer.json')
  await f.put(config,'# user setting\nmodel = "keep"\n');await f.put(foreign,'foreign');await f.put(project,'project')
  await f.put(f.marketplace,json({name:'personal',plugins:[{name:'foreign'}]}))
  const owned=`[plugins.${JSON.stringify(selector)}]\nenabled = true\n`,commands=[],failAfterAdd=new Set()
  let installedVersion=null
  const run=Object.assign(async args=>{
    commands.push(args)
    if(args[1]==='add') {
      const version=JSON.parse(await readFile(join(source,'.codex-plugin/plugin.json'))).version
      // Model the real CLI's observed pruning; this fixture never invokes a host.
      await rm(cacheRoot,{recursive:true,force:true});await cp(source,join(cacheRoot,version),{recursive:true})
      const current=await readFile(config,'utf8');if(!current.includes(selector))await f.put(config,current+owned)
      installedVersion=version
      if(failAfterAdd.delete(version))throw new Error('fixture native failure after '+version)
      return {stdout:json({version})}
    }
    if(args[1]==='remove') {
      await rm(cacheRoot,{recursive:true,force:true});installedVersion=null
      await f.put(config,(await readFile(config,'utf8')).replace(owned,''));return {stdout:'{}'}
    }
    return {stdout:json({available:[],installed:installedVersion?[{pluginId:selector,version:installedVersion,installed:true,enabled:true,source:{source:'local',path:source}}]:[]})}
  },{scope:'bwrap-isolated-native-test',userRoot:f.userRoot})
  const make=()=>createIsolatedCodexInstallerAdapter({isolationRoot:f.root,userRoot:f.userRoot,run})
  const adapter=await make(),oldOptions={...f.options,adapter,disableEmbedding:true}
  const runtime=await checkRuntime({npmRoot:f.npmRoot,disableEmbedding:true,receiptDirectory:join(f.root,'old-disabled-runtime')})
  const old=await applyInstallation(await planInstallation(oldOptions),{adapter,runtimeReceipt:runtime})
  const newRoot=join(f.root,'new npm root');await cp(f.npmRoot,newRoot,{recursive:true})
  const manifest=JSON.parse(await readFile(join(newRoot,'package.json')));manifest.version='2.0.0'
  await f.put(join(newRoot,'package.json'),json(manifest))
  const plugin=join(newRoot,'payload/overlays/codex/.codex-plugin/plugin.json'),metadata=JSON.parse(await readFile(plugin));metadata.version='2.0.0';await f.put(plugin,json(metadata))
  const options={...oldOptions,npmRoot:newRoot},newRuntime=await checkRuntime({npmRoot:newRoot,disableEmbedding:true,receiptDirectory:join(f.root,'new-disabled-runtime')})
  return {...f,source,config,cacheRoot,foreign,project,commands,failAfterAdd,make,adapter,old,options,newRuntime,oldOptions}
}

test('upgrade switches versions safely, repeats without add, refuses old uninstall and uninstalls only new ownership',async t=>{
  const f=await upgradeFixture(t),oldTree=await f.adapter.upgradeSource(f.old),oldPackage=await f.adapter.upgradeSource({...f.old,target:f.npmRoot})
  const config=await readFile(f.config,'utf8'),market=await readFile(f.marketplace,'utf8')
  const plan=await planInstallation(f.options),result=await applyInstallation(plan,{adapter:f.adapter,runtimeReceipt:f.newRuntime})
  assert.equal(result.phase,'verified');assert.equal(result.package.version,'2.0.0')
  assert.deepEqual(await f.adapter.upgradeSource({...result,target:result.previous}),oldTree)
  assert.deepEqual(await f.adapter.upgradeSource({...result,target:result.previousCache}),oldTree)
  assert.equal(await exists(join(f.cacheRoot,'1.0.0/.codex-plugin/plugin.json')),false)
  assert.equal(await f.adapter.readback(result),true)
  assert.equal(await readFile(f.config,'utf8'),config);assert.equal(await readFile(f.marketplace,'utf8'),market)
  assert.equal(await readFile(f.foreign,'utf8'),'foreign');assert.equal(await readFile(f.project,'utf8'),'project')
  assert.deepEqual(await f.adapter.upgradeSource({...f.old,target:f.npmRoot}),oldPackage)
  const adds=f.commands.filter(c=>c[1]==='add').length,restarted=await f.make()
  assert.equal((await applyInstallation(await planInstallation({...f.options,adapter:restarted}),{adapter:restarted,runtimeReceipt:f.newRuntime})).idempotent,true)
  assert.equal(f.commands.filter(c=>c[1]==='add').length,adds)
  await assert.rejects(uninstallInstallation(f.old,{adapter:restarted}),/changed|mismatch|refused/i)
  assert.equal(f.commands.some(c=>c[1]==='remove'),false)
  const uninstalled=await uninstallInstallation(result,{adapter:restarted})
  assert.equal(uninstalled.uninstallCompleted,true);assert.equal(await exists(join(f.source,'.codex-plugin/plugin.json')),false)
  assert.deepEqual(await uninstallInstallation(uninstalled,{adapter:await f.make()}),uninstalled)
  assert.deepEqual(await recoverInstallation(uninstalled,{adapter:await f.make()}),uninstalled)
  assert.equal(f.commands.filter(c=>c[1]==='remove').length,1)
  assert.equal(await readFile(f.foreign,'utf8'),'foreign');assert.equal(await readFile(f.project,'utf8'),'project')
  assert.deepEqual(await f.adapter.upgradeSource({...f.old,target:f.npmRoot}),oldPackage)
})

test('direct Agent install upgrades through the owning Codex transaction and repeats without native add',async t=>{
  const f=await upgradeFixture(t),beforeAdds=f.commands.filter(args=>args[1]==='add').length
  const args=['install','--host','codex','--receipt-dir',f.receiptDirectory,'--disable-embedding']
  const result=await installerMain(args,f.options)
  assert.equal(result.phase,'verified'); assert.equal(result.package.version,'2.0.0')
  assert.equal(result.installation.registration,'verified'); assert.equal(result.installation.activation,'required')
  assert.equal(result.installation.usability,'unverified'); assert.equal(result.usable,false)
  assert.equal(f.commands.filter(args=>args[1]==='add').length,beforeAdds+1)
  const again=await installerMain(args,{...f.options,adapter:await f.make()})
  assert.equal(again.idempotent,true); assert.equal(again.hostRegistered,true)
  assert.equal(f.commands.filter(args=>args[1]==='add').length,beforeAdds+1)
  assert.equal(await readFile(f.foreign,'utf8'),'foreign'); assert.equal(await readFile(f.project,'utf8'),'project')
})

test('upgrade failure before native publication or after native mutation restores the old version',async t=>{
  for(const mode of ['previous-published','published','native'])await t.test(mode,async t=>{
    const f=await upgradeFixture(t),before=await f.adapter.upgradeSource(f.old)
    if(mode==='native')f.failAfterAdd.add('2.0.0')
    let path
    try { await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.newRuntime,
      checkpoint:async phase=>{if(mode==='published'&&phase==='target-published'||mode==='previous-published'&&phase==='previous-published')throw new Error('fixture publication failure')}}) }
    catch(error){path=error.receiptPath}
    assert.ok(path);const receipt=JSON.parse(await readFile(path))
    assert.equal(receipt.phase,'rolled-back');assert.equal(receipt.rollbackCompleted,true)
    assert.deepEqual(await f.adapter.upgradeSource(f.old),before)
    assert.equal(await f.adapter.readback(f.old),true)
    assert.equal(f.commands.some(c=>c[1]==='remove'),false)
    assert.equal(await readFile(f.foreign,'utf8'),'foreign');assert.equal(await readFile(f.project,'utf8'),'project')
  })
})

test('upgrade interrupted recovery resumes through the persisted receipt and a fresh adapter',async t=>{
  const f=await upgradeFixture(t),oldTree=await f.adapter.upgradeSource(f.old)
  f.failAfterAdd.add('2.0.0');f.failAfterAdd.add('1.0.0')
  let path
  try {await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.newRuntime})}catch(error){path=error.receiptPath}
  assert.ok(path);const receipt=JSON.parse(await readFile(path));assert.equal(receipt.phase,'recovery-required')
  const dead=spawnSync(process.execPath,['-e','']);assert.equal(dead.status,0)
  await mkdir(receipt.lock);const identity=await lstat(receipt.lock)
  receipt.pid=dead.pid;receipt.lockIdentity={dev:identity.dev,ino:identity.ino}
  await f.put(receipt.receiptPath,json(receipt))
  const restored=await recoverInstallation(receipt,{adapter:await f.make()})
  await assert.rejects(lstat(receipt.lock),{code:'ENOENT'})
  assert.equal(restored.phase,'rolled-back');assert.equal(restored.rollbackCompleted,true)
  assert.deepEqual(await f.adapter.upgradeSource(f.old),oldTree);assert.equal(await f.adapter.readback(f.old),true)
  const adds=f.commands.filter(c=>c[1]==='add').length
  assert.deepEqual(await recoverInstallation(restored,{adapter:await f.make()}),restored)
  assert.equal(f.commands.filter(c=>c[1]==='add').length,adds)
  assert.equal(f.commands.some(c=>c[1]==='remove'),false)
})

test('upgrade preflight rejects unknown caches, edits and receipt identity drift without a native mutation',async t=>{
  for(const mode of ['unknown-version','edited-cache','receipt','package'])await t.test(mode,async t=>{
    const f=await upgradeFixture(t),adds=f.commands.filter(c=>c[1]==='add').length
    if(mode==='unknown-version')await mkdir(join(f.cacheRoot,'unowned-version'))
    if(mode==='edited-cache')await f.put(join(f.cacheRoot,'1.0.0/foreign.txt'),'foreign data')
    if(mode==='receipt'){const r=JSON.parse(await readFile(f.old.receiptPath));r.package.name='@foreign/package';await f.put(f.old.receiptPath,json(r))}
    if(mode==='package')await f.put(join(f.npmRoot,'unowned-edit'),'changed old package')
    await assert.rejects(planInstallation(f.options))
    assert.equal(f.commands.filter(c=>c[1]==='add').length,adds);assert.equal(f.commands.some(c=>c[1]==='remove'),false)
    assert.equal(await f.adapter.readback(f.old),true)
  })
})

test('upgrade recovery retains conflicting cache bytes instead of pruning unknown data',async t=>{
  const f=await upgradeFixture(t),foreign=join(f.cacheRoot,'unknown/keep.txt');let path
  try {await applyInstallation(await planInstallation(f.options),{adapter:f.adapter,runtimeReceipt:f.newRuntime,
    checkpoint:async phase=>{if(phase==='target-published'){await f.put(foreign,'retain');throw new Error('fixture foreign conflict')}}})}catch(error){path=error.receiptPath}
  const receipt=JSON.parse(await readFile(path));assert.equal(receipt.phase,'recovery-required')
  assert.equal(await readFile(foreign,'utf8'),'retain')
  assert.equal(f.commands.filter(c=>c[1]==='add').length,1);assert.equal(f.commands.some(c=>c[1]==='remove'),false)
  await assert.rejects(recoverInstallation(receipt,{adapter:await f.make()}),/Unknown native|retained|changed/i)
  assert.equal(await readFile(foreign,'utf8'),'retain')
})

// Public-entry tests exercise only temporary manifests and an explicitly injected
// test factory. Neither the real official CLI nor a host process is launched.
async function dshEntryFixture(t) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'dsh-public-entry-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const home=join(root,'dsh-home'),profile=join(home,'profiles/chosen'),npmRoot=join(root,'companion'),receipts=join(root,'receipts')
  async function put(path,value){await mkdir(dirname(path),{recursive:true});await writeFile(path,value)}
  await mkdir(npmRoot)
  await put(join(npmRoot,'package.json'),json({name:'@release/companion',version:'0.1.0-beta.1'}))
  for(const file of ['design-system.mjs','installer.mjs','npm-installer-dsh.mjs','npm-agent-installation.mjs'])
    await put(join(npmRoot,'bin',file),'// synthetic acquired product '+file+'\n')
  await put(join(profile,'package.json'),json({name:'selected-profile',dsh:{profile:{bundles:[],patchReload:'startup'}},models:{keep:true}}))
  await put(join(profile,'cordis.patch.yml'),'[]\n');await put(join(home,'cordis.patch.yml'),'[]\n')
  const host=join(root,'official-host'),loader=join(root,'official-loader')
  const paths={node:join(root,'node-runtime/bin/node'),cli:join(host,'bin.mjs'),hostManifest:join(host,'package.json'),
    loader:join(loader,'index.mjs'),loaderManifest:join(loader,'package.json')}
  await put(paths.node,'mock node; never executed\n');await put(paths.cli,'throw new Error("must not execute")\n')
  await put(paths.hostManifest,json({name:'@deepseek-ai/dsh',version:'0.1.2-rc.1',bin:{dsh:'bin.mjs'}}))
  await put(paths.loaderManifest,json({name:'@deepseek-ai/dsh-app-boot',version:'0.1.2-rc.1',main:'index.mjs'}))
  await put(paths.loader,`import {readFileSync} from 'node:fs';import {join} from 'node:path';
export const resolveProfileDir=(name,home)=>join(home,'profiles',name);
export const readProfileManifest=(bin,dir)=>JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
export function resolveBundleDir(bin,name,anchor,profile){const dir=join(profile,'node_modules',name);try{readProfileManifest(bin,dir);return dir}catch(error){if(error.code!=='ENOENT')throw error;throw new Error(bin+': cannot resolve profile bundle '+JSON.stringify(name)+' from the dsh installation or '+profile)}}
export const bundlePatchPaths=(dir,bundle)=>(typeof bundle.patch==='string'?[bundle.patch]:bundle.patch).map(path=>join(dir,path));
export const loadOverlayPatches=(bin,path)=>JSON.parse(readFileSync(path,'utf8'));
export const composeEntries=layers=>layers.flat();\n`)
  const pins=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([key,path])=>[key,{path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')}])))
  const config={dshHome:home,...pins,hostVersion:'0.1.2-rc.1',loaderVersion:'0.1.2-rc.1'},configPath=join(root,'dsh-pins.json')
  await put(configPath,json(config))
  const calls=[];let fail=false
  async function run(command,args,options){
    calls.push({command,args,options})
    const manifest=JSON.parse(await readFile(join(profile,'package.json'),'utf8'))
    manifest.dependencies={'@release/design-system-dsh':'1.2.3'};manifest.dsh.profile.bundles=['@release/design-system-dsh']
    await put(join(profile,'package.json'),json(manifest))
    const packageDir=join(profile,'node_modules/@release/design-system-dsh')
    await put(join(packageDir,'package.json'),json({name:'@release/design-system-dsh',version:'1.2.3',dsh:{bundle:{patch:'patch.json'}}}))
    await put(join(packageDir,'patch.json'),'[]\n')
    if(fail)throw Object.assign(new Error('mock CLI failure'),{code:4})
    return {exitCode:0}
  }
  const dshAdapterFactory=async options=>{
    assert.equal(options.scope,'official-pinned')
    return createDshInstallerAdapter({...options,scope:'isolated-test-contract',run})
  }
  const base=['install','--host','dsh','--dsh-config',configPath,'--profile','chosen','--aggregate-selector','@release/design-system-dsh@1.2.3','--registry','https://registry.npmjs.org/']
  const options={npmRoot,dshAdapterFactory}
  return {root,home,profile,npmRoot,receipts,config,configPath,paths,calls,base,options,put,setFail:()=>{fail=true},
    dry:()=>installerMain([...base,'--dry-run','--receipt-dir',receipts],options),
    apply:plan=>installerMain([...base,'--apply','--plan',plan.planFile,'--receipt-dir',receipts],options)}
}

test('DSH public entry dry-run saves an independent plan and help has no config side effects',async t=>{
  const f=await dshEntryFixture(t),before=await readFile(join(f.profile,'package.json'))
  const help=await installerMain(['--help','--dsh-config','/must-not-read'],f.options)
  assert.ok(help.options['--dsh-config <file>'])
  const plan=await f.dry()
  assert.equal(plan.route,'official-dsh-bundle');assert.equal(Object.hasOwn(plan,'npmRoot'),false)
  assert.equal(f.calls.length,0);assert.deepEqual(await readFile(join(f.profile,'package.json')),before)
  assert.equal(JSON.parse(await readFile(plan.planFile)).planSha256,plan.planSha256)
  await assert.rejects(f.dry(),{code:'EEXIST'}) // Never overwrite an existing output.
})

test('DSH public entry apply saves config-only results and rejects reuse of a stale saved plan',async t=>{
  const f=await dshEntryFixture(t),plan=await f.dry(),saved=await readFile(plan.planFile)
  const result=await f.apply(plan)
  assert.equal(result.status,'registered-config-parsed');assert.equal(result.host,'dsh')
  assert.equal(result.scope,'isolated-test-contract');assert.equal(result.runtimeMounted,false)
  assert.deepEqual(JSON.parse(await readFile(result.receiptFile)),Object.fromEntries(Object.entries(result).filter(([key])=>key!=='receiptFile')))
  assert.deepEqual(await readFile(plan.planFile),saved)
  await assert.rejects(f.apply(plan),/drifted/);assert.equal(f.calls.length,1)
  const next=await f.dry();assert.equal(next.action,'already-registered')
  await f.apply(next);assert.equal(f.calls.length,1)
})

test('DSH public entry failed apply persists the partial-state receipt without rollback',async t=>{
  const f=await dshEntryFixture(t),plan=await f.dry();f.setFail()
  const result=await f.apply(plan),stored=JSON.parse(await readFile(result.receiptFile))
  assert.equal(stored.status,'failed-partial-state-retained');assert.equal(stored.exitCode,4)
  assert.equal(stored.readback.packageInstalled,true);assert.equal(stored.rollbackAttempted,false)
  assert.equal(stored.runtimeMounted,false);assert.equal(f.calls.length,1)
  // The generated candidate bin wrapper owns mapping this status to exit 1.
})

test('DSH public entry refuses saved-plan/profile/pin drift before any CLI call',async t=>{
  const f=await dshEntryFixture(t),plan=await f.dry()
  const original=await readFile(plan.planFile)
  const changed=JSON.parse(original);changed.args.push('--unreviewed')
  await f.put(plan.planFile,json(changed));await assert.rejects(f.apply(plan),/Plan or profile changed/)
  await f.put(plan.planFile,original)
  await f.put(join(f.profile,'cordis.patch.yml'),'[{"id":"changed"}]\n')
  await assert.rejects(f.apply(plan),/drifted/)
  await f.put(f.paths.cli,'drifted CLI\n');await assert.rejects(f.apply(plan),/pin changed/)
  assert.equal(f.calls.length,0)
})

test('DSH public entry external output checks reject overlap, ancestor paths and symlinks',async t=>{
  const f=await dshEntryFixture(t)
  for(const output of [f.home,join(f.home,'receipts'),f.root,f.npmRoot,dirname(f.paths.cli)])
    await assert.rejects(installerMain([...f.base,'--dry-run','--receipt-dir',output],f.options),/overlaps/)
  const link=join(f.root,'linked-output');await symlink(f.home,link)
  await assert.rejects(installerMain([...f.base,'--dry-run','--receipt-dir',join(link,'new')],f.options),/Symlink/)
  assert.equal(f.calls.length,0)
})

test('DSH public entry rejects config scope overrides and flags on other hosts or commands',async t=>{
  const f=await dshEntryFixture(t)
  for(const args of [['install','--host','codex','--dry-run','--profile','chosen'],['check-runtime','--host','dsh','--dsh-config',f.configPath],
    [...f.base,'--dry-run','--apply','--receipt-dir',f.receipts], [...f.base,'--dry-run','--receipt-dir',f.receipts,'--runtime-receipt','/foreign'],
    [...f.base,'--dry-run','--receipt-dir',f.receipts,'--user-root',f.home]])
    await assert.rejects(installerMain(args,f.options))
  await f.put(f.configPath,json({...f.config,scope:'isolated-test-contract'}))
  await assert.rejects(f.dry(),/scope\/runner overrides/)
  assert.equal(f.calls.length,0)
})

async function assertPlanBodyRejectedWithoutEffects(f,plan) {
  async function fileSnapshot() {
    const entries={}
    for(const name of (await readdir(f.root,{recursive:true})).sort()) {
      const path=join(f.root,name),info=await lstat(path)
      entries[name]=info.isDirectory()?'directory':createHash('sha256').update(await readFile(path)).digest('hex')
    }
    return entries
  }
  const before=await fileSnapshot(),calls=[]
  const adapter={...f.adapter}
  for(const key of ['probe','register','readback','compensate'])adapter[key]=async()=>{calls.push(key);throw Error('Rejected plan must not call adapter')}
  await assert.rejects(applyInstallation(plan,{adapter,runtimeReceipt:f.runtimeReceipt}),/Plan body digest mismatch/)
  assert.deepEqual(calls,[])
  assert.deepEqual(await fileSnapshot(),before)
}

test('apply plan body rejects a dry-run planFile wrapper before adapter or filesystem effects',async t=>{
  const f=await fixture(t)
  const wrapped=await installerMain(['install','--dry-run','--host','codex','--receipt-dir',f.receiptDirectory],f.options)
  assert.ok(wrapped.planFile)
  await assertPlanBodyRejectedWithoutEffects(f,wrapped)
})

test('apply plan body rejects changed fields retaining the original hash before adapter or filesystem effects',async t=>{
  const f=await fixture(t),plan=await planInstallation(f.options)
  const changed={...plan,target:join(f.userRoot,'unreviewed-target')}
  assert.equal(changed.planSha256,plan.planSha256)
  await assertPlanBodyRejectedWithoutEffects(f,changed)
})

async function portableProtocolFixture(t) {
  const root=await mkdtemp(join(await realpath(tmpdir()),'codex-protocol-mock-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const userRoot=join(root,'isolated-home');await mkdir(userRoot)
  const paths=[join(root,'install-one/codex'),join(root,'install-two/codex')]
  for(const path of paths){await mkdir(dirname(path));await writeFile(path,'mock executable bytes; never launched\n')}
  const calls=[];let version='codex-cli 0.160.0\n',list={installed:[],available:[]}
  const run=async(command,args,options)=>{
    calls.push({command,args,options})
    assert.equal(options.env.HOME,userRoot)
    return {stdout:args[0]==='--version'?version:typeof list==='string'?list:JSON.stringify(list),stderr:''}
  }
  return {root,userRoot,paths,calls,run,version:value=>{version=value},list:value=>{list=value}}
}

test('portable Codex protocol accepts relocated exact-version bytes but rejects unknown protocol or JSON without admission',async t=>{
  const f=await portableProtocolFixture(t)
  const first=await inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run})
  const second=await inspectCodexNativeProtocol({executable:f.paths[1],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run})
  assert.notEqual(first.executable,second.executable);assert.equal(first.sha256,second.sha256)
  assert.equal(first.protocol,'local-plugin-json-v1');assert.equal(first.version,'codex-cli 0.160.0')
  assert.throws(()=>assertCodexAdmission(first),/verified native protocol adapter/)
  assert.ok(f.calls.every(call=>call.args[0]==='--version'||JSON.stringify(call.args)===JSON.stringify(['plugin','list','--json'])))
  const before=f.calls.length
  await assert.rejects(inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'darwin',arch:'arm64',run:f.run}),/Unsupported/)
  assert.equal(f.calls.length,before)
  f.version('codex-cli 0.160.1\n')
  await assert.rejects(inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run}),/Unsupported/)
  f.version('codex-cli 0.160.0\n')
  for(const value of [{plugins:[]},{installed:[{pluginId:'x'}],available:[]},'not JSON']) {
    f.list(value)
    await assert.rejects(inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run}))
  }
  assert.deepEqual(await readdir(f.userRoot),[])
})

test('portable Codex protocol SHA drift refuses the next command before runner or profile effects',async t=>{
  const f=await portableProtocolFixture(t)
  const identity=await inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run})
  const before=f.calls.length
  await writeFile(f.paths[0],'changed executable bytes\n')
  await assert.rejects(runPinnedCodexCommand(identity,['plugin','add','yugoo-design@personal','--json'],{userRoot:f.userRoot,run:f.run}),/Native executable changed/)
  assert.equal(f.calls.length,before);assert.deepEqual(await readdir(f.userRoot),[])
  assert.throws(()=>assertCodexAdmission({scope:'codex-native-transaction',nativeCompensationVerified:true,identity}),/verified native protocol adapter/)
})

test('portable Codex 0.162.0 admission is exact Linux x64 and retains JSON, SHA and adapter authority guards',async t=>{
  // Table regression only. Real lifecycle qualification is independent of this mock.
  const f=await portableProtocolFixture(t)
  f.version('codex-cli 0.162.0\n')
  const identity=await inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run})
  assert.equal(identity.version,'codex-cli 0.162.0')
  assert.equal(identity.protocol,'local-plugin-json-v1')
  assert.throws(()=>assertCodexAdmission(identity),/verified native protocol adapter/)
  for(const [platform,arch] of [['win32','x64'],['darwin','arm64'],['linux','arm64']]) {
    const before=f.calls.length
    await assert.rejects(inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform,arch,run:f.run}),/Unsupported/)
    assert.equal(f.calls.length,before)
  }
  for(const version of ['codex-cli 0.161.0\n','codex-cli 0.162.1\n','codex-cli 0.163.0\n']) {
    f.version(version)
    const before=f.calls.length
    await assert.rejects(inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run}),/Unsupported/)
    assert.equal(f.calls.length,before+1) // Version only; no list/apply command.
  }
  f.version('codex-cli 0.162.0\n')
  for(const value of [{plugins:[]},{installed:[{pluginId:'x'}],available:[]},'not JSON']) {
    f.list(value)
    await assert.rejects(inspectCodexNativeProtocol({executable:f.paths[0],userRoot:f.userRoot,platform:'linux',arch:'x64',run:f.run}))
  }
  const before=f.calls.length
  await writeFile(f.paths[0],'changed 0.162 executable bytes\n')
  await assert.rejects(runPinnedCodexCommand(identity,['plugin','add','yugoo-design@personal','--json'],{userRoot:f.userRoot,run:f.run}),/Native executable changed/)
  assert.equal(f.calls.length,before)
  assert.deepEqual(await readdir(f.userRoot),[])
})

// Build the persisted pre-rename format independently of the new installer.
// Recovery must accept the old selector while still verifying every recorded byte.
async function legacyCodexReceipt(t) {
  const f=await fixture(t),planned=await planInstallation(f.options)
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
  const digest=value=>hash(JSON.stringify(canonical(value)))
  const inventory=async root=>Object.fromEntries(Object.entries(await userSnapshot(root)).map(([path,bytes])=>[path.slice(root.length+1),hash(bytes)]))
  await f.put(join(f.overlay,'.codex-plugin/plugin.json'),json({name:'design-system',version:'1.0.0',skills:'./skills/',mcpServers:'./.mcp.json'}))
  await rename(join(f.overlay,'skills/yugoo'),join(f.overlay,'skills/design'))
  const {planSha256:unused,...body}=planned
  const plan={...body,selector:'design-system@personal',packageInventorySha256:digest(await inventory(f.npmRoot)),overlayInventorySha256:digest(await inventory(f.overlay))}
  plan.planSha256=digest(plan)
  const id='68a5d19a-b065-47d0-a435-c74b16890e30',receiptPath=join(f.receiptDirectory,id+'.receipt.json')
  await mkdir(dirname(plan.target),{recursive:true});await cp(f.overlay,plan.target,{recursive:true})
  const assetHashes=await inventory(plan.target)
  await f.put(join(plan.target,'.design-system-registration.json'),json({host:'codex',npmRoot:f.npmRoot,version:'1.0.0',assetHashes,transactionId:id,planSha256:plan.planSha256,receiptPath}))
  const afterEntry={name:'design-system',source:{source:'local',path:'./.local/share/design-system/registrations/codex'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}
  await f.put(f.marketplace,json({name:'personal',plugins:[afterEntry,{name:'foreign',source:{source:'local',path:'./foreign'}}]}))
  const receipt={schemaVersion:1,id,pid:2147483647,scope:'isolated-test-transaction',...plan,planSnapshot:structuredClone(plan),receiptPath,phase:'verified',hostRegistered:true,nativeAttempted:true,
    ownedTargetSha256:digest(await inventory(plan.target)),afterEntry,rollbackCompleted:false,stage:plan.target+'.stage-'+id,lock:join(f.receiptDirectory,'codex-install.lock'),lockIdentity:{dev:0,ino:0}}
  await f.put(receiptPath,json(receipt));await f.adapter.register(plan)
  return {...f,receipt}
}

test('legacy Codex receipts recover and uninstall their exact old identity, preserving foreign registration',async t=>{
  for(const operation of ['recover','uninstall'])await t.test(operation,async t=>{
    const f=await legacyCodexReceipt(t),retained=await userSnapshot(f.npmRoot)
    const result=await (operation==='uninstall'?uninstallInstallation:recoverInstallation)(f.receipt,{adapter:f.adapter})
    assert.equal(result.phase,'rolled-back')
    assert.equal(result.selector,'design-system@personal')
    assert.deepEqual(JSON.parse(await readFile(f.marketplace)).plugins,[{name:'foreign',source:{source:'local',path:'./foreign'}}])
    assert.deepEqual(await userSnapshot(f.npmRoot),retained)
    await assert.rejects(lstat(f.receipt.target),{code:'ENOENT'})
    assert.equal((await (operation==='uninstall'?uninstallInstallation:recoverInstallation)(result,{adapter:f.adapter})).phase,'rolled-back')
  })
})

test('new Codex installation refuses legacy or mixed marketplace identities without changing files',async t=>{
  for(const mixed of [false,true])await t.test(mixed?'mixed':'legacy',async t=>{
    const f=await fixture(t)
    const plugins=[{name:'design-system',source:{source:'local',path:'./old'}}]
    if(mixed)plugins.push({name:'yugoo-design',source:{source:'local',path:'./new'}})
    await f.put(f.marketplace,json({name:'personal',plugins}))
    const before=await userSnapshot(f.userRoot)
    await assert.rejects(planInstallation(f.options),/Legacy.*previous install receipt/)
    assert.deepEqual(await userSnapshot(f.userRoot),before)
    await assert.rejects(lstat(f.receiptDirectory),{code:'ENOENT'})
  })
})

test('legacy Codex receipt still refuses edited owned files before compensation',async t=>{
  const f=await legacyCodexReceipt(t)
  await f.put(join(f.receipt.target,'user-edited.txt'),'must retain')
  const before=await userSnapshot(f.userRoot)
  await assert.rejects(uninstallInstallation(f.receipt,{adapter:f.adapter}),/Owned registration changed/)
  assert.deepEqual(await userSnapshot(f.userRoot),before)
})

test('Codex native preflight detects old selectors in other catalogs and legacy compensation uses old cache',async t=>{
  const f=await fixture(t,'dsh-codex-native-'),selector='design-system@legacy',source=join(f.root,'legacy-source')
  const cache=join(f.userRoot,'.codex/plugins/cache/legacy/design-system/1.0.0'),config=join(f.userRoot,'.codex/config.toml')
  await f.put(join(source,'method.txt'),'legacy method')
  const calls=[]
  const run=Object.assign(async args=>{
    calls.push(args)
    if(args[1]==='add') {
      await mkdir(dirname(cache),{recursive:true});await cp(source,cache,{recursive:true})
      await f.put(config,`[plugins.${JSON.stringify(selector)}]\nenabled = true\n`);return {stdout:'{}'}
    }
    if(args[1]==='remove') {await rm(cache,{recursive:true});await f.put(config,'');return {stdout:'{}'}}
    const installed=await exists(config)&&(await readFile(config,'utf8')).includes(selector)
    return {stdout:json({available:[],installed:installed?[{pluginId:selector,version:'1.0.0',installed:true,enabled:true,source:{source:'local',path:source}}]:[]})}
  },{scope:'bwrap-isolated-native-test',userRoot:f.userRoot})
  const compensation=await createIsolatedCodexCompensation({isolationRoot:f.root,userRoot:f.userRoot,source,version:'1.0.0',selector,run})
  await compensation.register()
  const adapter=await createIsolatedCodexInstallerAdapter({isolationRoot:f.root,userRoot:f.userRoot,run})
  const before=await userSnapshot(f.userRoot),count=calls.length
  await assert.rejects(planInstallation({...f.options,adapter}),/Legacy design-system plugin/)
  assert.ok(calls.slice(count).every(args=>args[1]==='list'))
  assert.deepEqual(await userSnapshot(f.userRoot),before)
  await compensation.compensate()
  await assert.rejects(lstat(cache),{code:'ENOENT'})
  assert.ok(calls.some(args=>args[1]==='remove'&&args[2]===selector))
})
