import test from 'node:test'
import assert from 'node:assert/strict'
import { deferNativeConnection } from '../src/native-hook-transport.mjs'

const binding = { host: 'qoder', threadId: 'exact-session' }
const unavailable = { accepted: false, status: 'unavailable', notSubmitted: true }

test('Panel construction needs no input; an explicit probe and sends reuse the native connection', async () => {
  let opens = 0, probes = 0, closes = 0
  const sent = [], receipt = { accepted: true, status: 'hook_received' }
  const c = deferNativeConnection({ ...binding, open: async () => {
    opens++
    return { probe: async () => { probes++; return { status: 'available' } },
      send: async (...args) => { sent.push(args); return receipt }, close: () => { closes++ } }
  } })
  assert.equal(opens, 0)
  assert.deepEqual(await c.probe(), { status: 'available' })
  const context = { requestId: 'saved-intent' }
  assert.equal(await c.send('continue', context), receipt)
  assert.deepEqual(sent, [['continue', context]])
  assert.equal(opens, 1); assert.equal(probes, 1)
  await c.close(); await c.close()
  assert.equal(closes, 1)
})

test('concurrent opening failure submits nothing; only a later explicit operation opens again', async () => {
  let opens = 0, sends = 0, rejectOpen
  const c = deferNativeConnection({ ...binding, open: () => {
    opens++
    if (opens === 1) return new Promise((_resolve, reject) => { rejectOpen = reject })
    return { send: async () => { sends++; return { accepted: true } } }
  } })
  const first = c.send('first'), second = c.send('second')
  await Promise.resolve(); rejectOpen(new Error('Hook unavailable'))
  assert.deepEqual(await first, unavailable); assert.deepEqual(await second, unavailable)
  await Promise.resolve()
  assert.equal(opens, 1); assert.equal(sends, 0)
  assert.equal((await c.send('explicit recovery')).accepted, true)
  assert.equal(opens, 2); assert.equal(sends, 1)
  assert.deepEqual(await c.probe(), { status: 'unknown' }, 'no native probe does not fabricate readiness')
  await c.close()
})

test('a real send failure or unknown receipt keeps its native uncertainty and is never replayed', async () => {
  const error = new Error('response lost after submission')
  const receipt = { accepted: false, status: 'unknown' }
  let opens = 0, sends = 0
  const c = deferNativeConnection({ ...binding, open: () => {
    opens++
    return { send: async () => { if (++sends === 1) throw error; return receipt } }
  } })
  await assert.rejects(c.send('once'), actual => actual === error && !actual.notSubmitted)
  assert.equal(opens, 1); assert.equal(sends, 1)
  assert.equal(await c.send('another explicit intent'), receipt)
  assert.equal(opens, 1); assert.equal(sends, 2)
  await c.close()
})

test('close joins a pending open, disposes its late resource and never sends the waiting message', async () => {
  let resolveOpen, sends = 0, closes = 0, closed = false
  const c = deferNativeConnection({ ...binding, open: () => new Promise(resolve => { resolveOpen = resolve }) })
  const sent = c.send('must stay unsent')
  await Promise.resolve()
  const closing = c.close().then(() => { closed = true })
  await Promise.resolve(); assert.equal(closed, false)
  resolveOpen({ send: async () => { sends++; return { accepted: true } }, close: async () => { closes++ } })
  assert.deepEqual(await sent, unavailable)
  await closing; await c.close()
  assert.equal(closes, 1); assert.equal(sends, 0)
  assert.deepEqual(await c.send('closed route'), unavailable)
})

test('closing an unused route opens nothing; explicit probes preserve actual transport failures', async () => {
  let opens = 0
  const c = deferNativeConnection({ ...binding, open: () => { opens++; throw Error('not ready') } })
  await c.close()
  assert.deepEqual(await c.probe(), { status: 'unavailable' })
  assert.deepEqual(await c.send('unsent'), unavailable)
  assert.equal(opens, 0)
  const error = new Error('native probe response lost')
  const probed = deferNativeConnection({ ...binding, open: () => ({ probe: () => { throw error } }) })
  await assert.rejects(probed.probe(), actual => actual === error)
  await probed.close()
})

test('late resource cleanup failure is reported by close and cannot send a pending message', async () => {
  let resolveOpen, sends = 0
  const error = new Error('native helper cleanup failed')
  const c = deferNativeConnection({ ...binding, open: () => new Promise(resolve => { resolveOpen = resolve }) })
  const sent = c.send('must remain unsent')
  await Promise.resolve()
  const closing = c.close()
  resolveOpen({ send: () => { sends++ }, close: () => { throw error } })
  assert.deepEqual(await sent, unavailable)
  await assert.rejects(closing, actual => actual === error)
  assert.equal(sends, 0)
})
