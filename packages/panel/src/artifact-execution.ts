import type { DesignArtifactActivityRead, DesignArtifactLogTarget } from './client/types.ts'
export type ProjectedArtifactStatus = 'pending' | 'queued' | 'working' | 'completed' | 'failed' | 'unknown'
type ExecutionAttemptRead = NonNullable<import('./client/panels/shared.ts').SkillPanelProps['executionAttempts']>[number]

export interface ProjectedArtifactExecution {
  readonly status: ProjectedArtifactStatus
  readonly runId?: string
  readonly logTarget?: DesignArtifactLogTarget
  readonly activityUnavailable?: boolean
  readonly receipt?: ExecutionAttemptRead['receipt']
}

/** Project execution activity against observed file availability, never a JSON ref alone. */
export function projectArtifactStatus(input: Readonly<{
  artifactAvailable: boolean
  durableStatus?: ProjectedArtifactStatus
  artifactId?: string
  artifactKind?: string
  artifactFile?: string
  attempts?: readonly NonNullable<import('./client/panels/shared.ts').SkillPanelProps['executionAttempts']>[number][]
}>): ProjectedArtifactStatus {
  return projectArtifactExecution(
    input.artifactId,
    input.attempts,
    input.artifactKind,
    input.artifactAvailable,
    input.durableStatus,
    input.artifactFile,
  ).status
}

function currentInvocationAttempts(
  source: readonly ExecutionAttemptRead[] | undefined,
): readonly ExecutionAttemptRead[] {
  const attempts = source ?? []
  const newest = [...attempts].sort((left, right) => right.sequence - left.sequence)[0]
  return newest === undefined ? [] : attempts.filter(attempt => attempt.invocationId === newest.invocationId)
}

function latestArtifactAttempts(
  artifactId: string | undefined,
  source: readonly ExecutionAttemptRead[] | undefined,
  artifactKind?: string,
  artifactFile?: string,
): readonly ExecutionAttemptRead[] {
  if (artifactId === undefined) return []
  const candidates = currentInvocationAttempts(source).filter(attempt => (
    artifactKind === undefined || attempt.artifactKind === artifactKind
  ))
  const exactPath = artifactFile === undefined ? [] : candidates.filter(attempt => (
    attempt.artifactFile === artifactFile || attempt.receipt?.path === artifactFile
  ))
  // New Host events always carry artifactFile. Fall back to the historical ID
  // only for legacy events which carried neither a bound path nor a receipt.
  const attempts = exactPath.length > 0
    ? exactPath
    : candidates.filter(attempt => attempt.artifactId === artifactId
      && (artifactFile === undefined || (attempt.artifactFile === undefined && attempt.receipt?.path === undefined)))
  const latestByAttempt = new Map<string, (typeof attempts)[number]>()
  for (const attempt of attempts) {
    const current = latestByAttempt.get(attempt.attemptId)
    if (current === undefined || current.sequence < attempt.sequence) latestByAttempt.set(attempt.attemptId, attempt)
  }
  return [...latestByAttempt.values()].sort((left, right) => right.sequence - left.sequence)
}

function latestRootAttempt(source: readonly ExecutionAttemptRead[] | undefined): ExecutionAttemptRead | undefined {
  const latestByAttempt = new Map<string, ExecutionAttemptRead>()
  for (const attempt of currentInvocationAttempts(source)) {
    if (attempt.role !== 'producer' || attempt.artifactKind !== undefined) continue
    const current = latestByAttempt.get(attempt.attemptId)
    if (current === undefined || current.sequence < attempt.sequence) latestByAttempt.set(attempt.attemptId, attempt)
  }
  return [...latestByAttempt.values()].sort((left, right) => right.sequence - left.sequence)[0]
}

/** Fold the current invocation's root Producer without consulting Design Files. */
export function projectRootExecution(
  attempts: readonly ExecutionAttemptRead[] = [],
): ProjectedArtifactExecution {
  const root = latestRootAttempt(attempts)
  if (root === undefined) return { status: 'pending' }
  const status: ProjectedArtifactStatus = root.phase === 'cancelled' ? 'failed' : root.phase
  return {
    status,
    ...(root.runId === undefined ? {} : { runId: root.runId }),
    ...(root.receipt === undefined ? {} : { receipt: root.receipt }),
  }
}

/** Fold current-invocation artifact attempts, including Producer fallback. */
/** Match explicit native associations without inventing execution attempts. */
function artifactActivity(artifactId: string | undefined, activities: readonly DesignArtifactActivityRead[], artifactKind?: string, artifactFile?: string) {
  if (artifactId === undefined) return undefined
  return [...activities].filter(activity => (artifactKind === undefined || activity.artifactKind === artifactKind)
    && (artifactFile === undefined ? activity.artifactId === artifactId : activity.artifactFile === artifactFile))
    .sort((a, b) => b.sequence - a.sequence)[0]
}

