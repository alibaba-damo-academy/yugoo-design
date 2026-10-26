import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture, threadId } from './fixture.mjs'
import { callCompanion } from '../src/connection-file.mjs'
import { createNativeRuns } from '../src/native-runs.mjs'

const producer = '00000000-0000-4000-8000-000000000002'
const worker = '00000000-0000-4000-8000-000000000003'
const event = type => JSON.stringify({ type: 'event_msg', timestamp: '2026-09-09T08:00:00Z', payload: { type } }) + '\n'

async function producerBarrierFixture(t) {
  const f = await fixture(); t.after(() => f.close())
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  const log = async (id, parent) => {
    const path = join(f.root, `barrier-${id}.jsonl`)
    await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id, cwd: f.options.nativeCwd,
      source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } }) + '\n' + event('task_started'))
    return path
  }
  const producerPath = await log(producer, threadId)
  await call('registerNativeRun', { role: 'producer', runId: producer, parentRunId: threadId, transcriptPath: producerPath,
    skill: 'research', artifactId: 'research' })
  const directory = join(f.options.projectRoot, 'design_files/research/R-001')
  await mkdir(directory, { recursive: true })
  await writeFile(join(f.options.projectRoot, 'design_files/research/research.json'), JSON.stringify({
    rounds: { 'R-001': { round_id: 'R-001', stage: 'identified', topic: 'Producer barrier fixture',
      directions: { 'D-001': { direction_id: 'D-001', title: 'Evidence', research_points: ['Read primary source'] } }, direction_order: ['D-001'] } },
    round_order: ['R-001'], current_round_id: 'R-001',
  }))
  return { f, call, log, producerPath, directory }
}

for (const mode of ['active', 'unobservable']) test(`Producer settlement rejects a ${mode} Worker even after its file receipt`, async t => {
  const { f, call, log, directory } = await producerBarrierFixture(t)
  const workerPath = await log(worker, producer)
  const target = { role: 'worker', runId: worker, parentRunId: producer, transcriptPath: workerPath,
    skill: 'research', artifactId: 'D-001', artifactFile: 'research/R-001/D-001.md' }
  await call('registerNativeRun', target)
  await writeFile(join(directory, 'D-001.md'), '# Synthetic evidence\n')
  assert.ok((await call('finishNativeRun', { runId: worker })).receipt)
  if (mode === 'unobservable') await writeFile(workerPath, '{broken\n')
  const before = await f.server.project.store.head()
  await assert.rejects(call('finishNativeRun', { runId: producer, scope: 'state', outcome: 'pause' }), /active or unobservable Worker/)
  assert.equal(await f.server.project.store.head(), before, 'blocked settlement must not create a Git publication')
  if (mode === 'active') {
    await assert.rejects(call('finishNativeRun', { runId: producer, outcome: 'cancelled' }), /active or unobservable Worker/)
    assert.equal(await f.server.project.store.head(), before)
    await appendFile(workerPath, event('task_complete'))
    const published = await call('finishNativeRun', { runId: producer, scope: 'state', outcome: 'pause' })
    assert.equal(published.accepted, true)
    const committed = await f.server.project.store.head()
    assert.equal((await call('registerNativeRun', target)).registered, true, 'exact existing Worker retry is not new admission')
    const retried = await call('finishNativeRun', { runId: producer, scope: 'state', outcome: 'pause' })
    assert.equal(retried.accepted, true)
    assert.deepEqual(retried.settlement, published.settlement, 'the durable settlement is idempotent; live service status may change')
    assert.equal(await f.server.project.store.head(), committed, 'exact finish retry must not create another publication')
  }
})

for (const terminal of ['task_failed', 'turn_aborted']) test(`Producer can settle after its Worker records ${terminal}`, async t => {
  const { call, log, directory } = await producerBarrierFixture(t)
  const workerPath = await log(worker, producer)
  await call('registerNativeRun', { role: 'worker', runId: worker, parentRunId: producer, transcriptPath: workerPath,
    skill: 'research', artifactId: 'D-001', artifactFile: 'research/R-001/D-001.md' })
  await writeFile(join(directory, 'D-001.md'), '# Producer-reviewed bounded fixture evidence\n')
  await appendFile(workerPath, event(terminal))
  assert.equal((await call('finishNativeRun', { runId: producer, scope: 'state', outcome: 'pause' })).accepted, true)
})

