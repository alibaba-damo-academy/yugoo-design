import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioConversationClient, readStudioConversationTarget, studioConversationTarget, studioConversationHandoff, studioCandidateForReview, studioConversationScopeMatches, studioEditingContext } from '../src/studio-conversation.mjs'

const binding = { bindingId: 'service-a', threadId: 'main-a' }
const target = { ...binding, id: 'copy-a', expectedRevision: 2 }

test('editor hints are snapshotted separately and cannot enlarge the exact Studio target', async () => {
  let release, reads = 0
  const calls = [], context = { intent: 'edit', currentFile: 'SKILL.md' }, bundle = { name: 'questions', version: '1.0' }
  const client = createStudioConversationClient({ requestId: () => 'editing-context', rpc: async (method, params) => {
    if (method === 'info') {
      if (++reads === 2) await new Promise(resolve => { release = resolve })
      return { threadId: binding.threadId, studioConversation: binding }
    }
    calls.push({ method, params }); return { accepted: true }
  } })
  await client.connect()
  const pending = client.send({ text: 'Clarify the method', id: target.id, expectedRevision: target.expectedRevision, context, bundle })
  context.currentFile = 'schema.yaml'; bundle.version = '2.0'; release(); await pending
  assert.deepEqual(calls[0].params.studio, { ...target, bundle: { name: 'questions', version: '1.0' } })
  assert.deepEqual(calls[0].params.context, { intent: 'edit', currentFile: 'SKILL.md' })
  for (const value of [{ intent: 'publish' }, { intent: 'edit', dirty: false }, { intent: 'edit', root: '/outside' }, { intent: 'edit', currentFile: '' }]) {
    assert.throws(() => studioEditingContext(value), /Invalid/)
  }
  assert.throws(() => studioConversationTarget({ ...target, context }), /Invalid/)
})

test('event-time editor guard rejects an info response arriving after exit or a dirty change', async () => {
  let release, reads = 0, sends = 0, requests = 0, active = true
  const client = createStudioConversationClient({ requestId: () => 'late', onRequest() { requests++ }, rpc: async method => {
    if (method === 'info') {
      if (++reads === 2) await new Promise(resolve => { release = resolve })
      return { threadId: binding.threadId, studioConversation: binding }
    }
    sends++; return { accepted: true }
  } })
  await client.connect()
  const pending = client.send({ text: 'Retained human draft', id: target.id, expectedRevision: target.expectedRevision,
    beforeSend() { if (!active) throw Error('Editor changed or is dirty') } })
  active = false; release()
  await assert.rejects(pending, /Editor changed/)
  assert.equal(sends, 0); assert.equal(requests, 0)
})

