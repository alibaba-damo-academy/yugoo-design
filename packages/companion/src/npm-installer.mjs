import { isPathWithin } from './npm-installer-paths.mjs'
import { resolveNodeRuntime, verifyNodeRuntime } from './npm-node-runtime.mjs'
import { nodeRegistrationFiles, writeNodeRegistrationFiles, nodeRuntimePin } from './npm-node-registration.mjs'
import { assertWindowsPrivate, ensureWindowsPrivateDirectory } from './windows-private-storage.mjs'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { codexAdapter, assertCodexAdmission, createCodexNativeAdapter } from './npm-installer-codex.mjs'
import { createClaudeNativeAdapter, planClaudeInstallation, applyClaudeInstallation, recoverClaudeInstallation } from './npm-installer-claude.mjs'
import { installQoderPlugin } from './npm-installer-qoder.mjs'
import { checkRuntime, inspectRuntime, assertGitRuntimeReceipt } from './npm-runtime-check.mjs'
import { runDesktopDshInstaller } from './npm-installer-dsh-desktop.mjs'
import { desktopPreparationMain, desktopPreparationReuseMain } from './npm-desktop-preparation.mjs'
import { agentInstallation, AGENT_INSTALL_HOSTS, DESKTOP_INSTALL_OPTIONS } from './npm-agent-installation.mjs'
import { createDshInstallerAdapter, planDshInstallation, applyDshInstallation, validateReleaseHosts } from './npm-installer-dsh.mjs'

export const INSTALL_HOSTS = ['dsh','codex','claude-code','qoder','codex-desktop','qwenwork']
const PLUGIN = 'yugoo-design'
const LEGACY_PLUGIN = 'design-system'
function receiptPlugin(selector) {
  assert.match(selector ?? '', /^(?:yugoo-design|design-system)@[A-Za-z0-9_-]+$/u, 'Invalid owned plugin selector')
  return selector.split('@')[0]
}
const OWNER = '.design-system-registration.json'
const activeTransactions = new Set()
const internalRecovery = Symbol('in-process-install-compensation')
const internalUninstall = Symbol('successful-install-uninstall')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value==='object'
  ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])) : value
const digest = value => sha(JSON.stringify(sorted(value)))
const encode = value => JSON.stringify(value,null,2)+'\n'
const outside = (root,path) => !isPathWithin(root,path)

async function safePath(path) {
  for(let cursor=resolve(path);;cursor=dirname(cursor)) {
    try { assert.ok(!(await lstat(cursor)).isSymbolicLink(),`Symlink path rejected: ${cursor}`) }
    catch(error){if(error.code!=='ENOENT')throw error}
    if(cursor===dirname(cursor))break
  }
}
async function optional(path) {
  await safePath(path)
  try { assert.ok((await lstat(path)).isFile(),'Expected regular configuration file'); return await readFile(path,'utf8') }
  catch(error){if(error.code==='ENOENT')return null;throw error}
}
async function inventory(root) {
  await safePath(root)
  try{assert.ok((await lstat(root)).isDirectory(),'Expected directory')}catch(error){if(error.code==='ENOENT')return null;throw error}
  const files={}
  async function walk(dir) {
    for(const name of (await readdir(dir)).sort()) {
      const path=join(dir,name),info=await lstat(path)
      assert.ok(!info.isSymbolicLink(),'Registration/package symlink rejected')
      if(info.isDirectory())await walk(path)
      else{assert.ok(info.isFile(),'Special file rejected');files[relative(root,path)]=sha(await readFile(path))}
    }
  }
  await walk(root);return files
}
function locations(userRoot) {
  return { target:join(userRoot,'.local/share/design-system/registrations/codex'),
    marketplace:join(userRoot,'.agents/plugins/marketplace.json') }
}
function marketplace(text) {
  const value=text===null?{name:'personal',plugins:[]}:JSON.parse(text)
  assert.match(value.name??'',/^[A-Za-z0-9_-]+$/u)
  assert.ok(Array.isArray(value.plugins),'Invalid marketplace plugins')
  for(const name of [PLUGIN,LEGACY_PLUGIN])assert.ok(value.plugins.filter(p=>p.name===name).length<=1,'Duplicate Yugoo Design entries')
  return value
}
function managedEntry(value,target,userRoot) {
  const entry=value.plugins.find(p=>p.name===PLUGIN)
  if(entry)assert.deepEqual(entry.source,{source:'local',path:'./'+relative(userRoot,target).split('\\').join('/')},'Unmanaged or incompatible Design System entry')
  return entry??null
}

export async function planInstallation({ npmRoot,host,userRoot=homedir(),receiptDirectory,adapter=codexAdapter,disableEmbedding=false,nodeExecutable,nodeRuntime }) {
  nodeRuntime=nodeRuntime?structuredClone(nodeRuntime):undefined
  assert.ok(INSTALL_HOSTS.includes(host),'An explicit supported host is required; installed binaries are not active-host identity')
  const root=resolve(npmRoot),home=resolve(userRoot),receipts=resolve(receiptDirectory)
  await safePath(root);await safePath(home);await safePath(receipts)
  assert.equal(await realpath(root),root);assert.equal(await realpath(home),home)
  assert.ok(outside(root,receipts),'Receipt directory must be outside npm package')
  const manifest=JSON.parse(await optional(join(root,'package.json')))
  const admission=host==='codex'&&adapter.scope==='codex-native-transaction'?assertCodexAdmission(adapter):null
  if(admission==='production')assert.notEqual(manifest['x-design-release-review']?.fixture,true,'Production installation rejects review-fixture packages')
  assert.ok(typeof manifest.name==='string'&&typeof manifest.version==='string','Versioned npm package required')
  assert.match(manifest.version,/^[A-Za-z0-9_.+-]+$/u,'Unsafe package version')
  const packageFiles=await inventory(root)
  assert.ok(packageFiles['payload/shared/scripts/design.mjs'],'Missing shared CLI')
  if(host==='codex') { nodeRuntime??=await resolveNodeRuntime({nodeExecutable}); await verifyNodeRuntime(nodeRuntime) }
  const common={...(nodeRuntime?{nodeRuntime}:{}),schemaVersion:1,host,route:host==='dsh'?'dsh-package':'companion-registration',npmRoot:root,
    userRoot:home,receiptDirectory:receipts,package:{name:manifest.name,version:manifest.version},
    packageInventorySha256:digest(packageFiles),fixture:manifest['x-design-release-review']?.fixture===true,
    platform:process.platform,arch:process.arch,node:process.versions.node,disableEmbedding,
    runtimePrerequisites:await inspectRuntime({npmRoot:root,host,disableEmbedding,nodeRuntime}),
    hostRegistered:false,mcpReady:false,bundleCycleVerified:false,panelVerified:false,graVerified:false,kagVerified:false,releaseValidated:false }
  if(host!=='codex') {
    const plan={...common,registrationPending:true,applySupported:false,
      blockedReason:host==='dsh'?'A verified public DSH aggregate selector and official Loader protocol are required.':'Native host registration protocol is pending verification.'}
    return {...plan,planSha256:digest(plan)}
  }
  const paths=locations(home)
  assert.ok(outside(paths.target,receipts),'Receipt directory cannot be inside registration target')
  assert.ok(outside(root,paths.target)&&outside(paths.target,root),'Registration must be separate from shared npm root')
  const overlay=join(root,'payload/overlays/codex'),overlayFiles=await inventory(overlay)
  assert.ok(overlayFiles?.['.codex-plugin/plugin.json']&&overlayFiles?.['.mcp.json'],'Missing Codex overlay')
  const plugin=JSON.parse(await optional(join(overlay,'.codex-plugin/plugin.json')))
  assert.equal(plugin.name,PLUGIN);assert.equal(plugin.version,manifest.version)
  assert.equal(plugin.skills,'./skills/');assert.equal(plugin.mcpServers,'./.mcp.json')
  for(const path of ['scripts/design.mjs','skills/yugoo/SKILL.md','skills/design-panel/SKILL.md','skills/design-panel/native-execution.md'])
    assert.ok(overlayFiles[path],`Missing Codex registration asset: ${path}`)
  const mcp=JSON.parse(await optional(join(overlay,'.mcp.json'))).mcpServers?.['design-system']
  assert.deepEqual(mcp,{command:'node',args:['scripts/design.mjs','mcp'],cwd:'.'},'Unexpected Codex MCP entry')
  const text=await optional(paths.marketplace),catalog=marketplace(text)
  assert.ok(!catalog.plugins.some(p=>p.name===LEGACY_PLUGIN),'Legacy design-system registration found. Use the previous install receipt to uninstall it before installing yugoo-design; do not delete projects or replace old configuration.')
  if(adapter.assertPluginIdentityAvailable)await adapter.assertPluginIdentityAvailable()
  const direct=await optional(join(home,'plugins/design-system/.codex-plugin/plugin.json'))
  assert.equal(direct,null,'Legacy direct Codex package found at ~/plugins/design-system; uninstall its exact old selector and resolve its marketplace registration before installing yugoo-design.')
  const entry=managedEntry(catalog,paths.target,home)
  const beforeTarget=await inventory(paths.target)
  let upgrade=null
  if(beforeTarget) {
    assert.ok(entry,'Unmanaged registration target')
    const owner=JSON.parse(await optional(join(paths.target,OWNER)))
    assert.equal(owner.host,'codex')
    const actual={...beforeTarget};delete actual[OWNER]
    assert.deepEqual(actual,owner.assetHashes,'Managed registration was edited')
    if(owner.npmRoot===root&&owner.version===manifest.version)
      assert.deepEqual(nodeRuntimePin(owner.nodeRuntime),nodeRuntimePin(nodeRuntime),'Node selection changed; use an owned version update or original uninstall receipt before rebinding')
    if(owner.npmRoot!==root||owner.version!==manifest.version) {
      assert.ok(admission!==null,'Upgrade requires an admitted native adapter')
      assert.notEqual(owner.version,manifest.version,'Same-version package relocation is not an upgrade')
      const previous=JSON.parse(await optional(owner.receiptPath))
      verifiedUpgradeReceipt(previous)
      assert.equal(owner.transactionId,previous.id);assert.equal(owner.planSha256,previous.planSha256)
      assert.equal(previous.receiptPath,owner.receiptPath)
      assert.equal(previous.target,paths.target);assert.equal(previous.userRoot,home)
      assert.equal(previous.npmRoot,owner.npmRoot);assert.equal(previous.package.version,owner.version)
      assert.equal(previous.package.name,manifest.name,'Upgrade package name mismatch')
      assert.equal(previous.receiptDirectory,receipts,'Upgrade must reuse the previous receipt directory and lease')
      assert.deepEqual(previous.afterEntry,entry,'Owned marketplace entry changed')
      assert.equal(previous.ownedTargetSha256,digest(beforeTarget),'Previous owned target changed')
      assert.equal(digest(await inventory(previous.npmRoot)),previous.packageInventorySha256,'Previous npm package changed')
      assert.deepEqual(previous.protocol,await adapter.probe(),'Previous native executable/profile changed')
      assert.equal(typeof adapter.inspectUpgrade,'function','Native replacement protocol unavailable')
      const native=await adapter.inspectUpgrade(previous)
      let nativeJournalSha256=null
      if(previous.upgrade)assert.deepEqual(native.tree,previous.newNativeTree,'Previous upgrade source/cache changed')
      else {
        const journal=JSON.parse(await optional(join(previous.receiptDirectory,previous.id+'.native.json')))
        assert.equal(journal.phase,'registered','Previous native journal is not registered')
        assert.deepEqual(journal.journalIdentity,{transactionId:previous.id,planSha256:previous.planSha256,protocol:previous.protocol},'Previous native journal identity mismatch')
        assert.equal(journal.source,paths.target);assert.equal(journal.userRoot,home)
        assert.equal(journal.selector,previous.selector);assert.equal(journal.version,previous.package.version)
        assert.deepEqual(native.tree,journal.expectedCache,'Previous native source/cache inventory changed')
        nativeJournalSha256=digest(journal)
      }
      upgrade={previousReceipt:previous,previousReceiptSha256:digest(previous),native,nativeJournalSha256}
    }
  } else assert.equal(entry,null,'Registration entry exists without owned target')
  const protocol=await adapter.probe()
  const plan={...common,...paths,overlay,overlayInventorySha256:digest(overlayFiles),
    beforeMarketplaceSha256:text===null?null:sha(text),beforeMarketplaceMissing:text===null,beforeEntry:entry,
    beforeTargetSha256:beforeTarget===null?null:digest(beforeTarget),selector:`${PLUGIN}@${catalog.name}`,protocol,
    ...(upgrade?{upgrade}:{}),
    registrationPending:true,applySupported:admission!==null,
    blockedReason:admission===null?'Native mutation requires a reviewed executable/profile admission.':null}
  return {...plan,planSha256:digest(plan)}
}

