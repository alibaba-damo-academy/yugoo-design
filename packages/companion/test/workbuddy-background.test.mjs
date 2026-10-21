import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createNativeBackgroundAdapter } from '../src/native-background-adapter.mjs'
import { workBuddyBackgroundProtocol, workBuddyBackgroundReceipt, workBuddyBackgroundReadiness } from '../src/workbuddy-background.mjs'
import { readWorkBuddyBackgroundReadiness, verifyWorkBuddyChild, createWorkBuddyReviewTranscript } from '../src/workbuddy-native.mjs'

const sessionId = '00000000-0000-4000-8000-000000000001', runId = 'agent-review'
function events() {
  const descriptor = { version: 1, sessionId: runId, rootSessionId: sessionId, parentSessionId: sessionId,
    parentToolCallId: 'spawn', conversationRequestId: 'request', rootRequestId: 'root-request', role: 'general-purpose',
    description: 'readiness', mode: 'background', status: 'running', createdAt: 1, updatedAt: 2 }
  return [
    { id: 'launch', type: 'function_call', name: 'Agent', callId: 'spawn', arguments: JSON.stringify({ run_in_background: true }) },
    { id: 'receipt', type: 'function_call_result', name: 'Agent', callId: 'spawn', status: 'completed', timestamp: 100,
      providerData: { toolResult: { subAgent: { sessionId: runId, descriptor } } } },
  ]
}
function output(status = 'completed', taskId = runId) {
  return [ { id: 'query', type: 'function_call', name: 'TaskOutput', callId: 'query', arguments: JSON.stringify({ task_id: runId, block: false }) },
    { id: 'status', type: 'function_call_result', name: 'TaskOutput', callId: 'query', status: 'completed', timestamp: 300,
      providerData: { toolResult: { renderer: { type: 'agent-output', value: JSON.stringify({ taskId, status }) } } } } ]
}
test('background readiness requires a real parent receipt before dispatch, not public schema or RPC completion', () => {
  const protocol = workBuddyBackgroundProtocol()
  assert.equal(protocol.state, 'unverified'); assert.equal(protocol.canAttempt, undefined)
  assert.match(protocol.readiness, /Only ready permits background review dispatch/)
  assert.doesNotMatch(protocol.bootstrap.prompt, /evaluate this|review this/i)
  const native = events()
  assert.equal(workBuddyBackgroundReadiness([], sessionId, { since: 0 }).state, 'unverified')
  assert.equal(workBuddyBackgroundReadiness(native, sessionId).state, 'unverified', 'no service boundary is not readiness')
  assert.equal(workBuddyBackgroundReadiness(native, sessionId, { since: 0 }).state, 'ready')
  assert.equal(workBuddyBackgroundReadiness(native, sessionId, { since: 2 }).state, 'unverified', 'historical same-session descriptor does not survive a reopened connection')
  assert.equal(workBuddyBackgroundReceipt(native, runId, sessionId).recordedStatus, 'running', 'completed spawn RPC is not completed review')
  delete native[1].providerData.toolResult.subAgent.descriptor
  assert.equal(workBuddyBackgroundReadiness(native, sessionId, { since: 0 }).state, 'unverified')
  assert.throws(() => workBuddyBackgroundReceipt(native, runId, sessionId), /synchronous Agent fallback/)
  native[1].providerData.toolResult.subAgent.lastId = 'completed-child-message'
  const later = events(); later.push(...native.map(e => ({ ...e, callId: 'later' })))
  later[2].arguments = JSON.stringify({ run_in_background: true })
  assert.equal(workBuddyBackgroundReadiness(later, sessionId, { since: 0 }).state, 'unverified', 'later synchronous fallback invalidates historical ready')
})
test('a confirmed synchronous child result stops readiness probes without guessing the Host gate', () => {
  const native = events()
  native[1].providerData.toolResult.subAgent = { sessionId: runId, lastId: 'completed-child-message' }
  const readiness = workBuddyBackgroundReadiness(native, sessionId, { since: 0 })
  assert.equal(readiness.state, 'unverified')
  assert.equal(readiness.canAttemptReadiness, false)
  assert.match(readiness.reason, /synchronous child result/)
  assert.doesNotMatch(readiness.reason, /Teams is disabled|background tasks are disabled|print mode is active/)
  const protocol = workBuddyBackgroundProtocol(readiness)
  assert.equal(protocol.canAttemptReadiness, false)
  assert.equal(protocol.bootstrap, undefined)
  assert.match(protocol.readiness, /Do not launch another readiness probe/)
})
test('missing native transport is not synchronous fallback and does not revoke a verified proof', () => {
  const unknown = events().map(e => ({ ...e, callId: 'missing' }))
  delete unknown[1].providerData
  const readiness = workBuddyBackgroundReadiness(unknown, sessionId, { since: 0 })
  assert.equal(readiness.state, 'unverified')
  assert.equal(readiness.canAttemptReadiness, false)
  assert.match(readiness.reason, /no complete native transport observation/)
  assert.match(readiness.reason, /not a confirmed synchronous fallback/)
  const preserved = workBuddyBackgroundReadiness([...events(), ...unknown], sessionId, { since: 0 })
  assert.equal(preserved.state, 'ready')
  assert.equal(preserved.proof.callId, 'spawn')
  assert.equal(workBuddyBackgroundProtocol(preserved).bootstrap, undefined)
})
test('old results cannot revoke current proof and a new valid descriptor can establish readiness again', () => {
  const old = events().map(e => ({ ...e, callId: 'old', timestamp: 0 }))
  old[1].providerData.toolResult.subAgent = { sessionId: runId, lastId: 'old-child-message' }
  assert.equal(workBuddyBackgroundReadiness([...events(), ...old], sessionId, { since: 1 }).state, 'ready')
  const stale = workBuddyBackgroundReadiness(events(), sessionId, { since: 2 })
  assert.equal(stale.state, 'unverified')
  assert.equal(stale.canAttemptReadiness, false)
  assert.match(stale.reason, /predates this exact connection/)
  const current = events()
  current[1].providerData.toolResult.subAgent.descriptor.createdAt = 5
  current[1].providerData.toolResult.subAgent.descriptor.updatedAt = 6
  assert.equal(workBuddyBackgroundReadiness(current, sessionId, { since: 2 }).state, 'ready')
})
test('descriptor identity and matching native TaskOutput receipts are required for terminal state', () => {
  for (const [key, value] of Object.entries({ version: 2, sessionId: 'foreign', rootSessionId: 'foreign',
    parentSessionId: 'foreign', parentToolCallId: 'foreign', mode: 'foreground', status: 'completed', createdAt: -1 })) {
    const native = events(); native[1].providerData.toolResult.subAgent.descriptor[key] = value
    assert.throws(() => workBuddyBackgroundReceipt(native, runId, sessionId), /descriptor/, key)
    assert.equal(workBuddyBackgroundReadiness(native, sessionId, { since: 0 }).state, 'unverified')
  }
  for (const [status, expected] of [['pending','running'],['running','running'],['completed','completed'],['failed','failed'],['cancelled','interrupted'],['killed','interrupted'],['invented','unknown']]) {
    assert.equal(workBuddyBackgroundReceipt([...events(), ...output(status)], runId, sessionId).recordedStatus, expected)
  }
  assert.throws(() => workBuddyBackgroundReceipt([...events(), ...output('completed', 'foreign')], runId, sessionId), /another background task/)
  const externalized = output(); externalized[1].providerData.toolResult.renderer = { type: 'text', value: '<persisted-output>untrusted path</persisted-output>' }
  assert.equal(workBuddyBackgroundReceipt([...events(), ...externalized], runId, sessionId).recordedStatus, 'unknown')
  const rebound = events(); rebound[0].callId = rebound[1].callId = 'other'; rebound[1].providerData.toolResult.subAgent.descriptor.parentToolCallId = 'other'
  assert.throws(() => workBuddyBackgroundReceipt([...events(), ...rebound], runId, sessionId), /rebound/)
})
test('new WorkBuddy Reviewer binding requires current launch and exact request, not a same-time READY task', () => {
  const native = events(), reviewId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.throws(() => workBuddyBackgroundReceipt(native, runId, sessionId, { notBefore: 1, reviewId }), /exact review ID/)
  native[0].arguments = JSON.stringify({ run_in_background: true, prompt: `Read request ${reviewId} and submit its result.` })
  assert.equal(workBuddyBackgroundReceipt(native, runId, sessionId, { notBefore: 1, reviewId }).recordedStatus, 'running')
  assert.throws(() => workBuddyBackgroundReceipt(native, runId, sessionId, { notBefore: 2, reviewId }), /predates/)
  assert.throws(() => workBuddyBackgroundReceipt(native, runId, sessionId, { notBefore: 1, reviewId: 'another-review' }), /exact review ID/)
  assert.equal(workBuddyBackgroundReceipt(native, runId, sessionId).recordedStatus, 'running', 'old exact bound evidence remains readable')
})
test('validated native log binds the background child and invalidates terminal evidence after new activity', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wb-background-')); t.after(() => rm(root, { recursive: true, force: true }))
  const mainTranscriptPath = join(root, sessionId + '.jsonl'), transcriptPath = join(root, sessionId, 'subagents', runId + '.jsonl')
  await mkdir(join(root, sessionId, 'subagents'), { recursive: true })
  const parent = events().map(e => ({ ...e, sessionId, cwd: root }))
  const child = [{ id: 'task', type: 'message', role: 'user', sessionId: 'child-runtime-id', cwd: root, timestamp: 120,
    content: [{ type: 'input_text', text: 'readiness' }] }]
  const save = async () => { await writeFile(mainTranscriptPath, parent.map(JSON.stringify).join('\n') + '\n'); await writeFile(transcriptPath, child.map(JSON.stringify).join('\n') + '\n') }
  await save()
  const input = { runId, parentRunId: sessionId, projectRoot: root, sessionId, mainTranscriptPath, transcriptPath, requireBackground: true, readinessSince: 0 }
  assert.equal((await readWorkBuddyBackgroundReadiness(input)).state, 'ready')
  assert.equal((await verifyWorkBuddyChild(input)).recordedStatus, 'running')
  parent.push(...output().map(e => ({ ...e, sessionId, cwd: root }))); await save()
  assert.equal((await verifyWorkBuddyChild(input)).recordedStatus, 'completed')
  child.push({ ...child[0], id: 'later', timestamp: 400 }); await save()
  assert.equal((await verifyWorkBuddyChild(input)).recordedStatus, 'unknown')
  parent[0].sessionId = 'foreign'; await save()
  assert.equal((await readWorkBuddyBackgroundReadiness(input)).state, 'unverified')
  const observer = createWorkBuddyReviewTranscript({ ...input, threadId: runId, path: transcriptPath })
  assert.equal((await observer.read()).available, false)
})

