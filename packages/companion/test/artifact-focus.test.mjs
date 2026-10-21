import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createNativeRuns } from '../src/native-runs.mjs'
import { createCodexTranscript } from '../src/codex-transcript.mjs'
import { createDesignMcp } from '../src/mcp.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
const producer = '00000000-0000-4000-8000-000000000002'
let clock = 0
const event = (type, item) => JSON.stringify({ type: 'event_msg', timestamp: new Date(1700000000000 + ++clock).toISOString(), payload: { type, ...(item ? { item } : {}) } }) + '\n'
const message = text => event('item_completed', { type: 'AgentMessage', id: text, content: [{ type: 'text', text }] })
const focus = id => ({ artifactKind: 'direction', artifactId: `R-001/${id}`, artifactFile: `research/R-001/${id}.md` })

test('main focus maps MCP snake fields, shows only target segments and ends association at settlement', async () => {
  const f = await fixture({ withTranscript: true, researchMode: 'main' })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const server = createDesignMcp(), client = new Client({ name: 'focus-test', version: '1' })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(st); await client.connect(ct)
    await appendFile(f.options.transcriptPath, event('task_started') + message('before-focus'))
    const main = await call('beginMainBundle', { skill: 'research' })
    const args = { connection: f.server.connectionPath, invocationId: main.invocationId,
      artifact_kind: 'direction', artifact_id: 'R-001/A', artifact_file: 'research/R-001/A.md' }
    const response = await client.callTool({ name: 'design_focus_artifact', arguments: args })
    assert.ok(!response.isError, JSON.stringify(response))
    assert.equal(JSON.parse(response.content[0].text).artifact_id, args.artifact_id)
    await appendFile(f.options.transcriptPath, message('A-one'))
    await call('focusArtifact', { invocationId: main.invocationId, ...focus('B') })
    await appendFile(f.options.transcriptPath, message('B-only'))
    await call('focusArtifact', { invocationId: main.invocationId, ...focus('A') })
    await call('focusArtifact', { invocationId: main.invocationId, ...focus('A') })
    await appendFile(f.options.transcriptPath, message('A-two'))
    const read = id => call('readExecutionLog', { runId: threadId, invocationId: main.invocationId, artifactId: `R-001/${id}` })
    assert.deepEqual((await read('A')).entries.map(row => row.message), ['A-one', 'A-two'])
    assert.equal((await read('A')).association.segments.length, 2, 'idempotent focus does not split a segment')
    assert.deepEqual((await read('B')).entries.map(row => row.message), ['B-only'])
    let workspace = await call('readWorkspace')
    assert.equal(workspace.executionAttempts.length, 0, 'main is never forged into a Producer attempt')
    assert.equal(workspace.artifactActivities.find(item => item.active).artifactId, 'R-001/A')
    assert.equal(workspace.artifactActivities.find(item => item.active).runId, threadId)
    assert.equal(workspace.artifactActivities.find(item => item.active).nativeStatus, 'running')
    for (const params of [{ runId: threadId, invocationId: main.invocationId, ...focus('C') },
      { invocationId: main.invocationId, ...focus('C'), artifactFile: 'research/../other.md' },
      { invocationId: main.invocationId, ...focus('C'), artifactFile: 'research/research.json' },
      { invocationId: main.invocationId, ...focus('A'), artifactFile: 'research/other.md' },
      { invocationId: main.invocationId, ...focus('C'), artifactFile: focus('A').artifactFile }]) await assert.rejects(call('focusArtifact', params))
    await appendFile(f.options.transcriptPath, event('error'))
    assert.equal((await call('readWorkspace')).artifactActivities.find(item => item.active).nativeStatus, 'unknown')
    await call('finishMainBundle', { invocationId: main.invocationId, outcome: 'cancelled' })
    await appendFile(f.options.transcriptPath, message('later-unrelated'))
    assert.deepEqual((await read('A')).entries.map(row => row.message), ['A-one', 'A-two'])
    workspace = await call('readWorkspace')
    assert.ok(workspace.artifactActivities.every(item => !item.active))
    await assert.rejects(call('focusArtifact', { invocationId: main.invocationId, ...focus('C') }), /settled/)
    const observer = createCodexTranscript({ path: f.options.transcriptPath, threadId, projectRoot: f.options.projectRoot })
    const reloaded = await createNativeRuns({ project: f.server.project, stateRoot: f.options.stateRoot, threadId, readMainTranscript: () => observer.read() })
    assert.deepEqual((await reloaded.readExecutionLog({ invocationId: main.invocationId, artifactId: 'R-001/A' })).entries.map(row => row.message), ['A-one', 'A-two'])
    await writeFile(f.options.transcriptPath, '{invalid\n')
    assert.equal((await read('A')).found, false)
    assert.equal((await call('readWorkspace')).artifactActivities[0].nativeStatus, 'unknown')
    assert.equal(f.messages.length, 0)
  } finally { await client.close(); await server.close(); await f.close() }
})

