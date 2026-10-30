import assert from 'node:assert/strict'
import test from 'node:test'
const { register } = await import('tsx/esm/api')
register()
const { Context } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { installDesignResumeRouting } = await import('../src/dsh-design-resume.ts')
const { createMainBundleBridge, activeMainBundleWork } = await import('../src/dsh-main-bundle.ts')
const { matchesDesignResumeAction } = await import('../src/design-execution-runtime.ts')
const { DESIGN_CORE_PROGRESSION_PROMPT } = await import('../src/design-core-prompt.ts')

const gate = {
  kind: 'user_continue', invocationId: 'plan-1',
  pin: { skillName: 'research', projectId: 'project-1' },
  action: { routeId: 'execute_plan', label: { zh: '开始调研', en: 'Start Research' } },
}
function harness() {
  const hooks = new Map(), sections = new Map(), calls = []
  const assembly = context => ({ sections: [...sections.values()].map(section => ({
    name: section.name, text: typeof section.text === 'function' ? section.text(context) : section.text,
  })) })
  let assembled = 0
  const agent = { session: { header: {}, events: [] }, ctx: { systemPrompt: {
    async assemble(context) {
      assembled++
      assert.equal(context.agent, agent)
      return hooks.get('system-prompt/assemble')(assembly(context), context, async () => ({ tools: ['scoped-design-tools'] }))
    },
  } } }
  const ctx = {
    on(name, callback) { hooks.set(name, callback) },
    systemPrompt: { section(section) { sections.set(section.name, section) } },
  }
  installDesignResumeRouting(ctx, async (_agent, text) => text.trim() === '开始调研' ? gate : undefined)
  return { hooks, calls, agent, sections, get assembled() { return assembled },
    hint: () => sections.get('design:accepted-resume').text({ agent }),
    claim(text, source = 'user', turn = 4) {
      hooks.get('agent/inbox/claimed')({ agent, turn,
        message: { source: { kind: source }, content: [{ type: 'text', text }] } })
    },
    assemble() {
      const context = { agent, signal: new AbortController().signal }
      return hooks.get('system-prompt/assemble')(assembly(context), context, async () => ({ tools: ['ordinary-tools'] }))
    },
  }
}
test('accepted continuation only directs the ordinary visible tool, never starts hidden work', async () => {
  const h = harness()
  h.claim('开始调研')
  assert.deepEqual(await h.assemble(), { tools: ['ordinary-tools'] })
  assert.equal(h.calls.length, 0)
  assert.equal(h.assembled, 0)
  assert.match(h.hint(), /NOT started yet/)
  assert.match(h.hint(), /"name":"research","action":\{"routeId":"execute_plan"\}/)
  assert.match(h.hint(), /Do not add a brief/)
  await h.assemble()
  assert.equal(h.calls.length, 0, 'assembly never executes a Bundle')
})

test('global continuation guidance agrees with the pending visible-tool hint', async () => {
  const h = harness()
  h.claim('开始调研')
  await h.assemble()
  const guidance = DESIGN_CORE_PROGRESSION_PROMPT.split('\n')
    .find(line => line.startsWith('When run_design_skill returns a user-continue action'))
  assert.ok(guidance)
  assert.match(guidance, /design:accepted-resume.*NOT started yet/)
  assert.match(guidance, /call run_design_skill with.*exact.*arguments/)
  assert.doesNotMatch(guidance, /already been entered|must not be invoked/)
  assert.match(h.hint(), /NOT started yet/)
  assert.match(h.hint(), /call run_design_skill with exactly/)
  assert.match(h.hint(), /In Producer mode stay attached.*in main mode follow the returned scoped method/)
})

