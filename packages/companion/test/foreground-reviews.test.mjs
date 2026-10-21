// Source HTTP/MCP integration with isolated projects and fixture Host transport.
// Does not claim an installed package or real native Agent execution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'
import { createDesignMcp } from '../src/mcp.mjs'

const empty = {
  grounding: { schemaVersion: 1, inconsistencies: [] },
  reflection: { schemaVersion: 1, researchNeeds: [] },
  alignment: { schemaVersion: 1, questions: [] },
}
const grounding = { schemaVersion: 1, inconsistencies: [{ id: 'audience', facets: ['smart_questions', 'research'],
  summary: '目标用户描述需要对齐', authoritativeReference: 'smart_questions/smart_questions.json',
  correction: '按已有权威事实核对目标用户', affectedFacets: ['smart_questions'] }] }
const callFor = f => (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
const save = f => f.server.project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'foreground-evidence' })
const off = { mode: 'off', autoMergeWindowMs: 45000, continuousIntervalMs: 120000 }

for (const host of ['codex', 'qwenwork', 'workbuddy']) test(`${host}: explicit main GRA works while off without claiming background readiness`, async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host, browserAccess: 'local' } }), call = callFor(f)
  try {
    await save(f)
    const before = await call('readReviewPolicy')
    if (host !== 'codex') {
      await assert.rejects(call('recheckReviews', { requestId: 'not-foreground' }), /background|native agents/)
      assert.deepEqual(await call('readReviewPolicy'), before, 'unavailable background never silently changes policy')
      assert.equal((await call('readWorkspace')).reviews.some(row => row.reviewId), false)
    }
    await call('updateReviewPolicy', { policy: off })
    const params = { requestId: 'human-foreground', executionMode: 'foreground', userContext: '用户明确选择本次占用主对话评审' }
    const batch = await call('recheckReviews', params)
    assert.deepEqual(batch.requests.map(row => row.profile), ['grounding', 'reflection', 'alignment'])
    assert.ok(batch.requests.every(row => row.created && row.dispatch && row.executionMode === 'foreground'))
    assert.equal(batch.executionMode, 'foreground')
    for (const ref of batch.requests) {
      const request = await call('readReview', { reviewId: ref.reviewId })
      assert.equal(request.host, host)
      assert.equal(request.threadId, threadId)
      assert.equal(request.nativeRun, undefined)
      assert.equal(request.revisionChanged, false)
      assert.match(request.prompt, /omitting nativeRun/)
      assert.match(request.prompt, /Read only Design Files committed at/)
      assert.doesNotMatch(request.prompt, /Run as a native background reviewer|Read the supplied immutable Design Files snapshot/)
      if (ref.profile === 'grounding') {
        const pins = { project: f.server.project.project.metadata.id, checkpoint: request.revision.checkpoint }
        const path = 'design_files/smart_questions/smart_questions.json'
        const listed = await call('readGit', { ...pins, action: 'list', path: 'design_files' })
        assert.ok(listed.entries.some(entry => entry.path === path))
        const evidence = await call('readGit', { ...pins, action: 'read', path })
        assert.equal(evidence.project, pins.project)
        assert.equal(evidence.checkpoint, pins.checkpoint)
        assert.equal(evidence.page.complete, true)
        assert.deepEqual(JSON.parse(evidence.text), { questions: {} })
      }
      const result = await call('submitReview', { reviewId: ref.reviewId, result: empty[ref.profile] })
      assert.equal(result.status, 'completed')
      assert.deepEqual(await call('submitReview', { reviewId: ref.reviewId, result: empty[ref.profile] }), result)
    }
    const replay = await call('recheckReviews', params)
    assert.deepEqual(replay.requests.map(row => row.reviewId), batch.requests.map(row => row.reviewId))
    assert.ok(replay.requests.every(row => !row.created && !row.dispatch))
    const status = await call('readWorkspace')
    const foregroundRows = status.reviews.filter(row => row.executionMode === 'foreground')
    assert.equal(foregroundRows.length, 3, 'main results remain visible even when native Agents are unavailable')
    assert.ok(foregroundRows.every(row => row.status === 'completed' && !row.needsReview))
    assert.equal(status.clarity.assessment, null, 'GRA does not fabricate the separate main U/S/T report')
    assert.equal(status.hostCapabilities.backgroundReviews, host === 'codex')
    assert.equal(status.hostCapabilities.foregroundReviews, true)
    assert.deepEqual(await call('readReviewPolicy'), off)
    assert.equal(f.messages.length, 0, 'review preparation/submission never sends a foreground notification')
    // A browser's existing UI authority never admits native review methods.
    for (const method of ['recheckReviews', 'readReview', 'submitReview']) {
      const response = await fetch(`${f.server.url}api`, { method: 'POST', headers: {
        Origin: f.server.origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1',
      }, body: JSON.stringify({ method, params: { ...params, reviewId: batch.requests[0].reviewId, result: empty.grounding } }) })
      assert.equal(response.status, 403)
    }
  } finally { await f.close() }
})

