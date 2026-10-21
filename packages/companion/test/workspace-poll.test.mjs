import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

test('only authenticated API activity extends the Panel service idle observation',async()=>{
 const f=await fixture({withTranscript:true})
 try {
  const initial=f.server.lastAuthenticatedActivityAt
  await new Promise(resolve=>setTimeout(resolve,20))
  assert.equal((await fetch(f.server.origin)).status,200)
  const unauthorized=await fetch(f.server.origin+'/api',{method:'POST',headers:{Origin:f.server.origin,'Content-Type':'application/json'},body:JSON.stringify({method:'readConversation'})})
  assert.equal(unauthorized.status,403)
  assert.equal(f.server.lastAuthenticatedActivityAt,initial)
  await callCompanion(f.server.connectionPath,{method:'readConversation',params:{knownRevision:null}})
  assert.ok(f.server.lastAuthenticatedActivityAt>initial)
  assert.equal(f.messages.length,0,'a read never sends a native message')
 } finally {await f.close()}
})

for (const host of ['codex', 'claude-code', 'qoder']) test(`${host}: HTTP conditional workspace retains legacy reads and observes updates`, async () => {
  const f = await fixture({ serverOptions: { host } })
  const read = params => callCompanion(f.server.connectionPath, { method: 'readWorkspace', params })
  try {
    const legacy = await read({})
    assert.ok(legacy.projectId)
    const first = await read({ knownRevision: null })
    assert.equal(first.unchanged, false)
    assert.equal(first.workspace.projectId, legacy.projectId)
    const next = await read({ knownRevision: first.revision })
    assert.equal(next.unchanged, true)
    assert.ok(JSON.stringify(next).length < 120)
    await f.server.project.store.writeWorktreeText('research/research.json', '{"rounds":[]}')
    const changed = await read({ knownRevision: first.revision })
    assert.equal(changed.unchanged, false)
    assert.deepEqual(changed.workspace.design.research.state, { rounds: [] })
    await f.server.project.store.writeWorktreeText('research/research.json', '{')
    await assert.rejects(read({ knownRevision: changed.revision }), /invalid|incomplete/)
    await f.server.project.store.writeWorktreeText('research/research.json', '{"rounds":[]}')
    assert.equal((await read({ knownRevision: changed.revision })).unchanged, true)
    assert.equal((await read({})).unchanged, undefined, 'legacy API remains a full workspace')
  } finally { await f.close() }
})

for (const host of ['codex', 'workbuddy']) test(`${host}: bound history updates while workspace access is blocked; unchanged reads stay small`, async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { host } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const appendUser = text => appendFile(f.options.transcriptPath, JSON.stringify(host === 'workbuddy'
    ? { type: 'message', id: 'new-user', role: 'user', sessionId: f.options.connection.threadId,
      cwd: f.options.projectRoot, content: [{ type: 'input_text', text }], timestamp: Date.now() }
    : { type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', id: 'new-user',
      content: [{ type: 'Text', text }] } } }) + '\n')
  let release, enter
  const entered = new Promise(resolve => { enter = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const refresh = f.server.project.refreshAccess
  let workspace
  try {
    const initial = await call('readConversation', { knownRevision: null })
    assert.equal(initial.workspace.conversation.available, true)
    assert.equal(initial.workspace.conversation.threadId, f.options.connection.threadId)
    assert.deepEqual(initial.workspace.conversation.rows, [])
    f.server.project.refreshAccess = async (...args) => { enter(); await blocked; return refresh(...args) }
    workspace = call('readWorkspace')
    await entered
    await appendUser('Visible before any next agent action')
    const changed = await call('readConversation', { knownRevision: initial.revision, threadId: 'not-a-routing-authority' })
    assert.equal(changed.unchanged, false)
    assert.equal(changed.workspace.conversation.rows.at(-1).text, 'Visible before any next agent action')
    assert.equal(changed.workspace.conversation.threadId, f.options.connection.threadId)
    const unchanged = await call('readConversation', { knownRevision: changed.revision })
    assert.equal(unchanged.unchanged, true)
    assert.ok(JSON.stringify(unchanged).length < 120)
    const response = await fetch(`${f.server.origin}/api`, { method: 'POST', headers: {
      Origin: f.server.origin, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ method: 'readConversation' }) })
    assert.equal(response.status, 403, 'the fast path still requires the exact connection credential')
    assert.equal(f.messages.length, 0, 'observing history never wakes the host')
  } finally {
    release()
    f.server.project.refreshAccess = refresh
    await workspace?.catch(() => {})
    await f.close()
  }
})

