/** Optional archive UI capability. No installation, publication or execution ports. */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { StudioContentArchive, StudioKitDraftRecord, DesignKitVersionPin } from 'dsh-design-studio'

export interface StudioContentImportSummary {
  id: string; kind: 'kit' | 'bundle'; pin: { name: string; version: string }
  validation: { valid: boolean; diagnostics: readonly { code: string; message: string }[] }
  executionGranted: false; requiresTrustReview: boolean
}
export interface StudioContentImportRecord {
  id: string; archive: StudioContentArchive; validation: StudioContentImportSummary['validation']
  executionGranted: false; requiresTrustReview: boolean
}
export interface StudioContentAdoptionResult {
  importId: string
  contents: readonly { kind: 'kit' | 'bundle'; pin: { name: string; version: string } }[]
  /** Only Kit adoption creates a new unconfirmed working copy. */
  draft?: StudioKitDraftRecord
  executionGranted: false; requiresTrustReview: boolean
}
export interface StudioContentClient {
  export(input: { kind: 'kit'; pin: DesignKitVersionPin; provenance: { source: string; license: string } }): Promise<string>
  prepare(input: { source: string }): Promise<StudioContentImportRecord>
  list(): Promise<readonly StudioContentImportSummary[]>
  read(input: { id: string }): Promise<StudioContentImportRecord>
  adopt(input: { id: string }): Promise<StudioContentAdoptionResult>
}
const HTTP_BYTES = 12 * 1024 * 1024
/** HTTP counts the JSON wrapper and escaping too, not just the uploaded file. */
export function assertStudioImportRequestSize(source: string): void {
  if (new TextEncoder().encode(JSON.stringify({ method: 'studioContentImport', params: { source } })).byteLength > HTTP_BYTES) throw Error('Archive request exceeds the 12 MiB HTTP limit. No content was truncated or sent.')
}

export class StudioContentArchiveController {
  private generation = 0
  private disposed = false
  private listeners = new Set<() => void>()
  private state: { source: string; fileName?: string; dirty: boolean; busy: boolean; items: readonly StudioContentImportSummary[]; record?: StudioContentImportRecord; error?: string } = { source: '', dirty: false, busy: false, items: [] }
  constructor(private client: StudioContentClient) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  activate() { this.disposed = false; this.update({ busy: false }) }
  reportError(error: unknown) { if (!this.disposed) this.update({ error: error instanceof Error ? error.message : String(error) }) }
  dispose() { this.disposed = true; this.generation++; this.listeners.clear() }
  edit(source: string) { if (this.disposed || this.state.busy) return; this.generation++; this.update({ source, fileName: undefined, dirty: true, error: undefined }) }
  private async request<T>(operation: () => Promise<T>, accept: (result: T) => void): Promise<T | undefined> {
    if (this.disposed || this.state.busy) return
    const generation = ++this.generation
    this.update({ busy: true, error: undefined })
    try { const result = await operation(); if (generation !== this.generation) return; accept(result); return result }
    catch (error) { if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : String(error) }) }
    finally { if (generation === this.generation) this.update({ busy: false }) }
  }
  async refresh() { return this.request(() => this.client.list(), items => this.update({ items })) }
  async loadFile(file: Pick<File, 'size' | 'text'> & Partial<Pick<File, 'name'>>) {
    return this.request(async () => {
      if (file.size > HTTP_BYTES) throw Error('Archive file exceeds the 12 MiB HTTP limit. No content was read or sent.')
      const source = await file.text(); assertStudioImportRequestSize(source); return source
    }, source => this.update({ source, fileName: file.name, dirty: true }))
  }
  async prepare() {
    const source = this.state.source
    return this.request(async () => { assertStudioImportRequestSize(source); return this.client.prepare({ source }) }, record => this.update({ record, dirty: false,
      items: [{ id: record.id, kind: record.archive.kind, pin: record.archive.pin, validation: record.validation, executionGranted: record.executionGranted, requiresTrustReview: record.requiresTrustReview }, ...this.state.items.filter(item => item.id !== record.id)] }))
  }
  async select(id: string) {
    return this.request(async () => {
      const record = await this.client.read({ id })
      if (record.id !== id || record.executionGranted !== false) throw Error('Import response does not match the selected inert archive.')
      return record
    }, record => this.update({ record, source: '', fileName: undefined, dirty: false }))
  }
  async adopt() {
    const record = this.state.record
    if (!record || record.executionGranted !== false || !record.validation.valid || this.state.dirty) return
    return this.request(async () => {
      const result = await this.client.adopt({ id: record.id })
      const identity = (entry: StudioContentAdoptionResult['contents'][number]) => `${entry.kind}:${entry.pin.name}@${entry.pin.version}`
      const expected = [{ kind: record.archive.kind, pin: record.archive.pin }, ...(record.archive.kind === 'kit'
        ? record.archive.dependencies.map(pin => ({ kind: 'bundle' as const, pin })) : [])]
      const actual = Array.isArray(result.contents) ? result.contents.map(identity) : []
      if (result.importId !== record.id || result.executionGranted !== false || result.requiresTrustReview !== record.requiresTrustReview
        || actual.length !== expected.length || new Set(actual).size !== actual.length
        || expected.some(entry => !actual.includes(identity(entry)))
        || (record.archive.kind === 'kit' ? !result.draft || !result.draft.id || result.draft.confirmed !== false || result.draft.revision !== 0
          || result.draft.baseKit.name !== record.archive.pin.name || result.draft.baseKit.version !== record.archive.pin.version
          : result.draft !== undefined)) throw Error('Adoption response does not match the retained content identity and authority.')
      return result
    }, () => {})
  }
  async export(pin: DesignKitVersionPin, provenance: { source: string; license: string }) {
    return this.request(() => this.client.export({ kind: 'kit', pin: { ...pin }, provenance: { ...provenance } }), () => {})
  }
}