function verifiedUpgradeReceipt(receipt) {
  assert.equal(receipt.phase,'verified','Upgrade requires a successful installation receipt')
  assert.equal(receipt.hostRegistered,true);assert.equal(receipt.nativeAttempted,true)
  assert.match(receipt.id,/^[0-9a-f-]{36}$/u)
  assert.equal(receipt.receiptPath,join(resolve(receipt.receiptDirectory),receipt.id+'.receipt.json'))
  const {planSha256,...snapshot}=receipt.planSnapshot??{}
  assert.equal(planSha256,receipt.planSha256);assert.equal(digest(snapshot),planSha256,'Previous plan digest mismatch')
  for(const key of ['host','npmRoot','userRoot','receiptDirectory','package','packageInventorySha256','target','marketplace','selector','protocol'])
    assert.deepEqual(receipt[key],receipt.planSnapshot[key],'Previous receipt identity mismatch')
}

async function atomic(path,text) {
  await safePath(path);await mkdir(dirname(path),{recursive:true})
  const tmp=path+'.'+randomUUID()+'.tmp'
  try { await writeFile(tmp,text,{flag:'wx',mode:0o600});await rename(tmp,path) }
  finally { await rm(tmp,{force:true}) }
}
async function casMarketplace(path,expected,next) {
  assert.equal(await optional(path),expected,'Marketplace changed during transaction')
  if(next===null)await rm(path,{force:true});else await atomic(path,next)
}
async function removeOwnedTree(root,expectedSha256) {
  const files=await inventory(root)
  if(files===null)return
  assert.ok(expectedSha256&&digest(files)===expectedSha256,'Cleanup inventory changed; files retained')
  const identity=await lstat(root)
  const ownedDirectories=new Set([''])
  for(const path of Object.keys(files))for(let parent=dirname(path);parent!=='.';parent=dirname(parent))ownedDirectories.add(parent)
  async function checkDirectories(dir) {
    assert.ok(ownedDirectories.has(relative(root,dir)),'Unknown cleanup directory retained')
    for(const name of await readdir(dir)) {
      const child=join(dir,name),info=await lstat(child)
      if(info.isDirectory())await checkDirectories(child)
    }
  }
  await checkDirectories(root)
  const checkIdentity=async()=>{
    await safePath(root)
    const current=await lstat(root)
    assert.ok(current.dev===identity.dev&&current.ino===identity.ino,'Cleanup directory replaced; files retained')
  }
  // Never recursively remove a directory that may now contain foreign files.
  for(const [path,hash] of Object.entries(files)) {
    await checkIdentity()
    const file=join(root,path);await safePath(file)
    assert.equal(sha(await readFile(file)),hash,'Cleanup file changed; files retained')
    await unlink(file)
  }
  async function empty(dir) {
    await checkIdentity()
    assert.ok(ownedDirectories.has(relative(root,dir)),'Unknown cleanup directory retained')
    for(const name of await readdir(dir)) {
      const path=join(dir,name),info=await lstat(path)
      assert.ok(info.isDirectory()&&!info.isSymbolicLink(),'Foreign cleanup file retained')
      await empty(path)
    }
    await rmdir(dir)
  }
  await empty(root)
}
function testContract(adapter,userRoot) {
  if(adapter.scope==='codex-native-transaction') {
    assertCodexAdmission(adapter)
    return
  }
  assert.equal(adapter.scope,'isolated-test-contract','Native apply is plan-only until compensation is verified')
  assert.equal(adapter.nativeCompensationVerified,true,'Verified compensation required')
  assert.notEqual(resolve(userRoot),resolve(homedir()),'Isolated transaction cannot use the real user home')
  for(const name of ['probe','register','readback','compensate'])assert.equal(typeof adapter[name],'function')
}

function runtimeGate(plan,receipt,current,receiptSha256) {
  assert.ok(receipt&&typeof receipt==='object'&&!Array.isArray(receipt),'An explicit runtime-check receipt is required')
  assertGitRuntimeReceipt(receipt,current)
  assert.ok(['installed-runtime-readonly','isolated-test-contract'].includes(receipt.scope),'Unknown runtime receipt scope')
  assert.equal(receipt.npmRoot,plan.npmRoot,'Runtime receipt npmRoot mismatch')
  assert.equal(receipt.identitySha256,current.identitySha256,'Runtime receipt identity drift')
  for(const key of ['observation','embedding','pins','runtime','native','sharp','prerequisites'])
    assert.deepEqual(receipt[key],current[key],`Runtime receipt ${key} mismatch`)
  for(const key of ['nativeHostRegistrationVerified','transformersVerified','semanticKagVerified','graVerified','licenseObligationsAccepted','releaseValidated'])
    assert.equal(receipt[key],false,`Runtime receipt must not claim ${key}`)
  if(plan.disableEmbedding===true) {
    assert.equal(current.status,'disabled','Runtime configuration is not disabled')
    assert.equal(receipt.status,'disabled','Explicit disabled configuration requires matching receipt')
    assert.equal(receipt.embedding.provider,'disabled')
    assert.equal(receipt.embedding.selection,'explicit-cli')
    assert.equal(receipt.load?.status,'not-run')
  } else {
    assert.equal(current.status,'present','Required local runtime prerequisites are not present')
    assert.equal(receipt.status,'load-verified','Required local runtime load was not verified')
    assert.equal(receipt.embedding.provider,'local')
    assert.equal(receipt.load?.status,'passed','Required local runtime load failed')
    assert.equal(receipt.load.code,0,'Runtime loader did not exit successfully')
    assert.equal(receipt.load.signal,null,'Runtime loader was signalled')
    assert.equal(receipt.load.observation?.node,current.observation.node,'Runtime loader Node mismatch')
    assert.equal(receipt.load.observation?.execPath,current.observation.execPath,'Runtime loader executable mismatch')
    assert.ok(receipt.load.observation?.native?.includes(current.native.path),'Runtime loader native path mismatch')
    if(receipt.scope==='installed-runtime-readonly') {
      assert.ok(Number.isInteger(receipt.load.childPid)&&receipt.load.childPid>0,'Runtime loader PID evidence missing')
      assert.equal(receipt.load.childAbsent,true,'Runtime loader child cleanup was not verified')
    }
  }
  return {receiptSha256,identitySha256:current.identitySha256,status:receipt.status,
    scope:receipt.scope,embedding:receipt.embedding,loadStatus:receipt.load.status,
    transformersVerified:false,semanticKagVerified:false,graVerified:false,licenseObligationsAccepted:false,releaseValidated:false}
}

