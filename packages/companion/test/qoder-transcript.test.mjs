import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,appendFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createQoderTranscript,verifyQoderChild} from '../src/qoder-transcript.mjs'
import {bindNativeProject} from '../src/native-project-binding.mjs'

test('Qoder run ownership is isolated by native host and main session',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qoder-identity-'))
  try{
    const sessionId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222'
    await bindNativeProject({stateRoot:root,runId,projectId:'codex-project'})
    await bindNativeProject({stateRoot:root,runId,projectId:'qoder-project',host:'qoder',sessionId})
    await assert.rejects(bindNativeProject({stateRoot:root,runId,projectId:'wrong-project',host:'qoder',sessionId}),/another Design Project/)
    await bindNativeProject({stateRoot:root,runId:'aExplore-123',projectId:'qoder-project',host:'qoder',sessionId})
    await assert.rejects(bindNativeProject({stateRoot:root,runId:'../escape',projectId:'bad',host:'qoder',sessionId}),/Exact Qoder/)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('Qoder uses exact task/parent identities, native status and selected history without raw tool payloads',async()=>{
  const root=await mkdtemp(join(tmpdir(),'qoder-observer-'))
  try{
    const sessionId='11111111-1111-4111-8111-111111111111',agentId='aExplore-1234'
    const folder=join(root,sessionId,'subagents');await mkdir(folder,{recursive:true})
    const childCwd=join(root,'design_files');await mkdir(childCwd)
    const path=join(folder,`agent-${agentId}.jsonl`),taskPath=join(folder,'task-one.json')
    const event=(uuid,parentUuid,type,content,extra={})=>({uuid,parentUuid,type,sessionId,cwd:childCwd,agentId,timestamp:'2026-09-10T01:00:00Z',message:{content,...extra}})
    const parent={...event('dispatch',null,'assistant',[{type:'tool_use',id:'call-1',name:'Agent',input:{secret:'hidden'}}]),agentId:undefined,cwd:root}
    await writeFile(join(root,`${sessionId}.jsonl`),JSON.stringify(parent)+'\n')
    const task={sessionId,agentId,parentToolUseId:'call-1',transcriptPath:path,status:'running',updatedAt:Date.parse('2026-09-10T01:00:01Z')}
    await writeFile(taskPath,JSON.stringify(task))
    const events=[event('u',null,'user','Read source'),event('a','u','assistant',[{type:'thinking',thinking:'PRIVATE'},{type:'tool_use',id:'tool-1',name:'Read',input:{secret:'HIDDEN'}}]),
      event('r','a','user',[{type:'tool_result',tool_use_id:'tool-1',content:'SECRET OUTPUT'}]),event('end','r','assistant',[{type:'text',text:'Public result'}],{stop_reason:'end_turn'})]
    await writeFile(path,JSON.stringify({type:'file-history-snapshot',snapshot:{}})+'\n'+events.map(JSON.stringify).join('\n')+'\n')
    const observer=createQoderTranscript({path,taskPath,sessionId,agentId,projectRoot:root})
    const first=await observer.read()
    assert.equal(first.recordedStatus,'running','end_turn does not override a still-running native task')
    assert.equal(first.rows.find(r=>r.id==='tool-1').status,'completed')
    assert.doesNotMatch(JSON.stringify(first.rows),/PRIVATE|HIDDEN|SECRET OUTPUT/)
    assert.equal((await verifyQoderChild({runId:agentId,parentRunId:sessionId,transcriptPath:path,taskPath,sessionId,projectRoot:root})).available,true)
    await assert.rejects(verifyQoderChild({runId:agentId,parentRunId:'different-agent',transcriptPath:path,taskPath,sessionId,projectRoot:root}))
    await writeFile(taskPath,JSON.stringify({...task,status:'completed'}))
    assert.equal((await observer.read()).recordedStatus,'completed')
    await appendFile(path,JSON.stringify({...event('resume','end','user','Continue'),timestamp:'2026-09-10T01:01:00Z'})+'\n')
    assert.equal((await observer.read()).recordedStatus,'running')
    await appendFile(path,JSON.stringify(event('branch','u','assistant',[{type:'text',text:'Other branch'}],{stop_reason:'end_turn'}))+'\n'+JSON.stringify({type:'active-leaf',sessionId,leafUuid:'end'})+'\n')
    const selected=await observer.read()
    assert.equal(selected.rows.at(-1).text,'Public result')
    assert.doesNotMatch(JSON.stringify(selected.rows),/Other branch|Continue/)
    await appendFile(path,JSON.stringify({...event('api-error','end','assistant',[{type:'text',text:'Sorry, as an AI coding assistant'}]),isApiErrorMessage:true,errorDetails:'ModelTransportError: tpm_limit_exceeded; secret-provider-data'})+'\n')
    const errorRows=(await observer.read()).rows
    assert.match(errorRows.at(-1).text,/模型服务限流/)
    assert.doesNotMatch(JSON.stringify(errorRows),/Sorry, as an AI|secret-provider-data/)
    await writeFile(taskPath,JSON.stringify({...task,agentId:'wrong'}))
    assert.equal((await observer.read()).available,false)
  }finally{await rm(root,{recursive:true,force:true})}
})
