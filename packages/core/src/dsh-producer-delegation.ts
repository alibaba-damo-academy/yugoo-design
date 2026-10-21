/** Foreground file-worker delegation installed only in a Producer scope. */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentResult, SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createDesignSkillScriptTool, type DesignProducerSkillScriptPort, type ProducerProjectWorkspacePort } from './dsh-producer-design-tools.ts'
import type { DesignFileWorkerRequest } from './dsh-file-worker-agent.ts'
import type { DesignExecutionAttemptPayload } from './types.ts'
import type { DesignArtifactAttemptRegistry } from './artifact-attempt-registry.ts'
import { RECONSTRUCTION_WORKER_METHOD } from './reconstruction-prompt.ts'
import { KNOWLEDGE_AGENTIC_GUIDANCE } from './design-knowledge-query.ts'
import { DESIGN_WORKER_EVIDENCE_GUIDANCE } from './design-generation-guidance.ts'

export const DESIGN_DELEGATE_TOOL = 'design_delegate'
export const DESIGN_DELEGATE_FRONTIER_TOOL = 'design_delegate_frontier'
const DEFAULT_FRONTIER_CONCURRENCY = 4
const MAX_FRONTIER_ITEMS = 64
const READ_ARTIFACT = 'design_worker_read_artifact'
const WRITE_ARTIFACT = 'design_worker_write_artifact'
const EDIT_ARTIFACT = 'design_worker_edit_artifact'
export const WORKER_DENIED_PRODUCER_TOOLS = Object.freeze([
  'write',
  'edit',
  'delete',
  'move',
  'copy',
  'design_validate',
  'design_publish',
  'design_revisions',
  'design_restore_snapshot',
  'design_focus_artifact',
  'read_design_file',
  'design_delegate',
  'design_delegate_frontier',
])

export interface DshProducerDesignDelegation {
  install(ctx: Context): void
  settlementDiagnostics(): readonly string[]
}

export interface DshDesignDelegationOptions {
  readonly skillName: string
  readonly reconstruct?: boolean
  readonly provider: string
  readonly startSubagent: (provider: string, request: SubagentStartRequest) => Promise<SubagentRun>
  /** Explicit plugin-owned Worker route; other configured providers retain their native route. */
  readonly startFileWorker?: (request: Omit<DesignFileWorkerRequest, 'descriptor'>) => Promise<SubagentRun>
  readonly workerEvidenceTools?: readonly string[]
  readonly scripts?: DesignProducerSkillScriptPort
  readonly maxDepth: number
  readonly maxTokens?: number
  /** Maximum Workers started concurrently by one deterministic frontier call. */
  readonly maxConcurrency?: number
  readonly attempts: DesignArtifactAttemptRegistry
  readonly workspace: ProducerProjectWorkspacePort
  readonly recordAttempt: (event: Omit<DesignExecutionAttemptPayload, 'projectId' | 'invocationId' | 'skill'>) => void
}

interface WorkerAssignment {
  readonly path: string
  readonly artifactId: string
  readonly attempt: string
  readonly claimAttempt: string
  child?: string
}

interface PreparedFrontierItem {
  readonly artifactKind: string
  readonly artifactId: string
  readonly path: string
  readonly prompt: string
  readonly attempt: string
  readonly claims: readonly string[]
}

type ArtifactReceipt = Readonly<{ path: string; sha256: string; bytes: number; attempt: string }>

type FrontierItemResult = Readonly<{
  artifact_kind: string
  artifact_id: string
  artifact_file: string
  status: 'completed' | 'failed' | 'cancelled' | 'not_started'
  artifact?: ArtifactReceipt
  diagnostic?: string
}>

interface FrontierBatchEntry {
  readonly fingerprint: string
  readonly promise: Promise<Readonly<{ batch_id: string; items: FrontierItemResult[] }>>
}

