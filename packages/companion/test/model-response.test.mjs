import test from 'node:test'
import assert from 'node:assert/strict'
import { modelRequest, modelResponse } from '../src/model-response.mjs'

test('status carries one assessment and review list, preserving failures, pins and needed launch state', () => {
  const assessment = { u: { score: 60, evidence: 'Confirmed users. '.repeat(1000) }, summary: 'Saved scope' }
  const reviews = [{ reviewId: 'r1', status: 'due', executionAvailability: 'unavailable' }]
  const input = { projectId: 'project', assessedCheckpoint: 'checkpoint', kitContentHash: 'kit' }
  const raw = { projectId: 'project', checkpoint: 'checkpoint', access: { writable: true },
    design: { ignored: 'Full file contents'.repeat(1000) }, conversation: { rows: ['not model status'] },
    clarity: { assessment, explanation: assessment, state: 'due', needsReassessment: true }, reviews,
    continuations: [{ id: 'gate' }], activeMainBundles: [{ invocationId: 'active' }],
    hostCapabilities: { backgroundReviews: false, backgroundReviewReadiness: 'unverified',
      backgroundReviewProtocol: { state: 'unverified', canAttemptReadiness: false,
        launch: { tool: 'Agent' }, limitation: 'Long static documentation'.repeat(1000) } },
    services: { ust: { state: 'due', assessment, explanation: assessment, needsReassessment: true, reporting: { available: true, input } },
      kag: { state: 'failed', lastFailure: 'Database occupied', freshness: 'stale' },
      gra: { dispatchAllowed: false, reviews } } }
  const before = structuredClone(raw)
  const result = modelResponse('readWorkspace', raw)
  assert.deepEqual(result.services.ust.assessment, assessment)
  assert.equal(result.clarity.assessment, undefined)
  assert.equal(result.services.ust.explanation, undefined)
  assert.equal(result.services.gra.reviews, undefined)
  assert.deepEqual(result.reviews, reviews)
  assert.deepEqual(result.services.ust.reporting.input, input)
  assert.deepEqual(result.services.kag, raw.services.kag)
  assert.deepEqual(result.continuations, raw.continuations)
  assert.deepEqual(result.activeMainBundles, raw.activeMainBundles)
  assert.equal(result.hostCapabilities.backgroundReviewProtocol.canAttemptReadiness, false)
  assert.deepEqual(result.hostCapabilities.backgroundReviewProtocol.launch, { tool: 'Agent' })
  assert.match(result.hostCapabilities.backgroundReviewProtocol.details, /details=true/)
  assert.equal(result.design, undefined)
  assert.equal(result.conversation, undefined)
  assert.deepEqual(raw, before, 'projection cannot alter browser or authority objects')
  assert.equal(modelResponse('readWorkspace', raw, { details: true }), raw)
  assert.ok(JSON.stringify(result).length < JSON.stringify(raw).length / 3)
})

test('preparation retains the complete method once, exact paths, validation and evidence guidance', () => {
  const instructions = 'Complete shared operations. '.repeat(100)
  const method = instructions + '\n\n# Version-pinned Bundle method\nPreserve every domain principle.'
  const raw = { method, execution: { mode: 'subagent' }, resources: '/exact/resources', mindset: '/exact/mindset.md',
    executionContract: { instructions, directory: '/owned', validation: { executable: 'node', argv: ['validate'] } },
    cooperationMethod: 'Read bounded owned evidence', knowledgeMethod: 'Check source facts',
    mainAssessmentContext: { method: 'Unrelated rubric'.repeat(1000) } }
  const result = modelResponse('prepareBundle', raw)
  assert.equal(result.method, method)
  assert.equal(result.executionContract.instructions, undefined)
  assert.deepEqual(result.executionContract.validation, raw.executionContract.validation)
  for (const key of ['execution', 'resources', 'mindset', 'cooperationMethod', 'knowledgeMethod']) assert.deepEqual(result[key], raw[key])
  assert.equal(result.mainAssessmentContext, undefined)
  const separate = { ...raw, method: 'Domain method without the shared prefix' }
  assert.equal(modelResponse('prepareBundle', separate).executionContract.instructions, instructions, 'never discard instructions absent from method')
  assert.equal(raw.executionContract.instructions, instructions)
})

