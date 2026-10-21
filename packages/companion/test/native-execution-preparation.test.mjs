import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

test('empty WorkBuddy project prepares complete mapping, repairs canonical state and publishes through the existing finish', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host: 'workbuddy', workbuddyProducer: true,
    statusEntryPath: '/installed runtime/scripts/design.mjs' } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const runId = 'agent-fixture-producer'
  try {
    const prepared = await call('prepareBundle', { skill: 'function_modules' })
    const original = f.server.project.kit.skills.find(skill => skill.name === 'function_modules').content
    assert.ok(prepared.method.startsWith(prepared.executionContract.instructions))
    assert.ok(prepared.method.endsWith(original), 'full domain method is preserved verbatim')
    assert.equal(prepared.executionContract.host, 'workbuddy')
    assert.equal(prepared.executionContract.finishTool, 'design_finish_run')
    assert.deepEqual(prepared.executionContract.validation.argv, ['/installed runtime/scripts/design.mjs', 'validate',
      '--project', f.options.projectRoot, '--kit', f.options.kitRoot, '--state-root', f.options.stateRoot,
      '--skill', 'function_modules', '--scope', 'completion'])
    const main = await call('prepareBundle', { skill: 'research' })
    assert.equal(main.execution.mode, 'subagent')
    const parent = { type: 'function_call', name: 'Agent', callId: 'bootstrap', sessionId: threadId, cwd: f.options.projectRoot, arguments: '{}' }
    const parentResult = { type: 'function_call_result', name: 'Agent', callId: 'bootstrap', sessionId: threadId, cwd: f.options.projectRoot,
      status: 'completed', providerData: { toolResult: { subAgent: { sessionId: runId, lastId: 'ready' } } } }
    const child = { type: 'message', id: 'ready', role: 'assistant', status: 'completed', sessionId: 'native-child-session', cwd: f.options.projectRoot,
      content: [{ type: 'output_text', text: 'READY' }] }
    const childDirectory = join(f.root, threadId, 'subagents')
    await mkdir(childDirectory, { recursive: true })
    await writeFile(join(childDirectory, `${runId}.jsonl`), JSON.stringify(child) + '\n')
    await writeFile(f.options.transcriptPath, [parent, parentResult].map(JSON.stringify).join('\n') + '\n')
    assert.equal((await call('registerNativeRun', { runId, parentRunId: threadId, role: 'producer', skill: 'function_modules', artifactId: 'function_modules' })).registered, true)
    await assert.rejects(call('finishNativeRun', { runId }), /Canonical Design JSON is missing/)
    await mkdir(prepared.executionContract.directory, { recursive: true })
    await writeFile(prepared.executionContract.canonicalFile, '{"functions":{"F-001":{"function_id":"F-001"}}}')
    await assert.rejects(call('finishNativeRun', { runId }), /function_name|required|function_description/i)
    const state = { functions: { 'F-001': { function_id: 'F-001', function_name: 'Create task', function_description: 'A member creates a board task.',
      function_epic: 'Tasks', priority: 'Medium', rejected: false, source: 'ai' } } }
    await writeFile(prepared.executionContract.canonicalFile, JSON.stringify(state))
    const receipt = await call('finishNativeRun', { runId, scope: 'completion', outcome: 'complete' })
    assert.equal(receipt.accepted, true)
    assert.match(receipt.settlement.commit, /^[a-f0-9]{40}$/)
    assert.deepEqual(JSON.parse(await readFile(prepared.executionContract.canonicalFile, 'utf8')), state)
    assert.equal(f.messages.length, 0, 'generation and finish do not fabricate a Panel save or user notice')
  } finally { await f.close() }
})

test('main placement gets its own publication identity and cannot be silently replaced by a Producer', async () => {
  const f = await fixture({ smartQuestionsMode: 'main' })
  try {
    const prepared = await callCompanion(f.server.connectionPath, { method: 'prepareBundle', params: { skill: 'smart_questions' } })
    assert.equal(prepared.execution.mode, 'main')
    assert.equal(prepared.executionContract.finishTool, 'design_finish_main_bundle')
    assert.match(prepared.method, /invocationId returned by design_begin_main_bundle/)
    assert.match(prepared.method, /does not replace domain reasoning, schema, validation, ownership, permissions or handoff/)
  } finally { await f.close() }
})
