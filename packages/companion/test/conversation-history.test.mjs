import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationHistory, compactConversationHistory, conversationWork } from '../src/conversation-history.mjs'
import { transcriptRow } from '../src/codex-transcript.mjs'

test('main working state highlights current activity, not old history or background children',()=>{
 const value={available:true,recordedStatus:'running',rows:[{id:'old',role:'tool'},{id:'user',role:'user'},{id:'current',role:'tool',status:'completed'}]}
 assert.deepEqual(conversationWork(value),{status:'running',activeId:'current'})
 assert.deepEqual(conversationWork({...value,activityEpoch:2,rows:value.rows.map(r=>({...r,activityEpoch:1}))}),{status:'running',activeId:null})
 assert.deepEqual(conversationWork({...value,recordedStatus:'completed'}),{status:'completed',activeId:null})
 assert.deepEqual(conversationWork({...value,available:false}),{status:'unknown',activeId:null})
 assert.equal(conversationWork({...value,catchingUp:true}).status,'unknown')
 assert.equal(conversationWork({...value,rows:[...value.rows,{id:'question',questions:[{}],status:'running'}]}).status,'waiting')
 assert.equal(conversationWork({...value,rows:[...value.rows,{id:'new-user',role:'user'}]}).activeId,null)
})

test('producer stays at its exact native spawn, regardless of completion and later messages', () => {
  const spawn = transcriptRow({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'spawn', kind: 'started', agent_thread_id: 'producer' } } })
  const rows = [{ id: 'user' }, spawn, { id: 'answer' }, { id: 'next-user' }]
  const attempt = { role: 'producer', runId: 'producer', phase: 'working' }
  const order = phase => conversationHistory(rows, [{ ...attempt, phase }, { role: 'worker', runId: 'worker' }]).map(entry => entry.row?.id ?? entry.attempt.runId)
  assert.deepEqual(order('working'), ['user', ':spawn', 'producer', 'answer', 'next-user'])
  assert.deepEqual(order('completed'), order('working'))
  assert.equal(conversationHistory(rows.slice(2), [attempt])[0].earlier, true)
  assert.equal(transcriptRow({ payload: { item: { type: 'SubAgentActivity', id: 'done', kind: 'completed', agent_thread_id: 'producer' } } }).childRunIds.length, 0)
})

test('compact activities preserve every row and never cross messages or producer anchors', () => {
  const rows = [
    { id: 'a', role: 'tool', status: 'failed' },
    { id: 'b', role: 'tool', status: 'completed', childRunIds: ['p'] },
    { id: 'c', role: 'tool' },
    { id: 'd', role: 'assistant', text: 'Progress' },
    { id: 'e', role: 'tool' },
    { id: 'f', role: 'user' },
  ]
  const attempts = [{ role: 'producer', runId: 'p' }]
  const result = compactConversationHistory(rows, attempts)
  assert.deepEqual(result.map(entry => entry.kind), ['activity', 'producer', 'activity', 'message', 'activity', 'message'])
  assert.deepEqual(result.flatMap(entry => entry.rows ?? (entry.row ? [entry.row] : [])), rows)
  assert.deepEqual(result[0].rows, rows.slice(0, 2))
  assert.deepEqual(compactConversationHistory(), [])
  assert.equal(compactConversationHistory([], attempts)[0].earlier, true)
  assert.deepEqual(conversationWork({ available: true, recordedStatus: 'running', rows: rows.slice(0, 3) }, attempts),
    { status: 'running', activeId: 'c' }, 'active group uses the same Producer boundaries as the renderer')
})