test('the real SDK includes an accepted continuation in the first assembled request', async t => {
  const ctx = new Context()
  const promptPlugin = ctx.plugin(SystemPrompt, {})
  await promptPlugin
  t.after(() => promptPlugin.dispose())
  const events = []
  const agent = { session: { header: {}, snapshotEvents: () => [...events] } }
  let gateLookups = 0
  installDesignResumeRouting(ctx, async (_agent, text) => {
    gateLookups++
    return text === '开始调研' ? gate : undefined
  })
  ctx.systemPrompt.section({ name: 'test:before-resume', order: 570, text: 'before' })
  ctx.systemPrompt.section({ name: 'test:after-resume', order: 590, text: 'after' })
  ctx.emit('agent/inbox/claimed', { agent, turn: 4,
    message: { source: { kind: 'user' }, content: [{ type: 'text', text: '开始调研' }] } })
  const assemble = () => ctx.systemPrompt.assemble({ agent, signal: new AbortController().signal })
  const first = await assemble()
  const index = first.sections.findIndex(section => section.name === 'design:accepted-resume')
  assert.ok(index >= 0)
  assert.match(first.sections[index].text, /NOT started yet/)
  assert.match(first.sections[index].text, /"name":"research","action":\{"routeId":"execute_plan"\}/)
  assert.deepEqual(first.sections.slice(index - 1, index + 2).map(section => section.name),
    ['test:before-resume', 'design:accepted-resume', 'test:after-resume'])
  assert.deepEqual(first.tools, [], 'the hint grants no tool capabilities')
  assert.equal(gateLookups, 1)
  assert.deepEqual(events, [], 'assembly does not start an execution')
  events.push({ type: 'tool/call', data: { turn: 4, name: 'run_design_skill' } })
  const afterAttempt = await assemble()
  assert.equal(afterAttempt.sections.find(section => section.name === 'design:accepted-resume').text, '')
  assert.equal(gateLookups, 1, 'tool retirement does not retry gate resolution')
  assert.match(first.sections[index].text, /NOT started yet/, 'later assembly cannot rewrite the earlier request')
})

test('official snapshot-only Session preserves continuation claim and retirement', async () => {
  const h = harness()
  const events = h.agent.session.events
  delete h.agent.session.events
  h.agent.session.snapshotEvents = () => Object.freeze([...events])
  h.claim('开始调研')
  await h.assemble()
  assert.match(h.hint(), /NOT started yet/)
  events.push({ type: 'tool/call', data: { turn: 4, name: 'run_design_skill' } })
  assert.equal(h.hint(), '')
})
test('a real native tool attempt retires continuation guidance, regardless of its outcome', async () => {
  const h = harness()
  h.claim('开始调研')
  await h.assemble()
  h.agent.session.events.push({ type: 'tool/call', data: { turn: 4, name: 'run_design_skill', callId: 'native-1' } })
  assert.equal(h.hint(), '')
  await h.assemble()
  assert.equal(h.hint(), '', 'no repeated guidance after failure, cancellation or main in_progress')
})
test('background notices, mixed scope changes and child input never authorize resume', async () => {
  for (const kind of ['plugin', 'changed', 'mixed', 'child']) {
    const h = harness()
    if (kind === 'child') h.agent.session.header.origin = 'subagent'
    h.claim(kind === 'changed' ? '开始调研，但是更换调研范围' : '开始调研', kind === 'plugin' ? 'plugin' : 'user')
    if (kind === 'mixed') h.claim('调整范围')
    await h.assemble()
    assert.equal(h.calls.length, 0, kind)
    assert.equal(h.hint(), '', kind)
  }
})
test('ending the turn discards unprocessed controls and the prior result', async () => {
  const h = harness()
  h.claim('开始调研')
  h.hooks.get('agent/turn-stopping')({ agent: h.agent })
  await h.assemble()
  assert.equal(h.calls.length, 0)
  assert.equal(h.hint(), '')
})
test('later human scope changes clear the previous continuation, while old tool calls do not consume new intent', async () => {
  const h = harness()
  h.claim('开始调研')
  await h.assemble()
  h.agent.session.events.push({ type: 'tool/call', data: { turn: 3, name: 'run_design_skill' } })
  assert.match(h.hint(), /run_design_skill/)
  h.claim('修改范围', 'user', 5)
  await h.assemble()
  assert.equal(h.hint(), '')
})

test('cancellation clears intent; an explicit later continuation may retry without inheriting old calls', async () => {
  const h = harness()
  h.claim('开始调研')
  await h.assemble()
  h.agent.session.events.push({ type: 'tool/call', data: { turn: 4, name: 'run_design_skill' } })
  assert.equal(h.hint(), '')
  h.hooks.get('agent/turn-stopping')({ agent: h.agent })
  h.claim('开始调研', 'user', 5)
  await h.assemble()
  assert.match(h.hint(), /"routeId":"execute_plan"/)
})

test('an aborted gate lookup cannot publish continuation guidance', async () => {
  const hooks = new Map(), sections = new Map()
  const abort = new AbortController()
  const agent = { session: { header: {}, events: [] } }
  installDesignResumeRouting({ on: (name, fn) => hooks.set(name, fn),
    systemPrompt: { section: section => sections.set(section.name, section) } }, async () => {
    abort.abort()
    return gate
  })
  hooks.get('agent/inbox/claimed')({ agent, turn: 1,
    message: { source: { kind: 'user' }, content: [{ type: 'text', text: '开始调研' }] } })
  await assert.rejects(hooks.get('system-prompt/assemble')({}, { agent, signal: abort.signal }, async () => ({})),
    { name: 'AbortError' })
  assert.equal(sections.get('design:accepted-resume').text({ agent }), '')
})

