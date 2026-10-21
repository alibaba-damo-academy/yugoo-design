import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, appendFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { qwenWorkBackgroundProtocol, readQwenWorkBackgroundReadiness, verifyQwenWorkBackgroundChild, createQwenWorkBackgroundTranscript } from '../src/qwenwork-background.mjs'
import { createNativeBackgroundAdapter } from '../src/native-background-adapter.mjs'

const sessionId = '00000000-0000-4000-8000-000000000001'
const foreignSession = '00000000-0000-4000-8000-000000000002'
const since = 1700000000000
async function fixture(t, { topLevel = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qwen-background-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const mainTranscriptPath = join(root, `${sessionId}.jsonl`), folder = join(root, sessionId, 'subagents')
  await mkdir(folder, { recursive: true })
  const runId = 'agent-native-1', taskId = 'native-task-1', taskPath = join(folder, `task-${taskId}.json`)
  const transcriptPath = join(folder, `agent-${runId}.jsonl`), outputPath = join(root, `${taskId}.output`)
  const event = (uuid, parentUuid, type, content, extra = {}) => ({ uuid, parentUuid, type, sessionId, cwd: root,
    timestamp: new Date(since + 100).toISOString(), message: { content }, ...extra })
  const receipt = { isAsync: true, status: 'async_launched', agentId: runId, prompt: 'Return READY',
    description: 'Native background test', resolvedModel: 'native-inherited', outputFile: outputPath, canReadOutputFile: true }
  const rows = [event('human', null, 'user', 'Verify background'),
    event('dispatch', 'human', 'assistant', [{ type: 'tool_use', id: 'call-1', name: 'Agent', input: { run_in_background: true, prompt: receipt.prompt } }]),
    event('receipt', 'dispatch', 'user', [{ type: 'tool_result', tool_use_id: 'call-1', ...(topLevel ? {} : { toolUseResult: receipt }) }], topLevel ? { toolUseResult: receipt } : {})]
  const task = { taskId, sessionId, executionId: 42, agentId: runId, parentToolUseId: 'call-1', transcriptPath,
    outputPath, completionBehavior: 'notify', status: 'completed', createdAt: since + 50, updatedAt: since + 200 }
  const child = [event('child-human', null, 'user', 'Return READY', { agentId: runId }),
    event('child-answer', 'child-human', 'assistant', 'READY', { agentId: runId, message: { content: 'READY', stop_reason: 'end_turn' } })]
  await Promise.all([writeFile(mainTranscriptPath, rows.map(JSON.stringify).join('\n') + '\n'),
    writeFile(taskPath, JSON.stringify(task)), writeFile(transcriptPath, child.map(JSON.stringify).join('\n') + '\n'), writeFile(outputPath, 'READY')])
  const options = { sessionId, mainTranscriptPath, projectRoot: root, readinessSince: since,
    runId, parentRunId: sessionId, taskPath, transcriptPath }
  const saveMain = () => writeFile(mainTranscriptPath, rows.map(JSON.stringify).join('\n') + '\n')
  const saveTask = () => writeFile(taskPath, JSON.stringify(task))
  return { root, folder, options, task, receipt, rows, saveMain, saveTask, event }
}

test('Qwen protocol is cooperative, read-only and does not promise WorkBuddy receipt tools', () => {
  const protocol = qwenWorkBackgroundProtocol()
  assert.equal(protocol.mode, 'cooperative-background')
  assert.equal(protocol.bootstrap.run_in_background, true)
  assert.match(protocol.installedContract, /installation selected by runtime pins/)
  assert.match(protocol.installedContract, /not a stable public API/)
  assert.match(protocol.completion, /Do not assume WorkBuddy TaskOutput/)
  assert.equal(qwenWorkBackgroundProtocol({ state: 'ready' }).bootstrap, undefined)
  assert.equal(qwenWorkBackgroundProtocol({ state: 'unverified', canAttemptReadiness: false }).canAttemptReadiness, false)
})

for (const topLevel of [false, true]) test(`current native async receipt and exact task prove readiness (${topLevel ? 'event' : 'block'} receipt)`, async t => {
  const f = await fixture(t, { topLevel })
  const result = await readQwenWorkBackgroundReadiness(f.options)
  assert.equal(result.state, 'ready', result.reason)
  assert.equal(result.proof.taskId, f.task.taskId)
  assert.equal(result.proof.agentId, f.task.agentId)
  assert.equal((await verifyQwenWorkBackgroundChild(f.options)).recordedStatus, 'completed')
  assert.equal((await createQwenWorkBackgroundTranscript(f.options).read()).available, true)
})

test('synchronous fallback and later synchronous resume cannot reuse an earlier async proof', async t => {
  const f = await fixture(t)
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'ready')
  const more = [f.event('resume', 'receipt', 'assistant', [{ type: 'tool_use', id: 'call-2', name: 'Agent', input: { run_in_background: true, resume: f.options.runId } }]),
    f.event('sync', 'resume', 'user', [{ type: 'tool_result', tool_use_id: 'call-2', content: 'READY; Agent ID: agent-native-1' }])]
  await appendFile(f.options.mainTranscriptPath, more.map(JSON.stringify).join('\n') + '\n')
  const readiness = await readQwenWorkBackgroundReadiness(f.options)
  assert.equal(readiness.state, 'unverified')
  assert.equal(qwenWorkBackgroundProtocol(readiness).bootstrap, undefined, 'reuse the failed request instead of probing again')
  await assert.rejects(verifyQwenWorkBackgroundChild(f.options), /asynchronous launch receipt/)
  assert.equal((await createQwenWorkBackgroundTranscript(f.options).read()).recordedStatus, 'unknown')
})

