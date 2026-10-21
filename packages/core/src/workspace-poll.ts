import { createHash } from 'node:crypto'

/** Conditional transport only. Callers must assemble and authorize a fresh read first. */
export type WorkspacePollResult<T> =
  | { revision: string; unchanged: true }
  | { revision: string; unchanged: false; workspace: T }

/** All visible fields participate, including access, errors, logs and progress. */
export function workspacePollResult<T>(workspace: T, knownRevision: unknown): WorkspacePollResult<T> {
  const revision = createHash('sha256').update(JSON.stringify(workspace)).digest('hex')
  return knownRevision === revision
    ? { revision, unchanged: true }
    : { revision, unchanged: false, workspace }
}
