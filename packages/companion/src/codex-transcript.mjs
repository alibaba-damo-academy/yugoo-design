/** Read-only observer of an explicitly bound native Codex rollout (0.153.4). */
import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { requireThreadId } from './codex-connection.mjs'
import { nativeQuestions } from './native-questions.mjs'
import { reviewOperation } from './background-reviews.mjs'
import { mainReportOperation } from './native-main-report.mjs'
import { readCodexHeader, transcriptAnchor, verifyTranscriptBoundary } from './conversation-start.mjs'

const READ_BYTES = 2 * 1024 * 1024
const MAX_LINE = 8 * 1024 * 1024
const MAX_ROWS = 200

// Use native classifications only; never interpret shell strings or expose queries/output.
function commandLabel(item) {
  const actions = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : []
  const labels = actions.map(action => {
    const name = typeof action?.path === 'string' ? action.path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) : undefined
    switch (action?.type) {
      case 'read': return name ? `读取文件：${name}` : '读取文件'
      case 'list_files': return name ? `查看目录：${name}` : '查看目录'
      case 'search': return '搜索文件'
      default: return '运行命令'
    }
  })
  return [...new Set(labels)].join('；') || '运行命令'
}

export function executionRowMessage(row) {
  if (row.role !== 'tool') return row.text || row.label
  const status = ({ completed: '已完成', failed: '失败', running: '运行中', in_progress: '运行中', cancelled: '已取消', interrupted: '已中断' })[row.status]
  return `${row.text || row.label}${status ? ` · ${status}` : ''}`
}

const textBlocks = blocks => (Array.isArray(blocks) ? blocks : []).map(block => {
  if (['text', 'Text', 'input_text', 'output_text'].includes(block.type)) return block.text ?? ''
  return `[${block.type ?? '非文本内容'}]`
}).join('\n')

export function transcriptRow(event) {
  const item = event.payload?.item
  if (!item || typeof item.id !== 'string') return undefined
  let role = 'tool', text, label = item.type
  switch (item.type) {
    case 'UserMessage': role = 'user'; label = '你'; text = textBlocks(item.content); break
    case 'AgentMessage': role = 'assistant'; label = 'Codex'; text = textBlocks(item.content); break
    case 'Reasoning':
      // Only the native public summary. Never expose raw/encrypted reasoning.
      role = 'assistant'; label = '思考摘要'; text = (item.summary_text ?? []).join('\n'); break
    case 'Plan': role = 'assistant'; label = '计划'; text = item.text; break
    case 'CommandExecution': label = commandLabel(item); break
    case 'FileChange': label = '修改文件'; break
    case 'McpToolCall': case 'DynamicToolCall': label = item.tool ?? item.tool_name ?? item.type; break
    case 'WebSearch': label = '搜索'; break
    case 'CollabAgentToolCall': label = '子代理'; break
    case 'SubAgentActivity': label = '子代理'; break
    default: label = item.type ?? '原生事件'
  }
  if (item.type === 'Reasoning' && !text) return undefined
  return { id: `${event.payload.turn_id ?? ''}:${item.id}`, role, label,
    text: typeof text === 'string' ? text : '',
    status: item.status ?? (event.payload.type === 'item_completed' ? 'completed' : 'running'),
    timestamp: event.timestamp,
    ...(item.type === 'McpToolCall' && item.server === 'design-system'
      ? { reviewOperation: reviewOperation(item.tool, item.arguments), mainReportOperation: mainReportOperation(item.tool, item.arguments) } : {}),
    targetRunIds: item.type === 'SubAgentActivity' && typeof item.agent_thread_id === 'string'
      ? [item.agent_thread_id] : item.type === 'CollabAgentToolCall'
        ? (item.receiver_thread_ids ?? []).filter(id => typeof id === 'string') : [],
    childRunIds: item.type === 'SubAgentActivity' && item.kind === 'started' && typeof item.agent_thread_id === 'string'
      ? [item.agent_thread_id]
      : item.type === 'CollabAgentToolCall' && ['spawn_agent', 'spawnAgent'].includes(item.tool)
        ? (item.receiver_thread_ids ?? []).filter(id => typeof id === 'string') : [],
  }
}