test('a different current project or main native session is not background proof', async t => {
  const f = await fixture(t)
  assert.equal((await readQwenWorkBackgroundReadiness({ ...f.options, projectRoot: f.folder })).state, 'unverified')
  f.rows[0].sessionId = foreignSession
  await f.saveMain()
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'unverified')
})

test('an async receipt outside the selected native parent chain is ignored', async t => {
  const f = await fixture(t)
  f.rows.push(f.event('other-branch', 'human', 'assistant', 'Another branch'))
  await f.saveMain()
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'unverified')
})

for (const [label, mutate] of [
  ['old service', f => { f.options.readinessSince = since + 1000 }],
  ['old descriptor', f => { f.task.createdAt = since - 1 }],
  ['wrong parent call', f => { f.task.parentToolUseId = 'other-call' }],
  ['wrong task identity', f => { f.task.taskId = 'other-task' }],
  ['wrong native session', f => { f.task.sessionId = foreignSession }],
  ['wrong agent', f => { f.task.agentId = 'other-agent' }],
  ['unknown task status', f => { f.task.status = 'mystery' }],
  ['missing execution identity', f => { delete f.task.executionId }],
  ['non-background receipt', f => { f.receipt.isAsync = false }],
  ['foreground Agent input', f => { f.rows[1].message.content[0].input.run_in_background = false }],
  ['text-only async claim', f => { f.rows[2].message.content[0].toolUseResult = 'isAsync=true; async_launched' }],
]) test(`readiness and each reviewer reject ${label}`, async t => {
  const f = await fixture(t); mutate(f)
  await f.saveMain(); await f.saveTask()
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'unverified')
  await assert.rejects(verifyQwenWorkBackgroundChild(f.options))
})

test('corrupt descriptor and symlinked metadata fail closed without modifying native files', async t => {
  const f = await fixture(t)
  const mainBefore = await readFile(f.options.mainTranscriptPath, 'utf8')
  await writeFile(f.options.taskPath, '{broken')
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'unverified')
  await assert.rejects(verifyQwenWorkBackgroundChild(f.options))
  const outside = join(f.root, 'outside.json')
  await writeFile(outside, JSON.stringify(f.task)); await rm(f.options.taskPath); await symlink(outside, f.options.taskPath)
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'unverified')
  assert.equal(await readFile(f.options.mainTranscriptPath, 'utf8'), mainBefore)
})

