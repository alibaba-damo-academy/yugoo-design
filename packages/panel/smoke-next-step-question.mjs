import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  cancelPendingDesignNextStepQuestion,
  createPendingDesignInteractionSource,
  DESIGN_NEXT_STEP_QUESTION_ID,
} from './src/client/next-step-question.ts'

function source(candidate) {
  return { getSnapshot: () => candidate === undefined ? new Map() : new Map([['session-a', candidate]]) }
}

let cancellations = 0
const nextStep = {
  kind: 'question',
  questions: [{ id: DESIGN_NEXT_STEP_QUESTION_ID, question: '下一步？' }],
  async cancel() { cancellations += 1 },
}
assert.equal(await cancelPendingDesignNextStepQuestion(source(nextStep), 'session-a'), true)
assert.equal(cancellations, 1)

for (const preserved of [
  undefined,
  { ...nextStep, kind: 'plan-review' },
  { ...nextStep, questions: [{ id: 'grounding-question' }] },
  { ...nextStep, questions: [{ id: DESIGN_NEXT_STEP_QUESTION_ID }, { id: 'another' }] },
  { ...nextStep, cancel: undefined },
]) {
  assert.equal(await cancelPendingDesignNextStepQuestion(source(preserved), 'session-a'), false)
}
assert.equal(cancellations, 1, 'grounding, Smart Question-like, multi-question, plan-review, and absent interactions remain untouched')
assert.equal(await cancelPendingDesignNextStepQuestion(source(nextStep), 'another-session'), false, 'only the saving session may be inspected')

assert.equal(createPendingDesignInteractionSource({ pendingInteractions: source(nextStep) }).getSnapshot().get('session-a'), nextStep)
const currentQuestion = { ...nextStep, sessionId: 'session-a', cancel: undefined, dismissal: 'cancel', async dismiss() {
  assert.equal(this, currentQuestion)
  cancellations++
} }
const currentStatus = { getSnapshot() {
  assert.equal(this, currentStatus, 'the current Host snapshot retains its receiver')
  return new Map([
    ['session-a', { running: false, pendingInteraction: currentQuestion, completionUnread: false }],
    ['session-b', { running: false, pendingInteraction: undefined, completionUnread: false }],
  ])
} }
const currentSource = createPendingDesignInteractionSource({ sessionStatus: currentStatus })
assert.equal(await cancelPendingDesignNextStepQuestion(currentSource, 'session-a'), true)
assert.equal(cancellations, 2)
assert.equal(await cancelPendingDesignNextStepQuestion(currentSource, 'session-b'), false)
assert.equal(await cancelPendingDesignNextStepQuestion(currentSource, 'absent-session'), false)
let hidden = 0
const hiddenQuestion = { ...currentQuestion, dismissal: 'hide', async dismiss() { hidden++ } }
assert.equal(await cancelPendingDesignNextStepQuestion(source(hiddenQuestion), 'session-a'), false, 'current named-call dismissal hides a card, not the request')
assert.equal(hidden, 0, 'a hide-only card is neither dismissed nor falsely cancelled')
for (const preserved of [
  { ...currentQuestion, kind: 'plan-review' },
  { ...currentQuestion, questions: [{ id: 'other-question' }] },
  { ...currentQuestion, questions: [{ id: DESIGN_NEXT_STEP_QUESTION_ID }, { id: 'another' }] },
  { ...currentQuestion, dismissal: 'unknown' },
]) assert.equal(await cancelPendingDesignNextStepQuestion(source(preserved), 'session-a'), false)
assert.throws(() => createPendingDesignInteractionSource({}), /unsupported pending-interaction source/)
for (const snapshot of [null, {}, new Map([['session-a', null]]), new Map([['session-a', {}]]), new Map([['session-a', { pendingInteraction: { ...currentQuestion, sessionId: 'session-b' } }]])]) {
  assert.throws(() => createPendingDesignInteractionSource({ sessionStatus: { getSnapshot: () => snapshot } }).getSnapshot(), /invalid session-status|identity mismatch/)
}
assert.equal(cancellations, 2, 'malformed or cross-session current Host facts never cancel another interaction')

const failedCancel = { ...nextStep, async cancel() { throw new Error('transport failed') } }
assert.equal(await cancelPendingDesignNextStepQuestion(source(failedCancel), 'session-a'), false, 'cancel failure is non-fatal after a durable save')

const workspace = await readFile(new URL('./src/client/workspace.tsx', import.meta.url), 'utf8')
const saveBlock = /for \(const skill of dirty\)(?<body>[\s\S]*?)await runtime\.sendPrompt\(sessionId, isZh/du.exec(workspace)?.groups?.body ?? ''
assert.match(saveBlock, /await runtime\.savePanel/)
assert.match(saveBlock, /await runtime\.cancelPendingNextStepQuestion\(sessionId\)/)
assert.ok(saveBlock.indexOf('await runtime.savePanel') < saveBlock.indexOf('await runtime.cancelPendingNextStepQuestion(sessionId)'), 'durable save must happen before cancellation')
assert.equal(workspace.match(/await runtime\.cancelPendingNextStepQuestion\(sessionId\)/g)?.length, 2, 'ordinary save and save-and-regenerate must both release the stale next-step recommendation')

const corePrompt = await readFile(new URL('../core/src/design-core-prompt.ts', import.meta.url), 'utf8')
assert.match(corePrompt, /exactly one question whose machine id is exactly 'dsh-design-next-step'/)

console.log('PANEL SAVE PREEMPTS ONLY NEXT-STEP QUESTION OK')
