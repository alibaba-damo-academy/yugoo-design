import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { DEFAULT_DESIGN_REVIEW_POLICY, parseDesignReviewPolicy, readDesignReviewPolicy, writeDesignReviewPolicy,
  DesignReviewPublicationQueue, DesignContinuousReviewClock } = await import('../src/design-review-policy.ts')

test('continuous cadence repeats without publications, preserves timer on reread, and stops when disabled', async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const policy={mode:'continuous',autoMergeWindowMs:30000,continuousIntervalMs:60000}
  let calls=0
  const clock=new DesignContinuousReviewClock(async()=>{calls++},error=>{throw error})
  clock.configure(policy)
  t.mock.timers.tick(30000)
  clock.configure(policy)
  t.mock.timers.tick(30000)
  await Promise.resolve(); await Promise.resolve()
  assert.equal(calls,1)
  t.mock.timers.tick(60000)
  await Promise.resolve(); await Promise.resolve()
  assert.equal(calls,2)
  clock.configure({...policy,mode:'off'})
  t.mock.timers.tick(600000)
  assert.equal(calls,2)
  clock.close()
  const queue=new DesignReviewPublicationQueue(policy)
  assert.equal(queue.publish({checkpoint:'unchanged'},0),false)
  assert.throws(()=>parseDesignReviewPolicy({...policy,continuousIntervalMs:59000}))
})

test('project policy defaults to 30 seconds and persists independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gra-policy-'))
  try {
    assert.deepEqual(await readDesignReviewPolicy(root), DEFAULT_DESIGN_REVIEW_POLICY)
    await writeDesignReviewPolicy(root, { mode: 'off', autoMergeWindowMs: 45000 })
    assert.deepEqual(await readDesignReviewPolicy(root), { mode: 'off', autoMergeWindowMs: 45000 })
    assert.deepEqual(await readDesignReviewPolicy(join(root, 'another-project')), DEFAULT_DESIGN_REVIEW_POLICY)
    await writeFile(join(root, 'gra-policy.json'), '{broken')
    await assert.rejects(readDesignReviewPolicy(root))
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('invalid modes and timing cannot silently enable reviews', () => {
  for (const mode of ['unknown', null]) assert.throws(() => parseDesignReviewPolicy({ mode, autoMergeWindowMs: 30000 }))
  for (const autoMergeWindowMs of [-1, 1.5, Infinity, '30000', 3600001]) {
    assert.throws(() => parseDesignReviewPolicy({ mode: 'auto', autoMergeWindowMs }))
  }
})
test('auto merges quiet-window publications; duplicate notifications do not postpone dispatch', () => {
  const q = new DesignReviewPublicationQueue()
  q.publish({ checkpoint: 'a' }, 0)
  q.publish({ checkpoint: 'b' }, 10000)
  assert.equal(q.publish({ checkpoint: 'b' }, 39000), false)
  assert.equal(q.take(39999), undefined)
  assert.deepEqual(q.take(40000), { checkpoint: 'b' })
})
test('every publication retains exact targets and off clears pending without automatic retry', () => {
  const q = new DesignReviewPublicationQueue({ mode: 'every-publication', autoMergeWindowMs: 30000 })
  for (const checkpoint of ['a', 'b', 'c', 'c']) q.publish({ checkpoint }, 0)
  assert.equal(q.size, 3)
  assert.deepEqual(q.take(0), { checkpoint: 'a' })
  q.configure({ mode: 'off', autoMergeWindowMs: 30000 })
  assert.equal(q.size, 0)
  assert.equal(q.publish({ checkpoint: 'd' }, 0), false)
  q.configure(DEFAULT_DESIGN_REVIEW_POLICY)
  assert.equal(q.publish({ checkpoint: 'c' }, 0), false)
  assert.equal(q.publish({ checkpoint: 'd' }, 0), true)
  assert.deepEqual(q.take(0, true), { checkpoint: 'd' })
})
test('changing every-publication to auto cannot merge away an already admitted target', () => {
  const q = new DesignReviewPublicationQueue({ mode: 'every-publication', autoMergeWindowMs: 30000 })
  q.publish({ checkpoint: 'a' }, 0)
  q.configure(DEFAULT_DESIGN_REVIEW_POLICY)
  q.publish({ checkpoint: 'b' }, 0)
  q.publish({ checkpoint: 'c' }, 0)
  assert.equal(q.size, 2)
  assert.deepEqual(q.take(30000), { checkpoint: 'a' })
  assert.deepEqual(q.take(30000), { checkpoint: 'c' })
})
test('queue roundtrip resumes pending versions but does not re-admit an attempted version', () => {
  const q = new DesignReviewPublicationQueue({ mode: 'every-publication', autoMergeWindowMs: 30000 })
  q.publish({ checkpoint: 'a' }, 0)
  q.publish({ checkpoint: 'b' }, 0)
  assert.deepEqual(q.take(0), { checkpoint: 'a' })
  const resumed = DesignReviewPublicationQueue.restore(JSON.parse(JSON.stringify(q.snapshot())), value => value)
  assert.equal(resumed.publish({ checkpoint: 'a' }, 0), false)
  assert.deepEqual(resumed.take(0), { checkpoint: 'b' })
  assert.equal(resumed.size, 0)
  assert.throws(() => DesignReviewPublicationQueue.restore({schemaVersion: 1, seen: [], pending: [], dueAt: -1}, value=>value))
})
test('long-lived completed identity history does not make persisted queues unreadable',()=>{
  const q=new DesignReviewPublicationQueue({mode:'every-publication',autoMergeWindowMs:30000})
  for(let i=0;i<10001;i++){q.publish({checkpoint:`c-${i}`},0);q.take(0)}
  const restored=DesignReviewPublicationQueue.restore(JSON.parse(JSON.stringify(q.snapshot())),value=>value)
  assert.equal(restored.size,0)
  assert.equal(restored.publish({checkpoint:'c-0'},0),false)
})
test('mixed mode queues do not postpone every-publication work behind a later auto window',()=>{
  const q=new DesignReviewPublicationQueue({mode:'every-publication',autoMergeWindowMs:30000})
  q.publish({checkpoint:'every'},0)
  q.configure(DEFAULT_DESIGN_REVIEW_POLICY)
  q.publish({checkpoint:'auto'},0)
  assert.equal(q.delay(1),0)
  assert.deepEqual(q.take(1),{checkpoint:'every'})
  assert.equal(q.take(1),undefined)
  q.configure({mode:'auto',autoMergeWindowMs:100})
  assert.deepEqual(q.take(100),{checkpoint:'auto'})
})
