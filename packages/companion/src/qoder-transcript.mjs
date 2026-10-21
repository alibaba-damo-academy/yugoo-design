/** Read-only Qoder 1.1.45 records. No subprocess, model or native-log writes. */
import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { requireThreadId } from './codex-connection.mjs'
import { nativeQuestions } from './native-questions.mjs'
import { reviewOperation } from './background-reviews.mjs'
import { mainReportOperation } from './native-main-report.mjs'
import { verifyTranscriptBoundary, transcriptAnchor } from './conversation-start.mjs'

export function requireQoderAgentId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][\w-]{0,127}$/.test(id)) throw new Error('Exact Qoder agent ID required.')
  return id
}
async function readRegular(path, limit) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const s = await f.stat()
    if (!s.isFile() || s.size > limit) throw new Error('Qoder metadata file is not regular or exceeds read limit.')
    return await f.readFile('utf8')
  } finally { await f.close() }
}
const timestamp = value => typeof value === 'number' ? new Date(value).toISOString() : value
const millis = value => typeof value === 'number' ? value : Date.parse(value)
const blocks = event => Array.isArray(event.message?.content) ? event.message.content : []
function rowsFor(event, label = 'Qoder') {
  if (!['user', 'assistant'].includes(event.type) || event.isMeta) return []
  if (event.isApiErrorMessage) return [{ id:event.uuid, role:'assistant', label,
    text:JSON.stringify(event.errorDetails ?? '').includes('tpm_limit_exceeded')
      ? '模型服务限流：每分钟 Token 配额不足（tpm_limit_exceeded）。本轮未完成，不是拒绝设计任务。请稍后再试；不要自动重试或重复保存。'
      : `${label} 模型服务请求失败，本轮未完成。请查看原生服务错误；不要将通用错误文案当作模型拒答。`,
    status:'failed', timestamp:timestamp(event.timestamp), childRunIds:[] }]
  if (typeof event.message?.content === 'string') return [{ id:event.uuid, role:event.type, label:event.type === 'user' ? '你' : label, text:event.message.content, timestamp:timestamp(event.timestamp), childRunIds:[] }]
  return blocks(event).flatMap((block, i) => {
    const base = { id:`${event.uuid}:${i}`, activityEpoch:event.uuid, timestamp:timestamp(event.timestamp), childRunIds:[] }
    if (block.type === 'text') return [{...base, role:event.type, label:event.type === 'user' ? '你' : label, text:block.text ?? ''}]
    if (block.type === 'tool_use') {
      const questions = block.name === 'AskUserQuestion' ? nativeQuestions(block.input) : []
      return [{...base, id:block.id, role:'tool', label:block.name ?? '工具', text:'', status:'running',
        mainReportOperation: mainReportOperation(block.name, block.input),
        nativeAgentCall: ['Agent','Task'].includes(block.name),
        reviewOperation: typeof block.name === 'string' && block.name.startsWith('mcp__plugin_design-system_design-system__')
          ? reviewOperation(block.name.slice('mcp__plugin_design-system_design-system__'.length), block.input) : undefined,
        targetRunIds: ['Agent','Task'].includes(block.name) && typeof block.input?.resume === 'string' ? [block.input.resume] : [],
        ...(questions.length ? { questions } : {})}]
    }
    // Raw thinking, tool parameters and tool outputs are not presentation text.
    return []
  })
}

