import {resolveWorkBuddyRun} from './workbuddy-native.mjs'
/** Resolve exact native launch evidence, never a latest/name-based session. */
import { open, readdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { requireNativeId } from './native-identity.mjs'
import { resolveClaudeRun } from './claude-transcript.mjs'

async function records(path, limit=32*1024*1024) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
  try {
    const stat=await file.stat()
    if(!stat.isFile() || stat.size>limit)throw new Error('Native evidence exceeds bounded read limit.')
    const bytes=await file.readFile('utf8')
    // An append-in-progress final record is not evidence yet.
    return bytes.slice(0,bytes.lastIndexOf('\n')+1).split('\n').filter(Boolean).map(line=>JSON.parse(line))
  } finally {await file.close()}
}
async function matchingFiles(root, match, depth=4) {
  const found=[];let count=0
  async function visit(folder,remaining) {
    for(const item of await readdir(folder,{withFileTypes:true})) {
      if(++count>20000)throw new Error('Native lookup exceeds bounded directory limit; supply exact transcriptPath.')
      const path=join(folder,item.name)
      if(item.isFile() && match(item.name))found.push(path)
      else if(item.isDirectory() && remaining>0)await visit(path,remaining-1)
    }
  }
  await visit(root,depth);return found
}
/** Locate only the requested main session and verify its header before binding. */
export async function resolveCodexMainTranscript({threadId, nativeCwd, sessionsRoot, transcriptPath, deferIncomplete = false}) {
  requireNativeId('codex',threadId)
  if(!transcriptPath) {
    let paths
    try { paths=await matchingFiles(sessionsRoot,name=>name.endsWith(`-${threadId}.jsonl`)) }
    catch(error) { if(error.code==='ENOENT')return undefined;throw error }
    if(!paths.length)return undefined
    if(paths.length!==1)throw new Error('Main transcript is ambiguous; supply exact --transcript.')
    transcriptPath=paths[0]
  }
  let file
  try { file=await open(transcriptPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK) }
  catch(error) { if(deferIncomplete && error.code==='ENOENT')return transcriptPath;throw error }
  try {
    if(!(await file.stat()).isFile())throw new Error('Main transcript is not a regular file.')
    const buffer=Buffer.alloc(1024*1024)
    const {bytesRead}=await file.read(buffer,0,buffer.length,0)
    const end=buffer.subarray(0,bytesRead).indexOf(10)
    if(end<0) {
      if(deferIncomplete && bytesRead<buffer.length)return transcriptPath
      throw new Error('Main transcript header is incomplete or exceeds limit.')
    }
    let event
    try { event=JSON.parse(buffer.subarray(0,end).toString('utf8')) }
    catch { throw new Error('Invalid main transcript header.') }
    if(event.type!=='session_meta' || event.payload?.id!==threadId)throw new Error('Main transcript UUID mismatch.')
    if(event.payload.source && typeof event.payload.source==='object' && Object.hasOwn(event.payload.source,'subagent'))throw new Error('Main transcript must not be a child session.')
    if(typeof event.payload.cwd!=='string' || await realpath(event.payload.cwd)!==await realpath(nativeCwd))throw new Error('Main transcript cwd mismatch.')
    return transcriptPath
  } finally { await file.close() }
}

export async function resolveNativeRun(input,{host,threadId,mainTranscriptPath,parentBinding}) {
  const parentRunId=input.parentRunId ?? threadId
  requireNativeId(host,parentRunId)
  const parentPath=parentRunId===threadId ? mainTranscriptPath : parentBinding?.transcriptPath
  let runId=input.runId, transcriptPath=input.transcriptPath, taskPath=input.taskPath
  if(input.launchCallId || input.agentPath) {
    if(host!=='codex')throw new Error('launchCallId and agentPath are supported only for Codex. Supply the actual native child runId returned by this host\'s launch tool, not a custom name.')
    if(!parentPath)throw new Error('Exact parent transcript is required for launch lookup.')
    const ids=new Set()
    for(const event of await records(parentPath)) {
      const item=event.payload?.item
      if(event.type!=='event_msg' || event.payload?.type!=='item_completed' || !item)continue
      if(input.launchCallId && item.id!==input.launchCallId)continue
      if(input.agentPath && item.agent_path!==input.agentPath)continue
      if(item.type==='SubAgentActivity' && item.kind==='started')ids.add(item.agent_thread_id)
      if(item.type==='CollabAgentToolCall' && ['spawn_agent','spawnAgent'].includes(item.tool))
        for(const id of item.receiver_thread_ids ?? [])ids.add(id)
    }
    if(ids.size!==1)throw new Error('Native launch is missing or ambiguous; supply exact runId.')
    const [id]=ids
    if(runId && runId!==id)throw new Error('Native launch and runId conflict.')
    runId=id
  }
  requireNativeId(host,runId)
  if (host === 'workbuddy') return resolveWorkBuddyRun({...input,runId,parentRunId},{threadId,mainTranscriptPath})
  if (host === 'claude-code') return resolveClaudeRun({ runId, parentRunId, transcriptPath }, { threadId, mainTranscriptPath, parentBinding })
  if(!transcriptPath || ['qoder','qwenwork'].includes(host) && !taskPath) {
    if(!mainTranscriptPath)throw new Error('Native lookup requires the bound main transcript or explicit paths.')
    if(host==='codex') {
      let root=dirname(mainTranscriptPath)
      if(/^\d{2}$/.test(basename(root)) && /^\d{2}$/.test(basename(dirname(root))) && /^\d{4}$/.test(basename(dirname(dirname(root)))))root=dirname(dirname(dirname(root)))
      const paths=await matchingFiles(root,name=>name.endsWith(`-${runId}.jsonl`))
      if(paths.length!==1)throw new Error('Native transcript is missing or ambiguous; supply exact transcriptPath.')
      transcriptPath=paths[0]
    } else {
      const folder=join(dirname(mainTranscriptPath),threadId,'subagents')
      const paths=taskPath?[taskPath]:await matchingFiles(folder,name=>/^task-.*\.json$/.test(name),0)
      const matches=[]
      for(const path of paths) {
        const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
        try {
          const stat=await file.stat()
          if(!stat.isFile() || stat.size>2*1024*1024)throw new Error('Invalid native task file.')
          const task=JSON.parse(await file.readFile('utf8'))
          if(task.sessionId===threadId && task.agentId===runId)matches.push({path,transcriptPath:task.transcriptPath})
        } finally {await file.close()}
      }
      if(matches.length!==1)throw new Error('Native task is missing or ambiguous; supply exact taskPath.')
      if(transcriptPath && transcriptPath!==matches[0].transcriptPath)throw new Error('Native task and transcriptPath conflict.')
      taskPath=matches[0].path;transcriptPath=matches[0].transcriptPath
    }
  }
  return {runId,parentRunId,transcriptPath,...(['qoder','qwenwork'].includes(host)?{taskPath}:{})}
}
