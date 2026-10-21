import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createCompanionReviews } from '../src/reviews.mjs'
const alignment={schemaVersion:1,questions:[]}
const identity=r=>({reviewId:r.reviewId,ownerId:r.execution.ownerId,attemptId:r.execution.attemptId})
async function until(check) {for(let i=0;i<200;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Timed out')}
test('project policy defaults to 30s, persists, and off gates autonomous native requests',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    assert.deepEqual(await call('readReviewPolicy'),{mode:'auto',autoMergeWindowMs:30000})
    assert.deepEqual(await call('updateReviewPolicy',{policy:{mode:'off',autoMergeWindowMs:45000}}),{mode:'off',autoMergeWindowMs:45000})
    await assert.rejects(call('prepareReview',{profile:'alignment'}),/disabled by the user/)
    await assert.rejects(call('updateReviewPolicy',{policy:{mode:'auto',autoMergeWindowMs:-1}}),/merge window/)
    assert.equal((await call('readReviewPolicy')).mode,'off')
  }finally{await f.close()}
})
test('explicit human recheck works while off and a stable request ID does not rerun a completed pass',async()=>{
  let calls=0
  const f=await fixture({serverOptions:{backgroundReviews:true,reviewDebounceMs:0,reviewExecutor:async()=>{calls++;return {result:alignment}}}})
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:{mode:'off',autoMergeWindowMs:30000}})
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'manual-first'})
    const designCheckpoint=await f.server.project.store.head()
    await call('recheckReviews',{requestId:'human-check-1',profiles:['alignment']})
    await until(async()=>(await call('readWorkspace')).reviews.find(row=>row.profile==='alignment')?.status==='completed')
    assert.equal(calls,1)
    assert.notEqual(await f.server.project.store.head(),designCheckpoint,'review records advance Git without changing the design evidence')
    await call('recheckReviews',{requestId:'human-check-1',profiles:['alignment']})
    await new Promise(resolve=>setTimeout(resolve,80))
    assert.equal(calls,1)
    await call('recheckReviews',{requestId:'human-check-2',profiles:['alignment']})
    await until(()=>calls===2)
    assert.equal((await call('readReviewPolicy')).mode,'off')
    await f.server.project.savePanel({skill:'smart_questions',eventId:'manual-changed',state:{questions:{
      goal:{prompt:'Goal?',kind:'text',answer:'A genuinely changed product fact',detail:''},
    }}})
    await assert.rejects(call('recheckReviews',{requestId:'human-check-1',profiles:['alignment']}),/Manual request ID cannot change target/,
      'a real Design File change still requires a new explicit request identity')
  }finally{await f.close()}
})
test('native explicit recheck while off returns new background references once',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:{mode:'off',autoMergeWindowMs:30000}})
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'native-manual'})
    const first=await call('recheckReviews',{requestId:'human-native-1',profiles:['alignment']})
    assert.equal(first.requests[0].dispatch,true)
    const again=await call('recheckReviews',{requestId:'human-native-1',profiles:['alignment']})
    assert.equal(again.requests[0].reviewId,first.requests[0].reviewId)
    assert.equal(again.requests[0].dispatch,false)
    assert.equal((await call('readReviewPolicy')).mode,'off')
  }finally{await f.close()}
})
test('Agent initiative bypasses the automatic quiet window without becoming a manual recheck',async()=>{
  let calls=0
  const f=await fixture({serverOptions:{backgroundReviews:true,reviewExecutor:async()=>{calls++;return {result:alignment}}}})
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'agent-initiative'})
    const response=await call('prepareReview',{profile:'alignment'})
    assert.equal(response.dispatchOwner,'companion')
    await until(async()=>(await call('readWorkspace')).reviews.find(row=>row.profile==='alignment')?.status==='completed')
    assert.equal(calls,1)
    await call('prepareReview',{profile:'alignment'})
    await new Promise(resolve=>setTimeout(resolve,80))
    assert.equal(calls,1)
    assert.equal((await call('readReviewPolicy')).autoMergeWindowMs,30000)
  }finally{await f.close()}
})
test('failed managed reviews do not loop; the same explicit human request can retry a failed attempt',async()=>{
  let calls=0
  const f=await fixture({serverOptions:{backgroundReviews:true,reviewExecutor:async()=>{if(++calls===1)throw new Error('temporary model failure');return {result:alignment}}}})
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:{mode:'off',autoMergeWindowMs:30000}})
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'retry-failed'})
    await call('recheckReviews',{requestId:'human-failed',profiles:['alignment']})
    await until(async()=>(await call('readWorkspace')).reviews.find(row=>row.profile==='alignment')?.status==='failed')
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(calls,1)
    await call('recheckReviews',{requestId:'human-failed',profiles:['alignment']})
    await until(async()=>(await call('readWorkspace')).reviews.find(row=>row.profile==='alignment')?.status==='completed')
    assert.equal(calls,2)
  }finally{await f.close()}
})
test('joining a running manual review does not consume a different human request ID',async()=>{
  let calls=0,release
  const f=await fixture({serverOptions:{backgroundReviews:true,reviewExecutor:async()=>{if(++calls===1)await new Promise(resolve=>{release=resolve});return {result:alignment}}}})
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:{mode:'off',autoMergeWindowMs:30000}})
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'join-active'})
    await call('recheckReviews',{requestId:'human-running',profiles:['alignment']})
    await until(()=>calls===1)
    assert.equal((await call('recheckReviews',{requestId:'human-joined',profiles:['alignment']})).outcome,'noop')
    release()
    await until(async()=>(await call('readWorkspace')).reviews.find(row=>row.profile==='alignment')?.status==='completed')
    await new Promise(resolve=>setTimeout(resolve,80))
    await call('recheckReviews',{requestId:'human-joined',profiles:['alignment']})
    await until(()=>calls===2)
  }finally{release?.();await f.close()}
})
test('native manual requests reuse an already running matching review without consuming request identity',async()=>{
  const f=await fixture()
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'join-native-active'})
    const reviews=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId})
    const request=await reviews.prepareReview({profile:'alignment'})
    await reviews.bindReviewRun({reviewId:request.reviewId,nativeRun:{runId:'00000000-0000-4000-8000-000000000002',parentRunId:threadId,transcriptPath:'/tmp/reviewer-fixture.jsonl'}})
    const joined=await reviews.prepareManualReviews({requestId:'human-native-joined',profiles:['alignment']})
    assert.equal(joined.requests[0].reviewId,request.reviewId)
    assert.equal(joined.requests[0].dispatch,false)
    assert.equal((await reviews.readReview({reviewId:request.reviewId})).manualRequestId,undefined)
  }finally{await f.close()}
})
test('native manual recovery preserves live and uncertain runs and replaces confirmed local failures',async()=>{
  const f=await fixture()
  let observation={available:true,recordedStatus:'running'},throwObservation=false
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'native-recovery'})
    const reviews=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId,
      observeReviewRun:()=>{if(throwObservation)throw Error('observer unavailable');return observation}})
    const params={requestId:'human-native-recovery',profiles:['alignment']}
    const original=(await reviews.prepareManualReviews(params)).requests[0]
    const nativeRun={runId:'00000000-0000-4000-8000-000000000002',parentRunId:threadId,transcriptPath:join(f.root,'native-review.jsonl')}
    await reviews.bindReviewRun({reviewId:original.reviewId,nativeRun})
    const registry=join(f.options.stateRoot,f.server.project.project.metadata.id,`reviews-${threadId}.json`)
    const before=await readFile(registry,'utf8')
    observation={available:true,recordedStatus:'interrupted'}
    assert.equal((await reviews.readReviewStatus()).find(row=>row.profile==='alignment').status,'interrupted')
    assert.equal(await readFile(registry,'utf8'),before,'status reads never retire a request')
    observation={available:true,recordedStatus:'running'}
    assert.equal((await reviews.readReviewStatus()).find(row=>row.profile==='alignment').status,'running','the same Agent can resume before recheck')
    for(const value of [observation,{available:false},{available:true,recordedStatus:'unknown'},{available:true,recordedStatus:'completed'}]) {
      observation=value
      const joined=(await reviews.prepareManualReviews(params)).requests[0]
      assert.equal(joined.reviewId,original.reviewId)
      assert.equal(joined.dispatch,false,'running, unknown and unsubmitted work is retained')
    }
    throwObservation=true
    assert.equal((await reviews.prepareManualReviews(params)).requests[0].dispatch,false)
    throwObservation=false
    assert.equal(await readFile(registry,'utf8'),before,'uncertain observations never change the registry')
    observation={available:true,recordedStatus:'interrupted'}
    const replacement=(await reviews.prepareManualReviews(params)).requests[0]
    assert.equal(replacement.dispatch,true)
    assert.notEqual(replacement.reviewId,original.reviewId)
    assert.equal((await reviews.readReview({reviewId:original.reviewId})).status,'interrupted')
    const replay=(await reviews.prepareManualReviews(params)).requests[0]
    assert.equal(replay.reviewId,replacement.reviewId)
    assert.equal(replay.dispatch,false,'the same human request is idempotent after recovery')
    await reviews.bindReviewRun({reviewId:replacement.reviewId,nativeRun:{...nativeRun,runId:'00000000-0000-4000-8000-000000000003'}})
    observation={available:true,recordedStatus:'failed'}
    const next=(await reviews.prepareManualReviews(params)).requests[0]
    assert.equal(next.dispatch,true)
    assert.notEqual(next.reviewId,replacement.reviewId)
    assert.equal((await reviews.readReview({reviewId:replacement.reviewId})).status,'failed')
    assert.equal((await reviews.prepareManualReviews(params)).requests[0].dispatch,false)
  }finally{await f.close()}
})
test('native manual recovery never revives a superseded unknown run on request replay',async()=>{
  const f=await fixture(),observed=[]
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'superseded-recovery'})
    const oldRun={runId:'00000000-0000-4000-8000-000000000004',parentRunId:threadId,transcriptPath:join(f.root,'old-review.jsonl')}
    const failedRun={...oldRun,runId:'00000000-0000-4000-8000-000000000005'}
    const reviews=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId,
      observeReviewRun:run=>{observed.push(run.runId);return run.runId===failedRun.runId
        ? {available:true,recordedStatus:'failed'} : {available:false}}})
    const old=await reviews.prepareReview({profile:'alignment',userContext:'Initial review'})
    await reviews.bindReviewRun({reviewId:old.reviewId,nativeRun:oldRun})
    const oldBinding=await reviews.readReview({reviewId:old.reviewId})
    const newer=(await reviews.prepareReviews({profiles:['alignment'],userContext:'用户已停止上一轮并明确要求重新评审'})).requests[0]
    await reviews.bindReviewRun({reviewId:newer.reviewId,nativeRun:failedRun})
    const params={requestId:'human-superseded-recovery',profiles:['alignment']}
    const replacement=(await reviews.prepareManualReviews(params)).requests[0]
    assert.equal(replacement.dispatch,true)
    assert.notEqual(replacement.reviewId,newer.reviewId)
    const replay=(await reviews.prepareManualReviews(params)).requests[0]
    assert.equal(replay.reviewId,replacement.reviewId,'replay retains the latest prepared recovery')
    assert.equal(replay.dispatch,false)
    assert.deepEqual(observed,[failedRun.runId],'a superseded unknown run is not reconsidered as active')
    const retained=await reviews.readReview({reviewId:old.reviewId})
    assert.equal(retained.status,'running')
    assert.deepEqual(retained.nativeRun,oldBinding.nativeRun)
    assert.equal(retained.superseded,true,'history is retained without restarting or clearing it')
  }finally{await f.close()}
})
test('native manual recovery never observes or rewrites a foreign registry',async()=>{
  const f=await fixture(),foreignThread='00000000-0000-4000-8000-000000000088'
  let observed=0
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'foreign-recovery'})
    const foreign=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId:foreignThread})
    const request=await foreign.prepareReview({profile:'alignment'})
    await foreign.bindReviewRun({reviewId:request.reviewId,nativeRun:{runId:'00000000-0000-4000-8000-000000000089',
      parentRunId:foreignThread,transcriptPath:join(f.root,'foreign-review.jsonl')}})
    const registry=join(f.options.stateRoot,f.server.project.project.metadata.id,`reviews-${foreignThread}.json`)
    const before=await readFile(registry,'utf8')
    const local=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId,
      observeReviewRun:()=>{observed++;return {available:true,recordedStatus:'failed'}}})
    const joined=(await local.prepareManualReviews({requestId:'human-foreign-recovery',profiles:['alignment']})).requests[0]
    assert.equal(joined.reviewId,request.reviewId)
    assert.equal(joined.dispatch,false)
    assert.equal(observed,0,'a different native conversation remains with its owner')
    assert.equal(await readFile(registry,'utf8'),before)
  }finally{await f.close()}
})
test('exact publication claim uses a historical checkpoint; stale output is retained without publication',async()=>{
  const f=await fixture()
  try {
    const reviews=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId,managedExecution:true})
    const first=await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'first'})
    const revision=await reviews.reviewRevision({checkpoint:first.commit})
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{goal:{prompt:'Goal',kind:'text',answer:'new'}}},eventId:'second'})
    const request=await reviews.claimManagedReview({profile:'alignment',ownerId:'owner',revision,exactPublication:true})
    assert.equal(request.revision.checkpoint,first.commit)
    assert.equal((await reviews.finishManagedReview({...identity(request),result:alignment})).status,'stale')
    const recorded=await reviews.readReview({reviewId:request.reviewId})
    assert.deepEqual(recorded.historicalResult,alignment)
    assert.deepEqual(await reviews.listAdvisories(),[])
    assert.equal(await reviews.claimManagedReview({profile:'alignment',ownerId:'another',revision,exactPublication:true}),null)
  }finally{await f.close()}
})
test('pending managed publications survive a fresh adapter without rerunning acquired work',async()=>{
  const f=await fixture()
  try {
    const options={project:f.server.project,stateRoot:f.options.stateRoot,threadId,managedExecution:true}
    const first=await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'queue-first'})
    const a=createCompanionReviews(options)
    const revision=await a.reviewRevision({checkpoint:first.commit})
    await a.publicationQueue(async queue=>{
      // Evidence comparisons can be asynchronous; persist only after reduction.
      await new Promise(resolve=>setImmediate(resolve))
      queue.configure({mode:'every-publication',autoMergeWindowMs:30000})
      queue.publish({checkpoint:first.commit,revision,context:'',exactPublication:true},Date.now())
    })
    const b=createCompanionReviews(options)
    const resumed=await b.publicationQueue(queue=>queue.take(Date.now(),true))
    assert.equal(resumed.checkpoint,first.commit)
    const c=createCompanionReviews(options)
    assert.equal(await c.publicationQueue(queue=>queue.take(Date.now(),true)),undefined)
    assert.equal(await c.publicationQueue(queue=>queue.publish(resumed,Date.now())),false)
  }finally{await f.close()}
})
test('async queue reductions retain the lock and do not persist rejected changes',async()=>{
  const f=await fixture()
  let release,pending,observer
  try {
    const options={project:f.server.project,stateRoot:f.options.stateRoot,threadId,managedExecution:true}
    const a=createCompanionReviews(options),b=createCompanionReviews(options)
    const saved=await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'async-queue'})
    const revision=await a.reviewRevision({checkpoint:saved.commit})
    const gate=new Promise(resolve=>{release=resolve})
    let entered
    const started=new Promise(resolve=>{entered=resolve})
    pending=a.publicationQueue(async(_queue,state)=>{
      state.agentPublications=[{checkpoint:saved.commit,revision,context:'',exactPublication:true}]
      entered()
      await gate
      return 'settled'
    })
    await started
    let observed=false
    observer=b.publicationQueue((_queue,state)=>{observed=true;return state.agentPublications.length})
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(observed,false,'a concurrent reduction cannot enter before the first settles')
    release()
    assert.equal(await pending,'settled')
    assert.equal(await observer,1)
    await assert.rejects(a.publicationQueue(async(_queue,state)=>{
      state.agentPublications=[]
      await new Promise(resolve=>setImmediate(resolve))
      throw new Error('reducer rejected')
    }),/reducer rejected/)
    assert.equal(await b.publicationQueue((_queue,state)=>state.agentPublications.length),1)
  }finally{
    release?.()
    await pending?.catch(()=>{})
    await observer?.catch(()=>{})
    await f.close()
  }
})
