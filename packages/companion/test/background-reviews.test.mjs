import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {partitionReviewConversation,reviewOperation} from '../src/background-reviews.mjs'
import {transcriptRow} from '../src/codex-transcript.mjs'
import {createQoderTranscript} from '../src/qoder-transcript.mjs'
import {fixture,threadId} from './fixture.mjs'
import {callCompanion} from '../src/connection-file.mjs'

test('background projection uses verified role and exact operation scope, never names',()=>{
 const binding=[{reviewId:'r',runId:'reviewer'}], options={connectionPath:'/exact'}
 const tool=(id,targets)=>({id,role:'tool',label:'unimportant',status:'completed',targetRunIds:targets,activityEpoch:1})
 const rows=[tool('review',['reviewer']),tool('mixed',['reviewer','producer']),tool('unknown',['unknown']),
  {...tool('name',[]),label:'review_grounding'},
  {...tool('foreign',[]),reviewOperation:reviewOperation('design_read_review',{connection:'/other',reviewId:'r'})},
  {...tool('bad-id',[]),reviewOperation:reviewOperation('design_read_review',{connection:'/exact',reviewId:'unknown'})},
  {...tool('own',[]),status:'failed',reviewOperation:reviewOperation('design_bind_review',{connection:'/exact',reviewId:'r'})}]
 const value={available:true,recordedStatus:'running',activityEpoch:1,rows}
 const out=partitionReviewConversation(value,binding,options)
 assert.deepEqual(out.backgroundRows.map(r=>r.id),['review','own'])
 assert.equal(out.backgroundRows.at(-1).status,'failed')
 assert.deepEqual(out.conversation.rows.map(r=>r.id),['mixed','unknown','name','foreign','bad-id'])
 assert.equal(out.conversation.recordedStatus,'running')
 assert.equal(out.conversation.backgroundActivity,true)
 assert.ok(!JSON.stringify(out).includes('/exact'),'internal connection metadata never goes to UI')
 assert.equal(partitionReviewConversation(value,binding,{...options,foregroundActive:true}).conversation.backgroundActivity,false)
 assert.equal(partitionReviewConversation({...value,catchingUp:true},binding,options).conversation.backgroundActivity,false)
 assert.equal(partitionReviewConversation({...value,recordedStatus:'completed'},binding,options).conversation.recordedStatus,'completed')
 assert.equal(partitionReviewConversation({...value,rows:[...rows,{id:'question',role:'tool',status:'running',questions:[{}]}]},binding,options).conversation.backgroundActivity,false)
 assert.equal(partitionReviewConversation({...value,rows:[tool('early',['reviewer'])]},[],options).backgroundRows.length,0)
 assert.equal(partitionReviewConversation({...value,rows:[tool('conflict',['reviewer'])]},binding,{...options,foregroundRunIds:['reviewer']}).backgroundRows.length,0)
 assert.equal(reviewOperation('design_bind_reviews',{connection:'/exact',bindings:{}}),undefined)
 assert.equal(reviewOperation('design_prepare_bundle',{connection:'/exact'}),undefined)
})

test('Qoder native target and scoped MCP operations use the same background partition',async()=>{
 const f=await fixture()
 try {
  const path=join(f.root,'qoder.jsonl'),base={sessionId:threadId,cwd:f.options.projectRoot}
  const events=[
   {...base,type:'assistant',uuid:'launch',message:{content:[{type:'tool_use',id:'call',name:'Agent',input:{description:'not used for classification'}}]}},
   {...base,type:'user',uuid:'result',parentUuid:'launch',toolUseResult:{agentId:'r'},message:{content:[{type:'tool_result',tool_use_id:'call',content:'private output'}]}},
   {...base,type:'assistant',uuid:'bind',parentUuid:'result',message:{content:[{type:'tool_use',id:'bind-call',name:'mcp__plugin_design-system_design-system__design_bind_review',input:{connection:'/exact',reviewId:'review',secret:'not projected'}}]}},
  ]
  await writeFile(path,events.map(e=>JSON.stringify(e)+'\n').join(''))
  const observation=await createQoderTranscript({path,sessionId:threadId,projectRoot:f.options.projectRoot}).read()
  assert.equal(observation.available,true)
  const out=partitionReviewConversation(observation,[{reviewId:'review',runId:'r'}],{connectionPath:'/exact'})
  assert.deepEqual(out.backgroundRows.map(r=>r.id),['call','bind-call'])
  assert.equal(out.conversation.rows.length,0)
  assert.ok(!JSON.stringify(out).includes('private output'))
  assert.ok(!JSON.stringify(out).includes('not projected'))
  const mixed=[
   {...base,type:'assistant',uuid:'tools',message:{content:[{type:'tool_use',id:'agent',name:'Agent',input:{}},{type:'tool_use',id:'bash',name:'Bash',input:{}}]}},
   {...base,type:'user',uuid:'results',parentUuid:'tools',toolUseResult:{agentId:'r'},message:{content:[{type:'tool_result',tool_use_id:'agent'},{type:'tool_result',tool_use_id:'bash'}]}},
  ]
  await writeFile(path,mixed.map(e=>JSON.stringify(e)+'\n').join(''))
  const ambiguous=await createQoderTranscript({path,sessionId:threadId,projectRoot:f.options.projectRoot}).read()
  const projected=partitionReviewConversation(ambiguous,[{reviewId:'review',runId:'r'}],{connectionPath:'/exact'})
  assert.deepEqual(projected.conversation.rows.map(r=>r.id),['agent','bash'])
  assert.equal(projected.backgroundRows.length,0,'message-level agentId must not classify multiple results')
  mixed[1].message.content=[{type:'tool_result',tool_use_id:'bash'}]
  await writeFile(path,mixed.map(e=>JSON.stringify(e)+'\n').join(''))
  const ordinary=await createQoderTranscript({path,sessionId:threadId,projectRoot:f.options.projectRoot}).read()
  assert.deepEqual(ordinary.rows.find(r=>r.id==='bash').targetRunIds,[],'even a single ordinary tool result is not a child launch')
 }finally{await f.close()}
})

