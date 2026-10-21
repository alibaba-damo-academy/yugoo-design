import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { tmpdir, homedir } from 'node:os'

const exec = promisify(execFile)

/** Read-only protocol probe. Help/remove existence does not prove compensation. */
export async function probeCodex({ run = exec } = {}) {
  const results = {}
  try {
    for (const [key, args] of Object.entries({ version:['--version'], add:['plugin','add','--help'],
      list:['plugin','list','--help'], remove:['plugin','remove','--help'] })) {
      const r = await run('codex', args, { timeout:15000, maxBuffer:1024*1024 })
      results[key] = r.stdout
    }
    return { available:true, version:results.version.trim(),
      addJson:/--json/u.test(results.add), listJson:/--json/u.test(results.list), removeJson:/--json/u.test(results.remove),
      nativeCompensationVerified:false, applySupported:false,
      blockedReason:'Native configuration/cache side effects and compensation have not been verified.' }
  } catch (error) {
    return { available:false, applySupported:false, nativeCompensationVerified:false,
      blockedReason:`Codex read-only protocol probe failed: ${error.code ?? error.name}` }
  }
}

const admittedAdapters = new WeakMap()
// Verified local-plugin JSON/ownership protocol, not release-payload acceptance.
// Installation paths vary between users; pin each selected executable instance.
// No caller config, version range or help output can extend this internal table.
const verifiedNativeProtocols = Object.freeze([
  Object.freeze({platform:'linux',arch:'x64',version:'codex-cli 0.160.0',protocol:'local-plugin-json-v1'}),
  Object.freeze({platform:'linux',arch:'x64',version:'codex-cli 0.162.0',protocol:'local-plugin-json-v1'}),
])
export function assertCodexAdmission(adapter) {
  assert.ok(admittedAdapters.has(adapter),'Native apply remains plan-only; verified native protocol adapter required')
  return admittedAdapters.get(adapter)
}
export const codexAdapter = Object.freeze({ scope:'codex-native-plan-only', probe:probeCodex,
  nativeCompensationVerified:false,
  register:async()=>assertCodexAdmission(codexAdapter),
  readback:async()=>assertCodexAdmission(codexAdapter),
  compensate:async()=>assertCodexAdmission(codexAdapter) })

const hash = value => createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex')
async function text(path) { try { assert.ok((await lstat(path)).isFile(),'Expected native config file');return await readFile(path,'utf8') }catch(e){if(e.code==='ENOENT')return null;throw e} }
async function safe(path) {
  for(let cursor=resolve(path);;cursor=dirname(cursor)) {
    try{assert.ok(!(await lstat(cursor)).isSymbolicLink(),'Native ownership symlink rejected')}catch(e){if(e.code!=='ENOENT')throw e}
    if(cursor===dirname(cursor))break
  }
}
async function tree(root) {
  await safe(root)
  try{assert.ok((await lstat(root)).isDirectory())}catch(e){if(e.code==='ENOENT')return null;throw e}
  const files={},directories=[]
  async function visit(dir) {
    directories.push(relative(root,dir))
    for(const name of (await readdir(dir)).sort()) {
      const path=join(dir,name),info=await lstat(path)
      assert.ok(!info.isSymbolicLink(),'Unknown native cache symlink retained')
      if(info.isDirectory())await visit(path)
      else{assert.ok(info.isFile(),'Unknown native cache object retained');files[relative(root,path)]=hash(await readFile(path))}
    }
  }
  await visit(root);return {files,directories:directories.sort()}
}

