import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {fixture,threadId} from './fixture.mjs'
import {createNativeRuns} from '../src/native-runs.mjs'
import {nativeInvocationId} from '../src/native-identity.mjs'

test('Qoder repeated local agent IDs have distinct real publication identities across sessions',async()=>{
  const f=await fixture()
  try{
    const runId='aProducer-repeat', project=f.server.project
    const otherSession='00000000-0000-4000-8000-000000000099'
    const ids=[]
    for(const sessionId of [threadId,otherSession]){
      const runs=await createNativeRuns({project,stateRoot:f.options.stateRoot,threadId:sessionId,host:'qoder',
        verifyChild:async()=>({available:true}),createObserver:()=>({read:async()=>({available:true,recordedStatus:'running',rows:[]})})})
      await runs.registerNativeRun({runId,parentRunId:sessionId,transcriptPath:join(f.root,'unused.jsonl'),taskPath:join(f.root,'unused-task.json'),role:'producer',skill:'smart_questions',artifactId:'smart_questions'})
      const invocation=runs.getBinding(runId).invocationId
      assert.equal(invocation,nativeInvocationId('qoder',sessionId,runId))
      assert.ok(invocation.length<=128)
      ids.push(invocation)
      await mkdir(join(f.options.projectRoot,'design_files/smart_questions'),{recursive:true})
      await writeFile(join(f.options.projectRoot,'design_files/smart_questions/smart_questions.json'),JSON.stringify({questions:{overview:{prompt:'产品目标？',kind:'text',answer:sessionId,detail:''}}}))
      const result=await runs.finishNativeRun({runId,scope:'state',outcome:'pause'})
      assert.equal(result.accepted,true,'different session can checkpoint different content')
      await runs.registerNativeRun({runId:'aWorker-child',parentRunId:runId,transcriptPath:join(f.root,'unused-worker.jsonl'),taskPath:join(f.root,'unused-worker-task.json'),role:'worker',skill:'smart_questions',artifactId:'attachment',artifactFile:'smart_questions/attachment.md'})
      assert.equal(runs.getBinding('aWorker-child').invocationId,invocation)
    }
    assert.notEqual(ids[0],ids[1])
    const codexRun='00000000-0000-4000-8000-000000000002'
    assert.equal(nativeInvocationId('codex',threadId,codexRun),codexRun)
  }finally{await f.close()}
})
