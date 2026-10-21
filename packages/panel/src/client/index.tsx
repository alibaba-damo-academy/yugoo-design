/**
 * dsh-design-panel — browser half.
 *
 * Consumes the `designPanel` Remote namespace (mounted by dsh-design-core's
 * client boot entry), adds a Design toggle to the conversation toolbar,
 * and renders the design workspace as a right dock in `shell.overlay`
 * (aligned with the conversation header, below desktop chrome). Inside the dock, every skill of
 * the plugin-owned DesignJournal workspace gets a browser-style sub tab
 * (DesignTabsBar replica): panels stay mounted across tab switches, local
 * edits raise a gray dot, off-screen agent updates a "new" badge, and saves
 * round-trip through `remote.designPanel.savePanel` (host: Design Files
 * write + git commit + model notification).
 */
import type { Context } from '@deepseek-ai/cordis'
import { CanvasFontOwnerProvider, releaseCanvasFontOwner } from '../use-canvas-ui-font.mjs'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { DOCK_CSS } from './styles.ts'
import { observeHostDockGeometry, readHostDockGeometry, type HostDockGeometry } from './host-dock-geometry.ts'
import './owned-styles.ts'
import { DesignWorkspace, ReviewPolicyControl, type DesignRuntime, type DesignWorkspaceControls } from './workspace.tsx'
import { usePanelDraftObservation } from './panel-draft-observation.tsx'
import type { PanelDraftMessage } from '../panel-draft-lease.ts'
import { equalWorkspaceEmission } from './types.ts'
import { createWorkspacePollReader } from './workspace-poll-reader.ts'
import type { WorkspacePollResult } from '../../../core/src/workspace-poll.ts'
import {
  DesignContinuationBar,
  designContinuationOf,
} from './design-continuation-bar.tsx'
import type { DesignAdvisoryProjectionEntry, DesignExecutionLogRead, DesignPanelWorkspaceRead, DesignProjectCatalogRead } from './types.ts'
import { NativePanelRegistry } from './native-panel-registry.ts'
import type { BinaryArtifactRead } from './panels/shared.ts'
import {
  AdvisoryReviewCard,
  selectPendingAdvisories,
  renderAdvisoryAcceptancePrompt,
  type AdvisoryAcceptanceAuthority,
  type AdvisoryReviewEntry,
} from './ported/design/AdvisoryReviewCard.tsx'
import { AdvisorySidebarEntry, hasVisibleAdvisorySidebarEntry, observeAdvisorySidebarVisibility, pendingAdvisoryCount } from './advisory-sidebar-entry.tsx'
import { DesignProjectSidebarEntry } from './design-project-sidebar-entry.tsx'
import { executeDesignCommand, type DesignCommandRemote } from './design-command.ts'
import { currentLanguage, bindDesignHostLocale, useCurrentLanguage, type DesignHostLocale } from './ported/host.ts'
import { ExecutionRollingLog } from './execution-rolling-log.tsx'
import { requestLivePoll, subscribeLivePoll } from './live-poll.ts'
import { cancelPendingDesignNextStepQuestion, createPendingDesignInteractionSource, type UiSessionPendingFace } from './next-step-question.ts'
import { submitDesignPanelPrompt, type PanelPromptSession } from './panel-prompt-submission.ts'
// Tailwind build output and font-free icon compatibility CSS, surfaced for <style> injection
// (scoped to .dsh-design-root; the host shell's styles stay untouched).
import DESIGN_TW_CSS from './generated/design.tw.css?inline'
import ICON_GLYPH_CSS from './ported/iconfont.css?inline'
import RECORD_VISUAL_CSS from '../visual-components.css?inline'
import RECORD_FLOW_CSS from '@xyflow/react/dist/style.css?inline'
import { latestActiveFileExecution, producerExecutionForCall } from './design-activity.ts'
import { workspacePollAdmission } from './workspace-poll-policy.ts'
import {
  automaticDesignDockWidth,
  clampDesignDockWidth,
  COLLAPSED_NAV_WIDTH,
} from './dock-layout.ts'
import {
  activateDesignDockSession,
  currentDockSession,
  rail,
  setDockWidthClamp,
  setRailWidth,
  setSessionDockOpen,
  type DockTransient,
} from './dock-session-state.ts'
import {
  createPanelSessionAdapter,
  createPanelProjectFolderActions,
  type PanelProjectFolderRemote,
  type PanelSessions,
  type PanelSessionInfo,
} from './session-controller-adapter.ts'

/** The registry service starts immediately; the Panel shell waits on its host services below. */
export const inject: readonly string[] = []

let advisoryClientRevision = 0
const advisoryClientListeners = new Set<() => void>()

function bumpAdvisoryClientRevision(): void {
  advisoryClientRevision += 1
  for (const listener of advisoryClientListeners) listener()
}

const advisoryClientChanges = {
  subscribe: (listener: () => void) => {
    advisoryClientListeners.add(listener)
    return () => { advisoryClientListeners.delete(listener) }
  },
  getSnapshot: (): number => advisoryClientRevision,
}

/** The layout frame element (the grid parent of the shell overlay layer). */
function frameElement(): HTMLElement | null {
  return (document.querySelector('[data-shell-overlay]') as HTMLElement | null)?.parentElement ?? null
}

/** Compress the frame's grid by the dock width while the dock is open. */
function applyFrameInset(): void {
  const frame = frameElement()
  if (frame === null) return
  const snapshot = rail.getSnapshot()
  document.documentElement.style.setProperty('--dsh-design-dock-w', `${snapshot.width}px`)
  frame.classList.toggle('dsh-design-frame-inset', snapshot.open)
}

function clampDockWidth(width: number): number {
  return clampDesignDockWidth(window.innerWidth, width, hostNavigationWidth(frameElement()))
}

/** A bare observable that always reads undefined (absent projection face). */
const ABSENT = {
  subscribe: () => () => {},
  getSnapshot: (): unknown => undefined,
}

function useObservable<T>(source: { subscribe(fn: () => void): () => void; getSnapshot(): T }): T {
  const subscribe = useCallback((listener: () => void) => source.subscribe(listener), [source])
  const getSnapshot = useCallback(() => source.getSnapshot(), [source])
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
  )
}

/** The session provide bundle fields the dock consumes. */
type ProvideInfo = PanelSessionInfo

/** Transient bottom-center toast mirroring a /yugoo command outcome. */
function showDesignToast(text: string, kind: 'success' | 'error'): void {
  const toast = document.createElement('div')
  toast.className = `dsh-design-toast${kind === 'error' ? ' dsh-design-toast-error' : ''}`
  toast.textContent = text
  document.body.append(toast)
  window.setTimeout(() => toast.remove(), 6000)
}

/** One Remote call outcome (dsh-api-gateway client namespace methods). */
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code?: string; message?: string } }

/** Unwrap a Remote call outcome; a failed call rejects with the host error. */
async function unwrap<T>(endpoint: string, result: RemoteResult<T>): Promise<T> {
  if (!result.ok) throw new Error(`${endpoint}: ${result.error.message ?? result.error.code ?? 'remote call failed'}`)
  return result.value
}

/** Captured client services (single plugin instance; set during apply). */
let runtime: (DesignRuntime & {
  observePanelDraft: (sessionId: string, observation: PanelDraftMessage) => Promise<void>
  sessions: { currentProvideInfo: { subscribe(fn: () => void): () => void; getSnapshot(): ProvideInfo } }
}) | undefined

