/** Derive trial status from existing native bindings, never from output files. */
export function studioTrialEvidence({ id, projectId, owners, attempts, mainLog }) {
  const result = status => ({ id, projectId, status })
  if (!owners.length) return result('unknown')
  const unfinished = attempts.filter(attempt => !['completed', 'failed', 'cancelled'].includes(attempt.phase))
  if (unfinished.length) return result(unfinished.some(attempt => attempt.phase === 'working') ? 'running' : 'unknown')
  if (owners.some(owner => !owner.finished)) return result('unknown')
  if (owners.length > 1 && (owners.some(owner => !Number.isSafeInteger(owner.executionSequence) || owner.executionSequence < 1)
    || new Set(owners.map(owner => owner.executionSequence)).size !== owners.length)) return result('unknown')
  const owner = [...owners].sort((a, b) => (a.executionSequence ?? 0) - (b.executionSequence ?? 0)).at(-1)
  const phase = owner.mode === 'main'
    ? mainLog?.available ? mainLog.recordedStatus : 'unknown'
    : attempts.find(attempt => attempt.runId === owner.runId)?.phase
  if (phase === 'running' || phase === 'working') return result('running')
  if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(phase)) return result('unknown')
  // A later failure in the shared main conversation cannot close a paused trial.
  if (owner.settledOutcome === 'pause') return result('waiting')
  if (phase === 'failed') return result('failed')
  if (phase === 'cancelled' || phase === 'interrupted') return result('stopped')
  if (owner.settledOutcome === 'cancelled') return result('stopped')
  if (['failed', 'no-progress'].includes(owner.settledOutcome)) return result('failed')
  return result(owner.settledOutcome === 'complete' ? 'completed' : 'unknown')
}
