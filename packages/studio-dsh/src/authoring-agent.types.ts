import type { Agent } from '@deepseek-ai/dsh-agent'

export interface StudioAuthoringScope {
  readonly id: string
  readonly expectedRevision: number
  /** Initial read focus; subsequent reads and file changes stay in this bound object/revision. */
  readonly allowedPaths: readonly string[]
  readonly bundle?: Readonly<{ name: string; version: string }>
}

/** The existing S3 capability. Its receipt remains the sole candidate source. */
export interface StudioAuthoringPorts {
  read(input?: { paths?: string[] }): Promise<unknown>
  prepare(input: { changes: { path: string; content: string }[] }): Promise<unknown>
}

export interface StudioAuthoringReference {
  readonly sessionId: string
  readonly parentSessionId: string
  readonly invocationId: string
  readonly epoch: string
  readonly messageId: string
  readonly afterSeq: number
  readonly scope: StudioAuthoringScope
}

export interface StudioAuthoringObservation {
  readonly reference: StudioAuthoringReference
  readonly status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed' | 'unknown'
  readonly consumed: boolean
  readonly turn: number | null
  readonly terminal: boolean
  readonly reason?: string
  readonly throughSeq: number
  readonly source: 'live' | 'prepared'
  /** This adapter witnessed a successful scoped native flush; prepared-cache reads alone do not prove it. */
  readonly durable: boolean
  readonly pendingInput: boolean
  readonly diagnostic?: string
  /** Public messages and tool activity from this invocation's native event range. */
  readonly conversation?: {
    readonly rows: readonly { id: string; role: 'assistant' | 'tool'; label: string; text: string; status: string }[]
    readonly omitted: number
  }
}

export interface StudioAuthoringRequest {
  readonly parent: Agent
  readonly invocationId: string
  readonly scope: StudioAuthoringScope
  readonly workspaceRoot: string
  readonly prompt: string
  readonly ports: StudioAuthoringPorts
  readonly signal?: AbortSignal
  /** Retain this native address before the adapter attempts dispatch. */
  readonly onReference?: (reference: StudioAuthoringReference) => void | Promise<void>
  /** A projection of the successful S3 tool receipt, not execution completion. */
  readonly onPrepared?: (receipt: unknown) => void | Promise<void>
}

export interface StudioAuthoringResumeRequest extends StudioAuthoringRequest {
  readonly previous: StudioAuthoringReference
  readonly explicit: true
}

export interface StudioAuthoringRun {
  readonly reference: StudioAuthoringReference
  readonly result: Promise<StudioAuthoringObservation>
  observe(): Promise<StudioAuthoringObservation>
  /** null fences an invocation whose native turn has not started. */
  cancel(options: { expectedTurn: number | null }): Promise<StudioAuthoringObservation>
  readPrepared(): unknown | undefined
  dispose(): Promise<void>
}
