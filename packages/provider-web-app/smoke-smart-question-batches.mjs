#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  deriveSmartQuestionBatches,
  mergeSmartQuestionUpdates,
  reconcileSmartQuestionBatchSelection,
} from './src/client/panels/smart-question-batches.ts'

const legacy = { questions: {
  q1: { prompt: 'Who uses this product?', answer: 'Researchers' },
  q2: { prompt: 'What outcome matters?', answer: '', detail: '' },
  const_auth_mode: { prompt: 'Auth?', answer: 'anonymous' },
} }
const legacyBatches = deriveSmartQuestionBatches(legacy)
assert.deepEqual(legacyBatches.map(({ id, labelNumber, questionCount, complete }) => ({ id, labelNumber, questionCount, complete })), [
  { id: 0, labelNumber: 1, questionCount: 3, complete: false },
])
assert.deepEqual(legacyBatches[0].questionIds, ['q1', 'q2', 'const_auth_mode'])

const appended = { questions: {
  q1: { prompt: 'Who uses this product?', answer: 'Researchers', round: 0 },
  q2: { prompt: 'Ignored follow-up', answer: '', rejected: true, round: 0 },
  q3: { prompt: 'Which workflow comes first?', answer: '', round: 1 },
  q4: { prompt: 'Which evidence is required?', detail: 'Peer reviewed', round: 1 },
  const_auth_mode: { prompt: 'Auth?', answer: 'anonymous' },
} }
const appendedBatches = deriveSmartQuestionBatches(appended)
assert.deepEqual(appendedBatches.map((batch) => batch.id), [1, 0])
assert.deepEqual(appendedBatches[0].questionIds, ['q3', 'q4'], 'later rounds must contain only their dynamic questions')
assert.deepEqual(appendedBatches[1].questionIds, ['q1', 'q2', 'const_auth_mode'], 'fixed questions belong only to the first round')
assert.equal(appendedBatches[0].complete, false)
assert.equal(appendedBatches[1].complete, true)
assert.deepEqual(deriveSmartQuestionBatches({ questions: {} }), [])
assert.deepEqual(
  deriveSmartQuestionBatches({ questions: { const_auth_mode: { prompt: 'Auth?', answer: 'anonymous' } } })[0].questionIds,
  ['const_auth_mode'],
  'a fixed-only first round remains visible',
)
assert.equal(reconcileSmartQuestionBatchSelection({ selected: null, previousLatest: null, batches: legacyBatches }), 0)
assert.equal(reconcileSmartQuestionBatchSelection({ selected: 0, previousLatest: 1, batches: appendedBatches }), 0)
const thirdRound = deriveSmartQuestionBatches({ questions: { ...appended.questions, q5: { prompt: 'New gap?', answer: '', round: 2 } } })
assert.equal(reconcileSmartQuestionBatchSelection({ selected: 0, previousLatest: 1, batches: thirdRound }), 2)

const merged = mergeSmartQuestionUpdates(appended, { q3: { ...appended.questions.q3, answer: 'Literature review' } })
assert.equal(merged.questions.q1.answer, 'Researchers')
assert.equal(merged.questions.q3.answer, 'Literature review')
assert.equal(merged.questions.const_auth_mode.answer, 'anonymous')

const panelSource = await readFile(new URL('./src/client/panels/smart-questions.tsx', import.meta.url), 'utf8')
assert.match(panelSource, /<NativeDesignPanelFrame autoSaveId='smart-question-round-sidebar'>/)
assert.match(panelSource, /<DesignPanelSidebar[\s\S]*?title=\{isZh \? '问题轮次' : 'Question rounds'\}/)
assert.match(panelSource, /<DesignPanelNavItem[\s\S]*?selected=\{props\.selected\}/)
assert.doesNotMatch(panelSource, /<aside className=/, 'smart questions must reuse the provider sidebar instead of a one-off shell')
assert.match(panelSource, /<main className='min-h-0 min-w-0 flex-1 overflow-y-auto/)
assert.match(panelSource, /isLatest[\s\S]*?<AIQuestion[\s\S]*?: <ReadOnlyQuestionBatch/)
assert.match(panelSource, /data-testid='smart-question-read-only-batch'/)
assert.doesNotMatch(panelSource, /selectedBatch\?\.id === latest && id\.startsWith\('const_'\)/, 'the latest round must not re-attach fixed cards')

console.log('SMART QUESTION BATCH NAVIGATION OK')
