/** Reusable host-neutral React workspace for the read-only Kit-first Studio surface. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { StudioWorkspaceController, type StudioKitWorkspaceTab } from './controller.ts'
import { renderStudioDocument, renderStudioMarkdown, splitFrontmatter } from './markdown.tsx'
import { STUDIO_WORKSPACE_CSS } from './styles.ts'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { StudioSelect, StudioSelectContext, type StudioSelectRenderer } from './StudioSelect.tsx'
import { FileExplorer } from './FileExplorer.tsx'
import { KitFiles } from './KitFiles.tsx'
import { FileInfoSidebar, FilePurpose } from './FileInfoSidebar.tsx'
import { BundleMounts } from './BundleMounts.tsx'
import { groupInstalledContent } from './content-versions.ts'
import type { StudioManagementClient } from './types.ts'
import { KitDraftWorkbench, type StudioKitAuthoring } from './KitDraftWorkbench.tsx'
import { MindsetInlineEditor, type MindsetInlineEditorProps } from './MindsetInlineEditor.tsx'
import { PanelDraftWorkbench, PanelDraftEditor, type StudioAuthoring } from './PanelDraftWorkbench.tsx'
import { BundleTrial } from './BundleTrial.tsx'
import { InstanceWorkbench, type StudioInstanceClient, type StudioInstance } from './InstanceWorkbench.tsx'
import { ComponentLibrary, type StudioComponentLibrary } from './ComponentLibrary.tsx'
import { ContentArchiveWorkbench, type StudioContentClient } from './ContentArchiveWorkbench.tsx'
import type { StudioTrialClient } from './trial-controller.ts'
import type { DesignKitVersionPin, DesignBundleVersionPin, StudioPanelPreviewResult, StudioPanelDraftRecord } from 'dsh-design-studio'

/** Props accepted by embedded and companion Studio presentations. */
export interface StudioWorkspaceProps {
  /** Explicit host UI language; document/browser remains the fallback. */
  readonly locale?: 'zh' | 'en'
  readonly onLocaleChange?: (locale: 'zh' | 'en') => void
  /** Transport adapter implementing the shared read-only service methods. */
  readonly client: StudioManagementClient
  /** Optional preconstructed controller for host lifecycle ownership and tests. */
  readonly controller?: StudioWorkspaceController
  /** Explicit host capability; omitted hosts remain read-only. */
  readonly authoring?: StudioAuthoring
  readonly kitAuthoring?: StudioKitAuthoring
  readonly trials?: StudioTrialClient
  readonly instances?: StudioInstanceClient
  /** Trusted host-owned catalog and sample-only shared renderer. */
  readonly componentLibrary?: StudioComponentLibrary
  /** Optional host-owned shared choice control; no Panel implementation enters Studio UI. */
  readonly renderSelect?: StudioSelectRenderer
  /** Optional inert content import/export; only Kit adoption requires Kit authoring. */
  readonly contentClient?: StudioContentClient
  /** Lets the host guard dialog closure as well as internal navigation. */
  readonly onDraftDirtyChange?: (dirty: boolean) => void
}

const KIT_TABS: readonly StudioKitWorkspaceTab[] = ['mindset', 'mounts']
const TABPANEL_ID = 'ygd-studio-kit-tabpanel'
// Documentation only: this link never installs content or changes project pins.
const OFFICIAL_KITS_URL = 'https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/kit-sharing.md#official-kits'

type StudioLocale = 'zh' | 'en'
type DocViewMode = 'rich' | 'source'
const displayName = (name: string): string => name.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())

// Keep the selected recovery ID stable while create/save receipts update the parent.
function InlineMindset(props: MindsetInlineEditorProps): ReactElement {
  const [initialId] = useState(props.initialId)
  return <MindsetInlineEditor {...props} initialId={initialId} />
}

/** Follow the host document or browser language; Chinese is the product default. */
function detectLocale(): StudioLocale {
  const documentLanguage = typeof document === 'undefined' ? '' : document.documentElement.lang
  const navigatorLanguage = typeof navigator === 'undefined' ? '' : navigator.language
  return `${documentLanguage || navigatorLanguage || 'zh'}`.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

const STRINGS = {
  en: {
    kitsTitle: 'Kits',
    kitsContext: 'Studio 1.0 · Kits',
    kitsSubtitle: 'Manage domain methods and mounted Bundles.',
    browseOfficialKits: 'Browse official kits',
    officialKitsHelp: 'Browse official kits: descriptions and acquisition guidance (opens in a new tab)',
    bundlesTitle: 'Bundles',
    bundlesContext: 'Studio 1.0 · Bundles',
    bundlesSubtitle: 'Installed Bundles, read-only inspection',
    searchPlaceholder: 'Search bundles…',
    kitContext: 'Studio 1.0 · Kit Workspace',
    bundleContext: 'Studio 1.0 · Bundle Workspace',
    officialReadonly: 'Official content · read-only · Studio 1.0',
    readonlyBadge: 'Read-only',
    versionBadge: (version: string) => `Version ${version}`,
    mountedBundlesLabel: 'Mounted Bundles',
    openWorkspace: 'Open workspace',
    openInBundleWorkspace: 'Open in bundle workspace',
    mountedBy: (kits: string) => `Mounted by ${kits}`,
    usedBy: (kits: string) => `Used by ${kits}`,
    noMountedBy: 'no installed Kits',
    mountedInKits: 'Mounted in Kits:',
    noKits: 'No installed Kits.',
    noBundles: 'No matching Bundles.',
    noMounts: 'This Kit mounts no Bundles.',
    noFiles: 'This Bundle has no readable files.',
    resources: 'Resources',
    resourcesNone: 'none',
    tabMindset: 'Kit Files',
    tabRelations: 'KAG Relations',
    tabMounts: 'Bundles',
    noRelations: 'This Kit declares no relation extensions and uses only the Core vocabulary.',
    relationExtensionNote: 'Validated Kit extension · read-only preview. Versioned editing and publishing will be enabled with Studio authoring.',
    sourceFiles: 'Source Files',
    richToggle: 'Read',
    sourceToggle: 'Source',
    readOnlyWord: 'read-only',
    bytes: (count: number) => `${count} bytes`,
    schemaSummaryTitle: 'Schema Summary',
    propertiesTitle: 'Properties',
    requiredWord: 'required',
    optionalWord: 'optional',
    validationSummaryTitle: 'Validation Summary',
    validationRules: (rules: number, drivers: string) => `${rules} ${rules === 1 ? 'rule' : 'rules'} · drivers ${drivers}`,
    driversNone: 'none',
    panelProviderOwned: 'provider-owned',
    panelDeclarative: 'declarative',
    panelReadonly: 'readonly',
    panelPlaceholderSub: 'Provider-owned read-only rendering · Version 1.0 static declaration',
    requestFailed: 'Request failed',
    loading: 'Loading…',
  },
  zh: {
    kitsTitle: '设计套件',
    kitsContext: 'Studio 1.0 · 设计套件',
    kitsSubtitle: '管理领域方法与技能包挂载。',
    browseOfficialKits: '浏览官方设计套件',
    officialKitsHelp: '浏览官方设计套件：简介和获取指引（在新标签页打开）',
    bundlesTitle: '技能包',
    bundlesContext: 'Studio 1.0 · 技能包',
    bundlesSubtitle: '只读查看已安装技能包',
    searchPlaceholder: '搜索技能包…',
    kitContext: 'Studio 1.0 · Kit Workspace',
    bundleContext: 'Studio 1.0 · Bundle Workspace',
    officialReadonly: '官方内容只读 · Studio 1.0',
    readonlyBadge: '只读',
    versionBadge: (version: string) => `Version ${version}`,
    mountedBundlesLabel: '已挂载技能包',
    openWorkspace: '打开工作区',
    openInBundleWorkspace: '在技能包工作区打开',
    mountedBy: (kits: string) => `挂载于 ${kits}`,
    usedBy: (kits: string) => `被 ${kits} 使用`,
    noMountedBy: '无已安装设计套件',
    mountedInKits: '挂载于设计套件：',
    noKits: '暂无已安装的设计套件。',
    noBundles: '没有匹配的技能包。',
    noMounts: '该设计套件未挂载技能包。',
    noFiles: '该技能包没有可读文件。',
    resources: '资源',
    resourcesNone: '无',
    tabMindset: '设计套件文件',
    tabRelations: 'KAG 关系',
    tabMounts: '技能包',
    noRelations: '该 Kit 未声明关系扩展，仅使用 Core 关系词汇。',
    relationExtensionNote: '已校验的 Kit 扩展 · 当前只读预览；版本化编辑与发布将在 Studio 作者模式开放。',
    sourceFiles: '源文件',
    richToggle: '阅读',
    sourceToggle: '原文',
    readOnlyWord: '只读',
    bytes: (count: number) => `${count} 字节`,
    schemaSummaryTitle: 'Schema 摘要',
    propertiesTitle: '属性',
    requiredWord: '必填',
    optionalWord: '可选',
    validationSummaryTitle: '校验摘要',
    validationRules: (rules: number, drivers: string) => `${rules} 条规则 · 驱动 ${drivers}`,
    driversNone: '无',
    panelProviderOwned: 'provider 所有',
    panelDeclarative: '声明式',
    panelReadonly: '只读',
    panelPlaceholderSub: 'provider 所有的只读渲染 · 1.0 版静态声明',
    requestFailed: '请求失败',
    loading: '加载中…',
  },
} as const

function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

function lineNumbers(content: string): string {
  const count = content.split('\n').length
  const lines: string[] = []
  for (let index = 1; index <= count; index += 1) lines.push(String(index))
  return lines.join('\n')
}

/** Only a reading projection: the raw Mindset, including mount XML, stays intact. */
function mindsetBody(source: string): string {
  return splitFrontmatter(source).body.replace(/<design_skills\b[^>]*>[\s\S]*?<\/design_skills>/g, '').trim()
}

function StudioDialog({ title, children, close }: { title: string; children: ReactNode; close: () => void }): ReactElement {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close() } }, [])
  return <dialog ref={ref} className="ygd-studio-modal" onCancel={close} onClose={close} aria-label={title}>
    <header><h2>{title}</h2><button type="button" aria-label="Close" onClick={close}>×</button></header>
    {children}
  </dialog>
}

