/** Production DSH composition for the canonical attached Design Producer lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { designSessionEvents } from './dsh-session-events.ts'
import { snapshotJsonValue, type JsonValue } from './json-value.ts'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { isDeepStrictEqual } from 'node:util'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type DesignService from './design-service.ts'
import { DESIGN_FILES_UNBORN_REVISION, requireDesignFileRelativePath, type DesignWriteEvent } from './design-files.ts'
import { designText, latestDirectHumanText, resolveConversationLocale, type DesignLocale } from './design-locale.ts'
import { reconstructionContractPrompt } from './reconstruction-prompt.ts'
import { registerReconstructionKnowledgeTool } from './dsh-reconstruction-knowledge-tool.ts'
import { KNOWLEDGE_AGENTIC_GUIDANCE } from './design-knowledge-query.ts'
import { DESIGN_EXECUTOR_EVIDENCE_GUIDANCE, DESIGN_SKILL_RESOURCE_GUIDANCE, availableDesignKnowledgeTools } from './design-generation-guidance.ts'
import {
  deriveCurrentDesignExecutionGate,
  deriveDesignExecutionGate,
  type DesignExecutionAuthorityRecord,
} from './design-execution-derivation.ts'
import {
  continueAfterDesignPanelEdit,
  engageDesignExecution,
  matchesDesignResumeAction,
  resolveDesignExecutionInput,
  resumeDesignExecution,
  type DesignExecutionGate,
  type DesignExecutionPin,
  type DesignExecutionProducerPort,
  type DesignExecutionProducerSettlement,
  type DesignExecutionSelection,
  type DesignExecutionTransition,
} from './design-execution-runtime.ts'
import type { DesignJournalRecord } from './design-journal.ts'
import type { DesignProjectId } from './design-project.ts'
import {
  createDshProducerSkillAgentRuntime,
  type DshProducerSkillAgentRuntime,
} from './dsh-producer-agent.ts'
import { createDshDesignDelegation } from './dsh-producer-delegation.ts'
import { registerDesignFileWorkerDispatcher, type DesignFileWorkerRequest } from './dsh-file-worker-agent.ts'
import { activeMainBundleWork, createMainBundleBridge } from './dsh-main-bundle.ts'
import { installDesignResumeRouting } from './dsh-design-resume.ts'
import { createDesignArtifactAttemptRegistry } from './artifact-attempt-registry.ts'
import type {
  ProducerProjectFile,
  ProducerProjectWorkspacePort,
} from './dsh-producer-design-tools.ts'
import {
  createProducerProjectWorkspace,
  ProducerWorkingCopyConflictError,
  ProducerWorkingCopyValidationError,
  type ProducerProjectWorkspace,
} from './producer-project-workspace.ts'
import { landedDesignArtifactSourceNames } from './design-artifact-publication.ts'
import {
  apply as registerRunDesignSkillTool,
  type RunDesignSkillPort,
  type RunDesignSkillResult,
} from './dsh-run-design-skill-tool.ts'
import { DshClarityLifecycle } from './dsh-clarity-lifecycle.ts'
import { projectDesignExecutionProvenance } from './dsh-execution-provenance.ts'
import type {
  DesignProducerToolObservation,
  DesignProducerEvidenceRecord,
  DesignProducerContribution,
  DesignProducerPublicationContext,
  DesignProducerPublicationSnapshot,
} from './runtime-drivers.ts'
import { manifestFor, nodeFs } from './service-tools.ts'
import type { DesignExecutionAttemptPayload, DesignKit, DesignSkill } from './types.ts'

/** Deployment-tunable bounds for the required Producer Agent. */
export interface Config {
  /** Optional output-token ceiling for one Producer Agent. */
  readonly producerMaxTokens?: number
  /** Optional absolute delegation depth cap for the Producer Agent. */
  readonly producerMaxDepth?: number
  /** Optional DSH nested-worker acceleration; absence keeps every Producer serial. */
  readonly delegation?: {
    /** Registered one-shot DSH subagent provider. */
    readonly provider: string
    /** Absolute delegation depth cap enforced by the selected provider. */
    readonly maxDepth: number
    /** Optional child output-token ceiling over the inherited model route. */
    readonly maxTokens?: number
    /** Maximum Workers started concurrently by one frontier call. */
    readonly maxConcurrency?: number
  }
  /** Maximum exact-revision Design File count exposed to a Producer finalizer. */
  readonly maxArtifactInputFiles: number
  /** Maximum UTF-8 byte length of one finalizer source path. */
  readonly maxArtifactInputPathBytes: number
  /** Maximum UTF-8 bytes read from one finalizer source file. */
  readonly maxArtifactInputFileBytes: number
  /** Maximum aggregate UTF-8 bytes exposed to one finalizer. */
  readonly maxArtifactInputTotalBytes: number
}

interface ResolvedConfig {
  readonly producerMaxTokens?: number
  readonly producerMaxDepth?: number
  readonly delegation?: {
    readonly provider: string
    readonly maxDepth: number
    readonly maxTokens?: number
    readonly maxConcurrency?: number
  }
  readonly maxArtifactInputFiles: number
  readonly maxArtifactInputPathBytes: number
  readonly maxArtifactInputFileBytes: number
  readonly maxArtifactInputTotalBytes: number
}

interface DshExecutionHost {
  readonly design: DesignService
  readonly subprocess: SubprocessLike
}

interface SubprocessOutputReaderLike {
  readFrom(offset: number): { readonly text: string; readonly lossy: boolean }
}

interface SubprocessLike {
  spawn(request: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly stdio: {
      readonly stdin: { readonly data: string }
      readonly stdout: { readonly maxBytes: number }
      readonly stderr: { readonly maxBytes: number }
    }
    readonly graceMs: number
    readonly signal?: AbortSignal
  }): {
    readonly done: Promise<{ readonly exitCode: number | null }>
    readonly collected: {
      readonly stdout?: SubprocessOutputReaderLike
      readonly stderr?: SubprocessOutputReaderLike
    }
  }
}

export function createSkillScriptPort(kit: DesignKit, skill: DesignSkill, subprocess: SubprocessLike) {
  const root = skill.resourceRoot ?? kit.sourceRoot
  if (root === undefined) return undefined
  const scriptsRoot = skill.resourceRoot === undefined
    ? resolve(root, 'skills', skill.name, 'scripts') : resolve(root, 'scripts')
  return Object.freeze({
    async run(path: string, args: readonly string[], stdin: string, signal: AbortSignal) {
      signal.throwIfAborted()
      if (Buffer.byteLength(stdin, 'utf8') > 8 * 1024 * 1024) throw new Error('skill script stdin exceeds 8 MiB')
      if (args.length > 32 || args.some(value => Buffer.byteLength(value, 'utf8') > 4_096 || value.includes('\0'))) {
        throw new Error('skill script args exceed their bounded literal argv contract')
      }
      const candidate = resolve(scriptsRoot, path)
      const [realRoot, realScript] = await Promise.all([realpath(scriptsRoot), realpath(candidate)])
      if (realScript !== realRoot && !realScript.startsWith(`${realRoot}${sep}`)) {
        throw new Error('skill script path escapes the active Skill scripts directory')
      }
      const info = await stat(realScript)
      if (!info.isFile() || !realScript.endsWith('.mjs')) throw new Error('skill scripts must be regular .mjs files')
      const handle = subprocess.spawn({
        argv: Object.freeze([process.execPath, realScript, ...args]),
        cwd: dirname(realScript),
        stdio: {
          stdin: { data: stdin },
          stdout: { maxBytes: 8 * 1024 * 1024 },
          stderr: { maxBytes: 1024 * 1024 },
        },
        graceMs: 5_000,
        signal,
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      if (stdout?.lossy === true || stderr?.lossy === true) throw new Error('skill script output exceeded its configured limit')
      return Object.freeze({
        stdout: stdout?.text ?? '',
        stderr: stderr?.text ?? '',
        exitCode: outcome.exitCode ?? -1,
      })
    },
  })
}

type DesignSubagentStart = (provider: string, request: SubagentStartRequest) => Promise<SubagentRun>
type DesignFileWorkerStart = (request: Omit<DesignFileWorkerRequest, 'descriptor'>) => Promise<SubagentRun>

function positiveOptional(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`design execution: ${name} must be a positive safe integer`)
  }
  return value
}

function positive(value: number, name: string): number {
  const resolved = positiveOptional(value, name)
  if (resolved === undefined) throw new Error(`design execution: ${name} is required`)
  return resolved
}

function nonNegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new Error(`design execution: ${name} must be a non-negative safe integer`)
  }
  return value
}

function nonEmptyText(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`design execution: ${name} must be non-empty text`)
  }
  return value
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function manifestProducerTools(skill: DesignSkill): Readonly<{
  required: readonly string[]
  optional: readonly string[]
}> {
  const manifest = skill.metadata?.skillManifest
  const producer = isRecord(manifest) ? manifest.producer : undefined
  if (producer === undefined) return Object.freeze({ required: Object.freeze([]), optional: Object.freeze([]) })
  if (!isRecord(producer)) throw new Error(`design producer: Bundle ${JSON.stringify(skill.name)} producer must be an object`)
  if (Object.keys(producer).some(key => key !== 'required_tools' && key !== 'optional_tools')) {
    throw new Error(`design producer: Bundle ${JSON.stringify(skill.name)} producer accepts only required_tools and optional_tools`)
  }
  const list = (value: unknown, field: string): readonly string[] => {
    if (value === undefined) return Object.freeze([])
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || entry.trim() === '' || entry !== entry.trim())) {
      throw new Error(`design producer: Bundle ${JSON.stringify(skill.name)} producer.${field} must be a non-blank string list`)
    }
    if (new Set(value).size !== value.length) throw new Error(`design producer: Bundle ${JSON.stringify(skill.name)} producer.${field} must be unique`)
    return Object.freeze([...value]) as readonly string[]
  }
  const required = list(producer.required_tools, 'required_tools')
  const optional = list(producer.optional_tools, 'optional_tools')
  const overlap = required.find(tool => optional.includes(tool))
  if (overlap !== undefined) throw new Error(`design producer: Bundle ${JSON.stringify(skill.name)} tool ${JSON.stringify(overlap)} cannot be both required and optional`)
  return Object.freeze({ required, optional })
}

