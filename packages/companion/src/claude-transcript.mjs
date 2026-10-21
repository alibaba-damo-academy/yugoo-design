/** Claude Code native records: read-only, exact session/dispatch identity only. */
import {open,realpath} from 'node:fs/promises'
import {constants} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {requireThreadId} from './codex-connection.mjs'
import {createClaudeStyleTranscript} from './qoder-transcript.mjs'

export function requireClaudeAgentId(id) {
  if(typeof id!=='string'||!/^[a-zA-Z0-9][\w-]{0,127}$/.test(id))throw new Error('Exact Claude Code agent ID required.')
  return id
}
async function readRegular(path,limit) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
  try {const stat=await file.stat();if(!stat.isFile()||stat.size>limit)throw new Error('Claude Code metadata exceeds regular-file limit.');return await file.readFile('utf8')}
  finally {await file.close()}
}
const blocks=e=>Array.isArray(e.message?.content)?e.message.content:[]

export function createClaudeTranscript(options) {
  if(options.agentId)requireClaudeAgentId(options.agentId)
  // Null stop_reason occurs in real logs, including interrupted children. Only
  // explicit end_turn is terminal; elapsed time or assistant text is not proof.
  return createClaudeStyleTranscript({...options,label:'Claude Code',source:'claude-native-transcript',nativeTaskStatus:false})
}

export async function verifyClaudeChild({runId,parentRunId,transcriptPath,sessionId,projectRoot}) {
  requireThreadId(sessionId);requireClaudeAgentId(runId);requireClaudeAgentId(parentRunId)
  const folder=dirname(transcriptPath)
  const canonical=join(folder,`agent-${runId}.jsonl`)
  if(resolve(canonical)!==resolve(transcriptPath))throw new Error('Claude Code transcript filename identity mismatch.')
  // Native metadata ties the child to an exact Agent/Task tool use. Filename
  // identity alone cannot prove parentage, especially for nested subagents.
  const meta=JSON.parse(await readRegular(join(folder,`agent-${runId}.meta.json`),2*1024*1024))
  if(typeof meta.toolUseId!=='string'||!meta.toolUseId)throw new Error('Claude Code native dispatch metadata unavailable.')
  const parentPath=parentRunId===sessionId?join(folder,'../../',`${sessionId}.jsonl`):join(folder,`agent-${parentRunId}.jsonl`)
  const text=await readRegular(parentPath,32*1024*1024)
  // A concurrently appended partial record is not an identity failure; ignore
  // only that unfinished suffix, never malformed complete records.
  const records=text.slice(0,text.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(JSON.parse)
  const dispatch=records.find(e=>e.type==='assistant'&&e.sessionId===sessionId&&(e.agentId??sessionId)===parentRunId&&
    blocks(e).some(b=>b.type==='tool_use'&&b.id===meta.toolUseId&&['Agent','Task'].includes(b.name)))
  if(!dispatch)throw new Error('Claude Code native parent dispatch does not match.')
  // Enforce main-session cwd, but children may inherit a changed Bash cwd.
  const initial=records.find(e=>e.sessionId===sessionId&&!e.agentId&&e.cwd)
  if(parentRunId===sessionId&&(!initial||await realpath(initial.cwd)!==await realpath(projectRoot)))throw new Error('Claude Code parent cwd mismatch.')
  const log=await createClaudeTranscript({path:transcriptPath,sessionId,agentId:runId,projectRoot}).read()
  if(!log.available)throw new Error(log.error??'Claude Code child log is not yet readable.')
  return log
}

export async function resolveClaudeRun(input,{threadId,mainTranscriptPath,parentBinding}) {
  requireThreadId(threadId);requireClaudeAgentId(input.runId)
  const parentRunId=input.parentRunId??threadId
  requireClaudeAgentId(parentRunId)
  if(parentRunId!==threadId&&!parentBinding)throw new Error('Claude Code parent must be bound before resolving a nested child.')
  if(!mainTranscriptPath)throw new Error('Exact Claude Code main transcript required.')
  const transcriptPath=input.transcriptPath??join(dirname(mainTranscriptPath),threadId,'subagents',`agent-${input.runId}.jsonl`)
  return {runId:input.runId,parentRunId,transcriptPath}
}
