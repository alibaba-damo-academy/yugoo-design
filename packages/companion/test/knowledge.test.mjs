import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionKnowledge } from '../src/knowledge.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'
import { queryReviewSnapshot } from '../src/knowledge-snapshot-query.mjs'
import * as runtime from '../../knowledge-ladybug/lib/index.js'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

after(() => runtime.shutdownLadybugKnowledgeRuntime())

for (const host of ['codex', 'claude-code', 'qoder']) test(`${host}: healthy on-open index is accepted before response and zero-edge completion survives reopen`, async () => {
  const f = await fixture({ serverOptions: { host } })
  let calls = 0, release, knowledge
  const pending = new Promise(resolve => { release = resolve })
  class ControlledIndex {
    publicationIdentity = 'test-model:policy-v1'
    async compute() { calls++; await pending; return { edges: [] } }
    async close() {}
  }
  const options = { project: f.server.project, stateRoot: f.options.stateRoot,
    loadRuntime: async () => ({ ...runtime, DesignSemanticIndex: ControlledIndex }) }
  try {
    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '科研工作台' } } }, { origin: 'agent', settleEvent: async () => {} })
    const checkpoint = await f.server.project.store.head()
    knowledge = createCompanionKnowledge(options)
    const read = async () => JSON.parse((await knowledge.readGraph()).content)
    void knowledge.notify()
    const first = await read()
    assert.equal(first.recovery, undefined)
    assert.equal(first.coverage.embedding, 'indexing')
    await Promise.all([read(), read(), knowledge.notify()])
    assert.equal(calls, 1)
    release()
    let graph
    for (let i = 0; i < 20; i++) { graph = await read(); if (graph.coverage.embedding === 'ready') break; await new Promise(resolve => setTimeout(resolve, 20)) }
    assert.equal(graph.coverage.embedding, 'ready')
    assert.equal(graph.edges.filter(edge => edge.kind === 'semantic').length, 0)
    await knowledge.close()
    knowledge = createCompanionKnowledge(options)
    await knowledge.notify()
    let reopened
    for (let i = 0; i < 20; i++) { reopened = await read(); if (reopened.coverage.embedding === 'ready') break; await new Promise(resolve => setTimeout(resolve, 20)) }
    assert.equal(reopened.coverage.embedding, 'ready')
    assert.equal(calls, 1, 'Persisted successful empty candidate set is complete')
    assert.equal(await f.server.project.store.sameDesignEvidenceAt(checkpoint, await f.server.project.store.head()), true, 'Knowledge record commits do not change Design evidence')
    assert.equal(f.messages.length, 0, 'Read-only index requests never dispatch foreground or GRA notifications')
  } finally { release(); await knowledge?.close(); await f.close() }
})

test('Companion serves last-good KAG until the next complete generation is published', async () => {
  const f = await fixture()
  const gates = []
  class ControlledIndex {
    publicationIdentity = 'last-good-test:policy-v1'
    async compute() { await new Promise(resolve => gates.push(resolve)); return { edges: [] } }
    async close() {}
  }
  const knowledge = createCompanionKnowledge({ project: f.server.project, stateRoot: f.options.stateRoot,
    loadRuntime: async () => ({ ...runtime, DesignSemanticIndex: ControlledIndex }) })
  const read = async () => JSON.parse((await knowledge.readGraph()).content)
  try {
    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '第一版' } } }, { origin: 'agent', settleEvent: async () => {} })
    const firstCheckpoint = await f.server.project.store.head()
    await knowledge.notify()
    while (!gates.length) await new Promise(resolve => setTimeout(resolve, 0))
    gates.shift()()
    let first
    for (let i = 0; i < 30; i++) { first = await read(); if (first.coverage.embedding === 'ready') break; await new Promise(resolve => setTimeout(resolve, 20)) }
    assert.equal(first.checkpoint, firstCheckpoint)

    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '第二版' } } }, { origin: 'agent', settleEvent: async () => {} })
    const secondCheckpoint = await f.server.project.store.head()
    const beforeRefresh = await read()
    assert.equal(beforeRefresh.knowledgeStatus, 'due', 'A stale publication without a job is due, not ready')
    assert.equal(beforeRefresh.freshness.indexedCheckpoint, firstCheckpoint)
    await knowledge.notify()
    while (!gates.length) await new Promise(resolve => setTimeout(resolve, 0))
    const during = await read()
    assert.equal(during.checkpoint, firstCheckpoint)
    assert.equal(during.freshness.sourceCheckpoint, secondCheckpoint)
    assert.equal(during.freshness.indexedCheckpoint, firstCheckpoint)
    assert.equal(during.coverage.embedding, 'indexing')
    assert.equal(during.knowledgeStatus, 'running', 'A last-good graph must not claim the newer head is current')
    gates.shift()()
    let second
    for (let i = 0; i < 30; i++) { second = await read(); if (second.coverage.embedding === 'ready') break; await new Promise(resolve => setTimeout(resolve, 20)) }
    assert.equal(second.checkpoint, secondCheckpoint)
    assert.equal(second.freshness.indexedCheckpoint, secondCheckpoint)
    assert.equal(second.knowledgeStatus, 'current')
  } finally { for (const release of gates) release(); await knowledge.close(); await f.close() }
})

