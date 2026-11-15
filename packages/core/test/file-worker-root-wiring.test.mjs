import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { registerHooks } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import { apply } from '../src/dsh-design-execution-plugin.ts'
import { registerDesignFileWorkerDispatcher } from '../src/dsh-file-worker-agent.ts'

const limits = {
  maxArtifactInputFiles: 10, maxArtifactInputPathBytes: 1024,
  maxArtifactInputFileBytes: 1024, maxArtifactInputTotalBytes: 10240,
}

test('legacy SDK selects scoped native tools with the optional executor package absent', async () => {
  let optionalLoads = 0
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@deepseek-ai/dsh-tool-executor-native') {
      optionalLoads++
      throw Object.assign(Error('optional Host executor is absent'), { code: 'MODULE_NOT_FOUND' })
    }
    return next(specifier, context)
  } })
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools, { mode: 'ptc' })
  const key = {}
  const child = createScope(ctx, key)
  try {
    const { selectDshChildNativeTools } = await import('../src/dsh-subagent-backend.ts?legacy-no-executor')
    await new Promise((resolve, reject) => child.ctx.inject(['tools'], async scoped => {
      try {
        await selectDshChildNativeTools(scoped)
        assert.equal(scoped.tools.modeFor(key), 'native')
        resolve()
      } catch (error) { reject(error) }
    }))
    assert.equal(ctx.tools.modeFor(), 'ptc')
    assert.equal(optionalLoads, 0)
  } finally { await child.dispose(); await ctx.fiber.dispose(); hooks.deregister() }
})

test('unknown runtime shapes fail closed and a legacy start failure never retries through the factory', async () => {
  for (const subagents of [undefined, {}, { startActivation() {} },
    { startActivation() {}, registerProvider() {} },
    { startActivation() {}, registerProvider() {}, waitForTreeWork: true },
    { start: 'not callable', registerProvider() {} }]) {
    assert.throws(() => registerDesignFileWorkerDispatcher({ subagents }), /unavailable|unsupported/)
  }
  let starts = 0, creates = 0
  const dispatcher = registerDesignFileWorkerDispatcher({ subagents: {
    registerProvider: () => () => {},
    start: async () => { starts++; throw Error('native start rejected') },
  } })
  await assert.rejects(dispatcher.start({ parent: { ctx: { agents: { create: () => { creates++ } } } },
    signal: new AbortController().signal, label: 'bounded worker', prompt: [], maxDepth: 3,
    inheritedToolNames: [], installWorkerTools() {} }), /native start rejected/)
  assert.equal(starts, 1)
  assert.equal(creates, 0)
  dispatcher.dispose()
})

test('activation runtime uses the actual Agent factory independently of preparation/wait APIs', () => {
  for (const lifecycle of [{}, { prepareContinuable() {}, waitForChildren() {} }, { waitForTreeWork() {} }]) {
    let registrations = 0
    const dispatcher = registerDesignFileWorkerDispatcher({ agents: { get() {}, create() {} }, subagents: {
      startActivation() {}, registerProvider() { registrations++ }, ...lifecycle,
    } })
    assert.equal(typeof dispatcher.start, 'function')
    assert.equal(registrations, 0, 'factory children do not claim a legacy runtime provider')
    dispatcher.dispose()
    dispatcher.dispose()
  }
  for (const agents of [undefined, {}, { get() {} }, { create() {} }, { get() {}, create: true }]) {
    assert.throws(() => registerDesignFileWorkerDispatcher({ agents, subagents: {
      startActivation() {}, registerProvider() {}, prepareContinuable() {}, waitForChildren() {},
    } }), /unsupported/, 'an old runtime shape cannot substitute for the required Agent factory')
  }
})

function rootFixture() {
  const tools = new Map()
  const providers = new Map()
  const injections = []
  let unregisters = 0
  const ctx = {
    design: { registerClarityRuntime: () => () => {}, registerWorkspaceChangeListener: () => () => {} },
    tools: { register: tool => tools.set(tool.name, tool) }, effect: () => {},
    on: () => () => {}, systemPrompt: { section: () => () => {} },
    inject: (names, callback) => { injections.push({ names, callback }) },
  }
  const service = {
    subagents: {
      registerProvider: provider => {
        if (providers.has(provider.name)) throw new Error('duplicate provider')
        providers.set(provider.name, provider)
        return () => { unregisters++; providers.delete(provider.name) }
      },
      start: () => { throw new Error('No model execution in root wiring fixture') },
    },
  }
  return { ctx, service, providers, tools, injections, unregisters: () => unregisters }
}

test('shipped DSH patch explicitly activates the bounded file Worker dispatcher', () => {
  const patch = parse(readFileSync(new URL('../../dsh/cordis.patch.yml', import.meta.url), 'utf8'))
  const execution = patch.flatMap(entry => entry.insert ?? []).find(entry => entry.id === 'dsh-design-execution')
  assert.equal(execution.config.delegation.provider, 'dsh-design-file-worker')
  const f = rootFixture()
  apply(f.ctx, execution.config)
  const dispose = f.injections[0].callback(f.service)
  assert.equal(f.providers.has('dsh-design-file-worker'), true)
  dispose()
  assert.equal(f.unregisters(), 1)
})

test('actual root plugin registers owned provider only on explicit opt-in and disposes it once', () => {
  for (const provider of [undefined, 'spawn', 'custom-provider', 'dsh-design-file-worker']) {
    const f = rootFixture()
    apply(f.ctx, { ...limits, ...(provider ? { delegation: { provider, maxDepth: 3 } } : {}) })
    assert.ok(f.tools.has('run_design_skill'))
    assert.deepEqual(f.injections.map(x => x.names), [['subagents', 'agents']])
    assert.equal(f.providers.size, 0, 'Optional service has not mounted yet')
    const dispose = f.injections[0].callback(f.service)
    assert.equal(f.providers.has('dsh-design-file-worker'), provider === 'dsh-design-file-worker')
    dispose()
    dispose()
    assert.equal(f.providers.size, 0)
    assert.equal(f.unregisters(), provider === 'dsh-design-file-worker' ? 1 : 0)
  }
})
