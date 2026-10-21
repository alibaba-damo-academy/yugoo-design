/**
 * Main-Agent write policy for Design Project files.
 *
 * Design workers own native file operations. The Main Agent may read committed
 * files from the disclosed project root and inspect that repository's Git
 * status, diff, and history through host filesystem and shell tools; the
 * revision-pinned Design projection stays the same-turn authority for design
 * decisions. Only modification is reserved: Design Files change through the
 * design port, never through Main-Agent host write, edit, or patch tools.
 * Shell writes are forbidden by the Design Core prompt. Producer writes are
 * ordinary persistent worktree files; publication rebuilds its mechanical Git
 * index and commits only a validated frozen snapshot.
 */

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

  const text = normalizedPath(argumentText(input.arguments))
  const lower = text.toLowerCase()
  const projectRoot = normalizedPath(input.projectRoot)
  const designFilesRoot = normalizedPath(input.designFilesRoot)
  const referencesProtectedPath = lower.includes('/design_files/')
    || lower.includes('design_files/')
    || lower.includes('/.design-system/')
    || lower.includes('.design-system/')
    || text.includes(projectRoot)
    || text.includes(designFilesRoot)
  const declaresDesignFileIntent = /\bdesign[ -](?:files?|projects?)\b/i.test(text)

  if (!referencesProtectedPath && !declaresDesignFileIntent) return undefined
  return 'Design Files change only through the Design System (run_design_skill or a persisted Design panel edit); host write, edit, and patch tools cannot modify them. Reading committed files and inspecting Git status, diff, or history from the disclosed project root remains allowed.'
}