test('explicit recovery retry starts maintenance without a save, read side effect, or reopen', async () => {
  const f = await fixture()
  let failOpen = true, knowledge
  const wrappedRuntime = {
    ...runtime,
    LadybugDesignKnowledgeProvider: {
      open: async (...args) => {
        if (failOpen) {
          failOpen = false
          args[2]?.onState?.({ state: 'error', message: 'simulated recoverable failure' })
          throw new Error('simulated recoverable failure')
        }
        return runtime.LadybugDesignKnowledgeProvider.open(...args)
      },
    },
  }
  try {
    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '科研工作台' } } }, { origin: 'agent', settleEvent: async () => {} })
    knowledge = createCompanionKnowledge({ project: f.server.project, stateRoot: f.options.stateRoot,
      loadRuntime: async () => wrappedRuntime, embedding: { provider: 'disabled' } })
    await assert.rejects(knowledge.notify(), /simulated recoverable failure/)
    assert.deepEqual(await knowledge.retryRecovery(), { accepted: true })
    let graph
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { graph = JSON.parse((await knowledge.readGraph()).content) } catch {}
      if (graph?.knowledgeStatus === 'current' && graph.freshness.indexedCheckpoint === graph.freshness.sourceCheckpoint) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(graph?.knowledgeStatus, 'current')
    assert.equal(graph.freshness.indexedCheckpoint, graph.freshness.sourceCheckpoint)
    assert.ok(graph.nodes.length > 0)
  } finally { await knowledge?.close(); await f.close() }
})

for (const host of ['codex', 'claude-code', 'qoder']) test(`${host}: unreadable derived schema automatically rebuilds through Panel RPC`, async () => {
  const f = await fixture({ serverOptions: { host, knowledgeRuntime: async () => runtime } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const project = f.server.project, id = project.project.metadata.id
  const databaseRoot = join(f.options.stateRoot, 'project-management', 'registry', 'projects', id, 'design-knowledge')
  const path = join(databaseRoot, createHash('sha256').update(id).digest('hex') + '.lbdb')
  const ladybug = createRequire(new URL('../../knowledge-ladybug/package.json', import.meta.url))('@ladybugdb/wasm-core/nodejs')
  try {
    await project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '个人科研工作台' } } }, { origin: 'agent', settleEvent: async () => {} })
    const source = await readFile(join(project.project.designFilesRoot, 'smart_questions/smart_questions.json'), 'utf8')
    const checkpoint = await project.store.head()
    const old = await runtime.LadybugDesignKnowledgeProvider.open(id, { databaseRoot }); await old.close()
    const db = new ladybug.Database(path), connection = new ladybug.Connection(db)
    await connection.init()
    const result = await connection.query('MATCH (s:KnowledgeSchema) SET s.schemaVersion = 1;')
    assert.equal(result.isSuccess(), true)
    await result.close(); await connection.close(); await db.close()
    await f.server.knowledge.notify()
    let graph
    for (let attempt = 0; attempt < 20; attempt++) {
      graph = JSON.parse((await call('readGraph')).content)
      if (graph.recovery?.state !== 'rebuilding') break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.equal(graph.recovery?.state, 'ready', JSON.stringify(graph.recovery))
    assert.equal(graph.knowledgeStatus, 'current')
    assert.ok(graph.nodes.length > 0)
    assert.equal(await project.store.sameDesignEvidenceAt(checkpoint, await project.store.head()), true)
    assert.equal(await readFile(join(project.project.designFilesRoot, 'smart_questions/smart_questions.json'), 'utf8'), source)
    assert.equal(f.messages.length, 0)
    await assert.rejects(call('retryKnowledge'), /not awaiting retry/)
  } finally { await f.close() }
})