test('verified Producer retains immutable root identity; focus never fabricates an attempt or a file', async () => {
  const f = await fixture()
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const path = join(f.root, 'producer.jsonl')
    const meta = JSON.stringify({ type: 'session_meta', payload: { id: producer, cwd: f.options.projectRoot,
      source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n'
    await writeFile(path, meta + event('task_started') + message('root-history'))
    const registration = { runId: producer, parentRunId: threadId, transcriptPath: path, role: 'producer', skill: 'research', artifactId: 'research' }
    await call('registerNativeRun', registration)
    await call('focusArtifact', { runId: producer, ...focus('A') })
    await appendFile(path, message('target-only'))
    await call('registerNativeRun', registration)
    let workspace = await call('readWorkspace')
    assert.equal(workspace.executionAttempts.length, 1)
    assert.equal(workspace.executionAttempts[0].artifactId, 'research')
    assert.equal(workspace.executionAttempts[0].runId, producer)
    assert.equal(workspace.artifactFiles[focus('A').artifactFile], undefined)
    assert.equal(workspace.artifactActivities[0].executor, 'producer')
    assert.deepEqual((await call('readExecutionLog', { runId: producer, artifactId: 'R-001/A' })).entries.map(row => row.message), ['target-only'])
    assert.deepEqual((await call('readExecutionLog', { runId: producer })).entries.map(row => row.message), ['root-history', 'target-only'], 'existing root log remains unfiltered')
    await assert.rejects(call('focusArtifact', { runId: threadId, ...focus('B') }), /Unknown native run/)
    await assert.rejects(call('focusArtifact', { runId: producer, ...focus('B'), artifactFile: 'role_permissions/B.md' }), /Bundle/)
    await appendFile(path, event('task_complete'))
    await assert.rejects(call('focusArtifact', { runId: producer, ...focus('B') }), /ended/)
    const readOnly = { ...f.server.project, requireWritable: async () => { throw Error('read-only fixture') } }
    const runs = await createNativeRuns({ project: readOnly, stateRoot: f.options.stateRoot, threadId })
    await assert.rejects(runs.focusArtifact({ runId: producer, ...focus('B') }), /read-only/)
    workspace = await call('readWorkspace')
    assert.equal(workspace.artifactActivities.length, 1)
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})

test('bounded transcript eviction keeps absolute target sequences; a replaced log cannot reuse the old boundary', async () => {
  const f = await fixture({ withTranscript: true, researchMode: 'main' })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await appendFile(f.options.transcriptPath, event('task_started') + message('unrelated-before'))
    const main = await call('beginMainBundle', { skill: 'research' })
    await call('focusArtifact', { invocationId: main.invocationId, ...focus('A') })
    await appendFile(f.options.transcriptPath, Array.from({ length: 220 }, (_, index) => message(`A-${index}`)).join(''))
    let result = await call('readExecutionLog', { invocationId: main.invocationId, artifactId: 'R-001/A' })
    assert.equal(result.found, true)
    assert.equal(result.association.truncated, true)
    assert.equal(result.entries[0].seq, 22)
    assert.equal(result.entries[0].message, 'A-20')
    await call('focusArtifact', { invocationId: main.invocationId, ...focus('B') })
    await appendFile(f.options.transcriptPath, message('B-after-eviction'))
    result = await call('readExecutionLog', { invocationId: main.invocationId, artifactId: 'R-001/B' })
    assert.deepEqual(result.entries.map(row => row.message), ['B-after-eviction'])
    assert.equal(result.entries[0].seq, 222)
    const meta = JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: f.options.projectRoot } }) + '\n'
    await writeFile(f.options.transcriptPath, meta + event('task_started') + message('replacement'))
    result = await call('readExecutionLog', { invocationId: main.invocationId, artifactId: 'R-001/B' })
    assert.equal(result.found, false)
    assert.deepEqual(result.entries, [])
    assert.equal((await call('readWorkspace')).artifactActivities.find(item => item.active).nativeStatus, 'unknown')
    await assert.rejects(call('focusArtifact', { invocationId: main.invocationId, ...focus('C') }), /cursor changed|transcript is unavailable/)
  } finally { await f.close() }
})

test('same-length and longer native replacement cannot establish a new target from an old focus boundary', async () => {
  const f = await fixture({ researchMode: 'main' })
  const transcript = { available: true, threadId, recordedStatus: 'running', omitted: 0,
    rows: [{ id: 'original', timestamp: '2026-10-05T10:00:00Z', role: 'assistant', text: 'original' }] }
  try {
    const runs = await createNativeRuns({ project: f.server.project, stateRoot: f.options.stateRoot, threadId,
      readMainTranscript: async () => structuredClone(transcript) })
    const main = await runs.beginMainBundle({ skill: 'research' })
    await runs.focusArtifact({ invocationId: main.invocationId, ...focus('A') })
    for (const count of [1, 3]) {
      transcript.rows = Array.from({ length: count }, (_, index) => ({ id: `replacement-${index}`,
        timestamp: '2026-10-05T11:00:00Z', role: 'assistant', text: 'unrelated' }))
      await assert.rejects(runs.focusArtifact({ invocationId: main.invocationId, ...focus('B') }), /cursor changed/)
      assert.equal((await runs.readExecutionLog({ invocationId: main.invocationId, artifactId: 'R-001/A' })).found, false)
      await assert.rejects(runs.readExecutionLog({ invocationId: main.invocationId, artifactId: 'R-001/B' }), /no focus association/)
      assert.equal(runs.getMainInvocation(main.invocationId).artifactFocusSegments.length, 1)
    }
  } finally { await f.close() }
})
