import{test}from'node:test'
import assert from'node:assert/strict'
import{mkdtemp,mkdir,writeFile,rm,appendFile}from'node:fs/promises'
import{tmpdir}from'node:os'
import{join}from'node:path'
import{verifyWorkBuddyChild,resolveWorkBuddyRun,createWorkBuddyChildTranscript}from'../src/workbuddy-native.mjs'
const sessionId='00000000-0000-4000-8000-000000000001',runId='agent-test',childSession='child-runtime-uuid'
async function fixture(){const root=await mkdtemp(join(tmpdir(),'workbuddy-child-'));const mainTranscriptPath=join(root,sessionId+'.jsonl'),folder=join(root,sessionId,'subagents'),transcriptPath=join(folder,runId+'.jsonl');await mkdir(folder,{recursive:true});const event=(type,extra={},child=false)=>({id:'event',type,sessionId:child?childSession:sessionId,cwd:root,...extra});const parent=[event('message',{role:'user'}),event('function_call',{name:'Agent',callId:'call',arguments:'{}'}),event('function_call_result',{name:'Agent',callId:'call',status:'completed',providerData:{toolResult:{subAgent:{sessionId:runId,lastId:'answer'}}}})];const child=[event('message',{id:'prompt',role:'user',content:[{type:'input_text',text:'task'}]},true),event('reasoning',{id:'secret',rawContent:'PRIVATE_REASONING'},true),event('message',{id:'answer',role:'assistant',status:'completed',content:[{type:'output_text',text:'done'}]},true)];const save=async()=>{await writeFile(mainTranscriptPath,parent.map(JSON.stringify).join('\n')+'\n');await writeFile(transcriptPath,child.map(JSON.stringify).join('\n')+'\n')};await save();return{root,parent,child,event,save,input:{runId,parentRunId:sessionId,transcriptPath,projectRoot:root,sessionId,mainTranscriptPath},close:()=>rm(root,{recursive:true,force:true})}}
test('native structured receipt binds a distinct child session and hides reasoning',async()=>{const f=await fixture();try{const result=await verifyWorkBuddyChild(f.input);assert.equal(result.recordedStatus,'completed');assert.deepEqual(result.rows.map(r=>r.text),['task','done']);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REASONING/)}finally{await f.close()}})
test('assistant marker or tool text cannot substitute native identity',async()=>{const f=await fixture();try{delete f.parent[2].providerData;f.parent[2].output={type:'text',text:'[Agent ID: agent-test]'};await f.save();await assert.rejects(verifyWorkBuddyChild(f.input),/no native Agent receipt/)}finally{await f.close()}})
test('rejects wrong parent, foreign path, cwd and child output pins',async()=>{for(const mutate of [f=>{f.input.parentRunId='other'},f=>{f.input.transcriptPath=join(f.root,'foreign.jsonl')},f=>{f.child[0].sessionId='other'},f=>{f.parent[2].providerData.toolResult.subAgent.lastId='unrelated'},f=>{f.parent[1].sessionId='other'}]){const f=await fixture();try{mutate(f);await f.save();await assert.rejects(verifyWorkBuddyChild(f.input))}finally{await f.close()}}})
test('resume dispatch is running until a matching native terminal receipt',async()=>{const f=await fixture();try{f.parent.push(f.event('function_call',{name:'Agent',callId:'resume',arguments:JSON.stringify({resume:runId})}));await f.save();assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'running');f.child.push(f.event('message',{id:'answer2',role:'assistant',status:'completed',content:[{type:'output_text',text:'resumed'}]},true));await f.save();assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'running');f.parent.push(f.event('function_call_result',{name:'Agent',callId:'resume',status:'completed',providerData:{toolResult:{subAgent:{sessionId:runId,afterId:'answer',lastId:'answer2'}}}}));await f.save();assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'completed')}finally{await f.close()}})
test('appended unbound child activity is unknown and incomplete JSON suffix is ignored',async()=>{const f=await fixture();try{await appendFile(f.input.mainTranscriptPath,'{"unfinished"');assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'completed');f.child.push(f.event('message',{id:'next',role:'user'},true));await f.save();assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'unknown')}finally{await f.close()}})
test('observer fails closed after identity loss; resolver only derives bound parent path',async()=>{const f=await fixture();try{const resolved=await resolveWorkBuddyRun({runId},{threadId:sessionId,mainTranscriptPath:f.input.mainTranscriptPath});assert.equal(resolved.transcriptPath,f.input.transcriptPath);await assert.rejects(resolveWorkBuddyRun({runId:'../bad'},{threadId:sessionId,mainTranscriptPath:f.input.mainTranscriptPath}));f.parent=[];await writeFile(f.input.mainTranscriptPath,'');const observer=createWorkBuddyChildTranscript({...f.input,threadId:runId,path:f.input.transcriptPath});assert.equal((await observer.read()).available,false)}finally{await f.close()}})

