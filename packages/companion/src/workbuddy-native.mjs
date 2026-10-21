/** WorkBuddy native Agent receipts, never assistant text, establish child identity. */
import {open,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {workBuddyBackgroundReceipt,workBuddyBackgroundReadiness} from './workbuddy-background.mjs'

const agentId=id=>{if(typeof id!=='string'||!/^agent-[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('Exact WorkBuddy Agent ID required.');return id}
const nativeError=(code,message)=>Object.assign(Error(message),{code})
async function records(path){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
 try{
  const stat=await file.stat();if(!stat.isFile()||stat.size>32*1024*1024)throw Error('WorkBuddy native log exceeds regular-file limit.')
  const text=await file.readFile('utf8')
  return text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse)
 }finally{await file.close()}
}
const nativeTypes=new Set(['message','function_call','function_call_result'])
async function validate(events,cwd,session){
 const expected=await realpath(cwd)
 for(const e of events.filter(e=>nativeTypes.has(e.type))){
  if(typeof e.sessionId!=='string'||e.sessionId!==session||typeof e.cwd!=='string'||await realpath(e.cwd)!==expected)throw Error('WorkBuddy native session or cwd mismatch.')
 }
}
export async function resolveWorkBuddyRun(input,{threadId,mainTranscriptPath}){
 agentId(input.runId)
 if((input.parentRunId??threadId)!==threadId)throw Error('WorkBuddy nested Workers are not verified.')
 if(!mainTranscriptPath)throw Error('Exact WorkBuddy parent transcript required.')
 const expected=join(dirname(mainTranscriptPath),threadId,'subagents',`${input.runId}.jsonl`)
 if(input.transcriptPath&&resolve(input.transcriptPath)!==resolve(expected))throw Error('WorkBuddy child path is outside the bound parent.')
 return {runId:input.runId,parentRunId:threadId,transcriptPath:expected}
}
export async function readWorkBuddyBackgroundReadiness({projectRoot,sessionId,mainTranscriptPath,readinessSince}){
 try{
  if(!mainTranscriptPath||!sessionId)throw Error('Exact bound WorkBuddy main transcript required.')
  const parent=await records(mainTranscriptPath)
  if(!parent.some(e=>nativeTypes.has(e.type)))throw Error('WorkBuddy parent identity is not ready.')
  await validate(parent,projectRoot,sessionId)
  return workBuddyBackgroundReadiness(parent,sessionId,{since:readinessSince})
 }catch{return{state:'unverified',canDispatch:false,executionMode:'unavailable',canAttemptReadiness:false,reasonCode:'native-session-unavailable',observedMode:'unknown',diagnostics:{issues:[]},reason:'WorkBuddy bound native parent records are unavailable or do not match this connection.'}}
}
export async function verifyWorkBuddyChild({runId,parentRunId,transcriptPath,projectRoot,sessionId,mainTranscriptPath,requireBackground=false,notBefore,reviewId}){
 const binding=await resolveWorkBuddyRun({runId,parentRunId,transcriptPath},{threadId:sessionId,mainTranscriptPath})
 // Reject redirected folders as well as a symlink at the final file.
 const folder=join(dirname(mainTranscriptPath),sessionId,'subagents')
 if(await realpath(folder)!==resolve(folder)||await realpath(binding.transcriptPath)!==resolve(binding.transcriptPath))throw Error('WorkBuddy native child path was redirected.')
 const parent=await records(mainTranscriptPath),child=await records(transcriptPath)
 await validate(parent,projectRoot,sessionId)
 const first=child.find(e=>nativeTypes.has(e.type));if(!first)throw Error('WorkBuddy child identity is not ready.')
 await validate(child,projectRoot,first.sessionId)
 if(requireBackground){
  const receipt=workBuddyBackgroundReceipt(parent,runId,sessionId,{notBefore,reviewId})
  if(['completed','failed','interrupted'].includes(receipt.recordedStatus)){
   const at=child.filter(e=>nativeTypes.has(e.type)).at(-1)?.timestamp
   const last=typeof at==='number'?at:Date.parse(at)
   if(!Number.isFinite(receipt.receiptAt)||!Number.isFinite(last)||last>receipt.receiptAt)receipt.recordedStatus='unknown'
  }
  return{available:true,source:'workbuddy-native-background-child',threadId:runId,...receipt,...workBuddyRows(child)}
 }
 const calls=new Map(),receipts=[];let pending
 for(const event of parent){
  if(event.type==='function_call'&&event.name==='Agent'){
   let args;try{args=JSON.parse(event.arguments)}catch{continue}
   calls.set(event.callId,args)
   if(args.resume===runId)pending='running'
  }
  if(event.type!=='function_call_result'||event.name!=='Agent')continue
  const args=calls.get(event.callId),native=event.providerData?.toolResult?.subAgent
  if(!args)continue
  if(!native||native.sessionId!==runId){if(args.resume===runId)pending=event.status==='failed'?'failed':'unknown';continue}
  if(args.resume!==undefined&&args.resume!==runId)throw Error('WorkBuddy resume and native receipt conflict.')
  if(typeof native.lastId!=='string'&&(native.descriptor!==undefined||args.name!==undefined||args.team_name!==undefined))throw nativeError('workbuddy-foreground-receipt-shape',
   'WorkBuddy returned a named/team or descriptor-only Agent receipt without the foreground lastId cursor. This binding uses an ordinary foreground Agent without name/team_name. A confirmed no-write READY bootstrap rejected before binding may be corrected once; otherwise preserve outputs and report without polling or replaying the task.')
  if(event.status!=='completed')throw nativeError('workbuddy-native-result-incomplete',
   'WorkBuddy native Agent result is not complete. Use the existing call\'s native outcome before binding; do not poll for lastId, relaunch the task or infer completion from child text.')
  if(typeof native.lastId!=='string')throw nativeError('workbuddy-foreground-cursor-missing',
    'WorkBuddy completed its Agent call without the foreground lastId cursor. Binding remains unverified; inspect the returned native result once and report it, without polling or replaying the task.')
  const end=child.findIndex(e=>e.id===native.lastId&&e.type==='message'&&e.role==='assistant'&&e.status==='completed')
  if(end<0)throw Error('WorkBuddy native receipt does not match child output.')
  if(native.afterId!==undefined){const start=child.findIndex(e=>e.id===native.afterId);if(start<0||start>=end)throw Error('WorkBuddy native resume cursor does not match.')}
  receipts.push({end,event});pending=undefined
 }
 if(!receipts.length)throw Error('WorkBuddy parent has no native Agent receipt for this child; bootstrap before binding.')
 const last=receipts.at(-1);let status=pending??'completed'
 if(child.slice(last.end+1).some(e=>nativeTypes.has(e.type))&&!pending)status='unknown'
 return{available:true,source:'workbuddy-native-child',threadId:runId,recordedStatus:status,...workBuddyRows(child),activityEpoch:child.at(-1)?.id}
}
function workBuddyRows(child){
 const rows=[]
 for(const e of child){
  if(e.type==='message'&&['user','assistant'].includes(e.role)){
   const text=(Array.isArray(e.content)?e.content:[]).filter(b=>['input_text','output_text','text'].includes(b.type)&&typeof b.text==='string').map(b=>b.text).join('\n')
   if(text)rows.push({id:e.id,role:e.role,label:e.role==='user'?'任务':'WorkBuddy',text,timestamp:typeof e.timestamp==='number'?new Date(e.timestamp).toISOString():e.timestamp,childRunIds:[]})
  }else if(e.type==='function_call')rows.push({id:e.callId,role:'tool',label:e.name??'工具',text:'',status:'running',childRunIds:[]})
  else if(e.type==='function_call_result'){const row=rows.find(r=>r.id===e.callId);if(row)row.status=e.status==='completed'?'completed':'unknown'}
 }
 return {rows:rows.slice(-200),omitted:Math.max(0,rows.length-200)}
}
export function createWorkBuddyChildTranscript(options){return{async read(){try{return await verifyWorkBuddyChild({...options,runId:options.threadId,transcriptPath:options.path})}catch(error){return{available:false,threadId:options.threadId,recordedStatus:'unknown',rows:[],omitted:0,...(error.code?{reasonCode:error.code}:{}),error:String(error.message)}}}}}
export function createWorkBuddyReviewTranscript(options){return createWorkBuddyChildTranscript({...options,requireBackground:true})}
