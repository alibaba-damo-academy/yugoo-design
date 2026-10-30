/** Actual RC2 Agent/loop/query, scripted inherited route, real S2/S5a temp disk.
 * Source Fs/registered-content ports are explicit fixtures; no real Host/model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { fixture as sdkFixture, call, stop, deferred, sessions } from './fixtures/authoring-sdk.mjs'

const { createDshStudioAuthoringHost } = await import('../src/authoring-host.ts')
const { createStudioAuthoringReferenceStore } = await import('../src/authoring-reference-store.ts')
const { createStudioInstances } = await import('dsh-design-studio/node')
const { createDshStudioInstanceAdapters } = await import('../src/authoring-sources.ts')
const { loadDesignBundle } = await import('dsh-design-core')
const { originalFiles, additions, textOf, pin } = await import('../../companion/test/fixtures/studio-changes-fixture.mjs')
const { PANEL_COMPONENT_CATALOG, GENERATED_COMPONENT_KINDS } = await import('../../core/src/panel-component-catalog.ts')
const catalog = () => ({ components: Object.entries(PANEL_COMPONENT_CATALOG).map(([name, value]) => ({ name,
  description: value.description, sourceBound: value.sourceBound === true, generated: GENERATED_COMPONENT_KINDS.includes(name) })) })
const addressOf = r => ({ sessionId: r.sessionId, epoch: r.epoch })
const containsFailure = (error, failure) => error === failure || error instanceof AggregateError && error.errors.some(value => containsFailure(value, failure))
const sequence = n => [call('studio_authoring_read', {}), call('studio_authoring_prepare', { changes: additions() }), stop()][n % 3]

async function installedSources() {
  const root = '/fixture/trusted-independent', files = new Map(originalFiles.map(file => [root + '/' + file.path, Buffer.from(file.base64, 'base64')]))
  const dirs = new Set([root]); for (const path of files.keys()) { let p = path; while (p.includes('/')) { p = p.slice(0, p.lastIndexOf('/')); dirs.add(p) } }
  const targets = new Map(), paths = new Map()
  const target = path => { if (!targets.has(path)) { const value = { targetKey: `opaque:${targets.size}`, displayPath: 'fixture://display' }; targets.set(path, value); paths.set(value.targetKey, path) } return targets.get(path) }
  const fsPort = {
    async resolve(path) { assert.ok(files.has(path) || dirs.has(path)); return target(path) },
    contains(a, b) { const left = paths.get(a.targetKey), right = paths.get(b.targetKey); return right === left || right.startsWith(left + '/') },
    async stat(t) { const p = paths.get(t.targetKey); return files.has(p) ? { type: 'file', size: files.get(p).length, version: 'v1' } : dirs.has(p) ? { type: 'directory', version: 'v1' } : undefined },
    async readBytes(t, _signal, maxBytes) { const bytes = files.get(paths.get(t.targetKey)); assert.ok(bytes.length <= maxBytes); return Buffer.from(bytes) },
    async listDir(t) { const prefix = paths.get(t.targetKey) + '/', names = new Set(); for (const path of [...files.keys(), ...dirs]) if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0]); return [...names].map(name => ({ name, type: dirs.has(prefix + name) ? 'directory' : 'file', target: target(prefix + name) })) },
    async readText() { assert.fail('Host source capture must use Fs bytes') },
  }
  const loader = { readText: async p => files.get(p)?.toString('utf8'), readBytes: async p => files.get(p),
    listDir: async p => (await fsPort.listDir(target(p))).map(entry => entry.name), isDirectory: async p => dirs.has(p), realPath: async p => p }
  const content = await loadDesignBundle(loader, { rootDir: root, sourceId: 'trusted:host-source-fixture' }, pin)
  return { fs: fsPort, design: { registerCurrentKitSource: () => () => {}, listKits: () => [], listBundles: () => [content.skill], resolveBundle: p => p.name === pin.name && p.version === pin.version ? content : undefined, resolveKit: () => undefined } }
}

async function fixture(t, options = {}) {
  let stateRoot
  const dispatches = [], source = await installedSources()
  const sdk = await sdkFixture(t, { step: options.step ?? sequence,
    async created(agent) {
      await options.created?.(agent)
      const followup = agent.followup.bind(agent)
      agent.followup = message => {
        const binding = message.source?.studioAuthoring
        if (binding) {
          // Observe immediately before the real SDK followup, never replace its
          // execution with a mock. S5a validation/fsync behavior has its own suite.
          const directory = join(stateRoot, 'studio-authoring-references')
          const refs = readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')).reference)
          const retained = refs.find(ref => ref.messageId === String(message.id) && ref.epoch === binding.epoch)
          dispatches.push({ retained, binding })
          if (options.unknownDispatch) throw new Error('Injected unknown dispatch acknowledgement before consumption')
        }
        return followup(message)
      }
    },
  })
  const root = await fs.realpath(sdk.root)
  stateRoot = join(root, 'private-studio'); const workspaceRoot = join(root, 'isolated-workspace'); await fs.mkdir(workspaceRoot, { mode: 0o700 })
  let ownerContext = sdk.ctx, ownerScope
  if (options.ownerScope) {
    const ownerPlugin = Object.assign(ctx => { ownerContext = ctx }, { inject: ['agents', 'sessions', 'sessionQuery'] })
    ownerScope = sdk.ctx.plugin(ownerPlugin); await ownerScope; t.after(() => ownerScope.dispose())
  }
  const hostOptions = { ctx: ownerContext, ...source, stateRoot, workspaceRoot, readComponents: options.readComponents ?? catalog }
  const host = await createDshStudioAuthoringHost(hostOptions)
  t.after(() => options.expectedHostCleanupFailure ? assert.rejects(host.dispose(), error => containsFailure(error, options.expectedHostCleanupFailure)) : host.dispose())
  const bound = host.forParent(sdk.parent.agent), record = await bound.instances.copy({ kind: 'bundle', bundle: pin })
  const request = { invocationId: randomUUID(), id: record.id, expectedRevision: record.revision, paths: additions().map(change => change.path), prompt: 'Refine this exact retained working copy.' }
  return { ...sdk, source, hostOptions, host, bound, record, request, dispatches, stateRoot, workspaceRoot, ownerScope }
}

test('guarded parent forwards canonical blank creation without starting native work', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const blank = await f.bound.instances.create({ kind: 'kit', title: { zh: '宿主新方法', en: 'Host method' } })
  assert.equal(blank.createdBlank, true)
  assert.deepEqual(blank.mounts, [])
  assert.equal((await f.bound.instances.read({ id: blank.id })).id, blank.id)
  assert.equal(f.childIds.length, 0)
  assert.equal(f.dispatches.length, 0)
  await f.bound.dispose()
  await assert.rejects(f.bound.instances.create({ kind: 'kit', title: { zh: '拒绝', en: 'Rejected' } }), /disposed/iu)
})

test('parent-owned conversation receipts deduplicate, expire at a bounded count and retain call-time intent without saving', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  const original = await f.bound.instances.readFile({ id: f.record.id, path: 'SKILL.md' })
  const request = { id: f.record.id, expectedRevision: 0, changes: [{ path: 'SKILL.md', content: original.content + '\nFirst intent.\n' }] }
  const first = f.bound.prepareChanges(request)
  request.changes[0].content = 'caller mutation'
  const prepared = await first
  assert.match(prepared.prepared.request.changes[0].content, /First intent/)
  assert.deepEqual((await f.bound.prepareChanges(prepared.prepared.request)).locator, prepared.locator)
  const returned = await f.bound.readPrepared(prepared.locator)
  returned.request.changes[0].content = 'returned object mutation'
  assert.match((await f.bound.readPrepared(prepared.locator)).request.changes[0].content, /First intent/)
  let latest
  for (let i = 0; i < 16; i++) latest = await f.bound.prepareChanges({ id: f.record.id, expectedRevision: 0,
    changes: [{ path: 'SKILL.md', content: original.content + `\nSeparate intent ${i}.\n` }] })
  await assert.rejects(f.bound.readPrepared(prepared.locator), /exact live parent/)
  assert.equal((await f.bound.readPrepared(latest.locator)).candidate.digest, latest.prepared.candidate.digest)
  assert.equal((await f.bound.instances.read(f.record.id)).revision, 0)
  assert.equal(f.calls(), 0, 'projecting a Host candidate does not launch native/model work')
})

test('one composed store retains references before SDK dispatch, prepares without saving, and reopens an explicit save', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  assert.equal(f.host.forParent(f.parent.agent), f.bound)
  assert.deepEqual((await f.bound.instances.read(f.record.id)).source.bundle, pin)
  const run = await f.bound.start(f.request), outcome = await run.result
  assert.equal(outcome.status, 'completed'); assert.equal(f.dispatches.length, 1)
  assert.deepEqual(f.dispatches[0].retained, run.reference)
  assert.equal(f.dispatches[0].binding.scope.id, f.record.id)
  const reopenedRefs = await createStudioAuthoringReferenceStore({ stateRoot: f.stateRoot })
  assert.deepEqual(await reopenedRefs.read({ ...addressOf(run.reference), parentSessionId: String(f.parent.agent.id) }), run.reference)
  assert.deepEqual(await f.bound.listReferences(), [run.reference])
  const prepared = await f.bound.readPrepared(addressOf(run.reference))
  assert.equal(prepared.candidate.valid, true); assert.deepEqual(run.readPrepared(), prepared)
  assert.equal((await f.bound.instances.read(f.record.id)).revision, 0)
  const saved = await f.bound.instances.saveChanges({ ...prepared.request, mode: 'validated', digest: prepared.candidate.digest })
  assert.equal(saved.revision, 1)
  await f.host.dispose()
  const fresh = await createDshStudioAuthoringHost(f.hostOptions); t.after(() => fresh.dispose())
  const cold = fresh.forParent(f.parent.agent)
  for (const change of additions()) assert.equal((await cold.instances.readFile({ id: saved.id, path: change.path })).content, change.content)
  assert.equal((await cold.observe(addressOf(run.reference))).status, 'completed')
  await assert.rejects(cold.cancel(addressOf(run.reference), { expectedTurn: null }), /exact owned/)
  await assert.rejects(cold.readPrepared(addressOf(run.reference)), /exact owned/)
  const second = await cold.resume({ ...f.request, invocationId: randomUUID(), previous: addressOf(run.reference), explicit: true, expectedRevision: saved.revision, prompt: 'Explicitly review the saved revision.' })
  assert.equal((await second.result).status, 'completed')
  assert.equal(second.reference.sessionId, run.reference.sessionId); assert.notEqual(second.reference.epoch, run.reference.epoch)
  assert.equal(f.dispatches.length, 2); assert.deepEqual(f.dispatches[1].retained, second.reference)
  assert.equal((await cold.instances.read(saved.id)).revision, 1, 'the second native prepare also never saves')
})

test('foreign addresses, fake/disconnected parents and same-ID replacements never acquire old owned handles', { timeout: 15000 }, async t => {
  const f = await fixture(t), run = await f.bound.start(f.request); await run.result
  assert.throws(() => f.host.forParent({ id: f.parent.agent.id }), /exact native/)
  const other = await f.ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: f.root }, agentOptions: { provider: 'studio-sdk-fixture', model: 'inherited-parent-route' } }); t.after(() => other.dispose())
  const foreign = f.host.forParent(other.agent)
  assert.deepEqual(await foreign.listReferences(), [])
  await assert.rejects(foreign.observe({ ...addressOf(run.reference), parentSessionId: String(f.parent.agent.id), scope: run.reference.scope }), /another exact parent/)
  assert.equal((await foreign.instances.read(f.record.id)).id, f.record.id, 'S2 records are shared Host data, not per-Agent isolation')
  await assert.rejects(f.bound.observe({ sessionId: randomUUID(), epoch: randomUUID() }), /No retained/)
  await f.parent.dispose()
  await assert.rejects(f.bound.observe(addressOf(run.reference)), /disposed|disconnected/)
  const replacement = await f.ctx.agents.resume({ resumeSessionId: sessions.SessionId(String(f.parent.agent.id)), agentOptions: { provider: 'studio-sdk-fixture', model: 'inherited-parent-route' } }); t.after(() => replacement.dispose())
  assert.notEqual(replacement.agent, f.parent.agent)
  const renewed = f.host.forParent(replacement.agent); assert.notEqual(renewed, f.bound)
  assert.equal((await renewed.observe(addressOf(run.reference))).status, 'completed')
  await assert.rejects(renewed.cancel(addressOf(run.reference), { expectedTurn: null }), /exact owned/)
  await assert.rejects(renewed.readPrepared(addressOf(run.reference)), /exact owned/)
})

test('retention failure prevents followup and unknown dispatch is retained without replay or automatic save', { timeout: 15000 }, async t => {
  await t.test('retention failure', async t => {
    const f = await fixture(t), directory = join(f.stateRoot, 'studio-authoring-references')
    await fs.chmod(directory, 0o755)
    try { await assert.rejects(f.bound.start(f.request), /permissions|private/) } finally { await fs.chmod(directory, 0o700) }
    assert.equal(f.dispatches.length, 0); assert.equal(f.calls(), 0)
    assert.ok(f.childIds.every(id => f.ctx.agents.get(id) === undefined))
    assert.equal((await f.bound.instances.read(f.record.id)).revision, 0)
  })
  await t.test('unknown dispatch', async t => {
    const f = await fixture(t, { unknownDispatch: true }), run = await f.bound.start(f.request), observation = await run.result
    assert.equal(observation.status, 'unknown'); assert.equal(observation.consumed, false)
    assert.equal(f.dispatches.length, 1); assert.deepEqual(f.dispatches[0].retained, run.reference)
    const before = f.childIds.length
    await assert.rejects(f.bound.resume({ ...f.request, invocationId: randomUUID(), previous: addressOf(run.reference), explicit: true, prompt: 'Do not redispatch unknown prior input.' }), /unconsumed or unknown/)
    assert.equal(f.childIds.length, before); assert.equal(f.calls(), 0)
    assert.equal((await f.bound.instances.read(f.record.id)).revision, 0)
  })
})

test('Host disposal starts native cancellation before draining and returned run methods cannot bypass admission', { timeout: 15000 }, async t => {
  const entered = deferred()
  const f = await fixture(t, { async step(_n, request) { entered.resolve(); await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true })); return stop() } })
  const run = await f.bound.start(f.request); await entered.promise
  const closing = f.host.dispose(); assert.equal(f.host.dispose(), closing)
  assert.throws(() => f.host.forParent(f.parent.agent), /disposed/)
  await assert.rejects(f.bound.instances.read(f.record.id), /disposed/)
  await assert.rejects(run.observe(), /disposed/); await assert.rejects(run.cancel({ expectedTurn: null }), /disposed/)
  assert.throws(() => run.readPrepared(), /disposed/)
  await closing
  assert.equal((await run.result).status, 'cancelled')
  assert.equal(f.ctx.agents.get(f.parent.agent.id), f.parent.agent)
  assert.ok(f.childIds.every(id => f.ctx.agents.get(id) === undefined))
})

test('parent disconnect during admitted component lookup prevents dispatch and drains after the lookup settles', { timeout: 15000 }, async t => {
  const entered = deferred(), release = deferred(); t.after(() => release.resolve())
  const f = await fixture(t, { async readComponents() { entered.resolve(); await release.promise; return catalog() } })
  const starting = f.bound.start(f.request), rejected = assert.rejects(starting, /disposed|disconnected|closed/i)
  await entered.promise; await f.parent.dispose()
  const closing = f.host.dispose(); let drained = false; void closing.then(() => { drained = true })
  await Promise.resolve(); assert.equal(drained, false)
  release.resolve(); await rejected; await closing
  assert.equal(f.calls(), 0); assert.equal(f.dispatches.length, 0)
})

test('an admitted S2 save committed before parent disconnect is preserved despite the post-await rejection', { timeout: 15000 }, async t => {
  const f = await fixture(t), committed = deferred(), release = deferred(); t.after(() => release.resolve())
  const target = join(f.stateRoot, 'studio-instance-drafts', f.record.id + '.json'), original = fs.rename
  let intercept = true
  t.mock.method(fs, 'rename', async (from, to) => {
    await original(from, to)
    if (intercept && to === target) { intercept = false; committed.resolve(); await release.promise }
  }); syncBuiltinESMExports()
  const save = f.bound.instances.saveFile({ id: f.record.id, expectedRevision: 0, path: 'SKILL.md', content: 'Human content survives the disconnected response.' })
  const rejected = assert.rejects(save, /disposed|disconnected/)
  try { await committed.promise; await f.parent.dispose() }
  finally { release.resolve() }
  await rejected; t.mock.restoreAll(); syncBuiltinESMExports()
  const reopened = await createStudioInstances({ stateRoot: f.stateRoot, ...createDshStudioInstanceAdapters(f.source) })
  assert.equal((await reopened.read(f.record.id)).revision, 1)
  assert.equal((await reopened.readFile({ id: f.record.id, path: 'SKILL.md' })).content, 'Human content survives the disconnected response.')
  assert.equal(f.calls(), 0)
})

test('native cleanup result rejection remains observable and Host disposal preserves the actual failure', { timeout: 15000 }, async t => {
  const failure = new Error('injected actual child storage-close failure')
  const f = await fixture(t, { expectedHostCleanupFailure: failure })
  // Fault only the existing public memory-persistence port. Actual RC2 native
  // handles still close/unregister and produce their own cleanup failure.
  const backend = f.ctx.sessionPersistence, handleFor = backend.handle.bind(backend)
  backend.handle = (row, access) => {
    const handle = handleFor(row, access), close = handle.close.bind(handle)
    if (row.header.parentSession === f.parent.agent.session.id) handle.close = async () => { await close(); throw failure }
    return handle
  }
  const run = await f.bound.start(f.request)
  await assert.rejects(run.result, error => containsFailure(error, failure))
  await assert.rejects(f.host.dispose(), error => containsFailure(error, failure))
  assert.ok(f.childIds.every(id => f.ctx.agents.get(id) === undefined))
  assert.equal(f.ctx.agents.get(f.parent.agent.id), f.parent.agent)
  assert.equal(f.dispatches.length, 1)
})

test('owner scope unloading revokes every parent while later S4 cleanup is still draining', { timeout: 15000 }, async t => {
  const entered = deferred(), cancelling = deferred(), release = deferred(); t.after(() => release.resolve())
  const f = await fixture(t, { ownerScope: true, async step(_n, request) {
    entered.resolve(); await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }))
    cancelling.resolve(); await release.promise; return stop()
  } })
  const other = await f.ctx.agents.create({ sessionId: sessions.SessionId(randomUUID()), meta: { cwd: f.root }, agentOptions: { provider: 'studio-sdk-fixture', model: 'inherited-parent-route' } }); t.after(() => other.dispose())
  const later = f.host.forParent(other.agent), run = await later.start(f.request); await entered.promise
  const unloading = f.ownerScope.dispose(); await cancelling.promise
  try {
    await assert.rejects(f.bound.instances.read(f.record.id), /inactive|disposed|unload/i)
    await assert.rejects(run.observe(), /inactive|disposed|unload/i)
  } finally { release.resolve() }
  await unloading; assert.equal((await run.result).status, 'cancelled')
  assert.equal(f.ctx.agents.get(f.parent.agent.id), f.parent.agent)
  assert.equal(f.ctx.agents.get(other.agent.id), other.agent)
})