// Typed metadata from the existing 5.8.3 receipt reported in Chatroom
// ac07e0d56b9c, not a new Host/probe execution. Only native identity/state fields.
test('the observed attached completed v1 receipt is unavailable, with exact fields rather than a guessed Host switch', () => {
  const native = events(), current = '542a86e8-c6e6-41a3-80bd-b673f1449237'
  native[0].callId = native[1].callId = 'call_01a153ad9c647332a3196106'
  native[1].timestamp = 1792405274485
  native[1].providerData.toolResult.subAgent = { sessionId: 'agent-64a9c4fb-ba62-4e99-acd9-df1e86f88e31', lastId: 'terminal-child',
    descriptor: { ...native[1].providerData.toolResult.subAgent.descriptor,
      sessionId: 'agent-64a9c4fb-ba62-4e99-acd9-df1e86f88e31', rootSessionId: current, parentSessionId: current,
      parentToolCallId: native[0].callId, mode: 'attached', status: 'completed', createdAt: 1792405257829, updatedAt: 1792405263338 } }
  const result = workBuddyBackgroundReadiness(native, current, { since: 1792405200000 })
  assert.equal(result.reasonCode, 'native-attached-result')
  assert.equal(result.observedMode, 'attached'); assert.equal(result.state, 'unverified')
  assert.equal(result.canDispatch, false); assert.equal(result.executionMode, 'unavailable')
  assert.equal(result.canAttemptReadiness, false); assert.equal(workBuddyBackgroundProtocol(result).bootstrap, undefined)
  assert.deepEqual(result.diagnostics.issues.map(x => [x.field, x.actual]), [['descriptor.mode', 'attached'], ['descriptor.status', 'completed']])
  assert.doesNotMatch(result.reason, /Teams is disabled|background tasks are disabled|print mode is active/)
})

