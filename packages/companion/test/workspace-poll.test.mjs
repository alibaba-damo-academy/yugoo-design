import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'

const browserRequest = (f, method, params = {}) => fetch(f.server.url + 'api', {
  method: 'POST', headers: {
    Origin: f.server.origin, 'Content-Type': 'application/json', 'X-Design-Browser': '1',
  }, body: JSON.stringify({ method, params }),
})

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
  const pollHead = f.server.project.store.pollHead
  let workspace
  try {
    const initial = await call('readConversation', { knownRevision: null })
    assert.equal(initial.workspace.conversation.available, true)
    assert.equal(initial.workspace.conversation.threadId, f.options.connection.threadId)
    assert.deepEqual(initial.workspace.conversation.rows, [])
    f.server.project.store.pollHead = async (...args) => {
      enter(); await blocked
      return pollHead.apply(f.server.project.store, args)
    }
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
    f.server.project.store.pollHead = pollHead
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

test('browser history remains bound and readable when project Kit source is invalid', async () => {
  const f = await fixture({ withTranscript: true, serverOptions: { browserAccess: 'local' } })
  try {
    await writeFile(join(f.options.projectRoot, 'design_kit/source.json'), '{')
    await appendFile(f.options.transcriptPath, JSON.stringify({ type: 'event_msg', payload: {
      type: 'item_completed', item: { type: 'UserMessage', id: 'browser-history-user',
        content: [{ type: 'Text', text: 'History is independent of Kit parsing' }] },
    } }) + '\n')
    const response = await browserRequest(f, 'readConversation', {
      knownRevision: null, threadId: 'not-a-routing-authority',
    })
    const first = await response.json()
    assert.equal(response.status, 200, JSON.stringify(first))
    assert.equal(first.workspace.conversation.threadId, f.options.connection.threadId)
    assert.equal(first.workspace.conversation.rows.at(-1).text, 'History is independent of Kit parsing')
    const unchanged = await browserRequest(f, 'readConversation', { knownRevision: first.revision })
    assert.equal((await unchanged.json()).unchanged, true)

    await writeFile(f.options.transcriptPath, JSON.stringify({ type: 'session_meta', payload: {
      id: '00000000-0000-4000-8000-000000000002', cwd: f.options.projectRoot,
    } }) + '\n')
    const replaced = await browserRequest(f, 'readConversation')
    assert.equal(replaced.status, 200)
    const unavailable = await replaced.json()
    assert.equal(unavailable.conversation.available, false)
    assert.deepEqual(unavailable.conversation.rows, [])
    assert.equal(f.messages.length, 0, 'browser reads never send a native message')
  } finally { await f.close() }
})

test('workspace HTTP reads retain owner freshness and browser writes retain project identity checks', async () => {
  const f = await fixture({ serverOptions: { browserAccess: 'local' } })
  try {
    const metadataPath = join(f.options.projectRoot, 'project.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    const currentMetadata = { ...metadata, name: 'Current locally edited project name' }
    await writeFile(metadataPath, JSON.stringify(currentMetadata))
    const mindsetPath = join(f.options.projectRoot, 'design_kit/kit/mindset.md')
    const note = '\n<!-- Current local Kit edit remains observable. -->\n'
    await appendFile(mindsetPath, note)
    const fresh = await browserRequest(f, 'readWorkspace', { includeConversation: false })
    assert.equal(fresh.status, 200)
    assert.equal((await fresh.json()).projectName, currentMetadata.name)
    assert.ok(f.server.project.installedKit.mindsetSource.endsWith(note))

    const sourcePath = join(f.options.projectRoot, 'design_kit/source.json')
    const source = await readFile(sourcePath, 'utf8')
    await writeFile(sourcePath, '{')
    const invalidKit = await browserRequest(f, 'readWorkspace')
    assert.equal(invalidKit.status, 400)
    assert.match((await invalidKit.json()).error, /JSON|property name|Unexpected|position/i)
    await writeFile(sourcePath, source)

    const changedIdentity = { ...currentMetadata, id: '00000000-0000-4000-8000-000000000002' }
    const pollHead = f.server.project.store.pollHead.bind(f.server.project.store)
    f.server.project.store.pollHead = async () => {
      const head = await pollHead()
      await writeFile(metadataPath, JSON.stringify(changedIdentity))
      return head
    }
    try {
      const changedDuringRead = await browserRequest(f, 'readWorkspace')
      assert.equal(changedDuringRead.status, 400)
      assert.match((await changedDuringRead.json()).error, /project identity changed/i)
    } finally { f.server.project.store.pollHead = pollHead }

    const statePath = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json')
    const state = { questions: { purpose: { prompt: 'Purpose?', kind: 'text', answer: 'Keep this answer', detail: '' } } }
    await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
    const saved = JSON.stringify(state)
    await writeFile(statePath, saved)
    const rejectedRead = await browserRequest(f, 'readWorkspace')
    assert.equal(rejectedRead.status, 400)
    assert.match((await rejectedRead.json()).error, /project identity changed/i)
    const rejectedWrite = await browserRequest(f, 'savePanel', {
      skill: 'smart_questions', state: { ...state, questions: {} },
    })
    assert.equal(rejectedWrite.status, 400)
    assert.match((await rejectedWrite.json()).error, /project identity changed/i)
    assert.equal(await readFile(statePath, 'utf8'), saved)
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
    assert.deepEqual(calls, [], 'workspace freshness is owned by the project read, without duplicate dispatcher checks')
    calls.length = 0
    await callCompanion(f.server.connectionPath, { method: 'info' })
    assert.deepEqual(calls, [false], 'operation requests still use full project verification')
  } finally { f.server.project.refreshAccess = refresh; await f.close() }
})
