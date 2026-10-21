import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const {register}=await import('tsx/esm/api');register()
const {default:DesignService}=await import('../src/design-service.ts')
const {DesignJournalStorage}=await import('../src/design-journal-storage.ts')
const {DshAdvisoryScheduler}=await import('../src/dsh-advisory-plugin.ts')
const {OFFICIAL_GROUNDING_PROFILE:profile}=await import('../src/official-advisory-profiles.ts')
const agent={id:'durable-owner'}
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'dsh-review-queue-'))
  const storage=new DesignJournalStorage(root)
  await storage.append(agent.id,{type:'design/kit-selected',data:{kit:'web_app',version:'1.0',operation:'activate'}})
  const first=await storage.append(agent.id,{type:'design/changed',data:{kit:'web_app',version:'1.0',skill:'research',origin:'agent',state:{reports:{one:'authoritative'}},commit:'a'.repeat(40)}})
  const second=await storage.append(agent.id,{type:'design/changed',data:{kit:'web_app',version:'1.0',skill:'research',origin:'agent',state:{reports:{two:'new'}},commit:'b'.repeat(40)}})
  const receiver=()=>({withJournal:async(_agent,operation)=>operation(root,agent.id,{projectId:'project-1'}),
    assertProjectSelection:()=>{},journals:{read:(_root,conversation)=>storage.read(conversation)}})
  const call=(service,operation)=>DesignService.prototype.reviewPublicationQueue.call(service,agent,profile,operation)
  return {root,first,second,receiver,call,close:()=>rm(root,{recursive:true,force:true})}
}
test('persisted DSH queue stores references and restores exact historical folds, not latest facts',async()=>{
  const f=await fixture()
  try {
    await f.call(f.receiver(),queue=>{
      queue.configure({mode:'every-publication',autoMergeWindowMs:30000})
      queue.publish({checkpoint:'a'.repeat(40),journal:f.first},0)
      queue.publish({checkpoint:'b'.repeat(40),journal:f.second},0)
    })
    const file=(await readdir(f.root)).find(name=>name.startsWith('gra-queue-'))
    const persisted=JSON.parse(await readFile(join(f.root,file),'utf8'))
    assert.ok(persisted.pending.every(entry=>entry.target.journal===undefined))
    const first=await f.call(f.receiver(),queue=>queue.take(0))
    assert.equal(first.journal.snapshot.latestDesignChange.commit,'a'.repeat(40))
    assert.deepEqual(first.journal.snapshot.design.research.state,{reports:{one:'authoritative'}})
    const second=await f.call(f.receiver(),queue=>queue.take(0))
    assert.equal(second.checkpoint,'b'.repeat(40))
    assert.equal(await f.call(f.receiver(),queue=>queue.publish(first,0)),false)
    await assert.rejects(f.call(f.receiver(),queue=>queue.publish({checkpoint:'foreign',journal:f.first},0)),/must match/)
  }finally{await f.close()}
})
test('new scheduler resumes only durable pending work after disposal',async()=>{
  const f=await fixture()
  let first,second
  try {
    const calls=[]
    const ports={design:{reviewPublicationQueue:(_agent,_profile,operation)=>f.call(f.receiver(),operation)},subagents:{},warn:message=>assert.fail(message)}
    first=new DshAdvisoryScheduler(ports,{profiles:[profile]})
    await first.notifyPublication(agent,f.first,{mode:'auto',autoMergeWindowMs:30})
    first.dispose()
    second=new DshAdvisoryScheduler(ports,{profiles:[profile]})
    second.runProfile=async(_agent,_profile,revision,_signal,onStarted)=>{onStarted();calls.push(revision)}
    await second.resumePending(agent,{mode:'auto',autoMergeWindowMs:30})
    await new Promise(resolve=>setTimeout(resolve,100))
    assert.deepEqual(calls,[f.first.revision])
    await second.resumePending(agent,{mode:'auto',autoMergeWindowMs:30})
    await new Promise(resolve=>setTimeout(resolve,30))
    assert.equal(calls.length,1)
  }finally{first?.dispose();second?.dispose();await f.close()}
})
