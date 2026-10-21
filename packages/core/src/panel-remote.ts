/**
 * Panel save round-trip (host side): a Typert Remote the design panel's browser
 * half calls when the user saves an edited panel. The save is schema-validated,
 * written to Design Files, Git-committed, recorded in DesignJournal, and the
 * authoritative diff note is injected for the model's next turn. The `readArtifact` remote
 * serves heavy design_files artifacts (BPMN XML, findings, preview HTML) to the
 * panel on demand.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createYugooDesignMessage } from './dsh-message-source.ts'
import { allocateDshSaveScopeId, emitDshTimingDiagnostic } from './dsh-timing-diagnostics.ts'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { designSessionEvents } from './dsh-session-events.ts'
import { designClarityInputMatches } from './design-clarity-report.ts'
import { projectKitContentHash } from './project-content.ts'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import { createHash, randomUUID } from 'node:crypto'
import { workspacePollResult, type WorkspacePollResult } from './workspace-poll.ts'
import { activeMainBundleWork } from './dsh-main-bundle.ts'
import type DesignService from './design-service.ts'
import { DesignGraphReadRaceError } from './design-service.ts'
import type { DesignReviewPolicy } from './design-review-policy.ts'
import type { DesignAdvisoryRuntimeStatus } from './advisory-runtime-status.ts'
import type { DesignKnowledgeStatusSnapshot } from './design-knowledge-status.ts'
import { KnowledgeReadProgress } from './knowledge-read-progress.ts'
import { readDesignGraph } from './design-graph.ts'
import { designOntologyCoverage } from './design-ontology.ts'
import { applyPanelEdit, buildPanelSaveNote, parsePanelArtifacts } from './panel-save.ts'
import { projectWorktreeDesign, WORKTREE_REVISION_PREFIX } from './panel-worktree.ts'
import { assertAutoPanelSave, readAutoPanelCache } from './auto-panel-cache.ts'
import { type AutoPanelContext } from './auto-panel-spec.ts'
import { resolveAutoPanel, assertResolvedAutoPanelSave } from './auto-panel-resolution.ts'
import { saveAutoPanelDefinition } from './saved-auto-panel-store.ts'
import { generateAutoPanel } from './auto-panel-generation.ts'
import { dshAutoPanelGenerationPort } from './dsh-auto-panel-model.ts'
import { AutoPanelJobs, type AutoPanelJobState } from './auto-panel-jobs.ts'
import { AutoPanelReconcileFence } from './auto-panel-reconcile-fence.ts'
import { isDeepStrictEqual } from 'node:util'
import type { WorktreeProjection } from './panel-worktree.ts'
import { validatorFromSchemaYaml, parseSchemaYaml, type SchemaSpec } from './schema.ts'
import { parseValidationYaml, evaluateValidationRules } from './validation-rules.ts'
import { panelGraphSaveRules } from './panel-graph-save-rules.ts'
import { coerceObjectState, nodeFs, requireKitSkill } from './service-tools.ts'
import { pendingMustEditAuthorityForSave } from './design-execution-handoff-authority.ts'
import { deriveCurrentDesignExecutionGate } from './design-execution-derivation.ts'
import { deriveDesignContinuation, deriveDesignMustEditHandoff, type DesignContinuationDescriptor, type DesignMustEditHandoffDescriptor } from './design-continuation.ts'
import type { DesignJournalValue } from './design-journal-payloads.ts'
import type { DesignClarityActivity, DesignClarityAssessment, DesignClarityExplanation, DesignExecutionAttemptPayload, DesignSkill } from './types.ts'
import type { SavedDesignAssessmentRequest, SettledDesignPanelSave } from './design-clarity-runtime.ts'
import {
  type DesignAdvisoryDecisionPayload,
  type SessionDesignAdvisory,
} from './design-advisory-events.ts'

/** Only existing Bundle-owned artifacts can be named by generated UI. */
function autoArtifactInventory(files: Readonly<Record<string, string>> | undefined, bundle: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(files ?? {}).filter(([path]) => path.startsWith(`${bundle}/`)
    && path !== `${bundle}/${bundle}.json` && !path.includes('/attachments/')).slice(0, 30))
}

/** Deployment bounds for browser-facing binary Design File reads. */
export interface Config {
  /** Maximum decoded bytes returned by one binary artifact request. */
  readonly maxBinaryArtifactBytes: number
}

/** Browser-facing binary artifact response. */
export interface BinaryArtifactRead {
  readonly found: boolean
  readonly mediaType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp'
  /** Raw RFC 4648 base64, never a Data URL. */
  readonly base64: string
  readonly byteLength: number
}

/** One native child-session transcript row for rolling observability. */
export interface DesignExecutionLogEntry {
  readonly seq: number
  readonly timestamp: number
  readonly eventType: 'message' | 'search' | 'fetch' | 'synthesize' | 'error'
  readonly message: string
  readonly url?: string
}

/** Browser-safe projection of one authorized child session log. */
export interface DesignExecutionLogRead {
  readonly found: boolean
  readonly revision: string | null
  /**
   * True when the server could not extend from its cursor cache (cache loss or a
   * changed seed), so `entries` is the full snapshot and the client must discard
   * its accumulated transcript and replace it rather than append.
   */
  readonly reset: boolean
  readonly entries: readonly DesignExecutionLogEntry[]
}

interface ExecutionLogProjection {
  readonly seedLength: number
  readonly lastSeq: number
  readonly calls: ReadonlyMap<string, { readonly name: string; readonly eventType: DesignExecutionLogEntry['eventType']; readonly url?: string }>
  readonly entries: readonly DesignExecutionLogEntry[]
}

function entriesAfter(entries: readonly DesignExecutionLogEntry[], afterSeq: number | undefined): readonly DesignExecutionLogEntry[] {
  if (afterSeq === undefined) return entries
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((entries[middle]?.seq ?? Number.MAX_SAFE_INTEGER) <= afterSeq) low = middle + 1
    else high = middle
  }
  return entries.slice(low)
}

/** Find the first persisted event after one monotonic Host sequence cursor. */
function eventIndexAfterSeq(
  events: readonly SessionEvent[],
  afterSeq: number,
  minimumIndex: number,
): number {
  let low = Math.min(minimumIndex, events.length)
  let high = events.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if ((events[middle]?.seq ?? Number.MAX_SAFE_INTEGER) <= afterSeq) low = middle + 1
    else high = middle
  }
  return low
}

/** Browser-safe project directory and installed Mindset catalog. */
export interface DesignProjectCatalogRead {
  readonly currentProjectId: string | null
  readonly projects: readonly {
    readonly projectId: string
    readonly name: string
    readonly root: string
    readonly updatedAt: string
    readonly kit?: { readonly name: string; readonly version: string }
  }[]
  readonly mindsets: readonly {
    readonly name: string
    readonly version: string
    readonly description?: string
  }[]
}

/** Browser-safe process-local execution observation in Host sequence order. */
export interface DesignExecutionAttemptRead extends DesignExecutionAttemptPayload {
  readonly sequence: number
  readonly timestamp: number
}

