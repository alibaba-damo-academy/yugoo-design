/**
 * Main-Agent mutation routing for managed Design Project data.
 *
 * The Host owns ordinary file permissions. Only actual targets in the selected
 * project's Design Files and system metadata use the Design save boundary.
 * Source, notes and project-local design_kit definitions remain ordinary Host
 * edits. Payload text and similarly named outside paths are never authority.
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

function patchText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return ['patch', 'input'].map(key => (value as Record<string, unknown>)[key])
      .filter((text): text is string => typeof text === 'string').join('\n')
  }
  return ''
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

/** Classify actual mutation targets before consulting any Design Project. */
export function designFileMutationTargets(input: Pick<DesignFileToolPolicyInput, 'name' | 'arguments'>): readonly string[] {
  if (!HOST_MUTATION_TOOL_NAMES.has(input.name)) return []
  if (input.name === 'apply_patch') {
    const patch = patchText(input.arguments)
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

/** Actual Host mutation paths, for the existing filesystem-identity check. */
export function designFileMutationPaths(input: DesignFileToolPolicyInput): readonly string[] {
  return designFileMutationTargets(input).map(path => absoluteTarget(path, input.workingDirectory ?? input.projectRoot))
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
  const project = absoluteTarget(input.projectRoot, input.projectRoot)
  const managedRoots = [input.designFilesRoot, `${project}/design_records`, `${project}/.git`, `${project}/.design-system`]
    .map(path => absoluteTarget(path, project))
  const metadata = `${project}/project.json`
  const targets = [
    ...designFileMutationPaths(input),
    ...(input.resolvedTargets ?? []).map(path => absoluteTarget(path, project)),
  ]
  if (!targets.some(target => target === metadata
    || managedRoots.some(root => target === root || target.startsWith(`${root}/`)))) return undefined
  return 'Design Files and managed project metadata change only through the Design System (run_design_skill or a persisted Design panel edit). Ordinary authorized Host edits to source, notes and design_kit definitions remain available; file contents do not change that permission.'
}