for (const host of ['codex', 'claude-code', 'qoder']) test(`${host}: Panel read upgrades schema projection without editing Design Files and retains diagnostics`, async () => {
  const f = await fixture({ serverOptions: { host, knowledgeRuntime: async () => runtime } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  const project = f.server.project
  const skill = project.kit.skills.find(skill => skill.name === 'page_design')
  const currentSchema = skill.metadata.schemaYaml
  try {
    // An older Kit had no projection roles. Same project/file/checkpoint, then
    // restore the shipped schema to exercise the real Panel refresh boundary.
    skill.metadata.schemaYaml = currentSchema.replace(/knowledge: \{[^}]+\},?\s*/g, '')
    await project.store.write('page_design', { skill_name: 'page_design', schema_version: 7,
      page_order: ['p'], pages: { p: { id: 'p', name: '科研工作台', purpose: '整理科研资料', parent_id: 'missing' } },
    }, { origin: 'agent', settleEvent: async () => {} })
    const checkpoint = await project.store.head()
    const file = join(project.project.designFilesRoot, 'page_design/page_design.json')
    const source = await readFile(file, 'utf8')
    await f.server.knowledge.notify()
    let before
    for (let attempt = 0; attempt < 40; attempt++) {
      before = JSON.parse((await call('readGraph')).content)
      if (before.knowledgeStatus === 'current') break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(before.knowledgeStatus, 'current')
    assert.ok(before.nodes.some(n => n.context.includes('/schema_version:')))
    skill.metadata.schemaYaml = currentSchema
    await f.server.knowledge.notify()
    let after
    for (let attempt = 0; attempt < 40; attempt++) {
      after = JSON.parse((await call('readGraph')).content)
      if (after.knowledgeStatus === 'current' && after.knowledgeRevision !== before.knowledgeRevision) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(after.knowledgeStatus, 'current')
    assert.equal(await project.store.sameDesignEvidenceAt(checkpoint, after.checkpoint), true)
    assert.notEqual(after.knowledgeRevision, before.knowledgeRevision)
    assert.ok(after.nodes.length > 0)
    assert.equal(after.nodes.some(n => /\/(schema_version|skill_name|page_order)(:|\/)/.test(n.context)), false)
    assert.ok(after.warnings.some(w => w.includes('/pages/p/parent_id') && w.includes('未在当前投影中解析')))
    const page = after.nodes.find(n => n.pointer === '/pages/p')
    assert.equal(page.id, before.nodes.find(n => n.pointer === '/pages/p').id)
    const pins = { project: after.projectId, checkpoint, revision: after.knowledgeRevision }
    const queried = await call('queryKnowledge', { ...pins, entityIds: [page.id], relationIds: [], limit: 100 })
    assert.ok(queried.entities[0].properties.fields.some(field => field.pointer === '/pages/p/parent_id' && field.text === 'missing'))
    const historical = await call('queryKnowledge', { ...pins, revision: before.knowledgeRevision, limit: 100 })
    assert.ok(historical.entities.some(n => n.properties.fields.some(field => field.pointer === '/schema_version')))
    assert.equal((JSON.parse((await call('readGraph')).content)).knowledgeRevision, after.knowledgeRevision)
    assert.equal(await readFile(file, 'utf8'), source)
    assert.equal(await project.store.sameDesignEvidenceAt(checkpoint, await project.store.head()), true)
    assert.equal(f.messages.length, 0, 'derived refresh must not inject foreground tasks')
  } finally { skill.metadata.schemaYaml = currentSchema; await f.close() }
})

test('managed scheduler supplies a pinned full read replica without exposing live writes',async()=>{
  let executed=0
  const f=await fixture({serverOptions:{knowledgeRuntime:async()=>runtime,backgroundReviews:true,reviewDebounceMs:0,
    reviewExecutor:async({cwd,prompt,outputSchema})=>{
      assert.match(prompt,/immutable Design Files snapshot/)
      executed++
      const properties=outputSchema.properties
      return {result:properties.inconsistencies?{schemaVersion:1,inconsistencies:[]}:
        properties.researchNeeds?{schemaVersion:1,researchNeeds:[]}:
        properties.questions?{schemaVersion:1,questions:[]}:
        {summary:'已检查固定证据',u:{score:30,evidence:'目标'},s:{score:10,evidence:'尚无结构'},t:{score:10,evidence:'待细化'}}}
    }}})
  try{
    await callCompanion(f.server.connectionPath,{method:'savePanel',params:{skill:'smart_questions',state:{questions:{goal:{prompt:'目标',kind:'text',answer:'个人科研'}}},eventId:'snapshot'}})
    const deadline=Date.now()+15000
    let workspace
    while(Date.now()<deadline){
      workspace=await callCompanion(f.server.connectionPath,{method:'readWorkspace',params:{}})
      if(workspace.reviews.every(r=>r.status==='completed'))break
      await new Promise(resolve=>setTimeout(resolve,50))
    }
    assert.equal(executed,4,JSON.stringify(workspace.reviews))
    assert.ok(workspace.reviews.every(r=>r.status==='completed'),JSON.stringify(workspace.reviews))
    assert.equal(f.messages.length,0)
  }finally{await f.close()}
})

for (const managedExecution of [false, true]) test(`${managedExecution ? 'managed' : 'native'} review: graph writeback is optional, evidence-backed and stale-safe`, async () => {
  const f = await fixture()
  const project = f.server.project
  const knowledge = createCompanionKnowledge({ project, stateRoot:f.options.stateRoot,
    loadRuntime:async()=>runtime, embedding:{provider:'disabled'} })
  const reviews = createCompanionReviews({project, stateRoot:f.options.stateRoot,threadId,managedExecution,knowledge})
  const nativeRun = {runId:'00000000-0000-4000-8000-000000000091',parentRunId:threadId,transcriptPath:`${f.root}/review.jsonl`}
  async function prepare(profile, userContext) {
    if (managedExecution) return reviews.claimManagedReview({profile,ownerId:'test-owner',userContext})
    const request = await reviews.prepareReview({profile,userContext})
    await reviews.bindReviewRun({reviewId:request.reviewId,nativeRun})
    return request
  }
  const finish = (request,result) => managedExecution
    ? reviews.finishManagedReview({reviewId:request.reviewId,ownerId:request.execution.ownerId,attemptId:request.execution.attemptId,result})
    : reviews.submitReview({reviewId:request.reviewId,nativeRun,result})
  const snapshot = async () => JSON.parse((await knowledge.readGraph()).content)
  try {
    const unrelatedSource = await project.store.head()
    await project.savePanel({skill:'smart_questions',state:{questions:{
      purpose:{prompt:'目标',kind:'text',answer:'论文引用实验结果'},
      experiment:{prompt:'实验',kind:'text',answer:'实验输出测量结果'},
    }},eventId:'graph-review'})
    await knowledge.notify()
    const request = await prepare('grounding','source-backed relation')
    assert.equal(request.relationVocabulary.revision, project.kit.relationVocabulary.revision)
    assert.notEqual(request.knowledge.sourceCheckpoint, request.revision.checkpoint, 'Archive Git commits advance the review pin without changing the projected source')
    assert.equal(await project.store.sameDesignEvidenceAt(request.knowledge.sourceCheckpoint, request.revision.checkpoint), true)
    const replica = await knowledge.reviewSnapshot(request.revision.checkpoint,request.knowledge.knowledgeRevision)
    const pins = {project:replica.project,checkpoint:replica.checkpoint,revision:replica.graph.revision,limit:1,offset:0}
    assert.deepEqual(queryReviewSnapshot(replica,pins),await knowledge.query(pins),'replica and live pinned query have identical semantics')
    assert.throws(()=>queryReviewSnapshot(replica,{...pins,checkpoint:'foreign'}),/pins/)
    const nodes = request.knowledge.graph.entities.filter(x=>x.entityType==='design-record')
    const [a,b] = ['论文引用实验结果','实验输出测量结果'].map(text=>nodes.find(n=>n.properties.fields.some(f=>f.text===text)))
    assert.ok(a && b)
    const relation = {from:a.id,to:b.id,relationType:'web_app:corroborates',summary:'论文引用实验输出',
      evidence:[a,b].map(n=>({source:n.properties.file,locator:n.properties.fields.find(f=>f.text.includes('结果')).pointer,
        quote:n.properties.fields.find(f=>f.text.includes('结果')).text}))}
    const result = {schemaVersion:1,inconsistencies:[],knowledgeRelations:[relation]}
    await assert.rejects(knowledge.publishReview({checkpoint:request.revision.checkpoint,sourceCheckpoint:unrelatedSource,
      reviewed:request.knowledge.graph,producer:'grounding',observations:[relation],relationVocabulary:request.relationVocabulary}), /source checkpoint changed/)
    const outcome = await finish(request,result)
    assert.equal(outcome.status,'completed')
    assert.equal(outcome.knowledgeError,undefined,'Auxiliary commits must not hide a failed Knowledge writeback behind completed advice')
    assert.equal((await finish(request,result)).status,'completed','repeat submission is idempotent')
    const before = await snapshot()
    const relationIds = before.edges.filter(e=>e.id.startsWith('review:')).map(e=>e.id)
    assert.equal(relationIds.length,1)
    const published = await knowledge.captureReview(await project.store.head())
    assert.equal(published.graph.relations.find(r=>r.id===relationIds[0]).provenance.checkpoint,request.revision.checkpoint)
    const reviewEdge = before.edges.find(e=>e.id===relationIds[0])
    assert.equal(reviewEdge.reading.classification,'kit')
    assert.equal(reviewEdge.reading.meaning,'supports')
    assert.equal(reviewEdge.reading.vocabularyRevision,request.relationVocabulary.revision)
    const empty = await prepare('reflection','no additional relationship')
    assert.equal((await finish(empty,{schemaVersion:1,researchNeeds:[],knowledgeRelations:[]})).status,'completed')
    assert.deepEqual((await snapshot()).edges.filter(e=>e.id.startsWith('review:')).map(e=>e.id),relationIds)
    const invalid = await prepare('alignment','invalid graph extension must not swallow advice')
    const invalidOutcome = await finish(invalid,{schemaVersion:1,questions:[],knowledgeRelations:[{...relation,from:'invented'}]})
    assert.equal(invalidOutcome.status,'completed')
    assert.match(invalidOutcome.knowledgeError,/missing|stale/)
    assert.deepEqual((await snapshot()).edges.filter(e=>e.id.startsWith('review:')).map(e=>e.id),relationIds)
    // An empty/no-finding conclusion covers a file revision, not just its old
    // endpoints: adding evidence must reopen review even if both quotes survive.
    assert.equal((await reviews.readReviewStatus()).find(r=>r.profile==='reflection').needsReview,false)
    await project.savePanel({skill:'smart_questions',state:{questions:{
      purpose:{prompt:'目标',kind:'text',answer:'论文引用实验结果'},
      experiment:{prompt:'实验',kind:'text',answer:'实验输出测量结果'},
      new_evidence:{prompt:'新证据',kind:'text',answer:'另一个实验存在相反结果'},
    }},eventId:'graph-review-added-evidence'})
    await knowledge.notify()
    const invalidated=(await reviews.readReviewStatus()).find(r=>r.profile==='reflection')
    assert.equal(invalidated.status,'due')
    assert.equal(invalidated.revisionChanged,true)
    assert.equal(invalidated.needsReview,true)
    assert.deepEqual((await snapshot()).edges.filter(e=>e.id.startsWith('review:')).map(e=>e.id),relationIds,
      'unchanged supported relation survives; the scoped absence conclusion does not')
    await project.savePanel({skill:'smart_questions',state:{questions:{purpose:{prompt:'目标',kind:'text',answer:'第二版目标'}}},eventId:'graph-review-next'})
    await knowledge.notify()
    const stale = await prepare('grounding','review second revision')
    await project.savePanel({skill:'smart_questions',state:{questions:{purpose:{prompt:'目标',kind:'text',answer:'第三版目标'}}},eventId:'graph-review-newer'})
    await knowledge.notify()
    assert.equal((await finish(stale,result)).status,'stale')
    assert.equal(f.messages.length,0,'graph maintenance does not enqueue foreground work')
  } finally { await knowledge.close(); await f.close() }
})

for (const host of ['codex', 'claude-code', 'qoder']) test(`${host}: same persisted KAG drives context, Panel and pinned neighborhood queries`, async () => {
  const f = await fixture({ serverOptions: { host, knowledgeRuntime: async () => runtime } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await call('savePanel', { skill:'smart_questions',state:{questions:{purpose:{prompt:'目标',kind:'text',answer:'整理文献并制定研究计划'}}}, eventId:'kag-1' })
    // Agentic trigger model: the settlement exposes state only; the explicit
    // bounded refresh publishes the projection before KAG-backed reads.
    assert.equal((await call('refreshKnowledge')).outcome, 'accepted')
    let graph
    for (let attempt = 0; attempt < 80; attempt++) {
      graph = JSON.parse((await call('readGraph')).content)
      if (graph.knowledgeStatus === 'current' && graph.freshness?.sourceCheckpoint === graph.freshness?.indexedCheckpoint) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(graph.knowledgeStatus, 'current')
    assert.ok(graph.nodes.length > 0)
    assert.equal(graph.coverage.review, 'unknown')
    assert.match(graph.coverage.ontology.contractRevision, /^ontology-v1:[0-9a-f]{64}$/)
    assert.ok(graph.coverage.ontology.declaredTypes > 0)
    const pins = {project:graph.projectId,checkpoint:graph.checkpoint,revision:graph.knowledgeRevision}
    const records = await call('queryKnowledge', {...pins,entityIds:graph.nodes.map(x=>x.id).slice(0,64),relationIds:[],limit:100})
    assert.ok(records.entities.every(x=>graph.nodes.some(n=>n.id===x.id)))
    assert.equal(records.evidence.truncated,false)
    const context = await call('knowledgeContext')
    assert.equal(context.available,true)
    assert.equal(context.project,pins.project)
    const selected = graph.nodes.find(x=>x.record)
    assert.equal(typeof selected.ontologyType, 'string')
    assert.ok(['stable','structural','anonymous'].includes(selected.identityQuality))
    const typed = await call('queryKnowledge',{...pins,ontologyTypes:[selected.ontologyType],recordKinds:[selected.recordKind],identityQualities:[selected.identityQuality],limit:100})
    assert.ok(typed.entities.some(entity=>entity.id===selected.id))
    const neighborhood = await call('queryKnowledge',{...pins,incidentTo:[selected.id],direction:'outgoing',limit:1})
    assert.ok(neighborhood.page)
    for(const edge of neighborhood.relations) assert.equal(edge.from,selected.id)
    await assert.rejects(call('queryKnowledge',{...pins,project:'foreign'}),/project/)
    await assert.rejects(call('queryKnowledge',{...pins,revision:undefined}),/pins/)
    const review = await call('prepareReview',{profile:'grounding'})
    assert.ok(review.knowledge)
    assert.ok(review.schema.properties.knowledgeRelations)
    assert.match(review.schema.properties.knowledgeRelations.items.properties.relationType.description,/web_app:corroborates/)
    assert.match(review.prompt,/web_app:corroborates/)
    assert.match(review.prompt,/current design question/)
    const clarity = await call('prepareReview',{profile:'clarity'})
    assert.equal(clarity.schema.properties.knowledgeRelations,undefined)
    await call('savePanel',{skill:'smart_questions',state:{questions:{purpose:{prompt:'目标',kind:'text',answer:'课题组协作研究'}}},eventId:'kag-2'})
    // Agentic trigger model: the explicit bounded refresh advances the
    // publication; only then does a stale pin lose its latest-complete match.
    assert.equal((await call('refreshKnowledge')).outcome, 'accepted')
    for (let attempt = 0; attempt < 80; attempt++) {
      const current = JSON.parse((await call('readGraph')).content)
      if (current.freshness?.sourceCheckpoint === current.freshness?.indexedCheckpoint && current.checkpoint !== pins.checkpoint) break
      await new Promise(resolve => setTimeout(resolve,25))
    }
    await assert.rejects(call('queryKnowledge',pins),/checkpoint/)
  } finally { await f.close() }
})

test('unavailable KAG is disclosed without preventing Bundle preparation or file saving', async () => {
  const f = await fixture()
  const call = (method, params={}) => callCompanion(f.server.connectionPath,{method,params})
  try {
    assert.equal((await call('prepareBundle',{skill:'smart_questions'})).skill,'smart_questions')
    await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'without-db'})
    assert.equal((await call('knowledgeContext')).available,false)
    assert.equal(JSON.parse((await call('readGraph')).content).knowledgeStatus,'unavailable')
  } finally { await f.close() }
})

test('companion knowledge orchestration: sampling is pure and refresh is the only bounded entry', async () => {
  const f = await fixture({ serverOptions: { host: 'codex' } })
  let calls = 0, release
  const pending = new Promise(resolve => { release = resolve })
  class ControlledIndex {
    publicationIdentity = 'orchestration:policy-v1'
    async compute() { calls += 1; await pending; return { edges: [] } }
    async close() {}
  }
  let knowledge
  try {
    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '编排测试' } } }, { origin: 'agent', settleEvent: async () => {} })
    const head = await f.server.project.store.head()
    knowledge = createCompanionKnowledge({ project: f.server.project, stateRoot: f.options.stateRoot,
      loadRuntime: async () => ({ ...runtime, DesignSemanticIndex: ControlledIndex }) })
    // Pure sampling: the head exists, nothing is indexed, nothing was started.
    const initial = await knowledge.status()
    assert.equal(initial.state, 'unavailable', 'cold sampling must not open or recover the database')
    assert.equal(initial.reasonCode, 'knowledge-store-not-open')
    assert.equal(initial.freshness, 'none')
    assert.equal(initial.head, head)
    assert.equal(calls, 0, 'status sampling never starts indexing')
    // The explicit Agent entry admits exactly one bounded pass.
    const accepted = await knowledge.requestMaintenance()
    assert.equal(accepted.outcome, 'accepted')
    assert.equal(accepted.reason, 'maintenance-accepted')
    assert.equal(accepted.target.checkpoint, head)
    assert.equal('generation' in accepted.target, false, 'companion omits the single-flight key it cannot expose exactly')
    const duplicate = await knowledge.requestMaintenance()
    assert.equal(duplicate.outcome, 'noop')
    assert.equal(duplicate.reason, 'already-running')
    release()
    let current
    for (let i = 0; i < 60; i += 1) { current = await knowledge.status(); if (current.state === 'current') break; await new Promise(resolve => setTimeout(resolve, 25)) }
    assert.equal(current.state, 'current')
    assert.equal(current.freshness, 'matching')
    assert.equal(current.latestComplete.checkpoint, head)
    assert.equal(calls, 1)
    // Fresh KAG ⇒ the Agent can no-op.
    const noop = await knowledge.requestMaintenance()
    assert.deepEqual([noop.outcome, noop.reason], ['noop', 'current'])
    assert.equal(noop.target.lastPublishedRevision, current.latestComplete.revision)
    // A new settlement makes it due again while latest-complete stays readable.
    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '第二版' } } }, { origin: 'agent', settleEvent: async () => {} })
    const dueAgain = await knowledge.status()
    assert.equal(dueAgain.state, 'due')
    assert.equal(dueAgain.freshness, 'different')
    assert.equal(dueAgain.latestComplete.checkpoint, head)
    assert.equal(f.messages.length, 0, 'orchestration never dispatches foreground notifications')
  } finally { release(); await knowledge?.close(); await f.close() }
})

