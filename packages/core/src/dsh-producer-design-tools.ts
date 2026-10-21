/** Project-scoped file tools installed only in one Design Producer Agent scope. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from './json-value.ts'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { requireDesignFileRelativePath } from './design-files.ts'

const workspaceTools = new WeakSet<object>()
const READ_DESIGN_FILE_TOOL = 'read_design_file'
/** Distinguish the bound Design capability from same-named host filesystem tools. */
export function isDesignWorkspaceTool(definition: unknown): boolean {
  return typeof definition === 'object' && definition !== null && workspaceTools.has(definition)
}

/** File content crossing the Producer Project Workspace capability. */
export type ProducerProjectFile =
  | { readonly encoding: 'utf8'; readonly content: string }
  | { readonly encoding: 'base64'; readonly content: string }

/** Result of one exact text replacement. */
export interface ProducerProjectEditReceipt {
  readonly replacements: number
}

/** Atomic publication receipt returned by the bound Project Workspace. */
export interface ProducerProjectPublicationReceipt {
  readonly stateRevision: string
  readonly diff: string
  readonly indexMaintenance?: import('./design-files.ts').DesignWriteResult['indexMaintenance']
  readonly recovery?: import('./design-files.ts').DesignWriteResult['recovery']
}

/** A factual publication conflict; no files were discarded or committed. */
export interface ProducerProjectPublicationConflict {
  readonly kind: 'conflict'
  readonly expectedHead: string
  readonly currentHead: string
  readonly paths: readonly string[]
  readonly diagnostics: readonly string[]
}

/** One bounded Published revision touching the invocation Bundle. */
export interface ProducerProjectRevision {
  readonly commit: string
  readonly committedAt: string
  readonly subject: string
}

/** One mandatory preview for restoring the invocation Bundle from Published history. */
export interface ProducerProjectRestorePreview {
  readonly previewToken: string
  readonly revision: string
  readonly currentRevision: string
  readonly changedPaths: readonly string[]
  readonly overwrittenUnpublishedPaths: readonly string[]
}

/** Validation and publication scope selected by the Producer's settlement. */
export type ProducerProjectPublicationMode = 'in_progress' | 'complete'

/**
 * Narrow project authority consumed by Producer tools.
 *
 * Implementations expose project-wide committed and working-copy reads, while binding
 * every mutation to the invocation Bundle's owned canonical state and artifact
 * set. They reject writes outside that owned set. The Bundle, Design Project,
 * validation scope, and publication transaction are captured before this port
 * is exposed; model arguments never carry any of those identities or an
 * authorization token.
 */
export interface ProducerProjectWorkspacePort {
  /** Consume only pending facts of this invocation's already committed publication. */
  recoverPublication?(mode: ProducerProjectPublicationMode, signal: AbortSignal): Promise<ProducerProjectPublicationReceipt>
  /** List working-copy-visible paths, optionally filtered by a workspace-owned glob. */
  list(pattern: string | undefined, signal: AbortSignal): Promise<readonly string[]>
  /** Read one working-copy-visible file, or return undefined when it does not exist. */
  read(path: string, signal: AbortSignal): Promise<ProducerProjectFile | undefined>
  /** Create or replace one file in the invocation Bundle's owned working copy. */
  write(path: string, file: ProducerProjectFile, signal: AbortSignal): Promise<void>
  /** Replace exact text in one owned invocation-Bundle workspace file. */
  edit(
    path: string,
    oldText: string,
    newText: string,
    replaceAll: boolean,
    signal: AbortSignal,
  ): Promise<ProducerProjectEditReceipt>
  /** Remove one file from the invocation Bundle's owned working copy. */
  remove(path: string, signal: AbortSignal): Promise<void>
  /** Move one file within the invocation Bundle's owned working copy. */
  move(from: string, to: string, signal: AbortSignal): Promise<void>
  /** Render the complete working-copy diff from its pinned committed baseline. */
  diff(signal: AbortSignal): Promise<string>
  /** Read bounded newest-first Git history for this Bundle's canonical file. */
  revisions(limit: number, signal: AbortSignal): Promise<readonly ProducerProjectRevision[]>
  /** Preview a Bundle-scoped snapshot restore without changing the WorkingCopy. */
  previewRestore(revision: string, signal: AbortSignal): Promise<ProducerProjectRestorePreview>
  /** Apply the exact last preview to the WorkingCopy; publication remains separate. */
  restoreSnapshot(
    revision: string,
    previewToken: string,
    userAuthorizedOverwrite: boolean,
    signal: AbortSignal,
  ): Promise<Readonly<{ revision: string; changedPaths: readonly string[] }>>
  /** Validate the working copy for one pending or complete publication. Empty means valid. */
  validate(mode: ProducerProjectPublicationMode, signal: AbortSignal): Promise<readonly string[]>
  /** Validate once and atomically publish, or return repair diagnostics without publishing. */
  publish(mode: ProducerProjectPublicationMode, signal: AbortSignal): Promise<
    | ({ readonly kind: 'published' } & ProducerProjectPublicationReceipt)
    | { readonly kind: 'invalid'; readonly diagnostics: readonly string[] }
    | ProducerProjectPublicationConflict
  >
}

