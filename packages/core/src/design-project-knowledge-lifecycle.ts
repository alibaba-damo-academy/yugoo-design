/** Session-bound Design Project lifecycle over the provider-neutral knowledge manager. */
import type { DesignKnowledgeAdministration } from './design-knowledge-manager.ts'
import type { DesignKnowledgeService } from './design-knowledge.ts'
import type { DesignProjectId } from './design-project.ts'
import type { DesignKnowledgeProviderId } from './design-project.ts'
import type {
  DesignProjectRecord,
  DesignProjectSelectionLifecycle,
  DesignProjectSelectionPreparation,
  DesignProjectSnapshot,
} from './design-project-adapter.ts'
import type { DesignKnowledgeLeaseId } from './design-knowledge-manager.ts'

/** Project materialization invoked after its provider handle is acquired. */
export type DesignProjectKnowledgeMaterializer = (
  record: DesignProjectRecord,
  snapshot: DesignProjectSnapshot,
  knowledge: DesignKnowledgeService,
) => Promise<void>

/** Dependencies for one session-bound project knowledge lifecycle. */
export interface DesignProjectKnowledgeLifecycleOptions {
  readonly administration: DesignKnowledgeAdministration
  readonly service: DesignKnowledgeService
  readonly leaseId: DesignKnowledgeLeaseId
  readonly materialize: DesignProjectKnowledgeMaterializer
}

/** Provider-neutral runtime registered by one host composition. */
export interface DesignProjectKnowledgeRuntime {
  /** Persist settled graph facts in the owning project's Git-tracked archive. */
  readonly persistProjectRecords?: (projectId: DesignProjectId) => Promise<void>
  readonly recoveryStatus?: (projectId: DesignProjectId) => { state: 'rebuilding' | 'ready' | 'error'; message: string; generation?: string } | undefined
  readonly retryRecovery?: (projectId: DesignProjectId) => void
  readonly semantic?: import('./design-semantic.ts').SemanticGraphRuntime
  readonly defaultProvider: DesignKnowledgeProviderId
  readonly administration: DesignKnowledgeAdministration
  readonly service: DesignKnowledgeService
}

/**
 * Owns at most one selected-project lease for one host session. A target is
 * acquired and materialized before selection facts append; the prior project
 * is released only after those facts commit.
 */
export class DesignProjectKnowledgeLifecycle implements DesignProjectSelectionLifecycle {
  readonly #administration: DesignKnowledgeAdministration
  readonly #service: DesignKnowledgeService
  readonly #leaseId: DesignKnowledgeLeaseId
  readonly #materialize: DesignProjectKnowledgeMaterializer
  #selected: DesignProjectId | null = null
  #pending = false
  #restoring?: { projectId: DesignProjectId; task: Promise<void> }
  #disposing?: Promise<void>

  /** @param options - neutral manager, session lease, and journal materializer. */
  constructor(options: DesignProjectKnowledgeLifecycleOptions) {
    this.#administration = options.administration
    this.#service = options.service
    this.#leaseId = options.leaseId
    this.#materialize = options.materialize
  }

  async prepare(
    previousProjectId: DesignProjectId | null,
    record: DesignProjectRecord,
    snapshot: DesignProjectSnapshot,
  ): Promise<DesignProjectSelectionPreparation> {
    if (this.#restoring) await this.#restoring.task
    if (this.#pending) throw new Error('design project knowledge: another selection is being prepared')
    if (previousProjectId !== this.#selected) {
      throw new Error('design project knowledge: durable selection and owned provider lease disagree')
    }
    if (record.projectId === previousProjectId) {
      return Object.freeze({ abort: async () => {}, finalize: async () => ({}) })
    }
    this.#pending = true
    try {
      await this.#acquireAndMaterialize(record, snapshot)
    } catch (error) {
      this.#pending = false
      throw error
    }
    let settled = false
    const settle = (): void => {
      if (settled) throw new Error('design project knowledge: selection preparation is already settled')
      settled = true
      this.#pending = false
    }
    return Object.freeze({
      abort: async () => {
        settle()
        await this.#administration.releaseProject(record.projectId, this.#leaseId)
      },
      finalize: async () => {
        settle()
        const previous = this.#selected
        this.#selected = record.projectId
        if (previous === null) return {}
        try {
          await this.#administration.releaseProject(previous, this.#leaseId)
          return {}
        } catch (error) {
          return { warning: `Design Knowledge could not finish closing project ${JSON.stringify(previous)}: ${error instanceof Error ? error.message : String(error)}` }
        }
      },
    })
  }

  async close(projectId: DesignProjectId): Promise<void> {
    if (this.#restoring) await this.#restoring.task
    if (this.#pending) throw new Error('design project knowledge: cannot close during selection preparation')
    if (this.#selected !== projectId) throw new Error('design project knowledge: selected provider lease does not match close request')
    await this.#administration.releaseProject(projectId, this.#leaseId)
    this.#selected = null
  }

  async restore(record: DesignProjectRecord, snapshot: DesignProjectSnapshot): Promise<void> {
    if (this.#restoring) {
      if (this.#restoring.projectId !== record.projectId) throw new Error('design project knowledge: another project is being restored')
      return this.#restoring.task
    }
    if (this.#pending) throw new Error('design project knowledge: cannot restore during selection preparation')
    if (this.#selected === record.projectId) return
    if (this.#selected !== null) throw new Error('design project knowledge: cannot restore over another selected provider lease')
    const task = this.#acquireAndMaterialize(record, snapshot).then(() => { this.#selected = record.projectId })
    this.#restoring = { projectId: record.projectId, task }
    try { await task } finally { if (this.#restoring?.task === task) this.#restoring = undefined }
  }

  async dispose(): Promise<void> {
    if (this.#disposing) return this.#disposing
    const task = this.#disposeLease()
    this.#disposing = task
    try { await task } finally { if (this.#disposing === task) this.#disposing = undefined }
  }

  async #disposeLease(): Promise<void> {
    if (this.#restoring) await this.#restoring.task.catch(() => {})
    if (this.#pending) throw new Error('design project knowledge: cannot dispose during selection preparation')
    const selected = this.#selected
    if (selected === null) return
    await this.#administration.releaseProject(selected, this.#leaseId)
    this.#selected = null
  }

  async #acquireAndMaterialize(record: DesignProjectRecord, snapshot: DesignProjectSnapshot): Promise<void> {
    await this.#administration.acquireProject({
      projectId: record.projectId,
      provider: record.knowledge.provider,
      stateRoot: record.stateRoot,
    }, this.#leaseId)
    try {
      await this.#materialize(record, snapshot, this.#service)
    } catch (error) {
      try {
        await this.#administration.releaseProject(record.projectId, this.#leaseId)
      } catch (releaseError) {
        throw new AggregateError([error, releaseError], 'design project knowledge: materialization and lease release both failed')
      }
      throw error
    }
  }
}