/** Plugin-owned Design workspace snapshot consumed by browser Host Adapters. */
export interface DesignPanelWorkspaceRead {
  /** Opaque selected Design Project id, or null before `/yugoo new|open`. */
  readonly projectId: string | null
  /** Human-readable selected Design Project name, or null before binding. */
  readonly projectName: string | null
  /** Selected Design Project system directory, or null before `/yugoo new|open`. */
  readonly projectPath: string | null
  /** Exact committed project checkpoint from which `design` was loaded. */
  readonly checkpoint: string | null
  /** Current parseable Design Files worktree identity used for live panel reads. */
  readonly worktreeRevision: string | null
  /** File preview remains available when publication authority cannot be read. */
  readonly publicationError?: string
  /** Nonempty readable worktree files keyed by relative path, valued by content hash. */
  readonly artifactFiles?: Readonly<Record<string, string>>
  /** Published system views at checkpoint, independent of worktree deletions/drafts. */
  readonly experienceFiles?: Readonly<Record<string, string>>
  /** Native execution observability; independent of Design File publication. */
  readonly executionRevision: number
  readonly executionAttempts: readonly DesignExecutionAttemptRead[]
  readonly artifactActivities?: readonly import('./artifact-activity.ts').DesignArtifactActivityRead[]
  /** Existing main-Agent engagement for this selected project; not a Producer record. */
  readonly activeMainBundles?: readonly { readonly skill: string; readonly invocationId: string }[]
  /** Project access derived from the authoritative Kit pin at read time. */
  readonly access:
    | { readonly mode: 'unbound'; readonly writable: false }
    | { readonly mode: 'unconfigured'; readonly writable: false }
    | {
        readonly mode: 'recovery'
        readonly writable: false
        readonly kit: { readonly name: string; readonly version: string }
        readonly upgradeCommand?: string
      }
    | {
        readonly mode: 'writable'
        readonly writable: true
        readonly kit: { readonly name: string; readonly version: string }
      }
  /** Exact DesignJournal revision from which `design` was folded. */
  readonly journalRevision: number
  /** Latest state per skill, folded from the selected conversation's DesignJournal. */
  readonly design: Readonly<Record<string, DesignJournalValue>>
  /** Validated derived auto views; never authoritative Design File content. */
  readonly autoPanelManifests?: Readonly<Record<string, string>>
  readonly autoPanelDefinitions?: Readonly<Record<string, { origin?: 'generated' | 'retained'; definitionRevision?: string; sourceChanged?: boolean; error?: string }>>
  /** Process-local generation progress. It grants no write authority. */
  readonly autoPanelStates?: Readonly<Record<string, AutoPanelJobState>>
  /** Real Runtime-derived user-continue gates; never inferred from Bundle JSON fields. */
  readonly continuations: readonly DesignContinuationDescriptor[]
  /** Display-only real edit gates; saving still uses the existing authority path. */
  readonly mustEditHandoffs: readonly DesignMustEditHandoffDescriptor[]
  /** Current selected project's real GRA scheduler status; no scheduling authority. */
  readonly advisoryRuntime?: DesignAdvisoryRuntimeStatus
  /** Latest clarity assessment from the project authority and its staleness. */
  readonly clarity: {
    readonly assessment: DesignClarityAssessment | null
    readonly needsReassessment: boolean
    readonly explanation?: DesignClarityExplanation
    readonly activity?: DesignClarityActivity
  }
  /** Latest Design Files publication, used only for automatic panel focus. */
  readonly latestDesignChange?: {
    readonly skill: string
    readonly journalRevision: number
  }
}

// Live-file projection is shared with companion hosts.

function positiveSafeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`design panel: ${name} must be a positive safe integer`)
  }
  return value as number
}

function executionToolEventType(name: string): DesignExecutionLogEntry['eventType'] {
  const normalized = name.toLowerCase()
  if (normalized.includes('search')) return 'search'
  if (normalized.includes('fetch') || normalized === 'open' || normalized.includes('browse')) return 'fetch'
  return 'synthesize'
}

/** Mirror the native WebBlock href guard: only a parseable http(s) URL is link-safe. */
function safeExecutionHref(url: string): string | undefined {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : undefined
  } catch {
    return undefined
  }
}

/**
 * Surface a tool call's salient short identifier the way native tool cards title
 * themselves: search query, fetch URL, or file path. Only short identifier keys
 * are read, so a read or write surfaces its path, never the file text; argument
 * bodies and result content are not projected. A URL becomes a clickable link
 * only when it is a parseable http(s) target, matching the native href guard, so
 * a javascript:/data:/file:/relative argument never reaches the rendered anchor;
 * the full safe URL is kept as the href while the message shows a truncated form.
 */
function executionToolDetail(name: string, rawArguments: string): { readonly message: string; readonly url?: string } {
  let args: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(rawArguments) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
  } catch {
    // Keep the tool name when a partial model argument stream was persisted.
  }
  const identifier = (keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 200)
    }
    return undefined
  }
  const rawIdentifier = (keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = args[key]
      if (typeof value === 'string' && value.trim() !== '') return value.trim()
    }
    return undefined
  }
  const queries = Array.isArray(args.queries)
    ? args.queries.filter((query): query is string => typeof query === 'string' && query.trim() !== '').map(query => query.trim())
    : []
  const query = identifier(['query', 'q']) ?? (queries.length === 0 ? undefined : queries.join(', ').slice(0, 200))
  const rawUrl = rawIdentifier(['url', 'ref_id'])
  const url = rawUrl === undefined ? undefined : safeExecutionHref(rawUrl)
  const path = identifier(['file_path', 'path', 'target_file'])
  const eventType = executionToolEventType(name)
  const message = eventType === 'search'
    ? `搜索：${query ?? name}`
    : eventType === 'fetch'
      ? `读取：${url === undefined ? name : url.slice(0, 200)}`
      : name === 'run_skill_script'
        ? `运行脚本：${path ?? name}`
      : path !== undefined
        ? `${/(?:write|edit|create|publish)/iu.test(name) ? '写入' : '读取'}文件：${path}`
        : name === 'structured_output'
          ? '整理并校验调研结果'
          : `运行：${name}`
  return { message, ...(url === undefined ? {} : { url }) }
}

/** Expose top-level Assistant visible text and reasoning; redacted (empty-text) reasoning and Tool-result-nested reasoning stay hidden. */
function executionAssistantMessage(content: readonly unknown[]): string | undefined {
  const text = content.flatMap(block => {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) return []
    const candidate = block as { readonly type?: unknown; readonly text?: unknown }
    if (candidate.type !== 'text' && candidate.type !== 'reasoning') return []
    return typeof candidate.text === 'string' && candidate.text.trim() !== '' ? [candidate.text.trim()] : []
  }).join('\n')
  return text === '' ? undefined : text
}


/**
 * The `designPanel` remote: persists one browser-side panel save, serves
 * design_files artifacts, and notifies the owning agent.
 */
export class DesignPanelRemote extends TypertRemoteService {
  private readonly knowledgeReads = new KnowledgeReadProgress<{ content: string }>()
  /** Successful immutable publications only; never cache a preview, failed read, or live generation. */
  private readonly graphReads = new Map<string, { head: string; revision: string; kit: string; content: string }>()
  /** The design seam supplies the store factory and the active kit. */
  static inject = ['design', 'sessions', 'sessionPersistence']

  /** The design seam (hard dependency named by {@link inject}). */
  private readonly design: DesignService
  private readonly hostContext: Context
  private readonly maxBinaryArtifactBytes: number
  private readonly worktreeProjections = new Map<string, WorktreeProjection>()
  private continuationReads = new WeakMap<Agent, { key: string; value: readonly DesignContinuationDescriptor[]; mustEditHandoffs: readonly DesignMustEditHandoffDescriptor[] }>()
  private readonly executionLogReads = new Map<string, ExecutionLogProjection>()
  private readonly autoPanelJobs = new AutoPanelJobs()
  private autoPanelReconcileSequence = 0
  private readonly autoPanelReconcileFence = new AutoPanelReconcileFence()

  /**
   * @param ctx - Cordis context; the service registers as `designPanel`.
   * @param config - required deployment bound for binary responses.
   */
  constructor(ctx: Context, config: Config | undefined) {
    super(ctx, 'designPanel')
    this.hostContext = ctx
    this.design = (ctx as unknown as { design: DesignService }).design
    this.maxBinaryArtifactBytes = positiveSafeInteger(
      config?.maxBinaryArtifactBytes,
      'maxBinaryArtifactBytes',
    )
    const unregister = this.design.registerWorkspaceChangeListener((change) => {
      if (change.kind !== 'selection-changed' && change.kind !== 'workspace-restored' && change.kind !== 'design-changed') return
      const sequence = ++this.autoPanelReconcileSequence
      const agentKey = String(change.agent.id)
      const owner = this.autoPanelReconcileFence.event(agentKey, sequence, change.kind !== 'design-changed')
      queueMicrotask(() => { void this.reconcileAutoPanels(change.agent, sequence, owner) })
    })
    ctx.effect(() => () => {
      unregister()
      this.autoPanelJobs.dispose()
      this.autoPanelReconcileFence.dispose()
    })
  }

