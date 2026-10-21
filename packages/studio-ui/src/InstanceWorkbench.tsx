/** Editable local source instances. Persistence and preview remain host capabilities. */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { DesignBundleVersionPin, DesignKitVersionPin, StudioPanelPreviewResult } from 'dsh-design-studio'
import type { StudioAuthoring } from './PanelDraftWorkbench.tsx'
import { renderStudioDocument } from './markdown.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { StudioSelect } from './StudioSelect.tsx'
import { MountEditor } from './MountEditor.tsx'
import { FileExplorer } from './FileExplorer.tsx'
import { FileInfoSidebar, FilePurpose } from './FileInfoSidebar.tsx'

export interface StudioInstance {
  readonly id: string
  readonly kind: 'kit' | 'bundle'
  readonly title: { readonly zh: string; readonly en: string }
  readonly description?: string
  readonly displayDescription?: { readonly zh: string; readonly en: string }
  readonly source: { readonly kit?: DesignKitVersionPin; readonly bundle?: DesignBundleVersionPin }
  readonly kit?: DesignKitVersionPin
  readonly bundle?: DesignBundleVersionPin
  readonly revision: number
  readonly files?: readonly { readonly path: string; readonly bytes: number; readonly editable: boolean }[]
  readonly mounts: readonly { readonly bundle: DesignBundleVersionPin; readonly instanceId?: string }[]
  readonly refs: readonly { readonly id: string; readonly title: { readonly zh: string; readonly en: string } }[]
  readonly deletedAt?: string
  readonly availableBundles?: readonly (DesignBundleVersionPin & { readonly title: { readonly zh: string; readonly en: string }; readonly instanceId?: string; readonly revision?: number; readonly runtimeName?: string })[]
}

export interface StudioInstanceClient {
  list(input?: { kind?: 'kit' | 'bundle' }): Promise<readonly StudioInstance[]>
  read(input: { id: string }): Promise<StudioInstance>
  copy(input: { kind: 'kit' | 'bundle'; kit?: DesignKitVersionPin; bundle?: DesignBundleVersionPin; title?: { zh: string; en: string }; sourceId?: string; mountInstanceIds?: string[] }): Promise<StudioInstance>
  rename(input: { id: string; expectedRevision: number; title: { zh: string; en: string } }): Promise<StudioInstance>
  remove(input: { id: string; expectedRevision: number }): Promise<{ id: string; revision: number; deletedAt: string; recoverable: true }>
  readFile(input: { id: string; path: string }): Promise<{ id: string; revision: number; path: string; content: string }>
  saveFile(input: { id: string; expectedRevision: number; path: string; content: string }): Promise<StudioInstance>
  preview(input: { id: string; expectedRevision: number; bundle?: DesignBundleVersionPin; locale?: string }): Promise<StudioPanelPreviewResult>
  updateMounts?(input: { id: string; expectedRevision: number; bundles: readonly (DesignBundleVersionPin & { readonly instanceId?: string; readonly revision?: number })[] }): Promise<StudioInstance>
}

export interface InstanceWorkbenchProps {
  client: StudioInstanceClient
  id: string
  locale: 'zh' | 'en'
  onBack: () => void
  onChanged: (record?: StudioInstance) => void
  renderPreview?: StudioAuthoring['renderPreview']
  onDirtyChange?: (dirty: boolean) => void
}

