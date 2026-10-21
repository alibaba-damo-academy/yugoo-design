/** Version-pinned QwenWork native receipts. Read-only; never launches or configures a Host. */
import { open, readdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { requireThreadId } from './codex-connection.mjs'
import { requireNativeId } from './native-identity.mjs'
import { createQwenWorkTranscript, verifyQwenWorkChild } from './qwenwork-transcript.mjs'

const blocks = event => Array.isArray(event.message?.content) ? event.message.content : []
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const millis = value => typeof value === 'number' ? value : Date.parse(value)
const unavailable = 'No current bound-session QwenWork asynchronous Agent receipt and matching native task descriptor.'
const statuses = new Set(['running', 'pending', 'completed', 'failed', 'cancelled'])

async function readRegular(path, limit) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > limit) throw Error('QwenWork native record is not regular or exceeds its read limit.')
    return await file.readFile('utf8')
  } finally { await file.close() }
}

export function qwenWorkBackgroundProtocol(readiness = { state: 'unverified' }) {
  const ready = readiness.state === 'ready'
  const canAttemptReadiness = !ready && readiness.canAttemptReadiness !== false
  return { mode: 'cooperative-background', state: ready ? 'ready' : 'unverified', canAttemptReadiness,
    installedContract: 'QwenWorkCN native records for the installation selected by runtime pins; version-specific, not a stable public API.',
    launch: { tool: 'Agent', run_in_background: true, subagent_type: 'general-purpose' },
    readiness: 'Read current connection readiness before background review dispatch. Only a structured asynchronous launch after this connection opened, matched to the native parent call, task descriptor and child transcript, proves background readiness. Old tasks or a returned Agent ID do not.',
    ...(canAttemptReadiness ? { bootstrap: { description: 'Verify native background receipt only', prompt: 'Return READY immediately. Do not inspect files, use tools, evaluate Design, or perform any review.', run_in_background: true, subagent_type: 'general-purpose' } } : {}),
    proof: 'Keep the actual agentId, taskPath and child transcriptPath. The parent tool_result must contain isAsync=true and status=async_launched; task metadata must match that exact Agent call. Each Reviewer launch is independently verified when bound.',
    completion: 'Observe the exact native task descriptor and child transcript. Agent tool-call completion is not Reviewer completion. Do not assume WorkBuddy TaskOutput or a version-1 descriptor applies here; never busy-poll or wait for background reviews in the main conversation.',
    limitation: 'A synchronous fallback, unknown native shape, stale service proof or unreadable task is unavailable as background proof. Do not change Host settings, automatically substitute a foreground run or use another model client. A user-confirmed one-time review in the main conversation uses the shared design_recheck_reviews flow with executionMode=foreground; it does not establish background readiness.' }
}

async function readSession(options) {
  const { sessionId, mainTranscriptPath, projectRoot, readinessSince } = options
  requireThreadId(sessionId)
  if (!Number.isFinite(readinessSince) || readinessSince < 0) throw Error('Current QwenWork connection opening boundary is required.')
  if (!isAbsolute(mainTranscriptPath ?? '') || basename(mainTranscriptPath) !== `${sessionId}.jsonl`) throw Error('Exact bound QwenWork main transcript required.')
  const parent = await createQwenWorkTranscript({ path: mainTranscriptPath, sessionId, projectRoot }).read()
  if (!parent.available || parent.catchingUp) throw Error('QwenWork parent transcript is unavailable or not fully observed.')
  const events = (await readRegular(mainTranscriptPath, 32 * 1024 * 1024)).split('\n').filter(Boolean).map(line => {
    if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw Error('QwenWork native record exceeds read limit.')
    return JSON.parse(line)
  })
  const nodes = new Map(); let leaf
  for (const event of events) {
    if (!['active-leaf', 'user', 'assistant', 'system', 'attachment'].includes(event.type)) continue
    if (event.sessionId !== sessionId || event.agentId !== undefined) throw Error('QwenWork main session identity mismatch.')
    if (event.type === 'active-leaf') { leaf = event.leafUuid; continue }
    if (event.uuid) { nodes.set(event.uuid, event); leaf = event.uuid }
  }
  const chain = [], seen = new Set()
  while (leaf && nodes.has(leaf) && !seen.has(leaf)) { seen.add(leaf); const event = nodes.get(leaf); chain.unshift(event); leaf = event.parentUuid }
  const calls = new Map(), launches = []
  for (const event of chain) for (const block of blocks(event)) {
    if (block.type === 'tool_use' && ['Agent', 'Task'].includes(block.name)) calls.set(block.id, { block, event })
    if (block.type !== 'tool_result' || !calls.has(block.tool_use_id)) continue
    const call = calls.get(block.tool_use_id)
    const native = block.toolUseResult ?? (blocks(event).filter(x => x.type === 'tool_result').length === 1 ? event.toolUseResult : undefined)
    const async = block.is_error !== true && call.block.input?.run_in_background === true
      && object(native) && native.isAsync === true && native.status === 'async_launched'
      && typeof native.agentId === 'string' && typeof native.outputFile === 'string' && native.outputFile.length > 0
      && typeof native.description === 'string' && typeof native.prompt === 'string'
    launches.push({ callId: block.tool_use_id, call, native, async,
      at: millis(event.timestamp), callAt: millis(call.event.timestamp), receiptId: event.uuid })
  }
  return { launches, folder: join(dirname(mainTranscriptPath), sessionId, 'subagents') }
}