test('diagnostics distinguish identity and schema failures without admitting an attached or terminal launch', () => {
  for (const [field, value] of [['version', '1'], ['parentToolCallId', 'foreign'], ['parentSessionId', 'foreign'],
    ['rootSessionId', 'foreign'], ['sessionId', 'foreign'], ['createdAt', '1'], ['updatedAt', 0], ['status', 'completed']]) {
    const native = events(); native[1].providerData.toolResult.subAgent.descriptor[field] = value
    const result = workBuddyBackgroundReadiness(native, sessionId, { since: 0 })
    assert.equal(result.reasonCode, 'native-background-descriptor-invalid', field)
    assert.equal(result.canDispatch, false, field)
    const mismatch = result.diagnostics.issues.find(x => x.field === 'descriptor.' + field)
    assert.ok(mismatch, field); assert.equal(mismatch.actualType, typeof value, field)
  }
  const foreign = events(); Object.assign(foreign[1].providerData.toolResult.subAgent.descriptor, { mode: 'attached', status: 'completed', parentSessionId: 'foreign' })
  assert.equal(workBuddyBackgroundReadiness(foreign, sessionId, { since: 0 }).reasonCode, 'native-background-descriptor-invalid', 'attached cannot hide a parent identity failure')
})

test('a later attached launch revokes older background proof; a genuinely current background launch restores cooperative capability', () => {
  const attached = events(); attached[0].callId = attached[1].callId = 'attached'
  Object.assign(attached[1].providerData.toolResult.subAgent.descriptor, { parentToolCallId: 'attached', mode: 'attached', status: 'completed' })
  const revoked = workBuddyBackgroundReadiness([...events(), ...attached], sessionId, { since: 0 })
  assert.equal(revoked.reasonCode, 'native-attached-result'); assert.equal(revoked.proof, undefined)
  const ready = workBuddyBackgroundReadiness([...attached, ...events()], sessionId, { since: 0 })
  assert.equal(ready.canDispatch, true); assert.equal(ready.executionMode, 'cooperative-background')
  assert.equal(ready.reasonCode, 'native-background-ready'); assert.equal(ready.observedMode, 'background')
  assert.notEqual(ready.executionMode, 'native-detached', 'cooperation is not a programmatic spawn guarantee')
})