/**
 * Bundle-independent Producer behavior for ordinary Skills. The Host preserves
 * the exact authored state and artifacts; it performs no Bundle normalization,
 * derivation, or semantic repair.
 */
function defaultProducerContribution(skill: DesignSkill): DesignProducerContribution {
  const prefix = `${skill.name}/`
  const tools = manifestProducerTools(skill)
  return Object.freeze({
    producerTools: tools.required,
    optionalProducerTools: tools.optional,
    ownsPath: (path: string) => path.startsWith(prefix),
    preparePublication: (snapshot: import('./runtime-drivers.ts').DesignProducerPublicationSnapshot) => Object.freeze({
      write: Object.freeze({
        state: snapshot.state,
        ...(Object.keys(snapshot.artifacts).length === 0 ? {} : { artifacts: snapshot.artifacts }),
        ownedArtifacts: snapshot.ownedArtifacts,
      }),
    }),
  })
}

function resolveConfig(config: Config): ResolvedConfig {
  const producerMaxTokens = positiveOptional(config.producerMaxTokens, 'producerMaxTokens')
  const producerMaxDepth = positiveOptional(config.producerMaxDepth, 'producerMaxDepth')
  const delegationInput = config.delegation
  if (delegationInput !== undefined
    && (typeof delegationInput !== 'object' || delegationInput === null || Array.isArray(delegationInput))) {
    throw new Error('design execution: delegation must be an object')
  }
  const delegation = delegationInput === undefined
    ? undefined
    : Object.freeze({
      provider: nonEmptyText(delegationInput.provider, 'delegation.provider'),
      maxDepth: nonNegative(delegationInput.maxDepth, 'delegation.maxDepth'),
      ...(delegationInput.maxTokens === undefined
        ? {}
        : { maxTokens: positive(delegationInput.maxTokens, 'delegation.maxTokens') }),
      ...(delegationInput.maxConcurrency === undefined
        ? {}
        : { maxConcurrency: positive(delegationInput.maxConcurrency, 'delegation.maxConcurrency') }),
    })
  return Object.freeze({
    ...(producerMaxTokens === undefined ? {} : { producerMaxTokens }),
    ...(producerMaxDepth === undefined ? {} : { producerMaxDepth }),
    ...(delegation === undefined ? {} : { delegation }),
    maxArtifactInputFiles: positive(config.maxArtifactInputFiles, 'maxArtifactInputFiles'),
    maxArtifactInputPathBytes: positive(config.maxArtifactInputPathBytes, 'maxArtifactInputPathBytes'),
    maxArtifactInputFileBytes: positive(config.maxArtifactInputFileBytes, 'maxArtifactInputFileBytes'),
    maxArtifactInputTotalBytes: positive(config.maxArtifactInputTotalBytes, 'maxArtifactInputTotalBytes'),
  })
}

function exactSkill(kit: DesignKit, name: string): DesignSkill | undefined {
  return kit.skills.find(skill => skill.name === name)
}

interface CurrentTurnHumanInput {
  readonly hasTurn: boolean
  readonly hasHuman: boolean
  readonly controlTexts: readonly string[]
}

function currentTurnHumanInput(agent: Agent): CurrentTurnHumanInput {
  const events = designSessionEvents(agent.session)
  let turnStartIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/start') {
      turnStartIndex = index
      break
    }
  }
  if (turnStartIndex === -1) {
    return Object.freeze({ hasTurn: false, hasHuman: false, controlTexts: Object.freeze([]) })
  }
  let hasHuman = false
  const controlTexts: string[] = []
  for (let index = turnStartIndex + 1; index < events.length; index += 1) {
    const event = events[index]
    if (event?.type !== 'user/message' || event.data.source.kind !== 'user') continue
    hasHuman = true
    if (event.data.content.length === 1 && event.data.content[0]?.type === 'text') {
      controlTexts.push(event.data.content[0].text)
    }
  }
  return Object.freeze({ hasTurn: true, hasHuman, controlTexts: Object.freeze(controlTexts) })
}

function currentHumanResumeCommand(
  agent: Agent,
  gate: Extract<DesignExecutionGate, { readonly kind: 'user_continue' }>,
) {
  for (const text of currentTurnHumanInput(agent).controlTexts) {
    const resolved = resolveDesignExecutionInput(gate, { kind: 'chat', text })
    if (resolved.kind === 'command') return resolved.command
  }
  return undefined
}

function expectedActionSummary(gate: Extract<DesignExecutionGate, { readonly kind: 'user_continue' }>): string {
  return `${JSON.stringify(gate.action.routeId)} (${gate.action.label.en} / ${gate.action.label.zh})`
}

function pickLocalized(locale: DesignLocale, en: string, zh: string): string {
  return locale === 'zh' ? zh : en
}

function pinnedSkillTitle(kit: DesignKit, skillName: string, locale: DesignLocale): string {
  const entry = exactSkill(kit, skillName)
  return entry === undefined ? skillName : designText(entry.title, locale)
}

function transitionResult(
  transition: DesignExecutionTransition,
  projectRoot: string,
  kit: DesignKit,
  locale: DesignLocale,
): RunDesignSkillResult {
  switch (transition.kind) {
    case 'complete': {
      const title = pinnedSkillTitle(kit, transition.pin.skillName, locale)
      return Object.freeze({
        kind: 'completed',
        summary: pickLocalized(locale, `Design skill ${title} is complete.`, `设计技能「${title}」已完成。`),
        projectRoot,
        stateRevision: transition.pin.stateRevision,
        ...(transition.indexMaintenance === undefined ? {} : { indexMaintenance: transition.indexMaintenance }),
        ...(transition.recovery === undefined ? {} : { recovery: transition.recovery }),
        clarity: Object.freeze({ status: 'failed', summary: 'clarity assessment has not run' }),
      })
    }
    case 'await_user': {
      const title = pinnedSkillTitle(kit, transition.gate.pin.skillName, locale)
      return Object.freeze({
        kind: 'await_user',
        summary: transition.gate.kind === 'must_edit'
          ? pickLocalized(locale, `The ${title} state is ready for review and editing.`, `「${title}」的状态已就绪，等待审阅与编辑。`)
          : pickLocalized(locale, `The ${title} plan is ready and waits for the user to continue.`, `「${title}」的方案已就绪，等待用户继续。`),
        gate: transition.gate,
        ...(transition.indexMaintenance === undefined ? {} : { indexMaintenance: transition.indexMaintenance }),
        ...(transition.recovery === undefined ? {} : { recovery: transition.recovery }),
      })
    }
    case 'await_execution_input':
      return Object.freeze({ kind: 'await_user', summary: transition.instruction, instruction: transition.instruction })
    case 'failed': {
      const title = pinnedSkillTitle(kit, transition.pin.skillName, locale)
      return Object.freeze({
        kind: 'failed',
        summary: pickLocalized(locale, `Design skill ${title} did not complete.`, `设计技能「${title}」未能完成。`),
        diagnostics: transition.diagnostics,
      })
    }
    case 'cancelled': {
      const title = pinnedSkillTitle(kit, transition.pin.skillName, locale)
      return Object.freeze({
        kind: 'cancelled',
        summary: pickLocalized(locale, `Design skill ${title} was cancelled.`, `设计技能「${title}」已取消。`),
        diagnostics: transition.diagnostics,
      })
    }
  }
}

type DesignJournalChangeRecord = Extract<DesignJournalRecord, { readonly type: 'design/changed' }>

function latestRelevantChange(
  records: readonly DesignJournalRecord[],
  kit: DesignKit,
  skill: DesignSkill,
): DesignJournalChangeRecord | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]
    if (record?.type !== 'design/changed') continue
    if (record.data.kit === kit.name && record.data.version === kit.version && record.data.skill === skill.name) {
      return record
    }
  }
  return undefined
}

function latestAuthoritativeChange(
  records: readonly DesignJournalRecord[],
  projectId: DesignProjectId,
  kit: DesignKit,
  skill: DesignSkill,
  stateRevision: string,
  state: Readonly<Record<string, unknown>>,
): DesignExecutionAuthorityRecord | undefined {
  const record = latestRelevantChange(records, kit, skill)
  if (record === undefined
    || record.data.origin !== 'agent'
    || record.data.commit !== stateRevision
    || !isDeepStrictEqual(record.data.state, state)) return undefined
  if (record.data.execution === undefined
    || record.data.execution.stateStatus !== 'pending'
    || record.data.execution.handoff === 'none') return undefined
  return Object.freeze({
    recordId: record.data.execution.invocationId,
    projectId,
    kitName: kit.name,
    kitVersion: kit.version,
    skillName: skill.name,
    bundleVersion: skill.version,
    stateRevision,
    origin: record.data.origin,
  })
}