function nonEmpty(value: string, name: string): string {
  if (value.trim() === '') throw new Error(`${name} must be non-empty text`)
  return value.trim()
}

function artifactPath(value: string, skillName: string): string {
  const path = nonEmpty(value, 'design delegation artifact_file')
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`design delegation artifact_file must be a safe relative path: ${JSON.stringify(path)}`)
  }
  if (!path.startsWith(`${skillName}/`) || path === `${skillName}/${skillName}.json`) {
    throw new Error(`design delegation artifact_file ${JSON.stringify(path)} is outside Bundle ${JSON.stringify(skillName)} artifact scope`)
  }
  return path
}

function workerFailure(result: SubagentResult): Error | undefined {
  if (result.stopReason === 'completed') return undefined
  const partial = result.output
    .filter((block): block is Extract<ContentBlock, { readonly type: 'text' }> => block.type === 'text')
    .map(block => block.text).join('')
  return new Error([
    `Design artifact worker ended with ${String(result.stopReason)}`,
    ...result.diagnostic === undefined ? [] : [`Diagnostic: ${result.diagnostic}`],
    ...partial === '' ? [] : [`Partial output: ${partial}`],
  ].join('\n'))
}

function promptText(
  prompt: string,
  artifactKind: string,
  artifactId: string,
  path: string,
  assignmentId: string,
  reconstruct: boolean,
): string {
  return [
    prompt,
    DESIGN_WORKER_EVIDENCE_GUIDANCE,
    KNOWLEDGE_AGENTIC_GUIDANCE,
    '', '<delegation_artifact>', JSON.stringify({ artifact_kind: artifactKind, artifact_id: artifactId, artifact_file: path }), '</delegation_artifact>',
    '', `Your only Design Project output is the pre-bound artifact ${JSON.stringify(path)}.`,
    `Use ${READ_ARTIFACT}, ${WRITE_ARTIFACT}, and ${EDIT_ARTIFACT} with assignment_id ${JSON.stringify(assignmentId)} to inspect, create, and repair that file.`,
    'Do not modify canonical Design JSON or any other Design Project file.',
    'You inherit the Producer\'s Host-native read-only workspace tools. Use available read, read_image, glob, and grep tools directly when relevant source code, documentation, or visual evidence must be inspected; the Host path policy still applies.',
    'Follow the Producer assignment and shared Bundle artifact contract for the requested work, validation, and repair. A reconstruction assignment extracts source facts; it does not authorize forward design. The Host does not perform domain validation for you.',
    'Run Bundle scripts directly through run_skill_script using their documented CLI contract in the Bundle references. Use input_json only for small structured requests; use input_file, optional input_files, optional input_context, and optional output_file for artifacts so their bytes do not pass through your context. Do not read or inspect executable script source before running it unless the script itself reports an unexplained internal failure.',
    `Keep narration brief and write the complete artifact directly with ${WRITE_ARTIFACT}; do not spend the artifact output budget restating its contents.`,
    `Do not call ${READ_ARTIFACT} merely to check whether a write was complete, and do not rewrite the whole artifact based only on that check. Read only when the active Skill's validation or repair loop requires inspection.`,
    'Do not return artifact bytes as structured JSON. Finish only after the complete artifact is on disk.',
    ...(reconstruct ? ['<reconstruction_assignment>', RECONSTRUCTION_WORKER_METHOD, '</reconstruction_assignment>'] : []),
  ].join('\n')
}

function assignmentFor(
  assignments: ReadonlyMap<string, WorkerAssignment>,
  assignmentId: unknown,
  exec: ToolRunContext,
): WorkerAssignment {
  if (exec.agent === undefined) throw new Error('design artifact tools require a Worker Agent')
  const assignment = typeof assignmentId === 'string' ? assignments.get(assignmentId) : undefined
  if (assignment === undefined) throw new Error('design artifact tool is available only to an active delegated Worker')
  const child = String(exec.agent.session.id)
  if (assignment.child === undefined) assignment.child = child
  else if (assignment.child !== child) throw new Error('design artifact assignment belongs to another Worker')
  return assignment
}

