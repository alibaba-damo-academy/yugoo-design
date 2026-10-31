import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { register } = await import('tsx/esm/api')
register()
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignProjectKnowledgeLifecycle } = await import('../src/design-project-knowledge-lifecycle.ts')
const { DESIGN_KNOWLEDGE_PUBLICATION_KEY } = await import('../src/design-knowledge-refresh.ts')
const { writeContentCatalog } = await import('./fixtures/content-catalog.mjs')
const { loadDesignKit } = await import('../src/kit-loader.ts')
const { contentNodeFs } = await import('../src/content-store.ts')
const { nodeDesignProjectSpawn } = await import('../src/design-project.ts')

/** Real Core constructor and public Host activation event before any Panel read.
 * Source/CLI and finite provider ports; not a running native Host or model check. */
async function activationFixture(t, { missing = false, runtime = true, acquireError, statusNotice = true } = {}) {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
  const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const root = await mkdtemp(join(tmpdir(), 'design-activation-'))
  const previousBackend = process.env.YUGOO_GIT_BACKEND
  process.env.YUGOO_GIT_BACKEND = 'cli'
  const ctx = new Context()
  let disposeRuntime
  t.after(async () => {
    try { await ctx.fiber.dispose(); await disposeRuntime?.() }
    finally {
      if (previousBackend === undefined) delete process.env.YUGOO_GIT_BACKEND
      else process.env.YUGOO_GIT_BACKEND = previousBackend
      await rm(root, { recursive: true, force: true })
    }
  })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, { persona: 'Cold Design activation' })
  ctx.provide('tools', { register() {}, get() {} })
  ctx.provide('subprocess', {})
  const service = new DesignService(ctx, { stateRoot: join(root, 'state'), projectsRoot: join(root, 'projects'), hostInstanceId: 'activation-test' })
  service.spawnAdapter = () => nodeDesignProjectSpawn
  if (!statusNotice) service.injectKnowledgeOrchestrationSnapshot = async () => {}
  const agent = { id: 'original-cold-session', ctx, session: { id: 'original-cold-session', header: {} }, inject() {} }
  const counts = { acquire: [], release: [] }
  if (runtime) disposeRuntime = service.registerDesignKnowledgeRuntime({
    defaultProvider: 'fixture', service: { revision: async () => 'rev:0' },
    administration: {
      async acquireProject(location) { counts.acquire.push(location.projectId); if (acquireError && counts.acquire.length === 1) throw acquireError },
      async releaseProject(projectId) { counts.release.push(projectId) },
    },
  })
  async function project(name) {
    const catalog = await writeContentCatalog(join(root, name), { name, version: '1.0', bundles: [{ name: 'alpha', version: '1.0' }] })
    const kit = await loadDesignKit(contentNodeFs, catalog.root, { sourceId: `trusted:activation-${name}` })
    const created = await service.projects.create(name, { provider: 'fixture' })
    await service.projects.setKitPin(created.projectId, { name: kit.name, version: kit.version })
    const record = await service.projects.require(created.projectId)
    await service.prepareProjectKit(record, kit)
    return record
  }
  const selected = await project('selected')
  const mindsetPath = join(selected.root, 'design_kit/kit/mindset.md')
  await writeFile(mindsetPath, (await readFile(mindsetPath, 'utf8')) + '\nCurrent project-only cold method.\n')
  const file = join(selected.designFilesRoot, 'alpha/alpha.json')
  await mkdir(join(selected.designFilesRoot, 'alpha'), { recursive: true })
  const saved = JSON.stringify({ summary: 'Preserve the original project facts.' })
  await writeFile(file, saved)
  for (const args of [['add', 'design_files'], ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'Saved fixture facts']]) {
    const result = await nodeDesignProjectSpawn({ argv: ['git', ...args], cwd: selected.root })
    assert.equal(result.exitCode, 0, result.stderr)
  }
  const key = service.bindingKey(agent), binding = await service.bindings.read(key)
  await service.bindings.bind(key, selected.projectId, binding.revision)
  if (missing) await rename(join(selected.root, 'design_kit'), join(root, 'unavailable-original-source'))
  service.projectKits.clear() // A cold process has not resolved this project's definitions.
  const activate = () => ctx.agents.register(agent)
  const prompt = async () => (await ctx.systemPrompt.assemble({ agent })).sections.find(section => section.name === 'design:mindset')?.text
  return { service, ctx, agent, selected, counts, activate, prompt, project, file, saved }
}