/** Immutable reference files owned by the invocation Bundle. */
export interface DesignProducerSkillResourcePort {
  /** Read one path relative to that skill package, or return undefined. */
  read(path: string, signal: AbortSignal): Promise<string | undefined>
}

/** Host-confined executor for ordinary scripts shipped by the active Skill. */
export interface DesignProducerSkillScriptPort {
  run(
    path: string,
    args: readonly string[],
    stdin: string,
    signal: AbortSignal,
  ): Promise<Readonly<{ stdout: string; stderr: string; exitCode: number }>>
}

/** Maximum Unicode characters returned by one model-visible Bundle resource page. */
export const DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS = 12_000

/** One bounded page from an immutable Bundle resource. */
export interface DesignSkillResourcePage {
  readonly content: string
  readonly offset: number
  readonly totalCharacters: number
  readonly complete: boolean
  readonly nextOffset?: number
}

const FORBIDDEN_INHERITED_PRODUCER_TOOLS = new Set([
  'list',
  'write',
  'edit',
  'delete',
  'move',
  'copy',
  'diff',
  'read_skill_resource',
  'run_skill_script',
  'apply_patch',
  'write_design_json',
  'write_design_artifact',
  'save_design_state',
  'design_validate',
  'design_publish',
  'design_revisions',
  'design_restore_snapshot',
  'design_checkpoint',
  'design_finish',
  'design_focus_artifact',
  'design_delegate',
  'design_delegate_frontier',
  READ_DESIGN_FILE_TOOL,
  'run_design_skill',
])

/**
 * Reject inherited tools that could bypass the Producer's scoped Design
 * Project capability or recursively enter another Design Bundle.
 * @param names - host-resolved inherited tool names.
 * @param label - caller-facing list name for diagnostics.
 */
export function assertSafeDesignProducerInheritedTools(names: readonly string[], label: string): void {
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index)
  if (duplicates.length > 0) {
    throw new Error(`${label} contains duplicates: ${[...new Set(duplicates)].join(', ')}`)
  }
  for (const name of names) {
    if (name.trim() === '') throw new Error(`${label} contains an empty tool name`)
    if (FORBIDDEN_INHERITED_PRODUCER_TOOLS.has(name)) {
      throw new Error(`${label} cannot include reserved Design Producer tool ${JSON.stringify(name)}`)
    }
  }
}

/** Manifest handoff that permits one authoritative pending publication. */
export type DesignProducerPauseHandoff = 'must_edit' | 'user_continue'

/** Successful terminal or paused receipt captured by the shared publication path. */
export type DesignProducerFinishReceipt =
  | ({ readonly kind: 'complete' } & ProducerProjectPublicationReceipt)
  | ({ readonly kind: 'pause'; readonly handoff: DesignProducerPauseHandoff } & ProducerProjectPublicationReceipt)

/** Ephemeral settlement action selected explicitly by the Producer or conservatively by the Host. */
export type DesignProducerPublishAction = 'handoff' | 'complete'

/** Result from the single validation-and-publication path shared by tool and Host settlement. */
export type DesignProducerPublishResult =
  | { readonly kind: 'invalid'; readonly action: DesignProducerPublishAction; readonly diagnostics: string[] }
  | ({ readonly kind: 'unchanged'; readonly action: DesignProducerPublishAction; readonly stateRevision: string }
      & Pick<ProducerProjectPublicationReceipt, 'indexMaintenance' | 'recovery'>)
  | ({ readonly kind: 'published'; readonly action: DesignProducerPublishAction } & ProducerProjectPublicationReceipt)
  | {
    readonly kind: 'conflict'
    readonly action: DesignProducerPublishAction
    readonly expectedHead: string
    readonly currentHead: string
    readonly paths: string[]
    readonly diagnostics: string[]
  }

/** Handle retained by the Producer owner for explicit or Host-default settlement. */
export interface DesignProducerToolController {
  /** The first successful finish receipt, or undefined before publication. */
  finished(): DesignProducerFinishReceipt | undefined
  /** The latest explicit model-selected action, if `design_publish` was attempted. */
  requestedAction(): DesignProducerPublishAction | undefined
  /** Use the exact same validation-and-publication path as `design_publish`. */
  settle(action: DesignProducerPublishAction, signal: AbortSignal): Promise<DesignProducerPublishResult>
}

/** Model-invisible Host activity projection bound to the current Producer invocation. */
export interface DesignProducerArtifactActivityPort {
  /** Focus one explicit Bundle-owned artifact for serial Producer work. */
  focus(
    artifactKind: string,
    artifactId: string,
    artifactFile: string,
  ): string | Promise<string>
  /** Observe one real tool result from the exact Producer Agent. */
  observeTool(observation: {
    readonly name: string
    readonly arguments: unknown
    readonly isError: boolean
    readonly value?: JsonValue
    readonly meta?: JsonValue
  }): void | Promise<void>
}

const PATH_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
  },
} as const