const words = {
  en: { title: 'Content Archives', hint: 'Review portable content before adopting it into the local content library. Kit adoption also creates a working copy; existing sources and project pins stay unchanged.', source: 'Archive JSON', file: 'Choose archive file', prepare: 'Prepare import', adopt: 'Adopt Kit and create working copy', adoptBundle: 'Adopt Bundle', export: 'Download installed Kit archive', origin: 'Declared source', license: 'Declared license', declarations: 'Source and license are declarations, not verified authorship or redistribution permission.', trust: 'Trust review required; no execution permission is granted.', inert: 'No execution permission is granted.', invalid: 'Definition validation failed', valid: 'Definition validated', standalone: 'A Bundle is adopted independently. It is not mounted into a Kit or attached to an active project.', discard: 'Discard unprepared archive input?', loading: 'Working…', refresh: 'Refresh imports', selectKit: 'Open an installed Kit workspace to export its exact version.', files: 'Retained files' },
  zh: { title: '内容归档', hint: '审阅归档后采用到本机内容库。采用 Kit 还会创建工作副本；既有来源和项目版本绑定保持不变。', source: '归档 JSON', file: '选择归档文件', prepare: '准备导入', adopt: '采用 Kit 并创建工作副本', adoptBundle: '采用 Bundle', export: '下载已安装 Kit 归档', origin: '声明的来源', license: '声明的许可证', declarations: '来源与许可证仅为声明，不代表作者身份或再分发权限已核实。', trust: '需要信任审查；未授予执行权限。', inert: '未授予执行权限。', invalid: '定义校验失败', valid: '定义校验通过', standalone: 'Bundle 独立采用；不会自动挂载到 Kit 或关联当前项目。', discard: '放弃尚未准备的归档输入？', loading: '处理中…', refresh: '刷新导入记录', selectKit: '请先打开已安装 Kit 工作区，以导出其精确版本。', files: '保留文件数' },
}

