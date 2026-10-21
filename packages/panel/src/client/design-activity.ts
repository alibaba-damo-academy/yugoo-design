/** Pure helpers for correlating filesystem-visible Design state with Host execution. */
import type { DesignProjection } from './types.ts'
import type { DesignPanelWorkspaceRead } from './types.ts'

type ExecutionAttempt = DesignPanelWorkspaceRead['executionAttempts'][number]

/** Bind one run_design_skill conversation row to its exact root Producer. */
export function producerExecutionForCall(
  attempts: DesignPanelWorkspaceRead['executionAttempts'] | undefined,
  skill: string,
  rootCallId: string,
  running: boolean,
): ExecutionAttempt | undefined {
  const roots = [...(attempts ?? [])]
    .filter(attempt => attempt.skill === skill
      && attempt.role === 'producer'
      && attempt.artifactKind === undefined)
    .sort((left, right) => right.sequence - left.sequence)
  return roots.find(attempt => attempt.rootCallId === rootCallId)
    ?? (running ? roots.find(attempt => attempt.rootCallId === undefined
      && (attempt.phase === 'queued' || attempt.phase === 'working')) : undefined)
}

/** Latest still-running root Producer whose Bundle already exists in the filesystem projection. */
export function latestActiveFileExecution(
  design: DesignProjection | undefined,
  attempts: DesignPanelWorkspaceRead['executionAttempts'] | undefined,
): { readonly skill: string; readonly invocationId: string; readonly sequence: number } | undefined {
  const latestByInvocation = new Map<string, DesignPanelWorkspaceRead['executionAttempts'][number]>()
  for (const attempt of attempts ?? []) {
    if (attempt.role !== 'producer' || attempt.artifactKind !== undefined) continue
    const prior = latestByInvocation.get(attempt.invocationId)
    if (prior === undefined || attempt.sequence > prior.sequence) latestByInvocation.set(attempt.invocationId, attempt)
  }
  let latest: { readonly skill: string; readonly invocationId: string; readonly sequence: number } | undefined
  for (const attempt of latestByInvocation.values()) {
    if (attempt.phase !== 'queued' && attempt.phase !== 'working') continue
    if (design?.[attempt.skill] === undefined || (latest !== undefined && attempt.sequence <= latest.sequence)) continue
    latest = { skill: attempt.skill, invocationId: attempt.invocationId, sequence: attempt.sequence }
  }
  return latest
}
