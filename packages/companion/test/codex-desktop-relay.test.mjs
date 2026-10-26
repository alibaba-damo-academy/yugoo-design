import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCodexDesktopRelay } from '../src/codex-desktop-relay.mjs'

const threadId = '00000000-0000-4000-8000-000000000001'
const instance = '00000000-0000-4000-8000-000000000002'
const other = '00000000-0000-4000-8000-000000000003'
const admissions = new WeakMap()
const call = async (relay, operation, extra = {}) => {
  const result = await relay.desktopBridge({ instance, operation, generation: admissions.get(relay), ...extra })
  if (operation === 'ready') admissions.set(relay, result.generation)
  return result
}

test('only an admitted, exact-thread bridge can receive one pending save', async t => {
  const relay = createCodexDesktopRelay(threadId, { waitMs: 5 })
  t.after(() => relay.close())
  assert.equal((await relay.probe()).status, 'unavailable')
  await assert.rejects(relay.send('save'), error => error.notSubmitted)
  await assert.rejects(call(relay, 'ready', { threadId: other }), /THREAD_MISMATCH/)
  await call(relay, 'ready', { threadId })
  await assert.rejects(relay.desktopBridge({ instance, operation: 'next' }), /BRIDGE_UNAVAILABLE/)
  await assert.rejects(call(relay, 'ready', { threadId }), /ALREADY_BOUND/)
  await assert.rejects(call(relay, 'ready', { instance: other, threadId }), /ALREADY_BOUND/)
  const waiting = call(relay, 'next')
  const pending = relay.send('authoritative diff')
  await assert.rejects(relay.send('overlap'), /BUSY/)
  const { message } = await waiting
  assert.equal(message.text, 'authoritative diff')
  assert.deepEqual(await call(relay, 'next'), { message: null }, 'a claimed notification is never replayed')
  await assert.rejects(call(relay, 'settle', { messageId: other }), /RECEIPT_MISMATCH/)
  await call(relay, 'settle', { messageId: message.id, receipt: { accepted: true, status: 'submitted_unverified', threadId } })
  assert.deepEqual(await pending, { accepted: true, status: 'submitted_unverified', threadId, messageId: message.id })
  await assert.rejects(call(relay, 'settle', { messageId: message.id }), /RECEIPT_MISMATCH/)
  await assert.rejects(call(relay, 'tools/call'), /OPERATION_INVALID/)
})

test('wrong target receipt and claimed disconnect remain unknown, unclaimed stop stays unsubmitted', async () => {
  for (const scenario of ['wrong-target', 'claimed-stop', 'unclaimed-stop']) {
    const relay = createCodexDesktopRelay(threadId)
    await call(relay, 'ready', { threadId })
    const pending = relay.send('save')
    const check = assert.rejects(pending, error => scenario === 'unclaimed-stop' ? error.notSubmitted === true : error.delivery === 'unknown')
    const message = scenario === 'unclaimed-stop' ? undefined : (await call(relay, 'next')).message
    if (scenario === 'wrong-target') await call(relay, 'settle', { messageId: message.id, receipt: { accepted: true, status: 'submitted_unverified', threadId: other } })
    else relay.close()
    await check
    relay.close()
  }
})

test('lease loss rejects new submissions and a deadline never requeues claimed data', async () => {
  let time = 0
  const relay = createCodexDesktopRelay(threadId, { now: () => time, leaseMs: 20, deliveryMs: 15, waitMs: 1 })
  await call(relay, 'ready', { threadId })
  const pending = relay.send('save')
  const check = assert.rejects(pending, error => error.delivery === 'unknown')
  await call(relay, 'next')
  await check
  assert.deepEqual(await call(relay, 'next'), { message: null })
  time = 21
  assert.equal((await relay.probe()).status, 'unavailable')
  await assert.rejects(relay.send('later'), error => error.notSubmitted === true)
  relay.close()
})