function latestMatchingDesignChangeCommit(
  records: readonly DesignJournalRecord[],
  kit: DesignKit,
  skill: DesignSkill,
  state: Readonly<Record<string, unknown>>,
): string | undefined {
  const record = latestRelevantChange(records, kit, skill)
  if (record === undefined || !isDeepStrictEqual(record.data.state, state)) return undefined
  return record.data.commit === undefined || record.data.commit.trim() === '' ? undefined : record.data.commit
}

async function previousAgentMustEditGate(input: {
  readonly projectId: DesignProjectId
  readonly records: readonly DesignJournalRecord[]
  readonly kit: DesignKit
  readonly skill: DesignSkill
  readonly store: Awaited<ReturnType<DesignService['designFilesForProject']>>
  readonly signal: AbortSignal
}): Promise<Extract<DesignExecutionGate, { readonly kind: 'must_edit' }> | undefined> {
  let skippedCurrentChange = false
  for (let index = input.records.length - 1; index >= 0; index -= 1) {
    const record = input.records[index]
    if (record?.type !== 'design/changed') continue
    const change = record.data
    if (change.kit !== input.kit.name || change.version !== input.kit.version || change.skill !== input.skill.name) continue
    if (!skippedCurrentChange) {
      skippedCurrentChange = true
      continue
    }
    if (change.origin !== 'agent') continue
    if (change.execution?.stateStatus !== 'pending' || change.execution.handoff !== 'must_edit') return undefined
    if (change.commit === undefined || change.commit.trim() === '') {
      throw new Error('design execution: the prior agent Design change has no committed state revision')
    }
    const text = await input.store.readTextAt(change.commit, `${input.skill.name}/${input.skill.name}.json`, input.signal)
    if (text === undefined || text.trim() === '') {
      throw new Error('design execution: the prior agent Design change has no committed Design File')
    }
    const state = JSON.parse(text) as Readonly<Record<string, unknown>>
    if (!isDeepStrictEqual(change.state, state)) {
      throw new Error('design execution: the prior logged Design change differs from its committed Design File')
    }
    const gate = deriveDesignExecutionGate({
      skill: input.skill,
      pin: {
        projectId: input.projectId,
        kitName: input.kit.name,
        kitVersion: input.kit.version,
        skillName: input.skill.name,
        bundleVersion: input.skill.version,
        stateRevision: change.commit,
      },
      stateStatus: 'pending',
      change: {
        recordId: change.execution.invocationId,
        projectId: input.projectId,
        kitName: input.kit.name,
        kitVersion: input.kit.version,
        skillName: input.skill.name,
        bundleVersion: input.skill.version,
        stateRevision: change.commit,
        origin: 'agent',
      },
    })
    if (gate?.kind !== 'must_edit') throw new Error('design execution: the prior agent Design change has no must-edit gate')
    return gate
  }
  return undefined
}

/** Release one derived must-edit gate once without starting another Producer. */
export async function continueAfterUnconsumedPanelEdit(input: {
  readonly design: Pick<DesignService, 'isExecutionHandoffConsumed' | 'consumeExecutionHandoff'>
  readonly agent: Agent
  readonly gate: Extract<DesignExecutionGate, { readonly kind: 'must_edit' }>
  readonly selection: DesignExecutionSelection
}): Promise<DesignExecutionTransition | undefined> {
  const consumption = Object.freeze({
    invocationId: input.gate.invocationId,
    pin: input.gate.pin,
    panelStateRevision: input.selection.stateRevision,
  })
  if (await input.design.isExecutionHandoffConsumed(input.agent, consumption)) return undefined
  const transition = await continueAfterDesignPanelEdit(input.gate, input.selection)
  await input.design.consumeExecutionHandoff(input.agent, consumption)
  return transition
}

function globExpression(pattern: string): RegExp {
  let source = '^'
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index += 1
      } else source += '[^/]*'
    } else if (character === '?') source += '[^/]'
    else source += character?.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
  }
  return new RegExp(`${source}$`, 'u')
}

function decodeProjectFile(bytes: Uint8Array): ProducerProjectFile {
  try {
    return { encoding: 'utf8', content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { encoding: 'base64', content: Buffer.from(bytes).toString('base64') }
  }
}

function encodeProjectFile(file: ProducerProjectFile): Uint8Array {
  return file.encoding === 'utf8'
    ? Buffer.from(file.content, 'utf8')
    : Buffer.from(file.content, 'base64')
}

function fullReplacement(path: string, before: Uint8Array | undefined, after: Uint8Array | undefined): string {
  if (before !== undefined && after !== undefined && Buffer.from(before).equals(Buffer.from(after))) return ''
  const oldFile = before === undefined ? undefined : decodeProjectFile(before)
  const newFile = after === undefined ? undefined : decodeProjectFile(after)
  const render = (prefix: '-' | '+', file: ProducerProjectFile | undefined): string => {
    if (file === undefined) return ''
    const content = file.encoding === 'utf8' ? file.content : `[base64]\n${file.content}`
    return content.split('\n').map(line => `${prefix}${line}`).join('\n')
  }
  return [
    `--- ${before === undefined ? '/dev/null' : path}`,
    `+++ ${after === undefined ? '/dev/null' : path}`,
    render('-', oldFile),
    render('+', newFile),
  ].filter(part => part !== '').join('\n')
}

interface BoundProducerWorkspace {
  readonly port: ProducerProjectWorkspacePort
  discard(): void
}

async function bindProducerWorkspace(
  project: ProducerProjectWorkspace,
  expectedRevision: string,
  skill: DesignSkill,
): Promise<BoundProducerWorkspace> {
  const workingCopy = await project.openWorkingCopy(expectedRevision)
  const prefix = `${skill.name}/`
  const canonicalPath = `${skill.name}/${skill.name}.json`
  const committedPaths = await project.list()
  let restorePreview: Readonly<{
    token: string
    revision: string
    baseRevision: string
    changedPaths: readonly string[]
    overwrittenUnpublishedPaths: readonly string[]
    expectedWorking: ReadonlyMap<string, Uint8Array | undefined>
    desired: ReadonlyMap<string, Uint8Array>
  }> | undefined

  const bytesEqual = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean => (
    left === undefined || right === undefined
      ? left === right
      : Buffer.from(left).equals(Buffer.from(right))
  )

  const finalPaths = async (): Promise<readonly string[]> => {
    const owned = await workingCopy.list()
    return Object.freeze([...committedPaths.filter(path => !path.startsWith(prefix)), ...owned].sort())
  }
  const readBytes = (path: string): Promise<Uint8Array | undefined> => {
    requireDesignFileRelativePath(path)
    return path.startsWith(prefix) ? workingCopy.readBytes(path) : project.readBytes(path)
  }
  let publishedDiff = ''
  const renderDiff = async (): Promise<string> => {
    const before = committedPaths.filter(path => path.startsWith(prefix))
    const after = await workingCopy.list()
    const paths = [...new Set([...before, ...after])].sort()
    const changes: string[] = []
    for (const path of paths) {
      const candidate = after.includes(path) ? await workingCopy.readBytes(path) : undefined
      if (before.includes(path) && candidate !== undefined && await workingCopy.pathMatchesBase(path)) continue
      const committedText = before.includes(path) ? await project.readText(path) : undefined
      const committed = committedText === undefined ? undefined : Buffer.from(committedText, 'utf8')
      const change = fullReplacement(path, committed, candidate)
      if (change !== '') changes.push(change)
    }
    return changes.join('\n\n')
  }

  const port: ProducerProjectWorkspacePort = {
    async list(pattern, signal) {
      signal.throwIfAborted()
      const paths = await finalPaths()
      if (pattern === undefined || pattern === '') return paths
      const matcher = globExpression(pattern)
      return Object.freeze(paths.filter(path => matcher.test(path)))
    },
    async read(path, signal) {
      signal.throwIfAborted()
      const bytes = await readBytes(path)
      return bytes === undefined ? undefined : decodeProjectFile(bytes)
    },
    async write(path, file, signal) {
      signal.throwIfAborted()
      if (file.encoding === 'utf8') await workingCopy.writeText(path, file.content)
      else await workingCopy.writeBytes(path, encodeProjectFile(file))
    },
    async edit(path, oldText, newText, replaceAll, signal) {
      signal.throwIfAborted()
      if (oldText === '') throw new Error('design producer: edit old_text must be non-empty')
      const current = await workingCopy.readText(path)
      if (current === undefined) throw new Error(`design producer: edit target is absent: ${path}`)
      const occurrences = current.split(oldText).length - 1
      if (occurrences === 0) {
        throw new Error(`design producer: edit old_text was not found in ${path}; read the current Design File with read_design_file before retrying`)
      }
      if (!replaceAll && occurrences !== 1) {
        throw new Error(`design producer: edit old_text occurs ${occurrences} times in ${path}; set replace_all or provide more context`)
      }
      await workingCopy.writeText(path, replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText))
      return { replacements: replaceAll ? occurrences : 1 }
    },
    async remove(path, signal) {
      signal.throwIfAborted()
      await workingCopy.remove(path)
    },
    async move(from, to, signal) {
      signal.throwIfAborted()
      await workingCopy.move(from, to)
    },
    async diff(signal) {
      signal.throwIfAborted()
      return renderDiff()
    },
    async revisions(limit, signal) {
      signal.throwIfAborted()
      return project.history({ limit, path: canonicalPath })
    },
    async previewRestore(revision, signal) {
      signal.throwIfAborted()
      restorePreview = undefined
      return project.withCurrentRevision(workingCopy.baseRevision, async () => {
        await project.requirePublishedAncestor(revision, workingCopy.baseRevision)
        const targetPaths = (await project.listAt(revision)).filter(path => path.startsWith(prefix))
        const currentPaths = await workingCopy.list()
        const basePaths = committedPaths.filter(path => path.startsWith(prefix))
        const paths = [...new Set([...targetPaths, ...currentPaths, ...basePaths])].sort()
        const expectedWorking = new Map<string, Uint8Array | undefined>()
        const desired = new Map<string, Uint8Array>()
        const changedPaths: string[] = []
        const overwrittenUnpublishedPaths: string[] = []
        for (const path of paths) {
          const [current, target, base] = await Promise.all([
            workingCopy.readBytes(path),
            targetPaths.includes(path) ? project.readBytesAt(revision, path) : Promise.resolve(undefined),
            basePaths.includes(path) ? project.readBytesAt(workingCopy.baseRevision, path) : Promise.resolve(undefined),
          ])
          expectedWorking.set(path, current === undefined ? undefined : Uint8Array.from(current))
          if (targetPaths.includes(path) && target === undefined) {
            throw new Error(`restore snapshot is inconsistent because listed target path is absent: ${JSON.stringify(path)}`)
          }
          if (target !== undefined) desired.set(path, Uint8Array.from(target))
          if (!bytesEqual(current, target)) changedPaths.push(path)
          if (!bytesEqual(current, base) && !bytesEqual(current, target)) overwrittenUnpublishedPaths.push(path)
        }
        const preview = Object.freeze({
          token: randomUUID(),
          revision,
          baseRevision: workingCopy.baseRevision,
          changedPaths: Object.freeze(changedPaths),
          overwrittenUnpublishedPaths: Object.freeze(overwrittenUnpublishedPaths),
          expectedWorking,
          desired,
        })
        restorePreview = preview
        return Object.freeze({
          previewToken: preview.token,
          revision,
          currentRevision: preview.baseRevision,
          changedPaths: preview.changedPaths,
          overwrittenUnpublishedPaths: preview.overwrittenUnpublishedPaths,
        })
      })
    },
    async restoreSnapshot(revision, previewToken, userAuthorizedOverwrite, signal) {
      signal.throwIfAborted()
      if (!userAuthorizedOverwrite) throw new Error('restore apply requires explicit user_authorized_overwrite=true')
      const preview = restorePreview
      restorePreview = undefined
      if (preview === undefined || preview.token !== previewToken || preview.revision !== revision) {
        throw new Error('restore preview token is absent, stale, or belongs to another revision')
      }
      return project.withCurrentRevision(workingCopy.baseRevision, async () => {
        await project.requirePublishedAncestor(revision, workingCopy.baseRevision)
        if (preview.baseRevision !== workingCopy.baseRevision) {
          throw new Error('restore preview is stale because the Published base changed')
        }
        for (const path of await workingCopy.list()) {
          if (!preview.expectedWorking.has(path)) {
            throw new Error(`restore preview is stale because the WorkingCopy added ${JSON.stringify(path)}`)
          }
        }
        for (const [path, expected] of preview.expectedWorking) {
          if (!bytesEqual(await workingCopy.readBytes(path), expected)) {
            throw new Error(`restore preview is stale because the WorkingCopy changed at ${JSON.stringify(path)}`)
          }
        }
        await workingCopy.replaceSnapshot(preview.desired)
        return Object.freeze({ revision, changedPaths: preview.changedPaths })
      })
    },
    async validate(mode, signal) {
      signal.throwIfAborted()
      const issues = await workingCopy.validate(mode)
      return Object.freeze(issues.map(issue => `${issue.code}: ${issue.message}${issue.repair_hint === undefined ? '' : ` Repair: ${issue.repair_hint}`}`))
    },
    async publish(mode, signal) {
      signal.throwIfAborted()
      const diff = await renderDiff()
      try {
        const receipt = await workingCopy.publish(mode, mode === 'complete' ? 'complete' : 'handoff')
        publishedDiff = diff
        return Object.freeze({ kind: 'published' as const, stateRevision: receipt.stateRevision, diff,
          ...(receipt.indexMaintenance === undefined ? {} : { indexMaintenance: receipt.indexMaintenance }),
          ...(receipt.recovery === undefined ? {} : { recovery: receipt.recovery }),
        })
      } catch (error) {
        if (error instanceof ProducerWorkingCopyConflictError) {
          return Object.freeze({
            kind: 'conflict' as const,
            expectedHead: error.expectedHead,
            currentHead: error.currentHead,
            paths: Object.freeze(await workingCopy.list()),
            diagnostics: Object.freeze([error.message]),
          })
        }
        if (!(error instanceof ProducerWorkingCopyValidationError)) throw error
        return Object.freeze({
          kind: 'invalid' as const,
          diagnostics: Object.freeze(error.diagnostics.map(issue => (
            `${issue.code}: ${issue.message}${issue.repair_hint === undefined ? '' : ` Repair: ${issue.repair_hint}`}`
          ))),
        })
      }
    },
    async recoverPublication(mode, signal) {
      // The working copy is already closed. Recovery consumes only the
      // original accepted publication, without reading or editing its files.
      const receipt = await workingCopy.recoverPublication(mode, mode === 'complete' ? 'complete' : 'handoff')
      return Object.freeze({ stateRevision: receipt.stateRevision, diff: publishedDiff,
        ...(receipt.indexMaintenance === undefined ? {} : { indexMaintenance: receipt.indexMaintenance }),
        ...(receipt.recovery === undefined ? {} : { recovery: receipt.recovery }),
      })
    },
  }
  return Object.freeze({
    port,
    discard: () => workingCopy.discard(),
  })
}