interface WorkspaceChannel {
  readonly sessionId: string
  readonly listeners: Set<() => void>
  snapshot: DesignPanelWorkspaceRead | undefined
  transportSnapshot?: DesignPanelWorkspaceRead
  failure: string | undefined
  unsubscribePoll: (() => void) | undefined
  generation: number
  running: boolean
  refreshAfterRun: boolean
}

const workspaceChannels = new Map<string, WorkspaceChannel>()

function projectWorkspace(response: DesignPanelWorkspaceRead): DesignPanelWorkspaceRead {
  const latest = response.latestDesignChange
  const entry = latest === undefined ? undefined : response.design[latest.skill]
  if (latest === undefined || entry === undefined) return response
  return {
    ...response,
    design: {
      ...response.design,
      [latest.skill]: { ...entry, changedSeq: latest.journalRevision },
    },
  }
}

function emitWorkspace(channel: WorkspaceChannel, snapshot: DesignPanelWorkspaceRead): void {
  const recovered = channel.failure !== undefined
  if (!recovered && channel.transportSnapshot === snapshot) return
  channel.transportSnapshot = snapshot
  if (!recovered && channel.snapshot !== undefined && equalWorkspaceEmission(channel.snapshot, snapshot)) return
  channel.failure = undefined
  channel.snapshot = projectWorkspace(snapshot)
  for (const listener of channel.listeners) listener()
}

function emitWorkspaceFailure(channel: WorkspaceChannel, failure: unknown): void {
  const message = failure instanceof Error ? failure.message : String(failure)
  if (channel.failure === message) return
  channel.failure = message
  for (const listener of channel.listeners) listener()
}

function pollWorkspace(channel: WorkspaceChannel): void {
  const generation = channel.generation
  const admission = workspacePollAdmission(generation, channel.generation, channel.listeners.size, channel.running)
  if (admission === 'stop') return
  if (admission === 'defer') {
    channel.refreshAfterRun = true
    return
  }
  channel.running = true
  const currentRuntime = runtime
  const read = currentRuntime === undefined
    ? Promise.reject(new Error('design panel: browser runtime is unavailable'))
    : currentRuntime.readWorkspace(channel.sessionId)
  void read
    .then((snapshot) => {
      if (channel.generation === generation) emitWorkspace(channel, snapshot)
    })
    .catch((error: unknown) => {
      // Keep the last complete snapshot, but never disguise a Host failure as
      // an empty Design Project. The next shared tick still retries.
      if (channel.generation === generation) emitWorkspaceFailure(channel, error)
    })
    .finally(() => {
      channel.running = false
      if (channel.generation === generation && channel.listeners.size > 0 && channel.refreshAfterRun) {
        channel.refreshAfterRun = false
        requestLivePoll()
      }
    })
}

function workspaceChannel(sessionId: string): WorkspaceChannel {
  const existing = workspaceChannels.get(sessionId)
  if (existing !== undefined) return existing
  const listeners = new Set<() => void>()
  const channel: WorkspaceChannel = {
    sessionId,
    listeners,
    snapshot: undefined,
    failure: undefined,
    unsubscribePoll: undefined,
    generation: 0,
    running: false,
    refreshAfterRun: false,
  }
  workspaceChannels.set(sessionId, channel)
  return channel
}

function workspaceSource(sessionId: string | undefined): {
  subscribe(listener: () => void): () => void
  getSnapshot(): DesignPanelWorkspaceRead | undefined
} {
  if (sessionId === undefined) {
    return { subscribe: () => () => {}, getSnapshot: () => undefined }
  }
  const channel = workspaceChannel(sessionId)
  return {
    subscribe(listener): () => void {
      const start = channel.listeners.size === 0
      if (workspaceChannels.get(sessionId) !== channel) workspaceChannels.set(sessionId, channel)
      channel.listeners.add(listener)
      if (start) {
        channel.generation += 1
        channel.unsubscribePoll = subscribeLivePoll(() => pollWorkspace(channel))
      }
      return () => {
        channel.listeners.delete(listener)
        if (channel.listeners.size !== 0) return
        channel.generation += 1
        channel.unsubscribePoll?.()
        channel.unsubscribePoll = undefined
        channel.refreshAfterRun = false
        if (workspaceChannels.get(sessionId) === channel) workspaceChannels.delete(sessionId)
      }
    },
    getSnapshot: () => channel.snapshot,
  }
}

function usePanelWorkspace(sessionId: string | undefined): DesignPanelWorkspaceRead | undefined {
  const source = useMemo(() => workspaceSource(sessionId), [sessionId])
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

function workspaceFailureSource(sessionId: string | undefined): {
  subscribe(listener: () => void): () => void
  getSnapshot(): string | undefined
} {
  if (sessionId === undefined) return { subscribe: () => () => {}, getSnapshot: () => undefined }
  const channel = workspaceChannel(sessionId)
  return {
    subscribe(listener): () => void {
      const start = channel.listeners.size === 0
      if (workspaceChannels.get(sessionId) !== channel) workspaceChannels.set(sessionId, channel)
      channel.listeners.add(listener)
      if (start) {
        channel.generation += 1
        channel.unsubscribePoll = subscribeLivePoll(() => pollWorkspace(channel))
      }
      return () => {
        channel.listeners.delete(listener)
        if (channel.listeners.size !== 0) return
        channel.generation += 1
        channel.unsubscribePoll?.()
        channel.unsubscribePoll = undefined
        channel.refreshAfterRun = false
        if (workspaceChannels.get(sessionId) === channel) workspaceChannels.delete(sessionId)
      }
    },
    getSnapshot: () => channel.failure,
  }
}

function usePanelWorkspaceFailure(sessionId: string | undefined): string | undefined {
  const source = useMemo(() => workspaceFailureSource(sessionId), [sessionId])
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}

function designSkillName(block: ToolCallViewProps['block']): string {
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const name = (parsed as Record<string, unknown>).name
      if (typeof name === 'string' && name !== '') return name
    }
  } catch {
    // A streaming argument prefix is allowed; the row will bind once complete.
  }
  return ''
}

/** Generic conversation row for one long-running Design Producer. */
function DesignSkillToolView({ block }: ToolCallViewProps): ReactElement {
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const workspace = usePanelWorkspace(info.sessionId)
  const sessionId = info.sessionId
  const readProducerExecutionLog = useCallback((executionRef: string, afterSeq?: number): Promise<DesignExecutionLogRead> => {
    const currentRuntime = runtime
    return sessionId === undefined || currentRuntime === undefined
      ? Promise.resolve({ found: false, revision: null, reset: false, entries: [] })
      : currentRuntime.readExecutionLog(sessionId, executionRef, afterSeq)
  }, [sessionId])
  const running = !('kind' in block)
  const skill = designSkillName(block)
  const root = producerExecutionForCall(workspace?.executionAttempts, skill, block.callId, running)
  const rootActive = root?.phase === 'queued' || root?.phase === 'working'
  const zh = useCurrentLanguage() === 'zh_CN'
  return (
    <div data-tool='run_design_skill' style={{ margin: '2px 0', maxWidth: 720 }}>
      {root?.runId === undefined
        ? running ? <div style={{ color: 'var(--k-color-text-light, #8b8498)', fontSize: 13 }}>{zh ? '正在准备设计技能…' : 'Preparing Design skill…'}</div> : null
        : <ExecutionRollingLog
            runId={root.runId}
            active={running && rootActive}
            terminalSequence={rootActive ? undefined : root.sequence}
            locale={zh ? 'zh' : 'en'}
            label={zh ? 'Producer 日志' : 'Producer log'}
            presentation='conversation'
            readExecutionLog={sessionId === undefined || runtime === undefined ? undefined : readProducerExecutionLog}
          />}
    </div>
  )
}

