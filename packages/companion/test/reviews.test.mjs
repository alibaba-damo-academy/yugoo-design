import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'

test('default batch selects independent GRA without a second clarity evaluation, reuses same evidence despite paraphrased context',async()=>{
 const f=await fixture()
 const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
 try{
  await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'default'})
  const first=await call('prepareReviews',{userContext:'initial'})
  assert.deepEqual(first.requests.map(r=>r.profile),['grounding','reflection','alignment'])
  const second=await call('prepareReviews',{userContext:'same user intention paraphrased'})
  assert.deepEqual(second.requests.map(r=>r.reviewId),first.requests.map(r=>r.reviewId))
  assert.ok(second.requests.every(r=>!r.dispatch))
  const explicit=await call('prepareReviews',{profiles:['alignment'],userContext:'explicit new review'})
  assert.ok(explicit.requests[0].dispatch)
  assert.equal((await call('prepareReviews',{})).requests.find(r=>r.profile==='alignment').reviewId,explicit.requests[0].reviewId)
  const other=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId:'00000000-0000-4000-8000-000000000088'})
  const replacement=await other.prepareReviews({userContext:'another session'})
  const resumed=await call('prepareReviews',{userContext:'initial'})
  assert.ok(resumed.requests.every(r=>r.dispatch),'superseded local requests cannot suppress current work')
  for(const request of resumed.requests) {
    assert.notEqual(request.reviewId,replacement.requests.find(r=>r.profile===request.profile).reviewId)
    assert.equal((await call('readReview',{reviewId:request.reviewId})).superseded,false)
  }
 }finally{await f.close()}
})

test('batch references preserve independent contracts, reuse and connection isolation', async () => {
  const f=await fixture(), other=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'batch-start'})
    const params={profiles:['grounding','reflection','alignment','clarity'],userContext:'先做原型'}
    const batch=await call('prepareReviews',params)
    assert.equal(batch.requests.length,4)
    assert.equal(new Set(batch.requests.map(x=>x.reviewId)).size,4)
    assert.ok(batch.requests.every(x=>x.dispatch && x.created && !('prompt' in x) && !('schema' in x)))
    const again=await call('prepareReviews',params)
    assert.deepEqual(again.requests.map(x=>x.reviewId),batch.requests.map(x=>x.reviewId))
    assert.ok(again.requests.every(x=>!x.dispatch && !x.created))
    const id=batch.requests.find(x=>x.profile==='alignment').reviewId
    const request=await call('readReview',{reviewId:id})
    assert.ok(request.prompt && request.schema)
    assert.equal(request.revisionChanged,false)
    assert.equal(request.superseded,false)
    assert.match(request.prompt,/先做原型/)
    await assert.rejects(callCompanion(other.server.connectionPath,{method:'readReview',params:{reviewId:id}}),/Unknown review ID/)
    const runId='00000000-0000-4000-8000-000000000095', transcriptPath=join(f.root,'batch-child.jsonl')
    const nativeRun={runId,parentRunId:threadId,transcriptPath}
    await writeFile(transcriptPath,JSON.stringify({type:'session_meta',payload:{id:runId,cwd:f.options.projectRoot,
      source:{subagent:{thread_spawn:{parent_thread_id:threadId}}}}})+'\n'+JSON.stringify({type:'event_msg',payload:{type:'task_complete'}})+'\n')
    const bindings=[{reviewId:id,nativeRun},{reviewId:batch.requests[0].reviewId,nativeRun:{...nativeRun,parentRunId:'wrong'}}]
    const bound=await call('bindReviewRuns',{bindings})
    assert.equal(bound.results[0].status,'running')
    assert.match(bound.results[1].error,/bound main conversation/)
    assert.deepEqual((await call('readReview',{reviewId:id})).nativeRun,nativeRun)
    assert.equal((await call('readWorkspace')).reviews.find(item=>item.reviewId===id).status,'unsubmitted','early native completion does not manufacture a submitted result')
    // A follow-up to this same native child reads its now-registered request.
    const recovered=await call('readReview',{reviewId:id})
    assert.equal((await call('submitReview',{reviewId:id,nativeRun:recovered.nativeRun,result:{schemaVersion:1,questions:[]}})).status,'completed')
    assert.equal((await call('bindReviewRuns',{bindings:[bindings[0]]})).results[0].status,'completed')
    assert.ok((await call('prepareReviews',params)).requests.every(x=>!x.dispatch))
    await call('savePanel',{skill:'smart_questions',state:{questions:{goal:{prompt:'目标',kind:'text',answer:'新的目标'}}},eventId:'batch-new-revision'})
    assert.equal((await call('readReview',{reviewId:id})).revisionChanged,true)
    const pending=batch.requests.find(item=>item.profile==='grounding').reviewId
    await call('bindReviewRuns',{bindings:[{reviewId:pending,nativeRun}]})
    assert.equal((await call('submitReview',{reviewId:pending,nativeRun,result:{schemaVersion:1,inconsistencies:[]}})).status,'stale')
    await assert.rejects(call('prepareReviews',{profiles:['alignment','alignment']}),/distinct/)
    await assert.rejects(call('prepareReviews',{profiles:['alignment','invalid']}),/distinct/)
    assert.equal(f.messages.length,0,'batch plumbing never wakes the foreground')
  } finally {await f.close();await other.close()}
})