interface ProducerEvidenceTools {
  readonly allowed: readonly string[]
  readonly unavailableOptional: readonly string[]
}

const NATIVE_WORKSPACE_READ_TOOLS = Object.freeze(['read', 'read_image', 'glob', 'grep'] as const)

export function producerEvidenceTools(
  agent: Agent,
  producer: DesignProducerContribution,
): ProducerEvidenceTools {
  const required = producer.producerTools
  const optional = producer.optionalProducerTools ?? []
  const available = (name: string): boolean => agent.ctx.tools.get(name, agent) !== undefined
  const missingRequired = required.filter(name => !available(name))
  if (missingRequired.length > 0) {
    throw new Error(`design producer: required evidence tools are unavailable: ${missingRequired.join(', ')}`)
  }
  const availableOptional = optional.filter(available)
  const nativeWorkspaceRead = NATIVE_WORKSPACE_READ_TOOLS.filter(available)
  return Object.freeze({
    allowed: Object.freeze([...new Set([...required, ...availableOptional, ...nativeWorkspaceRead,
      ...availableDesignKnowledgeTools(available), ...['design_git_read'].filter(available)])]),
    unavailableOptional: Object.freeze(optional.filter(name => !available(name))),
  })
}

export function producerSystemPrompt(skill: DesignSkill, tools: ProducerEvidenceTools, applicationWorkspaceRoot?: string, reconstruct = false, resources: Readonly<Record<string, string>> = {}, designFilesRoot?: string): string {
  return [
    skill.execution.mode === 'main'
      ? 'Execute one Design Bundle in this existing main conversation. Do not create a Producer child.'
      : 'You are the isolated Design Skill Producer for one selected Design Project.',
    reconstruct
      ? 'Extract and restore source facts using the Bundle output contract below. This is not the forward-design workflow.'
      : 'Execute the complete Skill Body agentically.',
    'You may read the entire Design Project and the Host-authorized application workspace, but write, edit, move, or delete only files owned by the current Bundle; the tools enforce this authority.',
    skill.execution.mode === 'main'
      ? `Your native session cwd is unchanged. Design Files are at ${JSON.stringify(designFilesRoot)}. Always use read_design_file with Design-Files-relative paths for canonical Design JSON and Design artifacts. Use inherited native read/read_image/glob/grep only for Host-authorized application/source evidence; in main mode, use absolute source paths rooted at ${JSON.stringify(applicationWorkspaceRoot)}.`
      : `Your session cwd is the Design Files root. Always use read_design_file with Design-Files-relative paths for canonical Design JSON and Design artifacts so the method remains placement-independent. The application workspace root is ${applicationWorkspaceRoot === undefined ? 'not disclosed by this Host' : JSON.stringify(applicationWorkspaceRoot)}. Use the available inherited native read/read_image/glob/grep tools directly only to explore source code, documentation, and visual evidence; use absolute paths when leaving the Design Files cwd. Do not ask the main Agent to copy source contents into your prompt.`,
    `The canonical state file is ${skill.name}/${skill.name}.json. Read existing state and artifacts before deciding whether this is initial generation, continuation, or a targeted revision. Preserve correct material outside the requested change.`,
    'Canonical state is strict JSON: use double-quoted keys and strings, escape ASCII double quotes and control characters inside strings, and omit comments and trailing commas. Unicode text and punctuation are valid JSON. When parsing reports a line and column, inspect and repair the actual token in this same working copy; do not guess that valid Unicode punctuation is the cause.',
    'Use the file tools that are actually available as ordinary file operations. read_design_file and scoped Design list/write/edit plus Bundle scripts use paths relative to the bound Design Files root, independent of native cwd. Inherited native read/read_image/glob/grep follow Host path semantics and are reserved for Host-authorized application/source evidence. Do not invent other renamed source-reading tools or deprecated Design-specific file tools. Mutations remain ordinary uncommitted Design Project changes until design_publish validates and commits them. A failed validation preserves the same files for repair; continue editing them and retry design_publish.',
    'Treat implementation and documentation as evidence, not unquestionable product intent. Distinguish directly observed facts, reasonable inferences, and unresolved product decisions. Do not mechanically turn source folders, components, routes, or database tables into product structure.',
    reconstruct
      ? 'Report unresolved decisions without inventing answers.'
      : 'Route unresolved durable user decisions through the active Smart Questions Bundle rather than inventing answers.',
    DESIGN_SKILL_RESOURCE_GUIDANCE,
    'Historical correction is Bundle-scoped and forward-only. Use design_revisions to select an exact Published ancestor, then design_restore_snapshot preview. Apply only when the user explicitly authorized the previewed overwrite. The restore stages a WorkingCopy snapshot; inspect diff, validate, and publish it as a new commit. Never ask for or attempt Git checkout, switch, reset, fetch, pull, push, repository deletion, or raw Git passthrough.',
    'Artifact work uses the current filesystem worktree; it never requires an intermediate Git checkpoint. Write the canonical definitions before their artifacts, accepting file references only after the corresponding files exist and pass validation. The Host records real Producer/Worker attempt state and rolling logs; do not copy queued, working, execution ids, or attempt errors into Design JSON.',
    KNOWLEDGE_AGENTIC_GUIDANCE,
    DESIGN_EXECUTOR_EVIDENCE_GUIDANCE,
    skill.execution.mode === 'main'
      ? 'You are executing this Bundle in the main conversation, not a child Producer. Use design_publish explicitly to settle this Bundle: it returns shared validation, the saved revision and handoff; optional main-Agent clarity reporting is separate. Do not end your response without publication unless cancelled or blocked; a main turn ending is not evidence of Bundle completion. Publish only at the terminal boundary, not intermediate milestones.'
      : 'Use design_publish when you need to explicitly select handoff versus complete or end the turn immediately. If you finish without calling it, the Host applies the manifest-safe default through the same validation and publication path. Publish only at the terminal boundary; do not create intermediate milestone commits. Validation diagnostics are repair instructions for the same filesystem worktree. The action is an invocation command, not canonical Design state.',
    'Optional nested workers are acceleration only. You remain responsible for the complete working copy, canonical JSON, final integration validation, and publication, and must be able to finish without delegation. design_delegate is generic for one artifact: pass artifact_kind, artifact_id, artifact_file, and a complete prompt. When two or more tasks form one independent dependency frontier and design_delegate_frontier is available, prefer one call containing the complete ordered frontier; the Host atomically validates and claims it, applies bounded concurrency, and returns every item after the frontier settles. Use a new batch_id if the ordered items change. The Host does not infer Bundle tasks or run Bundle domain validators. Each successful result carries a Host-computed receipt for bytes the Worker already wrote to its exact pre-bound artifact path. Use that receipt to update only the matching canonical reference; do not read or resend the complete artifact merely to acknowledge completion. Read it only when the Skill requires its content for a real downstream synthesis, or use a Bundle script by path when compact diagnostics or metadata are sufficient. Integrate successful frontier receipts together. For failed, cancelled, or not-started items, take over each artifact with your normal scoped file tools and call design_focus_artifact with the same explicit kind, id, and file before serial work. The Host does not automatically retry delegated work.',
    `Available host evidence tools: ${tools.allowed.length === 0 ? '(none)' : tools.allowed.join(', ')}.`,
    ...tools.unavailableOptional.length === 0
      ? []
      : [`Optional host evidence tools unavailable in this deployment: ${tools.unavailableOptional.join(', ')}.`],
    ...(reconstruct
      ? [reconstructionContractPrompt(skill, resources)]
      : ['<design_skill_body>', skill.content, '</design_skill_body>']),
  ].join('\n\n')
}

