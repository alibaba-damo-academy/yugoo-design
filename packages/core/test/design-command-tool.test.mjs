import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api')
register()
const { default: DesignService } = await import('../src/design-service.ts')

test('main tool command uses shared project lifecycle without steering a user message', async () => {
  const calls = []
  const selections = []
  let selected
  const project = { projectId: 'project-1', name: '科研平台', root: '/tmp/project-1', knowledge: { provider: 'test' } }
  const owner = {
    projects: {
      create: async (name) => { calls.push(name); return project },
      snapshot: async () => ({ checkpoint: 'head', bundleStates: {} }),
      list: async () => [project],
      open: async () => project,
    },
    requireKnowledgeRuntime: () => ({ defaultProvider: 'test' }),
    advisoryRuntimeStatus: () => undefined,
    conversationPort: () => ({
      current: async () => selected,
      select: async record => { selected = { projectId: record.projectId }; return { revision: 1 } },
      changeMindset: async (id, name) => {
        selections.push({ id, name })
        return { kit: name, version: '1.0', sourceRevision: 2 }
      },
    }),
  }
  const main = { session: { header: {} }, steer: () => assert.fail('tool must not inject user intent') }
  const run = input => DesignService.prototype.executeProjectCommand.call(owner, main, input, new AbortController().signal)
  assert.equal((await run('kit web_app')).kind, 'error', 'Kit selection still requires a selected project')
  assert.equal((await run('kit')).text, '用法: /yugoo kit <kit>')
  assert.deepEqual(selections, [])
  assert.equal((await run('new 科研平台')).kind, 'success')
  assert.deepEqual(calls, ['科研平台'])
  assert.equal(selected.projectId, 'project-1')
  const activated = await run('kit web_app')
  assert.equal(activated.kind, 'success')
  assert.match(activated.text, /设计套件 "web_app@1.0"/)
  assert.deepEqual(await run('mindset web_app'), activated, 'the old spelling uses the same owner and result')
  assert.deepEqual(selections, [
    { id: 'project-1', name: 'web_app' }, { id: 'project-1', name: 'web_app' },
  ])
  const spec = await run('compose_spec 科研浏览')
  assert.equal(spec.kind, 'success')
  assert.match(spec.conversationPrompt, /科研浏览/)
  assert.equal(selected.projectId, 'project-1')
  assert.equal((await run('not-a-command')).kind, 'error')
  await assert.rejects(DesignService.prototype.executeProjectCommand.call(owner,
    { session: { header: { parentSession: 'main' } } }, 'new child', new AbortController().signal), /main Agent/)
  assert.deepEqual(calls, ['科研平台'])
  await assert.rejects(DesignService.prototype.executeProjectCommand.call(owner,
    { session: { header: { parentSession: 'main' } } }, 'compose_spec child', new AbortController().signal), /main Agent/)
  await assert.rejects(DesignService.prototype.executeProjectCommand.call(owner,
    { session: { header: { parentSession: 'main' } } }, 'kit web_app', new AbortController().signal), /main Agent/)
})

const { Context } = await import('@deepseek-ai/cordis')
const { default: CommandRuntime } = await import('@deepseek-ai/dsh-commands')
const { parseDesignCommand, runDesignProjectCommand } = await import('../src/design-project-adapter.ts')

test('project migration is the canonical command without a recover alias', async () => {
  const path = 'C:\\Users\\Tester\\Documents\\legacy project /recover notes'
  assert.deepEqual(parseDesignCommand(`migrate ${path}`), { verb: 'migrate', argument: path })
  assert.equal(parseDesignCommand(`recover ${path}`), undefined)
  const missing = await runDesignProjectCommand(parseDesignCommand('migrate'), { projects: {}, conversation: {} })
  assert.equal(missing.kind, 'error')
  assert.match(missing.text, /\/yugoo migrate/)
  const help = await runDesignProjectCommand(parseDesignCommand('help'), {
    projects: {}, conversation: { current: async () => undefined },
  })
  assert.match(help.text, /\/yugoo migrate/)
  assert.doesNotMatch(help.text, /\/yugoo recover/)
  const { registerServiceTools } = await import('../src/service-tools.ts')
  const definitions = new Map(), calls = []
  registerServiceTools({ tools: { register: definition => definitions.set(definition.name, definition) } }, {
    executeProjectCommand: async (...args) => { calls.push(args); return { kind: 'success', text: 'migration prepared' } },
  })
  const command = definitions.get('design_command')
  assert.ok(command.parameters.properties.action.enum.includes('migrate'))
  assert.ok(!command.parameters.properties.action.enum.includes('recover'))
  const agent = { session: { header: {} } }, signal = new AbortController().signal
  await command.execute({ action: 'migrate', argument: path }, { agent, signal })
  assert.deepEqual(calls, [[agent, `migrate ${path}`, signal]])
  const result = await DesignService.prototype.executeProjectCommand.call({}, agent, `recover ${path}`, signal)
  assert.equal(result.kind, 'error', 'the native service rejects the retired command before any project access')
})