test('single and batch bindings return compact receipts without copying a large review request', async () => {
  const f = await fixture()
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    await call('savePanel', { skill: 'smart_questions', state: { questions: {} }, eventId: 'compact-bind' })
    const { reviewId } = await call('prepareReview', { profile: 'alignment' })
    const registry = join(f.options.stateRoot, f.server.project.project.metadata.id, `reviews-${threadId}.json`)
    const state = JSON.parse(await readFile(registry, 'utf8'))
    const request = state.requests[reviewId]
    // Seed a large stored request without involving a model or Knowledge runtime.
    request.prompt += '\n' + 'Fixture review evidence. '.repeat(20000)
    request.knowledge = { project: f.server.project.project.metadata.id, checkpoint: request.revision.checkpoint,
      knowledgeRevision: 'fixture-revision', graph: { entities: [], relations: [] } }
    for (const field of ['prompt', 'schema', 'input', 'knowledge', 'relationVocabulary']) {
      assert.ok(Object.hasOwn(request, field), `fixture contains ${field}`)
    }
    assert.ok(Buffer.byteLength(JSON.stringify(request)) > 262144)
    await writeFile(registry, JSON.stringify(state))
    const runId = '00000000-0000-4000-8000-000000000096', transcriptPath = join(f.root, 'compact-reviewer.jsonl')
    const nativeRun = { runId, parentRunId: threadId, transcriptPath }
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: runId, cwd: f.options.projectRoot,
      source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n'
      + JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n')

    const binding = { reviewId, nativeRun }, expected = { reviewId, status: 'running', nativeRun }
    const single = await call('bindReviewRun', binding)
    const batch = await call('bindReviewRuns', { bindings: [binding] })
    const repeated = await call('bindReviewRun', binding)
    for (const receipt of [single, batch.results[0], repeated]) {
      assert.deepEqual(receipt, expected)
      for (const field of ['prompt', 'schema', 'input', 'knowledge', 'relationVocabulary']) {
        assert.equal(Object.hasOwn(receipt, field), false, `binding does not return ${field}`)
      }
    }
    const stored = JSON.parse(await readFile(registry, 'utf8')).requests[reviewId]
    assert.deepEqual(stored, { ...request, nativeRun, status: 'running' }, 'the internal request remains intact')
    const detail = await call('readReview', { reviewId })
    assert.equal(detail.prompt, request.prompt, 'review content still has its explicit read route')
    assert.deepEqual(detail.schema, request.schema)
    assert.equal(f.messages.length, 0, 'binding never wakes the foreground')
  } finally { await f.close() }
})

