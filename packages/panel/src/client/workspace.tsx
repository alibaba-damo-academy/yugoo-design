/**
 * DesignWorkspace: the dock's orchestration layer (strict port of Design.tsx,
 * scoped to the active runtime-loaded Bundles). Consumes the plugin workspace
 * through the dual-baseline panel store, renders the original chrome —
 * DesignTabsBar (+ overflow dropdown, wheel scroll, active-tab background),
 * the "+ new panel" SkillCatalogPicker overlay, the selected project's
 * completion/path header, and the FooterButtons save/retract bar — mounts only
 * the active skill panel, and round-trips saves through `remote.designPanel.savePanel`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { browserRandomUuid } from '../browser-uuid.ts'
import { createPanelDemoSave } from './demo-save.ts'
import {
  isRecord,
  type DesignExecutionLogRead,
  type DesignPanelWorkspaceRead,
  type DesignProjectCatalogRead,
  type DesignProjection,
  type SkillManifestLite,
} from './types.ts'
import type { DesignAdvisoryProjectionEntry } from './types.ts'
import { canNavigate } from './navigation.ts'
import { parsePanelManifest } from '../dsl.ts'
import { panelText } from '../panel-i18n.tsx'
import { AutoPanelNotice } from '../auto-panel-notice.tsx'
import { sectionBindingOf, recordsAtPath, type DesignData } from '../interpreter.ts'
import {
  editDraft,
  hasPendingChanges,
  isDirty,
  panelStore,
  resetPanelStore,
  revertAll,
  selectTab,
  setSaving,
  settleSavedDraft,
  syncProjection,
} from './store.ts'
import { currentLanguage, useCurrentLanguage, useLang } from './ported/host.ts'
import { DesignTabsBar } from './ported/design/DesignTabsBar.tsx'
import type { ITabOption } from './ported/design/DesignTabs.tsx'
import FooterButtons from './ported/design/FooterButtons.tsx'
import { DesignDockMeta, hasDockMeta } from './dock-action-meta.tsx'
import { SkillCatalogPicker } from './ported/design/SkillCatalogPicker.tsx'
import {
  buildSkillRouteText,
  catalogFromListSkills,
  type IDesignSkillCard,
  type IMindsetCatalogs,
  type SkillCatalogResponse,
} from './ported/design/skillCatalog.ts'
import { DslPanel } from './panels/dsl-panel.tsx'
import { createPanelSaveBarrier } from '../panel-save-barrier.ts'
import {
  panelPresentation,
  panelScrollOwner,
  prepareNativePanelSave,
  type NativePanelSaveArtifact,
  type NativePanelRegistry,
  type PanelPresentation,
} from './native-panel-registry.ts'
import type { BinaryArtifactRead } from './panels/shared.ts'
import { DesignPanelSurface } from './design-panel-surface.tsx'
import { ExperiencePanel } from './experience-panel.tsx'
import { GraphPanel } from './graph-panel.tsx'
import { PanelSaveError } from './panel-save-error.tsx'

/** Client runtime services the workspace needs. */
export interface DesignRuntime {
  /** Native Host capability; never constructs file: URLs or starts a model turn. */
  canOpenProjectFolder?: () => Promise<boolean>
  openProjectFolder?: (path: string) => Promise<void>
  readReviewPolicy?: (sessionId: string) => Promise<import('../../../core/src/design-review-policy.ts').DesignReviewPolicy>
  updateReviewPolicy?: (sessionId: string, policy: import('../../../core/src/design-review-policy.ts').DesignReviewPolicy) => Promise<import('../../../core/src/design-review-policy.ts').DesignReviewPolicy>
  readGraph?: (sessionId: string) => Promise<{ content: string }>
  readKnowledgeStatus?: (sessionId: string) => Promise<import('../../../core/src/design-knowledge-status.ts').DesignKnowledgeStatusSnapshot | undefined>
  retryKnowledge?: (sessionId: string) => Promise<{ accepted: boolean }>
  queryKnowledge?: (sessionId: string, args: import('../../../core/src/design-knowledge-query.ts').KnowledgeReadArguments) => Promise<import('../../../core/src/design-knowledge-query.ts').KnowledgeReadResult>
  /** Trusted compiled panel implementations available in this client plugin. */
  nativePanels: NativePanelRegistry
  /** Read one plugin-owned DesignJournal workspace snapshot. */
  readWorkspace: (sessionId: string) => Promise<DesignPanelWorkspaceRead>
  savePanel: (
    sessionId: string,
    skill: string,
    state: unknown,
    artifacts?: readonly NativePanelSaveArtifact[] | { readonly autoBefore: unknown; readonly definitionRevision?: string },
    eventId?: string,
  ) => Promise<{ commit?: string }>
  retainAutoPanel?: (sessionId: string, request: { projectId: string; skill: string; sourceRevision: string; definitionRevision: string }) => Promise<{ retained: true }>
  /** Native-host request delivery, not proof of model execution. */
  requestAutoPanel?: (sessionId: string, skill: string) => Promise<void>
  readArtifact: (sessionId: string, relPath: string, stateRevision: string) => Promise<{ found: boolean; content: string }>
  readBinaryArtifact: (sessionId: string, relPath: string, stateRevision: string) => Promise<BinaryArtifactRead>
  readExecutionLog: (sessionId: string, executionRef: string, afterSeq?: number, target?: import('./types.ts').DesignArtifactLogTarget) => Promise<DesignExecutionLogRead>
  /** Open a main-Agent turn with an explicit host-generated instruction. */
  sendPrompt: (sessionId: string, text: string, requestId?: string,
    saved?: readonly { readonly eventId: string; readonly commit?: string }[]) => Promise<void>
  /** Explicit project commands use the public host registry, never a model prompt. */
  sendCommand?: (sessionId: string, line: string) => Promise<void>
  /** Release only the machine-identified optional next-step recommendation. */
  cancelPendingNextStepQuestion: (sessionId: string) => Promise<boolean>
  /** The "+ new panel" picker's skill catalog source. */
  listSkills: (sessionId: string) => Promise<SkillCatalogResponse>
  /** Registered Design Projects newest-first plus installed Mindsets. */
  listProjects: (sessionId: string) => Promise<DesignProjectCatalogRead>
  /** Record review-card disposition; never applies the advisory itself. */
  decideAdvisory: (sessionId: string, advisoryId: string, decision: 'accepted' | 'rejected' | 'deferred') => Promise<DesignAdvisoryProjectionEntry>
  /** Read the Design-owned advisory review state for one session. */
  listAdvisories: (sessionId: string) => Promise<readonly DesignAdvisoryProjectionEntry[]>
}