/** Active main invocations have no attempt row; their actual identity scopes Worker fallback. */
function activityAttempts(association: DesignArtifactActivityRead | undefined, attempts: readonly ExecutionAttemptRead[]) {
  return association?.active && association.executor === 'main'
    ? attempts.filter(attempt => attempt.invocationId === association.invocationId)
    : attempts
}

export function projectArtifactExecution(
  artifactId: string | undefined,
  attempts: readonly ExecutionAttemptRead[] = [],
  artifactKind?: string,
  artifactAvailable = false,
  durableStatus: ProjectedArtifactStatus = 'pending',
  artifactFile?: string,
  activities: readonly DesignArtifactActivityRead[] = [],
): ProjectedArtifactExecution {
  const association = artifactActivity(artifactId, activities, artifactKind, artifactFile)
  const scopedAttempts = activityAttempts(association, attempts)
  const latest = latestArtifactAttempts(artifactId, scopedAttempts, artifactKind, artifactFile)
  // Exact current-invocation attempts retain the original status/log precedence.
  // A retained focus is a fallback, not a replacement for a real Worker.
  if (association !== undefined && latest.length === 0) {
    const locator = { runId: association.runId, logTarget: association.logTarget,
      ...(association.available ? {} : { activityUnavailable: true }) }
    if (association.active && association.available && association.nativeStatus === 'running') return { status: 'working', ...locator }
    if (association.active && association.available && ['failed', 'interrupted'].includes(association.nativeStatus)) return { status: 'failed', ...locator }
    // An open focus is an invocation fact, not proof that its native executor
    // is running. Existing bytes must not hide missing lifecycle evidence.
    if (association.active && (!association.available || !['running', 'completed', 'failed', 'interrupted'].includes(association.nativeStatus))) return { status: 'unknown', ...locator }
    // Unknown/settled native activity is not artifact completion. Bytes remain an independent fact.
    return { status: artifactAvailable ? 'completed' : durableStatus, ...locator }
  }
  const root = latestRootAttempt(scopedAttempts)
  const rootActive = root?.phase === 'queued' || root?.phase === 'working'
  const terminal = latest[0]
  const active = terminal?.phase === 'working' || terminal?.phase === 'queued' ? terminal : undefined
  if (active !== undefined && (root === undefined || rootActive || active.sequence > root.sequence)) {
    return {
      status: active.phase === 'queued' ? 'queued' : 'working',
      ...(active.runId === undefined ? {} : { runId: active.runId }),
    }
  }
  if (terminal !== undefined && (terminal.phase === 'queued' || terminal.phase === 'working')
    && root !== undefined && !rootActive && root.sequence > terminal.sequence) {
    return { status: 'failed', ...(terminal.runId === undefined ? {} : { runId: terminal.runId }) }
  }
  if (terminal?.phase === 'completed' && artifactAvailable) {
    return {
      status: 'completed',
      ...(terminal.runId === undefined ? {} : { runId: terminal.runId }),
      ...(terminal.receipt === undefined ? {} : { receipt: terminal.receipt }),
    }
  }
  if (terminal !== undefined) {
    return { status: 'failed', ...(terminal.runId === undefined ? {} : { runId: terminal.runId }) }
  }
  if (artifactAvailable) return { status: 'completed' }
  return { status: durableStatus }
}

/** Keep logs attached to the actual latest executor, including explicit Producer takeover. */
export function projectArtifactExecutionLogRunId(
  artifactId: string,
  attempts: readonly ExecutionAttemptRead[] = [],
  artifactKind?: string,
  artifactFile?: string,
): string | undefined {
  const current = latestArtifactAttempts(artifactId, attempts, artifactKind, artifactFile)[0]
  if (current?.runId !== undefined) return current.runId
  return projectArtifactExecution(artifactId, attempts, artifactKind, false, 'pending', artifactFile).runId
}

/** Latest Host-verified artifact receipt, used before canonical integration catches up. */
export function projectArtifactReceipt(
  artifactId: string,
  attempts: readonly ExecutionAttemptRead[] = [],
  artifactKind?: string,
  artifactFile?: string,
): ExecutionAttemptRead['receipt'] | undefined {
  const latest = latestArtifactAttempts(artifactId, attempts, artifactKind, artifactFile)[0]
  return latest?.phase === 'completed' ? latest.receipt : undefined
}

/** A bound file may be previewed while its executor is still validating or repairing it. */
export function projectArtifactFile(
  artifactId: string,
  attempts: readonly ExecutionAttemptRead[],
  artifactKind: string,
  artifactFiles: Readonly<Record<string, string>>,
  artifactFile?: string,
  activities: readonly DesignArtifactActivityRead[] = [],
): string | undefined {
  const association = artifactActivity(artifactId, activities, artifactKind, artifactFile)
  const latest = latestArtifactAttempts(artifactId, activityAttempts(association, attempts), artifactKind, artifactFile)[0]
  if (!latest && association && artifactFiles[association.artifactFile] !== undefined) return association.artifactFile
  const path = latest?.artifactFile ?? latest?.receipt?.path
  return path !== undefined && artifactFiles[path] !== undefined ? path : undefined
}