/** Owned transaction shared by admitted native adapters and isolated test harnesses. */
export async function applyInstallation(plan,{adapter=codexAdapter,checkpoint=async()=>{},runtimeReceipt}={}) {
  // Bind all caller-controlled paths and identities before any asynchronous work.
  plan=structuredClone(plan)
  const {planSha256,...planBody}=plan
  assert.equal(digest(planBody),planSha256,'Plan body digest mismatch; use the unmodified saved plan')
  testContract(adapter,plan.userRoot)
  assert.equal(plan.host,'codex')
  assert.ok(runtimeReceipt&&typeof runtimeReceipt==='object','An explicit runtime-check receipt is required')
  // Bind caller-supplied evidence before the first asynchronous boundary.
  const boundRuntime=structuredClone(runtimeReceipt)
  if(adapter.scope==='codex-native-transaction'&&assertCodexAdmission(adapter)==='production')
    assert.equal(boundRuntime.scope,'installed-runtime-readonly','Production apply requires actual runtime-load receipt')
  const boundRuntimeHash=digest(boundRuntime)
  const fresh=await planInstallation({...plan,adapter})
  assert.equal(fresh.planSha256,plan.planSha256,'Stale or modified plan')
  const runtimeReadiness=runtimeGate(plan,boundRuntime,fresh.runtimePrerequisites,boundRuntimeHash)
  const transactionScope=adapter.scope==='codex-native-transaction'?'codex-native-transaction':'isolated-test-transaction'
  const currentFiles=await inventory(plan.target)
  if(plan.upgrade)return applyUpgrade(plan,{adapter,checkpoint,runtimeReadiness,boundRuntime,boundRuntimeHash})
  if(currentFiles) {
    assert.equal(await adapter.readback(plan),true,'Native registration readback failed')
    return {idempotent:true,hostRegistered:true,scope:transactionScope,runtimeReadiness,releaseValidated:false}
  }
  await safePath(plan.receiptDirectory);await mkdir(plan.receiptDirectory,{recursive:true})
  const lock=join(plan.receiptDirectory,'codex-install.lock');await mkdir(lock)
  const lockIdentity=await lstat(lock)
  const id=randomUUID(),receiptPath=join(plan.receiptDirectory,id+'.receipt.json'),stage=plan.target+'.stage-'+id
  const receipt={schemaVersion:1,id,pid:process.pid,scope:transactionScope,...plan,planSnapshot:structuredClone(plan),runtimeReadiness,receiptPath,phase:'prepared',
    hostRegistered:false,nativeAttempted:false,ownedTargetSha256:null,afterEntry:null,rollbackCompleted:false,
    stage,lock,lockIdentity:{dev:lockIdentity.dev,ino:lockIdentity.ino}}
  let moved=false
  activeTransactions.add(id)
  const save=()=>atomic(receiptPath,encode(receipt))
  try {
    await save();await checkpoint('prepared')
    assert.equal((await planInstallation({...plan,adapter})).planSha256,plan.planSha256,'Concurrent change after prepare')
    await safePath(stage);await safePath(plan.overlay)
    await cp(plan.overlay,stage,{recursive:true,errorOnExist:true,force:false})
    const entry=pathToFileURL(join(plan.npmRoot,'payload/shared/scripts/design.mjs')).href
    await writeFile(join(stage,'scripts/design.mjs'),`const entry=new URL(${JSON.stringify(entry)});await import(entry.href)\n`)
    if(plan.nodeRuntime)await writeNodeRegistrationFiles(stage,await nodeRegistrationFiles(plan.overlay,'codex',plan.nodeRuntime))
    const assetHashes=await inventory(stage)
    await writeFile(join(stage,OWNER),encode({host:'codex',npmRoot:plan.npmRoot,version:plan.package.version,...(plan.nodeRuntime?{nodeRuntime:plan.nodeRuntime}:{}),assetHashes,
      transactionId:id,planSha256:plan.planSha256,receiptPath}))
    receipt.ownedTargetSha256=digest(await inventory(stage));receipt.phase='staged';await save();await checkpoint('staged')
    assert.equal(digest(await inventory(stage)),receipt.ownedTargetSha256,'Staged registration changed')
    assert.equal((await planInstallation({...plan,adapter})).planSha256,plan.planSha256,'Inputs changed before publication')
    runtimeGate(plan,boundRuntime,await inspectRuntime({npmRoot:plan.npmRoot,host:plan.host,disableEmbedding:plan.disableEmbedding,nodeRuntime:plan.nodeRuntime}),boundRuntimeHash)
    assert.equal(await inventory(plan.target),null,'Destination appeared during transaction')
    await safePath(plan.target);await mkdir(dirname(plan.target),{recursive:true});await rename(stage,plan.target);moved=true
    receipt.phase='target-published';await save();await checkpoint('target-published')
    const text=await optional(plan.marketplace);assert.equal(text===null?null:sha(text),plan.beforeMarketplaceSha256,'Marketplace changed')
    const catalog=marketplace(text);managedEntry(catalog,plan.target,plan.userRoot)
    receipt.afterEntry={name:PLUGIN,source:{source:'local',path:'./'+relative(plan.userRoot,plan.target).split('\\').join('/')},
      policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}
    catalog.plugins.push(receipt.afterEntry);await save();await casMarketplace(plan.marketplace,text,encode(catalog))
    receipt.phase='configured';await save();await checkpoint('configured')
    if(plan.nodeRuntime)await verifyNodeRuntime(plan.nodeRuntime)
    receipt.nativeAttempted=true;await save();await adapter.register(structuredClone(receipt))
    assert.equal(await adapter.readback(plan),true,'Native registration readback failed')
    receipt.hostRegistered=true;receipt.phase='verified';await save();await checkpoint('verified')
    return receipt
  } catch(error) {
    receipt.failure={name:error.name,message:error.message};await save()
    try { if(moved)Object.assign(receipt,await recoverInstallation(receipt,{adapter,[internalRecovery]:id}));else{receipt.rollbackCompleted=true;receipt.phase='rolled-back';await save()} }
    catch(recovery){receipt.phase='recovery-required';receipt.recoveryError=recovery.message;await save()}
    throw Object.assign(error,{receiptPath})
  } finally {
    activeTransactions.delete(id)
    const conflicts=[]
    try{await removeOwnedTree(stage,receipt.ownedTargetSha256)}catch(error){conflicts.push({path:stage,message:error.message})}
    try {
      await safePath(lock)
      const current=await lstat(lock)
      assert.ok(current.dev===lockIdentity.dev&&current.ino===lockIdentity.ino,'Transaction lock replaced; retained')
      await rmdir(lock)
    }catch(error){conflicts.push({path:lock,message:error.message})}
    if(conflicts.length) {
      receipt.phase='recovery-required';receipt.rollbackCompleted=false;receipt.cleanupConflicts=conflicts;await save()
    }
  }
}

