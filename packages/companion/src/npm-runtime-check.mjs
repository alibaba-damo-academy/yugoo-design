import { isPathWithin } from './npm-installer-paths.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = value => sha(JSON.stringify(value))
const inside = isPathWithin
export async function assertRuntimePath(path) {
  for(let p=resolve(path);;p=dirname(p)) {
    try { assert.ok(!(await lstat(p)).isSymbolicLink(),`Runtime symlink rejected: ${p}`) }
    catch(e) { if(e.code!=='ENOENT')throw e }
    if(p===dirname(p))break
  }
}
async function filePin(path) {
  await assertRuntimePath(path)
  assert.ok((await lstat(path)).isFile(),'Runtime regular file required')
  return {path,sha256:sha(await readFile(path))}
}
async function treePins(root) {
  await assertRuntimePath(root)
  const pins=[]
  async function walk(path) {
    for(const name of (await readdir(path)).sort()) {
      const p=join(path,name),s=await lstat(p)
      assert.ok(!s.isSymbolicLink(),'Runtime dependency symlink rejected')
      if(s.isDirectory())await walk(p)
      else pins.push(await filePin(p))
    }
  }
  await walk(root);return pins
}
function dependencyRoots(root) {
  const roots=[join(root,'node_modules')]
  for(let p=dirname(root);;p=dirname(p)) {
    if(p.split(sep).at(-1)==='node_modules'){roots.push(p);break}
    if(p===dirname(p))break
  }
  return roots
}
async function packageRoot(name,roots) {
  // Resolve package manifests explicitly inside this installation; never use
  // NODE_PATH, global module paths or an enclosing developer workspace.
  for(const root of roots) {
    const path=join(root,...name.split('/'),'package.json')
    try {
      const pin=await filePin(path),manifest=JSON.parse(await readFile(path,'utf8'))
      assert.equal(manifest.name,name,'Runtime package identity mismatch')
      return {root:dirname(path),manifest,pin}
    } catch(e) { if(e.code!=='ENOENT')throw e }
  }
  throw Object.assign(Error(`Missing installed dependency: ${name}`),{code:'ENOENT'})
}
const GIT_CHECKS=['init','publish','history','diff','read','agent-read-arguments','project-pin','read-no-publication']
async function describeGit(root,observation,pins) {
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
  const declared=manifest['x-design-release-review']?.nativeGit
  if(declared===undefined)return {required:false,status:'not-declared'}
  assert.equal(declared,'shared-core-library','Unknown installed Git runtime declaration')
  const shared=join(root,'payload/shared'),nativeRoot=join(shared,'git-native'),byPath=new Map(pins.map(pin=>[pin.path,pin]))
  const pin=path=>{const value=byPath.get(path);assert.ok(value,'Missing installed Git asset: '+path);return value}
  const recipe=JSON.parse(await readFile(pin(join(nativeRoot,'runtime-manifest.json')).path,'utf8'))
  const source=JSON.parse(await readFile(pin(join(nativeRoot,'SOURCE.json')).path,'utf8'))
  assert.equal(recipe.schemaVersion,1);assert.equal(pin(join(nativeRoot,'SOURCE.json')).sha256,recipe.sourceSha256)
  const pathFor=path=>{assert.ok(typeof path==='string'&&path&&!path.includes('\\')&&!path.split('/').some(p=>!p||p==='.'||p==='..'),'Unsafe Git manifest path');const target=resolve(nativeRoot,path);assert.ok(inside(nativeRoot,target)&&target!==nativeRoot);return target}
  for(const [path,identity] of Object.entries(recipe.files))assert.equal(pin(pathFor(path)).sha256,identity.sha256,'Installed Git material changed')
  for(const input of [...source.inputs,...source.artifacts])assert.equal(pin(pathFor(input.path)).sha256,input.sha256,'Installed Git source/prebuild changed')
  assert.deepEqual(source.artifacts.map(x=>x.path).sort(),['native/yugoo_git.linux-x64.node','native/yugoo_git.win32-x64.node'])
  assert.ok(['linux','win32'].includes(observation.platform)&&observation.arch==='x64'&&(observation.platform!=='linux'||observation.libc==='glibc'),'Unsupported installed Git platform')
  const descriptor={required:true,status:'present',backend:'native',
    worker:pin(join(shared,'scripts/git-native-worker.js')),probe:pin(join(shared,'scripts/git-runtime-check.mjs')),
    loader:pin(join(nativeRoot,'index.cjs')),materials:pin(join(nativeRoot,'runtime-manifest.json')),
    native:pin(join(nativeRoot,`native/yugoo_git.${observation.platform}-${observation.arch}.node`))}
  return {...descriptor,identitySha256:digest(descriptor)}
}
/** New packages require Git independently of the optional embedding runtime. */
export function assertGitRuntimeReceipt(receipt,current) {
  const expected=current.gitPrerequisites
  if(!expected?.required)return
  assert.equal(receipt.scope,'installed-runtime-readonly','Required Git check needs an actual installed-runtime receipt')
  assert.deepEqual(receipt.gitPrerequisites,expected,'Git static prerequisites mismatch')
  assert.equal(expected.status,'present','Required Git assets are not present')
  assert.equal(receipt.git?.required,true,'Required Git receipt missing')
  assert.equal(receipt.git.status,'passed','Required library Git check did not pass')
  assert.equal(receipt.git.identitySha256,expected.identitySha256,'Git runtime descriptor drift')
  for(const key of ['backend','worker','probe','loader','materials','native'])assert.deepEqual(receipt.git[key],expected[key],'Git runtime '+key+' mismatch')
  const load=receipt.git.load
  assert.equal(load?.status,'passed');assert.equal(load.code,0);assert.equal(load.signal,null)
  assert.ok(Number.isInteger(load.childPid)&&load.childPid>0,'Git check child PID missing')
  assert.equal(load.childAbsent,true,'Git check child exit was not verified')
  for(const key of ['execPath','node','platform','arch'])assert.equal(load.observation?.[key],current.observation[key],'Git check '+key+' mismatch')
  assert.equal(load.externalGitCalls,0);assert.deepEqual(load.checks,GIT_CHECKS)
}
export async function inspectRuntime({npmRoot,disableEmbedding=false,host}={}) {
  assert.equal(typeof disableEmbedding,'boolean')
  const root=resolve(npmRoot)
  await assertRuntimePath(root);assert.equal(await realpath(root),root)
  const observation={execPath:process.execPath,node:process.versions.node,platform:process.platform,arch:process.arch,
    libc:process.platform==='linux'?(process.report?.getReport().header.glibcVersionRuntime?'glibc':'musl'):'not-applicable'}
  const result={schemaVersion:1,npmRoot:root,observation,
    embedding:{provider:disableEmbedding?'disabled':'local',selection:disableEmbedding?'explicit-cli':'default-local',runningServerConfigurationVerified:false},
    status:'unverified',pins:[...await treePins(root),await filePin(await realpath(process.execPath))],nativeHostRegistrationVerified:false,transformersVerified:false,
    semanticKagVerified:false,graVerified:false,licenseObligationsAccepted:false}
  const finalize=()=>{
    result.pins.sort((a,b)=>a.path.localeCompare(b.path))
    result.identitySha256=digest({npmRoot:root,observation,embedding:result.embedding,gitPrerequisites:result.gitPrerequisites,pins:result.pins})
    return result
  }
  if(host==='dsh'){result.status='not-applicable';result.reason='DSH package route is not a Companion runtime';return finalize()}
  try {result.gitPrerequisites=await describeGit(root,observation,result.pins)}
  catch(e) {result.gitPrerequisites={required:true,status:'failed',reason:e.message};result.status='failed';result.reason=e.message;return finalize()}
  if(disableEmbedding){result.status='disabled';return finalize()}
  try {
    const runtime=join(root,'payload/shared/knowledge/runtime.mjs')
    result.runtime=await filePin(runtime)
    const req=createRequire(runtime),roots=dependencyRoots(root)
    const sharp=await packageRoot('sharp',roots)
    const entry=req.resolve('sharp')
    assert.ok(inside(sharp.root,entry),'Sharp resolved outside the intended installed dependency location')
    await assertRuntimePath(entry)
    result.sharp={entry,root:sharp.root,name:sharp.manifest.name,version:sharp.manifest.version}
    result.pins.push(...await treePins(sharp.root))
    const platform=`${observation.platform==='linux'&&observation.libc==='musl'?'linuxmusl':observation.platform}-${observation.arch}`
    const addon=`@img/sharp-${platform}`,vips=`@img/sharp-libvips-${platform}`
    const declared=sharp.manifest.optionalDependencies??{}
    if(!declared[addon]) { result.status='unknown';result.reason=`No declared platform mapping: ${addon}`;return finalize() }
    result.prerequisites=[]
    for(const name of [addon,...(declared[vips]?[vips]:[])]) {
      const pkg=await packageRoot(name,roots)
      assert.equal(pkg.manifest.version,declared[name],'Installed native package version differs from sharp declaration')
      result.prerequisites.push({name,version:pkg.manifest.version,root:pkg.root})
      result.pins.push(...await treePins(pkg.root))
      if(name===addon)result.native=await filePin(join(pkg.root,'lib',`sharp-${platform}.node`))
    }
    result.status='present'
  } catch(e) {
    result.status=e.code==='ENOENT'?'missing':'failed';result.reason=e.message
  }
  return finalize()
}