test('editing context reads the saved object name and only a current canonical file', async () => {
  const readInstance = async () => ({ id: target.id, revision: target.expectedRevision, kind: 'kit', title: { zh: '真实标题', en: 'Saved title' },
    mounts: [], files: [{ path: 'mindset.md' }] })
  const value = await readStudioConversationTarget({ target, binding, readInstance, context: { intent: 'create', currentFile: 'mindset.md' } })
  assert.deepEqual(value.title, { zh: '真实标题', en: 'Saved title' })
  assert.equal(value.context.intent, 'create')
  for (const currentFile of ['../SKILL.md', '/outside/SKILL.md', 'missing.md']) {
    await assert.rejects(readStudioConversationTarget({ target, binding, readInstance, context: { intent: 'edit', currentFile } }), { code: 'STUDIO_BINDING_CHANGED' })
  }
})
test('candidate links retain exact locators and reject partial, repeated or path-bearing targets', () => {
  assert.equal(studioConversationHandoff('?view=studio&presentation=content-only'), undefined)
  const query = new URLSearchParams({ studioTarget: JSON.stringify(target), studioRequest: 'native-request-1' })
  assert.deepEqual(studioConversationHandoff(query.toString()), { requestId: 'native-request-1', studio: target })
  for (const bad of ['studioRequest=only', 'studioTarget={}', `${query}&studioRequest=duplicate`, `${query}&studioTarget={}`,
    new URLSearchParams({ studioTarget: JSON.stringify({ ...target, root: '/other' }), studioRequest: 'native-request-1' }).toString(),
    new URLSearchParams({ studioTarget: JSON.stringify(target), studioRequest: '../request' }).toString()]) {
    assert.throws(() => studioConversationHandoff(bad))
  }
})
test('Studio sends to the exact bound main conversation and exact working copy through existing sendPrompt only', async () => {
  const calls = []
  const client = createStudioConversationClient({ requestId: () => 'request-a', rpc: async (method, params) => {
    calls.push({ method, params })
    return method === 'info' ? { host: 'codex', threadId: binding.threadId, studioConversation: binding } : { accepted: true, status: 'submitted_unverified' }
  } })
  await client.connect()
  const receipt = await client.send({ text: 'Clarify the selected method', id: target.id, expectedRevision: 2 })
  assert.equal(receipt.status, 'submitted_unverified')
  assert.deepEqual(calls.at(-1), { method: 'sendPrompt', params: { text: 'Clarify the selected method', requestId: 'request-a', studio: target } })
  assert.equal(calls.filter(x => x.method === 'sendPrompt').length, 1)
})
test('a restarted service or different native main cannot inherit an old Studio binding', async () => {
  let next = binding, sends = 0
  const client = createStudioConversationClient({ requestId: () => 'request-a', rpc: async method => {
    if (method === 'info') return { threadId: next.threadId, studioConversation: next }
    sends++; return { accepted: true }
  } })
  await client.connect(); next = { ...binding, bindingId: 'service-b' }
  await assert.rejects(client.send({ text: 'Retained draft', id: 'copy-a', expectedRevision: 2 }), { code: 'STUDIO_BINDING_CHANGED' })
  assert.equal(sends, 0)
  await assert.rejects(client.connect(), { code: 'STUDIO_BINDING_CHANGED' })
})
test('unknown native submission is not retried or converted into completion', async () => {
  let sends = 0
  const client = createStudioConversationClient({ requestId: () => 'request-a', rpc: async method => {
    if (method === 'info') return { threadId: binding.threadId, studioConversation: binding }
    sends++; throw Error('Delivery unknown')
  } })
  await client.connect()
  await assert.rejects(client.send({ text: 'One request', id: 'copy-a', expectedRevision: 2 }), /Delivery unknown/)
  assert.equal(sends, 1)
})
test('server rejects a stale copy or spoofed main before any native submission', async () => {
  let reads = 0
  const readInstance = async () => { reads++; return { id: 'copy-a', revision: 3, kind: 'bundle' } }
  await assert.rejects(readStudioConversationTarget({ target: { ...target, threadId: 'other' }, binding, readInstance }), { code: 'STUDIO_BINDING_CHANGED' })
  assert.equal(reads, 0)
  await assert.rejects(readStudioConversationTarget({ target, binding, readInstance }), { code: 'STUDIO_BINDING_CHANGED' })
  assert.equal(reads, 1)
  assert.throws(() => studioConversationTarget({ ...target, root: '/arbitrary/path' }), /Invalid/)
})

test('Bundle preview context must match the actual local Bundle pin', async () => {
  const readInstance = async () => ({ id: 'copy-a', revision: 2, kind: 'bundle', bundle: { name: 'observations', version: '1.0' } })
  await assert.rejects(readStudioConversationTarget({ target: { ...target, bundle: { name: 'observations', version: '2.0' } }, binding, readInstance }), { code: 'STUDIO_BINDING_CHANGED' })
  const valid = await readStudioConversationTarget({ target: { ...target, bundle: { name: 'observations', version: '1.0' } }, binding, readInstance })
  assert.deepEqual(valid.bundle, { name: 'observations', version: '1.0' })
})

test('review click reads the current mount even before the old prepared candidate is cleared by an effect', () => {
  const a = { name: 'observations', version: '1.0' }, b = { name: 'questions', version: '1.0' }
  const request = { studio: { ...target, bundle: a } }
  const prepared = { request: { id: target.id, expectedRevision: 2, changes: [] }, candidate: { id: target.id, baseRevision: 2, revision: 3, digest: 'a'.repeat(64) } }
  const current = { record: { id: target.id, revision: 2 }, previewBundle: a, dirty: false, busy: false }
  assert.equal(studioConversationScopeMatches(current, request.studio), true)
  assert.deepEqual(studioCandidateForReview(current, request, prepared), prepared)
  // The actual editor publishes its selection before paint; React's old
  // candidate state and the event closure can still refer to the previous pin.
  current.previewBundle = b
  const oldRenderedReviewClick = () => studioCandidateForReview(current, request, prepared)
  assert.equal(studioConversationScopeMatches(current, request.studio), false)
  assert.throws(oldRenderedReviewClick, { code: 'STUDIO_BINDING_CHANGED' })
  assert.equal(prepared.request.id, target.id, 'a rejected click neither adopts nor rewrites the old candidate')
})
