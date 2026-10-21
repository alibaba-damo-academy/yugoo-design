import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createNativeRuns } from '../src/native-runs.mjs'
import { nativeScope } from '../src/native-identity.mjs'

const exec = promisify(execFile)
const state = { questions: { goal: { prompt: 'Goal?', kind: 'text', answer: 'An isolated test', detail: '' } } }
function sameSettlement(actual, expected) {
  // Background knowledge/review projections may advance between HTTP replies.
  assert.equal(actual.accepted, expected.accepted)
  assert.deepEqual(actual.settlement, expected.settlement)
}
async function writeQuestions(f) {
  const root = join(f.options.projectRoot, 'design_files/smart_questions')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'smart_questions.json'), JSON.stringify(state, null, 2) + '\n')
}

test('HTTP main finish accepts a committed publication despite an external index lock', async () => {
  const f = await fixture({ smartQuestionsMode: 'main' })
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await exec('git', ['config', '--local', 'core.autocrlf', 'true'], { cwd: f.options.projectRoot })
    const invocation = await call('beginMainBundle', { skill: 'smart_questions' })
    await writeQuestions(f)
    const lockPath = join(f.options.projectRoot, '.git/index.lock')
    await writeFile(lockPath, 'external-index-owner\n')
    const input = { invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' }
    const result = await call('finishMainBundle', input)
    assert.equal(result.accepted, true)
    assert.equal(result.settlement.indexMaintenance.state, 'deferred')
    assert.equal(await f.server.project.store.head(), result.settlement.commit)
    sameSettlement(await call('finishMainBundle', input), result)
    assert.equal(await readFile(lockPath, 'utf8'), 'external-index-owner\n')
    assert.equal((await call('readWorkspace', {})).activeMainBundles.length, 0)
  } finally { await f.close() }
})

test('HTTP finish exposes a post-commit recovery receipt and one exact retry repairs it', async () => {
  const f = await fixture({ smartQuestionsMode: 'main' })
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const invocation = await call('beginMainBundle', { skill: 'smart_questions' })
    await writeQuestions(f)
    const store = f.server.project.store, original = store.write.bind(store)
    let fail = true
    store.write = (skill, value, options) => original(skill, value, { ...options,
      settleEvent: event => { if (fail) throw new Error('injected Journal outage'); return options.settleEvent(event) } })
    const input = { invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' }
    const failed = await call('finishMainBundle', input)
    assert.equal(failed.accepted, false)
    assert.equal(failed.committed, true)
    assert.equal(failed.recovery.stage, 'journal')
    assert.equal(failed.recovery.action, 'retry-same-finish-once')
    assert.match(failed.recovery.instruction, /do not rewrite files/)
    assert.equal((await call('readWorkspace', {})).activeMainBundles.length, 1)
    assert.equal(await store.head(), failed.settlement.commit)
    fail = false
    const repaired = await call('finishMainBundle', input)
    assert.equal(repaired.accepted, true)
    assert.equal(repaired.settlement.commit, failed.settlement.commit)
    assert.equal((await call('readWorkspace', {})).activeMainBundles.length, 0)
    sameSettlement(await call('finishMainBundle', input), repaired)
  } finally { await f.close() }
})

test('a binding persistence failure reports committed content and repairs on exact retry', async () => {
  const f = await fixture({ smartQuestionsMode: 'main' })
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const invocation = await call('beginMainBundle', { skill: 'smart_questions' })
    await writeQuestions(f)
    const path = join(f.options.stateRoot, f.server.project.project.metadata.id, 'native-bindings', nativeScope('codex', threadId), 'main-invocations.json')
    const activeBytes = await readFile(path)
    await rm(path); await mkdir(path)
    const input = { invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' }
    const failed = await call('finishMainBundle', input)
    assert.equal(failed.accepted, false)
    assert.equal(failed.committed, true)
    assert.equal(failed.recovery.stage, 'host-binding')
    assert.equal(await f.server.project.store.head(), failed.settlement.commit)
    await rm(path, { recursive: true }); await writeFile(path, activeBytes)
    const repaired = await call('finishMainBundle', input)
    assert.equal(repaired.accepted, true)
    assert.equal(repaired.settlement.commit, failed.settlement.commit)
    assert.equal((await call('readWorkspace', {})).activeMainBundles.length, 0)
  } finally { await f.close() }
})

test('native Producer retry and reopening return the original settlement without new commits', async () => {
  const f = await fixture()
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  const producer = '00000000-0000-4000-8000-000000000002'
  try {
    const transcriptPath = join(f.root, 'producer.jsonl')
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: producer, cwd: f.options.projectRoot,
      source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n'
      + JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n')
    await call('registerNativeRun', { runId: producer, parentRunId: threadId, transcriptPath, role: 'producer', skill: 'smart_questions', artifactId: 'intake' })
    await writeQuestions(f)
    const input = { runId: producer, scope: 'state', outcome: 'pause' }
    const result = await call('finishNativeRun', input)
    assert.equal(result.accepted, true)
    sameSettlement(await call('finishNativeRun', input), result)
    const reopened = await createNativeRuns({ project: f.server.project, stateRoot: f.options.stateRoot, threadId })
    const replay = await reopened.finishNativeRun(input)
    assert.equal(replay.accepted, true)
    assert.deepEqual(replay.settlement, result.settlement)
    assert.equal(await f.server.project.store.head(), result.settlement.commit)
    await assert.rejects(reopened.finishNativeRun({ runId: producer, scope: 'completion', outcome: 'complete' }), /another outcome/)
  } finally { await f.close() }
})
