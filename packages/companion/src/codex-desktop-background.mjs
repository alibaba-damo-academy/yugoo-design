/** Read-only, current-service evidence for Codex desktop cooperative reviewers.
 * The host owns native launches. No RPC, executable, model or writable readiness
 * ticket is accepted here. General Bundle Producer/Worker capability is separate.
 */
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'
import { readCodexHeader } from './conversation-start.mjs'
import { resolveNativeRun } from './native-run-resolution.mjs'
import { verifyNativeChild } from './native-runs.mjs'
import { createCodexTranscript } from './codex-transcript.mjs'

const WINDOW_BYTES = 4 * 1024 * 1024
const LINE_BYTES = 1024 * 1024
const millis = value => typeof value === 'number' ? value : Date.parse(value)
const unverified = (reasonCode, canAttemptReadiness = true) => ({ state: 'unverified', reasonCode, observedMode: 'unknown',
  canAttemptReadiness, diagnostics: { issues: [] } })

async function events(path, context, parentRunId, first = false) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile()) throw Error('Codex native evidence must be a regular file.')
    await readCodexHeader(file, { threadId: parentRunId ? context.runId : context.sessionId,
      projectRoot: context.projectRoot, ...(parentRunId ? { parentRunId } : {}) })
    const start = first ? 0 : Math.max(0, stat.size - WINDOW_BYTES)
    const bytes = Buffer.alloc(Math.min(WINDOW_BYTES, stat.size - start))
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start)
    let text = bytes.subarray(0, bytesRead).toString('utf8')
    if (start) text = text.slice(text.indexOf('\n') + 1)
    text = text.slice(0, text.lastIndexOf('\n') + 1)
    return text.split('\n').filter(Boolean).map(line => {
      const event = JSON.parse(line)
      // Compaction summaries can exceed the execution-record limit. The outer
      // read is still bounded by WINDOW_BYTES; summaries supply no native proof.
      if (event.type === 'compacted') return undefined
      if (Buffer.byteLength(line) > LINE_BYTES) throw Error('Codex native evidence record exceeds limit.')
      const expected = parentRunId ? context.runId : context.sessionId
      if (event.type === 'event_msg' && event.payload?.thread_id !== undefined
        && event.payload.thread_id !== expected) throw Error('Codex native event belongs to another conversation.')
      return event
    }).filter(Boolean)
  } finally { await file.close() }
}

function launches(rows, since, until = Date.now()) {
  return rows.flatMap(event => {
    const item = event.payload?.item, at = millis(event.timestamp)
    if (event.type !== 'event_msg' || event.payload?.type !== 'item_completed' || !Number.isFinite(at) || at < since || at > until) return []
    if (item?.type === 'SubAgentActivity' && item.kind === 'started') return [
      { runId: item.agent_thread_id, callId: item.id, agentPath: item.agent_path, at,
        started: event.payload.started_at_ms, completed: event.payload.completed_at_ms },
    ]
    if (item?.type === 'CollabAgentToolCall' && ['spawn_agent', 'spawnAgent'].includes(item.tool)) {
      return (item.receiver_thread_ids ?? []).map(runId => ({ runId, callId: item.id, agentPath: item.agent_path, at,
        started: event.payload.started_at_ms, completed: event.payload.completed_at_ms }))
    }
    return []
  })
}

function checkBoundary(context) {
  if (!Number.isFinite(context.readinessSince) || context.readinessSince < 0) throw Error('Current Codex desktop connection boundary is required.')
}

function validLaunch(launch, since, now) {
  return [launch.started, launch.completed, launch.at].every(Number.isFinite)
    && launch.started >= since && launch.completed >= launch.started
    && launch.completed <= launch.at && launch.at <= now
}

async function childLifetime(input, context, observation) {
  const first = await events(input.transcriptPath, { ...context, runId: input.runId }, context.sessionId, true)
  const last = await events(input.transcriptPath, { ...context, runId: input.runId }, context.sessionId)
  const header = first.find(event => event.type === 'session_meta')
  const created = millis(header?.payload?.timestamp ?? header?.timestamp)
  const start = first.find(event => event.type === 'event_msg' && event.payload?.type === 'task_started')
  const started = millis(start?.timestamp), turn = start?.payload?.turn_id
  const terminal = [...first, ...last].find(event => event.type === 'event_msg'
    && ['task_complete','task_completed','turn_aborted','task_failed','error'].includes(event.payload?.type)
    && event.payload?.turn_id === turn)
  const now = Date.now(), ended = terminal ? millis(terminal.timestamp) : now
  if (!turn || !Number.isFinite(created) || !Number.isFinite(started)
    || created > started || started > now || !Number.isFinite(ended) || ended < started || ended > now
    || !terminal && ['completed','failed','cancelled','interrupted'].includes(observation.recordedStatus)) {
    throw Error('Native child activity boundary is unavailable or invalid.')
  }
  return { first, created, started, ended, now, turn,
    version: header?.payload?.multi_agent_version, terminal: !!terminal }
}

