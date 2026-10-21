import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { createManagedReviewScheduler } from '../src/managed-reviews.mjs'
import { fixture } from './fixture.mjs'

async function until(check) {
  for (let i=0;i<200;i++) { if(check())return; await delay(10) }
  throw new Error('Timed out')
}

test('managed scheduler does not derive or dispatch reviews without a writable Kit, including a debounce transition', async () => {
  let writable=false, reads=0, claims=0
  const project={
    refreshAccess:async()=>({writable}),
    readWorkspace:async()=>{reads++;return {checkpoint:'a'.repeat(40)}},
    store:{designEvidenceRevisionAt:async()=> 'evidence'},
    get kit(){assert.equal(writable,true);return {name:'web_app',version:'1.0'}},
  }
  const scheduler=createManagedReviewScheduler({project,debounceMs:20,
    reviews:{claimManagedReview:async()=>{claims++;return null}},execute:async()=>assert.fail('must not execute')})
  try {
    await scheduler.notify(); assert.equal(reads,0)
    writable=true; await scheduler.notify(); writable=false
    await delay(60); assert.equal(claims,0)
    writable=true; await scheduler.notify()
    await until(()=>claims===4)
  } finally {await scheduler.close()}
})

test('managed scheduler retires an acquired claim when Kit becomes unavailable before execution', async () => {
  let writable=true
  const finished=[]
  const scheduler=createManagedReviewScheduler({debounceMs:0,
    project:{refreshAccess:async()=>({writable}),readWorkspace:async()=>({checkpoint:'a'.repeat(40)}),
      store:{designEvidenceRevisionAt:async()=> 'evidence'},kit:{name:'web_app',version:'1.0'}},
    reviews:{claimManagedReview:async()=>{writable=false;return {reviewId:'claim',execution:{attemptId:'attempt'}}},
      finishManagedReview:async result=>finished.push(result)},execute:async()=>assert.fail('must not execute')})
  try {
    await scheduler.notify(); await until(()=>finished.length===1)
    assert.equal(finished[0].status,'interrupted')
  } finally {await scheduler.close()}
})

test('managed result is never published after Kit access is lost while executor is running', async () => {
  const f=await fixture()
  let scheduler, writable=true, release, started=false
  const finished=[], errors=[]
  try {
    await f.server.project.savePanel({skill:'smart_questions',state:{questions:{}},eventId:'initial'})
    const workspace=await f.server.project.readWorkspace()
    const project={...f.server.project,refreshAccess:async()=>({writable})}
    scheduler=createManagedReviewScheduler({project,debounceMs:0,onError:e=>errors.push(e),
      reviews:{claimManagedReview:async()=>({reviewId:'claim',execution:{attemptId:'attempt'},revision:{checkpoint:workspace.checkpoint},prompt:'review',schema:{}}),
        finishManagedReview:async result=>finished.push(result)},
      execute:async()=>{started=true;return new Promise(resolve=>{release=()=>resolve({result:{ok:true}})})}})
    await scheduler.notify(); await until(()=>started)
    writable=false; release(); await until(()=>finished.length===1)
    assert.equal(finished[0].status,'interrupted')
    assert.equal(finished[0].result,undefined)
    assert.deepEqual(errors,[])
  } finally {release?.();await scheduler?.close();await f.close()}
})