export function InstanceWorkbench({ client, id, locale, onBack, onChanged, renderPreview, onDirtyChange }: InstanceWorkbenchProps): ReactElement {
  const zh = locale === 'zh'
  const [record, setRecord] = useState<StudioInstance>()
  const [path, setPath] = useState(''), [content, setContent] = useState(''), [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [tab, setTab] = useState<'files' | 'preview'>('files'), [reading, setReading] = useState(false)
  const [renaming, setRenaming] = useState(false), [title, setTitle] = useState('')
  const [preview, setPreview] = useState<StudioPanelPreviewResult>(), [previewBusy, setPreviewBusy] = useState(false)
  const [bundleKey, setBundleKey] = useState('')
  const [mountsOpen, setMountsOpen] = useState(false)
  const generation = useRef(0), fileRequest = useRef(0), previewRequest = useRef(0)
  const dirty = loaded && content !== saved
  const titleDirty = renaming && title !== record?.title[locale]
  const notifyDirty = useRef(onDirtyChange); notifyDirty.current = onDirtyChange
  const fail = (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))

  useEffect(() => {
    const current = ++generation.current
    ++fileRequest.current; ++previewRequest.current
    setRecord(undefined); setPath(''); setContent(''); setSaved(''); setLoaded(false); setBusy(false); setError(''); setPreview(undefined); setPreviewBusy(false); setRenaming(false); setTab('files'); setBundleKey('')
    void client.read({ id }).then(value => {
      if (generation.current !== current || value.id !== id) return
      setRecord(value)
      setPath(value.files?.find(file => /(^|\/)(mindset|SKILL)\.md$/.test(file.path))?.path ?? value.files?.[0]?.path ?? '')
      const first = value.mounts[0]?.bundle
      if (first) setBundleKey(`${first.name}@${first.version}`)
    }, failure => { if (generation.current === current) fail(failure) })
    return () => { ++generation.current; ++fileRequest.current; ++previewRequest.current; notifyDirty.current?.(false) }
  }, [client, id])

  useEffect(() => {
    if (!path || !record || record.id !== id) return
    const current = ++fileRequest.current, scope = generation.current
    setLoaded(false); setError('')
    if (record.files?.find(file => file.path === path)?.editable === false) {
      setContent(''); setSaved('')
      return
    }
    void client.readFile({ id, path }).then(value => {
      if (scope !== generation.current || current !== fileRequest.current) return
      if (value.id !== id || value.path !== path || value.revision !== record.revision) { setError(zh ? '副本已在其他位置更新，请重新打开。' : 'This copy changed elsewhere. Reopen it to load the current revision.'); return }
      setContent(value.content); setSaved(value.content); setLoaded(true)
    }, failure => { if (scope === generation.current && current === fileRequest.current) fail(failure) })
    return () => { ++fileRequest.current }
  }, [client, id, path, record?.revision])

  useEffect(() => { notifyDirty.current?.(dirty || titleDirty || busy) }, [dirty, titleDirty, busy])
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || titleDirty || busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { window.removeEventListener('beforeunload', unload) }
  }, [dirty, titleDirty, busy])

  const discard = (): boolean => !(dirty || titleDirty) || window.confirm(zh ? '放弃未保存的修改？' : 'Discard unsaved changes?')
  const restore = () => { setContent(saved); setRenaming(false) }
  const changeTab = (next: 'files' | 'preview') => { if (next === tab || busy || !discard()) return; restore(); setTab(next) }
  const mutate = async (action: () => Promise<StudioInstance | undefined>) => {
    const current = generation.current
    setBusy(true); setError(''); ++previewRequest.current; setPreview(undefined); setPreviewBusy(false)
    try {
      const value = await action()
      if (current !== generation.current) return
      if (value?.id === id) setRecord(value)
      setRenaming(false); onChanged(value)
    } catch (failure) { if (current === generation.current) fail(failure) }
    finally { if (current === generation.current) setBusy(false) }
  }
  const save = () => {
    if (!record || !loaded || !dirty || busy) return
    const text = content
    void mutate(async () => { const value = await client.saveFile({ id, expectedRevision: record.revision, path, content: text }); return value })
  }
  const rename = () => {
    if (!record || busy || !title.trim()) return
    if (title === record.title[locale]) { setRenaming(false); return }
    void mutate(() => client.rename({ id, expectedRevision: record.revision, title: { ...record.title, [locale]: title.trim() } }))
  }
  const duplicate = () => {
    if (!record || busy || !discard()) return
    restore()
    void mutate(() => client.copy({ kind: record.kind, kit: record.source.kit, bundle: record.source.bundle, sourceId: id }))
  }
  const remove = () => {
    if (!record || busy || !discard()) return
    const refs = record.refs.map(ref => ref.title[locale]).join('、')
    const prompt = zh ? `删除「${record.title[locale]}」？${refs ? `以下引用将受影响：${refs}。` : ''}删除后仍会保留可恢复的本地数据。` : `Delete “${record.title[locale]}”? ${refs ? `Affected references: ${refs}. ` : ''}Deletion retains recoverable local data.`
    if (!window.confirm(prompt)) return
    restore()
    void mutate(async () => { await client.remove({ id, expectedRevision: record.revision }); return undefined })
  }

  useEffect(() => {
    if (tab !== 'preview' || !record || busy) return
    const bundle = record.kind === 'bundle' ? record.bundle ?? record.source.bundle : record.mounts.find(mount => `${mount.bundle.name}@${mount.bundle.version}` === bundleKey)?.bundle
    setPreview(undefined)
    if (!bundle) return
    const current = ++previewRequest.current, scope = generation.current
    setPreviewBusy(true); setError('')
    void client.preview({ id, expectedRevision: record.revision, bundle, locale: zh ? 'zh-CN' : 'en-US' }).then(value => {
      if (scope !== generation.current || current !== previewRequest.current) return
      if (value.preview && value.preview.revision !== record.revision) { setError(zh ? '预览版本已过期，请重试。' : 'Preview revision is stale. Please retry.'); return }
      setPreview(value)
    }, failure => { if (scope === generation.current && current === previewRequest.current) fail(failure) }).finally(() => { if (scope === generation.current && current === previewRequest.current) setPreviewBusy(false) })
    return () => { ++previewRequest.current }
  }, [client, id, record?.revision, tab, bundleKey, locale, busy])

  const file = record?.files?.find(entry => entry.path === path)
  return <main className="ygd-studio-main ygd-studio-bundle-main ygd-studio-instance">
    <style>{`.ygd-studio-instance textarea:focus-visible{outline:2px solid var(--ds-primary);outline-offset:-2px}.ygd-studio-instance .ygd-studio-instance-pencil{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;background:transparent;border-radius:6px;color:var(--ds-text-secondary);cursor:pointer}.ygd-studio-instance .ygd-studio-instance-pencil:hover{background:var(--ds-primary-light);color:var(--ds-primary)}`}</style>
    <header className="ygd-studio-content-header"><div>
      <div className="ygd-studio-header-title-group">
        <button type="button" className="ygd-studio-instance-pencil" disabled={busy} aria-label={zh ? '返回' : 'Back'} title={zh ? '返回' : 'Back'} onClick={() => { if (discard()) { restore(); notifyDirty.current?.(false); onBack() } }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14" /></svg></button>
        <span className="ygd-studio-kitmark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></svg></span>
        {renaming ? <input autoFocus aria-label={zh ? '副本名称' : 'Copy title'} className="ygd-studio-search-input" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); rename() } if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) } }} /> : <h1 className="ygd-studio-page-title">{record?.title[locale] ?? (zh ? '正在打开…' : 'Opening…')}</h1>}
        {record && <button className="ygd-studio-instance-pencil" type="button" disabled={busy} aria-label={zh ? '重命名' : 'Rename'} title={zh ? '重命名' : 'Rename'} onClick={() => { if (!discard()) return; restore(); setTitle(record.title[locale]); setRenaming(true) }}><svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m13 3 4 4-9 9-5 1 1-5 9-9ZM11 5l4 4" /></svg></button>}
      </div>
      <div className="ygd-studio-hero-actions"><span className="ygd-studio-installed-status">{zh ? '本地副本 · 未发布' : 'Local copy · unpublished'}</span>{record && <><button type="button" className="ygd-studio-btn-secondary" disabled={busy} onClick={duplicate}>{zh ? '复制' : 'Copy'}</button><button type="button" className="ygd-studio-btn-secondary" disabled={busy} onClick={remove}>{zh ? '删除' : 'Delete'}</button></>}</div>
    </div></header>
    {record?.kind === 'kit' && client.updateMounts && <div className="ygd-studio-doc-toolbar"><button type="button" className="ygd-studio-btn-secondary" disabled={busy} onClick={() => { if (discard()) { restore(); setMountsOpen(!mountsOpen) } }}>{zh ? '挂载管理' : 'Manage mounts'}</button></div>}
    {mountsOpen && record && <MountEditor client={client} record={record} locale={locale} onClose={() => setMountsOpen(false)} onSaved={value => { setRecord(value); setMountsOpen(false); onChanged(value) }} />}
    {error && <p role="alert" style={{ padding: '8px 20px', color: '#b42318', whiteSpace: 'pre-wrap' }}>{error}</p>}
    <div className="ygd-studio-workplane-bar"><button type="button" className="ygd-studio-workplane-tab" aria-pressed={tab === 'files'} disabled={busy} onClick={() => changeTab('files')}>{zh ? '原始文件' : 'Source Files'}</button><button type="button" className="ygd-studio-workplane-tab" aria-pressed={tab === 'preview'} disabled={busy || !record} onClick={() => changeTab('preview')}>{zh ? '面板预览' : 'Panel Preview'}</button></div>
    {tab === 'files' && <div className="ygd-studio-workspace-body ygd-studio-files-layout"><aside className="ygd-studio-file-tree-pane"><div className="ygd-studio-file-tree-header">{zh ? '全部文件' : 'All Files'} · {record?.files?.length ?? 0}</div><FileExplorer paths={record?.files?.map(entry => entry.path) ?? []} selected={path} disabled={busy} openFile={next => { if (next === path || !discard()) return; restore(); setPath(next) }} /></aside><div className="ygd-studio-content-pane">
      <div className="ygd-studio-doc-toolbar"><div className="ygd-studio-file-heading"><strong className="ygd-studio-document-name">{path}</strong><FilePurpose path={path} locale={locale} /></div><div className="ygd-studio-doc-toggle-group">{/\.md$/i.test(path) && <button type="button" className="ygd-studio-doc-toggle" aria-pressed={reading} onClick={() => setReading(!reading)}>{reading ? (zh ? '编辑原文' : 'Edit source') : (zh ? '阅读' : 'Read')}</button>}<button type="button" className="ygd-studio-btn-secondary" disabled={!dirty || busy} onClick={() => { if (discard()) restore() }}>{zh ? '还原' : 'Revert'}</button><button type="button" className="ygd-studio-btn-primary" disabled={!dirty || busy || !file?.editable} onClick={save}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存' : 'Save')}</button></div></div>
      <div className="ygd-studio-document-body" style={{ display: 'flex', flexDirection: 'column' }}>{file?.editable === false ? <p role="status">{zh ? '此文件不支持文本编辑，复制时会完整保留。' : 'This file is not available for text editing. Copies preserve it in full.'}</p> : !loaded ? <p role="status">{error ? (zh ? '无法读取此文件。' : 'Could not load this file.') : path ? (zh ? '读取中…' : 'Loading…') : (zh ? '没有可读取的文件。' : 'No readable files.')}</p> : reading && /\.md$/i.test(path) ? <div>{renderStudioDocument(content, { locale })}</div> : <textarea aria-label={path || 'Source file'} spellCheck={false} value={content} readOnly={busy || !file?.editable} onChange={event => setContent(event.target.value)} style={{ flex: 1, minHeight: 360, width: '100%', resize: 'none', border: 0, padding: 16, boxSizing: 'border-box', background: 'transparent', color: 'inherit', font: '13px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace', tabSize: 2 }} />}</div>
      <footer className="ygd-studio-doc-footer"><span>{dirty ? (zh ? '未保存' : 'Unsaved') : file?.editable ? (zh ? '已保存 · 可编辑' : 'Saved · editable') : (zh ? '只读文件' : 'Read-only file')}</span><span>{loaded ? new TextEncoder().encode(content).length : file?.bytes ?? 0} {zh ? '字节' : 'bytes'}</span></footer>
    </div>{record && <FileInfoSidebar kind={record.kind} description={record.displayDescription?.[locale] ?? record.description} locale={locale} />}</div>}
    {tab === 'preview' && <section className="ygd-studio-content-pane" style={{ minHeight: 320, overflow: 'auto' }}>{record?.kind === 'kit' && <div className="ygd-studio-doc-toolbar"><label>{zh ? 'Bundle ' : 'Bundle '}<StudioSelect aria-label="Preview Bundle" value={bundleKey} onValueChange={setBundleKey} options={record.mounts.map(mount => ({ value: `${mount.bundle.name}@${mount.bundle.version}`, label: `${mount.bundle.name} · ${mount.bundle.version}` }))} /></label></div>}{previewBusy && <LoadingIndicator label={zh ? '正在准备预览' : 'Preparing preview'} />}{preview?.diagnostics.map((entry, index) => <p role="alert" key={index}>{entry.message}</p>)}{preview?.preview && renderPreview ? renderPreview(preview.preview, () => {}, { readOnly: false, toolbarTarget: null }) : !previewBusy && <p>{zh ? '当前没有可用的面板预览。' : 'No panel preview is available.'}</p>}</section>}
  </main>
}