export async function verifyQoderChild({ runId, parentRunId, transcriptPath, taskPath, sessionId, projectRoot }) {
  requireThreadId(sessionId); requireQoderAgentId(runId); requireQoderAgentId(parentRunId)
  const task = JSON.parse(await readRegular(taskPath, 2 * 1024 * 1024))
  if (task.sessionId !== sessionId || task.agentId !== runId || typeof task.parentToolUseId !== 'string' ||
      await realpath(task.transcriptPath) !== await realpath(transcriptPath)) throw new Error('Qoder native task identity does not match.')
  const folder = dirname(transcriptPath)
  const parentPath = parentRunId === sessionId ? join(folder, '../../', `${sessionId}.jsonl`) : join(folder, `agent-${parentRunId}.jsonl`)
  const records = (await readRegular(parentPath, 32 * 1024 * 1024)).split('\n').filter(Boolean).map(line => JSON.parse(line))
  const dispatch = records.find(event => blocks(event).some(block => block.type === 'tool_use' && block.id === task.parentToolUseId && ['Agent','Task'].includes(block.name)))
  if (!dispatch || dispatch.sessionId !== sessionId || (dispatch.agentId ?? sessionId) !== parentRunId) throw new Error('Qoder native parent dispatch does not match.')
  const log = await createQoderTranscript({path:transcriptPath, sessionId, agentId:runId, projectRoot, taskPath}).read()
  if (!log.available) throw new Error(log.error)
  return log
}

export function createQoderTranscript({ path, sessionId, agentId, projectRoot, taskPath }) {
  return createClaudeStyleTranscript({path,sessionId,agentId,projectRoot,taskPath})
}