  /** Reconcile only on a real project/Design event, never as a read side effect. */
  private async reconcileAutoPanels(agent: Agent, sequence: number, owner: string): Promise<void> {
    const signal = AbortSignal.timeout(60_000)
    try {
      const agentKey = String(agent.id)
      const currentAgent = (): boolean => this.autoPanelReconcileFence.currentAgent(agentKey, sequence)
      if (!currentAgent()) return
      const project = await this.design.selectedProjectForAgent(agent, signal)
      if (project === undefined || !currentAgent()) return
      const projectKey = String(project.projectId)
      if (!this.autoPanelReconcileFence.begin(projectKey, sequence)) return
      const workspace = await this.readWorkspace(agent, signal)
      if (!currentAgent() || !this.autoPanelReconcileFence.current(projectKey, sequence)) return
      if (workspace.projectId !== project.projectId || workspace.access.mode !== 'writable') return
      const pin = workspace.access.kit
      const kit = this.design.requireKitForAgent(agent)
      if (kit.name !== pin.name || kit.version !== pin.version) return
      for (const skill of kit.skills) {
        if (!currentAgent() || !this.autoPanelReconcileFence.current(projectKey, sequence)) return
        const manifest = skill.metadata?.skillManifest as { presentation?: { mode?: string } } | undefined
        if (manifest?.presentation?.mode !== 'auto' || typeof skill.metadata?.schemaYaml !== 'string') continue
        const state = workspace.design[skill.name]?.state
        if (typeof state !== 'object' || state === null || Array.isArray(state)) continue
        const context: AutoPanelContext = {
          kit: kit.name, kitVersion: String(kit.version), bundle: skill.name, bundleVersion: String(skill.version),
          schema: parseSchemaYaml(skill.metadata.schemaYaml), state: state as Record<string, unknown>,
          artifacts: autoArtifactInventory(workspace.artifactFiles, skill.name),
        }
        const cached = await resolveAutoPanel({ definitionRoot: project.root, cacheRoot: project.stateRoot }, context)
        if (!currentAgent() || !this.autoPanelReconcileFence.current(projectKey, sequence)) return
        if (cached.status !== 'needs-generation') continue
        const key = `${project.projectId}:${skill.name}`
        const target = createHash('sha256').update(JSON.stringify([context, workspace.worktreeRevision])).digest('hex')
        this.autoPanelJobs.request(key, target, owner, async (jobSignal) => {
          const deadline = AbortSignal.any([jobSignal, AbortSignal.timeout(60_000)])
          const result = await generateAutoPanel({
            context,
            stateRoot: project.stateRoot,
            port: dshAutoPanelGenerationPort(agent),
            signal: deadline,
            currentContext: async () => {
              const currentProject = await this.design.selectedProjectForAgent(agent, deadline)
              const current = await this.readWorkspace(agent, deadline)
              if (currentProject?.projectId !== project.projectId || current.access.mode !== 'writable'
                || current.access.kit.name !== pin.name || current.access.kit.version !== pin.version) {
                throw new Error('auto panel: project or Kit changed during generation')
              }
              const currentKit = this.design.requireKitForAgent(agent)
              const currentSkill = requireKitSkill(currentKit, skill.name)
              const currentManifest = currentSkill.metadata?.skillManifest as { presentation?: { mode?: string } } | undefined
              if (currentManifest?.presentation?.mode !== 'auto' || typeof currentSkill.metadata?.schemaYaml !== 'string') {
                throw new Error('auto panel: Bundle presentation changed during generation')
              }
              const currentState = current.design[skill.name]?.state
              if (typeof currentState !== 'object' || currentState === null || Array.isArray(currentState)) {
                throw new Error('auto panel: source Design File disappeared')
              }
              return {
                ...context,
                kit: currentKit.name,
                kitVersion: String(currentKit.version),
                bundleVersion: String(currentSkill.version),
                schema: parseSchemaYaml(currentSkill.metadata.schemaYaml),
                state: currentState as Record<string, unknown>,
                artifacts: autoArtifactInventory(current.artifactFiles, skill.name),
              }
            },
          })
          if (result.status !== 'published') throw new Error(`auto panel: generation ${result.status}${result.status === 'invalid' ? `: ${result.reason}` : ''}`)
          return { attempts: result.attempts, ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }) }
        })
      }
    } catch {
      // Derived UI must never fail or delay a project/Design event.
    }
  }

  /**
   * Read one authorized Producer/Worker transcript. This is observability only:
   * it never overlays canonical Design status or writes trace copies to JSON.
   */
  async readExecutionLog(
    agent: Agent,
    executionRef: string,
    afterSeq: number | undefined,
    signal: AbortSignal,
  ): Promise<DesignExecutionLogRead> {
    signal.throwIfAborted()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(executionRef)) {
      throw new Error('design panel: invalid execution ref')
    }
    if (afterSeq !== undefined && (!Number.isSafeInteger(afterSeq) || afterSeq < 0)) {
      throw new Error('design panel: execution log cursor must be a non-negative safe integer')
    }
    type Inspection = { readonly meta: SessionHeader; readonly events: readonly SessionEvent[]; readonly inheritedEventCount?: number }
    const services = this.hostContext as unknown as {
      readonly sessions?: { get(id: ReturnType<typeof SessionId>): { readonly header: SessionHeader; readonly inheritedEventCount?: number; snapshotEvents?: () => readonly SessionEvent[]; readonly events?: readonly SessionEvent[] } | undefined }
      readonly sessionPersistence?: { inspect(id: ReturnType<typeof SessionId>, signal?: AbortSignal): Promise<Inspection> }
    }
    const inspect = async (id: ReturnType<typeof SessionId>): Promise<Inspection | undefined> => {
      const live = services.sessions?.get(id)
      if (live !== undefined) return { meta: live.header, events: designSessionEvents(live), inheritedEventCount: live.inheritedEventCount }
      try {
        return await services.sessionPersistence?.inspect(id, signal)
      } catch {
        return undefined
      }
    }
    // The Design plugin binds every live Producer/Worker run id to its owning
    // conversation in process memory. Restarted Hosts intentionally do not
    // restore stale execution UI state; completed Design Files remain durable.
    const authorized = this.design.ownsExecutionRun(agent, executionRef)
    if (!authorized) throw new Error('design panel: execution ref does not belong to this conversation')
    const child = await inspect(SessionId(executionRef))
    if (child === undefined) return { found: false, revision: null, reset: false, entries: Object.freeze([]) }
    // The inherited prefix belongs to the session inspection, not its header.
    // Never use a legacy header field to bypass the seeded-session boundary check.
    const inherited = child.inheritedEventCount
    if (inherited === undefined && (child.meta as { readonly isSeeded?: boolean }).isSeeded === true) {
      throw new Error('design panel: seeded execution transcript has no inherited-history boundary')
    }
    if (inherited !== undefined && (!Number.isSafeInteger(inherited) || inherited < 0 || inherited > child.events.length)) {
      throw new Error('design panel: invalid inherited-history boundary')
    }
    const seedLength = inherited ?? 0
    const last = child.events.length > seedLength ? child.events.at(-1) : undefined
    const lastSeq = last?.seq ?? -1
    const cached = this.executionLogReads.get(executionRef)
    const extend = cached !== undefined && cached.seedLength === seedLength && cached.lastSeq <= lastSeq
    let projection: ExecutionLogProjection
    if (cached !== undefined && extend && cached.lastSeq === lastSeq) {
      projection = cached
    } else {
      const calls = new Map(extend && cached !== undefined ? cached.calls : [])
      const entries: DesignExecutionLogEntry[] = extend && cached !== undefined ? [...cached.entries] : []
      const start = extend && cached !== undefined
        ? eventIndexAfterSeq(child.events, cached.lastSeq, seedLength)
        : seedLength
      for (const event of child.events.slice(start)) {
        if (event.type === 'assistant/message') {
          const message = executionAssistantMessage(event.data.message.content)
          if (message !== undefined) entries.push(Object.freeze({
            seq: event.seq,
            timestamp: event.time,
            eventType: 'message',
            message,
          }))
        } else if (event.type === 'tool/call') {
          const eventType = executionToolEventType(event.data.name)
          const detail = executionToolDetail(event.data.name, event.data.arguments)
          calls.set(String(event.data.callId), { name: event.data.name, eventType, ...(detail.url === undefined ? {} : { url: detail.url }) })
          entries.push(Object.freeze({
            seq: event.seq,
            timestamp: event.time,
            eventType,
            message: detail.message,
            ...(detail.url === undefined ? {} : { url: detail.url }),
          }))
        } else if (event.type === 'tool/result') {
          const call = calls.get(String(event.data.message.source.callId))
          const failed = event.data.error !== undefined
            || event.data.message.isError === true
          if (failed) entries.push(Object.freeze({
            seq: event.seq,
            timestamp: event.time,
            eventType: 'error',
            message: `${call?.name ?? 'tool'} · failed${event.data.error === undefined ? '' : ` (${event.data.error.code})`}`,
            ...(call?.url === undefined ? {} : { url: call.url }),
          }))
        }
      }
      projection = Object.freeze({
        seedLength,
        lastSeq,
        calls,
        entries: Object.freeze(entries),
      })
      this.executionLogReads.delete(executionRef)
      this.executionLogReads.set(executionRef, projection)
    }
    // Refresh LRU recency without rebuilding an unchanged transcript.
    if (projection === cached) {
      this.executionLogReads.delete(executionRef)
      this.executionLogReads.set(executionRef, projection)
    }
    while (this.executionLogReads.size > 256) {
      const oldest = this.executionLogReads.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.executionLogReads.delete(oldest)
    }
    const reset = afterSeq !== undefined && !extend
    return Object.freeze({
      found: true,
      revision: `${executionRef}:${lastSeq}`,
      reset,
      entries: Object.freeze(reset ? projection.entries : entriesAfter(projection.entries, afterSeq)),
    })
  }

  /** List all registered projects and installed Mindsets without mutating either. */
  async listProjects(
    agent: Agent,
    signal: AbortSignal,
  ): Promise<DesignProjectCatalogRead> {
    signal.throwIfAborted()
    return this.design.listProjectCatalog(agent, signal)
  }

  /**
   * Read the plugin-owned workspace for one host conversation.
   * @param agent - Agent whose durable binding selects the Design Project.
   * @param signal - cancellation for project and journal reads.
   * @returns an empty snapshot without a binding, otherwise one exact journal fold.
   */
  async readReviewPolicy(agent: Agent, signal: AbortSignal): Promise<DesignReviewPolicy> {
    return this.design.readReviewPolicy(agent, signal)
  }

  async updateReviewPolicy(agent: Agent, policy: unknown, signal: AbortSignal): Promise<DesignReviewPolicy> {
    return this.design.updateReviewPolicy(agent, policy, signal)
  }

  async readWorkspace(
    agent: Agent,
    signal: AbortSignal,
  ): Promise<DesignPanelWorkspaceRead> {
    const workspace = await this.design.withWorkspaceRead(agent, signal, () => this.readWorkspaceSnapshot(agent, signal))
    return workspace
  }

  async observePanelDraft(agent: Agent, observation: import('./project-content-guard.ts').PanelDraftObservation, signal: AbortSignal): Promise<{ observed: true }> {
    signal.throwIfAborted()
    await this.design.observeProjectPanel(agent, observation)
    return { observed: true }
  }

  async pollWorkspace(agent: Agent, knownRevision: string | null, signal: AbortSignal): Promise<WorkspacePollResult<DesignPanelWorkspaceRead>> {
    return workspacePollResult(await this.readWorkspace(agent, signal), knownRevision)
  }

  private async readWorkspaceSnapshot(agent: Agent, signal: AbortSignal): Promise<DesignPanelWorkspaceRead> {
    const project = await this.design.selectedProjectForAgent(agent, signal)
    if (project === undefined) {
      return {
        projectId: null,
        projectName: null,
        projectPath: null,
        checkpoint: null,
        worktreeRevision: null,
        artifactFiles: {},
        executionRevision: 0,
        executionAttempts: Object.freeze([]),
        access: { mode: 'unbound', writable: false },
        journalRevision: 0,
        design: Object.freeze({}),
        continuations: Object.freeze([]),
        mustEditHandoffs: Object.freeze([]),
        clarity: { assessment: null, needsReassessment: false },
      }
    }
    let publicationError: string | undefined
    const projectWorkspace = await this.design.readProjectWorkspaceSnapshot(agent, project.projectId, signal).catch((error: unknown) => {
      signal.throwIfAborted()
      this.design.assertProjectSelection(agent, project.projectId)
      publicationError = error instanceof Error ? error.message : String(error)
      return { checkpoint: null, design: {} as Readonly<Record<string, DesignJournalValue>>, kit: project.kit }
    })
    const store = this.design.displayFilesForProject
      ? await this.design.displayFilesForProject(agent, project, nodeFs)
      : await this.design.designFilesForProject(agent, project.projectId, nodeFs, signal)
    const pin = projectWorkspace.kit
    const kit = pin === undefined ? undefined : this.design.resolveProjectKit(pin)
    const worktreeKey = String(project.projectId)
    const kitDefinitionIdentity = kit === undefined
      ? 'unresolved'
      : `resolved:${createHash('sha256').update(kit.skills.map(skill => `${skill.name}\0${skill.metadata?.panelYaml ?? ''}\0${JSON.stringify(skill.metadata?.skillManifest ?? null)}`).join('\0')).digest('hex')}`
    const projectionBaseRevision = `${projectWorkspace.checkpoint}\0${pin?.name ?? ''}\0${pin?.version ?? ''}\0${kitDefinitionIdentity}`
    const worktree = await projectWorktreeDesign(
      store,
      projectWorkspace.design,
      kit?.skills ?? [],
      projectionBaseRevision,
      this.worktreeProjections.get(worktreeKey),
    )
    const autoPanelManifests: Record<string, string> = {}
    const autoPanelDefinitions: Record<string, { origin?: 'generated' | 'retained'; definitionRevision?: string; sourceChanged?: boolean; error?: string }> = {}
    const autoPanelStates: Record<string, AutoPanelJobState> = {}
    if (kit !== undefined) {
      await Promise.all(kit.skills.map(async (skill) => {
        const manifest = skill.metadata?.skillManifest as { presentation?: { mode?: string } } | undefined
        if (manifest?.presentation?.mode !== 'auto' || typeof skill.metadata?.schemaYaml !== 'string') return
        const state = worktree.design[skill.name]?.state
        if (typeof state !== 'object' || state === null || Array.isArray(state)) return
        try {
          const context = {
            kit: kit.name, kitVersion: String(kit.version), bundle: skill.name, bundleVersion: String(skill.version),
            schema: parseSchemaYaml(skill.metadata.schemaYaml), state: state as Record<string, unknown>,
            artifacts: autoArtifactInventory(Object.fromEntries([...worktree.fileDigests].map(([path, digest]) => [path, digest.sha256])), skill.name),
          }
          const cached = await resolveAutoPanel({ definitionRoot: project.root, cacheRoot: project.stateRoot }, context)
          if (cached.status === 'ready') {
            autoPanelManifests[skill.name] = JSON.stringify(cached.manifest)
            autoPanelDefinitions[skill.name] = { origin: cached.origin, definitionRevision: cached.definitionRevision, sourceChanged: cached.sourceChanged }
          } else if (cached.status === 'incompatible') autoPanelDefinitions[skill.name] = { error: cached.reason }
          const status = this.autoPanelJobs.status(`${project.projectId}:${skill.name}`)
          const target = createHash('sha256').update(JSON.stringify([context, worktree.revision])).digest('hex')
          if (cached.status !== 'incompatible' && !(cached.status === 'ready' && cached.origin === 'retained')
            && status?.target === target && (cached.status !== 'ready' || status.phase === 'ready')) autoPanelStates[skill.name] = status
        } catch {
          // Auto UI is optional derived state; invalid cache is read-only fallback.
        }
      }))
    }
    this.worktreeProjections.delete(worktreeKey)
    this.worktreeProjections.set(worktreeKey, worktree)
    while (this.worktreeProjections.size > 32) {
      const oldest = this.worktreeProjections.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.worktreeProjections.delete(oldest)
    }
    const journal = await this.design.readDesignJournal(agent)
    const authority = await this.design.readClarityAuthority(project.projectId, signal)
    const continuationKey = JSON.stringify([project.projectId, projectWorkspace.checkpoint, kit?.name, kit?.version,
      kit?.skills.map(skill => [skill.name, skill.version, skill.execution]), journal.revision])
    this.continuationReads ??= new WeakMap()
    const cachedContinuation = this.continuationReads.get(agent)
    let continuations: readonly DesignContinuationDescriptor[] = Object.freeze([])
    let mustEditHandoffs: readonly DesignMustEditHandoffDescriptor[] = Object.freeze([])
    let experienceFiles: Record<string, string> = {}
    let needsReassessment = authority !== undefined
    try {
    if (!publicationError && projectWorkspace.checkpoint !== null && kit !== undefined) {
      if (cachedContinuation?.key === continuationKey) {
        continuations = cachedContinuation.value
        mustEditHandoffs = cachedContinuation.mustEditHandoffs
      } else {
        const gates = await Promise.all(kit.skills.map(async (skill): Promise<{
          continuation?: DesignContinuationDescriptor
          mustEditHandoff?: DesignMustEditHandoffDescriptor
        }> => {
          if (skill.execution.handoff === 'none') return {}
          const rawState = projectWorkspace.design[skill.name]?.state
          const state = typeof rawState === 'object' && rawState !== null && !Array.isArray(rawState)
            ? rawState as Readonly<Record<string, unknown>>
            : undefined
          const gate = await deriveCurrentDesignExecutionGate({
            projectId: project.projectId,
            records: journal.records,
            kit,
            skill,
            stateRevision: projectWorkspace.checkpoint,
            state,
            store,
            signal,
          })
          if (gate?.kind === 'must_edit') return { mustEditHandoff: deriveDesignMustEditHandoff(gate) }
          if (gate?.kind !== 'user_continue') return {}
          let journalRevision: number | undefined
          for (let index = journal.records.length - 1; index >= 0; index -= 1) {
            const record = journal.records[index]
            if (record?.type !== 'design/changed') continue
            if (record.data.kit !== kit.name || record.data.version !== kit.version
              || record.data.skill !== skill.name
              || record.data.execution?.invocationId !== gate.invocationId) continue
            journalRevision = record.revision
            break
          }
          return { continuation: deriveDesignContinuation({
            gate,
            title: skill.title,
            ...(journalRevision === undefined ? {} : { journalRevision }),
          }) }
        }))
        continuations = Object.freeze(gates.flatMap(entry => entry.continuation ? [entry.continuation] : []))
        mustEditHandoffs = Object.freeze(gates.flatMap(entry => entry.mustEditHandoff ? [entry.mustEditHandoff] : []))
      }
    }
    this.continuationReads.set(agent, { key: continuationKey, value: continuations, mustEditHandoffs })
    if (projectWorkspace.checkpoint !== null) {
      experienceFiles = Object.fromEntries((await store.listPathsAt(projectWorkspace.checkpoint, signal))
        .filter(path => path.startsWith('_experiences/')).map(path => [path, projectWorkspace.checkpoint!]))
      needsReassessment = authority !== undefined && (kit === undefined
        || !(await store.sameDesignEvidenceAt(authority.assessedCheckpoint, projectWorkspace.checkpoint, signal))
        || !designClarityInputMatches(authority.report, { kit: kit.name, version: kit.version,
          kitContentHash: projectKitContentHash(kit) }))
    }
    } catch (error) {
      signal.throwIfAborted()
      publicationError = error instanceof Error ? error.message : String(error)
      continuations = Object.freeze([])
      mustEditHandoffs = Object.freeze([])
      experienceFiles = {}
      this.continuationReads.delete(agent)
    }
    signal.throwIfAborted()
    this.design.assertProjectSelection(agent, project.projectId)
    const latest = journal.snapshot.latestDesignChange
    const executionAttempts = this.design.executionAttemptsFor(agent, String(project.projectId))
    const mainBundle = activeMainBundleWork(agent, String(project.projectId))
    const verifiedExecutionAttempts = await Promise.all(executionAttempts.map(async attempt => {
      if (attempt.receipt === undefined) return attempt
      const digest = worktree.fileDigests.get(attempt.receipt.path)
      if (digest !== undefined
        && digest.bytes === attempt.receipt.bytes
        && digest.sha256 === attempt.receipt.sha256) return attempt
      const { receipt: _staleReceipt, ...withoutReceipt } = attempt
      return Object.freeze(withoutReceipt)
    }))
    const assessment = authority === undefined
      ? null
      : {
          kit: authority.report.kit,
          version: authority.report.version,
          u: authority.report.u.score,
          s: authority.report.s.score,
          t: authority.report.t.score,
        }
    const access: DesignPanelWorkspaceRead['access'] = pin === undefined
      ? { mode: 'unconfigured', writable: false }
      : kit === undefined || publicationError !== undefined
        ? {
            mode: 'recovery',
            writable: false,
            kit: { name: pin.name, version: pin.version },
            ...(this.design.latestKit(pin.name) === undefined
              ? {}
              : { upgradeCommand: `/yugoo kit ${pin.name}` }),
          }
        : {
            mode: 'writable',
            writable: true,
            kit: { name: pin.name, version: pin.version },
          }
    const clarityActivity = this.design.clarityActivity?.(agent, project.projectId)
    return {
      projectId: project.projectId,
      projectName: project.name,
      projectPath: project.root,
      checkpoint: projectWorkspace.checkpoint,
      worktreeRevision: worktree.revision,
      ...(publicationError === undefined ? {} : { publicationError }),
      artifactFiles: Object.fromEntries([...worktree.fileDigests].filter(([, digest]) => digest.bytes > 0).map(([path, digest]) => [path, digest.sha256])),
      experienceFiles,
      executionRevision: executionAttempts.at(-1)?.sequence ?? 0,
      executionAttempts: Object.freeze(verifiedExecutionAttempts),
      activeMainBundles: mainBundle?.invocationId === undefined ? []
        : [{ skill: mainBundle.skillName, invocationId: mainBundle.invocationId }],
      access,
      journalRevision: journal.revision,
      design: worktree.design,
      autoPanelManifests,
      autoPanelDefinitions,
      autoPanelStates,
      continuations,
      mustEditHandoffs,
      advisoryRuntime: this.design.advisoryRuntimeStatus(agent),
      clarity: {
        assessment,
        ...(clarityActivity === undefined ? {} : { activity: clarityActivity }),
        ...(authority === undefined ? {} : { explanation: {
          summary: authority.report.summary,
          u: authority.report.u.evidence,
          s: authority.report.s.evidence,
          t: authority.report.t.evidence,
          ...(authority.report.nextGap === undefined ? {} : { nextGap: authority.report.nextGap }),
          assessedCheckpoint: authority.assessedCheckpoint,
        } }),
        needsReassessment,
      },
      ...(latest === undefined
        ? {}
        : { latestDesignChange: { skill: latest.skill, journalRevision: latest.journalRevision } }),
    }
  }

  /** Explicit user retention of the exact visible generated panel. No client DSL
   * or filesystem path is accepted, and Design Files are never modified. */
  async retainAutoPanel(agent: Agent, request: { projectId: string; skill: string; sourceRevision: string; definitionRevision: string }, signal: AbortSignal): Promise<{ retained: true }> {
    const project = await this.design.projectForAgent(agent, signal)
    if (String(project.projectId) !== request.projectId) throw new Error('auto panel: project changed')
    return this.design.withProjectMutationFor(agent, project.projectId, async () => {
      const workspace = await this.readWorkspace(agent, signal)
      if (workspace.projectId !== project.projectId || workspace.access.mode !== 'writable'
        || workspace.worktreeRevision !== request.sourceRevision) throw new Error('auto panel: source changed or project is read-only')
      const kit = this.design.requireKitForAgent(agent)
      const skill = requireKitSkill(kit, request.skill)
      const manifest = skill.metadata?.skillManifest as { presentation?: { mode?: string }; runtime?: unknown } | undefined
      if (manifest?.presentation?.mode !== 'auto' || manifest.runtime !== undefined || typeof skill.metadata?.schemaYaml !== 'string') {
        throw new Error('auto panel: retention is unavailable for this Bundle')
      }
      const context: AutoPanelContext = {
        kit: kit.name, kitVersion: String(kit.version), bundle: skill.name, bundleVersion: String(skill.version),
        schema: parseSchemaYaml(skill.metadata.schemaYaml), state: coerceObjectState(workspace.design[skill.name]?.state),
        artifacts: autoArtifactInventory(workspace.artifactFiles, skill.name),
      }
      const visible = await resolveAutoPanel({ definitionRoot: project.root, cacheRoot: project.stateRoot }, context)
      if (visible.status !== 'ready' || visible.definitionRevision !== request.definitionRevision) throw new Error('auto panel: definition changed')
      if (visible.origin === 'retained') return { retained: true as const }
      const cached = await readAutoPanelCache(project.stateRoot, context)
      if (cached.status !== 'ready') throw new Error('auto panel: generated definition unavailable')
      // The cache can change independently; pin the snapshot actually persisted.
      const { autoPanelManifest } = await import('./auto-panel-spec.ts')
      if (!isDeepStrictEqual(autoPanelManifest(cached.snapshot, context), visible.manifest)) throw new Error('auto panel: generated definition changed')
      await saveAutoPanelDefinition(project.root, cached.snapshot, context)
      return { retained: true as const }
    })
  }

  /**
   * Persist one panel save from the design panel UI.
   * @param agent - the receiving agent whose binding selects the project and receives the notice.
   * @param skill - the design skill that owns the panel.
   * @param state - the full post-edit panel state (JSON over the wire).
   * @param signal - cancellation for the write/commit.
   * @returns the save commit; the field is absent when the state was unchanged.
   */
  async savePanel(
    agent: Agent,
    skill: string,
    state: unknown,
    artifactsOrSignal: unknown,
    eventIdOrSignal?: string | AbortSignal,
    maybeSignal?: AbortSignal,
  ): Promise<{ commit?: string }> {
    const started = performance.now()
    const scopeId = allocateDshSaveScopeId()
    const trace = (phase: string): void => {
      try {
        const record = { tag: 'yugoo-panel-save', phase,
          at: new Date().toISOString(), session: String(agent.id), skill,
          elapsedMs: Math.round(performance.now() - started), ...(scopeId === undefined ? {} : { scopeId }) }
        emitDshTimingDiagnostic(record)
        this.hostContext?.logger?.info(JSON.stringify(record))
      } catch { /* Diagnostics cannot invalidate a save. */ }
    }
    trace('request')
    const signal = artifactsOrSignal instanceof AbortSignal
      ? artifactsOrSignal
      : eventIdOrSignal instanceof AbortSignal
        ? eventIdOrSignal
        : maybeSignal
    if (signal === undefined) throw new Error('design panel: save signal is required')
    const artifacts = artifactsOrSignal instanceof AbortSignal ? undefined : artifactsOrSignal
    // New clients supply a stable browser-generated id so transport retries
    // resolve to the same audit commit. The fallback keeps older clients
    // compatible for one release, but those callers cannot request retry
    // idempotence across separate RPC attempts.
    const eventId = typeof eventIdOrSignal === 'string' && eventIdOrSignal.trim() !== ''
      ? eventIdOrSignal
      : randomUUID()
    try {
    let assessmentReceipt: SettledDesignPanelSave | undefined
    const saved = await this.design.withSelectedDesignFilesMutation(agent, nodeFs, signal, async (project, store) => {
      trace('project-resolved')
      const coerced = coerceObjectState(state)
      const kit = this.design.requireKitForAgent(agent)
      const skillDef = requireKitSkill(kit, skill)
      const presentation = (skillDef.metadata?.skillManifest as { presentation?: { mode?: string } } | undefined)?.presentation
      const auto = presentation?.mode === 'auto'
      const autoBefore = auto && typeof artifacts === 'object' && artifacts !== null && !Array.isArray(artifacts)
        && Object.keys(artifacts).every(key => key === 'autoBefore' || key === 'definitionRevision') && 'autoBefore' in artifacts
        ? (artifacts as { autoBefore: unknown }).autoBefore : undefined
      if (auto && autoBefore === undefined) throw new Error('auto panel: original Design File state is required')
      const panelArtifacts = auto ? undefined : parsePanelArtifacts(skill, artifacts)
      const { checkpoint: priorHead, state: priorStored } = await store.readPublishedSnapshot(skill, signal)
      const journal = await this.design.readDesignJournal(agent)
      const mustEditAuthority = skillDef.execution.handoff === 'must_edit'
        ? await pendingMustEditAuthorityForSave(journal.records, kit.name, kit.version, skill, priorHead,
          commit => store.diffCommit(commit, signal))
        : undefined
      const manifest = skillDef.metadata?.skillManifest
      const runtimeDeclaration = typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
        ? (manifest as Record<string, unknown>).runtime
        : undefined
      const runtime = runtimeDeclaration === undefined ? undefined : this.design.runtimeDriverFor(skillDef)
      const context = {
        skill: skillDef,
        origin: 'panel' as const,
        signal,
      }
      const prior = priorStored === undefined ? undefined : coerceObjectState(priorStored)
      if (auto) {
        if (prior === undefined) throw new Error('auto panel: no published Design File state is available')
        if (typeof skillDef.metadata?.schemaYaml !== 'string' || runtimeDeclaration !== undefined) {
          throw new Error('auto panel: this Bundle has no supported generated save contract')
        }
        const visible = await this.readWorkspace(agent, signal)
        if (visible.projectId !== project.projectId) throw new Error('auto panel: project changed during save')
        const context: AutoPanelContext = {
          kit: kit.name, kitVersion: String(kit.version), bundle: skill, bundleVersion: String(skillDef.version),
          schema: parseSchemaYaml(skillDef.metadata.schemaYaml), state: prior,
          artifacts: autoArtifactInventory(visible.artifactFiles, skill),
        }
        // An uncertain transport retry may arrive after its first commit. Let
        // the Design Files event-id audit replay exact same bytes; it cannot
        // alter current facts. A real edit still needs a live snapshot pin.
        if (!isDeepStrictEqual(prior, coerced) || !await store.hasPanelSaveAudit(skill, eventId, signal)) {
          const revision = typeof artifacts === 'object' && artifacts !== null && 'definitionRevision' in artifacts
            ? (artifacts as { definitionRevision?: unknown }).definitionRevision : undefined
          if (typeof revision === 'string') await assertResolvedAutoPanelSave({
            roots: { definitionRoot: project.root, cacheRoot: project.stateRoot }, context, before: autoBefore,
            visibleState: visible.design[skill]?.state, after: coerced, definitionRevision: revision,
          })
          else {
            const resolved = await resolveAutoPanel({ definitionRoot: project.root, cacheRoot: project.stateRoot }, context)
            if (resolved.status === 'ready' && resolved.origin === 'retained') throw new Error('auto panel: retained definition revision is required')
            if (resolved.status === 'incompatible') throw new Error('auto panel: retained definition incompatible')
            await assertAutoPanelSave({
            stateRoot: project.stateRoot, context, before: autoBefore,
            visibleState: visible.design[skill]?.state, after: coerced,
            })
          }
        }
      }
      const normalized = runtime?.normalizeState === undefined
        ? coerced
        : await runtime.normalizeState(coerced, context, prior)
      const prepared = runtime?.prepareWrite === undefined
        ? { state: normalized, ...(panelArtifacts === undefined ? {} : { artifacts: panelArtifacts }) }
        : await runtime.prepareWrite(normalized, context)
      if (runtime?.prepareWrite !== undefined && panelArtifacts !== undefined) {
        throw new Error(`design panel: native artifact payload cannot be combined with runtime preparation for ${JSON.stringify(skill)}`)
      }
      const validate = typeof skillDef.metadata?.schemaYaml === 'string'
        ? validatorFromSchemaYaml(skillDef.metadata.schemaYaml)
        : undefined
      // Source locators and explicitly declared graph integrity are mandatory
      // in Panel and Agent paths alike. Do not gate saves on completeness.
      if (typeof skillDef.metadata?.validationYaml === 'string') {
        const doc = parseValidationYaml(skillDef.metadata.validationYaml)
        const graphRules = new Set(panelGraphSaveRules(doc, skillDef.metadata?.panelManifest))
        const rules = doc.rules.filter(rule => 'source_reference_map' in rule.check || graphRules.has(rule))
        if (rules.length) {
          const issues = await evaluateValidationRules({ ...doc, rules }, { skill, state: prepared.state }, 'state')
          if (issues.length) throw new Error(JSON.stringify(issues))
        }
      }
      this.design.assertProjectSelection(agent, project.projectId)
      let settledNewChange = false
      trace('publication-start')
      const result = await applyPanelEdit(store, { skill, state: prepared.state }, async (event) => {
        trace('commit-accepted')
        this.design.assertProjectSelection(agent, project.projectId)
        const revision = await this.design.recordDesignChange(agent, project.projectId, {
          kit: kit.name,
          version: kit.version,
          skill,
          state: event.state,
          origin: 'panel',
          ...(event.commit === undefined ? {} : { commit: event.commit }),
          ...(typeof skillDef.metadata?.panelYaml === 'string' ? { panelYaml: skillDef.metadata.panelYaml } : {}),
          ...(typeof skillDef.metadata?.skillManifest === 'object' && skillDef.metadata.skillManifest !== null
            ? { skillManifest: skillDef.metadata.skillManifest as Record<string, unknown> }
            : {}),
        })
        settledNewChange = revision > journal.revision
        trace('journal-settled')
      }, validate, prepared.artifacts, prepared.ownedArtifacts, signal, {
        eventId,
        kind: 'panel-save',
      })
      trace('committed-diff-read')
      // The reconstructed release revision wins: a later save must replay the
      // exact persisted disposition, not substitute its own fresh commit.
      const releasedPanelRevision = mustEditAuthority?.panelStateRevision
        ?? (result.diff.trim() === '' ? undefined : result.commit)
      if (releasedPanelRevision !== undefined && mustEditAuthority !== undefined) {
        await this.design.consumeExecutionHandoff(agent, {
          invocationId: mustEditAuthority.invocationId,
          pin: {
            invocationId: mustEditAuthority.invocationId,
            kitName: kit.name,
            kitVersion: kit.version,
            skillName: skill,
            bundleVersion: skillDef.version,
            stateRevision: mustEditAuthority.stateRevision,
            projectId: project.projectId,
          },
          panelStateRevision: releasedPanelRevision,
        })
      }
      trace('handoff-settled')
      const checkpoint = result.commit ?? priorHead
      if (settledNewChange) agent.inject(createYugooDesignMessage({
        content: [{ type: 'text', text: buildPanelSaveNote(skill, result.diff,
          result.diff.trim() === '' || checkpoint === undefined ? undefined : {
            projectId: project.projectId, assessedCheckpoint: checkpoint,
            selectionRevision: this.design.clarityInputForAgent?.(agent)?.selectionRevision,
            kitContentHash: projectKitContentHash(kit),
          }) }],
        notice: `design panel saved: ${skill}`,
      }))
      if (checkpoint !== undefined) assessmentReceipt = {
        project, kit, kitContentHash: projectKitContentHash(kit), eventId, commit: checkpoint,
        ...(result.commit === undefined ? {} : { returnedCommit: result.commit }), meaningful: result.diff.trim() !== '',
      }
      return result.commit === undefined ? {} : { commit: result.commit }
    }, () => trace('mutation-entered'), scopeId)
    // Record receipt only after the whole mutation/gate transaction succeeded.
    // Optional analysis must never turn an already durable save into failure.
    if (assessmentReceipt !== undefined && !signal.aborted) {
      try { this.design.recordSettledPanelSave?.(agent, assessmentReceipt) }
      catch (error) { this.hostContext?.logger?.warn(`design clarity: saved receipt unavailable: ${String(error).slice(0, 300)}`) }
    }
    trace('returned')
    return saved
    } catch (error) {
      trace('failed')
      throw error
    }
  }

  /** Called after native prompt admission; validates legacy receipts only. */
  admitSavedAssessment(agent: Agent, request: SavedDesignAssessmentRequest) {
    return this.design.admitSavedAssessment(agent, request)
  }

  /**
   * Read one heavy artifact from the selected project's `design_files/` tree.
   * @param agent - the owning agent whose binding resolves the project root.
   * @param relPath - path relative to `design_files/`, e.g. `flow_design/P-001.bpmn`.
   * @param signal - cancellation for the read.
   * @returns the artifact text; `found` is false when absent.
   * @throws when the path would escape the `design_files/` tree.
   */
  async queryKnowledge(agent: Agent, args: import('./design-knowledge-query.ts').KnowledgeReadArguments, signal: AbortSignal) {
    if (!args.project || !args.checkpoint || !args.revision) throw new Error('Panel Knowledge query requires exact snapshot pins')
    return this.design.queryStoredKnowledge(agent, args, signal)
  }

  async readGraph(agent: Agent, signal: AbortSignal): Promise<{ content: string }> {
    const project = await this.design.projectForAgent(agent, signal)
    const result = await this.knowledgeReads.read(`${String(agent.id)}:${project.projectId}`,
      () => this.readGraphNow(agent, new AbortController().signal),
      () => this.design.knowledgeRecoveryStatus(project.projectId))
    signal.throwIfAborted()
    this.design.assertProjectSelection(agent, project.projectId)
    if (result.value) return result.value
    return { content: JSON.stringify({ projectId: project.projectId, checkpoint: '', nodes: [], edges: [], warnings: [],
      knowledgeStatus: 'unavailable', recovery: result.recovery }) }
  }

  /** Cheap, read-only live state for a visible Graph Panel; never starts KAG work. */
  async readKnowledgeStatus(agent: Agent, signal: AbortSignal): Promise<DesignKnowledgeStatusSnapshot | undefined> {
    const project = await this.design.projectForAgent(agent, signal)
    const status = await this.design.knowledgeStatusSnapshot(agent, signal)
    signal.throwIfAborted()
    this.design.assertProjectSelection(agent, project.projectId)
    return status?.project === project.projectId ? status : undefined
  }

  async retryKnowledge(agent: Agent, signal: AbortSignal): Promise<{ accepted: boolean }> {
    return this.design.retryDerivedKnowledge(agent, signal)
  }

  private async readGraphNow(agent: Agent, signal: AbortSignal): Promise<{ content: string }> {
    const project = await this.design.projectForAgent(agent, signal)
    const store = await this.design.designFilesForProject(agent, project.projectId, nodeFs, signal)
    const checkpoint = await store.head(signal)
    if (!checkpoint) return { content: JSON.stringify({ projectId: project.projectId, checkpoint: '', knowledgeStatus: 'unavailable', nodes: [], edges: [], warnings: ['尚无已发布设计。'] }) }
    const kit = this.design.kitForAgent(agent)
    const kitKey = kit === undefined ? '' : `${kit.name}@${kit.version}`
    const cached = this.graphReads?.get(project.projectId)
    if (cached?.head === checkpoint && cached.kit === kitKey) {
      const status = await this.design.knowledgeStatusSnapshot(agent, signal)
      if (status?.state === 'current' && status.head === checkpoint && status.latestComplete?.revision === cached.revision) {
        signal.throwIfAborted()
        this.design.assertProjectSelection(agent, project.projectId)
        if (await store.head(signal) === checkpoint) return { content: cached.content }
      }
    }
    const schemas: Record<string, SchemaSpec> = {}, schemaWarnings: string[] = []
    for (const skill of kit?.skills ?? []) {
      const yaml = skill.metadata?.schemaYaml
      if (typeof yaml !== 'string') continue
      try { schemas[`${skill.name}/${skill.name}.json`] = parseSchemaYaml(yaml) }
      catch { schemaWarnings.push(`${skill.name}: schema 无法读取，使用结构回退。`) }
    }
    let graph
    try {
      const stored = await this.design.readStoredDesignGraph(agent, signal)
      const status = await this.design.knowledgeStatusSnapshot(agent, signal)
      const publicationChanged = !status || status.project !== project.projectId || status.head !== checkpoint
        || stored.freshness.sourceCheckpoint !== checkpoint
        || status.latestComplete?.revision !== (stored.freshness.indexedCheckpoint === undefined ? undefined : stored.knowledgeRevision)
      // A concurrent publish is not a database failure. Keep the internally
      // consistent stored generation and let the live status reader refresh it.
      graph = { ...stored, knowledgeStatus: publicationChanged ? 'unknown' : status.state }
      if (publicationChanged) graph.warnings.push('读取期间设计或图谱版本发生变化；当前显示已保存版本，稍后自动刷新。')
    } catch (error) {
      signal.throwIfAborted()
      const readRace = error instanceof DesignGraphReadRaceError
      // A checkpoint race can only show a temporary structural preview; a
      // storage failure is reported separately and must never be disguised.
      const ontologyContract = this.design.kitForAgent(agent)?.ontologyContract
      const previewCheckpoint = readRace ? await store.head(signal) ?? checkpoint : checkpoint
      const preview = await readDesignGraph(store, previewCheckpoint, signal, schemas, { ontology: ontologyContract })
      graph = { ...preview, projectId: project.projectId, knowledgeStatus: readRace ? 'unknown' : 'unavailable',
        coverage: { projection: 'structural-preview', embedding: 'unknown', review: 'unknown',
          ontology: designOntologyCoverage(preview.nodes, ontologyContract) }, freshness: { sourceCheckpoint: previewCheckpoint } }
      graph.warnings.push(readRace
        ? '读取期间设计版本发生变化；仅暂时展示文件结构预览，稍后自动刷新。'
        : 'Knowledge（统一 KAG）当前不可用；仅展示临时文件结构预览，不代表完整关联。',
      error instanceof Error ? error.message : String(error))
      if (!readRace) Object.assign(graph, { recovery: this.design.knowledgeRecoveryStatus(project.projectId) })
    }
    graph.warnings.push(...schemaWarnings)
    const { semanticUnits: _internalUnits, ...responseGraph } = graph
    // Field bodies are index evidence; the Panel needs only bounded display context.
    responseGraph.nodes = graph.nodes.map(({ fields: _fields, ...node }) => node)
    signal.throwIfAborted()
    const selected = await this.design.projectForAgent(agent, signal)
    if (selected.projectId !== project.projectId) throw new Error('Project selection changed; reload graph')
    const content = JSON.stringify(responseGraph)
    if (this.graphReads && graph.knowledgeStatus === 'current' && 'knowledgeRevision' in graph
      && typeof graph.knowledgeRevision === 'string' && graph.freshness?.sourceCheckpoint === checkpoint) {
      this.graphReads.delete(project.projectId)
      this.graphReads.set(project.projectId, { head: checkpoint, revision: graph.knowledgeRevision, kit: kitKey, content })
      if (this.graphReads.size > 3) this.graphReads.delete(this.graphReads.keys().next().value!)
    }
    return { content }
  }

  async readArtifact(
    agent: Agent,
    relPath: string,
    stateRevision: string,
    signal: AbortSignal,
  ): Promise<{ found: boolean; content: string }> {
    const project = await this.design.projectForAgent(agent, signal)
    const store = await this.design.designFilesForProject(agent, project.projectId, nodeFs, signal)
    const content = stateRevision.startsWith(WORKTREE_REVISION_PREFIX)
      ? await store.readWorktreeText(relPath)
      : await store.readTextAt(stateRevision, relPath, signal)
    return content === undefined ? { found: false, content: '' } : { found: true, content }
  }

  /**
   * Read one bounded PDF artifact without constructing a server-side Data URL.
   * @param agent - the owning agent whose binding resolves Design Files.
   * @param relPath - confined lower-case `.pdf` path below `design_files/`.
   * @param signal - cancellation before and after the filesystem read.
   * @returns a PDF media type, raw base64, and decoded byte length.
   */
  async readBinaryArtifact(
    agent: Agent,
    relPath: string,
    stateRevision: string,
    signal: AbortSignal,
  ): Promise<BinaryArtifactRead> {
    const mediaType = relPath.endsWith('.pdf')
      ? 'application/pdf' as const
      : relPath.endsWith('.png')
        ? 'image/png' as const
        : relPath.endsWith('.jpg') || relPath.endsWith('.jpeg')
          ? 'image/jpeg' as const
          : relPath.endsWith('.webp') ? 'image/webp' as const : undefined
    if (mediaType === undefined) throw new Error('design panel: binary artifact path must use a supported PDF or image extension')
    const project = await this.design.projectForAgent(agent, signal)
    const store = await this.design.designFilesForProject(agent, project.projectId, nodeFs, signal)
    signal.throwIfAborted()
    const content = stateRevision.startsWith(WORKTREE_REVISION_PREFIX)
      ? await store.readWorktreeBytes(relPath)
      : await store.readBytesAt(stateRevision, relPath, signal, this.maxBinaryArtifactBytes)
    signal.throwIfAborted()
    if (content !== undefined && content.byteLength > this.maxBinaryArtifactBytes) {
      throw new Error(`design panel: binary artifact exceeds ${this.maxBinaryArtifactBytes} bytes`)
    }
    if (content === undefined) {
      return { found: false, mediaType, base64: '', byteLength: 0 }
    }
    const has = (...signature: number[]): boolean => signature.every((byte, index) => content[index] === byte)
    const valid = mediaType === 'application/pdf'
      ? content.byteLength >= 5 && Buffer.from(content.subarray(0, 5)).toString('ascii') === '%PDF-'
      : mediaType === 'image/png'
        ? has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        : mediaType === 'image/jpeg'
          ? has(0xff, 0xd8, 0xff)
          : content.byteLength >= 12
            && Buffer.from(content.subarray(0, 4)).toString('ascii') === 'RIFF'
            && Buffer.from(content.subarray(8, 12)).toString('ascii') === 'WEBP'
    if (!valid) throw new Error(`design panel: binary artifact bytes do not match ${mediaType}`)
    return {
      found: true,
      mediaType,
      base64: Buffer.from(content).toString('base64'),
      byteLength: content.byteLength,
    }
  }

  /**
   * List the selected project's active Kit catalog for the panel's "+ new
   * panel" picker: the mindset name plus each skill's fallback routing
   * description and skill.yaml manifest (title/label/description/order/icon).
   * @param agent - the owning agent whose binding resolves the selected project.
   * @param signal - cancellation for the lookup.
   * @returns the catalog, or an empty catalog when the selected project has no Kit.
   */
  async listSkills(
    agent: Agent,
    signal: AbortSignal,
  ): Promise<{
    mindset: string | undefined
    skills: { id: string; description: string; manifest: Record<string, unknown> }[]
  }> {
    if (signal.aborted) signal.throwIfAborted()
    const project = await this.design.projectForAgent(agent, signal)
    const kit = this.design.kitForAgent(agent)
    if (kit === undefined) return { mindset: project.kit?.name, skills: [] }
    const skills = [...kit.skills]
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((entry) => ({
        id: entry.name,
        description: entry.description,
        manifest: typeof entry.metadata?.skillManifest === 'object' && entry.metadata?.skillManifest !== null
          ? entry.metadata.skillManifest as Record<string, unknown>
          : {},
      }))
    return { mindset: kit.name, skills }
  }

  /**
   * Record a review-card disposition without applying the recommendation.
   * @param agent - the owning Agent whose session holds the advisory.
   * @param decision - advisory identity and explicit human disposition.
   * @param signal - cancellation before the decision is recorded.
   */
  async decideAdvisory(
    agent: Agent,
    decision: DesignAdvisoryDecisionPayload,
    signal: AbortSignal,
  ): Promise<SessionDesignAdvisory> {
    if (signal.aborted) signal.throwIfAborted()
    return this.design.decideAdvisory(agent, decision)
  }

  /**
   * List the session's reviewable advisories from the Design-owned store.
   * @param agent - the owning Agent whose session holds the advisories.
   * @param signal - cancellation before the read.
   * @returns entries in publication order.
   */
  async listAdvisories(
    agent: Agent,
    signal: AbortSignal,
  ): Promise<readonly SessionDesignAdvisory[]> {
    if (signal.aborted) signal.throwIfAborted()
    return this.design.listAdvisoryInbox(agent)
  }
}