test('foreground cannot relabel background, change a stable request mode, bind a child or accept malformed result types', async () => {
  const f = await fixture(), call = callFor(f)
  try {
    await save(f)
    const background = await call('recheckReviews', { requestId: 'background-request', profiles: ['alignment'] })
    await assert.rejects(call('submitReview', { reviewId: background.requests[0].reviewId, executionMode: 'foreground', result: empty.alignment }), /native|run|identity/i)
    await assert.rejects(call('recheckReviews', { requestId: 'background-request', profiles: ['alignment'], executionMode: 'foreground' }), /cannot change execution mode/)
    const params = { requestId: 'main-request', profiles: ['alignment'], executionMode: 'foreground' }
    const { reviewId } = (await call('recheckReviews', params)).requests[0]
    await assert.rejects(call('recheckReviews', { ...params, executionMode: 'background' }), /cannot change execution mode/)
    await assert.rejects(call('recheckReviews', { ...params, executionMode: 'silent-fallback' }), /execution mode/)
    await assert.rejects(call('recheckReviews', { ...params, profiles: ['clarity'] }), /profiles/)
    const nativeRun = { runId: '00000000-0000-4000-8000-000000000002', parentRunId: threadId, transcriptPath: join(f.root, 'child.jsonl') }
    const api = createCompanionReviews({ project: f.server.project, stateRoot: f.options.stateRoot, threadId })
    await assert.rejects(api.bindReviewRun({ reviewId, nativeRun }), /without a child binding/)
    await assert.rejects(call('submitReview', { reviewId, nativeRun, result: empty.alignment }), /must omit nativeRun/)
    await assert.rejects(call('submitReview', { reviewId, result: { schemaVersion: '1', questions: [] } }), /schemaVersion/)
    await assert.rejects(call('submitReview', { reviewId, result: { schemaVersion: 1, questions: { item: [] } } }), /\$\.questions/)
    assert.equal((await call('readReview', { reviewId })).status, 'prepared')
    assert.equal((await call('submitReview', { reviewId, result: empty.alignment })).status, 'completed')
    await assert.rejects(call('submitReview', { reviewId, result: { schemaVersion: 1, questions: [{ id: 'new', facets: ['smart_questions'], decision: 'x', question: 'x', rationale: 'x', impact: 'x' }] } }), /different result/)
  } finally { await f.close() }
})

test('foreground stale evidence is retained, not promoted, and a stable request cannot silently retarget', async () => {
  const f = await fixture(), call = callFor(f)
  try {
    await save(f)
    const params = { requestId: 'pinned-main', executionMode: 'foreground', profiles: ['grounding'] }
    const { reviewId } = (await call('recheckReviews', params)).requests[0]
    await f.server.project.savePanel({ skill: 'smart_questions', eventId: 'changed-evidence', state: { questions: {
      goal: { prompt: '目标?', kind: 'text', answer: '新的产品目标', detail: '' },
    } } })
    assert.equal((await call('submitReview', { reviewId, result: grounding })).status, 'stale')
    assert.deepEqual((await call('readReview', { reviewId })).historicalResult, grounding)
    assert.deepEqual(await call('listAdvisories'), [])
    await assert.rejects(call('recheckReviews', params), /cannot change target/)
  } finally { await f.close() }
})

