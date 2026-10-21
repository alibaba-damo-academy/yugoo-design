import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createNativeReviewScheduler } from '../src/native-review-scheduler.mjs'
import { DesignReviewPublicationQueue } from '../../core/lib/index.js'

test('continuous native notices create fresh cycles at the same checkpoint and do not overlap active requests', async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let current={mode:'continuous',autoMergeWindowMs:30000,continuousIntervalMs:60000}, busy=false
  const q=new DesignReviewPublicationQueue(current), cycles=[], messages=[]
  const scheduler=createNativeReviewScheduler({
    getPolicy:async()=>current,
    getConnectionPath:()=>'/test/connection.json',
    project:{project:{metadata:{name:'fixture'},designFilesRoot:'/test/design_files'},refreshAccess:async()=>({writable:true}),readWorkspace:async()=>({checkpoint:'same'})},
    connection:{send:async()=>{throw Error('Background notice must not use user-input transport')},sendEvent:async message=>{messages.push(message);return {accepted:true}}},
    reviews:{publicationQueue:async fn=>fn(q,{}),publishedRevision:async()=>({checkpoint:'same'}),readReviewStatus:async()=>busy?[{status:'running'}]:[],preparePublicationReviews:async target=>{cycles.push(target.cycleId);return {requests:[{reviewId:target.cycleId,dispatch:true}]}}},
    onError:error=>{throw error},
  })
  const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve()}
  try {
    await scheduler.configure()
    t.mock.timers.tick(60000);await flush()
    t.mock.timers.tick(60000);await flush()
    assert.equal(messages.length,2)
    assert.notEqual(cycles[0],cycles[1])
    assert.match(messages[0],/queued notice is not a running reviewer/)
    busy=true;t.mock.timers.tick(60000);await flush()
    assert.equal(messages.length,2)
    current={...current,mode:'off'};await scheduler.configure()
    t.mock.timers.tick(600000);await flush()
    assert.equal(messages.length,2)
  } finally {await scheduler.close()}
})
const policy = mode => ({ mode, autoMergeWindowMs: 1000 })
const state = answer => ({ questions: { goal: { prompt: 'Goal', kind: 'text', answer } } })
async function until(check) {
  for(let i=0;i<200;i++){ if(await check())return; await new Promise(resolve=>setTimeout(resolve,10)) }
  throw new Error('Timed out')
}
test('native auto coalesces publications into one background notice with committed evidence pins',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:policy('auto')})
    await call('savePanel',{skill:'smart_questions',state:state('first'),eventId:'native-auto-first'})
    const last=await call('savePanel',{skill:'smart_questions',state:state('second'),eventId:'native-auto-second'})
    await until(()=>f.messages.length===1)
    assert.match(f.messages[0],new RegExp(last.commit))
    assert.match(f.messages[0],/queued notice is not a running reviewer/)
    const workspace=await call('readWorkspace')
    for(const profile of ['grounding','reflection','alignment']) {
      const status=workspace.reviews.find(item=>item.profile===profile)
      assert.equal(status.status,'prepared')
      assert.equal(status.revisionChanged,false)
      const request=await call('readReview',{reviewId:status.reviewId})
      assert.equal(request.revision.checkpoint,last.commit)
      assert.match(request.prompt,/Read only Design Files committed at/)
    }
    await call('readWorkspace')
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(f.messages.length,1)
  }finally{await f.close()}
})
test('native every-publication retains both checkpoint notices and off prevents automatic delivery',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:policy('every-publication')})
    const a=await call('savePanel',{skill:'smart_questions',state:state('a'),eventId:'native-every-a'})
    const b=await call('savePanel',{skill:'smart_questions',state:state('b'),eventId:'native-every-b'})
    await until(()=>f.messages.length===2)
    assert.match(f.messages[0],new RegExp(a.commit))
    assert.match(f.messages[1],new RegExp(b.commit))
    await call('updateReviewPolicy',{policy:policy('off')})
    await call('savePanel',{skill:'smart_questions',state:state('c'),eventId:'native-off-c'})
    await new Promise(resolve=>setTimeout(resolve,150))
    assert.equal(f.messages.length,2)
  }finally{await f.close()}
})
test('native publication reviewers use library Git pins and retain historical evidence after HEAD advances',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:policy('every-publication')})
    const first=await call('savePanel',{skill:'smart_questions',state:state('historical answer'),eventId:'review-library-first'})
    await until(()=>f.messages.length===1)
    const refs=JSON.parse(f.messages[0].match(/Exact prepared review references: (\[[^\n]+\])\./)[1])
    const manual=await call('recheckReviews',{requestId:'review-library-manual',profiles:['alignment']})
    const latest=await call('savePanel',{skill:'smart_questions',state:state('newer answer'),eventId:'review-library-later'})
    await until(()=>f.messages.length===2)
    assert.notEqual(first.commit,latest.commit)
    const project=f.server.project.project.metadata.id
    for(const reviewId of [refs[0].reviewId,manual.requests[0].reviewId]) {
      const request=await call('readReview',{reviewId})
      assert.equal(request.revision.checkpoint,first.commit)
      assert.match(request.prompt,/Use design_git_read through the exact private Companion connection/)
      assert.ok(request.prompt.includes(`project=${JSON.stringify(project)} and checkpoint=${JSON.stringify(first.commit)}`))
      assert.match(request.prompt,/action=list and path="design_files"/)
      assert.match(request.prompt,/action=read/)
      assert.match(request.prompt,/action=diff/)
      assert.match(request.prompt,/page\.nextOffset as offset until page\.complete=true and page\.nextOffset=null/)
      assert.match(request.prompt,/Preserve project, checkpoint, path and any from pin/)
      assert.match(request.prompt,/Do not omit or replace the checkpoint/)
      assert.match(request.prompt,/report the concrete coverage limitation/)
      assert.match(request.prompt,/A historical publication is intentional/)
      assert.doesNotMatch(request.prompt,/git ls-tree|git show/)
    }
    const pins={project,checkpoint:first.commit}
    const list=await call('readGit',{...pins,action:'list',path:'design_files'})
    assert.equal(list.checkpoint,first.commit)
    assert.equal(list.page.complete,true)
    const path='design_files/smart_questions/smart_questions.json'
    assert.ok(list.entries.some(entry=>entry.path===path))
    const read=await call('readGit',{...pins,action:'read',path})
    assert.equal(read.checkpoint,first.commit)
    assert.equal(JSON.parse(read.text).questions.goal.answer,'historical answer')
    const diff=await call('readGit',{...pins,action:'diff'})
    assert.equal(diff.checkpoint,first.commit)
    assert.equal(diff.page.complete,true)
    assert.ok(diff.text.includes('historical answer'))
    assert.ok(!diff.text.includes('newer answer'))
    await assert.rejects(call('readGit',{...pins,action:'status'}),/historical checkpoint/)
    await assert.rejects(call('readGit',{...pins,project:'another-project',action:'list'}),/project pin/)
  }finally{await f.close()}
})
test('uncertain native delivery is not automatically resent or described as execution',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    f.failNotification('delivery outcome is unknown')
    await call('updateReviewPolicy',{policy:policy('every-publication')})
    await call('savePanel',{skill:'smart_questions',state:state('a'),eventId:'native-unknown-a'})
    await until(async()=>(await call('readWorkspace')).reviews.some(item=>item.status==='prepared'))
    await new Promise(resolve=>setTimeout(resolve,120))
    f.failNotification(false)
    await call('updateReviewPolicy',{policy:policy('every-publication')})
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.equal(f.messages.length,0)
    assert.equal((await call('readWorkspace')).reviews.some(item=>item.status==='running'),false)
  }finally{await f.close()}
})
test('publication fallback does not duplicate reviews already prepared by Agent initiative',async()=>{
  const f=await fixture()
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    await call('updateReviewPolicy',{policy:policy('auto')})
    await call('savePanel',{skill:'smart_questions',state:state('a'),eventId:'native-agent-first'})
    const prepared=await call('prepareReviews',{profiles:['grounding','reflection','alignment']})
    assert.ok(prepared.requests.every(item=>item.dispatch))
    await new Promise(resolve=>setTimeout(resolve,1300))
    assert.equal(f.messages.length,0)
    const status=await call('readWorkspace')
    assert.deepEqual(status.reviews.filter(item=>item.profile!=='clarity').map(item=>item.reviewId),prepared.requests.map(item=>item.reviewId))
  }finally{await f.close()}
})