/** 「+ 新面板」= 浏览器式新空标签（原始 NEW_PANEL_TAB 常量）。 */
const NEW_PANEL_TAB = '__new_panel__'

export { ReviewPolicyControl } from './review-policy-control.tsx'
const PANEL_SAVE_VISIBLE_MESSAGE = { zh: '保存并继续设计', en: 'Save and continue designing' } as const

function regenerateInstruction(skill: string): string {
  return `Regenerate the saved ${JSON.stringify(skill)} Design state from the injected authoritative panel diff. Invoke run_design_skill exactly once with name ${JSON.stringify(skill)}; do not repeat the same invocation.`
}

/** Tab label: skill.yaml bilingual title, zh preferred. */
function tabLabel(manifest: { title?: { zh?: string; en?: string }; name?: string } | undefined, skill: string): string {
  return manifest?.title?.zh ?? manifest?.title?.en ?? manifest?.name ?? skill
}

function hasActiveExecution(
  attempts: DesignPanelWorkspaceRead['executionAttempts'],
  skill: string,
): boolean {
  const newest = [...attempts].filter(attempt => attempt.skill === skill)
    .sort((left, right) => right.sequence - left.sequence)[0]
  if (newest === undefined) return false
  const latest = new Map<string, DesignPanelWorkspaceRead['executionAttempts'][number]>()
  for (const attempt of attempts) {
    if (attempt.skill !== skill || attempt.invocationId !== newest.invocationId) continue
    const current = latest.get(attempt.attemptId)
    if (current === undefined || current.sequence < attempt.sequence) latest.set(attempt.attemptId, attempt)
  }
  const folded = [...latest.values()]
  const root = folded
    .filter(attempt => attempt.role === 'producer' && attempt.artifactKind === undefined)
    .sort((left, right) => right.sequence - left.sequence)[0]
  if (root !== undefined && root.phase !== 'queued' && root.phase !== 'working') {
    return folded.some(attempt => attempt.sequence > root.sequence
      && (attempt.phase === 'queued' || attempt.phase === 'working'))
  }
  return folded.some(attempt => attempt.phase === 'queued' || attempt.phase === 'working')
}

