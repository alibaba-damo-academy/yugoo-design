/** Pure Research projection from the current canonical file. */
import type { ResearchDirection, ResearchState } from '../types.ts'
import { projectArtifactFile, projectArtifactStatus, projectRootExecution } from './artifact-status-projection.ts'

/** Runtime identity for a direction whose local D-xxx id may repeat by round. */
export function researchDirectionArtifactId(roundId: string, directionId: string): string {
  return `${roundId}/${directionId}`
}

function currentInvocationAttempts(
  attempts: readonly import('./shared.ts').ExecutionAttemptRead[],
): readonly import('./shared.ts').ExecutionAttemptRead[] {
  const newest = [...attempts].sort((left, right) => right.sequence - left.sequence)[0]
  return newest === undefined ? [] : attempts.filter(attempt => attempt.invocationId === newest.invocationId)
}

/** Infer the round actually being executed from its explicitly bound artifacts. */
export function researchExecutionRoundId(
  state: ResearchState,
  attempts: readonly import('./shared.ts').ExecutionAttemptRead[] = [],
): string | undefined {
  const rounds = state.rounds ?? {}
  for (const attempt of [...currentInvocationAttempts(attempts)].sort((left, right) => right.sequence - left.sequence)) {
    const boundRound = /^research\/([^/]+)\//u.exec(attempt.artifactFile ?? '')?.[1]
    if (boundRound !== undefined && rounds[boundRound] !== undefined) return boundRound
    if (attempt.artifactKind === 'research_conclusion' && rounds[attempt.artifactId] !== undefined) {
      return attempt.artifactId
    }
    if (attempt.artifactKind !== 'research_direction') continue
    const separator = attempt.artifactId.indexOf('/')
    if (separator > 0) {
      const roundId = attempt.artifactId.slice(0, separator)
      if (rounds[roundId] !== undefined) return roundId
    }
    const receiptRound = /^research\/([^/]+)\//u.exec(attempt.receipt?.path ?? '')?.[1]
    if (receiptRound !== undefined && rounds[receiptRound] !== undefined) return receiptRound
  }
  return undefined
}

/** Normalize Research records at the historical-state compatibility boundary. */
export function projectResearchPanelState(
  state: ResearchState,
  attempts: readonly import('./shared.ts').ExecutionAttemptRead[] = [],
  artifactFiles: Readonly<Record<string, string>> = {},
): ResearchState {
  const invocationAttempts = currentInvocationAttempts(attempts)
  const executionRoundId = researchExecutionRoundId(state, invocationAttempts)
  const visibleCurrentRoundId = executionRoundId ?? state.current_round_id
  const rounds: NonNullable<ResearchState['rounds']> = {}
  for (const [roundId, round] of Object.entries(state.rounds ?? {})) {
    const roundAttempts = roundId === visibleCurrentRoundId ? invocationAttempts : []
    const directions: Record<string, ResearchDirection> = {}
    let missingFindings = false
    for (const [directionId, value] of Object.entries(round.directions ?? {})) {
      const scopedArtifactId = researchDirectionArtifactId(roundId, directionId)
      const hasScopedAttempt = invocationAttempts.some(attempt => attempt.artifactKind === 'research_direction'
        && attempt.artifactId === scopedArtifactId)
      // Legacy attempts used only D-xxx. Keep them confined to the canonical
      // current round; new scoped ids are unambiguous even when that hint is stale.
      const artifactId = hasScopedAttempt ? scopedArtifactId : directionId
      const directionAttempts = hasScopedAttempt ? invocationAttempts : roundAttempts
      const findingsFile = value.findings_file || projectArtifactFile(artifactId, directionAttempts, 'research_direction', artifactFiles, value.findings_file || undefined) || null
      const status = projectArtifactStatus({
        artifactAvailable: findingsFile != null && artifactFiles[findingsFile] !== undefined,
        artifactId,
        artifactKind: 'research_direction',
        artifactFile: findingsFile ?? undefined,
        attempts: directionAttempts,
      })
      directions[directionId] = {
        ...value,
        status,
        findings_file: findingsFile,
      }
      missingFindings ||= findingsFile == null || artifactFiles[findingsFile] === undefined
    }
    const conclusionFile = round.conclusion_file || projectArtifactFile(roundId, roundAttempts, 'research_conclusion', artifactFiles, round.conclusion_file || undefined) || null
    const conclusionStatus = projectArtifactStatus({
      artifactAvailable: conclusionFile != null && artifactFiles[conclusionFile] !== undefined,
      durableStatus: 'pending',
      artifactId: roundId,
      artifactKind: 'research_conclusion',
      artifactFile: conclusionFile ?? undefined,
      attempts: roundAttempts,
    })
    const directionStatuses = Object.values(directions).map(direction => direction.status)
    const rootStatus = projectRootExecution(roundAttempts).status
    const rootActive = rootStatus === 'queued' || rootStatus === 'working'
    const hasActive = conclusionStatus === 'queued' || conclusionStatus === 'working'
      || directionStatuses.some(status => status === 'queued' || status === 'working')
    rounds[roundId] = {
      ...round,
      directions,
      stage: rootActive ? 'researching'
        : conclusionFile != null && artifactFiles[conclusionFile] !== undefined ? (missingFindings ? 'partial' : 'completed')
        : hasActive ? 'researching'
          : round.stage === 'confirmed' ? 'confirmed' : 'identified',
      conclusion_file: conclusionFile,
    }
  }
  return { ...state, rounds, current_round_id: visibleCurrentRoundId }
}