test('managed service foreground requests remain main-owned, immutable in mode and isolated from another main thread', async () => {
  let executions = 0
  const f = await fixture({ serverOptions: { backgroundReviews: true, reviewExecutor: async () => { executions++; return { result: empty.alignment } } } }), call = callFor(f)
  try {
    await call('updateReviewPolicy', { policy: off })
    await save(f)
    const params = { requestId: 'managed-main', executionMode: 'foreground', profiles: ['alignment'] }
    const { reviewId } = (await call('recheckReviews', params)).requests[0]
    const foreign = createCompanionReviews({ project: f.server.project, stateRoot: f.options.stateRoot,
      threadId: '00000000-0000-4000-8000-000000000088', managedExecution: true })
    await assert.rejects(foreign.readReview({ reviewId }), /exact main conversation/)
    await assert.rejects(foreign.submitReview({ reviewId, result: empty.alignment }), /exact main conversation/)
    await assert.rejects(foreign.prepareManualReviews(params), /exact main conversation/)
    assert.equal((await call('readReview', { reviewId })).revisionChanged, false)
    assert.equal((await call('submitReview', { reviewId, result: empty.alignment })).status, 'completed')
    assert.equal(executions, 0, 'explicit main mode never invokes the managed executor')
    const registry = JSON.parse(await readFile(join(f.options.stateRoot, f.server.project.project.metadata.id, 'reviews-managed.json'), 'utf8'))
    assert.equal(registry.requests[reviewId].execution, undefined)
    assert.deepEqual(await call('readReviewPolicy'), off)
  } finally { await f.close() }
})

for (const host of ['qwenwork', 'workbuddy']) test(`${host}: accepted foreground advice can use the existing main Bundle without background readiness`, async () => {
  const f = await fixture({ withTranscript: true, smartQuestionsMode: 'main', researchMode: 'main', serverOptions: { host } }), call = callFor(f)
  try {
    await call('updateReviewPolicy', { policy: off })
    await save(f)
    const { reviewId } = (await call('recheckReviews', { requestId: 'action-main', executionMode: 'foreground', profiles: ['grounding'] })).requests[0]
    const submitted = await call('submitReview', { reviewId, result: grounding })
    assert.equal(submitted.status, 'completed')
    assert.equal(f.messages.length, 0, 'advice alone never executes or notifies')
    const accepted = await call('decideAdvisory', { advisoryId: submitted.advisoryId, decision: 'accepted' })
    assert.equal(f.messages.length, 1)
    const receiptId = accepted.actionReceipts[0].receiptId
    assert.equal(accepted.actionReceipts[0].state, 'ready')
    const wrong = await call('beginMainBundle', { skill: 'research' })
    await assert.rejects(call('claimReviewAction', { invocationId: wrong.invocationId, receiptId }), /exact advisory target/)
    await call('finishMainBundle', { invocationId: wrong.invocationId, outcome: 'cancelled' })
    const main = await call('beginMainBundle', { skill: 'smart_questions' })
    await assert.rejects(call('claimReviewAction', { invocationId: main.invocationId, receiptId: accepted.acceptanceReceiptId }), /Unknown action receipt/)
    const claim = await call('claimReviewAction', { invocationId: main.invocationId, receiptId })
    assert.equal(claim.claimed, true)
    await assert.rejects(call('settleReviewAction', { invocationId: main.invocationId, receiptId }), /Settle the Bundle/)
    await call('finishMainBundle', { invocationId: main.invocationId, scope: 'state', outcome: 'pause' })
    assert.equal((await call('settleReviewAction', { invocationId: main.invocationId, receiptId })).state, 'needs-user-input')
    assert.equal((await call('readWorkspace')).hostCapabilities.backgroundReviews, false)
    assert.deepEqual(await call('readReviewPolicy'), off)
    assert.equal(f.messages.length, 1)
  } finally { await f.close() }
})

