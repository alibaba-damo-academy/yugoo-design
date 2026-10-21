import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,appendFile,mkdir,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fixture,threadId} from './fixture.mjs'
import {callCompanion} from '../src/connection-file.mjs'
import {resolveNativeRun} from '../src/native-run-resolution.mjs'

test('non-Codex hosts reject Codex launch references with an actionable native-ID diagnostic',async()=>{
 for(const host of ['workbuddy','qoder','qwenwork','claude-code']) {
  for(const launch of [{launchCallId:'call-bootstrap'},{agentPath:'/root/producer'},
    {launchCallId:'call-bootstrap',agentPath:'/root/producer'}]) {
   for(const mainTranscriptPath of [undefined,'/exact/parent.jsonl']) {
    await assert.rejects(resolveNativeRun({runId:'agent-actual',...launch},{host,threadId,mainTranscriptPath}),error=>{
     assert.match(error.message,/launchCallId and agentPath are supported only for Codex/)
     assert.match(error.message,/actual native child runId/)
     assert.doesNotMatch(error.message,/parent transcript is required/)
     return true
    })
   }
  }
 }
})

test('Codex launch lookup still requires the exact bound parent transcript',async()=>{
 for(const launch of [{launchCallId:'call-bootstrap'},{agentPath:'/root/producer'}]) {
  await assert.rejects(resolveNativeRun(launch,{host:'codex',threadId}),/Exact parent transcript is required for launch lookup/)
 }
})

test('Codex launch references retain exact resolution, conflicting-ID and ambiguous-launch guards',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-launch-contract-'))
 const mainTranscriptPath=join(root,'parent.jsonl')
 const runId='00000000-0000-4000-8000-000000000077',otherId='00000000-0000-4000-8000-000000000078'
 const transcriptPath=join(root,`rollout-${runId}.jsonl`)
 const event=(id,child)=>JSON.stringify({type:'event_msg',payload:{type:'item_completed',item:{
  type:'SubAgentActivity',kind:'started',id,agent_thread_id:child,agent_path:'/root/producer'}}})+'\n'
 const options={host:'codex',threadId,mainTranscriptPath}
 try{
  await writeFile(mainTranscriptPath,event('call-one',runId))
  const expected={runId,parentRunId:threadId,transcriptPath}
  assert.deepEqual(await resolveNativeRun({launchCallId:'call-one',transcriptPath},options),expected)
  assert.deepEqual(await resolveNativeRun({agentPath:'/root/producer',transcriptPath},options),expected)
  await assert.rejects(resolveNativeRun({runId:otherId,launchCallId:'call-one',transcriptPath},options),/Native launch and runId conflict/)
  await appendFile(mainTranscriptPath,event('call-two',otherId))
  await assert.rejects(resolveNativeRun({agentPath:'/root/producer',transcriptPath},options),/Native launch is missing or ambiguous/)
  assert.deepEqual(await resolveNativeRun({launchCallId:'call-one',transcriptPath},options),expected)
 }finally{await rm(root,{recursive:true,force:true})}
})

test('WorkBuddy resolves an actual child ID without launch references and preserves path/parent guards',async()=>{
 const options={host:'workbuddy',threadId,mainTranscriptPath:'/exact/parent.jsonl'}
 const runId='agent-818d4d31c1084be4'
 const transcriptPath=join('/exact',threadId,'subagents',`${runId}.jsonl`)
 assert.deepEqual(await resolveNativeRun({runId},options),{runId,parentRunId:threadId,transcriptPath})
 assert.deepEqual(await resolveNativeRun({runId,transcriptPath},options),{runId,parentRunId:threadId,transcriptPath})
 await assert.rejects(resolveNativeRun({runId:'function-modules-task'},options),/Exact WorkBuddy Agent ID required/)
 await assert.rejects(resolveNativeRun({runId,transcriptPath:options.mainTranscriptPath},options),/outside the bound parent/)
 await assert.rejects(resolveNativeRun({runId,parentRunId:'agent-foreign-parent'},options),/nested Workers are not verified/)
 await assert.rejects(resolveNativeRun({runId},{host:'workbuddy',threadId}),/Exact WorkBuddy parent transcript required/)
})