export function producerPrompt(
  mode: 'engage' | 'resume',
  skill: DesignSkill,
  input: {
    readonly brief?: string
    readonly currentDesignState?: string
    readonly userContext?: string
    readonly reconstruct?: true
    readonly reconstructionSourceRoot?: string
  } | undefined,
): string {
  if (mode === 'resume') {
    return [
      input?.reconstruct === true
        ? `Resume fact extraction for ${skill.name}. Inspect the current Design Files and finish the assigned source restoration using the output contract, not the forward-design workflow. Validate, repair, and settle through design_publish.`
        : `Resume ${skill.name} after the user accepted its current manifest handoff. Inspect the current Design Files, complete the remaining Skill Body work, validate, repair as needed, and settle through design_publish.`,
      'For delegated artifacts, integrate each successful receipt path into canonical Design JSON only after the artifact exists and its author completed the Bundle validation loop; completion publication rejects any current-invocation receipt that remains unreferenced.',
      ...input?.reconstruct === true ? [
        '<user_brief>',
        input.brief ?? '',
        '</user_brief>',
        '<reconstruction_strategy>',
        `Continue reconstructing from the exact read-only evidence file or directory ${JSON.stringify(input.reconstructionSourceRoot)}. Follow the reconstruction method's source and asset boundaries. Preserve the observed, inferred, and unknown distinctions from the initial run.`,
        '</reconstruction_strategy>',
      ] : [],
    ].join('\n')
  }
  return [
    `Engage Design skill ${skill.name}.`,
    '<user_brief>',
    input?.brief ?? '',
    '</user_brief>',
    '<current_bundle_state>',
    input?.currentDesignState ?? '{}',
    '</current_bundle_state>',
    '<project_design_context>',
    input?.userContext ?? '',
    '</project_design_context>',
    ...input?.reconstruct === true ? [
      '<reconstruction_strategy>',
      `Reconstruct this Bundle from the exact read-only evidence file or directory ${JSON.stringify(input?.reconstructionSourceRoot)}. Follow the reconstruction method's source and asset boundaries. Explore relevant evidence yourself to recover product and business meaning, not a code wiki. Use the normal Bundle schema, validator, ownership and publication loop without a parallel reconstruction artifact.`,
      '</reconstruction_strategy>',
    ] : [],
    input?.reconstruct === true
      ? 'Inspect the source evidence and current Design Files. Extract facts into the existing schema and reproduce or convert the supported artifacts without redesign. Validate, repair, and settle through design_publish.'
      : 'Inspect the actual project files before editing. Produce the requested initial design or precise revision, then validate, repair, and settle through design_publish.',
    'For delegated artifacts, integrate each successful receipt path into canonical Design JSON only after the artifact exists and its author completed the Bundle validation loop. Successful sibling receipts may be integrated together; completion publication rejects any current-invocation receipt that remains unreferenced.',
  ].join('\n')
}

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function appendProducerEvidence(
  target: DesignProducerEvidenceRecord[],
  records: readonly DesignProducerEvidenceRecord[],
): void {
  for (const record of records) {
    if (record.kind.trim() === '') throw new Error('design producer: evidence kind must be non-empty text')
    const data = snapshotJsonValue(record.data)
    if (data === undefined) {
      throw new Error(`design producer: evidence ${JSON.stringify(record.kind)} is not lossless JSON`)
    }
    target.push(Object.freeze({ kind: record.kind, data: data as JsonValue }))
  }
}

function collectExactStringValues(value: unknown, target: Set<string>): void {
  if (typeof value === 'string') {
    target.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExactStringValues(item, target)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const item of Object.values(value as Record<string, unknown>)) collectExactStringValues(item, target)
}

/** Require every successful delegated artifact from this invocation to be integrated before completion. */
export function delegatedArtifactIntegrationDiagnostics(
  snapshot: DesignProducerPublicationSnapshot,
  receipts: readonly NonNullable<DesignExecutionAttemptPayload['receipt']>[],
): readonly string[] {
  if (snapshot.mode !== 'complete') return []
  const paths = [...new Set(receipts.map(receipt => receipt.path))]
  if (paths.length === 0) return []
  const references = new Set<string>()
  collectExactStringValues(snapshot.state, references)
  return paths.flatMap(path => {
    if (!Object.prototype.hasOwnProperty.call(snapshot.artifacts, path)) {
      return [`Successful delegated artifact ${JSON.stringify(path)} is missing from the current Producer working copy.`]
    }
    if (!references.has(path)) {
      return [`Successful delegated artifact ${JSON.stringify(path)} is not referenced by an exact string value in canonical Design JSON.`]
    }
    return []
  })
}

