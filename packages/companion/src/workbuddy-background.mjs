/** WorkBuddy 5.8.3 public Agent/TaskOutput native receipts. No Host settings or launches. */
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512
function args(event) { try { return typeof event.arguments === 'string' ? JSON.parse(event.arguments) : undefined } catch { return undefined } }
const millis = value => typeof value === 'number' ? value : Date.parse(value)

// Only bounded, non-content native metadata enters diagnostics. Never echo a
// prompt, description, path, arbitrary object, or thrown native error message.
const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
function issue(field, expected, value, content = false) {
  const actualType = valueType(value)
  const actual = content && typeof value === 'string' ? { length: value.length }
    : typeof value === 'string' ? value.slice(0, 128)
    : typeof value === 'number' ? Number.isFinite(value) ? value : String(value)
    : typeof value === 'boolean' || value === null ? value : undefined
  return { field, expected, actualType, ...(actual !== undefined ? { actual } : {}) }
}
function receiptError(code, message, issues = [], observedMode = 'unknown') {
  return Object.assign(new Error(message), { code, issues, observedMode })
}
function diagnostic(call, event, issues = []) {
  const native = event?.providerData?.toolResult?.subAgent
  return { ...(text(call?.callId) ? { callId: call.callId } : {}),
    ...(text(event?.id) ? { receiptId: event.id } : {}),
    ...(text(native?.sessionId) ? { taskId: native.sessionId } : {}), issues }
}
function capability(value) {
  return { ...value, canDispatch: value.state === 'ready',
    executionMode: value.state === 'ready' ? 'cooperative-background' : 'unavailable' }
}

export function workBuddyBackgroundProtocol(readiness = {}) {
  const canAttemptReadiness = readiness.state !== 'ready' && readiness.canAttemptReadiness !== false
  return { mode: 'cooperative-background', executionMode: readiness.state === 'ready' ? 'cooperative-background' : 'unavailable',
    state: readiness.state === 'ready' ? 'ready' : 'unverified', canAttemptReadiness,
    launch: { tool: 'Agent', run_in_background: true, subagent_type: 'general-purpose' },
    readiness: canAttemptReadiness
      ? 'Before any real background review, read the current bound-session background readiness. Only ready permits background review dispatch. A descriptor from before this exact Companion connection opened is not current proof. If unverified, do not send a review prompt to Agent. The user may verify the normal Host background capability, or explicitly run the content-free bootstrap below once and read readiness again. This protocol alone never establishes readiness.'
      : 'Do not launch another readiness probe. Reuse a ready current-connection proof; otherwise inspect the existing native result and the normal Host capability or invocation mode. Do not dispatch background reviews while unverified or change Host settings automatically.',
    ...(canAttemptReadiness ? { bootstrap: { description: 'Verify native background receipt only', prompt: 'Return READY immediately. Do not inspect files, use tools, evaluate Design, or perform any review.', run_in_background: true, subagent_type: 'general-purpose' } } : {}),
    proof: 'Use the actual structured subAgent.sessionId task ID and version-1 background descriptor, never the teammate name or assistant text. Bind that native run to its exact prepared review. Only verified binding is running.',
    limitation: 'This is cooperative background execution, not a guaranteed programmatic detached API. run_in_background=true requests background execution; the Agent mode argument controls permissions, not background execution. WorkBuddy can return a synchronous fallback when Agent Teams is disabled, background tasks are disabled, or single-shot print mode is active. Such a result is unavailable as background proof; do not wait, retry in a loop, change Host settings, or automatically substitute a foreground run. A user-confirmed one-time review in the main conversation uses the shared design_recheck_reviews flow with executionMode=foreground; it does not establish background readiness.',
    completion: 'TaskOutput with this exact task_id and block=false is the native status route. Its matching structured agent-output taskId/status receipt proves terminal state; a completed Agent spawn call does not. Never busy-poll or await background review completion in the main conversation.' }
}

/** Existing native receipts in this exact validated main session prove readiness.
 * A later synchronous Agent result invalidates older proof: configuration may
 * have changed. This reads no settings and launches no task, real or synthetic.
 */
