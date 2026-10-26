import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCodexDesktopBackgroundReadiness, resolveCodexDesktopReviewRun,
  verifyCodexDesktopReviewChild } from '../src/codex-desktop-background.mjs'

const parent = '10000000-0000-4000-8000-000000000001'
const child = '10000000-0000-4000-8000-000000000002'
const other = '10000000-0000-4000-8000-000000000003'
const base = Date.parse('2026-10-24T00:00:00Z')
const event = (second, payload) => ({ timestamp: new Date(base + second * 1000).toISOString(),
  type: 'event_msg', payload })
const item = (second, value) => event(second, { type: 'item_completed', item: value,
  started_at_ms: base + second * 1000 - 500, completed_at_ms: base + second * 1000 })
const text = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'codex-desktop-background-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const mainTranscriptPath = join(root, 'rollout-' + parent + '.jsonl')
  const transcriptPath = join(root, 'rollout-' + child + '.jsonl')
  const header = (id, source) => ({ type: 'session_meta', payload: { id, cwd: root,
    timestamp: new Date(base + (source ? 500 : 0)).toISOString(), ...(source ? { source } : {}) } })
  const main = [header(parent), item(1, { type: 'SubAgentActivity', kind: 'started',
    id: 'call-native', agent_path: '/root/probe', agent_thread_id: child })]
  if (options.overlap !== false) main.push(item(3, { type: 'McpToolCall', id: 'main-work', tool: 'read_file', status: 'completed' }))
  const childRows = [header(child, { subagent: { thread_spawn: { parent_thread_id: options.parent ?? parent } } }),
    { timestamp: new Date(base + 2000).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user',
      content: [{ type: 'input_text', text: options.assignment ?? 'Return READY. This is only a capability probe.' }] } },
    event(2, { type: 'task_started', turn_id: 'child-turn' }),
    item(4, { type: 'AgentMessage', id: 'child-final', phase: 'final_answer', content: [{ type: 'Text', text: 'READY' }] })]
  if (options.complete !== false) childRows.push(event(4, { type: 'task_complete', turn_id: 'child-turn' }))
  if (options.v2) childRows[0].payload.multi_agent_version = 'v2'
  await writeFile(mainTranscriptPath, text(main))
  await writeFile(transcriptPath, text(childRows))
  return { context: { sessionId: parent, projectRoot: root, mainTranscriptPath, readinessSince: base },
    input: { runId: child, parentRunId: parent, transcriptPath }, main, root }
}

test('actual native UUID launch plus completed independent main work admits cooperative readiness', async t => {
  const f = await fixture(t)
  const ready = await readCodexDesktopBackgroundReadiness(f.context)
  assert.equal(ready.state, 'ready')
  assert.equal(ready.observedMode, 'background')
  assert.equal(ready.diagnostics.callId, 'call-native')
  const resolved = await resolveCodexDesktopReviewRun({ launchCallId: 'call-native', agentPath: '/root/probe' }, f.context)
  assert.equal(resolved.runId, child)
  assert.equal(resolved.parentRunId, parent)
})

const consumed = (connection, reviewId, second = 3) => {
  const row = item(second, { type: 'McpToolCall', id: 'native-read-' + second,
    server: 'design-system', tool: 'design_read_review', status: 'completed',
    arguments: { connection, reviewId },
    result: { content: [{ type: 'text', text: JSON.stringify({ reviewId, profile: 'reflection', status: 'prepared' }) }] } })
  row.payload.turn_id = 'child-turn'
  return row
}
async function withReads(f, reads) {
  const rows = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  rows.splice(rows.findIndex(row => row.payload?.type === 'task_complete'), 0, ...reads)
  await writeFile(f.input.transcriptPath, text(rows))
}