function refreshPanelWorkspace(sessionId: string): void {
  const channel = workspaceChannels.get(sessionId)
  if (channel === undefined || channel.listeners.size === 0) return
  if (channel.running) channel.refreshAfterRun = true
  requestLivePoll()
}

function disposeWorkspaceChannels(): void {
  for (const channel of workspaceChannels.values()) {
    channel.generation += 1
    channel.unsubscribePoll?.()
  }
  workspaceChannels.clear()
}

let layout: { toggleSidebar(): void } | undefined

interface SidebarCollapseLease {
  readonly frame: HTMLElement
  readonly observer: MutationObserver
  expectedMutation: boolean
  owned: boolean
}

let sidebarCollapseLease: SidebarCollapseLease | undefined

/** Read the rendered Host navigation width for the no-collapse fallback. */
function hostNavigationWidth(frame: HTMLElement | null): number {
  const width = frame?.firstElementChild?.getBoundingClientRect().width
  return width !== undefined && Number.isFinite(width) ? Math.max(0, width) : COLLAPSED_NAV_WIDTH
}

/** Release ownership and optionally restore navigation collapsed by this dock lifecycle. */
function releaseSidebarCollapseLease(restore: boolean): void {
  const lease = sidebarCollapseLease
  sidebarCollapseLease = undefined
  if (lease === undefined) return
  lease.observer.disconnect()
  if (restore && lease.owned && lease.frame.dataset.sidebarCollapsed !== undefined) layout?.toggleSidebar()
}

/** Collapse Host navigation for one Design-dock lifecycle and calculate its 70% width. */
function prepareDesignLayout(): number {
  releaseSidebarCollapseLease(false)
  const frame = frameElement()
  if (frame !== null && frame.dataset.sidebarCollapsed === undefined && layout !== undefined) {
    const lease: SidebarCollapseLease = {
      frame,
      observer: new MutationObserver((records) => {
        if (!lease.owned) return
        if (lease.expectedMutation) {
          lease.expectedMutation = false
          if (records.length === 1 && frame.dataset.sidebarCollapsed !== undefined) return
        }
        // Any later Host or user transition supersedes our restore ownership.
        lease.owned = false
        lease.observer.disconnect()
      }),
      expectedMutation: true,
      owned: true,
    }
    lease.observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    sidebarCollapseLease = lease
    try {
      layout.toggleSidebar()
      return automaticDesignDockWidth(window.innerWidth)
    } catch (error: unknown) {
      // A Host that exposes an unwired layout face degrades to its current
      // navigation width; the Design dock remains usable and does not claim
      // ownership of Host chrome it failed to change.
      void error
      releaseSidebarCollapseLease(false)
    }
  }
  return automaticDesignDockWidth(window.innerWidth, hostNavigationWidth(frame))
}

/** Open Design through one layout path for manual and activity-driven entry. */
function openDesignDock(sessionId: string | undefined, patch: DockTransient = {}): void {
  if (sessionId === undefined || sessionId !== currentDockSession()) return
  if (!rail.getSnapshot().open) setRailWidth(prepareDesignLayout())
  setSessionDockOpen(sessionId, true, patch)
}

/** Close Design and restore navigation only when this opening collapsed it. */
function closeDesignDock(sessionId: string | undefined): void {
  if (sessionId === undefined || sessionId !== currentDockSession()) return
  setSessionDockOpen(sessionId, false)
  releaseSidebarCollapseLease(true)
}

/**
 * Mount the shared native-renderer service and the generic Panel shell consumer.
 * @param ctx - client root context that owns both child lifecycles.
 * @returns nothing; Cordis owns the service and injected shell scopes.
 */
export function apply(ctx: Context): void {
  ctx.inject(['locale'], (scope: Context) => {
    const source = (scope as unknown as { locale: DesignHostLocale }).locale
    scope.effect(() => bindDesignHostLocale(source), 'design panel: host locale')
  })
  ctx.plugin(NativePanelRegistry)
  ctx.inject(
    ['slots', 'sessions', 'remote', 'remote.session', 'remote.commands', 'remote.designPanel', 'layout', 'uiSession', 'designNativePanels'],
    (scope: Context) => { mountPanelShell(scope) },
  )
}

/**
 * Register the header toggle and overlay dock after every required browser service is live.
 * @param ctx - injected client scope carrying host services and the native Panel registry.
 */
