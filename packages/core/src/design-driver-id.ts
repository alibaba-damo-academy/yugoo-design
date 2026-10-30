/** Browser-safe identity grammar shared by trusted contributions and package admission. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque globally unique identity of one trusted driver or capability. */
export type DesignDriverId = Branded<'DesignDriverId'>
const DRIVER_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*(?:\/v[1-9][0-9]*)$/

/**
 * Whether a string is a well-formed versioned dotted identifier ending in `/vN`.
 * @param value - candidate identity.
 * @returns true when the value matches the shared versioned-id grammar.
 */
export function isValidVersionedId(value: string): boolean {
  return DRIVER_ID.test(value)
}

/**
 * Validate and brand a contribution identity read from provider configuration or Kit content.
 * @param value - versioned dotted identifier ending in `/vN`.
 * @param label - diagnostic subject.
 * @returns the branded identifier.
 */
export function DesignDriverId(value: string, label = 'design driver'): DesignDriverId {
  if (!DRIVER_ID.test(value)) throw new Error(`${label}: invalid versioned id ${JSON.stringify(value)}`)
  return value as DesignDriverId
}
