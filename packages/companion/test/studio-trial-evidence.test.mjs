import { test } from 'node:test'
import assert from 'node:assert/strict'
import { studioTrialEvidence } from '../src/studio-trial-evidence.mjs'
const base = { id: 'trial', projectId: 'isolated', owners: [{ mode: 'main', finished: true, settledOutcome: 'complete' }], attempts: [], mainLog: { available: true, recordedStatus: 'completed' } }
test('trial requires native termination and settlement, not just output', () => {
  assert.equal(studioTrialEvidence(base).status, 'completed')
  assert.equal(studioTrialEvidence({ ...base, owners: [] }).status, 'unknown')
  assert.equal(studioTrialEvidence({ ...base, mainLog: { available: false } }).status, 'unknown')
  assert.equal(studioTrialEvidence({ ...base, mainLog: { available: true, recordedStatus: 'running' } }).status, 'running')
  assert.equal(studioTrialEvidence({ ...base, owners: [{ mode: 'main', finished: false }] }).status, 'unknown')
  assert.equal(studioTrialEvidence({ ...base, owners: [{ mode: 'main', finished: true, settledOutcome: 'pause' }] }).status, 'waiting')
  assert.equal(studioTrialEvidence({ ...base, owners: [{ mode: 'main', finished: true, settledOutcome: 'pause' }], mainLog: { available: true, recordedStatus: 'failed' } }).status, 'waiting')
  assert.equal(studioTrialEvidence({ ...base, attempts: [{ phase: 'working' }] }).status, 'running')
  assert.equal(studioTrialEvidence({ ...base, owners: [{ mode: 'main', finished: false }], mainLog: { available: true, recordedStatus: 'failed' } }).status, 'unknown')
  assert.equal(studioTrialEvidence({ ...base, owners: [{ mode: 'main', finished: false }, { mode: 'subagent', runId: 'old', finished: true, settledOutcome: 'complete' }], attempts: [{ runId: 'old', phase: 'completed' }] }).status, 'unknown')
})
test('producer must match its actual native run', () => {
  const input = { ...base, owners: [{ mode: 'subagent', runId: 'owned', finished: true, settledOutcome: 'complete' }] }
  assert.equal(studioTrialEvidence({ ...input, attempts: [{ runId: 'other', phase: 'completed' }] }).status, 'unknown')
  assert.equal(studioTrialEvidence({ ...input, attempts: [{ runId: 'owned', phase: 'completed' }] }).status, 'completed')
})
test('a later exact invocation can complete after an earlier pause', () => {
  const old = { mode: 'subagent', runId: 'old', finished: true, settledOutcome: 'pause', executionSequence: 1 }
  const latest = { mode: 'main', finished: true, settledOutcome: 'complete', executionSequence: 2 }
  assert.equal(studioTrialEvidence({ ...base, owners: [latest, old], attempts: [{ runId: 'old', phase: 'completed' }] }).status, 'completed')
  assert.equal(studioTrialEvidence({ ...base, owners: [{ ...latest, finished: false }, old], attempts: [{ runId: 'old', phase: 'completed' }] }).status, 'unknown')
})
