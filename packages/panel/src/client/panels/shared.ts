/** Shared panel host contract for the five skill panels. */

/** Browser wire result for one bounded binary Design File artifact. */
export interface BinaryArtifactRead {
  readonly found: boolean
  readonly mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'
  /** Raw base64 without a Data URL prefix. */
  readonly base64: string
  readonly byteLength: number
}

/**
 * Every skill panel receives its draft (local edits), a change callback that
 * replaces the draft, the host-confirmed original (identity flips on save
 * echoes / agent writes — used to rehydrate artifacts), and bounded artifact
 * readers for Design Files content.
 */
/** Callable cleanup remains compatible with existing editor registrations. */
export type BeforeSaveRegistration = (() => void) & {
  /** Transient editor input only; never serialized into Design Files. */
  setPending?: (pending: boolean) => void
}

export interface SkillPanelProps {
  draft: unknown
  onChange: (next: unknown) => void
  originalState: unknown
  artifactFiles?: Readonly<Record<string, string>>
  readArtifact: (relPath: string, revision?: string) => Promise<{ found: boolean; content: string }>
  /** Exact committed source revision, not a transient worktree revision. */
  sourceRevision?: string
  readBinaryArtifact: (relPath: string) => Promise<BinaryArtifactRead>
  artifactActivities?: readonly import('../types.ts').DesignArtifactActivityRead[]
  executionAttempts?: readonly import('../types.ts').DesignPanelWorkspaceRead['executionAttempts'][number][]
  readExecutionLog?: (executionRef: string, afterSeq?: number, target?: import('../types.ts').DesignArtifactLogTarget) => Promise<import('../types.ts').DesignExecutionLogRead>
  /** Trusted editor serialization is awaited before the host snapshots a draft. */
  registerBeforeSave?: (flush: () => Promise<void>) => BeforeSaveRegistration
}
