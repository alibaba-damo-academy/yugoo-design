/** Installed SDK tool scheduler/Agent loop with a scripted adapter; no live model or Host profile. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDshTestRuntime } from './dsh-asar-test-loader.mjs'

assert.ok(process.env.DSH_TEST_WEB_ANCHOR, 'supply an exact installed SDK graph')
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
const stop = () => response([], { text: 'Reported the result without another Design invocation.' })

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'design-invocation-sdk-'))
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
  ctx.llm.registerAdapter(['design-fixture'], new Scripted())
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
    agentOptions: { provider: 'design-fixture', model: 'same-native-route' } })
  t.after(() => handle.dispose())
  const agent = handle.agent
  const user = (text = 'Generate the fixture design.') => llm.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  async function turn(text) { agent.followup(user(text)); await agent.whenIdle() }
  return { ctx, agent, user, turn, requests, runs, results, events: () => agent.session.snapshotEvents() }
}

test('an invocation without visible assistant text starts once and retains must_edit conclusion', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: () => missing() })
  await f.turn()
  assert.equal(f.requests.length, 1)
  assert.equal(f.runs.length, 1)
  assert.equal(f.results.length, 1)
  assert.equal(f.results[0].value.kind, 'await_user')
  assert.equal(f.results[0].value.gate.kind, 'must_edit')
  assert.equal(f.results[0].concludesTurn, true)
  assert.equal(f.events().filter(e => e.type === 'turn/end').length, 1)
})

test('normal in_progress work has no communication correction quota or forced end', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n < 2 ? missing() : stop(),
    run: () => ({ kind: 'in_progress', summary: 'Existing main engagement.' }) })
  await f.turn()
  assert.equal(f.requests.length, 3)
  assert.equal(f.runs.length, 2)
  assert.deepEqual(f.results.map(r => r.value.kind), ['in_progress', 'in_progress'])
  assert.ok(f.results.every(r => !r.concludesTurn && !r.isError))
})

for (const kind of ['invalid', 'failed', 'cancelled']) test(`controller ${kind} remains the actual outcome without protocol substitution`, { timeout: 15000 }, async t => {
  const value = kind === 'invalid'
    ? { kind, summary: 'Unknown Design skill.' }
    : { kind, summary: 'Execution did not complete.', diagnostics: ['explicit fixture failure'] }
  const f = await fixture(t, { step: n => n === 0 ? missing() : stop(), run: () => value })
  await f.turn()
  assert.equal(f.requests.length, 2)
  assert.equal(f.runs.length, 1)
  assert.equal(f.results.length, 1)
  assert.deepEqual(f.results[0].value, value)
  assert.notEqual(f.results[0].concludesTurn, true)
})

test('native tool permission refusal still prevents controller execution', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n === 0 ? missing() : stop() })
  f.ctx.tools.guard(exec => exec.name === 'run_design_skill' ? 'fixture permission refusal' : undefined)
  await f.turn()
  assert.equal(f.requests.length, 2)
  assert.equal(f.runs.length, 0)
  assert.equal(f.results.length, 1)
  assert.equal(f.results[0].isError, true)
  assert.match(f.results[0].error.message, /fixture permission refusal/)
})

test('a declared user_continue waits for a new human turn and preserves its exact action route', { timeout: 15000 }, async t => {
  const f = await fixture(t, { step: n => n === 0 ? missing() : n === 1 || n === 3
    ? response([{ name: 'example', action: { routeId: 'execute_plan' } }]) : stop(),
    run: request => request.action ? { kind: 'in_progress', summary: 'Accepted plan executing.' } : {
      kind: 'await_user', summary: 'Review the plan.', gate: { kind: 'user_continue',
        invocationId: request.invocationId, pin: { invocationId: request.invocationId,
          projectId: '11111111-1111-4111-8111-111111111111', kitName: 'fixture', kitVersion: '1.0',
          skillName: request.name, bundleVersion: '1.0', stateRevision: 'a'.repeat(40) },
        action: { routeId: 'execute_plan', label: { en: 'Execute plan', zh: '执行计划' } } },
    } })
  await f.turn()
  assert.equal(f.runs.length, 1)
  assert.equal(f.results[0].value.gate.kind, 'user_continue')
  assert.equal(f.results[1].isError, true)
  assert.match(f.results[1].error.message, /cannot run again in this user turn/)
  // Resume in the next actual Host turn, using the user's already selected route.
  await f.turn('Execute plan.')
  assert.equal(f.runs.length, 2)
  assert.deepEqual(f.runs[1].action, { routeId: 'execute_plan' })
  assert.deepEqual(f.events().filter(e => e.type === 'turn/start').map(e => e.data.turn), [1, 2])
})