const loader = `const {createRequire}=require('node:module');
const req=createRequire(process.argv[1]);
try { const sharp=req('sharp');const native=Object.keys(require.cache).filter(p=>p.endsWith('.node'));
console.log(JSON.stringify({node:process.versions.node,execPath:process.execPath,native,versions:sharp.versions})); }
catch(e){console.error(e.message);process.exitCode=1;}`

export async function checkRuntime(options) {
  const run=options.testRunner
  assert.ok(!run||options.scope==='isolated-test-contract','Injected runner requires isolated test scope')
  const before=await inspectRuntime(options)
  const directory=resolve(options.receiptDirectory)
  assert.ok(!inside(before.npmRoot,directory),'Runtime receipt directory must be outside npm package')
  // Diagnostics must also stay outside every checked external dependency.
  for(const p of before.prerequisites??[])assert.ok(!inside(p.root,directory),'Receipt directory overlaps native dependency')
  if(before.sharp)assert.ok(!inside(before.sharp.root,directory),'Receipt directory overlaps sharp')
  await assertRuntimePath(directory)
  const receipt={...before,load:{status:'not-run'},releaseValidated:false,scope:run?'isolated-test-contract':'installed-runtime-readonly'}
  receipt.git=before.gitPrerequisites??{required:false,status:'not-declared'}
  if(before.gitPrerequisites?.required) {
    let childPid=null,diagnostic
    try {
      assert.equal(before.gitPrerequisites.status,'present','Required installed Git assets are missing or changed')
      const entry=before.gitPrerequisites.probe.path
      await mkdir(directory,{recursive:true})
      diagnostic=await mkdtemp(join(directory,'library-git-'))
      for(const name of ['home','tmp','cache'])await mkdir(join(diagnostic,name))
      const env={PATH:'',HOME:join(diagnostic,'home'),USERPROFILE:join(diagnostic,'home'),TMPDIR:join(diagnostic,'tmp'),TMP:join(diagnostic,'tmp'),TEMP:join(diagnostic,'tmp'),XDG_CACHE_HOME:join(diagnostic,'cache')}
      if(process.platform==='win32'&&process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot
      const pending=execute(before.observation.execPath,[entry],{cwd:diagnostic,env,timeout:30000,killSignal:'SIGKILL',maxBuffer:1024*1024,encoding:'utf8'})
      childPid=pending.child?.pid??null
      const output=await pending
      const value=JSON.parse(output.stdout)
      assert.equal(value.status,'passed');assert.equal(value.backend,'native');assert.equal(value.externalGitCalls,0)
      assert.deepEqual(value.checks,GIT_CHECKS)
      assert.ok(Number.isInteger(childPid)&&childPid>0,'Git diagnostic child PID missing')
      let childAbsent=false
      try {process.kill(childPid,0)} catch(e) {childAbsent=e.code==='ESRCH'}
      assert.equal(childAbsent,true,'Git check child is still present')
      const after=await inspectRuntime(options)
      assert.equal(after.identitySha256,before.identitySha256,'Runtime prerequisites changed during Git check')
      receipt.git={...before.gitPrerequisites,status:'passed',load:{...value,code:0,signal:null,childPid,childAbsent,diagnosticDirectory:diagnostic,stderr:output.stderr}}
      assertGitRuntimeReceipt(receipt,before)
    } catch(e) {
      let childAbsent=null
      if(childPid) {try {process.kill(childPid,0);childAbsent=false} catch(error) {childAbsent=error.code==='ESRCH'}}
      receipt.git={...before.gitPrerequisites,status:'failed',reason:e.message,load:{status:'failed',code:e.code??null,signal:e.signal??null,killed:e.killed??false,childPid,childAbsent,diagnosticDirectory:diagnostic,stderr:String(e.stderr??'').slice(0,16384)}}
      receipt.status='failed';return receipt
    }
  }
  if(before.status!=='present')return receipt
  await mkdir(directory,{recursive:true})
  const diagnostic=await mkdtemp(join(directory,'native-load-'))
  for(const name of ['home','tmp','cache'])await mkdir(join(diagnostic,name))
  const env={HOME:join(diagnostic,'home'),USERPROFILE:join(diagnostic,'home'),TMPDIR:join(diagnostic,'tmp'),TMP:join(diagnostic,'tmp'),TEMP:join(diagnostic,'tmp'),XDG_CACHE_HOME:join(diagnostic,'cache')}
  if(process.platform==='win32'&&process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot
  let childPid=null
  try {
    const pending=(run??execute)(before.observation.execPath,['-e',loader,before.runtime.path],
      {cwd:diagnostic,env,timeout:15000,killSignal:'SIGKILL',maxBuffer:1024*1024,encoding:'utf8'})
    childPid=pending.child?.pid??null
    const output=await pending
    const loaded=JSON.parse(output.stdout)
    assert.equal(loaded.node,before.observation.node,'Loader Node version mismatch')
    assert.equal(loaded.execPath,before.observation.execPath,'Loader Node executable mismatch')
    assert.ok(loaded.native.includes(before.native.path),'Expected installed native addon was not loaded')
    receipt.load={status:'passed',code:0,signal:null,stdout:output.stdout,stderr:output.stderr,observation:loaded,diagnosticDirectory:diagnostic}
  } catch(e) {
    receipt.load={status:'failed',code:e.code??null,signal:e.signal??null,killed:e.killed??false,
      reason:e.message,stdout:e.stdout??'',stderr:e.stderr??'',diagnosticDirectory:diagnostic}
  }
  let childAbsent=null
  if(childPid) { try { process.kill(childPid,0);childAbsent=false } catch(e) { childAbsent=e.code==='ESRCH' } }
  receipt.load={...receipt.load,childPid,childAbsent}
  if(childAbsent===false)receipt.load={...receipt.load,status:'failed',reason:'Runtime check child still present'}
  const after=await inspectRuntime(options)
  if(after.identitySha256!==before.identitySha256)receipt.load={...receipt.load,status:'failed',reason:'Runtime prerequisites changed during load check'}
  receipt.status=receipt.load.status==='passed'?'load-verified':'failed'
  return receipt
}
