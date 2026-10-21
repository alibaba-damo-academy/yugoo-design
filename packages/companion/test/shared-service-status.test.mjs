/** Shared HTTP/MCP contract over isolated Files/Git and synthetic native logs.
 * No installed Host, browser, model, background probe or index maintenance.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDesignMcp } from '../src/mcp.mjs'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { fixture, threadId } from './fixture.mjs'

for (const host of ['codex', 'workbuddy', 'qwenwork', 'qoder', 'claude-code']) {
  test(`${host}: one explicit status exposes separate shared services without launching work`, async () => {
    let runtimeReads = 0
    const f = await fixture({ withTranscript: true, serverOptions: { host,
      ...(host === 'workbuddy' ? { workbuddyProducer: true } : {}),
      knowledgeRuntime: async () => { runtimeReads++; throw new Error('Controlled runtime unavailable; no maintenance started') },
    } })
    const server = createDesignMcp(), client = new Client({ name: 'shared-service-contract', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await callCompanion(f.server.connectionPath, { method: 'updateReviewPolicy', params: { policy: { mode: 'off', autoMergeWindowMs: 1000 } } })
      const initial = await callCompanion(f.server.connectionPath, { method: 'readWorkspace', params: { includeConversation: false } })
      assert.equal(initial.services, undefined, 'normal UI polling does not acquire the extra provider')
      assert.equal(runtimeReads, 0)
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
      const result = await client.callTool({ name: 'design_status', arguments: { connection: f.server.connectionPath } })
      assert.ok(!result.isError, JSON.stringify(result))
      const status = JSON.parse(result.content[0].text)
      assert.equal(status.services.schemaVersion, 1)
      assert.equal(status.services.projectId, f.server.project.project.metadata.id)
      assert.equal(status.services.ust.assessment, null)
      assert.equal(status.services.ust.needsReassessment, true)
      if (status.services.ust.reporting.available) {
        assert.equal(status.services.ust.reporting.input.projectId, f.server.project.project.metadata.id)
        assert.equal(status.services.ust.reporting.input.assessedCheckpoint, status.services.checkpoint)
      }
      assert.equal(status.services.kag.state, 'unavailable')
      assert.equal(status.services.kag.reasonCode, 'knowledge-store-not-open')
      assert.equal(status.services.gra.policy.mode, 'off')
      assert.equal(status.services.gra.dispatchAllowed, false)
      assert.ok(status.reviews.every(review => review.status !== 'running'))
      assert.equal(status.services.gra.reviews, undefined, 'the same review list is not retransmitted inside services')
      assert.equal(runtimeReads, 0, 'even a healthy or recoverable cold store is not opened by status')
      assert.equal(f.messages.length, 0, 'status sends no user input, READY probe or reviewer prompt')
      const repeated = await client.callTool({ name: 'design_status', arguments: { connection: f.server.connectionPath } })
      assert.ok(!repeated.isError)
      assert.equal(runtimeReads, 0, 'repeated reads do not initialize a provider')
      assert.equal(f.messages.length, 0)
    } finally { await client.close(); await server.close(); await f.close() }
  })
}

test('WorkBuddy ordinary report reaches project authority through MCP without native call proof', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'workbuddy', workbuddyProducer: true } })
  const server = createDesignMcp(), client = new Client({ name: 'native-main-wiring', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const argsFor = params => ({ connection: f.server.connectionPath, ...params })
  const call = async (name, params = {}) => {
    const result = await client.callTool({ name, arguments: argsFor(params) })
    assert.ok(!result.isError, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }
  let reopened
  try {
    await callCompanion(f.server.connectionPath, { method: 'updateReviewPolicy', params: { policy: { mode: 'off', autoMergeWindowMs: 1000 } } })
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])
    const context = await call('design_main_context')
    assert.ok(context.input.projectId, 'project context is available without native transcript proof')
    const params = { input: context.input, summary: 'Assessment of the opening request against saved evidence.',
      u: { score: 62, evidence: 'The user intent is explicit.' }, s: { score: 68, evidence: 'Saved scope has an agreed structure.' },
      t: { score: 45, evidence: 'Observable acceptance gaps remain.' } }
    const report = await call('report_design_clarity', params)
    assert.equal('callId' in report.report, false)
    assert.equal(report.report.origin, 'main-agent')
    const status = await call('design_status')
    assert.equal(status.services.ust.state, 'current')
    assert.equal(status.services.ust.needsReassessment, false)
    assert.equal(status.services.ust.assessment.u.score, 62)
    const authority = JSON.parse(await readFile(join(f.options.projectRoot, 'design_records/clarity.json'), 'utf8'))
    assert.equal('callId' in authority.report, false)
    assert.deepEqual(authority.report, report.report)
    reopened = await startCompanion({ ...f.options, host: 'workbuddy', workbuddyProducer: true })
    const after = await callCompanion(reopened.connectionPath, { method: 'mainContext' })
    assert.equal(after.input.projectId, context.input.projectId)
    assert.equal(after.input.kitContentHash, context.input.kitContentHash)
    assert.equal(after.clarity.state, 'current', 'reopening reuses the same shared score and main observation boundary')
    assert.equal(f.messages.length, 0, 'scoring never sends another user turn, model request or background probe')
  } finally { await reopened?.close(); await client.close(); await server.close(); await f.close() }
})

test('observing new background readiness cannot resume an admitted review queue', async () => {
  const sent = []
  let delivered
  const delivery = new Promise(resolve => { delivered = resolve })
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'workbuddy', workbuddyProducer: true,
    connection: { host: 'workbuddy', threadId, async send(text) { sent.push(text); delivered(); return { accepted: true, threadId } } },
  } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const event = (type, extra) => ({ type, id: crypto.randomUUID(), timestamp: Date.now(),
    sessionId: threadId, cwd: f.options.projectRoot, ...extra })
  const append = (...records) => appendFile(f.options.transcriptPath, records.map(JSON.stringify).join('\n') + '\n')
  try {
    await call('updateReviewPolicy', { policy: { mode: 'auto', autoMergeWindowMs: 0 } })
    await append(event('message', { role: 'user', content: [{ type: 'input_text', text: 'Design my private notebook.' }] }))
    await call('savePanel', { skill: 'smart_questions', eventId: 'status-no-review-launch', includeDerivedStatus: false,
      state: { questions: { goal: { prompt: 'Goal?', kind: 'text', answer: 'Private notebook', detail: '' } } } })
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(sent.length, 0, 'publication retains the queue while background capability is unavailable')
    const now = Date.now(), callId = 'native-spawn', runId = 'agent-native-ready'
    await append(event('function_call', { name: 'Agent', callId, arguments: JSON.stringify({ run_in_background: true }) }),
      event('function_call_result', { name: 'Agent', callId, status: 'completed', providerData: { toolResult: { subAgent: { sessionId: runId,
        descriptor: { version: 1, sessionId: runId, rootSessionId: threadId, parentSessionId: threadId,
          parentToolCallId: callId, conversationRequestId: 'request', rootRequestId: 'root', role: 'general-purpose',
          description: 'Synthetic receipt only', mode: 'background', status: 'running', createdAt: now, updatedAt: now } } } } }))
    const observed = await call('readWorkspace', { includeServices: true, includeConversation: false })
    assert.equal(observed.services.gra.execution.available, true)
    assert.equal(observed.services.gra.execution.mode, 'cooperative-background')
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(sent.length, 0, 'status changes no scheduler configuration and sends no review notice')
    assert.ok(observed.services.gra.reviews.every(review => review.status !== 'running'))
    // An explicit policy operation still owns normal queue resumption.
    await call('updateReviewPolicy', { policy: { mode: 'auto', autoMergeWindowMs: 0 } })
    let timeout
    try { await Promise.race([delivery, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Explicit policy did not resume its admitted queue')), 5000) })]) }
    finally { clearTimeout(timeout) }
    assert.equal(sent.length, 1)
    assert.match(sent[0], /Background GRA rule notice/)
  } finally { await f.close() }
})