// Deliberately narrow native table representation, not a general TOML parser.
// Reject multiline constructs rather than guessing where an owned table ends.
function section(config,selector) {
  const value=config??'',lines=value.match(/[^\n]*\n|[^\n]+$/gu)??[],headers=[]
  let offset=0
  for(const line of lines) {
    let quote=null,escape=false,depth=0
    assert.ok(!line.includes('"""')&&!line.includes("'''"),'Unsupported multiline native configuration')
    for(const char of line.trimEnd()) {
      if(quote){if(escape){escape=false;continue}if(quote==='"'&&char==='\\'){escape=true;continue}if(char===quote)quote=null;continue}
      if(char==='#')break
      if(char==='"'||char==="'"){quote=char;continue}
      if(char==='['||char==='{')depth++
      if(char===']'||char==='}')depth--
    }
    assert.ok(!quote&&depth===0,'Unsupported multiline native configuration')
    assert.ok(!/^\s*plugins\s*=/u.test(line),'Unsupported inline native plugin configuration')
    const match=line.match(/^\s*\[(?!\[)([^\n]+)\]\s*(?:#.*)?$/u)
    if(match)headers.push({key:match[1].trim(),start:offset,end:offset+line.length})
    offset+=line.length
  }
  const key='plugins.'+JSON.stringify(selector),matches=headers.filter(h=>h.key===key)
  assert.ok(matches.length<=1,'Duplicate native selector table')
  for(const header of headers)if(header.key.includes(selector))assert.equal(header.key,key,'Unsupported native selector table')
  const found=matches[0]
  if(!found)return {owned:null,foreign:value.trimEnd()}
  const end=headers.find(h=>h.start>found.start)?.start??value.length
  return {owned:value.slice(found.start,end),foreign:(value.slice(0,found.start)+value.slice(end)).trimEnd()}
}

/** Experimental only: caller must supply the already verified bwrap runner. */
export async function createIsolatedCodexCompensation({ isolationRoot,userRoot,source,version,selector,run,checkpoint=async()=>{} }) {
  const root=resolve(isolationRoot),home=resolve(userRoot),src=resolve(source)
  const beneath=path=>{const delta=relative(root,resolve(path));return delta&&!delta.startsWith('..')}
  assert.equal(dirname(root),await realpath(tmpdir()));assert.match(root.split('/').at(-1),/^dsh-codex-native-/u)
  assert.ok(beneath(home)&&beneath(src),'Native experiment paths must be inside isolated root')
  assert.equal(run.scope,'bwrap-isolated-native-test');assert.equal(run.userRoot,home)
  return createCodexCompensation({root,userRoot:home,source:src,version,selector,run,checkpoint})
}

async function createCodexCompensation({root,userRoot:home,source:src,version,selector,run,checkpoint=async()=>{},receiptPath:retainedPath,journalIdentity=null}) {
  assert.match(selector,/^(?:yugoo-design|design-system)@[A-Za-z0-9_-]+$/u);assert.match(version,/^[A-Za-z0-9_.+-]+$/u)
  await safe(home);await safe(src)
  const catalog=selector.split('@')[1],config=join(home,'.codex/config.toml'),cache=join(home,'.codex/plugins/cache',catalog,selector.split('@')[0],version)
  const expected=await tree(src);assert.ok(expected,'Native source required')
  const receiptPath=retainedPath??join(root,'evidence','native-'+randomUUID()+'.json')
  let receipt={scope:'isolated-native-compensation-test',selector,version,source:src,userRoot:home,config,cache,receiptPath,journalIdentity,
    phase:'new',commands:[],expectedCache:expected,nativeCompensationVerified:false,releaseValidated:false}
  const retained=await text(receiptPath)
  if(retained!==null) {
    const saved=JSON.parse(retained)
    for(const key of ['selector','version','source','userRoot','config','cache','receiptPath'])assert.equal(saved[key],receipt[key],'Native recovery identity mismatch')
    assert.deepEqual(saved.journalIdentity,journalIdentity,'Native recovery transaction identity mismatch')
    assert.deepEqual(saved.expectedCache,expected,'Native recovery source drift')
    assert.ok(Array.isArray(saved.commands),'Invalid native recovery commands')
    receipt=saved
  }
  async function save() {
    await safe(receiptPath);await mkdir(dirname(receiptPath),{recursive:true})
    const temp=receiptPath+'.'+randomUUID()+'.tmp'
    await writeFile(temp,JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,receiptPath)
  }
  async function command(args) {
    let result
    try{result=await run(args);receipt.commands.push({args,exitCode:0,stdout:result.stdout,stderr:result.stderr??''});await save();return JSON.parse(result.stdout)}
    catch(error){receipt.commands.push({args,exitCode:error.code??1,stdout:error.stdout??'',stderr:error.stderr??'',message:error.message});await save();throw error}
  }
  const readback=()=>command(['plugin','list','--json'])
  function checkEntry(list) {
    const matches=list.installed.filter(p=>p.pluginId===selector);assert.ok(matches.length<=1,'Duplicate native installed selector')
    if(!matches.length)return null
    const p=matches[0];assert.equal(p.version,version,'Native installed version changed; retained');assert.equal(p.installed,true)
    assert.deepEqual(p.source,{source:'local',path:src},'Native source changed');return p
  }
  function ownedCache(actual) {
    if(actual===null)return
    for(const dir of actual.directories)assert.ok(expected.directories.includes(dir),'Unknown native cache directory retained')
    for(const [path,digest] of Object.entries(actual.files))assert.equal(digest,expected.files[path],'Unknown or edited native cache file retained')
  }
  async function observe() {
    await safe(config);const current=await text(config),parts=section(current,selector),actual=await tree(cache)
    receipt.observedConfigSha256=current===null?null:hash(current);receipt.observedSection=parts.owned
    receipt.observedSectionVerified=false;receipt.observedCache=actual;receipt.observedCacheSha256=hash(actual);await save()
    return {current,parts,actual}
  }
  async function register() {
    assert.equal(receipt.phase,'new')
    await safe(config);const before=await text(config),beforeParts=section(before,selector)
    assert.equal(beforeParts.owned,null,'Pre-existing native selector table refused')
    assert.equal(await tree(cache),null,'Pre-existing native version cache refused')
    const beforeList=await readback();assert.equal(checkEntry(beforeList),null,'Pre-existing native selector refused')
    receipt.beforeConfigSha256=before===null?null:hash(before);receipt.beforeForeign=beforeParts.foreign
    receipt.phase='prepared';await save()
    let failure=null
    try{await checkpoint('before-add',receipt);await command(['plugin','add',selector,'--json'])}catch(error){failure=error}
    try {
      const observed=await observe();ownedCache(observed.actual)
      assert.equal(observed.parts.foreign,beforeParts.foreign,'Unrelated native configuration changed during add')
      if(observed.parts.owned)assert.equal(observed.parts.owned.trim(),`[plugins.${JSON.stringify(selector)}]\nenabled = true`,'Unexpected native selector content')
      receipt.observedSectionVerified=true;await save()
      const installed=checkEntry(await readback())
      if(!failure){assert.ok(installed&&installed.enabled===true,'Native installed readback failed');assert.deepEqual(observed.actual,expected,'Incomplete native cache')}
      receipt.phase=failure?'recovery-required':'registered';await save()
      if(!failure)await checkpoint('after-add',receipt)
    }catch(error){failure??=error}
    if(failure){receipt.phase='recovery-required';receipt.failure=failure.message;await save();throw Object.assign(failure,{receiptPath})}
    return receipt
  }
  async function compensate() {
    try {
      // A process can exit after add has made effects but before observe/save.
      // Re-read those effects; never infer ownership merely from a phase name.
      if(receipt.phase==='prepared') {
        const observed=await observe();ownedCache(observed.actual)
        assert.equal(observed.parts.foreign,receipt.beforeForeign,'Foreign configuration changed before recovery; retained')
        if(observed.parts.owned)assert.equal(observed.parts.owned.trim(),`[plugins.${JSON.stringify(selector)}]\nenabled = true`,'Unexpected native selector content; retained')
        checkEntry(await readback())
        receipt.observedSectionVerified=true;receipt.phase='recovery-required';await save()
      }
      assert.ok(['registered','recovery-required'].includes(receipt.phase),'No prepared native mutation to compensate')
      assert.ok(Object.hasOwn(receipt,'observedCacheSha256'),'Native outcome was not observed; manual recovery required')
      assert.equal(receipt.observedSectionVerified,true,'Native selector ownership unverified; retained')
      await safe(config);const current=await text(config),parts=section(current,selector),actual=await tree(cache)
      assert.equal(parts.owned,receipt.observedSection,'Native selector was edited; retained')
      ownedCache(actual);assert.equal(hash(actual),receipt.observedCacheSha256,'Native cache changed; retained')
      const cacheRoot=join(home,'.codex/plugins/cache'),foreignBefore=await tree(cacheRoot)
      const ownedPrefix=relative(cacheRoot,cache)+'/'
      const foreignFiles=value=>Object.fromEntries(Object.entries(value?.files??{}).filter(([path])=>!path.startsWith(ownedPrefix)))
      const installed=checkEntry(await readback())
      if(installed||parts.owned) {
        assert.ok(installed&&installed.enabled===true&&parts.owned,'Native selector state changed; retained')
        await checkpoint('before-remove',receipt);await command(['plugin','remove',selector,'--json'])
      } else if(actual) {
        // An add may copy cache before failing to persist its config entry.
        for(const [path,digest] of Object.entries(actual.files)) {
          await safe(join(cache,path))
          assert.equal(hash(await readFile(join(cache,path))),digest,'Partial cache changed; retained')
          await unlink(join(cache,path))
        }
        for(const dir of [...actual.directories].sort((a,b)=>b.length-a.length))await rmdir(join(cache,dir))
      }
      const afterText=await text(config),after=section(afterText,selector)
      assert.equal(after.owned,null);assert.equal(after.foreign,parts.foreign,'Foreign configuration was not preserved')
      assert.equal(checkEntry(await readback()),null);assert.equal(await tree(cache),null)
      assert.deepEqual(foreignFiles(await tree(cacheRoot)),foreignFiles(foreignBefore),'Foreign cache files were not preserved')
      receipt.phase='compensated';receipt.emptyConfigRetained=afterText==='';receipt.compensationCompleted=true;await save();return receipt
    }catch(error){receipt.phase='recovery-required';receipt.compensationCompleted=false;receipt.compensationFailure=error.message;await save();throw Object.assign(error,{receiptPath})}
  }
  return {scope:receipt.scope,nativeCompensationVerified:false,receiptPath,register,compensate}
}

function verifiedProtocol(identity) {
  const protocol=verifiedNativeProtocols.find(item=>item.platform===identity.platform&&item.arch===identity.arch&&item.version===identity.version)
  assert.ok(protocol,'Unsupported native version/platform/architecture protocol')
  return protocol
}
function assertNativeList(value) {
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value)&&Array.isArray(value.installed)&&Array.isArray(value.available),'Unknown native plugin list JSON schema')
  const ids=new Set()
  for(const entry of value.installed) {
    assert.ok(entry&&typeof entry==='object'&&!Array.isArray(entry),'Unknown native installed entry schema')
    assert.ok(typeof entry.pluginId==='string'&&entry.pluginId.length>0&&typeof entry.version==='string'&&entry.version.length>0,'Unknown native installed identity schema')
    assert.ok(typeof entry.installed==='boolean'&&typeof entry.enabled==='boolean'&&entry.source&&typeof entry.source==='object'&&!Array.isArray(entry.source),'Unknown native installed state schema')
    assert.ok(!ids.has(entry.pluginId),'Duplicate native installed selector');ids.add(entry.pluginId)
  }
  assert.ok(value.available.every(entry=>entry&&typeof entry==='object'&&!Array.isArray(entry)),'Unknown native available entry schema')
}

/** Inspection/pinning primitives never admit an adapter into the private WeakMap.
 * An injected runner is useful for isolated contract tests, not production authority. */
export async function runPinnedCodexCommand(identity,args,{userRoot,run=exec}={}) {
  const pinned=structuredClone(identity),argv=structuredClone(args)
  assert.equal(pinned.protocol,verifiedProtocol(pinned).protocol,'Native protocol identity mismatch')
  await safe(pinned.executable)
  assert.equal(await realpath(pinned.executable),pinned.executable,'Native executable path changed')
  assert.ok((await lstat(pinned.executable)).isFile(),'Native executable must be a regular file')
  assert.equal(hash(await readFile(pinned.executable)),pinned.sha256,'Native executable changed')
  const result=await run(pinned.executable,argv,{env:{...process.env,HOME:userRoot,CODEX_HOME:join(userRoot,'.codex')},timeout:15000,maxBuffer:1024*1024})
  assert.equal(hash(await readFile(pinned.executable)),pinned.sha256,'Native executable changed during command')
  if(argv.length===3&&argv[0]==='plugin'&&argv[1]==='list'&&argv[2]==='--json')assertNativeList(JSON.parse(result.stdout))
  return result
}
export async function inspectCodexNativeProtocol({executable,userRoot,platform=process.platform,arch=process.arch,run=exec}) {
  assert.ok(verifiedNativeProtocols.some(item=>item.platform===platform&&item.arch===arch),'Unsupported native platform/architecture protocol')
  const path=await realpath(resolve(executable));await safe(path)
  assert.ok((await lstat(path)).isFile(),'Native executable must be a regular file')
  const sha256=hash(await readFile(path))
  const result=await run(path,['--version'],{env:{...process.env,HOME:userRoot,CODEX_HOME:join(userRoot,'.codex')},timeout:15000,maxBuffer:1024*1024})
  assert.equal(hash(await readFile(path)),sha256,'Native executable changed during version probe')
  const identity={executable:path,sha256,platform,arch,version:result.stdout.trim()}
  identity.protocol=verifiedProtocol(identity).protocol
  await runPinnedCodexCommand(identity,['plugin','list','--json'],{userRoot,run})
  return Object.freeze(identity)
}

/** Public bridge retains real-profile ownership and uses only actual execFile.
 * Fixture and installed-runtime admission remain the installer's separate gates. */
export async function createCodexNativeAdapter({executable,userRoot}) {
  assert.equal(resolve(userRoot),resolve(homedir()),'Production adapter requires actual user profile')
  const identity=await inspectCodexNativeProtocol({executable,userRoot})
  const run=args=>runPinnedCodexCommand(identity,args,{userRoot})
  return bridgeAdapter({userRoot,run,identity})
}

async function bridgeAdapter({userRoot,run,identity}) {
  async function upgradeCache(plan,expected) {
    assert.match(plan.selector,/^(?:yugoo-design|design-system)@[A-Za-z0-9_-]+$/u)
    const root=join(plan.userRoot,'.codex/plugins/cache',plan.selector.split('@')[1],plan.selector.split('@')[0])
    await safe(root)
    let versions=[]
    try { versions=await readdir(root) } catch(error) { if(error.code!=='ENOENT')throw error }
    assert.ok(versions.length<=1,'Unknown native selector version cache retained')
    for(const version of versions) {
      assert.ok(Object.hasOwn(expected,version),'Unknown native selector version cache retained')
      assert.deepEqual(await tree(join(root,version)),expected[version],'Native upgrade cache changed; retained')
    }
    return root
  }
  const transaction=plan=>{
    assert.equal(plan.userRoot,resolve(userRoot),'Native profile mismatch')
    assert.match(plan.id,/^[0-9a-f-]{36}$/u,'Native transaction ID required')
    return createCodexCompensation({root:plan.receiptDirectory,userRoot:plan.userRoot,source:plan.target,
      version:plan.package.version,selector:plan.selector,run,
      receiptPath:join(plan.receiptDirectory,plan.id+'.native.json'),
      journalIdentity:{transactionId:plan.id,planSha256:plan.planSha256,protocol:plan.protocol}})
  }
  const adapter=Object.freeze({scope:'codex-native-transaction',nativeCompensationVerified:true,
    probe:async()=>({available:true,identity,nativeCompensationVerified:true,applySupported:true}),
    assertPluginIdentityAvailable:async()=>{
      const list=JSON.parse((await run(['plugin','list','--json'])).stdout)
      assertNativeList(list)
      assert.ok(!list.installed.some(entry=>entry.pluginId.startsWith('design-system@')),'Legacy design-system plugin found. Uninstall with its previous receipt or native exact selector before installing yugoo-design; no changes made.')
    },
    register:async plan=>(await transaction(plan)).register(),
    readback:async plan=>{
      const list=JSON.parse((await run(['plugin','list','--json'])).stdout)
      const matches=list.installed.filter(entry=>entry.pluginId===plan.selector)
      assert.ok(matches.length<=1,'Duplicate native installed selector')
      if(!matches.length)return false
      assert.equal(matches[0].version,plan.package.version)
      assert.deepEqual(matches[0].source,{source:'local',path:plan.target})
      assert.equal(matches[0].enabled,true);return matches[0].installed===true
    },
    inspectUpgrade:async plan=>{
      assert.equal(plan.userRoot,resolve(userRoot),'Native profile mismatch')
      const expected=await tree(plan.target)
      assert.ok(expected,'Native upgrade source required')
      const root=await upgradeCache(plan,{[plan.package.version]:expected})
      assert.deepEqual(await tree(join(root,plan.package.version)),expected,'Old native cache does not match owned source')
      assert.equal(await adapter.readback(plan),true,'Old native registration readback failed')
      const owned=section(await text(join(plan.userRoot,'.codex/config.toml')),plan.selector).owned
      assert.ok(owned,'Old native selector configuration required')
      return {cache:join(root,plan.package.version),tree:expected,ownedConfig:owned}
    },
    upgradeSource:async plan=>{
      assert.equal(plan.userRoot,resolve(userRoot),'Native profile mismatch')
      return tree(plan.target)
    },
    replaceUpgrade:async (plan,{expected,ownedConfig})=>{
      assert.equal(plan.userRoot,resolve(userRoot),'Native profile mismatch')
      assert.deepEqual(await tree(plan.target),expected[plan.package.version],'Replacement source changed; retained')
      await upgradeCache(plan,expected)
      const config=join(plan.userRoot,'.codex/config.toml'),before=section(await text(config),plan.selector)
      assert.equal(before.owned,ownedConfig,'Native upgrade selector configuration changed; retained')
      await run(['plugin','add',plan.selector,'--json'])
      const after=section(await text(config),plan.selector)
      assert.equal(after.foreign,before.foreign,'Native replacement changed foreign configuration')
      assert.equal(after.owned,ownedConfig,'Native replacement changed owned configuration')
      assert.equal(await adapter.readback(plan),true,'Native replacement readback failed')
      const root=await upgradeCache(plan,{[plan.package.version]:await tree(plan.target)})
      assert.deepEqual(await tree(join(root,plan.package.version)),await tree(plan.target),'Native replacement cache readback failed')
    },
    uninstallUpgrade:async plan=>{
      const root=await upgradeCache(plan,{[plan.package.version]:plan.newNativeTree})
      assert.deepEqual(await tree(join(root,plan.package.version)),plan.newNativeTree,'Upgraded native cache changed; retained')
      assert.equal(await adapter.readback(plan),true,'Upgraded native selector changed; retained')
      const config=join(plan.userRoot,'.codex/config.toml'),before=section(await text(config),plan.selector)
      assert.equal(before.owned,plan.upgrade.native.ownedConfig,'Upgraded native selector configuration changed; retained')
      await run(['plugin','remove',plan.selector,'--json'])
      const after=section(await text(config),plan.selector)
      assert.equal(after.owned,null);assert.equal(after.foreign,before.foreign)
      assert.equal(await tree(join(root,plan.package.version)),null,'Upgraded native cache removal failed')
      assert.equal(await adapter.readback(plan),false,'Upgraded native removal readback failed')
    },
    compensate:async plan=>(await transaction(plan)).compensate()})
  admittedAdapters.set(adapter,identity.scope==='isolated-acceptance'?'isolated':'production');return adapter
}

/** Isolated acceptance harness exercises the public transaction bridge. It
 * cannot grant authority for a real profile or an arbitrary caller boolean. */
export async function createIsolatedCodexInstallerAdapter({isolationRoot,userRoot,run}) {
  const root=await realpath(resolve(isolationRoot)),home=resolve(userRoot),delta=relative(root,home)
  assert.equal(dirname(root),await realpath(tmpdir()))
  assert.match(root.split('/').at(-1),/^dsh-codex-native-/u)
  assert.ok(delta&&!delta.startsWith('..'),'Isolated profile required')
  assert.equal(run.scope,'bwrap-isolated-native-test');assert.equal(run.userRoot,home)
  return bridgeAdapter({userRoot:home,run,identity:{scope:'isolated-acceptance',root}})
}
