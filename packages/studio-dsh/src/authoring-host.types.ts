import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { StudioInstances } from 'dsh-design-studio/node'
import type { DesignBundleVersionPin, StudioInstanceChangeRequest } from 'dsh-design-studio'
import type { DshStudioInstanceSources } from './authoring-sources.ts'
import type { StudioAuthoringObservation, StudioAuthoringReference } from './authoring-agent.types.ts'
import type { StudioAuthoringSessionOptions, StudioSessionPrepared, StudioSessionRun, StudioSessionStart } from './authoring-session.types.ts'
import type { DshStudioContent } from './authoring-content.ts'
import type DesignService from 'dsh-design-core'

/** A locator, never a caller-supplied parent, source scope or native authority. */
export type StudioAuthoringAddress = Pick<StudioAuthoringReference, 'sessionId' | 'epoch'>
/** Exact browser locator; the live Host parent and S2 still supply authority. */
export interface StudioPreparedLocator {
  readonly requestId: string
  readonly id: string
  readonly expectedRevision: number
  readonly digest: string
  readonly bundle?: DesignBundleVersionPin
}
export interface StudioPreparedProjection {
  readonly locator: StudioPreparedLocator
  readonly prepared: StudioSessionPrepared
}
export interface DshStudioAuthoringHostOptions extends DshStudioInstanceSources {
  readonly design: DshStudioInstanceSources['design'] & Pick<DesignService, 'registerCurrentKitSource' | 'listKits'>
  readonly ctx: Context
  readonly stateRoot: string
  readonly workspaceRoot: string
  readonly readComponents: StudioAuthoringSessionOptions['readComponents']
}
export interface DshStudioAuthoringParent {
  /** Guarded ports over the Host's ONE shared S2 service, not private Agent records. */
  readonly instances: StudioInstances
  readonly content: DshStudioContent
  /** Retain a bounded projection of the existing S2 preparation, without saving. */
  prepareChanges(request: StudioInstanceChangeRequest): Promise<StudioPreparedProjection>
  readReference(address: StudioAuthoringAddress): Promise<StudioAuthoringReference | undefined>
  listReferences(): Promise<readonly StudioAuthoringReference[]>
  start(request: StudioSessionStart): Promise<StudioSessionRun>
  resume(request: StudioSessionStart & { readonly previous: StudioAuthoringAddress; readonly explicit: true }): Promise<StudioSessionRun>
  observe(address: StudioAuthoringAddress): Promise<StudioAuthoringObservation>
  cancel(address: StudioAuthoringAddress, options: { readonly expectedTurn: number | null }): Promise<StudioAuthoringObservation>
  readPrepared(address: StudioAuthoringAddress | StudioPreparedLocator): Promise<StudioSessionPrepared | undefined>
  /** Permanently close this facade, cancel/release S4, then join admitted I/O. */
  dispose(): Promise<void>
}
export interface DshStudioAuthoringHost {
  /** Stable for the same live object; a same-ID replacement never inherits handles. */
  forParent(parent: Agent): DshStudioAuthoringParent
  dispose(): Promise<void>
}
