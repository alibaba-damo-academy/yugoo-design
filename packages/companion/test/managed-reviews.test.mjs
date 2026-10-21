import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fixture,threadId} from './fixture.mjs'
import {createCompanionReviews} from '../src/reviews.mjs'
import {reviewSnapshot,createManagedReviewScheduler} from '../src/managed-reviews.mjs'
import {callCompanion} from '../src/connection-file.mjs'
import {fork} from 'node:child_process'
const alignment={schemaVersion:1,questions:[]}
const api=(f,id=threadId)=>createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId:id,managedExecution:true})
const identity=r=>({reviewId:r.reviewId,ownerId:r.execution.ownerId,attemptId:r.execution.attemptId})
async function until(check){for(let i=0;i<300;i++){if(await check())return;await new Promise(r=>setTimeout(r,10))}throw new Error('Timed out')}

test('managed continuous cadence rechecks unchanged committed evidence with fresh requests',async t=>{
 const f=await fixture();let scheduler
 try {
  await callCompanion(f.server.connectionPath,{method:'updateReviewPolicy',params:{policy:{mode:'off',autoMergeWindowMs:30000}}})
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'periodic-source'})
  const reviews=api(f), calls=[], results=[{schemaVersion:1,inconsistencies:[]},{schemaVersion:1,researchNeeds:[]},alignment]
  let policy={mode:'continuous',autoMergeWindowMs:30000,continuousIntervalMs:60000}
  t.mock.timers.enable({apis:['setTimeout']})
  scheduler=createManagedReviewScheduler({reviews,project:f.server.project,getPolicy:async()=>policy,
   execute:async request=>{calls.push(request);return {result:results[(calls.length-1)%3]}},onError:error=>{throw error}})
  await scheduler.configure()
  const settle=async expected=>{
   const deadline=Date.now()+10000
   while(Date.now()<deadline){
    t.mock.timers.tick(0)
    await new Promise(resolve=>setImmediate(resolve))
    if(calls.length===expected && await reviews.publicationQueue((_q,state)=>!state.activePublication))return
   }
   throw new Error('Periodic reviews did not settle')
  }
  t.mock.timers.tick(60000);await settle(3)
  t.mock.timers.tick(60000);await settle(6)
  const rows=await reviews.readReviewStatus()
  assert.ok(rows.filter(row=>row.profile!=='clarity').every(row=>row.status==='completed'))
  policy={...policy,mode:'off'};await scheduler.configure()
  t.mock.timers.tick(600000)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(calls.length,6)
 }finally{await scheduler?.close();t.mock.timers.reset();await f.close()}
})

test('managed claim is project-wide, identity is separate, immediate output settles once',async()=>{
 const f=await fixture()
 try {
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'first'})
  const a=api(f),b=api(f,'00000000-0000-4000-8000-000000000088')
  const claimed=await Promise.all([a,b].map((x,i)=>x.claimManagedReview({profile:'alignment',ownerId:`owner-${i}`})))
  assert.equal(claimed.filter(Boolean).length,1)
  const request=claimed.find(Boolean),owner=claimed[0]?a:b
  assert.equal(request.nativeRun,undefined)
  await assert.rejects(owner.bindReviewRun({reviewId:request.reviewId,nativeRun:{}}),/background service/)
  await assert.rejects(owner.finishManagedReview({...identity(request),ownerId:'wrong',result:alignment}),/ownership/)
  assert.equal((await owner.finishManagedReview({...identity(request),result:alignment})).status,'completed')
  assert.equal((await b.readReviewStatus()).find(x=>x.profile==='alignment').status,'completed')
  assert.equal((await owner.finishManagedReview({...identity(request),result:alignment})).status,'completed')
  assert.equal(await b.claimManagedReview({profile:'alignment',ownerId:'third'}),null)
  const legacy=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId})
  await assert.rejects(legacy.prepareReview({profile:'alignment'}),/mixed review dispatch modes/)
  assert.equal(f.messages.length,0)
 }finally{await f.close()}
})

test('managed stale output is not published; expired owners are unknown, never stolen',async()=>{
 const f=await fixture()
 try {
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'first'})
  const a=api(f),r=await a.claimManagedReview({profile:'alignment',ownerId:'owner'})
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{goal:{prompt:'Goal',kind:'text',answer:'changed'}}},eventId:'second'})
  assert.equal((await a.finishManagedReview({...identity(r),result:alignment})).status,'stale')
  assert.deepEqual(await a.listAdvisories(),[])
  const next=await a.claimManagedReview({profile:'alignment',ownerId:'owner'})
  const file=join(f.options.stateRoot,f.server.project.project.metadata.id,'reviews-managed.json')
  const state=JSON.parse(await readFile(file,'utf8'))
  state.requests[next.reviewId].execution.expiresAt=0
  await writeFile(file,JSON.stringify(state))
  assert.equal(await a.claimManagedReview({profile:'alignment',ownerId:'replacement'}),null)
  assert.equal((await a.readReviewStatus()).find(x=>x.profile==='alignment').status,'unknown')
  await assert.rejects(a.finishManagedReview({...identity(next),result:alignment}),/already ended/)
 }finally{await f.close()}
})

