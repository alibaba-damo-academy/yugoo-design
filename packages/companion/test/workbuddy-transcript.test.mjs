import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,appendFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createDesignConversationObserver} from '../src/conversation-start.mjs'
import {createWorkBuddyTranscript,readWorkBuddyHeader} from '../src/workbuddy-transcript.mjs'
import {partitionReviewConversation} from '../src/background-reviews.mjs'

const threadId='00000000-0000-4000-8000-000000000001'
async function setup(t) {
 const root=await mkdtemp(join(tmpdir(),'workbuddy-log-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const path=join(root,'native.jsonl')
 const event=(type,id,extra={})=>({type,id,sessionId:threadId,cwd:root,timestamp:Date.now(),...extra})
 const line=value=>JSON.stringify(value)+'\n'
 await writeFile(path,line(event('message','old',{role:'user',content:[{type:'input_text',text:'old unrelated history'}]})))
 const options={stateRoot:join(root,'state'),projectId:'test-project',projectRoot:root,nativeCwd:root,threadId,transcriptPath:path,
  host:'workbuddy',readHeader:readWorkBuddyHeader,createObserver:createWorkBuddyTranscript}
 return {root,path,event,line,options,append:value=>appendFile(path,line(value))}
}

test('WorkBuddy durable start skips old history, presents public turns/tools, resumes and excludes private content',async t=>{
 const f=await setup(t),reader=await createDesignConversationObserver(f.options)
 assert.deepEqual((await reader.read()).rows,[])
 await f.append(f.event('message','user',{role:'user',content:[{type:'input_text',text:'saved answers'}]}))
 await f.append(f.event('reasoning','private',{content:'private thought',rawContent:'private raw'}))
 await f.append(f.event('function_call','call',{callId:'tool1',name:'design_status',arguments:'secret arguments'}))
 await f.append(f.event('function_call_result','result',{callId:'tool1',status:'completed',output:'secret output'}))
 await f.append(f.event('message','assistant',{role:'assistant',status:'completed',content:[{type:'output_text',text:'answers received'}],providerData:{secret:'provider metadata'}}))
 const log=await reader.read()
 assert.equal(log.available,true);assert.equal(log.recordedStatus,'completed')
 assert.deepEqual(log.rows.map(row=>row.text),['saved answers','','answers received'])
 assert.equal(log.rows[1].status,'completed');assert.equal(log.rows[2].label,'WorkBuddy')
 assert.doesNotMatch(JSON.stringify(log),/secret|private|old unrelated|provider metadata/)
 assert.deepEqual((await(await createDesignConversationObserver(f.options)).read()).rows,log.rows)
 await appendFile(f.path,'{"type":"message"')
 assert.equal((await reader.read()).catchingUp,true)
})

test('WorkBuddy rejects different session/cwd and changed durable files without granting authority',async t=>{
 const f=await setup(t)
 await assert.rejects(createDesignConversationObserver({...f.options,threadId:'00000000-0000-4000-8000-000000000002'}),/identity mismatch|session or cwd/)
 await assert.rejects(createDesignConversationObserver({...f.options,nativeCwd:tmpdir()}),/session or cwd/)
 const reader=await createDesignConversationObserver(f.options)
 await f.append(f.event('message','wrong',{sessionId:'another-session',role:'user',content:[]}))
 assert.equal((await reader.read()).available,false)
 await writeFile(f.path,'')
 assert.equal((await reader.read()).available,false)
 await assert.rejects(createDesignConversationObserver(f.options),/boundary/)
})

test('WorkBuddy waits for native identity and bounds presentation rows',async t=>{
 const f=await setup(t);await writeFile(f.path,'')
 const reader=await createDesignConversationObserver(f.options)
 assert.equal((await reader.read()).designSessionPending,true)
 await f.append(f.event('message','first',{role:'user',content:[{type:'input_text',text:'first valid turn'}]}))
 assert.equal((await reader.read()).available,true)
 for(let i=0;i<205;i++)await f.append(f.event('message',String(i),{role:'assistant',status:'completed',content:[{type:'output_text',text:String(i)}]}))
 const log=await reader.read();assert.equal(log.rows.length,200);assert.equal(log.rows.at(-1).text,'204');assert.ok(log.omitted>=5)
})

test('main UST native evidence survives observer reopen and is excluded from public conversation',async t=>{
 const f=await setup(t),reader=await createDesignConversationObserver(f.options)
 await f.append(f.event('message','human-1',{role:'user',content:[{type:'input_text',text:'design this'}]}))
 const args={connection:'/private/connection.json',input:{projectId:'exact-project'},summary:'private assessment',u:{score:60,evidence:'fact'},s:{score:50,evidence:'fact'},t:{score:40,evidence:'fact'}}
 await f.append(f.event('function_call','report',{callId:'main-report',name:'mcp__design-system__report_design_clarity',arguments:JSON.stringify(args)}))
 const log=await reader.read()
 assert.equal(log.rows[0].nativeTurn,1)
 assert.deepEqual(log.rows[1].mainReportOperation.input,args.input)
 assert.equal(log.rows[1].status,'running')
 assert.deepEqual((await(await createDesignConversationObserver(f.options)).read()).rows,log.rows)
 const publicLog=partitionReviewConversation(log,[],{connectionPath:args.connection})
 assert.doesNotMatch(JSON.stringify(publicLog),/mainReportOperation|nativeTurn|private assessment|exact-project|private\/connection/)
 await f.append(f.event('message','human-2',{role:'user',content:[{type:'input_text',text:'change scope'}]}))
 assert.equal((await reader.read()).rows.at(-1).nativeTurn,2)
})
