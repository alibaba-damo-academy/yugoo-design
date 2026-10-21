/** Configurable DSH scheduler for independent background Design advisory profiles. */
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { renderAdvisoryReviewMemory } from './advisory-review-memory.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { designSessionEvents } from './dsh-session-events.ts'
import { designLiveConfigField, installDesignSettingsSection, readDesignConfigValue } from './dsh-settings-consumer.ts'
export { DESIGN_ADVISORY_SETTINGS_NAMESPACE } from './dsh-settings-consumer.ts'
import z from '@deepseek-ai/schemastery'
import type DesignService from './design-service.ts'
import { createDshAdvisoryAgent } from './dsh-advisory-agent.ts'
import { latestDirectHumanText } from './design-locale.ts'
import { activeMainBundleWork } from './dsh-main-bundle.ts'
import { resolveMaxSuggestions, DEFAULT_MAX_SUGGESTIONS } from './advisory-inbox-policy.ts'
import {
  analyzeDshDesignAdvisory,
  type AdvisorySubagentPort,
  type ForegroundDesignWork,
} from './dsh-advisory-runner.ts'
import {
  OFFICIAL_ALIGNMENT_PROFILE,
  OFFICIAL_GROUNDING_PROFILE,
  OFFICIAL_REFLECTION_PROFILE,
  officialAdvisoryAttemptIds,
  officialAdvisoryProfile,
  type OfficialAdvisoryInput,
  type OfficialAdvisoryProfileId,
} from './official-advisory-profiles.ts'
import type { DesignAdvisoryRuntimeStatus, DesignAdvisoryRuntimeStatusProvider } from './advisory-runtime-status.ts'
import type { AdvisoryDesignKnowledge, AdvisoryKnowledgeSelection } from './advisory-knowledge.ts'
import { DEFAULT_DESIGN_REVIEW_POLICY, DesignReviewPublicationQueue, DesignContinuousReviewClock, parseDesignReviewPolicy, type DesignReviewPolicy } from './design-review-policy.ts'
import type { DesignJournalRead } from './design-journal-storage.ts'

export interface Config {
  readonly provider?: string
  readonly debounceMs?: number
  /** Bound detached Knowledge preparation; includes identity, retrieval and final pin checks. */
  readonly knowledgeReadTimeoutMs?: number
  readonly profiles?: readonly OfficialAdvisoryProfileId[]
  readonly maxSuggestions?: number
}

interface ResolvedConfig {
  readonly provider: string
  readonly debounceMs: number
  readonly knowledgeReadTimeoutMs: number
  readonly profiles: readonly OfficialAdvisoryProfileId[]
  readonly maxSuggestions: number
}

export interface AdvisorySettings { maxSuggestions: number }

const maxSuggestionsField = z.number().step(1).min(1).max(10).default(DEFAULT_MAX_SUGGESTIONS)
export const AdvisorySettings: z<AdvisorySettings> = z.object({ maxSuggestions: maxSuggestionsField })
const DEFAULT_ADVISORY_CONFIG = {
  provider: 'spawn',
  debounceMs: DEFAULT_DESIGN_REVIEW_POLICY.autoMergeWindowMs,
  knowledgeReadTimeoutMs: 5_000,
  profiles: [OFFICIAL_GROUNDING_PROFILE, OFFICIAL_REFLECTION_PROFILE, OFFICIAL_ALIGNMENT_PROFILE],
}

/** The Host projects live fields from this plugin's own Config on current DSH. */
export const Config: z<Config> = z.object({
  provider: z.string().default(DEFAULT_ADVISORY_CONFIG.provider),
  debounceMs: z.number().default(DEFAULT_ADVISORY_CONFIG.debounceMs),
  knowledgeReadTimeoutMs: z.number().default(DEFAULT_ADVISORY_CONFIG.knowledgeReadTimeoutMs),
  // Profile ids arrive as JSON strings; resolveConfig retains the existing
  // official-profile validation and brands them at the domain boundary.
  profiles: z.array(z.string()).default(DEFAULT_ADVISORY_CONFIG.profiles),
  maxSuggestions: designLiveConfigField(maxSuggestionsField),
}) as unknown as z<Config>

interface ScheduledLoop {
  readonly agentKey: string
  readonly agent: Agent
  readonly profile: OfficialAdvisoryProfileId
  latestRevision: number
  readyRevision?: number
  readyAttemptId?: string
  readyImmediate?: boolean
  running: boolean
  phase: DesignAdvisoryRuntimeStatus['phase']
  lastError?: string
  lastPublished?: DesignAdvisoryRuntimeStatus['lastPublished']
  publishedSequence?: number
  timer?: ReturnType<typeof setTimeout>
  controller?: AbortController
  seenManualRequests?: Map<string, number>
  publications?: DesignReviewPublicationQueue<{ readonly checkpoint: string; readonly journal: DesignJournalRead }>
}

interface KnowledgeWarmup {
  readonly revision: number
  readonly controller: AbortController
  promise?: Promise<AdvisoryDesignKnowledge | undefined>
  value?: AdvisoryDesignKnowledge
}

function knowledgeMatchesReview(knowledge: AdvisoryDesignKnowledge | undefined, target: AdvisoryKnowledgeSelection): knowledge is AdvisoryDesignKnowledge {
  return knowledge?.project === target.project && knowledge.checkpoint === target.checkpoint
    && knowledge.graph.entities.every((node) => node.provenance.producer !== 'design-file-projection'
      || node.provenance.checkpoint === (knowledge.sourceCheckpoint ?? target.checkpoint))
}