test('the exact expired owner can release its admission without reviving it', async t => {
  let time = 0
  const relay = createCodexDesktopRelay(threadId, { now: () => time, leaseMs: 20 })
  t.after(() => relay.close())
  await call(relay, 'ready', { threadId }); time = 21
  await assert.rejects(call(relay, 'next'), /BRIDGE_UNAVAILABLE/)
  await assert.rejects(call(relay, 'stop', { instance: other }), /BRIDGE_UNAVAILABLE/)
  assert.deepEqual(await call(relay, 'stop'), { stopped: true })
  assert.equal((await relay.probe()).status, 'unavailable')
  await call(relay, 'ready', { instance: other, threadId })
  assert.equal((await relay.probe()).status, 'available')
})

test('fresh explicit admission revokes an expired owner without replaying claimed or unclaimed mail', async t => {
  for (const claimed of [false, true]) await t.test(String(claimed), async t => {
    let time = 0
    const relay = createCodexDesktopRelay(threadId, { now: () => time, leaseMs: 20 })
    t.after(() => relay.close())
    const first = await call(relay, 'ready', { threadId })
    const old = { instance, generation: first.generation }
    const pending = relay.send('old event')
    const rejected = assert.rejects(pending, error => claimed ? error.delivery === 'unknown' : error.notSubmitted === true)
    if (claimed) await call(relay, 'next')
    time = 21
    const second = await call(relay, 'ready', { instance: other, threadId })
    await rejected
    assert.notEqual(second.generation, first.generation)
    const current = { instance: other, generation: second.generation }
    const next = relay.desktopBridge({ ...current, operation: 'next' })
    const newPending = relay.send('new user event')
    const { message } = await next
    assert.equal(message.text, 'new user event')
    for (const operation of ['next', 'stop', 'settle']) await assert.rejects(relay.desktopBridge({ ...old, operation, messageId: message.id }), /BRIDGE_UNAVAILABLE/)
    await relay.desktopBridge({ ...current, operation: 'settle', messageId: message.id, receipt: { accepted: true, status: 'submitted_unverified', threadId } })
    assert.equal((await newPending).status, 'submitted_unverified')
  })
})

for (const reboundInstance of [other, instance]) {
  test(`stopped next and stale operations cannot cross an admission when rebinding ${reboundInstance === instance ? 'the same instance' : 'another instance'}`, async t => {
    const relay = createCodexDesktopRelay(threadId)
    t.after(() => relay.close())
    const first = await relay.desktopBridge({ operation: 'ready', instance, threadId })
    const old = { instance, generation: first.generation }
    const staleNext = relay.desktopBridge({ ...old, operation: 'next' })
    const rejected = assert.rejects(staleNext, /BRIDGE_UNAVAILABLE/)

    // Do not await between these calls: reproduce stop -> ready -> send
    // before the old long poll's continuation can resume.
    const stopping = relay.desktopBridge({ ...old, operation: 'stop' })
    const rebinding = relay.desktopBridge({ operation: 'ready', instance: reboundInstance, threadId })
    const pending = relay.send('belongs to the new admission')
    const second = await rebinding
    await stopping
    await rejected
    assert.notEqual(second.generation, first.generation)
    const current = { instance: reboundInstance, generation: second.generation }
    const { message } = await relay.desktopBridge({ ...current, operation: 'next' })
    assert.equal(message.text, 'belongs to the new admission')
    for (const operation of ['next', 'settle', 'stop']) {
      await assert.rejects(relay.desktopBridge({ ...old, operation, messageId: message.id,
        receipt: { accepted: true, status: 'submitted_unverified', threadId } }), /BRIDGE_UNAVAILABLE/)
    }
    await assert.rejects(relay.desktopBridge({ ...old, operation: 'ready', threadId }), /ALREADY_BOUND/)
    assert.equal((await relay.probe()).status, 'available', 'stale cleanup must not stop the new owner')
    await relay.desktopBridge({ ...current, operation: 'settle', messageId: message.id,
      receipt: { accepted: true, status: 'submitted_unverified', threadId } })
    assert.equal((await pending).status, 'submitted_unverified')
    await relay.desktopBridge({ ...current, operation: 'stop' })
  })
}
