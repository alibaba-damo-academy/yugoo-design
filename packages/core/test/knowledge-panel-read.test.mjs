import test from 'node:test'
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
const { register } = await import('tsx/esm/api'); register()
const { default: DesignService } = await import('../src/design-service.ts')

function fixture() {
  let checkpoint = 'c1'
  let changeDuringQuery = false
  const projectId = '11111111-1111-4111-8111-111111111111'
  const receiver = {
    refreshPublishedKnowledge: async () => { throw new Error('Panel read must not start KAG maintenance') },
    projectForAgent: async () => ({ projectId }),
    withProjectMutationFor: async () => { assert.fail('pure graph reads must not occupy the Design Files mutation lane') },
    designFilesForProject: async () => ({ head: async () => checkpoint }),
    assertProjectSelection() {},
    knowledgeRecoveryStatus: () => undefined,
    knowledgeIndexStatus: () => 'unknown',
    knowledgeIndexPhase: () => 'unknown',
    kitForAgent: () => undefined,
    requireKnowledgeRuntime: () => ({ semantic: undefined, service: {
      revision: async () => 'rev:1', query: async () => {
        if (changeDuringQuery) checkpoint = 'c2'
        return { revision: 'rev:1', entities: [], relations: [],
          page: { offset: 0, nextOffset: null, totalEntities: 0, totalRelations: 0 } }
      },
    } }),
  }
  return { receiver, changeDuringRead: () => { changeDuringQuery = true }, read: () => DesignService.prototype.readStoredDesignGraph.call(receiver, {}) }
}

test('DSH stored graph is a pure read and exposes current publication state', async () => {
  const f = fixture(), graph = await f.read()
  assert.deepEqual(graph.warnings, [])
  assert.equal(graph.checkpoint, 'c1')
  assert.equal(graph.knowledgeRevision, 'rev:1')
  assert.equal(graph.coverage.embedding, 'unknown')
})

test('DSH rejects a checkpoint replaced during the pure graph read', async () => {
  const f = fixture()
  f.changeDuringRead()
  await assert.rejects(f.read(), /checkpoint changed during graph read/)
})

test('DSH explicit recovery retry schedules maintenance without a later save or reopen', async () => {
  const calls = []
  const projectId = '11111111-1111-4111-8111-111111111111'
  const agent = {}
  const receiver = {
    projectForAgent: async () => ({ projectId }),
    requireKnowledgeRuntime: () => ({
      recoveryStatus: id => ({ state: 'error', message: `failed:${id}` }),
      retryRecovery: id => { calls.push(['retry', id]) },
    }),
    scheduleKnowledgeMaintenance: (owner, id) => { calls.push(['schedule', owner, id]) },
  }
  assert.deepEqual(await DesignService.prototype.retryDerivedKnowledge.call(receiver, agent), { accepted: true })
  assert.deepEqual(calls, [['retry', projectId], ['schedule', agent, projectId]])
})

test('KAG maintenance cannot occupy the authoritative Design Files mutation lane', async () => {
  const calls = []
  const receiver = {
    serializeKnowledgeMutation: async (_agent, project, operation) => {
      calls.push(['knowledge', project])
      return operation()
    },
    serializeProjectMutation: async () => { assert.fail('KAG must not enter the Design Files lane') },
  }
  const background = DesignService.prototype.knowledgeMutationLane.call(receiver, {}, 'project-1')
  assert.equal(await background(async () => 'background-result'), 'background-result')
  assert.deepEqual(calls, [['knowledge', 'project-1']], 'derived maintenance keeps an independent KAG lane')
})

