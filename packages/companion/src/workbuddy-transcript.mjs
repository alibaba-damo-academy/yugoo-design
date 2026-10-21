/** WorkBuddy native flat JSONL; observation never grants execution authority. */
import {open, realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {verifyTranscriptBoundary,transcriptAnchor} from './conversation-start.mjs'
import {mainReportOperation} from './native-main-report.mjs'

const observed = new Set(['message', 'function_call', 'function_call_result'])
const pending = () => Object.assign(Error('WorkBuddy transcript identity is not ready.'), {code:'DESIGN_TRANSCRIPT_PENDING'})

export async function readWorkBuddyHeader(file, {threadId, projectRoot}) {
  const bytes=Buffer.alloc(1024*1024), {bytesRead}=await file.read(bytes,0,bytes.length,0)
  const text=bytes.subarray(0,bytesRead).toString('utf8'), end=text.lastIndexOf('\n')
  for(const line of text.slice(0,end<0?0:end).split('\n')) {
    if(!line.trim())continue
    const event=JSON.parse(line)
    if(event.sessionId!==undefined && event.sessionId!==threadId)throw Error('WorkBuddy session identity mismatch.')
    if(!observed.has(event.type))continue
    if(event.sessionId!==threadId || typeof event.cwd!=='string' || await realpath(event.cwd)!==await realpath(projectRoot))throw Error('WorkBuddy session or cwd mismatch.')
    return
  }
  if(bytesRead===bytes.length)throw Error('WorkBuddy identity exceeds observer limit.')
  throw pending()
}

export function createWorkBuddyTranscript({path, threadId, projectRoot, startBoundary, mainOnly = false}) {
  let offset=startBoundary.startOffset, partial=Buffer.alloc(0), skip=startBoundary.anchor.partial, rows=[], omitted=0, busy
  let activityEpoch, lastEventAt, recordedStatus='unknown',cursorGuard,userTurn=0
  const callStates=new Map()
  const read=async()=>{
    let file
    try {
      file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
      const stat=await file.stat()
      if(!stat.isFile() || stat.size<offset)throw Error('WorkBuddy transcript was replaced or truncated.')
      await verifyTranscriptBoundary(file,stat,startBoundary)
      if(cursorGuard)await verifyTranscriptBoundary(file,stat,cursorGuard)
      await readWorkBuddyHeader(file,{threadId,projectRoot})
      const bytes=Buffer.alloc(Math.min(2*1024*1024,stat.size-offset)), {bytesRead}=await file.read(bytes,0,bytes.length,offset)
      offset+=bytesRead;partial=Buffer.concat([partial,bytes.subarray(0,bytesRead)])
      for(let end=partial.indexOf(10);end>=0;end=partial.indexOf(10)) {
        if(end>8*1024*1024)throw Error('WorkBuddy record exceeds observer limit.')
        const line=partial.subarray(0,end).toString('utf8');partial=partial.subarray(end+1)
        if(skip){skip=false;continue}if(!line.trim())continue
        const event=JSON.parse(line)
        if(event.sessionId!==undefined && event.sessionId!==threadId)throw Error('WorkBuddy session identity mismatch.')
        if(!observed.has(event.type))continue
        if(event.sessionId!==threadId || typeof event.cwd!=='string' || await realpath(event.cwd)!==await realpath(projectRoot))throw Error('WorkBuddy session or cwd mismatch.')
        if(typeof event.id!=='string')continue
        const timestamp=typeof event.timestamp==='number'?new Date(event.timestamp).toISOString():event.timestamp
        activityEpoch=event.id;lastEventAt=timestamp
        if(event.type==='message' && ['user','assistant'].includes(event.role)) {
          if(mainOnly&&event.role==='user'&&(event.isMeta===true||event.origin?.kind==='task-notification'))continue
          const text=(Array.isArray(event.content)?event.content:[]).filter(block=>['input_text','output_text','text'].includes(block.type)&&typeof block.text==='string').map(block=>block.text).join('\n')
          if(text) {
            const row={id:event.id,role:event.role,label:event.role==='user'?'你':'WorkBuddy',text,timestamp,childRunIds:[]}
            const index=rows.findIndex(item=>item.id===event.id)
            if(event.role==='user')row.nativeTurn=index<0?++userTurn:rows[index].nativeTurn
            if(index<0)rows.push(row);else rows[index]=row
          }
          recordedStatus=event.role==='assistant'&&event.status==='completed'?'completed':'unknown'
        } else if(event.type==='function_call' && typeof event.callId==='string') {
          const operation=mainReportOperation(event.name,event.arguments,{host:'workbuddy'})
          const prior=rows.find(row=>row.id===event.callId)
          const status=callStates.get(event.callId)??'running'
          callStates.set(event.callId,status)
          if(callStates.size>2048)callStates.delete(callStates.keys().next().value)
          if(prior) {
            // Native streaming updates may complete arguments for the same call.
            // Never revive a completed call; only its running evidence can update.
            if(prior.role==='tool'&&prior.status==='running')prior.mainReportOperation=operation
          } else if(!mainOnly||operation) rows.push({id:event.callId,role:'tool',label:event.name??'工具',text:'',timestamp,status,childRunIds:[],mainReportOperation:operation})
          recordedStatus='unknown'
        } else if(event.type==='function_call_result') {
          callStates.set(event.callId,event.status==='completed'?'completed':event.status==='failed'?'failed':'unknown')
          if(callStates.size>2048)callStates.delete(callStates.keys().next().value)
          const row=rows.find(item=>item.role==='tool'&&item.id===event.callId)
          if(row)row.status=event.status==='completed'?'completed':event.status==='failed'?'failed':'unknown'
        }
        if(mainOnly)rows=rows.filter(row=>row.role==='user'||row.mainReportOperation)
        if(rows.length>200){omitted+=rows.length-200;rows=rows.slice(-200)}
      }
      if(partial.length>8*1024*1024)throw Error('WorkBuddy record exceeds observer limit.')
      cursorGuard={identity:startBoundary.identity,startOffset:offset,anchor:await transcriptAnchor(file,offset)}
      const catchingUp=offset<stat.size||partial.length>0
      return {available:true,source:'workbuddy-native-transcript',threadId,designSessionStartedAt:startBoundary.activatedAt,rows:rows.map(row=>({...row})),omitted,catchingUp,
        recordedStatus:catchingUp?'unknown':recordedStatus,activityEpoch,lastEventAt}
    } catch(error) {
      offset=startBoundary.startOffset;partial=Buffer.alloc(0);skip=startBoundary.anchor.partial;rows=[];omitted=0;recordedStatus='unknown';activityEpoch=undefined;lastEventAt=undefined;userTurn=0;callStates.clear()
      return {available:false,threadId,recordedStatus:'unknown',rows:[],omitted:0,error:`WorkBuddy 原生日志暂不可读：${error.code??error.message}`}
    } finally {await file?.close()}
  }
  return {read(){return busy??=(read().finally(()=>{busy=undefined}))}}
}