test('v2 native successful exact-service request reads bind without exposing opaque prompt content', async t => {
  const f = await fixture(t, { v2: true }), connection = join(f.root, 'connection.private.json')
  f.context.getConnectionPath = () => connection
  await withReads(f, [consumed(connection, 'review-exact'), consumed(connection, 'review-exact', 3.5)])
  assert.equal((await verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base })).available, true)
  const domain = await fixture(t, { v2: true }), domainConnection = join(domain.root, 'connection.private.json')
  domain.context.getConnectionPath = () => domainConnection
  const domainError = consumed(domainConnection, 'review-exact')
  domainError.payload.item.result.content[0].text = JSON.stringify({ reviewId: 'review-exact', error: 'Previous domain review diagnostic' })
  await withReads(domain, [domainError])
  assert.equal((await verifyCodexDesktopReviewChild(domain.input, domain.context,
    { reviewId: 'review-exact', notBefore: base })).available, true, 'domain review diagnostics are not MCP transport failures')
})

test('foreign, failed, malformed, echo and compacted reads never establish native review consumption', async t => {
  for (const change of [
    row => { row.payload.item.arguments.connection += '.foreign' },
    row => { row.payload.item.status = 'failed' },
    row => { row.payload.item.result.isError = true },
    row => { row.payload.item.result.isError = 'true' },
    row => { row.payload.item.result.isError = null },
    row => { row.payload.item.error = 'failed' },
    row => { row.payload.item.result.content[0].text = '{invalid' },
    row => { row.payload.item.result.content[0].text = JSON.stringify({ note: 'review-exact' }) },
    row => { row.payload.item.result.content[0].text = JSON.stringify({ reviewId: 'review-other' }) },
    row => { row.payload.item.tool = 'echo' },
    row => { row.type = 'compacted' },
  ]) {
    const f = await fixture(t, { v2: true }), connection = join(f.root, 'connection.private.json')
    f.context.getConnectionPath = () => connection
    const row = consumed(connection, 'review-exact'); change(row)
    await withReads(f, [row])
    await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
      { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
  }
})

test('successful native reads of another review and explicit readable assignments remain ambiguous', async t => {
  for (const assignment of [undefined, 'Bound review: review-other;']) {
    const f = await fixture(t, { v2: true, assignment }), connection = join(f.root, 'connection.private.json')
    f.context.getConnectionPath = () => connection
    await withReads(f, [consumed(connection, 'review-exact'),
      ...(assignment ? [] : [consumed(connection, 'review-other', 3.5)])])
    await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
      { reviewId: 'review-exact', notBefore: base }), /conflicting review/)
  }
})