test('a wedged KAG provider does not delay a foreground Design Files write', async () => {
  const projectId = '11111111-1111-4111-8111-111111111111'
  const agent = {}
  let releaseKnowledge
  const blockedKnowledge = new Promise(resolve => { releaseKnowledge = resolve })
  const receiver = {
    knowledgeMutations: new Map(),
    projectMutations: new Map(),
    projectMutationScope: new AsyncLocalStorage(),
    knowledgeLifecycles: new Map(),
    selectionForAgent: () => ({ projectId }),
    authorizeProjectWrite: async () => ({}),
    assertProjectSelection() {},
  }
  const knowledge = DesignService.prototype.serializeKnowledgeMutation.call(
    receiver, agent, projectId, async () => { await blockedKnowledge; return 'knowledge' },
  )
  await new Promise(resolve => setImmediate(resolve))
  let designSettled = false
  const design = DesignService.prototype.serializeProjectMutation.call(
    receiver, agent, projectId, 'write', async () => 'design',
  ).then(value => { designSettled = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(designSettled, true, 'foreground write must not queue behind derived Knowledge work')
  assert.equal(await design, 'design')
  releaseKnowledge()
  assert.equal(await knowledge, 'knowledge')
})

function maintenanceFixture() {
  const projectId = '11111111-1111-4111-8111-111111111111'
  let target = 'checkpoint-1', state = 'unknown', release
  const calls = []
  const receiver = {
    knowledgeRuntime: { disposing: false },
    knowledgeMaintenance: new Map(),
    knowledgeMaintenanceTargets: new Map(),
    knowledgeIndexStates: new Map(),
    knowledgeIndexPhases: new Map(),
    knowledgeIndexFailures: new Map(),
    knowledgeIndexer: { retry() {} },
    knowledgeMaintenanceTarget: () => target,
    knowledgeIndexStatus: () => state,
    injectKnowledgeOrchestrationSnapshot: async () => {},
    refreshPublishedKnowledge: async agent => {
      calls.push([target, agent])
      if (calls.length === 1) await new Promise(resolve => { release = resolve })
      state = 'ready'
      return { semantic: 'ready' }
    },
  }
  const schedule = (agent, reason = 'ensure') => DesignService.prototype.scheduleKnowledgeMaintenance.call(receiver, agent, projectId, reason)
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
  return { receiver, calls, schedule, settle, release: () => release(), setTarget: value => { target = value }, setState: value => { state = value } }
}

test('KAG maintenance is one project-generation single-flight across Agent restores', async () => {
  const f = maintenanceFixture()
  for (let i = 0; i < 80; i++) f.schedule({ id: `agent-${i}` }, 'ensure')
  await f.settle()
  assert.equal(f.calls.length, 1, 'same checkpoint across restored Agents starts one projection')
  f.release()
  await f.settle()
  f.schedule({ id: 'later-reader' }, 'ensure')
  await f.settle()
  assert.equal(f.calls.length, 1, 'ready generation is reused when another reader opens it')
})

test('KAG maintenance coalesces duplicate events but rebuilds the latest new checkpoint once', async () => {
  const f = maintenanceFixture()
  f.schedule({ id: 'first' }, 'changed')
  await f.settle()
  f.setTarget('checkpoint-2')
  f.setState('indexing')
  for (let i = 0; i < 20; i++) f.schedule({ id: `observer-${i}` }, 'changed')
  f.release()
  await f.settle()
  assert.deepEqual(f.calls.map(([target]) => target), ['checkpoint-1', 'checkpoint-2'])
})

test('restoring more conversations does not retry the same failed KAG generation', async () => {
  const f = maintenanceFixture()
  f.receiver.refreshPublishedKnowledge = async agent => {
    f.calls.push(['checkpoint-1', agent])
    f.setState('error')
    throw new Error('model unavailable')
  }
  f.schedule({ id: 'failed-reader-1' }, 'ensure')
  await f.settle()
  assert.equal(f.calls.length, 1)

  for (let index = 2; index <= 20; index += 1) f.schedule({ id: `failed-reader-${index}` }, 'ensure')
  await f.settle()
  assert.equal(f.calls.length, 1)

  // A restored conversation may carry a different local view while the
  // project is opening. Only an authoritative change event admits it.
  f.setTarget('checkpoint-2')
  f.schedule({ id: 'stale-restored-reader' }, 'ensure')
  await f.settle()
  assert.equal(f.calls.length, 1)
  f.schedule({ id: 'authoritative-change' }, 'changed')
  await f.settle()
  assert.equal(f.calls.length, 2)
})
