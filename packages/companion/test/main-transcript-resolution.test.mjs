import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {resolveCodexMainTranscript} from '../src/native-run-resolution.mjs'

test('main transcript discovery verifies exact UUID/cwd and rejects ambiguity and children',async()=>{
 const root=await mkdtemp(join(tmpdir(),'main-transcript-test-'))
 const id='00000000-0000-4000-8000-000000000077'
 const path=join(root,`rollout-${id}.jsonl`)
 const options={threadId:id,nativeCwd:root,sessionsRoot:root}
 const header={type:'session_meta',payload:{id,cwd:root}}
 try {
  assert.equal(await resolveCodexMainTranscript(options),undefined)
  await writeFile(path,JSON.stringify(header)+'\n')
  assert.equal(await resolveCodexMainTranscript(options),path)
  await assert.rejects(resolveCodexMainTranscript({...options,nativeCwd:tmpdir()}),/cwd mismatch/)
  await writeFile(join(root,`duplicate-${id}.jsonl`),JSON.stringify(header)+'\n')
  await assert.rejects(resolveCodexMainTranscript(options),/ambiguous/)
  assert.equal(await resolveCodexMainTranscript({...options,transcriptPath:path}),path)
  header.payload.source={subagent:{thread_spawn:{parent_thread_id:id}}}
  await writeFile(path,JSON.stringify(header)+'\n')
  await assert.rejects(resolveCodexMainTranscript({...options,transcriptPath:path}),/child session/)
  header.payload.source={subagent:'review'}
  await writeFile(path,JSON.stringify(header)+'\n')
  await assert.rejects(resolveCodexMainTranscript({...options,transcriptPath:path}),/child session/)
  await writeFile(path,'secret invalid json\n')
  await assert.rejects(resolveCodexMainTranscript({...options,transcriptPath:path}),error=>!error.message.includes('secret'))
 } finally { await rm(root,{recursive:true,force:true}) }
})

test('serve may defer only unavailable exact transcript evidence; default validation and identity stay strict', async()=>{
 const root=await mkdtemp(join(tmpdir(),'main-transcript-pending-'))
 const id='00000000-0000-4000-8000-000000000077',path=join(root,'exact.jsonl')
 const options={threadId:id,nativeCwd:root,sessionsRoot:root,transcriptPath:path}
 try {
  await assert.rejects(resolveCodexMainTranscript(options),{code:'ENOENT'})
  assert.equal(await resolveCodexMainTranscript({...options,deferIncomplete:true}),path)
  await writeFile(path,'{"type":"session_meta"')
  await assert.rejects(resolveCodexMainTranscript(options),/incomplete/)
  assert.equal(await resolveCodexMainTranscript({...options,deferIncomplete:true}),path)
  await writeFile(path,' '.repeat(1024*1024))
  await assert.rejects(resolveCodexMainTranscript({...options,deferIncomplete:true}),/exceeds limit/)
  await writeFile(path,'secret invalid JSON\n')
  await assert.rejects(resolveCodexMainTranscript({...options,deferIncomplete:true}),error=>!error.message.includes('secret'))
  await writeFile(path,JSON.stringify({type:'session_meta',payload:{id:'wrong',cwd:root}})+'\n')
  await assert.rejects(resolveCodexMainTranscript({...options,deferIncomplete:true}),/UUID/)
  await writeFile(path,JSON.stringify({type:'session_meta',payload:{id,cwd:tmpdir()}})+'\n')
  await assert.rejects(resolveCodexMainTranscript({...options,deferIncomplete:true}),/cwd/)
  await writeFile(path,JSON.stringify({type:'session_meta',payload:{id,cwd:root,source:{subagent:'child'}}})+'\n')
  await assert.rejects(resolveCodexMainTranscript({...options,deferIncomplete:true}),/child/)
  await assert.rejects(resolveCodexMainTranscript({...options,transcriptPath:root,deferIncomplete:true}),/regular file/)
  if(process.platform!=='win32'){
   const linked=join(root,'symlink.jsonl');await symlink(path,linked)
   await assert.rejects(resolveCodexMainTranscript({...options,transcriptPath:linked,deferIncomplete:true}),{code:'ELOOP'})
   await rm(linked)
  }
  await rm(path)
  assert.equal(await resolveCodexMainTranscript({threadId:id,nativeCwd:root,sessionsRoot:root,deferIncomplete:true}),undefined,'no discovery result is not an invented path')
 }finally{await rm(root,{recursive:true,force:true})}
})

test('actual CLI serve forwards exact missing and incomplete transcripts without starting a host', async()=>{
 const {registerHooks}=await import('node:module')
 const root=await mkdtemp(join(tmpdir(),'main-cli-pending-'))
 const id='00000000-0000-4000-8000-000000000077',path=join(root,'native.jsonl')
 const base=new URL('../src/',import.meta.url)
 const mockNames={
  'server.mjs':'export async function startCompanion(options){globalThis.__cx3StartOptions=options;return {url:"http://not-launched",connectionPath:"not-written",close:async()=>{}}}',
  'project.mjs':'export const openCompanionProject=()=>{throw new Error("not used")}',
  'project-commands.mjs':'export const runCompanionCommand=()=>{throw new Error("not used")}',
  'mcp.mjs':'export const startDesignMcp=()=>{throw new Error("not used")}',
 }
 const replacements=new Map(Object.entries(mockNames).map(([name,source])=>[new URL(name,base).href,source]))
 replacements.set(new URL('../../core/lib/index.js',base).href,'export const validateSkillDesign=()=>{throw new Error("not used")}')
 const hook=registerHooks({load(url,context,next){return replacements.has(url)?{format:'module',source:replacements.get(url),shortCircuit:true}:next(url,context)}})
 const previousLog=console.log,previousArgs=process.argv
 const priorSignals=new Map(['SIGINT','SIGTERM'].map(name=>[name,new Set(process.listeners(name))]))
 try{
  console.log=()=>{}
  process.argv=[process.execPath,'test-entry','--help']
  const {main}=await import('../src/plugin-cli.mjs')
  process.argv=previousArgs
  const args=['serve','--project',root,'--thread',id,'--host-cwd',root,'--transcript',path,'--state-root',join(root,'state')]
  await main(args)
  assert.equal(globalThis.__cx3StartOptions.transcriptPath,path)
  await writeFile(path,'{"type":"session_meta"')
  await main(args)
  assert.equal(globalThis.__cx3StartOptions.transcriptPath,path)
  await writeFile(path,'secret invalid\n')
  globalThis.__cx3StartOptions=undefined
  await assert.rejects(main(args),/Invalid main transcript header/)
  assert.equal(globalThis.__cx3StartOptions,undefined,'invalid identity must never reach startup')
 }finally{
  process.argv=previousArgs;console.log=previousLog;hook.deregister();delete globalThis.__cx3StartOptions
  for(const [name,previous]of priorSignals)for(const listener of process.listeners(name))if(!previous.has(listener))process.removeListener(name,listener)
  await rm(root,{recursive:true,force:true})
 }
})
