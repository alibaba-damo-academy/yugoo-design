import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, appendFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexTranscript, transcriptRow, executionRowMessage } from '../src/codex-transcript.mjs'
import { execFileSync } from 'node:child_process'

const threadId = '00000000-0000-4000-8000-000000000001'
const line = value => JSON.stringify(value) + '\n'
const event = payload => ({ timestamp: '2026-09-09T05:00:00Z', type: 'event_msg', payload })

test('native command classifications yield informative labels without raw commands or search queries', () => {
  const row = transcriptRow(event({ type: 'item_completed', item: {
    type: 'CommandExecution', id: 'cmd', status: 'failed', command: 'secret command', stdout: 'secret output',
    parsed_cmd: [
      { type: 'read', path: '/private/root/SKILL.md', cmd: 'secret command' },
      { type: 'list_files', path: 'design_files' },
      { type: 'search', query: 'secret query' },
      { type: 'search', query: 'another secret query' },
      { type: 'unknown', cmd: 'secret command' },
    ],
  } }))
  assert.equal(row.label, '读取文件：SKILL.md；查看目录：design_files；搜索文件；运行命令')
  assert.equal(executionRowMessage(row), `${row.label} · 失败`)
  assert.ok(!JSON.stringify(row).includes('secret'))
  assert.ok(!JSON.stringify(row).includes('/private'))
  for (const parsed_cmd of [undefined, [], 'invalid', [null]]) {
    assert.equal(transcriptRow(event({ item: { type: 'CommandExecution', id: 'fallback', parsed_cmd } })).label, '运行命令')
  }
  assert.equal(executionRowMessage({ role: 'assistant', text: 'Original message', status: 'completed' }), 'Original message')
  assert.equal(executionRowMessage({ role: 'tool', label: 'design_status', status: 'completed' }), 'design_status · 已完成')
})

test('native transcript tail verifies identity, handles partial lines, deduplicates and never guesses completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-transcript-test-'))
  try {
    const path = join(root, 'native.jsonl'), projectRoot = join(root, 'project')
    await mkdir(projectRoot)
    const metadata = { type: 'session_meta', payload: { id: threadId, cwd: projectRoot } }
    await writeFile(path, line(metadata) + line(event({ type: 'task_started', turn_id: 't1' })))
    const observer = createCodexTranscript({ path, projectRoot, threadId })
    assert.equal((await observer.read()).recordedStatus, 'running')
    const message = event({ type: 'item_completed', turn_id: 't1', thread_id: threadId, item: { type: 'AgentMessage', id: 'm1', content: [{ type: 'Text', text: '**你好**\n\n- 消息内容' }] } })
    const serialized = Buffer.from(line(message))
    await appendFile(path, serialized.subarray(0, serialized.length - 5))
    const partial = await observer.read()
    assert.equal(partial.rows.length, 0)
    assert.equal(partial.recordedStatus, 'unknown')
    assert.equal(partial.catchingUp, true)
    await appendFile(path, serialized.subarray(serialized.length - 5))
    await appendFile(path, line({ type: 'response_item', payload: { type: 'message', content: [{ type: 'output_text', text: 'duplicate transport text' }] } }))
    await appendFile(path, line(message))
    await appendFile(path, line(event({ type: 'item_completed', turn_id: 't1', item: { type: 'Reasoning', id: 'r1', summary_text: ['公开摘要'], raw_content: ['private reasoning'] } })))
    await appendFile(path, line(event({ type: 'item_completed', turn_id: 't1', item: { type: 'CommandExecution', id: 'c1', command: 'secret input', stdout: 'secret output', status: 'completed' } })))
    const result = await observer.read()
    assert.equal(Object.hasOwn(result, 'designSessionStartedAt'), false, 'default/child reader does not claim a project activation')
    assert.equal(result.rows.length, 3)
    assert.equal(result.rows[0].text, '**你好**\n\n- 消息内容')
    assert.equal(result.recordedStatus, 'running', 'completed tool is not completed Agent turn')
    assert.ok(!JSON.stringify(result).includes('secret'))
    assert.ok(!JSON.stringify(result).includes('private reasoning'))
    await appendFile(path, line(event({ type: 'task_complete', turn_id: 't1' })))
    assert.equal((await observer.read()).recordedStatus, 'completed')
    await rename(path, `${path}.old`)
    assert.equal((await observer.read()).recordedStatus, 'unknown', 'missing log is not success')
    await writeFile(path, line({ ...metadata, payload: { ...metadata.payload, id: 'different-thread' } }))
    assert.equal((await observer.read()).available, false)
    await writeFile(path, line(metadata) + line(event({ type: 'task_started', turn_id: 't2' })))
    assert.equal((await observer.read()).recordedStatus, 'running', 'replacement file is revalidated')
    await writeFile(path, line(metadata))
    assert.equal((await observer.read()).recordedStatus, 'unknown', 'truncated history drops stale terminal state')
    const other = join(root, 'other'); await mkdir(other)
    assert.equal((await createCodexTranscript({ path, projectRoot: other, threadId }).read()).available, false)
    if (process.platform !== 'win32') {
      const fifo = join(root, 'fifo')
      execFileSync('mkfifo', [fifo])
      const invalid = await createCodexTranscript({ path: fifo, projectRoot, threadId }).read()
      assert.equal(invalid.available, false)
      assert.match(invalid.error, /not a regular file/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