/** Install generic exact-file capabilities that delegated Workers inherit from the Producer scope. */
function registerArtifactTools(
  ctx: Context,
  options: DshDesignDelegationOptions,
  assignments: ReadonlyMap<string, WorkerAssignment>,
  assertLive?: () => void,
): void {
  const active = (assignment: WorkerAssignment): void => {
    assertLive?.()
    if (!options.attempts.isActive(assignment.artifactId, assignment.claimAttempt)
      || !options.attempts.isActive(`path:${assignment.path}`, assignment.claimAttempt)) {
      throw new Error('design artifact assignment is no longer active')
    }
  }
  ctx.tools.register(defineTool({
    name: READ_ARTIFACT,
    description: 'Read the exact artifact pre-bound to this Worker.',
    parameters: { assignment_id: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      found: { type: 'boolean', required: true },
      path: { type: 'string', required: true },
      encoding: { type: 'string', enum: ['utf8', 'base64'] },
      content: { type: 'string' },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const assignment = assignmentFor(assignments, args.assignment_id, exec)
      active(assignment)
      const file = await options.workspace.read(assignment.path, exec.signal)
      return file === undefined
        ? { found: false, path: assignment.path }
        : { found: true, path: assignment.path, ...file }
    },
  }))
  ctx.tools.register(defineTool({
    name: WRITE_ARTIFACT,
    description: 'Create or replace the exact artifact pre-bound to this Worker.',
    parameters: {
      assignment_id: { type: 'string', required: true },
      content: { type: 'string', required: true },
      encoding: { type: 'string', enum: ['utf8', 'base64'] },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string', required: true },
      written: { type: 'boolean', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const assignment = assignmentFor(assignments, args.assignment_id, exec)
      active(assignment)
      await options.workspace.write(assignment.path, {
        encoding: args.encoding === 'base64' ? 'base64' : 'utf8',
        content: args.content,
      }, exec.signal)
      return { path: assignment.path, written: true }
    },
  }))
  ctx.tools.register(defineTool({
    name: EDIT_ARTIFACT,
    description: 'Repair UTF-8 text in the exact artifact pre-bound to this Worker.',
    parameters: {
      assignment_id: { type: 'string', required: true },
      old_text: { type: 'string', required: true },
      new_text: { type: 'string', required: true },
      replace_all: { type: 'boolean' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      path: { type: 'string', required: true },
      replacements: { type: 'integer', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const assignment = assignmentFor(assignments, args.assignment_id, exec)
      active(assignment)
      const result = await options.workspace.edit(
        assignment.path,
        args.old_text,
        args.new_text,
        args.replace_all === true,
        exec.signal,
      )
      return { path: assignment.path, replacements: result.replacements }
    },
  }))
}

async function runWorker(
  options: DshDesignDelegationOptions,
  artifactKind: string,
  prompt: string,
  artifactId: string,
  path: string,
  attempt: string,
  claimAttempt: string,
  assignments: Map<string, WorkerAssignment>,
  exec: ToolRunContext,
): Promise<ArtifactReceipt> {
  let run: SubagentRun | undefined
  let primaryError: unknown
  assignments.set(attempt, { path, artifactId, attempt, claimAttempt })
  try {
    const promptBlocks: ContentBlock[] = [{ type: 'text', text: promptText(prompt, artifactKind, artifactId, path, attempt, options.reconstruct === true) }]
    run = options.startFileWorker === undefined ? await options.startSubagent(options.provider, {
      label: `${artifactKind} · ${artifactId}`, parent: exec.agent!, signal: exec.signal,
      // Official DSH composes the parent scope before applying toolFilter.
      // Keep the per-child restriction; no patched-host inheritance flag is needed.
      maxDepth: options.maxDepth,
      toolFilter: { deny: WORKER_DENIED_PRODUCER_TOOLS },
      ...options.maxTokens === undefined ? {} : { agentOptions: { maxTokens: options.maxTokens } satisfies AgentOptions },
      prompt: promptBlocks,
    }) : await options.startFileWorker({
      parent: exec.agent!, signal: exec.signal, label: `${artifactKind} · ${artifactId}`,
      prompt: promptBlocks, maxDepth: options.maxDepth,
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      inheritedToolNames: options.workerEvidenceTools ?? [],
      installWorkerTools(childCtx, child) {
        const assignment = assignments.get(attempt)
        if (assignment === undefined) throw new Error('design artifact assignment unavailable during setup')
        const assertActive = (output?: string): void => {
          if (assignments.get(attempt) !== assignment
            || !options.attempts.isActive(artifactId, claimAttempt)
            || !options.attempts.isActive(`path:${path}`, claimAttempt)) throw new Error('design artifact assignment is no longer active')
          if (output !== undefined && output !== path) throw new Error('script output must match the assigned artifact')
        }
        assertActive()
        assignment.child = String(child.session.id)
        registerArtifactTools(childCtx, options, new Map([[attempt, assignment]]), assertActive)
        if (options.scripts !== undefined) childCtx.tools.register(createDesignSkillScriptTool({
          // Inputs use the invocation's already-authorized Design workspace.
          read: (inputPath, signal) => { assertActive(); return options.workspace.read(inputPath, signal) },
          write: (outputPath, file, signal) => { assertActive(outputPath); return options.workspace.write(outputPath, file, signal) },
        }, options.scripts, (output, signal) => { signal.throwIfAborted(); assertActive(output) }))
      },
    })
    if (run.localAgent === undefined) throw new Error('direct artifact delegation requires a local Worker')
    const assignment = assignments.get(attempt)
    if (assignment === undefined) throw new Error('design artifact assignment disappeared during Worker startup')
    const childKey = String(run.localAgent.session.id)
    if (assignment.child !== undefined && assignment.child !== childKey) {
      throw new Error('design artifact assignment was claimed by another Worker during startup')
    }
    assignment.child = childKey
    options.recordAttempt({ artifactId, artifactKind, artifactFile: path, attemptId: attempt, runId: String(run.id), parentRunId: String(exec.agent!.session.id), role: 'worker', phase: 'working' })
    const failure = workerFailure(await run.result)
    if (failure !== undefined) throw failure
    const file = await options.workspace.read(path, exec.signal)
    if (file === undefined) throw new Error(`Design artifact worker completed without writing ${JSON.stringify(path)}`)
    const content = file.encoding === 'utf8' ? Buffer.from(file.content, 'utf8') : Buffer.from(file.content, 'base64')
    if (content.length === 0) throw new Error(`Design artifact worker wrote an empty artifact ${JSON.stringify(path)}`)
    const receipt = Object.freeze({ path, sha256: createHash('sha256').update(content).digest('hex'), bytes: content.length, attempt })
    options.recordAttempt({ artifactId, artifactKind, artifactFile: path, attemptId: attempt, runId: String(run.id), parentRunId: String(exec.agent!.session.id), role: 'worker', phase: 'completed', receipt: { path, sha256: receipt.sha256, bytes: receipt.bytes } })
    return receipt
  } catch (error) {
    primaryError = error
    options.recordAttempt({ artifactId, artifactKind, artifactFile: path, attemptId: attempt, ...(run === undefined ? {} : { runId: String(run.id) }), parentRunId: String(exec.agent!.session.id), role: 'worker', phase: exec.signal.aborted ? 'cancelled' : 'failed', diagnostics: [error instanceof Error ? error.message : String(error)] })
    throw error
  } finally {
    assignments.delete(attempt)
    if (run !== undefined) {
      try { await run.dispose() } catch (error) { if (primaryError === undefined) throw error }
    }
  }
}

function preparedFrontierItem(raw: {
  readonly artifact_kind: string
  readonly artifact_id: string
  readonly artifact_file: string
  readonly prompt: string
}, skillName: string): PreparedFrontierItem {
  const artifactKind = nonEmpty(raw.artifact_kind, 'design delegation artifact_kind')
  const artifactId = nonEmpty(raw.artifact_id, 'design delegation artifact_id')
  const path = artifactPath(raw.artifact_file, skillName)
  const prompt = nonEmpty(raw.prompt, 'design delegation prompt')
  return Object.freeze({
    artifactKind,
    artifactId,
    path,
    prompt,
    attempt: randomUUID(),
    claims: Object.freeze([artifactId, `path:${path}`]),
  })
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertUniqueFrontier(items: readonly PreparedFrontierItem[]): void {
  const artifactIds = new Set<string>()
  const paths = new Set<string>()
  for (const item of items) {
    if (artifactIds.has(item.artifactId)) {
      throw new Error(`design delegation frontier contains duplicate artifact_id ${JSON.stringify(item.artifactId)}`)
    }
    if (paths.has(item.path)) {
      throw new Error(`design delegation frontier contains duplicate artifact_file ${JSON.stringify(item.path)}`)
    }
    artifactIds.add(item.artifactId)
    paths.add(item.path)
  }
}

function frontierFingerprint(items: readonly PreparedFrontierItem[]): string {
  return JSON.stringify(items.map(item => ({
    artifact_kind: item.artifactKind,
    artifact_id: item.artifactId,
    artifact_file: item.path,
    prompt: item.prompt,
  })))
}

async function runFrontier(
  options: DshDesignDelegationOptions,
  batchId: string,
  items: readonly PreparedFrontierItem[],
  claimAttempt: string,
  maxConcurrency: number,
  assignments: Map<string, WorkerAssignment>,
  frontier: { active: number },
  exec: ToolRunContext,
): Promise<Readonly<{ batch_id: string; items: FrontierItemResult[] }>> {
  const results: Array<FrontierItemResult | undefined> = new Array(items.length)
  let next = 0

  const settleItem = (item: PreparedFrontierItem): void => {
    options.attempts.retireAll(item.claims, claimAttempt)
    frontier.active -= 1
  }
  const runNext = async (): Promise<void> => {
    while (!exec.signal.aborted) {
      const index = next
      next += 1
      if (index >= items.length) return
      const item = items[index]!
      try {
        const artifact = await runWorker(
          options,
          item.artifactKind,
          item.prompt,
          item.artifactId,
          item.path,
          item.attempt,
          claimAttempt,
          assignments,
          exec,
        )
        results[index] = Object.freeze({
          artifact_kind: item.artifactKind,
          artifact_id: item.artifactId,
          artifact_file: item.path,
          status: 'completed',
          artifact,
        })
      } catch (error) {
        results[index] = Object.freeze({
          artifact_kind: item.artifactKind,
          artifact_id: item.artifactId,
          artifact_file: item.path,
          status: exec.signal.aborted ? 'cancelled' : 'failed',
          diagnostic: diagnostic(error),
        })
      } finally {
        settleItem(item)
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(maxConcurrency, items.length) },
    () => runNext(),
  ))

  for (let index = 0; index < items.length; index += 1) {
    if (results[index] !== undefined) continue
    const item = items[index]!
    const reason = 'Frontier cancelled before this Worker started.'
    options.recordAttempt({
      artifactId: item.artifactId,
      artifactKind: item.artifactKind,
      artifactFile: item.path,
      attemptId: item.attempt,
      parentRunId: String(exec.agent!.session.id),
      role: 'worker',
      phase: 'cancelled',
      diagnostics: [reason],
    })
    results[index] = Object.freeze({
      artifact_kind: item.artifactKind,
      artifact_id: item.artifactId,
      artifact_file: item.path,
      status: 'not_started',
      diagnostic: reason,
    })
    settleItem(item)
  }

  return Object.freeze({ batch_id: batchId, items: results as FrontierItemResult[] })
}

function frontierTool(
  options: DshDesignDelegationOptions,
  assignments: Map<string, WorkerAssignment>,
  frontier: { active: number },
  batches: Map<string, FrontierBatchEntry>,
  maxConcurrency: number,
): ToolDefinition {
  const itemSchema = {
    type: 'object', additionalProperties: false, properties: {
      artifact_kind: { type: 'string', required: true, description: 'Opaque activity label interpreted only by the active Bundle presentation.' },
      artifact_id: { type: 'string', required: true, description: 'Stable node id used to bind native execution activity to the panel.' },
      artifact_file: { type: 'string', required: true, description: 'Exact Bundle-owned artifact path this Worker must write.' },
      prompt: { type: 'string', required: true, description: 'Complete bounded assignment with source evidence, the requested method, artifact requirements, and Bundle validation instructions.' },
    },
  } as const
  const resultItemSchema = {
    type: 'object', additionalProperties: false, properties: {
      artifact_kind: { type: 'string', required: true },
      artifact_id: { type: 'string', required: true },
      artifact_file: { type: 'string', required: true },
      status: { type: 'string', required: true, enum: ['completed', 'failed', 'cancelled', 'not_started'] },
      artifact: { type: 'object', additionalProperties: false, properties: {
        path: { type: 'string', required: true },
        sha256: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        attempt: { type: 'string', required: true },
      } },
      diagnostic: { type: 'string' },
    },
  } as const
  return defineTool({
    name: DESIGN_DELEGATE_FRONTIER_TOOL,
    description: 'Atomically submit one complete frontier of independent, pre-bound Design artifacts. '
      + 'The Host validates and claims the whole frontier before starting any Worker, runs it with bounded concurrency, and returns every item in request order after all have settled. '
      + 'Use design_delegate for a single artifact or when this frontier tool is unavailable.',
    parameters: {
      batch_id: { type: 'string', required: true, description: 'Invocation-local idempotency key. Reuse only for the exact same ordered items.' },
      items: { type: 'array', required: true, items: itemSchema, description: 'Complete independent dependency frontier; dependent work belongs in a later call.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      batch_id: { type: 'string', required: true },
      items: { type: 'array', required: true, items: resultItemSchema },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      if (exec.agent === undefined) throw new Error('design_delegate_frontier requires a calling Producer Agent')
      const batchId = nonEmpty(rawArgs.batch_id, 'design delegation batch_id')
      if (rawArgs.items.length === 0) throw new Error('design delegation frontier must contain at least one item')
      if (rawArgs.items.length > MAX_FRONTIER_ITEMS) {
        throw new Error(`design delegation frontier cannot exceed ${MAX_FRONTIER_ITEMS} items`)
      }
      const items = Object.freeze(rawArgs.items.map(item => preparedFrontierItem(item, options.skillName)))
      assertUniqueFrontier(items)
      const fingerprint = frontierFingerprint(items)
      const existing = batches.get(batchId)
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error(`design delegation batch_id ${JSON.stringify(batchId)} was already used for different items in this invocation`)
        }
        return existing.promise
      }

      const claimAttempt = randomUUID()
      const claims = Object.freeze(items.flatMap(item => item.claims))
      options.attempts.claimAll(claims, claimAttempt)
      frontier.active += items.length
      try {
        for (const item of items) {
          options.recordAttempt({
            artifactId: item.artifactId,
            artifactKind: item.artifactKind,
            artifactFile: item.path,
            attemptId: item.attempt,
            parentRunId: String(exec.agent.session.id),
            role: 'worker',
            phase: 'queued',
          })
        }
      } catch (error) {
        options.attempts.retireAll(claims, claimAttempt)
        frontier.active -= items.length
        throw error
      }
      const promise = runFrontier(
        options,
        batchId,
        items,
        claimAttempt,
        maxConcurrency,
        assignments,
        frontier,
        exec,
      )
      batches.set(batchId, Object.freeze({ fingerprint, promise }))
      return promise
    },
  })
}

function delegationTool(
  options: DshDesignDelegationOptions,
  assignments: Map<string, WorkerAssignment>,
  frontier: { active: number },
): ToolDefinition {
  return defineTool({
    name: DESIGN_DELEGATE_TOOL,
    description: 'Start one foreground Worker for one explicitly identified, pre-bound Design artifact. '
      + 'The Producer assignment and Bundle artifact contract define the task and validation; the Host only binds execution status, logs, and the final file receipt.',
    parameters: {
      artifact_kind: { type: 'string', required: true, description: 'Opaque activity label interpreted only by the active Bundle presentation.' },
      artifact_id: { type: 'string', required: true, description: 'Stable node id used to bind native execution activity to the panel.' },
      artifact_file: { type: 'string', required: true, description: 'Exact Bundle-owned artifact path this Worker must write.' },
      prompt: { type: 'string', required: true, description: 'Complete bounded assignment with source evidence, the requested method, artifact requirements, and Bundle validation instructions.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      artifact_kind: { type: 'string', required: true },
      artifact: { type: 'object', required: true, additionalProperties: false, properties: {
        path: { type: 'string', required: true },
        sha256: { type: 'string', required: true },
        bytes: { type: 'integer', required: true },
        attempt: { type: 'string', required: true },
      } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(rawArgs, exec) {
      if (exec.agent === undefined) throw new Error('design_delegate requires a calling Producer Agent')
      const artifactKind = nonEmpty(String(rawArgs.artifact_kind ?? ''), 'design delegation artifact_kind')
      const artifactId = nonEmpty(String(rawArgs.artifact_id ?? ''), 'design delegation artifact_id')
      const path = artifactPath(String(rawArgs.artifact_file ?? ''), options.skillName)
      const prompt = nonEmpty(String(rawArgs.prompt ?? ''), 'design delegation prompt')
      const attempt = randomUUID()
      const claims = Object.freeze([artifactId, `path:${path}`])
      options.attempts.claimAll(claims, attempt); frontier.active += 1
      options.recordAttempt({ artifactId, artifactKind, artifactFile: path, attemptId: attempt, parentRunId: String(exec.agent.session.id), role: 'worker', phase: 'queued' })
      try {
        return {
          artifact_kind: artifactKind,
          artifact: await runWorker(options, artifactKind, prompt, artifactId, path, attempt, attempt, assignments, exec),
        }
      } finally {
        options.attempts.retireAll(claims, attempt); frontier.active -= 1
      }
    },
  })
}

export function createDshDesignDelegation(options: DshDesignDelegationOptions): DshProducerDesignDelegation {
  nonEmpty(options.skillName, 'design delegation skillName')
  nonEmpty(options.provider, 'design delegation provider')
  if (!Number.isSafeInteger(options.maxDepth) || options.maxDepth < 0) throw new Error('maxDepth must be a non-negative safe integer')
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_FRONTIER_CONCURRENCY
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency <= 0) throw new Error('maxConcurrency must be a positive safe integer')
  const assignments = new Map<string, WorkerAssignment>()
  const frontier = { active: 0 }
  const batches = new Map<string, FrontierBatchEntry>()
  return Object.freeze({
    install(ctx: Context) {
      if (options.startFileWorker === undefined) registerArtifactTools(ctx, options, assignments)
      ctx.tools.register(delegationTool(options, assignments, frontier))
      ctx.tools.register(frontierTool(options, assignments, frontier, batches, maxConcurrency))
    },
    settlementDiagnostics: () => frontier.active === 0 ? Object.freeze([]) : Object.freeze([`${frontier.active} delegated Worker call(s) are still active`]),
  })
}