test('resume matching preserves aliases and normalization without accepting scope changes', () => {
  const action = { ...gate.action, aliases: { zh: ['执行调研计划'], en: [] } }
  for (const text of ['开始调研！', ' START RESEARCH. ', '执行调研计划']) {
    assert.equal(matchesDesignResumeAction(action, text), true)
  }
  assert.equal(matchesDesignResumeAction(action, '开始调研，但是改变方向'), false)
})

test('main handoff and resume reinstall the same scoped files and Worker delegation without host writes', async () => {
  const definitions = new Map(), listeners = new Map(), restrictions = [], files = new Map()
  let delegationInstalls = 0, published = 0, delegatedPending = false, invalid = false
  const agent = { session: { id: 'main', header: { cwd: '/unrelated/application' } }, ctx: {
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name) },
    plugin({ apply }) {
      apply({ tools: {
        restrict(policy) { restrictions.push(policy.allow) },
        register(tool) { definitions.set(tool.name, tool) },
      }, systemPrompt: { section() {} }, on() {} })
      return Object.assign(Promise.resolve(), { async dispose() { definitions.clear() } })
    },
  } }
  const workspace = {
    async read(path) { return files.get(path) },
    async write(path, value) {
      assert.ok(path.startsWith('research/'), 'same Bundle authority in both placements')
      files.set(path, value)
    },
    async publish() {
      if (invalid) return { kind: 'invalid', diagnostics: ['missing findings reference'] }
      return { kind: 'published', stateRevision: `commit-${++published}`, diff: 'canonical and artifacts' }
    },
  }
  const bridge = createMainBundleBridge({ run() { throw new Error('main must not spawn a Producer') } })
  const port = bridge.wrap({ async run(request) {
    const receipt = await bridge.runtime.run({ parent: request.agent, workspace,
      resources: {}, handoff: 'user_continue', allowedInheritedTools: ['read', 'web_search'],
      systemPrompt: 'research method', prompt: 'accepted research plan', signal: request.signal,
      activity: {}, delegation: {
        install(ctx) { delegationInstalls++; ctx.tools.register({ name: 'design_delegate_frontier', execute: async () => 'worker-receipt' }) },
        settlementDiagnostics() { return delegatedPending ? ['Worker still active'] : [] },
      },
    })
    return receipt.kind === 'pause' ? { kind: 'await_user', summary: 'Plan ready' }
      : { kind: 'completed', summary: 'Published', projectRoot: '/design-project', stateRevision: receipt.stateRevision,
        clarity: { status: 'failed', summary: 'test omits evaluator' } }
  } }, () => true, () => 'project-1')
  const signal = new AbortController().signal
  const exec = { agent, signal, concludeTurn() {} }
  for (const action of ['handoff', 'complete']) {
    const ready = await port.run({ agent, name: 'research', signal, invocationId: `main-${action}`, rootCallId: `call-${action}` })
    assert.equal(ready.kind, 'in_progress')
    assert.equal(activeMainBundleWork(agent).skillName, 'research')
    assert.equal(activeMainBundleWork(agent, 'project-1').invocationId, `main-${action}`)
    assert.equal(activeMainBundleWork(agent, 'other-project'), undefined, 'another project cannot inherit the panel lock')
    assert.deepEqual(restrictions.at(-1), ['read', 'web_search'])
    assert.equal(await definitions.get('design_delegate_frontier').execute(), 'worker-receipt')
    await definitions.get('write').execute({ path: 'research/research.json', content: '{"stage":"executing"}' }, exec)
    assert.equal((await definitions.get('read_design_file').execute({ path: 'research/research.json' }, exec)).content,
      '{"stage":"executing"}')
    delegatedPending = true
    assert.equal((await definitions.get('design_publish').execute({ action }, exec)).kind, 'invalid')
    assert.equal(published, action === 'handoff' ? 0 : 1, 'active Worker cannot be claimed completed')
    delegatedPending = false; invalid = true
    assert.equal((await definitions.get('design_publish').execute({ action }, exec)).kind, 'invalid')
    invalid = false
    assert.equal((await definitions.get('design_publish').execute({ action }, exec)).kind, 'published')
    assert.equal(activeMainBundleWork(agent), undefined)
    assert.equal(activeMainBundleWork(agent, 'project-1'), undefined, 'settlement clears the project-bound panel lock')
    assert.equal(definitions.has('design_publish'), false, 'scoped tools revoke after settlement')
  }
  assert.equal(delegationInstalls, 2)
  assert.equal(published, 2)
})
