import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoPanelJobs } from '../src/auto-panel-jobs.ts'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('one target runs once and a failed target requires a new explicit target', async () => {
  const jobs = new AutoPanelJobs()
  let calls = 0
  assert.equal(jobs.request('p:b', 'r1', 'agent-a', async () => { calls += 1; throw new Error('bad model') }), 'scheduled')
  await tick()
  assert.equal(jobs.status('p:b')?.phase, 'failed')
  assert.equal(jobs.request('p:b', 'r1', 'agent-a', async () => { calls += 1 }), 'noop')
  await tick()
  assert.equal(calls, 1)
  assert.equal(jobs.request('p:b', 'r2', 'agent-a', async () => { calls += 1 }), 'scheduled')
  await tick()
  assert.equal(jobs.status('p:b')?.phase, 'ready')
  assert.equal(calls, 2)
  jobs.dispose()
})

test('new revision cancels active work and runs only the latest target', async () => {
  const jobs = new AutoPanelJobs()
  let started
  const began = new Promise(resolve => { started = resolve })
  let oldAborted = false
  jobs.request('p:b', 'r1', 'agent-a', async signal => {
    started()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    oldAborted = true
    throw new Error('superseded')
  })
  await began
  let latest = 0
  assert.equal(jobs.request('p:b', 'r2', 'agent-a', async () => { latest += 1 }), 'merged')
  await tick()
  assert.equal(oldAborted, true)
  assert.equal(latest, 1)
  assert.equal(jobs.status('p:b')?.phase, 'ready')
  assert.equal(jobs.status('p:b')?.target, 'r2')
  assert.ok(jobs.status('p:b')?.durationMs >= 0)
  jobs.dispose()
})

test('another session takes over the same target while the first run is active', async () => {
  const jobs = new AutoPanelJobs()
  let started
  const began = new Promise(resolve => { started = resolve })
  let oldAborted = false
  jobs.request('p:b', 'r1', 'agent-a', async signal => {
    started()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    oldAborted = true
    throw new Error('first agent closed')
  })
  await began
  let successor = 0
  assert.equal(jobs.request('p:b', 'r1', 'agent-b', async () => { successor += 1 }), 'merged')
  assert.equal(jobs.request('p:b', 'r1', 'agent-a', async () => { throw new Error('old owner') }), 'noop')
  await tick()
  assert.equal(oldAborted, true)
  assert.equal(successor, 1)
  assert.equal(jobs.status('p:b')?.phase, 'ready')
  assert.equal(jobs.status('p:b')?.target, 'r1')
  jobs.dispose()
})

test('another session can recover a failed same-target run without an automatic retry loop', async () => {
  const jobs = new AutoPanelJobs()
  jobs.request('p:b', 'r1', 'agent-a', async () => { throw new Error('session closed') })
  await tick()
  assert.equal(jobs.status('p:b')?.phase, 'failed')
  let successor = 0
  assert.equal(jobs.request('p:b', 'r1', 'agent-b', async () => { successor += 1 }), 'scheduled')
  await tick()
  assert.equal(successor, 1)
  assert.equal(jobs.status('p:b')?.phase, 'ready')
  assert.equal(jobs.request('p:b', 'r1', 'agent-b', async () => { successor += 1 }), 'noop')
  jobs.dispose()
})

test('completed jobs expose bounded generation diagnostics', async () => {
  const jobs = new AutoPanelJobs()
  jobs.request('p:b', 'r1', 'agent-a', async () => ({ attempts: 2, fallbackReason: 'invalid layout' }))
  await tick()
  const status = jobs.status('p:b')
  assert.equal(status?.phase, 'ready')
  assert.equal(status?.attempts, 2)
  assert.equal(status?.fallbackReason, 'invalid layout')
  assert.ok(status?.durationMs >= 0)
  jobs.dispose()
})
