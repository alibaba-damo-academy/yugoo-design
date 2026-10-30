import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioConversationRequests } from '../src/studio-conversation-requests.mjs'

const binding = { bindingId: 'service-a', threadId: 'main-a' }
const studio = { ...binding, id: 'copy-a', expectedRevision: 0 }
const input = { id: 'copy-a', expectedRevision: 0, changes: [{ path: 'SKILL.md', content: 'Proposed method' }] }
const receipt = digest => ({ id: 'copy-a', baseRevision: 0, revision: 1, digest, valid: true, diagnostics: [], diff: [{ path: 'SKILL.md', before: 'Method', after: 'Proposed method' }] })
const readInstance = async () => ({ id: 'copy-a', revision: 0, kind: 'bundle' })

test('correlation never prepares for an unknown request, another copy, or a changed base', async () => {
  let prepares = 0
  const service = createStudioConversationRequests({ binding, readInstance, prepareChanges: async () => { prepares++; return receipt('a'.repeat(64)) } })
  await service.register({ requestId: 'one', studio })
  for (const request of [
    { ...input, authoringRequestId: 'unknown' },
    { ...input, authoringRequestId: 'one', id: 'copy-b' },
    { ...input, authoringRequestId: 'one', expectedRevision: 1 },
  ]) await assert.rejects(service.prepare(request))
  assert.equal(prepares, 0)
  assert.equal((await service.read({ requestId: 'one', studio })).prepared, null)
})
test('one request cannot be overwritten with another candidate or mutated by a reader', async () => {
  let digest = 'a'.repeat(64)
  const service = createStudioConversationRequests({ binding, readInstance, prepareChanges: async () => receipt(digest) })
  await service.register({ requestId: 'one', studio })
  await service.prepare({ ...input, authoringRequestId: 'one' })
  const read = await service.read({ requestId: 'one', studio })
  read.prepared.request.changes[0].content = 'Overwritten'
  digest = 'b'.repeat(64)
  await assert.rejects(service.prepare({ ...input, changes: [{ path: 'SKILL.md', content: 'A different proposal' }], authoringRequestId: 'one' }), /different candidate/)
  const retained = await service.read({ requestId: 'one', studio })
  assert.equal(retained.prepared.candidate.digest, 'a'.repeat(64))
  assert.equal(retained.prepared.request.changes[0].content, 'Proposed method')
  await assert.rejects(service.register({ requestId: 'one', studio }), /already submitted/)
})
test('capacity rejects rather than evicting an uncertain request; close rejects late candidate completion', async () => {
  let release
  const service = createStudioConversationRequests({ binding, readInstance, prepareChanges: () => new Promise(resolve => { release = resolve }) })
  for (let i = 0; i < 16; i++) await service.register({ requestId: `request-${i}`, studio })
  await assert.rejects(service.register({ requestId: 'request-17', studio }), /limit reached/)
  assert.equal((await service.read({ requestId: 'request-0', studio })).prepared, null)
  const pending = service.prepare({ ...input, authoringRequestId: 'request-0' })
  await new Promise(resolve => setImmediate(resolve))
  service.close(); release(receipt('a'.repeat(64)))
  await assert.rejects(pending, /closed/)
  await assert.rejects(service.read({ requestId: 'request-0', studio }), /closed/)
})

test('switching between two mounted previews cannot reuse a request for the other pin', async () => {
  let prepares = 0
  const a = { name: 'observations', version: '1.0' }, b = { name: 'questions', version: '1.0' }
  const service = createStudioConversationRequests({ binding,
    readInstance: async () => ({ id: 'copy-a', revision: 0, kind: 'kit', mounts: [{ bundle: a }, { bundle: b }] }),
    prepareChanges: async () => { prepares++; return receipt('a'.repeat(64)) },
  })
  await service.register({ requestId: 'one', studio: { ...studio, bundle: a } })
  await assert.rejects(service.prepare({ ...input, authoringRequestId: 'one', bundle: b }), /preview Bundle/)
  await assert.rejects(service.prepare({ ...input, authoringRequestId: 'one' }), /preview Bundle/)
  await assert.rejects(service.read({ requestId: 'one', studio: { ...studio, bundle: b } }), /target changed/)
  assert.equal(prepares, 0)
  assert.equal((await service.read({ requestId: 'one', studio: { ...studio, bundle: a } })).prepared, null)
})

const pin = { name: 'observations', version: '1.0' }
const nativeStudio = { ...studio, bundle: pin }
const nativeService = prepareChanges => createStudioConversationRequests({ binding,
  readInstance: async () => ({ id: 'copy-a', revision: 0, kind: 'bundle', bundle: pin }), prepareChanges })