test('batch preparation detects changing evidence and concurrent retries do not dispatch twice', async () => {
  const f=await fixture()
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'initial'})
    const project=f.server.project
    const workspace=await project.readWorkspace()
    let reads=0
    const changing={...project,readWorkspace:async()=>({...workspace,evidenceWorktreeRevision:`changed-${reads++}`})}
    const api=createCompanionReviews({project:changing,stateRoot:f.options.stateRoot,threadId})
    const changed=await api.prepareReviews({profiles:['grounding','reflection']})
    assert.equal(changed.revisionChanged,true)
    assert.ok(changed.requests.every(item=>!item.dispatch))
    const stable=createCompanionReviews({project,stateRoot:f.options.stateRoot,threadId})
    const batches=await Promise.all([0,1].map(()=>stable.prepareReviews({profiles:['alignment']})))
    assert.equal(batches.flatMap(batch=>batch.requests).filter(item=>item.dispatch).length,1)
    assert.equal(batches[0].requests[0].reviewId,batches[1].requests[0].reviewId)
    const first=batches[0].requests[0].reviewId
    await stable.prepareReviews({profiles:['alignment'],userContext:'新的明确用户要求'})
    assert.equal((await stable.readReview({reviewId:first})).superseded,true)
  } finally {await f.close()}
})

test('scope A to B to A creates a current request instead of reusing superseded history', async () => {
  for (const finishFirst of [true,false]) {
    const f=await fixture()
    try {
      await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'initial'})
      const api=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId})
      const nativeRun={runId:'00000000-0000-4000-8000-000000000090',parentRunId:threadId,transcriptPath:join(f.root,'review.jsonl')}
      const result={schemaVersion:1,questions:[]}
      const a=await api.prepareReview({profile:'alignment',activeWork:[]})
      await api.bindReviewRun({reviewId:a.reviewId,nativeRun})
      if(finishFirst)await api.submitReview({reviewId:a.reviewId,nativeRun,result})
      const b=await api.prepareReview({profile:'alignment',activeWork:[{skill:'page_design'}]})
      await api.bindReviewRun({reviewId:b.reviewId,nativeRun})
      await api.submitReview({reviewId:b.reviewId,nativeRun,result})
      const next=await api.prepareReview({profile:'alignment',activeWork:[]})
      assert.notEqual(next.reviewId,a.reviewId)
      assert.ok(next.sequence>b.sequence)
      assert.equal((await api.prepareReview({profile:'alignment',activeWork:[]})).reviewId,next.reviewId)
      if(!finishFirst)assert.equal((await api.submitReview({reviewId:a.reviewId,nativeRun,result})).status,'stale')
      await api.bindReviewRun({reviewId:next.reviewId,nativeRun})
      await api.submitReview({reviewId:next.reviewId,nativeRun,result})
      const status=(await api.readReviewStatus({activeWork:[]})).find(item=>item.profile==='alignment')
      assert.equal(status.reviewId,next.reviewId)
      assert.equal(status.status,'completed')
      assert.equal(status.needsReview,false)
    } finally {await f.close()}
  }
})

