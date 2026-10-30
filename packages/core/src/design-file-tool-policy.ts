/**
 * Main-Agent write policy for Design Project files.
 *
 * Design workers own native file operations. The Main Agent may read committed
 * files from the disclosed project root and inspect that repository's Git
 * status, diff, and history through host filesystem and shell tools; the
 * revision-pinned Design projection stays the same-turn authority for design
 * decisions. Only modification is reserved: Design Files change through the
 * design port, never through Main-Agent host write, edit, or patch tools.
 * Project-local design_kit definitions use ordinary authorized file editing.
 * Shell writes to Design data remain forbidden by the Design Core prompt.
 * Producer writes are
 * ordinary persistent worktree files; publication rebuilds its mechanical Git
 * index and commits only a validated frozen snapshot.
 */

import { posix } from 'node:path'

const HOST_MUTATION_TOOL_NAMES = new Set([
  'apply_patch',
  'edit',
  'write',
])

/** Inputs needed to classify one host-tool invocation. */
export interface DesignFileToolPolicyInput {
  /** Tool name presented by the host. */
  readonly name: string
  /** Parsed, losslessly logged tool arguments. */
  readonly arguments: unknown
  /** Absolute selected Design Project root. */
  readonly projectRoot: string
  /** Absolute selected Design Files root. */
  readonly designFilesRoot: string
  /** Whether the caller is a delegated Design worker. */
  readonly isSubagent: boolean
  /** Actual Host cwd used for relative file targets. */
  readonly workingDirectory?: string
  /** Host-resolved filesystem identities, in the same order as mutation targets. */
  readonly resolvedTargets?: readonly string[]
}

function argumentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(argumentText).join('\n')
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).map(argumentText).join('\n')
  }
  return ''
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** Exact mutation targets; patch moves must account for both source and destination. */
function mutationTargets(input: DesignFileToolPolicyInput): string[] {
  if (input.name === 'apply_patch') {
    const patch = typeof input.arguments === 'string' ? input.arguments : argumentText(input.arguments)
    return [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\r?$/gm)].map(match => match[1]!.trim())
  }
  if (!input.arguments || typeof input.arguments !== 'object' || Array.isArray(input.arguments)) return []
  return Object.entries(input.arguments).flatMap(([key, value]) =>
    ['file_path', 'filePath', 'path'].includes(key) && typeof value === 'string' ? [value] : [])
}

function absoluteTarget(path: string, cwd: string): string {
  const value = normalizedPath(path)
  const absolute = value.startsWith('/') || /^[a-z]:\//i.test(value) ? value : `${cwd}/${value}`
  const result = posix.normalize(absolute)
  if (absolute.startsWith('//')) return ('/' + result).toLowerCase()
  return /^[a-z]:\//i.test(result) ? result.toLowerCase() : result
}

/** The only project-repository exception: every mutated file belongs to its definition tree. */
export function projectDefinitionMutationPaths(input: DesignFileToolPolicyInput): readonly string[] | undefined {
  if (!HOST_MUTATION_TOOL_NAMES.has(input.name)) return undefined
  const paths = mutationTargets(input)
  if (!paths.length || paths.some(path => path.includes('\0') || normalizedPath(path).split('/').includes('..'))) return undefined
  const project = absoluteTarget(input.projectRoot, input.projectRoot)
  const root = `${project}/design_kit/`
  const targets = paths.map(path => absoluteTarget(path, input.workingDirectory ?? project))
  if (!targets.every(path => path.startsWith(root))) return undefined
  if (input.resolvedTargets && (input.resolvedTargets.length !== targets.length
    || !input.resolvedTargets.every(path => absoluteTarget(path, project).startsWith(root)))) return undefined
  return targets
}

/**
 * Return the final denial reason for a Main-Agent host mutation call.
 *
 * Read-only inspection tools (read, glob, grep, and shell commands such as
 * `git status`, `git diff`, and `git log`) always continue.
 * @param input - one pending tool call and the selected project roots.
 * @returns a denial reason, or `undefined` when the call may continue.
 */
export function designFileToolDenial(input: DesignFileToolPolicyInput): string | undefined {
  if (input.isSubagent || !HOST_MUTATION_TOOL_NAMES.has(input.name)) return undefined
  if (projectDefinitionMutationPaths(input)) return undefined

  const text = normalizedPath(argumentText(input.arguments))
  const lower = text.toLowerCase()
  const projectRoot = normalizedPath(input.projectRoot)
  const designFilesRoot = normalizedPath(input.designFilesRoot)
  const targetInProject = mutationTargets(input).some(path => {
    const target = absoluteTarget(path, input.workingDirectory ?? projectRoot)
    const project = absoluteTarget(projectRoot, projectRoot)
    return (input.workingDirectory !== undefined || /^(?:\/|[a-z]:[\\/])/i.test(path))
      && (target === project || target.startsWith(project + '/'))
  })
  const referencesProtectedPath = targetInProject
    || lower.includes('/design_files/')
    || lower.includes('design_files/')
    || lower.includes('/.design-system/')
    || lower.includes('.design-system/')
    || text.includes(projectRoot)
    || text.includes(designFilesRoot)
    || input.resolvedTargets !== undefined
  const declaresDesignFileIntent = /\bdesign[ -](?:files?|projects?)\b/i.test(text)

  if (!referencesProtectedPath && !declaresDesignFileIntent) return undefined
  return 'Design Files change only through the Design System (run_design_skill or a persisted Design panel edit); host write, edit, and patch tools cannot modify them. Ordinary authorized edits are allowed only for the selected project’s design_kit definition tree; this does not grant Design data, project metadata or Git mutation authority. Reading committed files and inspecting Git status, diff, or history from the disclosed project root remains allowed.'
}