test('a failed companion generation stays failed until an explicit request re-admits it once', async () => {
  const f = await fixture({ serverOptions: { host: 'codex' } })
  let attempts = 0
  class FailingIndex {
    publicationIdentity = 'failure:policy-v1'
    async compute() { attempts += 1; throw new Error('model unavailable') }
    async close() {}
  }
  let knowledge
  try {
    await f.server.project.store.write('smart_questions', { questions: { goal: { prompt: '目标', kind: 'text', answer: '失败测试' } } }, { origin: 'agent', settleEvent: async () => {} })
    knowledge = createCompanionKnowledge({ project: f.server.project, stateRoot: f.options.stateRoot,
      loadRuntime: async () => ({ ...runtime, DesignSemanticIndex: FailingIndex }) })
    assert.equal((await knowledge.requestMaintenance()).outcome, 'accepted')
    let status
    for (let i = 0; i < 60; i += 1) { status = await knowledge.status(); if (status.state === 'failed') break; await new Promise(resolve => setTimeout(resolve, 25)) }
    assert.equal(status.state, 'failed')
    assert.match(status.lastFailure.message, /model unavailable/)
    assert.equal(status.latestComplete, undefined, 'nothing ever completed')
    const settled = attempts
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(attempts, settled, 'a failed generation never auto-retries')
    const again = await knowledge.requestMaintenance()
    assert.equal(again.outcome, 'accepted')
    assert.equal(again.reason, 'failed-generation-retry-accepted')
  } finally { await knowledge?.close(); await f.close() }
})