function createProducerPort(input: {
  readonly deploymentCtx: Context
  readonly resolveSubagentStart: () => DesignSubagentStart | undefined
  readonly resolveFileWorkerStart: () => DesignFileWorkerStart | undefined
  readonly agent: Agent
  readonly designFilesRoot: string
  readonly projectId: DesignProjectId
  readonly rootCallId: string
  readonly store: Awaited<ReturnType<DesignService['designFilesForProject']>>
  readonly design: DesignService
  readonly kit: DesignKit
  readonly runtime: DshProducerSkillAgentRuntime
  readonly config: ResolvedConfig
  readonly subprocess: SubprocessLike
}): DesignExecutionProducerPort {
  return {
    async run(request): Promise<DesignExecutionProducerSettlement> {
      const main = request.skill.execution.mode === 'main'
      let producerRunId: string | undefined
      let producerTerminal = false
      const producerAttemptId = randomUUID()
      const successfulDelegatedArtifacts = new Map<string, NonNullable<DesignExecutionAttemptPayload['receipt']>>()
      const recordAttempt = (
        event: Omit<DesignExecutionAttemptPayload, 'projectId' | 'invocationId' | 'skill'>,
      ): void => {
        if (main && event.role === 'producer') return
        if (event.role === 'producer' && event.runId !== undefined) producerRunId = event.runId
        if (event.role === 'producer' && event.attemptId === producerAttemptId
          && (event.phase === 'completed' || event.phase === 'failed' || event.phase === 'cancelled')) {
          producerTerminal = true
        }
        if (event.role === 'worker' && event.phase === 'completed' && event.receipt !== undefined) {
          successfulDelegatedArtifacts.set(event.receipt.path, event.receipt)
        }
        input.design.recordExecutionAttempt(input.agent, {
          projectId: String(input.projectId),
          invocationId: String(request.pin.invocationId),
          rootCallId: input.rootCallId,
          skill: request.skill.name,
          ...event,
        })
      }
      recordAttempt({
        artifactId: request.skill.name,
        attemptId: producerAttemptId,
        parentRunId: String(input.agent.session.id),
        role: 'producer',
        phase: 'queued',
      })
      // One Design invocation owns the selected project's mutation lane until
      // it reaches a terminal settlement. Nested Producer writes are
      // re-entrant through DesignService's AsyncLocal project scope, while
      // unrelated invocations and panel saves wait their turn. This makes the
      // Producer the sole canonical-state writer without hiding live worktree
      // artifact writes from the polling panel.
      try {
        // Inline tools run on later main-Agent steps. Do not hold a mutation lock
        // across those steps; workspace writes/publication already take that lock.
        const withEngagement = main
          ? <T>(operation: () => Promise<T>) => operation()
          : <T>(operation: () => Promise<T>) => input.design.withProjectMutationFor(input.agent, input.projectId, operation)
        return await withEngagement(async () => {
        let workspace: BoundProducerWorkspace | undefined
        try {
        const driver = input.design.runtimeDriverFor(request.skill)
        const baseProducer = driver?.producer ?? defaultProducerContribution(request.skill)
        const authoredTools = manifestProducerTools(request.skill)
        const requiredTools = Object.freeze([...new Set([...baseProducer.producerTools, ...authoredTools.required])])
        const optionalTools = Object.freeze([...new Set([
          ...(baseProducer.optionalProducerTools ?? []),
          ...authoredTools.optional,
        ].filter(tool => !requiredTools.includes(tool)))])
        const producerContribution: DesignProducerContribution = Object.freeze({
          ...baseProducer,
          producerTools: requiredTools,
          optionalProducerTools: optionalTools,
        })
        const evidenceTools = producerEvidenceTools(input.agent, producerContribution)
        const invocationEvidence: DesignProducerEvidenceRecord[] = []
        const publicationContext = async (baseRevision: string) => {
          const priorText = await input.store.readTextAt(
            baseRevision,
            `${request.skill.name}/${request.skill.name}.json`,
            request.signal,
          )
          const priorValue = priorText === undefined ? undefined : JSON.parse(priorText) as unknown
          const previousState = typeof priorValue === 'object' && priorValue !== null && !Array.isArray(priorValue)
            ? priorValue as Readonly<Record<string, unknown>>
            : undefined
          const paths = await input.store.listPathsAt(baseRevision, request.signal)
          const sourceNames = landedDesignArtifactSourceNames(
            input.kit.skills.map(skill => skill.name).filter(name => name !== request.skill.name),
            paths,
          )
          const sourceSkills = sourceNames.map(name => exactSkill(input.kit, name) as DesignSkill)
          const sourcePaths = paths.filter(path => sourceNames.some(name => path.startsWith(`${name}/`)))
          return Object.freeze({
            skill: request.skill,
            kit: input.kit,
            origin: 'agent' as const,
            signal: request.signal,
            previousState: previousState ?? Object.freeze({}),
            evidence: Object.freeze([...invocationEvidence]),
            sources: Object.freeze({
              stateRevision: baseRevision,
              skills: Object.freeze(sourceSkills),
              paths: Object.freeze(sourcePaths),
              readText: (path: string) => input.store.readTextAt(baseRevision, path, request.signal),
              limits: Object.freeze({
                maxFileCount: input.config.maxArtifactInputFiles,
                maxPathBytes: input.config.maxArtifactInputPathBytes,
                maxFileBytes: input.config.maxArtifactInputFileBytes,
                maxTotalBytes: input.config.maxArtifactInputTotalBytes,
              }),
            }),
          })
        }
        const project = await createProducerProjectWorkspace({
          store: input.store,
          signal: request.signal,
          invocationSkill: request.skill,
          resolveSkill: name => exactSkill(input.kit, name),
          resolveValidationDriver: (skill, id) => input.design.validationDriverFor(skill, id),
          ownsPath: path => producerContribution.ownsPath(path, request.skill),
          publicationInvocationId: String(request.pin.invocationId),
          validatePublication: async snapshot => Object.freeze([
            ...delegatedArtifactIntegrationDiagnostics(snapshot, [...successfulDelegatedArtifacts.values()]),
            ...(producerContribution.validatePublication === undefined
              ? []
              : await producerContribution.validatePublication(snapshot, await publicationContext(snapshot.baseRevision))),
          ]),
          preparePublication: async (snapshot) => {
            return producerContribution.preparePublication(snapshot, await publicationContext(snapshot.baseRevision))
          },
          settleEvent: async (skillName: string, event: DesignWriteEvent, publication) => {
            const settledSkill = exactSkill(input.kit, skillName)
            if (settledSkill === undefined) throw new Error(`design execution: settled unknown Bundle ${JSON.stringify(skillName)}`)
            await input.design.recordDesignChange(input.agent, input.projectId, {
              kit: input.kit.name,
              version: input.kit.version,
              skill: settledSkill.name,
              state: event.state,
              origin: 'agent',
              execution: {
                invocationId: String(request.pin.invocationId),
                stateStatus: publication.mode === 'complete' ? 'complete' : 'pending',
                handoff: publication.purpose === 'handoff' ? settledSkill.execution.handoff : 'none',
              },
              ...(event.commit === undefined ? {} : { commit: event.commit }),
              ...(typeof settledSkill.metadata?.panelYaml === 'string' ? { panelYaml: settledSkill.metadata.panelYaml } : {}),
              ...manifestFor(settledSkill),
            })
          },
          withMutation: operation => input.design.withProjectMutationFor(input.agent, input.projectId, operation),
        })
        workspace = await bindProducerWorkspace(
          project,
          request.pin.stateRevision,
          request.skill,
        )
        const workingCopy = workspace
        const delegationConfig = input.config.delegation
        const startSubagent = input.resolveSubagentStart()
        const startFileWorker = delegationConfig?.provider === 'dsh-design-file-worker'
          ? input.resolveFileWorkerStart() : undefined
        if (delegationConfig?.provider === 'dsh-design-file-worker' && startFileWorker === undefined) {
          throw new Error('design execution: plugin file Worker provider is unavailable')
        }
        const artifactAttempts = createDesignArtifactAttemptRegistry()
        const delegation = delegationConfig === undefined
          || startSubagent === undefined
          ? undefined
          : createDshDesignDelegation({
            skillName: request.skill.name,
            reconstruct: request.input?.reconstruct === true,
            provider: delegationConfig.provider,
            startSubagent,
            ...(startFileWorker === undefined ? {} : {
              startFileWorker,
              workerEvidenceTools: [...new Set([...evidenceTools.allowed, 'read_skill_resource', 'list', 'read'])],
              scripts: createSkillScriptPort(input.kit, request.skill, input.subprocess),
            }),
            maxDepth: delegationConfig.maxDepth,
            ...(delegationConfig.maxTokens === undefined ? {} : { maxTokens: delegationConfig.maxTokens }),
            ...(delegationConfig.maxConcurrency === undefined ? {} : { maxConcurrency: delegationConfig.maxConcurrency }),
            attempts: artifactAttempts,
            workspace: workingCopy.port,
            recordAttempt,
          })
        let focusedArtifact: {
          readonly id: string
          readonly kind: string
          readonly path: string
          readonly attempt: string
          readonly claims: readonly string[]
        } | undefined
        const producerArtifactAttempts = new Map<string, {
          readonly attemptId: string
          readonly artifactKind: string
          readonly artifactId: string
          readonly artifactFile: string
          readonly claims: readonly string[]
        }>()
        const activity = {
          async focus(artifactKind: string, artifactId: string, artifactFile: string): Promise<string> {
            const kind = artifactKind.trim()
            const id = artifactId.trim()
            const path = artifactFile.trim()
            if (kind === '') throw new Error('design producer: artifact_kind must be non-empty text')
            if (id === '') throw new Error('design producer: artifact_id must be non-empty text')
            requireDesignFileRelativePath(path)
            if (!path.startsWith(`${request.skill.name}/`) || path === `${request.skill.name}/${request.skill.name}.json`) {
              throw new Error(`design producer: artifact_file ${JSON.stringify(path)} is outside Bundle artifact scope`)
            }
            if (focusedArtifact !== undefined
              && (focusedArtifact.id !== id || focusedArtifact.kind !== kind || focusedArtifact.path !== path)) {
              artifactAttempts.retireAll(focusedArtifact.claims, focusedArtifact.attempt)
              focusedArtifact = undefined
            }
            const ownCurrent = focusedArtifact?.id === id
              && focusedArtifact.kind === kind
              && focusedArtifact.path === path
              ? focusedArtifact
              : undefined
            const attempt = ownCurrent?.attempt ?? randomUUID()
            const claims = ownCurrent?.claims ?? Object.freeze([
              id,
              `path:${path}`,
            ])
            if (ownCurrent === undefined) {
              artifactAttempts.claimAll(claims, attempt)
              producerArtifactAttempts.set(attempt, {
                attemptId: attempt,
                artifactKind: kind,
                artifactId: id,
                artifactFile: path,
                claims,
              })
              recordAttempt({
                artifactId: id,
                artifactKind,
                artifactFile: path,
                attemptId: attempt,
                ...(producerRunId === undefined ? {} : { runId: producerRunId }),
                parentRunId: String(input.agent.session.id),
                role: 'producer',
                phase: 'working',
              })
            }
            focusedArtifact = { id, kind, path, attempt, claims }
            return id
          },
          async observeTool(observation: DesignProducerToolObservation): Promise<void> {
            const captured = producerContribution.captureEvidence?.(observation) ?? []
            if (captured.length > 0) appendProducerEvidence(invocationEvidence, captured)
            // Tool observations remain available in the native Producer session log.
          },
        }
        const scripts = createSkillScriptPort(input.kit, request.skill, input.subprocess)
        let producerSucceeded = false
        try {
          const receipt = await input.runtime.run({
          mode: request.mode,
          parent: input.agent,
          label: pickLocalized(
            resolveConversationLocale(latestDirectHumanText(designSessionEvents(input.agent.session))),
            `Design Producer · ${request.skill.title.en}`,
            `设计执行 · ${request.skill.title.zh}`,
          ),
          designFilesRoot: input.designFilesRoot,
          workspace: workingCopy.port,
          ...(request.input?.reconstruct === true ? { reconstructionSourceRoot: request.input.reconstructionSourceRoot } : {}),
          systemPrompt: producerSystemPrompt(
            request.skill,
            evidenceTools,
            request.input?.reconstructionSourceRoot ?? input.agent.session.header.cwd,
            request.input?.reconstruct === true,
            input.kit.resources,
            input.designFilesRoot,
          ),
          prompt: producerPrompt(request.mode, request.skill, request.input),
          handoff: request.skill.execution.handoff,
          signal: request.signal,
          allowedInheritedTools: evidenceTools.allowed,
          activity,
          resources: {
            async read(path, signal) {
              signal.throwIfAborted()
              return input.kit.resources[`${request.skill.name}/${path}`]
            },
          },
          ...(scripts === undefined ? {} : { scripts }),
          ...(input.config.producerMaxTokens === undefined ? {} : { maxTokens: input.config.producerMaxTokens }),
          ...(input.config.producerMaxDepth === undefined ? {} : { maxDepth: input.config.producerMaxDepth }),
          ...(delegation === undefined ? {} : { delegation }),
          execution: {
            artifactId: request.skill.name,
            attemptId: producerAttemptId,
            record: recordAttempt,
          },
          })
          producerSucceeded = true
          return Object.freeze({
            kind: 'committed',
            stateRevision: receipt.stateRevision,
            stateStatus: receipt.kind === 'complete' ? 'complete' : 'pending',
            ...(receipt.indexMaintenance === undefined ? {} : { indexMaintenance: receipt.indexMaintenance }),
            ...(receipt.recovery === undefined ? {} : { recovery: receipt.recovery }),
          })
        } finally {
          for (const producerAttempt of producerArtifactAttempts.values()) {
            recordAttempt({
              artifactId: producerAttempt.artifactId,
              artifactKind: producerAttempt.artifactKind,
              artifactFile: producerAttempt.artifactFile,
              attemptId: producerAttempt.attemptId,
              ...(producerRunId === undefined ? {} : { runId: producerRunId }),
              parentRunId: String(input.agent.session.id),
              role: 'producer',
              phase: producerSucceeded ? 'completed' : request.signal.aborted ? 'cancelled' : 'failed',
            })
            artifactAttempts.retireAll(producerAttempt.claims, producerAttempt.attemptId)
          }
        }
        } catch (error) {
          const failure = diagnostic(error)
          if (!producerTerminal) {
            recordAttempt({
              artifactId: request.skill.name,
              attemptId: producerAttemptId,
              ...(producerRunId === undefined ? {} : { runId: producerRunId }),
              parentRunId: String(input.agent.session.id),
              role: 'producer',
              phase: request.signal.aborted ? 'cancelled' : 'failed',
              diagnostics: [failure],
            })
          }
          const auditOutcome = request.signal.aborted ? 'cancelled' as const : 'failed' as const
          const outcome = auditOutcome
          let auditDiagnostic: string | undefined
          const stateRevision = await input.store.auditInvocation(request.skill.name, {
            eventId: String(request.pin.invocationId),
            outcome: auditOutcome,
          }).then(result => result.commit, (auditError: unknown) => {
            auditDiagnostic = `Git audit failed: ${diagnostic(auditError)}`
            return input.store.head().then(head => head ?? request.pin.stateRevision, () => request.pin.stateRevision)
          })
          const diagnostics = Object.freeze([
            failure,
            ...(auditDiagnostic === undefined ? [] : [auditDiagnostic]),
          ])
          return Object.freeze({ kind: outcome, stateRevision, diagnostics })
        } finally {
          workspace?.discard()
        }
        })
      } catch (error) {
        if (!producerTerminal) {
          recordAttempt({
            artifactId: request.skill.name,
            attemptId: producerAttemptId,
            ...(producerRunId === undefined ? {} : { runId: producerRunId }),
            parentRunId: String(input.agent.session.id),
            role: 'producer',
            phase: request.signal.aborted ? 'cancelled' : 'failed',
            diagnostics: [diagnostic(error)],
          })
        }
        throw error
      }
    },
  }
}