test('native activation with a missing Kit preserves the session, Panel recovery and the original lease for switching and closing', async t => {
  const f = await activationFixture(t, { missing: true })
  await f.activate()
  assert.equal(f.ctx.agents.get(f.agent.id), f.agent)
  assert.equal((await f.service.currentSelection(f.agent)).projectId, f.selected.projectId)
  assert.deepEqual(f.counts.acquire, [f.selected.projectId], 'Kit absence cannot prevent the original provider lease restoration')
  assert.match(f.service.knowledgeRestoreFailures.get(f.agent).message, /original Kit source unavailable/)
  assert.match(await f.prompt(), /design_kit_unavailable/)
  const { DesignPanelRemote } = await import('../src/panel-remote.ts')
  const remote = Object.create(DesignPanelRemote.prototype)
  Object.assign(remote, { design: f.service, worktreeProjections: new Map() })
  const signal = new AbortController().signal
  const workspace = await remote.readWorkspace(f.agent, signal)
  assert.equal(workspace.projectId, f.selected.projectId)
  assert.equal(workspace.access.mode, 'recovery')
  assert.equal(workspace.access.writable, false)
  assert.equal(workspace.design.alpha.state.summary, JSON.parse(f.saved).summary)
  await assert.rejects(f.service.projectForAgent(f.agent, signal), /original Kit source unavailable/)
  const { nodeFs } = await import('../src/service-tools.ts')
  await assert.rejects(f.service.designFilesForProject(f.agent, f.selected.projectId, nodeFs, signal), /restore the full exact pinned Kit/)
  assert.equal(await readFile(f.file, 'utf8'), f.saved)
  const healthy = await f.project('healthy')
  const opened = await f.service.executeProjectCommand(f.agent, `open ${healthy.projectId}`, signal)
  assert.equal(opened.kind, 'success', opened.text)
  assert.deepEqual(f.counts.acquire, [f.selected.projectId, healthy.projectId])
  assert.deepEqual(f.counts.release, [f.selected.projectId])
  const closed = await f.service.executeProjectCommand(f.agent, 'close', signal)
  assert.equal(closed.kind, 'success', closed.text)
  assert.deepEqual(f.counts.release, [f.selected.projectId, healthy.projectId])
  assert.equal(await f.service.currentSelection(f.agent), undefined)
})

for (const runtime of [true, false]) test(`healthy native activation prepares the current project Kit before prompt assembly (knowledge runtime: ${runtime})`, async t => {
  const f = await activationFixture(t, { runtime })
  await f.activate()
  assert.match(await f.prompt(), /Current project-only cold method\./)
  assert.match(await f.prompt(), /active_design_mindset/)
  assert.deepEqual(f.counts.acquire, runtime ? [f.selected.projectId] : [])
  assert.equal(f.service.knowledgeRestoreFailures.get(f.agent), undefined)
})

test('provider restoration failure remains visible without hiding an available project Kit or aborting native activation', async t => {
  // An optional notice must not be responsible for loading the healthy Kit.
  const f = await activationFixture(t, { acquireError: new Error('provider open failed'), statusNotice: false })
  await f.activate()
  assert.equal(f.ctx.agents.get(f.agent.id), f.agent)
  assert.match(f.service.knowledgeRestoreFailures.get(f.agent).message, /provider open failed/)
  assert.equal(f.service.projectKits.has(f.selected.root), true)
  assert.match(await f.prompt(), /Current project-only cold method\./)
  assert.equal(f.counts.acquire.length, 1)
  assert.deepEqual(f.counts.release, [], 'an unsuccessful acquire must not invent a held lease')
})

for (const closeFirst of [false, true]) test(`a failed provider restore permits normal navigation without a fabricated lease (close first: ${closeFirst})`, async t => {
  const f = await activationFixture(t, { acquireError: new Error('provider open failed'), statusNotice: false })
  await f.activate()
  const signal = new AbortController().signal
  if (closeFirst) {
    const closed = await f.service.executeProjectCommand(f.agent, 'close', signal)
    assert.equal(closed.kind, 'success', closed.text)
    assert.equal(await f.service.currentSelection(f.agent), undefined)
    assert.deepEqual(f.counts.release, [], 'there is no failed provider lease to release')
  }
  const healthy = await f.project('healthy')
  const opened = await f.service.executeProjectCommand(f.agent, `open ${healthy.projectId}`, signal)
  assert.equal(opened.kind, 'success', opened.text)
  assert.deepEqual(f.counts.acquire, [f.selected.projectId, healthy.projectId])
  assert.deepEqual(f.counts.release, [], 'switching must not fabricate a release for the failed original acquire')
  assert.equal((await f.service.currentSelection(f.agent)).projectId, healthy.projectId)
  const closed = await f.service.executeProjectCommand(f.agent, 'close', signal)
  assert.equal(closed.kind, 'success', closed.text)
  assert.deepEqual(f.counts.release, [healthy.projectId], 'only the actually acquired healthy lease is released')
})

