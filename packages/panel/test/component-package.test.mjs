import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { NativePanelRegistry } from '../src/client/native-panel-registry.ts'
import { fixture, fixtureRoot, npmEdit, revise, sourcePin } from '../../core/test/fixtures/component-package/fixture.mjs'
const requirePanel = createRequire(new URL('../package.json', import.meta.url))
const React = requirePanel('react'), ReactDOM = requirePanel('react-dom')
const { renderToStaticMarkup } = requirePanel('react-dom/server')
const { Context } = requirePanel('@deepseek-ai/cordis')
const runtime = { hostReact: React, providerReact: React, hostReactDOM: ReactDOM, providerReactDOM: ReactDOM }
test('actual minimal client entry renders with host React and is discovered in the existing registry', async () => {
  const { source, pin } = await fixture(), ctx = new Context(), registry = new NativePanelRegistry(ctx)
  try {
    const entry = await import(new URL('client.mjs', fixtureRoot))
    const dispose = await entry.install(registry, [source], pin, { React, ReactDOM })
    const [definition] = registry.installedDefinitions()
    assert.deepEqual(registry.ids(), ['org.example.notice.panel/v1'])
    assert.equal(definition.metadata.componentPackage.integrity, pin.integrity)
    assert.match(renderToStaticMarkup(definition.render({})), /Trusted notice component/)
    assert.ok(Object.isFrozen(definition.metadata.componentPackage.manifest))
    dispose(); dispose(); assert.deepEqual(registry.ids(), [])
  } finally { await ctx.fiber.dispose() }
})
test('wrong React instance, invalid bytes and declaration/definition mismatch never publish a renderer', async () => {
  const { source, pin } = await fixture(), ctx = new Context(), registry = new NativePanelRegistry(ctx)
  let invoked = 0
  const definitions = value => { invoked++; return value.manifest.components.map(c => ({ id: c.id, scrollOwner: 'panel', render: () => React.createElement('p') })) }
  try {
    await assert.rejects(registry.registerPackage([source], pin, definitions, { ...runtime, providerReact: { ...React } }), /package.react_source/)
    await assert.rejects(registry.registerPackage([source], pin, definitions, { ...runtime, providerReactDOM: { ...ReactDOM } }), /package.react_source/)
    const bad = { ...source, files: new Map(source.files) }; bad.files.set('client.mjs', Buffer.from('changed'))
    await assert.rejects(registry.registerPackage([bad], pin, definitions, runtime), /package.digest/)
    assert.equal(invoked, 0, 'invalid admission never calls trusted entry factory')
    await assert.rejects(registry.registerPackage([source], pin, () => [], runtime), /package.contributions/)
    await assert.rejects(registry.registerPackage([source], pin, value => [{ id: value.manifest.components[0].id, scrollOwner: 'other', render: () => React.createElement('p') }], runtime), /package.interface/)
    assert.deepEqual(registry.ids(), [])
  } finally { await ctx.fiber.dispose() }
})
test('existing conflicts are preserved and successful registration follows normal context disposal', async () => {
  const { source, pin } = await fixture(), ctx = new Context(), registry = new NativePanelRegistry(ctx)
  const make = value => value.manifest.components.map(c => ({ id: c.id, scrollOwner: 'panel', render: () => React.createElement('p') }))
  const stop = await registry.registerPackage([source], pin, make, runtime)
  const initial = registry.get('org.example.notice.panel/v1')
  await assert.rejects(registry.registerPackage([source], pin, make, runtime), /package.component_conflict/)
  const other = revise(source, m => { m.components[0].id = 'org.example.notice.other/v1' })
  await assert.rejects(registry.registerPackage([other], sourcePin(other), make, runtime), /package.namespace_conflict/)
  assert.equal(registry.get(initial.id), initial)
  await ctx.fiber.dispose(); assert.deepEqual(registry.ids(), [])
  stop()
})
test('throwing observers cannot strand failed registration, rollback or package cleanup', async () => {
  const { source, pin } = await fixture()
  const make = value => value.manifest.components.map(c => ({ id: c.id, scrollOwner: 'panel', render: () => React.createElement('p') }))
  const multiple = count => revise(source, manifest => {
    for (let index = 1; index < count; index++) manifest.components.push({ ...manifest.components[0], id: `org.example.notice.panel${index}/v1` })
  })
  {
    const ctx = new Context(), registry = new NativePanelRegistry(ctx)
    const original = new Error('initial observer failed')
    let calls = 0
    const stop = registry.subscribe(() => { throw ++calls === 1 ? original : new Error('rollback observer failed') })
    try {
      await assert.rejects(registry.registerPackage([source], pin, make, runtime), error => error === original)
      assert.deepEqual(registry.ids(), [])
      stop(); await ctx.fiber.dispose(); assert.deepEqual(registry.ids(), [])
    } finally { stop(); await ctx.fiber.dispose() }
  }
  {
    const ctx = new Context(), registry = new NativePanelRegistry(ctx), three = multiple(3)
    const existing = { id: 'existing-owner', scrollOwner: 'panel', render: () => React.createElement('p') }
    registry.register(existing)
    let previous = 1
    const stop = registry.subscribe(() => {
      const size = registry.ids().length, removing = size < previous
      previous = size
      if (removing) throw new Error('rollback observer failed')
    })
    try {
      await assert.rejects(registry.registerPackage([three], sourcePin(three), value => {
        const definitions = make(value)
        Object.defineProperty(definitions[2], 'metadata', { enumerable: true, get() { throw new Error('third definition failed') } })
        return definitions
      }, runtime), /third definition failed/, 'cleanup failures preserve the original setup failure')
      assert.deepEqual(registry.ids(), ['existing-owner'], 'every batch definition is removed despite observer failures')
      assert.equal(registry.get(existing.id), existing)
    } finally { stop(); await ctx.fiber.dispose() }
  }
  {
    const ctx = new Context(), registry = new NativePanelRegistry(ctx), two = multiple(2)
    const existing = { id: 'existing-owner', scrollOwner: 'panel', render: () => React.createElement('p') }
    registry.register(existing)
    const dispose = await registry.registerPackage([two], sourcePin(two), make, runtime)
    const stop = registry.subscribe(() => { throw new Error('cleanup observer failed') })
    try {
      assert.throws(dispose, error => error instanceof AggregateError && error.errors.length === 2)
      assert.deepEqual(registry.ids(), ['existing-owner'])
      assert.equal(registry.get(existing.id), existing)
      dispose()
    } finally { stop(); await ctx.fiber.dispose() }
  }
})
test('caller pin mutation during hashing cannot select a different admitted dependency', async () => {
  const { source } = await fixture(), ctx = new Context(), registry = new NativePanelRegistry(ctx)
  const dependency = revise(source, manifest => {
    manifest.name = '@example/notice-base'; manifest.namespace = 'org.example.base'; manifest.components[0].id = 'org.example.base.panel/v1'
  }, files => npmEdit(files, npm => { npm.name = '@example/notice-base' }))
  const dependencyPin = sourcePin(dependency)
  const root = revise(source, manifest => { manifest.dependencies = [dependencyPin] }, files => npmEdit(files, npm => { npm.dependencies = { [dependencyPin.name]: dependencyPin.version } }))
  const pin = sourcePin(root), requested = { ...pin }
  const make = value => value.manifest.components.map(c => ({ id: c.id, scrollOwner: 'panel', render: () => React.createElement('p') }))
  try {
    const pending = registry.registerPackage([root, dependency], pin, make, runtime)
    Object.assign(pin, dependencyPin)
    const dispose = await pending
    const [definition] = registry.installedDefinitions()
    assert.equal(definition.metadata.componentPackage.name, requested.name)
    assert.equal(definition.metadata.componentPackage.integrity, requested.integrity)
    assert.deepEqual(registry.ids(), ['org.example.notice.panel/v1'])
    dispose()
    await assert.rejects(registry.registerPackage([root, dependency], { ...requested, unknown: true }, make, runtime), /package.field/)
    assert.deepEqual(registry.ids(), [])
  } finally { await ctx.fiber.dispose() }
})
