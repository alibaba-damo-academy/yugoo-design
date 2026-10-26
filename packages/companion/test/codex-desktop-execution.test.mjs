import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, mkdir, writeFile, readFile, mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as pause } from 'node:timers/promises'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCodexDesktopExecutionAdapter } from '../src/codex-desktop-execution.mjs'
import { startCompanion } from '../src/server.mjs'

const producer = '00000000-0000-4000-8000-000000000002'
const worker = '00000000-0000-4000-8000-000000000003'
const event = (type, payload = {}, at = Date.now()) => JSON.stringify({ type: 'event_msg', timestamp: new Date(at).toISOString(),
  payload: { type, ...payload } }) + '\n'
const desktop = { codexDesktop: true, codexDesktopNativeBundles: true, browserAccess: 'local',
  connection: { host: 'codex', inputMode: 'desktop', threadId, send: async () => ({ accepted: true }) } }
async function launch(f, id, parent = threadId, parentPath = f.options.transcriptPath) {
  await pause(8)
  const at = Date.now() - 2, path = join(f.root, 'rollout-' + id + '.jsonl'), agentPath = '/root/' + id
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id, cwd: f.options.nativeCwd, timestamp: new Date(at).toISOString(),
    source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } }) + '\n' + event('task_started', { turn_id: 'turn-' + id }, at))
  await appendFile(parentPath, event('item_completed', { started_at_ms: at, completed_at_ms: at,
    item: { type: 'SubAgentActivity', kind: 'started', id: 'call-' + id, agent_path: agentPath, agent_thread_id: id } }, at))
  return { path, agentPath }
}
async function consume(f, path, id, skill, connection = f.server.connectionPath) {
  const prepared = await callCompanion(f.server.connectionPath, { method: 'prepareBundle', params: { skill } })
  const at = Date.now() - 1
  await appendFile(path, event('item_completed', { turn_id: 'turn-' + id, started_at_ms: at, completed_at_ms: at,
    item: { type: 'McpToolCall', id: 'read-' + id, server: 'design-system', tool: 'design_prepare_bundle', status: 'completed',
      arguments: { connection, skill }, result: { content: [{ type: 'text', text: JSON.stringify(prepared) }] } } }, at))
}
const researchState = { rounds: { 'R-001': { round_id: 'R-001', stage: 'identified', topic: 'Synthetic execution evidence',
  directions: { 'D-001': { direction_id: 'D-001', title: 'Literature', research_points: ['Find primary evidence'] } }, direction_order: ['D-001'] } },
round_order: ['R-001'], current_round_id: 'R-001' }

test('desktop native Bundle opt-in rejects missing desktop and exact transcript before startup', async () => {
  await assert.rejects(startCompanion({ codexDesktopNativeBundles: true }), /explicit Codex desktop/)
  await assert.rejects(startCompanion({ ...desktop }), /exact main transcript/)
})