export interface DshAdvisorySchedulerPorts {
  readonly design: Pick<DesignService,
    'publishAdvisory' | 'refreshAdvisoryProjection' | 'setAdvisoryInboxLimit' | 'kitForAgent' | 'readDesignJournal' | 'projectForAgent'
    | 'recordAdvisoryReviewCompletion'>
    & Partial<Pick<DesignService, 'advisoryDesignKnowledge' | 'publishReviewKnowledge' | 'readReviewPolicy' | 'reviewPublicationQueue'>>
  readonly subagents: AdvisorySubagentPort
  warn(message: string): void
}

function resolveConfig(config: Config): ResolvedConfig {
  const provider = config.provider ?? DEFAULT_ADVISORY_CONFIG.provider
  if (typeof provider !== 'string' || provider.trim() === '') throw new Error('design advisory: provider must be non-empty text')
  const debounceMs = config.debounceMs ?? DEFAULT_ADVISORY_CONFIG.debounceMs
  if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) throw new Error('design advisory: debounceMs must be a non-negative safe integer')
  const knowledgeReadTimeoutMs = config.knowledgeReadTimeoutMs ?? DEFAULT_ADVISORY_CONFIG.knowledgeReadTimeoutMs
  if (!Number.isSafeInteger(knowledgeReadTimeoutMs) || knowledgeReadTimeoutMs <= 0) {
    throw new Error('design advisory: knowledgeReadTimeoutMs must be a positive safe integer')
  }
  const profiles = config.profiles ?? DEFAULT_ADVISORY_CONFIG.profiles
  if (!Array.isArray(profiles) || profiles.length === 0 || new Set(profiles).size !== profiles.length) {
    throw new Error('design advisory: profiles must be a non-empty unique list')
  }
  for (const profile of profiles) officialAdvisoryProfile(profile)
  const maxSuggestions = resolveMaxSuggestions(readDesignConfigValue(config.maxSuggestions))
  return { provider, debounceMs, knowledgeReadTimeoutMs, profiles: Object.freeze([...profiles]), maxSuggestions }
}

// Kept host-neutral so companion and DSH use the same setting semantics.

function recentHumanContext(agent: Agent): string | undefined {
  return latestDirectHumanText(designSessionEvents(agent.session))
}

