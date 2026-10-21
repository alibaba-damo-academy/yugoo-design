import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeReviewScheduler } from '../src/native-review-scheduler.mjs'
import { DesignReviewPublicationQueue } from '../../core/lib/index.js'

test('unverified background capability retains the publication queue without prepare, notice or retry loop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const policy = { mode: 'auto', autoMergeWindowMs: 1000, continuousIntervalMs: 60000 }
  const queue = new DesignReviewPublicationQueue(policy), state = {}, notices = [], prepared = []
  let ready = false, checks = 0, loseAfterPrepare = false
  const scheduler = createNativeReviewScheduler({ getPolicy: async () => policy, canDispatch: async () => { checks++; return ready },
    getConnectionPath: () => '/test/private-connection.json',
    project: { project: { metadata: { name: 'fixture' }, designFilesRoot: '/test/design_files' }, refreshAccess: async () => ({ writable: true }) },
    connection: { sendEvent: async message => { notices.push(message); return { accepted: true } } },
    reviews: { publicationQueue: async operation => operation(queue, state), publishedRevision: async checkpoint => ({ checkpoint }),
      preparePublicationReviews: async target => { prepared.push(target); if (loseAfterPrepare) ready = false; return { requests: [{ reviewId: 'exact-request', status: 'prepared', dispatch: true }] } } },
    onError: error => { throw error },
  })
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
  try {
    await scheduler.notify('', { checkpoint: 'first' }); await scheduler.notify('', { checkpoint: 'latest' })
    const attempts = checks
    t.mock.timers.tick(600000); await flush()
    assert.equal(checks, attempts, 'no readiness polling loop while capability is unknown')
    assert.equal(queue.size, 1); assert.equal(prepared.length, 0); assert.equal(notices.length, 0)
    ready = true; await scheduler.configure(); t.mock.timers.tick(1000); await flush()
    assert.equal(prepared.length, 1); assert.equal(prepared[0].checkpoint, 'latest')
    assert.equal(notices.length, 1); assert.match(notices[0], /exact-request/)
    assert.equal(state.nativeDelivery.status, 'queued', 'transport queue is never native running')
    assert.equal(queue.size, 0)
    loseAfterPrepare = true
    await scheduler.notify('', { checkpoint: 'next' }); t.mock.timers.tick(1000); await flush()
    assert.equal(prepared.length, 2); assert.equal(notices.length, 1)
    assert.equal(state.nativeDelivery.status, 'prepared-unavailable'); assert.equal(state.nativeDelivery.target.checkpoint, 'next')
    ready = true; await scheduler.configure(); t.mock.timers.tick(1000); await flush()
    assert.equal(prepared.length, 2, 'capability recovery reuses the same prepared request')
    assert.equal(notices.length, 2); assert.equal(state.nativeDelivery.status, 'queued')
  } finally { await scheduler.close() }
})

test('scheduler close waits for the final queue read before its storage can be removed', async () => {
  const policy = { mode: 'auto', autoMergeWindowMs: 0 }, queue = new DesignReviewPublicationQueue(policy), state = {}
  let release, entered, timeout, closing, closed = false
  const gate = new Promise(resolve => { release = resolve })
  const finalRead = new Promise(resolve => { entered = resolve })
  const scheduler = createNativeReviewScheduler({ getPolicy: async () => policy, canDispatch: async () => true,
    getConnectionPath: () => '/test/owned-connection.json',
    project: { project: { metadata: { name: 'fixture' }, designFilesRoot: '/test/design_files' }, refreshAccess: async () => ({ writable: true }) },
    connection: { sendEvent: async () => ({ accepted: true }) },
    reviews: {
      async publicationQueue(operation) {
        if (state.nativeDelivery?.status === 'queued') { entered(); await gate }
        return operation(queue, state)
      },
      publishedRevision: async checkpoint => ({ checkpoint }),
      preparePublicationReviews: async () => ({ requests: [{ reviewId: 'owned-request', status: 'prepared', dispatch: true }] }),
    }, onError: error => { throw error },
  })
  try {
    await scheduler.notify('', { checkpoint: 'head' })
    await Promise.race([finalRead, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Final queue read did not start')), 2000) })])
    clearTimeout(timeout)
    closing = scheduler.close().then(() => { closed = true })
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(closed, false, 'close must join the complete drain, including its final storage operation')
    release(); await closing
    assert.equal(closed, true)
  } finally { clearTimeout(timeout); release(); await (closing ?? scheduler.close()) }
})
