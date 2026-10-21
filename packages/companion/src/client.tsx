import { Context } from '@deepseek-ai/cordis'
import { browserRandomUuid } from '../../panel/src/browser-uuid.ts'
import { usePanelDraftObservation } from '../../panel/src/client/panel-draft-observation.tsx'
import { alignConversationHeader } from './header-alignment.mjs'
import { browserTransport, companionView } from './browser-access.mjs'
import { CanvasFontRoot } from '../../panel/src/use-canvas-ui-font.mjs'
import { createRoot } from 'react-dom/client'
import { useCallback, useEffect, useState, useRef, type CSSProperties, type ReactElement } from 'react'
import { DesignWorkspace, ReviewPolicyControl, type DesignRuntime, type DesignWorkspaceControls } from '../../panel/src/client/workspace.tsx'
import { Button } from '../../panel/src/client/ported/ui/button.tsx'
import { createTrialPanelBridge, type TrialPanelBinding } from './trial-panel-bridge.ts'
import { NativePanelRegistry } from '../../panel/src/client/native-panel-registry.ts'
import { registerWebAppNativePanels } from '../../provider-web-app/src/client/packs/web-app.tsx'
import { DesignProjectSidebarEntry } from '../../panel/src/client/design-project-sidebar-entry.tsx'
import { CurrentProjectSidebarEntry } from '../../panel/src/client/current-project-sidebar-entry.tsx'
import { subscribeLivePoll, requestLivePoll } from '../../panel/src/client/live-poll.ts'
import { createWorkspacePollReader } from '../../panel/src/client/workspace-poll-reader.ts'
import { equalWorkspaceEmission, type DesignPanelWorkspaceRead, type DesignProjectCatalogRead } from '../../panel/src/client/types.ts'
import { DOCK_CSS } from '../../panel/src/client/styles.ts'
import { panelStore, setSaving } from '../../panel/src/client/store.ts'
import { Conversation, type RecordedConversation } from './conversation.tsx'
import { BackgroundReviewPanel, type BackgroundReviews } from './background-reviews.tsx'
import { requireNotificationAccepted, notificationAutoDismiss } from './notification-result.mjs'
import { ConversationResize, savedChatWidth, DEFAULT_CHAT_WIDTH } from './conversation-resize.tsx'
import { StudioWorkspace } from '../../studio-ui/src/StudioWorkspace.tsx'
import { PanelSelect } from '../../panel/src/panel-select.tsx'
import type { StudioManagementClient } from '../../studio-ui/src/types.ts'
import type { StudioContentClient } from '../../studio-ui/src/ContentArchiveWorkbench.tsx'
import type { StudioAuthoring } from '../../studio-ui/src/PanelDraftWorkbench.tsx'
import type { StudioTrialClient } from '../../studio-ui/src/trial-controller.ts'
import { StudioRuntimePreview } from './studio-preview.tsx'
import { studioComponentLibrary } from './studio-components.tsx'
import { AdvisorySidebarEntry } from '../../panel/src/client/advisory-sidebar-entry.tsx'
import { bindDesignHostLocale, useCurrentLanguage } from '../../panel/src/client/ported/host.ts'
import { createCompanionLocale, companionChromeText, companionDocumentLanguage, type CompanionChromeKey, type CompanionLanguage } from './locale.ts'
import { AdvisoryReviewCard, selectPendingAdvisories, type AdvisoryReviewEntry, type AdvisoryAcceptanceAuthority } from '../../panel/src/client/ported/design/AdvisoryReviewCard.tsx'
import '../../panel/src/client/owned-styles.ts'
import '../../panel/src/visual-components.css'
import '../../panel/src/client/generated/design.tw.css'
import '../../panel/src/client/ported/iconfont.css'
import '../../provider-web-app/src/client/generated/design.tw.css'
import '../../provider-web-app/src/client/ported/design/panel-shared.css'

