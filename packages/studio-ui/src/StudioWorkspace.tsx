/** Reusable host-neutral React workspace for the read-only Kit-first Studio surface. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import { StudioWorkspaceController, type StudioKitWorkspaceTab } from './controller.ts'
import { renderStudioDocument, renderStudioMarkdown, splitFrontmatter } from './markdown.tsx'
import { STUDIO_WORKSPACE_CSS } from './styles.ts'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { StudioFeedback } from './StudioFeedback.tsx'
import { StudioEmptyState } from './StudioEmptyState.tsx'
import { StudioSelectContext, type StudioSelectRenderer } from './StudioSelect.tsx'
import { FileExplorer } from './FileExplorer.tsx'
import { KitFiles } from './KitFiles.tsx'
import { FileInfoSidebar, FileName } from './FileInfoSidebar.tsx'
import { BundleCard, StudioGlyph } from './BundleCard.tsx'
import { BundleMounts } from './BundleMounts.tsx'
import { groupInstalledContent } from './content-versions.ts'
import type { StudioManagementClient } from './types.ts'
import type { StudioAuthoring } from './authoring.ts'
import { BundleTrial } from './BundleTrial.tsx'
import { InstanceWorkbench, type InstanceWorkbenchProps, type StudioInstanceClient, type StudioInstance, InstanceActionsMenu, InstanceTrashAction, confirmInstanceRemoval } from './InstanceWorkbench.tsx'
import { ComponentLibrary, type StudioComponentLibrary } from './ComponentLibrary.tsx'
import { readStudioImportFiles } from './content-source-import.ts'
import { assertStudioImportRequestSize, downloadStudioContent, formatStudioImportError, type StudioContentClient } from './content-transfer.ts'
import type { StudioTrialClient } from './trial-controller.ts'
import type { DesignKitVersionPin, DesignBundleVersionPin, StudioPanelPreviewResult } from 'dsh-design-studio'

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
  /** Sample-only rendering for saved instances, including ordinary read-only Open. */
  readonly renderPreview?: StudioAuthoring['renderPreview']
  readonly trials?: StudioTrialClient
  readonly instances?: StudioInstanceClient
  /** Open one exact working copy supplied by the host, without selecting a latest revision or first Bundle. */
  readonly initialInstance?: { id: string; expectedRevision: number; bundle?: DesignBundleVersionPin }
  /** Optional host presentation for an existing instance; nullish returns use the standard workbench. */
  readonly renderInstanceWorkbench?: (props: InstanceWorkbenchProps) => ReactNode
  /** Only an explicit editable object enters host authoring; catalog browsing is never wrapped. */
  readonly renderContent?: (content: ReactNode, context: StudioObjectAuthoringContext) => ReactNode
  /** Trusted host-owned catalog and sample-only shared renderer. */
  readonly componentLibrary?: StudioComponentLibrary
  /** Optional host-owned shared choice control; no Panel implementation enters Studio UI. */
  readonly renderSelect?: StudioSelectRenderer
  /** Optional inert content import/export; only Kit adoption requires Kit authoring. */
  readonly contentClient?: StudioContentClient
  /** Lets the host guard dialog closure as well as internal navigation. */
  readonly onDraftDirtyChange?: (dirty: boolean) => void
}

export interface StudioObjectAuthoringContext {
  readonly id: string
  readonly intent: 'create' | 'edit'
  readonly initialPrompt?: string
  readonly onDirtyChange: (dirty: boolean) => void
}

/** The instance ID owns presentation lifetime; all operations stay on the supplied ports. */
function presentInstanceWorkbench(props: InstanceWorkbenchProps, render?: StudioWorkspaceProps['renderInstanceWorkbench']): ReactElement {
  return <InstancePresentation key={`${props.id}:${props.readOnly ? 'read' : 'edit'}`} props={props} render={render} />
}
function InstancePresentation({ props, render }: { props: InstanceWorkbenchProps; render?: StudioWorkspaceProps['renderInstanceWorkbench'] }): ReactElement {
  return <>{render?.(props) ?? <InstanceWorkbench {...props} />}</>
}

const KIT_TABS: readonly StudioKitWorkspaceTab[] = ['mindset', 'mounts']
const TABPANEL_ID = 'ygd-studio-kit-tabpanel'
// Documentation only: this link never installs content or changes project pins.
const OFFICIAL_KITS_URL = 'https://github.com/alibaba-damo-academy/yugoo-design/blob/main/docs/wiki/kit-sharing.md#official-kits'

type StudioLocale = 'zh' | 'en'
type DocViewMode = 'rich' | 'source'
const displayName = (name: string): string => name.replace(/[_-]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())

function CatalogHeader({ label, query, onQueryChange, count, total, noun, locale, children }: {
  label: string; query: string; onQueryChange: (query: string) => void
  count: number; total: number; noun: string; locale: StudioLocale; children?: ReactNode
}): ReactElement {
  return <header className="ygd-studio-content-header ygd-studio-catalog-header">
    <div className="ygd-studio-catalog-tools" role="search" aria-label={label}>
      <input className="ygd-studio-search-input" type="search" value={query}
        placeholder={label} aria-label={label} onChange={event => onQueryChange(event.currentTarget.value)} />
      <span role="status">{locale === 'zh'
        ? count === total ? `共 ${total} 个${noun}` : `找到 ${count} 个${noun}，共 ${total} 个`
        : count === total ? `${total} ${total === 1 ? noun.replace(/s$/, '') : noun} in total` : `${count} of ${total} ${noun}`}</span>
    </div>
    {children && <div className="ygd-studio-hero-actions">{children}</div>}
  </header>
}

function catalogMatches(item: { name: string; description?: string; title?: Readonly<{ zh: string; en: string }>;
  displayDescription?: Readonly<{ zh: string; en: string }> }, query: string): boolean {
  const text = [item.name, displayName(item.name), item.description, item.title?.zh, item.title?.en,
    item.displayDescription?.zh, item.displayDescription?.en].filter(Boolean).join(' ').toLowerCase()
  return text.includes(query.trim().toLowerCase())
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
    kitsSubtitle: 'Browse installed Kits and editable working copies',
    kitsSearchPlaceholder: 'Search kits…',
    browseOfficialKits: 'Browse official kits',
    officialKitsHelp: 'Browse official kits: descriptions and acquisition guidance (opens in a new tab)',
    bundlesTitle: 'Bundles',
    bundlesContext: 'Studio 1.0 · Bundles',
    bundlesSubtitle: 'Browse installed Bundles and editable working copies',
    searchPlaceholder: 'Search bundles…',
    kitContext: 'Studio 1.0 · Kit Workspace',
    bundleContext: 'Studio 1.0 · Bundle Workspace',
    readonlyBadge: 'Read-only',
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
    requestFailed: 'Request failed',
    loading: 'Loading…',
  },
  zh: {
    kitsTitle: '设计套件',
    kitsContext: 'Studio 1.0 · 设计套件',
    kitsSubtitle: '浏览已安装设计套件与可编辑的工作副本',
    kitsSearchPlaceholder: '搜索设计套件…',
    browseOfficialKits: '浏览官方设计套件',
    officialKitsHelp: '浏览官方设计套件：简介和获取指引（在新标签页打开）',
    bundlesTitle: '技能包',
    bundlesContext: 'Studio 1.0 · 技能包',
    bundlesSubtitle: '浏览已安装技能包与可编辑的工作副本',
    searchPlaceholder: '搜索技能包…',
    kitContext: 'Studio 1.0 · Kit Workspace',
    bundleContext: 'Studio 1.0 · Bundle Workspace',
    readonlyBadge: '只读',
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

function StudioDialog({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }): ReactElement {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current, active = document.activeElement as HTMLElement | null
    const opener = active?.closest('details')?.querySelector('summary') ?? active
    dialog?.showModal()
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus() }
  }, [])
  return <dialog ref={ref} className="ygd-studio-modal" onCancel={event => { event.preventDefault(); if (!busy) close() }} aria-label={title}>
    <header><h2>{title}</h2><button className="ygd-studio-btn-link" type="button" aria-label="Close" disabled={busy} onClick={close}>×</button></header>
    {children}
  </dialog>
}