/** One skill panel element bound to its draft and host services. */
function SkillPanel(props: {
  skill: string
  panelYaml: string | undefined
  autoPanelYaml?: string
  autoPanelDefinition?: NonNullable<DesignPanelWorkspaceRead['autoPanelDefinitions']>[string]
  onRetainAutoPanel?: () => void
  onRequestAutoPanel?: () => void
  retaining?: boolean
  autoPanelState?: NonNullable<DesignPanelWorkspaceRead['autoPanelStates']>[string]
  presentation: PanelPresentation
  nativePanels: NativePanelRegistry
  draft: unknown
  originalState: unknown
  artifactFiles?: Readonly<Record<string, string>>
  readArtifact: (relPath: string, revision?: string) => Promise<{ found: boolean; content: string }>
  sourceRevision?: string
  readBinaryArtifact: (relPath: string) => Promise<BinaryArtifactRead>
  readExecutionLog: (executionRef: string, afterSeq?: number, target?: import('./types.ts').DesignArtifactLogTarget) => Promise<DesignExecutionLogRead>
  artifactActivities?: DesignPanelWorkspaceRead['artifactActivities']
  executionAttempts: DesignPanelWorkspaceRead['executionAttempts']
  registerBeforeSave: (skill: string, flush: () => Promise<void>) => import('./panels/shared.ts').BeforeSaveRegistration
  sendPrompt?: (text: string) => void | Promise<void>
  running?: boolean
  onSaveAndRegenerate?: () => void
  selectPanel: (skill: string) => void
  panelData?: (panelType: string, sectionId: string) => Record<string, Record<string, unknown>>
  readOnly: boolean
}): ReactElement {
  useCurrentLanguage()
  const editorReadOnly = props.readOnly || props.running === true
  const onChange = useCallback((next: unknown) => {
    if (!editorReadOnly) editDraft(props.skill, next)
  }, [editorReadOnly, props.skill])
  const registerBeforeSave = useCallback((flush: () => Promise<void>) => props.registerBeforeSave(props.skill, flush), [props.registerBeforeSave, props.skill])
  const common = {
    draft: props.draft,
    onChange,
    originalState: props.originalState,
    artifactFiles: props.artifactFiles,
    readArtifact: props.readArtifact,
    sourceRevision: props.sourceRevision,
    readBinaryArtifact: props.readBinaryArtifact,
    readExecutionLog: props.readExecutionLog,
    executionAttempts: props.executionAttempts,
    artifactActivities: props.artifactActivities,
    registerBeforeSave,
  }
  let content: ReactElement
  if (props.presentation.mode === 'declarative') {
    content = <DslPanel {...common} sendPrompt={props.sendPrompt} running={props.running} onSaveAndContinue={props.onSaveAndRegenerate} selectPanel={props.selectPanel} locale={currentLanguage()} skill={props.skill} panelYaml={props.panelYaml} panelData={props.panelData} readOnly={editorReadOnly} />
  } else if (props.presentation.mode === 'auto') {
    if (props.autoPanelYaml !== undefined) {
      content = <div className='dsh-design-auto-surface'>
        <AutoPanelNotice locale={currentLanguage()} origin={props.autoPanelDefinition?.origin}
          sourceChanged={props.autoPanelDefinition?.sourceChanged} readOnly={editorReadOnly}
          retaining={props.retaining} onRetain={props.onRetainAutoPanel} generation={props.autoPanelState} />
        <DslPanel {...common} locale={currentLanguage()} skill={props.skill} panelYaml={props.autoPanelYaml} panelData={props.panelData} readOnly={editorReadOnly} allowAttachments={false} />
      </div>
    } else {
      const source = props.originalState === undefined ? props.draft : props.originalState
      const preview = JSON.stringify(source ?? {}, null, 2)
      const busy = props.autoPanelState?.phase === 'queued' || props.autoPanelState?.phase === 'running'
      content = <div className='dsh-design-auto-wait' role='status' aria-live='polite'>
        <div className='dsh-design-auto-wait-heading'>
          {busy ? <span className='dsh-design-auto-wait-orb' aria-hidden='true' /> : null}
          <div>
            <h2>{props.autoPanelDefinition?.error ? panelText('retainedIncompatible', currentLanguage()) : busy ? panelText('autoPanelGenerating', currentLanguage()) : props.autoPanelState?.phase === 'awaiting-agent' ? panelText('autoPanelAwaitingAgent', currentLanguage()) : props.autoPanelState?.phase === 'failed' ? panelText('autoPanelFailed', currentLanguage()) : panelText('autoPanelNotReady', currentLanguage())}</h2>
            <p>{props.autoPanelDefinition?.error ? panelText('retainedIncompatibleHint', currentLanguage())
              : busy ? panelText('autoPanelGeneratingHint', currentLanguage())
              : props.autoPanelState?.phase === 'awaiting-agent' ? panelText('autoPanelAwaitingAgentHint', currentLanguage())
              : props.autoPanelState?.phase === 'failed'
                ? panelText('autoPanelFailedHint', currentLanguage())
                : panelText('autoPanelNotReadyHint', currentLanguage())}</p>
          </div>
        </div>
        {busy ? <div className='dsh-design-auto-wait-preview' aria-hidden='true'>
          <span className='dsh-design-auto-wait-line is-title' />
          <span className='dsh-design-auto-wait-line' />
          <span className='dsh-design-auto-wait-line is-short' />
          <div className='dsh-design-auto-wait-card'><span /><span /><span /></div>
        </div> : null}
        {props.autoPanelState?.phase === 'failed' && props.autoPanelState.detail
          ? <p className='dsh-design-auto-wait-error'>{props.autoPanelState.detail}</p> : null}
        {!busy && !editorReadOnly && !props.autoPanelDefinition?.error && props.onRequestAutoPanel ? <button type='button'
          className='dsh-design-auto-retain' disabled={props.retaining}
          onClick={props.onRequestAutoPanel}>{panelText('autoPanelRequest', currentLanguage())}</button> : null}
        <details className='dsh-design-auto-wait-source'>
          <summary>{panelText('autoPanelReadonlySource', currentLanguage())}</summary>
          <pre>{preview}</pre>
        </details>
      </div>
    }
  } else if (props.presentation.mode === 'invalid') {
    content = <div className='m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800' role='alert'>Invalid panel presentation: {props.presentation.reason}.</div>
  } else if (props.presentation.mode === 'none') {
    return <></>
  } else {
    const renderer = props.presentation.renderer
    const definition = renderer === undefined ? undefined : props.nativePanels.get(renderer)
    if (definition === undefined) {
      content = (
        <div className='m-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800' role='alert'>
          Native panel renderer {renderer === undefined ? '(missing id)' : JSON.stringify(renderer)} is not installed.
        </div>
      )
    } else {
      const action = definition.action
      const saveAndRegenerate = props.onSaveAndRegenerate
      const onAction = editorReadOnly || action === undefined || saveAndRegenerate === undefined
        ? undefined
        : () => { action({ saveAndRegenerate }) }
      content = definition.render({
        ...common,
        skill: props.skill,
        running: editorReadOnly,
        sendPrompt: editorReadOnly ? () => {} : (props.sendPrompt ?? (() => {})),
        selectPanel: props.selectPanel,
        panelData: props.panelData ?? (() => ({})),
        onAction,
      })
    }
  }
  return <DesignPanelSurface>{content}</DesignPanelSurface>
}

/**
 * The workspace body mounted inside the dock chrome.
 * @param props - DesignJournal snapshot, session id, runtime, dock visibility.
 * @returns tabs bar + feature popover + active panel + action bar (metadata + save/retract).
 */
export interface DesignWorkspaceControls {
  readonly dirty: boolean
  readonly saving: boolean
  readonly saveDisabled: boolean
  readonly retractDisabled: boolean
  readonly error?: string
  readonly save: () => void
  readonly retract: () => void
}