test('native request-read proof retains actual start/completion, first-turn and terminal boundaries', async t => {
  for (const change of [
    row => { delete row.payload.started_at_ms },
    row => { row.payload.completed_at_ms = row.payload.started_at_ms - 1 },
    row => { row.payload.started_at_ms = base },
    row => { row.payload.started_at_ms = base + 1500 },
    row => { row.payload.turn_id = 'another-turn' },
    row => { row.timestamp = new Date(base + 5000).toISOString(); row.payload.completed_at_ms = base + 5000 },
    row => { row.timestamp = new Date(Date.now() + 60000).toISOString() },
  ]) {
    const f = await fixture(t, { v2: true }), connection = join(f.root, 'connection.private.json')
    f.context.getConnectionPath = () => connection
    const row = consumed(connection, 'review-exact'); change(row)
    await withReads(f, [row])
    await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
      { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
  }
})

test('native consumption cannot supply its own connection authority or silently change legacy assignment rules', async t => {
  for (const v2 of [false, true]) {
    const f = await fixture(t, { v2 }), connection = join(f.root, 'connection.private.json')
    if (!v2) f.context.getConnectionPath = () => connection
    await withReads(f, [consumed(connection, 'review-exact')])
    await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
      { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
  }
})

test('a name or UUID alone, unfinished child, stale generation and wrong native parent do not establish readiness', async t => {
  for (const options of [{ overlap: false }, { complete: false }, { parent: other }]) {
    const f = await fixture(t, options)
    assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
  }
  const f = await fixture(t)
  assert.equal((await readCodexDesktopBackgroundReadiness({ ...f.context, readinessSince: base + 5000 })).state, 'unverified')
  assert.equal((await readCodexDesktopBackgroundReadiness({ ...f.context, readinessSince: undefined })).state, 'unverified')
})

test('native launch identity conflicts, foreign main UUID and wrong cwd fail closed', async t => {
  const f = await fixture(t)
  await assert.rejects(resolveCodexDesktopReviewRun({ runId: other, launchCallId: 'call-native' }, f.context), /conflict/)
  await assert.rejects(resolveCodexDesktopReviewRun({ agentPath: '/root/other' }, f.context), /missing or ambiguous/)
  assert.equal((await readCodexDesktopBackgroundReadiness({ ...f.context, sessionId: other })).state, 'unverified')
  assert.equal((await readCodexDesktopBackgroundReadiness({ ...f.context, projectRoot: tmpdir() })).state, 'unverified')
  f.main[1].payload.thread_id = other
  await writeFile(f.context.mainTranscriptPath, text(f.main))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
})

test('a readiness probe cannot be rebound as a review; a fresh exact review assignment can', async t => {
  const f = await fixture(t)
  await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
  const assigned = await fixture(t, { assignment: 'Bound review: review-exact; revision: pinned-original-evidence.' })
  assert.equal((await verifyCodexDesktopReviewChild(assigned.input, assigned.context,
    { reviewId: 'review-exact', notBefore: base })).available, true)
  await assert.rejects(verifyCodexDesktopReviewChild(assigned.input, assigned.context,
    { reviewId: 'review-other', notBefore: base }), /not assigned this exact review/)
  await assert.rejects(verifyCodexDesktopReviewChild(assigned.input, assigned.context,
    { reviewId: 'review-exact', notBefore: base + 5000 }), /outside this request boundary/)
})

test('a long original conversation resolves only current native evidence without whole-file limits', async t => {
  const f = await fixture(t)
  const historical = JSON.stringify({ type: 'historical', padding: 'x'.repeat(34 * 1024 * 1024) })
  await writeFile(f.context.mainTranscriptPath, text([f.main[0]]) + historical + '\n' + text(f.main.slice(1)))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'ready')
  assert.equal((await resolveCodexDesktopReviewRun({ launchCallId: 'call-native' }, f.context)).runId, child)
})

test('a symlinked or replaced main transcript is not accepted as a current native source', async t => {
  const f = await fixture(t), alias = join(f.root, 'alias.jsonl')
  await symlink(f.context.mainTranscriptPath, alias)
  assert.equal((await readCodexDesktopBackgroundReadiness({ ...f.context, mainTranscriptPath: alias })).state, 'unverified')
  await writeFile(f.context.mainTranscriptPath, text([{ type: 'session_meta', payload: { id: other, cwd: f.root } }, ...f.main.slice(1)]))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
})

test('future native timestamps do not manufacture a current readiness receipt', async t => {
  const f = await fixture(t)
  const future = Date.now() + 60000
  for (const row of f.main.slice(1)) row.timestamp = new Date(future).toISOString()
  await writeFile(f.context.mainTranscriptPath, text(f.main))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
})

test('an inherited old user message is not a new review assignment', async t => {
  const f = await fixture(t, { assignment: 'Bound review: review-exact; revision: old inherited context.' })
  const content = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  content.find(row => row.type === 'response_item').timestamp = new Date(base - 1).toISOString()
  await writeFile(f.input.transcriptPath, text(content))
  await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
})

test('main work begun before the native launch is not concurrent execution proof', async t => {
  const f = await fixture(t)
  const work = f.main.find(row => row.payload?.item?.id === 'main-work')
  work.payload.started_at_ms = base + 500
  await writeFile(f.context.mainTranscriptPath, text(f.main))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
})

test('future or post-terminal review assignments cannot retroactively authorize a child', async t => {
  for (const at of [Date.now() + 60000, base + 5000]) {
    const f = await fixture(t, { assignment: 'Bound review: review-exact; revision: invalid timing.' })
    const rows = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
    rows.find(row => row.type === 'response_item').timestamp = new Date(at).toISOString()
    await writeFile(f.input.transcriptPath, text(rows))
    await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
      { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
  }
})

test('missing or invalid main-work start/completion evidence never proves concurrency', async t => {
  for (const change of [
    work => { delete work.payload.started_at_ms },
    work => { work.payload.started_at_ms = null },
    work => { work.payload.started_at_ms = base + 3500 },
    work => { work.payload.completed_at_ms = base + 4500 },
  ]) {
    const f = await fixture(t)
    change(f.main.find(row => row.payload?.item?.id === 'main-work'))
    await writeFile(f.context.mainTranscriptPath, text(f.main))
    assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
  }
})

test('native first assignment can precede parent launch completion but cannot precede child creation', async t => {
  const f = await fixture(t, { assignment: 'Bound review: review-exact; revision: pinned.' })
  const rows = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  const assigned = rows.find(row => row.type === 'response_item')
  assigned.timestamp = new Date(base + 750).toISOString()
  await writeFile(f.input.transcriptPath, text(rows))
  assert.equal((await verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base })).available, true)
  assigned.timestamp = new Date(base + 250).toISOString()
  await writeFile(f.input.transcriptPath, text(rows))
  await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
})