/** skill.yaml `order` for design_state assembly ordering. */
function orderOf(skill: { metadata?: Record<string, unknown> }): number {
  const manifest = skill.metadata?.skillManifest
  const order = typeof manifest === 'object' && manifest !== null
    ? (manifest as Record<string, unknown>).order
    : undefined
  return typeof order === 'number' ? order : Number.MAX_SAFE_INTEGER
}

export default DesignPanelRemote

Remote(DesignPanelRemote.prototype.observePanelDraft, {
  kind: 'method', name: 'observePanelDraft', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['observePanelDraft']>)

// The bundle must stay parseable by plain Node ESM (no decorator syntax), so
// the Remote marker is applied here with the same effect as `@Remote`.
Remote(DesignPanelRemote.prototype.savePanel, {
  kind: 'method',
  name: 'savePanel',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['savePanel']>)

Remote(DesignPanelRemote.prototype.admitSavedAssessment, {
  kind: 'method', name: 'admitSavedAssessment', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['admitSavedAssessment']>)

Remote(DesignPanelRemote.prototype.readWorkspace, {
  kind: 'method',
  name: 'readWorkspace',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readWorkspace']>)

Remote(DesignPanelRemote.prototype.pollWorkspace, {
  kind: 'method', name: 'pollWorkspace', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['pollWorkspace']>)

Remote(DesignPanelRemote.prototype.readReviewPolicy, {
  kind: 'method', name: 'readReviewPolicy', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readReviewPolicy']>)
Remote(DesignPanelRemote.prototype.updateReviewPolicy, {
  kind: 'method', name: 'updateReviewPolicy', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['updateReviewPolicy']>)

Remote(DesignPanelRemote.prototype.readGraph, {
  kind: 'method', name: 'readGraph', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readGraph']>)
Remote(DesignPanelRemote.prototype.readKnowledgeStatus, {
  kind: 'method', name: 'readKnowledgeStatus', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readKnowledgeStatus']>)
Remote(DesignPanelRemote.prototype.retryKnowledge, {
  kind: 'method', name: 'retryKnowledge', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['retryKnowledge']>)

Remote(DesignPanelRemote.prototype.queryKnowledge, {
  kind: 'method', name: 'queryKnowledge', static: false, private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void { initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote) },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['queryKnowledge']>)

Remote(DesignPanelRemote.prototype.readArtifact, {
  kind: 'method',
  name: 'readArtifact',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readArtifact']>)

Remote(DesignPanelRemote.prototype.readExecutionLog, {
  kind: 'method',
  name: 'readExecutionLog',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readExecutionLog']>)

Remote(DesignPanelRemote.prototype.readBinaryArtifact, {
  kind: 'method',
  name: 'readBinaryArtifact',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['readBinaryArtifact']>)

Remote(DesignPanelRemote.prototype.listSkills, {
  kind: 'method',
  name: 'listSkills',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['listSkills']>)

Remote(DesignPanelRemote.prototype.decideAdvisory, {
  kind: 'method',
  name: 'decideAdvisory',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['decideAdvisory']>)

Remote(DesignPanelRemote.prototype.listAdvisories, {
  kind: 'method',
  name: 'listAdvisories',
  static: false,
  private: false,
  addInitializer(initializer: (this: DesignPanelRemote) => void): void {
    initializer.call(Object.create(DesignPanelRemote.prototype) as DesignPanelRemote)
  },
} as ClassMethodDecoratorContext<DesignPanelRemote, DesignPanelRemote['listAdvisories']>)
