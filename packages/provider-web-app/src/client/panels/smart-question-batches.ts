import type { SmartQuestion, SmartQuestionsState } from '../types.ts'

/** One UI-only question batch derived from persisted dynamic-card rounds. */
export interface SmartQuestionBatch {
  readonly id: number
  readonly labelNumber: number
  readonly title: string
  readonly questionIds: readonly string[]
  readonly questionCount: number
  readonly answeredCount: number
  readonly complete: boolean
}

function orderedEntries(state: SmartQuestionsState): Array<readonly [string, SmartQuestion]> {
  const questions = state.questions ?? {}
  const seen = new Set<string>()
  const entries: Array<readonly [string, SmartQuestion]> = []
  for (const id of state.question_order ?? []) {
    const question = questions[id]
    if (question === undefined || seen.has(id)) continue
    entries.push([id, question])
    seen.add(id)
  }
  for (const [id, question] of Object.entries(questions)) {
    if (seen.has(id)) continue
    entries.push([id, question])
  }
  return entries
}

function roundOf(question: SmartQuestion): number {
  return typeof question.round === 'number' && Number.isFinite(question.round)
    ? Math.max(0, Math.trunc(question.round))
    : 0
}

/** Whether one non-rejected question has a persisted answer or explanation. */
export function isSmartQuestionAnswered(question: SmartQuestion): boolean {
  return (question.answer?.trim() ?? '') !== ''
    || (question.detail?.trim() ?? '') !== ''
    || (question.multimodal_answer?.length ?? 0) > 0
}

/** Group cards by dynamic round, attaching fixed configuration only to the first round. */
export function deriveSmartQuestionBatches(state: SmartQuestionsState): readonly SmartQuestionBatch[] {
  const groups = new Map<number, Array<readonly [string, SmartQuestion]>>()
  const fixed: Array<readonly [string, SmartQuestion]> = []
  for (const [id, question] of orderedEntries(state)) {
    if (id.startsWith('const_')) {
      fixed.push([id, question])
      continue
    }
    const round = roundOf(question)
    groups.set(round, [...(groups.get(round) ?? []), [id, question]])
  }
  if (fixed.length > 0) {
    const firstRound = groups.size === 0 ? 0 : Math.min(...groups.keys())
    groups.set(firstRound, [...(groups.get(firstRound) ?? []), ...fixed])
  }
  const ordered = [...groups.entries()].sort(([left], [right]) => right - left)
  return ordered.map(([round, entries], index) => {
      const answerable = entries.filter(([, question]) => question.rejected !== true)
      const answeredCount = answerable.filter(([, question]) => isSmartQuestionAnswered(question)).length
      return {
        id: round,
        labelNumber: ordered.length - index,
        title: entries[0]?.[1].prompt.trim() || '',
        questionIds: entries.map(([id]) => id),
        questionCount: entries.length,
        answeredCount,
        complete: answerable.length > 0 && answeredCount === answerable.length,
      }
    })
}

/** Keep manual history selection until the latest persisted round changes. */
export function reconcileSmartQuestionBatchSelection(input: {
  readonly selected: number | null
  readonly previousLatest: number | null
  readonly batches: readonly SmartQuestionBatch[]
}): number | null {
  const latest = input.batches[0]?.id ?? null
  if (latest === null) return null
  if (input.previousLatest !== latest) return latest
  return input.batches.some((batch) => batch.id === input.selected) ? input.selected : latest
}

/** Overlay the selected batch's edits without dropping unselected rounds. */
export function mergeSmartQuestionUpdates(
  base: SmartQuestionsState,
  updates: Readonly<Record<string, SmartQuestion>>,
): SmartQuestionsState {
  return { ...base, questions: { ...(base.questions ?? {}), ...updates } }
}