test('server open samples only by default; knowledgeAutoRefresh:true restores legacy on-open refresh', async () => {
  // Default: open exposes honest state without indexing; the explicit tool refreshes.
  const f = await fixture({ serverOptions: { host: 'codex', knowledgeRuntime: async () => runtime } })
  const call = (method, params = {}) => callCompanion(f.server.connectionPath, { method, params })
  try {
    const initial = await call('knowledgeStatus')
    assert.equal(initial.state, 'disabled', 'fixture embedding is disabled and nothing was published on open')
    const before = JSON.parse((await call('readGraph')).content)
    assert.equal(before.knowledgeStatus, 'disabled', 'a readable empty store is not a published graph')
    assert.equal(before.freshness.indexedCheckpoint, undefined)
    const refreshed = await call('refreshKnowledge')
    assert.equal(refreshed.outcome, 'accepted')
    assert.equal(refreshed.reason, 'projection-only-accepted')
    let status
    for (let i = 0; i < 60; i += 1) { status = await call('knowledgeStatus'); if (status.state === 'current') break; await new Promise(resolve => setTimeout(resolve, 25)) }
    assert.equal(status.state, 'current')
    const published = JSON.parse((await call('readGraph')).content)
    assert.equal(published.knowledgeStatus, 'current', 'a published graph can legitimately contain no design nodes')
    assert.equal(published.freshness.indexedCheckpoint, published.freshness.sourceCheckpoint)
    assert.equal((await call('refreshKnowledge')).outcome, 'noop')
  } finally { await f.close() }

  // Opt-in: the legacy on-open refresh still runs without waiting for the response.
  const g = await fixture({ serverOptions: { host: 'codex', knowledgeRuntime: async () => runtime, knowledgeAutoRefresh: true } })
  const callG = (method, params = {}) => callCompanion(g.server.connectionPath, { method, params })
  try {
    let status
    for (let i = 0; i < 60; i += 1) { status = await callG('knowledgeStatus'); if (status.state === 'current') break; await new Promise(resolve => setTimeout(resolve, 25)) }
    assert.equal(status.state, 'current', 'opt-in keeps the legacy on-open indexing behavior')
  } finally { await g.close() }
})
