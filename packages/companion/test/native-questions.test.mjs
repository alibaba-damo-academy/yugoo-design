import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { nativeQuestions } from '../src/native-questions.mjs'
import { compactConversationHistory } from '../src/conversation-history.mjs'
import { createCodexTranscript } from '../src/codex-transcript.mjs'
import { createQoderTranscript } from '../src/qoder-transcript.mjs'

test('Qoder AskUserQuestion options survive projection and close on matching native result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qoder-question-'))
  try {
    const sessionId = '00000000-0000-4000-8000-000000000001', path = join(root, 'log.jsonl')
    const base = { sessionId, cwd:root, timestamp:new Date().toISOString() }
    await writeFile(path, JSON.stringify({ ...base, type:'assistant', uuid:'q', message:{ content:[{ type:'tool_use', name:'AskUserQuestion', id:'ask', input:{ questions:[{ question:'下一步？', options:[{ label:'调研' }] }] } }] } }) + '\n')
    const observer = createQoderTranscript({ path, sessionId, projectRoot:root })
    assert.equal((await observer.read()).rows[0].questions[0].options[0].label, '调研')
    await appendFile(path, JSON.stringify({ ...base, type:'user', uuid:'answer', parentUuid:'q', message:{ content:[{ type:'tool_result', tool_use_id:'ask', content:'private answer' }] } }) + '\n')
    const value = await observer.read()
    assert.equal(value.rows[0].status, 'completed')
    assert.ok(!JSON.stringify(value).includes('private answer'))
  } finally { await rm(root, { recursive:true, force:true }) }
})

test('native questions expose only bounded question fields and stay outside collapsed tool activity', () => {
  const questions = nativeQuestions({ secret: 'hidden', questions: [{ question: '下一步？', options: [{ label: '调研', description: '补足证据', secret: 'hidden' }] }] })
  assert.equal(questions.length, 1)
  assert.ok(!JSON.stringify(questions).includes('hidden'))
  assert.deepEqual(nativeQuestions('not json'), [])
  const history = compactConversationHistory([{ id: 'a', role: 'tool' }, { id: 'q', role: 'tool', questions }, { id: 'b', role: 'tool' }])
  assert.deepEqual(history.map(e => e.kind), ['activity', 'message', 'activity'])
})

test('Codex question call is visible before result and ends only on matching native output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-question-'))
  try {
    const threadId = '00000000-0000-4000-8000-000000000001', path = join(root, 'log.jsonl')
    const line = value => JSON.stringify(value) + '\n'
    await writeFile(path, line({ type:'session_meta', payload:{ id:threadId, cwd:root } }))
    const observer = createCodexTranscript({ path, threadId, projectRoot:root })
    const call = { type:'response_item', payload:{ type:'function_call', name:'request_user_input', call_id:'question-1', arguments:JSON.stringify({ questions:[{ id:'next', question:'下一步？', options:[{ label:'调研', description:'证据' }] }] }) } }
    await appendFile(path, line(call) + line(call))
    let value = await observer.read()
    assert.equal(value.rows.length, 1)
    assert.equal(value.rows[0].questions[0].question, '下一步？')
    assert.equal(value.rows[0].status, 'running')
    await appendFile(path, line({ type:'response_item', payload:{ type:'function_call_output', call_id:'unrelated', output:'secret' } }))
    assert.equal((await observer.read()).rows[0].status, 'running')
    await appendFile(path, line({ type:'response_item', payload:{ type:'function_call_output', call_id:'question-1', output:'private answer' } }))
    value = await observer.read()
    assert.equal(value.rows[0].status, 'completed')
    assert.ok(!JSON.stringify(value).includes('private answer'))
  } finally { await rm(root, { recursive:true, force:true }) }
})
