import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutoPanelTickets } from './src/auto-panel-tickets.mjs'

function fixture() {
  let time = 1, writes = 0, revision = 'source-1', origin, io = false
  let tail = Promise.resolve()
  const current = () => ({ projectId: 'project-1', definitionRevision: 'kit-1', sourceRevision: revision,
    context: { bundle: 'example', state: { text: 'saved fact' } },
    resolved: origin ? { status: 'ready', origin } : { status: 'missing' } })
  const options = { session: 'codex:authenticated-thread', now: () => time,
    inspect: async () => current(), prompt: () => 'shared prompt',
    mutate: operation => { const result = tail.then(operation); tail = result.catch(() => {}); return result },
    publish: async (_current, components) => {
      if (io) throw new Error('disk unavailable')
      if (!Array.isArray(components)) throw Object.assign(new Error('invalid catalog'), { autoPanelValidation: true })
      writes += 1; origin = 'generated'
    } }
  return { options, api: createAutoPanelTickets(options), writes: () => writes,
    tick: () => { time += 300_000 }, change: () => { revision = 'source-2' },
    retain: () => { origin = 'retained' }, failIO: () => { io = true } }
}

test('prepare does not dispatch or publish; concurrent identical requests merge and successful replay writes once', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([f.api.prepare({ skill: 'example' }), f.api.prepare({ skill: 'example' })])
  assert.equal(a.status, 'awaiting-agent'); assert.equal(a.requestId, b.requestId); assert.equal(f.writes(), 0)
  const request = { requestId: a.requestId, components: [] }
  const [first, replay] = await Promise.all([f.api.submit(request), f.api.submit(request)])
  assert.equal(first.status, 'ready'); assert.equal(replay.replay, true); assert.equal(f.writes(), 1)
  await assert.rejects(f.api.submit({ ...request, components: [{}] }), /payload differs/)
})

test('one bounded repair, then failure; oversized payload follows the same budget', async () => {
  const f = fixture(), a = await f.api.prepare({ skill: 'example' })
  const invalid = { requestId: a.requestId, components: 'x'.repeat(33_000) }
  const repair = await f.api.submit(invalid)
  assert.equal(repair.status, 'repair-required'); assert.equal(repair.attempt, 2)
  assert.equal((await f.api.submit(invalid)).status, 'failed'); assert.equal(f.writes(), 0)
  await assert.rejects(f.api.submit({ ...invalid, components: [] }), /no longer active/)
})

test('source mutation, expiry, restart/session replacement cannot publish old requests', async () => {
  for (const action of ['change', 'tick']) {
    const f = fixture(), a = await f.api.prepare({ skill: 'example' }); f[action]()
    await assert.rejects(f.api.submit({ requestId: a.requestId, components: [] }), /changed|expired/)
    assert.equal(f.writes(), 0)
  }
  const f = fixture(), a = await f.api.prepare({ skill: 'example' })
  const restarted = createAutoPanelTickets({ ...f.options, session: 'claude:other-session' })
  await assert.rejects(restarted.submit({ requestId: a.requestId, components: [] }), /expired/)
})

test('retained definition wins over in-flight generation; IO failure is not a model repair', async () => {
  const f = fixture(), a = await f.api.prepare({ skill: 'example' }); f.retain()
  assert.deepEqual(await f.api.submit({ requestId: a.requestId, components: [] }), { status: 'ready', origin: 'retained' })
  assert.equal(f.writes(), 0)
  const g = fixture(), b = await g.api.prepare({ skill: 'example' }); g.failIO()
  await assert.rejects(g.api.submit({ requestId: b.requestId, components: [] }), /disk unavailable/)
  assert.equal(g.api.states().example.phase, 'failed'); assert.equal(g.api.states().example.attempts, 1)
})
