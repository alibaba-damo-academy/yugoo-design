import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSavedContinuation } from '../src/saved-continuation.mjs'

async function fixture(t) {
  const stateRoot = await mkdtemp(join(tmpdir(), 'saved-continuation-'))
  t.after(() => rm(stateRoot, { recursive: true, force: true }))
  const options = { stateRoot, projectId: 'project-one', host: 'workbuddy', threadId: 'exact-native-session' }
  const open = overrides => createSavedContinuation({ ...options, ...overrides })
  const api = open(), saved = [{ eventId: 'save-one', commit: 'a'.repeat(40) }]
  await api.prepare({ eventId: 'save-one', skill: 'test_bundle', payloadHash: 'payload-hash' })
  await api.saved('save-one', saved[0].commit)
  return { api, open, saved, options }
}

test('exact save/checkpoint survives reopen without design bytes or automatic submission', async t => {
  const { open, saved, options } = await fixture(t)
  assert.equal((await open().snapshot())[0].retryable, true)
  for (const overrides of [{ threadId: 'other' }, { host: 'codex' }, { projectId: 'other' }]) assert.deepEqual(await open(overrides).snapshot(), [])
  const directory = join(options.stateRoot, options.projectId, 'saved-continuations')
  const file = join(directory, (await readdir(directory))[0])
  const text = await readFile(file, 'utf8')
  assert.equal(text.includes('Continue with SECRET design facts'), false)
  await assert.rejects(open().begin({ text: 'Continue', saved: [{ ...saved[0], commit: 'b'.repeat(40) }] }), /checkpoint/)
  await assert.rejects(open().begin({ text: 'Continue', saved: [saved[0], saved[0]] }), /Duplicate/)
  assert.equal((await open().snapshot())[0].retryable, true)
})

test('lost receipt and restart preserve unknown without retrying an uncertain send', async t => {
  const { api, open, saved } = await fixture(t)
  const first = await api.begin({ text: 'Continue', requestId: 'request-one', saved })
  assert.equal(first.entries.length, 1)
  assert.equal((await open().snapshot())[0].status, 'unknown')
  const retry = await open().begin({ text: 'Continue', requestId: 'request-one', saved })
  assert.equal(retry.entries.length, 0)
  assert.equal(retry.prior.status, 'unknown')
  await api.settle(first.requestId, { accepted: false, status: 'unknown' })
  assert.equal((await open().snapshot())[0].retryable, false)
})

test('native accepted queue and Hook receipts are retained, never manufactured consumption or resubmitted', async t => {
  for (const status of ['queued', 'hook_received', 'queued_for_resume', 'submitted_unverified', 'user_input_accepted']) {
    const { api, open, saved } = await fixture(t)
    const first = await api.begin({ text: 'Continue', requestId: 'request-one', saved })
    await api.settle(first.requestId, { accepted: true, status, queuedSubmissionId: 'native-queue-id' })
    const replay = await open().begin({ text: 'Continue', requestId: 'request-one', saved })
    assert.equal(replay.entries.length, 0)
    assert.equal(replay.prior.status, status)
    assert.equal((await open().snapshot())[0].status, status)
    assert.equal((await open().snapshot())[0].retryable, false)
    assert.equal((await open().begin({ text: 'Changed intent', requestId: 'new-id', saved })).prior.status, 'unknown')
  }
})

test('only proven not-submitted outcomes permit an explicit notification-only retry', async t => {
  const { api, open, saved } = await fixture(t)
  const first = await api.begin({ text: 'Continue', requestId: 'first', saved })
  await api.settle(first.requestId, { accepted: false, status: 'unavailable', notSubmitted: true })
  assert.equal((await open().snapshot())[0].retryable, true)
  const next = await open().begin({ text: 'Continue', requestId: 'second', saved })
  assert.equal(next.entries[0].commit, saved[0].commit)
  await open().settle(next.requestId, { accepted: false, status: 'held' })
  assert.equal((await open().snapshot())[0].retryable, false, 'approval held is not permission to resend')
})

test('concurrent same-event sends admit one and preserve exact-content fences', async t => {
  const { api, saved } = await fixture(t)
  const requests = await Promise.all([1, 2].map(() => api.begin({ text: 'Continue', requestId: 'same', saved })))
  assert.equal(requests.filter(value => value.entries.length).length, 1)
  await assert.rejects(api.prepare({ eventId: 'save-one', skill: 'test_bundle', payloadHash: 'changed' }), /different content/)
})

test('overlapping service instances retain both events and serialize late receipts with new saves', async t => {
  const { api, open, saved } = await fixture(t)
  const replacement = open()
  await Promise.all([
    api.prepare({ eventId: 'from-old-service', skill: 'test_bundle', payloadHash: 'old' }),
    replacement.prepare({ eventId: 'from-new-service', skill: 'test_bundle', payloadHash: 'new' }),
  ])
  assert.equal((await open().snapshot()).length, 3)
  await api.begin({ saved, text: 'old notification', requestId: 'old-request' })
  await Promise.all([
    api.settle('old-request', { accepted: false, status: 'unknown' }),
    replacement.saved('from-new-service', 'b'.repeat(40)),
  ])
  const entries = await open().snapshot()
  assert.equal(entries.find(entry => entry.eventId === 'save-one').status, 'unknown')
  assert.equal(entries.find(entry => entry.eventId === 'from-new-service').retryable, true)
  assert.equal(entries.find(entry => entry.eventId === 'from-old-service').status, 'preparing')
  const concurrent = await Promise.all([api, replacement].map(service => service.begin({ saved: [{ eventId: 'from-new-service', commit: 'b'.repeat(40) }], text: 'new operation', requestId: 'new-request' })))
  assert.equal(concurrent.filter(result => result.entries.length).length, 1)
})

test('Kit/native workspace pins cannot be reassigned to another continuation', async t => {
  const { api, saved, open } = await fixture(t)
  await assert.rejects(api.begin({ text: 'Continue', saved, kitHash: 'different-exact-kit' }), /Kit/)
  assert.equal((await api.snapshot({ kitHash: 'different-exact-kit' }))[0].status, 'stale')
  assert.equal((await api.snapshot({ kitHash: 'different-exact-kit' }))[0].retryable, false)
  assert.deepEqual(await open({ nativeCwd: '/another/native/workspace' }).snapshot(), [])
  assert.deepEqual(await open({ projectRoot: '/another/project/root' }).snapshot(), [])
})

test('prepared save without a settled checkpoint remains unconfirmed rather than automatically redelivering', async t => {
  const { api, open } = await fixture(t)
  await api.prepare({ eventId: 'interrupted-save', skill: 'test_bundle', payloadHash: 'other' })
  const entry = (await open().snapshot()).find(item => item.eventId === 'interrupted-save')
  assert.equal(entry.status, 'preparing'); assert.equal(entry.retryable, false)
})

test('corrupt, foreign binding or symlinked delivery metadata fails closed', async t => {
  const { open, options } = await fixture(t)
  const directory = join(options.stateRoot, options.projectId, 'saved-continuations')
  const file = join(directory, (await readdir(directory))[0])
  const original = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...original, binding: { ...original.binding, threadId: 'other' } }))
  await assert.rejects(open().snapshot(), /binding/)
  await writeFile(file, '{')
  await assert.rejects(open().snapshot())
  await rm(file)
  const outside = join(options.stateRoot, 'outside.json')
  await writeFile(outside, JSON.stringify(original)); await symlink(outside, file)
  await assert.rejects(open().snapshot(), /metadata/)
  assert.equal(await readFile(outside, 'utf8'), JSON.stringify(original))
})
