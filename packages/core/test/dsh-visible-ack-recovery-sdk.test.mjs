/** Real RC2 tool scheduler/Agent loop with a scripted adapter; no live model or Host profile. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDshTestRuntime } from './dsh-asar-test-loader.mjs'

assert.ok(process.env.DSH_TEST_WEB_ANCHOR, 'supply an exact installed RC2 SDK graph')
const runtime = loadDshTestRuntime({ webAnchor: process.env.DSH_TEST_WEB_ANCHOR })
const { Context } = await import('@deepseek-ai/cordis')
const { apply } = await import('../src/dsh-run-design-skill-tool.ts')
const [llm, sessions, prompt, tools, agents, loop, projections] = await Promise.all(
  ['dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-agent-loop', 'dsh-session-projection']
    .map(name => import('@deepseek-ai/' + name)))
test.after(() => runtime.close())

function response(calls, { text, reasoning } = {}) {
  const blocks = [
    ...(reasoning === undefined ? [] : [{ type: 'reasoning', text: reasoning }]),
    ...(text === undefined ? [] : [{ type: 'text', text }]),
    ...calls.map(args => ({ type: 'tool-call', id: llm.ToolCallId(randomUUID()), name: 'run_design_skill', arguments: JSON.stringify(args) })),
  ]
  return blocks.flatMap((block, index) => [
    { type: 'block-start', index, blockType: block.type },
    { type: 'block-end', index, block },
  ]).concat([
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' } },
  ])
}
const missing = (name = 'example', brief = 'Original bounded task.') => response([{ name, brief }], {
  reasoning: 'I will run the localized skill and persist its result. This is reasoning, not visible text.',
})
const acknowledged = args => response([args ?? { name: 'example' }], { text: 'I will run Example and persist the requested design.' })
const stop = () => response([], { text: 'Reported the result without another Design invocation.' })

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'visible-ack-sdk-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const [plugin, config] of [[llm.default], [sessions.default], [prompt.default, { persona: 'bounded fixture' }],
    [tools.default], [projections.default], [agents.default], [loop.default, { agents: [] }]]) await ctx.plugin(plugin, config)
  const requests = [], runs = [], results = []
  class Scripted extends llm.LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) {
      const index = requests.length
      requests.push(request)
      assert.ok(index < 10, 'scripted model requests remain bounded')
      yield* await options.step(index, request)
    }
  }
  ctx.llm.registerAdapter(['ack-fixture'], new Scripted())
  apply(ctx, {
    onMainSettlement() {},
    async run(request) {
      runs.push(request)
      if (options.run) return options.run(request)
      return { kind: 'await_user', summary: 'Edit the saved result.', gate: { kind: 'must_edit',
        invocationId: request.invocationId, pin: { invocationId: request.invocationId,
          projectId: '11111111-1111-4111-8111-111111111111', kitName: 'fixture', kitVersion: '1.0',
          skillName: request.name, bundleVersion: '1.0', stateRevision: 'a'.repeat(40) } } }
    },
  })
  ctx.on('tools/result', (exec, result) => {
    if (exec.name === 'run_design_skill') results.push({ callId: exec.callId, ...result })
  })
  const handle = await ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: root },
    agentOptions: { provider: 'ack-fixture', model: 'same-native-route' } })
  t.after(() => handle.dispose())
  const agent = handle.agent
  const user = () => llm.createUserMessage({ content: [{ type: 'text', text: 'Generate the bounded fixture design.' }], source: { kind: 'user' } })
  async function turn() { agent.followup(user()); await agent.whenIdle() }
  return { ctx, agent, user, turn, requests, runs, results, events: () => agent.session.snapshotEvents() }
}

test('real loop stops after a single missing-visible correction despite changed callId/name/brief', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n === 0 ? missing() : missing('other-name', 'Changed brief cannot mint a budget.') })
  await f.turn()
  assert.equal(f.requests.length, 2)
  assert.equal(f.runs.length, 0)
  assert.deepEqual(f.results.map(r => r.concludesTurn === true), [false, true])
  assert.ok(f.results.every(r => !r.isError && r.value.kind === 'invalid'))
  assert.match(f.results[0].value.summary, /retry this Design action once/)
  assert.match(f.results[1].value.summary, /correction limit.*reached/)
  assert.notEqual(f.results[0].callId, f.results[1].callId)
  assert.equal(f.events().filter(e => e.type === 'turn/end').length, 1)
})

test('one visible correction starts the controller exactly once and preserves must_edit conclusion', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n === 0 ? missing() : acknowledged() })
  await f.turn()
  assert.equal(f.requests.length, 2)
  assert.equal(f.runs.length, 1)
  assert.deepEqual(f.results.map(r => r.value.kind), ['invalid', 'await_user'])
  assert.equal(f.results[1].value.gate.kind, 'must_edit')
  assert.equal(f.results[1].concludesTurn, true)
})

test('concurrent same-step calls share one correction and all drain before the turn ends', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: () => response([
    { name: 'first', brief: 'A' }, { name: 'second', brief: 'B' }, { name: 'third', brief: 'C' },
  ]) })
  await f.turn()
  assert.equal(f.requests.length, 1)
  assert.equal(f.runs.length, 0)
  assert.equal(f.results.length, 3)
  assert.equal(f.results.filter(r => r.concludesTurn).length, 2)
  assert.equal(f.results.filter(r => /retry this Design action once/.test(r.value.summary)).length, 1)
  const calls = f.events().filter(e => e.type === 'tool/call')
  assert.equal(new Set(calls.map(e => e.data.turn)).size, 1)
  assert.equal(new Set(calls.map(e => e.data.step)).size, 1)
  assert.equal(f.events().filter(e => e.type === 'tool/result').length, 3)
})

test('a new actual Host turn receives a fresh correction budget', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n === 3 ? acknowledged() : missing() })
  await f.turn()
  await f.turn()
  assert.equal(f.requests.length, 4)
  assert.equal(f.runs.length, 1)
  assert.deepEqual(f.results.map(r => r.concludesTurn === true), [false, true, false, true])
  assert.deepEqual(f.events().filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2])
})

test('turn-stopping steering cannot reopen a closed budget even with later visible text', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n < 2 ? missing() : acknowledged() })
  let steered = false
  f.ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent === f.agent && !steered) { steered = true; agent.steer(f.user()) }
  })
  await f.turn()
  assert.equal(steered, true)
  assert.equal(f.requests.length, 3)
  assert.equal(f.runs.length, 0)
  assert.deepEqual(f.results.map(r => r.concludesTurn === true), [false, true, true])
  assert.equal(f.events().filter(e => e.type === 'turn/start').length, 1)
  assert.equal(f.events().filter(e => e.type === 'turn/end').length, 1)
})

for (const kind of ['invalid', 'failed', 'cancelled']) test(`real controller ${kind} does not acquire missing-visible recovery`, { timeout: 15000 }, async t => {
  const value = kind === 'invalid'
    ? { kind, summary: 'Unknown Design skill.' }
    : { kind, summary: 'Execution did not complete.', diagnostics: ['explicit fixture failure'] }
  const f = await fixture(t, { step: n => n === 0 ? acknowledged() : stop(), run: () => value })
  await f.turn()
  assert.equal(f.requests.length, 2)
  assert.equal(f.runs.length, 1)
  assert.equal(f.results.length, 1)
  assert.equal(f.results[0].value.kind, kind)
  assert.notEqual(f.results[0].concludesTurn, true)
  assert.doesNotMatch(f.results[0].value.summary, /correction|retry/)
})

test('native permission refusal does not consume the acknowledgement correction', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: () => missing() })
  let denied = true
  f.ctx.tools.guard(exec => exec.name === 'run_design_skill' && denied ? 'fixture permission refusal' : undefined)
  f.ctx.on('tools/result', (exec, result) => { if (exec.name === 'run_design_skill' && result.isError) denied = false })
  await f.turn()
  assert.equal(f.requests.length, 3)
  assert.equal(f.runs.length, 0)
  assert.equal(f.results[0].isError, true)
  assert.match(f.results[1].value.summary, /retry this Design action once/)
  assert.equal(f.results[2].concludesTurn, true)
})

test('same-turn successful correction does not refund the budget for a later invocation', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n === 1 ? acknowledged() : missing(),
    run: () => ({ kind: 'in_progress', summary: 'Existing main engagement.' }) })
  await f.turn()
  assert.equal(f.requests.length, 3)
  assert.equal(f.runs.length, 1)
  assert.equal(f.results[2].value.kind, 'invalid')
  assert.equal(f.results[2].concludesTurn, true)
})

test('two actual Agents at the same numeric turn do not share correction budgets', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: () => missing() })
  const other = await f.ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()),
    meta: { cwd: f.agent.session.header.cwd }, agentOptions: { provider: 'ack-fixture', model: 'same-native-route' } })
  t.after(() => other.dispose())
  f.agent.followup(f.user()); other.agent.followup(f.user())
  await Promise.all([f.agent.whenIdle(), other.agent.whenIdle()])
  assert.equal(f.requests.length, 4)
  assert.equal(f.runs.length, 0)
  assert.equal(f.results.filter(r => !r.concludesTurn).length, 2)
  assert.equal(f.results.filter(r => r.concludesTurn).length, 2)
  for (const agent of [f.agent, other.agent]) {
    assert.deepEqual(agent.session.snapshotEvents().filter(e => e.type === 'turn/start').map(e => e.data.turn), [1])
  }
})

test('a current explicit user-continue action keeps its original route without a new acknowledgement', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n < 2 ? missing() : response([{ name: 'example', action: { routeId: 'execute_plan' } }]) })
  let steered = false
  f.ctx.on('agent/turn-stopping', ({ agent }) => {
    if (agent === f.agent && !steered) { steered = true; agent.steer(f.user()) }
  })
  await f.turn()
  assert.equal(f.requests.length, 3)
  assert.equal(f.runs.length, 1)
  assert.deepEqual(f.runs[0].action, { routeId: 'execute_plan' })
  assert.equal(f.results[2].value.kind, 'await_user')
})

test('snapshot guard still rejects wrong-step, wrong-turn, later and non-visible text', async () => {
  for (const variant of ['wrong-step', 'wrong-turn', 'after-call', 'reasoning', 'empty']) {
    let definition, runs = 0
    apply({ on() {}, tools: { register(value) { definition = value } } }, {
      async run() { runs++; return { kind: 'in_progress', summary: 'started' } },
      onMainSettlement() {},
    })
    const message = { type: 'assistant/message', data: { turn: variant === 'wrong-turn' ? 1 : 2,
      step: variant === 'wrong-step' ? 1 : 2, message: { content: [{ type: variant === 'reasoning' ? 'reasoning' : 'text', text: variant === 'empty' ? '  ' : 'Visible acknowledgement.' }] } } }
    const call = { type: 'tool/call', data: { turn: 2, step: 2, callId: 'root', name: 'run_design_skill' } }
    const events = variant === 'after-call' ? [call, message] : [message, call]
    const result = await definition.execute({ name: 'example' }, {
      agent: { session: { snapshotEvents: () => events } }, rootCallId: 'root', signal: new AbortController().signal,
    })
    assert.equal(result.kind, 'invalid', variant)
    assert.equal(runs, 0, variant)
  }
})
