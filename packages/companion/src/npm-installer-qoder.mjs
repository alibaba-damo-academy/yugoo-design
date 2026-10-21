/** Persistent native Qoder registration. Reuses the npm overlay; never launches a model. */
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cp,lstat,mkdir,mkdtemp,readFile,readdir,realpath,writeFile} from 'node:fs/promises'
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {promisify} from 'node:util'

const runNative=promisify(execFile)
const PLUGIN='yugoo-design', LEGACY='design-system'
const marker='design-system-npm-registration.json'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const json=async path=>JSON.parse(await readFile(path,'utf8'))
const ownRow=row=>[PLUGIN,LEGACY].includes(row.name)||[PLUGIN,LEGACY].includes(row.id?.split('@')[0])
const foreignRows=rows=>rows.filter(row=>!ownRow(row)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
async function directory(path) {
  assert.ok(isAbsolute(path),'Absolute directory required')
  assert.ok((await lstat(path)).isDirectory(),'Regular directory required (not a symlink)')
  assert.equal(await realpath(path),resolve(path),'Symlink directory ancestors rejected')
  return path
}
async function inventory(root,prefix='') {
  const result={}
  for(const name of (await readdir(join(root,prefix))).sort()) {
    const key=prefix?`${prefix}/${name}`:name, info=await lstat(join(root,key))
    assert.ok(!info.isSymbolicLink(),`Plugin symlink rejected: ${key}`)
    if(info.isDirectory())Object.assign(result,await inventory(root,key))
    else {
      assert.ok(info.isFile(),`Regular plugin file required: ${key}`)
      if(key!==marker)result[key]=digest(await readFile(join(root,key)))
    }
  }
  return result
}
function launcher(entry) {
  return `import { existsSync } from 'node:fs'\nconst entry = new URL(${JSON.stringify(pathToFileURL(entry).href)})\nif (!existsSync(entry)) throw new Error('Missing shared Companion entry: ' + entry.href + '; retain or restore the registered npm version')\nawait import(entry.href)\n`
}
async function owned(row,{npmRoot,version,files}) {
  assert.equal(row.id,'yugoo-design@local','Unexpected Qoder plugin identity')
  assert.equal(row.scope,'user','Existing plugin is not user scoped')
  assert.ok(row.enabled===true,'Existing plugin is disabled in this working directory')
  assert.equal(row.version,version,'Listed plugin version differs')
  const path=await directory(row.installPath)
  let proof
  try {proof=await json(join(path,marker))} catch {throw new Error('Existing yugoo-design plugin is not owned by this npm installer')}
  assert.equal(proof.schemaVersion,1,'Unknown plugin ownership marker')
  assert.equal(proof.npmRoot,npmRoot,'Existing plugin belongs to another npm installation')
  assert.equal(proof.version,version,'Existing plugin version differs; explicit native uninstall is required before replacement')
  assert.deepEqual(proof.files,files,'Packaged overlay changed; explicit native uninstall is required before replacement')
  assert.deepEqual(await inventory(path),proof.files,'Installed owned plugin was modified; refusing replacement')
  assert.equal(await readFile(join(path,'scripts/design.mjs'),'utf8'),launcher(join(npmRoot,'payload/shared/scripts/design.mjs')),'Installed shared entry differs')
  return path
}
async function receiptParent(path) {
  try {return await directory(path)} catch(error) {
    if(error.code!=='ENOENT')throw error
    const parent=dirname(path)
    assert.notEqual(parent,path,'Receipt parent must exist')
    await receiptParent(parent)
    await mkdir(path)
    return await directory(path)
  }
}

export async function installQoderPlugin({npmRoot,executable='qodercli',configDir,cwd=process.cwd(),stageRoot,run=runNative}) {
  const root=await directory(resolve(npmRoot))
  await directory(resolve(cwd))
  if(configDir)await directory(resolve(configDir))
  assert.ok(typeof stageRoot==='string'&&isAbsolute(stageRoot),'External receipt/staging directory required')
  const rel=relative(root,resolve(stageRoot))
  assert.ok(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel),'Receipt/staging directory must be outside the npm installation')
  // Do not guess Qoder's default profile. Omitted configDir leaves native env/default resolution intact.
  const args=configDir?['--config-dir',resolve(configDir)]:[]
  const invoke=async tail=>run(executable,[...args,...tail],{cwd:resolve(cwd),timeout:15000,maxBuffer:4*1024*1024,env:process.env})
  const list=async()=>{
    const result=JSON.parse((await invoke(['plugin','list','--json'])).stdout)
    assert.ok(Array.isArray(result),'Qoder list must return a JSON array')
    return result
  }
  const pkg=await json(join(root,'package.json'))
  const overlay=await directory(join(root,'payload/overlays/qoder'))
  const manifest=await json(join(overlay,'.qoder-plugin/plugin.json'))
  assert.equal(manifest.name,PLUGIN,'Unexpected packaged Qoder identity')
  assert.equal(manifest.version,pkg.version,'Plugin/npm version mismatch')
  const entry=join(root,'payload/shared/scripts/design.mjs')
  assert.ok((await lstat(entry)).isFile(),'Shared Companion entry missing')
  // Require the actual shipped resources; copying does not create substitute methods or hooks.
  for(const path of ['.mcp.json','hooks/hooks.json','commands/yugoo.md','skills/yugoo/SKILL.md','skills/yugoo/native-execution.md',
    'scripts/design.mjs','scripts/qoder-context.mjs','scripts/qoder-notification.mjs','scripts/qoder-connection.mjs','scripts/qoder-hook-transport.mjs','scripts/native-hook-transport.mjs'])
    assert.ok((await lstat(join(overlay,path))).isFile(),`Missing Qoder asset: ${path}`)
  if((await readFile(join(overlay,'scripts/native-hook-transport.mjs'),'utf8')).includes('./windows-private-storage.mjs'))
    for(const path of ['scripts/windows-private-storage.mjs','scripts/windows-native-platform.mjs'])
      assert.ok((await lstat(join(overlay,path))).isFile(),`Missing Qoder asset: ${path}`)
  const expectedFiles=await inventory(overlay)
  expectedFiles['scripts/design.mjs']=digest(launcher(entry))
  const beforeRows=await list()
  const prior=beforeRows.filter(ownRow)
  assert.ok(!prior.some(row=>row.name===LEGACY||row.id?.split('@')[0]===LEGACY),'Legacy design-system plugin found. Use Qoder native uninstall for its exact old selector and scope before installing yugoo-design; no changes made.')
  const receipt={schemaVersion:1,kind:'native-qoder-registration',host:'qoder',scope:'user',npmRoot:root,package:{name:pkg.name,version:pkg.version},
    cwd:resolve(cwd),...(configDir?{configDir:resolve(configDir)}:{}),hostLaunched:false,modelLaunched:false,
    runtimeAcceptance:false,limitations:['Native persistent registration only; no model, MCP startup, panel, GRA or KAG acceptance.','Retain this exact npm installation; the copied plugin imports its absolute shared entry.']}
  if(prior.length) {
    assert.equal(prior.length,1,'Multiple existing yugoo-design installations; refusing precedence ambiguity')
    const installedPath=await owned(prior[0],{npmRoot:root,version:pkg.version,files:expectedFiles})
    return {...receipt,status:'already-registered',hostRegistered:true,pluginId:prior[0].id,installedPath}
  }
  await receiptParent(resolve(stageRoot))
  const stage=await mkdtemp(join(stageRoot,'qoder-registration-')),plugin=join(stage,'plugin')
  const receiptFile=join(stage,'receipt.json')
  await writeFile(receiptFile,JSON.stringify({...receipt,status:'prepared'},null,2)+'\n',{flag:'wx'})
  try {
    await cp(overlay,plugin,{recursive:true,errorOnExist:true,force:false})
    await writeFile(join(plugin,'scripts/design.mjs'),launcher(entry))
    const files=await inventory(plugin)
    assert.deepEqual(files,expectedFiles,'Packaged overlay changed during staging')
    await writeFile(join(plugin,marker),JSON.stringify({schemaVersion:1,npmRoot:root,version:pkg.version,files},null,2)+'\n',{flag:'wx'})
    const installed=JSON.parse((await invoke(['plugin','install',plugin,'--scope','user','--json'])).stdout)
    assert.equal(installed.ok,true,'Native Qoder install did not confirm success')
    assert.equal(installed.pluginId,'yugoo-design@local','Native Qoder install returned wrong identity')
    const afterRows=await list()
    assert.deepEqual(foreignRows(afterRows),foreignRows(beforeRows),'Foreign plugin registrations changed during native install; inspect retained state')
    const rows=afterRows.filter(ownRow)
    assert.equal(rows.length,1,'Fresh-process Qoder list did not confirm unique registration')
    assert.equal(rows[0].version,pkg.version,'Native Qoder version mismatch')
    const installedPath=await owned(rows[0],{npmRoot:root,version:pkg.version,files:expectedFiles})
    assert.equal(await realpath(installed.path),installedPath,'Install/list cache path mismatch')
    const result={...receipt,status:'registered',hostRegistered:true,pluginId:rows[0].id,installedPath,receiptFile}
    await writeFile(receiptFile,JSON.stringify(result,null,2)+'\n')
    return result
  } catch(error) {
    // Native state is retained for inspection; never delete foreign settings or invent rollback.
    await writeFile(receiptFile,JSON.stringify({...receipt,status:'failed',receiptFile,error:error.message},null,2)+'\n')
    error.receiptFile=receiptFile
    throw error
  }
}
