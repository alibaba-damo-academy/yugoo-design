import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, appendFile, readFile, open, rename, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyNativeWorkingDirectory } from '../src/native-working-directory.mjs'
import { resolveCodexMainTranscript } from '../src/native-run-resolution.mjs'
import { establishConversationStart, createDesignConversationObserver } from '../src/conversation-start.mjs'
import { createCodexTranscript } from '../src/codex-transcript.mjs'
import { createClaudeTranscript } from '../src/claude-transcript.mjs'
import { createQoderTranscript } from '../src/qoder-transcript.mjs'
import { createQwenWorkTranscript } from '../src/qwenwork-transcript.mjs'
import { readWorkBuddyHeader, createWorkBuddyTranscript } from '../src/workbuddy-transcript.mjs'
import { verifyClaudeChild } from '../src/claude-transcript.mjs'
import { verifyWorkBuddyChild } from '../src/workbuddy-native.mjs'

const id = '00000000-0000-4000-8000-000000000001'
const turn = '00000000-0000-4000-8000-000000000002'
const line = event => JSON.stringify(event) + '\n'
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'native-cwd-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const previous = join(root, 'old-workspace'), current = join(root, 'moved-conversation'), project = join(root, 'design-project')
  for (const path of [previous, current, project]) await mkdir(path)
  return { root, previous, current, project, path: join(root, 'native.jsonl') }
}
const header = cwd => ({ type: 'session_meta', payload: { id, cwd } })
const context = cwd => ({ type: 'turn_context', payload: { turn_id: turn, cwd } })
const message = (uuid, cwd) => ({ type: 'user', sessionId: id, uuid, parentUuid: null, cwd, message: { content: uuid } })

for (const host of ['codex', 'claude-code', 'qoder', 'qwenwork', 'workbuddy']) {
  test(`${host}: current native metadata permits cwd evolution without accepting text or partial records`, async t => {
    const f = await fixture(t)
    const native = cwd => host === 'codex' ? context(cwd) : host === 'workbuddy'
      ? { type: 'message', sessionId: id, cwd } : message('turn', cwd)
    await writeFile(f.path, line(host === 'codex' ? header(f.previous) : native(f.previous)) + line({ type: 'text', cwd: f.current, text: JSON.stringify(native(f.current)) }))
    const check = async () => {
      const file = await open(f.path, 'r')
      try { await verifyNativeWorkingDirectory(file, { host, sessionId: id, initialCwd: f.previous, expectedCwd: f.current }) }
      finally { await file.close() }
    }
    await assert.rejects(check(), /cwd mismatch/)
    const bytes = JSON.stringify(native(f.current))
    await appendFile(f.path, bytes)
    await assert.rejects(check(), /cwd mismatch/, 'a partial native record is not evidence')
    await appendFile(f.path, '\n')
    await check()
    const file = await open(f.path, 'r')
    try {
      await assert.rejects(verifyNativeWorkingDirectory(file, { host, sessionId: id,
        initialCwd: f.previous, expectedCwd: f.previous }), /cwd mismatch/, 'header=A, newest=B, expected=A must reject')
    } finally { await file.close() }
    await appendFile(f.path, line(native(f.project)))
    await assert.rejects(check(), /cwd mismatch/, 'an older matching cwd cannot override the current native context')
    await appendFile(f.path, line(native(f.current)))
    await check()
    if (host !== 'codex') {
      await appendFile(f.path, line({ ...native(f.current), sessionId: turn }))
      await assert.rejects(check(), /identity mismatch/)
    }
  })
}