/** Installed content is a reading surface; edits use the same current-content editor. */
function InstalledPreview({ authoring, client, kit, bundle, locale, declarative, onEdit }: { onEdit?: () => void; authoring?: StudioAuthoring; client: StudioManagementClient; kit?: DesignKitVersionPin; bundle: DesignBundleVersionPin; locale: StudioLocale; declarative: boolean }): ReactElement {
  const [result, setResult] = useState<StudioPanelPreviewResult>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [sourceError, setSourceError] = useState(''), [panelSource, setPanelSource] = useState<string>()
  const [retry, setRetry] = useState(0)
  const previewInstalled = authoring?.client.previewInstalled
  useEffect(() => {
    let active = true
    setResult(undefined); setError(''); setBusy(!!previewInstalled)
    if (previewInstalled) void previewInstalled({ kit, bundle, revision: retry }).then(value => {
      if (!active) return
      if (value.preview && (value.preview.bundle.name !== bundle.name || value.preview.bundle.version !== bundle.version)) throw Error('Preview identity mismatch')
      setResult(value)
    }).catch(failure => { if (active) setError(String(failure instanceof Error ? failure.message : failure)) })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [previewInstalled, kit?.name, kit?.version, bundle.name, bundle.version, retry])
  useEffect(() => {
    let active = true
    setPanelSource(undefined); setSourceError('')
    if (declarative) void client.readBundleFile({ name: bundle.name, version: bundle.version, path: 'panel.yaml' }).then(value => {
      if (!active) return
      if (!value.file || value.file.path !== 'panel.yaml') throw Error('Panel source is unavailable')
      setPanelSource(value.file.content)
    }).catch(failure => { if (active) setSourceError(String(failure instanceof Error ? failure.message : failure)) })
    return () => { active = false }
  }, [client, bundle.name, bundle.version, declarative, retry])
  return <section className="ygd-studio-panel-split">
    <section className="ygd-studio-yaml-pane">
      <header><FileName path="panel.yaml" locale={locale} />{onEdit && <button className="ygd-studio-btn-secondary" type="button" onClick={onEdit}>{locale === 'zh' ? '编辑' : 'Edit'}</button>}</header>
      {panelSource !== undefined ? <textarea aria-label="Panel YAML" spellCheck={false} value={panelSource} readOnly /> : sourceError
        ? <StudioFeedback feedbackId={`source:${retry}:${sourceError}`} tone="error" locale={locale} title={locale === 'zh' ? '无法读取面板定义' : 'Could not read Panel source'} message={sourceError} actions={[{ label: locale === 'zh' ? '重试' : 'Retry', onClick: () => setRetry(value => value + 1) }]} />
        : declarative ? <LoadingIndicator label={locale === 'zh' ? '正在读取面板定义' : 'Loading Panel definition'} /> : <StudioEmptyState title={locale === 'zh' ? '此面板由原生组件提供' : 'This is a native Panel'} />}
    </section>
    <section className="ygd-studio-live-pane"><div className="ygd-studio-live-pane-body">
      {!previewInstalled && <StudioEmptyState title={locale === 'zh' ? '此处暂不支持面板预览' : 'Panel preview is unavailable here'} />}
      {busy && <LoadingIndicator label={locale === 'zh' ? '正在加载预览' : 'Loading preview'} />}
      {error && <StudioFeedback feedbackId={`preview:${retry}:${error}`} tone="error" locale={locale} title={locale === 'zh' ? '无法载入面板预览' : 'Could not load Panel preview'} message={error} actions={[{ label: locale === 'zh' ? '重试' : 'Retry', onClick: () => setRetry(value => value + 1) }]} />}
      {!!result?.diagnostics.length && (result.diagnostics.every(item => item.code === 'preview.sample_missing')
        ? <StudioEmptyState title={locale === 'zh' ? '缺少预览样例' : 'Preview sample is missing'} description={locale === 'zh' ? '添加 reference/preview.json 后，可在这里查看面板效果。' : 'Add reference/preview.json to preview the Panel here.'} />
        : <StudioFeedback feedbackId={`preview:${retry}:${JSON.stringify(result.diagnostics)}`} tone="error" locale={locale} title={locale === 'zh' ? '面板预览未能生成' : 'Panel preview could not be generated'} details={result.diagnostics.map(item => ({ message: item.message }))} />)}
      {result?.preview && authoring?.renderPreview(result.preview, () => {}, { readOnly: false, toolbarTarget: null })}
    </div></section>
  </section>
}

/** Read-only Studio surface: one complete page with global nav, sidebar, and workspace main. */
export function StudioWorkspace({ client, controller: supplied, authoring, renderPreview, trials, instances, initialInstance, renderInstanceWorkbench, renderContent, componentLibrary, renderSelect, contentClient, onDraftDirtyChange, locale: hostLocale, onLocaleChange }: StudioWorkspaceProps): ReactElement {
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
  const launchTrial = useRef<(() => void) | undefined>()
  const [trialTarget, setTrialTarget] = useState<HTMLDivElement | null>(null)
  const [fileLocationOpen, setFileLocationOpen] = useState(false)
  const [mountsOpen, setMountsOpen] = useState(false)
  const [localMountRecord, setLocalMountRecord] = useState<StudioInstance>()
  const mountRequest = useRef<string>()
  const [mountQuery, setMountQuery] = useState('')
  const [archiveBusy, setArchiveBusy] = useState(false)
  const archiveLock = useRef(false)
  const exportGeneration = useRef(0)
  const [exportError, setExportError] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const importLock = useRef(false)
  const [importError, setImportError] = useState('')
  const importKind = useRef<'kit' | 'bundle'>('kit')
  const importFileInput = useRef<HTMLInputElement>(null)
  const importFolderInput = useRef<HTMLInputElement | null>(null)
  const [incompleteImport, setIncompleteImport] = useState<StudioInstance>()
  const [initialPrompt, setInitialPrompt] = useState<string>()
  const [importNotice, setImportNotice] = useState('')
  const [refreshFailure, setRefreshFailure] = useState<{ message: string; imported?: string }>()
  const [refreshBusy, setRefreshBusy] = useState(false)
  const refreshGeneration = useRef(0)
  useEffect(() => () => { refreshGeneration.current++ }, [])
  const importGeneration = useRef(0)
  useEffect(() => { ++exportGeneration.current; return () => { importGeneration.current++; ++exportGeneration.current } }, [contentClient])
  const createGeneration = useRef(0)
  const draftDirty = useRef(false)
  const sourceDirty = useRef(false)
  const panelDirty = useRef(false), trialDirty = useRef(false)
  const reportPreviewDirty = (kind: 'panel' | 'trial', value: boolean) => {
    if (kind === 'panel') panelDirty.current = value; else trialDirty.current = value
    draftDirty.current = panelDirty.current || trialDirty.current
    sourceDirty.current = draftDirty.current
    onDraftDirtyChange?.(draftDirty.current)
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (draftDirty.current || authoringDirty.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])
  const [creating, setCreating] = useState(false)
  const [authoringError, setAuthoringError] = useState('')
  const [trashNotice, setTrashNotice] = useState(0)
  const [kitQuery, setKitQuery] = useState('')
  const [localInstances, setLocalInstances] = useState<readonly StudioInstance[]>([])
  const [instanceId, setInstanceId] = useState<string | undefined>(initialInstance?.id)
  const [instanceMode, setInstanceMode] = useState<'read' | 'edit'>('edit')
  const [authoringIntent, setAuthoringIntent] = useState<'create' | 'edit'>('edit')
  const authoringDirty = useRef(false)
  const authoringDirtyChange = useCallback((value: boolean) => {
    authoringDirty.current = value
    onDraftDirtyChange?.(value || draftDirty.current)
  }, [onDraftDirtyChange])
  // Handoff identity is fixed on page entry; subsequent navigation/save keeps its ordinary lifecycle.
  const [entryInstance] = useState(initialInstance)
  const [entryRevisionConsumed, setEntryRevisionConsumed] = useState(false)
  const instanceListRequest = useRef(0)
  const refreshInstances = useCallback(async () => {
    if (!instances) return
    const request = ++instanceListRequest.current
    const records = await instances.list()
    if (request === instanceListRequest.current) setLocalInstances(records)
  }, [instances])
  useEffect(() => {
    let live = true
    void refreshInstances().catch(error => { if (live) setAuthoringError(String(error)) })
    return () => { live = false; ++instanceListRequest.current }
  }, [refreshInstances])
  const [localLocale, setLocalLocale] = useState<StudioLocale>()
  useEffect(() => { setLocalLocale(undefined) }, [hostLocale])
  const locale = localLocale ?? hostLocale ?? detectLocale()
  const changeLocale = (next: StudioLocale) => { if (onLocaleChange) onLocaleChange(next); else setLocalLocale(next) }
  const t = STRINGS[locale]
  const workspace = snapshot.kitWorkspace
  const kitKey = workspace ? `${workspace.name}@${workspace.version}` : ''
  const bundleWorkspace = snapshot.bundleWorkspace
  const bundleTitle = (name: string, version: string) => snapshot.view?.bundles.find(bundle => bundle.name === name && bundle.version === version)?.title?.[locale] ?? displayName(name)
  const bundleFile = snapshot.bundleFile
  useEffect(() => { setBundleTab('files'); setPreviewMode('sample'); setPreviewOpened(false); setMountsOpen(mountRequest.current === `${bundleWorkspace?.name}@${bundleWorkspace?.version}`); mountRequest.current = undefined }, [bundleWorkspace?.name, bundleWorkspace?.version])
  useEffect(() => { createGeneration.current++ }, [workspace?.name, workspace?.version, bundleWorkspace?.name, bundleWorkspace?.version])
  const leaveDrafts = (next: () => void) => {
    if ((draftDirty.current || authoringDirty.current) && !window.confirm(locale === 'zh' ? '离开会丢失尚未保存的修改，继续吗？' : 'Discard unsaved changes and leave?')) return
    setEntryRevisionConsumed(true)
    createGeneration.current++; setCreating(false); panelDirty.current = false; trialDirty.current = false; draftDirty.current = false; sourceDirty.current = false; authoringDirty.current = false; onDraftDirtyChange?.(false); setInitialPrompt(undefined); setInstanceId(undefined); setAuthoringIntent('edit'); setSidebarOpen(false); next()
  }
  const exportContent = async (target: { id: string; expectedRevision: number } | { kind: 'kit' | 'bundle'; pin: DesignKitVersionPin }, filename: string) => {
    if (!contentClient || archiveLock.current) return
    const generation = exportGeneration.current
    archiveLock.current = true; setArchiveBusy(true); setExportError('')
    try {
      const source = await contentClient.export(target)
      if (generation !== exportGeneration.current) return
      downloadStudioContent(source, filename)
    } catch (error) { setExportError(error instanceof Error ? error.message : String(error)) }
    finally { archiveLock.current = false; setArchiveBusy(false) }
  }
  const exportInstance = (record: StudioInstance) => {
    if (!contentClient || record.deletedAt || (record.id === instanceId && sourceDirty.current)) return
    void exportContent({ id: record.id, expectedRevision: record.revision }, record.title[locale])
  }
  // A completed adoption stays completed if a subsequent read fails. Retry reads,
  // never the write, and keep one actionable outcome for that operation.
  const refreshCatalog = async (imported?: string) => {
    const request = ++refreshGeneration.current
    setRefreshBusy(true); setRefreshFailure(undefined)
    try {
      await controller.load()
      if (request !== refreshGeneration.current) return false
      const failure = controller.getSnapshot().failure
      if (failure) throw new Error(failure.message)
      await refreshInstances()
      if (request !== refreshGeneration.current) return false
      if (imported) setImportNotice(locale === 'zh' ? `已导入「${imported}」。` : `Imported “${imported}”.`)
      return true
    } catch (error) {
      if (request === refreshGeneration.current) {
        if (imported) setImportNotice('')
        setRefreshFailure({ message: error instanceof Error ? error.message : String(error), imported })
      }
      return false
    } finally { if (request === refreshGeneration.current) setRefreshBusy(false) }
  }
  const importFiles = async (files: readonly File[], kind: 'kit' | 'bundle') => {
    if (!instances?.importSources || importLock.current || refreshBusy) return
    importLock.current = true; setImportBusy(true)
    const request = ++importGeneration.current
    setImportNotice(''); setImportError(''); setRefreshFailure(undefined)
    try {
      const input = await readStudioImportFiles(kind, files, contentClient ? async source => { assertStudioImportRequestSize(source); return contentClient.readArchive({ source }) } : undefined)
      if (request !== importGeneration.current) return
      const record = await instances.importSources(input)
      if (request !== importGeneration.current) return
      // Imported content is already saved. A failed list refresh must never repeat the import.
      setLocalInstances(previous => [record, ...previous.filter(item => item.id !== record.id)])
      if (record.readiness && !record.readiness.ready) setIncompleteImport(record)
      await refreshCatalog(record.title[locale])
    } catch (error) {
      if (request === importGeneration.current) setImportError(error instanceof Error ? error.message : String(error))
    } finally { if (request === importGeneration.current) { importLock.current = false; setImportBusy(false) } }
  }
  const chooseImport = (kind: 'kit' | 'bundle', folder = false) => {
    importKind.current = kind
    ;(folder ? importFolderInput : importFileInput).current?.click()
  }
  const importButton = (kind: 'kit' | 'bundle') => instances?.importSources ? <div className="ygd-studio-import-actions">
    <button className="ygd-studio-btn-secondary" type="button" disabled={importBusy || refreshBusy} onClick={() => chooseImport(kind)}>{locale === 'zh' ? '导入' : 'Import'}</button>
    <InstanceActionsMenu locale={locale}><button className="ygd-studio-btn-link" type="button" disabled={importBusy || refreshBusy} onClick={() => chooseImport(kind, true)}>{locale === 'zh' ? '导入文件夹' : 'Import folder'}</button></InstanceActionsMenu>
  </div> : undefined
  const importFeedback = <>{importBusy && <LoadingIndicator label={locale === 'zh' ? '正在导入' : 'Importing'} />}
    {archiveBusy && <LoadingIndicator label={locale === 'zh' ? '正在导出' : 'Exporting'} />}
    {exportError && <StudioFeedback feedbackId={`export:${exportError}`} tone="error" locale={locale} title={locale === 'zh' ? '导出失败' : 'Export failed'} message={exportError} />}
    {importError && <StudioFeedback feedbackId={`import:${importGeneration.current}:${importError}`} tone="error" locale={locale}
      title={locale === 'zh' ? '无法导入文件' : 'Could not import the file'} message={formatStudioImportError(importError, locale)}
      actions={[{ label: locale === 'zh' ? '选择文件' : 'Choose file', onClick: () => chooseImport(importKind.current) }]} />}
    {importNotice && <StudioFeedback feedbackId={`import:${importGeneration.current}:saved`} tone="success" locale={locale} title={importNotice} />}</>
  const installedExport = (kind: 'kit' | 'bundle', pin: DesignKitVersionPin) => contentClient && <InstanceActionsMenu locale={locale}><button className="ygd-studio-btn-link" type="button" disabled={archiveBusy} onClick={() => void exportContent({ kind, pin: { name: pin.name, version: pin.version } }, pin.name)}>{locale === 'zh' ? '导出' : 'Export'}</button></InstanceActionsMenu>
  const copyInstalled = async (kind: 'kit' | 'bundle', kit?: DesignKitVersionPin, bundle?: DesignBundleVersionPin, sourceId?: string) => {
    if (!instances || creating) return
    if (draftDirty.current && !window.confirm(locale === 'zh' ? '放弃未保存修改并复制？' : 'Discard unsaved edits and duplicate?')) return
    const request = ++createGeneration.current
    setCreating(true); setAuthoringError('')
    try {
      const record = await instances.copy({ kind,
        ...(kit ? { kit: { name: kit.name, version: kit.version } } : {}),
        ...(bundle ? { bundle: { name: bundle.name, version: bundle.version } } : {}),
        ...(sourceId ? { sourceId } : {}),
      })
      await refreshInstances()
      if (request !== createGeneration.current) return
      draftDirty.current = false; sourceDirty.current = false; onDraftDirtyChange?.(false); setAuthoringIntent('edit'); setInstanceMode('read'); setInstanceId(record.id)
    } catch (error) { if (request === createGeneration.current) setAuthoringError(String(error)) }
    finally { if (request === createGeneration.current) setCreating(false) }
  }
  const copyMenu = (kind: 'kit' | 'bundle', kit?: DesignKitVersionPin, bundle?: DesignBundleVersionPin) => instances && <button type="button" className="ygd-studio-btn-secondary" disabled={creating} onClick={() => { void copyInstalled(kind, kit, bundle) }}>{locale === 'zh' ? '复制' : 'Copy'}</button>
  const editInstalled = async (kind: 'kit' | 'bundle', pin: DesignKitVersionPin) => {
    if (!instances?.editCurrent || creating) return
    if ((draftDirty.current || authoringDirty.current) && !window.confirm(locale === 'zh' ? '放弃未保存的修改？' : 'Discard unsaved changes?')) return
    const request = ++createGeneration.current
    setCreating(true); setAuthoringError('')
    try {
      const record = await instances.editCurrent({ kind, [kind]: { name: pin.name, version: pin.version } })
      await refreshInstances()
      if (request !== createGeneration.current) return
      draftDirty.current = false; sourceDirty.current = false; authoringDirty.current = false; onDraftDirtyChange?.(false)
      setAuthoringIntent('edit'); setInstanceMode('edit'); setInstanceId(record.id)
    } catch (error) { if (request === createGeneration.current) setAuthoringError(String(error)) }
    finally { if (request === createGeneration.current) setCreating(false) }
  }
  const editButton = (kind: 'kit' | 'bundle', pin: DesignKitVersionPin) => instances?.editCurrent && <button type="button" className="ygd-studio-btn-secondary" disabled={creating} onClick={() => { void editInstalled(kind, pin) }}>{locale === 'zh' ? '编辑' : 'Edit'}</button>
  const createObject = async (kind: 'kit' | 'bundle') => {
    if (!instances?.create || creating) return
    const request = ++createGeneration.current
    setCreating(true); setAuthoringError('')
    try {
      const record = await instances.create({ kind, title: kind === 'kit'
        ? { zh: '新建设计套件', en: 'New Kit' } : { zh: '新建技能包', en: 'New Bundle' } })
      await refreshInstances()
      if (request !== createGeneration.current) return
      setAuthoringIntent('create'); setInstanceMode('edit'); setInstanceId(record.id)
    } catch (error) { if (request === createGeneration.current) setAuthoringError(String(error)) }
    finally { if (request === createGeneration.current) setCreating(false) }
  }
  const newButton = (kind: 'kit' | 'bundle') => instances?.create && <button type="button" className="ygd-studio-btn-primary" disabled={creating} onClick={() => { void createObject(kind) }}>
    {kind === 'kit' ? locale === 'zh' ? '新建设计套件' : 'New Kit' : locale === 'zh' ? '新建技能包' : 'New Bundle'}
  </button>
  const bundleCopyMenu = (bundle: DesignBundleVersionPin) => {
    return copyMenu('bundle', undefined, bundle)
  }
  const visibleLocalInstances = (kind: 'kit' | 'bundle') => localInstances.filter(record => record.kind === kind
    && catalogMatches({ name: record.title.en, title: record.title, description: record.description, displayDescription: record.displayDescription }, kind === 'kit' ? kitQuery : snapshot.bundleQuery))
  const searchRow = (query: string, change: (value: string) => void, count: number, label: string, placeholder: string) => <div className="ygd-studio-filter-row">
    <input className="ygd-studio-search-input" type="search" value={query} placeholder={placeholder} aria-label={placeholder} onChange={event => change(event.currentTarget.value)} />
    <span>{count} {label}</span>
  </div>
  const openLocal = (record: StudioInstance, mode: 'read' | 'edit') => leaveDrafts(() => {
    setInstanceMode(mode); setAuthoringIntent('edit'); setInstanceId(record.id)
  })
  const removeLocal = async (record: StudioInstance) => {
    if (!instances || creating || !confirmInstanceRemoval(record, locale)) return
    const request = ++createGeneration.current
    setCreating(true); setAuthoringError('')
    try {
      await instances.remove({ id: record.id, expectedRevision: record.revision })
      setTrashNotice(value => value + 1)
      await refreshInstances()
    } catch (failure) { if (request === createGeneration.current) setAuthoringError(String(failure)) }
    finally { if (request === createGeneration.current) setCreating(false) }
  }
  const localCards = (kind: 'kit' | 'bundle') => visibleLocalInstances(kind).map(record => {
    const warning = record.readiness && !record.readiness.ready && <button type="button" className="ygd-studio-btn-link ygd-studio-import-warning" onClick={() => setIncompleteImport(record)}>{locale === 'zh' ? '⚠ 待完善' : '⚠ Incomplete'}</button>
    const actions = <>
      <button type="button" className="ygd-studio-btn-secondary" disabled={creating} onClick={() => openLocal(record, 'read')}>{locale === 'zh' ? '打开' : 'Open'}</button>
      <button type="button" className="ygd-studio-btn-secondary" disabled={creating} onClick={() => void copyInstalled(record.kind, record.source.kit, record.source.bundle, record.id)}>{locale === 'zh' ? '复制' : 'Copy'}</button>
      <button type="button" className="ygd-studio-btn-secondary" disabled={creating} onClick={() => openLocal(record, 'edit')}>{locale === 'zh' ? '编辑' : 'Edit'}</button>
      <InstanceActionsMenu locale={locale}>{contentClient && <button className="ygd-studio-btn-link" type="button" disabled={creating || archiveBusy} onClick={() => exportInstance(record)}>{locale === 'zh' ? '导出' : 'Export'}</button>}<InstanceTrashAction locale={locale} disabled={creating} onClick={() => void removeLocal(record)} /></InstanceActionsMenu>
    </>
    const bundle = record.bundle ?? record.source.bundle
    if (kind === 'bundle' && bundle) {
      const uses = new Set(record.refs.map(ref => ref.id)).size
      return <BundleCard key={record.id} bundle={{ ...bundle, title: record.title, description: record.description, displayDescription: record.displayDescription }} locale={locale}
        sourceLabel={locale === 'zh' ? '本地内容 · 已保存 · 可编辑' : 'Local content · Saved · editable'}
        badge={`${uses} Kit`} badgeLabel={locale === 'zh' ? `${uses} Kit · 查看挂载` : `${uses} Kit · View mounts`}
        onBadgeClick={() => setLocalMountRecord(record)}>{warning}{actions}</BundleCard>
    }
    return <article key={record.id} className="ygd-studio-kit-card">
      <div className="ygd-studio-card-top"><StudioGlyph bundle={kind === 'bundle'} /><span className="ygd-studio-card-pill">{locale === 'zh' ? '本地内容' : 'Local content'}</span></div>
      <h3 className="ygd-studio-kit-card-name">{record.title[locale]}</h3>
      <div className="ygd-studio-card-description">{renderStudioMarkdown(record.displayDescription?.[locale] ?? record.description ?? '')}</div>
      {warning}<p className="ygd-studio-card-meta">{locale === 'zh' ? '已保存 · 可编辑' : 'Saved · editable'}</p>
      <div className="ygd-studio-kit-card-actions">{actions}</div>
    </article>
  })
  const mountBundle = localMountRecord?.bundle ?? localMountRecord?.source.bundle ?? (mountsOpen ? bundleWorkspace : undefined)
  const closeMounts = () => {
    setLocalMountRecord(undefined); setMountsOpen(false)
    void refreshInstances().catch(error => setAuthoringError(String(error)))
  }
  // A Kit can provide execution context without owning the Bundle source.
  const bundleContextKit = () => {
    if (!bundleWorkspace) return undefined
    const entry = snapshot.view?.bundles.find(item => item.name === bundleWorkspace.name && item.version === bundleWorkspace.version)
    const candidates = entry?.usedBy ?? snapshot.view?.kits.filter(kit => kit.name === bundleWorkspace.kit) ?? []
    if (workspace && candidates.some(pin => pin.name === workspace.name && pin.version === workspace.version)) return workspace
    return candidates.length === 1 ? candidates[0] : undefined
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
  const catalogBundles = (snapshot.view?.bundles ?? []).filter(bundle => !localInstances.some(record => record.current && record.kind === 'bundle' && record.bundle?.name === bundle.name))
  const listedBundles = catalogBundles.filter(bundle => catalogMatches(bundle, bundleQuery))
  const catalogKits = (snapshot.view?.kits ?? []).filter(kit => !localInstances.some(record => record.current && record.kind === 'kit' && record.kit?.name === kit.name))
  const listedKits = catalogKits.filter(kit => catalogMatches(kit, kitQuery))

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
    {snapshot.failure !== undefined && !refreshFailure && <StudioFeedback feedbackId={`request:${snapshot.failure.message}`} tone="error" locale={locale}
      title={t.requestFailed} message={snapshot.failure.message} />}
    {snapshot.diagnostics.length > 0 && <StudioFeedback feedbackId={`content:${JSON.stringify(snapshot.diagnostics)}`} tone="info" locale={locale}
      title={locale === 'zh' ? '内容检查提示' : 'Content check information'}
      details={snapshot.diagnostics.map(entry => ({ message: entry.message }))} />}
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
      <div className="ygd-studio-file-heading"><FileName path={bundleWorkspace ? bundleFile?.path : 'mindset.md'} locale={locale} /></div>
      <div className="ygd-studio-doc-toggle-group">
        {(!bundleFile || isMarkdownPath(bundleFile.path)) && <button className="ygd-studio-doc-toggle" type="button" aria-pressed={mode === 'rich'} onClick={() => select('rich')}>{t.richToggle}</button>}
        <button className="ygd-studio-doc-toggle" type="button" aria-pressed={mode === 'source'} onClick={() => select('source')}>{t.sourceToggle}</button>
      </div>
      {actions}
      <button className="ygd-studio-btn-link" type="button" onClick={() => setFileLocationOpen(true)}>{locale === 'zh' ? '文件位置' : 'File location'}</button>
    </div>
  )

  const docFooter = (content: string): ReactElement => <footer className="ygd-studio-doc-footer">
    <span>{locale === 'zh' ? '完整文件' : 'Complete file'} · {t.bytes(new TextEncoder().encode(content).length)}</span>
  </footer>

  const markdownDoc = (source: string, ariaLabel: string): ReactElement => renderStudioDocument(source, { locale, ariaLabel })

  /** Bundle descriptions are authored as Markdown lists; cards render the same safe subset. */
  const cardDescription = (description: string): ReactElement => (
    <div className="ygd-studio-card-description">{renderStudioMarkdown(description)}</div>
  )


  const bundleMain = bundleWorkspace === undefined ? undefined : <main className="ygd-studio-main ygd-studio-bundle-main">
    <header className="ygd-studio-content-header">
      <div>
        <div className="ygd-studio-header-title-group">
          <button type="button" className="ygd-studio-back" aria-label={locale === 'zh' ? '返回' : 'Back'} title={locale === 'zh' ? '返回' : 'Back'} onClick={() => leaveDrafts(() => controller.closeBundleWorkspace())}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg></button>
          <StudioGlyph bundle />
          <h1 className="ygd-studio-page-title">{bundleTitle(bundleWorkspace.name, bundleWorkspace.version)}</h1>
        </div>
        <div className="ygd-studio-hero-actions">
        <button className="ygd-studio-btn-secondary" type="button" aria-expanded={mountsOpen} onClick={() => setMountsOpen(!mountsOpen)}>{locale === 'zh' ? '挂载管理' : 'Mount management'}</button>
        {bundleCopyMenu(bundleWorkspace)}{editButton('bundle', bundleWorkspace)}{installedExport('bundle', bundleWorkspace)}
        <button type="button" className="ygd-studio-btn-primary" disabled={!trials || !bundleContextKit()} aria-pressed={bundleTab === 'preview' && previewMode === 'trial'} onClick={() => {
          if (panelDirty.current) { setAuthoringError(locale === 'zh' ? '请先保存左侧的面板修改，再试运行。' : 'Save the Panel changes before starting a trial.'); return }
          setAuthoringError(''); launchTrial.current?.()
        }}>{locale === 'zh' ? '试运行' : 'Trial run'}</button>
        {trials && (() => {
          const kit = bundleContextKit()
          return kit && <BundleTrial key={`${kit.name}:${bundleWorkspace.name}:${bundleWorkspace.version}`} client={trials} locale={locale} launchRef={launchTrial} target={trialTarget} onDirtyChange={value => reportPreviewDirty('trial', value)} visible={bundleTab === 'preview' && previewMode === 'trial'} onOpen={() => { setBundleTab('preview'); setPreviewMode('trial') }} source={{ kind: 'installed', kit: { name: kit.name, version: kit.version }, bundle: { name: bundleWorkspace.name, version: bundleWorkspace.version } }} />
        })()}
        </div>
      </div>
    </header>
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
          {docFooter(bundleFile.content)}
        </>}
      </div>
      <FileInfoSidebar kind="bundle" description={bundleWorkspace.displayDescription?.[locale] ?? bundleWorkspace.description} locale={locale} />
    </div>

    <div className="ygd-studio-trial-slot" ref={setTrialTarget} hidden={bundleTab !== 'preview' || previewMode !== 'trial'} />
    {previewOpened && <div className="ygd-studio-preview-slot" hidden={bundleTab !== 'preview' || previewMode !== 'sample'}><InstalledPreview key={`${bundleWorkspace.name}@${bundleWorkspace.version}`} client={client} authoring={authoring} onEdit={instances?.editCurrent ? () => { void editInstalled('bundle', bundleWorkspace) } : undefined} locale={locale} bundle={{ name: bundleWorkspace.name, version: bundleWorkspace.version }} kit={bundleContextKit()} declarative={bundleWorkspace.panel?.kind === 'declarative'} /></div>}
  </main>

  const bundleCard = (bundle: { name: string; version: string; description: string; title?: Readonly<{ zh: string; en: string }>; displayDescription?: Readonly<{ zh: string; en: string }> }, uses: number, inKit = false): ReactElement => <BundleCard key={`${bundle.name}@${bundle.version}`} bundle={bundle} locale={locale}
    badge={inKit ? locale === 'zh' ? '引用挂载' : 'Mounted reference' : `${uses} Kit`}
    badgeLabel={locale === 'zh' ? `${uses} Kit · 查看挂载` : `${uses} Kit · View mounts`}
    onBadgeClick={inKit ? undefined : () => {
      if (bundleWorkspace?.name === bundle.name && bundleWorkspace.version === bundle.version) setMountsOpen(true)
      else { mountRequest.current = `${bundle.name}@${bundle.version}`; void controller.openBundleWorkspace(bundle.name, bundle.version) }
    }}>
    <button className="ygd-studio-btn-secondary" type="button" onClick={() => void controller.openBundleWorkspace(bundle.name, bundle.version)}>{locale === 'zh' ? '打开' : 'Open'}</button>
    {bundleCopyMenu(bundle)}{editButton('bundle', bundle)}{installedExport('bundle', bundle)}
  </BundleCard>

  const bundlesListMain = <main className="ygd-studio-main">
    <CatalogHeader label={t.searchPlaceholder} query={snapshot.bundleQuery} onQueryChange={value => controller.setBundleQuery(value)}
      count={groupInstalledContent(listedBundles).length + visibleLocalInstances('bundle').length}
      total={groupInstalledContent(catalogBundles).length + localInstances.filter(item => item.kind === 'bundle').length}
      noun={t.bundlesTitle} locale={locale}>{importButton('bundle')}{newButton('bundle')}</CatalogHeader>
    <div className="ygd-studio-content-body">
      {diagnostics}
      {listedBundles.length === 0 && visibleLocalInstances('bundle').length === 0 && <div className="ygd-studio-empty">{t.noBundles}</div>}
      <div className="ygd-studio-kits-grid" aria-label="Catalog Bundles">
        {localCards('bundle')}
        {groupInstalledContent(listedBundles).map(({ latest: bundle }) => bundleCard(bundle,
          new Set(bundle.usedBy.map(kit => `${kit.name}@${kit.version}`)).size))}
      </div>
    </div>
  </main>

  const kitMain = workspace === undefined ? <main className="ygd-studio-main">
    <CatalogHeader label={t.kitsSearchPlaceholder} query={kitQuery} onQueryChange={setKitQuery}
      count={groupInstalledContent(listedKits).length + visibleLocalInstances('kit').length}
      total={groupInstalledContent(catalogKits).length + localInstances.filter(item => item.kind === 'kit').length}
      noun={t.kitsTitle} locale={locale}>
        <a className="ygd-studio-btn-link ygd-studio-catalog-link" href={OFFICIAL_KITS_URL} target="_blank" rel="noopener noreferrer" title={t.officialKitsHelp} aria-label={t.officialKitsHelp}>
          {t.browseOfficialKits}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M14 3h7v7M10 14 21 3M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6" /></svg>
        </a>
      {importButton('kit')}{newButton('kit')}
    </CatalogHeader>
    <div className="ygd-studio-content-body">
      {diagnostics}
      {listedKits.length === 0 && visibleLocalInstances('kit').length === 0 && <div className="ygd-studio-empty">{t.noKits}</div>}
      <div className="ygd-studio-kits-grid" aria-label="Installed Kits">
        {localCards('kit')}
        {groupInstalledContent(listedKits).map(({ latest: kit }) => {
          const bundleCount = bundleCountByKit.get(`${kit.name}\u0000${kit.version}`) ?? 0
          return (
            <article className="ygd-studio-kit-card ygd-studio-library-card" key={`${kit.name}@${kit.version}`}>
              <div className="ygd-studio-card-top"><StudioGlyph /><span className="ygd-studio-card-pill">{locale === 'zh' ? '已安装套件' : 'Installed kit'}</span></div>
              <h2 className="ygd-studio-kit-card-name">{displayName(kit.name)}</h2>
              <div className="ygd-studio-source-id">{kit.name}</div>
              {cardDescription(kit.displayDescription?.[locale] ?? kit.description ?? '')}
              <p className="ygd-studio-card-meta">{bundleCount} {locale === 'zh' ? '个技能包' : 'bundles'}</p>
              <div className="ygd-studio-kit-card-actions">
                <button className="ygd-studio-btn-secondary" type="button" onClick={() => void controller.selectKit(kit.name, kit.version)}>{locale === 'zh' ? '打开' : 'Open'}</button>
                {copyMenu('kit', kit)}{editButton('kit', kit)}{installedExport('kit', kit)}
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
        </div>
        <div className="ygd-studio-hero-actions">
        {copyMenu('kit', workspace)}{editButton('kit', workspace)}
        {installedExport('kit', workspace)}
        </div>
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
          {searchRow(mountQuery, setMountQuery, workspace.mounts.length, t.bundlesTitle, t.searchPlaceholder)}
          <div className="ygd-studio-bundles-list" aria-label="Mounted Bundles">
            {workspace.mounts.length === 0 && <div className="ygd-studio-empty">{t.noMounts}</div>}
            {workspace.mounts.filter(mount => `${mount.name} ${mount.description} ${mount.title?.[locale] ?? ''} ${mount.displayDescription?.[locale] ?? ''}`.toLowerCase().includes(mountQuery.toLowerCase())).map(mount => bundleCard(mount, mount.mountedBy.length, true))}
          </div>

        </>
        : <>
          <KitFiles key={kitKey} client={client} name={workspace.name} version={workspace.version} mindset={workspace.mindsetSource} description={workspace.displayDescription?.[locale] ?? workspace.description} locale={locale} canNavigate={() => !draftDirty.current || window.confirm(locale === 'zh' ? '放弃未保存的修改？' : 'Discard unsaved changes?')} />
        </>}
    </div>
  </main>

  const instanceKind = localInstances.find(record => record.id === instanceId)?.kind
  const objectAuthoring = instanceMode === 'edit' && !!instanceId && !!instances && !componentsOpen
  const visibleSection = instanceKind === 'bundle' ? 'bundles' : instanceKind === 'kit' ? 'kits' : snapshot.section
  const contentView = componentsOpen && componentLibrary ? <ComponentLibrary library={componentLibrary} locale={locale} /> : <>
        {snapshot.phase === 'loading' && !instanceId ? <main className="ygd-studio-main"><LoadingIndicator label={t.loading} /></main> : instanceId && instances ? presentInstanceWorkbench({ client: instances, id: instanceId, readOnly: instanceMode === 'read', onEdit: () => setInstanceMode('edit'), initialSelection: !entryRevisionConsumed && entryInstance?.id === instanceId ? entryInstance : undefined, locale, authoringIntent, renderPreview: renderPreview ?? authoring?.renderPreview, onBack: () => leaveDrafts(() => visibleSection === 'bundles' ? controller.setSection('bundles') : controller.backToList()), onExport: contentClient ? exportInstance : undefined, onChanged: record => { if (!record) { setTrashNotice(value => value + 1); controller.setSection(visibleSection) } setEntryRevisionConsumed(true); if (record && record.id !== instanceId) setInstanceMode('read'); setInstanceId(record?.id); void refreshInstances().catch(error => setAuthoringError(String(error))) }, onDirtyChange: (value, state) => { draftDirty.current = value; sourceDirty.current = state?.sourceDirty ?? value; onDraftDirtyChange?.(value || authoringDirty.current) } }, instanceMode === 'edit' ? renderInstanceWorkbench : undefined) : bundleMain !== undefined ? bundleMain : snapshot.section === 'bundles' ? bundlesListMain : kitMain}
        </>

  return <StudioSelectContext.Provider value={renderSelect}><section className="ygd-studio-workspace" aria-label="Design Studio">
    <style>{STUDIO_WORKSPACE_CSS}</style>
    <button className="ygd-studio-menu-btn" type="button" aria-label="Toggle menu" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
    <div className="ygd-studio-body">
      <aside className={`ygd-studio-sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Product navigation">
        <div className="ygd-studio-sidebar-logo">Yugoo Design</div>
        <nav className="ygd-studio-sidebar-nav" aria-label="Studio sections">
          <button className="ygd-studio-sidebar-item" type="button" aria-current={!componentsOpen && !bundleWorkspace && visibleSection === 'kits' ? 'page' : undefined} onClick={() => leaveDrafts(() => { setComponentsOpen(false); controller.backToList() })}><StudioGlyph />{t.kitsTitle}</button>
          <button className="ygd-studio-sidebar-item" type="button" aria-current={!componentsOpen && (bundleWorkspace || visibleSection === 'bundles') ? 'page' : undefined} onClick={() => leaveDrafts(() => { setComponentsOpen(false); controller.setSection('bundles') })}><StudioGlyph bundle />{t.bundlesTitle}</button>
        </nav>
        <div className="ygd-studio-sidebar-footer">{componentLibrary && <nav className="ygd-studio-sidebar-utilities" aria-label={locale === 'zh' ? 'Studio 工具' : 'Studio utilities'}><button className="ygd-studio-sidebar-item" type="button" aria-current={componentsOpen ? 'page' : undefined} onClick={() => leaveDrafts(() => setComponentsOpen(true))}><span className="ygd-studio-kitmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span>{locale === 'zh' ? '面板组件库' : 'Panel Component Library'}</button></nav>}<div className="ygd-studio-language" role="group" aria-label={locale === 'zh' ? '界面语言' : 'Interface language'}>
          <button type="button" lang="zh-CN" aria-pressed={locale === 'zh'} onClick={() => changeLocale('zh')}>中文</button>
          <button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => changeLocale('en')}>EN</button>
        </div></div>
      </aside>
      <div className="ygd-studio-stage">
        <div className="ygd-studio-topbar"><span aria-label="Breadcrumb">
          <button className="ygd-studio-breadcrumb-button" type="button" onClick={() => { if (!componentsOpen) leaveDrafts(() => visibleSection === 'kits' ? controller.backToList() : controller.setSection('bundles')) }}>{componentsOpen ? (locale === 'zh' ? '面板组件库' : 'Panel Component Library') : visibleSection === 'kits' ? t.kitsTitle : t.bundlesTitle}</button>
          {!componentsOpen && !instanceId && workspace && <><span aria-hidden="true">/</span>{bundleWorkspace ? <button className="ygd-studio-breadcrumb-button" type="button" onClick={() => leaveDrafts(() => controller.closeBundleWorkspace())}>{displayName(workspace.name)}</button> : <span aria-current="page">{displayName(workspace.name)}</span>}</>}
          {!componentsOpen && !instanceId && bundleWorkspace && <><span aria-hidden="true">/</span>{bundleTitle(bundleWorkspace.name, bundleWorkspace.version)}</>}
          {!componentsOpen && instanceId && <><span aria-hidden="true">/</span>{localInstances.find(record => record.id === instanceId)?.title[locale]}</>}
        </span><div className="ygd-studio-topbar-actions">{!componentsOpen && <button className="ygd-studio-btn-link" type="button" disabled={snapshot.phase === 'loading' || refreshBusy} onClick={() => leaveDrafts(() => { void (async () => {
          if (!await refreshCatalog(refreshFailure?.imported)) return
          if (workspace) await controller.selectKit(workspace.name, workspace.version)
          if (bundleWorkspace) { await controller.openBundleWorkspace(bundleWorkspace.name, bundleWorkspace.version); if (bundleFile) await controller.openBundleFile(bundleFile.path) }
        })() })}>{locale === 'zh' ? '刷新内容' : 'Refresh content'}</button>}</div></div>
        <div className="ygd-studio-notification-area" hidden={componentsOpen}>
        {trashNotice > 0 && <StudioFeedback feedbackId={`trash:${trashNotice}`} tone="success" locale={locale} title={locale === 'zh' ? '已移到系统回收站' : 'Moved to the system Trash'} />}
        {authoringError && <StudioFeedback feedbackId={`authoring:${authoringError}`} tone="error" locale={locale} title={locale === 'zh' ? '未能完成操作' : 'Could not complete the operation'} message={authoringError} />}
        {refreshFailure && <StudioFeedback feedbackId={`refresh:${refreshGeneration.current}`} tone="error" locale={locale}
          title={refreshFailure.imported ? (locale === 'zh' ? `「${refreshFailure.imported}」已导入，列表刷新失败。` : `“${refreshFailure.imported}” was imported, but the list could not refresh.`) : (locale === 'zh' ? '无法刷新内容' : 'Could not refresh content')}
          message={refreshFailure.message} actions={[{ label: locale === 'zh' ? '重试刷新' : 'Retry refresh', onClick: () => { void refreshCatalog(refreshFailure.imported) }, disabled: refreshBusy }]} />}
          {importFeedback}
        </div>
        {objectAuthoring && renderContent ? renderContent(contentView, { id: instanceId!, intent: authoringIntent, initialPrompt, onDirtyChange: authoringDirtyChange }) : contentView}
      </div>
    </div>
    {instances?.importSources && <>
      <input ref={importFileInput} type="file" hidden accept=".zip,.md,.json" aria-label={locale === 'zh' ? '选择导入文件' : 'Choose import file'} disabled={importBusy} onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; if (files.length) void importFiles(files, importKind.current) }} />
      <input ref={node => { importFolderInput.current = node; node?.setAttribute('webkitdirectory', '') }} type="file" hidden multiple aria-label={locale === 'zh' ? '选择导入文件夹' : 'Choose import folder'} disabled={importBusy} onChange={event => { const files = [...(event.currentTarget.files ?? [])]; event.currentTarget.value = ''; if (files.length) void importFiles(files, importKind.current) }} />
    </>}
    {mountBundle && <StudioDialog title={`${locale === 'zh' ? '挂载管理' : 'Mount Management'} · ${localMountRecord?.title[locale] ?? mountBundle.name}`} close={closeMounts}>
      <BundleMounts onEditKit={instances?.editCurrent ? kit => { closeMounts(); void editInstalled('kit', kit) } : undefined} client={instances} bundle={mountBundle}
        installed={localMountRecord ? [] : snapshot.view?.bundles.find(bundle => bundle.name === mountBundle.name && bundle.version === mountBundle.version)?.usedBy ?? []} locale={locale} />
    </StudioDialog>}
    {incompleteImport && <StudioDialog title={locale === 'zh' ? '已导入，内容待完善' : 'Imported — needs completion'} close={() => setIncompleteImport(undefined)}>
      <p>{incompleteImport.title[locale]}</p>
      <ul className="ygd-studio-import-issues">{incompleteImport.readiness?.diagnostics.map((issue, index) => <li key={index}>{locale === 'zh' && issue.code === 'instance.missing_source' && issue.path ? `缺少 ${issue.path}` : issue.message}</li>)}</ul>
      <p>{locale === 'zh' ? '可以先保留，稍后继续编辑。' : 'You can keep this copy and finish it later.'}</p>
      <footer className="ygd-studio-modal-actions">
        <button className="ygd-studio-btn-secondary" type="button" onClick={() => setIncompleteImport(undefined)}>{locale === 'zh' ? '暂不补齐' : 'Not now'}</button>
        <button className="ygd-studio-btn-primary" type="button" onClick={() => {
          const record = incompleteImport
          leaveDrafts(() => {
            setIncompleteImport(undefined); setInstanceMode('edit'); setInstanceId(record.id)
            if (record.kind === 'bundle') setInitialPrompt(locale === 'zh'
              ? `请使用技能包创作方法，保留当前 SKILL.md 的原有能力、方法和配套资源，补齐这个技能包的缺项并修复以下问题：\n${record.readiness?.diagnostics.map(issue => issue.code === 'instance.missing_source' && issue.path ? `缺少 ${issue.path}` : issue.message).join('\n')}\n请围绕这项技能中用户需要理解、比较、修改或确认的内容，设计贴合任务的可交互面板，并提供能体现主要用途的预览样例。保存后的判断和修改应能继续供 Agent 使用。请提供可查看差异并保存的修改建议。`
              : `Use the Bundle authoring skill to complete this Bundle, preserving its existing SKILL.md capabilities, methods and supporting resources. Address these issues:\n${record.readiness?.diagnostics.map(issue => issue.message).join('\n')}\nDesign an interactive Panel suited to what people need to understand, compare, change or confirm in this skill, with a representative preview example. Saved decisions and edits should remain available for the Agent to continue using. Return source changes that can be reviewed as a diff and saved.`)
          })
        }}>{incompleteImport.kind === 'bundle' ? locale === 'zh' ? 'AI 补齐' : 'Complete with AI' : locale === 'zh' ? '继续编辑' : 'Edit'}</button>
      </footer>
    </StudioDialog>}
    {fileLocationOpen && <StudioDialog title={locale === 'zh' ? '文件位置' : 'File location'} close={() => setFileLocationOpen(false)}>
      <p>{bundleWorkspace ? `${bundleWorkspace.name}/${bundleFile?.path ?? ''}` : 'mindset.md'}</p>
      <p>{locale === 'zh' ? '当前为包内相对路径。此宿主尚未提供本机绝对路径或打开编辑器接口。' : 'Package-relative path. This host does not expose a local absolute path or editor launch capability.'}</p>
    </StudioDialog>}
  </section></StudioSelectContext.Provider>
}
