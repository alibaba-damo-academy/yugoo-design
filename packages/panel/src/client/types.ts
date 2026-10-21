import type { DesignArtifactActivityRead } from '../../../core/src/artifact-activity.ts'
export type { DesignArtifactActivityRead, DesignArtifactLogTarget } from '../../../core/src/artifact-activity.ts'
/** Host-neutral projection and manifest types consumed by the design dock. */
import { equalClarityViews } from './clarity.ts'
import type { DesignAdvisoryRuntimeStatus, DesignClarityActivity, DesignClarityExplanation } from 'dsh-design-core'
import type { DesignContinuationDescriptor, DesignMustEditHandoffDescriptor } from 'dsh-design-core/design-continuation'

/** The skill.yaml manifest slice the tabs bar consumes. */
export interface SkillManifestLite {
  name?: string
  title?: { zh?: string; en?: string }
  label?: { zh?: string; en?: string }
  order?: number
  icon?: string
  presentation?: unknown
}

/** One plugin workspace fold entry (latest state per skill). */
export interface DesignProjectionEntry {
  state: unknown
  panelYaml?: string
  skillManifest?: Record<string, unknown>
  origin?: 'agent' | 'panel'
  /** Journal revision of the latest live Design File publication; absent on older entries. */
  changedSeq?: number
}

/** Plugin workspace DesignJournal fold: skill -> latest entry. */
export type DesignProjection = Record<string, DesignProjectionEntry>

/** Native child-session activity; observability only, never Design state. */
export interface DesignExecutionLogRead {
  found: boolean
  revision: string | null
  /** True when the server returned a full snapshot (cursor cache loss or a changed seed); replace accumulated entries instead of appending. */
  reset: boolean
  entries: readonly {
    seq: number
    timestamp: number
    eventType: 'message' | 'search' | 'fetch' | 'synthesize' | 'error'
    message: string
    url?: string
  }[]
}

/** Registered projects newest-first plus installed Mindsets. */
export interface DesignProjectCatalogRead {
  currentProjectId: string | null
  projects: readonly {
    projectId: string
    name: string
    root: string
    updatedAt: string
    kit?: { name: string; version: string }
  }[]
  mindsets: readonly {
    name: string
    version: string
    description?: string
  }[]
}

/** Browser-safe plugin-owned Design workspace response. */
export interface DesignPanelWorkspaceRead {
  projectId: string | null
  /** Human-readable selected Design Project name, or null before binding. */
  projectName: string | null
  /** Selected Design Project system directory, or null before `/yugoo new|open`. */
  projectPath: string | null
  checkpoint: string | null
  /** Content identity of the current parseable Design Files worktree. */
  worktreeRevision: string | null
  publicationError?: string
  artifactFiles?: Readonly<Record<string, string>>
  experienceFiles?: Readonly<Record<string, string>>
  artifactActivities?: readonly DesignArtifactActivityRead[]
  executionRevision: number
  /** Native main Bundle registrations awaiting explicit settlement, not process liveness. */
  activeMainBundles?: readonly { skill: string; invocationId: string }[]
  executionAttempts: readonly {
    projectId: string
    invocationId: string
    rootCallId?: string
    skill: string
    artifactId: string
    artifactKind?: string
    artifactFile?: string
    attemptId: string
    runId?: string
    parentRunId?: string
    role: 'producer' | 'worker'
    phase: 'queued' | 'working' | 'completed' | 'failed' | 'cancelled'
    diagnostics?: readonly string[]
    receipt?: { path: string; sha256: string; bytes: number }
    sequence: number
    timestamp: number
  }[]
  /** Project access derived from the authoritative Kit pin at read time. */
  access:
    | { mode: 'unbound'; writable: false }
    | { mode: 'unconfigured'; writable: false }
    | {
        mode: 'recovery'
        writable: false
        kit: { name: string; version: string }
        upgradeCommand?: string
      }
    | {
        mode: 'writable'
        writable: true
        kit: { name: string; version: string }
      }
  journalRevision: number
  design: DesignProjection
  /** Validated project-local derived manifests for explicit auto Panels. */
  autoPanelManifests?: Readonly<Record<string, string>>
  autoPanelDefinitions?: Readonly<Record<string, { origin?: 'generated' | 'retained'; definitionRevision?: string; sourceChanged?: boolean; error?: string }>>
  /** Process-local generated Panel progress; no authority to save. */
  autoPanelStates?: Readonly<Record<string, { phase: 'awaiting-agent' | 'queued' | 'running' | 'ready' | 'failed'; target: string;
    detail?: string; attempts?: number; durationMs?: number; fallbackReason?: string }>>
  /** Real Runtime-derived user-continue gates. */
  continuations: readonly DesignContinuationDescriptor[]
  /** Display-only edit gates; never a second save or continuation authority. */
  mustEditHandoffs: readonly DesignMustEditHandoffDescriptor[]
  /** Read-only GRA scheduler observation; independent of pending advisory count and U/S/T. */
  advisoryRuntime?: DesignAdvisoryRuntimeStatus
  clarity: {
    assessment: {
      kit: string
      version: string
      u: number
      s: number
      t: number
    } | null
    needsReassessment: boolean
    explanation?: DesignClarityExplanation
    activity?: DesignClarityActivity
  }
  latestDesignChange?: {
    skill: string
    journalRevision: number
  }
}