test('Codex native entry reopens original project after a verified turn cwd change', async t => {
  const f = await fixture(t)
  await writeFile(f.path, line(header(f.previous)))
  const options = { stateRoot: join(f.root, 'state'), projectId: 'project-one', projectRoot: f.project,
    nativeCwd: f.previous, transcriptPath: f.path, threadId: id }
  const boundary = await establishConversationStart(options)
  const stored = join(options.stateRoot, 'project-one', 'native-bindings', id, 'conversation-start.json')
  // Existing version1 receipts lack transcriptCwd; retain their bytes on reopen.
  const legacy = JSON.parse(await readFile(stored)); delete legacy.transcriptCwd
  await writeFile(stored, JSON.stringify(legacy))
  const before = await readFile(stored)
  const design = join(f.project, 'saved.txt'); await writeFile(design, 'Saved design stays here')
  await appendFile(f.path, line(context(f.current)) + line({ type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'AgentMessage', id: 'new', content: [{ type: 'Text', text: 'Same conversation after moving' }] } } }))
  await rm(f.previous, { recursive: true })
  assert.equal(await resolveCodexMainTranscript({ threadId: id, nativeCwd: f.current, transcriptPath: f.path }), f.path)
  const reopened = await establishConversationStart({ ...options, nativeCwd: f.current })
  assert.equal(reopened.startOffset, boundary.startOffset)
  assert.deepEqual(reopened.anchor, boundary.anchor)
  assert.equal(reopened.transcriptCwd, f.previous)
  assert.deepEqual(await readFile(stored), before)
  const observer = await createDesignConversationObserver({ ...options, nativeCwd: f.current, createObserver: createCodexTranscript })
  const state = await observer.read()
  assert.equal(state.available, true)
  assert.equal(state.rows.at(-1).text, 'Same conversation after moving')
  assert.equal(await readFile(design, 'utf8'), 'Saved design stays here')
  // Archival rename retains source identity/cursor without rewriting the receipt.
  const archived = join(f.root, 'archived.jsonl'); await rename(f.path, archived)
  const moved = await establishConversationStart({ ...options, nativeCwd: f.current, transcriptPath: archived })
  assert.equal(moved.identity, boundary.identity)
  assert.deepEqual(await readFile(stored), before)
})

for (const [host, create] of [['claude-code', createClaudeTranscript], ['qoder', createQoderTranscript], ['qwenwork', createQwenWorkTranscript]]) {
  test(`${host}: original native session remains readable after moving its workspace`, async t => {
    const f = await fixture(t)
    await writeFile(f.path, line(message('old', f.previous)) + line({ ...message('new', f.current), parentUuid: 'old' }))
    const reader = create({ path: f.path, sessionId: id, projectRoot: f.current })
    const state = await reader.read()
    assert.equal(state.available, true)
    assert.deepEqual(state.rows.map(row => row.text), ['old', 'new'])
  })
}

test('WorkBuddy retains start cursor across a current cwd change and reads new native turns', async t => {
  const f = await fixture(t)
  const event = (name, cwd) => ({ type: 'message', id: name, sessionId: id, cwd, role: 'user', content: [{ type: 'input_text', text: name }] })
  await writeFile(f.path, line(event('old', f.previous)))
  const options = { host: 'workbuddy', stateRoot: join(f.root, 'state'), projectId: 'project-one', projectRoot: f.project,
    nativeCwd: f.previous, transcriptPath: f.path, threadId: id, readHeader: readWorkBuddyHeader, createObserver: createWorkBuddyTranscript }
  const original = await establishConversationStart(options)
  await appendFile(f.path, line(event('new', f.current)))
  const observer = await createDesignConversationObserver({ ...options, nativeCwd: f.current })
  const state = await observer.read()
  assert.equal(state.available, true)
  assert.deepEqual(state.rows.map(row => row.text), ['new'])
  const reopened = await establishConversationStart({ ...options, nativeCwd: f.current })
  assert.equal(reopened.startOffset, original.startOffset)
})

test('a verified new cwd cannot hide a rewritten historical origin behind an unchanged cursor', async t => {
  const f = await fixture(t)
  await writeFile(f.path, line(header(f.previous)) + line({ type: 'padding', text: 'x'.repeat(1024) }))
  const options = { stateRoot: join(f.root, 'state'), projectId: 'project-one', projectRoot: f.project,
    nativeCwd: f.previous, transcriptPath: f.path, threadId: id }
  await establishConversationStart(options)
  await appendFile(f.path, line(context(f.current)))
  const forged = Buffer.from(line(header(f.previous.replace('old-workspace', 'new-workspace'))))
  assert.equal(forged.length, Buffer.byteLength(line(header(f.previous))))
  const file = await open(f.path, 'r+')
  try { await file.write(forged, 0, forged.length, 0) } finally { await file.close() }
  await assert.rejects(establishConversationStart({ ...options, nativeCwd: f.current }), /origin cwd was changed/)
})

