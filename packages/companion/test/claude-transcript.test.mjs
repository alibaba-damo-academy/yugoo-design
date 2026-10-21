import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,appendFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createClaudeTranscript,verifyClaudeChild,resolveClaudeRun} from '../src/claude-transcript.mjs'

test('Claude exact dispatch proof, changed child cwd, questions and honest terminal status',async()=>{
  const root=await mkdtemp(join(tmpdir(),'claude-observer-'))
  try{
    const sessionId='11111111-1111-4111-8111-111111111111',runId='a123456'
    const folder=join(root,sessionId,'subagents');await mkdir(folder,{recursive:true})
    const path=join(folder,`agent-${runId}.jsonl`),main=join(root,`${sessionId}.jsonl`)
    const event=(uuid,parentUuid,type,content,extra={})=>({uuid,parentUuid,type,sessionId,agentId:runId,cwd:'/changed/child/cwd',timestamp:'2026-09-10T00:00:00Z',message:{content},...extra})
    const parent={...event('p',null,'assistant',[{type:'tool_use',id:'dispatch',name:'Agent',input:{}}]),cwd:root,agentId:undefined}
    await writeFile(main,JSON.stringify(parent)+'\n')
    await writeFile(join(folder,`agent-${runId}.meta.json`),JSON.stringify({toolUseId:'dispatch',agentType:'general-purpose'}))
    const events=[event('u',null,'user','Work'),event('a','u','assistant',[{type:'thinking',thinking:'PRIVATE'},{type:'tool_use',id:'q',name:'AskUserQuestion',input:{questions:[{question:'Next?',header:'Next',options:[{label:'One',description:'First'},{label:'Two',description:'Second'}]}]}}]),event('r','a','user',[{type:'tool_result',tool_use_id:'q',content:'SECRET'}]),event('z','r','assistant',[{type:'text',text:'Result'}])]
    await writeFile(path,events.map(JSON.stringify).join('\n')+'\n')
    const observer=createClaudeTranscript({path,sessionId,agentId:runId,projectRoot:root})
    let result=await observer.read()
    assert.equal(result.available,true);assert.equal(result.recordedStatus,'running')
    assert.equal(result.source,'claude-native-transcript');assert.equal(result.rows.at(-1).label,'Claude Code')
    assert.equal(result.rows.find(r=>r.id==='q').questions[0].question,'Next?')
    assert.equal(result.rows.find(r=>r.id==='q').status,'completed')
    assert.doesNotMatch(JSON.stringify(result.rows),/PRIVATE|SECRET/)
    const args={runId,parentRunId:sessionId,transcriptPath:path,sessionId,projectRoot:root}
    assert.equal((await verifyClaudeChild(args)).available,true)
    const nestedId='nested-child',nestedPath=join(folder,`agent-${nestedId}.jsonl`)
    await appendFile(path,JSON.stringify(event('spawn','z','assistant',[{type:'tool_use',id:'nested-dispatch',name:'Task',input:{}}]))+'\n')
    await writeFile(join(folder,`agent-${nestedId}.meta.json`),JSON.stringify({toolUseId:'nested-dispatch'}))
    await writeFile(nestedPath,JSON.stringify({...event('nested',null,'user','Child'),agentId:nestedId})+'\n')
    assert.equal((await verifyClaudeChild({...args,runId:nestedId,parentRunId:runId,transcriptPath:nestedPath})).available,true)
    await assert.rejects(verifyClaudeChild({...args,runId:nestedId,transcriptPath:nestedPath}),/parent dispatch/)
    await assert.rejects(verifyClaudeChild({...args,parentRunId:'wrong-parent'}))
    await writeFile(join(folder,`agent-${runId}.meta.json`),JSON.stringify({toolUseId:'wrong'}))
    await assert.rejects(verifyClaudeChild(args),/parent dispatch/)
    await appendFile(path,JSON.stringify(event('done','z','assistant',[],{message:{content:[{type:'text',text:'Done'}],stop_reason:'end_turn'}}))+'\n')
    assert.equal((await observer.read()).recordedStatus,'completed')
    await appendFile(path,JSON.stringify(event('resume','done','user','Again'))+'\n')
    assert.equal((await observer.read()).recordedStatus,'running')
    await appendFile(path,JSON.stringify({...event('bad','resume','user',''),sessionId:'22222222-2222-4222-8222-222222222222'})+'\n')
    assert.equal((await observer.read()).available,false)
    assert.deepEqual(await resolveClaudeRun({runId},{threadId:sessionId,mainTranscriptPath:main}),{runId,parentRunId:sessionId,transcriptPath:path})
    await assert.rejects(resolveClaudeRun({runId,parentRunId:'nested'},{threadId:sessionId,mainTranscriptPath:main}),/parent must be bound/)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('Claude main verifies cwd, partial records and symlinks fail closed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'claude-main-'))
  try {
    const sessionId='11111111-1111-4111-8111-111111111111',path=join(root,'main.jsonl')
    const event={type:'user',sessionId,cwd:root,uuid:'u',parentUuid:null,message:{content:'Hello'}}
    await writeFile(path,JSON.stringify(event)+'\n'+JSON.stringify({...event,uuid:'partial'}).slice(0,20))
    const log=await createClaudeTranscript({path,sessionId,projectRoot:root}).read()
    assert.equal(log.available,true);assert.equal(log.catchingUp,true);assert.equal(log.recordedStatus,'unknown')
    await symlink(path,join(root,'link.jsonl'))
    assert.equal((await createClaudeTranscript({path:join(root,'link.jsonl'),sessionId,projectRoot:root}).read()).available,false)
    assert.equal((await createClaudeTranscript({path,sessionId,projectRoot:tmpdir()}).read()).available,false)
    await writeFile(path,JSON.stringify({...event,agentId:'unexpected-child'})+'\n')
    assert.equal((await createClaudeTranscript({path,sessionId,projectRoot:root}).read()).available,false)
  }finally{await rm(root,{recursive:true,force:true})}
})