async function descriptorFor(options, session, launch, taskPath, transcriptPath) {
  const { sessionId, readinessSince } = options
  if (!launch?.async || !Number.isFinite(launch.at) || !Number.isFinite(launch.callAt)
    || launch.at < readinessSince || launch.callAt < readinessSince) throw Error('No current QwenWork asynchronous launch receipt.')
  if (options.reviewId !== undefined && (typeof launch.call.block.input?.prompt !== 'string'
    || !launch.call.block.input.prompt.includes(options.reviewId))) throw Error('QwenWork native Agent launch must name this exact review ID.')
  requireNativeId('qwenwork', launch.native.agentId)
  if (await realpath(dirname(taskPath)) !== await realpath(session.folder)) throw Error('QwenWork task is outside this exact native session.')
  const task = JSON.parse(await readRegular(taskPath, 2 * 1024 * 1024))
  if (!object(task) || typeof task.taskId !== 'string' || !/^[a-zA-Z0-9][\w-]{0,127}$/.test(task.taskId)
    || basename(taskPath) !== `task-${task.taskId}.json` || task.sessionId !== sessionId || task.agentId !== launch.native.agentId
    || task.parentToolUseId !== launch.callId || task.completionBehavior !== 'notify'
    || !Number.isSafeInteger(task.executionId) || task.executionId < 1
    || !Number.isFinite(task.createdAt) || !Number.isFinite(task.updatedAt) || task.createdAt < readinessSince || task.updatedAt < task.createdAt
    || !statuses.has(task.status)) throw Error('QwenWork asynchronous task descriptor does not match its actual parent Agent call.')
  const expected = join(session.folder, `agent-${task.agentId}.jsonl`)
  if (!isAbsolute(task.transcriptPath ?? '') || await realpath(task.transcriptPath) !== await realpath(expected)
    || transcriptPath && await realpath(transcriptPath) !== await realpath(expected)
    || !isAbsolute(task.outputPath ?? '') || await realpath(task.outputPath) !== await realpath(launch.native.outputFile)) throw Error('QwenWork asynchronous task paths do not match the native receipt.')
  const log = await verifyQwenWorkChild({ runId: task.agentId, parentRunId: sessionId,
    transcriptPath: task.transcriptPath, taskPath, sessionId, projectRoot: options.projectRoot })
  if (log.catchingUp || log.recordedStatus === 'unknown') throw Error('QwenWork asynchronous child status is not yet verified.')
  return { task, log, proof: { agentId: task.agentId, taskId: task.taskId, taskPath,
    transcriptPath: task.transcriptPath, parentToolUseId: launch.callId, receiptId: launch.receiptId, notBefore: readinessSince } }
}

export async function readQwenWorkBackgroundReadiness(options) {
  let attempted = false
  try {
    const session = await readSession(options)
    // A later synchronous background request invalidates older capability proof.
    const launch = session.launches.filter(x => x.call.block.input?.run_in_background === true).at(-1)
    attempted = Number.isFinite(launch?.at) && launch.at >= options.readinessSince
    if (!launch?.async) return { state: 'unverified', ...(attempted ? { canAttemptReadiness: false } : {}), reason: unavailable }
    const names = (await readdir(session.folder)).filter(name => /^task-[\w-]+\.json$/.test(name))
    if (names.length > 128) throw Error('QwenWork current-session task discovery exceeds its bounded limit.')
    let proof
    for (const name of names) {
      const path = join(session.folder, name), task = JSON.parse(await readRegular(path, 2 * 1024 * 1024))
      if (task.agentId !== launch.native.agentId || task.parentToolUseId !== launch.callId) continue
      if (proof) throw Error('QwenWork native launch has ambiguous task descriptors.')
      proof = (await descriptorFor(options, session, launch, path)).proof
    }
    return proof ? { state: 'ready', proof } : { state: 'unverified', ...(attempted ? { canAttemptReadiness: false } : {}), reason: unavailable }
  } catch (error) { return { state: 'unverified', ...(attempted ? { canAttemptReadiness: false } : {}), reason: `QwenWork background readiness unavailable: ${String(error.message ?? error)}` } }
}

export async function verifyQwenWorkBackgroundChild(options) {
  if (options.parentRunId !== options.sessionId) throw Error('QwenWork Reviewer must belong to its exact bound main session.')
  const session = await readSession(options)
  const launch = session.launches.filter(x => x.native?.agentId === options.runId || x.call.block.input?.resume === options.runId).at(-1)
  if (launch?.async && launch.native.agentId !== options.runId) throw Error('QwenWork asynchronous receipt belongs to another native child.')
  const { log } = await descriptorFor(options, session, launch, options.taskPath, options.transcriptPath)
  return log
}

export function createQwenWorkBackgroundTranscript(options) {
  return { async read() {
    try { return await verifyQwenWorkBackgroundChild({ ...options, runId: options.runId ?? options.agentId ?? options.threadId,
      transcriptPath: options.transcriptPath ?? options.path, parentRunId: options.parentRunId ?? options.sessionId }) }
    catch (error) { return { available: false, threadId: options.runId ?? options.agentId ?? options.threadId,
      recordedStatus: 'unknown', rows: [], omitted: 0, error: `QwenWork background observation unavailable: ${String(error.message ?? error)}` } }
  } }
}
