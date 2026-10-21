/** Invocation-local ownership for guarded artifact candidate writes. */

export interface DesignArtifactAttemptRegistry {
  claim(id: string, attempt: string): void
  claimAll(ids: readonly string[], attempt: string): void
  isActive(id: string, attempt: string): boolean
  retire(id: string, attempt: string): boolean
  retireAll(ids: readonly string[], attempt: string): void
}

export function createDesignArtifactAttemptRegistry(): DesignArtifactAttemptRegistry {
  const active = new Map<string, string>()
  return Object.freeze({
    claim(id: string, attempt: string): void {
      assertId(id)
      assertAttempt(attempt)
      if (active.has(id)) throw new Error(`artifact ${JSON.stringify(id)} already has an active attempt`)
      active.set(id, attempt)
    },
    claimAll(ids: readonly string[], attempt: string): void {
      assertAttempt(attempt)
      const unique = [...new Set(ids)]
      for (const id of unique) {
        assertId(id)
        if (active.has(id)) throw new Error(`artifact ${JSON.stringify(id)} already has an active attempt`)
      }
      for (const id of unique) active.set(id, attempt)
    },
    isActive(id: string, attempt: string): boolean {
      return active.get(id) === attempt
    },
    retire(id: string, attempt: string): boolean {
      if (active.get(id) !== attempt) return false
      active.delete(id)
      return true
    },
    retireAll(ids: readonly string[], attempt: string): void {
      for (const id of new Set(ids)) {
        if (active.get(id) === attempt) active.delete(id)
      }
    },
  })
}

function assertId(value: string): void {
  if (value.trim() === '') throw new Error('artifact attempt: artifact id must be non-empty text')
}

function assertAttempt(value: string): void {
  if (value.trim() === '') throw new Error('artifact attempt: attempt must be non-empty text')
}