function StudioGlyph({ bundle = false }: { bundle?: boolean }): ReactElement {
  return <span className="ygd-studio-kitmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
    {bundle ? <><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9" /></> : <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>}
  </svg></span>
}

function draftMatches(record: StudioPanelDraftRecord, kit?: DesignKitVersionPin, bundle?: DesignBundleVersionPin): boolean {
  return !!kit && !!bundle && record.kit.name === kit.name && record.kit.version === kit.version
    && record.bundle.name === bundle.name && record.bundle.version === bundle.version
}

function InstalledPreview({ authoring, client, kit, bundle, locale, declarative, onDirtyChange, onRecord }: { authoring?: StudioAuthoring; client: StudioManagementClient; kit?: DesignKitVersionPin; bundle: DesignBundleVersionPin; locale: StudioLocale; declarative: boolean; onDirtyChange: (dirty: boolean) => void; onRecord: (record: StudioPanelDraftRecord) => void }): ReactElement {
  const [result, setResult] = useState<StudioPanelPreviewResult>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [panelSource, setPanelSource] = useState<string>(), [record, setRecord] = useState<StudioPanelDraftRecord>()
  const editedSource = useRef<string>(), installedSource = useRef<string>(), creatingDraft = useRef(false)
  const sourceInput = useRef<HTMLTextAreaElement>(null), initialSelection = useRef<{ start: number; end: number }>()
  const [recoverableId, setRecoverableId] = useState<string>()
  const restoreRequest = useRef(0)
  const callbacks = useRef({ onDirtyChange, onRecord }); callbacks.current = { onDirtyChange, onRecord }
  const request = useRef(0)
  // Optional transport: a read-only preview must never manufacture a saved draft.
  const previewInstalled = authoring?.client.previewInstalled
  const preview = async (sampleSource?: string) => {
    if (!previewInstalled) return
    const revision = ++request.current
    setBusy(true); setError(''); setResult(undefined)
    try {
      const value = await previewInstalled({ kit, bundle, revision, ...(sampleSource === undefined ? {} : { sampleSource }) })
      if (revision !== request.current) return
      if (value.preview && (value.preview.kit?.name !== kit?.name || value.preview.kit?.version !== kit?.version || value.preview.bundle.name !== bundle.name || value.preview.bundle.version !== bundle.version || value.preview.revision !== revision)) throw new Error('Preview identity mismatch')
      setResult(value)
    } catch (failure) { if (revision === request.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (revision === request.current) setBusy(false) }
  }
  useEffect(() => { void preview(); return () => { ++request.current } }, [previewInstalled, kit?.name, kit?.version, bundle.name, bundle.version])
  useEffect(() => {
    let current = true
    if (declarative) void client.readBundleFile({ name: bundle.name, version: bundle.version, path: 'panel.yaml' }).then(value => {
      if (!current) return
      if (!value.file || value.file.path !== 'panel.yaml') throw new Error('Panel source is unavailable')
      installedSource.current = value.file.content; setPanelSource(value.file.content)
    }).catch(failure => { if (current) setError(String(failure instanceof Error ? failure.message : failure)) })
    return () => { current = false; callbacks.current.onDirtyChange(false) }
  }, [client, bundle.name, bundle.version, declarative])
  useEffect(() => {
    let current = true
    if (authoring && kit && declarative) void authoring.client.list().then(records => {
      if (!current) return
      const matches = records.filter(value => !value.confirmed && value.kit.name === kit.name && value.kit.version === kit.version && value.bundle.name === bundle.name && value.bundle.version === bundle.version)
      // Never arbitrarily choose among several independently retained drafts.
      setRecoverableId(matches.length === 1 ? matches[0].id : undefined)
    }).catch(() => {})
    return () => { current = false }
  }, [authoring, kit?.name, kit?.version, bundle.name, bundle.version, declarative])
  const restore = async () => {
    if (!authoring || !recoverableId || !kit || creatingDraft.current) return
    const revision = request.current, operation = ++restoreRequest.current, id = recoverableId
    try {
      const value = await authoring.client.read(id)
      if (revision !== request.current || operation !== restoreRequest.current) return
      if (value.id !== id || !draftMatches(value, kit, bundle)) throw new Error('Draft identity mismatch')
      editedSource.current = undefined; initialSelection.current = undefined
      setRecord(value); callbacks.current.onRecord(value)
    } catch (failure) { if (revision === request.current && operation === restoreRequest.current) setError(String(failure instanceof Error ? failure.message : failure)) }
  }
  const editSource = (source: string) => {
    // Continued typing wins over a pending explicit recovery read. It must
    // still retain every keystroke while the first draft creation is pending.
    ++restoreRequest.current
    editedSource.current = source; setPanelSource(source); callbacks.current.onDirtyChange(source !== installedSource.current)
    if (source === installedSource.current) return
    if (!authoring || !kit || !result?.preview || creatingDraft.current) return
    creatingDraft.current = true; setError('')
    const revision = request.current
    void authoring.client.create({ kit, bundle, sampleSource: JSON.stringify(result.preview.sample) }).then(value => {
      if (revision !== request.current) return
      if (value.kit.name !== kit.name || value.kit.version !== kit.version || value.bundle.name !== bundle.name || value.bundle.version !== bundle.version) throw new Error('Draft identity mismatch')
      const input = sourceInput.current
      if (input && document.activeElement === input) initialSelection.current = { start: input.selectionStart, end: input.selectionEnd }
      setRecord(value); callbacks.current.onRecord(value)
    }).catch(failure => { if (revision === request.current) { creatingDraft.current = false; setError(String(failure instanceof Error ? failure.message : failure)) } })
  }
  const editorGeneration = request.current
  if (record && authoring) return <PanelDraftEditor key={`${record.id}:${record.revision}`} record={record} authoring={authoring} locale={locale} initialPanelSource={editedSource.current} initialSelection={initialSelection.current} onDirtyChange={onDirtyChange} onRecord={value => {
    // A completed CAS save stays durable, but a receipt from a closed preview
    // must never switch a different Bundle's current trial source.
    if (editorGeneration !== request.current || value.id !== record.id || !draftMatches(value, kit, bundle)) return
    editedSource.current = undefined; initialSelection.current = undefined; setRecord(value); callbacks.current.onRecord(value)
  }} />
  const rendered = <>
    {!previewInstalled ? <p className="ygd-studio-empty">{locale === 'zh' ? '此宿主暂未提供已安装面板的只读预览。' : 'This host does not provide installed Panel previews.'}</p> : <>
      {busy && <LoadingIndicator label={locale === 'zh' ? '正在加载预览' : 'Loading preview'} />}
      {error && <p role="alert">{error}</p>}
      {result?.diagnostics.map((diagnostic, index) => <p role="status" key={index}>{locale === 'zh' && diagnostic.code === 'preview.sample_missing' ? '此 Bundle 尚未提供预览样例。作者可添加 reference/preview.json。预览不会读取项目数据。' : diagnostic.message}</p>)}
      {result?.preview && authoring?.renderPreview(result.preview, () => {}, { readOnly: false, toolbarTarget: null })}
    </>}
  </>
  return <section className="ygd-studio-panel-split">
    <section className="ygd-studio-yaml-pane">
      <header><strong>panel.yaml</strong><span>{locale === 'zh' ? '编辑将使用本地副本' : 'Edits use a local copy'}</span>{recoverableId && <button className="ygd-studio-btn-secondary" type="button" onClick={() => void restore()}>{locale === 'zh' ? '继续编辑副本' : 'Continue local copy'}</button>}</header>
      {panelSource === undefined ? declarative ? error ? null : <LoadingIndicator label={locale === 'zh' ? '正在读取面板定义' : 'Loading Panel definition'} /> : <p className="ygd-studio-empty">{locale === 'zh' ? '此面板由原生组件提供，没有可编辑的 panel.yaml。' : 'This native Panel has no editable panel.yaml.'}</p>
        : <textarea ref={sourceInput} aria-label="Panel YAML" spellCheck={false} value={panelSource} readOnly={!authoring || !kit || !result?.preview} onChange={event => editSource(event.currentTarget.value)} />}
      {error && <p role="alert">{error}</p>}
    </section>
    <section className="ygd-studio-live-pane"><div className="ygd-studio-live-pane-body">{rendered}</div></section>
  </section>
}

/** Read-only Studio surface: one complete page with global nav, sidebar, and workspace main. */
export function StudioWorkspace({ client, controller: supplied, authoring, kitAuthoring, trials, instances, componentLibrary, renderSelect, contentClient, onDraftDirtyChange, locale: hostLocale, onLocaleChange }: StudioWorkspaceProps): ReactElement {
  const controller = useMemo(() => supplied ?? new StudioWorkspaceController(client), [client, supplied])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const tabElements = useRef(new Map<StudioKitWorkspaceTab, HTMLButtonElement>())
  useEffect(() => { if (snapshot.phase === 'idle') void controller.load('') }, [controller, snapshot.phase])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [componentsOpen, setComponentsOpen] = useState(false)
  const [mindsetMode, setMindsetMode] = useState<DocViewMode>('rich')
  const [fileMode, setFileMode] = useState<DocViewMode>('rich')
  const [bundleTab, setBundleTab] = useState<'files' | 'preview'>('files')
  const [previewMode, setPreviewMode] = useState<'sample' | 'trial'>('sample')
  const [previewOpened, setPreviewOpened] = useState(false)
  const [panelDraft, setPanelDraft] = useState<StudioPanelDraftRecord>()
  const previewOwner = useRef<{ kit?: DesignKitVersionPin; bundle?: DesignBundleVersionPin }>({})
  const launchTrial = useRef<(() => void) | undefined>()
  const [trialTarget, setTrialTarget] = useState<HTMLDivElement | null>(null)
  const [fullMindset, setFullMindset] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [fileLocationOpen, setFileLocationOpen] = useState(false)
  const [mountsOpen, setMountsOpen] = useState(false)
  const [mountQuery, setMountQuery] = useState('')
  const [kitFilesOpen, setKitFilesOpen] = useState(false)
  const [toc, setToc] = useState<readonly string[]>([])
  const mindsetDocument = useRef<HTMLDivElement>(null)
  const [draftsOpen, setDraftsOpen] = useState<false | 'panel' | 'kit'>(false)
  const [archivesOpen, setArchivesOpen] = useState(false)
  const createGeneration = useRef(0)
  const [draftId, setDraftId] = useState<string>()
  const draftDirty = useRef(false)
  const panelDirty = useRef(false), trialDirty = useRef(false)
  const reportPreviewDirty = (kind: 'panel' | 'trial', value: boolean) => {
    if (kind === 'panel') panelDirty.current = value; else trialDirty.current = value
    draftDirty.current = panelDirty.current || trialDirty.current
    onDraftDirtyChange?.(draftDirty.current)
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (draftDirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  const [creating, setCreating] = useState(false)
  const [authoringError, setAuthoringError] = useState('')
  const [localInstances, setLocalInstances] = useState<readonly StudioInstance[]>([])
  const [instanceId, setInstanceId] = useState<string>()
  const refreshInstances = async () => { if (instances) setLocalInstances(await instances.list()) }
  useEffect(() => {
    let live = true
    if (instances) void instances.list().then(records => { if (live) setLocalInstances(records) }).catch(error => { if (live) setAuthoringError(String(error)) })
    return () => { live = false }
  }, [instances])
  const [localLocale, setLocalLocale] = useState<StudioLocale>()
  useEffect(() => { setLocalLocale(undefined) }, [hostLocale])
  const locale = localLocale ?? hostLocale ?? detectLocale()
  const changeLocale = (next: StudioLocale) => { if (onLocaleChange) onLocaleChange(next); else setLocalLocale(next) }
  const t = STRINGS[locale]
  const workspace = snapshot.kitWorkspace
  const mindsetRecords = useRef(new Map<string, string>())
  const [savedMindsets, setSavedMindsets] = useState<Record<string, string>>({})
  const [mindsetChoices, setMindsetChoices] = useState<readonly { id: string; revision: number }[]>([])
  const [mindsetEditorEpoch, setMindsetEditorEpoch] = useState(0)
  const kitKey = workspace ? `${workspace.name}@${workspace.version}` : ''
  const visibleMindset = savedMindsets[kitKey] ?? workspace?.mindsetSource ?? ''
  useEffect(() => {
    let active = true
    setMindsetChoices([])
    if (kitAuthoring && workspace) void kitAuthoring.client.list().then(records => {
      if (active) setMindsetChoices(previous => [...new Map([
        ...records.filter(record => !record.confirmed && record.baseKit.name === workspace.name && record.baseKit.version === workspace.version).map(record => [record.id, record] as const),
        ...previous.map(record => [record.id, record] as const),
      ]).values()])
    }).catch(error => { if (active) setAuthoringError(String(error)) })
    return () => { active = false }
  }, [kitAuthoring, kitKey])
  const bundleWorkspace = snapshot.bundleWorkspace
  const bundleTitle = (name: string, version: string) => snapshot.view?.bundles.find(bundle => bundle.name === name && bundle.version === version)?.title?.[locale] ?? displayName(name)
  const bundleFile = snapshot.bundleFile
  useEffect(() => { setBundleTab('files'); setPreviewMode('sample'); setPreviewOpened(false); setPanelDraft(undefined); setMountsOpen(false) }, [bundleWorkspace?.name, bundleWorkspace?.version])
  useEffect(() => { setFullMindset(false); setKitFilesOpen(false) }, [workspace?.name, workspace?.version])
  useEffect(() => {
    const headings = [...(mindsetDocument.current?.querySelectorAll('h1,h2,h3') ?? [])]
    headings.forEach((heading, index) => { heading.id = `studio-mindset-heading-${index}` })
    setToc(headings.map(heading => heading.textContent ?? ''))
  }, [visibleMindset, mindsetMode, snapshot.kitTab, bundleWorkspace, draftsOpen])
  useEffect(() => { createGeneration.current++ }, [workspace?.name, workspace?.version, bundleWorkspace?.name, bundleWorkspace?.version])
  const leaveDrafts = (next: () => void) => {
    if (draftDirty.current && !window.confirm(locale === 'zh' ? '离开会丢失尚未保存的修改，继续吗？' : 'Discard unsaved changes and leave?')) return
    createGeneration.current++; panelDirty.current = false; trialDirty.current = false; draftDirty.current = false; onDraftDirtyChange?.(false); setDraftsOpen(false); setArchivesOpen(false); setInstanceId(undefined); setSidebarOpen(false); next()
  }
  const copyInstalled = async (kind: 'kit' | 'bundle', kit?: DesignKitVersionPin, bundle?: DesignBundleVersionPin) => {
    if (!instances || creating) return
    if (draftDirty.current && !window.confirm(locale === 'zh' ? '放弃未保存修改并复制？' : 'Discard unsaved edits and duplicate?')) return
    const request = ++createGeneration.current
    setCreating(true); setAuthoringError('')
    try {
      const record = await instances.copy({ kind, kit, ...(bundle ? { bundle } : {}) })
      await refreshInstances()
      if (request !== createGeneration.current) return
      draftDirty.current = false; onDraftDirtyChange?.(false); setInstanceId(record.id)
    } catch (error) { setAuthoringError(String(error)) }
    finally { setCreating(false) }
  }
  const copyMenu = (kind: 'kit' | 'bundle', kit?: DesignKitVersionPin, bundle?: DesignBundleVersionPin) => instances && <button type="button" className="ygd-studio-btn-secondary" disabled={creating} onClick={() => { void copyInstalled(kind, kit, bundle) }}>{locale === 'zh' ? '复制' : 'Copy'}</button>
  const bundleCopyMenu = (bundle: DesignBundleVersionPin) => {
    return copyMenu('bundle', undefined, bundle)
  }
  const localCards = (kind: 'kit' | 'bundle') => localInstances.filter(record => record.kind === kind && (!snapshot.bundleQuery || kind === 'kit' || Object.values(record.title).some(title => title.toLowerCase().includes(snapshot.bundleQuery.toLowerCase())))).map(record => <article key={record.id} className="ygd-studio-kit-card">
    <div className="ygd-studio-card-top"><StudioGlyph bundle={kind === 'bundle'} /><span className="ygd-studio-card-pill">{locale === 'zh' ? '本地副本' : 'Local copy'}</span></div>
    <h3 className="ygd-studio-kit-card-name">{record.title[locale]}</h3>
    <div className="ygd-studio-card-description">{renderStudioMarkdown(record.displayDescription?.[locale] ?? record.description ?? '')}</div>
    <p className="ygd-studio-card-meta">{locale === 'zh' ? '可编辑 · 未发布' : 'Editable · unpublished'}</p>
    <div className="ygd-studio-kit-card-actions"><button type="button" className="ygd-studio-btn-secondary" onClick={() => leaveDrafts(() => setInstanceId(record.id))}>{locale === 'zh' ? '打开 →' : 'Open →'}</button></div>
  </article>)
  // A Kit can provide execution context without owning the Bundle source.
  const bundleContextKit = () => {
    if (!bundleWorkspace) return undefined
    const entry = snapshot.view?.bundles.find(item => item.name === bundleWorkspace.name && item.version === bundleWorkspace.version)
    const candidates = entry?.usedBy ?? snapshot.view?.kits.filter(kit => kit.name === bundleWorkspace.kit) ?? []
    if (workspace && candidates.some(pin => pin.name === workspace.name && pin.version === workspace.version)) return workspace
    return candidates.length === 1 ? candidates[0] : undefined
  }
  previewOwner.current = { kit: bundleContextKit(), bundle: bundleWorkspace }
  const receivePanelDraft = (record: StudioPanelDraftRecord) => {
    if (draftMatches(record, previewOwner.current.kit, previewOwner.current.bundle)) setPanelDraft(record)
  }
  useEffect(() => () => { createGeneration.current++ }, [])
  // Each opened document starts on its own default view: markdown rich, everything else source.
  useEffect(() => {
    if (bundleFile !== undefined) setFileMode(isMarkdownPath(bundleFile.path) ? 'rich' : 'source')
  }, [bundleFile?.path])

  const bundleCountByKit = new Map<string, number>()
  for (const bundle of snapshot.view?.bundles ?? []) {
    for (const kit of bundle.usedBy) {
      const key = `${kit.name}\u0000${kit.version}`
      bundleCountByKit.set(key, (bundleCountByKit.get(key) ?? 0) + 1)
    }
  }
  const bundleQuery = snapshot.bundleQuery.trim().toLowerCase()
  const listedBundles = (snapshot.view?.bundles ?? []).filter((bundle) => bundleQuery === ''
    || bundle.name.toLowerCase().includes(bundleQuery)
    || bundle.description.toLowerCase().includes(bundleQuery))

  const switchTab = (id: StudioKitWorkspaceTab): void => {
    if (snapshot.kitTab === id) { tabElements.current.get(id)?.focus(); return }
    leaveDrafts(() => { controller.setKitTab(id); tabElements.current.get(id)?.focus() })
  }

  const tab = (id: StudioKitWorkspaceTab, label: string): ReactElement => {
    const selected = snapshot.kitTab === id
    return (
      <button
        className="ygd-studio-workplane-tab"
        type="button"
        role="tab"
        id={`ygd-studio-tab-${id}`}
        aria-selected={selected}
        aria-controls={TABPANEL_ID}
        tabIndex={selected ? 0 : -1}
        ref={(element) => { if (element === null) tabElements.current.delete(id); else tabElements.current.set(id, element) }}
        onClick={() => { if (!selected) switchTab(id) }}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          const index = KIT_TABS.indexOf(id)
          let target: StudioKitWorkspaceTab | undefined
          if (event.key === 'ArrowRight') target = KIT_TABS[(index + 1) % KIT_TABS.length]
          else if (event.key === 'ArrowLeft') target = KIT_TABS[(index + KIT_TABS.length - 1) % KIT_TABS.length]
          else if (event.key === 'Home') target = KIT_TABS[0]
          else if (event.key === 'End') target = KIT_TABS[KIT_TABS.length - 1]
          else return
          event.preventDefault()
          switchTab(target)
        }}
      >
        {label}
      </button>
    )
  }

  const diagnostics = <>
    {snapshot.phase === 'loading' && <LoadingIndicator label={t.loading} />}
    {snapshot.failure !== undefined && <div className="ygd-studio-diagnostics" role="alert">
      <strong>{t.requestFailed}</strong>: {snapshot.failure.message}
    </div>}
    {snapshot.diagnostics.length > 0 && <ul className="ygd-studio-diagnostics" aria-label="Validation diagnostics">
      {snapshot.diagnostics.map((entry, index) => <li key={`${entry.code}:${index}`}><strong>{entry.code}</strong>: {entry.message}</li>)}
    </ul>}
  </>

  const codeFrame = (content: string, ariaLabel: string): ReactElement => (
    <div className="ygd-studio-code-frame">
      <div className="ygd-studio-code-scroll">
        <div className="ygd-studio-code-view">
          <div className="ygd-studio-line-numbers" aria-hidden="true">{lineNumbers(content)}</div>
          <pre className="ygd-studio-code-body" aria-label={ariaLabel}>{content}</pre>
        </div>
      </div>
    </div>
  )

  const docToggle = (mode: DocViewMode, select: (mode: DocViewMode) => void, _byteCount: number, actions?: ReactNode): ReactElement => (
    <div className="ygd-studio-doc-toolbar">
      <div className="ygd-studio-file-heading"><strong className="ygd-studio-document-name">{bundleWorkspace ? bundleFile?.path : 'mindset.md'}</strong><FilePurpose path={bundleWorkspace ? bundleFile?.path : 'mindset.md'} locale={locale} /></div>
      <div className="ygd-studio-doc-toggle-group">
        {(!bundleFile || isMarkdownPath(bundleFile.path)) && <button className="ygd-studio-doc-toggle" type="button" aria-pressed={mode === 'rich'} onClick={() => select('rich')}>{t.richToggle}</button>}
        <button className="ygd-studio-doc-toggle" type="button" aria-pressed={mode === 'source'} onClick={() => select('source')}>{t.sourceToggle}</button>
      </div>
      {actions}
      <button className="ygd-studio-btn-link" type="button" onClick={() => setFileLocationOpen(true)}>{locale === 'zh' ? '文件位置' : 'File location'}</button>
    </div>
  )

  const docFooter = (content: string, draft: boolean): ReactElement => <footer className="ygd-studio-doc-footer">
    <span>{locale === 'zh' ? '完整文件' : 'Complete file'} · {t.bytes(new TextEncoder().encode(content).length)}</span>
    {!bundleWorkspace && kitAuthoring && mindsetChoices.length > 0 && <button type="button" className="ygd-studio-btn-link" onClick={() => setRecoveryOpen(true)}>{locale === 'zh' ? '恢复工作副本' : 'Restore working copy'}</button>}
    <span>{draft ? locale === 'zh' ? '工作副本 · 未发布' : 'Working copy · unpublished' : locale === 'zh' ? '已安装内容' : 'Installed content'}</span>
  </footer>

  const markdownDoc = (source: string, ariaLabel: string): ReactElement => renderStudioDocument(source, { locale, ariaLabel })

  /** Bundle descriptions are authored as Markdown lists; cards render the same safe subset. */
  const cardDescription = (description: string): ReactElement => (
    <div className="ygd-studio-card-description">{renderStudioMarkdown(description)}</div>
  )
  const installedStatus = <span className="ygd-studio-installed-status" title={locale === 'zh' ? '已安装内容受保护，复制后可以编辑。' : 'Installed content is protected. Make a copy to edit.'}>{locale === 'zh' ? '已安装 · 只读' : 'Installed · read-only'}</span>

  const bundleMain = bundleWorkspace === undefined ? undefined : <main className="ygd-studio-main ygd-studio-bundle-main">
    <header className="ygd-studio-content-header">
      <div>
        <div className="ygd-studio-header-title-group">
          <button type="button" className="ygd-studio-back" aria-label={locale === 'zh' ? '返回' : 'Back'} title={locale === 'zh' ? '返回' : 'Back'} onClick={() => leaveDrafts(() => controller.closeBundleWorkspace())}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg></button>
          <StudioGlyph bundle />
          <h1 className="ygd-studio-page-title">{bundleTitle(bundleWorkspace.name, bundleWorkspace.version)}</h1>
          <label>{locale === 'zh' ? '版本 ' : 'Version '}<StudioSelect aria-label={locale === 'zh' ? 'Bundle 版本' : 'Bundle version'} value={bundleWorkspace.version}
            onValueChange={version => leaveDrafts(() => void controller.openBundleWorkspace(bundleWorkspace.name, version))}
            options={groupInstalledContent(snapshot.view?.bundles ?? []).find(group => group.name === bundleWorkspace.name)?.versions
              .map(bundle => ({ value: bundle.version, label: bundle.version })) ?? []} /></label>
        </div>
        <div className="ygd-studio-hero-actions">
        {installedStatus}
        <button className="ygd-studio-btn-secondary" type="button" aria-expanded={mountsOpen} onClick={() => setMountsOpen(!mountsOpen)}>{locale === 'zh' ? '挂载管理' : 'Mount management'}</button>
        {bundleCopyMenu(bundleWorkspace)}
        <button type="button" className="ygd-studio-btn-primary" disabled={!trials || !bundleContextKit()} aria-pressed={bundleTab === 'preview' && previewMode === 'trial'} onClick={() => {
          if (panelDirty.current) { setAuthoringError(locale === 'zh' ? '请先保存左侧的面板修改，再试运行。' : 'Save the Panel changes before starting a trial.'); return }
          setAuthoringError(''); launchTrial.current?.()
        }}>{locale === 'zh' ? '试运行' : 'Trial run'}</button>
        {trials && (() => {
          const kit = bundleContextKit()
          return kit && <BundleTrial key={`${kit.name}:${bundleWorkspace.name}:${bundleWorkspace.version}`} client={trials} locale={locale} launchRef={launchTrial} target={trialTarget} onDirtyChange={value => reportPreviewDirty('trial', value)} visible={bundleTab === 'preview' && previewMode === 'trial'} onOpen={() => { setBundleTab('preview'); setPreviewMode('trial') }} source={panelDraft && draftMatches(panelDraft, kit, bundleWorkspace) ? { kind: 'panel-draft', id: panelDraft.id, expectedRevision: panelDraft.revision, kit: panelDraft.kit, bundle: panelDraft.bundle } : { kind: 'installed', kit: { name: kit.name, version: kit.version }, bundle: { name: bundleWorkspace.name, version: bundleWorkspace.version } }} />
        })()}
        </div>
        {authoringError && <p role="alert">{authoringError}</p>}
      </div>
    </header>
    {mountsOpen && <StudioDialog title={`${locale === 'zh' ? '挂载管理' : 'Mount Management'} · ${bundleWorkspace.name}`} close={() => setMountsOpen(false)}>
      <BundleMounts client={instances} bundle={bundleWorkspace} installed={snapshot.view?.bundles.find(bundle => bundle.name === bundleWorkspace.name && bundle.version === bundleWorkspace.version)?.usedBy ?? []} locale={locale} />
    </StudioDialog>}
    <div className="ygd-studio-workplane-bar" aria-label="Bundle content">
      <button className="ygd-studio-workplane-tab" type="button" aria-pressed={bundleTab === 'files'} onClick={() => setBundleTab('files')}>{locale === 'zh' ? '原始文件' : 'Source Files'}</button>
      <button className="ygd-studio-workplane-tab" type="button" aria-pressed={bundleTab === 'preview' && previewMode === 'sample'} onClick={() => { setBundleTab('preview'); setPreviewMode('sample'); setPreviewOpened(true) }}>{locale === 'zh' ? '面板预览' : 'Panel Preview'}</button>
    </div>
    <div className="ygd-studio-workspace-body ygd-studio-files-layout" hidden={bundleTab !== 'files'}>
      <aside className="ygd-studio-file-tree-pane" aria-label="Bundle source files">
        <div className="ygd-studio-file-tree-header">{locale === 'zh' ? '全部文件' : 'All Files'} · {bundleWorkspace.files.length}</div>
        <FileExplorer key={bundleWorkspace.name} paths={bundleWorkspace.files.map(file => file.path)} selected={bundleFile?.path} openFile={path => void controller.openBundleFile(path)} />
      </aside>
      <div className="ygd-studio-content-pane">
        {diagnostics}
        {bundleFile && <>
          {docToggle(isMarkdownPath(bundleFile.path) ? fileMode : 'source', setFileMode, new TextEncoder().encode(bundleFile.content).length)}
          <div className="ygd-studio-document-body">
            {isMarkdownPath(bundleFile.path) && fileMode === 'rich'
              ? markdownDoc(bundleFile.content, 'Bundle file source')
              : codeFrame(bundleFile.content, 'Bundle file source')}
          </div>
          {docFooter(bundleFile.content, false)}
        </>}
      </div>
      <FileInfoSidebar kind="bundle" description={bundleWorkspace.displayDescription?.[locale] ?? bundleWorkspace.description} locale={locale} />
    </div>

    <div className="ygd-studio-trial-slot" ref={setTrialTarget} hidden={bundleTab !== 'preview' || previewMode !== 'trial'} />
    {previewOpened && <div className="ygd-studio-preview-slot" hidden={bundleTab !== 'preview' || previewMode !== 'sample'}><InstalledPreview key={`${bundleWorkspace.name}@${bundleWorkspace.version}`} client={client} authoring={authoring} locale={locale} bundle={{ name: bundleWorkspace.name, version: bundleWorkspace.version }} kit={bundleContextKit()} declarative={bundleWorkspace.panel?.kind === 'declarative'} onDirtyChange={value => reportPreviewDirty('panel', value)} onRecord={receivePanelDraft} /></div>}
  </main>

  const bundleCard = (bundle: { name: string; version: string; description: string; title?: Readonly<{ zh: string; en: string }>; displayDescription?: Readonly<{ zh: string; en: string }> }, uses: number, inKit = false): ReactElement => <article className="ygd-studio-kit-card ygd-studio-bundle-card" key={`${bundle.name}@${bundle.version}`}>
    <div className="ygd-studio-card-top"><StudioGlyph bundle /><span className="ygd-studio-card-pill">{inKit ? locale === 'zh' ? '引用挂载' : 'Mounted reference' : `${uses} Kit`}</span></div>
    <h3 className="ygd-studio-kit-card-name">{bundle.title?.[locale] ?? displayName(bundle.name)}</h3>
    <div className="ygd-studio-source-id">{bundle.name}</div>
    {cardDescription(bundle.displayDescription?.[locale] ?? bundle.description)}
    <div className="ygd-studio-kit-card-actions">
      <button className="ygd-studio-btn-secondary ygd-studio-btn-soft" type="button" onClick={() => void controller.openBundleWorkspace(bundle.name, bundle.version)}>{locale === 'zh' ? '打开 →' : 'Open →'}</button>
      {bundleCopyMenu(bundle)}
      {!inKit && <button className="ygd-studio-btn-link" type="button" onClick={() => { void controller.openBundleWorkspace(bundle.name, bundle.version).then(() => setMountsOpen(true)) }}>{locale === 'zh' ? '查看挂载' : 'View mounts'}</button>}
    </div>
  </article>

  const bundlesListMain = <main className="ygd-studio-main">
    <header className="ygd-studio-content-header">
      <div>
        <div className="ygd-studio-header-title-group">
          <h1 className="ygd-studio-page-title">{t.bundlesTitle}</h1>


        </div>
        <p className="ygd-studio-subtitle">{t.bundlesSubtitle}</p>
      </div>
    </header>
    <div className="ygd-studio-content-body">
      {diagnostics}
      <div className="ygd-studio-filter-row"><span>{groupInstalledContent(listedBundles).length} {t.bundlesTitle}</span>
        <input
          className="ygd-studio-search-input"
          type="search"
          value={snapshot.bundleQuery}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchPlaceholder}
          onChange={(event) => controller.setBundleQuery(event.currentTarget.value)}
        />
      </div>
      {listedBundles.length === 0 && <div className="ygd-studio-empty">{t.noBundles}</div>}
      <div className="ygd-studio-kits-grid" aria-label="Catalog Bundles">
        {localCards('bundle')}
        {groupInstalledContent(listedBundles).map(({ latest: bundle, versions }) => bundleCard(bundle,
          new Set(versions.flatMap(version => version.usedBy.map(kit => `${kit.name}@${kit.version}`))).size))}
      </div>
    </div>
  </main>

  const mindsetDocumentView = (actions?: ReactNode, editor?: ReactNode, editing = false): ReactElement => <article className="ygd-studio-document-card">
    {docToggle(mindsetMode, setMindsetMode, 0, actions)}
    <div className="ygd-studio-mindset-document" ref={mindsetDocument}>
      {editing ? <div className="ygd-studio-mindset-inline">{editor}</div> : <>
        {editor}
        {mindsetMode === 'rich' ? markdownDoc(mindsetBody(visibleMindset), 'Mindset source') : codeFrame(mindsetBody(visibleMindset), 'Mindset body source')}
      </>}
    </div>
    {docFooter(visibleMindset, !!mindsetRecords.current.get(kitKey))}
  </article>

  const kitMain = workspace === undefined ? <main className="ygd-studio-main">
    <header className="ygd-studio-content-header">
      <div>
        <div className="ygd-studio-header-title-group">
          <h1 className="ygd-studio-page-title">{t.kitsTitle}</h1>
        </div>
        <p className="ygd-studio-subtitle">{t.kitsSubtitle}</p>
        <a className="ygd-studio-btn-link ygd-studio-catalog-link" href={OFFICIAL_KITS_URL} target="_blank" rel="noopener noreferrer" title={t.officialKitsHelp} aria-label={t.officialKitsHelp}>
          {t.browseOfficialKits}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" /></svg>
        </a>
      </div>
    </header>
    <div className="ygd-studio-content-body">
      {diagnostics}
      {snapshot.view?.kits.length === 0 && <div className="ygd-studio-empty">{t.noKits}</div>}
      <div className="ygd-studio-kits-grid" aria-label="Installed Kits">
        {localCards('kit')}
        {groupInstalledContent(snapshot.view?.kits ?? []).map(({ latest: kit }) => {
          const bundleCount = bundleCountByKit.get(`${kit.name}\u0000${kit.version}`) ?? 0
          return (
            <article className="ygd-studio-kit-card ygd-studio-library-card" key={`${kit.name}@${kit.version}`}>
              <div className="ygd-studio-card-top"><StudioGlyph /><span className="ygd-studio-card-pill">{locale === 'zh' ? '已安装套件' : 'Installed kit'}</span></div>
              <h2 className="ygd-studio-kit-card-name">{displayName(kit.name)}</h2>
              <div className="ygd-studio-source-id">{kit.name}</div>
              {cardDescription(kit.displayDescription?.[locale] ?? kit.description ?? '')}
              <p className="ygd-studio-card-meta">{bundleCount} {locale === 'zh' ? '个技能包' : 'bundles'}</p>
              <div className="ygd-studio-kit-card-actions">
                <button className="ygd-studio-btn-secondary ygd-studio-btn-soft" type="button" onClick={() => void controller.selectKit(kit.name, kit.version)}>{locale === 'zh' ? '打开 →' : 'Open →'}</button>
                {copyMenu('kit', kit)}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  </main> : <main className="ygd-studio-main">
    <header className="ygd-studio-content-header">
      <div>
        <div className="ygd-studio-header-title-group">
          <button type="button" className="ygd-studio-back" aria-label={locale === 'zh' ? '返回' : 'Back'} title={locale === 'zh' ? '返回' : 'Back'} onClick={() => leaveDrafts(() => controller.backToList())}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg></button>
          <StudioGlyph />
          <h1 className="ygd-studio-page-title">{displayName(workspace.name)}</h1>
          <label>{locale === 'zh' ? '版本 ' : 'Version '}<StudioSelect aria-label={locale === 'zh' ? 'Kit 版本' : 'Kit version'} value={workspace.version}
            onValueChange={version => leaveDrafts(() => void controller.selectKit(workspace.name, version))}
            options={groupInstalledContent(snapshot.view?.kits ?? []).find(group => group.name === workspace.name)?.versions
              .map(kit => ({ value: kit.version, label: kit.version })) ?? []} /></label>
        </div>
        <div className="ygd-studio-hero-actions">
        {installedStatus}
        {copyMenu('kit', workspace)}
        </div>
        {authoringError && <p role="alert">{authoringError}</p>}
      </div>
    </header>
    <div className="ygd-studio-workplane-bar" role="tablist" aria-label="Kit Workspace sections">
      {tab('mindset', t.tabMindset)}
      {tab('mounts', `${t.tabMounts} · ${workspace.mounts.length}`)}
    </div>
    <div className={`ygd-studio-content-body${snapshot.kitTab === 'mindset' ? ' ygd-studio-kit-files-body' : ''}`} role="tabpanel" id={TABPANEL_ID} aria-labelledby={`ygd-studio-tab-${snapshot.kitTab}`}>
      {diagnostics}
      {snapshot.kitTab === 'mounts'
        ? <>
          <div className="ygd-studio-filter-row"><span>{workspace.mounts.length} {t.bundlesTitle}</span><input className="ygd-studio-search-input" type="search" aria-label={t.searchPlaceholder} placeholder={t.searchPlaceholder} value={mountQuery} onChange={event => setMountQuery(event.currentTarget.value)} /></div>
          <div className="ygd-studio-bundles-list" aria-label="Mounted Bundles">
            {workspace.mounts.length === 0 && <div className="ygd-studio-empty">{t.noMounts}</div>}
            {workspace.mounts.filter(mount => `${mount.name} ${mount.description} ${mount.title?.[locale] ?? ''} ${mount.displayDescription?.[locale] ?? ''}`.toLowerCase().includes(mountQuery.toLowerCase())).map(mount => bundleCard(mount, mount.mountedBy.length, true))}
          </div>

        </>
        : <>
          <KitFiles key={kitKey} client={client} name={workspace.name} version={workspace.version} mindset={workspace.mindsetSource} description={workspace.displayDescription?.[locale] ?? workspace.description} locale={locale} canNavigate={() => !draftDirty.current || window.confirm(locale === 'zh' ? '放弃未保存的修改？' : 'Discard unsaved changes?')} renderMindset={kitAuthoring ? sourceToggle => <InlineMindset key={`${kitKey}:${mindsetEditorEpoch}`} authoring={kitAuthoring}
            kit={{ name: workspace.name, version: workspace.version }} installedSource={workspace.mindsetSource}
            initialId={mindsetRecords.current.get(kitKey)} locale={locale}
            onRecord={record => { mindsetRecords.current.set(kitKey, record.id); setMindsetChoices(previous => [...previous.filter(item => item.id !== record.id), { id: record.id, revision: record.revision }]) }}
            onSource={source => setSavedMindsets(previous => ({ ...previous, [kitKey]: source }))}
            onDirtyChange={value => { draftDirty.current = value; onDraftDirtyChange?.(value) }} renderContent={parts => <><div className="ygd-studio-doc-toolbar"><div className="ygd-studio-file-heading"><strong className="ygd-studio-document-name">mindset.md</strong><FilePurpose path="mindset.md" locale={locale} /></div><div className="ygd-studio-doc-toggle-group">{!parts.editing && sourceToggle}{parts.actions}</div></div><div className="ygd-studio-document-body">{parts.editing ? parts.editor : markdownDoc(mindsetBody(visibleMindset), 'Mindset source')}</div></>} /> : undefined} />
        </>}
    </div>
  </main>

  return <StudioSelectContext.Provider value={renderSelect}><section className="ygd-studio-workspace" aria-label="Design Studio">
    <style>{STUDIO_WORKSPACE_CSS}</style>
    <button className="ygd-studio-menu-btn" type="button" aria-label="Toggle menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
    <div className="ygd-studio-body">
      <aside className={`ygd-studio-sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Product navigation">
        <div className="ygd-studio-sidebar-logo">Yugoo Design</div>
        <nav className="ygd-studio-sidebar-nav" aria-label="Studio sections">
          <button className="ygd-studio-sidebar-item" type="button" aria-current={!componentsOpen && !archivesOpen && !draftsOpen && !bundleWorkspace && snapshot.section === 'kits' ? 'page' : undefined} onClick={() => leaveDrafts(() => { setComponentsOpen(false); controller.backToList() })}><StudioGlyph />{t.kitsTitle}</button>
          <button className="ygd-studio-sidebar-item" type="button" aria-current={!componentsOpen && !archivesOpen && !draftsOpen && (bundleWorkspace || snapshot.section === 'bundles') ? 'page' : undefined} onClick={() => leaveDrafts(() => { setComponentsOpen(false); controller.setSection('bundles') })}><StudioGlyph bundle />{t.bundlesTitle}</button>
        </nav>
        <div className="ygd-studio-sidebar-footer">{componentLibrary && <nav className="ygd-studio-sidebar-utilities" aria-label={locale === 'zh' ? 'Studio 工具' : 'Studio utilities'}><button className="ygd-studio-sidebar-item" type="button" aria-current={componentsOpen ? 'page' : undefined} onClick={() => leaveDrafts(() => setComponentsOpen(true))}><span className="ygd-studio-kitmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>{locale === 'zh' ? '面板组件库' : 'Panel Component Library'}</button></nav>}<div className="ygd-studio-language" role="group" aria-label={locale === 'zh' ? '界面语言' : 'Interface language'}>
          <button type="button" lang="zh-CN" aria-pressed={locale === 'zh'} onClick={() => changeLocale('zh')}>中文</button>
          <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}>EN</button>
        </div></div>
      </aside>
      <div className="ygd-studio-stage">
        <div className="ygd-studio-topbar"><span aria-label="Breadcrumb">
          <button className="ygd-studio-breadcrumb-button" type="button" onClick={() => { if (!componentsOpen) leaveDrafts(() => snapshot.section === 'kits' ? controller.backToList() : controller.closeBundleWorkspace()) }}>{componentsOpen ? (locale === 'zh' ? '面板组件库' : 'Panel Component Library') : snapshot.section === 'kits' ? t.kitsTitle : t.bundlesTitle}</button>
          {!componentsOpen && !archivesOpen && !instanceId && workspace && <><span aria-hidden="true">/</span>{bundleWorkspace ? <button className="ygd-studio-breadcrumb-button" type="button" onClick={() => leaveDrafts(() => controller.closeBundleWorkspace())}>{displayName(workspace.name)}</button> : <span aria-current="page">{displayName(workspace.name)}</span>}</>}
          {!componentsOpen && !archivesOpen && !instanceId && bundleWorkspace && <><span aria-hidden="true">/</span>{bundleTitle(bundleWorkspace.name, bundleWorkspace.version)}</>}
          {!componentsOpen && instanceId && <><span aria-hidden="true">/</span>{localInstances.find(record => record.id === instanceId)?.title[locale]}</>}
          {archivesOpen && <><span aria-hidden="true">/</span><span aria-current="page">{locale === 'zh' ? '内容归档' : 'Content archives'}</span></>}
        </span><div className="ygd-studio-topbar-actions">{contentClient && <button className="ygd-studio-btn-link" type="button" disabled={archivesOpen} onClick={() => leaveDrafts(() => { setComponentsOpen(false); setArchivesOpen(true) })}>{locale === 'zh' ? '内容归档' : 'Content archives'}</button>}{!componentsOpen && <button className="ygd-studio-btn-link" type="button" disabled={snapshot.phase === 'loading'} onClick={() => leaveDrafts(() => { void (async () => {
          await controller.load()
          await refreshInstances()
          if (workspace) await controller.selectKit(workspace.name, workspace.version)
          if (bundleWorkspace) { await controller.openBundleWorkspace(bundleWorkspace.name, bundleWorkspace.version); if (bundleFile) await controller.openBundleFile(bundleFile.path) }
        })() })}>{locale === 'zh' ? '刷新内容' : 'Refresh content'}</button>}</div></div>
        {componentsOpen && componentLibrary ? <ComponentLibrary library={componentLibrary} locale={locale} /> : <>
        {authoringError && <p role="alert" className="ygd-studio-error">{authoringError}</p>}
        {archivesOpen && contentClient ? <ContentArchiveWorkbench client={contentClient} installedKit={workspace ? { name: workspace.name, version: workspace.version } : undefined} locale={locale} canAdoptKit={!!kitAuthoring}
          onBack={() => leaveDrafts(() => {})}
          onAdopt={result => leaveDrafts(() => {
            if (result.draft && kitAuthoring) { setDraftId(result.draft.id); setDraftsOpen('kit'); void controller.load(); return }
            const bundle = result.contents.find(item => item.kind === 'bundle')
            if (!bundle) return
            const request = createGeneration.current
            void (async () => {
              await controller.load()
              if (request !== createGeneration.current || controller.getSnapshot().phase !== 'ready') return
              controller.setSection('bundles')
              await controller.openBundleWorkspace(bundle.pin.name, bundle.pin.version)
            })()
          })}
          onDirtyChange={value => { draftDirty.current = value; onDraftDirtyChange?.(value) }} />
          : snapshot.phase === 'loading' && !instanceId && !draftsOpen ? <main className="ygd-studio-main"><LoadingIndicator label={t.loading} /></main> : instanceId && instances ? <InstanceWorkbench key={instanceId} client={instances} id={instanceId} locale={locale} renderPreview={authoring?.renderPreview} onBack={() => leaveDrafts(() => controller.backToList())} onChanged={record => { setInstanceId(record?.id); void refreshInstances().catch(error => setAuthoringError(String(error))) }} onDirtyChange={value => { draftDirty.current = value; onDraftDirtyChange?.(value) }} /> : draftsOpen === 'kit' && kitAuthoring ? <KitDraftWorkbench authoring={kitAuthoring} initialId={draftId} locale={locale} onDirtyChange={value => { draftDirty.current = value; onDraftDirtyChange?.(value) }} /> : draftsOpen === 'panel' && authoring ? <PanelDraftWorkbench onBack={() => leaveDrafts(() => { setBundleTab('preview'); setPreviewMode('sample') })} trials={trials} authoring={authoring} initialId={draftId} locale={locale} onDirtyChange={value => { draftDirty.current = value; onDraftDirtyChange?.(value) }} /> : bundleMain !== undefined ? bundleMain : snapshot.section === 'bundles' ? bundlesListMain : kitMain}
        </>}
      </div>
    </div>
    {workspace && recoveryOpen && <StudioDialog title={locale === 'zh' ? '恢复工作副本' : 'Restore working copy'} close={() => setRecoveryOpen(false)}>
              {kitAuthoring && mindsetChoices.length > 0 && <label className="ygd-studio-mindset-recovery">{locale === 'zh' ? '工作副本' : 'Working copy'} <StudioSelect aria-label="Mindset working copy" value={mindsetRecords.current.get(kitKey) ?? ''} onValueChange={id => {
                leaveDrafts(() => {
                  if (id) mindsetRecords.current.set(kitKey, id); else mindsetRecords.current.delete(kitKey)
                  setSavedMindsets(previous => { const next = { ...previous }; delete next[kitKey]; return next })
                  setMindsetEditorEpoch(epoch => epoch + 1); setRecoveryOpen(false)
                })
              }} options={[{ value: '', label: locale === 'zh' ? '已安装原文' : 'Installed source' }, ...mindsetChoices.map(record => ({ value: record.id, label: `${record.id.slice(0, 8)} · r${record.revision}` }))]} /></label>}
    </StudioDialog>}
    {fileLocationOpen && <StudioDialog title={locale === 'zh' ? '文件位置' : 'File location'} close={() => setFileLocationOpen(false)}>
      <p>{bundleWorkspace ? `${bundleWorkspace.name}/${bundleFile?.path ?? ''}` : 'mindset.md'}</p>
      <p>{locale === 'zh' ? '当前为包内相对路径。此宿主尚未提供本机绝对路径或打开编辑器接口。' : 'Package-relative path. This host does not expose a local absolute path or editor launch capability.'}</p>
    </StudioDialog>}
    {workspace && fullMindset && <StudioDialog title="mindset.md · 完整文件" close={() => setFullMindset(false)}>
      <p>{locale === 'zh' ? '包含 frontmatter 与 <design_skills>；阅读视图不会修改或丢弃文件内容。' : 'Includes frontmatter and <design_skills>; the reading view never changes file content.'}</p>
      {codeFrame(visibleMindset, 'Complete Mindset file')}
    </StudioDialog>}
    {workspace && kitFilesOpen && <StudioDialog title={`${locale === 'zh' ? '设计套件文件' : 'Kit Files'} · ${workspace.name}`} close={() => setKitFilesOpen(false)}>
      <button className="ygd-studio-tree-node" type="button" onClick={() => { setKitFilesOpen(false); setFullMindset(true) }}>mindset.md</button>

      <p className="ygd-studio-subtitle">{locale === 'zh' ? 'Bundle 资源请在对应 Bundle 的文件树中查看；其他 Kit 根目录文件读取尚未接入。' : 'Compiled resource list; reading other Kit-root files is not yet connected.'}</p>
    </StudioDialog>}
  </section></StudioSelectContext.Provider>
}
