import test from 'node:test'
import assert from 'node:assert/strict'
import { derivedServicesStatus } from '../src/derived-services-status.mjs'

const projectId = 'project-a', checkpoint = 'commit-a'
const input = { projectId, assessedCheckpoint: checkpoint, kitContentHash: 'kit', scopeDigest: 'scope' }
function fixture(overrides = {}) {
  return { projectId, checkpoint, clarity: { assessment: null, needsReassessment: true },
    mainContext: { available: true, input, clarity: { assessment: null, needsReassessment: true } },
    knowledge: { project: projectId, state: 'current', freshness: 'matching', head: checkpoint,
      latestComplete: { checkpoint, revision: 'rev:0', warningCount: 1 }, semanticLayer: 'enabled' },
    reviewPolicy: { mode: 'auto' },
    hostCapabilities: { backgroundReviews: false, backgroundReviewReadiness: 'unverified',
      backgroundReviewExecutionMode: 'unavailable', backgroundReviewReasonCode: 'attached-result' },
    reviewDispatchOwner: 'unavailable', reviews: [{ profile: 'grounding', status: 'due', dispatch: false }], ...overrides }
}

test('the reported mixed outcome cannot become a single successful assessment', () => {
  const f = fixture(), result = derivedServicesStatus(f)
  assert.equal(result.ust.state, 'unknown')
  assert.equal(result.ust.assessment, null)
  assert.equal(result.ust.needsReassessment, true)
  assert.equal(result.kag, f.knowledge, 'reuse the one shared publication read model unchanged')
  assert.equal(result.kag.latestComplete.warningCount, 1)
  assert.equal(result.gra.execution.available, false)
  assert.equal(result.gra.execution.reasonCode, 'attached-result')
  assert.equal(result.gra.dispatchAllowed, false)
  assert.equal(result.gra.reviews, f.reviews)
})

test('missing native evidence preserves the last accepted score without certifying freshness', () => {
  const result = derivedServicesStatus(fixture({ clarity: { assessment: { u: 62, s: 68, t: 45 }, needsReassessment: false },
    mainContext: { available: false, reasonCode: 'native-main-turn-unavailable', error: 'No current user turn.' } }))
  assert.equal(result.ust.assessment.u, 62)
  assert.equal(result.ust.state, 'unavailable')
  assert.equal(result.ust.needsReassessment, true)
  assert.equal(result.ust.reporting.available, false)
  assert.equal(result.ust.reporting.reasonCode, 'native-main-turn-unavailable')
  assert.equal(result.kag.state, 'current', 'UST availability does not gate KAG')
})

test('only the same project and checkpoint can expose reportable main input', () => {
  for (const stale of [{ ...input, projectId: 'foreign' }, { ...input, assessedCheckpoint: 'old' }]) {
    const result = derivedServicesStatus(fixture({ mainContext: { available: true, input: stale } }))
    assert.equal(result.ust.reporting.available, false)
    assert.equal(result.ust.reporting.input, undefined)
    assert.match(result.ust.reporting.reason, /changed/)
  }
  assert.equal(derivedServicesStatus(fixture({ knowledge: { project: 'foreign', state: 'current' } })).kag.state, 'unavailable')
})

test('policy off, readiness and running reviews remain distinct', () => {
  const f = fixture({ clarity: { assessment: { u: 80, s: 75, t: 70 }, needsReassessment: false },
    mainContext: { available: true, input, clarity: { assessment: { u: 80, s: 75, t: 70 }, needsReassessment: false } },
    hostCapabilities: { backgroundReviews: true, backgroundReviewReadiness: 'ready', backgroundReviewExecutionMode: 'cooperative-background' },
    reviewDispatchOwner: 'main', reviewPolicy: { mode: 'off' } })
  const off = derivedServicesStatus(f)
  assert.equal(off.ust.state, 'current')
  assert.equal(off.gra.execution.available, true)
  assert.equal(off.gra.execution.mode, 'cooperative-background')
  assert.equal(off.gra.dispatchAllowed, false)
  assert.equal(off.gra.reviews[0].status, 'due', 'ready is not running')
  assert.equal(derivedServicesStatus({ ...f, reviewPolicy: { mode: 'auto' } }).gra.dispatchAllowed, true)
  assert.equal(derivedServicesStatus({ ...f, reviewPolicy: undefined }).gra.dispatchAllowed, false, 'unknown policy is not dispatch permission')
})

test('a newer user scope at the same checkpoint invalidates an older workspace score', () => {
  const result = derivedServicesStatus(fixture({ clarity: { assessment: { u: 80, s: 75, t: 70 }, needsReassessment: false },
    mainContext: { available: true, input: { ...input, scopeDigest: 'new-user-scope' },
      clarity: { assessment: { u: 80, s: 75, t: 70 }, needsReassessment: true } } }))
  assert.equal(result.ust.state, 'due')
  assert.equal(result.ust.needsReassessment, true)
  assert.equal(result.ust.reporting.input.scopeDigest, 'new-user-scope')
})

test('KAG accepted/running/failed and last-good publication stay independent of scoring', () => {
  for (const state of ['queued', 'running', 'failed', 'due']) {
    const f = fixture({ knowledge: { project: projectId, state, freshness: 'different', head: checkpoint,
      latestComplete: { checkpoint: 'old', revision: 'rev:0', warningCount: 0 } } })
    assert.deepEqual(derivedServicesStatus(f).kag, f.knowledge)
  }
})