test('post-terminal typed input cannot move the terminal boundary to authorize itself', async t => {
  const f = await fixture(t)
  const rows = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  rows.push(item(5, { type: 'UserMessage', id: 'late-assignment',
    content: [{ type: 'Text', text: 'Bound review: review-exact; revision: late.' }] }))
  await writeFile(f.input.transcriptPath, text(rows))
  await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
})

test('a large native compaction record within the bounded main window does not hide current execution evidence', async t => {
  const f = await fixture(t)
  await writeFile(f.context.mainTranscriptPath, text([...f.main,
    { type: 'compacted', message: 'x'.repeat(1066308) }]))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'ready')
  assert.equal((await resolveCodexDesktopReviewRun({ launchCallId: 'call-native' }, f.context)).runId, child)
})

test('a large child compaction record does not replace its actual first-turn review assignment', async t => {
  const f = await fixture(t, { assignment: 'Bound review: review-exact; revision: pinned.' })
  const rows = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  rows.push({ type: 'compacted', message: 'x'.repeat(1066308) })
  await writeFile(f.input.transcriptPath, text(rows))
  assert.equal((await verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base })).available, true)
})

test('compaction content never supplies native launch, concurrency or review assignment proof', async t => {
  const f = await fixture(t, { overlap: false })
  await writeFile(f.context.mainTranscriptPath, text([f.main[0],
    { type: 'compacted', payload: f.main[1].payload, message: text(f.main) + 'x'.repeat(1066308) }]))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
  await writeFile(f.context.mainTranscriptPath, text(f.main))
  const rows = (await readFile(f.input.transcriptPath, 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
  rows.push({ type: 'compacted', timestamp: new Date(base + 2500).toISOString(),
    payload: { role: 'user', content: [{ text: 'Bound review: review-exact;' }] }, message: 'x'.repeat(1066308) })
  await writeFile(f.input.transcriptPath, text(rows))
  await assert.rejects(verifyCodexDesktopReviewChild(f.input, f.context,
    { reviewId: 'review-exact', notBefore: base }), /not assigned this exact review/)
})

test('oversized execution records still fail closed instead of bypassing the native evidence limit', async t => {
  const f = await fixture(t)
  await writeFile(f.context.mainTranscriptPath, text([...f.main,
    { ...item(3, { type: 'McpToolCall', id: 'oversized-main-work' }), padding: 'x'.repeat(1066308) }]))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).reasonCode, 'native-records-unavailable')
})

test('a malformed complete compaction record and proof outside the read window remain unverified', async t => {
  const f = await fixture(t)
  await writeFile(f.context.mainTranscriptPath, text(f.main) + '{"type":"compacted","message":}\n')
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).reasonCode, 'native-records-unavailable')
  await writeFile(f.context.mainTranscriptPath, text(f.main) + text([
    { type: 'compacted', message: 'x'.repeat(5 * 1024 * 1024) }]))
  assert.equal((await readCodexDesktopBackgroundReadiness(f.context)).state, 'unverified')
  await assert.rejects(resolveCodexDesktopReviewRun({ launchCallId: 'call-native' }, f.context), /missing or ambiguous/)
})
