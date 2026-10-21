/** Explicit, isolated Panel authoring; the installed-content viewer stays read-only. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DesignKitVersionPin, DesignBundleVersionPin, StudioPanelDraftEdit, StudioPanelDraftRecord, StudioPanelDraftSummary, StudioPanelPreview, StudioPanelPreviewResult } from 'dsh-design-studio'
import { StudioPanelDraftController } from './panel-draft-controller.ts'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import type { StudioTrialClient } from './trial-controller.ts'

export interface StudioAuthoringClient {
  /** Inspect an installed declarative Panel with sample-only ports; creates no draft. */
  previewInstalled?(input: { kit?: DesignKitVersionPin; bundle: DesignBundleVersionPin; revision: number; sampleSource?: string }): Promise<StudioPanelPreviewResult>
  create(input: { kit: DesignKitVersionPin; bundle: DesignBundleVersionPin; sampleSource?: string }): Promise<StudioPanelDraftRecord>
  list(): Promise<readonly StudioPanelDraftSummary[]>
  read(id: string): Promise<StudioPanelDraftRecord>
  save(input: StudioPanelDraftEdit): Promise<StudioPanelDraftRecord>
  preview(input: StudioPanelDraftEdit & { revision: number }): Promise<StudioPanelPreviewResult>
  confirm(input: { id: string; expectedRevision: number }): Promise<StudioPanelPreviewResult & { draft?: StudioPanelDraftRecord }>
  fork(id: string): Promise<StudioPanelDraftRecord>
}
export interface StudioAuthoring {
  readonly client: StudioAuthoringClient
  /** Must use the shared runtime renderer with isolated sample-only ports. */
  readonly renderPreview: (preview: StudioPanelPreview, adoptSample: (value: Record<string, unknown>) => void, options: { readOnly: boolean; toolbarTarget?: HTMLElement | null }) => ReactElement
}

export function PanelDraftWorkbench({ authoring, initialId, locale, onDirtyChange, onBack }: {
  trials?: StudioTrialClient
  authoring: StudioAuthoring; initialId?: string; locale: 'zh' | 'en'; onDirtyChange: (dirty: boolean) => void; onBack?: () => void
}): ReactElement {
  const [record, setRecord] = useState<StudioPanelDraftRecord>()
  const [error, setError] = useState('')
  const selection = useRef(0)
  useEffect(() => {
    let active = true
    ++selection.current
    setRecord(undefined); setError('')
    if (initialId) void authoring.client.read(initialId).then(value => { if (active) setRecord(value) }, failure => { if (active) setError(String(failure)) })
    return () => { active = false; ++selection.current; onDirtyChange(false) }
  }, [authoring, initialId])
  const generation = selection.current
  return <main className="ygd-studio-main ygd-studio-panel-editor">
    <header className="ygd-studio-editor-heading">
      <button type="button" className="ygd-studio-btn-secondary" onClick={onBack}>{locale === 'zh' ? '← 返回面板' : '← Back to panel'}</button>
      <strong>{locale === 'zh' ? '编辑面板' : 'Edit Panel'}{record ? ' · ' + record.bundle.name : ''}</strong>
      <span>{locale === 'zh' ? '编辑副本，不改动已安装 Kit' : 'Working copy; installed Kit unchanged'}</span>
    </header>
    {error && <p role="alert">{error}</p>}
    {record ? <PanelDraftEditor key={record.id + ':' + record.revision} record={record} authoring={authoring} locale={locale} onDirtyChange={onDirtyChange} onRecord={value => { if (generation === selection.current && value.id === initialId) setRecord(value) }} />
      : <p role="status">{locale === 'zh' ? '正在打开面板…' : 'Opening Panel…'}</p>}
  </main>
}

export function PanelDraftEditor({ record, authoring, locale, onDirtyChange, onRecord, initialPanelSource, initialSelection }: {
  record: StudioPanelDraftRecord; authoring: StudioAuthoring; locale: 'zh' | 'en';
  onDirtyChange: (dirty: boolean) => void; onRecord: (record: StudioPanelDraftRecord) => void
  initialPanelSource?: string
  initialSelection?: { start: number; end: number }
}): ReactElement {
  const zh = locale === 'zh'
  const controller = useMemo(() => new StudioPanelDraftController({ preparePreview: request => authoring.client.preview({
    id: record.id, expectedRevision: record.revision, revision: request.revision,
    panelSource: request.panelSource, sampleSource: request.sampleSource,
  }) }, { kit: record.kit, bundle: record.bundle, revision: record.revision, panelSource: initialPanelSource ?? record.panelSource, sampleSource: record.sampleSource }), [record, authoring])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const sourceInput = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (initialSelection) { sourceInput.current?.focus(); sourceInput.current?.setSelectionRange(initialSelection.start, initialSelection.end) } }, [])
  const lastPreview = useRef<StudioPanelPreview>()
  if (state.preview) lastPreview.current = state.preview
  const preview = state.preview ?? lastPreview.current
  const dirty = state.request.panelSource !== record.panelSource
  useEffect(() => { onDirtyChange(dirty) }, [dirty])
  useEffect(() => {
    const timer = setTimeout(() => { void controller.preview() }, 450)
    return () => clearTimeout(timer)
  }, [controller, state.request.revision])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const save = async () => {
    setBusy(true); setError('')
    try { onRecord(await authoring.client.save({ id: record.id, expectedRevision: record.revision, panelSource: state.request.panelSource, sampleSource: state.request.sampleSource })) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <section className="ygd-studio-panel-split">
    <section className="ygd-studio-yaml-pane">
      <header><strong>panel.yaml</strong><span>{zh ? '本地副本 · ' : 'Local copy · '}{dirty ? (zh ? '未保存' : 'Unsaved') : (zh ? '已保存' : 'Saved')}</span>
        <button className="ygd-studio-btn-primary" type="button" disabled={busy || !dirty || record.confirmed || state.phase !== 'ready'} onClick={() => void save()}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存面板' : 'Save panel')}</button>
      </header>
      <textarea ref={sourceInput} aria-label="Panel YAML" spellCheck={false} readOnly={record.confirmed || busy} value={state.request.panelSource} onChange={event => controller.edit({ panelSource: event.target.value })} />
      {error && <p role="alert">{error}</p>}
      {state.diagnostics.length > 0 && <div className="ygd-studio-editor-errors" role="alert">{state.diagnostics.map((entry, i) => <p key={i}>{entry.message}</p>)}</div>}
    </section>
    <section className="ygd-studio-live-pane">
      <header><strong>{zh ? '面板预览' : 'Panel Preview'}</strong><span aria-live="polite">{state.phase === 'previewing' || state.phase === 'editing' ? (zh ? '更新中…' : 'Updating…') : state.phase === 'invalid' ? (zh ? '请修正 YAML，当前保留上次预览' : 'Fix YAML; showing last valid preview') : (zh ? '随 YAML 自动更新 · 隔离样例' : 'Live YAML preview · isolated sample')}</span></header>
      <div className="ygd-studio-live-pane-body">{preview ? authoring.renderPreview(preview, () => {}, { readOnly: false, toolbarTarget: null }) : state.phase === 'invalid' ? <p role="status">{zh ? '请修正 YAML 后预览。' : 'Fix the YAML to preview.'}</p> : <LoadingIndicator label={zh ? '正在准备样例面板' : 'Preparing sample Panel'} />}</div>
    </section>
  </section>
}