export function workBuddyBackgroundReadiness(events, parentSessionId, { since } = {}) {
  if (!Number.isFinite(since) || since < 0) return capability({ state: 'unverified', reasonCode: 'native-connection-boundary-missing',
    reason: 'This exact Companion connection opening boundary is required for native background readiness.',
    diagnostics: { issues: [issue('readinessSince', 'finite nonnegative connection time', since)] } })
  let proof
  let observation = { state: 'unverified', reasonCode: 'native-background-not-observed', observedMode: 'unknown',
    reason: 'No current bound-session native background descriptor; background review dispatch is disabled.', diagnostics: { issues: [] } }
  const calls = new Map()
  for (const event of events) {
    if (event.type === 'function_call' && event.name === 'Agent') calls.set(event.callId, event)
    const call = calls.get(event.callId)
    if (event.type !== 'function_call_result' || event.name !== 'Agent' || args(call ?? {})?.run_in_background !== true) continue
    const receiptAt = millis(event.timestamp)
    if (!Number.isFinite(receiptAt) || receiptAt < since) continue
    const native = event.providerData?.toolResult?.subAgent
    const runId = native?.sessionId
    if (!object(native?.descriptor)) {
      // The normal synchronous result has a terminal child cursor. Missing
      // transport metadata alone cannot establish fallback or revoke good proof.
      const synchronous = event.status === 'completed' && text(runId) && text(native?.lastId) && native.descriptor === undefined
      if (synchronous) proof = undefined
      observation = { state: 'unverified', canAttemptReadiness: false,
        reasonCode: synchronous ? 'native-synchronous-result' : 'native-background-transport-missing',
        observedMode: synchronous ? 'synchronous' : 'unknown',
        diagnostics: diagnostic(call, event, [issue('subAgent.descriptor', 'version-1 background descriptor', native?.descriptor, true)]),
        reason: synchronous
          ? 'The current WorkBuddy background request returned a synchronous child result without a background descriptor. Background GRA remains unavailable; do not repeat READY probes. Verify the normal Host Agent Teams/background capability and invocation mode.'
          : 'The current WorkBuddy background request has no complete native transport observation. Background execution is unverified, not a confirmed synchronous fallback. Inspect that existing request; do not launch another readiness probe.' }
      continue
    }
    try {
      const receipt = workBuddyBackgroundReceipt([call, event], runId, parentSessionId)
      // An old descriptor for a resumed task is not proof of this new launch.
      proof = receipt.descriptor.parentToolCallId === event.callId && receipt.descriptor.createdAt >= since
        && Number.isFinite(receipt.receiptAt) && receipt.receiptAt >= since
        ? { taskId: runId, callId: event.callId, receiptId: event.id, parentSessionId, notBefore: since } : undefined
      if (!proof) observation = { state: 'unverified', canAttemptReadiness: false, reasonCode: 'native-background-stale', observedMode: 'background',
        diagnostics: diagnostic(call, event, [issue('descriptor.createdAt', 'at or after current connection opening', native.descriptor.createdAt)]),
        reason: 'The observed WorkBuddy descriptor predates this exact connection. It is not current readiness proof. Inspect the existing native request instead of repeating READY probes.' }
    } catch (error) {
      proof = undefined
      observation = { state: 'unverified', canAttemptReadiness: false,
        reasonCode: error.code ?? 'native-background-descriptor-invalid', observedMode: error.observedMode ?? 'unknown',
        diagnostics: diagnostic(call, event, error.issues ?? []),
        reason: error.code === 'native-attached-result'
          ? 'The existing native request returned an attached Agent result, not background execution. Background GRA remains unavailable. This receipt does not identify a Host setting; inspect the existing result without another probe.'
          : 'The current WorkBuddy background descriptor does not match its native parent call. Background execution remains unverified; inspect the reported fields in the existing request instead of repeating READY probes.' }
    }
  }
  return capability(proof ? { state: 'ready', proof, reasonCode: 'native-background-ready', observedMode: 'background',
    diagnostics: { callId: proof.callId, receiptId: proof.receiptId, taskId: proof.taskId, issues: [] } } : observation)
}