test('default status retains every execution receipt and failure without repeating canonical states and diffs', () => {
  const raw = { projectId: 'project', checkpoint: 'current-head', access: { writable: true },
    executionAttempts: [
      { runId: 'completed', role: 'producer', skill: 'example', phase: 'completed', settledScope: 'completion', settledOutcome: 'complete',
        diagnostics: [], settlement: { state: { original: 'Canonical content'.repeat(1000) }, diff: 'Original Git diff'.repeat(1000), note: 'Saved design note', commit: 'saved-head' } },
      { runId: 'working', parentRunId: 'actual-parent', role: 'worker', phase: 'working', artifactFile: 'example/current.html', diagnostics: [] },
      { runId: 'failed-after-commit', phase: 'failed', diagnostics: ['Host binding unavailable'], accepted: false, committed: true,
        settlement: { state: { original: 'Already saved content' }, diff: 'Committed diff', commit: 'repair-head', accepted: false,
          recovery: { stage: 'host-binding', action: 'retry-same-finish-once' }, validation: { issues: ['Keep the actual diagnostic'] } },
        receipt: { path: 'example/retained.html', sha256: 'original-digest' }, recovery: { instruction: 'Do not rewrite committed content.' } },
      { runId: 'cancelled', phase: 'cancelled', diagnostics: ['Native turn was interrupted'] },
      { runId: 'unknown', phase: 'queued', diagnostics: ['No native completion observed'] },
    ],
    activeMainBundles: [{ invocationId: 'main-active' }], continuations: [{ kind: 'user_continue', prompt: 'Ask the saved question' }],
    savedContinuations: [{ status: 'unknown', retryable: false }], savedNotificationError: 'Do not blindly resend',
    services: { kag: { state: 'unavailable', error: 'Provider is occupied' } } }
  const before = structuredClone(raw)
  const result = modelResponse('readWorkspace', raw)
  assert.deepEqual(result, modelResponse('readWorkspace', raw, { details: false }))
  assert.deepEqual(result.executionAttempts.map(row => [row.runId, row.phase, row.diagnostics]),
    raw.executionAttempts.map(row => [row.runId, row.phase, row.diagnostics]), 'no history window or successful-only filter')
  assert.deepEqual(result.executionAttempts[0].settlement, { commit: 'saved-head' })
  const failed = result.executionAttempts[2]
  assert.equal(failed.accepted, false); assert.equal(failed.committed, true)
  assert.deepEqual(failed.settlement, { commit: 'repair-head', accepted: false,
    recovery: raw.executionAttempts[2].settlement.recovery, validation: raw.executionAttempts[2].settlement.validation })
  assert.deepEqual(failed.receipt, raw.executionAttempts[2].receipt)
  assert.deepEqual(failed.recovery, raw.executionAttempts[2].recovery)
  for (const key of ['activeMainBundles', 'continuations', 'savedContinuations', 'savedNotificationError', 'services']) assert.deepEqual(result[key], raw[key])
  assert.deepEqual(raw, before)
  assert.equal(modelResponse('readWorkspace', raw, { details: true }), raw)
})

test('unknown execution receipt shapes remain visible rather than being discarded by compact status', () => {
  for (const executionAttempts of ['unavailable', null, [null, 'unknown record', { runId: 'future', settlement: 'Unavailable receipt', diagnostics: ['Preserve'] }]]) {
    const raw = { executionAttempts }
    assert.deepEqual(modelResponse('readWorkspace', raw).executionAttempts, executionAttempts)
    assert.equal(modelResponse('readWorkspace', raw, { details: true }), raw)
  }
})

test('compact settlement never promotes committed recovery to success or hides follow-up work', () => {
  const raw = { accepted: false, committed: true,
    settlement: { skill: 'example', commit: 'checkpoint', state: { large: 'canonical bytes' }, diff: 'large diff', note: 'save note' },
    recovery: { stage: 'host-binding', action: 'retry-same-finish-once', instruction: 'Do not rewrite committed files.' },
    receipt: { path: 'artifact', sha256: 'digest' },
    autoTask: { status: 'awaiting-agent', prompt: 'Required generated Panel instructions' },
    continuation: { kind: 'user_continue' }, diagnostics: ['Needs repair'],
    knowledge: { state: 'failed', error: 'Independent graph failure' },
    hostCapabilities: { backgroundReviewProtocol: { proof: 'irrelevant repeated document' } }, reviews: [] }
  const before = structuredClone(raw)
  for (const method of ['finishNativeRun', 'finishMainBundle']) {
    const result = modelResponse(method, raw)
    assert.equal(result.accepted, false)
    assert.equal(result.committed, true)
    assert.equal(result.settlement.commit, 'checkpoint')
    assert.equal(result.settlement.state, undefined)
    assert.equal(result.settlement.diff, undefined)
    for (const key of ['recovery', 'receipt', 'autoTask', 'continuation', 'diagnostics', 'knowledge']) assert.deepEqual(result[key], raw[key])
  }
  assert.deepEqual(raw, before)
})

test('only model status requests omit conversation and request service status; unrelated calls retain their exact JSON', () => {
  const status = { method: 'readWorkspace', params: {} }
  assert.deepEqual(modelRequest(status), { method: 'readWorkspace', params: { includeServices: true, includeConversation: false } })
  assert.deepEqual(status.params, {})
  const submit = { method: 'submitReview', params: { result: { schemaVersion: 1, researchNeeds: [] } } }
  assert.equal(modelRequest(submit), submit)
  assert.equal(modelResponse('readReview', submit.params.result), submit.params.result, 'explicit evidence/schema reads remain complete')
})