async function applyUpgrade(plan,{adapter,checkpoint,runtimeReadiness,boundRuntime,boundRuntimeHash}) {
  await safePath(plan.receiptDirectory);await mkdir(plan.receiptDirectory,{recursive:true})
  const lock=join(plan.receiptDirectory,'codex-install.lock');await mkdir(lock)
  const lockIdentity=await lstat(lock),id=randomUUID()
  const receipt={schemaVersion:1,id,pid:process.pid,scope:'codex-native-transaction',...plan,planSnapshot:structuredClone(plan),
    runtimeReadiness,receiptPath:join(plan.receiptDirectory,id+'.receipt.json'),phase:'prepared',hostRegistered:false,
    nativeAttempted:false,ownedTargetSha256:null,afterEntry:plan.beforeEntry,rollbackCompleted:false,
    stage:plan.target+'.stage-'+id,previous:plan.target+'.previous-'+id,
    previousCache:join(plan.receiptDirectory,id+'.previous-cache'),previousCacheSha256:null,
    lock,lockIdentity:{dev:lockIdentity.dev,ino:lockIdentity.ino}}
  const save=()=>atomic(receipt.receiptPath,encode(receipt))
  activeTransactions.add(id)
  try {
    await save();await checkpoint('prepared')
    assert.equal((await planInstallation({...plan,adapter})).planSha256,plan.planSha256,'Concurrent upgrade change')
    await safePath(receipt.stage);await cp(plan.overlay,receipt.stage,{recursive:true,errorOnExist:true,force:false})
    const entry=pathToFileURL(join(plan.npmRoot,'payload/shared/scripts/design.mjs')).href
    await writeFile(join(receipt.stage,'scripts/design.mjs'),`const entry=new URL(${JSON.stringify(entry)});await import(entry.href)\n`)
    if(plan.nodeRuntime)await writeNodeRegistrationFiles(receipt.stage,await nodeRegistrationFiles(plan.overlay,'codex',plan.nodeRuntime))
    const assetHashes=await inventory(receipt.stage)
    await writeFile(join(receipt.stage,OWNER),encode({host:'codex',npmRoot:plan.npmRoot,version:plan.package.version,...(plan.nodeRuntime?{nodeRuntime:plan.nodeRuntime}:{}),assetHashes,
      transactionId:id,planSha256:plan.planSha256,receiptPath:receipt.receiptPath}))
    receipt.ownedTargetSha256=digest(await inventory(receipt.stage))
    receipt.newNativeTree=await adapter.upgradeSource({...receipt,target:receipt.stage})
    receipt.phase='staged';await save();await checkpoint('staged')
    assert.equal((await planInstallation({...plan,adapter})).planSha256,plan.planSha256,'Upgrade inputs changed before backup')
    runtimeGate(plan,boundRuntime,await inspectRuntime({npmRoot:plan.npmRoot,host:plan.host,disableEmbedding:plan.disableEmbedding,nodeRuntime:plan.nodeRuntime}),boundRuntimeHash)
    await safePath(receipt.previousCache)
    await cp(plan.upgrade.native.cache,receipt.previousCache,{recursive:true,errorOnExist:true,force:false})
    assert.deepEqual(await adapter.upgradeSource({...receipt,target:receipt.previousCache}),plan.upgrade.native.tree,'Old native cache backup differs')
    receipt.previousCacheSha256=digest(await inventory(receipt.previousCache));receipt.phase='cache-backed-up';await save();await checkpoint('cache-backed-up')
    assert.equal((await planInstallation({...plan,adapter})).planSha256,plan.planSha256,'Upgrade inputs changed before publication')
    assert.equal(digest(await inventory(receipt.stage)),receipt.ownedTargetSha256,'Staged upgrade changed')
    assert.deepEqual(await adapter.upgradeSource({...receipt,target:receipt.stage}),receipt.newNativeTree,'Staged upgrade directories changed')
    assert.equal(await inventory(receipt.previous),null,'Previous registration backup already exists')
    await safePath(receipt.previous);await rename(plan.target,receipt.previous)
    receipt.phase='previous-published';await save();await checkpoint('previous-published')
    assert.equal(digest(await inventory(receipt.previous)),plan.beforeTargetSha256,'Old registration backup changed')
    await rename(receipt.stage,plan.target)
    receipt.phase='target-published';await save();await checkpoint('target-published')
    const marketText=await optional(plan.marketplace)
    assert.equal(marketText===null?null:sha(marketText),plan.beforeMarketplaceSha256,'Marketplace changed during upgrade')
    assert.deepEqual(await adapter.upgradeSource({...receipt,target:receipt.previous}),plan.upgrade.native.tree,'Previous source backup changed before native replacement')
    assert.deepEqual(await adapter.upgradeSource({...receipt,target:receipt.previousCache}),plan.upgrade.native.tree,'Previous cache backup changed before native replacement')
    if(plan.nodeRuntime)await verifyNodeRuntime(plan.nodeRuntime)
    receipt.nativeAttempted=true;await save()
    await adapter.replaceUpgrade(receipt,{expected:{[plan.upgrade.previousReceipt.package.version]:plan.upgrade.native.tree,
      [plan.package.version]:receipt.newNativeTree},ownedConfig:plan.upgrade.native.ownedConfig})
    receipt.hostRegistered=true;receipt.phase='verified';await save();await checkpoint('verified')
    return receipt
  } catch(error) {
    receipt.failure={name:error.name,message:error.message};await save()
    try { Object.assign(receipt,await recoverInstallation(receipt,{adapter,[internalRecovery]:id})) }
    catch(recovery){receipt.phase='recovery-required';receipt.recoveryError=recovery.message;await save()}
    throw Object.assign(error,{receiptPath:receipt.receiptPath})
  } finally {
    activeTransactions.delete(id)
    const conflicts=[]
    try { await removeOwnedTree(receipt.stage,receipt.ownedTargetSha256) } catch(error){conflicts.push({path:receipt.stage,message:error.message})}
    try {
      await safePath(lock);const current=await lstat(lock)
      assert.ok(current.dev===lockIdentity.dev&&current.ino===lockIdentity.ino,'Transaction lock replaced; retained');await rmdir(lock)
    } catch(error){conflicts.push({path:lock,message:error.message})}
    if(conflicts.length){receipt.phase='recovery-required';receipt.cleanupConflicts=conflicts;await save()}
  }
}

async function recoverUpgrade(receipt,{adapter,uninstall}) {
  assert.deepEqual(receipt.upgrade,receipt.planSnapshot.upgrade,'Upgrade recovery identity mismatch')
  const old=receipt.upgrade.previousReceipt
  verifiedUpgradeReceipt(old)
  assert.equal(digest(old),receipt.upgrade.previousReceiptSha256,'Previous receipt digest mismatch')
  assert.equal(digest(JSON.parse(await optional(old.receiptPath))),receipt.upgrade.previousReceiptSha256,'Previous persisted receipt changed')
  assert.equal(digest(await inventory(old.npmRoot)),old.packageInventorySha256,'Previous npm package changed')
  if(receipt.upgrade.nativeJournalSha256!==null)assert.equal(digest(JSON.parse(await optional(join(old.receiptDirectory,old.id+'.native.json')))),receipt.upgrade.nativeJournalSha256,'Previous native journal changed')
  assert.equal(receipt.previous,receipt.target+'.previous-'+receipt.id)
  assert.equal(receipt.previousCache,join(receipt.receiptDirectory,receipt.id+'.previous-cache'))
  const oldSha=receipt.beforeTargetSha256,files=await inventory(receipt.target),previous=await inventory(receipt.previous)
  const marketText=await optional(receipt.marketplace),current=marketplace(marketText)
  if(receipt.previousCacheSha256!==null) {
    assert.equal(digest(await inventory(receipt.previousCache)),receipt.previousCacheSha256,'Old cache backup changed; retained')
    assert.deepEqual(await adapter.upgradeSource({...receipt,target:receipt.previousCache}),receipt.upgrade.native.tree,'Old cache backup changed; retained')
  }
  if(previous!==null) {
    assert.equal(digest(previous),oldSha,'Previous registration backup changed; retained')
    assert.deepEqual(await adapter.upgradeSource({...receipt,target:receipt.previous}),receipt.upgrade.native.tree,'Previous registration directories changed; retained')
  }
  if(files!==null)assert.ok([oldSha,receipt.ownedTargetSha256].includes(digest(files)),'Upgrade registration changed; retained')
  if(files!==null&&digest(files)===receipt.ownedTargetSha256) {
    const owner=JSON.parse(await optional(join(receipt.target,OWNER)))
    assert.equal(owner.transactionId,receipt.id);assert.equal(owner.planSha256,receipt.planSha256)
    assert.equal(owner.receiptPath,receipt.receiptPath)
    assert.deepEqual(await adapter.upgradeSource(receipt),receipt.newNativeTree,'Upgrade registration directories changed; retained')
  }
  // Successful upgrade uninstall removes only the new version; historical
  // backups never authorize removal of the previous shared npm package.
  if(uninstall||receipt.uninstallCompleted===true) {
    if(receipt.uninstallCompleted) {
      assert.equal(files,null,'Uninstalled target reappeared; retained')
      assert.equal(current.plugins.some(p=>p.name===receiptPlugin(receipt.selector)),false,'Uninstalled marketplace entry reappeared; retained')
      assert.equal(await adapter.readback(receipt),false,'Uninstalled native selector reappeared; retained')
      assert.equal(await inventory(receipt.upgrade.native.cache),null,'Uninstalled old native cache reappeared; retained')
      assert.equal(await inventory(join(dirname(receipt.upgrade.native.cache),receipt.package.version)),null,'Uninstalled native cache reappeared; retained')
      return receipt
    }
    assert.equal(receipt.phase,'verified','Upgrade uninstall requires a successful receipt')
    assert.deepEqual(current.plugins.find(p=>p.name===receiptPlugin(receipt.selector))??null,receipt.afterEntry,'Upgraded marketplace entry changed; retained')
    assert.equal(digest(files),receipt.ownedTargetSha256,'Upgraded registration changed; retained')
    await adapter.uninstallUpgrade(receipt)
    current.plugins=current.plugins.filter(p=>p.name!==receiptPlugin(receipt.selector))
    await casMarketplace(receipt.marketplace,marketText,encode(current))
    await removeOwnedTree(receipt.target,receipt.ownedTargetSha256)
    receipt.hostRegistered=false;receipt.rollbackCompleted=true;receipt.phase='rolled-back'
    await atomic(receipt.receiptPath,encode(receipt));return receipt
  }
  assert.deepEqual(current.plugins.find(p=>p.name===receiptPlugin(receipt.selector))??null,receipt.beforeEntry,'Owned marketplace entry changed; retained')
  if(receipt.phase==='rolled-back') {
    assert.equal(digest(files),oldSha,'Restored registration changed; retained')
    assert.equal(await adapter.readback(old),true,'Restored old native readback failed')
    assert.deepEqual(await adapter.inspectUpgrade(old),receipt.upgrade.native,'Restored native cache changed; retained')
    return receipt
  }
  if(previous!==null) {
    if(files!==null) {
      assert.equal(digest(files),receipt.ownedTargetSha256,'Unknown registration retained')
      await removeOwnedTree(receipt.target,receipt.ownedTargetSha256)
    }
    await rename(receipt.previous,receipt.target)
  } else assert.equal(digest(files),oldSha,'Previous registration backup missing; retained')
  assert.equal(digest(await inventory(receipt.target)),oldSha,'Old registration restoration failed')
  // Repeat add is reversible but may prune the other version's cache. Only the
  // two exact owned inventories are admitted; unknown objects stop recovery.
  if(receipt.nativeAttempted)await adapter.replaceUpgrade(old,{expected:{[old.package.version]:receipt.upgrade.native.tree,
    ...(receipt.newNativeTree?{[receipt.package.version]:receipt.newNativeTree}:{})},ownedConfig:receipt.upgrade.native.ownedConfig})
  assert.equal(await adapter.readback(old),true,'Old native recovery readback failed')
  assert.deepEqual(await adapter.inspectUpgrade(old),receipt.upgrade.native,'Old native recovery differs')
  await removeOwnedTree(receipt.stage,receipt.ownedTargetSha256)
  receipt.hostRegistered=false;receipt.rollbackCompleted=true;receipt.previousVersionRestored=old.package.version;receipt.phase='rolled-back'
  await atomic(receipt.receiptPath,encode(receipt));return receipt
}

/** Owned-entry compensation in isolated roots; preserve unrelated concurrent edits. */
export async function uninstallInstallation(receipt,{adapter=codexAdapter}={}) {
  receipt=structuredClone(receipt)
  assert.ok(receipt.phase==='verified'&&receipt.hostRegistered===true&&receipt.nativeAttempted===true
    ||receipt.phase==='rolled-back'&&receipt.uninstallCompleted===true&&receipt.rollbackCompleted===true,
  'Uninstall requires a successful installation receipt or its completed uninstall receipt')
  return recoverInstallation(receipt,{adapter,[internalUninstall]:true})
}