test('field diagnostics do not contain prompt, description, content or native paths', () => {
  const native = events(), secret = 'PRIVATE_CONTENT_DO_NOT_ECHO'
  native[0].arguments = JSON.stringify({ run_in_background: true, prompt: secret })
  native[1].providerData.toolResult.subAgent.descriptor.description = secret.repeat(40)
  native[1].providerData.toolResult.subAgent.descriptor.role = { nested: secret }
  native[1].providerData.toolResult.subAgent.descriptor.conversationRequestId = secret.repeat(40)
  const result = workBuddyBackgroundReadiness(native, sessionId, { since: 0 })
  const json = JSON.stringify(result)
  assert.ok(!json.includes(secret)); assert.ok(!json.includes('prompt'))
  assert.deepEqual(result.diagnostics.issues.find(x => x.field === 'descriptor.description').actual, { length: secret.length * 40 })
  native[1].providerData.toolResult.subAgent.descriptor = secret + '/private/path'
  const missing = workBuddyBackgroundReadiness(native, sessionId, { since: 0 })
  assert.equal(missing.reasonCode, 'native-background-transport-missing')
  assert.ok(!JSON.stringify(missing).includes(secret))
})

test('native adapter preserves foreground attached receipts but rejects them for review binding and observes neutral unavailability', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wb-attached-')); t.after(() => rm(root, { recursive: true, force: true }))
  const mainTranscriptPath = join(root, sessionId + '.jsonl'), transcriptPath = join(root, sessionId, 'subagents', runId + '.jsonl')
  await mkdir(join(root, sessionId, 'subagents'), { recursive: true })
  const parent = events().map(e => ({ ...e, sessionId, cwd: root })), childId = 'terminal-child'
  Object.assign(parent[1].providerData.toolResult.subAgent, { lastId: childId })
  Object.assign(parent[1].providerData.toolResult.subAgent.descriptor, { mode: 'attached', status: 'completed' })
  const child = [{ id: childId, type: 'message', role: 'assistant', status: 'completed', sessionId: 'child-session', cwd: root, timestamp: 90, content: [] }]
  await writeFile(mainTranscriptPath, parent.map(JSON.stringify).join('\n') + '\n')
  await writeFile(transcriptPath, child.map(JSON.stringify).join('\n') + '\n')
  const options = { projectRoot: root, sessionId, mainTranscriptPath, readinessSince: 0 }
  const input = { runId, parentRunId: sessionId, transcriptPath }
  assert.equal((await verifyWorkBuddyChild({ ...options, ...input })).recordedStatus, 'completed', 'foreground Producer retains its real native receipt')
  const adapter = createNativeBackgroundAdapter({ ...options, host: 'workbuddy' })
  const result = await adapter.readReadiness()
  assert.equal(result.executionMode, 'unavailable'); assert.equal(result.reasonCode, 'native-attached-result')
  await assert.rejects(adapter.verifyNewChild(input, { reviewId: 'current-review', notBefore: 0 }), error => error.code === 'native-attached-result')
  const missing = await readWorkBuddyBackgroundReadiness({ ...options, mainTranscriptPath: join(root, 'NON_SECRET_PATH_MARKER') })
  assert.equal(missing.reasonCode, 'native-session-unavailable'); assert.equal(missing.canDispatch, false)
  assert.ok(!JSON.stringify(missing).includes('NON_SECRET_PATH_MARKER'))
})