export function ContentArchiveWorkbench({ client, installedKit, locale, canAdoptKit, onAdopt, onDirtyChange, onBack }: {
  client: StudioContentClient; installedKit?: DesignKitVersionPin; locale: 'zh' | 'en'; canAdoptKit: boolean
  onAdopt: (result: StudioContentAdoptionResult) => void; onDirtyChange: (dirty: boolean) => void
  onBack?: () => void
}): ReactElement {
  const controller = useMemo(() => new StudioContentArchiveController(client), [client])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [origin, setOrigin] = useState(''), [license, setLicense] = useState('')
  const t = words[locale], record = state.record
  useEffect(() => { controller.activate(); void controller.refresh(); return () => { controller.dispose(); onDirtyChange(false) } }, [controller])
  useEffect(() => { onDirtyChange(state.dirty); const unload = (event: BeforeUnloadEvent) => { if (state.dirty) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload) }, [state.dirty])
  const leaveInput = () => !state.dirty || window.confirm(t.discard)
  const download = async () => {
    if (!installedKit) return
    const source = await controller.export(installedKit, { source: origin, license })
    if (source === undefined) return
    try {
      const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }))
      try { const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${installedKit.name}-${installedKit.version}.studio-content.json`.replace(/[^a-zA-Z0-9_.-]/g, '_'); anchor.click() }
      finally { URL.revokeObjectURL(url) }
    } catch (error) { controller.reportError(error) }
  }
  return <main className="ygd-studio-main ygd-studio-archive">
    <header className="ygd-studio-content-header"><div><div className="ygd-studio-header-title-group">{onBack && <button className="ygd-studio-back" type="button" aria-label={locale === 'zh' ? '返回工作区' : 'Back to workspace'} title={locale === 'zh' ? '返回工作区' : 'Back to workspace'} onClick={onBack}>←</button>}<h1 className="ygd-studio-page-title">{t.title}</h1></div><p className="ygd-studio-subtitle">{t.hint}</p></div></header>
    <div className="ygd-studio-content-body">
    {state.error && <p role="alert">{state.error}</p>}
    <section className="ygd-studio-draft-editor"><h2>1 · {t.prepare}</h2><div className="ygd-studio-draft-toolbar"><label>{t.file}<input type="file" accept="application/json,.json" aria-label={t.file} disabled={state.busy} onChange={event => { const file = event.target.files?.[0]; if (file && leaveInput()) void controller.loadFile(file); event.target.value = '' }} /></label>
      <button type="button" disabled={state.busy} onClick={() => void controller.refresh()}>{t.refresh}</button><span role="status">{state.busy ? t.loading : ''}</span></div>
    <details><summary>{t.source}</summary><div className="ygd-studio-draft-sources"><label>{t.source}<textarea aria-label={t.source} value={state.source} disabled={state.busy} onChange={event => controller.edit(event.target.value)} /></label></div></details>
    {state.source && <p>{state.fileName ?? t.source} · {new TextEncoder().encode(state.source).byteLength} bytes</p>}
    <button className="ygd-studio-btn-primary" type="button" disabled={state.busy || !state.source.trim()} onClick={() => void controller.prepare()}>{t.prepare}</button></section>
    <details><summary>{t.refresh} · {state.items.length}</summary><div className="ygd-studio-draft-list" aria-label={t.title}>{state.items.map(item => <button type="button" key={item.id} disabled={state.busy} aria-current={record?.id === item.id ? 'page' : undefined} onClick={() => { if (leaveInput()) void controller.select(item.id) }}>{item.kind} · {item.pin.name} @{item.pin.version}</button>)}</div></details>
      {record && <section className="ygd-studio-draft-editor"><h2>2 · {record.archive.kind} · {record.archive.pin.name} @{record.archive.pin.version}</h2>
        <p>{t.origin}: {record.archive.provenance.source}</p><p>{t.license}: {record.archive.provenance.license}</p><p>{t.declarations}</p>
        <p>{t.files}: {record.archive.files.length} · Bundle: {record.archive.kind === 'kit' ? record.archive.dependencies.length : 1}</p><p>{record.validation.valid ? t.valid : t.invalid}</p><p>{record.requiresTrustReview ? t.trust : t.inert}</p>
        {record.validation.diagnostics.length > 0 && <ul className="ygd-studio-diagnostics">{record.validation.diagnostics.map((entry, index) => <li key={index}><strong>{entry.code}</strong>: {entry.message}</li>)}</ul>}
        {record.archive.kind === 'bundle' && <p>{t.standalone}</p>}
        {record.archive.kind === 'kit' && !canAdoptKit && <p>{locale === 'zh' ? '此宿主未提供 Kit 编辑能力，可保留归档并查看校验结果。' : 'This host can retain and inspect archives, but does not provide Kit authoring.'}</p>}
        <h3>3 · {record.archive.kind === 'kit' ? t.adopt : t.adoptBundle}</h3><button className="ygd-studio-btn-primary" type="button" disabled={(record.archive.kind === 'kit' && !canAdoptKit) || state.busy || state.dirty || !record.validation.valid} onClick={async () => { const result = await controller.adopt(); if (result) onAdopt(result) }}>{record.archive.kind === 'kit' ? t.adopt : t.adoptBundle}</button>
      </section>}
    <details><summary>{t.export}</summary><section className="ygd-studio-draft-editor">{installedKit ? <p>{installedKit.name} @{installedKit.version}</p> : <p>{t.selectKit}</p>}
      <fieldset className="ygd-studio-draft-sources" disabled={state.busy}><label>{t.origin}<input className="ygd-studio-search-input" aria-label={t.origin} value={origin} onChange={event => setOrigin(event.target.value)} /></label><label>{t.license}<input className="ygd-studio-search-input" aria-label={t.license} value={license} onChange={event => setLicense(event.target.value)} /></label></fieldset>
      <p>{t.declarations}</p><button type="button" disabled={state.busy || !installedKit || !origin.trim() || !license.trim()} onClick={() => void download()}>{t.export}</button>
    </section></details>
    </div>
  </main>
}