test('conversation preparation discovers exact candidates without a UI request or saving authority', async () => {
  let prepares = 0
  const service = nativeService(async () => { prepares++; return receipt('a'.repeat(64)) })
  await service.register({ requestId: 'pending-ui', studio: nativeStudio })
  assert.deepEqual(await service.list({ studio: nativeStudio }), { candidates: [] })
  const proposed = await service.prepareForConversation(input)
  assert.equal(prepares, 1)
  assert.deepEqual(proposed.authoring.studio, nativeStudio)
  const { requestId } = proposed.authoring
  assert.deepEqual(await service.list({ studio: nativeStudio }), { candidates: [{ requestId, studio: nativeStudio,
    digest: proposed.digest, changedFiles: ['SKILL.md'] }] })
  const read = await service.read({ requestId, studio: nativeStudio })
  assert.deepEqual(read.prepared.request, input)
  assert.equal(read.prepared.candidate.digest, proposed.digest)
  assert.equal(read.prepared.candidate.authoring, undefined, 'locator does not become another S2 candidate authority')
  proposed.authoring.studio.bundle.version = '9.0'
  read.prepared.request.changes[0].content = 'mutated reader'
  assert.equal((await service.read({ requestId, studio: nativeStudio })).prepared.request.changes[0].content, input.changes[0].content)
})

test('same normalized conversation request joins in-flight preparation and reuses its exact candidate', async () => {
  let prepares = 0, release
  const service = nativeService(async () => { prepares++; await new Promise(resolve => { release = resolve }); return receipt('a'.repeat(64)) })
  const first = service.prepareForConversation(input)
  const second = service.prepareForConversation({ changes: input.changes, expectedRevision: 0, id: 'copy-a' })
  while (!release) await new Promise(resolve => setImmediate(resolve))
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(prepares, 1)
  assert.equal(a.authoring.requestId, b.authoring.requestId)
  assert.deepEqual(a, b)
  assert.deepEqual(await service.prepareForConversation(input), a)
  assert.equal(prepares, 1)
})

test('discovery rejects wrong binding/thread/revision/pin and never infers the latest candidate', async () => {
  let prepares = 0
  const service = nativeService(async () => { prepares++; return receipt('a'.repeat(64)) })
  const proposed = await service.prepareForConversation(input)
  for (const wrong of [{ bindingId: 'other-service' }, { threadId: 'other-thread' }, { expectedRevision: 1 }, { bundle: { ...pin, version: '2.0' } }]) {
    await assert.rejects(service.list({ studio: { ...nativeStudio, ...wrong } }), /changed/)
    await assert.rejects(service.read({ requestId: proposed.authoring.requestId, studio: { ...nativeStudio, ...wrong } }), /changed/)
  }
  assert.deepEqual(await service.list({ studio }), { candidates: [] }, 'another exact preview scope does not select a latest candidate')
  await assert.rejects(service.prepareForConversation({ ...input, expectedRevision: 1 }), /changed/)
  await assert.rejects(service.prepareForConversation({ ...input, bundle: { ...pin, version: '2.0' } }), /changed/)
  await assert.rejects(service.prepareForConversation({ ...input, studio: { ...nativeStudio, threadId: 'other' } }), /Invalid/)
  assert.equal(prepares, 1)
})

test('native request deduplication preserves the shared 16-entry bound without evicting UI requests', async () => {
  const service = nativeService(async () => receipt('a'.repeat(64)))
  await service.register({ requestId: 'pending-ui', studio: nativeStudio })
  for (let i = 0; i < 15; i++) await service.prepareForConversation({ ...input, changes: [{ path: 'SKILL.md', content: String(i) }] })
  await assert.rejects(service.prepareForConversation(input), /limit reached/)
  assert.equal((await service.list({ studio: nativeStudio })).candidates.length, 15)
  assert.equal((await service.read({ requestId: 'pending-ui', studio: nativeStudio })).prepared, null)
  await service.prepareForConversation({ ...input, changes: [{ path: 'SKILL.md', content: '0' }] })
})

test('all conversation candidates retain the existing 24MiB prepared-data budget', async () => {
  const service = nativeService(async () => ({ ...receipt('a'.repeat(64)), diff: [{ path: 'SKILL.md', before: 'x'.repeat(1024 * 1024), after: 'y'.repeat(1024 * 1024) }] }))
  for (let i = 0; i < 11; i++) await service.prepareForConversation({ ...input, changes: [{ path: 'SKILL.md', content: String(i) }] })
  await assert.rejects(service.prepareForConversation(input), /24 MiB/)
  assert.equal((await service.list({ studio: nativeStudio })).candidates.length, 11)
})

test('Kit preparation without a selected preview preserves absence instead of choosing a mount', async () => {
  const service = createStudioConversationRequests({ binding,
    readInstance: async () => ({ id: 'copy-a', revision: 0, kind: 'kit', mounts: [{ bundle: pin }] }),
    prepareChanges: async request => { assert.equal(request.bundle, undefined); return receipt('a'.repeat(64)) },
  })
  const result = await service.prepareForConversation(input)
  assert.equal(result.authoring.studio.bundle, undefined)
  assert.equal((await service.list({ studio })).candidates.length, 1)
  assert.equal((await service.list({ studio: nativeStudio })).candidates.length, 0)
})
