import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { projectDesignExecutionProvenance, renderDesignExecutionProvenance } from '../src/dsh-execution-provenance.ts'
import { renderResult, apply } from '../src/dsh-run-design-skill-tool.ts'
import { createDshDesignDelegation } from '../src/dsh-producer-delegation.ts'
import { createDesignArtifactAttemptRegistry } from '../src/artifact-attempt-registry.ts'

const path = 'page_design/a.html'
const content = Buffer.from('<html>Worker output</html>')
const pin = { projectId: 'project', invocationId: 'invocation', kitName: 'kit', kitVersion: '1.0',
  skillName: 'page_design', bundleVersion: '1.0', stateRevision: 'a'.repeat(40) }
const receipt = { path, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length }
const base = { projectId: pin.projectId, invocationId: pin.invocationId, rootCallId: 'root', skill: pin.skillName }
const producer = { ...base, attemptId: 'producer-attempt', artifactId: pin.skillName,
  parentRunId: 'parent', runId: 'producer', role: 'producer', phase: 'completed' }
const worker = { ...base, attemptId: 'worker-attempt', artifactId: 'a', artifactFile: path,
  parentRunId: 'producer', runId: 'worker', role: 'worker' }
function fixture() {
  const reads = []
  const blobs = new Map([[path, content], [`${pin.skillName}/${pin.skillName}.json`,
    Buffer.from(JSON.stringify({ pages: [{ artifact_file: path }] }))]])
  const request = {
    pin, rootCallId: 'root', parentSessionId: 'parent', mode: 'subagent',
    observations: [producer, { ...worker, phase: 'queued', runId: undefined },
      { ...worker, phase: 'working' }, { ...worker, phase: 'completed', receipt }],
    publicationAccepted: true, signal: new AbortController().signal,
    limits: { maxFileCount: 4, maxFileBytes: 4096, maxTotalBytes: 8192 },
    files: {
      async readPublishedExecutionAt(commit) {
        assert.equal(commit, pin.stateRevision)
        return { invocationId: pin.invocationId, skill: pin.skillName, bundleVersion: pin.bundleVersion, outcome: 'complete' }
      },
      async readBytesAt(commit, file, _signal, maxBytes) {
        assert.equal(commit, pin.stateRevision)
        reads.push({ commit, file, maxBytes })
        const bytes = blobs.get(file)
        if (bytes !== undefined && bytes.length > maxBytes) throw new Error('read limit exceeded')
        return bytes
      },
    },
  }
  return { request, reads, blobs }
}

test('Host receipt requires the actual child lifecycle and matching accepted bytes/references', async () => {
  const { request, reads } = fixture()
  const result = await projectDesignExecutionProvenance(request)
  assert.deepEqual(result.integratedWorkerReceipts, [{ attemptId: worker.attemptId, runId: worker.runId,
    parentRunId: worker.parentRunId, artifactId: worker.artifactId, ...receipt }])
  assert.deepEqual(result.producerRunIds, ['producer'])
  assert.equal(result.workerAttempts.length, 1)
  assert.equal(reads.length, 2)
  assert.match(renderDesignExecutionProvenance(result), /Verified integrated Worker completion receipts: 1/)
  request.observations.at(-1).receipt = { ...receipt, sha256: 'b'.repeat(64) }
  assert.equal(result.integratedWorkerReceipts[0].sha256, receipt.sha256)
  assert(Object.isFrozen(result.integratedWorkerReceipts[0]))
})

for (const field of ['projectId', 'invocationId', 'rootCallId', 'skill']) test(`wrong ${field} cannot borrow an old successful receipt`, async () => {
  const { request, reads } = fixture()
  request.observations = request.observations.map(row => ({ ...row, [field]: 'another' }))
  const result = await projectDesignExecutionProvenance(request)
  assert.equal(result.integratedWorkerReceipts.length, 0)
  assert.equal(result.workerAttempts.length, 0)
  assert.equal(reads.length, 0)
  assert.match(result.diagnostics[0], /missing\/truncated/)
})

for (const change of [
  rows => rows.filter(row => row.phase !== 'working'),
  rows => rows.map(row => row.role === 'worker' ? { ...row, parentRunId: 'another-producer' } : row),
  rows => rows.map(row => row.phase === 'working' ? { ...row, runId: 'another-worker' } : row),
  rows => rows.map(row => row.phase === 'completed' && row.role === 'worker' ? { ...row, receipt: { ...receipt, path: 'page_design/page_design.json' } } : row),
  rows => rows.map(row => row.phase === 'completed' && row.role === 'worker' ? { ...row, receipt: { ...receipt, bytes: 0 } } : row),
  rows => [...rows, { ...worker, attemptId: 'retry', phase: 'failed', runId: 'retry-run' }],
  rows => [...rows, { ...worker, phase: 'cancelled' }],
]) test('missing, conflicting, canonical or superseded Worker evidence is not certified', async () => {
  const { request } = fixture()
  request.observations = change(request.observations)
  assert.equal((await projectDesignExecutionProvenance(request)).integratedWorkerReceipts.length, 0)
})