test('pending activation does not invent an origin cwd before native metadata is complete', async t => {
  const f = await fixture(t), prefix = line(header(f.previous))
  await writeFile(f.path, prefix.slice(0, 8))
  const options = { stateRoot: join(f.root, 'state'), projectId: 'project-one', projectRoot: f.project,
    nativeCwd: f.current, transcriptPath: f.path, threadId: id }
  await assert.rejects(establishConversationStart(options), error => error.code === 'DESIGN_TRANSCRIPT_PENDING')
  await appendFile(f.path, prefix.slice(8) + line(context(f.current)))
  const active = await establishConversationStart(options)
  assert.equal(active.status, 'active')
  assert.equal(active.nativeCwd, f.current)
  assert.equal(active.transcriptCwd, f.previous)
})

test('Codex child keeps its own historical cwd after the main conversation moves', async t => {
  const f = await fixture(t), child = '00000000-0000-4000-8000-000000000003'
  const path = join(f.root, 'child.jsonl')
  await writeFile(path, line({ type: 'session_meta', payload: { id: child, cwd: f.previous,
    source: { subagent: { thread_spawn: { parent_thread_id: id } } } } }) + line({ type: 'event_msg', payload: {
    type: 'item_completed', item: { type: 'AgentMessage', id: 'answer', content: [{ type: 'Text', text: 'done' }] } } }))
  const options = { path, threadId: child, parentRunId: id, projectRoot: f.current }
  assert.equal((await createCodexTranscript(options).read()).available, true)
  const wrong = await createCodexTranscript({ ...options, parentRunId: turn }).read()
  assert.equal(wrong.available, false)
  assert.match(wrong.error, /parent/)
})

test('Claude parent dispatch stays authoritative when its current cwd changes', async t => {
  const f = await fixture(t), runId = 'child-cwd'
  const folder = join(f.root, id, 'subagents'); await mkdir(folder, { recursive: true })
  const childPath = join(folder, `agent-${runId}.jsonl`), parent = join(f.root, `${id}.jsonl`)
  await writeFile(parent, line(message('old', f.previous)) + line({ ...message('dispatch', f.current), type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'dispatch', name: 'Agent', input: {} }] } }))
  await writeFile(join(folder, `agent-${runId}.meta.json`), JSON.stringify({ toolUseId: 'dispatch' }))
  await writeFile(childPath, line({ ...message('answer', f.current), type: 'assistant', agentId: runId,
    message: { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' } }))
  assert.equal((await verifyClaudeChild({ runId, parentRunId: id, transcriptPath: childPath, sessionId: id, projectRoot: f.current })).recordedStatus, 'completed')
})

test('WorkBuddy parent and native child receipts survive a moved workspace without weakening their pins', async t => {
  const f = await fixture(t), runId = 'agent-cwd'
  const folder = join(f.root, id, 'subagents'); await mkdir(folder, { recursive: true })
  const childPath = join(folder, `${runId}.jsonl`), parent = join(f.root, `${id}.jsonl`)
  const event = (type, cwd, extra = {}) => ({ type, sessionId: id, cwd, ...extra })
  await writeFile(parent, [event('message', f.previous), event('function_call', f.current, { name: 'Agent', callId: 'call', arguments: '{}' }),
    event('function_call_result', f.current, { name: 'Agent', callId: 'call', status: 'completed', providerData: { toolResult: { subAgent: { sessionId: runId, lastId: 'answer' } } } })].map(line).join(''))
  await writeFile(childPath, line(event('message', f.current, { sessionId: 'child-runtime', id: 'answer', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'done' }] })))
  const input = { runId, parentRunId: id, transcriptPath: childPath, mainTranscriptPath: parent, sessionId: id, projectRoot: f.current }
  assert.equal((await verifyWorkBuddyChild(input)).recordedStatus, 'completed')
  const bytes = await readFile(childPath, 'utf8'); await writeFile(childPath, bytes.replace('answer', 'another-output'))
  await assert.rejects(verifyWorkBuddyChild(input), /native receipt does not match/)
})
