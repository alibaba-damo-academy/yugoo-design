/**
 * The Design System capability seam, registered as `ctx.design`.
 *
 * Owns in-process registered Design Kits keyed by name and explicit version,
 * plugin-bound Mindset and Bundle catalog views, the design-state runtime
 * context, and per-project Design Files stores backed by dedicated Git
 * repositories.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { DesignKnowledgeRevision, DesignKnowledgeEntityId, DesignKnowledgeRelationId } from './design-knowledge.ts'
import type { KnowledgeReadArguments } from './dsh-knowledge-query-tool.ts'
import { designGitReadArguments, readDesignGit } from './design-git-read.ts'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import { emitDshGitScopeTiming, emitDshTimingDiagnostic } from './dsh-timing-diagnostics.ts'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import { join, resolve, relative, sep } from 'node:path'
import { designProjectRecordsRoot } from './design-project-record-paths.ts'
import { commitDesignProjectRecords } from './design-project-records.ts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { isDeepStrictEqual } from 'node:util'
import { readDesignReviewPolicy, writeDesignReviewPolicy, DesignReviewPublicationQueue, type DesignReviewPolicy } from './design-review-policy.ts'
import { readFile, writeFile, rename, rm, mkdir, lstat, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { foldDesignJournal } from './design-journal.ts'
import type { DesignBundleVersion, DesignClarityReportedPayload, DesignExecutionAttemptPayload, DesignKit, DesignKitVersion, DesignSkill } from './types.ts'
import type { CompiledDesignRelationVocabulary } from './design-relation-vocabulary.ts'
import type { DesignAdvisory } from './design-advisory.ts'
import { collectGitStdout, GitVersioning, gitBackendSetting, type SpawnFn } from './git.ts'
import { DesignFilesStore, type DesignFilesAccess, type FsLike } from './design-files.ts'
import { registerDesignStateContext } from './prompt.ts'
import { nodeFs, registerServiceTools } from './service-tools.ts'
import { registerDesignClarityTool } from './dsh-design-clarity-tool.ts'
import { designClarityInputMatches, parseDesignClarityReported } from './design-clarity-report.ts'
import type { DesignClarityRuntime, SavedDesignAssessmentRequest, SettledDesignPanelSave } from './design-clarity-runtime.ts'
import { designSessionEvents } from './dsh-session-events.ts'
import { openDshGitScope, runDshGitScope } from './dsh-git-scope.ts'
import { activeMainBundleWork, interruptedMainBundleWork } from './dsh-main-bundle.ts'
import { ProjectContentPanelGuard } from './project-content-guard.ts'
import { isContentRecoveryTool } from './dsh-content-recovery-tool.ts'
import {
  DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION,
  readDesignClarityAuthority,
  writeDesignClarityAuthority,
  type DesignClarityAuthority,
} from './design-clarity-authority.ts'
import type { SubprocessLike, SystemPromptLike } from './dsh-contracts.ts'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
// Type-only: resolves ctx.sessionProjections for the design projection child.
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { designKnowledgeSourcePolicyIdentity } from './design-knowledge-source-policy.ts'
// Type-only: resolves ctx.commands for the /yugoo trigger command.
import type { CommandRuntime, CommandDefinition } from '@deepseek-ai/dsh-commands'
import {
  parseDesignCommand,
  runDesignProjectCommand,
  type DesignConversationSelection,
  type DesignProjectConversationPort,
  type DesignProjectPort,
  type DesignProjectRecord,
  type DesignProjectSnapshot,
} from './design-project-adapter.ts'
import { DesignProjectRegistry, type RegisteredDesignProject } from './design-project-registry.ts'
import type { DesignProjectId } from './design-project.ts'
import type { DesignProjectKitPin } from './design-project.ts'
import { composeProjectKit, projectBundleOverrides, sameProjectContentPin, latestInstalledKit, projectKitContentHash } from './project-content.ts'
import { ProjectContentMigration, type ProjectContentMigrationPorts } from './project-content-migration.ts'
import { ProjectContentTransaction } from './project-content-transaction.ts'
import { recordProjectContentAdoption } from './project-content-journal.ts'
import { parseDesignProjectJson } from './design-project.ts'
import { createAdvisoryEvidence } from './advisory-evidence.ts'
import { validateSkillDesign } from './validate-design.ts'
import type { DesignJournalValue, DesignKitPin } from './design-journal-payloads.ts'
import { assembleDesignState } from './renderer.ts'
import {
  DesignBundleContributionRegistry,
  type DesignBundleContribution,
  type DesignBundleContributionIds,
  type DesignDriverId,
  type DesignRuntimeDriver,
  type DesignValidationDriver,
} from './runtime-drivers.ts'
import {
  applyAdvisoryInboxEvent,
  deriveAdvisoryStaleness,
  type DesignAdvisoryCurrency,
  type DesignAdvisoryDecisionPayload,
  type SessionDesignAdvisory,
} from './design-advisory-events.ts'
import { DesignJournalRegistry } from './design-journal-registry.ts'
import type { ResolvedDesignAdvisoryAction } from './design-advisory-journal.ts'
import type {
  DesignAdvisoryActionState,
  DesignAdvisoryExecutionState,
  DesignJournalAdvisoryActionEntry,
  DesignJournalAdvisoryEntry,
  DesignJournalExecutionHandoffConsumption,
} from './design-journal.ts'
import type { DesignJournalRead } from './design-journal-storage.ts'
import { DesignExecutionInvocationId } from './design-execution-runtime.ts'
import { DESIGN_CORE_CLARITY_RUBRIC_PROMPT, DESIGN_CORE_PROGRESSION_PROMPT, renderDesignSkillCatalog } from './design-core-prompt.ts'
import {
  UNAVAILABLE_ADVISORY_RUNTIME_STATUS,
  type DesignAdvisoryRuntimeStatus,
  type DesignAdvisoryRuntimeStatusProvider,
} from './advisory-runtime-status.ts'
import { designFileToolDenial } from './design-file-tool-policy.ts'
import { isDesignWorkspaceTool } from './dsh-producer-design-tools.ts'
import { DesignKnowledgeLeaseId } from './design-knowledge-manager.ts'
import {
  DesignProjectKnowledgeLifecycle,
  type DesignProjectKnowledgeRuntime,
} from './design-project-knowledge-lifecycle.ts'
import { materializeDesignKnowledgeJournal } from './design-knowledge-materializer.ts'
import {
  refreshDesignKnowledge,
  readDesignKnowledgePublication,
  readPublishedDesignKnowledge,
  advanceDesignKnowledgePublication,
  readDesignKnowledgeFailure,
  writeDesignKnowledgeFailure,
  clearDesignKnowledgeFailure,
} from './design-knowledge-refresh.ts'
import {
  deriveDesignKnowledgeStatus,
  deriveReviewStatuses,
  renderDesignKnowledgeStatusReminder,
  type DesignKnowledgeStatusSnapshot,
  type DesignOrchestrationResult,
  type DesignReviewProfileStatusSnapshot,
} from './design-knowledge-status.ts'
import { DesignKnowledgeIndex } from './design-knowledge-index.ts'
import { parseSchemaYaml, type SchemaSpec } from './schema.ts'
import { knowledgeQueryFilters, knowledgeReadResult } from './design-knowledge-query.ts'
import { publishKnowledgeReview, type KnowledgeReviewObservation, type KnowledgeReviewRetraction } from './design-knowledge-review.ts'
import { readCompleteDesignKnowledge } from './design-knowledge-snapshot.ts'
import { storedKnowledgeGraph } from './design-knowledge-semantic.ts'
import { designOntologyCoverage } from './design-ontology.ts'
import type { DesignKnowledgeService } from './design-knowledge.ts'
import { ADVISORY_KNOWLEDGE_SOURCE_EQUIVALENCE, readAdvisoryDesignKnowledge, type AdvisoryDesignKnowledge, type AdvisoryKnowledgeSelection } from './advisory-knowledge.ts'
import {
  ConversationDesignBindingStore,
  conversationDesignBindingKey,
  type ConversationDesignBinding,
  type ConversationDesignBindingKey,
} from './conversation-design-binding-store.ts'
import { renderDshDesignAdvisorySetReminder } from './dsh-advisory.ts'
import { DesignSemanticCapabilityId, resolveSemanticCapability } from './semantic-capabilities.ts'
import { reviewSupportOf } from './review-support.ts'
import { currentAdvisoryEntries } from './advisory-inbox-policy.ts'
import { officialAdvisoryAttemptIds } from './official-advisory-profiles.ts'

/** Wire payload schema of the `designAdvisoryInbox` revision projection. */
const designAdvisoryInboxProjectionSchema: ZodType<number> = zod.number().int().min(0)

interface ActiveDesignWorkspace {
  readonly binding: ConversationDesignBinding
  readonly project: RegisteredDesignProject
  readonly checkpoint: string
  readonly values: Readonly<Record<string, DesignJournalValue>>
}

/** Exact committed Design Project projection used by model and Panel reads. */
export interface DesignProjectWorkspaceSnapshot {
  readonly checkpoint: string
  readonly design: Readonly<Record<string, DesignJournalValue>>
  readonly kit?: NonNullable<RegisteredDesignProject['kit']>
}

function sameProjectKitPin(
  left: RegisteredDesignProject['kit'],
  right: RegisteredDesignProject['kit'],
): boolean {
  return sameProjectContentPin(left, right)
}

/** Plugin-owned workspace change observed by host adapters. */
export type DesignWorkspaceChange =
  | { readonly kind: 'selection-changed'; readonly agent: Agent }
  | { readonly kind: 'workspace-restored'; readonly agent: Agent }
  | { readonly kind: 'design-changed'; readonly agent: Agent; readonly journalRevision: number; readonly publication?: DesignJournalRead; readonly projectId?: DesignProjectId }
  | { readonly kind: 'advisory-changed'; readonly agent: Agent; readonly journalRevision: number }
  | { readonly kind: 'review-policy-changed'; readonly agent: Agent; readonly policy: DesignReviewPolicy }

/** Process-local observer for plugin-owned workspace changes. */
export type DesignWorkspaceChangeListener = (change: DesignWorkspaceChange) => void

/**
 * Host-neutral orchestration principles for derived Knowledge (KAG) and GRA
 * reviews, injected as one Design Core prompt section on every host. They
 * combine publication defaults with Agent judgement and explicit human intent.
 */
const KNOWLEDGE_ORCHESTRATION_PRINCIPLES = [
  'Design Knowledge (KAG) and the Grounding/Reflection/Alignment reviews are derived services over the authoritative Design Files. Successful Design publication automatically schedules bounded KAG maintenance; you may also request it explicitly when needed.',
  'You receive a compact <design-knowledge-status> notice at activation, after each Design Files save settlement, and when a maintenance pass settles. Judge from it; never refresh or review merely because a state is not current.',
  'Reading never requires freshness: design_query_knowledge serves the latest complete generation with its pins, and every conclusion still cites the Design Files commit, not the derived graph.',
  'Call design_refresh_knowledge when an explicit refresh is useful for upcoming queries, reviews, or cross-Bundle decisions. Publication already schedules maintenance, so reuse queued/running work rather than duplicating it. It runs in the background, never blocks the conversation, and never retries itself after a failure; a new generation or an explicit retry may proceed.',
  'Call design_request_reviews only for profiles that are due and only when newly settled content may carry cross-file inconsistencies (grounding), doubtful external knowledge worth research (reflection), or decisions only the user can clarify (alignment). Reviews are detached, publish through the ordinary advisory inbox, and are advice, never authoritative facts.',
  'GRA follows the project user policy: auto combines your due-profile judgement with a publication-triggered configurable quiet window (default 30 seconds); every-publication reviews each published version; off forbids automatic and your autonomous reviews. Do not change that policy yourself. Reuse scheduled/running reviews rather than duplicating them. Neither KAG nor GRA is a foreground prerequisite; Clarity is independent.',
  'If the user explicitly asks to check or recheck the current Design, use design_recheck_reviews with a fresh stable requestId for that user request, even when the same revision was reviewed before. Reuse the same requestId only when retrying the same request; never invoke this manual path on your own initiative. An active same-profile review is reported as already active instead of launching a duplicate; that no-op does not consume the requestId.',
  'When you start either action, tell the user in one sentence what you started and why; present derived knowledge and review output as evidence-located assistance, not as a second source of design truth.',
].join(' ')

type KnowledgeIndexState = 'queued' | 'indexing' | 'ready' | 'error' | 'disabled'
type KnowledgeIndexPhase = 'projection' | 'semantic' | 'publication' | 'ready' | 'error' | 'disabled'
type KnowledgeMaintenanceReason = 'ensure' | 'changed' | 'retry'
interface KnowledgeMaintenanceEntry {
  agent: Agent
  target: string
  running: boolean
  rerun: boolean
}

/** Process-local execution observation used only while this Host is running. */
export interface DesignExecutionAttemptObservation extends DesignExecutionAttemptPayload {
  readonly sequence: number
  readonly timestamp: number
}

interface DesignKitFamily {
  readonly owner: symbol
  latestVersion: DesignKitVersion
  readonly versions: Map<DesignKitVersion, DesignKit>
}

/** Optional host storage roots; application commands never require them. */
export interface DesignServiceConfig {
  /** Parent directory for independent Design Project repositories. */
  readonly projectsRoot?: string
  /** Global project registry and runtime-state directory. */
  readonly stateRoot?: string
  /** Stable identity of this DSH installation inside the plugin state root. */
  readonly hostInstanceId?: string
  /** Maximum graph records supplied to one background advisory snapshot. */
  readonly advisoryKnowledgeLimit?: number
}

/** Authority-bound claim request issued by the run_design_skill adapter. */
export interface DesignAdvisoryActionClaimRequest {
  readonly receiptId: string
  readonly proposedInvocationId: DesignExecutionInvocationId
  readonly skillName: string
  readonly bundleVersion: DesignBundleVersion
}

/** Exact attempt authority returned to the adapter. */
export interface DesignAdvisoryActionClaimResult {
  readonly claimed: boolean
  readonly advisoryId: string
  readonly attemptId: string
  readonly effectiveInvocationId: DesignExecutionInvocationId
  readonly action: DesignJournalAdvisoryActionEntry
}

/** Publication handle owned by one configured Kit source. */
export interface DesignKitPublisher {
  /**
   * Make one fully validated candidate the registered Kit for its version.
   * Same-version publication atomically replaces the in-process content; a
   * new version becomes latest for new sessions while earlier versions stay
   * resolvable for exact pins within this process.
   * @param kit - fully loaded and validated candidate from the owning source.
   * @returns whether the source's latest version changed.
   */
  publish(kit: DesignKit): boolean
  /** Remove this source and all of its process-local versions. */
  dispose(): void
}

/** The `ctx.design` service. */
/** The authoritative checkpoint moved while a read-only graph snapshot was being assembled. */
export class DesignGraphReadRaceError extends Error {}

export default class DesignService extends Service {
  /** Hard dependencies supplied by the unmodified DSH plugin host. */
  static inject = ['subprocess', 'systemPrompt', 'tools']

  private readonly kits = new Map<string, DesignKitFamily>()
  /** Durable published content loaded by the trusted host; never disposed with a working source. */
  private readonly retainedKits = new Map<string, Map<DesignKitVersion, DesignKit>>()
  private readonly independentBundles = new Map<string, {readonly content: import('./kit-loader.ts').DesignBundleContent; readonly retained: boolean}>()
  private readonly projectMutations = new Map<string, Promise<void>>()
  /** Derived KAG writes serialize independently from authoritative Design Files. */
  private readonly knowledgeMutations = new Map<string, Promise<void>>()
  private readonly projectMutationScope = new AsyncLocalStorage<DesignProjectId>()
  private readonly conversationMutations = new WeakMap<Agent, Promise<void>>()
  private readonly journalMutations = new Map<string, Promise<void>>()
  private readonly projects: DesignProjectRegistry
  private readonly bindings: ConversationDesignBindingStore
  private readonly hostInstanceId: string
  private readonly activeWorkspaces = new WeakMap<Agent, ActiveDesignWorkspace>()
  private settledDesignChanges?: WeakMap<Agent, Set<string>>
  private readonly contentRecoveryLocations = new WeakMap<Agent, { projectId: string; root: string }>()
  private readonly workspaceContentEpochs = new WeakMap<Agent, number>()
  private readonly projectContentEpochs = new Map<string, number>()
  private readonly selectedAgents = new Set<WeakRef<Agent>>()
  private readonly selectedAgentRefs = new WeakMap<Agent, WeakRef<Agent>>()
  private readonly contentPanelGuards = new Map<string, ProjectContentPanelGuard>()
  private readonly workspaceChangeListeners = new Set<DesignWorkspaceChangeListener>()
  private readonly executionObservations = new WeakMap<Agent, {
    revision: number
    readonly attempts: DesignExecutionAttemptObservation[]
    active?: Map<string, DesignExecutionAttemptObservation>
  }>()
  private readonly journals = new DesignJournalRegistry(projectRoot => join(designProjectRecordsRoot(projectRoot), 'journal'),
    async (projectRoot, file) => { await commitDesignProjectRecords({ projectRoot,
      paths: [relative(projectRoot, file).split(sep).join('/')], message: 'Record Design project decisions', spawn: this.spawnAdapter() }) })
  private knowledgeRuntime?: { readonly owner: symbol; readonly runtime: DesignProjectKnowledgeRuntime; readonly restoring: Set<Promise<void>>; disposing: boolean }
  private readonly knowledgeLifecycles = new Map<Agent, DesignProjectKnowledgeLifecycle>()
  private readonly knowledgeRestorations = new Map<Agent, Promise<void>>()
  private readonly knowledgeRestorationOwners = new WeakMap<Agent, symbol | undefined>()
  private readonly knowledgeRestoreFailures = new WeakMap<Agent, { projectId: DesignProjectId; message: string }>()
  private readonly disposedAgents = new WeakSet<Agent>()
  private readonly knowledgeIndexStates = new Map<DesignProjectId, KnowledgeIndexState>()
  private readonly knowledgeIndexPhases = new Map<DesignProjectId, KnowledgeIndexPhase>()
  private readonly knowledgeIndexAttempts = new Map<DesignProjectId, symbol>()
  private readonly knowledgeIndexFailures = new Map<DesignProjectId, { target: string; message: string }>()
  private readonly knowledgeStatusInjections = new WeakMap<Agent, string>()
  private readonly knowledgeMaintenanceTargets = new Map<DesignProjectId, string>()
  private readonly knowledgeMaintenance = new Map<DesignProjectId, KnowledgeMaintenanceEntry>()
  private knowledgeIndexer = new DesignKnowledgeIndex()
  private advisoryRuntime?: { readonly owner: symbol; readonly provider: DesignAdvisoryRuntimeStatusProvider<Agent> }
  private clarityRuntime?: { readonly owner: symbol; readonly provider: DesignClarityRuntime<Agent> }
  private advisoryInboxLimit = 5
  private readonly advisoryKnowledgeLimit: number
  /** Live process ownership; absence permits single-writer orphan reconciliation/reclaim. */
  private readonly advisoryActionAttempts = new WeakMap<Agent, Map<string, string>>()
  /** Trusted executable contributions registered independently for each Bundle. */
  private readonly contributions = new DesignBundleContributionRegistry(ids => this.contributionDisposalReason(ids))
  private readonly context: Context
  private readonly workspaceReadScope = new AsyncLocalStorage<{ active: boolean; checks: (() => Promise<void>)[] }>()
  private readonly workspaceGitReaders = new Map<string, { identity: string; git: GitVersioning }>()

  /** Bound one UI read to a shared, revalidated project identity. No mutation uses this scope. */
  async withWorkspaceRead<T>(agent: Agent, signal: AbortSignal, read: () => Promise<T>): Promise<T> {
    const scope = { active: true, checks: [] as (() => Promise<void>)[] }
    return this.workspaceReadScope.run(scope, async () => {
      try {
        const selection = await this.currentSelection(agent)
        const result = await this.projects.withReadSnapshot(read, signal, true)
        if (selection?.projectId !== this.selectionForAgent(agent)?.projectId) {
          throw new Error('design: project selection changed while reading workspace')
        }
        for (const check of scope.checks) await check()
        signal.throwIfAborted()
        return result
      } finally {
        scope.active = false
      }
    })
  }

