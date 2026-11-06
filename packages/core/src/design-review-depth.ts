/** User-selected review effort, shared by native and Companion reviewers.
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
    light: 'Start with the changed object or current user task and its directly involved saved facts. Follow a dependency when it is necessary to verify a concrete concern. Stop routine expansion once those facts support the profile judgment; do not expand into an unrelated whole-project audit or speculative future concerns.',
    standard: 'Start with the changed object or current user task, then check its directly related saved responsibilities, decisions and explicit dependencies across owning files. Stop when the relevant neighboring evidence resolves the consistency or uncertainty being checked; do not expand into unrelated areas.',
    thorough: 'Review the relevant project-wide responsibilities and dependency chains, including cross-file consistency, important exceptions and consequences beyond the changed object. Stop when those related paths and meaningful edge cases support the profile judgment; do not substitute an exhaustive generic checklist for relevant investigation.',
  }[depth]
  return [
    `User-selected review depth: ${depth}. This is fixed for this run; do not change the project policy.`,
    scope,
    'Every depth may pursue a known consequential risk beyond its routine starting scope until the evidence resolves it or a concrete limitation is reached. Return every substantiated material finding, and none when the profile threshold is not met. Finding count and response verbosity do not define review depth.',
    'Read targeted excerpts first and obtain enough surrounding evidence to verify each finding. A partial read is not a complete-file review. If essential evidence is unavailable, disclose the limitation; do not invent facts or claim the project passed an exhaustive review.',
    'Do not add a separate Agent or model call to choose review depth. Do not repeat pending, rejected or resolved advice without a material new fact.',
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