for (const change of [
  f => f.blobs.set(path, Buffer.from('Producer replacement')),
  f => f.blobs.delete(path),
  f => f.blobs.set(`${pin.skillName}/${pin.skillName}.json`, Buffer.from(JSON.stringify({ note: `prefix:${path}` }))),
  f => { f.request.files.readPublishedExecutionAt = async () => ({ invocationId: 'old', skill: pin.skillName, bundleVersion: pin.bundleVersion }) },
  f => { f.request.files.readPublishedExecutionAt = async () => ({ invocationId: pin.invocationId, skill: pin.skillName, bundleVersion: '2.0' }) },
  f => { f.request.files.readPublishedExecutionAt = async () => undefined },
  f => { f.request.pin = { ...pin, stateRevision: 'HEAD' } },
  f => { f.request.publicationAccepted = false },
  f => { f.request.limits.maxFileCount = 1 },
  f => { f.request.limits.maxTotalBytes = 1 },
  f => { const abort = new AbortController(); abort.abort(); f.request.signal = abort.signal },
]) test('only the accepted pinned publication within read budgets can certify integration', async () => {
  const f = fixture()
  change(f)
  const result = await projectDesignExecutionProvenance(f.request)
  assert.equal(result.integratedWorkerReceipts.length, 0)
  assert(result.diagnostics.length > 0)
})

test('main-mode Workers bind directly to their actual main Agent, not a fabricated Producer', async () => {
  const { request } = fixture()
  request.mode = 'main'
  request.observations = request.observations.filter(row => row.role === 'worker').map(row => ({ ...row, parentRunId: 'parent' }))
  const result = await projectDesignExecutionProvenance(request)
  assert.equal(result.integratedWorkerReceipts.length, 1)
  assert.deepEqual(result.producerRunIds, [])
})

test('canonical pre-admission rejection remains a real error and never becomes a Worker success', async () => {
  const tools = new Map(), observations = []
  let starts = 0
  const delegation = createDshDesignDelegation({
    skillName: 'page_design', provider: 'spawn', maxDepth: 3,
    startSubagent: async () => { starts++; throw new Error('must not start') },
    workspace: {}, attempts: createDesignArtifactAttemptRegistry(), recordAttempt: row => observations.push(row),
  })
  delegation.install({ tools: { register: tool => tools.set(tool.name, tool) } })
  await assert.rejects(tools.get('design_delegate').execute({ artifact_kind: 'json', artifact_id: 'a',
    artifact_file: 'page_design/page_design.json', prompt: 'delegate canonical state' },
  { agent: { session: { id: 'producer' } }, signal: new AbortController().signal }), /outside Bundle/)
  assert.equal(starts, 0)
  assert.equal(observations.length, 0)
  const { request } = fixture()
  request.observations = [producer]
  const execution = await projectDesignExecutionProvenance(request)
  const text = renderResult({ kind: 'completed', summary: 'Bundle published.', projectRoot: '/isolated',
    stateRevision: pin.stateRevision, execution, clarity: { status: 'updated',
      summary: 'Worker-delegation step added and Worker succeeded.',
      u: { score: 1, evidence: 'user intent' }, s: { score: 1, evidence: 'structure' }, t: { score: 1, evidence: 'testability' } } })
  assert.match(text, /Derived design assessment \(not execution evidence\)/)
  assert.match(text, /Assessment text: "Worker-delegation step added/)
  assert.match(text, /No verified integrated Worker completion receipt/)
  assert.match(text, /Do not repeat execution or delegation claims from the design assessment/)
  assert.doesNotMatch(text, /Verified integrated Worker completion receipts: [1-9]/)
})

for (const result of [
  { kind: 'completed', projectRoot: '/isolated', stateRevision: pin.stateRevision, clarity: { status: 'failed', summary: 'timeout' } },
  { kind: 'completed', projectRoot: '/isolated', stateRevision: pin.stateRevision, clarity: { status: 'failed', summary: 'timeout' }, recovery: { stage: 'journal', state: 'pending', message: 'retry same receipt' } },
  { kind: 'completed', projectRoot: '/isolated', stateRevision: pin.stateRevision, clarity: { status: 'failed', summary: 'timeout' }, indexMaintenance: { state: 'deferred', message: 'another index lock' } },
  { kind: 'await_user', instruction: 'Need actual user input.' },
  { kind: 'await_user', gate: { kind: 'must_edit', pin } },
  { kind: 'await_user', gate: { kind: 'user_continue', pin, action: { routeId: 'run', label: { en: 'Run', zh: '运行' } } } },
  { kind: 'failed', diagnostics: ['Producer failed after a Worker attempt'] },
  { kind: 'cancelled', diagnostics: ['cancelled'] },
]) test(`${result.kind} retains missing-provenance honesty, including handoff/recovery branches`, () => {
  const text = renderResult({ ...result, summary: 'Design outcome.' })
  assert.match(text, /Unavailable for this result/)
  assert.match(text, /Do not report Worker execution as successful/)
  assert.equal((text.match(/Execution provenance \(/g) ?? []).length, 1)
})

test('registered tool snapshots the execution proof separately from model clarity', async () => {
  const { request } = fixture()
  const execution = await projectDesignExecutionProvenance(request)
  let tool
  apply({ on() {}, tools: { register: definition => { tool = definition } } }, {
    run: async () => ({ kind: 'completed', summary: 'Published.', projectRoot: '/isolated',
      stateRevision: pin.stateRevision, execution, clarity: { status: 'failed', summary: 'timeout' } }),
  })
  const value = await tool.execute({ name: 'page_design' }, {
    agent: { session: {} }, rootCallId: 'root', signal: request.signal,
  })
  assert.deepEqual(value.execution.integratedWorkerReceipts, execution.integratedWorkerReceipts)
  assert.notEqual(value.execution, execution)
  assert.notEqual(value.execution.integratedWorkerReceipts[0], execution.integratedWorkerReceipts[0])
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value), [])
  assert(validateJsonSchemaValue(tool.output.schema, { ...value,
    execution: { ...value.execution, source: 'model-assessment' } }).length > 0)
})
