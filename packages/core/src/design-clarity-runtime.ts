/** Transient Host work around the existing durable clarity authority. */
import type { RegisteredDesignProject } from './design-project-registry.ts'
import type { DesignClarityActivity, DesignKit } from './types.ts'

/** A real Panel publication, recorded only after save and gate settlement. */
export interface SettledDesignPanelSave {
  readonly project: RegisteredDesignProject
  readonly kit: DesignKit
  readonly kitContentHash: string
  readonly eventId: string
  readonly commit: string
  readonly returnedCommit?: string
  readonly meaningful: boolean
}

/** Correlation only: these browser references cannot prove a save or a user turn. */
export interface SavedDesignAssessmentRequest {
  readonly requestId: string
  readonly saves: readonly { readonly eventId: string; readonly commit?: string }[]
}

export type SavedDesignAssessmentAdmission = { readonly status: 'accepted' | 'unchanged' | 'unavailable' }

/** One process-local Host adapter; no scores or durable scheduling state. */
export interface DesignClarityRuntime<Agent> {
  recordPanelSave(agent: Agent, receipt: SettledDesignPanelSave): void
  admitPanelSave(agent: Agent, request: SavedDesignAssessmentRequest): SavedDesignAssessmentAdmission
  activity(agent: Agent, projectId: string): DesignClarityActivity | undefined
}
