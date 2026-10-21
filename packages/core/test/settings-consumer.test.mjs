import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import * as legacyApi from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { designLiveConfigField, readDesignConfigValue, installDesignSettingsSection, DESIGN_ADVISORY_SETTINGS_NAMESPACE as NS } from '../src/dsh-settings-consumer.ts'

const publicApi = process.env.DSH_SETTINGS_TEST_MODULE ? await import(process.env.DSH_SETTINGS_TEST_MODULE) : undefined
const { register } = await import('tsx/esm/api'); register()
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const entry = Object.freeze({ value: 'base' })
const schema = z.object({ value: z.string().default('base') })

test('fixed advisory namespace satisfies both legacy and public provider syntax', () => {
  assert.equal(NS, 'dsh-design-advisory')
  assert.match(NS, /^[a-z][a-z0-9-]*$/u)
})

test('the current pinned SDK supplies the public ConfigForms presentation API', () => {
  assert.equal(typeof legacyApi.SettingsForms, 'function')
  assert.equal(typeof legacyApi.SettingsForms.prototype.configure, 'function')
})

for (const [name, api, providerApi] of [['legacy', legacyApi, legacyApi], ['provider', {}, publicApi]]) {
  test(`${name} settings: actual provider attach/change/detach/re-attach and consumer unload`, {
    skip: typeof providerApi?.SettingsProvider !== 'function' ? 'retained historical adapter; no legacy provider input in the current SDK' : false,
  }, async t => {
    const root = new Context()
    t.after(async () => { await root.fiber.dispose() })
    let raw, consumerContext, source = () => entry, changes = 0
    class MemorySettings extends providerApi.SettingsProvider {
      constructor(ctx) { super(ctx); raw = this }
      async load() { return {} }
      async persist() {}
    }
    const consumer = root.plugin(ctx => {
      consumerContext = ctx
      installDesignSettingsSection(ctx, schema, entry, {
        setSource: next => { source = next }, onChange: () => { changes++ },
      }, api)
    })
    await consumer; await tick()
    assert.deepEqual(source(), entry); assert.equal(changes, 0, 'absence retains composition defaults')
    let provider = root.plugin(MemorySettings); await provider; await tick()
    assert.equal(raw.registrations.has(NS), true); assert.equal(changes, 1)
    raw.publish({ [NS]: { value: 'user' } }); await tick()
    assert.deepEqual(source(), { value: 'user' }); assert.equal(changes, 2)
    await provider.ctx.fiber.dispose(); await tick(); await tick()
    assert.deepEqual(source(), entry); assert.equal(changes, 3)
    assert.equal(consumer.ctx, consumerContext, 'provider reload must not restart consumer')
    provider = root.plugin(MemorySettings); await provider; await tick()
    assert.equal(raw.registrations.has(NS), true); assert.equal(changes, 4)
    raw.publish({ [NS]: { value: 'second' } }); await tick()
    assert.equal(changes, 5)
    await consumer.ctx.fiber.dispose(); await tick()
    assert.equal(raw.registrations.has(NS), false)
    assert.equal(changes, 5, 'consumer unload does not fall back or notify')
    raw.publish({ [NS]: { value: 'late' } }); await tick()
    assert.equal(changes, 5, 'late publish cannot notify disposed consumer')
    assert.deepEqual(source(), { value: 'second' })
  })
}

test('provider call preserves traced receiver, synchronous registration and original owner', () => {
  const provider = { installSection(owner, namespace, passedSchema, passedEntry, hooks) {
    assert.equal(this, provider); assert.equal(owner, consumer); assert.equal(namespace, NS)
    assert.equal(passedSchema, schema); assert.equal(passedEntry, entry); assert.equal(hooks, passedHooks)
    called = true
  } }
  const passedHooks = { setSource() {}, onChange() {} }
  let called = false
  const consumer = { inject(names, callback) { assert.deepEqual(names, ['settings']); callback({ settings: provider }); assert.equal(called, true) } }
  installDesignSettingsSection(consumer, schema, entry, passedHooks, {})
})

test('unsupported installed provider is an explicit failure, not ignored', () => {
  const consumer = { inject(_names, callback) { callback({ settings: {} }) } }
  assert.throws(() => installDesignSettingsSection(consumer, schema, entry, { setSource() {}, onChange() {} }, {}), /lacks a supported/)
})

