import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { register } = await import('tsx/esm/api'); register()
const { default: DesignService } = await import('../src/design-service.ts')
const { boundedKnowledgeQuery, registerKnowledgeQueryTool } = await import('../src/dsh-knowledge-query-tool.ts')
const { knowledgeReadResult } = await import('../src/design-knowledge-query.ts')
const { GitVersioning } = await import('../src/git.ts')
const { DesignFilesStore } = await import('../src/design-files.ts')
const { nodeDesignProjectSpawn } = await import('../src/design-project.ts')
const { nodeFs } = await import('../src/service-tools.ts')
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
  assert.match(tool.parameters.properties.text.description, /case-insensitive literal substring/)
  assert.match(tool.parameters.properties.text.description, /Spaces are literal/)
  assert.match(tool.parameters.properties.text.description, /not tokenized or vector search/)
  assert.match(tool.parameters.properties.sourceFiles.description, /exact provenance\.evidence\[\]\.source/)
  assert.match(tool.parameters.properties.sourceFiles.description, /do not add.*design_files\//)
  assert.match(tool.description, /Zero matches.*do not prove.*index.*embedding/)
  assert.match(tool.description, /sourceReadRequired.*source verification/)
  assert.match(tool.description, /design_knowledge_status/)
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

test('three distinct review/publication/current commits query one exact graph only after real Design evidence proof', async t => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-review-pins-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = async (...args) => {
    const result = await nodeDesignProjectSpawn({ argv: ['git', ...args], cwd: root })
    assert.equal(result.exitCode, 0, result.stderr)
    return result.stdout.trim()
  }
  await git('init', '--quiet')
  await git('config', '--local', 'user.name', 'Knowledge fixture')
  await git('config', '--local', 'user.email', 'knowledge@invalid')
  await mkdir(join(root, 'design_files', 'flow_design'), { recursive: true })
  await writeFile(join(root, 'project.json'), JSON.stringify({ kit: { name: 'fixture', version: '1.0' } }))
  const factPath = join(root, 'design_files', 'flow_design.json')
  const artifactPath = join(root, 'design_files', 'flow_design', 'flow.bpmn')
  await writeFile(factPath, JSON.stringify({ description: 'Canonical fact', artifact: 'flow_design/flow.bpmn' }))
  await writeFile(artifactPath, '<flow id="original"/>')
  const commit = async label => { await git('add', '.'); await git('commit', '--quiet', '--allow-empty', '-m', label); return git('rev-parse', 'HEAD') }
  const reviewCommit = await commit('review f5e7 shape')
  const publicationCommit = await commit('publication 6f920 shape')
  let head = await commit('current 1882 shape')
  assert.equal(new Set([reviewCommit, publicationCommit, head]).size, 3)
  // Source-level real Git proof; the integrated built native worker has its
  // own boundary. No worker build or Host profile is needed for this fixture.
  const store = new DesignFilesStore(nodeFs, new GitVersioning(nodeDesignProjectSpawn, root, 'design_files', false, 'cli'), join(root, 'design_files'))
  assert.equal(await store.designEvidenceRevisionAt(reviewCommit), await store.designEvidenceRevisionAt(publicationCommit))
  const f = fixture()
  const publication = { schemaVersion: 1, key: 'k', edges: 'e', checkpoint: publicationCommit, revision: 'rev:7', warnings: [] }
  f.receiver.requireKnowledgeRuntime = () => ({ semantic: { publicationCache: () => ({ readSemanticCache: async () => JSON.stringify(publication) }) } })
  f.receiver.withSelectedKnowledge = async (_owner, fn) => fn(f.service, { projectId }, head)
  f.receiver.projects.status = async () => ({ lastCheckpoint: head })
  f.receiver.designFilesForProject = async () => store
  f.receiver.knowledgeSourceMatches = DesignService.prototype.knowledgeSourceMatches
  const entity = { id: 'fact', entityType: 'design-record', label: 'Fact', lifecycle: 'accepted',
    properties: { description: 'Canonical fact' }, provenance: { producer: 'design-file-projection', checkpoint: publicationCommit, evidence: [{ source: 'flow_design.json' }] } }
  f.service.query = async request => { f.reads.push(request); return { revision: request.revision, entities: [entity], relations: [] } }
  const args = { project: projectId, checkpoint: reviewCommit, revision: publication.revision, offset: 0, limit: 1 }
  const result = await f.run(f.child, args)
  assert.equal(result.checkpoint, reviewCommit, 'the request never changes to the publication pin')
  assert.equal(result.sourceCheckpoint, publicationCommit)
  assert.match(result.sourceEquivalence, /same verified Design evidence/)
  assert.equal(result.revision, publication.revision)
  assert.deepEqual(result.entities, [entity], 'complete properties and provenance survive the query')
  assert.equal(f.reads[0].revision, publication.revision)
  assert.equal((await f.run(f.child, { ...args, checkpoint: publicationCommit })).checkpoint, publicationCommit)
  const reads = f.reads.length
  await assert.rejects(f.run(f.child, { ...args, revision: 'rev:wrong' }), /pins|publication/)
  await assert.rejects(f.run(f.child, { ...args, checkpoint: '0'.repeat(40), sourceEquivalent: true }), /pins|publication/)
  await writeFile(factPath, JSON.stringify({ description: 'Changed business fact', artifact: 'flow_design/flow.bpmn' }))
  head = await commit('changed source fact')
  // A current-head explicit historical query retains its prior contract. To
  // exercise the equivalent historical grant, move current past the bad pin.
  const changedFact = head
  head = await commit('head after changed fact')
  await assert.rejects(f.run(f.child, { ...args, checkpoint: changedFact }), /pins|publication/)
  await writeFile(factPath, JSON.stringify({ description: 'Canonical fact', artifact: 'flow_design/flow.bpmn' }))
  await writeFile(artifactPath, '<flow id="changed"/>')
  const changedArtifact = await commit('changed referenced artifact')
  head = await commit('head after changed artifact')
  await assert.rejects(f.run(f.child, { ...args, checkpoint: changedArtifact }), /pins|publication/)
  assert.equal(f.reads.length, reads, 'unproven historical queries never reach the provider')
})

test('Knowledge final response budget includes source metadata and never returns a partial record', () => {
  const graph = { revision: 'rev:7', entities: [], relations: [] }
  const full = { ...graph, entities: [{ id: 'fact', properties: { text: '' } }] }
  const overhead = Buffer.byteLength(JSON.stringify(knowledgeReadResult(projectId, 'c', full)))
  full.entities[0].properties.text = 'x'.repeat(2 * 1024 * 1024 - overhead)
  assert.equal(Buffer.byteLength(JSON.stringify(knowledgeReadResult(projectId, 'c', full))), 2 * 1024 * 1024)
  assert.throws(() => knowledgeReadResult(projectId, 'c', full, { sourceCheckpoint: 's'.repeat(200) }), /response budget/)
  assert.throws(() => knowledgeReadResult(projectId, 'c', { ...graph, entities: [{ properties: { text: '中'.repeat(1024 * 1024) } }] }), /No partial result/)
})