  private async workspaceGitReader(project: RegisteredDesignProject): Promise<GitVersioning> {
    const scope = this.workspaceReadScope.getStore()
    if (!scope?.active) return new GitVersioning(this.spawnAdapter(), project.root, 'design_files')
    const identity = async () => {
      const [root, git] = await Promise.all([lstat(project.root), lstat(join(project.root, '.git')).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      })])
      if (!root.isDirectory()) throw new Error('design: workspace repository identity changed')
      if (!git?.isDirectory()) return { key: JSON.stringify([root.dev, root.ino, git?.ino, git?.mtimeMs]), cacheable: false }
      // Shallow boundaries and Git configuration can change the interpretation
      // of an otherwise fixed OID. Replacement/graft repositories use fresh readers.
      const controls = await Promise.all(['config', 'shallow', 'packed-refs', 'info/grafts', 'refs/replace'].map(async path => {
        try {
          const stat = await lstat(join(project.root, '.git', path))
          return { path, symlink: stat.isSymbolicLink(), stamp: [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs] }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
      }))
      return {
        key: JSON.stringify([project.root, root.dev, root.ino, root.birthtimeMs, git.dev, git.ino, git.birthtimeMs, controls]),
        cacheable: !controls.some(control => control !== null && (control.symlink || control.path === 'info/grafts' || control.path === 'refs/replace')),
      }
    }
    const observed = await identity()
    scope.checks.push(async () => {
      if ((await identity()).key !== observed.key) throw new Error('design: workspace repository changed while reading')
    })
    const cached = this.workspaceGitReaders.get(project.projectId)
    const git = observed.cacheable && cached?.identity === observed.key ? cached.git : new GitVersioning(this.spawnAdapter(), project.root, 'design_files', observed.cacheable)
    this.workspaceGitReaders.delete(project.projectId)
    if (observed.cacheable) this.workspaceGitReaders.set(project.projectId, { identity: observed.key, git })
    while (this.workspaceGitReaders.size > 8) this.workspaceGitReaders.delete(this.workspaceGitReaders.keys().next().value!)
    return git
  }

  /**
   * @param ctx - Cordis context; the service registers as `ctx.design` and wires
   * the mindset catalog, design-state context, and Design tools.
   */
  constructor(ctx: Context, config: DesignServiceConfig = {}) {
    super(ctx, 'design')
    this.context = ctx
    const stateRoot = config.stateRoot ?? join(homedir(), '.dsh', 'design-system')
    this.advisoryKnowledgeLimit = config.advisoryKnowledgeLimit ?? 256
    if (!Number.isSafeInteger(this.advisoryKnowledgeLimit) || this.advisoryKnowledgeLimit < 1) {
      throw new Error('design: advisoryKnowledgeLimit must be a positive safe integer')
    }
    this.projects = new DesignProjectRegistry({
      projectsRoot: config.projectsRoot,
      stateRoot,
    })
    this.hostInstanceId = config.hostInstanceId ?? 'default'
    this.bindings = new ConversationDesignBindingStore({ root: resolve(stateRoot, 'conversation-bindings') })
    ctx.effect(() => () => {
      this.workspaceChangeListeners.clear()
      this.knowledgeMaintenance.clear()
      this.knowledgeMaintenanceTargets.clear()
      this.knowledgeMutations.clear()
      this.workspaceGitReaders.clear()
      this.journals.dispose()
    })
    ctx.on('agent/created', async ({ agent }) => {
      await this.restoreAgentKnowledge(agent)
      if (this.selectionForAgent(agent) === undefined) return
      // Agentic trigger model: activation only samples cheap durable state and
      // injects the compact KAG/GRA snapshot. The main Agent decides on its
      // next natural turn whether bounded maintenance or due reviews are worth
      // starting; opening a project never auto-starts expensive model work,
      // and the notice never wakes the model or promises execution.
      await this.injectKnowledgeOrchestrationSnapshot(agent)
    })
    ctx.on('agent/disposed', async ({ agent }) => {
      this.disposedAgents.add(agent)
      await this.knowledgeRestorations.get(agent)?.catch(() => {})
      this.knowledgeRestoreFailures.delete(agent)
      const reference = this.selectedAgentRefs.get(agent)
      if (reference) this.selectedAgents.delete(reference)
      const lifecycle = this.knowledgeLifecycles.get(agent)
      if (lifecycle === undefined) return
      await lifecycle.dispose()
      if (this.knowledgeLifecycles.get(agent) === lifecycle) this.knowledgeLifecycles.delete(agent)
    })
    const host = ctx as unknown as { systemPrompt: SystemPromptLike }
    // Host-neutral Design Core renders before the active-Kit mindset: the
    // decision loop and clarity rubric are the baseline a Kit only calibrates.
    host.systemPrompt.section({
      name: 'design:progression',
      order: 500,
      text: (assembly) => this.renderDesignProgression(assembly.agent),
    })
    host.systemPrompt.section({
      name: 'design:clarity-rubric',
      order: 525,
      text: (assembly) => this.renderClarityRubric(assembly.agent),
    })
    // Mindset section: a provider re-evaluated at every assembly, so the active
    // mindset is present in every model request regardless of compaction.
    host.systemPrompt.section({
      name: 'design:mindset',
      order: 550,
      text: (assembly) => this.renderMindset(assembly.agent),
    })
    host.systemPrompt.section({
      name: 'design:main-bundle-recovery',
      order: 575,
      text: (assembly) => {
        if (assembly.agent === undefined) return ''
        const work = interruptedMainBundleWork(assembly.agent)
        if (work === undefined) return ''
        return `The prior main-mode Design Bundle ${JSON.stringify(work.skillName)} ended before publication, so its scoped Design tools were revoked. Working files may remain. To continue that work, call run_design_skill again for the exact same Bundle${work.brief === undefined ? '' : ` with a brief that preserves the prior intent ${JSON.stringify(work.brief)}`}; do not use ordinary host write/edit/patch, do not delegate canonical JSON to a Worker, and do not silently switch execution mode.`
      },
    })
    // Host-neutral orchestration judgement for derived Knowledge and GRA:
    // principles, not schedules; the runtime below keeps only invariants.
    host.systemPrompt.section({
      name: 'design:knowledge-orchestration',
      order: 585,
      text: () => KNOWLEDGE_ORCHESTRATION_PRINCIPLES,
    })
    // Design-state runtime context: logged and re-emitted after compaction.
    registerDesignStateContext(host.systemPrompt, (assembly) => this.renderDesignState(assembly.agent))
    // Model-facing discovery tools; execution is registered separately as run_design_skill.
    registerServiceTools(ctx, this)
    // Structured clarity reporting: the sole clarity assessment authority.
    registerDesignClarityTool(ctx, this)
    ctx.on('tools/pre-execute', async (
      execution: ToolExecution,
      next: () => Promise<PreToolDecision>,
    ): Promise<PreToolDecision> => {
      const agent = execution.agent
      if (agent === undefined || agent.session.header.origin === 'subagent') return next()
      // A scoped Design tool is an invocation capability installed only for
      // this Agent. It performs its own project-selection, ownership and
      // publication checks. Recognize it before the ordinary host-tool guard:
      // reopening the registry here both duplicates authorization and lets an
      // unrelated registry/Git probe delay an already-bound Bundle write.
      if (isDesignWorkspaceTool(agent.ctx.tools.get(execution.name, agent))) return next()
      const recovery = this.contentRecoveryLocation(agent)
      if (recovery) {
        if (isContentRecoveryTool(agent.ctx.tools.get(execution.name, agent))) return next()
        const reason = designFileToolDenial({ name: execution.name, arguments: execution.arguments,
          projectRoot: recovery.root, designFilesRoot: join(recovery.root, 'design_files'), isSubagent: false })
        return reason === undefined ? next() : { kind: 'deny', reason }
      }
      const selection = this.selectionForAgent(agent)
      if (selection === undefined) return next()
      const project = await this.projects.require(selection.projectId, execution.signal)
      this.assertProjectSelection(agent, project.projectId)
      const reason = designFileToolDenial({
        name: execution.name,
        arguments: execution.arguments,
        projectRoot: project.root,
        designFilesRoot: project.designFilesRoot,
        isSubagent: false,
      })
      return reason === undefined ? next() : { kind: 'deny', reason }
    })
    // Explicit Design Project lifecycle; bare `/yugoo` is help and status.
    ctx.inject(['commands'], (commandCtx) => {
      this.registerProjectCommands(
        (commandCtx as unknown as { commands: CommandRuntime }).commands,
      )
    })
    this.registerAdvisoryProjection(ctx)
  }

  /** Register the sole public project entry; no legacy command alias is owned. */
  private registerProjectCommands(commands: Pick<CommandRuntime, 'register'>): void {
    const handler: CommandDefinition['handler'] = async (invocation) => {
      const result = await this.executeProjectCommand(invocation.agent, invocation.rawInput, invocation.signal)
      if (result.kind === 'success' && result.conversationPrompt !== undefined) {
        invocation.agent.steer(createUserMessage({
          content: [{ type: 'text', text: result.conversationPrompt }],
          source: { kind: 'user' },
        }))
      }
      return result
    }
    const input = { hint: '[new <name>|open <id|name|path>|migrate <path>|reconstruct <material-path>|list|status|kit <kit>|delete <id|name>|close]' }
    try {
      commands.register({ name: 'yugoo', description: 'Yugoo Design：新建、打开和管理独立设计项目', input, handler })
    } catch (cause) {
      throw new Error('Yugoo Design: cannot register /yugoo; the host command registration failed.', { cause })
    }
  }

  /** Shared user-command/tool entry. Tool results never synthesize user intent. */
  async executeProjectCommand(agent: Agent, input: string, signal: AbortSignal) {
    if (agent.session.header.parentSession !== undefined) throw new Error('design: project commands require the main Agent; children cannot change project selection')
    signal.throwIfAborted()
    const command = parseDesignCommand(input)
    if (command === undefined) return { kind: 'error' as const, text: '未知 /yugoo 子命令；使用 /yugoo 查看帮助。' }
    const projects: DesignProjectPort = {
      create: async (name) => this.projects.create(name, {
        provider: this.requireKnowledgeRuntime().defaultProvider,
      }, signal),
      migrate: async (reference, currentProjectId) => {
        const source = await this.projects.inspectMigrationSource(reference, signal)
        const current = currentProjectId === undefined ? undefined : await this.projects.require(currentProjectId, signal)
        const sourceKit = source.metadata?.kit === undefined
          ? undefined
          : this.resolveKit({ kit: source.metadata.kit.name, version: source.metadata.kit.version }) ?? this.latestKit(source.metadata.kit.name)
        const currentKit = current?.kit === undefined
          ? undefined : this.resolveKit({ kit: current.kit.name, version: current.kit.version })
        const installed = this.listKits()
        const kit = sourceKit ?? currentKit ?? (installed.length === 1 ? installed[0] : undefined)
        if (kit === undefined) {
          const names = installed.map(candidate => candidate.name).sort().join(', ')
          throw new Error(`design project migration: cannot determine Mindset from the source or current project; available Mindsets: ${names || 'none'}`)
        }
        const knowledge = current?.knowledge ?? { provider: this.requireKnowledgeRuntime().defaultProvider }
        return this.projects.migrate(reference, {
          knowledge, kit: { name: kit.name, version: kit.version },
        }, kit.skills.map(skill => skill.name), signal)
      },
      inspectReconstructionSource: async reference => this.projects.inspectReconstructionSource(reference, signal),
      open: async reference => this.projects.open(reference, signal),
      list: async () => this.projects.list(signal),
      status: async projectId => this.projects.status(projectId, signal),
      close: async projectId => this.projects.close(projectId, signal),
      forget: async reference => this.projects.forget(reference, signal),
      snapshot: async projectId => this.projects.snapshot(projectId, signal),
    }
    try {
      return await runDesignProjectCommand(command, {
        projects,
        conversation: this.conversationPort(agent, signal),
        advisoryStatus: () => this.advisoryRuntimeStatus(agent),
      })
    } catch (error) {
      return { kind: 'error' as const, text: error instanceof Error ? error.message : 'design: project command failed' }
    }
  }

  private registerAdvisoryProjection(ctx: Context) {
    // The standard advisory inbox projection is only a browser refresh signal.
    // Project, Design Files, and clarity state come from the plugin-owned
    // binding store, the project clarity authority, and the workspace RPC.
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      const projections = (projectionCtx as unknown as { sessionProjections: SessionProjectionRegistry }).sessionProjections
      projections.register<'designAdvisoryInbox', number>({
        key: 'designAdvisoryInbox',
        stateSchema: designAdvisoryInboxProjectionSchema,
        init: () => 0,
        apply: applyAdvisoryInboxEvent,
        wire: {
          viewSchema: designAdvisoryInboxProjectionSchema,
          view: (state) => state,
        },
        stateVersion: 1,
      })
    })
  }

  private bindingKey(agent: Agent): ConversationDesignBindingKey {
    return conversationDesignBindingKey({
      hostKind: 'dsh',
      hostInstanceId: this.hostInstanceId,
      conversationId: String(agent.id),
    })
  }

  private snapshotValues(snapshot: DesignProjectSnapshot): Readonly<Record<string, DesignJournalValue>> {
    return Object.freeze(Object.fromEntries(Object.entries(snapshot.bundleStates).map(([skill, state]) => [
      skill,
      Object.freeze({ state, origin: 'agent' as const }),
    ])))
  }

  private async restoreWorkspace(agent: Agent): Promise<ActiveDesignWorkspace | undefined> {
    const binding = await this.bindings.read(this.bindingKey(agent))
    if (binding.projectId === null) {
      this.activeWorkspaces.delete(agent)
      this.contentRecoveryLocations.delete(agent)
      return undefined
    }
    const location = await this.projects.contentRecoveryLocation(binding.projectId)
    if (existsSync(join(location.root, '.git', 'design-system-content-adoption'))) {
      this.contentRecoveryLocations.set(agent, location)
      this.activeWorkspaces.delete(agent)
      return undefined
    }
    this.contentRecoveryLocations.delete(agent)
    const project = await this.projects.require(binding.projectId)
    const snapshot = await this.projects.snapshot(project.projectId)
    const workspace = Object.freeze({
      binding,
      project,
      checkpoint: snapshot.checkpoint,
      values: this.snapshotValues(snapshot),
    })
    this.setActiveWorkspace(agent, workspace)
    // A restored binding is a real process-local selection, even when the
    // persisted project id did not change. Derived UI observers need this
    // event after a DSH restart; it does not inject a new Agent prompt.
    this.notifyWorkspaceChange({ kind: 'workspace-restored', agent })
    return workspace
  }

  private selectionForAgent(agent: Agent): DesignConversationSelection | undefined {
    const workspace = this.activeWorkspaces.get(agent)
    return workspace === undefined
      ? undefined
      : Object.freeze({ projectId: workspace.project.projectId, revision: workspace.binding.revision })
  }

  private async currentSelection(agent: Agent): Promise<DesignConversationSelection | undefined> {
    const workspace = this.activeWorkspaces.get(agent)
    if (workspace && this.workspaceContentEpochs.get(agent) !== (this.projectContentEpochs.get(workspace.project.projectId) ?? 0)) {
      await this.restoreWorkspace(agent)
    }
    return this.selectionForAgent(agent) ?? this.restoreWorkspace(agent).then((workspace) => (
      workspace === undefined
        ? undefined
        : Object.freeze({ projectId: workspace.project.projectId, revision: workspace.binding.revision })
    ))
  }

  private setActiveWorkspace(agent: Agent, workspace: ActiveDesignWorkspace): void {
    this.activeWorkspaces.set(agent, workspace)
    this.workspaceContentEpochs.set(agent, this.projectContentEpochs.get(workspace.project.projectId) ?? 0)
    if (!this.selectedAgentRefs.has(agent)) {
      const reference = new WeakRef(agent)
      this.selectedAgentRefs.set(agent, reference)
      this.selectedAgents.add(reference)
    }
  }

  /** Actual selected sessions, for project-wide Host run checks; no model-authored status. */
  agentsForProject(projectId: string): readonly Agent[] {
    const result: Agent[] = []
    for (const reference of this.selectedAgents) {
      const agent = reference.deref()
      if (!agent) this.selectedAgents.delete(reference)
      else if (this.selectionForAgent(agent)?.projectId === projectId) result.push(agent)
    }
    return result
  }

  private projectPanelGuard(projectId: string): ProjectContentPanelGuard {
    let guard = this.contentPanelGuards.get(projectId)
    if (!guard) this.contentPanelGuards.set(projectId, guard = new ProjectContentPanelGuard(projectId))
    return guard
  }

  async observeProjectPanel(agent: Agent, observation: import('./project-content-guard.ts').PanelDraftObservation): Promise<void> {
    const selection = await this.currentSelection(agent)
    if (!selection || selection.projectId !== observation.projectId) throw new Error('design: Panel observation project binding changed')
    this.projectPanelGuard(selection.projectId).observe(observation)
  }

  async resolveDisconnectedProjectPanels(agent: Agent, signal: AbortSignal): Promise<{ discarded: number }> {
    const project = await this.projectForAgent(agent, signal), guard = this.contentPanelGuards.get(project.projectId)
    const snapshot = guard?.disconnected() ?? []
    if (!snapshot.length) return { discarded: 0 }
    const host = this.context as unknown as { userQuestions?: { ask(input: { agent: Agent; signal: AbortSignal; questions: readonly { id: string; question: string; options: readonly { label: string }[] }[] }): Promise<{ answers: readonly { id: string; selected: readonly string[] }[] }> } }
    if (!host.userQuestions) throw new Error('content upgrade: this Host cannot obtain actual user confirmation; reconnect the original pages')
    const result = await host.userQuestions.ask({ agent, signal, questions: [{ id: 'discard-disconnected-design-drafts',
      question: `项目“${project.name}”的 ${snapshot.length} 个设计面板已断开，草稿状态未知。确认已放弃这些页面的未保存编辑？这不会保存任何文件。`,
      options: [{ label: '保留并返回原页面' }, { label: '确认放弃未保存编辑' }] }] })
    if (!result.answers.some(answer => answer.id === 'discard-disconnected-design-drafts' && answer.selected.includes('确认放弃未保存编辑'))) return { discarded: 0 }
    signal.throwIfAborted()
    if ((await this.bindings.read(this.bindingKey(agent))).projectId !== project.projectId) throw new Error('content upgrade: project binding changed; no draft was discarded')
    guard!.discardDisconnected(snapshot)
    return { discarded: snapshot.length }
  }

  /** Project-wide actual foreground/worker/review state, including other selected sessions. */
  async assertContentUpgradeQuiescent(projectId: string): Promise<void> {
    this.contentPanelGuards.get(projectId)?.assertQuiescent()
    for (const agent of this.agentsForProject(projectId)) {
      if (activeMainBundleWork(agent, projectId)) throw new Error('design: settle active main Bundle before upgrading')
      const attempts = new Map<string, DesignExecutionAttemptObservation>()
      for (const item of this.executionAttemptsFor(agent, projectId)) attempts.set(item.attemptId, item)
      // Bounded presentation history must not evict an actual still-running attempt.
      for (const item of this.executionObservations.get(agent)?.active?.values() ?? []) {
        if (item.projectId === projectId) attempts.set(item.attemptId, item)
      }
      if ([...attempts.values()].some(item => item.phase === 'queued' || item.phase === 'working')) throw new Error('design: native Producer or Worker is still running')
      const reviews = this.advisoryRuntimeStatus(agent)
      if (reviews.phase === 'running' || reviews.phase === 'scheduled') throw new Error('design: settle scheduled or running native reviews before upgrading')
    }
  }

  private invalidateProjectContent(projectId: string): void {
    this.projectContentEpochs.set(projectId, (this.projectContentEpochs.get(projectId) ?? 0) + 1)
    for (const agent of this.agentsForProject(projectId)) this.notifyWorkspaceChange({ kind: 'selection-changed', agent })
  }

  private assertCurrentContent(agent: Agent, project: RegisteredDesignProject): void {
    if (existsSync(join(project.root, '.git', 'design-system-content-adoption'))) throw new Error('design: content adoption requires recovery before reading or writing')
    if (this.workspaceContentEpochs.get(agent) !== (this.projectContentEpochs.get(project.projectId) ?? 0)) {
      throw new Error('design: project content changed; reopen its workspace before using scoped tools')
    }
  }

  private assertStoreContent(agent: Agent, project: RegisteredDesignProject, epoch: number): void {
    this.assertCurrentContent(agent, project)
    if (epoch !== (this.projectContentEpochs.get(project.projectId) ?? 0)
      || !sameProjectContentPin(project.kit, this.activeWorkspaces.get(agent)?.project.kit)) {
      throw new Error('design: scoped store belongs to the previous content version; reopen it')
    }
  }

  private async appendJournalKit(
    project: DesignProjectRecord,
    agent: Agent,
    kit: string,
    version: DesignKitVersion,
  ): Promise<number> {
    const conversation = String(project.projectId)
    const mutation = await this.journals.atomicMutate(project.root, conversation, (current) => {
      if (current.snapshot.latestKitSelection?.kit === kit && current.snapshot.latestKitSelection.version === version) return undefined
      return {
        type: 'design/kit-selected',
        data: {
          kit,
          version,
          operation: current.snapshot.latestKitSelection?.kit === kit ? 'upgrade' : 'activate',
        },
      }
    })
    return mutation.read.revision
  }

  private conversationPort(agent: Agent, signal?: AbortSignal): DesignProjectConversationPort {
    const key = this.bindingKey(agent)
    const lifecycle = this.knowledgeLifecycleFor(agent)
    return {
      current: async () => this.currentSelection(agent),
      select: (record, snapshot) => this.serializeConversationMutation(agent, async () => {
        const unavailableKitWarning = record.kit !== undefined
          && this.resolveProjectKit(record.kit) === undefined
          ? `项目 pin 的设计心智 ${JSON.stringify(record.kit.name)}@${JSON.stringify(record.kit.version)} 不可用；当前已按恢复模式打开，依赖设计心智的读取与写入保持禁用。请恢复完整的精确版本定义；更改 mindset 不会升级已有项目。`
          : undefined
        const current = await this.bindings.read(key)
        const preparation = await lifecycle.prepare(current.projectId, record, snapshot)
        try {
          const binding = await this.bindings.bind(key, record.projectId, current.revision)
          const registered = await this.projects.require(record.projectId, signal)
          this.setActiveWorkspace(agent, Object.freeze({
            binding,
            project: registered,
            checkpoint: snapshot.checkpoint,
            values: this.snapshotValues(snapshot),
          }))
          const finalized = await preparation.finalize()
          this.notifyWorkspaceChange({ kind: 'selection-changed', agent })
          let journalWarning: string | undefined
          if (record.kit !== undefined) {
            try {
              await this.appendJournalKit(record, agent, record.kit.name, record.kit.version)
            } catch (error) {
              journalWarning = `设计项目已打开，但 Kit Journal 结算失败，可从项目快照恢复：${String(error)}`
            }
          }
          const warning = [unavailableKitWarning, finalized.warning, journalWarning].filter((value): value is string => value !== undefined).join(' ')
          return warning === ''
            ? { revision: binding.revision }
            : { revision: binding.revision, warning }
        } catch (error) {
          try {
            await preparation.abort()
          } catch (abortError) {
            throw new AggregateError([error, abortError], 'design project: binding update and lifecycle abort both failed')
          }
          throw error
        }
      }),
      close: (projectId) => this.serializeConversationMutation(agent, async () => {
        const current = await this.bindings.read(key)
        if (current.projectId !== projectId) {
          throw new Error(`design: conversation binding changed while closing ${JSON.stringify(projectId)}`)
        }
        const project = await this.projects.require(projectId, signal)
        const snapshot = await this.projects.snapshot(projectId, signal)
        await lifecycle.close(projectId)
        try {
          const binding = await this.bindings.unbind(key, current.revision)
          this.activeWorkspaces.delete(agent)
          this.notifyWorkspaceChange({ kind: 'selection-changed', agent })
          return { revision: binding.revision }
        } catch (error) {
          try {
            await lifecycle.restore(project, snapshot)
          } catch (restoreError) {
            throw new AggregateError([error, restoreError], 'design project: binding close and lifecycle restore both failed')
          }
          throw error
        }
      }),
      changeMindset: (projectId, kitName) => this.serializeConversationMutation(agent, async () => {
        return this.serializeProjectMutation(agent, projectId, 'selection', async () => {
          const kit = this.listKits().find(item => item.name === kitName)
          if (kit === undefined) throw new Error(`design: unknown mindset ${JSON.stringify(kitName)}`)
          const previous = await this.projects.open(projectId, signal)
          if (previous.kit && previous.kit.name !== kit.name) throw new Error('design: changing an active Kit requires an explicit semantic migration')
          const pin = previous.kit ?? { name: kit.name, version: kit.version }
          const effective = this.resolveProjectKit(pin)
          if (!effective) throw new Error('design: restore the exact pinned Kit or explicitly migrate; mindset selection cannot upgrade saved design')
          const project = await this.projects.setKitPin(projectId, pin, signal)
          const sourceRevision = await this.appendJournalKit(project, agent, effective.name, effective.version)
          const snapshot = await this.projects.snapshot(projectId, signal)
          const binding = await this.bindings.read(key)
          if (binding.projectId !== projectId) throw new Error('design: conversation binding changed while selecting the mindset')
          this.setActiveWorkspace(agent, Object.freeze({
            binding,
            project,
            checkpoint: snapshot.checkpoint,
            values: this.snapshotValues(snapshot),
          }))
          this.notifyWorkspaceChange({ kind: 'selection-changed', agent })
          return { kit: effective.name, version: effective.version, sourceRevision }
        })
      }),
    }
  }

  private async serializeConversationMutation<T>(agent: Agent, operation: () => Promise<T>): Promise<T> {
    const previous = this.conversationMutations.get(agent) ?? Promise.resolve()
    const execution = previous.then(operation, operation)
    const tail = execution.then(() => undefined, () => undefined)
    this.conversationMutations.set(agent, tail)
    try {
      return await execution
    } finally {
      if (this.conversationMutations.get(agent) === tail) this.conversationMutations.delete(agent)
    }
  }

  /**
   * Register the host's provider-neutral project knowledge runtime.
   * @param runtime - exact default provider plus lifecycle/data ports.
   * @returns an async disposer that drains this service's session leases.
   */
  registerDesignKnowledgeRuntime(runtime: DesignProjectKnowledgeRuntime): () => Promise<void> {
    if (this.knowledgeRuntime !== undefined) throw new Error('design: duplicate Design Knowledge runtime')
    const owner = Symbol('design-knowledge-runtime')
    this.knowledgeIndexer = new DesignKnowledgeIndex()
    this.knowledgeIndexStates.clear()
    this.knowledgeIndexPhases.clear()
    this.knowledgeIndexAttempts.clear()
    this.knowledgeMaintenance.clear()
    this.knowledgeMaintenanceTargets.clear()
    this.knowledgeMutations.clear()
    this.knowledgeRuntime = { owner, runtime, restoring: new Set(), disposing: false }
    // Plugin replacement does not recreate the Host's existing Agents. Restore
    // their durable selections and leases at registration, not in status reads
    // or by starting a new model turn. Future Agents use the same lifecycle.
    for (const agent of this.context.get('agents')?.list() ?? []) {
      this.knowledgeRestoreFailures.delete(agent)
      void this.restoreAgentKnowledge(agent).catch(error => {
        this.context.logger?.warn(`design: could not restore Design Knowledge: ${String(error).slice(0, 1000)}`)
      })
    }
    return async () => {
      const registration = this.knowledgeRuntime
      if (registration?.owner !== owner) return
      if (registration.disposing) throw new Error('design: Design Knowledge runtime disposal is already in progress')
      registration.disposing = true
      // A restore may still be reading a binding before it acquires a lease.
      // Fence new work, then drain it before taking the disposal snapshot.
      await Promise.allSettled([...registration.restoring])
      await this.knowledgeIndexer.close()
      const lifecycles = [...this.knowledgeLifecycles.values()]
      const released = await Promise.allSettled(lifecycles.map(lifecycle => lifecycle.dispose()))
      const failures = released.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failures.length > 0) {
        registration.disposing = false
        throw new AggregateError(failures.map(result => result.reason), 'design: Design Knowledge runtime lease disposal failed')
      }
      for (const [agent, lifecycle] of this.knowledgeLifecycles) {
        if (lifecycles.includes(lifecycle)) this.knowledgeLifecycles.delete(agent)
      }
      this.knowledgeIndexStates.clear()
      this.knowledgeIndexPhases.clear()
      this.knowledgeIndexAttempts.clear()
      this.knowledgeMaintenance.clear()
      this.knowledgeMaintenanceTargets.clear()
      this.knowledgeMutations.clear()
      if (this.knowledgeRuntime?.owner === owner) this.knowledgeRuntime = undefined
    }
  }

  /** Restore an existing Host Agent once; never refresh/index or wake it. */
  private restoreAgentKnowledge(agent: Agent): Promise<void> {
    const registration = this.knowledgeRuntime
    const pending = this.knowledgeRestorations.get(agent)
    if (pending && this.knowledgeRestorationOwners.get(agent) === registration?.owner) return pending
    const current = () => !this.disposedAgents.has(agent)
      && this.knowledgeRuntime === registration && !registration?.disposing
    const task = this.serializeConversationMutation(agent, async () => {
      if (!current()) return
      const workspace = await this.restoreWorkspace(agent)
      if (!workspace || !registration || !current()) return
      const snapshot = await this.projects.snapshot(workspace.project.projectId)
      if (!current()) return
      await this.knowledgeLifecycleFor(agent).restore(workspace.project, snapshot)
      if (!current()) return
      this.knowledgeRestoreFailures.delete(agent)
      // The first restoration event exposes the binding. This settlement lets
      // existing derived views sample the now-open provider without polling.
      this.notifyWorkspaceChange({ kind: 'workspace-restored', agent })
    }).catch(error => {
      const selection = this.selectionForAgent(agent)
      if (selection && current()) {
        this.knowledgeRestoreFailures.set(agent, { projectId: selection.projectId, message: String(error).slice(0, 1000) })
        this.notifyWorkspaceChange({ kind: 'workspace-restored', agent })
      }
      throw error
    })
    this.knowledgeRestorations.set(agent, task)
    this.knowledgeRestorationOwners.set(agent, registration?.owner)
    registration?.restoring.add(task)
    const settle = () => {
      if (this.knowledgeRestorations.get(agent) === task) this.knowledgeRestorations.delete(agent)
      registration?.restoring.delete(task)
    }
    void task.then(settle, settle)
    return task
  }

  /**
   * Publish one validated advisory for a session's review UI.
   * @param agent - owning Agent and workspace journal scope.
   * @param advisory - trusted bounded advisory.
   */
  async publishAdvisory(agent: Agent, advisory: DesignAdvisory): Promise<void> {
    await this.withJournal(agent, async (workspace, conversation) => {
      await this.journals.publish(workspace, conversation, advisory)
      const read = await this.journals.read(workspace, conversation)
      this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: read.revision })
      this.injectAdvisoryProjection(agent, read.snapshot.advisories, read.snapshot.latestDesignChange?.journalRevision)
    })
  }

  /**
   * Persist one completed advisory review pass, including an empty findings
   * list. Only a produced (non-stale, non-failed) run may be recorded. The
   * append settles after any advisory publication for the same pass: a
   * journal failure leaves the advice durable and the profile simply due
   * again, recoverable by a later review.
   * @param agent - owning Agent and workspace journal scope.
   * @param completion - the exact reviewed revision, commit, and KAG path facts.
   * @returns whether a new fact was appended (identical repeats append nothing).
   */
  async recordAdvisoryReviewCompletion(
    agent: Agent,
    completion: import('./design-journal.ts').DesignJournalAdvisoryReviewCompletion,
  ): Promise<{ readonly recorded: boolean }> {
    return this.withJournal(agent, async (workspace, conversation) => {
      const result = await this.journals.recordAdvisoryReviewCompletion(workspace, conversation, completion)
      return { recorded: result.recorded }
    })
  }

  /** Re-project current non-stale advice after an independent empty review result. */
  async refreshAdvisoryProjection(agent: Agent): Promise<void> {
    await this.withJournal(agent, async (workspace, conversation) => {
      const read = await this.journals.read(workspace, conversation)
      this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: read.revision })
      this.injectAdvisoryProjection(agent, read.snapshot.advisories, read.snapshot.latestDesignChange?.journalRevision)
    })
  }

  /** Refresh derived storage using existing host serialization and model runtime. */
  async rebuildDerivedKnowledge(projectId: DesignProjectId, service: import('./design-knowledge.ts').DesignKnowledgeService) {
    // Host-only recovery reads the registered project, never caller-supplied paths.
    const project = await this.projects.require(projectId)
    const kit = project.kit && this.resolveProjectKit(project.kit)
    if (!kit) throw new Error('Knowledge recovery requires the project\'s pinned Kit')
    const schemas: Record<string, SchemaSpec> = {}
    for (const skill of kit.skills) if (typeof skill.metadata?.schemaYaml === 'string') schemas[`${skill.name}/${skill.name}.json`] = parseSchemaYaml(skill.metadata.schemaYaml)
    const store = new DesignFilesStore(nodeFs, new GitVersioning(this.spawnAdapter(), project.root, 'design_files'), project.designFilesRoot)
    // This provider-open callback rebuilds only a disposable cache. The host
    // restores the project archive before exposing it; ordinary settled refresh
    // owns project-record publication after the provider has opened.
    const result = await refreshDesignKnowledge({ projectId, service, store, schemas, ontology: kit.ontologyContract, mutate: operation => operation() })
    return async () => {
      const current = await this.projects.require(projectId)
      const head = await store.head()
      if (current.root !== project.root || JSON.stringify(current.kit) !== JSON.stringify(project.kit)
        || !head || !await store.sameDesignEvidenceAt(result.checkpoint, head)) throw new Error('Design checkpoint changed during Knowledge recovery; retry from current files')
    }
  }

  knowledgeRecoveryStatus(projectId: DesignProjectId) {
    return this.knowledgeRuntime?.runtime.recoveryStatus?.(projectId)
  }

  /** Resolve only registered project storage; callers cannot supply arbitrary roots. */
  async knowledgeProjectRoot(projectId: DesignProjectId): Promise<string> {
    return (await this.projects.require(projectId)).root
  }

  knowledgeIndexStatus(projectId: DesignProjectId) {
    const live = this.knowledgeIndexer.state(projectId)
    return live === 'unknown' ? this.knowledgeIndexStates.get(projectId) ?? 'unknown' : live
  }

  knowledgeIndexPhase(projectId: DesignProjectId): KnowledgeIndexPhase | 'unknown' {
    const state = this.knowledgeIndexStatus(projectId)
    if (state === 'ready' || state === 'error' || state === 'disabled') return state
    return this.knowledgeIndexPhases.get(projectId) ?? (state === 'indexing' ? 'semantic' : 'unknown')
  }

  /** Called by the provider's final lease release, not by an individual viewer. */
  async releaseKnowledgeIndex(projectId: DesignProjectId) { await this.knowledgeIndexer.release(projectId) }

  async retryDerivedKnowledge(agent: Agent, signal?: AbortSignal) {
    const project = await this.projectForAgent(agent, signal)
    const runtime = this.requireKnowledgeRuntime()
    if (!runtime.retryRecovery || runtime.recoveryStatus?.(project.projectId)?.state !== 'error') throw new Error('Knowledge recovery is not awaiting retry')
    runtime.retryRecovery(project.projectId)
    // Retrying is a lifecycle command, not a read hint. Start a fresh
    // acquire/rebuild/index pass immediately so the Panel can remain a pure
    // observer and recovery does not depend on a later save or reopen.
    this.scheduleKnowledgeMaintenance(agent, project.projectId, 'retry')
    return { accepted: true }
  }

  async refreshPublishedKnowledge(agent: Agent, signal?: AbortSignal, index: boolean | 'background' = true) {
    const indexer = this.knowledgeIndexer
    const project = await this.projectForAgent(agent, signal)
    const attempt = Symbol('knowledge-index')
    const report = (phase: KnowledgeIndexPhase) => {
      if (!index || this.knowledgeIndexAttempts.get(project.projectId) !== attempt) return
      this.knowledgeIndexPhases.set(project.projectId, phase)
      if (phase === 'ready' || phase === 'error' || phase === 'disabled') this.knowledgeIndexStates.set(project.projectId, phase)
      else this.knowledgeIndexStates.set(project.projectId, 'indexing')
    }
    if (index) { this.knowledgeIndexAttempts.set(project.projectId, attempt); report('projection') }
    try {
      // A prior session-start may have observed an unavailable old index. Reacquire
      // its derived service on demand; recovery never requires reopening the project.
      await this.knowledgeLifecycleFor(agent).restore(project, await this.projects.snapshot(project.projectId))
      const owner = () => {
        const current = [agent, ...this.knowledgeLifecycles.keys()].find(candidate => this.selectionForAgent(candidate)?.projectId === project.projectId)
        if (!current) throw new DOMException('No remaining Knowledge project reader', 'AbortError')
        return current
      }
      // Background work belongs to the acquired project, not its first viewer.
      // Re-resolve a surviving owner for access; never capture a short RPC signal.
      const store = index ? new DesignFilesStore(nodeFs, new GitVersioning(this.spawnAdapter(), project.root, 'design_files'), project.designFilesRoot, {
        read: async operation => {
          await this.authorizeProjectWrite(owner(), project.projectId)
          const result = await operation()
          await this.authorizeProjectWrite(owner(), project.projectId)
          return result
        },
        mutate: async () => { throw new Error('Knowledge indexing cannot edit Design Files') },
      }) : await this.designFilesForProject(agent, project.projectId, nodeFs, signal)
      const schemas: Record<string, SchemaSpec> = {}
      const activeKit = this.kitForAgent(agent)
      for (const skill of activeKit?.skills ?? []) {
        const yaml = skill.metadata?.schemaYaml
        if (typeof yaml === 'string') schemas[`${skill.name}/${skill.name}.json`] = parseSchemaYaml(yaml)
      }
      const runtime = this.requireKnowledgeRuntime()
      const mutate = this.knowledgeMutationLane(agent, project.projectId, signal)
      const result = await refreshDesignKnowledge({ projectId: project.projectId, store, schemas, ontology: activeKit?.ontologyContract, service: runtime.service, signal,
        mutate,
        persist: async () => { await runtime.persistProjectRecords?.(project.projectId) },
        report,
        indexer, background: index === 'background',
        identity: runtime.semantic?.identity, cache: runtime.semantic?.publicationCache?.(project.projectId),
        ...(index && runtime.semantic?.compute ? { compute: (graph, signal) => runtime.semantic!.compute!(project.projectId, graph, signal) } : {}) })
      if (index && this.knowledgeIndexAttempts.get(project.projectId) === attempt) {
        this.knowledgeIndexStates.set(project.projectId, result.semantic)
        if (result.semantic === 'ready' || result.semantic === 'error' || result.semantic === 'disabled') this.knowledgeIndexPhases.set(project.projectId, result.semantic)
      }
      return result
    } catch (error) {
      if (index && this.knowledgeIndexAttempts.get(project.projectId) === attempt) {
        this.knowledgeIndexStates.set(project.projectId, 'error')
        this.knowledgeIndexPhases.set(project.projectId, 'error')
      }
      // A superseded or cancelled attempt is not a failure of the current
      // generation; a real error becomes bounded memory + durable evidence.
      if ((error as { name?: string } | undefined)?.name !== 'AbortError') {
        const failureTarget = this.knowledgeMaintenanceTarget(agent, project.projectId) ?? 'unbound'
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
        this.knowledgeIndexFailures.set(project.projectId, { target: failureTarget, message })
        void writeDesignKnowledgeFailure(this.knowledgeRuntime?.runtime?.semantic?.publicationCache?.(project.projectId), failureTarget, message)
      }
      throw error
    }
  }

  async publishReviewKnowledge(agent: Agent, reviewed: AdvisoryDesignKnowledge,
    producer: 'grounding' | 'reflection' | 'alignment', observations: readonly KnowledgeReviewObservation[], signal?: AbortSignal,
    retractions?: readonly KnowledgeReviewRetraction[], relationVocabulary?: CompiledDesignRelationVocabulary) {
    return this.withSelectedKnowledge(agent, async (service, project, checkpoint) => {
      if (project.projectId !== reviewed.project) throw new Error('Design project changed during Knowledge review')
      const files = await this.designFilesForProject(agent, project.projectId, nodeFs, signal)
      const matches = async (head: string | undefined): Promise<boolean> => head !== undefined
        && await this.knowledgeSourceMatches(files, reviewed.checkpoint, head, signal)
      if (!await matches(checkpoint)) throw new Error('Design project changed during Knowledge review')
      if (!await this.knowledgeSourceMatches(files, reviewed.sourceCheckpoint, reviewed.checkpoint, signal)) {
        throw new Error('Knowledge review source no longer matches the reviewed Design evidence')
      }
      return this.serializeKnowledgeMutation(agent, project.projectId, async () => {
        const currentVocabulary = this.kitForAgent(agent)?.relationVocabulary
        if ((currentVocabulary?.revision ?? 'legacy-unavailable') !== (relationVocabulary?.revision ?? 'legacy-unavailable')) {
          throw new Error('Review relation vocabulary changed')
        }
        const before = await this.projects.status(project.projectId)
        if (!await matches(before.lastCheckpoint)) throw new Error('Design checkpoint changed during Knowledge review')
        const result = await publishKnowledgeReview({ service, projectId: project.projectId, checkpoint: reviewed.checkpoint, sourceCheckpoint: reviewed.sourceCheckpoint, reviewed: reviewed.graph, producer, observations, retractions,
          relationVocabulary, signal })
        const after = await this.projects.status(project.projectId)
        if (!await matches(after.lastCheckpoint)) throw new Error('Design checkpoint changed while publishing Knowledge review')
        const runtime = this.requireKnowledgeRuntime()
        await advanceDesignKnowledgePublication(runtime.semantic?.publicationCache?.(project.projectId), reviewed.checkpoint, result.revision,
          (left, right) => files.sameDesignEvidenceAt(left, right, signal))
        await runtime.persistProjectRecords?.(project.projectId)
        return result
      }, signal)
    })
  }

  async readStoredDesignGraph(agent: Agent, signal?: AbortSignal) {
    const project = await this.projectForAgent(agent, signal)
    // This is a pure derived read. Never hold the authoritative Design Files
    // mutation lane while Ladybug/cache I/O is pending; validate the immutable
    // Git checkpoint before and after instead.
    const store = await this.designFilesForProject(agent, project.projectId, nodeFs, signal)
    const checkpoint = await store.head(signal)
    if (!checkpoint) throw new Error('Knowledge graph requires a published checkpoint')
    const runtime = this.requireKnowledgeRuntime()
    const cache = runtime.semantic?.publicationCache?.(project.projectId)
    const { publication, snapshot } = await readPublishedDesignKnowledge({ service: runtime.service, cache,
      projectId: project.projectId, limit: 100, signal })
    const publicationMatchesHead = publication !== undefined && await this.knowledgeSourceMatches(store, publication.checkpoint, checkpoint, signal)
    this.assertProjectSelection(agent, project.projectId)
    if (await store.head(signal) !== checkpoint) throw new DesignGraphReadRaceError('Design checkpoint changed during graph read')
    const publishedCheckpoint = publication?.checkpoint ?? checkpoint
    const graph = storedKnowledgeGraph(snapshot, publishedCheckpoint)
    graph.warnings.push(...(publication?.warnings ?? []))
    const activeState = this.knowledgeIndexStatus(project.projectId)
    const phase = this.knowledgeIndexPhase(project.projectId)
    // Honest coverage: currency derives ONLY from the durable publication
    // matching the authoritative head. A stale publication without a live job
    // is `due` (the latest complete generation stays readable), and a residual
    // in-memory `ready` without any publication pointer never claims currency.
    const embedding = activeState === 'indexing' || activeState === 'error' || activeState === 'queued'
      ? activeState
      : publication === undefined
        ? (activeState === 'ready' ? 'unknown' : activeState)
        : publicationMatchesHead ? 'ready' : 'due'
    const ontology = designOntologyCoverage(graph.nodes, this.kitForAgent(agent)?.ontologyContract)
    return { ...graph, projectId: project.projectId, knowledgeRevision: snapshot.revision,
      recovery: this.knowledgeRecoveryStatus(project.projectId),
      coverage: { projection: 'canonical-json-and-direct-artifacts', embedding, phase, review: 'unknown', ontology },
      freshness: { sourceCheckpoint: checkpoint, ...(publication === undefined ? {} : { indexedCheckpoint: publication.checkpoint }),
        ...(publication !== undefined && publication.checkpoint !== checkpoint && publicationMatchesHead ? { sourceEquivalent: true } : {}) } }
  }

  /** Library Git reads follow native ancestry, never a model-supplied root. */
  async queryDesignGit(caller: Agent, input: unknown, signal?: AbortSignal) {
    const args = designGitReadArguments(input)
    if (caller.session.header.parentSession !== undefined && (!args.project || !args.checkpoint)) {
      throw new Error('Design Git child query requires exact project and checkpoint pins')
    }
    let owner: Agent | undefined = caller
    let project: RegisteredDesignProject | undefined
    const seen = new Set<Agent>()
    while (owner) {
      signal?.throwIfAborted()
      if (seen.has(owner)) throw new Error('Cyclic native Agent ancestry')
      seen.add(owner)
      project = await this.selectedProjectForAgent(owner, signal)
      if (project) break
      const parent: typeof caller.session.header.parentSession = owner.session.header.parentSession
      owner = parent === undefined ? undefined : owner.ctx.agents.get(parent)
    }
    if (!owner || !project) throw new Error('No selected Design Project in native Agent ancestry')
    const selectedOwner = owner, selected = project, revision = this.selectionForAgent(owner)?.revision
    const check = () => { signal?.throwIfAborted(); this.assertProjectSelection(selectedOwner, selected.projectId, revision) }
    check()
    const result = await readDesignGit({
      projectId: selected.projectId, git: new GitVersioning(this.spawnAdapter(), selected.root),
      status: async readSignal => {
        check()
        const status = await this.projects.status(selected.projectId, readSignal)
        return { head: status.lastCheckpoint, porcelain: status.porcelain }
      },
    }, args, signal)
    check()
    await this.projects.require(selected.projectId, signal)
    check()
    return result
  }

  /** Read one stable provider-neutral KAG retrieval snapshot for any review loop. */
  async queryStoredKnowledge(caller: Agent, args: KnowledgeReadArguments, signal?: AbortSignal) {
    const child = caller.session.header.parentSession !== undefined
    if (child && (!args.project || !args.checkpoint || !args.revision)) throw new Error('Knowledge child query requires exact project, checkpoint and revision pins')
    if ((args.offset ?? 0) > 0 && !args.revision) throw new Error('Knowledge continuation requires a pinned revision')
    let owner: Agent | undefined = caller
    const seen = new Set<Agent>()
    while (owner) {
      signal?.throwIfAborted()
      if (seen.has(owner)) throw new Error('Cyclic native Agent ancestry')
      seen.add(owner)
      if (await this.selectedProjectForAgent(owner, signal)) break
      const parent: typeof caller.session.header.parentSession = owner.session.header.parentSession
      owner = parent === undefined ? undefined : owner.ctx.agents.get(parent)
    }
    if (!owner) throw new Error('No selected Design Project in native Agent ancestry')
    const selectedOwner = owner
    return this.withSelectedKnowledge(selectedOwner, async (service, project, checkpoint) => {
      signal?.throwIfAborted()
      if (args.project !== undefined && args.project !== project.projectId) throw new Error('Knowledge query project no longer matches native binding')
      const requestedCheckpoint = args.checkpoint ?? checkpoint
      let sourceCheckpoint = requestedCheckpoint
      if (requestedCheckpoint !== checkpoint) {
        const publication = await readDesignKnowledgePublication(this.requireKnowledgeRuntime().semantic?.publicationCache?.(project.projectId))
        if (!publication || args.revision !== publication.revision) {
          throw new Error('Knowledge query checkpoint pins no longer match the stable publication')
        }
        if (publication.checkpoint !== requestedCheckpoint) {
          const store = await this.designFilesForProject(selectedOwner, project.projectId, nodeFs, signal)
          if (!await this.knowledgeSourceMatches(store, publication.checkpoint, requestedCheckpoint, signal)) {
            throw new Error('Knowledge query checkpoint pins no longer match the stable publication Design evidence')
          }
        }
        sourceCheckpoint = publication.checkpoint
      }
      const read = await readAdvisoryDesignKnowledge({ project: project.projectId, checkpoint: requestedCheckpoint }, service, args.limit ?? this.advisoryKnowledgeLimit,
        knowledgeQueryFilters(args),
        args.revision === undefined ? undefined : DesignKnowledgeRevision(args.revision), sourceCheckpoint)
      signal?.throwIfAborted()
      this.assertProjectSelection(selectedOwner, project.projectId)
      const current = await this.projects.status(project.projectId)
      signal?.throwIfAborted()
      this.assertProjectSelection(selectedOwner, project.projectId)
      if (current.lastCheckpoint !== checkpoint) throw new Error('Design checkpoint changed during Knowledge query')
      return knowledgeReadResult(project.projectId, requestedCheckpoint, read.graph, sourceCheckpoint === requestedCheckpoint ? {} : {
        sourceCheckpoint, sourceEquivalence: ADVISORY_KNOWLEDGE_SOURCE_EQUIVALENCE,
      })
    })
  }

  /** Read the published graph for the target already admitted by the review scheduler. */
  async advisoryDesignKnowledge(agent: Agent, target: AdvisoryKnowledgeSelection, signal?: AbortSignal): Promise<AdvisoryDesignKnowledge | undefined> {
    signal?.throwIfAborted()
    const selection = this.selectionForAgent(agent)
    if (selection === undefined || selection.projectId !== target.project) return undefined
    const project = await this.projects.require(target.project, signal)
    this.assertProjectSelection(agent, project.projectId)
    const runtime = this.requireKnowledgeRuntime()
    const publication = await readDesignKnowledgePublication(runtime.semantic?.publicationCache?.(project.projectId))
    if (!publication) return undefined
    // Equal pins need no Git evidence comparison. A derived-only publication
    // can be reused only after proving its committed Design evidence is equal.
    if (publication.checkpoint !== target.checkpoint) {
      const store = await this.designFilesForProject(agent, project.projectId, nodeFs, signal)
      if (!await this.knowledgeSourceMatches(store, publication.checkpoint, target.checkpoint, signal)) return undefined
    }
    signal?.throwIfAborted()
    const knowledge = await readAdvisoryDesignKnowledge(target, runtime.service,
      this.advisoryKnowledgeLimit, {}, publication.revision, publication.checkpoint)
    signal?.throwIfAborted()
    this.assertProjectSelection(agent, project.projectId)
    // Revalidate provider/root/Kit identity, not mutable HEAD or journal state.
    // The scheduler owns review revision validity and cancellation.
    const currentProject = await this.projects.require(target.project, signal)
    if (!isDeepStrictEqual(currentProject, project)) return undefined
    this.assertProjectSelection(agent, project.projectId)
    return knowledge
  }

  /** Publication ancestry remains auditable; equivalence never rewrites its original Git pin. */
  private async knowledgeSourceMatches(store: DesignFilesStore, publication: string, head: string, signal?: AbortSignal): Promise<boolean> {
    if (publication === head) return true
    try {
      return await store.sameDesignEvidenceAt(publication, head, signal)
    } catch {
      signal?.throwIfAborted()
      // Missing historical objects cannot prove that two Git commits carry
      // identical source. Keep the publication stale in that case.
      return false
    }
  }

  /**
   * Cheap pure sampling of the derived Knowledge state for the selected
   * project, safe at activation and after every save settlement. Reads the
   * durable publication/failure pointers and live-job presence only; it never
   * schedules maintenance, starts indexing, or mutates any store.
   * @param agent - Agent whose current selection scopes the sample.
   * @returns the shared honest snapshot, or undefined without a selection or runtime.
   */
  async knowledgeStatusSnapshot(agent: Agent, signal?: AbortSignal): Promise<DesignKnowledgeStatusSnapshot | undefined> {
    const selection = this.selectionForAgent(agent)
    if (selection === undefined) return undefined
    const registration = this.knowledgeRuntime
    if (registration === undefined || registration.disposing) return undefined
    const projectId = selection.projectId
    const status = await this.projects.status(projectId, signal)
    this.assertProjectSelection(agent, projectId)
    const semantic = registration.runtime.semantic
    const cache = semantic?.publicationCache?.(projectId)
    const publication = await readDesignKnowledgePublication(cache)
    const publicationMatchesHead = publication !== undefined && status.lastCheckpoint !== undefined && publication.checkpoint !== status.lastCheckpoint
      ? await this.knowledgeSourceMatches(await this.designFilesForProject(agent, projectId, nodeFs, signal), publication.checkpoint, status.lastCheckpoint, signal)
      : false
    signal?.throwIfAborted()
    const target = this.knowledgeMaintenanceTarget(agent, projectId)
    const memoryFailure = this.knowledgeIndexFailures.get(projectId)
    const indexFailure = memoryFailure !== undefined && (target === undefined || memoryFailure.target === target)
      ? memoryFailure
      : undefined
    let failure = indexFailure
    if (failure === undefined) {
      const durable = await readDesignKnowledgeFailure(cache)
      if (durable !== undefined && target !== undefined && durable.target === target) {
        failure = { target: durable.target, message: durable.message }
      }
    }
    const entry = this.knowledgeMaintenance.get(projectId)
    const indexerState = this.knowledgeIndexer.state(projectId)
    const liveJob = entry !== undefined
      ? (entry.running ? 'running' as const : 'queued' as const)
      : indexerState === 'indexing' ? 'running' as const : 'none' as const
    const phase = this.knowledgeIndexPhase(projectId)
    const restoreFailure = this.knowledgeRestoreFailures.get(agent)
    const providerRecovery = registration.runtime.recoveryStatus?.(projectId)
    // Opening the store may report ready before restoring the project archive
    // fails. Keep that current failure visible unless recovery is still active.
    const recovery = cache === undefined && restoreFailure?.projectId === projectId
      && providerRecovery?.state !== 'rebuilding'
      ? { state: 'error' as const, message: restoreFailure.message }
      : providerRecovery
    const derived = deriveDesignKnowledgeStatus({
      project: projectId,
      ...(status.lastCheckpoint === undefined ? {} : { head: status.lastCheckpoint }),
      ...(publication === undefined ? {} : { publication }),
      publicationMatchesHead,
      liveJob,
      ...(liveJob === 'running' && (phase === 'projection' || phase === 'semantic' || phase === 'publication') ? { phase } : {}),
      ...(failure === undefined ? {} : { indexFailure: failure }),
      ...(recovery === undefined ? {} : { recovery }),
      semanticEnabled: semantic?.enabled ?? semantic !== undefined,
    })
    // An unopened provider is a lifecycle availability state, not evidence
    // that the user disabled semantic computation. Keep sampling pure.
    return semantic?.publicationCache && cache === undefined && recovery === undefined
      && failure === undefined && liveJob === 'none'
      ? Object.freeze({ ...derived, state: 'unavailable' as const })
      : derived
  }

  /**
   * Derive per-profile GRA review freshness from durable journal facts plus
   * the real scheduler loop phases. Pure read; never triggers a review.
   * @param agent - Agent whose conversation journal scopes the derivation.
   * @returns frozen per-profile statuses, empty without an advisory runtime.
   */
  async reviewStatuses(agent: Agent): Promise<readonly DesignReviewProfileStatusSnapshot[]> {
    const runtime = this.advisoryRuntimeStatus(agent)
    if (!runtime.available || runtime.profiles.length === 0) return Object.freeze([])
    if (this.selectionForAgent(agent) === undefined) return Object.freeze([])
    const journal = await this.readDesignJournal(agent)
    return deriveReviewStatuses(journal.snapshot, runtime.profiles, runtime.profileStatus)
  }

  /**
   * Agent-initiated bounded KAG maintenance for the current generation.
   * Explicit recovery is never blocked by the one-automatic-attempt gate, but
   * it always reuses the same single-flight entry, latest-wins coalescing, and
   * retry fencing; the runtime never loops or retries on its own afterwards.
   * @param agent - Agent whose current selection scopes the request.
   * @returns the structured accepted/noop/rejected outcome with the exact target.
   */
  async requestKnowledgeMaintenance(agent: Agent, signal?: AbortSignal): Promise<DesignOrchestrationResult> {
    const selection = this.selectionForAgent(agent)
    if (selection === undefined) return { outcome: 'rejected', reason: 'no-project' }
    const registration = this.knowledgeRuntime
    if (registration === undefined || registration.disposing) return { outcome: 'rejected', reason: 'no-knowledge-runtime' }
    const projectId = selection.projectId
    const status = await this.knowledgeStatusSnapshot(agent, signal)
    if (status === undefined) return { outcome: 'rejected', reason: 'no-knowledge-runtime' }
    // The generation identity of THIS request (the exact single-flight key),
    // never the previously published revision; the last publication is named
    // separately so a due request can never misreport its target.
    const generation = this.knowledgeMaintenanceTarget(agent, projectId)
    const target = {
      ...(status.head === undefined ? {} : { checkpoint: status.head }),
      ...(generation === undefined ? {} : { generation }),
      ...(status.latestComplete === undefined ? {} : { lastPublishedRevision: status.latestComplete.revision }),
    }
    // Every accepted path reports the REAL single-flight admission decision:
    // a concurrent pass that this request merged into is disclosed as merged,
    // and a gate that admitted nothing turns the result into an honest
    // rejection instead of a phantom acceptance.
    const admit = (reason: string, mergedReason: string): DesignOrchestrationResult => {
      const decision = this.scheduleKnowledgeMaintenance(agent, projectId, 'retry')
      if (decision === 'skipped') return { outcome: 'rejected', reason: 'not-schedulable', target }
      return { outcome: 'accepted', reason: decision === 'merged' ? mergedReason : reason, target }
    }
    switch (status.state) {
      case 'current':
        return { outcome: 'noop', reason: 'current', target }
      case 'queued':
      case 'running':
        return { outcome: 'noop', reason: `already-${status.state}`, target }
      case 'unavailable':
        return { outcome: 'rejected', reason: 'recovery-in-progress', target }
      case 'disabled':
        return { outcome: 'rejected', reason: 'knowledge-runtime-incomplete', target }
      case 'unknown':
        return { outcome: 'rejected', reason: 'no-published-checkpoint', target }
      case 'failed': {
        // A derived-store recovery error keeps its explicit retry gate; a
        // failed generation is re-admitted exactly once per explicit request.
        if (status.recovery?.state === 'error') {
          if (registration.runtime.retryRecovery === undefined) return { outcome: 'rejected', reason: 'recovery-error-not-retryable', target }
          registration.runtime.retryRecovery(projectId)
          return admit('recovery-retry-accepted', 'recovery-retry-merged-into-active-pass')
        }
        return admit('failed-generation-retry-accepted', 'merged-into-active-pass')
      }
      default:
        return admit('maintenance-accepted', 'merged-into-active-pass')
    }
  }

  /**
   * Agent-initiated GRA trigger: start only the profiles that are due for the
   * latest settled Design revision, through the scheduler's existing
   * idempotent latest-wins machinery. Profiles already scheduled or running
   * for that revision are reported as active rather than duplicated.
   * @param agent - Agent whose conversation and selection scope the request.
   * @param profiles - optional subset of configured profile ids; omitted means every due profile.
   * @returns the structured outcome with triggered profiles and the exact revision target.
   */
  async readReviewPolicy(agent: Agent, signal?: AbortSignal): Promise<DesignReviewPolicy> {
    const project = await this.projectForAgent(agent, signal)
    return readDesignReviewPolicy(join(designProjectRecordsRoot(project.root), 'reviews'), project.root)
  }

  /** Persist only commit/revision references; historical facts remain in DesignJournal/Git. */
  async reviewPublicationQueue<T>(agent: Agent, profile: string, operation: (queue: DesignReviewPublicationQueue<{ checkpoint: string; journal: DesignJournalRead }>) => T): Promise<T> {
    return this.withJournal(agent, async (root, conversation, project) => {
      this.assertProjectSelection(agent,project.projectId)
      const identity=createHash('sha256').update(`${conversation}\0${profile}`).digest('hex')
      const file=join(project.stateRoot, `gra-queue-${identity}.json`)
      const journal=await this.journals.read(root,conversation)
      let queue: DesignReviewPublicationQueue<{ checkpoint: string; journal: DesignJournalRead }>
      try {
        const state=JSON.parse(await readFile(file,'utf8'))
        queue=DesignReviewPublicationQueue.restore(state,value=>{
          const target=value as {checkpoint?: unknown; journalRevision?: unknown}
          if(typeof target.checkpoint!=='string' || !Number.isSafeInteger(target.journalRevision)
            || (target.journalRevision as number)<1)throw new Error('Invalid queued GRA publication')
          const revision=target.journalRevision as number
          const records=journal.records.filter(record=>record.revision<=revision)
          const snapshot=foldDesignJournal(records)
          if(snapshot.latestDesignChange?.journalRevision!==revision || snapshot.latestDesignChange.commit!==target.checkpoint)throw new Error('Queued GRA publication no longer matches its journal fact')
          return {checkpoint:target.checkpoint,journal:{revision,records,snapshot}}
        })
      } catch(error) {
        if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
        queue=new DesignReviewPublicationQueue()
      }
      const result=operation(queue)
      const state=queue.snapshot() as {pending: {target: {checkpoint: string; journal: DesignJournalRead}; mergeable: boolean}[]}
      for(const entry of state.pending) {
        const revision=entry.target.journal.snapshot.latestDesignChange?.journalRevision
        const fact=journal.records.find(record=>record.revision===revision)
        if(fact?.type!=='design/changed'||fact.data.commit!==entry.target.checkpoint)throw new Error('GRA queue admission must match this project conversation publication')
      }
      const persisted={...state,pending:state.pending.map(entry=>({mergeable:entry.mergeable,target:{
        checkpoint:entry.target.checkpoint,journalRevision:entry.target.journal.snapshot.latestDesignChange!.journalRevision,
      }}))}
      const temporary=`${file}.${randomUUID()}.tmp`
      await mkdir(project.stateRoot,{recursive:true})
      this.assertProjectSelection(agent,project.projectId)
      try {await writeFile(temporary,JSON.stringify(persisted),'utf8');await rename(temporary,file)}
      finally {await rm(temporary,{force:true})}
      return result
    })
  }

  /** Immutable source capability; no worktree reads or project mutation authority. */
  async advisoryEvidence(agent: Agent, commit: string, signal: AbortSignal,
    options?: { readonly expectedProjectId: DesignProjectId }) {
    if (options) this.assertProjectSelection(agent, options.expectedProjectId)
    const project = await this.projectForAgent(agent, signal)
    if (options && project.projectId !== options.expectedProjectId) throw new Error('design clarity: selected project changed before evidence capture')
    const evidence = await createAdvisoryEvidence({
      git: new GitVersioning(this.spawnAdapter(), project.root), commit, projectId: String(project.projectId), signal,
      resolveKit: pin => this.resolveProjectKit(pin), resolveBundle: pin => this.resolveBundle(pin),
    })
    if (options) this.assertProjectSelection(agent, options.expectedProjectId)
    return evidence
  }

  /** User settings entry; automatic reviewers cannot change their own policy. */
  async updateReviewPolicy(agent: Agent, value: unknown, signal?: AbortSignal): Promise<DesignReviewPolicy> {
    const project = await this.projectForAgent(agent, signal)
    signal?.throwIfAborted()
    const policy = await writeDesignReviewPolicy(join(designProjectRecordsRoot(project.root), 'reviews'), value, project.root)
    await commitDesignProjectRecords({ projectRoot: project.root, paths: ['design_records/reviews/gra-policy.json'],
      message: 'Record project review settings', spawn: this.spawnAdapter() })
    await this.advisoryRuntime?.provider.configureReviews?.(agent, policy)
    this.notifyWorkspaceChange({ kind: 'review-policy-changed', agent, policy })
    return policy
  }

  async requestReviews(agent: Agent, profiles?: readonly string[], signal?: AbortSignal): Promise<DesignOrchestrationResult> {
    const runtime = this.advisoryRuntimeStatus(agent)
    if (!runtime.available) return { outcome: 'rejected', reason: 'advisory-runtime-unavailable' }
    if (this.selectionForAgent(agent) === undefined) return { outcome: 'rejected', reason: 'no-project' }
    if ((await this.readReviewPolicy(agent, signal)).mode === 'off') return { outcome: 'rejected', reason: 'gra-disabled-by-user' }
    const configured = runtime.profiles
    if (profiles !== undefined) {
      const unknown = profiles.filter((profile) => !configured.includes(profile))
      if (unknown.length > 0) return { outcome: 'rejected', reason: `unknown-profiles:${unknown.join(',')}` }
    }
    const requested = profiles ?? configured
    if (requested.length === 0) return { outcome: 'noop', reason: 'no-configured-profiles' }
    const journal = await this.readDesignJournal(agent)
    signal?.throwIfAborted()
    const change = journal.snapshot.latestDesignChange
    if (change === undefined) return { outcome: 'rejected', reason: 'no-design-change' }
    if (change.commit === undefined) return { outcome: 'rejected', reason: 'no-published-commit' }
    const statuses = deriveReviewStatuses(journal.snapshot, requested, runtime.profileStatus)
    const coversCurrent = (profile: string): boolean => {
      const loop = runtime.profileStatus?.find((entry) => entry.profile === profile)
      return loop !== undefined && (loop.phase === 'scheduled' || loop.phase === 'running')
        && (loop.latestRevision ?? 0) >= change.journalRevision
    }
    const due = statuses
      .filter((entry) => entry.review === 'due' || entry.review === 'never-reviewed')
      .map((entry) => entry.profile)
      .filter((profile) => !coversCurrent(profile))
    const target = { revision: change.journalRevision, checkpoint: change.commit }
    if (due.length === 0) {
      const anyActive = statuses.some((entry) => coversCurrent(entry.profile))
      return { outcome: 'noop', reason: anyActive ? 'already-active' : 'none-due', target }
    }
    const provider = this.advisoryRuntime?.provider
    if (provider?.requestReviews === undefined) return { outcome: 'rejected', reason: 'host-adapter-missing-trigger' }
    provider.requestReviews(agent, change.journalRevision, due)
    return { outcome: 'accepted', reason: 'reviews-triggered', target, profiles: Object.freeze([...due]) }
  }

  /**
   * Re-examine the latest settled Design revision at an explicit user's
   * request, even if these profiles already completed on that revision.
   * The caller must retain `requestId` when retrying the same user request;
   * a later distinct user request uses a new id. This is intentionally a
   * separate entry from the Agent's due-only automatic judgement.
   */
  async requestManualReviews(
    agent: Agent,
    requestId: string,
    profiles?: readonly string[],
    signal?: AbortSignal,
  ): Promise<DesignOrchestrationResult> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(requestId)) {
      return { outcome: 'rejected', reason: 'invalid-request-id' }
    }
    const runtime = this.advisoryRuntimeStatus(agent)
    if (!runtime.available) return { outcome: 'rejected', reason: 'advisory-runtime-unavailable' }
    const selection = this.selectionForAgent(agent)
    if (selection === undefined) return { outcome: 'rejected', reason: 'no-project' }
    const configured = runtime.profiles
    const unknown = profiles?.filter((profile) => !configured.includes(profile)) ?? []
    if (unknown.length > 0) return { outcome: 'rejected', reason: `unknown-profiles:${unknown.join(',')}` }
    const requested = [...new Set(profiles ?? configured)]
    if (requested.length === 0) return { outcome: 'noop', reason: 'no-configured-profiles' }
    const journal = await this.readDesignJournal(agent)
    signal?.throwIfAborted()
    if (this.selectionForAgent(agent)?.projectId !== selection.projectId) {
      return { outcome: 'rejected', reason: 'project-changed' }
    }
    const kit = this.kitForAgent(agent)
    if (kit === undefined) return { outcome: 'rejected', reason: 'no-active-kit' }
    const change = journal.snapshot.latestDesignChange
    if (change === undefined) return { outcome: 'rejected', reason: 'no-design-change' }
    if (change.commit === undefined) return { outcome: 'rejected', reason: 'no-published-commit' }
    const target = { revision: change.journalRevision, checkpoint: change.commit }
    const prior = journal.records.filter((record) => record.type === 'design/advisory-review-completed'
      && record.data.attemptId === requestId)
    if (prior.some((record) => record.type === 'design/advisory-review-completed'
      && (record.data.designRevision !== target.revision || record.data.commit !== target.checkpoint))) {
      return { outcome: 'rejected', reason: 'request-id-target-mismatch', target }
    }
    const completed = new Set(prior.map((record) => record.type === 'design/advisory-review-completed' ? record.data.profile : ''))
    const repairs: import('./design-journal.ts').DesignJournalAdvisoryReviewCompletion[] = []
    // A crash or journal append failure can fall between advisory publication
    // and its completion fact. Recover the exact already-published attempt;
    // never ask the model to regenerate a different advisory under that ID.
    for (const profile of requested) {
      if (completed.has(profile)) continue
      if (this.selectionForAgent(agent)?.projectId !== selection.projectId
        || this.kitForAgent(agent)?.name !== kit.name || this.kitForAgent(agent)?.version !== kit.version) {
        return { outcome: 'rejected', reason: 'project-or-kit-changed', target }
      }
      const identity = officialAdvisoryAttemptIds(profile, target.revision, requestId)
      const existing = journal.snapshot.advisories?.find((entry) => entry.advisory.id === identity.advisoryId)?.advisory
      if (existing === undefined) continue // Empty findings have no publication and remain retryable.
      const pin = (source: string) => existing.inputs.find((entry) => entry.source === source)?.revision
      const kitPin = existing.inputs.find((entry) => entry.source.startsWith('kit:'))
      const sourceCheckpoint = pin('design-knowledge-source')
      const fallbackReason = pin('knowledge-fallback')
      if (existing.profile !== profile || pin('design-revision') !== String(target.revision)
        || pin('design-commit') !== target.checkpoint
        || pin('design-project') !== String(selection.projectId)
        || kitPin?.source !== `kit:${kit.name}` || kitPin.revision !== kit.version
        || (sourceCheckpoint === undefined && fallbackReason === undefined)) {
        return { outcome: 'rejected', reason: 'published-attempt-pin-mismatch', target }
      }
      repairs.push({
        profile,
        attemptId: requestId,
        designRevision: target.revision,
        commit: target.checkpoint,
        itemCount: existing.items.length,
        knowledgeUsed: sourceCheckpoint !== undefined,
        ...(sourceCheckpoint === undefined ? { fallbackReason: fallbackReason! } : { knowledgeSourceCheckpoint: sourceCheckpoint }),
        kit: kitPin.source.slice(4),
        kitVersion: kitPin.revision as DesignKitVersion,
        vocabularyRevision: pin('relation-vocabulary') ?? 'legacy-unavailable',
      })
    }
    // Validate every published attempt before appending any completion fact.
    // A malformed later profile must not partially repair an earlier one.
    for (const repair of repairs) {
      await this.recordAdvisoryReviewCompletion(agent, repair)
      completed.add(repair.profile)
    }
    const remaining = requested.filter((profile) => !completed.has(profile))
    if (remaining.length === 0) return { outcome: 'noop', reason: 'request-already-completed', target }
    if (this.selectionForAgent(agent)?.projectId !== selection.projectId
      || this.kitForAgent(agent)?.name !== kit.name || this.kitForAgent(agent)?.version !== kit.version) {
      return { outcome: 'rejected', reason: 'project-or-kit-changed', target }
    }
    const provider = this.advisoryRuntime?.provider
    if (provider?.requestManualReviews === undefined) return { outcome: 'rejected', reason: 'host-adapter-missing-manual-trigger', target }
    const scheduled = provider.requestManualReviews(agent, target.revision, remaining, requestId)
    if (scheduled.length === 0) return { outcome: 'noop', reason: 'already-active-or-requested', target }
    return { outcome: 'accepted', reason: 'manual-reviews-triggered', target, profiles: Object.freeze([...scheduled]) }
  }

  /**
   * Inject the compact KAG/GRA snapshot as one non-waking plugin notice: the
   * model reads it at its next natural boundary and judges whether to act.
   * Identical consecutive snapshots are deduplicated so repeated lifecycle
   * events never become a token storm. Best-effort: a sampling or injection
   * failure never breaks the originating lifecycle event.
   */
  private async injectKnowledgeOrchestrationSnapshot(agent: Agent): Promise<void> {
    try {
      const selectionAtSample = this.selectionForAgent(agent)?.projectId
      if (selectionAtSample === undefined) return
      const knowledge = await this.knowledgeStatusSnapshot(agent)
      if (knowledge === undefined) return
      const reviews = await this.reviewStatuses(agent)
      const reviewPolicy = await this.readReviewPolicy(agent)
      // Identity guard: a selection that changed while sampling makes this
      // snapshot belong to another project. Drop it; the selection-changed
      // event injects the fresh project's own snapshot. The reminder text
      // carries the project id, so dedupe can never suppress a real switch
      // between two projects with otherwise identical state.
      if (this.selectionForAgent(agent)?.projectId !== selectionAtSample) return
      const text = `${renderDesignKnowledgeStatusReminder(knowledge, reviews)}\nProject GRA policy: ${JSON.stringify(reviewPolicy)}. Auto combines useful Agent initiative with publication admission; continuous uses the online periodic scheduler even when Design Files are unchanged. Do not mechanically launch another review after every publication. Use explicit tools for useful initiative in auto or the user's manual check. Off forbids autonomous GRA, not explicit human rechecks or Clarity. Review the existing suggestion dispositions and avoid repeating pending/rejected issues without new evidence.`
      if (this.knowledgeStatusInjections.get(agent) === text) return
      this.knowledgeStatusInjections.set(agent, text)
      agent.inject(createYugooDesignMessage({
        content: [{ type: 'text', text }],
        notice: `design knowledge status: ${knowledge.state}`,
      }))
    } catch { /* Status injection assists judgement; it must never break a lifecycle event. */ }
  }

  /** Optional derived semantic index; never schedules or publishes GRA work. */
  async semanticDesignGraph(projectId: string, graph: import('./design-graph.ts').DesignGraph) {
    return this.knowledgeRuntime?.runtime.semantic?.read(projectId, graph)
  }

  /**
   * Register the host adapter that runs the built-in advisory profiles.
   * @param provider - process-local operational status provider.
   * @returns an idempotent disposer for the exact registration.
   */
  registerAdvisoryRuntime(provider: DesignAdvisoryRuntimeStatusProvider<Agent>): () => void {
    if (this.advisoryRuntime !== undefined) throw new Error('design: duplicate advisory runtime')
    const owner = Symbol('design-advisory-runtime')
    this.advisoryRuntime = { owner, provider }
    return () => {
      if (this.advisoryRuntime?.owner === owner) this.advisoryRuntime = undefined
    }
  }

  /** One Host lifecycle adapter, not another score or scheduling authority. */
  registerClarityRuntime(provider: DesignClarityRuntime<Agent>): () => void {
    if (this.clarityRuntime !== undefined) throw new Error('design: duplicate clarity runtime')
    const owner = Symbol('design-clarity-runtime')
    this.clarityRuntime = { owner, provider }
    return () => { if (this.clarityRuntime?.owner === owner) this.clarityRuntime = undefined }
  }

  /** Save calls this only after its publication and handoff mutation settled. */
  recordSettledPanelSave(agent: Agent, receipt: SettledDesignPanelSave): void {
    this.clarityRuntime?.provider.recordPanelSave(agent, receipt)
  }

  /** Passive compatibility receipt validation; starts no model execution. */
  admitSavedAssessment(agent: Agent, request: SavedDesignAssessmentRequest) {
    return this.clarityRuntime?.provider.admitPanelSave(agent, request) ?? { status: 'unavailable' as const }
  }

  clarityActivity(agent: Agent, projectId: string) {
    return this.clarityRuntime?.provider.activity(agent, projectId)
  }

  /** Detached analysis must reacquire its own mutation lane at promotion. */
  outsideProjectMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.projectMutationScope.exit(() => this.workspaceReadScope.exit(() => Promise.resolve().then(operation)))
  }

  /**
   * Observe process-local workspace selection and Design Files changes.
   * Durable state remains in the binding store, project repository, and
   * DesignJournal; observers only schedule host work and may be recreated.
   * @param listener - host-adapter callback.
   * @returns an idempotent disposer.
   */
  registerWorkspaceChangeListener(listener: DesignWorkspaceChangeListener): () => void {
    this.workspaceChangeListeners.add(listener)
    return () => { this.workspaceChangeListeners.delete(listener) }
  }

  private notifyWorkspaceChange(change: DesignWorkspaceChange): void {
    if(change.kind==='design-changed' && change.projectId!==undefined
      && change.projectId!==this.selectionForAgent(change.agent)?.projectId)return
    // Only a successful Design publication triggers derived maintenance.
    // Selection, advisory publication and reads must not create update loops.
    // The existing project single-flight retains newer generations and merges
    // duplicate observers without cancelling a useful running generation.
    if (change.kind === 'design-changed') {
      const projectId = this.selectionForAgent(change.agent)?.projectId
      if (projectId !== undefined) this.scheduleKnowledgeMaintenance(change.agent, projectId, 'changed')
    }
    if (change.kind === 'design-changed' || change.kind === 'selection-changed' || change.kind === 'review-policy-changed') {
      void this.injectKnowledgeOrchestrationSnapshot(change.agent)
    }
    for (const listener of this.workspaceChangeListeners) listener(change)
  }

  /**
   * Admit one bounded maintenance attempt through the project single-flight.
   * The return value is the REAL admission decision, so Agent-facing results
   * can never claim an acceptance that a concurrency gate silently dropped:
   * `scheduled` created a fresh pass, `merged` joined/coalesced an active one,
   * `skipped` admitted nothing (runtime gone, no target, or an automatic
   * attempt gate that explicit requests do not use).
   */
  private scheduleKnowledgeMaintenance(agent: Agent, projectId: DesignProjectId, reason: KnowledgeMaintenanceReason = 'ensure'): 'scheduled' | 'merged' | 'skipped' {
    if (this.knowledgeRuntime === undefined || this.knowledgeRuntime.disposing) return 'skipped'
    const target = this.knowledgeMaintenanceTarget(agent, projectId)
    if (target === undefined) return 'skipped'
    let entry = this.knowledgeMaintenance.get(projectId)
    if (entry !== undefined) {
      // Opening or restoring another conversation is only another reader of the
      // same project generation. It must not enqueue the same expensive file
      // projection again. A real Design change or explicit retry marks one
      // latest-wins rerun, regardless of how many Agents observe that event.
      if (reason === 'retry' || reason === 'changed' && entry.target !== target) {
        entry.target = target
        entry.rerun = true
      }
      entry.agent = agent
      return 'merged'
    }
    // One generation gets one automatic attempt. In particular, restoring a
    // second conversation must not turn a failed embedding/model attempt into
    // an unbounded retry loop. A new target (Design Files / Kit / ontology /
    // model identity) is admitted automatically; the same failed target only
    // runs again through the explicit recovery command.
    const previousTarget = this.knowledgeMaintenanceTargets.get(projectId)
    if (reason === 'ensure' && previousTarget !== undefined) return 'skipped'
    if (reason !== 'retry' && previousTarget === target) return 'skipped'
    entry = { agent, target, running: false, rerun: true }
    this.knowledgeMaintenanceTargets.set(projectId, target)
    this.knowledgeMaintenance.set(projectId, entry)
    // `queued` means accepted but not yet executing; the real pipeline reports
    // `indexing` and its phases itself, so even a synchronous completion never
    // leaves a transient fake running state behind. Admitting a new attempt
    // clears the prior generation's failure evidence.
    this.knowledgeIndexStates.set(projectId, 'queued')
    this.knowledgeIndexPhases.delete(projectId)
    this.knowledgeIndexFailures.delete(projectId)
    void clearDesignKnowledgeFailure(this.knowledgeRuntime?.runtime?.semantic?.publicationCache?.(projectId))
    queueMicrotask(() => {
      void (async () => {
        entry.running = true
        try {
          while (entry.rerun) {
            entry.rerun = false
            this.knowledgeMaintenanceTargets.set(projectId, entry.target)
            this.knowledgeIndexer.retry(projectId)
            try {
              const result = await this.refreshPublishedKnowledge(entry.agent, undefined, 'background')
              if (result.semantic === 'indexing') {
                // Stay the single-flight owner while the detached embedding job
                // settles, so its terminal outcome is recorded honestly and a
                // concurrent duplicate never starts a second pass.
                await this.knowledgeIndexer.settledState?.(projectId)
              }
              this.knowledgeIndexFailures.delete(projectId)
              await clearDesignKnowledgeFailure(this.knowledgeRuntime?.runtime?.semantic?.publicationCache?.(projectId))
            } catch (error) {
              // A superseded or cancelled attempt is not a failure of the
              // current generation; only a real error becomes durable evidence.
              if ((error as { name?: string } | undefined)?.name !== 'AbortError') {
                const message = (error instanceof Error ? error.message : String(error)).slice(0, 1_000)
                this.knowledgeIndexFailures.set(projectId, { target: entry.target, message })
                void writeDesignKnowledgeFailure(this.knowledgeRuntime?.runtime?.semantic?.publicationCache?.(projectId), entry.target, message)
              }
              // A newer checkpoint observed while the failed generation was
              // running still gets exactly one attempt. Otherwise retain the
              // explicit error state until a later lifecycle boundary.
              if (!entry.rerun) break
            }
          }
        } finally {
          entry.running = false
          if (this.knowledgeMaintenance.get(projectId) === entry) this.knowledgeMaintenance.delete(projectId)
          // Terminal honesty without polling: the owning conversation learns
          // ready/failed at the next natural boundary through the same compact
          // snapshot the Agent orchestrates from.
          void this.injectKnowledgeOrchestrationSnapshot(entry.agent)
        }
      })()
    })
    return 'scheduled'
  }


  /** A project generation is independent of how many Agent sessions read it. */
  private knowledgeMaintenanceTarget(agent: Agent, projectId: DesignProjectId): string | undefined {
    const active = this.activeWorkspaces.get(agent)
    if (active === undefined || active.project.projectId !== projectId) return undefined
    const kit = this.kitForAgent(agent)
    const semantic = this.knowledgeRuntime?.runtime.semantic
    return JSON.stringify([
      active.checkpoint,
      active.project.kit?.name ?? null,
      active.project.kit?.version ?? null,
      kit?.ontologyContract?.revision ?? null,
      designKnowledgeSourcePolicyIdentity(Object.fromEntries((kit?.skills ?? [])
        .filter(skill => typeof skill.metadata?.schemaYaml === 'string')
        .map(skill => [`${skill.name}/${skill.name}.json`, parseSchemaYaml(skill.metadata?.schemaYaml as string)]))),
      semantic?.identity ?? null,
    ])
  }

  /** Record transient Producer/Worker activity without writing into Session history. */
  recordExecutionAttempt(agent: Agent, payload: DesignExecutionAttemptPayload): void {
    const observations = this.executionObservations.get(agent) ?? { revision: 0, attempts: [], active: new Map<string, DesignExecutionAttemptObservation>() }
    observations.revision += 1
    const observation = Object.freeze({
      ...payload,
      sequence: observations.revision,
      timestamp: Date.now(),
    })
    observations.attempts.push(observation)
    observations.active ??= new Map()
    if (payload.phase === 'queued' || payload.phase === 'working') observations.active.set(payload.attemptId, observation)
    else observations.active.delete(payload.attemptId)
    if (observations.attempts.length > 500) observations.attempts.shift()
    this.executionObservations.set(agent, observations)
  }

  /** Read transient activity for the selected project in observation order. */
  executionAttemptsFor(agent: Agent, projectId: string): readonly DesignExecutionAttemptObservation[] {
    const observations = this.executionObservations.get(agent)
    if (observations === undefined) return Object.freeze([])
    return Object.freeze(observations.attempts.filter(attempt => attempt.projectId === projectId))
  }

  /** Authorize a native child transcript through the current process's run binding. */
  ownsExecutionRun(agent: Agent, runId: string): boolean {
    return this.executionObservations.get(agent)?.attempts.some(attempt => attempt.runId === runId) ?? false
  }

  /** Return the built-in advisory runtime's current status for one Agent. */
  advisoryRuntimeStatus(agent: Agent): DesignAdvisoryRuntimeStatus {
    return this.advisoryRuntime?.provider.status(agent) ?? UNAVAILABLE_ADVISORY_RUNTIME_STATUS
  }

  /** Resolve one trusted v2 actionSpec against the exact currently pinned Kit. */
  private resolveAdvisoryActions(agent: Agent, advisory: DesignAdvisory): readonly ResolvedDesignAdvisoryAction[] {
    if (advisory.schemaVersion === 1 || advisory.actionSpec.kind === 'none'
      || advisory.actionSpec.kind === 'review-choice') return Object.freeze([])
    const kit = this.kitForAgent(agent)
    if (advisory.actionSpec.kind === 'semantic-capability') {
      if (kit === undefined) return Object.freeze([])
      const skill = resolveSemanticCapability(kit, DesignSemanticCapabilityId(advisory.actionSpec.capability))
      if (skill === undefined) return Object.freeze([])
      return Object.freeze([Object.freeze({
        actionId: `capability:${advisory.actionSpec.capability}`,
        target: Object.freeze({
          kitName: kit.name,
          kitVersion: kit.version,
          skillName: skill.name,
          bundleVersion: skill.version,
          entityRefs: advisory.actionSpec.entityRefs,
        }),
      })])
    }
    if (kit === undefined) {
      throw new Error(`design advisory: accepted Bundle actions require an active exact Kit`)
    }
    return Object.freeze(advisory.actionSpec.targets.map(target => {
      const skill = kit.skills.find(candidate => candidate.name === target.skillName)
      if (skill === undefined) {
        throw new Error(`design advisory: action target ${JSON.stringify(target.skillName)} is not in active Kit ${JSON.stringify(kit.name)} ${JSON.stringify(kit.version)}`)
      }
      return Object.freeze({
        actionId: `bundle:${skill.name}`,
        target: Object.freeze({
          kitName: kit.name,
          kitVersion: kit.version,
          skillName: skill.name,
          bundleVersion: skill.version,
          entityRefs: target.entityRefs,
        }),
      })
    }))
  }

  /**
   * Record one explicit human disposition without applying the advice.
   * Revision mismatch never rejects a decision: it remains a separate
   * revalidation marker in the read model.
   * @param agent - owning Agent and workspace journal scope.
   * @param decision - advisory identity and disposition.
   */
  async decideAdvisory(agent: Agent, decision: DesignAdvisoryDecisionPayload): Promise<SessionDesignAdvisory> {
    return this.withJournal(agent, async (workspace, conversation) => {
      const before = await this.journals.list(workspace, conversation)
      const advisory = before.find(candidate => candidate.advisory.id === decision.advisoryId)?.advisory
      if (advisory === undefined) throw new Error(`design advisory: unknown advisory ${JSON.stringify(decision.advisoryId)}`)
      const actions = decision.decision === 'accepted' ? this.resolveAdvisoryActions(agent, advisory) : Object.freeze([])
      const entries = await this.journals.decide(workspace, conversation, decision, actions)
      const read = await this.journals.read(workspace, conversation)
      this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: read.revision })
      this.injectAdvisoryProjection(agent, entries, read.snapshot.latestDesignChange?.journalRevision)
      const entry = entries.find(candidate => candidate.advisory.id === decision.advisoryId)
      if (entry === undefined) throw new Error(`design advisory: unknown advisory ${JSON.stringify(decision.advisoryId)}`)
      return Object.freeze({
        advisory: entry.advisory,
        status: entry.status,
        publishedAt: entry.publishedAt,
        publishedRevision: entry.publishedRevision,
        stale: deriveAdvisoryStaleness(entry.advisory, this.advisoryCurrency(agent, read.snapshot.latestDesignChange?.journalRevision)),
        ...(entry.selection === undefined ? {} : { selection: entry.selection }),
        ...(entry.acceptanceReceiptId === undefined ? {} : { acceptanceReceiptId: entry.acceptanceReceiptId }),
        ...(entry.actionReceipts === undefined ? {} : { actionReceipts: entry.actionReceipts }),
        ...(entry.executionStatus === undefined ? {} : { executionStatus: entry.executionStatus }),
      })
    })
  }

  /** Inspect advice and candidate hints; this read grants no execution authority. */
  async reviewActionOptions(agent: Agent, advisoryId: string) {
    const binding = this.selectionForAgent(agent)
    return this.withJournal(agent, async (workspace, conversation, project) => {
      const read = await this.journals.read(workspace, conversation)
      const current = this.selectionForAgent(agent)
      if (!binding || current?.projectId !== project.projectId || binding.projectId !== project.projectId || current.revision !== binding.revision) {
        throw new Error('design advisory: selected project changed')
      }
      const entry = read.snapshot.advisories.find(item => item.advisory.id === advisoryId)
      if (!entry || entry.advisory.schemaVersion !== 2 || entry.advisory.actionSpec.kind !== 'review-choice') {
        throw new Error('design advisory: no agentic choice for this advisory')
      }
      const kit = this.kitForAgent(agent)
      if (!kit) throw new Error('design advisory: select a Kit first')
      return { entry, projectId: project.projectId, selectionRevision: binding.revision,
        revision: read.revision, kitName: kit.name, kitVersion: kit.version,
        candidates: kit.skills.map(skill => ({ skillName: skill.name, bundleVersion: skill.version,
          description: skill.description, review_support: reviewSupportOf(skill) })),
        instruction: 'Candidate hints are not a binding. Revalidate current evidence and necessity before selecting. Host actions grant no Design File write authority.' }
    })
  }

  /** Record the main Agent's bounded selection before minting one exact receipt. */
  async selectReviewAction(agent: Agent, request: {
    advisoryId: string; acceptanceReceiptId: string; kind: 'bundle' | 'host-question' | 'host-research' | 'no-action';
    reason: string; revision: number; kitName: string; kitVersion: string; skillName?: string;
    projectId: string; selectionRevision: number;
  }) {
    return this.withJournal(agent, async (workspace, conversation, project) => {
      const requireBinding = () => {
        const current = this.selectionForAgent(agent)
        if (project.projectId !== request.projectId || current?.projectId !== request.projectId || current.revision !== request.selectionRevision) {
          throw new Error('design advisory: selected project changed')
        }
      }
      requireBinding()
      const read = await this.journals.read(workspace, conversation)
      requireBinding()
      const kit = this.kitForAgent(agent)
      if (!kit || kit.name !== request.kitName || kit.version !== request.kitVersion) {
        throw new Error('design advisory: selection context changed; read options and revalidate again')
      }
      const entry = read.snapshot.advisories.find(item => item.advisory.id === request.advisoryId)
      if (!entry || entry.advisory.schemaVersion !== 2 || entry.advisory.actionSpec.kind !== 'review-choice') {
        throw new Error('design advisory: no agentic choice for this advisory')
      }
      const skill = request.kind === 'bundle' ? kit.skills.find(item => item.name === request.skillName) : undefined
      if (request.kind === 'bundle' && !skill) throw new Error('design advisory: selected Bundle is not in the current Kit')
      if (request.kind !== 'bundle' && request.skillName !== undefined) throw new Error('design advisory: host choice cannot carry a Bundle target')
      const selected = await this.journals.selectReviewAction(workspace, conversation, {
        advisoryId: entry.advisory.id, acceptanceReceiptId: request.acceptanceReceiptId,
        kind: request.kind, reason: request.reason,
        expectedJournalRevision: request.revision,
      }, skill ? { actionId: `bundle:${skill.name}`, target: {
        kitName: kit.name, kitVersion: kit.version, skillName: skill.name, bundleVersion: skill.version,
        entityRefs: entry.advisory.actionSpec.entityRefs,
      } } : undefined)
      const after = await this.journals.read(workspace, conversation)
      requireBinding()
      this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: after.revision })
      this.injectAdvisoryProjection(agent, after.snapshot.advisories, after.snapshot.latestDesignChange?.journalRevision)
      return selected
    })
  }

  /** Claim one acceptance receipt before starting its Bundle execution. */
  async claimAdvisoryExecution(agent: Agent, receiptId: string): Promise<{ readonly claimed: boolean; readonly advisoryId: string }> {
    void agent
    void receiptId
    throw new Error('design advisory: acceptance receipts are disposition evidence; run_design_skill requires an exact action receipt')
  }

  /** Persist a claimed acceptance receipt's terminal or retryable execution state. */
  async settleAdvisoryExecution(
    agent: Agent,
    receiptId: string,
    state: Exclude<DesignAdvisoryExecutionState, 'accepted' | 'queued' | 'running'>,
  ): Promise<void> {
    void agent
    void receiptId
    void state
    throw new Error('design advisory: acceptance receipts are disposition evidence and cannot be settled as tool executions')
  }

  /** Validate that a receipt still names the exact active immutable Bundle. */
  private requireAdvisoryActionTarget(
    agent: Agent,
    action: DesignJournalAdvisoryActionEntry,
    request: Pick<DesignAdvisoryActionClaimRequest, 'skillName' | 'bundleVersion'>,
  ): void {
    const kit = this.requireKitForAgent(agent)
    const skill = kit.skills.find(candidate => candidate.name === request.skillName)
    if (kit.name !== action.target.kitName || kit.version !== action.target.kitVersion
      || skill === undefined || skill.name !== action.target.skillName
      || skill.version !== action.target.bundleVersion || skill.version !== request.bundleVersion) {
      throw new Error(`design advisory: action receipt ${JSON.stringify(action.receiptId)} does not authorize the requested exact Bundle`)
    }
  }

  /** Latest durable Producer publication for this exact logical action, if any. */
  private advisoryActionPublication(
    read: DesignJournalRead,
    action: DesignJournalAdvisoryActionEntry,
  ): 'needs-user-input' | 'completed' | undefined {
    if (action.logicalInvocationId === undefined) return undefined
    for (const record of [...read.records].reverse()) {
      if (record.type !== 'design/changed' || record.data.execution === undefined) continue
      if (record.data.kit !== action.target.kitName || record.data.version !== action.target.kitVersion
        || record.data.skill !== action.target.skillName
        || record.data.execution.invocationId !== action.logicalInvocationId) continue
      return record.data.execution.stateStatus === 'complete' ? 'completed' : 'needs-user-input'
    }
    return undefined
  }

  /**
   * Reconcile a running action from its durable design/changed publication.
   * No evidence means no inferred settlement and no mutation.
   */
  async reconcileAdvisoryActionExecution(agent: Agent, receiptId: string): Promise<DesignJournalAdvisoryActionEntry> {
    return this.withJournal(agent, async (workspace, conversation) => {
      const read = await this.journals.read(workspace, conversation)
      const entry = read.snapshot.advisories.find(candidate => candidate.actionReceipts?.some(action => action.receiptId === receiptId))
      const action = entry?.actionReceipts?.find(candidate => candidate.receiptId === receiptId)
      if (entry === undefined || action === undefined) throw new Error(`design advisory: unknown action receipt ${JSON.stringify(receiptId)}`)
      if (action.state !== 'running' || action.attemptId === undefined) return action
      const state = this.advisoryActionPublication(read, action)
      if (state === undefined) return action
      const settled = await this.journals.settleAdvisoryActionExecution(workspace, conversation, {
        receiptId,
        attemptId: action.attemptId,
        state,
      })
      const after = await this.journals.read(workspace, conversation)
      this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: after.revision })
      this.injectAdvisoryProjection(agent, after.snapshot.advisories, after.snapshot.latestDesignChange?.journalRevision)
      return settled
    })
  }

  /** Claim one exact action receipt, reconciling orphaned durable publication first. */
  async claimAdvisoryActionExecution(
    agent: Agent,
    request: DesignAdvisoryActionClaimRequest,
  ): Promise<DesignAdvisoryActionClaimResult> {
    return this.withJournal(agent, async (workspace, conversation) => {
      let read = await this.journals.read(workspace, conversation)
      let entry = read.snapshot.advisories.find(candidate => candidate.actionReceipts?.some(action => action.receiptId === request.receiptId))
      let action = entry?.actionReceipts?.find(candidate => candidate.receiptId === request.receiptId)
      if (entry === undefined || action === undefined) throw new Error(`design advisory: unknown action receipt ${JSON.stringify(request.receiptId)}`)
      this.requireAdvisoryActionTarget(agent, action, request)

      const owners = this.advisoryActionAttempts.get(agent) ?? new Map<string, string>()
      this.advisoryActionAttempts.set(agent, owners)
      const ownedAttemptId = owners.get(request.receiptId)
      if (action.state === 'running' && ownedAttemptId !== action.attemptId && action.attemptId !== undefined) {
        const recovered = this.advisoryActionPublication(read, action)
        if (recovered !== undefined) {
          await this.journals.settleAdvisoryActionExecution(workspace, conversation, {
            receiptId: request.receiptId,
            attemptId: action.attemptId,
            state: recovered,
          })
          read = await this.journals.read(workspace, conversation)
          entry = read.snapshot.advisories.find(candidate => candidate.actionReceipts?.some(candidate => candidate.receiptId === request.receiptId))
          action = entry?.actionReceipts?.find(candidate => candidate.receiptId === request.receiptId)
          if (entry === undefined || action === undefined) throw new Error(`design advisory: action receipt ${JSON.stringify(request.receiptId)} disappeared`)
        }
      }

      const result = await this.journals.claimAdvisoryActionExecution(workspace, conversation, {
        receiptId: request.receiptId,
        proposedInvocationId: request.proposedInvocationId,
        allowOrphanedRunning: action.state === 'running' && ownedAttemptId !== action.attemptId,
      })
      if (result.claimed) owners.set(request.receiptId, result.attemptId)
      const after = await this.journals.read(workspace, conversation)
      if (result.claimed || after.revision !== read.revision) {
        this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: after.revision })
        this.injectAdvisoryProjection(agent, after.snapshot.advisories, after.snapshot.latestDesignChange?.journalRevision)
      }
      return Object.freeze({
        claimed: result.claimed,
        advisoryId: result.advisoryId as string,
        attemptId: result.attemptId,
        effectiveInvocationId: result.effectiveInvocationId,
        action: result.action,
      })
    })
  }

  /** Persist a terminal/retryable state for the exact current action attempt. */
  async settleAdvisoryActionExecution(
    agent: Agent,
    request: {
      readonly receiptId: string
      readonly attemptId: string
      readonly state: Exclude<DesignAdvisoryActionState, 'ready' | 'running'>
    },
  ): Promise<void> {
    const owners = this.advisoryActionAttempts.get(agent)
    try {
      await this.withJournal(agent, async (workspace, conversation) => {
        await this.journals.settleAdvisoryActionExecution(workspace, conversation, request)
        const read = await this.journals.read(workspace, conversation)
        this.notifyWorkspaceChange({ kind: 'advisory-changed', agent, journalRevision: read.revision })
        this.injectAdvisoryProjection(agent, read.snapshot.advisories, read.snapshot.latestDesignChange?.journalRevision)
      })
    } finally {
      if (owners?.get(request.receiptId) === request.attemptId) owners.delete(request.receiptId)
    }
  }

  /**
   * List a session's advisories for the review UI. Journal history is
   * retained exactly; each entry additionally carries staleness derived from
   * the current DesignJournal revision and Kit pin.
   * @param agent - owning Agent and workspace journal scope.
   * @returns entries in publication order.
   */
  async listAdvisories(agent: Agent): Promise<readonly SessionDesignAdvisory[]> {
    return this.withJournal(agent, async (workspace, conversation) => {
      const read = await this.journals.read(workspace, conversation)
      const currency = this.advisoryCurrency(agent, read.snapshot.latestDesignChange?.journalRevision)
      return read.snapshot.advisories.map((entry) => Object.freeze({
        advisory: entry.advisory,
        status: entry.status,
        publishedAt: entry.publishedAt,
        publishedRevision: entry.publishedRevision,
        stale: deriveAdvisoryStaleness(entry.advisory, currency),
        ...(entry.selection === undefined ? {} : { selection: entry.selection }),
        ...(entry.acceptanceReceiptId === undefined ? {} : { acceptanceReceiptId: entry.acceptanceReceiptId }),
        ...(entry.actionReceipts === undefined ? {} : { actionReceipts: entry.actionReceipts }),
        ...(entry.executionStatus === undefined ? {} : { executionStatus: entry.executionStatus }),
      }))
    })
  }

  /** Apply the user-facing cap to the derived current inbox; Journal history is untouched. */
  setAdvisoryInboxLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) {
      throw new Error('design: advisoryInboxLimit must be a safe integer from 1 through 10')
    }
    this.advisoryInboxLimit = limit
  }

  /** Return the shared current queue consumed by both the Panel and model projection. */
  async listAdvisoryInbox(agent: Agent): Promise<readonly SessionDesignAdvisory[]> {
    return this.withJournal(agent, async (workspace, conversation) => {
      const read = await this.journals.read(workspace, conversation)
      const currency = this.advisoryCurrency(agent, read.snapshot.latestDesignChange?.journalRevision)
      return this.currentAdvisoryEntries(read.snapshot.advisories).map((entry) => Object.freeze({
        advisory: entry.advisory,
        status: entry.status,
        publishedAt: entry.publishedAt,
        publishedRevision: entry.publishedRevision,
        stale: deriveAdvisoryStaleness(entry.advisory, currency),
        ...(entry.selection === undefined ? {} : { selection: entry.selection }),
        ...(entry.acceptanceReceiptId === undefined ? {} : { acceptanceReceiptId: entry.acceptanceReceiptId }),
        ...(entry.actionReceipts === undefined ? {} : { actionReceipts: entry.actionReceipts }),
        ...(entry.executionStatus === undefined ? {} : { executionStatus: entry.executionStatus }),
      }))
    })
  }

  /** Derive the current Design currency facts for advisory staleness reads. */
  private advisoryCurrency(agent: Agent, designRevision: number | undefined): DesignAdvisoryCurrency {
    const kit = this.kitForAgent(agent)
    return Object.freeze({
      designRevision,
      ...(kit === undefined ? {} : { kit: Object.freeze({ name: kit.name, version: kit.version }) }),
    })
  }

  /** Latest successful publication per logical profile, then the global inbox cap. */
  private currentAdvisoryEntries(entries: readonly DesignJournalAdvisoryEntry[]): readonly DesignJournalAdvisoryEntry[] {
    return currentAdvisoryEntries(entries, this.advisoryInboxLimit)
  }

  /** Keep model routing count on the same durable unresolved projection as the UI. */
  private injectAdvisoryProjection(
    agent: Agent,
    entries: readonly DesignJournalAdvisoryEntry[],
    designRevision: number | undefined,
  ): void {
    const currency = this.advisoryCurrency(agent, designRevision)
    const visible = this.currentAdvisoryEntries(entries)
      .filter(entry => !deriveAdvisoryStaleness(entry.advisory, currency))
      .map(entry => entry.advisory)
    agent.inject(createYugooDesignMessage({
      content: [{ type: 'text', text: renderDshDesignAdvisorySetReminder(visible) }],
      notice: `design advisory projection: ${visible.length}`,
    }))
  }

  /**
   * Persist the plugin-owned DesignJournal fact after an accepted Design Files
   * write. Git and DesignJournal do not share a transaction: a settlement
   * failure is reported after the Git commit and can be recovered from the
   * project snapshot without introducing host Session event types.
   * @param agent - Agent whose conversation and selected project own the event.
   * @param projectId - project identity pinned before the Design Files write.
   */
  async recordDesignChange(agent: Agent, projectId: DesignProjectId, payload: import('./types.ts').DesignChangedPayload): Promise<number> {
    const kit = await this.authorizeProjectWrite(agent, projectId)
    if (kit.name !== payload.kit || kit.version !== payload.version) {
      throw new Error(`design: rejected Design Files settlement for stale kit ${JSON.stringify(payload.kit)}@${JSON.stringify(payload.version)}`)
    }
    const settlement = await this.withJournal(agent, async (workspace, conversation) => {
      await this.authorizeProjectWrite(agent, projectId)
      const current = await this.journals.read(workspace, conversation)
      if (payload.commit !== undefined) {
        const prior = current.records.find(record => record.type === 'design/changed'
          && record.data.origin === payload.origin && record.data.skill === payload.skill && record.data.commit === payload.commit)
        if (prior !== undefined) {
          if (!isDeepStrictEqual(prior.data, payload)) throw new Error('design: settlement commit was reused with different facts')
          return { revision: prior.revision, replayed: true, publication: current }
        }
      }
      if (current.snapshot.latestKitSelection?.kit !== payload.kit || current.snapshot.latestKitSelection.version !== payload.version) {
        const project = await this.projects.require(projectId)
        await this.appendJournalKit(project, agent, payload.kit, payload.version)
      }
      const read = await this.journals.append(workspace, conversation, { type: 'design/changed', data: payload })
      await this.authorizeProjectWrite(agent, projectId)
      return { revision: read.revision, replayed: false, publication: read }
    })
    // A durable Journal append can itself report failure, or later projection
    // can fail. Replaying the fact must also finish the missing notification.
    const notified = this.settledDesignChanges ??= new WeakMap<Agent, Set<string>>()
    const key = JSON.stringify([projectId, payload.origin, payload.skill, payload.commit, settlement.revision])
    if (settlement.replayed && notified.get(agent)?.has(key)) return settlement.revision
    await this.authorizeProjectWrite(agent, projectId)
    const active = this.activeWorkspaces.get(agent)
    if (active !== undefined && active.project.projectId === projectId) {
      this.setActiveWorkspace(agent, Object.freeze({
        ...active,
        checkpoint: payload.commit ?? active.checkpoint,
        values: Object.freeze({
          ...active.values,
          [payload.skill]: Object.freeze({
            state: payload.state,
            origin: payload.origin,
            ...(payload.panelYaml === undefined ? {} : { panelYaml: payload.panelYaml }),
            ...(payload.skillManifest === undefined ? {} : { skillManifest: payload.skillManifest }),
          }),
        }),
      }))
    }
    this.notifyWorkspaceChange({ kind: 'design-changed', agent, journalRevision: settlement.revision, publication: settlement.publication, projectId })
    const completed = notified.get(agent) ?? new Set<string>()
    completed.add(key)
    if (completed.size > 1024) completed.delete(completed.values().next().value!)
    notified.set(agent, completed)
    return settlement.revision
  }

  /**
   * Read the selected conversation's ordered plugin-owned journal.
   * @param agent - Agent whose binding selects the project and conversation.
   * @returns records and folded snapshot at one exact revision.
   */
  async readDesignJournal(agent: Agent): Promise<DesignJournalRead> {
    return this.withJournal(agent, async (workspace, conversation, project) => {
      const read = await this.journals.read(workspace, conversation)
      this.assertProjectSelection(agent, project.projectId)
      return read
    })
  }

  /** Test whether an exact authoritative must-edit release is already durable. */
  async isExecutionHandoffConsumed(
    agent: Agent,
    consumption: DesignJournalExecutionHandoffConsumption,
  ): Promise<boolean> {
    return this.withJournal(agent, async (workspace, conversation) => {
      return this.journals.isExecutionHandoffConsumed(workspace, conversation, consumption)
    })
  }

  /** Persist one successful authoritative must-edit release exactly once. */
  async consumeExecutionHandoff(
    agent: Agent,
    consumption: DesignJournalExecutionHandoffConsumption,
  ): Promise<void> {
    await this.withJournal(agent, async (workspace, conversation) => {
      await this.journals.consumeExecutionHandoff(workspace, conversation, consumption)
    })
  }

  /**
   * Persist one structured clarity report. The DesignJournal fact is the
   * audit record; the project-scoped `clarity.json` is the latest-assessment
   * authority. Exact current content is a no-op; corrections and reassessment
   * may happen in the same turn without native-log authentication. Checkpoint,
   * Kit and selection checks remain inside the existing project mutation lane.
   * Project files settle through the existing explicit-path Git CAS, preserving
   * unrelated work. A failed publication is reported, never repaired by reads. The
   * standard Session `tool/result` remains the model-visible execution record.
   * @param agent - owning Agent and workspace journal scope.
   * @param candidate - structured report validated before persistence.
   * @returns the journal revision after the operation and whether it appended.
   */
  async reportClarity(
    agent: Agent,
    candidate: DesignClarityReportedPayload,
    options?: { readonly expectedProjectId: DesignProjectId; readonly expectedSelectionRevision?: number; readonly assessedCheckpoint?: string; readonly signal?: AbortSignal },
  ): Promise<{ readonly journalRevision: number; readonly replayed: boolean }> {
    const report = parseDesignClarityReported(candidate)
    const signal = options?.signal
    signal?.throwIfAborted()
    const project = await this.projectForAgent(agent, signal)
    if (options) this.assertProjectSelection(agent, options.expectedProjectId, options.expectedSelectionRevision)
    if (options && project.projectId !== options.expectedProjectId) throw new Error('design clarity: selected project changed')
    return this.serializeProjectMutation(agent, project.projectId, 'selection', async () => {
      const kit = this.requireKitForAgent(agent)
      const matches = (): boolean => {
        signal?.throwIfAborted()
        this.assertProjectSelection(agent, project.projectId, options?.expectedSelectionRevision)
        const current = this.requireKitForAgent(agent)
        return designClarityInputMatches(report, { kit: current.name, version: current.version,
          kitContentHash: projectKitContentHash(current) })
      }
      const files = await this.designFilesForProject(agent, project.projectId, nodeFs, signal)
      const head = await files.head(signal)
      const assessedCheckpoint = options?.assessedCheckpoint ?? head
      if (!head || !assessedCheckpoint || !await files.sameDesignEvidenceAt(assessedCheckpoint, head, signal))
        throw new Error('design clarity: assessed Design evidence changed')
      if (!matches()) throw new Error('design clarity: assessed Kit content changed')
      const root = designProjectRecordsRoot(project.root)
      const existing = await readDesignClarityAuthority(root, project.projectId)
      const same = existing && existing.report.digest === report.digest
        && designClarityInputMatches(existing.report, { kit: kit.name, version: kit.version, kitContentHash: projectKitContentHash(kit) })
        && await files.sameDesignEvidenceAt(existing.assessedCheckpoint, assessedCheckpoint, signal)
      if (same) {
        // Settle a prior explicit record write whose Git response failed; reads never do this.
        await commitDesignProjectRecords({ projectRoot: project.root, paths: ['design_records/clarity.json'],
          message: 'Record Design clarity', expectedHead: head, signal, spawn: this.spawnAdapter() })
        return { journalRevision: (await this.readDesignJournal(agent)).revision, replayed: true }
      }
      const mutation = await this.withJournalForProject(project, String(project.projectId), (workspace, conversation) =>
        this.journals.atomicMutate(workspace, conversation, () => {
          if (!matches()) throw new Error('design clarity: assessed Kit changed while awaiting persistence')
          return { type: 'design/clarity-reported', data: { assessedCheckpoint, report } }
        }))
      await writeDesignClarityAuthority(root, { schemaVersion: DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION,
        projectId: project.projectId, assessedCheckpoint, report }, { beforeReplace: () => {
        if (!matches()) throw new Error('design clarity: selected project or Kit changed before replacement')
      } })
      await commitDesignProjectRecords({ projectRoot: project.root, paths: ['design_records/clarity.json'],
        message: 'Record Design clarity', expectedHead: head, signal, spawn: this.spawnAdapter() })
      return { journalRevision: mutation.read.revision, replayed: false }
    }, signal)
  }

  /** Explicit evaluator callers use the same ordinary commit-pinned persistence path. */
  async reportEvaluatedClarity(
    agent: Agent,
    assessedCheckpoint: string,
    report: DesignClarityReportedPayload,
    options?: { readonly expectedProjectId: DesignProjectId; readonly signal?: AbortSignal },
  ): Promise<{ readonly status: 'updated' | 'unchanged' | 'stale'; readonly journalRevision: number }> {
    if (report.origin !== 'evaluator') throw new Error('design clarity: evaluator origin is required')
    const result = await this.reportClarity(agent, report, {
      expectedProjectId: options?.expectedProjectId ?? (await this.projectForAgent(agent, options?.signal)).projectId,
      assessedCheckpoint, signal: options?.signal,
    })
    return { status: result.replayed ? 'unchanged' : 'updated', journalRevision: result.journalRevision }
  }

  /**
   * Read one project's latest clarity authority document. Current clarity
   * state comes from this file only; journal folds never serve it.
   * @param projectId - the project whose authority is read.
   * @param signal - optional cancellation for the registry read.
   * @returns the validated authority, or undefined when no assessment exists.
   */
  async readClarityAuthority(
    projectId: DesignProjectId,
    signal?: AbortSignal,
  ): Promise<DesignClarityAuthority | undefined> {
    const project = await this.projects.require(projectId, signal)
    return readDesignClarityAuthority(designProjectRecordsRoot(project.root), projectId)
  }

  /**
   * Assert that one compiled Kit can use the currently installed trusted drivers.
   * @param kit - compiled candidate to check before registration.
   */
  assertKitInstallable(kit: DesignKit): void {
    this.contributions.assertKit(kit)
  }

  /** Host adapter entry. Native confinement/receipts and all Panel/run observations remain Host-owned. */
  async contentMigrationFor(agent: Agent,
    host: Pick<ProjectContentMigrationPorts, 'assertQuiescent' | 'verifyNativeProducer'>): Promise<ProjectContentMigration> {
    const selection = await this.currentSelection(agent)
    if (!selection) throw new Error('design: select the existing project before upgrading')
    const project = await this.projects.require(selection.projectId)
    const git = new GitVersioning(this.spawnAdapter(), project.root)
    return new ProjectContentMigration({ root: project.root, stateRoot: project.stateRoot, spawn: this.spawnAdapter(),
      journalOwner: String(agent.id),
      mutate: operation => this.serializeProjectMutation(agent, project.projectId, 'selection', operation),
      resolveKit: pin => this.resolveProjectKit(pin), assertCompatible: kit => this.assertKitInstallable(kit),
      assertQuiescent: async () => { this.assertProjectSelection(agent, project.projectId); await host.assertQuiescent() },
      verifyNativeProducer: host.verifyNativeProducer,
      validate: async (kit, files) => {
        for (const path of files.keys()) {
          const canonical = /^design_files\/([^/]+)\/\1\.json$/u.exec(path)
          if (canonical && !kit.skills.some(skill => skill.name === canonical[1])) throw new Error(`design: upgrade cannot orphan ${path}`)
        }
        for (const skill of kit.skills) {
          const bytes = files.get(`design_files/${skill.name}/${skill.name}.json`)
          if (!bytes) continue
          const issues = await validateSkillDesign(skill, JSON.parse(Buffer.from(bytes).toString('utf8')), {
            scopes: ['state'], resolveValidationDriver: id => this.validationDriverFor(skill, id),
            artifactText: async path => {
              const bytes = files.get(`design_files/${path}`)
              return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8')
            },
          })
          if (issues.length) throw new Error(JSON.stringify(issues))
        }
      },
      record: async (receipt, journalOwner) => {
        const metadata = parseDesignProjectJson((await git.readTextAt(receipt.checkpoint, 'project.json'))!)
        if (!metadata.kit || metadata.id !== project.projectId) throw new Error('design: mismatched adoption metadata')
        await recordProjectContentAdoption({ atomicMutate: (_conversation, mutator) => this.journals.atomicMutate(project.root, String(project.projectId), mutator) },
          journalOwner ?? String(agent.id), receipt, metadata.kit)
        // Invalidate the old effective closure immediately; ordinary reopen restores the committed pin.
        this.invalidateProjectContent(project.projectId)
      },
    })
  }

  /** Recover an already authorized adoption after restart without reading a mixed closure. */
  async recoverContentMigrationFor(agent: Agent): Promise<import('./project-content-transaction.ts').ProjectContentAdoptionReceipt | undefined> {
    const binding = await this.bindings.read(this.bindingKey(agent))
    if (!binding.projectId) throw new Error('design: select the exact recovery project')
    const project = await this.projects.contentRecoveryLocation(binding.projectId)
    const git = new GitVersioning(this.spawnAdapter(), project.root)
    const receipt = await new ProjectContentTransaction({ root: project.root, spawn: this.spawnAdapter(),
      mutate: operation => this.serializeProjectMutation(agent, project.projectId, 'recovery', operation),
      record: async (receipt, journalOwner) => {
        const metadata = parseDesignProjectJson((await git.readTextAt(receipt.checkpoint, 'project.json'))!)
        if (!metadata.kit || metadata.id !== project.projectId) throw new Error('design: mismatched recovery identity')
        await recordProjectContentAdoption({ atomicMutate: (_conversation, mutator) => this.journals.atomicMutate(project.root, String(project.projectId), mutator) },
          journalOwner ?? String(agent.id), receipt, metadata.kit)
        this.invalidateProjectContent(project.projectId)
      },
    }).recover()
    await this.restoreWorkspace(agent)
    return receipt
  }

  /**
   * Register one fully validated Kit source for this process. The source
   * files remain the Kit authority: no durable Kit snapshot is retained, and
   * restarts load only the current source.
   * @param initial - fully loaded and validated Kit that is latest for new sessions.
   * @returns the source-owned publisher and disposer.
   */
  registerKitSource(initial: DesignKit): DesignKitPublisher {
    if (this.kits.has(initial.name)) throw new Error(`design: duplicate kit ${JSON.stringify(initial.name)}`)
    this.assertKitInstallable(initial)
    const owner = Symbol(initial.name)
    const versions = new Map<DesignKitVersion, DesignKit>([[initial.version, initial]])
    this.kits.set(initial.name, { owner, latestVersion: initial.version, versions })
    let disposed = false
    return {
      publish: (candidate) => {
        if (disposed || this.kits.get(initial.name)?.owner !== owner) {
          throw new Error(`design: Kit source ${JSON.stringify(initial.name)} is disposed`)
        }
        if (candidate.name !== initial.name) {
          throw new Error(`design: Kit source ${JSON.stringify(initial.name)} cannot publish family ${JSON.stringify(candidate.name)}`)
        }
        this.assertKitInstallable(candidate)
        const current = this.kits.get(initial.name) as DesignKitFamily
        // Same-version publication atomically replaces the registered content:
        // pre-release source files stay authoritative without a version bump.
        current.versions.set(candidate.version, candidate)
        if (current.latestVersion === candidate.version) return false
        current.latestVersion = candidate.version
        return true
      },
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.kits.get(initial.name)?.owner !== owner) return
        this.kits.delete(initial.name)
      },
    }
  }

  /** Register an immutable file-backed closure without making it a mutable source. */
  registerRetainedKit(kit: DesignKit): void {
    this.assertKitInstallable(kit)
    let family = this.retainedKits.get(kit.name)
    if (!family) { family = new Map(); this.retainedKits.set(kit.name, family) }
    const existing = family.get(kit.version)
    if (existing && JSON.stringify(existing) !== JSON.stringify(kit)) throw new Error('design: retained Kit version conflict')
    family.set(kit.version, kit)
  }

  /** Install an exact version independently of a Kit. Trusted hosts mark file-backed retained roots explicitly. */
  registerBundleContent(bundle: import('./kit-loader.ts').DesignBundleContent, options: {readonly retained?: boolean} = {}): void {
    const pin = `${bundle.skill.catalogName ?? bundle.skill.name}\0${bundle.skill.version}`
    const previous = this.independentBundles.get(pin)
    const fingerprint = (value: import('./kit-loader.ts').DesignBundleContent) => {
      const {resourceRoot: _root, ...skill} = value.skill
      return JSON.stringify({skill, resources: value.resources})
    }
    if (previous && fingerprint(previous.content) !== fingerprint(bundle)) throw new Error('design: independent immutable Bundle version conflict')
    if (previous?.retained && !options.retained) return
    this.independentBundles.set(pin, {content: bundle, retained: options.retained === true})
  }

  /** Independently registered published versions. Legacy sources are a transition projection only. */
  listBundles(): readonly DesignSkill[] {
    const result = new Map<string, DesignSkill>()
    for (const family of this.kits.values()) for (const kit of family.versions.values()) {
      for (const skill of kit.skills) result.set(`${skill.catalogName ?? skill.name}\0${skill.version}`, skill)
    }
    for (const {content} of this.independentBundles?.values() ?? []) {
      result.set(`${content.skill.catalogName ?? content.skill.name}\0${content.skill.version}`, content.skill)
    }
    return [...result.values()]
  }

  resolveBundle(pin: {readonly name: string; readonly version: string}): import('./kit-loader.ts').DesignBundleContent | undefined {
    return this.independentBundles?.get(`${pin.name}\0${pin.version}`)?.content
  }

  resolveBundleRoot(pin: {readonly name: string; readonly version: string}): string | undefined {
    return this.resolveBundle(pin)?.resourceRoot
  }

  /**
   * Atomically register one Bundle's trusted server contributions.
   * @param contribution - stable runtime, validation, capability, and presentation identities owned by one Bundle.
   * @returns an owner-safe disposer that refuses to orphan any registered Kit version.
   */
  registerBundleContribution(contribution: DesignBundleContribution): () => void {
    return this.contributions.registerBundleContribution(contribution)
  }

  /** Return the first live Kit reference that prevents contribution disposal. */
  private contributionDisposalReason(ids: DesignBundleContributionIds): string | undefined {
    for (const family of [...this.kits.values(), ...[...(this.retainedKits?.values() ?? [])].map(versions => ({versions}))]) {
      for (const kit of family.versions.values()) {
        for (const skill of kit.skills) {
          const manifest = skill.metadata?.skillManifest
          if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) continue
          const record = manifest as Record<string, unknown>
          const runtime = record.runtime
          const runtimeId = typeof runtime === 'object' && runtime !== null && !Array.isArray(runtime)
            ? (runtime as Record<string, unknown>).driver
            : undefined
          const presentation = record.presentation
          const presentationId = typeof presentation === 'object' && presentation !== null && !Array.isArray(presentation)
            && (presentation as Record<string, unknown>).mode === 'native'
            ? (presentation as Record<string, unknown>).renderer
            : undefined
          const capabilityId = (Array.isArray(record.capabilities)
            ? record.capabilities.filter((id): id is string => typeof id === 'string')
            : []).find(id => ids.capabilities.has(id as DesignDriverId))
          const validationId = ((skill.metadata?.validationDocument as { rules?: readonly { check?: Record<string, unknown> }[] } | undefined)?.rules ?? [])
            .flatMap(rule => typeof rule.check?.driver === 'string' ? [rule.check.driver] : [])
            .find(id => ids.validations.has(id as DesignDriverId))
          const referenced = typeof runtimeId === 'string' && runtimeId === ids.runtime
            ? runtimeId
            : typeof presentationId === 'string' && presentationId === ids.presentation
              ? presentationId
              : capabilityId ?? validationId
          if (referenced !== undefined) {
            return `design runtime: cannot dispose contribution ${JSON.stringify(referenced)} while registered Kit ${JSON.stringify(kit.name)}@${JSON.stringify(kit.version)} Bundle ${JSON.stringify(skill.name)} references it`
          }
        }
      }
    }
    return undefined
  }

  /**
   * Resolve the trusted runtime driver declared by one Bundle.
   * @param skill - Bundle whose parsed manifest carries `runtime.driver`.
   * @returns the installed driver, or undefined for a declarative Bundle.
   */
  runtimeDriverFor(skill: DesignKit['skills'][number]): DesignRuntimeDriver | undefined {
    const manifest = skill.metadata?.skillManifest
    const runtime = typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).runtime
      : undefined
    if (runtime === undefined) return undefined
    if (typeof runtime !== 'object' || runtime === null || Array.isArray(runtime)) {
      throw new Error(`design runtime: Bundle ${JSON.stringify(skill.name)} has an unresolved runtime declaration`)
    }
    return this.contributions.requireRuntime(skill.authority, (runtime as { driver: DesignDriverId }).driver)
  }

  /**
   * Resolve the procedural validation driver declared by one Bundle.
   * @param skill - Bundle whose trusted authority owns the validation reference.
   * @param id - globally unique validation contribution identity.
   * @returns the installed validation driver.
   */
  validationDriverFor(skill: DesignKit['skills'][number], id: DesignDriverId): DesignValidationDriver {
    return this.contributions.requireValidation(skill.authority, id)
  }

  /** All installed kits. */
  listKits(): readonly DesignKit[] {
    const contents = new Map<string, DesignKit>()
    for (const family of this.kits.values()) for (const kit of family.versions.values()) contents.set(`${kit.name}\0${kit.version}`, kit)
    for (const versions of this.retainedKits?.values() ?? []) for (const kit of versions.values()) contents.set(`${kit.name}\0${kit.version}`, kit)
    const kits = [...contents.values()]
    return [...new Set(kits.map(kit => kit.name))].map(name => latestInstalledKit(kits, name)!)
  }

  /** Browser-safe Design Project and Mindset catalog for the current conversation. */
  async listProjectCatalog(agent: Agent, signal?: AbortSignal): Promise<{
    readonly currentProjectId: string | null
    readonly projects: readonly {
      readonly projectId: string
      readonly name: string
      readonly root: string
      readonly updatedAt: string
      readonly kit?: { readonly name: string; readonly version: string }
    }[]
    readonly mindsets: readonly { readonly name: string; readonly version: string; readonly description?: string }[]
  }> {
    const selection = await this.currentSelection(agent)
    const projects = (await this.projects.listRecent(signal)).map(project => Object.freeze({
      projectId: String(project.projectId),
      name: project.name,
      root: project.root,
      updatedAt: project.updatedAt,
      ...(project.kit === undefined ? {} : { kit: { ...project.kit, version: String(project.kit.version) } }),
    }))
    const mindsets = this.listKits()
      .map(kit => Object.freeze({
        name: kit.name,
        version: String(kit.version),
        ...(kit.description === undefined ? {} : { description: kit.description }),
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return Object.freeze({
      currentProjectId: selection === undefined ? null : String(selection.projectId),
      projects: Object.freeze(projects),
      mindsets: Object.freeze(mindsets),
    })
  }

  /** Resolve the latest published version of one Kit family. */
  latestKit(name: string): DesignKit | undefined {
    const family = this.kits.get(name)
    if (family === undefined) return undefined
    return family.versions.get(family.latestVersion)
  }

  /** Resolve one exact registered Kit version. */
  resolveKit(pin: DesignKitPin): DesignKit | undefined {
    return this.retainedKits?.get(pin.kit)?.get(pin.version) ?? this.kits.get(pin.kit)?.versions.get(pin.version)
  }

  /** Project overrides affect methods, schema, summary, Panel and runtime as one closure. */
  resolveProjectKit(pin: DesignProjectKitPin): DesignKit | undefined {
    const base = this.resolveKit({ kit: pin.name, version: pin.version })
    if (!base) return undefined
    const replacements = projectBundleOverrides(pin, base).map(target => {
      const bundle = this.resolveBundle(target)
      if (!bundle) throw new Error(`project content: unavailable exact Bundle ${target.name}@${target.version}`)
      return bundle
    })
    const kit = composeProjectKit(pin, base, replacements)
    this.assertKitInstallable(kit)
    return kit
  }

  /** Resolve the exact Kit pinned by the selected Design Project. */
  kitForAgent(agent: Agent): DesignKit | undefined {
    const project = this.activeWorkspaces.get(agent)?.project
    if (project) this.assertCurrentContent(agent, project)
    const pin = project?.kit
    return pin === undefined ? undefined : this.resolveProjectKit(pin)
  }

  /** Require the exact Kit pinned by the selected Design Project. */
  requireKitForAgent(agent: Agent): DesignKit {
    const workspace = this.activeWorkspaces.get(agent)
    if (workspace) this.assertCurrentContent(agent, workspace.project)
    const pin = workspace?.project.kit
    if (pin === undefined) throw new Error('design: no mindset is active in the selected Design Project')
    const kit = this.resolveProjectKit(pin)
    if (kit === undefined) {
      throw new Error(`design: restore the full exact pinned Kit ${JSON.stringify(pin.name)}@${JSON.stringify(pin.version)} before using or migrating saved design`)
    }
    return kit
  }

  /**
   * Model-facing project-aware mindset activation. Resolves the Design Project
   * explicitly selected by the Agent session (fail loud when none) and runs the
   * shared project-pin-first/session-event-second transaction.
   * @param agent - the calling Agent whose session selects the project.
   * @param name - installed mindset/kit name.
   * @param signal - optional cancellation.
   * @returns the activated kit.
   */
  async selectProjectMindset(agent: Agent, name: string, signal?: AbortSignal): Promise<DesignKit> {
    const project = await this.projectForAgent(agent, signal)
    if (project.kit !== undefined && this.resolveProjectKit(project.kit) === undefined) {
      throw new Error('design: restore the full exact pinned Kit before selecting or migrating saved design')
    }
    const selected = await this.conversationPort(agent, signal).changeMindset(project.projectId, name)
    return this.requireKitForAgent(agent)
  }

  /** Require one registered Kit version without changing session state. */
  private requireExactKit(name: string, version: DesignKitVersion): DesignKit {
    const kit = this.resolveKit({kit: name, version})
    if (kit === undefined) {
      throw new Error(`design: unavailable mindset version ${JSON.stringify(name)}@${JSON.stringify(version)}`)
    }
    return kit
  }

  /** Resolve the selected Design Project, or undefined without a binding. */
  async selectedProjectForAgent(agent: Agent, signal?: AbortSignal): Promise<RegisteredDesignProject | undefined> {
    const selection = await this.currentSelection(agent)
    if (selection === undefined) return undefined
    const project = await this.projects.require(selection.projectId, signal)
    this.assertProjectSelection(agent, selection.projectId)
    return project
  }

  /** Resolve the Design Project explicitly selected by an Agent session. */
  async projectForAgent(agent: Agent, signal?: AbortSignal): Promise<RegisteredDesignProject> {
    const project = await this.selectedProjectForAgent(agent, signal)
    if (project === undefined) {
      throw new Error('design: no Design Project is selected; use /yugoo new <name> or /yugoo open <id|name|path>')
    }
    return project
  }

  /** Resolve one exact evidence file or directory authorized by reconstruction. */
  inspectReconstructionSource(sourceRoot: string, signal?: AbortSignal) {
    return this.projects.inspectReconstructionSource(sourceRoot, signal)
  }

  /**
   * Resolve a pinned committed checkpoint for optional Knowledge work.
   * Knowledge never owns the authoritative Design Files mutation lane; callers
   * revalidate the checkpoint around their provider operation.
   */
  async withSelectedKnowledge<T>(agent: Agent, operation: (service: DesignKnowledgeService, project: RegisteredDesignProject, checkpoint: string) => Promise<T>): Promise<T> {
    const project = await this.projectForAgent(agent)
    const status = await this.projects.status(project.projectId)
    const result = await operation(this.requireKnowledgeRuntime().service, project, status.lastCheckpoint)
    this.assertProjectSelection(agent, project.projectId)
    return result
  }

  /**
   * Read the selected project's exact committed Design Files projection.
   * Current-conversation Journal facts do not replace this state. Exact Kit
   * metadata is attached only when the project's pinned version is installed.
   * @param agent - Agent whose durable binding selects the project.
   * @param projectId - project identity pinned by the caller before the read.
   * @param signal - optional cancellation for registry and Git reads.
   * @returns checkpoint plus canonical Bundle states from that checkpoint.
   */
  async readProjectWorkspaceSnapshot(
    agent: Agent,
    projectId: DesignProjectId,
    signal?: AbortSignal,
  ): Promise<DesignProjectWorkspaceSnapshot> {
    this.assertProjectSelection(agent, projectId)
    const before = await this.projects.require(projectId, signal)
    this.assertProjectSelection(agent, projectId)
    const snapshot = await this.projects.snapshot(projectId, signal)
    this.assertProjectSelection(agent, projectId)
    const project = await this.projects.require(projectId, signal)
    this.assertProjectSelection(agent, projectId)
    if (!sameProjectKitPin(before.kit, project.kit)) {
      throw new Error('design: project Kit pin changed while reading the workspace checkpoint')
    }
    const kit = project.kit === undefined
      ? undefined
      : this.resolveProjectKit(project.kit)
    const skills = new Map(kit?.skills.map(skill => [skill.name, skill]) ?? [])
    const design = Object.freeze(Object.fromEntries(Object.entries(snapshot.bundleStates).map(([skillName, state]) => {
      const skill = skills.get(skillName)
      const panelYaml = skill?.metadata?.panelYaml
      const skillManifest = skill?.metadata?.skillManifest
      return [skillName, Object.freeze({
        state,
        origin: 'agent' as const,
        ...(typeof panelYaml === 'string' ? { panelYaml } : {}),
        ...(typeof skillManifest === 'object' && skillManifest !== null && !Array.isArray(skillManifest)
          ? { skillManifest: skillManifest as Record<string, unknown> }
          : {}),
      })]
    })))
    const active = this.activeWorkspaces.get(agent)
    if (active !== undefined && active.project.projectId === projectId) {
      this.setActiveWorkspace(agent, Object.freeze({
        ...active,
        project,
        checkpoint: snapshot.checkpoint,
        values: design,
      }))
    }
    return Object.freeze({
      checkpoint: snapshot.checkpoint,
      design,
      ...(project.kit === undefined ? {} : { kit: project.kit }),
    })
  }

  /** Reject an operation whose selected Design Project changed after it began. */
  assertProjectSelection(agent: Agent, projectId: DesignProjectId, selectionRevision?: number): void {
    const selection = this.selectionForAgent(agent)
    if (selection?.projectId !== projectId || (selectionRevision !== undefined && selection.revision !== selectionRevision)) {
      throw new Error(`design: selected Design Project changed while operating on ${JSON.stringify(projectId)}`)
    }
  }

  /** Build a Design Files store pinned to one already-resolved project identity. */
  async displayFilesForProject(agent: Agent, project: RegisteredDesignProject, fs: FsLike): Promise<DesignFilesStore> {
    const epoch = this.projectContentEpochs.get(project.projectId) ?? 0
    const git = await this.workspaceGitReader(project)
    return new DesignFilesStore(fs, git, project.designFilesRoot, {
      read: async operation => {
        this.assertProjectSelection(agent, project.projectId)
        this.assertStoreContent(agent, project, epoch)
        const result = await operation()
        this.assertProjectSelection(agent, project.projectId)
        this.assertStoreContent(agent, project, epoch)
        return result
      },
      mutate: async () => { throw new Error('design: display reader cannot mutate Design Files') },
    })
  }

  /** Build a fully authorized store for actions, never using display-only authority. */
  async designFilesForProject(
    agent: Agent,
    projectId: DesignProjectId,
    fs: FsLike,
    signal?: AbortSignal,
  ): Promise<DesignFilesStore> {
    await this.authorizeProjectWrite(agent, projectId, signal)
    const project = await this.projects.require(projectId, signal)
    return this.authorizedDesignFiles(agent, project, fs, signal)
  }

  /** Construct a store from the registered identity just validated by the caller. */
  private async authorizedDesignFiles(
    agent: Agent,
    project: RegisteredDesignProject,
    fs: FsLike,
    signal?: AbortSignal,
    assertScope?: () => Promise<void>,
    scopedGit?: GitVersioning,
  ): Promise<DesignFilesStore> {
    const projectId = project.projectId
    await assertScope?.()
    const epoch = this.projectContentEpochs.get(projectId) ?? 0
    await this.authorizeProjectWrite(agent, projectId, signal)
    const git = scopedGit ?? await this.workspaceGitReader(project)
    const access: DesignFilesAccess = {
      read: async (operation) => {
        await assertScope?.()
        this.assertStoreContent(agent, project, epoch)
        await this.authorizeProjectWrite(agent, projectId, signal)
        const result = await operation()
        await this.authorizeProjectWrite(agent, projectId, signal)
        this.assertStoreContent(agent, project, epoch)
        await assertScope?.()
        return result
      },
      mutate: operation => this.serializeProjectMutation(agent, projectId, 'write', async () => {
        await assertScope?.()
        this.assertStoreContent(agent, project, epoch)
        const result = await operation()
        this.assertStoreContent(agent, project, epoch)
        await assertScope?.()
        return result
      }, signal),
    }
    return new DesignFilesStore(fs, git, project.designFilesRoot, access)
  }

  /**
   * Resolve a selected project's registered identity only after acquiring its
   * existing mutation lane. Reuse that identity for this operation's store,
   * not a display snapshot, an entry-time cache or a later request. Every
   * store operation retains its selection/content checks and publication CAS.
   */
  async withSelectedDesignFilesMutation<T>(
    agent: Agent,
    fs: FsLike,
    signal: AbortSignal,
    operation: (project: RegisteredDesignProject, store: DesignFilesStore) => Promise<T>,
    onMutationEntered?: () => void,
    scopeId?: number,
  ): Promise<T> {
    signal.throwIfAborted()
    const backend = gitBackendSetting()
    const entry = this.selectionForAgent(agent)
    const entryEpoch = entry === undefined ? undefined : this.projectContentEpochs.get(entry.projectId) ?? 0
    const selection = await this.currentSelection(agent)
    if (selection === undefined) {
      throw new Error('design: no Design Project is selected; use /yugoo new <name> or /yugoo open <id|name|path>')
    }
    const selected = this.activeWorkspaces.get(agent)?.project
    if (selected?.projectId !== selection.projectId) throw new Error('design: selected Design Project changed before mutation')
    const epoch = this.projectContentEpochs.get(selection.projectId) ?? 0
    if (entry !== undefined && (entry.projectId !== selection.projectId || entry.revision !== selection.revision || entryEpoch !== epoch)) {
      throw new Error('design: project selection or content changed while resolving mutation')
    }
    // Metadata witnesses fence an external repository replacement while queued;
    // they do not cache HEAD or replace the fresh registered Git-open below.
    const identity = async (): Promise<string> => {
      const stamp = (entry: Awaited<ReturnType<typeof lstat>>) => [entry.dev, entry.ino, entry.birthtimeMs]
      const entries = await Promise.all([selected.root, join(selected.root, '.git')].map(async path => {
        const entry = await lstat(path)
        // The existing manager follows directory symlinks. Witness both the
        // link entry and its resolved directory without narrowing that shape.
        const target = entry.isSymbolicLink() ? await realpath(path) : path
        const directory = entry.isSymbolicLink() ? await lstat(target) : entry
        if (!directory.isDirectory()) throw new Error('design: project repository identity changed')
        return [target, stamp(entry), stamp(directory)]
      }))
      return JSON.stringify(entries)
    }
    const witness = await identity()
    let active = true
    const assertScope = async (): Promise<void> => {
      const check = (): void => {
        if (!active) throw new Error('design: selected project mutation scope has ended')
        signal.throwIfAborted()
        const current = this.selectionForAgent(agent)
        if (current?.projectId !== selection.projectId || current.revision !== selection.revision
          || (this.projectContentEpochs.get(selection.projectId) ?? 0) !== epoch) {
          throw new Error('design: project selection or content changed while waiting for mutation')
        }
      }
      check()
      if (await identity() !== witness) throw new Error('design: project repository identity changed while waiting for mutation')
      check()
    }
    try { return await this.serializeProjectMutation(agent, selection.projectId, 'write', async () => {
      await assertScope()
      onMutationEntered?.()
      const registeredOpenStarted = performance.now()
      emitDshGitScopeTiming(scopeId, 'registered-open-start', 0)
      let opened = false
      const project = await (async () => {
        try {
          const value = await this.projectForAgent(agent, signal)
          opened = true
          return value
        } finally { emitDshGitScopeTiming(scopeId, 'registered-open-end', performance.now() - registeredOpenStarted,
          { completed: opened, cancelled: signal.aborted }) }
      })()
      this.assertProjectSelection(agent, selection.projectId)
      if (project.projectId !== selection.projectId || project.root !== selected.root || project.designFilesRoot !== selected.designFilesRoot) {
        throw new Error('design: selected project repository identity changed before mutation')
      }
      const scope = await openDshGitScope({
        subprocess: this.context.get('subprocess'), root: project.root, signal, assertScope, scopeId, backend,
      })
      return runDshGitScope(scope, async () => {
        try {
          const git = new GitVersioning(scope?.spawn ?? this.spawnAdapter(), project.root, 'design_files', false, backend)
          const store = await this.authorizedDesignFiles(agent, project, fs, signal, assertScope, git)
          const result = await operation(project, store)
          await assertScope()
          return result
        } finally { active = false }
      }, completed => this.context.logger?.warn(`design git: save worker cleanup was not confirmed; operation ${completed ? 'completed' : 'failed'}`))
    }, signal) } finally { active = false }
  }

  /** Build a Design Files store inside the Agent session's selected project. */
  async designFiles(agent: Agent, fs: FsLike, signal?: AbortSignal): Promise<DesignFilesStore> {
    const project = await this.projectForAgent(agent, signal)
    return this.designFilesForProject(agent, project.projectId, fs, signal)
  }

  /** Serialize and revalidate one mutation against its initiating project. */
  async withProjectMutationFor<T>(
    agent: Agent,
    projectId: DesignProjectId,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.serializeProjectMutation(agent, projectId, 'write', operation)
  }

  private async authorizeProjectWrite(agent: Agent, projectId: DesignProjectId, signal?: AbortSignal): Promise<DesignKit> {
    this.assertProjectSelection(agent, projectId)
    // The active workspace is the conversation's selected-project authority.
    // A Bundle invocation is created from this exact record and its tools are
    // disposed when the invocation ends. Reopening the global registry for
    // every scoped file operation is not a stronger authorization boundary;
    // it couples foreground writes to unrelated project discovery and Git
    // probes. Project/Kit changes through this service replace the active
    // workspace, so the pre/post selection checks still reject stale work.
    signal?.throwIfAborted()
    const active = this.activeWorkspaces.get(agent)
    if (active === undefined || active.project.projectId !== projectId) {
      throw new Error(`design: selected Design Project changed while operating on ${JSON.stringify(projectId)}`)
    }
    const project = active.project
    this.assertCurrentContent(agent, project)
    const pin = project.kit
    if (pin === undefined) throw new Error('design: no mindset is active in the selected Design Project')
    const kit = this.resolveProjectKit(pin)
    if (kit === undefined) {
      throw new Error(`design: restore the full exact pinned Kit ${JSON.stringify(pin.name)}@${JSON.stringify(pin.version)} before using or migrating saved design`)
    }
    this.assertProjectSelection(agent, projectId)
    signal?.throwIfAborted()
    return kit
  }

  private async serializeProjectMutation<T>(
    agent: Agent,
    projectId: DesignProjectId,
    authority: 'selection' | 'write' | 'knowledge' | 'recovery',
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const authorize = async (): Promise<void> => {
      if (authority === 'knowledge') {
        const owner = [agent, ...this.knowledgeLifecycles.keys()].find(candidate => this.selectionForAgent(candidate)?.projectId === projectId)
        if (!owner) throw new DOMException('No remaining Knowledge project reader', 'AbortError')
        await this.authorizeProjectWrite(owner, projectId, signal)
      } else if (authority === 'recovery') {
        const binding = await this.bindings.read(this.bindingKey(agent))
        if (binding.projectId !== projectId) throw new Error('design: recovery conversation binding changed')
      } else if (authority === 'write') await this.authorizeProjectWrite(agent, projectId, signal)
      else this.assertProjectSelection(agent, projectId)
    }
    if (this.projectMutationScope.getStore() === projectId) {
      await authorize()
      const result = await operation()
      await authorize()
      return result
    }
    const previous = this.projectMutations.get(projectId) ?? Promise.resolve()
    const guarded = async (): Promise<T> => {
      return this.projectMutationScope.run(projectId, async () => {
        await authorize()
        const result = await operation()
        await authorize()
        return result
      })
    }
    const execution = previous.then(guarded, guarded)
    const tail = execution.then(() => undefined, () => undefined)
    this.projectMutations.set(projectId, tail)
    try {
      return await execution
    } finally {
      if (this.projectMutations.get(projectId) === tail) this.projectMutations.delete(projectId)
    }
  }

  /**
   * Select the mutation lane used by a Knowledge refresh.
   *
   * KAG is derived, checkpoint-fenced work. It must never occupy the
   * authoritative Design Files lane: a slow embedding/provider transaction
   * would otherwise block Bundle writes and even user cancellation. KAG keeps
   * its own per-project lane, while refreshDesignKnowledge rechecks the pinned
   * Design checkpoint before publishing.
   */
  private knowledgeMutationLane(
    agent: Agent,
    projectId: DesignProjectId,
    signal?: AbortSignal,
  ): <T>(operation: () => Promise<T>) => Promise<T> {
    return operation => this.serializeKnowledgeMutation(agent, projectId, operation, signal)
  }

  private async serializeKnowledgeMutation<T>(
    agent: Agent,
    projectId: DesignProjectId,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const authorize = async () => {
      const owner = [agent, ...this.knowledgeLifecycles.keys()].find(candidate => this.selectionForAgent(candidate)?.projectId === projectId)
      if (!owner) throw new DOMException('No remaining Knowledge project reader', 'AbortError')
      await this.authorizeProjectWrite(owner, projectId, signal)
    }
    const previous = this.knowledgeMutations.get(projectId) ?? Promise.resolve()
    const guarded = async () => {
      await authorize()
      const result = await operation()
      await authorize()
      return result
    }
    const execution = previous.then(guarded, guarded)
    const tail = execution.then(() => undefined, () => undefined)
    this.knowledgeMutations.set(projectId, tail)
    try {
      return await execution
    } finally {
      if (this.knowledgeMutations.get(projectId) === tail) this.knowledgeMutations.delete(projectId)
    }
  }

  /**
   * Serialize one Design Files read-modify-write transaction per selected project.
   * The queue contains failures so one rejected mutation cannot starve later
   * panel saves, agent writes, or artifact-worker settlements.
   * @param agent - Agent whose durable selection owns the project mutation.
   * @param operation - complete mutation, including its authoritative read and event append.
   * @returns the operation result after every earlier workspace mutation settles.
  */
  async withProjectMutation<T>(agent: Agent, operation: () => Promise<T>): Promise<T> {
    const selection = this.selectionForAgent(agent)
    if (selection === undefined) {
      throw new Error('design: no Design Project is selected; use /yugoo new <name> or /yugoo open <id|name|path>')
    }
    // Pin the queue key before the first await. Concurrent callers must enter
    // the selected project's queue in invocation order even when project
    // registry resolution completes in a different order.
    return this.withProjectMutationFor(agent, selection.projectId, operation)
  }

  private requireKnowledgeRuntime(): DesignProjectKnowledgeRuntime {
    const registration = this.knowledgeRuntime
    if (registration === undefined) {
      throw new Error('design: Design Knowledge runtime is unavailable; the installation is incomplete')
    }
    if (registration.disposing) throw new Error('design: Design Knowledge runtime is shutting down')
    return registration.runtime
  }

  private knowledgeLifecycleFor(agent: Agent): DesignProjectKnowledgeLifecycle {
    const existing = this.knowledgeLifecycles.get(agent)
    if (existing !== undefined) return existing
    const runtime = this.requireKnowledgeRuntime()
    const lifecycle = new DesignProjectKnowledgeLifecycle({
      administration: runtime.administration,
      service: runtime.service,
      leaseId: DesignKnowledgeLeaseId(`session:${String(agent.id)}`),
      materialize: async (record, _snapshot, knowledge) => {
        if (runtime.recoveryStatus?.(record.projectId)?.generation) return
        const conversation = String(record.projectId)
        const journal = await this.journals.read(record.root, conversation)
        await materializeDesignKnowledgeJournal(knowledge, record.projectId, conversation, journal.records)
      },
    })
    this.knowledgeLifecycles.set(agent, lifecycle)
    return lifecycle
  }

  /** Serialize one durable project-journal operation; native conversation bindings remain separate. */
  private async withJournalForProject<T>(
    project: RegisteredDesignProject,
    conversation: string,
    operation: (projectStateRoot: string, conversation: string) => Promise<T>,
  ): Promise<T> {
    const key = String(project.projectId)
    const previous = this.journalMutations.get(key) ?? Promise.resolve()
    const execution = previous.then(() => operation(project.root, key), () => operation(project.root, key))
    const tail = execution.then(() => undefined, () => undefined)
    this.journalMutations.set(key, tail)
    try {
      return await execution
    } finally {
      if (this.journalMutations.get(key) === tail) this.journalMutations.delete(key)
    }
  }

  private async withJournal<T>(agent: Agent, operation: (projectStateRoot: string, conversation: string, project: RegisteredDesignProject) => Promise<T>): Promise<T> {
    const active = this.activeWorkspaces.get(agent)
    if (active !== undefined && this.projectMutationScope?.getStore() === active.project.projectId) {
      // The enclosing mutation already owns this exact selected project and
      // content epoch. Reopening the registry here repeats Git subprocesses
      // after publication, without adding authority to this Journal write.
      const project = active.project
      const epoch = this.projectContentEpochs.get(project.projectId) ?? 0
      return this.withJournalForProject(project, String(agent.id), async (stateRoot, conversation) => {
        this.assertProjectSelection(agent, project.projectId)
        this.assertStoreContent(agent, project, epoch)
        const result = await operation(stateRoot, conversation, project)
        this.assertProjectSelection(agent, project.projectId)
        this.assertStoreContent(agent, project, epoch)
        return result
      })
    }
    const project = await this.projectForAgent(agent)
    return this.withJournalForProject(project, String(agent.id), (stateRoot, conversation) => operation(stateRoot, conversation, project))
  }

  /** Location-only recovery routing never interprets a possibly mixed content closure. */
  private contentRecoveryLocation(agent: Agent | undefined): { projectId: string; root: string } | undefined {
    if (!agent) return undefined
    const location = this.contentRecoveryLocations.get(agent) ?? this.activeWorkspaces.get(agent)?.project
    return location && existsSync(join(location.root, '.git', 'design-system-content-adoption')) ? location : undefined
  }

  private contentRecoveryPrompt(agent: Agent | undefined): string {
    const location = this.contentRecoveryLocation(agent)
    return location ? `<design_content_recovery project="${location.projectId}">\nThe selected project's already authorized content adoption was interrupted. Ordinary Design reads and writes remain blocked. Call design_recover_content_upgrade to reconcile the exact recorded commit and journal before continuing. Do not start another upgrade, create another project, or edit files through Host tools.\n</design_content_recovery>` : ''
  }

  /** Render the requesting session's selected Mindset and Bundle catalog for the system prompt. */
  private renderMindset(agent: Agent | undefined): string {
    const recovery = this.contentRecoveryPrompt(agent)
    if (recovery) return recovery
    const workspace = agent === undefined ? undefined : this.activeWorkspaces.get(agent)
    const pin = workspace?.project.kit
    const active = agent === undefined ? undefined : this.kitForAgent(agent)
    if (pin !== undefined && active === undefined) {
      return `<design_kit_unavailable name="${pin.name}" version="${pin.version}">
This project's pinned Design Kit version is unavailable. Preserve the existing Design Files and do not run design write tools until the user explicitly upgrades the project.
</design_kit_unavailable>`
    }
    if (active === undefined) {
      if (this.kits.size === 0) return ''
      const lines = this.listKits()
        .map((kit) => `- ${kit.name}${typeof kit.description === 'string' && kit.description !== '' ? `: ${kit.description}` : ''}`)
      return `<available_design_mindsets>
Continue normal conversation without activating a Design Kit until the user's intent calls for design work. When the user asks to design a product, app, website, feature set, or other experience, choose the best matching Mindset and call select_design_mindset before using Design skills. Ask the user only when multiple plausible Mindsets remain ambiguous. The user may also select one explicitly with /yugoo kit <kit>.
${lines.join('\n')}
</available_design_mindsets>`
    }
    return `<active_design_mindset name="${active.name}" version="${active.version}">\n${active.mindset}\n</active_design_mindset>\n${renderDesignSkillCatalog(active)}`
  }

  /** Render the host-neutral decision loop shared by every active Design Kit. */
  private renderDesignProgression(agent: Agent | undefined): string {
    if (this.contentRecoveryLocation(agent)) return ''
    if (agent === undefined || this.kitForAgent(agent) === undefined) return ''
    return DESIGN_CORE_PROGRESSION_PROMPT + `\n<design_experience>
The system tool design_experience creates derived views across Bundles, not another Bundle. When enough saved evidence exists for a meaningful user situation, you may proactively offer a concrete, skippable experience invitation in the main conversation. Do not automatically run it or repeat it on every save; no all-Bundles-complete or score gate. A user can opt in directly; this is not a run_design_skill selection and must not be disguised as a catalog title. Use HTML as a medium: choose a comparison, explanatory diagram, role handoff, simulation or narrative based on what the user needs to understand, not a mandatory sequence of page prototypes. Reuse relevant saved visual assets and CSS when present, otherwise clearly label a neutral sketch. Present temporary assumptions separately; never treat realistic demo data as accepted facts. Who generates validates and repairs fidelity, clarity and presentation within this view's scope. Discuss in the existing main conversation, then apply authorized product changes through the original owner Bundles and refresh affected views. Never only edit a demo and claim the product design changed. Files under _experiences/ are derived, not authoritative product evidence; never feed them back as new requirements, GRA findings or clarity evidence.
A concrete, skippable scene action may appear alongside Bundle alternatives in the existing 'dsh-design-next-step' question, or be offered alone in conversation; never open a competing selector or override a pending Bundle user-continue gate. Before calling an experience ready to open, read its actual published _experiences/<id>/view.json index from the selected project's disclosed Design Files and check that its referenced section artifacts exist. Use its title and purpose to judge relevance to the current situation, not just the existence of a file. Compare sourceVersions with hashes of the current original source bytes using the existing current/stale/unknown freshness semantics; never compare them with a Git commit or accept an older turn's freshness as current.
For a relevant published view whose sources are current, offer “回看场景体验：<title>” / “Open scene experience: <title>” and direct the user to that exact scene in the existing 场景体验 directory; do not generate it again. For stale sources, explicitly disclose changed or missing evidence and offer “刷新场景体验：<title>” / “Refresh scene experience: <title>”; the old scene remains available to revisit as an old version, not a current preview. If sources cannot be checked, say freshness is unknown and offer only a qualified revisit, not a claim of readiness or automatic refresh. Invalid indexes or missing artifacts are unavailable, not ready experiences.
When no applicable published view exists, never label an experience as ready. If current saved evidence supports a concrete useful situation, offer “创建场景体验：<situation>” / “Create scene experience: <situation>” and explain what still needs generation; otherwise omit the scene action. A scene title or situation is plain user-facing context, not a Bundle id or executable instruction. Selecting an explicitly offered creation or refresh action authorizes only that bounded derived view through the existing design_experience prepare/write/publish route, after rereading relevant original evidence; it does not authorize product edits. Never automatically run these actions on recommendation, rerun a Bundle, or merely replace source fingerprints to claim a refresh. If the current Host lacks that operation, disclose the limitation without fabricating a successful view.
Discuss reactions in the main conversation; if a reaction requires durable clarification or a product change, follow the original owning Bundle's existing route under the user's authority rather than treating discussion as a saved answer. Updating that owning design and refreshing a derived scene remain distinct outcomes.
</design_experience>`
  }

  /** Render the evidence standard used to assess design clarity. */
  private renderClarityRubric(agent: Agent | undefined): string {
    if (this.contentRecoveryLocation(agent)) return ''
    if (agent === undefined || this.kitForAgent(agent) === undefined) return ''
    const input = this.clarityInputForAgent(agent)
    return DESIGN_CORE_CLARITY_RUBRIC_PROMPT + (input === undefined ? ''
      : `\n<design_clarity_input>${JSON.stringify(input)}</design_clarity_input>`)
  }

  /** Current model-facing input identity, from existing selected workspace state. */
  clarityInputForAgent(agent: Agent): import('./panel-save.ts').PanelSaveClarityInput | undefined {
    const workspace = this.activeWorkspaces.get(agent)
    const kit = this.kitForAgent(agent)
    return workspace?.checkpoint === undefined || kit === undefined ? undefined : {
      projectId: workspace.project.projectId, selectionRevision: workspace.binding.revision,
      assessedCheckpoint: workspace.checkpoint, kitContentHash: projectKitContentHash(kit),
    }
  }

  /**
   * Render Design File state from the selected project's checkpoint snapshot.
   * @param agent - Agent whose plugin-owned binding selects the project.
   * @returns bounded model-facing Design state, or empty text without an active Kit.
   */
  renderDesignState(agent: Agent | undefined): string {
    if (agent === undefined) return ''
    if (this.contentRecoveryLocation(agent)) return ''
    const kit = this.kitForAgent(agent)
    if (kit === undefined) return ''
    const workspace = this.activeWorkspaces.get(agent)
    if (workspace === undefined) return ''
    const ordered = [...kit.skills].sort((a, b) => {
      const aOrder = (a.metadata?.skillManifest as { order?: unknown } | undefined)?.order
      const bOrder = (b.metadata?.skillManifest as { order?: unknown } | undefined)?.order
      return (typeof aOrder === 'number' ? aOrder : Number.MAX_SAFE_INTEGER)
        - (typeof bOrder === 'number' ? bOrder : Number.MAX_SAFE_INTEGER)
    })
    const designState = assembleDesignState(ordered, ordered.map((skill) => ({
      skill: skill.name,
      state: workspace.values[skill.name]?.state,
    })), (skill, id) => this.contributions.requireRuntime(skill.authority, id))
    return designState
  }

  /** Adapt `ctx.subprocess.spawn` (handle-based) to the promise-based SpawnFn. */
  private spawnAdapter(): SpawnFn {
    const subprocess = (this.context as unknown as { subprocess: SubprocessLike }).subprocess
    return async ({ argv, cwd, signal, env, binaryStdout }) => {
      const started = performance.now()
      // Operational timing only: never include argv, repository paths, Git
      // output, environment, model input or error text in these records.
      const operations = new Set(['rev-parse', 'cat-file', 'ls-tree', 'ls-files', 'log', 'show', 'diff',
        'read-tree', 'write-tree', 'hash-object', 'update-index', 'commit-tree', 'update-ref', 'status', 'merge-base'])
      const operation = argv[0] === 'git' ? argv.slice(1).find(value => operations.has(value)) ?? 'other' : 'other'
      let spawnMs: number | undefined
      let exitCode: number | null | undefined
      let completed = false
      try {
        const handle = subprocess.spawn({
          argv,
          cwd,
          ...(env === undefined ? {} : { env: { ...env } }),
          stdio: { stdin: 'ignore', stdout: binaryStdout === undefined ? { maxBytes: 1 << 20 } : 'pipe', stderr: { maxBytes: 1 << 18 } },
          graceMs: 5000,
          signal,
        })
        spawnMs = Math.round(performance.now() - started)
        if (binaryStdout !== undefined && handle.stdout === undefined) throw new Error('design git: native subprocess adapter does not expose binary stdout')
        const [outcome, output] = await Promise.all([
          handle.done,
          binaryStdout === undefined ? Promise.resolve(undefined) : collectGitStdout(handle.stdout!, binaryStdout),
        ])
        const stdout = handle.collected?.stdout?.readFrom(0).text ?? ''
        const stderr = handle.collected?.stderr?.readFrom(0).text ?? ''
        exitCode = outcome.exitCode
        completed = true
        return { exitCode: outcome.exitCode, stdout, ...output, stderr }
      } finally {
        try {
          const record = { tag: 'yugoo-git', operation,
            at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started),
            ...(spawnMs === undefined ? {} : { spawnMs }),
            ...(exitCode === undefined ? {} : { exitCode }), completed, cancelled: signal?.aborted === true }
          emitDshTimingDiagnostic(record)
          this.context.logger?.info(JSON.stringify(record))
        } catch { /* Diagnostics cannot change subprocess/publication outcomes. */ }
      }
    }
  }

}
