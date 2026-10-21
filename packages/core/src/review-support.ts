/**
 * Optional Bundle candidates for agentic review follow-up. A declaration is
 * discovery metadata, never an execution choice or Design File write authority.
 * Grounding continues to route corrections to the affected source owners.
 */
import type { DesignKit, DesignSkill } from './types.ts'

/** Review roles that may offer zero, one or many candidate Bundles. */
export type DesignReviewSupportProfile = 'alignment' | 'reflection'

const EMPTY_SUPPORT: readonly DesignReviewSupportProfile[] = Object.freeze([])

/** Validate a manifest's optional review_support list without choosing a Bundle. */
export function parseReviewSupport(value: unknown, path: string): readonly DesignReviewSupportProfile[] {
  if (value === undefined) return EMPTY_SUPPORT
  if (!Array.isArray(value)) {
    throw new Error(`design kit: ${path} review_support must be a list of alignment or reflection`)
  }
  const parsed = value.map((profile, index) => {
    if (profile !== 'alignment' && profile !== 'reflection') {
      throw new Error(`design kit: ${path} review_support[${index}] must be alignment or reflection`)
    }
    return profile
  })
  if (new Set(parsed).size !== parsed.length) {
    throw new Error(`design kit: ${path} review_support must be unique within one Bundle`)
  }
  return Object.freeze(parsed)
}

/** Read a Bundle's declared candidate roles; omission provides no candidates. */
export function reviewSupportOf(skill: DesignSkill): readonly DesignReviewSupportProfile[] {
  const manifest = skill.metadata?.skillManifest as Record<string, unknown> | undefined
  return parseReviewSupport(manifest?.review_support, `Bundle ${JSON.stringify(skill.name)}`)
}

/**
 * Return all candidates in the pinned Kit's catalog order. The Agent still
 * chooses whether any Bundle, a Host capability, or no action is appropriate;
 * exact target authorization belongs to the subsequent execution selection.
 * This is not an authorization allowlist: an undeclared Bundle may still be
 * chosen under the main Agent's independently validated task authority.
 */
export function reviewCandidates(kit: DesignKit, profile: DesignReviewSupportProfile): readonly DesignSkill[] {
  return Object.freeze(kit.skills.filter(skill => reviewSupportOf(skill).includes(profile)))
}
