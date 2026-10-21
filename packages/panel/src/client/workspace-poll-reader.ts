import type { WorkspacePollResult } from '../../../core/src/workspace-poll.ts'

/** Small, runtime-local transport cache; never used for write authorization. */
export function createWorkspacePollReader<T>(
  fetchSnapshot: (session: string, revision: string | null) => Promise<WorkspacePollResult<T>>,
): (session: string) => Promise<T> {
  const snapshots = new Map<string, { revision: string; workspace: T; sequence: number }>()
  let sequence = 0
  return async session => {
    const requestSequence = ++sequence
    const previous = snapshots.get(session)
    const result = await fetchSnapshot(session, previous?.revision ?? null)
    if (result.unchanged) {
      if (!previous || previous.revision !== result.revision) throw new Error('design panel: unchanged response has no matching snapshot')
    }
    const workspace = result.unchanged ? previous!.workspace : result.workspace
    // An older concurrent request must not overwrite a newer cached response.
    if ((snapshots.get(session)?.sequence ?? 0) < requestSequence) {
      snapshots.delete(session)
      snapshots.set(session, { revision: result.revision, workspace, sequence: requestSequence })
      while (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!)
    }
    return workspace
  }
}
