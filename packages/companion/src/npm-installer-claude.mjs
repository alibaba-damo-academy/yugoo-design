/** Claude user-scope transactions. No model sessions, direct settings rollback or cache purge. */
import { resolveNodeRuntime, verifyNodeRuntime } from './npm-node-runtime.mjs'
import { nodeRegistrationFiles, writeNodeRegistrationFiles, nodeRuntimePin } from './npm-node-registration.mjs'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { assertRuntimePath, inspectRuntime, assertGitRuntimeReceipt } from './npm-runtime-check.mjs'

const execute = promisify(execFile), adapters = new WeakMap(), activeLocks = new Set()
const PLUGIN = 'yugoo-design', LEGACY = 'design-system'
const MARKET = 'yugoo-design-local', SELECTOR = PLUGIN + '@' + MARKET, OWNER = '.yugoo-claude-owner.json'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value
const digest = value => sha(JSON.stringify(canonical(value)))
const encode = value => JSON.stringify(value,null,2)+'\n'
const beneath = (root,path) => { const d=relative(root,path);return d===''||(!isAbsolute(d)&&d!=='..'&&!d.startsWith('../')) }
async function json(path, optional=false) {
  await assertRuntimePath(path)
  try { assert.ok((await lstat(path)).isFile(),'Expected regular JSON');return JSON.parse(await readFile(path,'utf8')) }
  catch(error) { if(optional&&error.code==='ENOENT')return null;throw error }
}
async function tree(root) {
  await assertRuntimePath(root)
  try { assert.ok((await lstat(root)).isDirectory(),'Expected directory') }
  catch(error) { if(error.code==='ENOENT')return null;throw error }
  const files={}
  async function walk(dir) {
    for(const name of (await readdir(dir)).sort()) {
      const file=join(dir,name),info=await lstat(file)
      assert.ok(!info.isSymbolicLink(),'Registration symlink rejected')
      if(info.isDirectory()) { files[relative(root,file)]=null;await walk(file) }
      else { assert.ok(info.isFile(),'Unexpected registration file type');files[relative(root,file)]=sha(await readFile(file)) }
    }
  }
  await walk(root);return files
}
async function atomic(path,value) {
  await assertRuntimePath(path)
  const temp=path+'.'+randomUUID()+'.tmp'
  await writeFile(temp,encode(value),{flag:'wx',mode:0o600});await rename(temp,path)
}
function pluginName(selector) {
  assert.ok([SELECTOR,LEGACY+'@'+MARKET].includes(selector),'Unexpected Claude selector')
  return selector.split('@')[0]
}
function locations(userRoot,plugin=PLUGIN) {
  const config=join(userRoot,'.claude'),target=join(userRoot,'.local/share/yugoo-design/claude-code')
  return {config,target,plugin:join(target,'plugins',plugin),marketplace:join(target,'.claude-plugin/marketplace.json')}
}
async function executableFence(s) {
  const exe=s.identity.executable
  await assertRuntimePath(exe);assert.equal(await realpath(exe),exe,'Claude canonical executable changed')
  assert.ok((await lstat(exe)).isFile(),'Claude executable must remain regular')
  assert.equal(sha(await readFile(exe)),s.identity.sha256,'Claude executable changed')
}
async function nativeCwdFence(s) {
  const cwd=s.identity.nativeCwd
  await assertRuntimePath(cwd)
  assert.equal(await realpath(cwd),cwd,'Claude canonical native working directory changed')
  const info=await lstat(cwd)
  assert.ok(info.isDirectory(),'Claude native working directory must be a directory')
  assert.deepEqual({dev:info.dev,ino:info.ino},s.nativeCwdIdentity,'Claude native working directory replaced')
  assert.notEqual(cwd,s.userRoot,'Claude native working directory must differ from HOME')
  for(const name of ['settings.json','settings.local.json']) {
    const file=join(cwd,'.claude',name)
    await assertRuntimePath(file)
    try { await lstat(file);assert.fail('Claude native working directory contains direct .claude configuration') }
    catch(error) { if(error.code!=='ENOENT')throw error }
  }
}
function protocolIdentity(s) { const {scope,...identity}=s.identity;return identity }
async function state(adapter) {
  const s=adapters.get(adapter);assert.ok(s,'Unrecognized Claude adapter')
  await executableFence(s);await nativeCwdFence(s);return s
}
async function call(s,args) {
  await executableFence(s);await nativeCwdFence(s)
  let result
  try { result=await s.run(s.identity.executable,args,{cwd:s.identity.nativeCwd,env:s.env,timeout:30000,maxBuffer:1048576}) }
  finally { await executableFence(s);await nativeCwdFence(s) }
  assert.ok(result.code===undefined||result.code===0,'Claude command failed')
  assert.ok(!result.signal,'Claude command signalled');return result.stdout??''
}
/** Read-only factory. Injected runners are confined to explicitly isolated profiles. */
export async function createClaudeNativeAdapter({executable,userRoot,nativeCwd,scope='plan-only',run=execute}) {
  assert.ok(['plan-only','isolated-acceptance','isolated-test-contract','production'].includes(scope),'Unknown Claude scope')
  assert.ok(isAbsolute(executable??'')&&isAbsolute(userRoot??''),'Explicit Claude executable/profile required')
  assert.ok(isAbsolute(nativeCwd??''),'Explicit Claude native working directory required')
  assert.equal(resolve(nativeCwd),nativeCwd,'Explicit canonical Claude native working directory required')
  const exe=await realpath(executable),home=resolve(userRoot)
  await assertRuntimePath(exe);await assertRuntimePath(home)
  assert.equal(await realpath(home),home);assert.ok((await lstat(home)).isDirectory())
  await assertRuntimePath(nativeCwd);assert.equal(await realpath(nativeCwd),nativeCwd,'Claude canonical native working directory changed')
  const cwdInfo=await lstat(nativeCwd)
  assert.ok(cwdInfo.isDirectory(),'Claude native working directory must be a directory')
  if(scope.startsWith('isolated-'))assert.notEqual(home,resolve(homedir()),'Isolated Claude cannot use actual profile')
  else { assert.equal(run,execute,'Real profile cannot use injected transport');assert.equal(home,resolve(homedir()),'Real profile identity required') }
  const identity={executable:exe,sha256:sha(await readFile(exe)),userRoot:home,configDir:locations(home).config,nativeCwd,platform:process.platform,arch:process.arch,scope}
  const config=identity.configDir
  const env={HOME:home,CLAUDE_CONFIG_DIR:config,PATH:dirname(process.execPath)+':/usr/bin:/bin',
    XDG_CONFIG_HOME:join(home,'.config'),XDG_CACHE_HOME:join(home,'.cache'),XDG_DATA_HOME:join(home,'.local/share'),
    TMPDIR:join(config,'tmp'),LANG:'C.UTF-8',LC_ALL:'C.UTF-8',DISABLE_AUTOUPDATER:'1',NODE_OPTIONS:'',NODE_PATH:''}
  const s={identity,userRoot:home,run,env,nativeCwdIdentity:{dev:cwdInfo.dev,ino:cwdInfo.ino}}
  const version=(await call(s,['--version'])).trim().match(/^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?) \(Claude Code\)$/)
  assert.ok(version,'Expected Claude Code native executable');identity.version=version[1]
  // Check the native interface we actually use, not one developer's binary hash.
  // The selected executable bytes are still fenced for every subsequent call.
  if(scope!=='isolated-test-contract')for(const [args,options] of [
    [['plugin','list','--help'],['--json']],[['plugin','marketplace','list','--help'],['--json']],
    [['plugin','install','--help'],['--scope']],[['plugin','uninstall','--help'],['--scope','--keep-data']],
    [['plugin','marketplace','add','--help'],['--scope']],[['plugin','marketplace','remove','--help'],['--scope']],
  ]) {
    const help=await call(s,args)
    for(const option of options)assert.ok(help.includes(option),`Claude native capability missing: ${args.join(' ')} ${option}`)
  }
  const adapter=Object.freeze({scope:'claude-native-transaction',identity:structuredClone(identity)})
  adapters.set(adapter,s);return adapter
}
function mutationAdmission(s) {
  assert.ok(s.identity.scope==='production'||s.identity.scope.startsWith('isolated-'),'Claude mutation requires an apply adapter, not a read-only plan adapter')
}
async function lists(s) {
  const markets=JSON.parse(await call(s,['plugin','marketplace','list','--json']))
  const plugins=JSON.parse(await call(s,['plugin','list','--json']))
  assert.ok(Array.isArray(markets)&&Array.isArray(plugins),'Claude list must be JSON arrays')
  assert.ok(markets.every(row=>row&&typeof row.name==='string'),'Unknown marketplace row')
  assert.ok(plugins.every(row=>row&&typeof row.id==='string'&&typeof row.scope==='string'),'Unknown plugin row')
  return {markets,plugins}
}
function ownedRows(rows,plan) {
  const markets=rows.markets.filter(row=>row.name===MARKET),plugins=rows.plugins.filter(row=>row.id===plan.selector)
  assert.ok(markets.length<=1&&plugins.length<=1,'Ambiguous or multi-scope Claude ownership')
  if(markets[0])assert.deepEqual(markets[0],{name:MARKET,source:'directory',path:plan.paths.target,installLocation:plan.paths.target},'Foreign marketplace source')
  if(plugins[0]) {
    const row=plugins[0]
    assert.equal(row.scope,'user','Foreign plugin scope');assert.equal(row.version,plan.package.version,'Plugin version conflict; upgrade not supported')
    assert.equal(row.enabled,true,'Owned plugin was disabled or changed')
    const expected=join(plan.paths.config,'plugins/cache',MARKET,pluginName(plan.selector),plan.package.version)
    assert.equal(row.installPath,expected,'Unexpected Claude cache path')
  }
  // A marketplace removal cascades to every plugin; only a dedicated market is eligible.
  assert.ok(!rows.plugins.some(row=>row.id!==plan.selector&&row.id.endsWith('@'+MARKET)),'Foreign plugin shares managed marketplace')
  return {market:markets[0]??null,plugin:plugins[0]??null}
}
async function foreignState(s,rows,plan) {
  const settings=await json(join(locations(s.userRoot).config,'settings.json'),true)??{}
  for(const [key,owned] of [['enabledPlugins',plan.selector],['extraKnownMarketplaces',MARKET]]) {
    if(settings[key]) { assert.ok(typeof settings[key]==='object'&&!Array.isArray(settings[key]));delete settings[key][owned];if(!Object.keys(settings[key]).length)delete settings[key] }
  }
  return {markets:rows.markets.filter(row=>row.name!==MARKET),plugins:rows.plugins.filter(row=>row.id!==plan.selector),settings}
}
async function verifyCache(plan,owned,expected) {
  assert.ok(owned.market&&owned.plugin,'Claude registration incomplete')
  assert.deepEqual(await tree(owned.plugin.installPath),expected,'Claude cached overlay changed')
}
async function acquireLease(directory,id,fn,recovery=false) {
  await assertRuntimePath(directory);await mkdir(directory,{recursive:true})
  const path=join(directory,'claude-install.lock');assert.ok(!activeLocks.has(path),'Concurrent in-process Claude transaction')
  try { await writeFile(path,encode({id,pid:process.pid}),{flag:'wx',mode:0o600}) }
  catch(error) {
    if(error.code!=='EEXIST'||!recovery)throw error
    const previous=await json(path);assert.equal(previous.id,id,'Foreign recovery lease')
    assert.ok(Number.isInteger(previous.pid)&&previous.pid>0,'Invalid recovery lease PID')
    let alive=true;try{process.kill(previous.pid,0)}catch(e){if(e.code==='ESRCH')alive=false;else throw e}
    assert.ok(!alive,'Claude transaction is still live')
    assert.deepEqual(await json(path),previous,'Recovery lease changed');await unlink(path)
    await writeFile(path,encode({id,pid:process.pid}),{flag:'wx',mode:0o600})
  }
  activeLocks.add(path)
  try{return await fn()}finally{activeLocks.delete(path);assert.deepEqual(await json(path),{id,pid:process.pid},'Claude lease ownership changed');await unlink(path)}
}
async function lock(directory,id,fn,recovery=false) {
  if(!recovery)return acquireLease(directory,id,fn)
  await assertRuntimePath(directory);await mkdir(directory,{recursive:true})
  const guard=join(directory,id+'.claude-recovery.lock')
  await assertRuntimePath(guard);await mkdir(guard)
  const identity=await lstat(guard)
  try { return await acquireLease(directory,id,fn,true) }
  finally {
    const current=await lstat(guard)
    assert.equal(current.dev,identity.dev,'Claude recovery guard changed')
    assert.equal(current.ino,identity.ino,'Claude recovery guard changed')
    await rmdir(guard)
  }
}
function validatePlan(plan) {
  const {planSha256,...body}=plan;assert.equal(digest(body),planSha256,'Claude plan body digest mismatch')
  assert.ok(typeof plan.protocol?.nativeCwd==='string','Claude protocol missing nativeCwd; use the retained installed implementation for its existing receipts')
  assert.equal(plan.host,'claude-code');assert.equal(plan.scope,'user');pluginName(plan.selector)
  for(const key of ['npmRoot','userRoot','receiptDirectory'])assert.ok(isAbsolute(plan[key])&&resolve(plan[key])===plan[key],'Noncanonical Claude plan path')
  assert.ok(!beneath(plan.npmRoot,plan.receiptDirectory)&&!beneath(plan.paths.target,plan.receiptDirectory),'Receipt overlaps owned inputs')
  assert.deepEqual(plan.paths,locations(plan.userRoot,pluginName(plan.selector)),'Claude plan path mismatch')
}
/** Read-only plan, before any ownership or host registration writes. */
export async function planClaudeInstallation({npmRoot,userRoot,receiptDirectory,adapter,disableEmbedding=false,nodeExecutable,nodeRuntime}) {
  nodeRuntime=nodeRuntime?structuredClone(nodeRuntime):undefined
  const s=await state(adapter),root=resolve(npmRoot),home=resolve(userRoot),receipts=resolve(receiptDirectory)
  assert.equal(home,s.userRoot,'Claude profile mismatch')
  for(const path of [root,home,receipts])await assertRuntimePath(path)
  assert.equal(await realpath(root),root)
  const paths=locations(home);assert.ok(!beneath(root,receipts)&&!beneath(paths.target,receipts),'Receipt must be outside npm and registration')
  assert.ok(!beneath(root,paths.target)&&!beneath(paths.target,root),'Registration must be outside retained npm package')
  const manifest=await json(join(root,'package.json')),overlay=join(root,'payload/overlays/claude-code')
  assert.ok(typeof manifest.name==='string');assert.match(manifest.version??'',/^[A-Za-z0-9_.+-]+$/u)
  const files=await tree(root),overlayFiles=await tree(overlay)
  assert.ok(files?.['payload/shared/scripts/design.mjs'],'Missing shared npm entry')
  const plugin=await json(join(overlay,'.claude-plugin/plugin.json'));assert.equal(plugin.name,PLUGIN);assert.equal(plugin.version,manifest.version)
  assert.deepEqual((await json(join(overlay,'.mcp.json'))).mcpServers?.['design-system'],{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/scripts/design.mjs','mcp']},'Unexpected Claude MCP entry')
  for(const name of ['scripts/design.mjs','skills/yugoo/SKILL.md'])assert.ok(overlayFiles[name],`Missing Claude overlay: ${name}`)
  nodeRuntime??=await resolveNodeRuntime({nodeExecutable}); await verifyNodeRuntime(nodeRuntime)
  const plan={nodeRuntime,schemaVersion:1,host:'claude-code',route:'claude-local-marketplace',scope:'user',selector:SELECTOR,npmRoot:root,userRoot:home,receiptDirectory:receipts,
    package:{name:manifest.name,version:manifest.version},fixture:manifest['x-design-release-review']?.fixture===true,
    paths,overlay,packageInventorySha256:digest(files),overlayInventory:overlayFiles,protocol:protocolIdentity(s),disableEmbedding,
    runtimePrerequisites:await inspectRuntime({npmRoot:root,host:'claude-code',disableEmbedding,nodeRuntime}),releaseValidated:false}
  const before=await tree(paths.target),rows=await lists(s)
  assert.ok(!rows.plugins.some(row=>row.id.startsWith(LEGACY+'@')),'Legacy design-system plugin found. Uninstall using its original receipt or native exact selector before installing yugoo-design; no changes made.')
  if(before) {
    const oldManifest=await json(join(paths.target,'plugins',LEGACY,'.claude-plugin/plugin.json'),true)
    assert.equal(oldManifest,null,'Legacy design-system source found. Recover or uninstall using its original receipt before installing yugoo-design; no changes made.')
  }
  const owned=ownedRows(rows,plan)
  plan.before={registration:before,native:rows};plan.action='install'
  if(before) {
    const owner=await json(join(paths.target,OWNER));assert.equal(owner.npmRoot,root);assert.deepEqual(owner.package,plan.package,'Version/source conflict; use explicit recovery')
    assert.equal(owner.userRoot,home);assert.equal(owner.receiptDirectory,receipts)
    const old=await json(join(receipts,owner.id+'.claude-receipt.json'))
    validatePlan(old.plan)
    assert.deepEqual(nodeRuntimePin(old.plan.nodeRuntime),nodeRuntimePin(nodeRuntime),'Node selection changed; use the original uninstall receipt before rebinding')
    assert.deepEqual(old.plan.protocol,protocolIdentity(s),'Previous Claude protocol changed')
    assert.equal(old.phase,'verified','Incomplete Claude transaction requires recovery')
    assert.equal(old.id,owner.id);assert.equal(old.plan.npmRoot,root);assert.equal(old.plan.userRoot,home)
    assert.deepEqual(old.plan.package,plan.package);assert.deepEqual(before,old.sourceFiles,'Owned registration changed')
    await verifyCache(plan,owned,old.cacheFiles);plan.action='already-registered';plan.previousReceiptFile=old.receiptFile
  } else assert.ok(!owned.market&&!owned.plugin,'Unowned native Claude registration exists')
  return {...plan,planSha256:digest(plan)}
}
function runtimeGate(plan,receipt,current,s) {
  assert.ok(receipt&&typeof receipt==='object'&&!Array.isArray(receipt),'Explicit Claude runtime receipt required')
  assertGitRuntimeReceipt(receipt,current)
  assert.ok(['installed-runtime-readonly','isolated-test-contract'].includes(receipt.scope),'Unknown runtime receipt scope')
  if(!s.identity.scope.startsWith('isolated-'))assert.equal(receipt.scope,'installed-runtime-readonly','Production requires actual runtime receipt')
  assert.equal(receipt.npmRoot,plan.npmRoot);assert.equal(receipt.identitySha256,current.identitySha256,'Runtime receipt identity drift')
  for(const key of ['observation','embedding','pins','runtime','native','sharp','prerequisites'])assert.deepEqual(receipt[key],current[key],`Runtime receipt ${key} mismatch`)
  for(const key of ['nativeHostRegistrationVerified','transformersVerified','semanticKagVerified','graVerified','licenseObligationsAccepted','releaseValidated'])assert.equal(receipt[key],false)
  if(plan.disableEmbedding) {
    assert.equal(current.status,'disabled');assert.equal(receipt.status,'disabled');assert.equal(receipt.embedding.provider,'disabled');assert.equal(receipt.embedding.selection,'explicit-cli');assert.equal(receipt.load?.status,'not-run')
  } else {
    assert.equal(current.status,'present');assert.equal(receipt.status,'load-verified');assert.equal(receipt.embedding.provider,'local');assert.equal(receipt.load?.status,'passed');assert.equal(receipt.load.code,0);assert.equal(receipt.load.signal,null)
    assert.equal(receipt.load.observation?.node,current.observation.node);assert.equal(receipt.load.observation?.execPath,current.observation.execPath);assert.ok(receipt.load.observation?.native?.includes(current.native.path))
    if(receipt.scope==='installed-runtime-readonly'){assert.ok(Number.isInteger(receipt.load.childPid)&&receipt.load.childPid>0);assert.equal(receipt.load.childAbsent,true)}
  }
}
async function validateReceipt(receipt,s) {
  assert.match(receipt.id??'',/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);validatePlan(receipt.plan)
  assert.equal(receipt.host,'claude-code');assert.equal(receipt.npmRoot,receipt.plan.npmRoot);assert.equal(receipt.userRoot,receipt.plan.userRoot)
  assert.deepEqual(receipt.package,receipt.plan.package,'Claude receipt package mismatch')
  assert.equal(receipt.receiptFile,join(receipt.plan.receiptDirectory,receipt.id+'.claude-receipt.json'))
  assert.equal(receipt.plan.userRoot,s.userRoot);assert.deepEqual(receipt.plan.protocol,protocolIdentity(s))
  assert.deepEqual(await json(receipt.receiptFile),receipt,'Stale or edited caller receipt')
  const p=receipt.plan
  assert.equal(digest(await tree(p.npmRoot)),p.packageInventorySha256,'Retained npm package changed')
  const source=await tree(p.paths.target)
  if(source) {
    if(!receipt.marketAttempted&&!receipt.installAttempted&&receipt.publicationCompleted!==true) {
      for(const [name,pin] of Object.entries(source)) {
        const original=name===`plugins/${pluginName(p.selector)}/scripts/design.mjs`?p.overlayInventory['scripts/design.mjs']:undefined
        assert.ok(Object.hasOwn(receipt.sourceFiles,name)&&(pin===receipt.sourceFiles[name]||pin===original),'Partial source changed; retain for conflict resolution')
      }
    } else assert.deepEqual(source,receipt.sourceFiles,'Owned source changed; retain for conflict resolution')
    assert.deepEqual(await json(join(p.paths.target,OWNER)),{id:receipt.id,npmRoot:p.npmRoot,package:p.package,userRoot:p.userRoot,receiptDirectory:p.receiptDirectory},'Claude owner changed')
  } else assert.ok(!['verified','published'].includes(receipt.phase),'Owned registration disappeared')
}
async function compensate(receipt,s) {
  await validateReceipt(receipt,s)
  const p=receipt.plan,rows=await lists(s),owned=ownedRows(rows,p)
  if(receipt.phase==='rolled-back') { assert.ok(!owned.market&&!owned.plugin,'Claude registration reappeared');return receipt }
  if(owned.plugin) {
    assert.ok(receipt.installAttempted,'Foreign plugin without owned install intent');await verifyCache(p,owned,receipt.cacheFiles)
    const foreign=await foreignState(s,rows,p);receipt.phase='uninstall-intent';await atomic(receipt.receiptFile,receipt)
    await call(s,['plugin','uninstall',p.selector,'--scope','user','--keep-data'])
    const after=await lists(s);assert.ok(!ownedRows(after,p).plugin,'Claude uninstall not observed');assert.deepEqual(await foreignState(s,after,p),foreign,'Foreign state changed during uninstall')
  }
  const current=await lists(s),market=ownedRows(current,p)
  if(market.market) {
    assert.ok(receipt.marketAttempted,'Foreign marketplace without owned add intent')
    assert.ok(!market.plugin,'Plugin remains; marketplace cascade forbidden')
    const foreign=await foreignState(s,current,p);receipt.phase='market-remove-intent';await atomic(receipt.receiptFile,receipt)
    await call(s,['plugin','marketplace','remove',MARKET,'--scope','user'])
    const after=await lists(s);assert.ok(!ownedRows(after,p).market,'Claude marketplace removal not observed');assert.deepEqual(await foreignState(s,after,p),foreign,'Foreign state changed during marketplace removal')
  }
  if(await tree(p.paths.target)) { await validateReceipt(receipt,s);await rm(p.paths.target,{recursive:true}) }
  receipt.phase='rolled-back';receipt.rollbackCompleted=true;await atomic(receipt.receiptFile,receipt);return receipt
}
export async function applyClaudeInstallation(plan,{adapter,runtimeReceipt,checkpoint=async()=>{}}={}) {
  plan=structuredClone(plan);validatePlan(plan)
  const s=await state(adapter);mutationAdmission(s)
  if(s.identity.scope==='production')assert.equal(plan.fixture,false,'Production rejects fixture packages')
  const boundRuntime=structuredClone(runtimeReceipt),id=randomUUID()
  const initial=await planClaudeInstallation({...plan,adapter})
  assert.equal(initial.planSha256,plan.planSha256,'Stale Claude plan')
  runtimeGate(plan,boundRuntime,initial.runtimePrerequisites,s)
  return lock(plan.receiptDirectory,id,async()=> {
    const fresh=await planClaudeInstallation({...plan,adapter});assert.equal(fresh.planSha256,plan.planSha256,'Stale Claude plan')
    runtimeGate(plan,boundRuntime,fresh.runtimePrerequisites,s)
    if(plan.action==='already-registered')return {...await json(plan.previousReceiptFile),idempotent:true}
    const owner={id,npmRoot:plan.npmRoot,package:plan.package,userRoot:plan.userRoot,receiptDirectory:plan.receiptDirectory}
    const launcher=`import { existsSync } from 'node:fs'\nconst entry=new URL(${JSON.stringify(pathToFileURL(join(plan.npmRoot,'payload/shared/scripts/design.mjs')).href)})\nif(!existsSync(entry))throw new Error('Retained npm Companion entry is missing')\nawait import(entry.href)\n`
    const marketplace={name:MARKET,owner:{name:'yugoo-design'},plugins:[{name:PLUGIN,source:'./plugins/'+PLUGIN}]}
    const nodeFiles=plan.nodeRuntime?await nodeRegistrationFiles(plan.overlay,'claude-code',plan.nodeRuntime):{}
    const cacheFiles={...plan.overlayInventory,...Object.fromEntries(Object.entries(nodeFiles).map(([path,text])=>[path,sha(text)])),'scripts/design.mjs':sha(launcher)}
    const sourceFiles={'.claude-plugin':null,plugins:null,['plugins/'+PLUGIN]:null,
      [OWNER]:sha(encode(owner)),'.claude-plugin/marketplace.json':sha(encode(marketplace)),
      ...Object.fromEntries(Object.entries(cacheFiles).map(([name,pin])=>['plugins/'+PLUGIN+'/'+name,pin]))}
    const receipt={schemaVersion:1,id,host:'claude-code',npmRoot:plan.npmRoot,userRoot:plan.userRoot,package:plan.package,plan,receiptFile:join(plan.receiptDirectory,id+'.claude-receipt.json'),phase:'prepared',runtimeReceiptSha256:digest(boundRuntime),sourceFiles,cacheFiles,publicationCompleted:false,marketAttempted:false,installAttempted:false,rollbackCompleted:false,releaseValidated:false}
    await atomic(receipt.receiptFile,receipt)
    try {
      const target=plan.paths.target
      await mkdir(dirname(target),{recursive:true});await mkdir(target)
      await writeFile(join(target,OWNER),encode(owner),{flag:'wx'})
      await mkdir(join(target,'.claude-plugin'));await mkdir(join(target,'plugins'))
      await cp(plan.overlay,plan.paths.plugin,{recursive:true,errorOnExist:true,force:false})
      await writeFile(join(plan.paths.plugin,'scripts/design.mjs'),launcher)
      await writeNodeRegistrationFiles(plan.paths.plugin,nodeFiles)
      await writeFile(plan.paths.marketplace,encode(marketplace),{flag:'wx'})
      assert.deepEqual(await tree(target),receipt.sourceFiles,'Published Claude source differs from plan')
      receipt.publicationCompleted=true;receipt.phase='published';await atomic(receipt.receiptFile,receipt)
      await checkpoint('published',structuredClone(receipt))
      const before=await lists(s);assert.ok(!ownedRows(before,plan).market&&!ownedRows(before,plan).plugin,'Native state changed before registration')
      const foreign=await foreignState(s,before,plan)
      if(plan.nodeRuntime)await verifyNodeRuntime(plan.nodeRuntime)
      receipt.marketAttempted=true;receipt.phase='market-add-intent';await atomic(receipt.receiptFile,receipt)
      await call(s,['plugin','marketplace','add',target,'--scope','user'])
      const added=await lists(s);assert.ok(ownedRows(added,plan).market);assert.deepEqual(await foreignState(s,added,plan),foreign,'Foreign state changed during marketplace add')
      if(plan.nodeRuntime)await verifyNodeRuntime(plan.nodeRuntime)
      receipt.installAttempted=true;receipt.phase='install-intent';await atomic(receipt.receiptFile,receipt)
      await call(s,['plugin','install',SELECTOR,'--scope','user'])
      const installed=await lists(s);await verifyCache(plan,ownedRows(installed,plan),receipt.cacheFiles);assert.deepEqual(await foreignState(s,installed,plan),foreign,'Foreign state changed during install')
      receipt.phase='verified';await atomic(receipt.receiptFile,receipt);await checkpoint('verified',structuredClone(receipt));return receipt
    } catch(error) {
      receipt.failure=String(error.message);receipt.phase='recovery-required';await atomic(receipt.receiptFile,receipt)
      try { await compensate(receipt,s) } catch(recovery) { receipt.phase='recovery-required';receipt.recoveryError=String(recovery.message);await atomic(receipt.receiptFile,receipt) }
      throw Object.assign(error,{receiptFile:receipt.receiptFile,receipt:structuredClone(receipt)})
    }
  })
}
export async function recoverClaudeInstallation(input,{adapter,uninstall=false}={}) {
  const receipt=structuredClone(input),s=await state(adapter);mutationAdmission(s)
  if(uninstall)assert.ok(['verified','rolled-back'].includes(receipt.phase),'Uninstall requires successful or completed receipt')
  await validateReceipt(receipt,s)
  return lock(receipt.plan.receiptDirectory,receipt.id,async()=>compensate(receipt,s),true)
}
