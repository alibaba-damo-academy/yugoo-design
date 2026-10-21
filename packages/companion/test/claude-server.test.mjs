import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { nativeScope, nativeInvocationId } from '../src/native-identity.mjs'

test('Claude bridge reuses publication, nested workers and independent native reviews', async () => {
  const f = await fixture()
  let server
  try {
    const folder = join(f.root, 'native', threadId, 'subagents')
    await mkdir(folder, { recursive: true })
    const main = join(f.root, 'native', `${threadId}.jsonl`)
    let seq = 0
    const leaves = new Map()
    const emit = async (agentId, content, stop) => {
      const uuid = `e-${++seq}`, key = agentId ?? 'main'
      const event = { uuid, parentUuid: leaves.get(key) ?? null, type: 'assistant', sessionId: threadId,
        ...(agentId ? { agentId } : {}), cwd: f.options.projectRoot, timestamp: new Date().toISOString(),
        message: { content, stop_reason: stop ?? null } }
      leaves.set(key, uuid)
      await appendFile(agentId ? join(folder, `agent-${agentId}.jsonl`) : main, JSON.stringify(event) + '\n')
    }
    await emit(undefined, [{ type: 'text', text: 'Claude main' }])
    const options = { ...f.options, host: 'claude-code', transcriptPath: main,
      connection: { host: 'claude-code', threadId, send: async () => ({ accepted: true, status: 'hook_received' }) } }
    await assert.rejects(startCompanion({ ...options, backgroundReviews: true }), /Codex only/)
    server = await startCompanion(options)
    const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
    const child = async (runId, parentRunId = threadId) => {
      await emit(parentRunId === threadId ? undefined : parentRunId, [{ type: 'tool_use', id: `call-${runId}`, name: 'Agent', input: {} }])
      await writeFile(join(folder, `agent-${runId}.meta.json`), JSON.stringify({ toolUseId: `call-${runId}`, agentType: 'general-purpose' }))
      await emit(runId, [{ type: 'text', text: `${runId} progress` }])
      return { runId, parentRunId, transcriptPath: join(folder, `agent-${runId}.jsonl`) }
    }
    assert.equal((await call('info')).host, 'claude-code')
    assert.equal((await call('readWorkspace')).conversation.available, true)
    const producer = await child('producer')
    await call('registerNativeRun', { runId: producer.runId, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
    const worker = await child('worker', producer.runId)
    await call('registerNativeRun', { runId: worker.runId, parentRunId: producer.runId, role: 'worker', skill: 'smart_questions', artifactId: 'sample', artifactFile: 'smart_questions/sample.md' })
    assert.match(JSON.stringify(await call('readExecutionLog', { runId: worker.runId })), /worker progress/)
    await emit(worker.runId, [{ type: 'text', text: 'done' }], 'end_turn')
    assert.ok((await call('savePanel', { skill: 'smart_questions', state: { questions: {} }, eventId: 'claude-save' })).commit)
    assert.equal((await call('sendPrompt', { text: 'continue' })).status, 'hook_received')
    await emit(producer.runId, [{ type: 'text', text: 'done' }], 'end_turn')
    assert.equal((await call('finishNativeRun', { runId: producer.runId, scope: 'state', outcome: 'pause' })).accepted, true)
    const review = await call('prepareReview', { profile: 'alignment', userContext: 'Keep user scope' })
    const reviewer = await child('reviewer')
    const bound = await call('bindReviewRun', { reviewId: review.reviewId, nativeRun: { runId: reviewer.runId } })
    assert.deepEqual(bound.nativeRun, reviewer)
    await emit(reviewer.runId, [{ type: 'text', text: 'done' }], 'end_turn')
    assert.equal((await call('readWorkspace')).reviews.find(x => x.profile === 'alignment').status, 'unsubmitted')
    assert.equal((await call('submitReview', { reviewId: review.reviewId, nativeRun: reviewer, result: { schemaVersion: 1, questions: [] } })).status, 'completed')
    assert.notEqual(nativeScope('claude-code', threadId), nativeScope('qoder', threadId))
    assert.notEqual(nativeInvocationId('claude-code', threadId, 'producer'), nativeInvocationId('qoder', threadId, 'producer'))
  } finally { await server?.close(); await f.close() }
})