export function DesignWorkspace(props: {
  /** Presentation only; persistence, editor barriers and access stay shared. */
  presentation?: 'workspace' | 'panel-only'
  /** Studio-only UI demonstration: no persistence, publication or Agent continuation. */
  demonstrationSave?: boolean
  onControlsChange?: (controls: DesignWorkspaceControls | undefined) => void
  design: DesignProjection | undefined
  projectId: string | null
  checkpoint: string | null
  worktreeRevision: string | null
  artifactFiles?: Readonly<Record<string, string>>
  autoPanelManifests?: DesignPanelWorkspaceRead['autoPanelManifests']
  autoPanelDefinitions?: DesignPanelWorkspaceRead['autoPanelDefinitions']
  autoPanelStates?: DesignPanelWorkspaceRead['autoPanelStates']
  activeMainBundles?: DesignPanelWorkspaceRead['activeMainBundles']
  mustEditHandoffs?: DesignPanelWorkspaceRead['mustEditHandoffs']
  artifactActivities?: DesignPanelWorkspaceRead['artifactActivities']
  executionAttempts: DesignPanelWorkspaceRead['executionAttempts']
  access: DesignPanelWorkspaceRead['access']
  publicationError?: string
  /** Error already presented by this host; suppress only its duplicate inline copy. */
  hostReportedSaveError?: string
  /** DesignJournal clarity value for the action-bar metadata's first line. */
  clarity?: unknown
  /** Human-readable selected Design Project name for header metadata. */
  projectName?: string | null
  /** Selected Design Project system directory for header metadata. */
  projectPath?: string | null
  /** Opt-in one-row header for host embedded browser surfaces. */
  compactHeader?: boolean
  /** Host renders the same project metadata elsewhere (for example in a sidebar). */
  hideProjectHeader?: boolean
  sessionId: string | undefined
  runtime: DesignRuntime
  dockOpen: boolean
  /** Explicit host capability; do not advertise generation where no tool is installed. */
  experienceAvailable?: boolean
  experienceFiles?: Readonly<Record<string, string>>
  focus?: { readonly skill: string; readonly nonce: number }
  /** Close the dock; renders the × at the far right of the Chrome-style tab strip. */
  onClose?: () => void
}): ReactElement {
  const { design: sourceDesign, projectId, checkpoint, worktreeRevision, executionAttempts, access, clarity, projectName, projectPath, sessionId, runtime, dockOpen, focus, onClose } = props
  const demo = useMemo(() => createPanelDemoSave(), [sessionId, projectId, projectPath, props.demonstrationSave])
  const [demoRevision, setDemoRevision] = useState(0)
  const design = useMemo(() => props.demonstrationSave ? demo.project(sourceDesign) : sourceDesign, [sourceDesign, demo, demoRevision, props.demonstrationSave])
  // The artifact RPC only distinguishes live worktree reads from committed
  // revision reads. Keep the live selector stable while sibling files change;
  // otherwise every poll recreates the reader and aborts in-flight artifact
  // hydration for diagrams that have already landed.
  const readableRevision = worktreeRevision === null ? checkpoint : 'worktree:live'
  const writable = access.writable
  const panelOnly = props.presentation === 'panel-only'
  const store = useSyncExternalStore(panelStore.subscribe, panelStore.getSnapshot)
  const saveBarrier = useMemo(() => createPanelSaveBarrier(), [sessionId, projectId, projectPath, runtime])
  const saveAdmission = useMemo(() => ({ busy: false }), [saveBarrier])
  const pendingEditorInput = useSyncExternalStore(saveBarrier.subscribe, saveBarrier.hasPendingChanges)
  const activeSaveBarrier = useRef(saveBarrier)
  activeSaveBarrier.current = saveBarrier
  const saveAccess = useRef({ mounted: true, writable })
  saveAccess.current.writable = writable
  // Strict Mode replays effect cleanup/setup: do not permanently dispose the
  // memoized registry here. Editors unregister themselves; obsolete registries
  // are collected after in-flight saves settle and fail the identity guard.
  useEffect(() => {
    saveAccess.current.mounted = true
    return () => { saveAccess.current.mounted = false }
  }, [])
  const isCurrentSave = useCallback(() => saveAccess.current.mounted && activeSaveBarrier.current === saveBarrier, [saveBarrier])
  const assertSaveAccess = useCallback(() => {
    if (!isCurrentSave() || !saveAccess.current.writable) throw new Error('The design workspace changed before saving.')
  }, [isCurrentSave])
  const subscribeNativePanels = useCallback(
    (listener: () => void) => runtime.nativePanels.subscribe(listener),
    [runtime.nativePanels],
  )
  const readNativePanelRevision = useCallback(
    () => runtime.nativePanels.revision(),
    [runtime.nativePanels],
  )
  const nativePanelRevision = useSyncExternalStore(subscribeNativePanels, readNativePanelRevision)
  const t = useLang()
  const isZh = currentLanguage() === 'zh_CN'

  // 「+ 新面板」选择器（空面板）是否打开。纯本地视图态：不插入持久本地
  // tab，真正的面板由 agent engage 技能后经 projection 到达。
  const [pickerOpen, setPickerOpen] = useState(false)
  const [experienceOpen, setExperienceOpen] = useState(false)
  const [graphOpen, setGraphOpen] = useState(false)
  useEffect(() => { resetPanelStore(projectId === null ? undefined : `${projectPath ?? ''}:${projectId}`) }, [sessionId, projectId, projectPath])
  useEffect(() => {
    const renderedSkills = Object.entries(design ?? {}).filter(([skill, entry]) => {
      const presentation = panelPresentation(entry.skillManifest as SkillManifestLite | undefined)
      if (presentation.mode === 'auto') return props.autoPanelManifests?.[skill] !== undefined
      if (presentation.mode === 'declarative') return entry.panelYaml !== undefined
      return presentation.mode === 'native' && presentation.renderer !== undefined
        && runtime.nativePanels.get(presentation.renderer) !== undefined
    }).map(([skill]) => skill)
    syncProjection(design, dockOpen && !graphOpen && !experienceOpen && !pickerOpen,
      runtime.nativePanels, focus?.skill, props.artifactFiles, renderedSkills)
  }, [design, dockOpen, graphOpen, experienceOpen, pickerOpen, focus, nativePanelRevision, runtime.nativePanels, props.artifactFiles, props.autoPanelManifests])
  const readGraph = useCallback(() => sessionId && runtime.readGraph ? runtime.readGraph(sessionId) : Promise.reject(new Error('Graph unavailable')), [runtime, sessionId, projectId])
  const readKnowledgeStatus = useCallback(() => sessionId && runtime.readKnowledgeStatus ? runtime.readKnowledgeStatus(sessionId) : Promise.resolve(undefined), [runtime, sessionId, projectId])
  const retryKnowledge = useCallback(() => sessionId && runtime.retryKnowledge ? runtime.retryKnowledge(sessionId) : Promise.reject(new Error('Recovery unavailable')), [runtime, sessionId, projectId])
  const [catalog, setCatalog] = useState<IMindsetCatalogs | null>(null)
  const [catalogFetching, setCatalogFetching] = useState(false)
  useEffect(() => {
    setPickerOpen(false)
    setExperienceOpen(false)
    setGraphOpen(false)
    setCatalog(null)
    setCatalogFetching(false)
  }, [sessionId, projectId])
  useEffect(() => {
    if (!writable) setPickerOpen(false)
  }, [writable])

  const readArtifact = useCallback(
    (relPath: string, revision?: string) => sessionId !== undefined && readableRevision !== null
      ? runtime.readArtifact(sessionId, relPath, revision ?? readableRevision)
      : Promise.resolve({ found: false, content: '' }),
    [readableRevision, runtime, sessionId, projectId],
  )

  const readBinaryArtifact = useCallback(
    (relPath: string) => sessionId !== undefined && readableRevision !== null
      ? runtime.readBinaryArtifact(sessionId, relPath, readableRevision)
      : Promise.resolve({
          found: false,
          mediaType: 'application/pdf' as const,
          base64: '',
          byteLength: 0,
        }),
    [readableRevision, runtime, sessionId, projectId],
  )

  const readExecutionLog = useCallback(
    (executionRef: string, afterSeq?: number, target?: import('./types.ts').DesignArtifactLogTarget) => sessionId === undefined
      ? Promise.resolve({ found: false, revision: null, reset: false, entries: [] })
      : runtime.readExecutionLog(sessionId, executionRef, afterSeq, target),
    [runtime, sessionId],
  )

  const sendPrompt = useCallback(
    async (text: string) => {
      if (props.demonstrationSave || !writable || sessionId === undefined) throw new Error('The current design project is not writable')
      await runtime.sendPrompt(sessionId, text)
    },
    [runtime, sessionId, writable, props.demonstrationSave],
  )
  // Experience indexes and versioned resources are read from committed Git,
  // never from the publication's transient worktree writes before commitExact.
  const readExperienceArtifact = useCallback((path: string) => sessionId !== undefined && checkpoint !== null
    ? runtime.readArtifact(sessionId, path, checkpoint) : Promise.resolve({ found: false, content: '' }), [runtime, sessionId, projectId, checkpoint])
  const readExperienceBinary = useCallback((path: string) => sessionId !== undefined && checkpoint !== null
    ? runtime.readBinaryArtifact(sessionId, path, checkpoint) : Promise.resolve({ found: false, mediaType: 'image/png' as const, base64: '', byteLength: 0 }), [runtime, sessionId, projectId, checkpoint])

  // 跨面板选项源：声明式面板的 options_from_panel 经此解析其他技能的分区
  // 记录。草稿优先（未保存编辑立即可被引用看到），只读返回所点名分区，
  // 缺失面板/分区一律空——引用永不拷贝或回写来源数据。
  // Cross-panel option source: resolve the target panel's section through
  // its manifest storage binding (nested records_path included); parse
  // failure degrades to empty options (core validates at publication).
  const panelData = useCallback((panelType: string, sectionId: string): Record<string, Record<string, unknown>> => {
    const state = store.drafts[panelType] ?? store.originals[panelType]
    if (!isRecord(state)) return {}
    const targetYaml = design?.[panelType]?.panelYaml
    if (typeof targetYaml !== 'string') {
      const section = state[sectionId]
      return isRecord(section) ? (section as Record<string, Record<string, unknown>>) : {}
    }
    try {
      const manifest = parsePanelManifest(targetYaml)
      return recordsAtPath(state as unknown as DesignData, sectionBindingOf(manifest, sectionId).recordsPath)
    } catch {
      return {}
    }
  }, [store, design])

  // 技能目录按需拉取（选择器打开时一次）。
  const openPicker = useCallback((): void => {
    if (!writable) return
    setPickerOpen(true)
    if (catalog !== null || catalogFetching || sessionId === undefined) return
    setCatalogFetching(true)
    runtime.listSkills(sessionId)
      .then((response) => { setCatalog(catalogFromListSkills(response)) })
      .catch(() => { setCatalog(null) })
      .finally(() => { setCatalogFetching(false) })
  }, [catalog, catalogFetching, runtime, sessionId, writable])

  // 点选技能卡片 → 发送 skill.yaml picker label 进聊天，agent 的技能目录
  // 完成 engage；面板随后经 projection 出现（store 自动切换到新 tab）。
  const handlePickSkill = useCallback((card: IDesignSkillCard): void => {
    if (writable && sessionId !== undefined) void runtime.sendPrompt(sessionId, buildSkillRouteText(card))
    setPickerOpen(false)
  }, [runtime, sessionId, writable])

  const pending = pendingEditorInput || hasPendingChanges(runtime.nativePanels)

  const tabOptions: ITabOption[] = useMemo(() => store.skills.map((skill) => ({
    value: skill,
    // 灰点 = 人工未保存编辑；new 角标 = agent 离屏更新未读（互斥，灰点优先）。
    label: tabLabel(store.manifests[skill], skill),
    badge: isDirty(skill, runtime.nativePanels),
    unread: !isDirty(skill, runtime.nativePanels) && store.unread[skill] === true,
  })), [store, nativePanelRevision, runtime.nativePanels])

  const save = useCallback((): void => {
    if (!writable || sessionId === undefined || store.saving || saveAdmission.busy) return
    saveAdmission.busy = true
    // Every save durably consumes its exact must-edit gate before this
    // assessment turn observes the authoritative diffs.
    void (async () => {
      await saveBarrier.flush()
      assertSaveAccess()
      // The editor must deliver its last native input before the saving lock
      // makes its onChange callback read-only. Admission still prevents reentry.
      setSaving(true)
      const latest = panelStore.getSnapshot()
      const dirty = latest.skills.filter((skill) => isDirty(skill, runtime.nativePanels))
      if (!dirty.length) return
      if (props.demonstrationSave) {
        demo.accept(sourceDesign, latest.drafts, dirty)
        setDemoRevision(value => value + 1)
        return
      }
      const receipts: { eventId: string; commit?: string }[] = []
      for (const skill of dirty) {
        assertSaveAccess()
        const presentation = panelPresentation(latest.manifests[skill])
        if (presentation.mode === 'auto') {
          const original = latest.originals[skill]
          if (original === undefined) throw new Error('自动面板缺少原始设计文件状态，请刷新后重试。')
          const state = latest.drafts[skill]
          const eventId = browserRandomUuid()
          const saved = await runtime.savePanel(sessionId, skill, state, { autoBefore: original, definitionRevision: props.autoPanelDefinitions?.[skill]?.definitionRevision }, eventId)
          receipts.push({ eventId, ...saved })
          assertSaveAccess()
          settleSavedDraft(skill, state)
        } else {
          const prepared = prepareNativePanelSave(presentation, runtime.nativePanels, latest.drafts[skill])
          const eventId = browserRandomUuid()
          const saved = await runtime.savePanel(sessionId, skill, prepared.state, prepared.artifacts ?? [], eventId)
          receipts.push({ eventId, ...saved })
          assertSaveAccess()
          settleSavedDraft(skill, prepared.state)
        }
      }
      // The writes above are already authoritative. Release only the optional
      // post-Design recommendation so this saved user intent is not queued
      // behind a stale choice; a failed/absent cancel never invalidates save.
      await runtime.cancelPendingNextStepQuestion(sessionId)
      assertSaveAccess()
      await runtime.sendPrompt(sessionId, isZh ? PANEL_SAVE_VISIBLE_MESSAGE.zh : PANEL_SAVE_VISIBLE_MESSAGE.en, browserRandomUuid(), receipts)
    })()
      .then(
        () => { saveAdmission.busy = false; if (isCurrentSave()) setSaving(false) },
        (failure: unknown) => { saveAdmission.busy = false; if (isCurrentSave()) setSaving(false, failure instanceof Error ? failure.message : String(failure)) },
      )
  }, [isZh, runtime, sessionId, store.saving, writable, saveBarrier, saveAdmission, assertSaveAccess, isCurrentSave, props.autoPanelDefinitions, props.demonstrationSave, demo, sourceDesign])

  const controls = useMemo<DesignWorkspaceControls>(() => ({
    dirty: pending, saving: store.saving,
    saveDisabled: !writable || store.skills.length === 0 || store.saving || sessionId === undefined || !pending,
    retractDisabled: !writable || store.skills.length === 0 || store.saving || !pending,
    ...(store.error ? { error: store.error } : {}), save, retract: revertAll,
  }), [pending, store.saving, store.skills.length, store.error, writable, sessionId, save])
  useEffect(() => { props.onControlsChange?.(controls) }, [props.onControlsChange, controls])
  useEffect(() => () => { props.onControlsChange?.(undefined) }, [props.onControlsChange])

  // Driver-owned action host: persist the current rendered skill's draft and
  // issue one exact fresh regeneration request for that skill.
  // No skill names here — the pack's action decides which panel triggers it.
  const saveSkillAndContinue = useCallback((skill: string): void => {
    if (props.demonstrationSave) { save(); return }
    if (!writable || sessionId === undefined || store.saving || saveAdmission.busy) return
    saveAdmission.busy = true
    void (async () => {
      await saveBarrier.flush(skill)
      assertSaveAccess()
      setSaving(true)
      const latest = panelStore.getSnapshot()
      const receipts: { eventId: string; commit?: string }[] = []
      if (isDirty(skill, runtime.nativePanels)) {
        const presentation = panelPresentation(latest.manifests[skill])
        if (presentation.mode === 'auto') {
          const original = latest.originals[skill]
          if (original === undefined) throw new Error('自动面板缺少原始设计文件状态，请刷新后重试。')
          const state = latest.drafts[skill]
          const eventId = browserRandomUuid()
          const saved = await runtime.savePanel(sessionId, skill, state, { autoBefore: original, definitionRevision: props.autoPanelDefinitions?.[skill]?.definitionRevision }, eventId)
          receipts.push({ eventId, ...saved })
          assertSaveAccess()
          settleSavedDraft(skill, state)
        } else {
          const prepared = prepareNativePanelSave(presentation, runtime.nativePanels, latest.drafts[skill])
          const eventId = browserRandomUuid()
          const saved = await runtime.savePanel(sessionId, skill, prepared.state, prepared.artifacts ?? [], eventId)
          receipts.push({ eventId, ...saved })
          assertSaveAccess()
          settleSavedDraft(skill, prepared.state)
        }
      }
      await runtime.cancelPendingNextStepQuestion(sessionId)
      assertSaveAccess()
      await runtime.sendPrompt(sessionId, regenerateInstruction(skill), browserRandomUuid(), receipts.length ? receipts : undefined)
    })()
      .then(
        () => { saveAdmission.busy = false; if (isCurrentSave()) setSaving(false) },
        (failure: unknown) => { saveAdmission.busy = false; if (isCurrentSave()) setSaving(false, failure instanceof Error ? failure.message : String(failure)) },
      )
  }, [runtime, sessionId, store.saving, writable, saveBarrier, saveAdmission, assertSaveAccess, isCurrentSave, props.autoPanelDefinitions, props.demonstrationSave, save])

  const retainPanel = useCallback((skill: string): void => {
    if (props.demonstrationSave) return
    const definitionRevision = props.autoPanelDefinitions?.[skill]?.definitionRevision
    if (!runtime.retainAutoPanel || !writable || !sessionId || !projectId || !worktreeRevision || !definitionRevision || store.saving) return
    if (isDirty(skill, runtime.nativePanels)) return
    setSaving(true)
    void runtime.retainAutoPanel(sessionId, { projectId, skill, sourceRevision: worktreeRevision, definitionRevision })
      .then(() => { if (isCurrentSave()) setSaving(false) }, (error: unknown) => {
        if (isCurrentSave()) setSaving(false, error instanceof Error ? error.message : String(error))
      })
  }, [runtime, writable, sessionId, projectId, worktreeRevision, props.autoPanelDefinitions, store.saving, isCurrentSave, props.demonstrationSave])

  const requestPanel = useCallback((skill: string): void => {
    if (props.demonstrationSave) return
    if (!runtime.requestAutoPanel || !writable || !sessionId || store.saving || isDirty(skill, runtime.nativePanels)) return
    setSaving(true)
    void runtime.requestAutoPanel(sessionId, skill).then(
      () => { if (isCurrentSave()) setSaving(false) },
      (error: unknown) => { if (isCurrentSave()) setSaving(false, error instanceof Error ? error.message : String(error)) },
    )
  }, [runtime, writable, sessionId, store.saving, isCurrentSave, props.demonstrationSave])

  // Generic navigation guard: cross-panel references (e.g. PRD evidence
  // chips) may carry uninstalled skill names or non-skill markers
  // (user:/upload:); unknown targets no-op instead of blanking the dock.
  const navigationBusy = useRef(false)
  const flushBeforeNavigation = useCallback((navigate: () => void): void => {
    if (navigationBusy.current || panelStore.getSnapshot().saving) return
    navigationBusy.current = true
    void saveBarrier.flush().then(() => {
      if (isCurrentSave()) navigate()
    }).catch((failure: unknown) => {
      if (isCurrentSave()) setSaving(false, failure instanceof Error ? failure.message : String(failure))
    }).finally(() => { navigationBusy.current = false })
  }, [saveBarrier, isCurrentSave])
  const selectPanel = useCallback((target: string): void => {
    if (!canNavigate(store.skills, target)) return
    flushBeforeNavigation(() => selectTab(target))
  }, [store.skills, flushBeforeNavigation])

  const accessNotice = projectId === null || writable
    ? null
    : (
      <div
        data-testid='dsh-design-workspace-readonly'
        className='mx-4 mt-3 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900'
        role='status'
      >
        {props.publicationError
          ? (isZh ? `版本状态暂不可用，当前文件仅供只读查看：${props.publicationError}`
            : `Publication state is unavailable. Current files are read-only: ${props.publicationError}`)
          : access.mode === 'recovery'
          ? (isZh
              ? `当前项目固定的 Kit ${access.kit.name}@${access.kit.version} 不可用；Design Panel 已按只读恢复模式打开。请在对话中输入 ${access.upgradeCommand ?? '/yugoo kit <kit>'} 显式升级。`
              : `The pinned Kit ${access.kit.name}@${access.kit.version} is unavailable. The Design Panel is read-only until you explicitly run ${access.upgradeCommand ?? '/yugoo kit <kit>'} in the conversation.`)
          : (isZh
              ? '当前项目尚未选择 Kit；Design Panel 保持只读。请在对话中输入 /yugoo kit <kit>。'
              : 'This project has no selected Kit. The Design Panel is read-only until you run /yugoo kit <kit> in the conversation.')}
      </div>
    )
  const closeButton = panelOnly || onClose === undefined
    ? null
    : (
      <button
        type='button'
        data-testid='dsh-design-dock-close'
        onClick={() => flushBeforeNavigation(onClose)}
        title={isZh ? '关闭设计面板' : 'Close design dock'}
        aria-label={isZh ? '关闭设计面板' : 'Close design dock'}
        className='dsh-design-dock-close'
      >
        ×
      </button>
    )
  const projectHeader = panelOnly || props.hideProjectHeader ? null : (
    <div className='dsh-design-project-header' data-testid='design-project-header' data-compact={props.compactHeader || undefined}>
      {hasDockMeta(clarity, projectPath, projectName)
        ? <DesignDockMeta compact={props.compactHeader} clarity={clarity} projectName={projectName} projectPath={projectPath}
            canOpenProjectFolder={runtime.canOpenProjectFolder} openProjectFolder={runtime.openProjectFolder} />
        : null}
      {store.skills.length === 0 ? closeButton : null}
    </div>
  )
  const viewSwitcher = !panelOnly && (props.experienceAvailable || runtime.readGraph) && projectId !== null ? (
    <nav aria-label={t.design_project_views} className='dsh-design-view-switcher' data-testid='design-view-switcher'>
      <button type='button' aria-pressed={!experienceOpen && !graphOpen} onClick={() => flushBeforeNavigation(() => { setExperienceOpen(false); setGraphOpen(false) })}>{t.design_files_view}</button>
      {props.experienceAvailable && <button type='button' aria-pressed={experienceOpen && !graphOpen} onClick={() => flushBeforeNavigation(() => { setExperienceOpen(true); setGraphOpen(false) })}>{t.design_experience_view}</button>}
      {runtime.readGraph && <button type='button' aria-pressed={graphOpen} onClick={() => flushBeforeNavigation(() => { setGraphOpen(true); setExperienceOpen(false) })}>{t.design_graph_view}</button>}
    </nav>
  ) : null
  if (!panelOnly && graphOpen && runtime.readGraph) return <div className='flex h-full min-h-0 flex-col'>{projectHeader}{accessNotice}<div className='min-h-0 flex-1'><GraphPanel key={`${sessionId}:${projectId}`} read={readGraph} readStatus={runtime.readKnowledgeStatus ? readKnowledgeStatus : undefined} retry={runtime.retryKnowledge ? retryKnowledge : undefined} footer={viewSwitcher} /></div></div>

  if (!panelOnly && props.experienceAvailable && experienceOpen) return <div className='flex h-full min-h-0 flex-col'>
    {projectHeader}
    {accessNotice}
    <div className='min-h-0 flex-1'><ExperiencePanel key={`${sessionId}:${projectId}`} footerStart={viewSwitcher} experienceFiles={props.experienceFiles} artifactFiles={props.artifactFiles} readArtifact={readExperienceArtifact} readBinaryArtifact={readExperienceBinary} writable={writable && sessionId !== undefined}
      sendPrompt={async text => { if (!writable || sessionId === undefined) throw new Error('当前项目不可写'); await runtime.sendPrompt(sessionId, text) }} /></div>
  </div>

  if (store.skills.length === 0) {
    return (
      <div className='relative flex h-full min-h-0 flex-col'>
        {projectHeader}
        {props.hideProjectHeader && !panelOnly ? closeButton : null}
        {accessNotice}
        <div className='dsh-design-dock-empty flex-1'>{t.design_empty_panels}</div>
        {viewSwitcher && <div className='dsh-design-view-footer'>{viewSwitcher}</div>}
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {projectHeader}
      {!panelOnly && <div className='relative grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-stretch'>
        <DesignTabsBar
          options={
            pickerOpen
              ? [
                  ...tabOptions,
                  {
                    value: NEW_PANEL_TAB,
                    label: t.design_new_panel,
                    badge: false,
                    unread: false,
                  },
                ]
              : tabOptions
          }
          flashTab={store.flash !== undefined ? { type: store.flash.skill, nonce: store.flash.nonce } : null}
          value={pickerOpen ? NEW_PANEL_TAB : store.active ?? ''}
          onChange={(value) => flushBeforeNavigation(() => {
            if (value === NEW_PANEL_TAB) {
              setPickerOpen(true)
              return
            }
            setPickerOpen(false)
            selectTab(value)
          })}
          onAddPanel={() => flushBeforeNavigation(openPicker)}
          addDisabled={!writable}
        />
        {closeButton}
      </div>}
      {accessNotice}
      <div
        className='ai dsh-design-workspace-inset relative h-0 min-h-0 flex-1 overflow-hidden'
        style={{ padding: panelOnly ? 0 : 'var(--ds-space-4) 0 var(--ds-space-4) var(--ds-space-4)' }}
      >
        {/* 「+ 新面板」选择器：覆盖整个工作区（原始：页签条保持可见，白遮罩
            盖住内容区，选择器用与其它面板相同的圆角卡片外框）。 */}
        {pickerOpen && !panelOnly
          ? (
            <div className='absolute inset-0 z-40 overflow-hidden bg-white px-4 pb-4'>
              <div className='h-full overflow-hidden rounded-2xl border border-[var(--ds-border-default)] bg-white'>
                <SkillCatalogPicker
                  openPanelTypes={store.skills}
                  mindsets={catalog}
                  fetching={catalogFetching}
                  onPick={handlePickSkill}
                />
              </div>
            </div>
          )
          : null}
        <PanelSaveError error={store.error} hostReportedError={props.hostReportedSaveError} />
        {store.active === undefined ? null : (() => {
          const skill = store.active
          const presentation = panelPresentation(design?.[skill]?.skillManifest)
          const scrollOwner = panelScrollOwner(presentation, runtime.nativePanels)
          return (
            <div
              key={skill}
              data-testid={`dsh-design-panel-${skill}`}
              data-scroll-owner={scrollOwner}
              className={`h-full min-h-0 ${scrollOwner === 'workspace' ? 'overflow-y-auto' : 'overflow-hidden'}`}
              {...(writable ? {} : { inert: '' })}
            >
              <SkillPanel
                skill={skill}
                panelYaml={design?.[skill]?.panelYaml}
                autoPanelYaml={props.autoPanelManifests?.[skill]}
                autoPanelDefinition={props.autoPanelDefinitions?.[skill]}
                onRetainAutoPanel={!props.demonstrationSave && runtime.retainAutoPanel && !isDirty(skill, runtime.nativePanels) ? () => retainPanel(skill) : undefined}
                onRequestAutoPanel={!props.demonstrationSave && runtime.requestAutoPanel && !isDirty(skill, runtime.nativePanels) ? () => requestPanel(skill) : undefined}
                retaining={store.saving}
                autoPanelState={props.autoPanelStates?.[skill]}
                presentation={presentation}
                nativePanels={runtime.nativePanels}
                draft={store.drafts[skill]}
                originalState={store.originals[skill]}
                artifactFiles={props.artifactFiles}
                readArtifact={readArtifact}
                sourceRevision={checkpoint ?? undefined}
                readBinaryArtifact={readBinaryArtifact}
                readExecutionLog={readExecutionLog}
                executionAttempts={executionAttempts.filter(attempt => attempt.skill === skill)}
                artifactActivities={props.artifactActivities?.filter(activity => activity.skill === skill)}
                registerBeforeSave={saveBarrier.register}
                sendPrompt={sendPrompt}
                running={store.saving || hasActiveExecution(executionAttempts, skill)
                  || props.activeMainBundles?.some(bundle => bundle.skill === skill) === true}
                onSaveAndRegenerate={() => saveSkillAndContinue(skill)}
                selectPanel={selectPanel}
                panelData={panelData}
                readOnly={!writable || (presentation.mode === 'auto' && props.autoPanelManifests?.[skill] === undefined)}
              />
            </div>
          )
        })()}
      </div>
      {!panelOnly && <FooterButtons
        className={`shrink-0 border-t border-[var(--ds-line-1)]${viewSwitcher ? ' dsh-design-footer-with-views' : ''}`}
        disabled={!writable || store.skills.length === 0 || store.saving || !pending}
        saveDisabled={!writable || store.skills.length === 0 || store.saving || sessionId === undefined || !pending}
        saveVariant={pending ? 'default' : 'outline'}
        onSave={save}
        onRegenerate={writable ? revertAll : undefined}
        regenerateText={t.button_regenerate}
        saveText={t.button_save_and_continue}
      >
        {viewSwitcher}
      </FooterButtons>}
    </div>
  )
}

export default DesignWorkspace