test('restoring an already-selected project emits a process-local event for derived Panels', async () => {
  const agent = { id: 'restored-agent' }
  const project = { root: '/isolated-nonexistent-restore', projectId: 'restored-project' }
  const events = []
  const service = Object.create(DesignService.prototype)
  service.bindingKey = () => 'binding'
  service.bindings = { read: async () => ({ projectId: project.projectId, revision: 4 }) }
  service.projects = { contentRecoveryLocation: async () => project, require: async () => project, snapshot: async () => ({ checkpoint: 'saved', bundleStates: {} }) }
  service.activeWorkspaces = new Map()
  service.workspaceReadScope = new AsyncLocalStorage()
  service.contentRecoveryLocations = new WeakMap()
  service.workspaceContentEpochs = new WeakMap()
  service.projectContentEpochs = new Map()
  service.selectedAgents = new Set()
  service.selectedAgentRefs = new WeakMap()
  service.workspaceChangeListeners = new Set([event => events.push(event)])

  const workspace = await service.restoreWorkspace(agent)
  assert.equal(workspace.project, project)
  assert.deepEqual(events, [{ kind: 'workspace-restored', agent }])
  assert.equal(service.activeWorkspaces.get(agent), workspace)
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function existingAgentFixture({ bindingGate, acquireGate, acquireError, selected = true } = {}) {
  const agent = { id: 'original-agent' }
  const project = { root: '/isolated-nonexistent-restore', stateRoot: '/unused', projectId: 'original-project', knowledge: { provider: 'fixture' } }
  const binding = Object.freeze({ projectId: selected ? project.projectId : null, revision: 4 })
  const publication = Object.freeze({ schemaVersion: 1, key: 'key', edges: 'edges', checkpoint: 'published', revision: 'rev:4', warnings: [] })
  const counts = { acquire: 0, release: 0, materialize: 0, selectedReads: 0 }
  const events = [], warnings = []
  let open = false
  const cache = { async readSemanticCache(key) { return key === DESIGN_KNOWLEDGE_PUBLICATION_KEY ? JSON.stringify(publication) : undefined } }
  const runtime = {
    defaultProvider: 'fixture', service: {},
    semantic: { enabled: true, publicationCache: () => open ? cache : undefined },
    administration: {
      async acquireProject(location, lease) {
        assert.equal(location.projectId, project.projectId)
        assert.equal(lease, 'session:original-agent')
        counts.acquire++
        await acquireGate?.promise
        if (acquireError) throw acquireError
        open = true
      },
      async releaseProject() { counts.release++; open = false },
    },
  }
  const service = Object.create(DesignService.prototype)
  Object.assign(service, {
    context: { get: name => name === 'agents' ? { list: () => [agent] } : undefined, logger: { warn: message => warnings.push(message) } },
    bindingKey: () => 'binding',
    bindings: { async read() { counts.selectedReads++; await bindingGate?.promise; return binding } },
    projects: { contentRecoveryLocation: async () => project, require: async () => project, snapshot: async () => ({ checkpoint: 'published', bundleStates: {} }), status: async () => ({ lastCheckpoint: 'published' }) },
    activeWorkspaces: new WeakMap(), workspaceReadScope: new AsyncLocalStorage(), contentRecoveryLocations: new WeakMap(), workspaceContentEpochs: new WeakMap(), projectContentEpochs: new Map(),
    selectedAgents: new Set(), selectedAgentRefs: new WeakMap(), workspaceChangeListeners: new Set([event => events.push(event)]),
    conversationMutations: new WeakMap(), knowledgeLifecycles: new Map(), knowledgeRestorations: new Map(), knowledgeRestorationOwners: new WeakMap(), knowledgeRestoreFailures: new WeakMap(), disposedAgents: new WeakSet(),
    knowledgeIndexStates: new Map(), knowledgeIndexPhases: new Map(), knowledgeIndexAttempts: new Map(), knowledgeMaintenance: new Map(), knowledgeMaintenanceTargets: new Map(), knowledgeMutations: new Map(), knowledgeIndexFailures: new Map(),
    knowledgeMaintenanceTarget: () => undefined, assertProjectSelection() {},
    scheduleKnowledgeMaintenance() { throw new Error('restore must not start maintenance') },
    refreshPublishedKnowledge() { throw new Error('restore must not index') },
    rebuildDerivedKnowledge() { throw new Error('restore must not rebuild') },
    knowledgeLifecycleFor(agent) {
      let lifecycle = service.knowledgeLifecycles.get(agent)
      if (!lifecycle) {
        lifecycle = new DesignProjectKnowledgeLifecycle({ ...runtime, leaseId: 'session:original-agent', materialize: async () => { counts.materialize++ } })
        service.knowledgeLifecycles.set(agent, lifecycle)
      }
      return lifecycle
    },
  })
  return { service, runtime, agent, project, binding, publication, counts, events, warnings, open: () => open }
}

test('runtime replacement restores the same live Agent and durable publication without indexing or a model turn', async () => {
  const f = existingAgentFixture()
  let dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  const pending = f.service.knowledgeRestorations.get(f.agent)
  assert.equal(f.service.restoreAgentKnowledge(f.agent), pending, 'creation and registration share one restore')
  await pending
  assert.equal(f.counts.acquire, 1)
  assert.equal(f.counts.materialize, 1)
  assert.equal((await f.service.knowledgeStatusSnapshot(f.agent)).state, 'current')
  assert.equal((await f.service.currentSelection(f.agent)).revision, f.binding.revision)
  await dispose()
  assert.equal(f.counts.release, 1)
  dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  await f.service.knowledgeRestorations.get(f.agent)
  assert.equal(f.counts.acquire, 2, 'same existing Agent reacquires without agent/created')
  assert.equal((await f.service.knowledgeStatusSnapshot(f.agent)).latestComplete.revision, 'rev:4')
  assert.equal(f.binding.revision, 4)
  assert.equal(f.publication.checkpoint, 'published')
  await dispose()
  assert.equal(f.counts.release, 2)
})

test('runtime disposal fences a restore still reading its binding before acquiring a lease', async () => {
  const bindingGate = deferred(), f = existingAgentFixture({ bindingGate })
  const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  await Promise.resolve()
  const closing = dispose()
  bindingGate.resolve()
  await closing
  assert.equal(f.counts.acquire, 0)
  assert.equal(f.counts.release, 0)
  assert.equal(f.service.knowledgeRestorations.size, 0)
})

test('registration arriving during Agent activation restores against the new runtime', async () => {
  const bindingGate = deferred(), f = existingAgentFixture({ bindingGate })
  const activation = f.service.restoreAgentKnowledge(f.agent)
  await Promise.resolve()
  const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  const registered = f.service.knowledgeRestorations.get(f.agent)
  assert.notEqual(registered, activation, 'an activation without a runtime must not consume registration work')
  bindingGate.resolve()
  await Promise.all([activation, registered])
  assert.equal(f.counts.acquire, 1)
  assert.equal((await f.service.knowledgeStatusSnapshot(f.agent)).state, 'current')
  await dispose()
})

test('runtime disposal drains an in-flight acquire and releases its lease exactly once', async () => {
  const acquireGate = deferred(), f = existingAgentFixture({ acquireGate })
  const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  while (!f.counts.acquire) await new Promise(resolve => setImmediate(resolve))
  const closing = dispose()
  acquireGate.resolve()
  await closing
  assert.equal(f.counts.acquire, 1)
  assert.equal(f.counts.release, 1)
  assert.equal(f.open(), false)
})

test('an Agent disposed while its binding is being restored cannot acquire later', async () => {
  const bindingGate = deferred(), f = existingAgentFixture({ bindingGate })
  const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  const pending = f.service.knowledgeRestorations.get(f.agent)
  f.service.disposedAgents.add(f.agent)
  bindingGate.resolve()
  await pending
  assert.equal(f.counts.acquire, 0)
  await dispose()
})

test('restore failure remains an honest failed status and reads do not retry it', async () => {
  const f = existingAgentFixture({ acquireError: new Error('provider open failed') })
  const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  await assert.rejects(f.service.knowledgeRestorations.get(f.agent), /provider open failed/)
  const first = await f.service.knowledgeStatusSnapshot(f.agent)
  const second = await f.service.knowledgeStatusSnapshot(f.agent)
  assert.equal(first.state, 'failed')
  assert.equal(first.semanticLayer, 'enabled')
  assert.match(first.recovery.message, /provider open failed/)
  assert.deepEqual(second, first)
  assert.equal(f.counts.acquire, 1)
  await dispose()
})

test('live Agents without a Design selection do not open any project', async () => {
  const f = existingAgentFixture({ selected: false })
  const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
  await f.service.knowledgeRestorations.get(f.agent)
  assert.equal(f.counts.acquire, 0)
  assert.equal(await f.service.knowledgeStatusSnapshot(f.agent), undefined)
  await dispose()
})

test('the public Host registry supplies an existing Agent without replaying its creation event', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: AgentRegistry } = await import('@deepseek-ai/dsh-agent')
  const ctx = new Context(), f = existingAgentFixture()
  try {
    await ctx.plugin(AgentRegistry)
    f.agent.ctx = ctx
    f.agent.session = { id: f.agent.id }
    await ctx.agents.register(f.agent)
    let creations = 0
    ctx.on('agent/created', () => { creations++ })
    f.service.context = ctx
    const dispose = f.service.registerDesignKnowledgeRuntime(f.runtime)
    await f.service.knowledgeRestorations.get(f.agent)
    assert.equal(f.counts.acquire, 1)
    assert.equal(creations, 0)
    assert.equal(ctx.get('agents').get(f.agent.id), f.agent)
    await dispose()
  } finally { await ctx.fiber.dispose() }
})
