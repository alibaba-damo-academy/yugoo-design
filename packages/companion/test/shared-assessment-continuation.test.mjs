/** Combined server wiring only: real temporary Files/Git, synthetic native JSONL.
 * Never starts a Host, reviewer, model, installed plugin or browser.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

const policyOff = { mode: 'off', autoMergeWindowMs: 1000 }
const state = answer => ({ questions: { goal: { prompt: 'Goal?', kind: 'text', answer, detail: '' } } })
function native(f, type, extra = {}) {
  return { type, id: `event-${crypto.randomUUID()}`, sessionId: threadId, cwd: f.options.projectRoot, timestamp: Date.now(), ...extra }
}
async function append(f, ...events) {
  await appendFile(f.options.transcriptPath, events.map(JSON.stringify).join('\n') + '\n')
}
async function backgroundReceipt(f, suffix, createdAt = Date.now()) {
  const callId = `background-${suffix}`, taskId = `agent-${suffix}`
  return [
    native(f, 'function_call', { name: 'Agent', callId, arguments: JSON.stringify({ run_in_background: true, prompt: 'READY only; no Design review' }) }),
    native(f, 'function_call_result', { name: 'Agent', callId, status: 'completed', timestamp: createdAt,
      providerData: { toolResult: { subAgent: { sessionId: taskId, descriptor: {
        version: 1, sessionId: taskId, rootSessionId: threadId, parentSessionId: threadId, parentToolCallId: callId,
        conversationRequestId: 'request', rootRequestId: 'root', role: 'general-purpose', description: 'Synthetic readiness receipt',
        mode: 'background', status: 'running', createdAt, updatedAt: createdAt,
      } } } } }),
  ]
}

test('QwenWork dispatch uses its own current asynchronous native proof, with each Reviewer independently fenced', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'qwenwork' } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const event = (uuid, parentUuid, type, content, at = Date.now()) => ({ uuid, parentUuid, type,
    sessionId: threadId, cwd: f.options.projectRoot, timestamp: new Date(at).toISOString(), message: { content } })
  const folder = join(dirname(f.options.transcriptPath), threadId, 'subagents')
  let parent = 'before-design'
  async function launch(suffix, at, reviewId) {
    await mkdir(folder, { recursive: true })
    const agentId = `agent-${suffix}`, taskId = `task-${suffix}`, callId = `launch-${suffix}`
    const transcriptPath = join(folder, `agent-${agentId}.jsonl`), taskPath = join(folder, `task-${taskId}.json`)
    const outputPath = join(folder, `${taskId}.output`)
    await writeFile(outputPath, 'READY')
    await writeFile(transcriptPath, JSON.stringify({ ...event(`child-${suffix}`, null, 'assistant', 'READY', at),
      agentId, message: { content: 'READY', stop_reason: 'end_turn' } }) + '\n')
    await writeFile(taskPath, JSON.stringify({ taskId, sessionId: threadId, executionId: 1, agentId,
      parentToolUseId: callId, transcriptPath, outputPath, completionBehavior: 'notify', status: 'completed', createdAt: at, updatedAt: at }))
    await append(f,
      event(`dispatch-${suffix}`, parent, 'assistant', [{ type: 'tool_use', id: callId, name: 'Agent', input: {
        run_in_background: true, prompt: reviewId ? `Read and submit this exact review ${reviewId}` : 'Return READY immediately; no Design review.' } }], at),
      event(`receipt-${suffix}`, `dispatch-${suffix}`, 'user', [{ type: 'tool_result', tool_use_id: callId,
        toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: 'Synthetic native receipt',
          prompt: 'READY only; no Design review', outputFile: outputPath } }], at))
    parent = `receipt-${suffix}`
    return { runId: agentId, parentRunId: threadId, taskPath, transcriptPath }
  }
  try {
    await call('updateReviewPolicy', { policy: policyOff })
    let snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, false)
    assert.equal(snapshot.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, true)
    assert.match(snapshot.hostCapabilities.backgroundReviewProtocol.proof, /async_launched/)
    await launch('historical', 1)
    assert.equal((await call('readWorkspace')).hostCapabilities.backgroundReviews, false)
    const bootstrap = await launch('current', Date.now())
    snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, true, snapshot.hostCapabilities.backgroundReviewReason)
    assert.equal(snapshot.hostCapabilities.backgroundReviewReadiness, 'ready')
    assert.equal(snapshot.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, false)
    assert.equal(snapshot.reviewDispatchOwner, 'main')
    assert.equal(f.messages.length, 0, 'status never launches a probe or automatic review while policy is off')
    const prepared = await call('recheckReviews', { profiles: ['grounding'], requestId: 'qwen-explicit-recheck' })
    assert.equal(prepared.requests.length, 1)
    const reviewId = prepared.requests[0].reviewId
    const oldChild = await call('bindReviewRuns', { bindings: [{ reviewId, nativeRun: bootstrap }] })
    assert.match(oldChild.results[0].error, /asynchronous launch receipt|exact review ID/, 'a READY task cannot become a Reviewer')
    const actual = await launch('reviewer', Date.now(), reviewId)
    const rejected = await call('bindReviewRuns', { bindings: [{ reviewId, nativeRun: { ...actual, parentRunId: 'foreign-parent' } }] })
    assert.match(rejected.results[0].error, /bound main conversation/)
    const unverifiedChild = await call('bindReviewRuns', { bindings: [{ reviewId, nativeRun: { ...actual, runId: 'agent-without-async-receipt' } }] })
    assert.match(unverifiedChild.results[0].error, /asynchronous launch receipt/, 'readiness never substitutes for this Reviewer launch')
    const bound = await call('bindReviewRuns', { bindings: [{ reviewId, nativeRun: actual }] })
    assert.equal(bound.results[0].status, 'running', bound.results[0].error)
    assert.equal((await call('bindReviewRuns', { bindings: [{ reviewId, nativeRun: actual }] })).results[0].status, 'running',
      'an exact existing binding remains idempotent')
    await append(f,
      event('sync-call', parent, 'assistant', [{ type: 'tool_use', id: 'sync-call', name: 'Agent', input: { run_in_background: true, resume: actual.runId } }]),
      event('sync-result', 'sync-call', 'user', [{ type: 'tool_result', tool_use_id: 'sync-call', content: 'READY; Agent ID: a-text-only-claim' }]))
    snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, false, 'later sync fallback is not background proof')
    assert.equal(snapshot.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, false, 'do not repeat a failed readiness probe')
    await assert.rejects(call('prepareReviews', { profiles: ['reflection'] }), /background reviewer execution is not verified/)
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})

test('WorkBuddy dispatch is fenced by this service readiness, not historic receipts or protocol support', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'workbuddy', workbuddyProducer: true } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await call('updateReviewPolicy', { policy: policyOff })
    let snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, false)
    assert.equal(snapshot.hostCapabilities.backgroundReviewReadiness, 'unverified')
    assert.equal(snapshot.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, true)
    await assert.rejects(call('prepareReviews', { profiles: ['grounding'] }), /background reviewer execution is not verified/)
    await append(f, ...await backgroundReceipt(f, 'historical', 1))
    snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, false)
    assert.equal(f.messages.length, 0, 'status/protocol discovery never sends a real review or readiness probe')
    await append(f, ...await backgroundReceipt(f, 'current'))
    snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, true)
    assert.equal(snapshot.hostCapabilities.backgroundReviewReadiness, 'ready')
    assert.equal(snapshot.reviewDispatchOwner, 'main')
    const prepared = await call('recheckReviews', { profiles: ['grounding'], requestId: 'explicit-synthetic-recheck' })
    assert.equal(prepared.requests.length, 1)
    assert.equal(prepared.requests[0].status, 'prepared', 'readiness itself is not a reviewer launch')
    assert.equal(f.messages.length, 0, 'off policy remains off after readiness changes')
    await append(f,
      native(f, 'function_call', { name: 'Agent', callId: 'fallback', arguments: JSON.stringify({ run_in_background: true }) }),
      native(f, 'function_call_result', { name: 'Agent', callId: 'fallback', status: 'completed', providerData: { toolResult: { subAgent: { sessionId: 'agent-fallback', lastId: 'sync-answer' } } } }))
    snapshot = await call('readWorkspace')
    assert.equal(snapshot.hostCapabilities.backgroundReviews, false, 'later synchronous fallback revokes older readiness')
    await assert.rejects(call('prepareReviews', { profiles: ['reflection'] }), /background reviewer execution is not verified/)
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})

test('saved continuation receives exact main-assessment guidance and native main scores govern current status', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'workbuddy', workbuddyProducer: true, browserAccess: 'local' } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await call('updateReviewPolicy', { policy: policyOff })
    await append(f, native(f, 'message', { id: 'user-design', role: 'user', content: [{ type: 'input_text', text: 'Design a private notebook; keep saved scope explicit.' }] }))
    const saved = await call('savePanel', { skill: 'smart_questions', state: state('private notebook'), eventId: 'combined-save', includeDerivedStatus: false })
    const receipts = [{ eventId: 'combined-save', commit: saved.commit }]
    const sent = await call('sendPrompt', { text: 'Continue from my saved answer.', requestId: 'combined-notify', saved: receipts })
    assert.equal(sent.accepted, true)
    assert.match(f.messages[0], /read design_main_context/i)
    assert.match(f.messages[0], /must assess.*call report_design_clarity.*before asking the next question/s)
    assert.match(f.messages[0], /later user stop, cancellation or instruction not to assess takes priority/)
    assert.doesNotMatch(f.messages[0], /update U\/S\/T when useful|assess U\/S\/T at a meaningful task boundary/)
    assert.match(f.messages[0], /Assessment, KAG and GRA do not block/)
    assert.match(f.messages[0], /private notebook/)
    assert.equal(await f.server.project.store.head(), saved.commit)
    await call('sendPrompt', { text: 'Continue from my saved answer.', requestId: 'combined-notify', saved: receipts })
    assert.equal(f.messages.length, 1, 'accepted notification is not replayed when the same receipt is submitted')
    const context = await call('mainContext')
    assert.equal(context.input.assessedCheckpoint, saved.commit)
    assert.equal(context.clarity.needsReassessment, true)
    const assessment = { summary: 'Main-turn assessment of the saved notebook scope.',
      u: { score: 80, evidence: 'Owner and intent are explicit.' },
      s: { score: 70, evidence: 'Private notebook scope is saved.' },
      t: { score: 60, evidence: 'Privacy still needs observable acceptance criteria.' } }
    const args = { input: context.input, ...assessment }
    const report = await call('reportMainClarity', args)
    assert.equal(report.report.origin, 'main-agent')
    assert.equal('callId' in report.report, false)
    assert.equal(report.assessedCheckpoint, saved.commit)
    const current = await call('readWorkspace')
    assert.equal(current.clarity.needsReassessment, false)
    assert.equal(current.clarity.assessment.u, 80)
    const browser = await fetch(`${new URL(f.server.url).origin}${new URL(f.server.url).pathname}api`, {
      method: 'POST', headers: { Origin: f.server.origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1' },
      body: JSON.stringify({ method: 'reportMainClarity', params: args }),
    })
    assert.equal(browser.status, 403, 'the browser cannot claim native main scoring authority')
    await append(f, native(f, 'message', { id: 'user-new-scope', role: 'user', content: [{ type: 'input_text', text: 'Change scope to a shared team notebook.' }] }))
    const corrected = await call('reportMainClarity', { ...args, summary: 'New user scope changes the assessment reasoning.' })
    assert.equal(corrected.replayed, false)
    assert.equal((await call('readWorkspace')).clarity.needsReassessment, false)
  } finally { await f.close() }
})