export async function recoverInstallation(receipt,options={}) {
  receipt=structuredClone(receipt)
  const adapter=options.adapter??codexAdapter
  testContract(adapter,receipt.userRoot)
  assert.match(receipt.id,/^[0-9a-f-]{36}$/u,'Invalid transaction identity')
  assert.equal(receipt.receiptPath,join(resolve(receipt.receiptDirectory),receipt.id+'.receipt.json'),'Receipt identity mismatch')
  assert.ok(outside(receipt.npmRoot,receipt.receiptDirectory)&&outside(receipt.target,receipt.receiptDirectory))
  const recoveryLock=join(receipt.receiptDirectory,receipt.id+'.recovery.lock')
  await safePath(recoveryLock);await mkdir(recoveryLock)
  const identity=await lstat(recoveryLock)
  try {
    const uninstall=options[internalUninstall]===true
    const result=await recoverOwnedInstallation(receipt,{adapter,ownRecovery:options[internalRecovery]===receipt.id,uninstall})
    if(uninstall) {
      result.uninstallCompleted=true
      await atomic(result.receiptPath,encode(result))
    }
    return result
  }
  finally {
    await safePath(recoveryLock)
    const current=await lstat(recoveryLock)
    assert.ok(current.dev===identity.dev&&current.ino===identity.ino,'Recovery lock replaced; retained')
    await rmdir(recoveryLock)
  }
}

async function recoverOwnedInstallation(receipt,{adapter,ownRecovery,uninstall=false}) {
  testContract(adapter,receipt.userRoot)
  assert.match(receipt.id,/^[0-9a-f-]{36}$/u,'Invalid transaction identity')
  assert.equal(receipt.receiptPath,join(resolve(receipt.receiptDirectory),receipt.id+'.receipt.json'),'Receipt identity mismatch')
  const persisted=JSON.parse(await optional(receipt.receiptPath))
  assert.deepEqual(persisted,receipt,'Persisted receipt differs from requested recovery')
  const {planSha256,...snapshot}=receipt.planSnapshot??{}
  assert.equal(planSha256,receipt.planSha256,'Recovery plan identity mismatch')
  assert.equal(digest(snapshot),planSha256,'Recovery plan digest mismatch')
  receiptPlugin(receipt.selector)
  for(const key of ['host','npmRoot','userRoot','receiptDirectory','package','packageInventorySha256','platform','arch','node','target','marketplace','overlay','selector','protocol'])
    assert.deepEqual(receipt[key],receipt.planSnapshot[key],'Recovery plan field mismatch')
  assert.equal(digest(await inventory(receipt.npmRoot)),receipt.packageInventorySha256,'Recovery npm package changed')
  assert.deepEqual(await adapter.probe(),receipt.protocol,'Recovery native executable/profile changed')
  const expected=locations(resolve(receipt.userRoot))
  assert.equal(receipt.target,expected.target);assert.equal(receipt.marketplace,expected.marketplace)
  const rel=relative(resolve(receipt.receiptDirectory),resolve(receipt.receiptPath))
  assert.ok(rel&&!rel.startsWith('..')&&!rel.includes('/'),'Receipt must be in its declared external directory')
  assert.ok(outside(receipt.npmRoot,receipt.receiptDirectory)&&outside(receipt.target,receipt.receiptDirectory))
  assert.equal(receipt.stage,receipt.target+'.stage-'+receipt.id,'Recovery stage mismatch')
  assert.equal(receipt.lock,join(receipt.receiptDirectory,'codex-install.lock'),'Recovery lock mismatch')
  let lease=null
  try{lease=await lstat(receipt.lock)}catch(error){if(error.code!=='ENOENT')throw error}
  if(lease) {
    await safePath(receipt.lock)
    assert.ok(lease.dev===receipt.lockIdentity.dev&&lease.ino===receipt.lockIdentity.ino,'Recovery lock replaced; retained')
    assert.ok(Number.isInteger(receipt.pid)&&receipt.pid>0,'Unknown transaction owner; retained')
    if(!(ownRecovery&&activeTransactions.has(receipt.id))) {
      let alive=true
      try{process.kill(receipt.pid,0)}catch(error){if(error.code==='ESRCH')alive=false;else throw error}
      assert.equal(alive,false,'Transaction owner is still running; recovery refused')
    }
  }
  const files=await inventory(receipt.target)
  if(receipt.upgrade) {
    const result=await recoverUpgrade(receipt,{adapter,uninstall})
    if(lease&&!activeTransactions.has(receipt.id)) {
      await safePath(receipt.lock);const current=await lstat(receipt.lock)
      assert.ok(current.dev===lease.dev&&current.ino===lease.ino,'Recovery lock replaced; retained')
      await rmdir(receipt.lock)
    }
    return result
  }
  if(receipt.phase==='rolled-back') {
    assert.equal(files,null,'Recovered target reappeared; retained')
    assert.equal(receipt.rollbackCompleted,true)
    if(uninstall) {
      const catalog=marketplace(await optional(receipt.marketplace))
      assert.equal(catalog.plugins.some(entry=>entry.name===receiptPlugin(receipt.selector)),false,'Uninstalled marketplace entry reappeared; retained')
      assert.equal(await adapter.readback(receipt),false,'Uninstalled native selector reappeared; retained')
      const cache=join(receipt.userRoot,'.codex/plugins/cache',receipt.selector.split('@')[1],receiptPlugin(receipt.selector),receipt.package.version)
      assert.equal(await inventory(cache),null,'Uninstalled native cache reappeared; retained')
    }
    return receipt
  }
  if(files===null) {
    assert.equal(receipt.nativeAttempted,false,'Missing target after native attempt; retained')
    assert.ok(['prepared','staged','recovery-required'].includes(receipt.phase),'Unexpected missing registration target')
    const current=marketplace(await optional(receipt.marketplace)),entry=current.plugins.find(p=>p.name===receiptPlugin(receipt.selector))??null
    assert.deepEqual(entry,receipt.beforeEntry,'Unexpected marketplace effect; retained')
    const staged=await inventory(receipt.stage)
    if(staged!==null)await removeOwnedTree(receipt.stage,receipt.ownedTargetSha256)
    if(lease&&!activeTransactions.has(receipt.id))await rmdir(receipt.lock)
    receipt.hostRegistered=false;receipt.rollbackCompleted=true;receipt.phase='rolled-back'
    await atomic(receipt.receiptPath,encode(receipt));return receipt
  }
  assert.ok(files&&digest(files)===receipt.ownedTargetSha256,'Owned registration changed; recovery refused')
  const owner=JSON.parse(await optional(join(receipt.target,OWNER)))
  assert.equal(owner.transactionId,receipt.id);assert.equal(owner.planSha256,receipt.planSha256)
  assert.equal(owner.receiptPath,receipt.receiptPath)
  const text=await optional(receipt.marketplace),catalog=marketplace(text),entry=catalog.plugins.find(p=>p.name===receiptPlugin(receipt.selector))
  assert.ok(!entry||digest(entry)===digest(receipt.afterEntry),'Owned marketplace entry changed; recovery refused')
  if(receipt.nativeAttempted) {
    await adapter.compensate(receipt)
    assert.equal(await adapter.readback(receipt),false,'Native compensation readback failed')
  }
  if(entry) {
    catalog.plugins=catalog.plugins.filter(p=>p.name!==receiptPlugin(receipt.selector))
    if(receipt.beforeEntry)catalog.plugins.push(receipt.beforeEntry)
    await casMarketplace(receipt.marketplace,text,receipt.beforeMarketplaceMissing&&digest(catalog)===digest(marketplace(null))?null:encode(catalog))
  }
  assert.equal(digest(await inventory(receipt.target)),receipt.ownedTargetSha256,'Target changed before removal')
  await removeOwnedTree(receipt.target,receipt.ownedTargetSha256)
  await removeOwnedTree(receipt.stage,receipt.ownedTargetSha256)
  if(lease&&!activeTransactions.has(receipt.id))await rmdir(receipt.lock)
  receipt.hostRegistered=false;receipt.rollbackCompleted=true;receipt.phase='rolled-back'
  await atomic(receipt.receiptPath,encode(receipt));return receipt
}