function mountPanelShell(ctx: Context): void {
  const timedRequest = async <T,>(session: string, phase: string, run: () => Promise<T>): Promise<T> => {
    const started = performance.now()
    const log = (edge: 'start' | 'end'): void => {
      try { ctx.logger.info(JSON.stringify({ tag: 'yugoo-panel-client', session, phase, edge,
        at: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started) })) } catch { /* Diagnostics are not admission. */ }
    }
    log('start')
    try { return await run() } finally { log('end') }
  }
  const fontOwner = {}
  ctx.effect(() => () => releaseCanvasFontOwner(fontOwner), 'design panel: canvas font owner')
  const OwnedDesignDock = () => <CanvasFontOwnerProvider owner={fontOwner}><DesignDock /></CanvasFontOwnerProvider>
  const face = ctx as unknown as {
    designNativePanels: NativePanelRegistry
    slots: {
      inject: (name: string, contribute: () => unknown) => void
      register: (spec: Record<string, unknown>, component: unknown) => () => void
    }
    sessions: PanelSessions
    uiSession: UiSessionPendingFace & {
      adapter?: { current: import('./session-controller-adapter.ts').CurrentPanelSessionSource<import('./session-controller-adapter.ts').PanelCurrentSessionBinding> }
    }
    remote: {
      commands?: DesignCommandRemote
      session?: PanelProjectFolderRemote
      designPanel: {
        admitSavedAssessment(id: string, request: import('../../../core/src/design-clarity-runtime.ts').SavedDesignAssessmentRequest):
          Promise<RemoteResult<import('../../../core/src/design-clarity-runtime.ts').SavedDesignAssessmentAdmission>>
        observePanelDraft(id: string, observation: PanelDraftMessage): Promise<RemoteResult<{ observed: true }>>
        readWorkspace(id: string): Promise<RemoteResult<DesignPanelWorkspaceRead>>
        pollWorkspace(id: string, knownRevision: string | null): Promise<RemoteResult<WorkspacePollResult<DesignPanelWorkspaceRead>>>
        retainAutoPanel(id: string, request: { projectId: string; skill: string; sourceRevision: string; definitionRevision: string }): Promise<RemoteResult<{ retained: true }>>
        readReviewPolicy(id: string): Promise<RemoteResult<import('../../../core/src/design-review-policy.ts').DesignReviewPolicy>>
        updateReviewPolicy(id: string, policy: import('../../../core/src/design-review-policy.ts').DesignReviewPolicy): Promise<RemoteResult<import('../../../core/src/design-review-policy.ts').DesignReviewPolicy>>
        savePanel(
          id: string,
          skill: string,
          state: unknown,
          artifacts?: readonly { readonly path: string; readonly content: string; readonly encoding?: 'base64' }[] | { readonly autoBefore: unknown; readonly definitionRevision?: string },
          eventId?: string,
        ): Promise<RemoteResult<{ commit?: string }>>
        readGraph(id: string): Promise<RemoteResult<{ content: string }>>
        readKnowledgeStatus(id: string): Promise<RemoteResult<import('../../../core/src/design-knowledge-status.ts').DesignKnowledgeStatusSnapshot | undefined>>
        retryKnowledge(id: string): Promise<RemoteResult<{ accepted: boolean }>>
        queryKnowledge(id: string, args: import('../../../core/src/design-knowledge-query.ts').KnowledgeReadArguments): Promise<RemoteResult<import('../../../core/src/design-knowledge-query.ts').KnowledgeReadResult>>
        readArtifact(id: string, relPath: string, stateRevision: string): Promise<RemoteResult<{ found: boolean; content: string }>>
        readExecutionLog(id: string, executionRef: string, afterSeq?: number): Promise<RemoteResult<DesignExecutionLogRead>>
        readBinaryArtifact(id: string, relPath: string, stateRevision: string): Promise<RemoteResult<BinaryArtifactRead>>
        listSkills(id: string): Promise<RemoteResult<{
          mindset: string | undefined
          skills: { id: string; description: string; manifest: Record<string, unknown> }[]
        }>>
        listProjects(id: string): Promise<RemoteResult<DesignProjectCatalogRead>>
        decideAdvisory(id: string, decision: {
          advisoryId: string
          decision: 'accepted' | 'rejected' | 'deferred'
        }): Promise<RemoteResult<DesignAdvisoryProjectionEntry>>
        listAdvisories(id: string): Promise<RemoteResult<readonly DesignAdvisoryProjectionEntry[]>>
      }
    }
    layout: { toggleSidebar(): void }
  }
  // The designPanel namespace is mounted by dsh-design-core's client boot
  // entry (package.json boot edge orders it first), so it is ready here.
  const nativePanels = face.designNativePanels
  layout = face.layout
  const panelSession = createPanelSessionAdapter(face.sessions, face.uiSession.adapter?.current)
  const pendingInteractions = createPendingDesignInteractionSource(face.uiSession)
  const mountedRuntime: NonNullable<typeof runtime> = {
    ...createPanelProjectFolderActions(face.remote.session),
    observePanelDraft: async (id, observation) => { await unwrap('designPanel/observePanelDraft', await face.remote.designPanel.observePanelDraft(id, observation)) },
    nativePanels,
    readReviewPolicy: async id => unwrap('designPanel/readReviewPolicy', await face.remote.designPanel.readReviewPolicy(id)),
    updateReviewPolicy: async (id, policy) => unwrap('designPanel/updateReviewPolicy', await face.remote.designPanel.updateReviewPolicy(id, policy)),
    sessions: { currentProvideInfo: panelSession.source },
    readWorkspace: createWorkspacePollReader(async (sessionId, knownRevision) => unwrap(
      'designPanel/pollWorkspace',
      await face.remote.designPanel.pollWorkspace(sessionId, knownRevision),
    )),
    savePanel: async (sessionId, skill, state, artifacts, eventId) => {
      const result = await timedRequest(sessionId, 'save-rpc', async () => unwrap('designPanel/savePanel',
        await face.remote.designPanel.savePanel(sessionId, skill, state, artifacts ?? [], eventId)))
      refreshPanelWorkspace(sessionId)
      return result
    },
    retainAutoPanel: async (sessionId, request) => {
      const result = await unwrap('designPanel/retainAutoPanel', await face.remote.designPanel.retainAutoPanel(sessionId, request))
      refreshPanelWorkspace(sessionId)
      return result
    },
    readGraph: async sessionId => unwrap('designPanel/readGraph', await face.remote.designPanel.readGraph(sessionId)),
    readKnowledgeStatus: async sessionId => unwrap('designPanel/readKnowledgeStatus', await face.remote.designPanel.readKnowledgeStatus(sessionId)),
    retryKnowledge: async sessionId => unwrap('designPanel/retryKnowledge', await face.remote.designPanel.retryKnowledge(sessionId)),
    queryKnowledge: async (sessionId, args) => unwrap('designPanel/queryKnowledge', await face.remote.designPanel.queryKnowledge(sessionId, args)),
    readArtifact: async (sessionId, relPath, stateRevision) => unwrap('designPanel/readArtifact', await face.remote.designPanel.readArtifact(sessionId, relPath, stateRevision)),
    readExecutionLog: async (sessionId, executionRef, afterSeq) => unwrap(
      'designPanel/readExecutionLog',
      await face.remote.designPanel.readExecutionLog(sessionId, executionRef, afterSeq),
    ),
    readBinaryArtifact: async (sessionId, relPath, stateRevision) => unwrap(
      'designPanel/readBinaryArtifact',
      await face.remote.designPanel.readBinaryArtifact(sessionId, relPath, stateRevision),
    ),
    listSkills: async (sessionId) => unwrap('designPanel/listSkills', await face.remote.designPanel.listSkills(sessionId)),
    listProjects: async (sessionId) => unwrap('designPanel/listProjects', await face.remote.designPanel.listProjects(sessionId)),
    decideAdvisory: async (sessionId, advisoryId, decision) => {
      const entry = await unwrap(
        'designPanel/decideAdvisory',
        await face.remote.designPanel.decideAdvisory(sessionId, { advisoryId, decision }),
      )
      bumpAdvisoryClientRevision()
      return entry
    },
    listAdvisories: async (sessionId) => unwrap(
      'designPanel/listAdvisories',
      await face.remote.designPanel.listAdvisories(sessionId),
    ),
    cancelPendingNextStepQuestion: async sessionId => timedRequest(sessionId, 'cancel-next-step', () =>
      cancelPendingDesignNextStepQuestion(pendingInteractions, sessionId)),
    sendCommand: async (sessionId, line) => executeDesignCommand(face.remote.commands, sessionId, line),
    sendPrompt: async (sessionId, text, requestId, saved) => {
      const binding = face.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`design panel: no session binding for "${sessionId}"`)
      const session = binding.session as unknown as PanelPromptSession<RemoteResult<{ accepted: true }>>
      await timedRequest(sessionId, 'queue-prompt', async () => unwrap('session.prompt',
        await submitDesignPanelPrompt(session, text, requestId, saved?.length ? id => {
          // The ordinary prompt already succeeded. This metadata-only RPC may
          // validate legacy receipt metadata; main-turn reporting owns scoring.
          void Promise.resolve().then(() => face.remote.designPanel.admitSavedAssessment(sessionId, { requestId: id, saves: saved }))
            .then(result => unwrap('designPanel/admitSavedAssessment', result))
            .then(result => {
              if (result.status === 'unavailable') throw new Error('Saved-checkpoint receipt registration is unavailable.')
            }).catch((error: unknown) => {
              // The save and ordinary message already succeeded. Do not label
              // either failed, or silently pretend assessment has started.
              if (currentDockSession() === sessionId) showDesignToast(currentLanguage() === 'zh_CN'
                ? '设计已保存，消息已发送；保存凭据未能登记。'
                : 'Design saved and message sent; save receipts could not be registered.', 'error')
              try { ctx.logger.warn(`design panel assessment admission: ${(error instanceof Error ? error.message : String(error)).slice(0, 1000)}`) } catch { /* Diagnostics cannot undo admission. */ }
            }).finally(() => { refreshPanelWorkspace(sessionId) })
        } : undefined)))
    },
  }
  runtime = mountedRuntime
  ctx.effect(() => () => {
    panelSession.dispose()
    if (runtime === mountedRuntime) runtime = undefined
    disposeWorkspaceChannels()
    releaseSidebarCollapseLease(true)
    if (layout === face.layout) layout = undefined
    frameElement()?.classList.remove('dsh-design-frame-inset')
    document.documentElement.style.removeProperty('--dsh-design-dock-w')
  }, 'design panel: browser runtime')
  ctx.effect(() => {
    setDockWidthClamp(clampDockWidth)
    applyFrameInset()
    const source = panelSession.source
    const activate = (): void => {
      activateDesignDockSession((source.getSnapshot() as ProvideInfo).sessionId)
    }
    activate()
    const disposeActivation = source.subscribe(activate)
    const disposeInset = rail.subscribe(applyFrameInset)
    return () => {
      disposeActivation()
      disposeInset()
    }
  }, 'design panel: session dock activation')
  ctx.effect(() => {
    const frame = frameElement()
    let animationFrame: number | undefined
    const reconcileDockWidth = (): void => {
      animationFrame = undefined
      const snapshot = rail.getSnapshot()
      if (!snapshot.open) return
      // Opening owns the initial Design-first layout. Later Host changes,
      // including manually expanded navigation, only constrain its width.
      const width = clampDockWidth(snapshot.width)
      if (width !== snapshot.width) setRailWidth(width)
    }
    const scheduleReconcile = (): void => {
      if (animationFrame !== undefined) return
      animationFrame = window.requestAnimationFrame(reconcileDockWidth)
    }
    const disposeRailReflow = rail.subscribe(scheduleReconcile)
    window.addEventListener('resize', scheduleReconcile)
    const navigation = frame?.firstElementChild
    const resizeObserver = navigation === null || navigation === undefined
      ? undefined
      : new ResizeObserver(scheduleReconcile)
    if (navigation !== null && navigation !== undefined) resizeObserver?.observe(navigation)
    const sidebarObserver = frame === null
      ? undefined
      : new MutationObserver(scheduleReconcile)
    if (frame !== null) {
      sidebarObserver?.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
    }
    // The per-session open flags and the page width survive session switches
    // and hot client remounts. Fit a restored open dock to the current Host
    // layout without reapplying its one-time opening policy.
    scheduleReconcile()
    return () => {
      disposeRailReflow()
      window.removeEventListener('resize', scheduleReconcile)
      resizeObserver?.disconnect()
      sidebarObserver?.disconnect()
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
    }
  }, 'design panel: Host layout reflow')
  // The pre-content empty state renders no message flow, so the /yugoo
  // command's flow node is invisible there; mirror its outcome as a toast.
  const commandEvents = ctx as unknown as {
    on(
      name: 'command/executed',
      listener: (sessionId: string, name: string, result: { kind: 'success' | 'error'; text?: string }) => void,
    ): () => void
  }
  commandEvents.on('command/executed', (_sessionId, name, result) => {
    if ((name !== 'yugoo' && name !== 'design') || result.text === undefined) return
    showDesignToast(result.text, result.kind)
  })
  // The official open-in-app entry uses order -10 in this same public slot.
  face.slots.inject('conversation.session.header.utilities', () => face.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'design-toggle',
    order: -20,
  }, DesignToggle))
  face.slots.inject('tool.call.toolview', () => face.slots.register({
    name: 'tool.call.toolview',
    key: 'run_design_skill',
  }, DesignSkillToolView))
  face.slots.inject('sidebar.footer.action', () => face.slots.register({
    name: 'sidebar.footer.action',
    id: 'design-sidebar-actions',
    order: 90,
  }, DesignSidebarActionsHost))
  face.slots.inject('conversation.input.left', () => face.slots.register({
    name: 'conversation.input.left',
    id: 'design-advisory-entry',
    order: 90,
  }, AdvisoryComposerEntry))
  face.slots.inject('conversation.input.dock', () => face.slots.register({
    name: 'conversation.input.dock',
    id: 'design-advisories',
    order: 20,
  }, AdvisoryComposerInbox))
  face.slots.inject('conversation.input.dock', () => face.slots.register({
    name: 'conversation.input.dock',
    id: 'design-continuation',
    order: 30,
  }, DesignContinuationHost))
  face.slots.inject('shell.overlay', () => face.slots.register({
    name: 'shell.overlay',
    id: 'design',
    order: 50,
  }, OwnedDesignDock))
}

