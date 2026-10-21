/** Pure admission policy for one workspace polling timer. */
export type WorkspacePollAdmission = 'stop' | 'defer' | 'start'

/**
 * Decide whether a timer is stale, must wait for an older in-flight read, or
 * may start a new read. The `defer` result is essential after unsubscribe →
 * resubscribe while the prior generation's request is still settling.
 */
export function workspacePollAdmission(
  expectedGeneration: number,
  currentGeneration: number,
  listenerCount: number,
  running: boolean,
): WorkspacePollAdmission {
  if (expectedGeneration !== currentGeneration || listenerCount === 0) return 'stop'
  return running ? 'defer' : 'start'
}
