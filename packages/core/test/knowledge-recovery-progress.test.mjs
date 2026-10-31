import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { KnowledgeReadProgress } = await import('../src/knowledge-read-progress.ts')
const { DesignProjectKnowledgeLifecycle } = await import('../src/design-project-knowledge-lifecycle.ts')

test('an actually held different provider lease still rejects mismatched selection and close', async () => {
  let acquired = 0, released = 0
  const lifecycle = new DesignProjectKnowledgeLifecycle({
    administration: { acquireProject: async () => { acquired++ }, releaseProject: async () => { released++ } },
    service: {}, leaseId: 'session:test', materialize: async () => {},
  })
  const record = { projectId: 'held', stateRoot: '/unused', knowledge: { provider: 'fixture' } }
  await lifecycle.restore(record, {})
  await assert.rejects(lifecycle.prepare('different', { ...record, projectId: 'target' }, {}), /durable selection and owned provider lease disagree/)
  await assert.rejects(lifecycle.close('different'), /selected provider lease does not match close request/)
  assert.equal(acquired, 1); assert.equal(released, 0)
  await lifecycle.close(record.projectId)
  assert.equal(released, 1)
})

test('reopening the same durable project after failed restore reacquires its provider instead of returning a false no-op', async () => {
  let acquired = 0, materialized = 0, released = 0
  const lifecycle = new DesignProjectKnowledgeLifecycle({
    administration: { acquireProject: async () => { if (++acquired === 1) throw new Error('provider failed') }, releaseProject: async () => { released++ } },
    service: {}, leaseId: 'session:test', materialize: async () => { materialized++ },
  })
  const record = { projectId: 'original', stateRoot: '/unused', knowledge: { provider: 'fixture' } }
  await assert.rejects(lifecycle.restore(record, {}), /provider failed/)
  const prepared = await lifecycle.prepare(record.projectId, record, {})
  await prepared.finalize()
  assert.equal(acquired, 2); assert.equal(materialized, 1); assert.equal(released, 0)
  await lifecycle.close(record.projectId)
  assert.equal(released, 1)
})

test('recovery progress is returned while one shared rebuild continues', async () => {
  const progress = new KnowledgeReadProgress()
  let complete, calls = 0
  const task = new Promise(resolve => { complete = resolve })
  const operation = () => { calls++; return task }
  const status = () => ({ state: 'rebuilding', message: '正在恢复' })
  const results = await Promise.all([progress.read('project', operation, status), progress.read('project', operation, status)])
  assert.equal(calls, 1)
  assert.ok(results.every(result => result.recovery.state === 'rebuilding'))
  complete('ready')
  await task
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await progress.read('project', async () => 'rebuilt graph', () => ({ state: 'ready' })), { value: 'rebuilt graph' })
})

test('concurrent restore shares acquire/materialize; dispose waits and releases once', async () => {
  let acquired = 0, materialized = 0, released = 0, complete
  const gate = new Promise(resolve => { complete = resolve })
  const lifecycle = new DesignProjectKnowledgeLifecycle({
    administration: { acquireProject: async () => { acquired++; await gate }, releaseProject: async () => { released++ } },
    service: {}, leaseId: 'session:test', materialize: async () => { materialized++ },
  })
  const record = { projectId: 'project', stateRoot: '/unused', knowledge: { provider: 'ladybug-wasm' } }
  const first = lifecycle.restore(record, {}), second = lifecycle.restore(record, {})
  const dispose = lifecycle.dispose()
  complete()
  await Promise.all([first, second, dispose])
  assert.equal(acquired, 1); assert.equal(materialized, 1); assert.equal(released, 1)
})

test('Agent disposal and runtime teardown join one in-flight lease release', async () => {
  let released = 0, complete
  const gate = new Promise(resolve => { complete = resolve })
  const lifecycle = new DesignProjectKnowledgeLifecycle({
    administration: { acquireProject: async () => {}, releaseProject: async () => { released++; await gate } },
    service: {}, leaseId: 'session:test', materialize: async () => {},
  })
  await lifecycle.restore({ projectId: 'project', stateRoot: '/unused', knowledge: { provider: 'ladybug-wasm' } }, {})
  const first = lifecycle.dispose(), second = lifecycle.dispose()
  assert.equal(released, 1)
  complete()
  await Promise.all([first, second])
  await lifecycle.dispose()
  assert.equal(released, 1)
})

test('failed shared disposal retains lease ownership for an explicit retry', async () => {
  let released = 0
  const lifecycle = new DesignProjectKnowledgeLifecycle({
    administration: { acquireProject: async () => {}, releaseProject: async () => { if (++released === 1) throw new Error('close failed') } },
    service: {}, leaseId: 'session:test', materialize: async () => {},
  })
  await lifecycle.restore({ projectId: 'project', stateRoot: '/unused', knowledge: { provider: 'ladybug-wasm' } }, {})
  const results = await Promise.allSettled([lifecycle.dispose(), lifecycle.dispose()])
  assert.ok(results.every(result => result.status === 'rejected' && /close failed/.test(result.reason.message)))
  assert.equal(released, 1)
  await lifecycle.dispose()
  assert.equal(released, 2)
})