/** Rebind/clean up with the dock's actual session lifecycle, before painting. */
function useHostDockGeometry(sessionId: string | undefined): HostDockGeometry {
  const [geometry, setGeometry] = useState(() => readHostDockGeometry(document))
  useLayoutEffect(() => observeHostDockGeometry(document, next => {
    setGeometry(previous => previous.top === next.top && previous.headerHeight === next.headerHeight ? previous : next)
  }), [sessionId])
  return geometry
}

/** Focus the host composer input so the user can adjust the continuation request. */
function focusHostComposer(): void {
  document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')?.focus()
}

let advisoryInboxVisibilityRevision = 0
const advisoryInboxVisibilityBySession = new Map<string, boolean>()
const advisoryOpeningTargetBySession = new Map<string, string>()
const advisoryInboxVisibilityListeners = new Set<() => void>()
const advisoryInboxVisibility = {
  subscribe: (listener: () => void): (() => void) => {
    advisoryInboxVisibilityListeners.add(listener)
    return () => { advisoryInboxVisibilityListeners.delete(listener) }
  },
  getSnapshot: (): number => advisoryInboxVisibilityRevision,
  isExpanded: (sessionId: string | undefined): boolean => (
    sessionId === undefined ? false : advisoryInboxVisibilityBySession.get(sessionId) ?? false
  ),
  setExpanded: (sessionId: string | undefined, expanded: boolean, target?: string): void => {
    if (sessionId === undefined || advisoryInboxVisibility.isExpanded(sessionId) === expanded) return
    if (target === undefined) advisoryOpeningTargetBySession.delete(sessionId)
    else advisoryOpeningTargetBySession.set(sessionId, target)
    advisoryInboxVisibilityBySession.set(sessionId, expanded)
    advisoryInboxVisibilityRevision += 1
    for (const listener of advisoryInboxVisibilityListeners) listener()
  },
  toggle: (sessionId: string | undefined): boolean => {
    if (sessionId === undefined) return false
    const expanded = !advisoryInboxVisibility.isExpanded(sessionId)
    advisoryInboxVisibility.setExpanded(sessionId, expanded)
    return expanded
  },
}