/** Best-effort description of an attached Design skill whose tool result has not landed yet. */
function activeDesignWork(agent: Agent): ForegroundDesignWork | undefined {
  if (agent.status !== 'running') return undefined
  const main = activeMainBundleWork(agent)
  if (main !== undefined) return main
  const events = designSessionEvents(agent.session)
  const settled = new Set<string>()
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const record = event as {
      readonly type?: unknown
      readonly data?: { readonly message?: { readonly source?: { readonly callId?: unknown } } }
    }
    const callId = record.data?.message?.source?.callId
    if (record.type === 'tool/result' && typeof callId === 'string') settled.add(callId)
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === null || typeof event !== 'object') continue
    const record = event as {
      readonly type?: unknown
      readonly data?: { readonly callId?: unknown; readonly name?: unknown; readonly arguments?: unknown }
    }
    if (record.type !== 'tool/call' || record.data?.name !== 'run_design_skill'
      || typeof record.data.callId !== 'string' || settled.has(record.data.callId)) continue
    if (typeof record.data.arguments !== 'string') return undefined
    try {
      const parsed = JSON.parse(record.data.arguments) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
      const args = parsed as { readonly name?: unknown; readonly brief?: unknown }
      if (typeof args.name !== 'string' || args.name.trim() === '') return undefined
      const brief = typeof args.brief === 'string' && args.brief.trim() !== ''
        ? args.brief.trim().slice(0, 8_192)
        : undefined
      return Object.freeze({ skillName: args.name, ...(brief === undefined ? {} : { brief }) })
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Per-profile latest-wins loops; one loop never waits for or mutates another loop. */
export class DshAdvisoryScheduler {
  private readonly loops = new Map<string, ScheduledLoop>()
  private readonly statuses = new Map<string, DesignAdvisoryRuntimeStatus>()
  private readonly knowledgeWarmups = new Map<string, KnowledgeWarmup>()
  private readonly ports: DshAdvisorySchedulerPorts
  private readonly config: ResolvedConfig
  private publicationSequence = 0
  private closed = false
  private readonly reviewPolicies = new Map<string, DesignReviewPolicy>()
  private readonly selectionEpochs = new Map<string, number>()
  private readonly continuousClocks = new Map<string, DesignContinuousReviewClock>()

  async configureReviews(agent: Agent, value: DesignReviewPolicy): Promise<void> {
    const policy = parseDesignReviewPolicy(value)
    const agentKey = String(agent.id)
    const epoch=this.selectionEpochs.get(agentKey)??0
    this.reviewPolicies.set(agentKey, policy)
    let clock = this.continuousClocks.get(agentKey)
    if (!clock) {
      clock = new DesignContinuousReviewClock(async () => {
        const epoch = this.selectionEpochs.get(agentKey) ?? 0
        if (this.closed || this.reviewPolicies.get(agentKey)?.mode !== 'continuous') return
        if ([...this.loops.values()].some(entry => entry.agentKey === agentKey && (entry.running || entry.readyRevision !== undefined || entry.publications?.size))) return
        const journal = await this.ports.design.readDesignJournal(agent)
        if (this.closed || (this.selectionEpochs.get(agentKey) ?? 0) !== epoch || this.reviewPolicies.get(agentKey)?.mode !== 'continuous') return
        const change = journal.snapshot.latestDesignChange
        if (change?.commit) this.requestManualReviews(agent, change.journalRevision, this.config.profiles, `periodic-${randomUUID()}`)
      }, error => this.ports.warn(`design advisory: periodic review unavailable: ${String(error).slice(0, 1000)}`))
      this.continuousClocks.set(agentKey, clock)
    }
    clock.configure(policy)
    for (const entry of this.loops.values()) {
      if (entry.agentKey === agentKey) entry.publications?.configure(policy)
    }
    if (this.ports.design.reviewPublicationQueue) {
      for (const profile of this.config.profiles) {
        if(this.closed||(this.selectionEpochs.get(agentKey)??0)!==epoch)return
        await this.ports.design.reviewPublicationQueue(agent,profile,queue=>queue.configure(policy))
      }
    }
    if(this.closed||(this.selectionEpochs.get(agentKey)??0)!==epoch)return
    if (policy.mode !== 'off') {
      for(const [key,entry] of this.loops) {
        if(entry.agentKey===agentKey&&entry.publications?.size&&entry.readyAttemptId===undefined) {
          this.schedule(key,entry,entry.publications.delay(Date.now()))
        }
      }
      return
    }
    for (const entry of this.loops.values()) {
      if (entry.agentKey !== agentKey || (entry.readyAttemptId !== undefined && !entry.readyAttemptId.startsWith('periodic-'))) continue
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.timer = undefined
      entry.readyRevision = undefined
      entry.readyAttemptId = undefined
      if (!entry.running) entry.phase = 'idle'
    }
    // A running pass keeps its honest state; mode changes do not fake cancellation.
    this.refreshStatus(agentKey)
  }

  /** Admit the exact post-publication fold, not a later read of the latest HEAD. */
  async notifyPublication(agent: Agent, journal: DesignJournalRead, policy: DesignReviewPolicy): Promise<void> {
    if (this.closed) return
    const epoch=this.selectionEpochs.get(String(agent.id))??0
    await this.configureReviews(agent, policy)
    if(this.closed||(this.selectionEpochs.get(String(agent.id))??0)!==epoch)return
    const change = journal.snapshot.latestDesignChange
    if (policy.mode === 'off' || !change?.commit) return
    const agentKey = String(agent.id)
    for (const profile of this.config.profiles) {
      if(this.closed||(this.selectionEpochs.get(agentKey)??0)!==epoch)return
      const key = this.loopKey(agentKey, profile)
      const entry: ScheduledLoop = this.loops.get(key) ?? {
        agentKey, agent, profile, latestRevision: change.journalRevision, running: false, phase: 'idle',
      }
      entry.publications ??= new DesignReviewPublicationQueue(policy)
      const admit=(queue: NonNullable<ScheduledLoop['publications']>)=>{
        const admitted=queue.publish({checkpoint:change.commit!,journal},Date.now())
        entry.publications=queue
        return admitted
      }
      const admitted=this.ports.design.reviewPublicationQueue
        ? await this.ports.design.reviewPublicationQueue(agent,profile,admit) : admit(entry.publications)
      if(this.closed||(this.selectionEpochs.get(agentKey)??0)!==epoch)return
      if (!admitted) continue
      entry.latestRevision = Math.max(entry.latestRevision, change.journalRevision)
      this.loops.set(key, entry)
      this.schedule(key, entry, policy.mode === 'every-publication' ? 0 : undefined)
    }
    this.startKnowledgeWarmup(agent, change.journalRevision)
    this.refreshStatus(agentKey)
  }

  /** Reopen only durably pending work, never reconstruct retries from due status. */
  async resumePending(agent: Agent, policy: DesignReviewPolicy): Promise<void> {
    if (!this.ports.design.reviewPublicationQueue || this.closed) return
    const epoch=this.selectionEpochs.get(String(agent.id))??0
    await this.configureReviews(agent,policy)
    if(this.closed||(this.selectionEpochs.get(String(agent.id))??0)!==epoch)return
    if (policy.mode==='off')return
    const agentKey=String(agent.id)
    for (const profile of this.config.profiles) {
      const queue=await this.ports.design.reviewPublicationQueue(agent,profile,queue=>queue)
      if(this.closed||(this.selectionEpochs.get(agentKey)??0)!==epoch)return
      const target=queue.latest()
      if (!target || this.closed)continue
      const key=this.loopKey(agentKey,profile)
      const entry: ScheduledLoop=this.loops.get(key)??{
        agentKey,agent,profile,latestRevision:target.journal.snapshot.latestDesignChange!.journalRevision,running:false,phase:'idle',
      }
      entry.publications=queue
      this.loops.set(key,entry)
      this.schedule(key,entry,queue.delay(Date.now()))
    }
    this.refreshStatus(agentKey)
  }

  constructor(ports: DshAdvisorySchedulerPorts, config: Config) {
    this.ports = ports
    this.config = resolveConfig(config)
  }

  /** Update only the shared consumption projection; independent review loops are unchanged. */
  setMaxSuggestions(value: number): void {
    this.ports.design.setAdvisoryInboxLimit(resolveMaxSuggestions(value))
    const agents = new Set([...this.loops.values()].map(entry => entry.agent))
    for (const agent of agents) void this.ports.design.refreshAdvisoryProjection(agent).catch(error => {
      this.ports.warn(`design advisory: failed to refresh inbox limit: ${String(error).slice(0, 1_000)}`)
    })
  }

  status(agent: Agent): DesignAdvisoryRuntimeStatus {
    return this.statuses.get(String(agent.id)) ?? Object.freeze({
      available: true,
      profiles: this.config.profiles,
      phase: 'idle',
    })
  }

  notify(agent: Agent, journalRevision: number, profiles?: readonly string[]): void {
    if (this.closed) return
    const agentKey = String(agent.id)
    if (this.reviewPolicies.get(agentKey)?.mode === 'off') return
    this.startKnowledgeWarmup(agent, journalRevision)
    // An explicit subset limits this fan-out; the default remains every
    // configured profile for callers that own the due judgement themselves.
    const selected = profiles === undefined
      ? this.config.profiles
      : this.config.profiles.filter((profile) => profiles.includes(profile))
    for (const profile of selected) {
      const key = this.loopKey(agentKey, profile)
      const entry = this.loops.get(key) ?? {
        agentKey,
        agent,
        profile,
        latestRevision: journalRevision,
        running: false,
        phase: 'idle' as const,
      }
      entry.latestRevision = Math.max(entry.latestRevision, journalRevision)
      entry.readyRevision = entry.latestRevision
      entry.lastError = undefined
      this.loops.set(key, entry)
      // Keep the active pinned pass finite; a newer publication is pending,
      // not a reason to repeatedly cancel and restart the reviewer.
      this.schedule(key, entry)
    }
    this.refreshStatus(agentKey)
  }

  /**
   * Agent-initiated trigger for exactly the listed profiles at one journal
   * revision. Reuses the ordinary notify machinery, so every invariant holds:
   * per-profile single-flight, latest-wins coalescing, the debounce window as
   * an upper-bound storm guard, and revision pinning with stale discard.
   */
  requestReviews(agent: Agent, journalRevision: number, profiles: readonly string[]): void {
    if (this.closed) throw new Error('design advisory: scheduler is disposed')
    if (this.reviewPolicies.get(String(agent.id))?.mode === 'off') throw new Error('design advisory: GRA disabled by user')
    const unknown = profiles.filter((profile) => !(this.config.profiles as readonly string[]).includes(profile))
    if (profiles.length === 0) throw new Error('design advisory: requestReviews requires at least one profile')
    if (unknown.length > 0) throw new Error(`design advisory: unknown profiles ${JSON.stringify(unknown)}`)
    this.notify(agent, journalRevision, profiles)
    for (const profile of profiles) {
      const entry = this.loops.get(this.loopKey(String(agent.id), profile as OfficialAdvisoryProfileId))
      if (entry?.readyRevision !== undefined) {
        entry.readyImmediate = true
        this.schedule(this.loopKey(entry.agentKey, entry.profile), entry, 0)
      }
    }
  }

  /**
   * Schedule an explicit user-requested recheck, including an already reviewed
   * revision. The caller supplies a stable request identity; the journal owns
   * durable replay checks, while this loop joins concurrent same-profile work.
   */
  requestManualReviews(agent: Agent, journalRevision: number, profiles: readonly string[], requestId: string): readonly string[] {
    if (this.closed) throw new Error('design advisory: scheduler is disposed')
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/.test(requestId)) throw new Error('design advisory: invalid manual request id')
    if (profiles.length === 0) throw new Error('design advisory: manual request requires at least one profile')
    const unknown = profiles.filter((profile) => !(this.config.profiles as readonly string[]).includes(profile))
    if (unknown.length > 0) throw new Error(`design advisory: unknown profiles ${JSON.stringify(unknown)}`)
    const agentKey = String(agent.id)
    const scheduled: string[] = []
    for (const profile of this.config.profiles.filter((candidate) => profiles.includes(candidate))) {
      const key = this.loopKey(agentKey, profile)
      const entry: ScheduledLoop = this.loops.get(key) ?? {
        agentKey, agent, profile, latestRevision: journalRevision, running: false,
        phase: 'idle' as const, seenManualRequests: new Map<string, number>(),
      }
      const seen = entry.seenManualRequests ?? new Map<string, number>()
      entry.seenManualRequests = seen
      const priorRevision = seen.get(requestId)
      if (priorRevision !== undefined) {
        if (priorRevision !== journalRevision) throw new Error('design advisory: manual request id cannot change target')
        continue
      }
      // An active same-target pass satisfies this call for now, but it may
      // fail or be cancelled. Do not consume this request id without a new
      // scheduled attempt and a corresponding durable completion.
      if (entry.running && journalRevision <= entry.latestRevision) continue
      if (entry.readyRevision !== undefined && journalRevision <= entry.readyRevision) continue
      if (entry.running) entry.controller?.abort(new Error('design advisory: a newer Design revision replaced the running review'))
      seen.set(requestId, journalRevision)
      if (seen.size > 128) {
        const oldest = seen.keys().next().value
        if (oldest !== undefined) seen.delete(oldest)
      }
      entry.latestRevision = Math.max(entry.latestRevision, journalRevision)
      entry.readyRevision = journalRevision
      entry.readyAttemptId = requestId
      entry.readyImmediate = true
      entry.lastError = undefined
      this.loops.set(key, entry)
      this.schedule(key, entry, 0)
      scheduled.push(profile)
    }
    if (scheduled.length > 0) {
      const otherProfileRunning = [...this.loops.values()].some((entry) => entry.agentKey === agentKey && entry.running)
      this.startKnowledgeWarmup(agent, journalRevision, !otherProfileRunning)
    }
    this.refreshStatus(agentKey)
    return Object.freeze(scheduled)
  }

  reset(agent: Agent): void {
    const agentKey = String(agent.id)
    this.continuousClocks.get(agentKey)?.close()
    this.continuousClocks.delete(agentKey)
    this.selectionEpochs.set(agentKey,(this.selectionEpochs.get(agentKey)??0)+1)
    this.knowledgeWarmups.get(agentKey)?.controller.abort(new Error('Design Project selection changed'))
    this.knowledgeWarmups.delete(agentKey)
    this.reviewPolicies.delete(agentKey)
    for (const [key, entry] of this.loops) {
      if (entry.agentKey !== agentKey) continue
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.readyRevision = undefined
      entry.controller?.abort(new Error('design advisory: Design Project selection changed'))
      this.loops.delete(key)
    }
    this.statuses.delete(agentKey)
  }

  dispose(): void {
    this.closed = true
    for (const clock of this.continuousClocks.values()) clock.close()
    this.continuousClocks.clear()
    for (const entry of this.knowledgeWarmups.values()) entry.controller.abort(new Error('Design advisory scheduler disposed'))
    this.knowledgeWarmups.clear()
    for (const entry of this.loops.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      entry.controller?.abort(new Error('design advisory scheduler disposed'))
    }
    this.loops.clear()
    this.statuses.clear()
  }

  private loopKey(agentKey: string, profile: OfficialAdvisoryProfileId): string {
    return `${agentKey}\0${profile}`
  }

  /**
   * Warm the optional Knowledge snapshot once per Design revision. The main conversation
   * never awaits this work: Design Files at the pinned Git commit remain the
   * authority when Ladybug, projection, or local embedding is unavailable.
   */
  private startKnowledgeWarmup(agent: Agent, revision: number, force = false): void {
    if (!this.ports.design.advisoryDesignKnowledge || this.closed) return
    const agentKey = String(agent.id)
    const previous = this.knowledgeWarmups.get(agentKey)
    if (previous?.revision === revision && !force) return
    previous?.controller.abort(new Error('New Design revision'))
    const controller = new AbortController()
    const entry: KnowledgeWarmup = { revision, controller }
    this.knowledgeWarmups.set(agentKey, entry)
    entry.promise = (async () => {
      const kit = this.ports.design.kitForAgent(agent)
      if (kit === undefined) return
      const journal = await this.ports.design.readDesignJournal(agent)
      const change = journal.snapshot.latestDesignChange
      if (change?.journalRevision !== revision || change.commit === undefined) return
      if (!await this.isCurrent(agent, kit.name, kit.version, revision)) return
      try {
        const project = await this.ports.design.projectForAgent(agent, controller.signal)
        const target = { project: String(project.projectId), checkpoint: change.commit }
        const knowledge = await this.ports.design.advisoryDesignKnowledge?.(agent, target, controller.signal)
        if (controller.signal.aborted || this.closed || this.knowledgeWarmups.get(agentKey) !== entry) return
        if (knowledgeMatchesReview(knowledge, target)) {
          entry.value = knowledge
          return knowledge
        }
      } catch (error) {
        if (!controller.signal.aborted && !this.closed) {
          this.ports.warn(`Design Knowledge snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })().catch(error => {
      if (!controller.signal.aborted && !this.closed && this.knowledgeWarmups.get(agentKey) === entry) {
        this.ports.warn(`Design Knowledge refresh unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
      return undefined
    })
  }

  private async drain(key: string, entry: ScheduledLoop): Promise<void> {
    if (this.closed || entry.running || this.loops.get(key)!==entry) return
    entry.running = true
    // Explicit manual work has priority; otherwise consume immutable publication FIFO.
    let publication: {checkpoint:string;journal:DesignJournalRead}|undefined
    try {
      if(entry.readyAttemptId===undefined)publication=this.ports.design.reviewPublicationQueue
        ? await this.ports.design.reviewPublicationQueue(entry.agent,entry.profile,queue=>queue.take(Date.now(),true))
        : entry.publications?.take(Date.now(),true)
    } catch(error){entry.running=false;entry.phase='failed';entry.lastError=String(error).slice(0,1000);this.refreshStatus(entry.agentKey);return}
    if(this.closed||this.loops.get(key)!==entry){entry.running=false;return}
    if (entry.readyRevision === undefined && publication === undefined) {entry.running=false;return}
    // Stay `scheduled` through the pre-dispatch checks; only a genuinely
    // spawned reviewer subagent may present this profile as running.
    entry.lastError = undefined
    this.refreshStatus(entry.agentKey)
    const targetRevision = publication?.journal.snapshot.latestDesignChange?.journalRevision ?? entry.readyRevision!
    const attemptId = publication === undefined ? entry.readyAttemptId : undefined
    if (publication === undefined) {
      entry.readyRevision = undefined
      entry.readyAttemptId = undefined
      entry.readyImmediate = undefined
    }
    const controller = new AbortController()
    entry.controller = controller
    let completionRecorded = false
    try {
      const published = await this.runProfile(entry.agent, entry.profile, targetRevision, controller.signal, () => {
        entry.phase = 'running'
        this.refreshStatus(entry.agentKey)
      }, attemptId, () => { completionRecorded = true }, publication?.journal)
      entry.phase = 'idle'
      entry.lastError = undefined
      if (published !== undefined) {
        entry.lastPublished = published
        entry.publishedSequence = ++this.publicationSequence
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = String(error).slice(0, 1_000)
        entry.phase = 'failed'
        entry.lastError = message
        this.ports.warn(`design advisory: ${entry.profile} analysis failed: ${message}`)
      }
    } finally {
      // A request id is durable only after its completion fact. Failure,
      // cancellation, stale discard, or an empty/no-op result must leave the
      // same explicit user request retryable.
      if (attemptId !== undefined && !completionRecorded) entry.seenManualRequests?.delete(attemptId)
      entry.running = false
      entry.controller = undefined
      if (this.closed||this.loops.get(key)!==entry) return
      if (entry.readyRevision !== undefined) this.schedule(key, entry, entry.readyImmediate ? 0 : undefined)
      else {
        if(this.ports.design.reviewPublicationQueue)entry.publications=await this.ports.design.reviewPublicationQueue(entry.agent,entry.profile,queue=>queue)
        if(this.closed||this.loops.get(key)!==entry)return
        if(entry.publications?.size)this.schedule(key,entry,entry.publications.delay(Date.now()))
      }
      this.refreshStatus(entry.agentKey)
    }
  }

  private schedule(key: string, entry: ScheduledLoop, delayMs?: number): void {
    if (entry.running) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    entry.phase = 'scheduled'
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      void this.drain(key, entry).catch(error=>this.ports.warn(`design advisory: queue persistence failed: ${String(error).slice(0,1000)}`))
    }, delayMs ?? this.reviewPolicies.get(entry.agentKey)?.autoMergeWindowMs ?? this.config.debounceMs)
  }

  private async runProfile(
    agent: Agent,
    profileId: OfficialAdvisoryProfileId,
    targetRevision: number,
    signal: AbortSignal,
    onStarted: () => void,
    attemptId?: string,
    onCompleted?: () => void,
    publication?: DesignJournalRead,
  ): Promise<DesignAdvisoryRuntimeStatus['lastPublished'] | undefined> {
    const kit = this.ports.design.kitForAgent(agent)
    if (kit === undefined) return undefined
    if ((attemptId === undefined || attemptId.startsWith('periodic-')) && this.ports.design.readReviewPolicy) {
      const mode = (await this.ports.design.readReviewPolicy(agent, signal)).mode
      if (mode === 'off' || (attemptId?.startsWith('periodic-') && mode !== 'continuous')) return undefined
    }
    const journal = publication ?? await this.ports.design.readDesignJournal(agent)
    const change = journal.snapshot.latestDesignChange
    if (change?.journalRevision !== targetRevision || change.commit === undefined) return undefined
    if (change.kit !== kit.name || change.version !== kit.version) return undefined
    const project = await this.ports.design.projectForAgent(agent, signal)
    const target = { project: String(project.projectId), checkpoint: change.commit }
    // Preparation stays in this detached review. Reuse a revision-scoped read
    // and allow its identity/retrieval/final-pin chain a bounded budget before
    // falling back; the main conversation never awaits this preparation.
    const warmed = this.knowledgeWarmups.get(String(agent.id))
    let reviewedKnowledge = warmed?.revision === targetRevision
      && knowledgeMatchesReview(warmed.value, target) ? warmed.value : undefined
    // The actual read-path outcome, recorded for the durable completion fact.
    // Never inferred from availability: only a snapshot this run really
    // consumed counts as used; every miss names its concrete observed path —
    // a race the bounded read lost is `timeout`, while a read that answered
    // in time without a checkpoint-matched snapshot is `no-matching-snapshot`.
    let knowledgeFallbackReason: 'unavailable' | 'timeout' | 'read-error' | 'checkpoint-mismatch' | 'no-matching-snapshot' | undefined
    if (!reviewedKnowledge) {
      if (!this.ports.design.advisoryDesignKnowledge) knowledgeFallbackReason = 'unavailable'
      else {
        try {
          let readError: unknown
          let timedOut = false
          // The revision warmup is already reading this same provider. Reuse
          // its promise: a second query would wait behind the first in
          // Ladybug's serialized queue and almost always lose this budget.
          const read = Promise.resolve((warmed?.revision === targetRevision ? warmed.promise : undefined) ?? this.ports.design.advisoryDesignKnowledge(agent, target, signal))
            .catch((error: unknown) => { readError = error; return undefined })
          let timer: ReturnType<typeof setTimeout> | undefined
          let onAbort: (() => void) | undefined
          let current: AdvisoryDesignKnowledge | undefined
          try {
            const cancelled = new Promise<undefined>(resolve => {
              onAbort = () => resolve(undefined)
              if (signal.aborted) onAbort()
              else signal.addEventListener('abort', onAbort, { once: true })
            })
            current = await Promise.race([read, cancelled, new Promise<undefined>(resolve => {
              timer = setTimeout(() => { timedOut = true; resolve(undefined) }, this.config.knowledgeReadTimeoutMs)
            })])
          } finally {
            if (timer !== undefined) clearTimeout(timer)
            if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
          }
          if (signal.aborted) return undefined
          if (knowledgeMatchesReview(current, target)) reviewedKnowledge = current
          else if (current === undefined) {
            if (readError !== undefined) knowledgeFallbackReason = 'read-error'
            else knowledgeFallbackReason = timedOut ? 'timeout' : 'no-matching-snapshot'
          } else knowledgeFallbackReason = 'checkpoint-mismatch'
        } catch {
          // Current KAG is optional; pinned Design Files remain authoritative.
          knowledgeFallbackReason = 'read-error'
        }
      }
    }
    const knowledgeContext = reviewedKnowledge?.context
    const userContextSummary = recentHumanContext(agent)
    const compatible = async (): Promise<boolean> => {
      const currentKit = this.ports.design.kitForAgent(agent)
      return currentKit?.name === kit.name && currentKit.version === kit.version
        && (publication !== undefined || await this.isCurrent(agent, kit.name, kit.version, targetRevision))
    }
    if (signal.aborted || !await compatible()) return undefined
    const relationVocabulary = kit.relationVocabulary
    const relationVocabularyRevision = relationVocabulary?.revision ?? 'legacy-unavailable'
    const suffix = profileId.split('/')[0]?.split('.').at(-1) ?? 'profile'
    const identity = officialAdvisoryAttemptIds(profileId, targetRevision, attemptId)
    const input: OfficialAdvisoryInput = {
      schemaVersion: 1,
      runId: identity.runId,
      resultId: identity.resultId,
      pins: [
        { source: `kit:${kit.name}`, revision: kit.version },
        { source: 'relation-vocabulary', revision: relationVocabularyRevision },
        { source: 'design-project', revision: String(project.projectId) },
        { source: 'design-revision', revision: String(targetRevision) },
        { source: 'design-commit', revision: change.commit },
        ...(reviewedKnowledge === undefined
          ? [{ source: 'knowledge-fallback', revision: knowledgeFallbackReason ?? 'unavailable' }]
          : [{ source: 'design-knowledge-source', revision: reviewedKnowledge.sourceCheckpoint ?? change.commit }]),
      ],
      facetRefs: Object.keys(journal.snapshot.design),
      ...(reviewedKnowledge === undefined ? {} : { knowledgeDocumentRef: reviewedKnowledge.documentRef }),
      ...(userContextSummary === undefined ? {} : { userContextSummary }),
    }
    const outcome = await analyzeDshDesignAdvisory({
        design: this.ports.design,
        parent: agent,
        provider: this.config.provider,
        profile: profileId,
        input,
        projectRoot: project.root,
        designFilesRoot: project.designFilesRoot,
        reviewCommit: change.commit,
        knowledgeContext,
        handlingMemory: renderAdvisoryReviewMemory((await this.ports.design.readDesignJournal(agent)).snapshot.advisories),
        relationVocabulary,
        foregroundDesignWork: activeDesignWork(agent),
        signal,
        // The runner fires this only after the host subagent really started;
        // a rejected start never presents this profile as running.
        onStarted,
        stillCurrent: async () => {
          if (this.closed || signal.aborted) return false
          const currentProject = await this.ports.design.projectForAgent(agent, signal)
          const currentVocabulary = this.ports.design.kitForAgent(agent)?.relationVocabulary
          return currentProject.projectId === project.projectId
            && (currentVocabulary?.revision ?? 'legacy-unavailable') === relationVocabularyRevision
            && await compatible()
        },
      }, this.ports.subagents)
    if (outcome.status !== 'produced') return undefined
    if (outcome.knowledgeError) this.ports.warn(`Design Knowledge observations discarded: ${outcome.knowledgeError}`)
    let published: DesignAdvisoryRuntimeStatus['lastPublished'] | undefined
    if (outcome.advisory.items.length === 0) {
      await this.ports.design.refreshAdvisoryProjection(agent)
    } else {
      await this.ports.design.publishAdvisory(agent, outcome.advisory)
      const current = await this.ports.design.readDesignJournal(agent)
      if (current.snapshot.advisories.some(entry => entry.advisory.id === outcome.advisory.id)) {
        published = { profile: outcome.advisory.profile, advisoryId: outcome.advisory.id }
      }
    }
    // Durable completion evidence for due / latest-complete derivation, and
    // the only record that a produced empty-findings pass examined this exact
    // revision. Stale, failed, and aborted runs never reach this point. The
    // append settles after the advice is durable: a journal failure keeps the
    // published advisory authoritative and leaves the profile due again.
    try {
      await this.ports.design.recordAdvisoryReviewCompletion(agent, {
        profile: profileId,
        ...(attemptId === undefined ? {} : { attemptId }),
        designRevision: targetRevision,
        commit: change.commit,
        itemCount: outcome.advisory.items.length,
        knowledgeUsed: reviewedKnowledge !== undefined,
        ...(reviewedKnowledge === undefined ? {} : { knowledgeSourceCheckpoint: reviewedKnowledge.sourceCheckpoint ?? change.commit }),
        ...(reviewedKnowledge === undefined ? { fallbackReason: knowledgeFallbackReason ?? 'unavailable' } : {}),
        kit: kit.name,
        kitVersion: kit.version,
        vocabularyRevision: relationVocabularyRevision,
      })
      onCompleted?.()
    } catch (error) {
      this.ports.warn(`design advisory: ${profileId} review completion not recorded: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Persist graph observations only after the user-visible advisory has
    // settled. This writeback is optional derived maintenance: a serialized
    // or wedged Ladybug operation must not hold the profile in `running` or
    // suppress its card. The revision warmup owns cancellation/fencing.
    if (reviewedKnowledge && warmed
      && await this.isCurrent(agent, kit.name, kit.version, targetRevision)
      && (reviewedKnowledge.sourceCheckpoint ?? change.commit) === change.commit
      && (outcome.knowledgeRelations?.length || outcome.knowledgeRetractions?.length)
      && this.ports.design.publishReviewKnowledge) {
      const publishReviewKnowledge = this.ports.design.publishReviewKnowledge.bind(this.ports.design)
      void Promise.resolve().then(async () => {
        if (this.closed || warmed.controller.signal.aborted
          || this.knowledgeWarmups.get(String(agent.id)) !== warmed) return
        await publishReviewKnowledge(
          agent,
          reviewedKnowledge,
          suffix as 'grounding' | 'reflection' | 'alignment',
          outcome.knowledgeRelations ?? [],
          warmed.controller.signal,
          outcome.knowledgeRetractions,
          relationVocabulary,
        )
      }).catch(error => {
        if (!this.closed && !warmed.controller.signal.aborted) {
          this.ports.warn(`Design Knowledge observations not published: ${error instanceof Error ? error.message : String(error)}`)
        }
      })
    }
    return published
  }

  private async isCurrent(agent: Agent, kitName: string, kitVersion: string, designRevision: number): Promise<boolean> {
    const currentKit = this.ports.design.kitForAgent(agent)
    if (currentKit?.name !== kitName || currentKit.version !== kitVersion) return false
    const current = await this.ports.design.readDesignJournal(agent)
    return current.snapshot.latestDesignChange?.journalRevision === designRevision
  }

  private refreshStatus(agentKey: string): void {
    const loops = [...this.loops.values()].filter(entry => entry.agentKey === agentKey)
    if (loops.length === 0) {
      this.statuses.delete(agentKey)
      return
    }
    const phase: DesignAdvisoryRuntimeStatus['phase'] = loops.some(entry => entry.phase === 'running')
      ? 'running'
      : loops.some(entry => entry.phase === 'scheduled')
        ? 'scheduled'
        : loops.some(entry => entry.phase === 'failed')
          ? 'failed'
          : 'idle'
    const lastPublished = loops
      .filter(entry => entry.lastPublished !== undefined)
      .sort((left, right) => (right.publishedSequence ?? 0) - (left.publishedSequence ?? 0))[0]
      ?.lastPublished
    const lastError = loops.map(entry => entry.lastError).filter(value => value !== undefined).join('; ').slice(0, 1_000) || undefined
    const profileStatus = Object.freeze(loops.map(entry => Object.freeze({
      profile: entry.profile as string,
      phase: entry.phase,
      latestRevision: entry.latestRevision,
      ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
    })))
    this.statuses.set(agentKey, Object.freeze({
      available: true,
      profiles: this.config.profiles,
      phase,
      ...(lastPublished === undefined ? {} : { lastPublished }),
      ...(lastError === undefined ? {} : { lastError }),
      profileStatus,
    }))
  }
}

export const inject = ['design']

export function apply(ctx: Context, config: Config = {}): void {
  const host = ctx as unknown as { design: DesignService }
  const scheduler = new DshAdvisoryScheduler({
    design: host.design,
    subagents: createDshAdvisoryAgent((parent, commit, signal) => host.design.advisoryEvidence(parent, commit, signal)),
    warn: (message) => { ctx.logger.warn(message) },
  }, config)
  const baseSettings: AdvisorySettings = Object.freeze({ maxSuggestions: resolveMaxSuggestions(readDesignConfigValue(config.maxSuggestions)) })
  let settings = (): AdvisorySettings => baseSettings
  scheduler.setMaxSuggestions(baseSettings.maxSuggestions)
  installDesignSettingsSection(ctx, AdvisorySettings, baseSettings, {
    setSource: current => { settings = current },
    onChange: () => { scheduler.setMaxSuggestions(settings().maxSuggestions) },
  })
  const unregisterStatus = host.design.registerAdvisoryRuntime(
    scheduler as DesignAdvisoryRuntimeStatusProvider<Agent>,
  )
  const admissions = new WeakMap<Agent, Promise<void>>()
  const selectionEpochs = new WeakMap<Agent, number>()
  const unregisterWorkspaceChanges = host.design.registerWorkspaceChangeListener((change) => {
    if (change.kind === 'selection-changed') {
      selectionEpochs.set(change.agent, (selectionEpochs.get(change.agent) ?? 0) + 1)
      scheduler.reset(change.agent)
    }
    if (change.kind === 'review-policy-changed') void scheduler.configureReviews(change.agent, change.policy).catch(error=>ctx.logger.warn(String(error)))
    if (change.kind === 'design-changed' && change.publication) {
      const publication = change.publication
      const epoch = selectionEpochs.get(change.agent) ?? 0
      // Read only project policy; the immutable source fold was captured at settlement.
      const admit = (admissions.get(change.agent) ?? Promise.resolve()).then(async () => {
        const policy = await host.design.readReviewPolicy(change.agent)
        const current = await host.design.projectForAgent(change.agent)
        if ((selectionEpochs.get(change.agent) ?? 0) !== epoch || current.projectId !== change.projectId) return
        await scheduler.notifyPublication(change.agent, publication, policy)
      }).catch(error => ctx.logger.warn(`design advisory: publication admission failed: ${String(error).slice(0, 1000)}`))
      admissions.set(change.agent, admit)
    }
    if(change.kind==='selection-changed'||change.kind==='workspace-restored') {
      const epoch=selectionEpochs.get(change.agent)??0
      const resume=(admissions.get(change.agent)??Promise.resolve()).then(async()=>{
        if((selectionEpochs.get(change.agent)??0)!==epoch)return
        const policy=await host.design.readReviewPolicy(change.agent)
        if((selectionEpochs.get(change.agent)??0)!==epoch)return
        await scheduler.resumePending(change.agent,policy)
      }).catch(error=>ctx.logger.warn(`design advisory: pending recovery unavailable: ${String(error).slice(0,1000)}`))
      admissions.set(change.agent,resume)
    }
  })
  ctx.effect(() => () => {
    scheduler.dispose()
    unregisterWorkspaceChanges()
    unregisterStatus()
  })
}
