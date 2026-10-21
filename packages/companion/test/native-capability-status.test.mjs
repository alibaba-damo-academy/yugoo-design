import test from 'node:test'
import assert from 'node:assert/strict'
import { nativeCapabilityStatus } from '../src/native-capability-status.mjs'

test('public native capability diagnostics preserve useful typed metadata without raw receipt/content/proof', () => {
  const raw = { state: 'unverified', executionMode: 'unavailable', observedMode: 'attached', reasonCode: 'native-attached-result',
    proof: { secret: 'must-not-escape' }, diagnostics: { callId: 'call_abc123', taskId: 'agent-child',
      prompt: 'must-not-escape', issues: [
        { field: 'descriptor.mode', expected: 'background', actualType: 'string', actual: 'attached' },
        { field: 'descriptor.description', expected: 'nonempty bounded string', actualType: 'string', actual: 'must-not-escape' },
        { field: 'descriptor.createdAt', expected: 'number', actualType: 'number', actual: 123 },
      ] } }
  const value = nativeCapabilityStatus(raw)
  assert.equal(value.backgroundReviewObservedMode, 'attached')
  assert.equal(value.backgroundReviewReasonCode, 'native-attached-result')
  assert.equal(value.backgroundReviewDiagnostics.callId, 'call_abc123')
  assert.equal(value.backgroundReviewDiagnostics.issues[0].actual, 'attached')
  assert.equal(value.backgroundReviewDiagnostics.issues[2].actual, 123)
  assert.doesNotMatch(JSON.stringify(value), /must-not-escape|"proof"|"prompt"/)
})

test('unknown modes and unbounded diagnostic objects are not forwarded', () => {
  const value = nativeCapabilityStatus({ state: 'invented', executionMode: 'invented', observedMode: 'private-value',
    diagnostics: { receiptId: '/private/path', issues: Array.from({ length: 100 }, () => ({ field: 'field', actual: { private: 'do-not-escape' } })) } })
  assert.equal(value.backgroundReviewReadiness, 'unverified')
  assert.equal(value.backgroundReviewExecutionMode, 'unavailable')
  assert.equal(value.backgroundReviewDiagnostics.issues.length, 24)
  assert.equal(value.backgroundReviewDiagnostics.receiptId, undefined)
  assert.doesNotMatch(JSON.stringify(value), /private-value|private\/path|do-not-escape/)
})

test('native parser exceptions and unknown adapter reasons never escape public status', () => {
  for (const reasonCode of ['native-background-descriptor-invalid', 'future-adapter-code', 'constructor', undefined]) {
    const value = nativeCapabilityStatus({ reasonCode, reason: 'JSON parse failed near PRIVATE_TRANSCRIPT_MARKER' })
    assert.equal(typeof value.backgroundReviewReason, 'string')
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE_TRANSCRIPT_MARKER|JSON parse failed/)
  }
})