/** Share one per-session inbox toggle across the sidebar and composer slots. */
function useAdvisoryInboxExpanded(sessionId: string | undefined): boolean {
  useSyncExternalStore(advisoryInboxVisibility.subscribe, advisoryInboxVisibility.getSnapshot)
  return advisoryInboxVisibility.isExpanded(sessionId)
}

/** Reveal the single Design-advisory review UI mounted above the composer. */
function revealAdvisoryComposerInbox(): void {
  window.requestAnimationFrame(() => {
    const inbox = document.querySelector<HTMLElement>('#dsh-advisory-composer-inbox')
    if (inbox === null) return
    inbox.scrollIntoView({ block: 'nearest' })
    inbox.focus({ preventScroll: true })
  })
}

/**
 * Native continuation bar above the composer: presents the Runtime's current
 * user-continue choice (Continue / Later / Adjust). Continue sends the exact
 * manifest resume label through the ordinary composer path, opening a new
 * user turn. Bundle panels do not render a second continuation control.
 */
function DesignContinuationHost(): ReactElement | null {
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const session = useObservable(info.hooks?.session ?? ABSENT) as { running?: boolean } | undefined
  const descriptor = designContinuationOf(usePanelWorkspace(info.sessionId)?.continuations)
  const sessionId = info.sessionId
  if (descriptor === undefined || sessionId === undefined || session?.running === true) return null
  return (
    <DesignContinuationBar
      descriptor={descriptor}
      onContinue={(label) => { void runtime?.sendPrompt(sessionId, label) }}
      onAdjust={focusHostComposer}
    />
  )
}

/** Toolbar entry before the Host's file-open action, independent of view tabs. */
function DesignToggle(): ReactElement | null {
  const isZh = useCurrentLanguage() === 'zh_CN'
  const snap = useSyncExternalStore(rail.subscribe, rail.getSnapshot)
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const currentSession = useObservable(info.hooks?.session ?? ABSENT) as { running?: boolean } | undefined
  const workspace = usePanelWorkspace(info.sessionId)
  const design = workspace?.design
  const { entries: advisories } = useAdvisoryEntries(info)
  const pending = pendingAdvisoryCount(advisoryReviewEntries(advisories))
  const previousPending = useRef(0)
  const previousProject = useRef<string | null | undefined>(undefined)
  const observedWorktree = useRef<{
    readonly sessionId: string
    readonly projectId: string
    readonly skills: ReadonlySet<string>
    readonly activeInvocation?: string
  }>()
  useEffect(() => {
    if (previousPending.current === 0 && pending > 0) {
      showDesignToast(`${pending} design ${pending === 1 ? 'advisory needs' : 'advisories need'} review`, 'success')
    }
    previousPending.current = pending
  }, [pending])
  useEffect(() => {
    const sessionId = info.sessionId
    const projectId = workspace?.projectId
    if (sessionId === undefined || workspace === undefined || projectId == null || design === undefined) return
    const skills = new Set(Object.keys(design))
    const active = latestActiveFileExecution(design, workspace.executionAttempts)
    const previous = observedWorktree.current
    const sameWorkspace = previous?.sessionId === sessionId && previous.projectId === projectId
    const added = sameWorkspace ? [...skills].filter(skill => !previous.skills.has(skill)) : []
    const shouldFocusActive = active !== undefined
      && (!sameWorkspace || previous.activeInvocation !== active.invocationId)
    const latestProducer = !sameWorkspace && currentSession?.running === true
      ? [...workspace.executionAttempts].reverse().find(attempt => (
          attempt.role === 'producer' && attempt.artifactKind === undefined && design[attempt.skill] !== undefined
        ))
      : undefined
    observedWorktree.current = {
      sessionId,
      projectId,
      skills,
      ...(active === undefined ? {} : { activeInvocation: active.invocationId }),
    }
    const skill = shouldFocusActive ? active.skill : added.at(-1) ?? latestProducer?.skill
    if (skill === undefined) return
    const snapshot = rail.getSnapshot()
    openDesignDock(sessionId, {
      focus: { skill, nonce: (snapshot.focus?.nonce ?? 0) + 1 },
    })
  }, [currentSession?.running, design, info.sessionId, workspace?.executionAttempts, workspace?.projectId, workspace?.worktreeRevision])
  useEffect(() => {
    const projectId = workspace?.projectId
    const previous = previousProject.current
    previousProject.current = projectId
    if (projectId === undefined || projectId === previous) return
    // Selecting or creating a project only enables the Design button; the dock
    // opens solely from a manual click or real Design activity.
    if (projectId === null) closeDesignDock(info.sessionId)
  }, [workspace?.projectId, info.sessionId])
  if (info.sessionId === undefined) return null
  return (
    <button
      type='button'
      data-testid='design-toolbar-toggle'
      className={`dsh-design-toggle${snap.open ? ' dsh-design-toggle-active' : ''}`}
      aria-pressed={snap.open}
      onClick={() => { snap.open ? closeDesignDock(info.sessionId) : openDesignDock(info.sessionId) }}
    >
      {isZh ? 'Yugoo设计' : 'Yugoo Design'}
    </button>
  )
}

/** Read advisory entries whenever the standard inbox or plugin workspace advances. */
function useAdvisoryEntries(info: ProvideInfo): {
  readonly entries: readonly DesignAdvisoryProjectionEntry[]
  readonly loaded: boolean
  readonly refresh: () => Promise<void>
} {
  const inboxRevision = useObservable(info.projections?.faceOf('designAdvisoryInbox') ?? ABSENT) as number | undefined
  const workspace = usePanelWorkspace(info.sessionId)
  const clientRevision = useSyncExternalStore(advisoryClientChanges.subscribe, advisoryClientChanges.getSnapshot)
  const scope = JSON.stringify([info.sessionId ?? null, workspace?.projectId ?? null])
  const [snapshot, setSnapshot] = useState<{
    readonly scope: string
    readonly entries: readonly DesignAdvisoryProjectionEntry[]
  }>()
  const request = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    const sessionId = info.sessionId
    const projectId = workspace?.projectId
    const current = ++request.current
    if (sessionId === undefined || projectId === undefined || projectId === null || runtime === undefined) {
      setSnapshot(undefined)
      return
    }
    const next = await runtime.listAdvisories(sessionId)
    if (current === request.current) setSnapshot({ scope, entries: next })
  }, [info.sessionId, scope, workspace?.projectId])
  useEffect(() => {
    void refresh().catch(() => {
      if (info.sessionId === undefined) setSnapshot(undefined)
    })
    return () => { request.current += 1 }
  }, [clientRevision, inboxRevision, refresh, info.sessionId, workspace?.projectId, workspace?.journalRevision])
  const loaded = snapshot?.scope === scope
  return { entries: loaded ? snapshot.entries : [], loaded, refresh }
}

/** Narrow the Design projection to the fields accepted by the shared review card. */
function advisoryReviewEntries(projected: readonly DesignAdvisoryProjectionEntry[]): readonly AdvisoryReviewEntry[] {
  return projected.flatMap((entry) => {
    // A stale input pin means the advice must be revalidated before action; it
    // is not a terminal disposition and must remain visible to the reviewer.
    if (entry.advisory.attention !== 'human-review' || entry.advisory.acceptanceInstruction === undefined) return []
    return [{
      publishedAt: entry.publishedAt,
      publishedRevision: entry.publishedRevision,
      status: entry.status,
      stale: entry.stale,
      ...(entry.acceptanceReceiptId === undefined ? {} : { acceptanceReceiptId: entry.acceptanceReceiptId }),
      ...(entry.actionReceipts === undefined ? {} : { actionReceipts: entry.actionReceipts }),
      ...(entry.executionStatus === undefined ? {} : { executionStatus: entry.executionStatus }),
      advisory: {
        ...entry.advisory,
        attention: 'human-review' as const,
        acceptanceInstruction: entry.advisory.acceptanceInstruction,
      },
    }]
  })
}