function successfulReviewRead(event, life, since) {
  const payload = event.payload, item = payload?.item, at = millis(event.timestamp)
  if (event.type !== 'event_msg' || payload?.type !== 'item_completed' || payload.turn_id !== life.turn
    || item?.type !== 'McpToolCall' || item.server !== 'design-system' || item.tool !== 'design_read_review'
    || item.status !== 'completed' || item.error !== undefined) return undefined
  const start = payload.started_at_ms, completed = payload.completed_at_ms
  if (![at, start, completed].every(Number.isFinite) || start < Math.max(since, life.created, life.started)
    || completed < start || completed > at || at >= life.ended || at > life.now) return undefined
  const args = item.arguments, result = item.result
  if (!args || typeof args !== 'object' || Array.isArray(args) || typeof args.reviewId !== 'string'
    || typeof args.connection !== 'string' || !result || typeof result !== 'object' || Array.isArray(result)
    || result.isError !== undefined && result.isError !== false || result.error !== undefined
    || !Array.isArray(result.content) || result.content.length !== 1
    || result.content[0]?.type !== 'text' || typeof result.content[0].text !== 'string') return undefined
  try {
    const read = JSON.parse(result.content[0].text)
    if (!read || typeof read !== 'object' || Array.isArray(read) || read.reviewId !== args.reviewId) return undefined
    return { reviewId: read.reviewId, connection: args.connection }
  } catch { return undefined }
}

export async function resolveCodexDesktopReviewRun(input, context) {
  checkBoundary(context)
  let runId = input.runId
  if (input.launchCallId || input.agentPath) {
    const rows = await events(context.mainTranscriptPath, context)
    const matches = launches(rows, context.readinessSince).filter(launch =>
      (!input.launchCallId || launch.callId === input.launchCallId) &&
      (!input.agentPath || launch.agentPath === input.agentPath))
    const ids = new Set(matches.map(launch => launch.runId))
    if (ids.size !== 1) throw Error('Current native Codex launch is missing or ambiguous.')
    const [actual] = ids
    if (runId && runId !== actual) throw Error('Native launch and runId conflict.')
    runId = actual
  }
  // Exact actual UUID lookup reuses the existing bounded child resolver. Avoid
  // its whole-parent launch scan: a valid long main conversation can exceed 32MiB.
  return resolveNativeRun({ runId, parentRunId: input.parentRunId, transcriptPath: input.transcriptPath },
    { host: 'codex', threadId: context.sessionId, mainTranscriptPath: context.mainTranscriptPath })
}

export async function readCodexDesktopBackgroundReadiness(context) {
  if (!isAbsolute(context.mainTranscriptPath ?? '') || !Number.isFinite(context.readinessSince)) {
    return unverified('native-connection-boundary-missing', false)
  }
  try {
    checkBoundary(context)
    const rows = await events(context.mainTranscriptPath, context)
    // Bound work even when a main turn launches many native children.
    for (const launch of launches(rows, context.readinessSince).slice(-8).reverse()) {
      try {
        const binding = await resolveCodexDesktopReviewRun({ runId: launch.runId }, context)
        const child = await verifyNativeChild({ ...binding, projectRoot: context.projectRoot })
        if (!child.available || child.catchingUp || !['completed', 'failed', 'cancelled', 'interrupted'].includes(child.recordedStatus)) continue
        const life = await childLifetime(binding, context, child)
        const end = life.ended
        if (!life.terminal || !validLaunch(launch, context.readinessSince, life.now)
          || life.created < context.readinessSince || life.created > launch.completed) continue
        // A returned task name/UUID is insufficient. The actual main Agent must
        // have completed independent native work while this child was alive.
        const overlap = rows.find(event => {
          const item = event.payload?.item, at = millis(event.timestamp)
          const started = event.payload?.started_at_ms, completed = event.payload?.completed_at_ms
          return event.type === 'event_msg' && event.payload?.type === 'item_completed'
            && ['AgentMessage', 'McpToolCall', 'CommandExecution', 'FileChange'].includes(item?.type)
            && [at, started, completed].every(Number.isFinite)
            && started > Math.max(launch.at, life.created) && completed >= started
            && completed <= at && at < end && at <= life.now
        })
        if (!overlap) continue
        return { state: 'ready', reasonCode: 'native-background-ready', observedMode: 'background',
          canAttemptReadiness: false, diagnostics: { callId: launch.callId, issues: [] } }
      } catch { /* One unrelated/unfinished child is not a capability failure. */ }
    }
    return unverified('native-background-not-observed')
  } catch { return unverified('native-records-unavailable') }
}