test('desktop Producer and its nested Worker use real parent logs, receipts and shared publication', async t => {
  const f = await fixture({ withTranscript: true, serverOptions: desktop }); t.after(() => f.close())
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const initial = await call('readWorkspace')
  assert.equal(initial.hostCapabilities.nativeSubagents, true)
  assert.equal(initial.hostCapabilities.nativeWorkers, true)
  assert.equal(initial.hostCapabilities.backgroundReviewReadiness, 'unverified', 'attached execution grants no GRA readiness')
  assert.equal(initial.hostCapabilities.nativeExecutionProtocol.mode, 'native-attached')
  const prepared = await call('prepareBundle', { skill: 'research' })
  assert.equal(prepared.execution.mode, 'subagent')
  assert.ok(prepared.workerMethod)
  const p = await launch(f, producer)
  await assert.rejects(call('registerNativeRun', { role: 'producer', skill: 'research', artifactId: 'research', agentPath: p.agentPath }), /must consume/)
  await consume(f, p.path, producer, 'research', f.server.connectionPath + '.foreign')
  await assert.rejects(call('registerNativeRun', { role: 'producer', skill: 'research', artifactId: 'research', agentPath: p.agentPath }), /must consume/)
  await consume(f, p.path, producer, 'research')
  await call('registerNativeRun', { role: 'producer', skill: 'research', artifactId: 'research', agentPath: p.agentPath })
  const w = await launch(f, worker, producer, p.path)
  await consume(f, w.path, worker, 'research')
  const target = { role: 'worker', skill: 'research', parentRunId: producer, artifactId: 'D-001',
    artifactFile: 'research/R-001/D-001.md', agentPath: w.agentPath }
  await assert.rejects(call('registerNativeRun', { ...target, parentRunId: threadId }), /launch is missing/)
  await assert.rejects(call('registerNativeRun', { ...target, artifactFile: 'research/research.json' }), /not canonical JSON/)
  await call('registerNativeRun', target)
  await assert.rejects(call('registerNativeRun', { ...target, artifactFile: 'research/R-001/D-002.md' }), /rebound/)
  await mkdir(join(f.options.projectRoot, 'design_files/research/R-001'), { recursive: true })
  await writeFile(join(f.options.projectRoot, 'design_files/research/R-001/D-001.md'), '# Synthetic primary evidence\n')
  const receipt = await call('finishNativeRun', { runId: worker })
  assert.equal(receipt.receipt.path, target.artifactFile)
  assert.equal((await call('readWorkspace')).executionAttempts.find(x => x.runId === worker).phase, 'working')
  await appendFile(w.path, event('task_complete', { turn_id: 'turn-' + worker }))
  await writeFile(join(f.options.projectRoot, 'design_files/research/research.json'), JSON.stringify(researchState))
  const published = await call('finishNativeRun', { runId: producer, scope: 'state', outcome: 'pause' })
  assert.equal(published.accepted, true)
  assert.ok(published.settlement.commit)
  await appendFile(p.path, event('task_complete', { turn_id: 'turn-' + producer }))
  const end = await call('readWorkspace')
  assert.equal(end.executionAttempts.find(x => x.runId === producer).phase, 'completed')
  assert.equal(end.executionAttempts.find(x => x.runId === worker).phase, 'completed')
  assert.equal(end.hostCapabilities.backgroundReviewReadiness, 'unverified')
})

test('desktop main Worker requires its exact invocation and blocks publication while active', async t => {
  const f = await fixture({ withTranscript: true, researchMode: 'main', serverOptions: desktop }); t.after(() => f.close())
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const main = await call('beginMainBundle', { skill: 'research' })
  const w = await launch(f, worker)
  await consume(f, w.path, worker, 'research')
  const target = { role: 'worker', skill: 'research', artifactId: 'D-001', artifactFile: 'research/R-001/D-001.md',
    invocationId: main.invocationId, agentPath: w.agentPath }
  await assert.rejects(call('registerNativeRun', { ...target, invocationId: producer }), /Unknown main/)
  await call('registerNativeRun', target)
  await mkdir(join(f.options.projectRoot, 'design_files/research/R-001'), { recursive: true })
  await writeFile(join(f.options.projectRoot, 'design_files/research/R-001/D-001.md'), '# Main Worker evidence\n')
  await writeFile(join(f.options.projectRoot, 'design_files/research/research.json'), JSON.stringify(researchState))
  await assert.rejects(call('finishMainBundle', { invocationId: main.invocationId, scope: 'state', outcome: 'pause' }), /active or unobservable Worker/)
  await appendFile(w.path, event('task_complete', { turn_id: 'turn-' + worker }))
  const settled = await call('finishMainBundle', { invocationId: main.invocationId, scope: 'state', outcome: 'pause' })
  assert.equal(settled.accepted, true)
  assert.deepEqual((await call('readReviewPolicy')), { mode: 'auto', autoMergeWindowMs: 30000 })
})