const DSH_FLAGS = ['dsh-config','profile','aggregate-selector','registry']
export { validateReleaseHosts }
async function dshReleaseSelection(values,npmRoot) {
  const bytes=await optional(join(npmRoot,'release-hosts.json'))
  const mapped=bytes===null?null:validateReleaseHosts(JSON.parse(bytes))
  if(mapped) {
    if(Object.hasOwn(values,'aggregate-selector'))assert.equal(values['aggregate-selector'],mapped.aggregateSelector,'Aggregate override differs from product release')
    // The release binds the package/version and default origin, not the user's
    // explicit download mirror. The owning planner validates and pins transport.
    return {...mapped,registry:values.registry ?? mapped.registry}
  }
  for(const key of ['aggregate-selector','registry'])assert.ok(typeof values[key]==='string' && values[key],`DSH release mapping is unbound or missing; explicit --${key} required for compatibility installation`)
  return {aggregateSelector:values['aggregate-selector'],registry:values.registry}
}
async function dshConfiguration(path) {
  assert.ok(typeof path==='string'&&isAbsolute(path),'Explicit absolute DSH pins config required')
  const config=JSON.parse(await optional(path))
  const fields=['dshHome','node','cli','hostManifest','loader','loaderManifest','hostVersion','loaderVersion']
  assert.ok(config&&typeof config==='object'&&!Array.isArray(config),'DSH pins config object required')
  assert.ok(fields.every(key => Object.hasOwn(config,key)) && Object.keys(config).every(key => fields.includes(key) || key === 'desktopHostManifest'),'DSH pins config accepts only public pins and an optional Desktop host manifest; scope/runner overrides are forbidden')
  assert.ok(typeof config.dshHome==='string'&&isAbsolute(config.dshHome),'Explicit absolute DSH home required')
  for(const key of ['node','cli','hostManifest','loader','loaderManifest', ...config.desktopHostManifest ? ['desktopHostManifest'] : []]) {
    const pin=config[key]
    assert.ok(pin&&typeof pin==='object'&&!Array.isArray(pin),'Official file pin object required')
    assert.deepEqual(Object.keys(pin).sort(),['path','sha256'],'Official pin accepts only path and sha256')
  }
  return config
}
async function dshOutputDirectory(path,{npmRoot,config,configPath,planPath,previousProductRoot}) {
  assert.ok(typeof path==='string'&&isAbsolute(path),'Explicit absolute external receipt directory required')
  const output=resolve(path)
  await safePath(output)
  // safePath checks every existing ancestor; resolve the nearest existing one
  // as well before creating an external output directory.
  let ancestor=output
  while(true) {
    try { assert.equal(await realpath(ancestor),ancestor,'Output ancestor realpath mismatch'); break }
    catch(error){if(error.code!=='ENOENT')throw error;ancestor=dirname(ancestor)}
  }
  const roots=[resolve(npmRoot),resolve(config.dshHome),...previousProductRoot ? [resolve(previousProductRoot)] : []]
  for(const key of ['node','cli','hostManifest','loader','loaderManifest', ...config.desktopHostManifest ? ['desktopHostManifest'] : []]) {
    roots.push(dirname(resolve(config[key].path)),dirname(await realpath(config[key].path)))
  }
  for(const root of roots)assert.ok(outside(root,output)&&outside(output,root),'DSH output overlaps a package, host or user configuration root')
  for(const file of [configPath,planPath].filter(Boolean))
    assert.ok(outside(output,resolve(file))&&outside(resolve(file),output),'DSH output overlaps config or saved plan')
  if(process.platform==='win32') {
    try { await lstat(output) } catch(error) { if(error.code==='ENOENT')return output; throw error }
    await assertWindowsPrivate(output,{directory:true})
  }
  return output
}
async function writeDshOutput(directory,name,value) {
  await safePath(directory)
  if(process.platform==='win32')await ensureWindowsPrivateDirectory(directory)
  else await mkdir(directory,{recursive:true})
  await safePath(directory)
  const path=join(directory,name)
  // Exclusive create, never overwrite even an unrelated file at a digest name.
  await safePath(path);await writeFile(path,encode(value),{flag:'wx',mode:0o600})
  return path
}
async function dshInstallerEntry(values,{npmRoot,dshAdapterFactory,args,signal,dshInstallTimeoutMs}) {
  assert.ok(values['dry-run']===true&&values.apply!==true||values.apply===true&&values['dry-run']!==true,'Choose exactly dry-run or apply')
  for(const key of ['codex-executable','user-root','runtime-receipt','disable-embedding','receipt'])
    assert.ok(!Object.hasOwn(values,key),`DSH install does not accept --${key}`)
  for(const key of ['dsh-config','profile'])assert.ok(typeof values[key]==='string'&&values[key],`DSH install requires --${key}`)
  assert.ok(values.apply===true?values.plan:!values.plan,'DSH apply requires saved --plan; dry-run cannot consume --plan')
  const selection=await dshReleaseSelection(values,npmRoot)
  const configPath=values['dsh-config'],config=await dshConfiguration(configPath)
  if (config.desktopHostManifest && !process.versions.electron)
    return runDesktopDshInstaller({ node:config.node, args, npmRoot, signal, timeoutMs:dshInstallTimeoutMs })
  const output=await dshOutputDirectory(values['receipt-dir'],{npmRoot,config,configPath})
  const adapter=await dshAdapterFactory({...config,scope:'official-pinned'})
  let aggregateDirectory
  try {
    const name=selection.aggregateSelector.slice(0,selection.aggregateSelector.lastIndexOf('@'))
    aggregateDirectory=dirname(await realpath(createRequire(join(npmRoot,'package.json')).resolve(name+'/package.json')))
  } catch(error) { if(error.code!=='MODULE_NOT_FOUND')throw error }
  const options={adapter,profile:values.profile,...selection,productRoot:await realpath(resolve(npmRoot)),
    ...values['previous-receipt'] ? {previousReceipt:values['previous-receipt']} : {},
    ...aggregateDirectory ? {aggregateDirectory} : {}}
  if(values['dry-run']) {
    const plan=await planDshInstallation(options)
    if(plan.previous)await dshOutputDirectory(output,{npmRoot,config,configPath,previousProductRoot:plan.previous.product.npmRoot})
    const planFile=await writeDshOutput(output,plan.planSha256+'.dsh-plan.json',plan)
    return {...plan,planFile}
  }
  assert.ok(isAbsolute(values.plan),'Explicit absolute saved DSH plan required')
  const plan=JSON.parse(await optional(values.plan))
  assert.equal(plan.host,'dsh');assert.equal(plan.route,'official-dsh-bundle')
  // A saved plan may live in the receipt directory, but its bytes must never be overwritten.
  assert.equal(plan.profile,options.profile,'Saved DSH profile mismatch')
  assert.equal(plan.aggregateSelector,options.aggregateSelector,'Saved aggregate selector mismatch')
  assert.equal(plan.registry,new URL(options.registry).href,'Saved registry mismatch')
  assert.equal(plan.previousReceipt,options.previousReceipt,'Saved previous ownership reference mismatch')
  assert.equal(plan.protocol.scope,adapter.scope,'Saved adapter scope mismatch')
  const fresh=await planDshInstallation(options)
  if(fresh.previous)await dshOutputDirectory(output,{npmRoot,config,configPath,previousProductRoot:fresh.previous.product.npmRoot})
  assert.deepEqual(plan.protocol,fresh.protocol,'Saved official pins/home/version mismatch')
  assert.equal(plan.planSha256,fresh.planSha256,'Saved DSH plan or profile drifted')
  const id=randomUUID(),receiptPath=join(output,id+'.dsh-result.json')
  const preparedRecordFile=await writeDshOutput(output,id+'.dsh-prepared.json',{
    schemaVersion:2,kind:'dsh-installation-prepared',id,planSha256:plan.planSha256,planSnapshot:plan,
    receiptPath,ownershipEstablished:false,phase:'prepared',retrySafe:false})
  try {
    const result=await applyDshInstallation(plan,{adapter,signal,timeoutMs:dshInstallTimeoutMs,logDirectory:output})
    const body={...result,id,receiptPath,preparedRecordFile}
    const receipt={...body,receiptSha256:digest(body)}
    const receiptFile=await writeDshOutput(output,id+'.dsh-result.json',receipt)
    return {...receipt,receiptFile}
  } catch(error) {
    // The native command may already have changed the profile. Keep the exact
    // prepared record discoverable without fabricating a successful terminal receipt.
    throw Object.assign(error,{receiptPath:preparedRecordFile,preparedRecordFile,planFile:values.plan})
  }
}

/** Reuse native session plugin loading. No registration, copying, or host launch. */
export async function nativePluginDirectory({npmRoot,host}) {
  assert.ok(['claude-code','qoder'].includes(host),'Native plugin-directory host required')
  const root=await realpath(resolve(npmRoot))
  await safePath(root)
  const prefix=host==='claude-code'?'claude':'qoder'
  const pluginRoot=join(root,'payload/overlays',host)
  const manifest=JSON.parse(await optional(join(root,'package.json')))
  const plugin=JSON.parse(await optional(join(pluginRoot,`.${prefix}-plugin/plugin.json`)))
  assert.equal(plugin.name,PLUGIN,'Unexpected native plugin identity')
  assert.equal(plugin.version,manifest.version,'Native plugin/package version mismatch')
  const required=[
    'scripts/design.mjs','skills/yugoo/SKILL.md','skills/yugoo/native-execution.md',
    `scripts/${prefix}-context.mjs`,`scripts/${prefix}-notification.mjs`,
    `scripts/${prefix}-hook-transport.mjs`,`scripts/${prefix}-connection.mjs`,
    'scripts/native-hook-transport.mjs',
  ]
  if(host==='qoder')required.push('commands/yugoo.md')
  if((await optional(join(pluginRoot,'scripts/native-hook-transport.mjs')))?.includes('./windows-private-storage.mjs'))
    required.push('scripts/windows-private-storage.mjs','scripts/windows-native-platform.mjs')
  for(const file of required)assert.notEqual(await optional(join(pluginRoot,file)),null,`Missing native plugin asset: ${file}`)
  for(const file of ['scripts/design.mjs','web/index.html','kits/web_app/kit.yaml','knowledge/runtime.mjs'])
    assert.notEqual(await optional(join(root,'payload/shared',file)),null,`Missing shared asset: ${file}`)
  const variable=prefix==='claude'?'CLAUDE_PLUGIN_ROOT':'QODER_PLUGIN_ROOT'
  const mcp=JSON.parse(await optional(join(pluginRoot,'.mcp.json')))
  assert.deepEqual(mcp.mcpServers?.['design-system'],{
    command:'node',args:[`\${${variable}}/scripts/design.mjs`,'mcp'],
  },'Unexpected native MCP entry')
  const hooks=JSON.parse(await optional(join(pluginRoot,'hooks/hooks.json'))).hooks
  for(const event of ['SessionStart','CwdChanged','SubagentStart','FileChanged']) {
    assert.ok(Array.isArray(hooks?.[event])&&hooks[event].length,`Missing native hook: ${event}`)
    for(const group of hooks[event]) {
      assert.ok(Array.isArray(group.hooks)&&group.hooks.length,`Empty native hook: ${event}`)
      const script=`\${${variable}}/scripts/${prefix}-${event==='FileChanged'?'notification':'context'}.mjs`
      for(const hook of group.hooks) {
        if(prefix==='claude') {
          assert.equal(hook.command,'node','Unexpected native hook command')
          assert.deepEqual(hook.args,[script],'Unexpected native hook entry')
        } else assert.equal(hook.command,`node "${script}"`,'Unexpected native hook entry')
      }
    }
  }
  return {
    schemaVersion:1,kind:'native-plugin-directory',status:'plugin-directory-ready',host,
    package:{name:manifest.name,version:manifest.version},npmRoot:root,pluginRoot,
    launch:{executable:prefix==='claude'?'claude':'qodercli',args:['--plugin-dir',pluginRoot]},
    command:'/yugoo-design:yugoo',hostRegistered:false,hostLaunched:false,
    runtimePrerequisites:await inspectRuntime({npmRoot:root,host}),
    next:'Start the native CLI in your intended workspace with the returned argv, then use /yugoo-design:yugoo. This loads the plugin for that session only; no user configuration was changed.',
    limitations:['Retain this npm installation while using the plugin; after an update restart the host with the new directory and reopen the Panel.',
      'Directory readiness is not native loading, model, subagent or runtime acceptance. Linux CLI is the existing tested scope; other platforms are not certified here.',
      'Runtime prerequisites are inspected, not loaded; use check-runtime for native dependency diagnostics.'],
  }
}