test('each review binding independently rejects paths and parent identity outside its native launch', async t => {
  const f = await fixture(t)
  await assert.rejects(verifyQwenWorkBackgroundChild({ ...f.options, parentRunId: 'another-agent' }), /bound main session/)
  await assert.rejects(verifyQwenWorkBackgroundChild({ ...f.options, taskPath: join(f.root, 'other-task.json') }))
  const foreign = join(f.root, 'foreign.jsonl'); await writeFile(foreign, '')
  await assert.rejects(verifyQwenWorkBackgroundChild({ ...f.options, transcriptPath: foreign }), /paths/)
  f.task.transcriptPath = foreign; await f.saveTask()
  assert.equal((await readQwenWorkBackgroundReadiness(f.options)).state, 'unverified')
})

test('native descriptor owns terminal status; a completed spawn never manufactures review completion', async t => {
  const f = await fixture(t)
  for (const [native, expected] of [['running', 'running'], ['failed', 'failed'], ['cancelled', 'interrupted']]) {
    f.task.status = native; await f.saveTask()
    const log = await createQwenWorkBackgroundTranscript(f.options).read()
    assert.equal(log.recordedStatus, expected)
  }
  f.task.status = 'unknown'; await f.saveTask()
  assert.equal((await createQwenWorkBackgroundTranscript(f.options).read()).available, false)
})

test('new Reviewer binding requires its exact review assignment even at the same launch timestamp', async t => {
  const f = await fixture(t), reviewId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await assert.rejects(verifyQwenWorkBackgroundChild({ ...f.options, reviewId }), /exact review ID/,
    'READY and time freshness alone are not a review assignment')
  f.rows[1].message.content[0].input.prompt = `Read request ${reviewId} and submit its result.`
  await f.saveMain()
  assert.equal((await verifyQwenWorkBackgroundChild({ ...f.options, reviewId })).recordedStatus, 'completed')
  await assert.rejects(verifyQwenWorkBackgroundChild({ ...f.options, reviewId: foreignSession }), /exact review ID/)
  const reopened = createNativeBackgroundAdapter({ ...f.options, host: 'qwenwork', readinessSince: since + 1000 })
  await assert.rejects(reopened.verifyNewChild(f.options, { reviewId, notBefore: since + 1000 }), /asynchronous launch receipt/)
  assert.equal((await reopened.verifyChild(f.options)).recordedStatus, 'completed', 'historical observation is distinct from new binding')
})

test('background composition pins Host context and separates new-service readiness from historical review observation', async t => {
  const f = await fixture(t)
  const adapter = createNativeBackgroundAdapter({ ...f.options, host: 'qwenwork' })
  const capability = await adapter.readReadiness()
  assert.equal(capability.state, 'ready'); assert.equal(capability.canDispatch, true)
  assert.equal(capability.executionMode, 'cooperative-background'); assert.equal(capability.reasonCode, 'native-background-ready')
  assert.deepEqual(capability.diagnostics.issues, [])
  assert.match(adapter.protocol().proof, /async_launched/)
  const hostileInput = { ...f.options, sessionId: foreignSession, projectRoot: f.folder, mainTranscriptPath: join(f.root, 'foreign.jsonl') }
  assert.equal((await adapter.verifyChild(hostileInput)).recordedStatus, 'completed', 'callers cannot replace the bound adapter context')
  const reopened = createNativeBackgroundAdapter({ ...f.options, host: 'qwenwork', readinessSince: since + 1000 })
  assert.equal((await reopened.readReadiness()).state, 'unverified', 'old background proof cannot authorize new dispatch')
  assert.equal((await reopened.createObserver({ ...f.options, path: f.options.transcriptPath, threadId: f.options.runId }).read()).recordedStatus,
    'completed', 'a genuine already-bound review stays observable after reopening')
  await assert.rejects(reopened.verifyChild({ ...f.options, parentRunId: 'foreign-parent' }), /bound main session/)
  assert.equal(createNativeBackgroundAdapter({ ...f.options, host: 'codex' }), undefined, 'existing native routes are unchanged')
  const workbuddy = createNativeBackgroundAdapter({ ...f.options, host: 'workbuddy' })
  assert.match(workbuddy.protocol().proof, /version-1/)
  const unavailable = await workbuddy.readReadiness()
  assert.equal(unavailable.state, 'unverified', 'a QwenWork receipt cannot certify WorkBuddy capability')
  assert.equal(unavailable.canDispatch, false); assert.equal(unavailable.executionMode, 'unavailable')
})