let entryStorage: Storage | undefined
try { entryStorage = sessionStorage } catch { /* Some host webviews disable storage. */ }
const transport = browserTransport(location, entryStorage)
// Per-page presentation, never a host capability or a persisted preference.
// Keep the query when removing the credential so reload keeps this layout.
const designOnly = companionView(new URLSearchParams(location.search).get('view')) === 'panel-only'
if (transport.removeFragment) history.replaceState(null, '', location.pathname + location.search)
const studioPage = new URLSearchParams(location.search).get('view') === 'studio'
const trialPanelPage = new URLSearchParams(location.search).get('view') === 'trial-panel'
let onNotificationError = (_message: string) => {}
let onNotice = (_message: string, _autoDismiss = false) => {}
let lastNotificationFailure: string | undefined
type SavedContinuation = { eventId: string; commit?: string; status: string; retryable: boolean }
async function rpc<T>(method: string, params = {}): Promise<T> {
  // A stalled read must release its single-flight slot so the next visible
  // tick can recover. Mutations/submissions retain their no-replay semantics.
  const signal = method === 'readWorkspace' || method === 'readConversation' ? AbortSignal.timeout(10000) : undefined
  const response = await fetch(transport.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...transport.headers }, body: JSON.stringify({ method, params }), signal, keepalive: method === 'observePanelDraft' })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'Companion request failed')
  return result as T
}
const context = new Context()
let languageStorage: Storage | undefined
try { languageStorage = localStorage } catch { /* Storage may be unavailable. */ }
const companionLocale = createCompanionLocale(languageStorage, navigator.language)
const studioClient: StudioManagementClient = {
  readKitFiles: input => rpc('studioKitFiles', input), readKitFile: input => rpc('studioKitFile', input),
  workspace: query => rpc('studioWorkspace', { query }), readKitWorkspace: (name, version) => rpc('studioKit', { name, version }),
  readBundleWorkspace: (name, version) => rpc('studioBundle', { name, version }), readBundleFile: input => rpc('studioFile', input),
}
const studioContentClient: StudioContentClient = {
  export: input => rpc('studioContentExport', input),
  prepare: input => rpc('studioContentImport', input),
  list: () => rpc('studioContentImportList'),
  read: input => rpc('studioContentImportRead', input),
  adopt: input => rpc('studioContentImportAdopt', input),
}
const studioInstances: import('../../studio-ui/src/InstanceWorkbench.tsx').StudioInstanceClient = {
  list: input => rpc('studioInstanceList', input), read: input => rpc('studioInstanceRead', input),
  copy: input => rpc('studioInstanceCopy', input), rename: input => rpc('studioInstanceRename', input),
  remove: input => rpc('studioInstanceRemove', input), readFile: input => rpc('studioInstanceFile', input),
  saveFile: input => rpc('studioInstanceSave', input), preview: input => rpc('studioInstancePreview', input),
  updateMounts: input => rpc('studioInstanceMounts', input),
}
const nativePanels = new NativePanelRegistry(context)
const studioTrials: StudioTrialClient = {
  checkConnection: () => rpc('studioTrialAvailability'),
  panelUrl: record => { if (!record.resultUrl) return undefined; const url = new URL(record.resultUrl); url.searchParams.set('view', 'trial-panel'); return url.href },
  start: input => rpc('studioTrialStart', input),
  list: () => rpc('studioTrialList'),
  read: id => rpc('studioTrialRead', { id }),
  stop: id => rpc('studioTrialStop', { id }),
  remove: id => rpc('studioTrialRemove', { id }),
}
const studioAuthoring: StudioAuthoring = {
  client: {
    previewInstalled: input => rpc('studioInstalledPreview', input),
    create: input => rpc('studioDraftCreate', input), list: () => rpc('studioDraftList'),
    read: id => rpc('studioDraftRead', { id }), save: input => rpc('studioDraftSave', input),
    preview: input => rpc('studioDraftPreview', input), confirm: input => rpc('studioDraftConfirm', input),
    fork: id => rpc('studioDraftFork', { id }),
  },
  renderPreview: (preview, adoptSample, options) => <StudioRuntimePreview key={`${preview.kit?.name ?? 'standalone'}:${preview.bundle.name}:${preview.revision}`} preview={preview} adoptSample={adoptSample} readOnly={options.readOnly} toolbarTarget={options.toolbarTarget} />,
}
const studioKitAuthoring: import('../../studio-ui/src/KitDraftWorkbench.tsx').StudioKitAuthoring = {
  client: {
    create: input => rpc('studioKitDraftCreate', input), list: () => rpc('studioKitDraftList'),
    read: id => rpc('studioKitDraftRead', { id }), save: input => rpc('studioKitDraftSave', input),
    validate: input => rpc('studioKitDraftValidate', input), preview: input => rpc('studioKitDraftPreview', input),
    confirm: input => rpc('studioKitDraftConfirm', input), fork: id => rpc('studioKitDraftFork', { id }),
  },
  renderPreview: studioAuthoring.renderPreview,
}
let nativeHostLabel = '原生 Agent'
const readConversation = createWorkspacePollReader<{ conversation: RecordedConversation; backgroundRows: RecordedConversation['rows'] }>(
  (_session, knownRevision) => rpc('readConversation', { knownRevision }),
)
const readBackgroundRows = createWorkspacePollReader<{ backgroundRows: RecordedConversation['rows']; available: boolean; error?: string }>(
  (_session, knownRevision) => rpc('readConversation', { knownRevision, includeConversation: false }),
)
const runtime: DesignRuntime = {
  nativePanels,
  readReviewPolicy: () => rpc('readReviewPolicy'),
  updateReviewPolicy: (_session, policy) => rpc('updateReviewPolicy', {policy}),
  readWorkspace: createWorkspacePollReader((_session, knownRevision) => rpc('readWorkspace', { knownRevision, includeConversation: false })),
  readGraph: () => rpc('readGraph'),
  readKnowledgeStatus: () => rpc('knowledgeStatus'),
  retryKnowledge: () => rpc('retryKnowledge'),
  queryKnowledge: (_session, args) => rpc('queryKnowledge', args),
  retainAutoPanel: async (_session, request) => {
    const result = await rpc<{ retained: true }>('retainAutoPanel', request)
    requestLivePoll()
    return result
  },
  requestAutoPanel: async (session, skill) => {
    await runtime.sendPrompt(session, `Generate the auto Panel for saved Bundle ${JSON.stringify(skill)} in the current project. Use design_prepare_auto_panel with the exact active Companion connection, follow its prompt, then submit via design_submit_auto_panel; at most one repair. Ready means no work. Do not modify Design Files or retained panel definitions, or launch another model process. This is a UI-only request.`)
    requestLivePoll()
  },
  savePanel: async (_session, skill, state, artifacts, eventId) => {
    const result = await rpc<{commit?: string}>('savePanel', { skill, state, artifacts, eventId: eventId ?? browserRandomUuid(), includeDerivedStatus:false })
    onNotice(`文件已保存。正在通知 ${nativeHostLabel}；通知失败不会撤销保存。`)
    requestLivePoll()
    return result
  },
  readArtifact: (_session, path, revision) => rpc('readArtifact', { path, revision }),
  readBinaryArtifact: (_session, path, revision) => rpc('readBinaryArtifact', { path, revision }),
  readExecutionLog: (_session, runId, afterSeq, target) => rpc('readExecutionLog', { runId, afterSeq, ...target }),
  sendPrompt: async (_session, text, requestId, saved) => {
    onNotice(`正在发送到 ${nativeHostLabel}…`)
    try {
      const result = await rpc<{ accepted?: boolean; status?: string }>('sendPrompt', { text, requestId, saved })
      const notice = requireNotificationAccepted(result, nativeHostLabel)
      // Clear only this acknowledged notification, never another save error.
      const panel = panelStore.getSnapshot()
      if (!panel.saving && lastNotificationFailure !== undefined && panel.error === lastNotificationFailure) setSaving(false)
      lastNotificationFailure = undefined
      onNotificationError('')
      onNotice(notice, notificationAutoDismiss(result))
      requestLivePoll()
    } catch (error) {
      onNotice(`已保存文件仍然有效。${error instanceof Error ? error.message : String(error)}`)
      lastNotificationFailure = error instanceof Error ? error.message : String(error)
      onNotificationError(String(error)); throw error
    }
  },
  cancelPendingNextStepQuestion: async () => false,
  listSkills: () => rpc('listSkills'),
  listProjects: () => rpc('listProjects'),
  listAdvisories: () => rpc('listAdvisories'),
  decideAdvisory: (_session, advisoryId, decision) => rpc('decideAdvisory', { advisoryId, decision }),
}