/**
 * Compare two workspace emissions for listener-visible change. The clarity
 * view participates exactly, so an authority-only repair (same checkpoint
 * and journal revision) still reaches workspace listeners.
 * @param previous - the last emitted workspace snapshot.
 * @param next - the newly polled workspace snapshot.
 * @returns true when a listener cannot observe any difference.
 */
export function equalWorkspaceEmission(
  previous: DesignPanelWorkspaceRead,
  next: DesignPanelWorkspaceRead,
): boolean {
  if (previous === next) return true
  return previous.projectId === next.projectId
    && previous.projectName === next.projectName
    && previous.projectPath === next.projectPath
    && previous.checkpoint === next.checkpoint
    && previous.worktreeRevision === next.worktreeRevision
    && previous.publicationError === next.publicationError
    && JSON.stringify(previous.access) === JSON.stringify(next.access)
    && JSON.stringify(Object.entries(previous.design).map(([name, value]) => [name, value.panelYaml, value.skillManifest]))
      === JSON.stringify(Object.entries(next.design).map(([name, value]) => [name, value.panelYaml, value.skillManifest]))
    && previous.executionRevision === next.executionRevision
    && JSON.stringify(previous.activeMainBundles) === JSON.stringify(next.activeMainBundles)
    && previous.journalRevision === next.journalRevision
    && JSON.stringify(previous.autoPanelManifests) === JSON.stringify(next.autoPanelManifests)
    && JSON.stringify(previous.autoPanelDefinitions) === JSON.stringify(next.autoPanelDefinitions)
    && JSON.stringify(previous.autoPanelStates) === JSON.stringify(next.autoPanelStates)
    && JSON.stringify(previous.continuations) === JSON.stringify(next.continuations)
    && JSON.stringify(previous.mustEditHandoffs) === JSON.stringify(next.mustEditHandoffs)
    && JSON.stringify(previous.advisoryRuntime) === JSON.stringify(next.advisoryRuntime)
    && equalClarityViews(previous.clarity, next.clarity)
}

/** One Design advisory projected for human review. */
export interface DesignAdvisoryProjectionEntry {
  publishedAt?: number
  publishedRevision?: number
  advisory: {
    id: string
    profile: string
    kind: 'reminder' | 'suggestion'
    attention: 'next-boundary' | 'human-review'
    summary: string
    items: readonly {
      id: string
      title: string
      detail: string
      rationale?: string
      references: readonly string[]
    }[]
    acceptanceInstruction?: string
    actionSpec?: { readonly kind: string }
  }
  status: 'pending' | 'accepted' | 'rejected' | 'deferred' | 'queued' | 'running' | 'failed' | 'needs-user-input' | 'completed' | 'invalidated'
  acceptanceReceiptId?: string
  actionReceipts?: readonly {
    actionId: string
    receiptId: string
    target: {
      kitName: string
      kitVersion: string
      skillName: string
      bundleVersion: string
      entityRefs: readonly string[]
    }
    state: 'ready' | 'running' | 'failed' | 'needs-user-input' | 'completed'
    logicalInvocationId?: string
    attemptId?: string
  }[]
  executionStatus?: 'not-applicable' | 'ready' | 'running' | 'failed' | 'needs-user-input' | 'completed'
  selection?: {
    advisoryId: string
    acceptanceReceiptId: string
    kind: 'bundle' | 'host-question' | 'host-research' | 'no-action'
    reason: string
    actions: readonly Pick<NonNullable<DesignAdvisoryProjectionEntry['actionReceipts']>[number], 'actionId' | 'receiptId' | 'target'>[]
    journalRevision: number
  }
  /** True when the inputs need revalidation; never a visibility/terminal flag. */
  stale: boolean
}

/** Plain-record guard shared by the generic renderers. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
