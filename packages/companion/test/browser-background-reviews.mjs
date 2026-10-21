import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {writeFile,appendFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fixture,threadId} from './fixture.mjs'
import {callCompanion} from '../src/connection-file.mjs'
const run=promisify(execFile),session=`companion-background-${process.pid}`
const browser=async(...args)=>(await run('agent-browser',['--session',session,...args],{timeout:45000})).stdout
const f=await fixture({withTranscript:true}),id='00000000-0000-4000-8000-000000000077'
const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
const event=payload=>appendFile(f.options.transcriptPath,JSON.stringify({type:'event_msg',payload})+'\n')
try {
 const request=await call('prepareReview',{profile:'grounding'})
 const transcriptPath=join(f.root,`rollout-${id}.jsonl`)
 await writeFile(transcriptPath,JSON.stringify({type:'session_meta',payload:{id,cwd:f.options.projectRoot,source:{subagent:{thread_spawn:{parent_thread_id:threadId}}}}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'task_complete'}})+'\n')
 await call('bindReviewRun',{reviewId:request.reviewId,nativeRun:{runId:id}})
 await event({type:'task_started'})
 await event({type:'item_completed',item:{id:'reply',type:'AgentMessage',content:[{type:'Text',text:'功能设计结果仍在主对话'}]}})
 await event({type:'item_completed',item:{id:'review-start',type:'SubAgentActivity',kind:'started',agent_thread_id:id}})
 await event({type:'item_completed',item:{id:'review-end',type:'SubAgentActivity',kind:'completed',agent_thread_id:id}})
 await browser('open',f.server.url)
 await browser('wait','--fn','document.querySelector(".companion-connection-popover")?.textContent.includes("主对话：正在处理后台评审")')
 assert.match(await browser('eval','!document.querySelector(".companion-conversation header .companion-spinner") && !document.querySelector(".companion-conversation-history").textContent.includes("子代理")'),/true/)
 assert.match(await browser('get','text','.companion-conversation-history'),/功能设计结果仍在主对话/)
 await browser('find','role','button','click','--name','后台评审','--exact')
 await browser('wait','--fn','document.querySelector("dialog[open]")?.textContent.includes("子代理已结束，结果未提交")')
 assert.match(await browser('get','text','dialog[open]'),/后台操作记录 · 2 项/)
 await browser('find','role','button','click','--name','关闭后台评审','--exact')
 await event({type:'item_started',item:{id:'foreground',type:'CommandExecution',status:'running'}})
 await browser('wait','--fn','document.body.innerText.includes("主对话：运行中") && !!document.querySelector(".companion-conversation header .companion-spinner")')
 await event({type:'task_complete'})
 await browser('wait','--fn','document.querySelector(".companion-connection-popover")?.textContent.includes("主对话：本轮已结束")')
 assert.equal(f.messages.length,0)
 assert.ok(!(await browser('errors')).includes('Error'))
 console.log('BACKGROUND REVIEW BROWSER OK: separate area, unsubmitted visible, no review task in main history, actual foreground remains active, no dispatch.')
}finally{await browser('close').catch(()=>{});await f.close()}
