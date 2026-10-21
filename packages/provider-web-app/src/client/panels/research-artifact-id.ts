/** Client-visible artifact identity for one Research direction across retries. */
export function researchDirectionArtifactId(roundId: string, directionId: string): string {
  return `research/${encodeURIComponent(roundId)}/direction/${encodeURIComponent(directionId)}`
}

/** Stable artifact identity for one Research round conclusion. */
export function researchConclusionArtifactId(roundId: string): string {
  return `research/${encodeURIComponent(roundId)}/conclusion`
}
