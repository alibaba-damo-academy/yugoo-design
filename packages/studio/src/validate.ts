/**
 * Explicit Kit/Bundle definition validation for the Studio editing experience.
 *
 * Unlike catalog enumeration (which fails loud on an illegal Kit), validation
 * captures the Design Core loader's known content errors and returns them as
 * bounded, locatable diagnostics so an author can repair a working copy. A valid
 * definition may report non-blocking authoring warnings; an invalid one never degrades
 * to a silently empty result. This validates Bundle DEFINITIONS, not design
 * state instances (that is the runtime's `validateSkillDesign`).
 */
import { basename, join } from 'node:path'
import { diagnoseKnowledgeDeclarations, type DesignSkill } from 'dsh-design-core'
import { loadStudioKit } from './load.ts'
import type { StudioDiagnostic, StudioReadFs, StudioValidationReport } from './types.ts'

const REQUIRED_BUNDLE_SLOTS = ['SKILL.md', 'skill.yaml', 'schema.yaml', 'validation.yaml'] as const

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Adapt shared, read-only declaration advice into the existing authoring report. */
export function knowledgeDeclarationWarnings(skills: readonly DesignSkill[]): StudioDiagnostic[] {
  return diagnoseKnowledgeDeclarations(skills).map(({ code, message, subject }) => ({ code, message, subject, severity: 'warning' }))
}

/**
 * Validate one Kit definition at `kitRoot`.
 * @param fs - injected read file-ops port.
 * @param kitRoot - absolute directory holding the Kit.
 * @returns load validity plus any non-blocking declaration warnings.
 */
export async function validateKit(
  fs: StudioReadFs,
  kitRoot: string,
): Promise<StudioValidationReport> {
  try {
    const kit = await loadStudioKit(fs, kitRoot)
    return { valid: true, diagnostics: knowledgeDeclarationWarnings(kit.skills) }
  } catch (error) {
    const diagnostic: StudioDiagnostic = { code: 'kit.load', message: errorMessage(error), subject: basename(kitRoot) }
    return { valid: false, diagnostics: [diagnostic] }
  }
}

/**
 * Validate one Bundle definition inside an existing Kit.
 *
 * Reports missing required slots, then loads the Kit and attributes any loader
 * content error or a missing Mindset-catalog reference to the Bundle.
 * @param fs - injected read file-ops port.
 * @param kitRoot - absolute directory of the containing Kit.
 * @param name - the Bundle id (its `skills/<name>/` directory).
 * @returns load validity plus warnings attributed to this Bundle, not its neighbors.
 */
export async function validateBundle(
  fs: StudioReadFs,
  kitRoot: string,
  name: string,
): Promise<StudioValidationReport> {
  const bundleRoot = join(kitRoot, 'skills', name)
  const missing: StudioDiagnostic[] = []
  for (const slot of REQUIRED_BUNDLE_SLOTS) {
    const text = await fs.readText(join(bundleRoot, slot))
    if (text === undefined || text.trim() === '') {
      missing.push({ code: 'bundle.missing_slot', message: `Bundle ${JSON.stringify(name)} is missing required slot ${slot}`, subject: name })
    }
  }
  if (missing.length > 0) return { valid: false, diagnostics: missing }
  try {
    const kit = await loadStudioKit(fs, kitRoot)
    if (!kit.skills.some((skill) => skill.name === name)) {
      const diagnostic: StudioDiagnostic = {
        code: 'bundle.not_in_catalog',
        message: `Bundle ${JSON.stringify(name)} is not referenced by the Mindset <design_skills> catalog`,
        subject: name,
      }
      return { valid: false, diagnostics: [diagnostic] }
    }
    return { valid: true, diagnostics: knowledgeDeclarationWarnings(kit.skills).filter(diagnostic => diagnostic.subject === name) }
  } catch (error) {
    const diagnostic: StudioDiagnostic = { code: 'bundle.load', message: errorMessage(error), subject: name }
    return { valid: false, diagnostics: [diagnostic] }
  }
}