export function createCodexTranscript({ path, threadId, projectRoot, parentRunId, startBoundary, openFile = open, mainOnly = false }) {
  requireThreadId(threadId)
  let identity, offset = 0, pending = Buffer.alloc(0), verified = false
  let rows = [], omitted = 0, recordedStatus = 'unknown', lastEventAt
  let activityEpoch = 0, userTurn = 0
  const callStates = new Map()
  const rememberCall = (id, status) => {
    callStates.set(id, status)
    if (callStates.size > 2048) callStates.delete(callStates.keys().next().value)
  }
  let busy
  let cursorGuard, skippingPrefix = false, skippedPrefixBytes = 0
  const reset = () => { offset = startBoundary?.startOffset ?? 0; pending = Buffer.alloc(0); verified = false; rows = []; omitted = 0; recordedStatus = 'unknown'; lastEventAt = undefined; activityEpoch = 0; userTurn = 0; skippingPrefix = startBoundary?.anchor.partial ?? false; skippedPrefixBytes = 0; callStates.clear() }
  reset()
  const read = async () => {
    let file
    try {
      file = await openFile(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error('Codex transcript is not a regular file.')
      const current = `${stat.dev}:${stat.ino}`
      if (startBoundary) {
        await verifyTranscriptBoundary(file, stat, startBoundary)
        if (cursorGuard && (stat.size < cursorGuard.offset || (await transcriptAnchor(file, cursorGuard.offset)).hash !== cursorGuard.hash)) throw new Error('Native transcript design-session cursor was changed.')
      }
      if (identity !== current || stat.size < offset) { reset(); identity = current }
      if (startBoundary) {
        await readCodexHeader(file, { threadId, projectRoot, parentRunId })
        verified = true
      }
      const buffer = Buffer.alloc(Math.min(READ_BYTES, Math.max(0, stat.size - offset)))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      offset += bytesRead
      pending = Buffer.concat([pending, buffer.subarray(0, bytesRead)])
      if (startBoundary) cursorGuard = { offset, ...(await transcriptAnchor(file, offset)) }
      if (skippingPrefix) {
        const newline = pending.indexOf(10)
        const discarded = newline < 0 ? pending.length : newline + 1
        skippedPrefixBytes += discarded
        if (skippedPrefixBytes > MAX_LINE) throw new Error('Native transcript record exceeds the observer limit.')
        pending = pending.subarray(discarded)
        if (newline >= 0) skippingPrefix = false
      }
      for (let newline = pending.indexOf(10); newline >= 0; newline = pending.indexOf(10)) {
        if (newline > MAX_LINE) throw new Error('Native transcript record exceeds the observer limit.')
        const lineOffset = offset - pending.length
        const line = pending.subarray(0, newline).toString('utf8')
        pending = pending.subarray(newline + 1)
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (!verified) {
          if (event.type !== 'session_meta' || event.payload?.id !== threadId) throw new Error('Codex transcript UUID does not match the bound conversation.')
          if (parentRunId && event.payload.source?.subagent?.thread_spawn?.parent_thread_id !== parentRunId) throw new Error('Codex transcript parent does not match the bound native child.')
          if (typeof event.payload.cwd !== 'string' || await realpath(event.payload.cwd) !== await realpath(projectRoot)) throw new Error('Codex transcript cwd does not match the bound project.')
          verified = true
          continue
        }
        // Native question calls may have no item presentation event. Read only
        // this allowlisted payload, never arbitrary response items or reasoning.
        if (event.type === 'response_item') {
          const p = event.payload
          if (mainOnly && p?.type === 'function_call' && typeof p.call_id === 'string') {
            const status = callStates.get(p.call_id) ?? 'running'
            rememberCall(p.call_id, status)
            const operation = mainReportOperation(p.name, p.arguments)
            const prior = rows.find(row => row.id === p.call_id)
            if (prior?.status === 'running') prior.mainReportOperation = operation
            else if (!prior && operation) rows.push({ id: p.call_id, role: 'tool', label: p.name, text: '', status, mainReportOperation: operation })
          } else if (mainOnly && p?.type === 'function_call_output' && typeof p.call_id === 'string') {
            // Outputs are native lifecycle evidence even when the earlier call
            // had incomplete/unrecognized args and produced no report row.
            rememberCall(p.call_id, 'completed')
            const row = rows.find(row => row.id === p.call_id)
            if (row) row.status = 'completed'
          }
          if (!mainOnly && p?.type === 'function_call' && ['request_user_input', 'functions.request_user_input'].includes(p.name)) {
            const questions = nativeQuestions(p.arguments)
            if (questions.length && typeof p.call_id === 'string' && !rows.some(r => r.id === p.call_id)) {
              rows.push({ id:p.call_id, role:'tool', label:'Codex 提问', text:'', status:'running', questions, timestamp:event.timestamp })
              if (rows.length > MAX_ROWS) { rows.shift(); omitted++ }
            }
          } else if (!mainOnly && p?.type === 'function_call_output') {
            const row = rows.find(r => r.id === p.call_id && r.questions)
            if (row) row.status = 'completed'
          }
          if (rows.length > MAX_ROWS) { omitted += rows.length - MAX_ROWS; rows = rows.slice(-MAX_ROWS) }
          continue
        }
        if (event.type !== 'event_msg') continue
        const payload = event.payload ?? {}
        if (payload.thread_id && payload.thread_id !== threadId) throw new Error('Native event belongs to another conversation.')
        if (mainOnly && !payload.isMeta && payload.type === 'user_message' && typeof payload.message === 'string' && payload.message.trim()) {
          rows.push({ id: `native-user:${lineOffset}`, role: 'user', text: payload.message, nativeTurn: ++userTurn })
          if (rows.length > MAX_ROWS) { rows.shift(); omitted++ }
          continue
        }
        if (payload.type === 'task_started') { recordedStatus = 'running'; activityEpoch++ }
        else if (payload.type === 'task_complete') recordedStatus = 'completed'
        else if (payload.type === 'turn_aborted') recordedStatus = 'interrupted'
        else if (payload.type === 'task_failed') recordedStatus = 'failed'
        else if (payload.type === 'error') recordedStatus = 'unknown'
        if (['task_complete', 'turn_aborted', 'task_failed'].includes(payload.type)) {
          for (const row of rows) if (row.questions && row.status === 'running') row.status = 'interrupted'
        }
        if (['task_started', 'task_complete', 'turn_aborted', 'task_failed', 'error'].includes(payload.type)) lastEventAt = event.timestamp
        // item_completed is the native presentation record; response_item is
        // deliberately not also rendered, avoiding duplicated messages/tools.
        if (!['item_started', 'item_completed'].includes(payload.type)) continue
        const row = transcriptRow(event)
        if (!row) continue
        if (mainOnly && row.role !== 'user' && !row.mainReportOperation) continue
        row.activityEpoch = activityEpoch
        const index = rows.findIndex(prior => prior.id === row.id)
        if (row.role === 'user') row.nativeTurn = index < 0 ? ++userTurn : rows[index].nativeTurn
        if (index >= 0) rows[index] = row
        else rows.push(row)
        if (rows.length > MAX_ROWS) { rows.shift(); omitted++ }
      }
      if (pending.length > MAX_LINE) throw new Error('Native transcript record exceeds the observer limit.')
      const catchingUp = offset < stat.size || pending.length > 0 || skippingPrefix
      return { available: verified, source: 'codex-native-transcript', threadId,
        ...(startBoundary ? { designSessionStartedAt: startBoundary.activatedAt } : {}),
        recordedStatus: catchingUp ? 'unknown' : recordedStatus, activityEpoch, lastEventAt, catchingUp,
        rows: verified ? [...rows] : [], omitted,
      }
    } catch (error) {
      // Next successful read must revalidate metadata; never retain a terminal
      // status from a missing, replaced, or malformed native file.
      reset(); identity = undefined
      return { available: false, threadId, recordedStatus: 'unknown', rows: [], omitted: 0,
        error: `原生日志暂不可读：${error.code ?? error.message}` }
    } finally { await file?.close() }
  }
  return { read() { if (!busy) busy = read().finally(() => { busy = undefined }); return busy } }
}
