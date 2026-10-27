import assert from 'node:assert/strict'
import { test } from 'node:test'

const { register } = await import('tsx/esm/api')
register()
const { default: DesignService } = await import('../src/design-service.ts')
const { DesignProjectKnowledgeLifecycle } = await import('../src/design-project-knowledge-lifecycle.ts')
const { DESIGN_KNOWLEDGE_PUBLICATION_KEY } = await import('../src/design-knowledge-refresh.ts')

test('restoring an already-selected project emits a process-local event for derived Panels', async () => {
  const agent = { id: 'restored-agent' }
  const project = { root: '/isolated-nonexistent-restore', projectId: 'restored-project' }
  const events = []
  const service = Object.create(DesignService.prototype)
  service.bindingKey = () => 'binding'
  service.bindings = { read: async () => ({ projectId: project.projectId, revision: 4 }) }
  service.projects = { contentRecoveryLocation: async () => project, require: async () => project, snapshot: async () => ({ checkpoint: 'saved', bundleStates: {} }) }
  service.activeWorkspaces = new Map()
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
    activeWorkspaces: new WeakMap(), contentRecoveryLocations: new WeakMap(), workspaceContentEpochs: new WeakMap(), projectContentEpochs: new Map(),
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