function createController(
  deploymentCtx: Context,
  host: DshExecutionHost,
  config: ResolvedConfig,
  resolveSubagentStart: () => DesignSubagentStart | undefined,
  resolveFileWorkerStart: () => DesignFileWorkerStart | undefined,
): RunDesignSkillPort {
  const bridge = createMainBundleBridge(createDshProducerSkillAgentRuntime())
  const runtime = bridge.runtime
  const controller: RunDesignSkillPort = {
    async claimAdvisoryActionExecution(request) {
      request.signal.throwIfAborted()
      const kit = host.design.requireKitForAgent(request.agent)
      const skill = exactSkill(kit, request.name)
      if (skill === undefined) {
        return Object.freeze({
          kind: 'invalid' as const,
          summary: `Unknown Design skill ${JSON.stringify(request.name)}. Active skills: ${kit.skills.map(entry => entry.name).join(', ')}.`,
        })
      }
      const result = await host.design.claimAdvisoryActionExecution(request.agent, {
        receiptId: request.receiptId,
        proposedInvocationId: request.proposedInvocationId,
        skillName: skill.name,
        bundleVersion: skill.version,
      })
      return Object.freeze({
        kind: 'action' as const,
        claimed: result.claimed,
        attemptId: result.attemptId,
        effectiveInvocationId: result.effectiveInvocationId,
        state: result.action.state,
      })
    },
    settleAdvisoryActionExecution(request) {
      return host.design.settleAdvisoryActionExecution(request.agent, {
        receiptId: request.receiptId,
        attemptId: request.attemptId,
        state: request.state,
      })
    },
    async run(request): Promise<RunDesignSkillResult> {
      const project = await host.design.projectForAgent(request.agent, request.signal)
      const mainWork = activeMainBundleWork(request.agent)
      if (mainWork?.projectId !== undefined && mainWork.projectId !== project.projectId) {
        return { kind: 'invalid', summary: 'The selected Design Project changed before main Bundle execution; start again in the intended project.' }
      }
      const kit = host.design.requireKitForAgent(request.agent)
      if (project.kit?.name !== kit.name) {
        throw new Error('design execution: active Kit pin does not match the selected Design Project')
      }
      const skill = exactSkill(kit, request.name)
      if (skill === undefined) {
        return Object.freeze({
          kind: 'invalid',
          summary: `Unknown Design skill ${JSON.stringify(request.name)}. Active skills: ${kit.skills.map(entry => entry.name).join(', ')}.`,
        })
      }
      if (request.reconstruct === true
        && (request.reconstructionSourceRoot === undefined || request.reconstructionSourceRoot.trim() === '')) {
        throw new Error('design reconstruction: missing exact source root')
      }
      const reconstructionSource = request.reconstruct === true
        ? await host.design.inspectReconstructionSource(request.reconstructionSourceRoot as string, request.signal)
        : undefined
      request.signal.throwIfAborted()
      const locale = resolveConversationLocale(latestDirectHumanText(designSessionEvents(request.agent.session)))
      const finish = async (result: RunDesignSkillResult, pin?: DesignExecutionPin): Promise<RunDesignSkillResult> => {
        if (pin !== undefined) {
          const execution = await projectDesignExecutionProvenance({
            pin,
            rootCallId: request.rootCallId,
            parentSessionId: String(request.agent.session.id),
            mode: skill.execution.mode === 'main' ? 'main' : 'subagent',
            observations: host.design.executionAttemptsFor(request.agent, String(project.projectId)),
            publicationAccepted: result.kind === 'completed' || (result.kind === 'await_user' && result.gate !== undefined),
            files: store,
            limits: {
              maxFileCount: config.maxArtifactInputFiles,
              maxFileBytes: config.maxArtifactInputFileBytes,
              maxTotalBytes: config.maxArtifactInputTotalBytes,
            },
            signal: request.signal,
          })
          result = Object.freeze({ ...result, execution })
        }
        if (result.kind !== 'completed') return result
        return Object.freeze({ ...result, clarity: Object.freeze({ status: 'pending' as const,
          summary: 'Design saved. The main Agent can assess this result through report_design_clarity; no second assessment Agent is required for completion.' }) })
      }
      const store = await host.design.designFilesForProject(request.agent, project.projectId, nodeFs, request.signal)
      const stateRevision = (await store.head(request.signal)) ?? DESIGN_FILES_UNBORN_REVISION
      const storedState = await store.readPublished(skill.name, request.signal)
      const currentState = storedState === undefined ? undefined : storedState as Readonly<Record<string, unknown>>
      const journalRecords = (await host.design.readDesignJournal(request.agent)).records
      const producer = createProducerPort({
        deploymentCtx,
        resolveSubagentStart,
        resolveFileWorkerStart,
        agent: request.agent,
        designFilesRoot: project.designFilesRoot,
        projectId: project.projectId,
        rootCallId: request.rootCallId,
        store,
        design: host.design,
        kit,
        runtime,
        config,
        subprocess: host.subprocess,
      })

      const humanInput = currentTurnHumanInput(request.agent)
      const revising = request.brief !== undefined && request.brief.trim() !== '' && humanInput.hasHuman
      // A current human revision starts new work, including over legacy saved
      // answers. Only acknowledgement of the old save requires its exact gate
      // disposition; revision must not invent or reconcile that old receipt.
      if (!revising && request.reconstruct !== true && request.action === undefined && skill.execution.handoff === 'must_edit' && currentState !== undefined) {
        const currentChange = latestRelevantChange(journalRecords, kit, skill)
        if (currentChange?.data.origin === 'panel' && isDeepStrictEqual(currentChange.data.state, currentState)) {
          const panelStateRevision = latestMatchingDesignChangeCommit(journalRecords, kit, skill, currentState)
          if (panelStateRevision === undefined) throw new Error('design execution: panel-origin state has no authoritative committed Design change')
          const gate = await previousAgentMustEditGate({
            projectId: project.projectId,
            records: journalRecords,
            kit,
            skill,
            store,
            signal: request.signal,
          })
          if (gate !== undefined) {
            const consumed = await host.design.isExecutionHandoffConsumed(request.agent, {
              invocationId: gate.invocationId,
              pin: gate.pin,
              panelStateRevision,
            })
            if (!consumed) throw new Error('design execution: panel save did not consume its exact must-edit gate')
          }
          if (!humanInput.hasHuman) {
            const title = designText(skill.title, locale)
            return finish(Object.freeze({
              kind: 'completed',
              summary: pickLocalized(locale, `Design skill ${title} accepted the saved panel state.`, `设计技能「${title}」已采纳面板保存的状态。`),
              projectRoot: project.root,
              stateRevision,
              clarity: Object.freeze({ status: 'failed', summary: 'clarity assessment has not run' }),
            }))
          }
        }
      }

      const currentGate = await deriveCurrentDesignExecutionGate({
        projectId: project.projectId,
        records: journalRecords,
        kit,
        skill,
        stateRevision,
        state: currentState,
        store,
        signal: request.signal,
      })
      if (request.action !== undefined) {
        const title = designText(skill.title, locale)
        if (currentGate?.kind !== 'user_continue') {
          return Object.freeze({
            kind: 'invalid',
            summary: pickLocalized(locale, `Design skill ${title} has no current user-continue action.`, `设计技能「${title}」当前没有可继续的用户操作。`),
          })
        }
        if (request.action.routeId !== currentGate.action.routeId) {
          return Object.freeze({
            kind: 'invalid',
            summary: pickLocalized(
              locale,
              `Design action ${JSON.stringify(request.action.routeId)} is not current for skill ${title}; expected ${expectedActionSummary(currentGate)}.`,
              `设计动作 ${JSON.stringify(request.action.routeId)} 不是技能「${title}」的当前动作；期望的是 ${expectedActionSummary(currentGate)}。`,
            ),
          })
        }
        const resolvedControl = request.resumeControl === undefined ? undefined
          : resolveDesignExecutionInput(currentGate, { kind: 'chat', text: request.resumeControl.text })
        const command = request.resumeControl === undefined
          ? currentHumanResumeCommand(request.agent, currentGate)
          : resolvedControl?.kind === 'command' ? resolvedControl.command : undefined
        if (command === undefined) {
          return Object.freeze({
            kind: 'invalid',
            summary: pickLocalized(
              locale,
              `Design action ${expectedActionSummary(currentGate)} requires a current human message matching its visible label or alias.`,
              `设计动作 ${expectedActionSummary(currentGate)} 需要一条与其可见标签或别名匹配的当前人类消息。`,
            ),
          })
        }
        const transition = await resumeDesignExecution(command, {
          invocationId: currentGate.invocationId,
          projectId: project.projectId,
          kit,
          kitVersion: kit.version,
          skillName: skill.name,
          bundleVersion: skill.version,
          stateRevision,
        }, request.signal, producer, reconstructionSource === undefined
          ? undefined
          : { reconstruct: true, reconstructionSourceRoot: reconstructionSource.sourceRoot })
        return finish(transitionResult(transition, project.root, kit, locale),
          transition.kind === 'await_user' ? transition.gate.pin : transition.pin)
      }

      if (currentGate !== undefined && request.reconstruct !== true) {
        if (!revising) return finish(transitionResult({ kind: 'await_user', gate: currentGate }, project.root, kit, locale), currentGate.pin)
      }
      if (humanInput.hasTurn && !humanInput.hasHuman) {
        const title = designText(skill.title, locale)
        return Object.freeze({
          kind: 'invalid',
          summary: pickLocalized(
            locale,
            `Design skill ${title} can start only from a current human message; background notices cannot start or re-plan Design work.`,
            `设计技能「${title}」只能由当前人类消息启动；后台通知无法启动或重新规划设计工作。`,
          ),
        })
      }
      const transition = await engageDesignExecution({
        invocationId: request.invocationId,
        projectId: project.projectId,
        kit,
        kitVersion: kit.version,
        skillName: skill.name,
        bundleVersion: skill.version,
        stateRevision,
      }, {
        brief: request.brief ?? '',
        currentDesignState: JSON.stringify(currentState ?? {}),
        userContext: host.design.renderDesignState(request.agent),
        ...(request.reconstruct === true ? { reconstruct: true } : {}),
        ...(reconstructionSource === undefined ? {} : { reconstructionSourceRoot: reconstructionSource.sourceRoot }),
      }, request.signal, { producer })
      return finish(transitionResult(transition, project.root, kit, locale),
        transition.kind === 'await_user' ? transition.gate.pin : transition.pin)
    },
  }
  return bridge.wrap(controller,
    (agent, name) => exactSkill(host.design.requireKitForAgent(agent), name)?.execution.mode === 'main',
    async (agent, signal) => (await host.design.selectedProjectForAgent(agent, signal))?.projectId)
}