test('review reminders are derived, scope-aware and distinguish native termination from results', async () => {
  const f=await fixture()
  try {
    const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
    const saved=await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'start'})
    assert.equal(saved.reviews.length,4)
    assert.ok(saved.reviews.every(item=>item.status==='due'))
    const runId='00000000-0000-4000-8000-000000000088', transcriptPath=join(f.root,'review.jsonl')
    const nativeRun={runId,parentRunId:threadId,transcriptPath}
    const event=type=>JSON.stringify({type:'event_msg',payload:{type}})+'\n'
    await writeFile(transcriptPath,JSON.stringify({type:'session_meta',payload:{id:runId,cwd:f.options.projectRoot,
      source:{subagent:{thread_spawn:{parent_thread_id:threadId}}}}})+'\n'+event('task_started'))
    const a=await call('prepareReview',{profile:'alignment',userContext:'先做原型'})
    await call('bindReviewRun',{reviewId:a.reviewId,nativeRun})
    const current=async()=> (await call('readWorkspace')).reviews.find(item=>item.profile==='alignment')
    assert.equal((await current()).status,'running')
    await appendFile(transcriptPath,event('task_complete'))
    assert.equal((await current()).status,'unsubmitted')
    await appendFile(transcriptPath,event('task_started'))
    assert.equal((await current()).status,'running','same native agent may resume')
    await appendFile(transcriptPath,event('turn_aborted'))
    assert.equal((await current()).status,'interrupted')
    await appendFile(transcriptPath,event('task_failed'))
    assert.equal((await current()).status,'failed')
    // Submit is a separate fact; the native event never manufactures a result.
    await call('submitReview',{reviewId:a.reviewId,nativeRun,result:{schemaVersion:1,questions:[]}})
    assert.equal((await current()).status,'completed')
    const registry=join(f.options.stateRoot,f.server.project.project.metadata.id,`reviews-${threadId}.json`)
    const before=await readFile(registry,'utf8')
    await call('readWorkspace'); await call('readWorkspace')
    assert.equal(await readFile(registry,'utf8'),before,'poll never creates requests or persists reminders')
    // A legacy request used the same input but told reviewers to exclude whole Bundles.
    const legacy=JSON.parse(before)
    const canonical=value=>value && typeof value==='object'
      ? Array.isArray(value) ? `[${value.map(canonical)}]` : `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
      : JSON.stringify(value)
    legacy.requests[a.reviewId].requestKey=createHash('sha256').update(canonical({profile:'alignment',revision:a.revision,userContext:'先做原型',activeWork:[]})).digest('hex')
    delete legacy.requests[a.reviewId].activeWork
    await writeFile(registry,JSON.stringify(legacy))
    assert.equal((await current()).scopeChanged,true)
    assert.notEqual((await call('prepareReview',{profile:'alignment',userContext:'先做原型'})).reviewId,a.reviewId,'do not reuse obsolete exclusion prompt')
    const api=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId})
    const work=[{skill:'page_design',artifactFile:'page_design/a.html'},{skill:'page_design',artifactFile:null}]
    const first=await api.prepareReview({profile:'grounding',activeWork:work,userContext:'先做原型'})
    const same=await api.prepareReview({profile:'grounding',activeWork:[...work].reverse().concat(work),userContext:'先做原型'})
    assert.equal(first.reviewId,same.reviewId,'order/duplicates are not new work')
    assert.ok(!first.prompt.includes('work to exclude'))
    assert.equal(first.input.userContextSummary,'先做原型')
    assert.equal((await api.readReviewStatus({activeWork:[]})).find(x=>x.profile==='grounding').scopeChanged,true)
    const next=await api.prepareReview({profile:'grounding',activeWork:[],userContext:'先做原型'})
    assert.notEqual(first.reviewId,next.reviewId,'scope clearance allows follow-up at unchanged revision')
    assert.deepEqual(first.revision,next.revision)
    await call('registerNativeRun',{...nativeRun,role:'producer',skill:'smart_questions',artifactId:'smart_questions'})
    const settled=await call('finishNativeRun',{runId,scope:'state',outcome:'pause'})
    assert.equal(settled.accepted,true)
    assert.equal(settled.reviews.length,4)
    await appendFile(transcriptPath,event('task_complete'))
    await appendFile(transcriptPath,event('task_started'))
    const resumed=await call('prepareReview',{profile:'reflection'})
    assert.deepEqual(resumed.activeWork,[{skill:'smart_questions',artifactFile:null}], 'historical settlement does not hide resumed editing')
    await writeFile(registry,'invalid JSON')
    const after=await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'after-review-failure'})
    assert.match(after.reviewStatusError,/files remain saved/)
    assert.ok(await f.server.project.store.read('smart_questions'))
    assert.equal(f.messages.length,0,'review reads never wake foreground')
  } finally {await f.close()}
})

test('background results use exact native identity, shared journal policy and real action settlement', async () => {
  const f = await fixture()
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  const state = { questions: { overview: { prompt: '目标用户', kind: 'text', answer: '研究者', detail: '' } } }
  let id = 10
  async function child() {
    const runId = `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`
    const transcriptPath = join(f.root, `${runId}.jsonl`)
    const nativeRun = { runId, parentRunId: threadId, transcriptPath }
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: runId, cwd: f.options.projectRoot,
      source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n')
    return nativeRun
  }
  try {
    await f.server.project.savePanel({ skill: 'smart_questions', state, eventId: 'initial' })
    const task = await call('prepareReview', { profile: 'grounding' })
    assert.equal((await call('prepareReview', { profile: 'grounding' })).reviewId, task.reviewId)
    const nativeRun = await child()
    const result = { schemaVersion: 1, inconsistencies: [{ id: 'audience', facets: ['smart_questions', 'research'],
      summary: '用户说明与问题答案不一致', authoritativeReference: 'smart_questions/smart_questions.json',
      correction: '核对并修正目标用户', affectedFacets: ['smart_questions'] }] }
    await assert.rejects(call('submitReview', { reviewId: task.reviewId, result, nativeRun }), /registered native reviewer/)
    await call('bindReviewRun', { reviewId: task.reviewId, nativeRun })
    await assert.rejects(call('bindReviewRun', { reviewId: task.reviewId, nativeRun: await child() }), /rebound/)
    const submitted = await call('submitReview', { reviewId: task.reviewId, result, nativeRun })
    assert.equal(submitted.status, 'completed')
    assert.deepEqual(await call('submitReview', { reviewId: task.reviewId, result, nativeRun }), submitted)
    await assert.rejects(call('submitReview', { reviewId: task.reviewId, result: { schemaVersion: 1, inconsistencies: [] }, nativeRun }), /different result/)
    assert.equal(f.messages.length, 0, 'background review never queues foreground work')
    assert.equal((await call('readWorkspace')).advisories.length, 1)
    const accepted = await call('decideAdvisory', { advisoryId: submitted.advisoryId, decision: 'accepted' })
    assert.equal(f.messages.length, 1, 'only explicit user acceptance wakes foreground')
    assert.equal(accepted.actionReceipts[0].state, 'ready')
    assert.equal((await call('listAdvisories')).length, 0)
    await call('decideAdvisory', { advisoryId: submitted.advisoryId, decision: 'accepted' })
    assert.equal(f.messages.length, 1)
    let producer = await child()
    const wrong = await child()
    await call('registerNativeRun', { ...producer, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
    await call('registerNativeRun', { ...wrong, role: 'producer', skill: 'function_modules', artifactId: 'function_modules' })
    const receiptId = accepted.actionReceipts[0].receiptId
    await assert.rejects(call('claimReviewAction', { runId: wrong.runId, receiptId }), /exact advisory target/)
    const claim = await call('claimReviewAction', { runId: producer.runId, receiptId })
    assert.equal(claim.claimed, true)
    assert.deepEqual(await call('claimReviewAction', { runId: producer.runId, receiptId }), claim)
    await assert.rejects(call('settleReviewAction', { runId: producer.runId, receiptId }), /not ended/)
    await call('finishNativeRun', { runId: producer.runId, outcome: 'failed' })
    await appendFile(producer.transcriptPath, JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }) + '\n')
    assert.equal((await call('settleReviewAction', { runId: producer.runId, receiptId })).state, 'failed')
    await assert.rejects(call('claimReviewAction', { runId: producer.runId, receiptId }), /already settled/)
    producer = await child()
    await call('registerNativeRun', { ...producer, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
    assert.equal((await call('claimReviewAction', { runId: producer.runId, receiptId })).claimed, true)
    await call('finishNativeRun', { runId: producer.runId })
    await appendFile(producer.transcriptPath, JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }) + '\n')
    assert.equal((await call('settleReviewAction', { runId: producer.runId, receiptId })).state, 'completed')
    await assert.rejects(call('claimReviewAction', { runId: producer.runId, receiptId }), /already settled/)

    const clarity = await call('prepareReview', { profile: 'clarity' }), clarityRun = await child()
    await call('bindReviewRun', { reviewId: clarity.reviewId, nativeRun: clarityRun })
    const assessment = { summary: '目标清晰，细节待完善', u: { score: 70, evidence: '明确研究者'.repeat(300) }, s: { score: 40, evidence: '只有目标说明' }, t: { score: 20, evidence: '尚无技术设计' } }
    assert.equal((await call('submitReview', { reviewId: clarity.reviewId, nativeRun: clarityRun, result: assessment })).status, 'completed')
    assert.equal((await call('readWorkspace')).clarity.assessment.u, 70)
    assert.equal((await call('readWorkspace')).clarity.explanation.u, assessment.u.evidence, 'native review evidence reaches the shared UI without truncation')
    const late = await call('prepareReview', { profile: 'alignment' }), lateRun = await child()
    await call('bindReviewRun', { reviewId: late.reviewId, nativeRun: lateRun })
    await f.server.project.savePanel({ skill: 'smart_questions', state: { ...state, questions: { overview: { ...state.questions.overview, answer: '学生' } } }, eventId: 'new-answer' })
    assert.equal((await call('submitReview', { reviewId: late.reviewId, nativeRun: lateRun, result: { schemaVersion: 1, questions: [] } })).status, 'stale')
    assert.equal((await call('readWorkspace')).clarity.needsReassessment, true)
    await assert.rejects(call('updateSettings', { maxSuggestions: 11 }), /1 through 10/)
    assert.equal((await call('updateSettings', { maxSuggestions: 2 })).maxSuggestions, 2)
  } finally { await f.close() }
})

test('project clarity ordering spans native threads and rejects prototype review IDs', async () => {
  const f = await fixture()
  try {
    await f.server.project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    const make = id => createCompanionReviews({ project: f.server.project, stateRoot: f.options.stateRoot, threadId: id })
    const otherId = '00000000-0000-4000-8000-000000000099'
    const a = make(threadId), b = make(otherId)
    const old = await a.prepareReview({ profile: 'clarity' })
    const fresh = await b.prepareReview({ profile: 'clarity' })
    assert.ok(fresh.sequence > old.sequence)
    const bind = (parent, runId) => ({ parentRunId: parent, runId, transcriptPath: '/test/native.jsonl' })
    const first = bind(threadId, '00000000-0000-4000-8000-000000000051')
    const second = bind(otherId, '00000000-0000-4000-8000-000000000052')
    await a.bindReviewRun({ reviewId: old.reviewId, nativeRun: first })
    await b.bindReviewRun({ reviewId: fresh.reviewId, nativeRun: second })
    const result = { summary: '评估', u: { score: 70, evidence: '明确' }, s: { score: 40, evidence: '部分' }, t: { score: 20, evidence: '待补' } }
    assert.equal((await b.submitReview({ reviewId: fresh.reviewId, nativeRun: second, result })).status, 'completed')
    assert.equal((await a.submitReview({ reviewId: old.reviewId, nativeRun: first, result: { ...result, u: { score: 10, evidence: '旧评估' } } })).status, 'stale')
    assert.equal((await a.readClarity()).assessment.u, 70)
    for (const reviewId of ['__proto__', 'constructor', 'toString']) {
      await assert.rejects(a.bindReviewRun({ reviewId, nativeRun: first }), /Unknown review ID/)
      await assert.rejects(a.submitReview({ reviewId, nativeRun: first, result }), /Unknown review ID/)
    }
  } finally { await f.close() }
})

test('independent service processes serialize clarity allocation and promotion', async () => {
  const f = await fixture(), children = []
  try {
    await f.server.project.savePanel({ skill: 'smart_questions', state: { questions: {} }, eventId: 'initial' })
    const workspace = await f.server.project.readWorkspace()
    const base = { stateRoot: f.options.stateRoot, workspace, project: {
      project: f.server.project.project,
      kit: { name: f.server.project.kit.name, version: f.server.project.kit.version, skills: [] },
    } }
    async function start(thread) {
      const child = fork(new URL('./review-process.mjs', import.meta.url), [JSON.stringify({ ...base, threadId: thread })], { silent: true })
      children.push(child)
      await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject) })
      let seq = 0
      return (method, params) => new Promise((resolve, reject) => {
        const id = ++seq
        const listener = message => {
          if (message.id !== id) return
          child.off('message', listener)
          message.error ? reject(new Error(message.error)) : resolve(message.value)
        }
        child.on('message', listener); child.send({ id, method, params })
      })
    }
    const ids = [threadId, '00000000-0000-4000-8000-000000000088']
    const callers = await Promise.all(ids.map(start))
    const tasks = await Promise.all(callers.map(call => call('prepareReview', { profile: 'clarity' })))
    assert.notEqual(tasks[0].sequence, tasks[1].sequence)
    const bindings = ids.map((parentRunId, i) => ({ parentRunId, runId: `00000000-0000-4000-8000-00000000006${i}`, transcriptPath: '/fixture/native.jsonl' }))
    await Promise.all(callers.map((call, i) => call('bindReviewRun', { reviewId: tasks[i].reviewId, nativeRun: bindings[i] })))
    const results = await Promise.all(callers.map((call, i) => call('submitReview', { reviewId: tasks[i].reviewId, nativeRun: bindings[i], result: {
      summary: '评估', u: { score: 60 + i, evidence: '明确' }, s: { score: 40, evidence: '部分' }, t: { score: 20, evidence: '待补' },
    } })))
    const newest = tasks[0].sequence > tasks[1].sequence ? 0 : 1
    assert.equal(results[newest].status, 'completed')
    assert.equal(results[1 - newest].status, 'stale')
    assert.equal((await callers[0]('readClarity')).assessment.u, 60 + newest)
  } finally {
    await Promise.all(children.map(child => new Promise(resolve => { child.once('exit', resolve); child.kill() })))
    await f.close()
  }
})

test('display review snapshot shares one lock with writers and releases it after failure', async () => {
  const f = await fixture()
  let entered, release, fail = false, block = true
  const enteredPromise = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  const api = createCompanionReviews({ project: f.server.project, stateRoot: f.options.stateRoot, threadId,
    getSettings: async () => { if (block) { entered(); await held }; if (fail) throw Error('display settings failed'); return {} } })
  try {
    const workspace = await f.server.project.readWorkspace({ displayOnly: true })
    const reading = api.readPresentation({ workspace })
    await enteredPromise
    let writerFinished = false
    const writer = assert.rejects(api.bindReviewRun({ reviewId: 'unknown' }), /Unknown/).finally(() => { writerFinished = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(writerFinished, false, 'writer waits for the complete display projection')
    block = false; release()
    const combined = await reading; await writer
    assert.deepEqual(combined, { reviews: await api.readReviewStatus({ workspace }), clarity: await api.readClarity(workspace), advisories: await api.listAdvisories(workspace) })
    fail = true
    await assert.rejects(api.readPresentation({ workspace }), /display settings failed/)
    fail = false
    const recovered = await api.readPresentation({ workspace, includeReviews: false })
    assert.deepEqual(recovered.reviews, [], 'hosts without background reviews keep that boundary')
    assert.deepEqual(recovered.clarity, combined.clarity)
  } finally { release(); await f.close() }
})
