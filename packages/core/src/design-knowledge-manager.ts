/** Project lifecycle and routing for provider-neutral Design Knowledge. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { isAbsolute, resolve } from 'node:path'
import type { DesignKnowledgeProviderId, DesignProjectId } from './design-project.ts'
import type { DesignKnowledgeService } from './design-knowledge.ts'

/** Process-local identity of one session's lease on a Design Project provider. */
export type DesignKnowledgeLeaseId = Branded<'DesignKnowledgeLeaseId'>

/** Validate and brand a non-empty lease identity. */
export function DesignKnowledgeLeaseId(value: string): DesignKnowledgeLeaseId {
  if (value.trim() === '' || Buffer.byteLength(value, 'utf8') > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`invalid Design Knowledge lease id ${JSON.stringify(value)}`)
  }
  return value as DesignKnowledgeLeaseId
}

/** External runtime location of one registered Design Project. */
export interface DesignKnowledgeProjectLocation {
  readonly projectId: DesignProjectId
  /** Exact provider selected by this project's project.json. */
  readonly provider: DesignKnowledgeProviderId
  /** Runtime state outside the user-owned project Git repository. */
  readonly stateRoot: string
}

/** One opened provider handle owned by the lifecycle manager. */
export interface DesignKnowledgeProjectHandle {
  readonly projectId: DesignProjectId
  readonly service: DesignKnowledgeService
  close(): Promise<void>
}

/** Internal provider factory selected by the host composition. */
export interface DesignKnowledgeProviderFactory {
  open(location: DesignKnowledgeProjectLocation): Promise<DesignKnowledgeProjectHandle>
}

/** Host-only lifecycle API; G/R/A consumers receive only {@link DesignKnowledgeService}. */
export interface DesignKnowledgeAdministration {
  acquireProject(location: DesignKnowledgeProjectLocation, leaseId: DesignKnowledgeLeaseId): Promise<void>
  releaseProject(projectId: DesignProjectId, leaseId: DesignKnowledgeLeaseId): Promise<void>
  shutdown(): Promise<void>
}

interface ProjectEntry {
  readonly location: DesignKnowledgeProjectLocation
  readonly handle: DesignKnowledgeProjectHandle
  readonly leases: Set<DesignKnowledgeLeaseId>
  mutationTail: Promise<void>
}