/** Required host services. */
export const inject = ['design', 'tools', 'subprocess', 'systemPrompt']

/** Mount the attached canonical Design Producer over DSH's public Agent API. */
export function apply(ctx: Context, config: Config): void {
  const resolvedConfig = resolveConfig(config)
  registerReconstructionKnowledgeTool(ctx, (ctx as unknown as DshExecutionHost).design)
  let subagentStart: DesignSubagentStart | undefined
  let fileWorkerStart: DesignFileWorkerStart | undefined
  ctx.inject(['subagents'], (subagentCtx) => {
    const dispatcher = resolvedConfig.delegation?.provider === 'dsh-design-file-worker'
      ? registerDesignFileWorkerDispatcher(subagentCtx) : undefined
    // The dispatcher start function owns only closure state; no receiver binding.
    fileWorkerStart = dispatcher?.start
    const current: DesignSubagentStart = (provider, request) => subagentCtx.subagents.start(provider, request)
    subagentStart = current
    return () => {
      if (subagentStart === current) subagentStart = undefined
      if (fileWorkerStart === dispatcher?.start) fileWorkerStart = undefined
      dispatcher?.dispose()
    }
  })
  const host = ctx as unknown as DshExecutionHost
  const clarity = new DshClarityLifecycle(host.design)
  const unregisterClarity = host.design.registerClarityRuntime(clarity)
  ctx.on('agent/disposed', ({ agent }) => { clarity.reset(agent) })
  const unregisterSelection = host.design.registerWorkspaceChangeListener(change => {
    if (change.kind === 'selection-changed') clarity.reset(change.agent)
  })
  ctx.effect(() => () => { clarity.dispose(); unregisterClarity(); unregisterSelection() })
  const controller = createController(ctx, host, resolvedConfig, () => subagentStart, () => fileWorkerStart)
  registerRunDesignSkillTool(ctx, controller)
  installDesignResumeRouting(ctx, async (agent, text, signal) => {
    if (host.design.kitForAgent(agent) === undefined || activeMainBundleWork(agent) !== undefined) return undefined
    const project = await host.design.projectForAgent(agent, signal)
    if (project.kit === undefined) return undefined
    const kit = host.design.requireKitForAgent(agent)
    const candidates = kit.skills.filter(skill => skill.execution.handoff === 'user_continue'
      && matchesDesignResumeAction(skill.execution.resumeAction, text))
    if (candidates.length === 0) return undefined
    const store = await host.design.designFilesForProject(agent, project.projectId, nodeFs, signal)
    const stateRevision = (await store.head(signal)) ?? DESIGN_FILES_UNBORN_REVISION
    const records = (await host.design.readDesignJournal(agent)).records
    const gates: Extract<DesignExecutionGate, { kind: 'user_continue' }>[] = []
    for (const skill of candidates) {
      const state = await store.readPublished(skill.name, signal)
      const gate = await deriveCurrentDesignExecutionGate({
        projectId: project.projectId, records, kit, skill, stateRevision,
        state: state as Readonly<Record<string, unknown>> | undefined, store, signal,
      })
      if (gate?.kind === 'user_continue'
        && resolveDesignExecutionInput(gate, { kind: 'chat', text }).kind === 'command') gates.push(gate)
    }
    // Never guess when different Bundles expose the same visible control.
    return gates.length === 1 ? gates[0] : undefined
  })
}