for (const resumed of [false, true]) test(`a settled Producer cannot admit a new Worker${resumed ? ' after native resume' : ' after native completion'}`, async t => {
  const { f, call, log, producerPath } = await producerBarrierFixture(t)
  await call('finishNativeRun', { runId: producer, scope: 'state', outcome: 'pause' })
  await appendFile(producerPath, event('task_complete'))
  if (resumed) await appendFile(producerPath, event('task_started'))
  const workerPath = await log(worker, producer), before = await f.server.project.store.head()
  await assert.rejects(call('registerNativeRun', { role: 'worker', runId: worker, parentRunId: producer, transcriptPath: workerPath,
    skill: 'research', artifactId: 'D-002', artifactFile: 'research/R-001/D-002.md' }), /active Bundle Producer|finished Producer/)
  assert.equal(await f.server.project.store.head(), before)
  assert.equal((await call('readWorkspace')).executionAttempts.length, 1, 'rejection must not persist a Worker binding')
})

test('native child binding follows real events and individual files, not a finish tool or another round', async () => {
  const f = await fixture()
  const call = (method, params) => callCompanion(f.server.connectionPath, { method, params })
  try {
    async function log(id, parent) {
      const path = join(f.root, `${id}.jsonl`)
      await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id, cwd: f.options.projectRoot,
        source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } }) + '\n' + event('task_started'))
      return path
    }
    const producerPath = await log(producer, threadId), workerPath = await log(worker, producer)
    const p = { role: 'producer', runId: producer, parentRunId: threadId, transcriptPath: producerPath, skill: 'research', artifactId: 'research' }
    await call('registerNativeRun', p)
    await call('registerNativeRun', p)
    const w = { role: 'worker', runId: worker, parentRunId: producer, transcriptPath: workerPath, skill: 'research', artifactId: 'D-001', artifactFile: 'research/R-002/D-001.md' }
    await assert.rejects(call('registerNativeRun', { ...w, parentRunId: threadId }), /Unknown native run/)
    await call('registerNativeRun', w)
    for (const [runId, path] of [[producer, producerPath], [worker, workerPath]]) {
      await appendFile(path, JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: {
        type: 'CommandExecution', id: 'read', status: 'failed',
        parsed_cmd: [{ type: 'read', path: '/source/design.json', cmd: 'private command' }], stdout: 'private output',
      } } }) + '\n')
      const result = await call('readExecutionLog', { runId })
      assert.equal(result.entries.at(-1).message, '读取文件：design.json · 失败')
      assert.ok(!JSON.stringify(result).includes('private'))
    }
    await assert.rejects(call('registerNativeRun', { ...w, artifactFile: 'research/R-003/D-001.md' }), /rebound/)
    let workspace = await call('readWorkspace')
    assert.equal(workspace.executionAttempts.length, 2)
    assert.equal(workspace.executionAttempts[1].phase, 'working')
    assert.equal(workspace.executionAttempts[1].artifactFile, 'research/R-002/D-001.md')
    assert.equal(workspace.executionAttempts[1].invocationId, producer)
    await mkdir(join(f.options.projectRoot, 'design_files/research/R-002'), { recursive: true })
    await writeFile(join(f.options.projectRoot, 'design_files', w.artifactFile), '# Direction\n')
    await call('finishNativeRun', { runId: worker })
    assert.equal((await call('readWorkspace')).executionAttempts[1].phase, 'working', 'file receipt does not stop a native run')
    await appendFile(workerPath, event('task_complete'))
    workspace = await call('readWorkspace')
    assert.equal(workspace.executionAttempts[1].phase, 'completed')
    assert.equal(workspace.executionAttempts[0].phase, 'working', 'worker completion never completes producer')
    const reloaded = await createNativeRuns({ project: f.server.project, stateRoot: f.options.stateRoot, threadId })
    assert.equal((await reloaded.read()).executionAttempts[1].phase, 'completed')
    await writeFile(workerPath, '{broken\n')
    workspace = await call('readWorkspace')
    assert.notEqual(workspace.executionAttempts[1].phase, 'completed')
    assert.equal((await call('readExecutionLog', { runId: worker })).found, false)
    assert.equal(f.messages.length, 0, 'polling and native binding must never enqueue foreground work')
  } finally { await f.close() }
})