export async function verifyCodexDesktopReviewChild(input, context, request) {
  checkBoundary(context)
  if (input.parentRunId !== context.sessionId) throw Error('Reviewer must be a native child of the bound main conversation.')
  const observation = await verifyNativeChild({ ...input, projectRoot: context.projectRoot })
  if (request) {
    if (typeof request.reviewId !== 'string' || !request.reviewId) throw Error('Exact review assignment is required.')
    const since = Math.max(context.readinessSince, request.notBefore)
    if (!Number.isFinite(since)) throw Error('Exact review creation boundary is required.')
    const parentRows = await events(context.mainTranscriptPath, context)
    const life = await childLifetime(input, context, observation)
    if (!launches(parentRows, since).some(launch => launch.runId === input.runId
      && validLaunch(launch, since, life.now) && life.created >= since
      && life.created <= launch.completed && launch.started < life.ended)) throw Error('Reviewer launch is outside this request boundary.')
    const incoming = life.first.flatMap(event => {
      const at = millis(event.timestamp)
      if (!Number.isFinite(at) || at < Math.max(since, life.created) || at > life.now || at >= life.ended) return []
      const item = event.payload?.item
      const legacy = event.type === 'response_item' && event.payload?.role === 'user' || item?.type === 'UserMessage'
      const blocks = event.type === 'response_item' && (event.payload?.role === 'user' || event.payload?.type === 'agent_message')
        ? event.payload.content : item?.type === 'UserMessage' ? item.content : []
      const text = (Array.isArray(blocks) ? blocks : []).map(block => typeof block.text === 'string' ? block.text : '').join('\n')
      return [{ text, legacy }]
    })
    const reads = life.version === 'v2' ? life.first.map(event => successfulReviewRead(event, life, since)).filter(Boolean) : []
    if (incoming.some(({ text }) => [...text.matchAll(/Bound review: ([^;\r\n]+);/g)].some(match => match[1] !== request.reviewId))
      || reads.some(read => read.reviewId !== request.reviewId)) throw Error('Native child was not assigned this exact review: conflicting review assignments or consumption.')
    const assigned = incoming.some(({ text, legacy }) => legacy && text.includes('Bound review: ' + request.reviewId + ';'))
    // v2 hides task text. Only an actual successful native read of this exact
    // service/request can replace readable input; a path supplied by the caller
    // or an Agent's own message is never connection authority.
    const exactConnection = typeof context.getConnectionPath === 'function' ? context.getConnectionPath() : undefined
    const consumed = isAbsolute(exactConnection ?? '') && reads.some(read => read.connection === exactConnection)
    if (!assigned && !consumed) throw Error('Native child was not assigned this exact review; a readiness probe cannot be rebound.')
  }
  return observation
}

export function codexDesktopBackgroundProtocol(readiness = {}) {
  const ready = readiness.state === 'ready'
  const canAttemptReadiness = !ready && readiness.canAttemptReadiness !== false
  return { mode: 'cooperative-background', state: ready ? 'ready' : 'unverified',
    canAttemptReadiness,
    installedContract: 'Codex desktop native SubAgentActivity/CollabAgentToolCall and UUID parent/child transcript metadata; version-bound, not a public process-spawn API.',
    launch: { tool: 'collaboration.spawn_agent', fork_turns: 'none' },
    ...(canAttemptReadiness ? { bootstrap: {
      description: 'Verify a native child without reviewing Design',
      prompt: 'This is a read-only host capability probe, not a Design review. Call clock.sleep once for 10000 milliseconds, then return READY. Do not inspect or change files, settings or Design; do not spawn children or send messages.',
      parentInstructions: 'Launch this one probe through the native collaboration tool in the exact current conversation. Continue independent ordinary main work while it runs. After its native completion read design_status once. Do not block the main conversation waiting, poll, or repeat a failed/unknown probe automatically. A task name or an accepted spawn alone is not proof.',
    } } : {}),
    proof: 'Keep the actual launchCallId or unique agentPath from the native launch. Bind each review to its own fresh native child, passing the unchanged prepared prompt containing its Bound review ID. For v2 opaque inputs, the child must first successfully call design_read_review for this exact connection and review ID; binding verifies that native tool receipt. If it yields before binding, bind once after the read and resume that same child to submit. Never bind a readiness probe as a Reviewer.',
    completion: 'The main Agent continues independently. The exact child transcript owns completion; submit the requested result with its existing nativeRun binding. Do not poll or block the main conversation waiting for reviews.',
    limitation: 'Only current-service observed native concurrency permits new cooperative review dispatch. This does not verify general Producer/Worker support, change policy, or permit a synchronous/second-model fallback.' }
}

export function createCodexDesktopBackgroundAdapter(context) {
  return {
    readReadiness: () => readCodexDesktopBackgroundReadiness(context),
    protocol: codexDesktopBackgroundProtocol,
    resolveRun: input => resolveCodexDesktopReviewRun(input, context),
    verifyChild: input => verifyCodexDesktopReviewChild(input, context),
    verifyNewChild: (input, request) => verifyCodexDesktopReviewChild(input, context, request),
    createObserver: input => createCodexTranscript(input),
  }
}

// Shared native record syntax, not background readiness authority. Attached
// Bundle execution verifies its own parent/child launch and binding separately.
export { events as readCodexDesktopEvents, launches as codexDesktopLaunches, validLaunch as validCodexDesktopLaunch }