export async function installerMain(args,{npmRoot,userRoot=homedir(),adapter=codexAdapter,dshAdapterFactory=createDshInstallerAdapter,claudeAdapterFactory=createClaudeNativeAdapter,qoderInstaller=installQoderPlugin,agentDispatch=true,signal,dshInstallTimeoutMs}={}) {
  if(args[0]==='prepare-desktop')return desktopPreparationMain(args.slice(1),{npmRoot})
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{host:{type:'string'},'dry-run':{type:'boolean'},
    help:{type:'boolean',short:'h'},apply:{type:'boolean'},plan:{type:'string'},'receipt-dir':{type:'string'},receipt:{type:'string'},'runtime-receipt':{type:'string'},'codex-executable':{type:'string'},'claude-executable':{type:'string'},'user-root':{type:'string'},'disable-embedding':{type:'boolean'},
    'qoder-executable':{type:'string'},'qoder-config-dir':{type:'string'},
    'dsh-config':{type:'string'},profile:{type:'string'},'aggregate-selector':{type:'string'},registry:{type:'string'},
    ...Object.fromEntries(DESKTOP_INSTALL_OPTIONS.map(key=>[key,{type:key==='separate-mcp'?'boolean':'string'}]))}})
  if(values.help)return {
    schemaVersion:1,kind:'installer-help',status:'not-applicable',
    usage:'design-system <command> [options]',
    commands:{
      'resolve-node':'Discover and verify an existing compatible Node without a host, npm package or configuration writes.',
      'prepare-desktop':'Prepare a small QwenWork suite or stable WorkBuddy market from this exact acquired npm package. Uses --target, --package-name/--package-version, --suite-version, --node-executable and an external --destination; does not register a host. Updates use the previous preparation receipt.',
      install:'The current Agent selects --host from trusted context or one user choice. Direct install orchestrates the existing DSH/Codex saved-plan routes, native Claude/Qoder registration, or QwenWork/WorkBuddy import preparation. Missing inputs and pending activation are explicit. Existing --dry-run / --apply remain available.',
      'plugin-directory':'Inspect the optional Claude/Qoder session-only --plugin-dir entry; this is not persistent installation.',
      'check-runtime':'Check runtime prerequisites and write an external runtime receipt; does not install.',
      recover:'Recover an owned Codex or Claude installation transaction using --receipt.',
      uninstall:'Uninstall a successful owned Codex or Claude installation using --receipt; retain projects and shared npm files.',
    },
    options:{
      '--help, -h':'Show this JSON usage without reading configuration or registering a host.',
      '--host <host>':`Current host: ${AGENT_INSTALL_HOSTS.join(', ')}. Omission requests one choice; installed binaries are not active-host identity. Explicit legacy codex-desktop remains plan-only.`,
      '--dry-run':'Prepare an install plan; requires --receipt-dir and writes that plan.',
      '--apply':'Apply a saved plan. Codex and Claude require --runtime-receipt; DSH requires explicit pins and external --receipt-dir.',
      '--plan <file>':'Saved installation plan used by --apply.',
      '--receipt-dir <directory>':'External output directory for install plans or runtime receipts.',
      '--receipt <file>':'Owned transaction receipt used by recover or uninstall.',
      '--runtime-receipt <file>':'Runtime-check receipt used by --apply.',
      '--claude-executable <path>':'Explicit Claude executable for user-scope installation. Native capabilities are checked and selected executable bytes remain pinned during the operation.',
      '--qoder-executable <path>':'Qoder CLI executable for native user-scope install (default: qodercli on PATH).',
      '--qoder-config-dir <directory>':'Optional existing Qoder configuration directory; omission preserves native environment/default resolution.',
      '--codex-executable <path>':'Explicit Codex executable for native apply/recovery/uninstall.',
      '--user-root <directory>':'Profile root; production native registration requires the actual user profile.',
      '--disable-embedding':'Explicitly disable local embedding in the plan or runtime check.',
      '--dsh-config <file>':'DSH install only: absolute JSON with dshHome, official node/CLI/Loader file pins and host/Loader versions; desktopHostManifest selects the official Electron Desktop CLI. No scope or runner override.',
      '--profile <name>':'DSH install only: explicitly selected existing profile; never initialized implicitly.',
      '--aggregate-selector <name@version>':'DSH install only: optional exact aggregate override matching the product release mapping; required for old or unbound candidates.',
      '--registry <https-url>':'DSH install only: explicit credential-free HTTPS download registry or mirror; defaults to the product mapping. Preserves the exact mapped aggregate and binds the saved plan/receipt; no automatic fallback. Required for old or unbound candidates.',
      '--destination <directory>':'QwenWork/WorkBuddy direct install: exclusive external preparation directory, or the same owned directory with --previous-receipt.',
      '--suite-version <version>':'QwenWork/WorkBuddy: exact native suite version, separate from the acquired npm version.',
      '--node-executable <path>':'Existing compatible Node for a new CLI installation/runtime check or desktop preparation; selected absolute executable is bound to owned native launchers. DSH retains its own host runtime.',
      '--qwenwork-runtime <file>':'QwenWork: verified native executable/worker/Node paths and byte pins. Agent obtains these through supported native inspection; no credentials.',
      '--separate-mcp':'QwenWork: emit one external connector instead of bundling it when organization policy requires this.',
      '--previous-receipt <file>':'DSH: successful source-bound installation receipt for an owned update or repeat; sparse/manual receipts cannot be adopted. Desktop: reuse an owned preparation or prepare a newer native suite/npm version.',
      '--npm-root-windows, --destination-windows':'Desktop: explicit Windows path mappings required when preparing from another platform; native Windows paths must match actual roots.',
    },
    limitations:['plugin-directory is an optional session-only diagnostic, not installation. Codex requires an admitted adapter; DSH requires pinned public CLI inputs. Desktop preparation needs native import and activation. Exit 2 means host selection or inputs are required; exit 0 does not establish a usable native session.',
      'DSH failures retain partial state without rollback. Configuration parsing is not actual host runtime or release acceptance.',
      'Uninstall requires a successful owned receipt. Package installation is not Bundle/Panel/GRA/KAG acceptance.'],
  }
  assert.equal(positionals.length,1,'Exactly one installer command required')
  if(positionals[0]==='resolve-node') {
    assert.ok(Object.keys(values).every(key=>key==='node-executable'),'resolve-node accepts only --node-executable')
    return {schemaVersion:1,kind:'node-runtime-selection',...await resolveNodeRuntime({nodeExecutable:values['node-executable']})}
  }
  if(agentDispatch&&positionals[0]==='install'&&!values['dry-run']&&!values.apply) {
    const context={npmRoot,userRoot,adapter,dshAdapterFactory,claudeAdapterFactory,qoderInstaller,agentDispatch:false,signal,dshInstallTimeoutMs}
    return agentInstallation(values,{npmRoot,admittedCodexAdapter:adapter!==codexAdapter,
      invoke:nextArgs=>installerMain(nextArgs,context),
      desktopPrepare:nextArgs=>desktopPreparationMain(nextArgs,{npmRoot}),
      desktopReuse:nextArgs=>desktopPreparationReuseMain(nextArgs,{npmRoot})})
  }
  for(const key of DESKTOP_INSTALL_OPTIONS)if(!(key==='previous-receipt'&&values.host==='dsh'&&positionals[0]==='install')
    && !(key==='node-executable'&&['codex','claude-code','qoder'].includes(values.host)&&['install','check-runtime'].includes(positionals[0])))
    assert.ok(!Object.hasOwn(values,key),`--${key} is only valid for direct desktop install`)
  if(positionals[0]==='plugin-directory'&&['claude-code','qoder'].includes(values.host)) {
    assert.deepEqual(Object.keys(values),['host'],'Native directory entry accepts only --host; transaction/runtime options must not be silently ignored')
    return nativePluginDirectory({npmRoot,host:values.host})
  }
  if(DSH_FLAGS.some(key=>Object.hasOwn(values,key)))
    assert.ok(values.host==='dsh'&&positionals[0]==='install','DSH flags are only valid for install --host dsh')
  if(values['claude-executable'])assert.equal(values.host,'claude-code','Claude executable is only valid for Claude host')
  for(const key of ['qoder-executable','qoder-config-dir'])if(Object.hasOwn(values,key))
    assert.ok(values.host==='qoder'&&positionals[0]==='install',`${key} is only valid for install --host qoder`)
  if(values.host==='qoder'&&positionals[0]!=='check-runtime') {
    assert.equal(positionals[0],'install','Qoder recovery/uninstall uses its native CLI; inspect the saved registration receipt')
    const allowed=new Set(['host','receipt-dir','qoder-executable','qoder-config-dir','node-executable'])
    assert.ok(Object.keys(values).every(key=>allowed.has(key)),'Qoder install accepts only host, receipt-dir and Qoder executable/config options')
    assert.ok(values['receipt-dir'],'External receipt directory required')
    const receipt=await qoderInstaller({npmRoot,executable:values['qoder-executable']??'qodercli',configDir:values['qoder-config-dir'],cwd:process.cwd(),stageRoot:values['receipt-dir'],nodeExecutable:values['node-executable']})
    return {...receipt,next:'Start Qoder CLI normally in your project and use /yugoo-design:yugoo. No --plugin-dir argument is needed; retain the installed npm package. Registration does not establish runtime dependency readiness; use check-runtime separately.'}
  }
  if(values.host==='claude-code')assert.ok(!values['codex-executable'],'Codex executable is invalid for Claude host')
  if(values.host==='claude-code'&&positionals[0]!=='check-runtime') {
    const command=positionals[0]
    assert.ok(['install','recover','uninstall'].includes(command),'Unknown Claude installer command')
    assert.ok(values['claude-executable'],'Explicit Claude executable required')
    const profile=resolve(values['user-root']??userRoot)
    const directInstall=command==='install'&&!values['dry-run']&&!values.apply
    if(command==='install') {
      assert.ok(directInstall||values['dry-run']!==values.apply,'Choose Claude dry-run or apply')
      assert.ok(!values.receipt,'Install cannot take a recovery receipt')
      if(values.apply)assert.ok(values.plan&&values['runtime-receipt']&&!values['receipt-dir']&&!values['disable-embedding']&&!values['node-executable'],'Claude apply requires saved plan and runtime receipt only')
      else assert.ok(values['receipt-dir']&&!values.plan&&!values['runtime-receipt'],'Claude dry-run requires external receipt directory only')
    } else assert.ok(values.receipt&&!values.apply&&!values['dry-run']&&!values.plan&&!values['receipt-dir']&&!values['runtime-receipt']&&!values['disable-embedding'],'Claude recovery/uninstall requires only persisted receipt')
    const native=await claudeAdapterFactory({executable:values['claude-executable'],userRoot:profile,nativeCwd:resolve(npmRoot),scope:values['dry-run']?'plan-only':'production'})
    if(command==='recover'||command==='uninstall') {
      const receipt=JSON.parse(await optional(resolve(values.receipt)))
      assert.equal(receipt.npmRoot,resolve(npmRoot),'Claude receipt npm root mismatch');assert.equal(receipt.userRoot,profile,'Claude receipt profile mismatch')
      return recoverClaudeInstallation(receipt,{adapter:native,uninstall:command==='uninstall'})
    }
    if(values.apply) {
      const plan=JSON.parse(await optional(resolve(values.plan)))
      assert.equal(plan.npmRoot,resolve(npmRoot),'Claude plan npm root mismatch');assert.equal(plan.userRoot,profile,'Claude plan profile mismatch')
      return applyClaudeInstallation(plan,{adapter:native,runtimeReceipt:JSON.parse(await optional(resolve(values['runtime-receipt'])))})
    }
    const plan=await planClaudeInstallation({npmRoot,userRoot:profile,receiptDirectory:values['receipt-dir'],adapter:native,disableEmbedding:values['disable-embedding']??false,nodeExecutable:values['node-executable']})
    await mkdir(plan.receiptDirectory,{recursive:true})
    const path=join(plan.receiptDirectory,plan.planSha256+'.claude-plan.json')
    await atomic(path,encode(plan))
    if(directInstall) {
      const runtimeReceipt=await checkRuntime({npmRoot,host:'claude-code',disableEmbedding:plan.disableEmbedding,receiptDirectory:plan.receiptDirectory,nodeRuntime:plan.nodeRuntime})
      const receipt=await applyClaudeInstallation(plan,{adapter:native,runtimeReceipt})
      return {...receipt,hostRegistered:true,installationScope:'user',next:'Start Claude Code normally in your project and use /yugoo-design:yugoo. No --plugin-dir argument is needed; retain the installed npm package.'}
    }
    return {...plan,planFile:path}
  }
  if(values.apply)assert.ok(!values['node-executable'],'Apply uses the saved plan Node; do not select another executable')
  if(values.host==='dsh'&&positionals[0]==='install')return dshInstallerEntry(values,{npmRoot,dshAdapterFactory,args,signal,dshInstallTimeoutMs})
  if(adapter===codexAdapter&&values['codex-executable']&&positionals[0]!=='check-runtime') {
    assert.equal(values.host,'codex','Native executable is only valid for the Codex host')
    const profile=resolve(values['user-root']??userRoot)
    assert.equal(profile,resolve(homedir()),'Production adapter requires actual user profile')
    adapter=await createCodexNativeAdapter({executable:values['codex-executable'],userRoot:profile})
  }
  if(positionals[0]==='check-runtime') {
    assert.ok(!values.apply&&!values['dry-run']&&!values.receipt,'check-runtime does not install or apply a plan')
    assert.ok(INSTALL_HOSTS.includes(values.host),'An explicit supported host is required')
    assert.ok(values['receipt-dir'],'Explicit external receipt directory required')
    let nodeRuntime,disableEmbedding=values['disable-embedding']??false
    if(values.plan) {
      assert.ok(['codex','claude-code'].includes(values.host)&&!values['node-executable'],'Saved runtime plan cannot be combined with a new Node selection')
      const plan=JSON.parse(await optional(resolve(values.plan))),{planSha256,...body}=plan
      assert.equal(digest(body),planSha256,'Runtime plan digest mismatch')
      assert.equal(plan.host,values.host,'Runtime plan host mismatch');assert.equal(plan.npmRoot,resolve(npmRoot),'Runtime plan npm root mismatch')
      assert.ok(plan.nodeRuntime,'Saved plan has no bound Node; use its original installed checker')
      if(Object.hasOwn(values,'disable-embedding'))assert.equal(disableEmbedding,plan.disableEmbedding,'Runtime plan embedding policy mismatch')
      nodeRuntime=plan.nodeRuntime;disableEmbedding=plan.disableEmbedding
    } else if(['codex','claude-code','qoder'].includes(values.host))nodeRuntime=await resolveNodeRuntime({nodeExecutable:values['node-executable']})
    const receipt=await checkRuntime({npmRoot,host:values.host,disableEmbedding,receiptDirectory:values['receipt-dir'],nodeRuntime})
    const directory=resolve(values['receipt-dir'])
    await mkdir(directory,{recursive:true})
    const path=join(directory,digest(receipt)+'.runtime.json')
    await atomic(path,encode(receipt));return {...receipt,receiptFile:path}
  }
  if(positionals[0]==='recover'||positionals[0]==='uninstall'||values.apply) {
    if(adapter!==codexAdapter)assertCodexAdmission(adapter)
    assert.ok(values.host==='codex','Explicit Codex host required')
    if(adapter===codexAdapter) {
      assert.ok(values['codex-executable'],'Explicit native executable required')
      assert.equal(resolve(values['user-root']??userRoot),resolve(homedir()),'Production adapter requires actual user profile')
      adapter=await createCodexNativeAdapter({executable:values['codex-executable'],userRoot:resolve(userRoot)})
    }
    assertCodexAdmission(adapter)
    if(positionals[0]==='recover'||positionals[0]==='uninstall') {
      assert.ok(values.receipt&&!values.apply&&!values['dry-run']&&!values.plan,'Recovery requires only a transaction receipt')
      if(positionals[0]==='uninstall')assert.ok(!values['runtime-receipt']&&!values['receipt-dir']&&!values['disable-embedding'],'Uninstall accepts only its installation receipt and host identity options')
      const receipt=JSON.parse(await optional(resolve(values.receipt)))
      assert.equal(receipt.npmRoot,resolve(npmRoot),'Receipt npm root mismatch')
      assert.equal(receipt.userRoot,resolve(values['user-root']??userRoot),'Receipt profile mismatch')
      return positionals[0]==='uninstall'?uninstallInstallation(receipt,{adapter}):recoverInstallation(receipt,{adapter})
    }
  }
  assert.equal(positionals[0],'install');assert.ok(values['dry-run']!==values.apply,'Choose exactly dry-run or apply')
  if(values.apply) {
    assert.ok(values.plan&&values['runtime-receipt'],'Apply requires saved plan and runtime-check receipt')
    const plan=JSON.parse(await optional(resolve(values.plan)))
    assert.equal(plan.npmRoot,resolve(npmRoot),'Plan npm root mismatch')
    assert.equal(plan.userRoot,resolve(values['user-root']??userRoot),'Plan profile mismatch')
    return applyInstallation(plan,{adapter,runtimeReceipt:JSON.parse(await optional(resolve(values['runtime-receipt'])))})
  }
  assert.ok(values['receipt-dir'],'Explicit external receipt directory required')
  const plan=await planInstallation({npmRoot,host:values.host,userRoot:values['user-root']??userRoot,receiptDirectory:values['receipt-dir'],adapter,disableEmbedding:values['disable-embedding']??false,nodeExecutable:values['node-executable']})
  await mkdir(plan.receiptDirectory,{recursive:true})
  const path=join(plan.receiptDirectory,plan.planSha256+'.plan.json')
  await atomic(path,encode(plan));return {...plan,planFile:path}
}