test('Research main retains user_continue and direct Worker publication barrier', async () => {
  const f=await fixture({researchMode:'main'})
  const call=(method,params={})=>callCompanion(f.server.connectionPath,{method,params})
  try {
    assert.equal((await call('prepareBundle',{skill:'research'})).execution.mode,'main')
    const main=await call('beginMainBundle',{skill:'research'})
    const transcriptPath=join(f.root,'research-main-worker.jsonl')
    await writeFile(transcriptPath,JSON.stringify({type:'session_meta',payload:{id:worker,cwd:f.options.projectRoot,
      source:{subagent:{thread_spawn:{parent_thread_id:threadId}}}}})+'\n'+event('task_started'))
    await call('registerNativeRun',{runId:worker,parentRunId:threadId,transcriptPath,role:'worker',skill:'research',
      artifactId:'D-001',artifactFile:'research/R-001/D-001.md',invocationId:main.invocationId})
    const state={rounds:{'R-001':{round_id:'R-001',stage:'identified',topic:'Research evidence',
      directions:{'D-001':{direction_id:'D-001',title:'Literature',research_points:['Find primary evidence']}},direction_order:['D-001']}},
      round_order:['R-001'],current_round_id:'R-001'}
    await mkdir(join(f.options.projectRoot,'design_files/research/R-001'),{recursive:true})
    await writeFile(join(f.options.projectRoot,'design_files/research/research.json'),JSON.stringify(state))
    await writeFile(join(f.options.projectRoot,'design_files/research/R-001/D-001.md'),'# Evidence')
    await assert.rejects(call('finishMainBundle',{invocationId:main.invocationId,scope:'state',outcome:'pause'}),/active or unobservable Worker/)
    await appendFile(transcriptPath,event('task_complete'))
    await call('finishMainBundle',{invocationId:main.invocationId,scope:'state',outcome:'pause'})
    const workspace=await call('readWorkspace')
    assert.equal(workspace.executionAttempts.length,1)
    assert.equal(workspace.executionAttempts[0].role,'worker')
    assert.ok(workspace.continuations.some(gate=>gate.skill==='research'))
  } finally {await f.close()}
})