export function workBuddyBackgroundReceipt(events, runId, parentSessionId, { notBefore, reviewId } = {}) {
  const calls = new Map(); let launch, status = 'unknown', latestReceipt, receiptAt
  for (const event of events) {
    if (event.type === 'function_call' && ['Agent', 'TaskOutput'].includes(event.name) && text(event.callId)) {
      const input = args(event)
      calls.set(event.callId, { event, args: input })
      if (launch && event.name === 'Agent' && input?.resume === runId) status = 'unknown'
      continue
    }
    if (event.type !== 'function_call_result') continue
    const call = calls.get(event.callId)
    if (!call || call.event.name !== event.name) continue
    const native = event.providerData?.toolResult
    if (event.name === 'Agent' && native?.subAgent?.sessionId === runId) {
      const descriptor = native.subAgent.descriptor
      if (!object(descriptor)) continue // The old synchronous lastId receipt is not detached.
      const issues = []
      const check = (field, valid, expected, value, content = false) => { if (!valid) issues.push(issue(field, expected, value, content)) }
      check('arguments.run_in_background', call.args?.run_in_background === true, 'true', call.args?.run_in_background)
      check('result.status', event.status === 'completed', 'completed', event.status)
      check('descriptor.version', descriptor.version === 1, 'number 1', descriptor.version)
      check('descriptor.sessionId', descriptor.sessionId === runId && text(runId), 'exact native child task ID', descriptor.sessionId)
      check('descriptor.mode', descriptor.mode === 'background', 'background', descriptor.mode)
      check('descriptor.rootSessionId', descriptor.rootSessionId === parentSessionId && text(parentSessionId), 'bound main session ID', descriptor.rootSessionId)
      check('descriptor.parentSessionId', descriptor.parentSessionId === parentSessionId && text(parentSessionId), 'bound main session ID', descriptor.parentSessionId)
      check('descriptor.parentToolCallId', descriptor.parentToolCallId === event.callId, 'actual native Agent call ID', descriptor.parentToolCallId)
      for (const key of ['conversationRequestId', 'rootRequestId', 'role', 'description'])
        check('descriptor.' + key, text(descriptor[key]), 'nonempty string <=512 characters', descriptor[key], true)
      check('descriptor.status', descriptor.status === 'running', 'running launch snapshot', descriptor.status)
      check('descriptor.createdAt', Number.isFinite(descriptor.createdAt) && descriptor.createdAt >= 0, 'finite nonnegative number', descriptor.createdAt)
      check('descriptor.updatedAt', Number.isFinite(descriptor.updatedAt) && descriptor.updatedAt >= descriptor.createdAt, 'finite number >=createdAt', descriptor.updatedAt)
      if (issues.length) {
        const attached = descriptor.mode === 'attached' && issues.every(x => ['descriptor.mode', 'descriptor.status'].includes(x.field))
        throw receiptError(attached ? 'native-attached-result' : 'native-background-descriptor-invalid',
          'WorkBuddy background descriptor does not match its actual native parent Agent call.', issues,
          ['attached', 'background'].includes(descriptor.mode) ? descriptor.mode : 'unknown')
      }
      if (notBefore !== undefined && (!Number.isFinite(notBefore) || notBefore < 0
        || descriptor.createdAt < notBefore || !(millis(event.timestamp) >= notBefore))) {
        throw receiptError('native-background-stale', 'WorkBuddy new Reviewer launch predates its current connection or prepared request.',
          [issue('descriptor.createdAt', 'at or after current connection and request', descriptor.createdAt), issue('result.timestamp', 'at or after current connection and request', event.timestamp)], 'background')
      }
      if (reviewId !== undefined && (typeof call.args.prompt !== 'string' || !call.args.prompt.includes(reviewId))) {
        throw receiptError('native-review-id-mismatch', 'WorkBuddy native Agent launch must name this exact review ID.',
          [issue('arguments.prompt', 'contains exact prepared review ID', call.args.prompt, true)], 'background')
      }
      if (launch && launch.parentToolCallId !== descriptor.parentToolCallId) throw new Error('WorkBuddy background task was rebound to another launch.')
      launch = Object.freeze({ ...descriptor }); status = 'running'; latestReceipt = event.id; receiptAt = millis(event.timestamp)
    } else if (event.name === 'TaskOutput' && launch && call.args?.task_id === runId) {
      // Large native render data may be externalized. Never follow a path found
      // in text or infer terminal state from a truncated/persisted-output notice.
      const renderer = native?.renderer
      if (event.status !== 'completed' || renderer?.type !== 'agent-output' || typeof renderer.value !== 'string'
        || Buffer.byteLength(renderer.value) > 8192) { status = 'unknown'; continue }
      let value; try { value = JSON.parse(renderer.value) } catch { status = 'unknown'; continue }
      if (!object(value) || value.taskId !== runId) throw new Error('WorkBuddy TaskOutput receipt belongs to another background task.')
      status = ({ pending: 'running', running: 'running', completed: 'completed', failed: 'failed', cancelled: 'interrupted', killed: 'interrupted' })[value.status] ?? 'unknown'
      latestReceipt = event.id; receiptAt = millis(event.timestamp)
    }
  }
  if (!launch) throw receiptError('native-background-launch-missing', 'No verified WorkBuddy background launch descriptor. A synchronous Agent fallback is not background proof; inspect the existing native request without changing Host settings automatically.')
  return { descriptor: launch, recordedStatus: status, activityEpoch: latestReceipt, receiptAt }
}
