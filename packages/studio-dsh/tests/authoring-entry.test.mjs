/** Actual private-directory helper + explicit lifecycle fixtures, and one actual SDK Service activation.
 * All roots are private temporary fixtures. No production Host/profile or model call. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fixture as sdkFixture } from './fixtures/authoring-sdk.mjs'
const deferred = () => Promise.withResolvers()
const { Service } = await import('@deepseek-ai/cordis')
const { default: Registry } = await import('@deepseek-ai/dsh-typert-registry')
const built = process.env.STUDIO_AUTHORING_ENTRY_BUILT === '1'
const { default: NativeService } = await import(new URL(built ? '../lib/authoring-service.js' : '../src/authoring-service.ts', import.meta.url).href)
const { default: Entry, apply } = await import(new URL(built ? '../lib/authoring-entry.js' : '../src/authoring-entry.ts', import.meta.url).href)

async function fixture(t, options = {}) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'studio-authoring-entry-')))
  const home = join(root, 'host-home'); await fs.mkdir(home, { mode: 0o700 })
  const config = { stateRoot: join(root, 'state'), workspaceRoot: join(root, 'workspace') }
  const events = [], mounts = [], initializing = deferred(), disposing = deferred(), listeners = new Map()
  if (!options.deferInit) initializing.resolve({})
  if (!options.deferDispose) disposing.resolve()
  const child = { closed: false, dispose() { child.closed = true; events.push('child-close'); return disposing.promise }, then: initializing.promise.then.bind(initializing.promise) }
  let close
  const ctx = {
    fiber: { uid: 1, state: 1 },
    on(name, listener) { listeners.set(name, listener); return () => listeners.delete(name) },
    effect(setup) { events.push('hook'); close = setup() },
    plugin(plugin, roots) { assert.equal(plugin, NativeService); events.push('service'); mounts.push({ plugin, roots }); return child },
  }
  t.after(async () => {
    initializing.resolve({}); disposing.resolve()
    if (options.expectedCleanupFailure) await close?.().catch(() => {})
    else await close?.()
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, home, config, events, mounts, child, initializing, disposing, ctx, listeners,
    start: input => {
      const previous = process.env.DSH_HOME; process.env.DSH_HOME = home
      try { return apply(ctx, input) }
      finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous }
    }, close: () => close?.() }
}

test('default roots respect actual public DSH_HOME and prepare only two private leaves before one existing Service', async t => {
  const f = await fixture(t), mkdir = fs.mkdir
  t.mock.method(fs, 'mkdir', async (path, ...args) => { assert.equal(f.events[0], 'hook'); f.events.push('mkdir'); return mkdir(path, ...args) })
  await f.start()
  assert.equal(f.mounts.length, 1)
  assert.deepEqual(f.mounts[0].roots, { stateRoot: join(f.home, 'yugoo-design-studio'), workspaceRoot: join(f.home, 'yugoo-design-studio-workspace') })
  for (const path of Object.values(f.mounts[0].roots)) {
    assert.equal((await fs.stat(path)).mode & 0o777, 0o700)
    assert.deepEqual(await fs.readdir(path), [], 'the entry did not create a second store/namespace')
  }
  assert.deepEqual(Entry.inject, NativeService.inject)
})

test('trusted roots are snapshotted at call time and may independently override defaults', async t => {
  const f = await fixture(t), request = { ...f.config }
  const starting = f.start(request)
  request.stateRoot = join(f.root, 'later-state'); request.workspaceRoot = join(f.root, 'later-workspace')
  await starting; assert.deepEqual(f.mounts[0].roots, f.config)
  const second = await fixture(t)
  await second.start({ stateRoot: second.config.stateRoot })
  assert.deepEqual(second.mounts[0].roots, { stateRoot: second.config.stateRoot, workspaceRoot: join(second.home, 'yugoo-design-studio-workspace') })
})

test('relative/noncanonical paths, missing parents and malformed config reject without native admission or recursive creation', async t => {
  const f = await fixture(t)
  for (const stateRoot of ['relative', f.root + '/missing/../state', join(f.root, 'absent-parent', 'state')]) {
    await assert.rejects(f.start({ ...f.config, stateRoot }), /canonical|ENOENT|absolute/i)
    await f.close()
  }
  await assert.rejects(f.start(null), /trusted configuration/)
  assert.equal(f.mounts.length, 0)
  await assert.rejects(fs.stat(join(f.root, 'absent-parent')), { code: 'ENOENT' })
})

test('existing unsafe permissions and symlink roots are refused without repairing or replacing content', async t => {
  const f = await fixture(t)
  await fs.mkdir(f.config.stateRoot, { mode: 0o700 }); await fs.chmod(f.config.stateRoot, 0o755)
  await assert.rejects(f.start(f.config), /private|permission/i)
  assert.equal((await fs.stat(f.config.stateRoot)).mode & 0o777, 0o755)
  await f.close()
  const g = await fixture(t), target = join(g.root, 'owned-fixture-target')
  await fs.mkdir(target, { mode: 0o700 }); await fs.writeFile(join(target, 'sentinel'), 'retain bytes')
  await fs.symlink(target, g.config.stateRoot)
  await assert.rejects(g.start(g.config), /symbolic|symlink|physical/i)
  assert.equal(await fs.readFile(join(target, 'sentinel'), 'utf8'), 'retain bytes')
  assert.equal(g.mounts.length, 0)
})

test('failure during workspace preparation preserves the already-prepared state root and never mounts Service', async t => {
  const f = await fixture(t), mkdir = fs.mkdir, failure = new Error('workspace mkdir failed')
  t.mock.method(fs, 'mkdir', async (path, ...args) => { if (path === f.config.workspaceRoot) throw failure; return mkdir(path, ...args) })
  await assert.rejects(f.start(f.config), error => error === failure)
  assert.equal((await fs.stat(f.config.stateRoot)).isDirectory(), true)
  assert.equal(f.mounts.length, 0)
  await f.close()
})

test('shutdown registered before queued initialization prevents every directory/native operation', async t => {
  const f = await fixture(t), starting = f.start(f.config), closing = f.close()
  await assert.rejects(starting, /closed during initialization/); await closing
  assert.equal(f.mounts.length, 0)
  await assert.rejects(fs.stat(f.config.stateRoot), { code: 'ENOENT' })
})

test('shutdown joins a directory operation, preserves its partial result and does not start the next root or Service', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred(), mkdir = fs.mkdir
  t.mock.method(fs, 'mkdir', async (path, ...args) => { if (path === f.config.stateRoot) { entered.resolve(); await release.promise } return mkdir(path, ...args) })
  const starting = f.start(f.config), outcome = starting.then(() => undefined, error => error)
  await entered.promise
  let done = false; const closing = f.close().then(() => { done = true })
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(done, false)
  release.resolve(); assert.match((await outcome).message, /closed during initialization/); await closing
  assert.equal((await fs.stat(f.config.stateRoot)).isDirectory(), true)
  await assert.rejects(fs.stat(f.config.workspaceRoot), { code: 'ENOENT' })
  assert.equal(f.mounts.length, 0)
})

test('Service initialization shutdown closes the owned child before joining original bootstrap, without a self-wait', async t => {
  const f = await fixture(t, { deferInit: true, deferDispose: true }), starting = f.start(f.config)
  const outcome = starting.then(() => undefined, error => error)
  while (!f.mounts.length) await new Promise(resolve => setTimeout(resolve, 2))
  const closing = f.close(); assert.equal(f.child.closed, true); assert.equal(f.close(), closing)
  let done = false; void closing.then(() => { done = true })
  f.initializing.resolve({}); assert.match((await outcome).message, /closed during initialization/)
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(done, false, 'child cleanup must also settle')
  f.disposing.resolve(); await closing
  assert.equal(f.events.filter(value => value === 'child-close').length, 1)
})

test('Service failure is not retried; cleanup failures are retained after initialization settles', async t => {
  const f = await fixture(t, { deferInit: true, deferDispose: true, expectedCleanupFailure: true }), initError = new Error('service init failed'), disposeError = new Error('service close failed')
  const starting = f.start(f.config)
  while (!f.mounts.length) await new Promise(resolve => setTimeout(resolve, 2))
  f.initializing.reject(initError); await assert.rejects(starting, error => error === initError)
  const closing = f.close(); f.disposing.reject(disposeError)
  await assert.rejects(closing, error => error instanceof AggregateError && error.errors.includes(disposeError))
  assert.equal(f.mounts.length, 1)
})

async function nativeFixture(t) {
  const sdk = await sdkFixture(t, { step: () => { throw Error('Activation must not invoke a model') } })
  for (const [name, value] of [
    ['design', { listBundles: () => [], resolveBundle: () => undefined, resolveKit: () => undefined }],
    ['fs', {}],
  ]) {
    class Source extends Service { constructor(ctx) { super(ctx, name); Object.assign(this, value) } }
    await sdk.ctx.plugin(Source)
  }
  await sdk.ctx.plugin(Registry)
  const config = { stateRoot: join(await fs.realpath(sdk.root), 'entry-state'), workspaceRoot: join(await fs.realpath(sdk.root), 'entry-workspace') }
  return { ...sdk, config }
}

test('actual public Cordis mounts the existing reviewed Service once and unloads it while preserving its private data and native parent', { timeout: 20000 }, async t => {
  const sdk = await nativeFixture(t), { config } = sdk
  const owner = sdk.ctx.plugin(Entry, config); t.after(() => owner.dispose())
  await owner
  const service = sdk.ctx.get('studioAuthoring')
  assert.ok(service, 'existing native Service is visible after activation')
  assert.deepEqual(await service.list(sdk.parent.agent, { kind: 'bundle' }), [])
  await owner.dispose()
  await assert.rejects(service.list(sdk.parent.agent, { kind: 'bundle' }), /unavailable|disposed/i)
  assert.equal(sdk.ctx.agents.get(sdk.parent.agent.id), sdk.parent.agent)
  assert.equal(sdk.calls(), 0); assert.equal(sdk.childIds.length, 0)
  assert.equal((await fs.stat(config.stateRoot)).isDirectory(), true)
  assert.equal((await fs.stat(config.workspaceRoot)).isDirectory(), true)
})

for (const [label, blockOccurrence] of [['private root bootstrap', 1], ['existing Service raw Host initialization', 2]]) {
  test(`actual Cordis unload joins ${label}, never admits a child and keeps the native parent`, { timeout: 20000 }, async t => {
    const sdk = await nativeFixture(t), { config } = sdk, entered = deferred(), release = deferred(), mkdir = fs.mkdir
    let count = 0
    t.mock.method(fs, 'mkdir', async (path, ...args) => {
      if (path === config.stateRoot && ++count === blockOccurrence) { entered.resolve(); await release.promise }
      return mkdir(path, ...args)
    })
    const owner = sdk.ctx.plugin(Entry, config)
    t.after(async () => { release.resolve(); await owner.dispose() })
    const outcome = Promise.resolve(owner).then(() => ({ ok: true }), error => ({ ok: false, error }))
    await entered.promise
    let done = false
    const closing = owner.dispose().then(() => { done = true })
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(done, false)
    release.resolve()
    assert.equal((await outcome).ok, false)
    await closing
    assert.equal(sdk.ctx.get('studioAuthoring'), undefined)
    assert.equal(sdk.ctx.agents.get(sdk.parent.agent.id), sdk.parent.agent)
    assert.equal(sdk.calls(), 0); assert.equal(sdk.childIds.length, 0)
    assert.equal((await fs.stat(config.stateRoot)).isDirectory(), true)
  })
}