test('main Bundle owns a separate invocation, direct Workers retain native identity and publication barrier', async () => {
  const f = await fixture()
  try {
    const project = { ...f.server.project, kit: { ...f.server.project.kit,
      skills: f.server.project.kit.skills.map(skill => skill.name === 'smart_questions'
        ? { ...skill, execution: { ...skill.execution, mode: 'main' } } : skill) } }
    const open = () => createNativeRuns({ project, stateRoot: f.options.stateRoot, threadId })
    const runs = await open()
    await assert.rejects(runs.beginMainBundle({ skill: 'research' }), /requires a native Producer/)
    const invocation = await runs.beginMainBundle({ skill: 'smart_questions' })
    assert.notEqual(invocation.invocationId, threadId)
    assert.equal(invocation.runId, undefined)
    assert.equal(invocation.mode, 'main')
    assert.equal(invocation.kit, project.kit.name)
    assert.equal(invocation.kitVersion, project.kit.version)
    assert.equal(invocation.bundleVersion, project.kit.skills.find(skill => skill.name === 'smart_questions').version)
    assert.deepEqual(await runs.beginMainBundle({ skill: 'smart_questions' }), invocation, 'recover same active invocation')
    const status = await runs.read()
    assert.equal(status.executionAttempts.length, 0, 'no phantom Producer row or log')
    assert.equal(status.activeMainBundles[0].skill, 'smart_questions')
    await assert.rejects(runs.registerNativeRun({ runId: producer, parentRunId: threadId, role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' }), /main conversation/)
    const transcriptPath = join(f.root, 'main-worker.jsonl')
    await writeFile(transcriptPath, JSON.stringify({ type: 'session_meta', payload: { id: worker, cwd: f.options.projectRoot,
      source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n' + event('task_started'))
    const assignment = { runId: worker, parentRunId: threadId, transcriptPath, role: 'worker', skill: 'smart_questions',
      artifactId: 'attachment', artifactFile: 'smart_questions/attachment.md', invocationId: invocation.invocationId }
    await assert.rejects(runs.registerNativeRun({ ...assignment, invocationId: producer }), /Unknown main/)
    await assert.rejects(runs.registerNativeRun({ ...assignment, skill: 'research', artifactFile: 'research/attachment.md' }), /exact active main/)
    await runs.registerNativeRun(assignment)
    await mkdir(join(f.options.projectRoot, 'design_files/smart_questions'), { recursive: true })
    await writeFile(join(f.options.projectRoot, 'design_files/smart_questions/attachment.md'), '# Evidence')
    await writeFile(join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json'), JSON.stringify({ questions: { goal: { prompt: '产品目标？', kind: 'text', answer: '', detail: '' } } }))
    await assert.rejects(runs.finishMainBundle({ invocationId: invocation.invocationId, scope: 'state' }), /active or unobservable Worker/)
    await appendFile(transcriptPath, event('task_complete'))
    const reloaded = await open()
    assert.equal((await reloaded.read()).executionAttempts[0].phase, 'completed')
    assert.equal(reloaded.getBinding(worker).invocationId, invocation.invocationId)
    const result = await reloaded.finishMainBundle({ invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' })
    assert.equal(result.accepted, true)
    assert.equal((await reloaded.read()).activeMainBundles.length, 0)
    assert.equal((await reloaded.read()).executionAttempts.length, 1, 'only the real Worker remains')
    assert.deepEqual(await reloaded.finishMainBundle({ invocationId: invocation.invocationId, scope: 'state', outcome: 'pause' }), result)
    await assert.rejects(reloaded.finishMainBundle({ invocationId: invocation.invocationId }), /another outcome/)
    await assert.rejects(reloaded.registerNativeRun(assignment), /exact active main/)
    const next = await reloaded.beginMainBundle({ skill: 'smart_questions' })
    assert.ok(next.executionSequence > invocation.executionSequence, 'reopening retains monotonic execution order')
    assert.notEqual(next.invocationId, invocation.invocationId, 'another Bundle call does not reuse the main thread as an invocation')
    await reloaded.finishMainBundle({ invocationId: next.invocationId, outcome: 'cancelled' })
    assert.equal((await reloaded.read()).executionAttempts.length, 1)
  } finally { await f.close() }
})

test('execution mode changes apply only after the active invocation settles', async () => {
  const f = await fixture()
  try {
    const mainMode = { ...f.server.project, kit: { ...f.server.project.kit,
      skills: f.server.project.kit.skills.map(skill => skill.name === 'smart_questions'
        ? { ...skill, execution: { ...skill.execution, mode: 'main' } } : skill) } }
    const open = (project = mainMode) => createNativeRuns({ project, stateRoot: f.options.stateRoot, threadId })
    const transcriptFor = async id => {
      const path = join(f.root, `${id}.jsonl`)
      await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id, cwd: f.options.projectRoot,
        source: { subagent: { thread_spawn: { parent_thread_id: threadId } } } } }) + '\n' + event('task_started'))
      return path
    }
    // Cross-Bundle parallelism: an active Producer of another Bundle never blocks
    // a main-conversation Bundle with its own canonical artifact.
    const runs = await open()
    await runs.registerNativeRun({ runId: producer, parentRunId: threadId, transcriptPath: await transcriptFor(producer),
      role: 'producer', skill: 'function_modules', artifactId: 'function_modules' })
    const invocation = await runs.beginMainBundle({ skill: 'smart_questions' })
    assert.equal(invocation.mode, 'main')
    assert.equal((await runs.read()).executionAttempts.length, 1, 'the active Producer stays visible while another Bundle runs in main')
    await runs.finishMainBundle({ invocationId: invocation.invocationId, outcome: 'cancelled' })
    // Direction 1: a same-Bundle Producer registered under the old subagent
    // placement keeps canonical ownership across an execution-mode change.
    const subagent = await open(f.server.project)
    await subagent.registerNativeRun({ runId: worker, parentRunId: threadId, transcriptPath: await transcriptFor(worker),
      role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' })
    await assert.rejects((await open()).beginMainBundle({ skill: 'smart_questions' }), /active native Producer/)
    // Direction 2: once the main invocation is active, the same Bundle cannot
    // register a Producer even through a subagent-mode Kit view.
    await subagent.finishNativeRun({ runId: worker, scope: 'completion', outcome: 'cancelled' })
    const resumed = await (await open()).beginMainBundle({ skill: 'smart_questions' })
    assert.ok(resumed.executionSequence > subagent.getBinding(worker).executionSequence, 'main/Producer order is shared and durable')
    assert.notEqual(resumed.invocationId, invocation.invocationId, 'a settled main invocation never resumes after a mode change')
    await assert.rejects((await open(f.server.project)).registerNativeRun({ runId: '00000000-0000-4000-8000-000000000004',
      parentRunId: threadId, transcriptPath: await transcriptFor('00000000-0000-4000-8000-000000000004'),
      role: 'producer', skill: 'smart_questions', artifactId: 'smart_questions' }), /active main Bundle/)
  } finally { await f.close() }
})