test('DSH migration resolves the source Kit and uses the renamed registry port', async () => {
  const calls = [], selections = []
  const sourceRoot = '/legacy/read only /recover notes'
  const pin = { name: 'fixture_kit', version: '1.0' }
  const kit = { ...pin, skills: [{ name: 'bounded_records' }] }
  const migrated = { projectId: 'new-target', name: 'legacy-migrated', root: '/new-target',
    sourceRoot, migratedBundles: ['bounded_records'], kit: pin }
  const signal = new AbortController().signal
  const owner = {
    projects: {
      inspectMigrationSource: async (...args) => { calls.push(['inspect', ...args]); return { sourceRoot, metadata: { kit: pin } } },
      migrate: async (...args) => { calls.push(['migrate', ...args]); return migrated },
      snapshot: async id => { assert.equal(id, migrated.projectId); return { checkpoint: 'new-head', bundleStates: {} } },
    },
    resolveKit: value => { assert.deepEqual(value, { kit: pin.name, version: pin.version }); return kit },
    listKits: () => [kit],
    requireKnowledgeRuntime: () => ({ defaultProvider: 'test-provider' }),
    advisoryRuntimeStatus: () => undefined,
    conversationPort: () => ({
      current: async () => undefined,
      select: async record => { selections.push(record); return { revision: 1 } },
    }),
  }
  const main = { session: { header: {} } }
  const result = await DesignService.prototype.executeProjectCommand.call(owner, main, `migrate ${sourceRoot}`, signal)
  assert.equal(result.kind, 'success')
  assert.deepEqual(calls, [
    ['inspect', sourceRoot, signal],
    ['migrate', sourceRoot, { knowledge: { provider: 'test-provider' }, kit: pin }, ['bounded_records'], signal],
  ])
  assert.deepEqual(selections, [migrated])
  assert.match(result.conversationPrompt, /bounded_records/)
  assert.match(result.conversationPrompt, /不要修改来源目录/)
  await assert.rejects(DesignService.prototype.executeProjectCommand.call(owner,
    { session: { header: { parentSession: 'main' } } }, `migrate ${sourceRoot}`, signal), /main Agent/)
  assert.equal(calls.length, 2, 'a child refusal never begins migration')
})

test('Kit commands preserve exact catalog identifiers and keep the old spelling as an alias', async () => {
  assert.deepEqual(parseDesignCommand('  kit  custom_kit  '), { verb: 'kit', argument: 'custom_kit' })
  assert.deepEqual(parseDesignCommand('mindset custom_kit'), { verb: 'mindset', argument: 'custom_kit' })
  const error = new Error('Changing an existing Kit requires migration')
  for (const command of ['kit other_kit', 'mindset other_kit']) {
    await assert.rejects(runDesignProjectCommand(parseDesignCommand(command), {
      projects: {},
      conversation: { current: async () => ({ projectId: 'pinned-project' }), changeMindset: async () => { throw error } },
    }), value => value === error, 'selection policy refusals must propagate without a fallback')
  }
})

test('model-facing project commands expose Kit selection and forward it unchanged', async () => {
  const { registerServiceTools } = await import('../src/service-tools.ts')
  const definitions = new Map()
  const calls = []
  registerServiceTools({ tools: { register: definition => definitions.set(definition.name, definition) } }, {
    executeProjectCommand: async (...args) => { calls.push(args); return { kind: 'success', text: 'selected' } },
  })
  const command = definitions.get('design_command')
  assert.ok(command.parameters.properties.action.enum.includes('kit'))
  assert.ok(command.parameters.properties.action.enum.includes('mindset'))
  const agent = { session: { header: {} } }, signal = new AbortController().signal
  await command.execute({ action: 'kit', argument: 'web_app' }, { agent, signal })
  assert.deepEqual(calls, [[agent, 'kit web_app', signal]])
})

async function nativeCommands(t, owner, existing) {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  t.after(() => ctx.fiber.dispose())
  if (existing) ctx.commands.register(existing)
  DesignService.prototype.registerProjectCommands.call(owner, ctx.commands)
  const events = [], messages = []
  const agent = { ctx, session: { append: (type, data) => events.push({ type, data }) }, steer: message => messages.push(message) }
  return { ctx, agent, events, messages }
}

