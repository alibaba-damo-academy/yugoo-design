import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api'); register()
const { apply } = await import('../src/dsh-run-design-skill-tool.ts')

test('snapshot-only host starts authorized work without scanning assistant text', async () => {
  for (const variant of ['missing', 'wrong-step', 'wrong-turn', 'after-call', 'reasoning', 'empty']) {
    let tool, runs = 0
    apply({ on() {}, tools: { register(definition) { tool = definition } } }, {
      onMainSettlement() {},
      async run() { runs++; return { kind: 'in_progress', summary: 'started' } },
    })
    const call = { type: 'tool/call', data: { turn: 1, step: 1, callId: 'root', name: 'run_design_skill' } }
    const message = { type: 'assistant/message', data: { turn: variant === 'wrong-turn' ? 2 : 1,
      step: variant === 'wrong-step' ? 2 : 1, message: { content: [{
        type: variant === 'reasoning' ? 'reasoning' : 'text', text: variant === 'empty' ? ' ' : 'Progress update.',
      }] } } }
    const history = variant === 'missing' ? [call] : variant === 'after-call' ? [call, message] : [message, call]
    const session = {
      snapshotEvents() { return history },
      ownEvents() { throw new Error('full snapshot required') },
      get events() { throw new Error('must not inspect legacy accessor on official host') },
    }
    const exec = { agent: { session }, rootCallId: 'root', signal: new AbortController().signal }
    assert.equal((await tool.execute({ name: 'example' }, exec)).kind, 'in_progress', variant)
    assert.equal(runs, 1, variant)
  }
})

function continueFixture({ recorded = true, main = false } = {}) {
  let tool
  const hooks = new Map(), history = [], runs = [], settlements = []
  const waiting = { kind: 'await_user', summary: 'Confirm the saved plan.',
    gate: { kind: 'user_continue', invocationId: 'plan', pin: { invocationId: 'plan', projectId: 'project',
      kitName: 'fixture', kitVersion: '1.0', skillName: 'example', bundleVersion: '1.0', stateRevision: 'a'.repeat(40) },
    action: { routeId: 'run', label: { en: 'Run', zh: '运行' } } } }
  apply({ on(name, callback) { hooks.set(name, callback) },
    tools: { register(definition) { tool = definition } } }, {
    async run(request) { runs.push(request); return main ? { kind: 'in_progress', summary: 'started' } : waiting },
    onMainSettlement(_agent, callback) { settlements.push(callback) },
  })
  const agent = { session: recorded ? { snapshotEvents: () => history } : {} }
  function invoke(turn, action) {
    const rootCallId = `call-${history.length}`
    history.push({ type: 'tool/call', data: { turn, step: 1, callId: rootCallId, name: 'run_design_skill' } })
    return tool.execute({ name: 'example', ...(action ? { action: { routeId: 'run' } } : {}) },
      { agent, rootCallId, signal: new AbortController().signal })
  }
  return { invoke, runs, waiting, settlements, stop: () => hooks.get('agent/turn-stopping')?.({ agent }) }
}

test('a new recorded Host turn reaches the controller without relying on turn-stopping cleanup', async () => {
  const f = continueFixture()
  assert.equal((await f.invoke(11)).kind, 'await_user')
  assert.equal((await f.invoke(12, true)).kind, 'await_user')
  assert.equal(f.runs.length, 2)
  assert.deepEqual(f.runs[1].action, { routeId: 'run' })
})

for (const action of [false, true]) test(`same-turn ${action ? 'action' : 'engagement'} stays blocked across stopping/steering`, async () => {
  const f = continueFixture()
  await f.invoke(11)
  await assert.rejects(f.invoke(11, action), /cannot run again in this user turn/)
  f.stop()
  await assert.rejects(f.invoke(11, action), /cannot run again in this user turn/)
  assert.equal(f.runs.length, 1)
})

test('late main-mode settlement retains the original turn and cannot overwrite a newer wait', async () => {
  const f = continueFixture({ main: true })
  await f.invoke(11)
  await f.invoke(12)
  await f.settlements[1](f.waiting)
  await f.settlements[0](f.waiting)
  await assert.rejects(f.invoke(12, true), /cannot run again in this user turn/)
  assert.equal((await f.invoke(13, true)).kind, 'in_progress')
  assert.equal(f.runs.length, 3)
})

test('an older main settlement alone does not mark the currently active turn as waiting', async () => {
  const f = continueFixture({ main: true })
  await f.invoke(11)
  await f.invoke(12)
  await f.settlements[0](f.waiting)
  assert.equal((await f.invoke(12, true)).kind, 'in_progress')
})

test('hosts without recorded turn identity retain the conservative stop-cleanup fallback', async () => {
  const f = continueFixture({ recorded: false })
  await f.invoke(11)
  await assert.rejects(f.invoke(12, true), /cannot run again in this user turn/)
  f.stop()
  assert.equal((await f.invoke(12, true)).kind, 'await_user')
})
