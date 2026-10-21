/** Shared panel host contract for the five skill panels. */

/** Browser wire result for one bounded binary Design File artifact. */
export interface BinaryArtifactRead {
  readonly found: boolean
  readonly mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'
  /** Raw base64 without a Data URL prefix. */
  readonly base64: string
  readonly byteLength: number
}

export interface ExecutionLogRead {
  readonly found: boolean
  readonly revision: string | null
  /** True when the server returned a full snapshot (cursor cache loss or a changed seed); replace accumulated entries instead of appending. */
  readonly reset: boolean
  readonly entries: readonly {
    readonly seq: number
    readonly timestamp: number
    readonly eventType: 'message' | 'search' | 'fetch' | 'synthesize' | 'error'
    readonly message: string
    readonly url?: string
  }[]
}

export interface ExecutionAttemptRead {
  readonly invocationId: string
  readonly rootCallId?: string
  readonly skill: string
  readonly artifactId: string
  readonly artifactKind?: string
  readonly artifactFile?: string
  readonly attemptId: string
  readonly runId?: string
  readonly parentRunId?: string
  readonly role: 'producer' | 'worker'
  readonly phase: 'queued' | 'working' | 'completed' | 'failed' | 'cancelled'
  readonly diagnostics?: readonly string[]
  readonly receipt?: { readonly path: string; readonly sha256: string; readonly bytes: number }
  readonly sequence: number
  readonly timestamp: number
}

/**
 * Every skill panel receives its draft (local edits), a change callback that
 * replaces the draft, the host-confirmed original (identity flips on save
 * echoes / agent writes — used to rehydrate artifacts), and bounded artifact
 * readers for Design Files content.
 */
export interface SkillPanelProps {
  draft: unknown
  onChange: (next: unknown) => void
  originalState: unknown
  /** Readable nonempty files from the shared workspace poll; values are content hashes. */
  artifactFiles?: Readonly<Record<string, string>>
  /** Host foreground execution or read-only state disables local edits. */
  running?: boolean
  readArtifact: (relPath: string) => Promise<{ found: boolean; content: string }>
  readBinaryArtifact: (relPath: string) => Promise<BinaryArtifactRead>
  readExecutionLog?: (executionRef: string, afterSeq?: number) => Promise<ExecutionLogRead>
  executionAttempts?: readonly ExecutionAttemptRead[]
}