test('source MCP exposes existing policy and explicit foreground mode with typed submission and server-side background proof', async () => {
  const f = await fixture(), server = createDesignMcp(), client = new Client({ name: 'foreground-source', version: '1' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  const call = (name, args = {}) => client.callTool({ name, arguments: { connection: f.server.connectionPath, ...args } })
  const value = response => { assert.ok(!response.isError, JSON.stringify(response)); return JSON.parse(response.content[0].text) }
  try {
    await Promise.all([client.connect(ct), server.connect(st)])
    const { tools } = await client.listTools()
    const read = tools.find(tool => tool.name === 'design_read_review_policy'), update = tools.find(tool => tool.name === 'design_update_review_policy')
    assert.equal(read.annotations.readOnlyHint, true)
    assert.notEqual(update.annotations.readOnlyHint, true)
    assert.equal(update.inputSchema.properties.policy.additionalProperties, false)
    assert.deepEqual(tools.find(tool => tool.name === 'design_recheck_reviews').inputSchema.properties.executionMode.enum, ['background', 'foreground'])
    assert.ok(!tools.find(tool => tool.name === 'design_submit_review').inputSchema.required.includes('nativeRun'))
    assert.equal(value(await call(read.name)).mode, 'auto')
    assert.deepEqual(value(await call(update.name, { policy: off })), off)
    await save(f)
    const background = value(await call('design_recheck_reviews', { requestId: 'mcp-background', profiles: ['alignment'] }))
    assert.equal((await call('design_submit_review', { reviewId: background.requests[0].reviewId, result: empty.alignment })).isError, true)
    const foreground = value(await call('design_recheck_reviews', { requestId: 'mcp-main', profiles: ['alignment'], executionMode: 'foreground' }))
    const reviewId = foreground.requests[0].reviewId
    assert.equal((await call('design_submit_review', { reviewId, result: { schemaVersion: '1', questions: [] } })).isError, true)
    assert.equal((await call('design_submit_review', { reviewId, result: { schemaVersion: 1, questions: { item: [] } } })).isError, true)
    assert.equal(value(await call('design_submit_review', { reviewId, result: empty.alignment })).status, 'completed')
    assert.deepEqual(value(await call(read.name)), off)
  } finally { await client.close(); await server.close(); await f.close() }
})

test('unready QwenWork can revalidate an accepted choice and select its existing main Bundle', async () => {
  const f = await fixture({ withTranscript: true, smartQuestionsMode: 'main', serverOptions: { host: 'qwenwork' } }), call = callFor(f)
  try {
    await save(f)
    const { reviewId } = (await call('recheckReviews', { requestId: 'choice-main', executionMode: 'foreground', profiles: ['alignment'] })).requests[0]
    const result = { schemaVersion: 1, questions: [{ id: 'audience', facets: ['smart_questions'], decision: '首版用户',
      question: '本轮面向哪一类用户？', rationale: '现有事实无法确认首版范围', impact: '影响首版入口与功能范围' }] }
    const submitted = await call('submitReview', { reviewId, result })
    const accepted = await call('decideAdvisory', { advisoryId: submitted.advisoryId, decision: 'accepted' })
    assert.deepEqual(accepted.actionReceipts, [], 'accepting a choice alone grants no Bundle execution')
    const options = await call('readReviewAction', { advisoryId: submitted.advisoryId })
    const selection = { advisoryId: submitted.advisoryId, acceptanceReceiptId: accepted.acceptanceReceiptId,
      revision: options.revision, currency: options.currency, reason: '本次用户已接受且问题仍影响当前结果', kind: 'bundle' }
    await assert.rejects(call('selectReviewAction', { ...selection, skillName: 'foreign' }), /unavailable/)
    const selected = await call('selectReviewAction', { ...selection, skillName: 'smart_questions' })
    assert.equal(selected.actionReceipts.length, 1)
    const receiptId = selected.actionReceipts[0].receiptId
    const main = await call('beginMainBundle', { skill: 'smart_questions' })
    assert.equal((await call('claimReviewAction', { invocationId: main.invocationId, receiptId })).claimed, true)
    await call('finishMainBundle', { invocationId: main.invocationId, scope: 'state', outcome: 'pause' })
    assert.equal((await call('settleReviewAction', { invocationId: main.invocationId, receiptId })).state, 'needs-user-input')
    assert.equal(f.messages.length, 1)
    assert.equal((await call('readWorkspace')).hostCapabilities.backgroundReviews, false)
  } finally { await f.close() }
})

test('WorkBuddy foreground advice never silently runs an isolated Bundle in main when native Producers are unavailable', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'workbuddy' } }), call = callFor(f)
  try {
    await save(f)
    const { reviewId } = (await call('recheckReviews', { requestId: 'no-producer', executionMode: 'foreground', profiles: ['grounding'] })).requests[0]
    const submitted = await call('submitReview', { reviewId, result: grounding })
    await assert.rejects(call('decideAdvisory', { advisoryId: submitted.advisoryId, decision: 'accepted' }), /execution is unsupported; no acceptance recorded/)
    await assert.rejects(call('beginMainBundle', { skill: 'smart_questions' }), /native Producer/)
    assert.equal((await call('listAdvisories')).find(entry => entry.advisory.id === submitted.advisoryId).status, 'pending')
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})
