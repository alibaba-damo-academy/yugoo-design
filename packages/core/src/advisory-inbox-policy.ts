/** Shared Host-independent advisory inbox policy. */
import type { DesignJournalAdvisoryEntry } from './design-journal.ts'

export const DEFAULT_MAX_SUGGESTIONS = 5

export function resolveMaxSuggestions(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_SUGGESTIONS
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error('design advisory: maxSuggestions must be a safe integer from 1 through 10')
  }
  return value
}

export function currentAdvisoryEntries(entries: readonly DesignJournalAdvisoryEntry[], limit?: number): readonly DesignJournalAdvisoryEntry[] {
  const latest = new Map<string, DesignJournalAdvisoryEntry>()
  for (const entry of entries) {
    if (entry.advisory.attention !== 'human-review') continue
    const profile = String(entry.advisory.profile).replace(/\/v[1-9][0-9]*$/u, '')
    latest.delete(profile)
    latest.set(profile, entry)
  }
  return [...latest.values()].filter(entry => entry.status === 'pending' || entry.status === 'deferred').slice(-resolveMaxSuggestions(limit))
}
