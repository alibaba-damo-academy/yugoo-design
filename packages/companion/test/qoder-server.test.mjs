import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, appendFile, rename } from 'node:fs/promises'
import cp from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'

test('browser save receipt does not wait for derived knowledge acquisition and still admits maintenance',async()=>{
 const f=await fixture(),originalStatus=f.server.knowledge.status,originalNotify=f.server.knowledge.notify
 let statusReads=0,notifications=0,release
 const held=new Promise(resolve=>{release=resolve})
 f.server.knowledge.status=async()=>{statusReads++;await held;return originalStatus()}
 f.server.knowledge.notify=async()=>{notifications++}
 try {
  const result=await callCompanion(f.server.connectionPath,{method:'savePanel',params:{skill:'smart_questions',state:{questions:{}},eventId:'derived-does-not-gate-save',includeDerivedStatus:false}})
  assert.match(result.commit,/^[a-f0-9]{40}$/)
  assert.equal(result.derivedStatus,'pending')
  assert.equal(statusReads,0,'save acknowledgement does not acquire a derived database')
  await callCompanion(f.server.connectionPath,{method:'sendPrompt',params:{text:'continue after durable save'}})
  assert.equal(f.messages.length,1)
  assert.match(f.messages[0],/panel_save_context|git_diff/)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(notifications,1,'publication maintenance is retained')
 }finally{release();f.server.knowledge.status=originalStatus;f.server.knowledge.notify=originalNotify;await f.close()}
})

test('send validates repository once at its owning operation and still rejects a missing repository',async()=>{
 const f=await fixture(),original=cp.spawn
 const git=[]
 try {
  cp.spawn=function(command,args,...rest){if(command==='git')git.push(args);return original.call(this,command,args,...rest)}
  syncBuiltinESMExports()
  await callCompanion(f.server.connectionPath,{method:'sendPrompt',params:{text:'one authorized fixture message'}})
  assert.equal(git.filter(args=>args.includes('--show-toplevel')).length,1)
  assert.equal(git.filter(args=>args.includes('--verify')).length,1)
  assert.equal(f.messages.length,1)
  await rename(join(f.options.projectRoot,'.git'),join(f.options.projectRoot,'.git-held'))
  try {
   await assert.rejects(callCompanion(f.server.connectionPath,{method:'sendPrompt',params:{text:'must not deliver'}}))
   assert.equal(f.messages.length,1,'validation failure cannot reach the host')
  }finally{await rename(join(f.options.projectRoot,'.git-held'),join(f.options.projectRoot,'.git'))}
 }finally{cp.spawn=original;syncBuiltinESMExports();await f.close()}
})

for (const host of ['qoder', 'qwenwork']) test(`${host} HTTP bridge preserves native child binding and enforces separate background capability`, async () => {
  const f = await fixture()
  let server
  try {
    const nativeRoot = join(f.root, 'native'), folder = join(nativeRoot, threadId, 'subagents')
    await mkdir(folder, { recursive: true })
    const main = join(nativeRoot, `${threadId}.jsonl`)
    let sequence = 0
    const event = (agentId, content) => ({ type: 'assistant', sessionId: threadId, ...(agentId ? { agentId } : {}),
      uuid: `e-${++sequence}`, cwd: f.options.projectRoot, timestamp: new Date().toISOString(), message: { content } })
    await writeFile(main, JSON.stringify(event(undefined, [{ type: 'text', text: 'Main conversation' }])) + '\n')
    server = await startCompanion({ ...f.options, host, transcriptPath: main,
      connection: { host, threadId, send: async () => ({ accepted: false, status: 'held' }) } })
    const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
    const makeChild = async (runId, parentRunId = threadId) => {
      const transcriptPath = join(folder, `agent-${runId}.jsonl`), taskPath = join(folder, `task-${runId}.json`)
      const callId = `call-${runId}`
      await appendFile(parentRunId === threadId ? main : join(folder, `agent-${parentRunId}.jsonl`),
        JSON.stringify(event(parentRunId === threadId ? undefined : parentRunId, [{ type: 'tool_use', id: callId, name: 'Agent', input: {} }])) + '\n')
      await writeFile(transcriptPath, JSON.stringify(event(runId, [{ type: 'text', text: `${runId} public progress` }])) + '\n')
      const task = { sessionId: threadId, agentId: runId, parentToolUseId: callId, transcriptPath, status: 'running', updatedAt: Date.now() }
      await writeFile(taskPath, JSON.stringify(task))
      return { binding: { runId, parentRunId, transcriptPath, taskPath }, end: () => writeFile(taskPath, JSON.stringify({ ...task, status: 'completed', updatedAt: Date.now() })) }
    }
    assert.equal((await call('info')).host, host)
    assert.equal((await call('readWorkspace')).conversation.available, true)
    const producer = await makeChild('aProducer')
    await call('registerNativeRun', { runId: producer.binding.runId, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
    const worker = await makeChild('aWorker', 'aProducer')
    await call('registerNativeRun', { runId: worker.binding.runId, parentRunId: worker.binding.parentRunId, role: 'worker', skill: 'smart_questions', artifactId: 'sample', artifactFile: 'smart_questions/sample.md' })
    await assert.rejects(call('registerNativeRun', { ...worker.binding, taskPath: producer.binding.taskPath, runId: 'wrong', role: 'worker', skill: 'smart_questions', artifactId: 'wrong', artifactFile: 'smart_questions/wrong.md' }), /identity/)
    const log = await call('readExecutionLog', { runId: 'aWorker' })
    assert.ok(JSON.stringify(log).includes('public progress'))
    await worker.end()
    const saved = await call('savePanel', { skill: 'smart_questions', state: { questions: {} }, eventId: 'qoder-save' })
    assert.ok(saved.commit)
    assert.equal((await call('sendPrompt', { text: 'continue' })).status, 'held')
    await producer.end()
    assert.equal((await call('finishNativeRun', { runId: 'aProducer', scope: 'state', outcome: 'pause' })).accepted, true)
    if(host==='qwenwork') {
      const status=await call('readWorkspace')
      assert.equal(status.hostCapabilities.backgroundReviews,false)
      assert.equal(status.reviewDispatchOwner,'unavailable')
      assert.equal(status.reviews.length,4,'pending status remains readable')
      assert.ok(status.reviews.every(row=>row.dispatch===false && row.executionAvailability==='unavailable'))
      for(const method of ['prepareReview','prepareReviews','bindReviewRun','bindReviewRuns','recheckReviews'])
        await assert.rejects(call(method,{profile:'clarity'}),/background reviewer execution is not verified/)
      assert.equal((await call('readWorkspace')).reviews.some(row=>row.reviewId),false,'blocked dispatch creates no requests')
      return
    }
    const prepared = await call('prepareReview', { profile: 'alignment', userContext: 'keep scope small' })
    const reviewer = await makeChild('aReviewer')
    const bound = await call('bindReviewRun', { reviewId: prepared.reviewId, nativeRun: { runId: reviewer.binding.runId } })
    assert.deepEqual(bound.nativeRun, reviewer.binding, 'resolved task paths still pass the native parent/child verifier')
    assert.equal((await call('readWorkspace')).reviews.find(x => x.profile === 'alignment').status, 'running')
    await reviewer.end()
    assert.equal((await call('readWorkspace')).reviews.find(x => x.profile === 'alignment').status, 'unsubmitted')
    assert.equal((await call('submitReview', { reviewId: prepared.reviewId, nativeRun: reviewer.binding, result: { schemaVersion: 1, questions: [] } })).status, 'completed')
  } finally { await server?.close(); await f.close() }
})
