import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { StudioInstanceCandidate, StudioInstanceChangeRequest, DesignBundleVersionPin } from 'dsh-design-studio'
import type { StudioAuthoringComponentCatalog, StudioAwaitable, StudioInstances } from 'dsh-design-studio/node'
import type { StudioAuthoringObservation, StudioAuthoringReference } from './authoring-agent.types.ts'

/** A projection of the existing S2/S1 receipt, not another candidate authority. */
export interface StudioSessionPrepared {
  readonly request: StudioInstanceChangeRequest
  readonly candidate: StudioInstanceCandidate
}
export interface StudioAuthoringSessionOptions {
  readonly ctx: Context
  readonly parent: Agent
  readonly instances: Pick<StudioInstances, 'read' | 'readFile' | 'prepareChanges'> & Partial<Pick<StudioInstances, 'readMountedBundle'>>
  readonly readComponents: () => StudioAwaitable<StudioAuthoringComponentCatalog>
  /** Host-selected isolated workspace, never a browser-supplied path. */
  readonly workspaceRoot: string
  /** Caller persists the native address before H2 attempts dispatch. */
  readonly retainReference: (reference: StudioAuthoringReference) => void | Promise<void>
}
export interface StudioSessionStart {
  readonly invocationId: string
  readonly id: string
  readonly expectedRevision: number
  readonly paths: readonly string[]
  readonly bundle?: DesignBundleVersionPin
  readonly prompt: string
  readonly signal?: AbortSignal
  readonly onPrepared?: (prepared: StudioSessionPrepared) => void | Promise<void>
}
export interface StudioSessionResume extends StudioSessionStart {
  readonly previous: StudioAuthoringReference
  readonly explicit: true
}
export interface StudioSessionRun {
  readonly reference: StudioAuthoringReference
  /** Native turn outcome, independently of candidate validity or user save. */
  readonly result: Promise<StudioAuthoringObservation>
  observe(): Promise<StudioAuthoringObservation>
  cancel(options: { readonly expectedTurn: number | null }): Promise<StudioAuthoringObservation>
  readPrepared(): StudioSessionPrepared | undefined
}
export interface StudioAuthoringSession {
  start(request: StudioSessionStart): Promise<StudioSessionRun>
  resume(request: StudioSessionResume): Promise<StudioSessionRun>
  observe(reference: StudioAuthoringReference): Promise<StudioAuthoringObservation>
  /** Only this session object's exact retained run handle can be cancelled. */
  cancel(reference: StudioAuthoringReference, options: { readonly expectedTurn: number | null }): Promise<StudioAuthoringObservation>
  readPrepared(reference: StudioAuthoringReference): StudioSessionPrepared | undefined
  dispose(): Promise<void>
}