test('invalid Design Files do not block history; native replacement remains rejected', async () => {
  const f = await fixture({ withTranscript: true })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await f.server.project.store.writeWorktreeText('research/research.json', '{')
    await assert.rejects(call('readWorkspace'), /invalid|incomplete/)
    await appendFile(f.options.transcriptPath, JSON.stringify({ type: 'event_msg', payload: {
      type: 'item_completed', item: { type: 'UserMessage', id: 'saved-user',
        content: [{ type: 'Text', text: 'Saved in native history' }] },
    } }) + '\n')
    assert.equal((await call('readConversation')).conversation.rows.at(-1).text, 'Saved in native history')
    await writeFile(f.options.transcriptPath, '')
    const unavailable = await call('readConversation')
    assert.equal(unavailable.conversation.available, false)
    assert.deepEqual(unavailable.conversation.rows, [])
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})

test('presentation does not wait for a review lock; browser workspace revisions exclude history', async () => {
  const f = await fixture({ withTranscript: true })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const workspace = await call('readWorkspace', { knownRevision: null, includeConversation: false })
    assert.equal(Object.hasOwn(workspace.workspace, 'conversation'), false)
    await appendFile(f.options.transcriptPath, JSON.stringify({ type: 'event_msg', payload: {
      type: 'item_completed', item: { type: 'UserMessage', id: 'independent', content: [{ type: 'Text', text: 'History only' }] },
    } }) + '\n')
    const unchanged = await call('readWorkspace', { knownRevision: workspace.revision, includeConversation: false })
    assert.equal(unchanged.unchanged, true, 'history changes do not invalidate the browser Panel snapshot')
    assert.equal((await call('readWorkspace')).conversation.rows.at(-1).text, 'History only', 'legacy tools retain history')
    const reviewOnly = await call('readConversation', { includeConversation: false, knownRevision: null })
    assert.equal(Object.hasOwn(reviewOnly.workspace, 'conversation'), false, 'review logs omit the foreground projection')
    assert.deepEqual(reviewOnly.workspace.backgroundRows, [])
    const sameReviews = await call('readConversation', { includeConversation: false, knownRevision: reviewOnly.revision })
    assert.equal(sameReviews.unchanged, true)
    assert.ok(JSON.stringify(sameReviews).length < 120)
    const lock = join(f.options.stateRoot, f.server.project.project.metadata.id, 'review.lock')
    await mkdir(lock)
    assert.equal((await call('readConversation')).conversation.rows.at(-1).text, 'History only')
    assert.equal((await stat(lock)).isDirectory(), true, 'a presentation read never clears another operation lock')
    assert.equal(f.messages.length, 0)
  } finally { await f.close() }
})

test('workspace display ticks skip full Git-open while operation access remains strict', async () => {
  const f = await fixture({ serverOptions: { browserAccess: 'local' } })
  const refresh = f.server.project.refreshAccess, calls = []
  f.server.project.refreshAccess = async (...args) => { calls.push(args[0] === true); return refresh(...args) }
  try {
    for (let n = 0; n < 3; n++) {
      const response = await fetch(f.server.url + 'api', { method: 'POST', headers: {
        Origin: f.server.origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1',
      }, body: JSON.stringify({ method: 'readWorkspace', params: { includeConversation: false } }) })
      assert.equal(response.status, 200); await response.json()
    }
    assert.deepEqual(calls, [true, true, true, true, true, true])
    calls.length = 0
    await callCompanion(f.server.connectionPath, { method: 'info' })
    assert.deepEqual(calls, [false], 'operation requests still use full project verification')
  } finally { f.server.project.refreshAccess = refresh; await f.close() }
})