/** Byte-preserving single-file reuse through the existing owned workspace write path. */
export async function copyProducerFile(
  workspace: ProducerProjectWorkspacePort,
  from: string,
  to: string,
  signal: AbortSignal,
  reconstructionSourceRoot?: string,
): Promise<{ path: string; bytes: number }> {
  signal.throwIfAborted()
  requireDesignFileRelativePath(to)
  const maxBytes = 10 * 1024 * 1024
  let bytes: Buffer
  if (isAbsolute(from)) {
    if (reconstructionSourceRoot === undefined) throw new Error('Absolute copy source requires an authorized reconstruction input')
    const root = await realpath(reconstructionSourceRoot)
    const path = await realpath(from)
    const rootInfo = await stat(root)
    const local = relative(root, path)
    if (rootInfo.isFile() ? path !== root : !rootInfo.isDirectory() || local === '..' || local.startsWith('../') || isAbsolute(local)) {
      throw new Error('Copy source must stay inside the authorized reconstruction directory or match its exact input file')
    }
    const sourceInfo = await stat(path)
    if (!sourceInfo.isFile()) throw new Error('Copy accepts one regular file, not a directory or device')
    // Do not follow a replaced final symlink or block on a substituted FIFO.
    // Like workspace writes, this expects stable parent directories, not an
    // adversarial filesystem concurrently renaming the authorized source tree.
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await handle.stat()
      if (info.dev !== sourceInfo.dev || info.ino !== sourceInfo.ino) throw new Error('Copy source changed while opening; retry from the current source file')
      if (!info.isFile() || info.size > maxBytes) throw new Error('Copy requires a regular file of at most 10 MiB')
      const buffer = Buffer.alloc(maxBytes + 1)
      let size = 0
      while (size < buffer.length) {
        signal.throwIfAborted()
        const result = await handle.read(buffer, size, buffer.length - size, null)
        if (result.bytesRead === 0) break
        size += result.bytesRead
      }
      if (size > maxBytes) throw new Error('Copy requires a file of at most 10 MiB')
      bytes = buffer.subarray(0, size)
    } finally { await handle.close() }
  } else {
    requireDesignFileRelativePath(from)
    const file = await workspace.read(from, signal)
    if (file === undefined) throw new Error(`Copy source does not exist: ${from}`)
    bytes = Buffer.from(file.content, file.encoding)
  }
  if (bytes.length > maxBytes) throw new Error('Copy requires a file of at most 10 MiB')
  // The owning Producer serializes asset writes; this is not a concurrent
  // compare-and-swap operation against external writers.
  const existing = await workspace.read(to, signal)
  if (existing !== undefined && !bytes.equals(Buffer.from(existing.content, existing.encoding))) {
    throw new Error(`Copy destination already contains different bytes: ${to}; use a new asset path and update its reference`)
  }
  signal.throwIfAborted()
  // Retain the existing destination ownership, symlink and mutation checks even
  // for identical content. Binary transport is internal, never model-visible.
  await workspace.write(to, { encoding: 'base64', content: bytes.toString('base64') }, signal)
  signal.throwIfAborted()
  return { path: to, bytes: bytes.length }
}

function text(value: unknown): { readonly type: 'text'; readonly text: string }[] {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
}

function requireSkillResourcePath(path: string): string {
  const parts = path.split('/')
  if (
    path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || parts.some(part => part === '' || part === '.' || part === '..')
  ) {
    throw new Error('resource paths must stay inside the current skill package')
  }
  return path
}

