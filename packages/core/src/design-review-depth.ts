/** User-selected review scope, shared by native and Companion reviewers.
 * These are investigation instructions, not a promise
 * about model tokens, billing, completeness, or the severity of findings.
 */
export type DesignReviewDepth = 'light' | 'standard' | 'thorough'

export function designReviewDepth(value: unknown = 'standard'): DesignReviewDepth {
  if (value !== 'light' && value !== 'standard' && value !== 'thorough') throw new Error('Invalid GRA review depth')
  return value
}

export function renderDesignReviewDepth(depth: DesignReviewDepth): string {
  const scope = {
    light: 'Check the current design object or user task and its directly involved saved facts. Read referenced evidence when necessary to verify the same concrete concern, without starting a review of other objects in that source. This works without a prior change baseline; do not invent a diff or expand into a whole-project audit.',
    standard: 'Start with the changed object or current user task, then check its directly related saved responsibilities, decisions and explicit dependencies across owning files. Stop when the relevant neighboring evidence resolves the consistency or uncertainty being checked; do not expand into unrelated areas.',
    thorough: 'Review the project’s current saved design results and their relevant responsibilities, dependencies and exceptions. Consult original artifacts as needed. Do not scan obsolete history or copies, or treat an ungenerated Bundle as a required missing deliverable regardless of the user’s current goal.',
  }[depth]
  return [
    `User-selected review depth: ${depth}. Review scope: ${depth === 'light' ? 'Current design' : depth === 'thorough' ? 'Entire project' : 'Related designs'}. This is fixed for this run; do not change the project policy.`,
    scope,
    'Every scope uses the same profile threshold. Return substantiated material findings, and none when that threshold is not met. Outside-scope clues without sufficient evidence remain explicitly unverified; state their source and coverage limit without silently broadening the investigation. Scope does not determine finding count, severity or response length.',
    'Read targeted excerpts first and obtain enough surrounding evidence to verify each finding. A partial read is not a complete-file review. If essential evidence is unavailable, disclose the limitation; do not invent facts or claim the project passed an exhaustive review.',
    'Do not add a separate Agent or model call to choose review depth.',
  ].join('\n')
}

/** Hints are intersected with the existing immutable manifest, never a new read boundary. */
export interface DesignReviewTarget {
  readonly skill: string
  readonly artifactFile?: string | null
}

export function renderDesignReviewStartingPoints(targets: readonly DesignReviewTarget[], paths: readonly string[]): string {
  const available = new Set(paths.filter(path => path.startsWith('design_files/') && !path.startsWith('design_files/_experiences/')))
  const points = new Map<string, { bundle: string; file?: string; prefix?: string }>()
  for (const target of targets) {
    const prefix = `design_files/${target.skill}/`
    const state = `${prefix}${target.skill}.json`
    const artifact = target.artifactFile?.startsWith('design_files/') ? target.artifactFile : `design_files/${target.artifactFile ?? ''}`
    const file = target.artifactFile && artifact.startsWith(prefix) && available.has(artifact) ? artifact
      : available.has(state) ? state : undefined
    const point = file ? { bundle: target.skill, file } : [...available].some(path => path.startsWith(prefix)) ? { bundle: target.skill, prefix } : undefined
    if (point) points.set(JSON.stringify(point), point)
  }
  if (!points.size) return ''
  return [
    `Priority investigation starting points in this run's pinned files: ${JSON.stringify([...points.values()])}`,
    'These are existing file locators, not proof that every fact in them changed or that their contents were reviewed. Start with the relevant objects there, then follow dependencies according to the selected depth. They do not exclude other necessary evidence or establish project-wide coverage.',
  ].join('\n')
}
