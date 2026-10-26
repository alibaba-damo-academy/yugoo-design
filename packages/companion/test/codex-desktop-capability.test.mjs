import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { startCompanion } from '../src/server.mjs'
import { openCompanionProject } from '../src/project.mjs'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

test('desktop startup rejects unset and token browser access before any project or native effects', async () => {
  for (const browser of [{}, { browserAccess: 'token' }]) {
    await assert.rejects(startCompanion({ codexDesktop: true, ...browser }), /Codex desktop requires explicit browserAccess="local"/)
  }
})

test('desktop transport cannot opt into CLI remote or managed reviewer processes', async () => {
  for (const invalid of [{ host: 'workbuddy' }, { codexRemote: 'unix:///private/other.sock' }, { backgroundReviews: true }]) {
    await assert.rejects(startCompanion({ codexDesktop: true, browserAccess: 'local', ...invalid }), /Codex desktop requires the Codex host/)
  }
})

test('private desktop lane preserves real save/reopen and rejects browser admission', async t => {
  const f = await fixture({ smartQuestionsMode: 'main', serverOptions: { codexDesktop: true, browserAccess: 'local', connection: undefined } })
  t.after(() => f.close())
  const instance = '00000000-0000-4000-8000-000000000002'
  let generation
  const call = params => callCompanion(f.server.connectionPath, { method: 'desktopBridge', params: { ...params, instance, generation } })
  const request = JSON.stringify({ method: 'desktopBridge', params: { operation: 'ready', instance, threadId } })
  assert.equal((await fetch(f.server.origin + '/api', { method: 'POST', headers: { Origin: f.server.origin, 'Content-Type': 'application/json' }, body: request })).status, 403)
  assert.equal((await fetch(f.server.url + 'api', { method: 'POST', headers: { Origin: f.server.origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1' }, body: request })).status, 403)
  const admission = await call({ operation: 'ready', threadId })
  generation = admission.generation
  const state = { questions: { desktop: { prompt: 'Save check', kind: 'text', answer: 'canonical saved bytes', detail: '' } } }
  const saved = await f.server.project.savePanel({ skill: 'smart_questions', state, eventId: 'desktop-http-save' })
  const pending = f.server.project.sendPrompt({ text: 'Confirm saved test only' })
  const { message } = await call({ operation: 'next' })
  assert.match(message.text, /canonical saved bytes/)
  assert.ok(!message.text.includes(f.server.token))
  await call({ operation: 'settle', messageId: message.id, receipt: { accepted: true, status: 'submitted_unverified', threadId } })
  assert.equal((await pending).status, 'submitted_unverified')
  const reopened = await openCompanionProject(f.options)
  assert.equal(await reopened.store.head(), saved.commit)
  assert.deepEqual((await reopened.readWorkspace()).design.smart_questions.state, state)
  await call({ operation: 'stop' })
})

test('desktop connection does not inherit CLI subagent/worker/background capability', async t => {
  const f = await fixture({ smartQuestionsMode: 'main', serverOptions: {
    codexDesktop: true, browserAccess: 'local',
    connection: { host: 'codex', inputMode: 'desktop', threadId, send: async () => ({ accepted: true, status: 'submitted_unverified', threadId }) },
  } })
  t.after(() => f.close())
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const status = await call('readWorkspace')
  const keys = ['mainBundles','foregroundReviews','nativeSubagents','nativeWorkers','backgroundReviews']
  assert.deepEqual(Object.fromEntries(keys.map(key => [key, status.hostCapabilities[key]])),
    { mainBundles: true, foregroundReviews: true, nativeSubagents: false, nativeWorkers: false, backgroundReviews: false })
  assert.equal(status.hostCapabilities.backgroundReviewReadiness, 'unverified')
  assert.equal(status.hostCapabilities.backgroundReviewProtocol.mode, 'cooperative-background')
  assert.equal(status.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, false,
    'without an exact native transcript there is no supported bootstrap in this connection')
  assert.equal(status.reviewDispatchOwner, 'unavailable')
  await assert.rejects(call('registerNativeRun', {}), /Codex desktop native agents/)
  await assert.rejects(call('prepareReview', { profile: 'reflection' }), /not verified/)
  assert.deepEqual(await call('readReviewPolicy'), { mode: 'auto', autoMergeWindowMs: 30000 })
})

test('desktop review HTTP paths require current native proof and a fresh exact review child', async t => {
  const f = await fixture({ withTranscript: true, serverOptions: { codexDesktop: true, browserAccess: 'local',
    connection: { host: 'codex', inputMode: 'desktop', threadId, send: async () => ({ accepted: true, status: 'submitted_unverified', threadId }) } } })
  t.after(() => f.close())
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const unverified = await call('readWorkspace')
  assert.equal(unverified.hostCapabilities.backgroundReviews, false)
  const probe = '00000000-0000-4000-8000-000000000002'
  const reviewer = '00000000-0000-4000-8000-000000000003'
  const native = async (runId, name, assignment, consumedRequest) => {
    // All native records are synthetic fixtures, after this service opened and
    // in the past; real-host evidence is verified separately on the Mac.
    await setTimeout(8)
    const at = Date.now() - 3
    const event = (offset, payload) => ({ timestamp: new Date(at + offset).toISOString(), type: 'event_msg',
      payload: { ...payload, started_at_ms: at + offset, completed_at_ms: at + offset } })
    const launch = event(0, { type: 'item_completed', item: { type: 'SubAgentActivity', kind: 'started',
      id: 'call-' + name, agent_path: '/root/' + name, agent_thread_id: runId } })
    const mainWork = event(1, { type: 'item_completed', item: { type: 'McpToolCall', id: 'work-' + name, tool: 'read_file', status: 'completed' } })
    await appendFile(f.options.transcriptPath, [launch, mainWork].map(JSON.stringify).join('\n') + '\n')
    const path = join(dirname(f.options.transcriptPath), 'rollout-' + runId + '.jsonl')
    const rows = [
      { type: 'session_meta', payload: { id: runId, cwd: f.options.nativeCwd, timestamp: new Date(at - 1).toISOString(),
        source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } },
      { timestamp: new Date(at).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: assignment }] } },
      event(0, { type: 'task_started', turn_id: 'child-' + name }),
      event(2, { type: 'task_complete', turn_id: 'child-' + name }),
    ]
    if (consumedRequest) {
      rows[0].payload.multi_agent_version = 'v2'
      rows.splice(3, 0, event(1, { type: 'item_completed', turn_id: 'child-' + name,
        item: { type: 'McpToolCall', id: 'native-consume-' + name, server: 'design-system', tool: 'design_read_review',
          status: 'completed', arguments: { connection: f.server.connectionPath + '.foreign', reviewId: consumedRequest.reviewId },
          result: { content: [{ type: 'text', text: JSON.stringify(consumedRequest) }] } } }))
    }
    await writeFile(path, rows.map(JSON.stringify).join('\n') + '\n')
    return path
  }
  await native(probe, 'ready', 'Return READY, no review.')
  const ready = await call('readWorkspace')
  assert.equal(ready.hostCapabilities.backgroundReviews, true)
  assert.equal(ready.hostCapabilities.backgroundReviewExecutionMode, 'cooperative-background')
  assert.equal(ready.hostCapabilities.nativeSubagents, false, 'review proof does not grant general Bundle topology')
  const prepared = await call('prepareReview', { profile: 'reflection' })
  assert.ok(prepared.reviewId)
  await assert.rejects(call('bindReviewRun', { reviewId: prepared.reviewId,
    nativeRun: { launchCallId: 'call-ready', agentPath: '/root/ready' } }), /outside this request boundary|not assigned/)
  await native(reviewer, 'reviewer', prepared.prompt)
  await call('bindReviewRun', { reviewId: prepared.reviewId,
    nativeRun: { launchCallId: 'call-reviewer', agentPath: '/root/reviewer' } })
  const bound = await call('readReview', { reviewId: prepared.reviewId })
  assert.equal(bound.nativeRun.runId, reviewer)
  assert.equal(bound.nativeRun.parentRunId, threadId)
  const v2Request = await call('prepareReview', { profile: 'alignment' })
  const material = await call('readReview', { reviewId: v2Request.reviewId })
  const v2Path = await native('00000000-0000-4000-8000-000000000004', 'opaque-reviewer', 'Opaque native input', material)
  const bind = () => call('bindReviewRun', { reviewId: v2Request.reviewId, nativeRun: { agentPath: '/root/opaque-reviewer' } })
  await assert.rejects(bind(), /not assigned this exact review/, 'a foreign path cannot substitute the server-owned connection')
  const v2Rows = (await readFile(v2Path, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  v2Rows.find(row => row.payload?.item?.id === 'native-consume-opaque-reviewer').payload.item.arguments.connection = f.server.connectionPath
  await writeFile(v2Path, v2Rows.map(JSON.stringify).join('\n') + '\n')
  await bind()
  const v2Bound = await call('readReview', { reviewId: v2Request.reviewId })
  await call('submitReview', { reviewId: v2Request.reviewId, nativeRun: v2Bound.nativeRun,
    result: { schemaVersion: 1, questions: [] } })
  assert.equal((await call('readReview', { reviewId: v2Request.reviewId })).status, 'completed')
  const completed = await call('readWorkspace')
  assert.deepEqual(completed.backgroundReviews.reviews, completed.reviews)
  assert.equal(completed.hostCapabilities.nativeSubagents, false)
  assert.equal(completed.hostCapabilities.nativeWorkers, false)
  const saved = await call('savePanel', { skill: 'smart_questions', eventId: 'desktop-review-status-save',
    state: { questions: { status: { prompt: 'Status visibility', kind: 'text', answer: 'Saved fixture evidence', detail: '' } } } })
  assert.deepEqual({
    unverifiedVisible: unverified.reviews.some(row => row.profile === 'alignment' && row.executionAvailability === 'unavailable' && row.dispatch === false),
    completedVisible: completed.reviews.some(row => row.profile === 'alignment' && row.status === 'completed'),
    saveReceiptVisible: saved.reviews.some(row => row.profile === 'alignment' && row.revisionChanged === true),
  }, { unverifiedVisible: true, completedVisible: true, saveReceiptVisible: true },
  'desktop review state stays visible before readiness, after completion and after changed Design evidence')
  assert.deepEqual(await call('readReviewPolicy'), { mode: 'auto', autoMergeWindowMs: 30000 })
})