test('current ConfigForms adapter fixture: attach/change/detach/re-attach/unload uses owning fiber and host references', async t => {
  // This is a lifecycle fixture over real Cordis/Schemastery, not an installed
  // DSH activation test. The Windows public SettingsForms probe is separate.
  const requireFromSchema = createRequire(import.meta.resolve('@deepseek-ai/schemastery'))
  const { updateVolatile } = await import(requireFromSchema.resolve('@deepseek-ai/cosmokit'))
  const root = new Context()
  t.after(async () => { await root.fiber.dispose() })
  const Config = z.object({ value: designLiveConfigField(schema.dict.value) })
  let raw, consumerContext, source = () => entry, changes = 0
  class FormsFixture extends Service {
    policies = new Map()
    constructor(ctx) { super(ctx, 'settings'); raw = this }
    configure(policy, owner) {
      assert.equal(owner, consumerContext.fiber, 'host-owned profile entry, not the injected child')
      assert.equal(this.ctx.fiber !== owner, true, 'call remains on the traced receiver')
      assert.deepEqual(policy, { auto: true })
      this.policies.set(owner, policy)
      return () => this.policies.delete(owner)
    }
  }
  const consumer = root.plugin({ Config, apply(ctx) {
    consumerContext = ctx
    installDesignSettingsSection(ctx, schema, entry, {
      setSource: next => { source = next }, onChange: () => { changes++ },
    }, { SettingsForms: FormsFixture })
  } })
  await consumer; await tick()
  assert.deepEqual(source(), entry); assert.equal(changes, 0)
  let provider = root.plugin(FormsFixture); await provider; await tick()
  assert.equal(raw.policies.has(consumerContext.fiber), true)
  assert.deepEqual(source(), entry); assert.equal(changes, 1)
  const publish = value => {
    updateVolatile(consumerContext.fiber.config.value, Config({ value }).value)
    root.emit('settings/document-updated', 'actual-entry-id-not-fixed-namespace', 1)
  }
  publish('user'); await tick()
  assert.deepEqual(source(), { value: 'user' }); assert.equal(changes, 2)
  root.emit('settings/document-updated', 'unrelated-entry', 2); await tick()
  assert.equal(changes, 2, 'unrelated or repeated invalidation does not signal a change')
  const previousProvider = raw
  await provider.ctx.fiber.dispose(); await tick(); await tick()
  assert.equal(previousProvider.policies.size, 0)
  assert.deepEqual(source(), entry); assert.equal(changes, 3)
  assert.equal(consumer.ctx, consumerContext, 'service reload must not restart the consumer')
  provider = root.plugin(FormsFixture); await provider; await tick()
  assert.equal(raw.policies.has(consumerContext.fiber), true)
  assert.deepEqual(source(), { value: 'user' }); assert.equal(changes, 4, 'host Config survives service re-attach')
  publish('second'); await tick(); assert.equal(changes, 5)
  await consumer.ctx.fiber.dispose(); await tick()
  assert.equal(raw.policies.size, 0)
  assert.equal(changes, 5, 'consumer unload does not notify')
  root.emit('settings/document-updated', 'late', 3); await tick()
  assert.equal(changes, 5, 'late host invalidation cannot notify an unloaded consumer')
})

test('current settings refuse missing owning volatile Config; old schema and scalar values remain unchanged', () => {
  const historicalField = { volatile: undefined }
  assert.equal(designLiveConfigField(historicalField), historicalField)
  assert.equal(readDesignConfigValue(5), 5)
  assert.equal(readDesignConfigValue(undefined), undefined)
  const reference = { get() { assert.equal(this, reference); return 7 } }
  assert.equal(readDesignConfigValue(reference), 7)
  class Forms {}
  const provider = Object.create(Forms.prototype)
  const consumer = {
    fiber: { config: { value: 'base' }, runtime: { Config: schema }, state: 2 },
    inject(_names, callback) { callback({ settings: provider }) },
  }
  assert.throws(() => installDesignSettingsSection(consumer, schema, entry, { setSource() {}, onChange() {} }, { SettingsForms: Forms }), /owning plugin volatile Config fields/)
})

test('advisory owning Config exposes the same bounded preference and retains domain config validation', async () => {
  const { Config, DshAdvisoryScheduler } = await import('../src/dsh-advisory-plugin.ts')
  assert.equal(Config.dict.maxSuggestions.meta.volatile, true)
  const parsed = Config({ provider: 'spawn', debounceMs: 0, knowledgeReadTimeoutMs: 100, maxSuggestions: 7 })
  assert.equal(readDesignConfigValue(parsed.maxSuggestions), 7)
  assert.equal(readDesignConfigValue(Config({}).maxSuggestions), 5)
  const ports = { design: {}, subagents: {}, warn() {} }
  const scheduler = new DshAdvisoryScheduler(ports, parsed)
  scheduler.dispose()
  assert.throws(() => Config({ maxSuggestions: 11 }), /max|expect/u)
  assert.throws(() => new DshAdvisoryScheduler(ports, Config({ profiles: ['unknown-profile'] })), /profile/u)
  assert.throws(() => new DshAdvisoryScheduler(ports, Config({ debounceMs: -1 })), /non-negative/u)
  assert.throws(() => new DshAdvisoryScheduler(ports, Config({ knowledgeReadTimeoutMs: 0 })), /positive/u)
})
