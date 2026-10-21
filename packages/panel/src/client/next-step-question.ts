/** Exact machine contract for the optional post-Design next-step question. */

export const DESIGN_NEXT_STEP_QUESTION_ID = 'dsh-design-next-step'

interface PendingQuestionLike {
  readonly kind?: unknown
  readonly questions?: unknown
  readonly dismissal?: unknown
  cancel?: () => Promise<void>
  dismiss?: () => Promise<void>
}

/** A Session-scoped pending-interaction lookup supplied by the Host UI seam. */
export interface PendingInteractionSource {
  getSnapshot(): ReadonlyMap<string, unknown>
}

/** The exact legacy/current public UI Session faces; no fabricated empty source. */
export interface UiSessionPendingFace {
  readonly pendingInteractions?: PendingInteractionSource
  readonly sessionStatus?: { getSnapshot(): ReadonlyMap<string, unknown> }
}

export function createPendingDesignInteractionSource(face: UiSessionPendingFace): PendingInteractionSource {
  if (typeof face.pendingInteractions?.getSnapshot === 'function') return face.pendingInteractions
  const status = face.sessionStatus
  if (typeof status?.getSnapshot !== 'function') throw new Error('design panel: unsupported pending-interaction source')
  return { getSnapshot() {
    const rows = status.getSnapshot()
    if (!(rows instanceof Map)) throw new Error('design panel: invalid session-status snapshot')
    const pending = new Map<string, unknown>()
    for (const [sessionId, row] of rows) {
      if (typeof sessionId !== 'string' || typeof row !== 'object' || row === null || !Object.hasOwn(row, 'pendingInteraction')) {
        throw new Error('design panel: invalid session-status row')
      }
      const interaction = Reflect.get(row, 'pendingInteraction')
      if (interaction === undefined) continue
      if (typeof interaction !== 'object' || interaction === null || Reflect.get(interaction, 'sessionId') !== sessionId) {
        throw new Error('design panel: pending-interaction session identity mismatch')
      }
      pending.set(sessionId, interaction)
    }
    return pending
  } }
}

/**
 * Cancel only the one machine-identified Design next-step recommendation.
 * Other native questions, multi-question requests, plan reviews, and absent
 * interactions are deliberately untouched. A cancellation transport failure
 * cannot undo the panel save that already committed before this call.
 */
export async function cancelPendingDesignNextStepQuestion(
  source: PendingInteractionSource,
  sessionId: string,
): Promise<boolean> {
  const candidate = source.getSnapshot().get(sessionId) as PendingQuestionLike | undefined
  if (candidate?.kind !== 'question' || !Array.isArray(candidate.questions) || candidate.questions.length !== 1) return false
  const question = candidate.questions[0]
  if (typeof question !== 'object' || question === null || (question as { id?: unknown }).id !== DESIGN_NEXT_STEP_QUESTION_ID) return false
  const cancel = typeof candidate.cancel === 'function' ? candidate.cancel
    : candidate.dismissal === 'cancel' && typeof candidate.dismiss === 'function' ? candidate.dismiss : undefined
  // Current Host tool-call-keyed cards have dismissal='hide': dismissing one
  // leaves the request live, so it must never be reported as cancellation.
  if (cancel === undefined) return false
  try {
    await cancel.call(candidate)
    return true
  } catch {
    return false
  }
}