test('desktop attached resolver stays bounded on a long parent and rejects foreign/ambiguous launches', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-native-bounded-'))); t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'main.jsonl'), since = Date.now() - 100
  await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: root } }) + '\n'
    + JSON.stringify({ type: 'compacted', payload: { summary: 'x'.repeat(33 * 1024 * 1024) } }) + '\n')
  const adapter = await createCodexDesktopExecutionAdapter({ sessionId: threadId, projectRoot: root,
    mainTranscriptPath: path, startedAt: since, getParentBinding: () => undefined })
  const fake = { root, options: { nativeCwd: root, transcriptPath: path } }
  const p = await launch(fake, producer)
  const binding = await adapter.resolveRun({ agentPath: p.agentPath })
  assert.equal(binding.runId, producer)
  assert.equal((await adapter.verifyChild(binding)).available, true)
  await assert.rejects(adapter.resolveRun({}), /Exact native Bundle launch/)
  await assert.rejects(adapter.resolveRun({ agentPath: p.agentPath, parentRunId: worker }), /registered Producer/)
  await assert.rejects(adapter.resolveRun({ agentPath: p.agentPath, runId: worker }), /launch is missing/)
  const child = JSON.parse((await readFile(p.path, 'utf8')).split('\n')[0])
  child.payload.cwd = '/'
  await writeFile(p.path, JSON.stringify(child) + '\n')
  await assert.rejects(adapter.verifyChild(binding), /cwd does not match/)
  const at = Date.now() - 1
  await appendFile(path, event('item_completed', { started_at_ms: at, completed_at_ms: at,
    item: { type: 'SubAgentActivity', kind: 'started', id: 'other-call', agent_path: p.agentPath, agent_thread_id: worker } }, at))
  await assert.rejects(adapter.resolveRun({ agentPath: p.agentPath }), /ambiguous/)
})

test('Bundle registration consumes only its own successful pinned native first-turn method read', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-native-consumption-'))); t.after(() => rm(root, { recursive: true, force: true }))
  const main = join(root, 'main.jsonl'), child = join(root, 'child.jsonl'), now = Date.now()
  await writeFile(main, JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: root } }) + '\n')
  const adapter = await createCodexDesktopExecutionAdapter({ sessionId: threadId, projectRoot: root, mainTranscriptPath: main, startedAt: now - 2000 })
  const expected = { skill: 'research', version: '1.0', kit: { name: 'web_app', version: '1.0' }, designFiles: join(root, 'design_files') }
  const connection = join(root, 'private-connection.json'), binding = { runId: producer, parentRunId: threadId, transcriptPath: child }
  const prefix = JSON.stringify({ type: 'session_meta', payload: { id: producer, cwd: root, timestamp: new Date(now - 1500).toISOString(),
    source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n'
    + event('task_started', { turn_id: 'first' }, now - 1400)
  const read = () => ({ type: 'event_msg', timestamp: new Date(now - 1000).toISOString(), payload: { type: 'item_completed', turn_id: 'first',
    started_at_ms: now - 1200, completed_at_ms: now - 1100, item: { type: 'McpToolCall', server: 'design-system', tool: 'design_prepare_bundle', status: 'completed',
      arguments: { connection, skill: 'research' }, result: { content: [{ type: 'text', text: JSON.stringify({ ...expected, method: 'Complete version-pinned Bundle method' }) }] } } } })
  const check = async (value, error) => {
    await writeFile(child, prefix + JSON.stringify(value) + '\n' + event('task_complete', { turn_id: 'first' }, now - 500))
    if (error) await assert.rejects(adapter.verifyAssignment(binding, expected, connection), error)
    else await adapter.verifyAssignment(binding, expected, connection)
  }
  await check(read())
  for (const mutate of [
    r => { r.payload.item.arguments.connection += '.foreign' },
    r => { r.payload.item.status = 'failed' },
    r => { r.payload.item.result.isError = true },
    r => { r.payload.item.result.isError = 'false' },
    r => { r.payload.turn_id = 'another-turn' },
    r => { r.payload.started_at_ms = now - 1600 },
    r => { r.payload.completed_at_ms = now - 900 },
    r => { r.timestamp = new Date(now - 400).toISOString() },
    r => { r.timestamp = new Date(Date.now() + 60000).toISOString() },
    r => { const v = JSON.parse(r.payload.item.result.content[0].text); v.version = 'different'; r.payload.item.result.content[0].text = JSON.stringify(v) },
    r => { const v = JSON.parse(r.payload.item.result.content[0].text); v.kit.name = 'other-kit'; r.payload.item.result.content[0].text = JSON.stringify(v) },
    r => { const v = JSON.parse(r.payload.item.result.content[0].text); v.designFiles += '-foreign'; r.payload.item.result.content[0].text = JSON.stringify(v) },
  ]) { const r = read(); mutate(r); await check(r, /must consume/) }
  const foreign = read(); foreign.payload.item.arguments.skill = 'smart_questions'
  await check(foreign, /conflicting Bundle/)
})
