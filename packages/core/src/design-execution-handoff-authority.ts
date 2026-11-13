/** Host-neutral reconstruction of the exact pending must-edit release authority. */
import { DesignExecutionInvocationId } from './design-execution-runtime.ts'
import type { DesignJournalRecord } from './design-journal.ts'
import type { DesignKitVersion } from './types.ts'

/** Exact publication and earliest later Panel commit, reconstructed from journal facts. */
export interface PendingMustEditAuthority {
  readonly invocationId: ReturnType<typeof DesignExecutionInvocationId>
  readonly stateRevision: string
  readonly panelStateRevision?: string
}

/**
 * Reconstruct a gate only when the latest relevant committed change matches HEAD.
 * Commit-less Panel saves move no authority. Retries retain the earliest Panel
 * commit after the publication instead of substituting a later save's revision.
 * Callers must serialize this read with their Panel mutation and persist the
 * resulting disposition through DesignExecutionHandoffJournal.
 */
export function pendingMustEditAuthority(
  records: readonly DesignJournalRecord[],
  kitName: string,
  kitVersion: DesignKitVersion,
  skillName: string,
  head: string | undefined,
  hasContentChanges: (commit: string) => boolean = () => true,
): PendingMustEditAuthority | undefined {
  if (head === undefined) return undefined
  let latestPanelRevision: string | undefined
  let releasedPanelRevision: string | undefined
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record === undefined) continue
    if (record.type !== 'design/changed') continue
    const change = record.data
    if (change.kit !== kitName || change.version !== kitVersion || change.skill !== skillName) continue
    if (change.origin === 'panel') {
      if (change.commit === undefined) continue
      if (latestPanelRevision === undefined) {
        if (change.commit !== head) return undefined
        latestPanelRevision = change.commit
      }
      if (hasContentChanges(change.commit)) releasedPanelRevision = change.commit
      continue
    }
    if (change.origin !== 'agent') return undefined
    if (latestPanelRevision === undefined && change.commit !== head) return undefined
    if (change.execution?.stateStatus !== 'pending' || change.execution.handoff !== 'must_edit') return undefined
    if (change.commit === undefined || change.commit.trim() === '') return undefined
    return {
      invocationId: DesignExecutionInvocationId(change.execution.invocationId),
      stateRevision: change.commit,
      ...(releasedPanelRevision === undefined ? {} : { panelStateRevision: releasedPanelRevision }),
    }
  }
  return undefined
}

/**
 * Resolve Panel release facts against exact committed Design Files diffs.
 * Audit-only commits remain part of HEAD authority but cannot release a gate.
 * The caller provides its serialized store's reader, never mutable state or a
 * client-provided changed flag. Artifact-only edits count as content changes.
 */
export async function pendingMustEditAuthorityForSave(
  records: readonly DesignJournalRecord[],
  kitName: string,
  kitVersion: DesignKitVersion,
  skillName: string,
  head: string | undefined,
  readCommitDiff: (commit: string) => Promise<string>,
  matchesCurrentPublication?: (commit: string, head: string) => Promise<boolean>,
  hasPublishedState?: (commit: string) => Promise<boolean>,
): Promise<PendingMustEditAuthority | undefined> {
  // Journal publications keep their original commit pins. A caller may prove
  // that later system records advanced HEAD without replacing that publication
  // or changing Design evidence; do not mistake that audit commit for a gate.
  let publicationHead = head
  if (head !== undefined && matchesCurrentPublication !== undefined) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]
      if (record?.type !== 'design/changed'
        || record.data.kit !== kitName || record.data.version !== kitVersion || record.data.skill !== skillName
        || record.data.commit === undefined) continue
      if (record.data.commit !== head && await matchesCurrentPublication(record.data.commit, head)) {
        publicationHead = record.data.commit
      }
      break
    }
  }
  const initial = pendingMustEditAuthority(records, kitName, kitVersion, skillName, publicationHead)
  if (initial === undefined) return undefined
  // A new Panel commit cannot reconnect Journal authority across missing Git
  // history. Keep those facts, but do not consume an unprovable old handoff.
  if (hasPublishedState !== undefined && !await hasPublishedState(initial.stateRevision)) return undefined
  if (initial.panelStateRevision === undefined) return initial
  const commits: string[] = []
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record?.type !== 'design/changed') continue
    const change = record.data
    if (change.kit !== kitName || change.version !== kitVersion || change.skill !== skillName) continue
    if (change.origin !== 'panel') break
    if (change.commit !== undefined) commits.push(change.commit)
  }
  // Only the earliest actual release is needed. Do not re-read every later
  // save's diff on every edit: HEAD was already checked against journal facts.
  const seen = new Set<string>()
  let release: string | undefined
  for (const commit of commits.reverse()) {
    if (seen.has(commit)) continue
    seen.add(commit)
    // Do not skip a missing earlier release and substitute a later save for it.
    if (hasPublishedState !== undefined && !await hasPublishedState(commit)) return undefined
    if ((await readCommitDiff(commit)).trim() !== '') { release = commit; break }
  }
  return pendingMustEditAuthority(records, kitName, kitVersion, skillName, publicationHead, commit => commit === release)
}