function requireStateRoot(value: string): string {
  if (value === '' || !isAbsolute(value) || resolve(value) !== value) {
    throw new Error(`design knowledge manager: stateRoot must be a normalized absolute path: ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Owns one provider handle per selected Design Project and exposes a data-only
 * facade to advisory consumers. Mutations are serialized per project; the
 * provider still performs transactional Pin validation and cross-process CAS.
 */
export class DesignKnowledgeManager implements DesignKnowledgeAdministration {
  readonly service: DesignKnowledgeService
  readonly #factory: DesignKnowledgeProviderFactory
  readonly #projects = new Map<DesignProjectId, ProjectEntry>()
  readonly #opening = new Map<DesignProjectId, Promise<ProjectEntry>>()
  #lifecycleTail: Promise<void> = Promise.resolve()
  #closed = false

  /** @param factory - provider implementation selected by the host. */
  constructor(factory: DesignKnowledgeProviderFactory) {
    this.#factory = factory
    const service: DesignKnowledgeService = {
      revision: async (projectId) => this.#read(projectId, service => service.revision(projectId)),
      applyDelta: async (delta) => this.#mutate(delta.pin.projectId, service => service.applyDelta(delta)),
      query: async (request) => this.#read(request.projectId, service => service.query(request)),
      trace: async (request) => this.#read(request.projectId, service => service.trace(request)),
      impact: async (request) => this.#read(request.projectId, service => service.impact(request)),
      propose: async (proposal, pin) => {
        this.#requireSameProject(proposal.projectId, pin.projectId, 'proposal')
        return this.#mutate(pin.projectId, service => service.propose(proposal, pin))
      },
      proposeBatch: async (batch) => {
        for (const proposal of batch.proposals) this.#requireSameProject(proposal.projectId, batch.pin.projectId, 'proposal batch')
        return this.#mutate(batch.pin.projectId, service => service.proposeBatch(batch))
      },
      applyDecision: async (decision, pin) => {
        this.#requireSameProject(decision.projectId, pin.projectId, 'decision')
        return this.#mutate(pin.projectId, service => service.applyDecision(decision, pin))
      },
      exportProject: async (projectId, revision) => this.#read(projectId, service => service.exportProject(projectId, revision)),
      importProject: async (archive) => this.#mutate(archive.projectId, service => service.importProject(archive)),
    }
    this.service = Object.freeze(service)
  }

  /** Acquire or share the exact project's provider handle. */
  async acquireProject(location: DesignKnowledgeProjectLocation, leaseId: DesignKnowledgeLeaseId): Promise<void> {
    await this.#serializeLifecycle(async () => {
      if (this.#closed) throw new Error('design knowledge manager: manager is shut down')
      const normalized = Object.freeze({ projectId: location.projectId, provider: location.provider, stateRoot: requireStateRoot(location.stateRoot) })
      const existing = this.#projects.get(location.projectId)
      if (existing !== undefined) {
        this.#requireLocation(existing.location, normalized)
        if (existing.leases.has(leaseId)) return
        existing.leases.add(leaseId)
        return
      }
      const entry = await this.#open(normalized)
      this.#requireLocation(entry.location, normalized)
      entry.leases.add(leaseId)
    })
  }

  /** Release one lease and close the handle after its mutation queue drains. */
  async releaseProject(projectId: DesignProjectId, leaseId: DesignKnowledgeLeaseId): Promise<void> {
    await this.#serializeLifecycle(async () => {
      const entry = this.#projects.get(projectId)
      if (entry === undefined || !entry.leases.has(leaseId)) {
        throw new Error(`design knowledge manager: lease ${JSON.stringify(leaseId)} does not own project ${JSON.stringify(projectId)}`)
      }
      if (entry.leases.size > 1) {
        entry.leases.delete(leaseId)
        return
      }
      await entry.mutationTail
      await entry.handle.close()
      entry.leases.delete(leaseId)
      this.#projects.delete(projectId)
    })
  }

  /** Drain and close every opened provider handle. */
  async shutdown(): Promise<void> {
    await this.#serializeLifecycle(async () => {
      if (this.#closed) return
      const opening = [...this.#opening.values()]
      const opened = await Promise.allSettled(opening)
      const entries = new Set(this.#projects.values())
      for (const result of opened) if (result.status === 'fulfilled') entries.add(result.value)
      const candidates = [...entries]
      const closed = await Promise.allSettled(candidates.map(async (entry) => {
        await entry.mutationTail
        await entry.handle.close()
      }))
      for (let index = 0; index < closed.length; index += 1) {
        if (closed[index]?.status !== 'fulfilled') continue
        const entry = candidates[index] as ProjectEntry
        if (this.#projects.get(entry.location.projectId) === entry) this.#projects.delete(entry.location.projectId)
      }
      const failures = closed.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) {
        throw new AggregateError(failures.map(result => result.reason), 'design knowledge manager: shutdown failed')
      }
      this.#closed = true
    })
  }

  async #serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const execution = this.#lifecycleTail.then(operation, operation)
    this.#lifecycleTail = execution.then(() => undefined, () => undefined)
    return execution
  }

  async #open(location: DesignKnowledgeProjectLocation): Promise<ProjectEntry> {
    const pending = this.#opening.get(location.projectId)
    if (pending !== undefined) return pending
    const opening = this.#factory.open(location).then((handle) => {
      if (handle.projectId !== location.projectId) {
        return handle.close().then(() => { throw new Error('design knowledge manager: provider opened the wrong project') })
      }
      const entry: ProjectEntry = { location, handle, leases: new Set(), mutationTail: Promise.resolve() }
      this.#projects.set(location.projectId, entry)
      return entry
    }).finally(() => { this.#opening.delete(location.projectId) })
    this.#opening.set(location.projectId, opening)
    return opening
  }

  async #read<T>(projectId: DesignProjectId, operation: (service: DesignKnowledgeService) => Promise<T>): Promise<T> {
    const entry = this.#requireProject(projectId)
    return operation(entry.handle.service)
  }

  async #mutate<T>(projectId: DesignProjectId, operation: (service: DesignKnowledgeService) => Promise<T>): Promise<T> {
    const entry = this.#requireProject(projectId)
    const result = entry.mutationTail.then(() => operation(entry.handle.service), () => operation(entry.handle.service))
    entry.mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  #requireProject(projectId: DesignProjectId): ProjectEntry {
    if (this.#closed) throw new Error('design knowledge manager: manager is shut down')
    const entry = this.#projects.get(projectId)
    if (entry === undefined || entry.leases.size === 0) {
      throw new Error(`design knowledge manager: project ${JSON.stringify(projectId)} is not acquired`)
    }
    return entry
  }

  #requireLocation(actual: DesignKnowledgeProjectLocation, requested: DesignKnowledgeProjectLocation): void {
    if (actual.provider !== requested.provider) {
      throw new Error(`design knowledge manager: project ${JSON.stringify(actual.projectId)} is already bound to provider ${JSON.stringify(actual.provider)}`)
    }
    if (actual.stateRoot !== requested.stateRoot) {
      throw new Error(`design knowledge manager: project ${JSON.stringify(actual.projectId)} is already bound to another state root`)
    }
  }

  #requireSameProject(left: DesignProjectId, right: DesignProjectId, operation: string): void {
    if (left !== right) throw new Error(`design knowledge manager: ${operation} project does not match its Pin`)
  }
}