test('snapshot uses committed bytes rather than live design edits',async()=>{
 const f=await fixture();let snapshot
 try {
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'first'})
  const w=await f.server.project.readWorkspace()
  const path='design_files/smart_questions/smart_questions.json'
  const original=await readFile(join(f.options.projectRoot,path),'utf8')
  await writeFile(join(f.options.projectRoot,path),'not published')
  snapshot=await reviewSnapshot(f.options.projectRoot,w.checkpoint)
  assert.equal(await readFile(join(snapshot.root,path),'utf8'),original)
 }finally{await snapshot?.close();await f.close()}
})

test('switching dispatch mode cannot silently strand or duplicate a native request',async()=>{
 const f=await fixture()
 try {
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'first'})
  const native=createCompanionReviews({project:f.server.project,stateRoot:f.options.stateRoot,threadId})
  await native.prepareReview({profile:'alignment'})
  const managed=api(f)
  assert.equal(await managed.claimManagedReview({profile:'alignment',ownerId:'new'}),null)
  const state=(await managed.readReviewStatus()).find(r=>r.profile==='alignment')
  assert.equal(state.status,'unavailable');assert.match(state.error,/other dispatch mode/)
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{goal:{prompt:'Goal',kind:'text',answer:'new'}}},eventId:'second'})
  assert.ok(await managed.claimManagedReview({profile:'alignment',ownerId:'new'}))
 }finally{await f.close()}
})

test('save dispatches without foreground tools; reads do not launch; close cancels own execution',async()=>{
 let started=0,aborted=false
 const f=await fixture({serverOptions:{backgroundReviews:true,reviewDebounceMs:0,reviewExecutor:async({signal})=>{
  started++
  await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason)},{once:true}))
 }}})
 const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
 try {
  await call('readWorkspace');await call('readWorkspace');assert.equal(started,0)
  const prepared=await call('prepareReviews');assert.equal(prepared.dispatchOwner,'companion');assert.deepEqual(prepared.requests,[])
  await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'first'})
  await until(()=>started===1)
  assert.equal((await call('readWorkspace')).reviewDispatchOwner,'companion')
  assert.equal(f.messages.length,0)
 }finally{await f.close()}
 assert.equal(aborted,true)
})

test('two OS processes atomically claim exactly one project review',async()=>{
 const f=await fixture(),children=[]
 try {
  await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'first'})
  const workspace=await f.server.project.readWorkspace()
  const options={managedExecution:true,stateRoot:f.options.stateRoot,workspace,project:{project:f.server.project.project,kit:{name:'web_app',version:'1.0',skills:[]}}}
  async function start(id) {
   const child=fork(new URL('./review-process.mjs',import.meta.url),[JSON.stringify({...options,threadId:id})],{silent:true})
   children.push(child)
   await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject)})
   return ()=>new Promise((resolve,reject)=>{
    child.once('message',m=>m.error?reject(new Error(m.error)):resolve(m.value))
    child.send({id:1,method:'claimManagedReview',params:{profile:'alignment',ownerId:id}})
   })
  }
  const a=await start(threadId),b=await start('00000000-0000-4000-8000-000000000088')
  assert.equal((await Promise.all([a(),b()])).filter(Boolean).length,1)
 }finally{for(const child of children)child.kill();await f.close()}
})

test('service collects independent profiles and publishes clarity without a native child',async()=>{
 let calls=0
 const results=[{schemaVersion:1,inconsistencies:[]},{schemaVersion:1,researchNeeds:[]},alignment,
  {summary:'评估',u:{score:60,evidence:'目标'},s:{score:30,evidence:'部分'},t:{score:10,evidence:'待补'}}]
 const f=await fixture({serverOptions:{backgroundReviews:true,reviewDebounceMs:0,reviewExecutor:async()=>({result:results[calls++]})}})
 const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
 try {
  await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'first'})
  await until(async()=> (await call('readWorkspace')).reviews.every(r=>r.status==='completed'))
  assert.equal(calls,4)
  assert.equal((await call('readWorkspace')).clarity.assessment.u,60)
  await call('savePanel',{skill:'smart_questions',state:{questions:{}},eventId:'first'})
  await new Promise(r=>setTimeout(r,30));assert.equal(calls,4)
  assert.equal(f.messages.length,0)
 }finally{await f.close()}
})