/** Shared JSONL reader; host wrappers retain their own native identity proofs. */
export function createClaudeStyleTranscript({ path, sessionId, agentId, projectRoot, taskPath, label='Qoder', source='qoder-native-transcript', nativeTaskStatus=true, classifyTurn = () => undefined, startBoundary, mainOnly = false, readHeader }) {
  requireThreadId(sessionId)
  if (agentId) requireQoderAgentId(agentId)
  let offset=0, pending=Buffer.alloc(0), identity, verified=false, leaf, dropped=0, busy, userTurn=0
  const nodes=new Map()
  let cursorGuard
  const reset=()=>{offset=startBoundary?.startOffset??0;pending=Buffer.alloc(0);verified=false;leaf=undefined;dropped=0;userTurn=0;nodes.clear()}
  reset()
  const read=async()=>{
    let file
    try {
      file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
      const stat=await file.stat()
      if(!stat.isFile())throw new Error('Qoder transcript is not a regular file.')
      const current=`${stat.dev}:${stat.ino}`
      if(identity!==current || stat.size<offset){reset();identity=current}
      if(startBoundary){await verifyTranscriptBoundary(file,stat,startBoundary);if(cursorGuard)await verifyTranscriptBoundary(file,stat,cursorGuard);if(readHeader)await readHeader(file,{threadId:sessionId,projectRoot})}
      const buffer=Buffer.alloc(Math.min(2*1024*1024,Math.max(0,stat.size-offset)))
      const {bytesRead}=await file.read(buffer,0,buffer.length,offset)
      offset+=bytesRead;pending=Buffer.concat([pending,buffer.subarray(0,bytesRead)])
      for(let end=pending.indexOf(10);end>=0;end=pending.indexOf(10)){
        if(end>8*1024*1024)throw new Error('Qoder record exceeds observer limit.')
        const line=pending.subarray(0,end).toString('utf8');pending=pending.subarray(end+1)
        if(!line.trim())continue
        const event=JSON.parse(line)
        if(!['active-leaf','user','assistant','system','attachment'].includes(event.type))continue
        if(event.sessionId!==sessionId)throw new Error('Qoder session identity mismatch.')
        if(event.type==='active-leaf'){leaf=event.leafUuid;continue}
        if(!event.uuid)continue
        if((event.agentId??undefined)!==(agentId??undefined))throw new Error('Qoder agent identity mismatch.')
        // A child can legitimately inherit a changed Bash cwd. Native task,
        // session and parent dispatch prove identity, not a fixed directory.
        if(!verified){if(!agentId && await realpath(event.cwd)!==await realpath(projectRoot))throw new Error('Qoder cwd mismatch.');verified=true}
        const toolResults=blocks(event).filter(b=>b.type==='tool_result')
        // Visibility follows the selected native parent chain, not message text.
        // Keep it on nodes across incremental reads and bounded ancestor eviction.
        const background = classifyTurn(event) ?? nodes.get(event.parentUuid)?.background ?? false
        const nativeTurn = event.type==='user' && !event.isMeta && !toolResults.length && !background
          ? nodes.get(event.uuid)?.nativeTurn ?? ++userTurn : undefined
        nodes.set(event.uuid,{id:event.uuid,parent:event.parentUuid, background,
          nativeTurn, rows:rowsFor(event,label).map(row => background ? {...row, nativeBackground:true, activityEpoch:event.uuid} : row.role==='user' ? {...row,nativeTurn} : row), type:event.type, stop:event.message?.stop_reason,
          at:timestamp(event.timestamp), results:blocks(event).filter(b=>b.type==='tool_result').map(b=>({id:b.tool_use_id,error:b.is_error,
            child:toolResults.length===1 && typeof event.toolUseResult?.agentId==='string'?event.toolUseResult.agentId:undefined}))})
        leaf=event.uuid
        if(nodes.size>2048){nodes.delete(nodes.keys().next().value);dropped++}
      }
      if(pending.length>8*1024*1024)throw new Error('Qoder record exceeds observer limit.')
      const chain=[],seen=new Set();let cursor=leaf
      while(cursor && nodes.has(cursor) && !seen.has(cursor)){seen.add(cursor);const n=nodes.get(cursor);chain.unshift(n);cursor=n.parent}
      const selected=[...chain].reverse().find(n=>['user','assistant'].includes(n.type))
      let recordedStatus=!selected?'unknown':selected.type==='assistant'&&selected.stop==='end_turn'?'completed':'running'
      if(agentId && nativeTaskStatus){
        if(!taskPath)recordedStatus='unknown'
        else {
          const task=JSON.parse(await readRegular(taskPath,2*1024*1024))
          if(task.sessionId!==sessionId||task.agentId!==agentId||await realpath(task.transcriptPath)!==await realpath(path))throw new Error('Qoder task identity mismatch.')
          recordedStatus=({running:'running',pending:'running',completed:'completed',failed:'failed',cancelled:'interrupted'})[task.status]??'unknown'
          // A resumed transcript must not inherit a prior task's terminal state.
          if(selected && millis(selected.at)>millis(task.updatedAt) && selected.stop!=='end_turn')recordedStatus='running'
        }
      }
      const results=new Map(chain.flatMap(n=>n.results).map(r=>[r.id,r]))
      const rows=chain.flatMap(n=>n.rows).filter(r=>!mainOnly||r.role==='user'||r.mainReportOperation).map(r=>r.role==='tool'&&results.has(r.id)?{...r,status:results.get(r.id).error?'failed':'completed',
        childRunIds:r.nativeAgentCall && results.get(r.id).child?[results.get(r.id).child]:[],
        targetRunIds:r.nativeAgentCall && results.get(r.id).child?[results.get(r.id).child]:(r.targetRunIds ?? [])}:r)
      const catchingUp=offset<stat.size||pending.length>0
      if(startBoundary)cursorGuard={identity:startBoundary.identity,startOffset:offset,anchor:await transcriptAnchor(file,offset)}
      return {available:verified,source,threadId:agentId??sessionId,recordedStatus:catchingUp?'unknown':recordedStatus,
        catchingUp,activityEpoch:selected?.id,lastEventAt:selected?.at,rows:rows.slice(-200),omitted:dropped+Math.max(0,rows.length-200)}
    }catch(error){reset();identity=undefined;return {available:false,threadId:agentId??sessionId,recordedStatus:'unknown',rows:[],omitted:0,error:`原生日志暂不可读：${String(error.code??error.message).replaceAll('Qoder',label)}`}}
    finally{await file?.close()}
  }
  return {read(){if(!busy)busy=read().finally(()=>{busy=undefined});return busy}}
}