test('native /yugoo is the sole entry and preserves raw arguments and host lifecycle', async t => {
  const calls = []
  const owner = { executeProjectCommand: async (agent, input, signal) => {
    calls.push({ agent, input, signal })
    return { kind: 'success', text: 'opened', conversationPrompt: 'continue selected project' }
  } }
  const { ctx, agent, events, messages } = await nativeCommands(t, owner)
  assert.ok(ctx.commands.find(agent, 'yugoo'))
  assert.equal(ctx.commands.find(agent, 'design'), undefined)
  const rawInput = '  open C:\\Users\\Tester\\Documents\\design project /design notes'
  const signal = new AbortController().signal
  const outcome = await ctx.commands.execute(agent, `/yugoo${rawInput}`, [], signal)
  assert.equal(outcome.result.kind, 'success')
  assert.equal(await ctx.commands.execute(agent, `/design${rawInput}`, [], signal), undefined)
  assert.equal(await ctx.commands.execute(agent, '/design', [], signal), undefined)
  assert.deepEqual(calls, [{ agent, input: rawInput, signal }])
  assert.deepEqual(events.filter(event => event.type === 'command/run').map(event => event.data.name), ['yugoo'])
  assert.equal(events.filter(event => event.type === 'command/done').length, 1)
  assert.equal(messages.length, 1)
  assert.equal(await ctx.commands.execute(agent, '/yugoostatus', [], signal), undefined)
})

test('another plugin may keep /design while Yugoo Panel commands use /yugoo', async t => {
  let ownCalls = 0
  const foreign = { name: 'design', description: 'Other plugin', handler: async () => ({ kind: 'success', text: 'foreign' }) }
  const { ctx, agent } = await nativeCommands(t, {
    executeProjectCommand: async () => { ownCalls++; return { kind: 'success', text: 'yugoo' } },
  }, foreign)
  const signal = new AbortController().signal
  assert.equal((await ctx.commands.execute(agent, '/design', [], signal)).result.text, 'foreign')
  assert.equal((await ctx.commands.execute(agent, '/yugoo', [], signal)).result.text, 'yugoo')
  assert.equal(ownCalls, 1)
  assert.equal(ctx.commands.find(agent, 'design').handler, foreign.handler)
})

test('a /yugoo collision fails explicitly and preserves the existing owner', async t => {
  const ctx = new Context()
  await ctx.plugin(CommandRuntime)
  t.after(() => ctx.fiber.dispose())
  const handler = async () => ({ kind: 'success', text: 'foreign' })
  ctx.commands.register({ name: 'yugoo', description: 'Another owner', handler })
  assert.throws(() => DesignService.prototype.registerProjectCommands.call({}, ctx.commands), /cannot register \/yugoo/)
  assert.equal(ctx.commands.find({ ctx }, 'yugoo').handler, handler)
  assert.equal(ctx.commands.find({ ctx }, 'design'), undefined)
})

test('registration attempts only yugoo and preserves host failure as the cause', () => {
  const names = []
  const error = new Error('host registry unavailable')
  const commands = { register: definition => {
    names.push(definition.name)
    throw error
  } }
  assert.throws(() => DesignService.prototype.registerProjectCommands.call({}, commands), value => {
    assert.match(value.message, /cannot register \/yugoo/)
    return value.cause === error
  })
  assert.deepEqual(names, ['yugoo'])
  const registered = []
  DesignService.prototype.registerProjectCommands.call({}, { register: definition => {
    registered.push(definition.name)
    return () => {}
  } })
  assert.deepEqual(registered, ['yugoo'])
})

test('branded help preserves project data containing the legacy command spelling', async () => {
  const raw = 'open /projects/design archive /design notes'
  assert.deepEqual(parseDesignCommand(raw), { verb: 'open', argument: '/projects/design archive /design notes' })
  const project = { projectId: 'p', name: 'A /design name', root: '/projects/design archive /design notes' }
  const result = await runDesignProjectCommand(parseDesignCommand('list'), {
    projects: { list: async () => [project] }, conversation: { current: async () => undefined },
  })
  assert.ok(result.text.includes(project.name))
  assert.ok(result.text.includes(project.root))
  const help = await runDesignProjectCommand(parseDesignCommand(''), {
    projects: {}, conversation: { current: async () => undefined },
  })
  assert.match(help.text, /\/yugoo new <name>/)
  assert.match(help.text, /\/yugoo kit <kit>/)
  assert.doesNotMatch(help.text, /\/design new/)
})

test('the sole native entry leaves with its owning scope and never registers design on remount', async t => {
  const root = new Context()
  await root.plugin(CommandRuntime)
  t.after(() => root.fiber.dispose())
  const owner = { executeProjectCommand: async () => ({ kind: 'success', text: 'ok' }) }
  const mount = () => root.plugin(Object.assign(ctx => {
    DesignService.prototype.registerProjectCommands.call(owner, ctx.commands)
  }, { inject: ['commands'] }))
  const agent = { ctx: root }
  const first = mount(); await first
  assert.ok(root.commands.find(agent, 'yugoo'))
  assert.equal(root.commands.find(agent, 'design'), undefined)
  await first.ctx.fiber.dispose()
  assert.equal(root.commands.find(agent, 'yugoo'), undefined)
  assert.equal(root.commands.find(agent, 'design'), undefined)
  const second = mount(); await second
  assert.ok(root.commands.find(agent, 'yugoo'))
  assert.equal(root.commands.find(agent, 'design'), undefined)
})