function requireResourcePageInteger(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`)
  }
  return value
}

/**
 * Select one Unicode-character page without silently truncating model-visible
 * Bundle resources. Callers continue from `nextOffset` until `complete`.
 * @param content - complete immutable resource text from the pinned Bundle.
 * @param offset - zero-based Unicode-character offset.
 * @param maxCharacters - requested page size, capped by the tool protocol.
 * @returns the bounded resource page and exact continuation position.
 */
export function pageDesignSkillResource(
  content: string,
  offset = 0,
  maxCharacters = DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS,
): DesignSkillResourcePage {
  const start = requireResourcePageInteger(offset, 'offset', 0)
  const limit = requireResourcePageInteger(maxCharacters, 'max_chars', 1)
  if (limit > DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS) {
    throw new Error(`max_chars must be less than or equal to ${DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS}`)
  }
  const characters = Array.from(content)
  if (start > characters.length) {
    throw new Error(`offset ${start} exceeds resource length ${characters.length}`)
  }
  const end = Math.min(characters.length, start + limit)
  const complete = end === characters.length
  return Object.freeze({
    content: characters.slice(start, end).join(''),
    offset: start,
    totalCharacters: characters.length,
    complete,
    ...complete ? {} : { nextOffset: end },
  })
}

/** Shared script tool; callers may provide a narrower read/write workspace capability. */
export function createDesignSkillScriptTool(
  workspace: Pick<ProducerProjectWorkspacePort, 'read' | 'write'>,
  scripts: DesignProducerSkillScriptPort,
  assertAccess: (outputFile: string | undefined, signal: AbortSignal) => void,
): ToolDefinition {
  return defineTool({
    name: 'run_skill_script',
    description: 'Run one ordinary script bundled under the active Skill scripts/ directory. '
      + 'Call this executable directly; do not read its source before use. The Host binds the installed Skill and executes it outside the Design Project. '
      + 'Use input_json for a small structured request, or input_file when the script processes a Design Project file. '
      + 'When the result is an artifact, use output_file so file bytes stay outside model context.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path below scripts/, for example layout.mjs.' },
      args: { type: 'array', items: { type: 'string' }, description: 'Optional literal argv entries; no shell expansion.' },
      input_json: { type: 'object', additionalProperties: true, description: 'Small structured script input. Use this or input_file, never both.' },
      input_file: { type: 'string', description: 'Working-copy UTF-8 file processed directly by the script.' },
      input_files: { type: 'array', items: { type: 'string' }, description: 'Optional additional Working-copy UTF-8 files. The Host supplies their exact bytes to the script as input_files keyed by project-relative path.' },
      input_context: { type: 'object', additionalProperties: true, description: 'Optional small structured context accompanying input_file.' },
      output_file: { type: 'string', description: 'On exit 0, write the script result to this WorkingCopy UTF-8 path and return only a compact receipt.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          exit_code: { type: 'integer', required: true },
          written_path: { type: 'string' },
          written_bytes: { type: 'integer' },
        },
      },
      render: (_args, value) => text([
        `exit ${value.exit_code}`,
        ...(value.written_path === undefined ? [] : [`wrote ${value.written_path} (${value.written_bytes} bytes)`]),
        ...(value.stderr === '' ? [] : [`stderr:\n${value.stderr}`]),
        ...(value.stdout === '' ? [] : [`stdout:\n${value.stdout}`]),
      ].join('\n')),
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const outputFile = args.output_file === undefined ? undefined : requireSkillResourcePath(args.output_file)
      assertAccess(outputFile, exec.signal)
      const path = requireSkillResourcePath(args.path)
      const hasJson = args.input_json !== undefined
      const hasFile = args.input_file !== undefined
      if (hasJson === hasFile) throw new Error('run_skill_script requires exactly one of input_json or input_file')
      if (!hasFile && args.input_context !== undefined) throw new Error('input_context requires input_file')
      if (!hasFile && args.input_files !== undefined) throw new Error('input_files requires input_file')

      let scriptInput = hasJson ? JSON.stringify(args.input_json) : ''
      if (hasFile) {
        const inputFile = requireSkillResourcePath(args.input_file!)
        const file = await workspace.read(inputFile, exec.signal)
        if (file === undefined) throw new Error(`artifact not found: ${inputFile}`)
        if (file.encoding !== 'utf8') throw new Error(`artifact must be UTF-8 text: ${inputFile}`)
        const additionalFiles: Record<string, string> = {}
        for (const raw of args.input_files ?? []) {
          const additionalPath = requireSkillResourcePath(raw)
          if (additionalPath === inputFile) throw new Error('input_files must not repeat input_file')
          if (Object.hasOwn(additionalFiles, additionalPath)) throw new Error(`input_files contains duplicate path ${JSON.stringify(additionalPath)}`)
          const additional = await workspace.read(additionalPath, exec.signal)
          if (additional === undefined) throw new Error(`artifact not found: ${additionalPath}`)
          if (additional.encoding !== 'utf8') throw new Error(`artifact must be UTF-8 text: ${additionalPath}`)
          additionalFiles[additionalPath] = additional.content
        }
        const context = {
          ...args.input_context ?? {},
          ...Object.keys(additionalFiles).length === 0 ? {} : { input_files: additionalFiles },
        }
        scriptInput = Object.keys(context).length === 0 ? file.content : `${JSON.stringify(context)}\n${file.content}`
      }

      const result = await scripts.run(path, args.args ?? [], scriptInput, exec.signal)
      if (outputFile === undefined || result.exitCode !== 0) {
        return { stdout: result.stdout, stderr: result.stderr, exit_code: result.exitCode }
      }
      if (result.stdout === '') throw new Error('successful artifact-producing skill script produced empty stdout')
      const parts = outputFile.split('/')
      if (parts.length === 2 && parts[1] === `${parts[0]}.json`) {
        throw new Error('skill scripts cannot write a Bundle canonical JSON through output_file')
      }
      exec.signal.throwIfAborted()
      assertAccess(outputFile, exec.signal)
      await workspace.write(outputFile, { encoding: 'utf8', content: result.stdout }, exec.signal)
      return {
        stdout: '',
        stderr: result.stderr,
        exit_code: result.exitCode,
        written_path: outputFile,
        written_bytes: Buffer.byteLength(result.stdout, 'utf8'),
      }
    },
  })
}

/**
 * Register native-semantics Project Workspace operations in the calling Agent
 * scope. The caller must first restrict inherited tools so these definitions
 * are the Producer's complete file authority rather than aliases beside host FS.
 * @param ctx - unpublished Producer Agent context.
 * @param workspace - already-authorized invocation-local Project Workspace.
 * @param resources - immutable files confined to the invocation Bundle.
 * @param handoff - manifest policy controlling whether pending publication is valid.
 * @param activity - invocation-owned Host projection for serial artifact work.
 * @returns a controller exposing whether the Producer published and finished.
 */
export function registerDshProducerDesignTools(
  ctx: Context,
  workspace: ProducerProjectWorkspacePort,
  resources: DesignProducerSkillResourcePort,
  handoff: 'none' | DesignProducerPauseHandoff,
  activity: DesignProducerArtifactActivityPort,
  settlementDiagnostics: () => readonly string[] = () => [],
  scripts?: DesignProducerSkillScriptPort,
  inheritedTools: readonly string[] = [],
  reconstructionSourceRoot?: string,
  onPublished?: (receipt: DesignProducerFinishReceipt) => Promise<string>,
): DesignProducerToolController {
  const register = (definition: ToolDefinition) => {
    workspaceTools.add(definition)
    return ctx.tools.register(definition)
  }
  let finishReceipt: DesignProducerFinishReceipt | undefined
  let explicitAction: DesignProducerPublishAction | undefined

  const recover = async (receipt: ProducerProjectPublicationReceipt, mode: ProducerProjectPublicationMode, signal: AbortSignal): Promise<ProducerProjectPublicationReceipt> => {
    if (receipt.recovery === undefined || workspace.recoverPublication === undefined || signal.aborted) return receipt
    try {
      const recovered = await workspace.recoverPublication(mode, signal)
      if (recovered.stateRevision !== receipt.stateRevision) throw new Error('follow-up recovery changed its committed revision')
      return { ...recovered,
        ...(recovered.indexMaintenance !== undefined ? {} : receipt.indexMaintenance === undefined ? {} : { indexMaintenance: receipt.indexMaintenance }),
      }
    } catch (error) {
      return { ...receipt, recovery: { ...receipt.recovery,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 2048),
      } }
    }
  }

  const settle = async (
    action: DesignProducerPublishAction,
    signal: AbortSignal,
  ): Promise<DesignProducerPublishResult> => {
    if (finishReceipt !== undefined) {
      const priorAction = finishReceipt.kind === 'pause' ? 'handoff' : 'complete'
      if (action !== priorAction) return { kind: 'invalid', action, diagnostics: ['A committed publication cannot change its outcome.'] }
      if (finishReceipt.recovery !== undefined) {
        const recovered = await recover(finishReceipt, action === 'complete' ? 'complete' : 'in_progress', signal)
        finishReceipt = finishReceipt.kind === 'pause'
          ? Object.freeze({ kind: 'pause', handoff: finishReceipt.handoff, ...recovered })
          : Object.freeze({ kind: 'complete', ...recovered })
      }
      return { kind: 'unchanged', action, stateRevision: finishReceipt.stateRevision,
        ...(finishReceipt.indexMaintenance === undefined ? {} : { indexMaintenance: finishReceipt.indexMaintenance }),
        ...(finishReceipt.recovery === undefined ? {} : { recovery: finishReceipt.recovery }),
      }
    }
    const unsettled = [...settlementDiagnostics()]
    if (unsettled.length > 0) {
      return {
        kind: 'invalid',
        action,
        diagnostics: unsettled.map(message => `Cannot finish yet: ${message}. Wait for the attached work to settle.`),
      }
    }
    const pausing = action === 'handoff'
    if (pausing && handoff === 'none') {
      return { kind: 'invalid', action, diagnostics: ['This Bundle has no manifest handoff and cannot pause.'] }
    }
    const publication = await workspace.publish(pausing ? 'in_progress' : 'complete', signal)
    if (publication.kind === 'conflict') return {
      ...publication,
      action,
      paths: [...publication.paths],
      diagnostics: [...publication.diagnostics],
    }
    if (publication.kind === 'invalid') return { kind: 'invalid', action, diagnostics: [...publication.diagnostics] }
    const { kind: _published, ...accepted } = publication
    // Both main and native Producer placement use this path. Consume a
    // transient follow-up outage once, without a model turn or polling loop.
    const published = await recover(accepted, pausing ? 'in_progress' : 'complete', signal)
    finishReceipt = pausing
      ? Object.freeze({ kind: 'pause', handoff: handoff as DesignProducerPauseHandoff, ...published })
      : Object.freeze({ kind: 'complete', ...published })
    return { kind: 'published', action, ...published }
  }

  register(defineTool({
    name: 'design_revisions',
    description: 'List bounded newest-first Published Git revisions that touched this Bundle canonical file. This is read-only and never changes HEAD, files, or Design state.',
    parameters: {
      limit: { type: 'integer', description: 'Maximum revisions to return, from 1 to 100. Defaults to 20.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          revisions: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                commit: { type: 'string', required: true },
                committedAt: { type: 'string', required: true },
                subject: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => text(value.revisions.length === 0
        ? 'No Published revisions touch this Bundle canonical file.'
        : value.revisions.map(entry => `${entry.commit} ${entry.committedAt} ${entry.subject}`).join('\n')),
    },
    async execute(args, exec) {
      const limit = args.limit ?? 20
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100')
      return { revisions: [...await workspace.revisions(limit, exec.signal)] }
    },
  }))

  register(defineTool({
    name: 'design_restore_snapshot',
    description: 'Safely restore only this invocation Bundle from one exact Published ancestor. '
      + 'Always call action preview first and inspect the affected paths. Call action apply only when the user explicitly authorized overwriting those paths, passing the one-time preview_token and user_authorized_overwrite=true. '
      + 'Apply changes only the WorkingCopy: inspect diff, run design_validate, and use design_publish to create a new audited commit. This never moves HEAD backward or runs checkout/reset.',
    parameters: {
      action: { type: 'string', required: true, enum: ['preview', 'apply'] },
      revision: { type: 'string', required: true, description: 'Exact full lowercase Published commit object id.' },
      preview_token: { type: 'string', description: 'One-time token returned by the immediately preceding preview.' },
      user_authorized_overwrite: { type: 'boolean', description: 'Must be true for apply and represents explicit user authorization for the previewed overwrite.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'preview' },
              preview_token: { type: 'string', required: true },
              revision: { type: 'string', required: true },
              current_revision: { type: 'string', required: true },
              changed_paths: { type: 'array', required: true, items: { type: 'string' } },
              overwritten_unpublished_paths: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'staged' },
              revision: { type: 'string', required: true },
              changed_paths: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        ],
      },
      render: (_args, value) => text(value.kind === 'preview'
        ? [
            `Restore preview ${value.revision} over ${value.current_revision}:`,
            ...(value.changed_paths.length === 0 ? ['no Bundle files change'] : value.changed_paths),
            ...(value.overwritten_unpublished_paths.length === 0
              ? []
              : ['Unpublished WorkingCopy paths that would be overwritten:', ...value.overwritten_unpublished_paths]),
          ].join('\n')
        : `Staged ${value.changed_paths.length} restored Bundle path(s) from ${value.revision}; validate and publish explicitly.`),
    },
    async execute(args, exec) {
      if (args.action === 'preview') {
        if (args.preview_token !== undefined || args.user_authorized_overwrite !== undefined) {
          throw new Error('restore preview accepts only action and revision')
        }
        const preview = await workspace.previewRestore(args.revision, exec.signal)
        return {
          kind: 'preview' as const,
          preview_token: preview.previewToken,
          revision: preview.revision,
          current_revision: preview.currentRevision,
          changed_paths: [...preview.changedPaths],
          overwritten_unpublished_paths: [...preview.overwrittenUnpublishedPaths],
        }
      }
      if (args.preview_token === undefined || args.preview_token.trim() === '') {
        throw new Error('restore apply requires the one-time preview_token')
      }
      const staged = await workspace.restoreSnapshot(
        args.revision,
        args.preview_token,
        args.user_authorized_overwrite === true,
        exec.signal,
      )
      return { kind: 'staged' as const, revision: staged.revision, changed_paths: [...staged.changedPaths] }
    },
  }))

  register(defineTool({
    name: 'design_focus_artifact',
    description: 'Focus one explicitly identified Bundle-owned artifact before doing serial Producer work on it. '
      + 'The Host binds the real Producer attempt and native session log to that artifact until another artifact is focused. '
      + 'This records execution association only; it does not write Design state or prove artifact acceptance. '
      + 'Delegated workers are observed automatically and do not need this tool.',
    parameters: {
      artifact_kind: { type: 'string', required: true, description: 'Opaque panel activity label.' },
      artifact_id: { type: 'string', required: true, description: 'Stable node id used to bind Producer activity to the panel.' },
      artifact_file: { type: 'string', required: true, description: 'Exact Bundle-owned artifact path being authored.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifact_id: { type: 'string', required: true },
          focused: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => text(`focused artifact ${value.artifact_id}`),
    },
    async execute(args) {
      const artifactKind = args.artifact_kind.trim()
      if (artifactKind === '') throw new Error('artifact_kind must be non-empty text')
      const artifactId = await activity.focus(artifactKind, args.artifact_id, args.artifact_file)
      return { artifact_id: artifactId, focused: true }
    },
  }))

  register(defineTool({
    name: 'read_skill_resource',
    description: 'Read one immutable reference or asset bundled with the current Design skill. '
      + 'The invocation Bundle is already bound and cannot be selected through tool arguments. '
      + 'A resource that exceeds one bounded page returns next_offset; continue reading from that offset.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path relative to the current skill package.' },
      offset: { type: 'integer', description: 'Zero-based Unicode-character offset. Defaults to 0.' },
      max_chars: {
        type: 'integer',
        description: `Maximum Unicode characters to return, from 1 through ${DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS}.`,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          offset: { type: 'integer', required: true },
          total_chars: { type: 'integer', required: true },
          complete: { type: 'boolean', required: true },
          next_offset: { type: 'integer' },
        },
      },
      render: (args, value) => text([
        `${args.path} (characters ${value.offset}-${value.offset + Array.from(value.content).length} of ${value.total_chars})`,
        value.content,
        value.complete ? 'End of resource.' : `Continue with offset=${value.next_offset}.`,
      ].join('\n')),
    },
    async execute(args, exec) {
      const path = requireSkillResourcePath(args.path)
      const content = await resources.read(path, exec.signal)
      if (content === undefined) throw new Error(`resource not found: ${path}`)
      const page = pageDesignSkillResource(content, args.offset, args.max_chars)
      return {
        content: page.content,
        offset: page.offset,
        total_chars: page.totalCharacters,
        complete: page.complete,
        ...page.nextOffset === undefined ? {} : { next_offset: page.nextOffset },
      }
    },
  }))

  if (scripts !== undefined) register(createDesignSkillScriptTool(workspace, scripts, (_output, signal) => signal.throwIfAborted()))

  register(defineTool({
    name: READ_DESIGN_FILE_TOOL,
    description: 'Read one Design-Files-relative file from the current Design Project working copy. '
      + 'Use this for canonical Design JSON and Design artifacts regardless of the native session cwd; '
      + 'use inherited native read tools only for Host-authorized application/source evidence.',
    parameters: {
      path: { type: 'string', required: true, description: 'Path relative to the bound Design Files root.' },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'missing' },
              path: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'file' },
              path: { type: 'string', required: true },
              encoding: { type: 'string', required: true, enum: ['utf8', 'base64'] },
              content: { type: 'string', required: true },
            },
          },
        ],
      },
      render: (_args, value) => text(value.kind === 'missing' ? `${value.path}: not found` : value.content),
    },
    async execute(args, exec) {
      const file = await workspace.read(args.path, exec.signal)
      return file === undefined
        ? { kind: 'missing' as const, path: args.path }
        : { kind: 'file' as const, path: args.path, ...file }
    },
  }))

  register(defineTool({
    name: 'list',
    description: 'List files visible in the current Design Project working copy. '
      + 'The project and writable scope are already bound; pass only an optional glob pattern.',
    parameters: {
      pattern: { type: 'string', description: 'Optional glob over project-relative paths.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => text(value.paths.join('\n')),
    },
    async execute(args, exec) {
      return { paths: [...await workspace.list(args.pattern, exec.signal)] }
    },
  }))

  // Prefer the Host's native `read` when it was inherited. The Producer runs
  // with the Design Files root as cwd, so relative reads still cover the whole
  // Design Project, while absolute Host-authorized paths can inspect the
  // application workspace. Keep the scoped fallback for deployments without a
  // native reader; never register a same-name wrapper that would shadow it.
  if (!inheritedTools.includes('read')) register(defineTool({
      name: 'read',
      description: 'Read one project-relative file from the current Design Project working copy. '
        + 'Text is returned as UTF-8 and binary content as base64.',
      parameters: {
        path: { type: 'string', required: true, description: 'Project-relative file path.' },
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'missing' },
                path: { type: 'string', required: true },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', required: true, const: 'file' },
                path: { type: 'string', required: true },
                encoding: { type: 'string', required: true, enum: ['utf8', 'base64'] },
                content: { type: 'string', required: true },
              },
            },
          ],
        },
        render: (_args, value) => text(value.kind === 'missing' ? `${value.path}: not found` : value.content),
      },
      async execute(args, exec) {
        const file = await workspace.read(args.path, exec.signal)
        return file === undefined
          ? { kind: 'missing' as const, path: args.path }
          : { kind: 'file' as const, path: args.path, ...file }
      },
    }))

  register(defineTool({
    name: 'write',
    description: 'Create or replace one project-relative file in the current invocation Bundle '
      + 'owned state/artifact working copy. The writable Bundle is already bound.',
    parameters: {
      path: { type: 'string', required: true, description: 'Project-relative destination path.' },
      content: { type: 'string', required: true, description: 'UTF-8 text or base64 bytes according to encoding.' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Content encoding. Defaults to utf8.' },
    },
    output: { schema: PATH_RESULT, render: (_args, value) => text(`saved ${value.path} in the filesystem worktree; the panel can observe it now and Git records the invocation once at its terminal boundary`) },
    async execute(args, exec) {
      await workspace.write(args.path, {
        encoding: args.encoding ?? 'utf8',
        content: args.content,
      }, exec.signal)
      return { path: args.path }
    },
  }))

  register(defineTool({
    name: 'edit',
    description: 'Replace exact text in one project-relative UTF-8 file owned by the current invocation Bundle workspace.',
    parameters: {
      path: { type: 'string', required: true, description: 'Project-relative text file path.' },
      old_text: { type: 'string', required: true, description: 'Exact text to replace.' },
      new_text: { type: 'string', required: true, description: 'Replacement text.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring one.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          replacements: { type: 'number', required: true },
        },
      },
      render: (_args, value) => text(`saved edit in the filesystem worktree at ${value.path}: ${value.replacements} replacement(s); the panel can observe it now and Git records the invocation once at its terminal boundary`),
    },
    async execute(args, exec) {
      const result = await workspace.edit(
        args.path,
        args.old_text,
        args.new_text,
        args.replace_all ?? false,
        exec.signal,
      )
      return { path: args.path, replacements: result.replacements }
    },
  }))

  register(defineTool({
    name: 'delete',
    description: 'Delete one project-relative file from the current invocation Bundle owned working copy.',
    parameters: {
      path: { type: 'string', required: true, description: 'Project-relative file path.' },
    },
    output: { schema: PATH_RESULT, render: (_args, value) => text(`saved deletion in the filesystem worktree for ${value.path}; the panel can observe it now and Git records the invocation once at its terminal boundary`) },
    async execute(args, exec) {
      await workspace.remove(args.path, exec.signal)
      return { path: args.path }
    },
  }))

  register(defineTool({
    name: 'move',
    description: 'Move one file inside the current invocation Bundle owned working copy.',
    parameters: {
      from: { type: 'string', required: true, description: 'Project-relative source path.' },
      to: { type: 'string', required: true, description: 'Project-relative destination path.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
        },
      },
      render: (_args, value) => text(`saved move in the filesystem worktree from ${value.from} to ${value.to}; the panel can observe it now and Git records the invocation once at its terminal boundary`),
    },
    async execute(args, exec) {
      await workspace.move(args.from, args.to, exec.signal)
      return { from: args.from, to: args.to }
    },
  }))

  register(defineTool({
    name: 'copy',
    description: 'Copy one existing file byte-for-byte into the current Bundle without moving bytes through model arguments. Use project-relative paths, or an absolute source inside the authorized reconstruction input. No directories; at most 10 MiB. An existing different destination is not overwritten.',
    parameters: {
      from: { type: 'string', required: true, description: 'Project-relative source, or absolute file in the reconstruction input.' },
      to: { type: 'string', required: true, description: 'Project-relative destination owned by this Bundle.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string', required: true },
      bytes: { type: 'integer', required: true },
    } }, render: (_args, value) => text(`copied ${value.bytes} bytes to ${value.path}; source unchanged`) },
    execute: (args, exec) => copyProducerFile(workspace, args.from, args.to, exec.signal, reconstructionSourceRoot),
  }))

  register(defineTool({
    name: 'diff',
    description: 'Show the complete current Design Project working-copy diff from its pinned committed baseline.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { diff: { type: 'string', required: true } },
      },
      render: (_args, value) => text(value.diff),
    },
    async execute(_args, exec) {
      return { diff: await workspace.diff(exec.signal) }
    },
  }))

  register(defineTool({
    name: 'design_validate',
    description: handoff === 'none'
      ? 'Validate the current Design Project working copy for complete publication without publishing it.'
      : 'Validate the current Design Project working copy without publishing it. '
        + `Choose pause only when returning the manifest-owned ${handoff} handoff.`,
    parameters: {
      outcome: {
        type: 'string',
        required: true,
        enum: handoff === 'none' ? ['complete'] : ['complete', 'pause'],
        description: 'Intended settlement after validation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valid: { type: 'boolean', required: true },
          diagnostics: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => text(value.valid ? 'Design working copy is valid.' : value.diagnostics.join('\n')),
    },
    async execute(args, exec) {
      const mode = args.outcome === 'pause' ? 'in_progress' : 'complete'
      const diagnostics = [...await workspace.validate(mode, exec.signal)]
      return { valid: diagnostics.length === 0, diagnostics }
    },
  }))

  register(defineTool({
    name: 'design_publish',
    description: handoff === 'none'
      ? 'Validate and atomically publish the complete Design working copy, ending this Producer invocation.'
      : 'Validate and atomically publish once: handoff for the manifest-owned user gate, or complete for terminal completion.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: handoff === 'none' ? ['complete'] : ['handoff', 'complete'],
        description: 'This invocation\'s publication action; it is not persisted Design state.',
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'invalid' },
              action: { type: 'string', required: true, enum: ['handoff', 'complete'] },
              diagnostics: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'conflict' },
              action: { type: 'string', required: true, enum: ['handoff', 'complete'] },
              expectedHead: { type: 'string', required: true },
              currentHead: { type: 'string', required: true },
              paths: { type: 'array', required: true, items: { type: 'string' } },
              diagnostics: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'unchanged' },
              action: { type: 'string', required: true, enum: ['handoff', 'complete'] },
              stateRevision: { type: 'string', required: true },
              settlement: { type: 'string' },
              indexMaintenance: { type: 'object', additionalProperties: false, properties: {
                state: { type: 'string', required: true, const: 'deferred' }, message: { type: 'string', required: true },
              } },
              recovery: { type: 'object', additionalProperties: false, properties: {
                stage: { type: 'string', required: true, enum: ['journal', 'diff'] },
                state: { type: 'string', required: true, const: 'pending' }, message: { type: 'string', required: true },
              } },
            },
          },
          {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'published' },
              action: { type: 'string', required: true, enum: ['handoff', 'complete'] },
              stateRevision: { type: 'string', required: true },
              diff: { type: 'string', required: true },
              settlement: { type: 'string' },
              indexMaintenance: { type: 'object', additionalProperties: false, properties: {
                state: { type: 'string', required: true, const: 'deferred' }, message: { type: 'string', required: true },
              } },
              recovery: { type: 'object', additionalProperties: false, properties: {
                stage: { type: 'string', required: true, enum: ['journal', 'diff'] },
                state: { type: 'string', required: true, const: 'pending' }, message: { type: 'string', required: true },
              } },
            },
          },
        ],
      },
      render: (_args, value) => text([
        'settlement' in value && value.settlement ? value.settlement
          : value.kind === 'invalid' || value.kind === 'conflict' ? value.diagnostics.join('\n')
          : value.kind === 'unchanged' ? `Design state is unchanged at ${value.stateRevision} for ${value.action}.`
            : `Published Design revision ${value.stateRevision} for ${value.action}.`,
        'recovery' in value && value.recovery ? `Content is committed; ${value.recovery.stage} recovery is pending: ${value.recovery.message}. Do not rewrite content or change Git settings.` : '',
        'indexMaintenance' in value && value.indexMaintenance ? `Content is committed; ordinary Git index maintenance is deferred: ${value.indexMaintenance.message}. Do not remove index locks.` : '',
      ].filter(Boolean).join('\n')),
    },
    async execute(args, exec) {
      const action = args.action as DesignProducerPublishAction
      explicitAction = action
      const result = await settle(action, exec.signal)
      if (result.kind === 'published' || result.kind === 'unchanged') {
        if (onPublished !== undefined && finishReceipt !== undefined) {
          const settlement = await onPublished(finishReceipt)
          if (finishReceipt.kind === 'pause') exec.concludeTurn()
          return { ...result, settlement }
        }
        exec.concludeTurn()
      }
      return result
    },
  }))

  return Object.freeze({
    finished: () => finishReceipt,
    requestedAction: () => explicitAction,
    settle,
  })
}
