/** Native executor-to-artifact association, independent of attempts and Design state. */
export interface DesignArtifactLogTarget {
  readonly artifactId: string
  readonly invocationId?: string
}

/** Read-only historical activity; never an active execution or a saved design status. */
export interface DesignArtifactHistoryEntry {
  readonly skill: string
  readonly artifactId: string
  readonly artifactKind: string
  readonly artifactFile: string
  readonly invocationId: string
  readonly runId: string
  readonly parentRunId: string
  readonly phase: 'completed' | 'failed' | 'cancelled'
  readonly timestamp: number
  readonly diagnostic?: string
}
export interface DesignArtifactActivityRead {
  readonly executor: 'main' | 'producer'
  readonly projectId: string
  readonly skill: string
  readonly invocationId: string
  /** Actual main conversation or already verified Producer native run. */
  readonly runId: string
  readonly artifactId: string
  readonly artifactKind: string
  readonly artifactFile: string
  readonly active: boolean
  readonly available: boolean
  readonly nativeStatus: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown'
  readonly sequence: number
  readonly logTarget: DesignArtifactLogTarget
}