function App() {
  const trialBridge = useRef<ReturnType<typeof createTrialPanelBridge>>()
  const trialControls = useRef<DesignWorkspaceControls>()
  const publishTrialControls = useCallback((value: DesignWorkspaceControls | undefined) => {
    trialControls.current = value
    trialBridge.current?.update(value)
  }, [])
  useEffect(() => registerWebAppNativePanels(nativePanels), [])
  const shellRoot = useRef<HTMLDivElement>(null)
  useEffect(() => !designOnly && shellRoot.current ? alignConversationHeader(shellRoot.current) : undefined, [])
  const [workspace, setWorkspace] = useState<DesignPanelWorkspaceRead>()
  const drafts = usePanelDraftObservation(!studioPage && workspace?.projectId
    ? { key: `${transport.headers['X-Design-Token']?.slice(0, 24) ?? transport.endpoint}:${workspace.projectId}`, projectId: workspace.projectId } : undefined,
    message => rpc('observePanelDraft', message))
  const [panelSaving, setPanelSaving] = useState(false)
  const publishControls = useCallback((value: DesignWorkspaceControls | undefined) => {
    publishTrialControls(value)
    drafts.observe(value)
    setPanelSaving(value?.saving ?? false)
  }, [publishTrialControls, drafts.observe])
  const [conversation, setConversation] = useState<RecordedConversation>()
  const [backgroundReviews, setBackgroundReviews] = useState<BackgroundReviews>()
  const reviewDialog = useRef<HTMLDialogElement>(null)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [reviewLogError, setReviewLogError] = useState('')
  const [catalog, setCatalog] = useState<DesignProjectCatalogRead>()
  const [thread, setThread] = useState<string>()
  const [error, setError] = useState('')
  const kitReloadPending = useRef(false)
  const lastKitReloadError = useRef<string>()
  const [pollError, setPollError] = useState('')
  const [notificationError, setNotificationError] = useState('')
  const [savedContinuations, setSavedContinuations] = useState<SavedContinuation[]>([])
  const [savedContinuationError, setSavedContinuationError] = useState('')
  const [recoveringNotification, setRecoveringNotification] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(!designOnly)
  const [conversationOpen, setConversationOpen] = useState(!designOnly)
  const conversationVisible = !trialPanelPage && !designOnly && conversationOpen
  const [notice, setNotice] = useState('')
  const [advisories, setAdvisories] = useState<AdvisoryReviewEntry[]>([])
  const [advisoriesOpen, setAdvisoriesOpen] = useState(false)
  const [advisoryOpeningTarget, setAdvisoryOpeningTarget] = useState<string>()
  const seenAdvisories = useRef(new Set<string>())
  const pendingAdvisories = selectPendingAdvisories(advisories, new Set())
  useEffect(() => {
    // Reopen for newly arrived actionable results, not every polling emission.
    // A manually collapsed/deferred card stays collapsed until a new ID arrives.
    const fresh = pendingAdvisories.find(entry => !seenAdvisories.current.has(entry.id))
    for (const entry of pendingAdvisories) seenAdvisories.current.add(entry.id)
    if (fresh && !advisoriesOpen) {
      setAdvisoryOpeningTarget(fresh.id); setAdvisoriesOpen(true)
      if (!designOnly) setConversationOpen(true)
    }
  }, [advisories])
  const [maxSuggestions, setMaxSuggestions] = useState('')
  const [chatWidth, setChatWidth] = useState(savedChatWidth)
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const locale = useCurrentLanguage()
  const chrome = (key: CompanionChromeKey, values?: { host: string }) => companionChromeText(key, locale, values)
  useEffect(() => { document.documentElement.lang = companionDocumentLanguage(locale) }, [locale])
  const [language, setLanguage] = useState(companionLocale.getPreference)
  useEffect(() => bindDesignHostLocale(companionLocale), [])
  const resizeChat = (value: number) => { setChatWidth(value); try { localStorage.setItem('design-companion-chat-width', String(value)) } catch { /* Layout remains usable without storage. */ } }
  useEffect(() => {
    let disposed = false
    let busy = false
    let lastSnapshot: DesignPanelWorkspaceRead | undefined
    onNotificationError = setNotificationError
    let noticeTimer: ReturnType<typeof setTimeout> | undefined
    onNotice = (message, autoDismiss = false) => {
      clearTimeout(noticeTimer)
      setNotice(message)
      if (autoDismiss) noticeTimer = setTimeout(() => setNotice(''), 5000)
    }
    const poll = async () => {
      if (busy || disposed) return
      busy = true
      try {
        const next = await runtime.readWorkspace('bound') as DesignPanelWorkspaceRead & { conversation?: RecordedConversation; advisories?: AdvisoryReviewEntry[]; backgroundReviews?:BackgroundReviews; savedContinuations?: SavedContinuation[]; savedNotificationError?: string }
        if (!disposed) {
          setPollError('')
          if (next === lastSnapshot) return
          lastSnapshot = next
          setSavedContinuations(prior => JSON.stringify(prior) === JSON.stringify(next.savedContinuations ?? []) ? prior : next.savedContinuations ?? [])
          setSavedContinuationError(next.savedNotificationError ?? '')
          setWorkspace(prior => prior && equalWorkspaceEmission(prior, next)
            && JSON.stringify(prior.access) === JSON.stringify(next.access) ? prior : next)
          // History has its own reader; a late workspace response must not
          // replace newer native records or background rows with an older copy.
          setBackgroundReviews(prior => {
            const value = next.backgroundReviews && { ...next.backgroundReviews, rows: prior?.rows ?? [] }
            return JSON.stringify(prior) === JSON.stringify(value) ? prior : value
          })
          setAdvisories(prior => JSON.stringify(prior) === JSON.stringify(next.advisories ?? []) ? prior : next.advisories ?? [])
        }
      } catch (error) {
        if (!disposed) {
          lastSnapshot = undefined
          setPollError(String(error))
        }
      }
      finally { busy = false }
    }
    void Promise.all([rpc<{threadId:string;host?:string;trialPanel?:TrialPanelBinding}>('info'), rpc<DesignProjectCatalogRead>('listProjects')])
      .then(([info, projects]) => { if (!disposed) {
        nativeHostLabel = info.host === 'workbuddy' ? 'WorkBuddy' : info.host === 'qwenwork' ? 'QwenWork' : info.host === 'qoder' ? 'Qoder CLI' : info.host === 'claude-code' ? 'Claude Code' : info.host === 'codex' ? 'Codex' : '原生 Agent'
        if (trialPanelPage && info.trialPanel && window.parent !== window) {
          if (info.trialPanel.locale) companionLocale.setPreference(info.trialPanel.locale === 'zh-CN' ? 'zh' : 'en', false)
          trialBridge.current = createTrialPanelBridge(window, info.trialPanel)
          trialBridge.current.update(trialControls.current)
        }
        setThread(info.threadId); setCatalog(projects)
      } })
      .catch(error => { if (!disposed) setError(String(error)) })
    void poll()
    void rpc<{ maxSuggestions: number }>('readSettings').then(value => { if (!disposed) setMaxSuggestions(String(value.maxSuggestions)) }).catch(error => { if (!disposed) setError(String(error)) })
    const unsubscribe = subscribeLivePoll(() => { void poll() })
    return () => { disposed = true; trialBridge.current?.dispose(); trialBridge.current = undefined; clearTimeout(noticeTimer); unsubscribe(); onNotificationError = () => {}; onNotice = () => {} }
  }, [])
  useEffect(() => {
    if (!conversationVisible) return
    let disposed = false, busy = false
    const poll = async () => {
      if (disposed || busy) return
      busy = true
      try {
        const next = await readConversation('bound')
        if (!disposed) {
          setReviewLogError(next.conversation.available ? '' : next.conversation.error ?? '后台操作记录暂不可读。')
          setConversation(prior => JSON.stringify(prior) === JSON.stringify(next.conversation) ? prior : next.conversation)
          setBackgroundReviews(prior => {
            const value = { reviews: prior?.reviews ?? [], rows: next.backgroundRows }
            return JSON.stringify(prior) === JSON.stringify(value) ? prior : value
          })
        }
      } catch {
        if (!disposed) {
          setReviewLogError('后台操作记录暂不可读；以下保留上次收到的记录。')
          setConversation(prior => ({ ...prior, available: false, recordedStatus: 'unknown', catchingUp: false,
            rows: prior?.rows ?? [], omitted: prior?.omitted ?? 0, error: '会话同步已断开，正在重试；以下保留上次收到的记录。' }))
        }
      } finally { busy = false }
    }
    void poll()
    const unsubscribe = subscribeLivePoll(() => { void poll() })
    return () => { disposed = true; unsubscribe() }
  }, [conversationVisible])
  useEffect(() => {
    // The visible conversation already supplies these rows when it is open.
    if (!reviewDialogOpen || conversationVisible) return
    let disposed = false, busy = false
    const poll = async () => {
      if (disposed || busy) return
      busy = true
      try {
        const next = await readBackgroundRows('bound')
        if (!disposed) {
          setReviewLogError(next.available ? '' : next.error ?? '后台操作记录暂不可读。')
          setBackgroundReviews(prior => {
            const value = { reviews: prior?.reviews ?? [], rows: next.backgroundRows }
            return JSON.stringify(prior) === JSON.stringify(value) ? prior : value
          })
        }
      } catch {
        if (!disposed) setReviewLogError('后台操作记录暂不可读；以下保留上次收到的记录。')
      } finally { busy = false }
    }
    void poll()
    const unsubscribe = subscribeLivePoll(() => { void poll() })
    return () => { disposed = true; unsubscribe() }
  }, [reviewDialogOpen, conversationVisible])
  const closeAdvisories = () => {
    setAdvisoriesOpen(false)
    if (designOnly) shellRoot.current?.querySelector<HTMLButtonElement>('.companion-sidebar .dsh-advisory-sidebar-trigger')?.focus({ preventScroll: true })
  }
  const advisoryInbox = advisoriesOpen && workspace?.projectId && thread && <section id="dsh-advisory-composer-inbox" className="dsh-advisory-inbox" aria-label="设计建议收件箱">
        <div className="dsh-advisory-inbox-heading"><span>设计建议</span><button type="button" aria-label="收起设计建议" onClick={closeAdvisories}>收起</button></div>
        <ReviewPolicyControl key={`${thread}:${workspace.projectId}`} sessionId={thread} runtime={runtime} />
        <AdvisoryReviewCard entries={advisories} emptyText="暂无待处理的设计建议。"
          key={`${thread}:${workspace.projectId}`} readingScope={`${thread}:${workspace.projectId}`} preferredAdvisoryId={advisoryOpeningTarget}
          onRecordAccepted={async advisory => {
            const result = await rpc<AdvisoryAcceptanceAuthority & { notification?: string; notificationError?: string }>('decideAdvisory', { advisoryId: advisory.id, decision: 'accepted' })
            requestLivePoll()
            if (result.notification === 'failed') { setNotificationError(result.notificationError ?? '建议已接受，但通知未确认。'); throw new Error(result.notificationError) }
            return result
          }}
          onAccept={async () => { requestLivePoll() }}
          onDismiss={async (advisory, decision) => { await rpc('decideAdvisory', { advisoryId: advisory.id, decision }); requestLivePoll() }}
          onDeferred={closeAdvisories} />
      </section>
  return <div className="dsh-design-root companion-root" data-companion-view={designOnly ? 'panel-only' : 'full'} ref={shellRoot}>
    <style>{DOCK_CSS}{`
      html,body,#root{height:100%;margin:0;font-family:var(--ds-font-main,system-ui,sans-serif)}
      .companion-root{height:100%;display:flex;background:#fff;color:#272727}
      .companion-sidebar{width:190px;padding:12px;border-right:1px solid #e8e8e8;display:flex;flex-direction:column;gap:8px;flex-shrink:0}
      .companion-sidebar[data-collapsed=true]{width:60px}
      .companion-sidebar-heading{display:flex;align-items:center;justify-content:space-between;min-height:calc(var(--companion-top-header-height,76px) - 24px);flex-shrink:0;margin-bottom:8px;gap:4px}
      .companion-sidebar-heading>strong{font-size:18px;line-height:24px;white-space:nowrap}
      .companion-sidebar .dsh-project-sidebar-entry,.companion-sidebar .dsh-advisory-sidebar-entry{margin:0}
      .companion-sidebar .dsh-project-sidebar-trigger,.companion-sidebar .dsh-advisory-sidebar-trigger{height:40px}
      .companion-icon-button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:6px;flex-shrink:0;color:#625879}
      .companion-icon-button:hover,.companion-sidebar-action:hover{background:#f3f0f8}
      .companion-icon-button:focus-visible,.companion-sidebar-action:focus-visible{outline:2px solid #7c5af6;outline-offset:2px}
      .companion-icon-button svg,.companion-sidebar-action svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0}
      .companion-sidebar-action{display:flex;align-items:center;gap:10px;min-height:40px;padding:0 8px;border-radius:6px;font-size:14px;line-height:22px;text-align:left}
      .companion-sidebar-action[aria-expanded=true]{background:#f1ecff;color:#663ae8}
      .companion-sidebar[data-collapsed=true] .companion-sidebar-action{width:36px;justify-content:center;padding:0}
      .companion-sidebar-meta{margin-top:auto;font-size:12px;color:#6d6d6d;overflow-wrap:anywhere}
      .companion-review-statuses{display:grid;gap:12px;padding:12px 0;list-style:none}
      .companion-review-statuses li{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .companion-review-statuses strong{min-width:100px}
      .companion-review-statuses small{width:100%;color:#777}
      .companion-main{position:relative;display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
      .companion-content{display:flex;flex:1;min-width:0;min-height:0}
      .companion-conversation{width:var(--chat-width,30%);min-width:0;flex-shrink:0;display:flex;flex-direction:column;font-size:14px;line-height:1.5}
      .companion-resize{width:6px;flex-shrink:0;cursor:col-resize;touch-action:none;background:#f6f5f8}
      .companion-resize:hover,.companion-resize:focus-visible{background:#b9a2f4;outline:none}
      .companion-conversation[hidden]{display:none}
      .companion-conversation>header{gap:8px;justify-content:space-between}
      .companion-conversation-heading{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}
      .companion-conversation-title{display:flex;align-items:center;gap:6px;min-width:0}
      .companion-conversation-heading>span,.companion-conversation-hint{font-size:12px;color:#6d6d6d}
      .companion-conversation .companion-conversation-hint{padding:8px 16px;margin:0}
      .companion-sync-status{display:flex;align-items:center;gap:6px;background:#faf9fd;border-bottom:1px solid #eee;flex-shrink:0}
      .companion-sync-status .companion-spinner{margin-right:0;flex-shrink:0}
      .companion-conversation-history{flex:1;min-height:0;overflow:auto;padding:0 16px;overflow-anchor:none}
      .companion-conversation .companion-message{padding:12px 0;border:0;min-width:0;overflow-wrap:anywhere}
      .companion-message-content{font-size:16px;line-height:24px;padding:9px 4px;min-width:0;overflow-wrap:anywhere}
      .companion-message[data-role=assistant] .companion-message-content{font-size:14px;line-height:1.7}
      .companion-message-content> :first-child{margin-top:0}
      .companion-message-content> :last-child{margin-bottom:0}
      .companion-conversation .companion-message[data-role=user]{display:flex;flex-direction:column;align-items:flex-end;padding-left:52px}
      .companion-message[data-role=user] .companion-message-label{text-align:right}
      .companion-message[data-role=user] .companion-message-content{box-sizing:border-box;max-width:100%;padding:10px 12px;border-radius:8px;background:#f6f6f6;font-size:14px}
      .companion-message-label{font-size:12px;color:#6d6d6d;margin-bottom:4px}
      .companion-activity{margin:8px 0;font-size:12px;color:#6d6d6d}
      .companion-spinner{display:inline-block;width:12px;height:12px;margin-right:6px;border:2px solid #ddd;border-top-color:#666;border-radius:50%;vertical-align:middle;animation:companion-spin .8s linear infinite}
      @keyframes companion-spin{to{transform:rotate(360deg)}}
      @media(prefers-reduced-motion:reduce){.companion-spinner{animation:none}}
      .companion-activity>summary{cursor:pointer;padding:5px 0;overflow-wrap:anywhere}
      .companion-activity>summary:focus-visible{outline:2px solid #7c5af6;outline-offset:2px;border-radius:3px}
      .companion-activity>div{padding-left:12px;border-left:1px solid #e8e8e8}
      .companion-activity article{padding:4px 0;border:0;overflow-wrap:anywhere}
      .companion-activity .companion-message-label{margin:0}
      .companion-activity-failed{color:#a34232}
      .companion-native-question{border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0;background:#fff;color:#222}
      .companion-native-question ul{padding-left:20px;margin:10px 0}
      .companion-native-question li{margin:8px 0}
      .companion-native-question li p{color:#666;margin:3px 0;font-size:12px}
      .companion-native-question small{display:block;color:#666;line-height:1.5}
      .companion-conversation form{padding:12px;border-top:1px solid #e8e8e8;display:flex;flex-direction:column;gap:8px}
      .companion-input-shell{border:1px solid #dfdfdf;border-radius:16px;padding:10px;background:#fff;display:flex;flex-direction:column;gap:6px;min-width:0;transition:border-color .15s,box-shadow .15s}
      .companion-input-shell:focus-within{border-color:#b9a2f4;box-shadow:0 0 0 2px #7c5af612}
      .companion-conversation textarea{resize:vertical;box-sizing:border-box;width:100%;min-height:64px;max-height:180px;border:0;border-radius:0;padding:2px;background:transparent;font:inherit;outline:none}
      .companion-composer-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0}
      .companion-composer-actions button{min-height:32px;border:1px solid #e2ddea;border-radius:6px;padding:6px 10px;font-size:12px;line-height:18px}
      .companion-conversation button[type=submit]{flex-shrink:0;background:#7c5af6;border-color:#7c5af6;color:#fff}
      .companion-composer-actions button:focus-visible{outline:2px solid #7c5af6;outline-offset:2px}
      .companion-send-group{display:inline-flex;align-items:stretch;position:relative;max-width:100%}
      .companion-send-group button[type=submit]{border-radius:6px 0 0 6px}
      .companion-send-menu{position:relative;flex-shrink:0}
      .companion-send-menu>summary{list-style:none;display:flex;align-items:center;justify-content:center;width:28px;height:32px;box-sizing:border-box;background:#7c5af6;color:#fff;border-left:1px solid #ffffff50;border-radius:0 6px 6px 0;cursor:pointer}
      .companion-send-menu>summary::-webkit-details-marker{display:none}
      .companion-send-menu>summary svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5}
      .companion-send-menu>summary:focus-visible{outline:2px solid #7c5af6;outline-offset:2px}
      .companion-send-options{position:absolute;right:0;bottom:calc(100% + 8px);width:max-content;max-width:280px;padding:4px;background:#fff;border:1px solid #e2ddea;border-radius:8px;box-shadow:0 4px 16px #0002;z-index:20}
      .companion-composer-actions .companion-send-options button{width:100%;border:0;text-align:left;justify-content:flex-start}
      .companion-send-options button:hover:not(:disabled){background:#f3f0f8}
      .companion-conversation button:disabled{opacity:.5;cursor:default}
      .companion-connection{position:relative;font-size:12px;color:#6d6d6d;overflow:visible}
      .companion-connection>button{cursor:pointer;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;padding:0;border-radius:6px;background:transparent;color:inherit}
      .companion-connection>button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5}
      .companion-connection>button:hover{background:#f3f0f8}
      .companion-connection>button:focus-visible{outline:2px solid #7c5af6;outline-offset:2px}
      .companion-connection-popover{display:none;position:absolute;top:calc(100% + 6px);left:-80px;width:260px;max-width:calc(100vw - 48px);padding:10px 12px;background:#fff;border:1px solid #e2ddea;border-radius:8px;box-shadow:0 4px 16px #0002;z-index:30;overflow-wrap:anywhere}
      .companion-connection[data-open]>.companion-connection-popover,.companion-connection:hover>.companion-connection-popover,.companion-connection:focus-within>.companion-connection-popover{display:block}
      .companion-connection-popover p{margin:0 0 6px}
      .companion-connection-popover p:last-child{margin-bottom:0}
      .companion-notify{min-width:0;color:#625879;background:#fff;text-align:left;overflow-wrap:anywhere}
      .companion-main .dsh-design-dock{position:relative;width:100%;flex:1;min-width:0;min-height:0;border:0}
      .companion-feedback{display:flex;align-items:center;justify-content:space-between;gap:12px;pointer-events:auto;box-sizing:border-box;max-width:min(520px,calc(100vw - 32px));max-height:25vh;overflow:auto;overflow-wrap:anywhere}
      .companion-feedback>div{min-width:0}
      .companion-feedback>button{display:flex;align-items:center;justify-content:center;flex-shrink:0;width:28px;height:28px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}
      .companion-feedback>button:hover{background:#ffffff20}
      .companion-feedback>button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
      .companion-feedback>button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
      .companion-feedback .companion-error{padding:0;color:inherit}
      .companion-feedback p{margin:6px 0 0}
      .companion-error{padding:10px;color:#b02d2f;white-space:pre-wrap;overflow-wrap:anywhere}
      .companion-advisories{max-height:40%;overflow:auto;padding:8px 12px;flex-shrink:0}
      .companion-settings{font-size:12px;line-height:1.6}
      .companion-settings input{width:48px;border:1px solid #ddd;margin:4px}
      .companion-sidebar-bottom{margin-top:auto;display:flex;flex-direction:column;gap:8px}
      .companion-settings-dialog{margin:auto;max-width:540px;width:calc(100% - 48px);max-height:80vh;overflow:auto;border:1px solid #e2ddea;border-radius:12px;padding:24px;background:#fff;color:#272727}
      .companion-settings-dialog::backdrop{background:#0005}
      .companion-settings-dialog>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
      .companion-settings-dialog>section{margin:18px 0;display:flex;flex-direction:column;gap:10px}
      .companion-settings-dialog>header>button,.companion-settings-dialog>section>button{padding:6px 10px;border:1px solid #ddd;border-radius:6px}
      .companion-conversation .dsh-advisory-inbox{flex-shrink:0;max-height:min(35vh,350px)}
      @media(max-width:900px){
        .companion-content{flex-direction:column}
        .companion-conversation{width:100%;height:45%;min-height:0;overflow:auto}
        .companion-conversation>header,.companion-conversation>form,.companion-conversation>.companion-notify{flex-shrink:0}
        .companion-conversation-history{flex:1 0 120px;min-height:120px}
        .companion-resize{display:none}
        .companion-conversation header{flex-wrap:wrap}
        .companion-main .dsh-design-dock{width:100%;overflow:auto}
      }
      .companion-root[data-companion-view=panel-only]{flex-direction:row-reverse}
      [data-companion-view=panel-only] .companion-sidebar{width:214px;box-sizing:border-box;padding:8px;border-right:0;border-left:1px solid var(--ds-line-1,#e8e8e8)}
      [data-companion-view=panel-only] .companion-sidebar[data-collapsed=true]{width:52px}
      [data-companion-view=panel-only] .companion-sidebar-heading{min-height:28px;margin:0}
      [data-companion-view=panel-only] .companion-sidebar-heading .companion-icon-button svg{transform:scaleX(-1)}
      [data-companion-view=panel-only] .companion-content{flex-direction:row}
      [data-companion-view=panel-only] .companion-main .dsh-design-dock{height:100%;overflow:hidden}
    `}</style>
    {!trialPanelPage && <aside id="companion-sidebar" className="companion-sidebar" data-collapsed={!sidebarOpen} aria-label={chrome('sidebar')}>
      <div className="companion-sidebar-heading">
        {sidebarOpen && <strong>Yugoo Design</strong>}
        <button type="button" className="companion-icon-button" aria-label={chrome(sidebarOpen ? 'collapseSidebar' : 'expandSidebar')} title={chrome(sidebarOpen ? 'collapseSidebar' : 'expandSidebar')} aria-expanded={sidebarOpen} aria-controls="companion-sidebar" onClick={() => { setExpanded(false); setSidebarOpen(value => !value) }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M7.5 3v14"/>{sidebarOpen ? <path d="m13 7-3 3 3 3"/> : <path d="m11 7 3 3-3 3"/>}</svg>
        </button>
      </div>
      {designOnly && workspace && <CurrentProjectSidebarEntry key={workspace.projectId} wide={sidebarOpen}
        clarity={workspace.clarity} projectName={workspace.projectName} projectPath={workspace.projectPath} />}
      <DesignProjectSidebarEntry side={designOnly ? 'right' : 'left'} wide={sidebarOpen} expanded={expanded} catalog={catalog ?? null} loading={!catalog} error={undefined}
        onToggle={() => setExpanded(value => !value)} onRefresh={() => {
          if (kitReloadPending.current) return
          kitReloadPending.current = true
          void (async () => {
            const reload = await rpc<{ status: string; error?: string }>('reloadKit')
            requestLivePoll()
            if (reload.status === 'rejected') throw new Error(reload.error)
            setCatalog(await rpc<DesignProjectCatalogRead>('listProjects'))
            const priorReloadError = lastKitReloadError.current
            setError(prior => prior === priorReloadError ? '' : prior)
            lastKitReloadError.current = undefined
          })().catch(error => {
            lastKitReloadError.current = String(error)
            setError(lastKitReloadError.current)
          }).finally(() => { kitReloadPending.current = false })
        }}
        onCommand={() => setError('当前预览绑定单个项目；新建、迁移、切换与移除尚未接通。')} />
      {!designOnly && <button type="button" className="companion-sidebar-action" aria-label={chrome(conversationOpen ? 'collapseConversation' : 'expandConversation')} title={chrome(conversationOpen ? 'collapseConversation' : 'expandConversation')} aria-expanded={conversationOpen} aria-controls="companion-conversation" onClick={() => setConversationOpen(value => !value)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 15H8l-4 3v-3a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 3Z"/><path d="M6 7h8M6 11h5"/></svg>
        {sidebarOpen && <span>{nativeHostLabel} {chrome('conversation')}</span>}
      </button>}
      <div className="companion-sidebar-bottom">
        <button type="button" className="companion-sidebar-action" aria-label={chrome('backgroundReviews')} title={chrome('backgroundReviews')} onClick={()=>{ reviewDialog.current?.showModal(); setReviewDialogOpen(true) }}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="m6 10 3 3 5-6"/></svg>
          {sidebarOpen && <span>{chrome('backgroundReviews')}{backgroundReviews?.reviews.some(r=>['failed','unsubmitted','unavailable','interrupted'].includes(r.status)) ? ` · ${chrome('pending')}` : !pollError && backgroundReviews?.reviews.some(r=>r.status==='running') ? ` · ${chrome('running')}` : ''}</span>}
        </button>
        <AdvisorySidebarEntry wide={sidebarOpen} entries={advisories} expanded={advisoriesOpen && (designOnly || conversationVisible)}
          popoverContent={designOnly ? advisoryInbox : undefined}
          onToggle={() => { setAdvisoryOpeningTarget(undefined); if (!designOnly) setConversationOpen(true); setAdvisoriesOpen(value => !value || (!designOnly && !conversationVisible)) }} />
        <button type="button" className="companion-sidebar-action" aria-label={chrome('settings')} title={chrome('settings')} onClick={() => settingsDialog.current?.showModal()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14"/><circle cx="7" cy="5" r="2"/><circle cx="13" cy="10" r="2"/><circle cx="8" cy="15" r="2"/></svg>
          {sidebarOpen && <span>{chrome('settings')}</span>}
        </button>
        {sidebarOpen && <div className="companion-sidebar-meta">Mindset：{workspace?.access && 'kit' in workspace.access
          ? `${workspace.access.kit.name}@${workspace.access.kit.version}${workspace.access.mode === 'recovery' ? '（待恢复）' : ''}`
          : workspace?.access.mode === 'unconfigured' ? '未选择' : '—'}</div>}
      </div>
    </aside>}
    <main className="companion-main">
      <div className="companion-content" style={{ '--chat-width': `${chatWidth}%` } as CSSProperties}>
      {!trialPanelPage && !designOnly && <Conversation hostLabel={nativeHostLabel} value={conversation} thread={thread} visible={conversationVisible} attempts={workspace?.executionAttempts}
        readExecutionLog={(runId, afterSeq) => runtime.readExecutionLog(thread!, runId, afterSeq)}
        onClose={() => { setConversationOpen(false); document.querySelector<HTMLButtonElement>('.companion-sidebar-action')?.focus() }} send={text => runtime.sendPrompt(thread!, text)}
        beforeComposer={conversationVisible && advisoryInbox} />}
      {conversationVisible && <ConversationResize width={chatWidth} onChange={resizeChat} />}
      <div className="dsh-design-dock">
        {drafts.notice}
        {savedContinuationError && <p role="alert">{locale === 'zh_CN' ? savedContinuationError : 'Saved notification status is unavailable. Check the authoritative files in the original conversation; do not blindly resend.'}</p>}
        {!trialPanelPage && savedContinuations.some(entry => entry.retryable || ['unknown', 'preparing'].includes(entry.status)) && <section aria-label={locale === 'zh_CN' ? '保存后的通知状态' : 'Saved notification status'}>
          <span role="status">{savedContinuations.some(entry => ['unknown', 'preparing'].includes(entry.status))
            ? (locale === 'zh_CN' ? '已保存内容请在原会话核对；有未确认的保存或投递，不会自动重发。' : 'Check the saved content in the original conversation. A save or delivery is unconfirmed; it will not be replayed.')
            : (locale === 'zh_CN' ? '文件已保存，接续通知尚未提交。' : 'Files are saved; the continuation has not been submitted.')}</span>
          {savedContinuations.some(entry => entry.retryable) && <Button type="button" variant="outline" size="sm" disabled={recoveringNotification || panelSaving || !!pollError || !thread} onClick={() => {
            if (recoveringNotification || !thread || panelStore.getSnapshot().saving) return
            setRecoveringNotification(true)
            const saved = savedContinuations.filter(entry => entry.retryable).map(({ eventId, commit }) => ({ eventId, commit }))
            void runtime.sendPrompt(thread, locale === 'zh_CN' ? '请读取这些已保存的修改，继续当前已授权的设计工作；不要重新保存或重跑 Bundle。' : 'Read these saved changes and continue the authorized design work. Do not save again or rerun the Bundle.', browserRandomUuid(), saved)
              .catch(() => {}).finally(() => { setRecoveringNotification(false); requestLivePoll() })
          }}>{recoveringNotification ? (locale === 'zh_CN' ? '正在通知…' : 'Notifying…') : (locale === 'zh_CN' ? '仅恢复通知' : 'Recover notification only')}</Button>}
        </section>}
        {workspace && thread ? <DesignWorkspace hideProjectHeader={designOnly} {...workspace} experienceAvailable sessionId={thread} runtime={runtime} dockOpen
          presentation={trialPanelPage ? 'panel-only' : 'workspace'} demonstrationSave={trialPanelPage} onControlsChange={publishControls}
          hostReportedSaveError={lastNotificationFailure} /> : <p>正在读取设计文件…</p>}
      </div>
      </div>
      {(error || pollError || notificationError || notice) && <div className={`dsh-design-toast companion-feedback${error || pollError || notificationError ? ' dsh-design-toast-error' : ''}`}>
        <div><span role={error || pollError || notificationError ? 'alert' : 'status'} className={error || pollError || notificationError ? 'companion-error' : undefined}>{error || pollError || notificationError || notice}</span>
          {!!(error || pollError || notificationError) && notice && <p role="status">{notice}</p>}</div>
        <button type="button" aria-label="关闭提示" onClick={() => { setError(''); setPollError(''); setNotificationError(''); onNotice('') }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
      </div>}
    </main>
    <dialog className="companion-settings-dialog" ref={reviewDialog} aria-label={chrome('backgroundReviews')} onClose={() => setReviewDialogOpen(false)}>
      <header><strong>{chrome('backgroundReviews')}</strong><button type="button" onClick={()=>reviewDialog.current?.close()}>{chrome('closeBackgroundReviews')}</button></header>
      {reviewLogError && <p role="status">{reviewLogError}</p>}
      <BackgroundReviewPanel value={backgroundReviews} disconnected={!!pollError || !!reviewLogError}/>
    </dialog>
    <dialog className="companion-settings-dialog" ref={settingsDialog} aria-label={chrome('designSettings')}>
      <header><strong>{chrome('settings')}</strong><button type="button" onClick={() => settingsDialog.current?.close()}>{chrome('closeSettings')}</button></header>
      <section className="companion-settings">
        <label htmlFor="companion-language">{chrome('language')}</label>
        <select id="companion-language" value={language} onChange={event => {
          const value = event.target.value as CompanionLanguage
          companionLocale.setPreference(value)
          setLanguage(value)
        }}>
          <option value="auto">{chrome('browserDefault')}</option>
          <option value="zh">中文</option>
          <option value="en">English</option>
        </select>
      </section>
      <section className="companion-settings"><strong>{chrome('designSuggestions')}</strong>
        <label>{chrome('maxSuggestions')}<input aria-label={chrome('maxSuggestions')} type="number" min="1" max="10" step="1" value={maxSuggestions} onChange={event => setMaxSuggestions(event.target.value)} /></label>
        <button type="button" onClick={() => { void rpc('updateSettings', { maxSuggestions: Number(maxSuggestions) }).then(() => { requestLivePoll(); onNotice(chrome('settingsSaved'), true) }).catch(error => setError(String(error))) }}>{chrome('saveSettings')}</button>
      </section>
      {!designOnly && <section><strong>{chrome('display')}</strong><button type="button" onClick={() => resizeChat(DEFAULT_CHAT_WIDTH)}>{chrome('restoreChatLayout')}</button></section>}
      <section><strong>{chrome('designStudio')}</strong><p>{chrome('studioDescription')}</p>
        <a href={transport.headers['X-Design-Token'] ? `?view=studio#${encodeURIComponent(transport.headers['X-Design-Token'])}` : '?view=studio'} target="_blank" rel="noopener noreferrer" onClick={() => settingsDialog.current?.close()}>{chrome('openStudio')}</a>
      </section>
      <section><strong>{chrome('nativeConnection')}</strong><p>{nativeHostLabel} · {thread ?? chrome('connecting')}</p><p>{chrome('nativeConnectionDescription', { host: nativeHostLabel })}</p></section>
    </dialog>
  </div>
}
function StudioPage(): ReactElement {
  const locale = useCurrentLanguage()
  useEffect(() => { document.documentElement.lang = companionDocumentLanguage(locale); document.title = 'Yugoo Design · Studio' }, [locale])
  useEffect(() => bindDesignHostLocale(companionLocale), [])
  return <><style>{'html,body,#root{height:100%;margin:0}body{overflow:hidden}'}</style><StudioWorkspace locale={locale === 'zh_CN' ? 'zh' : 'en'} onLocaleChange={value => companionLocale.setPreference(value)} client={studioClient} instances={studioInstances} trials={studioTrials} authoring={studioAuthoring} kitAuthoring={studioKitAuthoring} componentLibrary={studioComponentLibrary} renderSelect={PanelSelect} contentClient={studioContentClient} /></>
}
createRoot(document.getElementById('root')!).render(<CanvasFontRoot>{studioPage ? <StudioPage /> : <App />}</CanvasFontRoot>)
