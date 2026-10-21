import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { default: DesignService } = await import('../src/design-service.ts')
const { boundedKnowledgeQuery, registerKnowledgeQueryTool } = await import('../src/dsh-knowledge-query-tool.ts')
const projectId = '11111111-1111-4111-8111-111111111111'

function fixture() {
  const parent = { session: { header: {} }, ctx: { agents: { get: () => undefined } } }
  const child = { session: { header: { parentSession: 'parent' } }, ctx: { agents: { get: id => id === 'parent' ? parent : undefined } } }
  const reads = []
  const service = { revision: async () => 'rev:8', query: async request => {
    reads.push(request)
    return { revision: request.revision, entities: [], relations: [], page: { offset: request.offset, nextOffset: null, totalEntities: 0, totalRelations: 0 } }
  } }
  const receiver = { advisoryKnowledgeLimit: 20,
    requireKnowledgeRuntime: () => ({ semantic: undefined }),
    projects: { status: async () => ({ lastCheckpoint: 'c' }) },
    selectedProjectForAgent: async owner => owner === parent ? { projectId } : undefined,
    withSelectedKnowledge: async (owner, fn) => { assert.equal(owner, parent); return fn(service, { projectId }, 'c') },
    assertProjectSelection: (owner, project) => { assert.equal(owner, parent); assert.equal(project, projectId) },
  }
  const run = (caller, args, signal) => DesignService.prototype.queryStoredKnowledge.call(receiver, caller, args, signal)
  return { parent, child, receiver, service, reads, run }
}
test('native child reads only its real ancestor project and exact graph revision', async () => {
  const { child, reads, run } = fixture()
  const result = await run(child, { project: projectId, checkpoint: 'c', revision: 'rev:7', offset: 20, entityIds: ['a'], relationIds: [] })
  assert.equal(result.project, projectId); assert.equal(result.revision, 'rev:7')
  assert.deepEqual(reads[0], { offset: 20, entityIds: ['a'], relationIds: [], projectId, revision: 'rev:7', limit: 20 })
  assert.equal(result.page.nextOffset, null)
})
test('registered read tool executes through a child native binding without exposing mutation methods', async () => {
  const { child, run, reads } = fixture()
  let tool
  registerKnowledgeQueryTool({ tools: { register: definition => { tool = definition } } }, { queryStoredKnowledge: run })
  assert.equal(tool.name, 'design_query_knowledge')
  assert.equal(tool.parameters.source_root, undefined)
  assert.equal(tool.parameters.entities, undefined)
  assert.equal(tool.parameters.properties.designRoles, undefined)
  for (const name of ['relationMeanings', 'relationOrigins']) assert.ok(tool.parameters.properties[name])
  const result = await tool.execute({ project: projectId, checkpoint: 'c', revision: 'rev:7' }, { agent: child, signal: new AbortController().signal })
  assert.equal(JSON.parse(result.content).revision, 'rev:7')
  await tool.execute({project:projectId,checkpoint:'c',revision:'rev:7',relationMeanings:['references'],relationOrigins:['file']}, {agent:child})
  assert.deepEqual(reads[1].relationMeanings,['references'])
  assert.deepEqual(reads[1].relationOrigins,['file'])
  await assert.rejects(tool.execute({}, { signal: new AbortController().signal }), /calling Agent/)
})
test('optional native Knowledge reads have a local deadline even when storage never settles', async () => {
  let observedSignal
  await assert.rejects(
    boundedKnowledgeQuery(async signal => {
      observedSignal = signal
      await new Promise(() => {})
    }, undefined, 5),
    /timed out after 5ms/,
  )
  assert.equal(observedSignal.aborted, true)

  const parent = new AbortController()
  const cancelled = boundedKnowledgeQuery(async () => new Promise(() => {}), parent.signal, 1_000)
  parent.abort(new Error('parent stopped'))
  await assert.rejects(cancelled, /parent stopped/)
})
test('missing child pins, foreign project, stale checkpoint and unpinned continuation fail before reading', async () => {
  const { parent, child, reads, run } = fixture()
  for (const args of [{}, { project: 'other', checkpoint: 'c', revision: 'rev:7' }, { project: projectId, checkpoint: 'old', revision: 'rev:7' }]) {
    await assert.rejects(run(child, args), /pins|binding/)
  }
  await assert.rejects(run(parent, { offset: 20 }), /pinned revision/)
  assert.equal(reads.length, 0)
  assert.equal((await run(parent, {})).revision, 'rev:8')
})
test('unbound or cyclic native ancestry cannot fall back to an arbitrary project', async () => {
  const { child, receiver, run } = fixture()
  receiver.selectedProjectForAgent = async () => undefined
  child.ctx.agents.get = () => child
  await assert.rejects(run(child, { project: 'p', checkpoint: 'c', revision: 'rev:7' }), /Cyclic/)
  child.ctx.agents.get = () => undefined
  await assert.rejects(run(child, { project: 'p', checkpoint: 'c', revision: 'rev:7' }), /No selected/)
})
test('late query result is rejected after project switch, checkpoint change or cancellation', async () => {
  for (const variant of ['selection', 'checkpoint', 'cancel']) {
    const { parent, receiver, service, run } = fixture()
    let release, entered
    const gate = new Promise(resolve => { release = resolve })
    const reading = new Promise(resolve => { entered = resolve })
    const query = service.query
    service.query = async args => { entered(); await gate; return query(args) }
    const abort = new AbortController()
    const pending = run(parent, {}, abort.signal)
    await reading
    if (variant === 'selection') receiver.assertProjectSelection = () => { throw new Error('selection changed') }
    if (variant === 'checkpoint') receiver.projects.status = async () => ({ lastCheckpoint: 'new' })
    if (variant === 'cancel') abort.abort()
    const rejected = assert.rejects(pending, /changed|abort/i)
    release()
    await rejected
  }
})