test('native review end targets are separate from Producer spawn anchors',()=>{
 const row=transcriptRow({payload:{type:'item_completed',item:{id:'end',type:'SubAgentActivity',kind:'completed',agent_thread_id:'r'}}})
 assert.deepEqual(row.childRunIds,[])
 assert.deepEqual(row.targetRunIds,['r'])
 const foreign=transcriptRow({payload:{type:'item_completed',item:{id:'m',type:'McpToolCall',server:'other',tool:'design_prepare_reviews',arguments:{connection:'/exact'}}}})
 assert.equal(foreign.reviewOperation,undefined)
})

test('HTTP late review binding reprojects start/end into background without scheduling work',async()=>{
 const f=await fixture({withTranscript:true}),id='00000000-0000-4000-8000-000000000077'
 const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
 const event=payload=>appendFile(f.options.transcriptPath,JSON.stringify({type:'event_msg',payload})+'\n')
 try{
  await event({type:'task_started'})
  await event({type:'item_completed',item:{id:'launch',type:'SubAgentActivity',kind:'started',agent_thread_id:id}})
  assert.equal((await call('readWorkspace')).conversation.rows.length,1)
  const request=await call('prepareReview',{profile:'grounding'})
  const transcriptPath=join(f.root,`rollout-${id}.jsonl`)
  await writeFile(transcriptPath,JSON.stringify({type:'session_meta',payload:{id,cwd:f.options.projectRoot,source:{subagent:{thread_spawn:{parent_thread_id:threadId}}}}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'task_complete'}})+'\n')
  await call('bindReviewRun',{reviewId:request.reviewId,nativeRun:{runId:id}})
  await event({type:'item_completed',item:{id:'done',type:'SubAgentActivity',kind:'completed',agent_thread_id:id}})
  const w=await call('readWorkspace')
  assert.equal(w.conversation.rows.length,0)
  assert.equal(w.backgroundReviews.rows.length,2)
  await event({type:'item_completed',item:{id:'foreground',type:'UserMessage',content:[{type:'Text',text:'Foreground stays private to the full view'}]}})
  const reviewOnly=await call('readConversation',{includeConversation:false,knownRevision:null})
  assert.equal(Object.hasOwn(reviewOnly.workspace,'conversation'),false)
  assert.deepEqual(reviewOnly.workspace.backgroundRows.map(row=>row.id),w.backgroundReviews.rows.map(row=>row.id))
  assert.ok(!JSON.stringify(reviewOnly).includes('Foreground stays private'))
  assert.equal(reviewOnly.workspace.available,true)
  assert.equal((await call('readConversation',{includeConversation:false,knownRevision:reviewOnly.revision})).unchanged,true)
  assert.equal(w.backgroundReviews.reviews.find(r=>r.profile==='grounding').status,'unsubmitted')
  assert.equal(w.conversation.backgroundActivity,true)
  await event({type:'task_complete'})
  assert.equal((await call('readWorkspace')).conversation.recordedStatus,'completed')
  await event({type:'task_started'})
  const fresh=await call('readWorkspace')
  assert.equal(fresh.conversation.recordedStatus,'running')
  assert.equal(fresh.conversation.backgroundActivity,false,'old review rows cannot suppress a new foreground turn')
  assert.equal(f.messages.length,0)
 }finally{await f.close()}
})
