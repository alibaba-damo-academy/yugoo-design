/**
 * Renderability checkpoint (the second validation layer). Given a design skill
 * and a lifecycle-specific candidate, report every applicable validation issue:
 * scoped validation.yaml rules plus write-time schema and declarative panel
 * renderability for state-bearing phases.
 */
import { parse } from 'yaml'
import type { DesignSkill } from './types.ts'
import { validatorFromSchemaYaml } from './schema.ts'
import { evaluateValidationRules, parseValidationYaml, type ValidationEnv } from './validation-rules.ts'
import type { DesignDriverId, DesignValidationDriver } from './runtime-drivers.ts'

/** One repairable problem found by the checkpoint. */
export interface ValidationIssue {
  code: string
  message: string
  artifact?: string
  repair_hint?: string
}

/** One validation-rule phase selected by the owning lifecycle boundary. */
export type DesignValidationScope = 'state' | 'candidate' | 'completion'

/** Bounded child result validated before the Producer may integrate it. */
export interface DesignValidationCandidate {
  readonly content: string
  readonly metadata?: Record<string, unknown>
}

/** Optional checkpoint environment and explicitly selected rule phases. */
export interface ValidateDesignOptions {
  /** Rule phases to run; defaults to the legacy state plus completion checkpoint. */
  scopes?: readonly DesignValidationScope[]
  /** Submitted payload required when `candidate` is selected. */
  candidate?: DesignValidationCandidate
  /** Read one artifact relative to `design_files/` for state and completion audits. */
  artifactText?: (relPath: string) => Promise<string | undefined>
  /** Resolve trusted procedural validation referenced by this skill. */
  resolveValidationDriver?: (id: DesignDriverId) => DesignValidationDriver
}

/**
 * Validate the phases selected by the caller. Producers select `state` while
 * editing, delegated children select `candidate` before returning material,
 * and Producers select `completion` before publication.
 * @param skill - the design skill and its common and conditional metadata.
 * @param state - the candidate design state.
 * @param options - selected scopes and their required validation environment.
 * @returns all issues found; empty means the design passes the checkpoint.
 */
export async function validateSkillDesign(
  skill: DesignSkill,
  state: unknown,
  options: ValidateDesignOptions = {},
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  const scopes = new Set<DesignValidationScope>(options.scopes ?? ['state', 'completion'])
  const validatesCandidateState = scopes.has('state') || scopes.has('completion')
  const stateRecord = typeof state === 'object' && state !== null && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {}

  if (validatesCandidateState) {
    const schemaYaml = skill.metadata?.schemaYaml
    if (typeof schemaYaml === 'string') {
      const result = validatorFromSchemaYaml(schemaYaml)(state)
      if (!result.ok) {
        issues.push({
          code: 'schema_violation',
          message: result.error,
          repair_hint: 'Bring the design state into conformance with the skill schema before persisting.',
        })
      }
    } else {
      issues.push({
        code: 'schema_missing',
        message: `skill "${skill.name}" has no schema.yaml`,
        repair_hint: 'Add a schema.yaml data contract for the skill.',
      })
    }
  }

  const validationYaml = skill.metadata?.validationYaml
  if (typeof validationYaml === 'string') {
    const doc = parseValidationYaml(validationYaml)
    const stateEnv: ValidationEnv = {
      skill: skill.name,
      state: stateRecord,
      ...(options.artifactText === undefined ? {} : { artifactText: options.artifactText }),
    }
    if (scopes.has('state')) {
      issues.push(...await evaluateValidationRules(doc, stateEnv, 'state', options.resolveValidationDriver))
    }
    if (scopes.has('candidate')) {
      if (options.candidate === undefined) {
        throw new Error('validateSkillDesign: candidate scope requires options.candidate')
      }
      const candidate = options.candidate
      const candidateState: Record<string, unknown> = {
        content: candidate.content,
        ...(candidate.metadata === undefined ? {} : { metadata: candidate.metadata }),
      }
      issues.push(...await evaluateValidationRules(doc, {
        skill: skill.name,
        state: candidateState,
        candidate,
      }, 'candidate', options.resolveValidationDriver))
    }
    if (scopes.has('completion')) {
      issues.push(...await evaluateValidationRules(doc, stateEnv, 'completion', options.resolveValidationDriver))
    }
  }

  if (!validatesCandidateState) return issues

  const manifest = skill.metadata?.skillManifest
  const presentation = typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
    && typeof (manifest as Record<string, unknown>).presentation === 'object'
    && (manifest as Record<string, unknown>).presentation !== null
    && !Array.isArray((manifest as Record<string, unknown>).presentation)
    ? (manifest as Record<string, unknown>).presentation as Record<string, unknown>
    : undefined
  if (presentation?.mode === 'declarative') {
    const panelYaml = skill.metadata?.panelYaml
    if (typeof panelYaml !== 'string') {
      issues.push({
        code: 'panel_missing',
        message: `skill "${skill.name}" has no panel.yaml`,
        repair_hint: 'Add a panel.yaml so the declarative design can be visualized and edited.',
      })
      return issues
    }
    try {
      const panel = parse(panelYaml) as { version?: unknown; panel_kind?: unknown; ui?: unknown }
      if (panel.version !== 1) {
        issues.push({
          code: 'panel_version',
          message: `panel manifest version ${String(panel.version)} is unsupported`,
          repair_hint: 'Set version: 1 in panel.yaml.',
        })
      }
      if (panel.ui === undefined) {
        issues.push({
          code: 'panel_no_ui',
          message: 'panel manifest has no ui tree',
          repair_hint: 'Define the ui component tree in panel.yaml.',
        })
      }
    } catch (error) {
      issues.push({
        code: 'panel_unparseable',
        message: error instanceof Error ? error.message : String(error),
        repair_hint: 'Fix the panel.yaml syntax.',
      })
    }
  }

  return issues
}