/** Persistent left-navigation project directory; mutations stay ordinary `/yugoo` commands. */
function DesignProjectSidebarHost({ wide }: { readonly wide: boolean }): ReactElement {
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const [expanded, setExpanded] = useState(false)
  const [catalog, setCatalog] = useState<DesignProjectCatalogRead | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef(0)
  const refresh = useCallback(async (): Promise<void> => {
    const sessionId = info.sessionId
    const current = ++request.current
    if (runtime === undefined || sessionId === undefined) {
      setCatalog(null)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const next = await runtime.listProjects(sessionId)
      if (current === request.current) setCatalog(next)
    } catch (failure) {
      if (current === request.current) setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [info.sessionId])
  useEffect(() => {
    if (expanded) void refresh()
    return () => { request.current += 1 }
  }, [expanded, refresh])
  return (
    <DesignProjectSidebarEntry
      wide={wide}
      expanded={expanded}
      catalog={catalog}
      loading={loading}
      error={error}
      onToggle={() => { setExpanded(value => !value) }}
      onRefresh={() => { void refresh() }}
      onCommand={(command) => {
        const sessionId = info.sessionId
        if (runtime === undefined || sessionId === undefined) return
        const submit = runtime.sendCommand
        if (submit === undefined) {
          setError('design panel: host command API unavailable')
          return
        }
        void submit(sessionId, command).then(() => { setExpanded(false) }).catch(failure => {
          setError(failure instanceof Error ? failure.message : String(failure))
        })
      }}
    />
  )
}

/** Persistent left-navigation entry that only opens the existing advisory review UI. */
function AdvisorySidebarHost({ wide, composer = false }: { readonly wide: boolean; readonly composer?: boolean }): ReactElement {
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const advisories = useAdvisoryEntries(info)
  const entries = advisoryReviewEntries(advisories.entries)
  const sessionId = info.sessionId
  const workspace = usePanelWorkspace(sessionId)
  const projectId = workspace?.projectId
  const failure = usePanelWorkspaceFailure(sessionId)
  const expanded = useAdvisoryInboxExpanded(sessionId)
  return (
    <AdvisorySidebarEntry
      key={`${sessionId ?? 'none'}:${projectId ?? 'none'}`}
      wide={wide}
      location={composer ? 'composer' : 'sidebar'}
      entries={entries}
      runtime={projectId ? workspace?.advisoryRuntime : undefined}
      disconnected={failure !== undefined}
      expanded={expanded}
      onToggle={() => {
        const next = advisoryInboxVisibility.toggle(sessionId)
        if (next) void advisories.refresh().catch(() => {})
      }}
    />
  )
}

/** Only mount another projection reader when the Host has no usable sidebar action. */
function AdvisoryComposerEntry(): ReactElement | null {
  const [sidebarVisible, setSidebarVisible] = useState(() => hasVisibleAdvisorySidebarEntry(document))
  const focusComposer = useRef(false)
  useLayoutEffect(() => observeAdvisorySidebarVisibility(document, visible => {
    focusComposer.current = !visible && document.activeElement?.closest('[data-advisory-entry="sidebar"]') != null
    if (visible && document.activeElement?.closest('[data-advisory-entry="composer"]')) {
      document.querySelector<HTMLElement>('[data-advisory-entry="sidebar"] .dsh-advisory-sidebar-trigger')?.focus({ preventScroll: true })
    }
    setSidebarVisible(visible)
  }), [])
  useLayoutEffect(() => {
    if (!sidebarVisible && focusComposer.current) {
      document.querySelector<HTMLElement>('[data-advisory-entry="composer"] .dsh-advisory-sidebar-trigger')?.focus({ preventScroll: true })
      focusComposer.current = false
    }
  }, [sidebarVisible])
  return sidebarVisible ? null : <AdvisorySidebarHost wide={false} composer />
}

/** Keep the two independent Design sidebar buttons vertically ordered. */
function DesignSidebarActionsHost({ wide }: { readonly wide: boolean }): ReactElement {
  return (
    <div className={`dsh-design-sidebar-actions${wide ? '' : ' dsh-design-sidebar-actions-rail'}`}>
      <DesignProjectSidebarHost wide={wide} />
      <AdvisorySidebarHost wide={wide} />
    </div>
  )
}

/** The right dock: chrome + plugin-owned workspace for the current session. */
function DesignDock(): ReactElement | null {
  const snap = useSyncExternalStore(rail.subscribe, rail.getSnapshot)
  if (!snap.open || runtime === undefined) return null
  return <DockContent />
}

/** Pointer event subset the resize handle consumes. */
interface HandlePointerEvent {
  clientX: number
  pointerId: number
  currentTarget: HTMLDivElement
  preventDefault(): void
}

/** The dock's left-edge drag strip: dragging resizes the dock (and the conversation). */
function DockResizeHandle(): ReactElement {
  const onPointerDown = (event: HandlePointerEvent): void => {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = rail.getSnapshot().width
    const onMove = (move: PointerEvent): void => { setRailWidth(startWidth + (startX - move.clientX)) }
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }
  return <div className='dsh-design-dock-resize' onPointerDown={onPointerDown} />
}

/** Dock body bound to the current session's provide bundle. */
function DockContent(): ReactElement | null {
  useCurrentLanguage()
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const geometry = useHostDockGeometry(info.sessionId)
  const workspace = usePanelWorkspace(info.sessionId)
  const workspaceFailure = usePanelWorkspaceFailure(info.sessionId)
  const drafts = usePanelDraftObservation(workspace?.projectId && info.sessionId
    ? { key: `${info.sessionId}:${workspace.projectId}`, projectId: workspace.projectId } : undefined,
    async message => { if (runtime && info.sessionId) await runtime.observePanelDraft(info.sessionId, message) })
  const observeControls = drafts.observe
  if (runtime === undefined) return null
  const dockStyle = {
    '--dsh-design-dock-top': `${geometry.top}px`,
    '--dsh-host-primary-header-height': `${geometry.headerHeight}px`,
  } as CSSProperties
  if (workspace === undefined && workspaceFailure !== undefined) {
    const isZh = currentLanguage() === 'zh_CN'
    return (
      <div className='dsh-design-dock dsh-design-root' style={dockStyle}>
        <style>{DESIGN_TW_CSS}</style>
        <style>{DOCK_CSS}</style>
        <div className='flex min-h-0 flex-1 items-center justify-center p-8'>
          <div role='alert' className='max-w-xl rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900 shadow-sm'>
            <div className='mb-2 text-base font-semibold'>{isZh ? '设计面板加载失败' : 'Design Panel failed to load'}</div>
            <div className='break-words opacity-80'>{workspaceFailure}</div>
            <button type='button' className='mt-4 rounded-lg border border-red-300 bg-white px-3 py-2 font-medium' onClick={() => {
              if (info.sessionId !== undefined) refreshPanelWorkspace(info.sessionId)
            }}>{isZh ? '重试' : 'Retry'}</button>
          </div>
        </div>
        <DockResizeHandle />
      </div>
    )
  }
  return (
    <div className='dsh-design-dock dsh-design-root' style={dockStyle}>
      {/* DESIGN_TW_CSS first: its scoped preflight zeroes border-width under
          .dsh-design-root at the same specificity as the dock chrome rules,
          so DOCK_CSS must come later to win the cascade tie. */}
      <style>{DESIGN_TW_CSS}</style>
      <style>{RECORD_FLOW_CSS}</style>
      <style>{RECORD_VISUAL_CSS}</style>
      <style>{DOCK_CSS}</style>
      <style>{ICON_GLYPH_CSS}</style>
      <div className='flex min-h-0 flex-1 flex-col'>
        {drafts.notice}
        <div className='min-h-0 flex-1'>
          <DesignWorkspace
            onControlsChange={observeControls}
            experienceAvailable
            design={workspace?.design}
            projectId={workspace?.projectId ?? null}
            checkpoint={workspace?.checkpoint ?? null}
            publicationError={workspace?.publicationError}
            worktreeRevision={workspace?.worktreeRevision ?? null}
            artifactFiles={workspace?.artifactFiles}
            autoPanelManifests={workspace?.autoPanelManifests}
            autoPanelDefinitions={workspace?.autoPanelDefinitions}
            autoPanelStates={workspace?.autoPanelStates}
            experienceFiles={workspace?.experienceFiles}
            executionAttempts={workspace?.executionAttempts ?? []}
            activeMainBundles={workspace?.activeMainBundles}
            mustEditHandoffs={workspace?.mustEditHandoffs}
            access={workspace?.access ?? { mode: 'unbound', writable: false }}
            clarity={workspace?.clarity}
            projectName={workspace?.projectName}
            projectPath={workspace?.projectPath}
            sessionId={info.sessionId}
            runtime={runtime}
            dockOpen
            focus={rail.getSnapshot().focus}
            onClose={() => { closeDesignDock(info.sessionId) }}
          />
        </div>
      </div>
      <DockResizeHandle />
    </div>
  )
}

/** Actionable advisory messages mounted above the host composer card. */
function AdvisoryComposerInbox(): ReactElement | null {
  const isZh = useCurrentLanguage() === 'zh_CN'
  const info = useObservable(runtime?.sessions.currentProvideInfo ?? ABSENT) as ProvideInfo
  const workspace = usePanelWorkspace(info.sessionId)
  const { entries: projected, loaded } = useAdvisoryEntries(info)
  const entries = advisoryReviewEntries(projected)
  const pending = pendingAdvisoryCount(entries)
  const sessionId = info.sessionId
  const expanded = useAdvisoryInboxExpanded(sessionId)
  const advisoryScope = `${sessionId ?? 'none'}:${workspace?.projectId ?? 'none'}`
  const actionableIds = entries
    .filter(entry => entry.status === 'pending' || entry.status === 'deferred')
    .map(entry => entry.advisory.id)
  const actionableIdKey = actionableIds.join('\0')
  const observedAdvisories = useRef<{ readonly scope: string; readonly ids: ReadonlySet<string>; readonly initialized: boolean }>({
    scope: advisoryScope,
    ids: new Set(),
    initialized: false,
  })
  const previousExpanded = useRef(expanded)
  useEffect(() => {
    const previous = observedAdvisories.current
    if (!loaded) return
    if (!previous.initialized || previous.scope !== advisoryScope) {
      // The first successful snapshot contains existing advice, not arrivals.
      observedAdvisories.current = { scope: advisoryScope, ids: new Set(actionableIds), initialized: true }
      return
    }
    const hasNewPending = entries.some(entry => entry.status === 'pending' && !previous.ids.has(entry.advisory.id))
    observedAdvisories.current = { scope: advisoryScope, ids: new Set(actionableIds), initialized: true }
    // "Later" collapses the current card. A genuinely new advisory is new
    // information and should surface again without requiring the user to
    // notice only the sidebar badge.
    if (hasNewPending && !expanded) {
      const fresh = selectPendingAdvisories(entries, new Set()).find(item => !previous.ids.has(item.id) && item.status === 'pending')
      advisoryInboxVisibility.setExpanded(sessionId, true, fresh?.id)
    }
  }, [actionableIdKey, advisoryScope, entries, expanded, loaded, sessionId])
  useEffect(() => {
    const newlyExpanded = expanded && !previousExpanded.current
    previousExpanded.current = expanded
    if (newlyExpanded) revealAdvisoryComposerInbox()
  }, [expanded, pending])
  if (runtime === undefined || sessionId === undefined || workspace?.projectId === undefined || workspace.projectId === null || !expanded) return null
  return (
    <section
      id='dsh-advisory-composer-inbox'
      className='dsh-advisory-inbox'
      aria-label={isZh ? '设计建议收件箱' : 'Design advisory inbox'}
      key={`${sessionId}:${workspace.projectId}`}
      tabIndex={-1}
    >
      <div className='dsh-advisory-inbox-heading'>
        <div className='dsh-advisory-inbox-title'>
          <span>{isZh ? '设计建议' : 'Design advisor'}</span>
          {runtime.readReviewPolicy && runtime.updateReviewPolicy && <ReviewPolicyControl key={`${sessionId}:${workspace.projectId}`} sessionId={sessionId} runtime={runtime} />}
        </div>
        <div className='dsh-advisory-inbox-actions'>
          <span>{isZh ? `${pending} 条待处理` : `${pending} pending`}</span>
          <button type='button' className='dsh-advisory-inbox-close' aria-label={isZh ? '关闭设计建议' : 'Close design advisories'} title={isZh ? '关闭设计建议' : 'Close design advisories'} onClick={() => advisoryInboxVisibility.setExpanded(sessionId, false)}>×</button>
        </div>
      </div>
      <AdvisoryReviewCard
        readingScope={advisoryScope}
        preferredAdvisoryId={advisoryOpeningTargetBySession.get(sessionId)}
        emptyText={isZh ? '暂无待处理的设计建议。' : 'No pending design advisories.'}
        entries={entries}
        onAccept={async (advisory, authority) => { await runtime?.sendPrompt(sessionId, renderAdvisoryAcceptancePrompt(advisory, authority), authority.acceptanceReceiptId) }}
        onRecordAccepted={async (advisory) => {
          const entry = await runtime?.decideAdvisory(sessionId, advisory.id, 'accepted')
          if (entry?.acceptanceReceiptId === undefined) throw new Error('design advisory: accepted receipt was not returned')
          if (entry.actionReceipts === undefined || entry.executionStatus === undefined) {
            throw new Error('design advisory: accepted action receipt projection was not returned')
          }
          return {
            acceptanceReceiptId: entry.acceptanceReceiptId,
            actionReceipts: entry.actionReceipts,
            executionStatus: entry.executionStatus,
          }
        }}
        onDismiss={async (advisory, decision) => { await runtime?.decideAdvisory(sessionId, advisory.id, decision) }}
        onDeferred={() => { advisoryInboxVisibility.setExpanded(sessionId, false) }}
      />
    </section>
  )
}