test('failed native resume never remains running or inherits old completion',async()=>{const f=await fixture();try{f.parent.push(f.event('function_call',{name:'Agent',callId:'resume',arguments:JSON.stringify({resume:runId})}),f.event('function_call_result',{name:'Agent',callId:'resume',status:'failed'}));await f.save();assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'failed')}finally{await f.close()}})

test('descriptor-only, named and team receipts diagnose shape before incomplete status, without leaking arguments',async()=>{
 for(const status of ['completed','running'])for(const shape of ['descriptor','name','team','named-descriptor']){
  const f=await fixture()
  try{
   f.parent[1].arguments=JSON.stringify({...(shape==='name'||shape==='named-descriptor'?{name:'PRIVATE_TEAM_NAME'}:shape==='team'?{team_name:'PRIVATE_TEAM'}:{}),prompt:'PRIVATE_PROMPT'})
   f.parent[2].status=status
   const native=f.parent[2].providerData.toolResult.subAgent
   delete native.lastId
   if(shape==='descriptor'||shape==='named-descriptor')native.descriptor={mode:'attached',status,description:'PRIVATE_DESCRIPTION'}
   await f.save()
   await assert.rejects(verifyWorkBuddyChild(f.input),error=>error.code==='workbuddy-foreground-receipt-shape')
   const log=await createWorkBuddyChildTranscript({...f.input,threadId:runId,path:f.input.transcriptPath}).read()
   assert.equal(log.available,false);assert.equal(log.recordedStatus,'unknown')
   assert.equal(log.reasonCode,'workbuddy-foreground-receipt-shape');assert.deepEqual(log.rows,[])
   assert.doesNotMatch(JSON.stringify(log),/PRIVATE_/)
  }finally{await f.close()}
 }
})

test('an unfinished native result is distinct from a completed call missing its cursor',async()=>{
 const f=await fixture()
 try{
  f.parent[2].status='running';await f.save()
  await assert.rejects(verifyWorkBuddyChild(f.input),error=>error.code==='workbuddy-native-result-incomplete')
  f.parent[2].providerData.toolResult.subAgent.descriptor={mode:'attached',status:'running'};await f.save()
  await assert.rejects(verifyWorkBuddyChild(f.input),error=>error.code==='workbuddy-native-result-incomplete')
  delete f.parent[2].providerData.toolResult.subAgent.descriptor
  delete f.parent[2].providerData.toolResult.subAgent.lastId;await f.save()
  await assert.rejects(verifyWorkBuddyChild(f.input),error=>error.code==='workbuddy-native-result-incomplete')
  f.parent[2].status='completed';delete f.parent[2].providerData.toolResult.subAgent.lastId;await f.save()
  await assert.rejects(verifyWorkBuddyChild(f.input),error=>error.code==='workbuddy-foreground-cursor-missing')
 }finally{await f.close()}
})

test('a descriptor never replaces the exact foreground cursor but does not invalidate a matching cursor',async()=>{
 const f=await fixture()
 try{
  f.parent[2].providerData.toolResult.subAgent.descriptor={mode:'attached',status:'completed'};await f.save()
  assert.equal((await verifyWorkBuddyChild(f.input)).recordedStatus,'completed')
  f.parent[2].providerData.toolResult.subAgent.lastId='forged-terminal';await f.save()
  await assert.rejects(verifyWorkBuddyChild(f.input),/does not match child output/)
 }finally{await f.close()}
})