test('path resolution keeps the actual Producer parent for a nested Worker',async()=>{
 const f=await fixture({withTranscript:true})
 const call=(method,params)=>callCompanion(f.server.connectionPath,{method,params})
 const producer='00000000-0000-4000-8000-000000000072',worker='00000000-0000-4000-8000-000000000073'
 try {
  for(const [id,parent] of [[producer,threadId],[worker,producer]]) {
   await writeFile(join(f.root,`rollout-${id}.jsonl`),JSON.stringify({type:'session_meta',payload:{id,cwd:f.options.projectRoot,
    source:{subagent:{thread_spawn:{parent_thread_id:parent}}}}})+'\n')
  }
  await call('registerNativeRun',{runId:producer,role:'producer',skill:'research',artifactId:'research'})
  await call('registerNativeRun',{runId:worker,parentRunId:producer,role:'worker',skill:'research',artifactId:'D-001',artifactFile:'research/R-001/D-001.md'})
  const workspace=await call('readWorkspace',{})
  assert.equal(workspace.executionAttempts.find(x=>x.runId===worker).invocationId,producer)
  await assert.rejects(call('registerNativeRun',{runId:worker,parentRunId:threadId,role:'worker',skill:'research',artifactId:'D-001'}))
 }finally{await f.close()}
})

test('exact launch/run IDs resolve inside existing bind paths without exposing session contents',async()=>{
 const f=await fixture({withTranscript:true})
 const call=(method,params)=>callCompanion(f.server.connectionPath,{method,params})
 const id='00000000-0000-4000-8000-000000000077'
 try{
  const transcriptPath=join(f.root,`rollout-${id}.jsonl`)
  await writeFile(transcriptPath,JSON.stringify({type:'session_meta',payload:{id,cwd:f.options.projectRoot,
   source:{subagent:{thread_spawn:{parent_thread_id:threadId}}}}})+'\n')
  const launch={type:'event_msg',payload:{type:'item_completed',item:{type:'SubAgentActivity',kind:'started',id:'call-1',agent_thread_id:id,agent_path:'/root/reviewer'}}}
  await appendFile(f.options.transcriptPath,JSON.stringify(launch)+'\n')
  const batch=await call('prepareReviews',{})
  const reviewId=batch.requests[0].reviewId
  const bound=await call('bindReviewRuns',{bindings:[{reviewId,nativeRun:{agentPath:'/root/reviewer'}}]})
  assert.deepEqual(bound.results[0].nativeRun,{runId:id,parentRunId:threadId,transcriptPath})
  assert.ok(!JSON.stringify(bound).includes('session_meta'))
  const again=await call('bindReviewRun',{reviewId,nativeRun:{runId:id}})
  assert.equal(again.nativeRun.transcriptPath,transcriptPath)
  await assert.rejects(call('bindReviewRun',{reviewId,nativeRun:{runId:threadId,launchCallId:'call-1'}}),/conflict/)
  launch.payload.item.agent_thread_id='00000000-0000-4000-8000-000000000078'
  launch.payload.item.id='call-2'
  await appendFile(f.options.transcriptPath,JSON.stringify(launch)+'\n')
  await assert.rejects(call('bindReviewRun',{reviewId,nativeRun:{agentPath:'/root/reviewer'}}),/ambiguous/)
  assert.equal((await call('bindReviewRun',{reviewId,nativeRun:{launchCallId:'call-1'}})).nativeRun.runId,id)
  await writeFile(join(f.root,`duplicate-${id}.jsonl`),'not evidence')
  await assert.rejects(call('bindReviewRun',{reviewId,nativeRun:{runId:id}}),/ambiguous/)
  assert.equal((await call('bindReviewRun',{reviewId,nativeRun:{runId:id,transcriptPath}})).nativeRun.runId,id)
 }finally{await f.close()}
})

test('Qoder resolution uses exact session/task evidence and rejects conflicting paths',async()=>{
 const f=await fixture({withTranscript:true})
 try{
  const folder=join(f.root,threadId,'subagents');await mkdir(folder,{recursive:true})
  const taskPath=join(folder,'task-one.json'),transcriptPath=join(folder,'agent-a1.jsonl')
  await writeFile(taskPath,JSON.stringify({sessionId:threadId,agentId:'a1',transcriptPath}))
  const options={host:'qoder',threadId,mainTranscriptPath:f.options.transcriptPath}
  assert.deepEqual(await resolveNativeRun({runId:'a1'},options),{runId:'a1',parentRunId:threadId,taskPath,transcriptPath})
  await assert.rejects(resolveNativeRun({runId:'a2'},options),/missing/)
  await assert.rejects(resolveNativeRun({runId:'a1',transcriptPath:'/different'},options),/conflict/)
  await writeFile(join(folder,'task-two.json'),await import('node:fs/promises').then(fs=>fs.readFile(taskPath)))
  await assert.rejects(resolveNativeRun({runId:'a1'},options),/ambiguous/)
 }finally{await f.close()}
})
