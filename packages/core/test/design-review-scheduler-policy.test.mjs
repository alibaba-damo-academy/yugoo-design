import test from 'node:test'
import assert from 'node:assert/strict'
const { register } = await import('tsx/esm/api'); register()
const { DshAdvisoryScheduler } = await import('../src/dsh-advisory-plugin.ts')
const { OFFICIAL_GROUNDING_PROFILE } = await import('../src/official-advisory-profiles.ts')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const agent = { id: 'policy-test' }
const profile = OFFICIAL_GROUNDING_PROFILE
const publication = revision => ({ revision, records: [], snapshot: {
  design: {}, latestDesignChange: { journalRevision: revision, commit: `checkpoint-${revision}` },
} })

test('DSH continuous dispatch carries fresh bounded cycle IDs without file updates',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  const requests=[]
  const scheduler=new DshAdvisoryScheduler({design:{readDesignJournal:async()=>publication(1)},subagents:{},warn:message=>{throw new Error(message)}},{profiles:[profile]})
  scheduler.requestManualReviews=(_agent,revision,_profiles,id)=>requests.push({revision,id})
  try {
    await scheduler.configureReviews(agent,{mode:'continuous',autoMergeWindowMs:30000,continuousIntervalMs:60000})
    t.mock.timers.tick(60000)
    for(let i=0;i<10;i++)await Promise.resolve()
    t.mock.timers.tick(60000)
    for(let i=0;i<10;i++)await Promise.resolve()
    assert.deepEqual(requests.map(item=>item.revision),[1,1])
    assert.notEqual(requests[0].id,requests[1].id)
    assert.match(requests[0].id,/^periodic-/)
    await scheduler.configureReviews(agent,{mode:'off',autoMergeWindowMs:30000})
    t.mock.timers.tick(600000)
    assert.equal(requests.length,2)
  }finally{scheduler.dispose()}
})
function harness() {
  const calls = []
  const scheduler = new DshAdvisoryScheduler({ design: {}, subagents: {}, warn: message => { throw new Error(message) } }, { profiles: [profile] })
  scheduler.runProfile = async (_agent, _profile, revision, signal, onStarted, attemptId, onCompleted, journal) => {
    onStarted()
    calls.push({ revision, signal, attemptId, journal })
    await sleep(15)
    onCompleted()
  }
  return { scheduler, calls }
}
test('every-publication runs pinned FIFO without cancelling active reviewer', async () => {
  const { scheduler, calls } = harness()
  try {
    const policy = { mode: 'every-publication', autoMergeWindowMs: 30000 }
    scheduler.notifyPublication(agent, publication(1), policy)
    await sleep(5)
    scheduler.notifyPublication(agent, publication(2), policy)
    scheduler.notifyPublication(agent, publication(3), policy)
    scheduler.notifyPublication(agent, publication(3), policy)
    await sleep(90)
    assert.deepEqual(calls.map(call => call.revision), [1, 2, 3])
    assert.ok(calls.every(call => !call.signal.aborted))
    assert.ok(calls.every(call => call.journal.snapshot.latestDesignChange.journalRevision === call.revision))
  } finally { scheduler.dispose() }
})
test('auto coalesces pending publications using configured window', async () => {
  const { scheduler, calls } = harness()
  try {
    const policy = { mode: 'auto', autoMergeWindowMs: 20 }
    scheduler.notifyPublication(agent, publication(1), policy)
    scheduler.notifyPublication(agent, publication(2), policy)
    assert.equal(calls.length, 0)
    await sleep(60)
    assert.deepEqual(calls.map(call => call.revision), [2])
  } finally { scheduler.dispose() }
})
test('updating the merge window reschedules already pending work',async()=>{
  const {scheduler,calls}=harness()
  try {
    await scheduler.notifyPublication(agent,publication(1),{mode:'auto',autoMergeWindowMs:1000})
    await scheduler.configureReviews(agent,{mode:'auto',autoMergeWindowMs:0})
    await sleep(40)
    assert.deepEqual(calls.map(call=>call.revision),[1])
  }finally{scheduler.dispose()}
})
test('off removes queued automatic work but explicit human recheck bypasses mode and window', async () => {
  const { scheduler, calls } = harness()
  try {
    scheduler.notifyPublication(agent, publication(1), { mode: 'auto', autoMergeWindowMs: 1000 })
    scheduler.configureReviews(agent, { mode: 'off', autoMergeWindowMs: 1000 })
    assert.throws(() => scheduler.requestReviews(agent, 1, [profile]), /disabled by user/)
    scheduler.notifyPublication(agent, publication(2), { mode: 'off', autoMergeWindowMs: 1000 })
    await sleep(10)
    assert.equal(calls.length, 0)
    scheduler.requestManualReviews(agent, 2, [profile], 'human-request-1')
    await sleep(50)
    assert.deepEqual(calls.map(call => [call.revision, call.attemptId]), [[2, 'human-request-1']])
  } finally { scheduler.dispose() }
})
