/** Invocation-local ownership for guarded artifact candidate writes. */

interface DesignArtifactAttemptOwner {
  readonly role: 'producer' | 'worker'
  /** The executor that focused the artifact or requested the Worker. */
  readonly sessionId: string
}

export interface DesignArtifactAttemptRegistry {
  claim(id: string, attempt: string, owner?: DesignArtifactAttemptOwner): void
  claimAll(ids: readonly string[], attempt: string, owner?: DesignArtifactAttemptOwner): void
  isActive(id: string, attempt: string): boolean
  retire(id: string, attempt: string): boolean
  retireAll(ids: readonly string[], attempt: string): void
}

export function createDesignArtifactAttemptRegistry(): DesignArtifactAttemptRegistry {
  const active = new Map<string, Readonly<{ attempt: string; owner?: DesignArtifactAttemptOwner }>>()
  const claimAll = (ids: readonly string[], attempt: string, owner?: DesignArtifactAttemptOwner): void => {
    assertAttempt(attempt)
    const unique = [...new Set(ids)]
    for (const id of unique) {
      assertId(id)
      const current = active.get(id)
      if (current !== undefined) throw conflict(id, current.attempt, current.owner)
    }
    const entry = Object.freeze({ attempt, ...(owner === undefined ? {} : { owner: Object.freeze({ ...owner }) }) })
    for (const id of unique) active.set(id, entry)
  }
  return Object.freeze({
    claim(id: string, attempt: string, owner?: DesignArtifactAttemptOwner): void {
      claimAll([id], attempt, owner)
    },
    claimAll,
    isActive(id: string, attempt: string): boolean {
      return active.get(id)?.attempt === attempt
    },
    retire(id: string, attempt: string): boolean {
      if (active.get(id)?.attempt !== attempt) return false
      active.delete(id)
      return true
    },
    retireAll(ids: readonly string[], attempt: string): void {
      for (const id of new Set(ids)) {
        if (active.get(id)?.attempt === attempt) active.delete(id)
      }
    },
  })
}

function conflict(id: string, attempt: string, owner?: DesignArtifactAttemptOwner): Error {
  const identity = `artifact ${JSON.stringify(id)} already has an active attempt in this invocation`
  if (owner?.role === 'producer') {
    return new Error(`${identity}: serial Producer focus (design_focus_artifact), attempt ${JSON.stringify(attempt)}, session ${JSON.stringify(owner.sessionId)}. `
      + 'Continue the already focused artifact serially with the scoped Design file tools, then validate and publish. '
      + 'No Worker starts for this rejected claim. Repeating delegation cannot release the focus; choose delegation before serial focus when planning Worker work.')
  }
  if (owner?.role === 'worker') {
    return new Error(`${identity}: Worker delegation, attempt ${JSON.stringify(attempt)}, requested by session ${JSON.stringify(owner.sessionId)}. `
      + 'Wait for that foreground delegation to settle before retrying this target or taking over serially with design_focus_artifact. '
      + 'Do not change the artifact ID or path to bypass active ownership.')
  }
  return new Error(`${identity}: attempt ${JSON.stringify(attempt)}. Wait for its owner to finish before retrying; do not clear or bypass an active claim.`)
}

function assertId(value: string): void {
  if (value.trim() === '') throw new Error('artifact attempt: artifact id must be non-empty text')
}

function assertAttempt(value: string): void {
  if (value.trim() === '') throw new Error('artifact attempt: attempt must be non-empty text')
}
