/** Kit-owned source editing with immutable mounts and isolated runtime previews. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { DesignKitVersionPin, DesignBundleVersionPin, StudioKitDraftRecord, StudioKitDraftEdit, StudioKitDraftValidation, StudioPanelPreviewResult } from 'dsh-design-studio'
import type { StudioAuthoring } from './PanelDraftWorkbench.tsx'
import { StudioSelect } from './StudioSelect.tsx'

export interface StudioKitAuthoringClient {
  create(input: { kit: DesignKitVersionPin }): Promise<StudioKitDraftRecord>
  list(): Promise<readonly Pick<StudioKitDraftRecord, 'id' | 'revision' | 'baseKit' | 'confirmed'>[]>
  read(id: string): Promise<StudioKitDraftRecord>
  save(input: StudioKitDraftEdit): Promise<StudioKitDraftRecord>
  validate(input: { id: string; expectedRevision: number }): Promise<StudioKitDraftValidation>
  preview(input: { id: string; expectedRevision: number; bundle: DesignBundleVersionPin; sampleSource: string }): Promise<StudioPanelPreviewResult>
  confirm(input: { id: string; expectedRevision: number }): Promise<StudioKitDraftValidation & { draft?: StudioKitDraftRecord }>
  fork(id: string): Promise<StudioKitDraftRecord>
}
export interface StudioKitAuthoring { client: StudioKitAuthoringClient; renderPreview: StudioAuthoring['renderPreview'] }

/** A request cannot replace newer edits or survive an editor's disposal. */
export class StudioKitDraftController {
  private generation = 0
  private listeners = new Set<() => void>()
  private state: { record: StudioKitDraftRecord; mindsetSource: string; relationsSource: string | null; dirty: boolean; busy: boolean; validation?: StudioKitDraftValidation; preview?: StudioPanelPreviewResult; error?: string }
  constructor(record: StudioKitDraftRecord, private client: StudioKitAuthoringClient) { this.state = { record, mindsetSource: record.mindsetSource, relationsSource: record.relationsSource, dirty: false, busy: false } }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }
  edit(patch: { mindsetSource?: string; relationsSource?: string | null }) {
    if (this.state.record.confirmed || this.state.busy) return
    this.generation++
    const next = { ...this.state, ...patch }
    this.update({ ...patch, dirty: next.mindsetSource !== next.record.mindsetSource || next.relationsSource !== next.record.relationsSource, validation: undefined, preview: undefined, error: undefined })
  }
  clearPreview() { if (this.state.busy) return; this.generation++; this.update({ preview: undefined, busy: false }) }
  dispose() { this.generation++; this.listeners.clear() }
  async perform(action: 'save' | 'validate' | 'confirm' | 'fork' | 'preview', input?: { bundle: DesignBundleVersionPin; sampleSource: string }): Promise<StudioKitDraftRecord | undefined> {
    const s = this.state
    if (s.busy || (s.record.confirmed && action !== 'fork' && action !== 'preview') || (s.dirty && action !== 'save') || (action === 'preview' && !input)) return
    const generation = ++this.generation
    this.update({ busy: true, error: undefined })
    try {
      const pin = { id: s.record.id, expectedRevision: s.record.revision }
      let record: StudioKitDraftRecord | undefined
      if (action === 'save') record = await this.client.save({ ...pin, mindsetSource: s.mindsetSource, relationsSource: s.relationsSource })
      else if (action === 'fork') record = await this.client.fork(s.record.id)
      else if (action === 'preview') {
        const preview = await this.client.preview({ ...pin, ...input! })
        if (preview.preview && (preview.preview.revision !== pin.expectedRevision || preview.preview.bundle.name !== input!.bundle.name || preview.preview.bundle.version !== input!.bundle.version)) throw new Error('Preview identity does not match the saved revision and mounted Bundle.')
        if (generation === this.generation) this.update({ preview })
      } else {
        const result = action === 'confirm' ? await this.client.confirm(pin) : await this.client.validate(pin)
        if (result.revision !== pin.expectedRevision) throw new Error('Validation does not match the saved revision.')
        if (generation === this.generation) this.update({ validation: result })
        if ('draft' in result) record = result.draft as StudioKitDraftRecord | undefined
      }
      if (generation !== this.generation) return
      if (record) this.update({ record, mindsetSource: record.mindsetSource, relationsSource: record.relationsSource, dirty: false, validation: action === 'confirm' ? this.state.validation : undefined, preview: undefined })
      return record
    } catch (error) { if (generation === this.generation) this.update({ error: error instanceof Error ? error.message : String(error) }) }
    finally { if (generation === this.generation) this.update({ busy: false }) }
  }
}

const words = {
  zh: { title: 'Kit 工作副本', empty: '从 Kit 工作区选择“定制 Kit”开始。', hint: '只编辑 Kit 自有文件；挂载的 Bundle 保持只读。确认锁定工作副本，不代表发布。', save: '保存', validate: '校验', confirm: '确认并锁定', fork: '派生新副本', preview: '预览面板', sample: '样例 JSON', mounts: '挂载 Bundle（只读）', relations: '包含 relations.yaml', discard: '离开会丢失尚未保存的修改，继续吗？', dirty: '有未保存修改', valid: '校验通过', locked: '已确认', draft: '工作副本', pending: '处理中…' },
  en: { title: 'Kit Working Copies', empty: 'Choose “Customize Kit” from a Kit workspace to start.', hint: 'Edit Kit-owned files only; mounted Bundles are read-only. Confirmation locks the working copy without publishing it.', save: 'Save', validate: 'Validate', confirm: 'Confirm and lock', fork: 'Fork working copy', preview: 'Preview panel', sample: 'Sample JSON', mounts: 'Mounted Bundles (read-only)', relations: 'Include relations.yaml', discard: 'Discard unsaved changes and leave?', dirty: 'Unsaved changes', valid: 'Validation passed', locked: 'Confirmed', draft: 'Working copy', pending: 'Working…' },
}

export function KitDraftWorkbench({ authoring, initialId, locale, onDirtyChange }: { authoring: StudioKitAuthoring; initialId?: string; locale: 'zh' | 'en'; onDirtyChange: (dirty: boolean) => void }): ReactElement {
  const t = words[locale]
  const [items, setItems] = useState<Awaited<ReturnType<StudioKitAuthoringClient['list']>>>([])
  const [selected, setSelected] = useState<StudioKitDraftRecord>()
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const generation = useRef(0), dirty = useRef(false)
  const refresh = async (request: number) => { try { const result = await authoring.client.list(); if (request === generation.current) setItems(result) } catch (failure) { if (request === generation.current) setError(String(failure)) } }
  const select = async (id: string) => {
    if (dirty.current && !window.confirm(t.discard)) return
    const request = ++generation.current
    setError(''); setOpening(true)
    try { const record = await authoring.client.read(id); if (request === generation.current) { dirty.current = false; onDirtyChange(false); setSelected(record); void refresh(request) } }
    catch (failure) { if (request === generation.current) setError(String(failure)) }
    finally { if (request === generation.current) setOpening(false) }
  }
  useEffect(() => { const request = ++generation.current; void refresh(request); if (initialId) void select(initialId); return () => { generation.current++; onDirtyChange(false) } }, [authoring, initialId])
  const selectionGeneration = generation.current
  return <main className="ygd-studio-main">
    <header className="ygd-studio-content-header"><h1 className="ygd-studio-page-title">{t.title}</h1><p className="ygd-studio-subtitle">{t.hint}</p></header>
    {error && <p role="alert">{error}</p>}
    <div className="ygd-studio-draft-layout"><aside className="ygd-studio-draft-list" aria-label={t.title}>{items.map(item => <button type="button" key={item.id} aria-current={selected?.id === item.id ? 'page' : undefined} onClick={() => void select(item.id)}>{item.baseKit.name} · r{item.revision} · {item.confirmed ? t.locked : t.draft}</button>)}</aside>
      {selected ? <KitDraftEditor key={`${selected.id}:${selected.revision}`} record={selected} authoring={authoring} locale={locale} opening={opening} onDirtyChange={value => { dirty.current = value; onDirtyChange(value) }} onRecord={record => { if (selectionGeneration !== generation.current) return; const request = ++generation.current; setSelected(record); void refresh(request) }} /> : <p className="ygd-studio-empty">{t.empty}</p>}
    </div>
  </main>
}

function KitDraftEditor({ record, authoring, locale, opening, onDirtyChange, onRecord }: { record: StudioKitDraftRecord; authoring: StudioKitAuthoring; locale: 'zh' | 'en'; opening: boolean; onDirtyChange: (dirty: boolean) => void; onRecord: (record: StudioKitDraftRecord) => void }): ReactElement {
  const t = words[locale]
  const controller = useMemo(() => new StudioKitDraftController(record, authoring.client), [record.id, record.revision, authoring])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [bundleKey, setBundleKey] = useState(''), [sample, setSample] = useState('{}')
  useEffect(() => () => controller.dispose(), [controller])
  useEffect(() => { onDirtyChange(state.dirty); const unload = (event: BeforeUnloadEvent) => { if (state.dirty) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload) }, [state.dirty])
  const run = async (action: Parameters<StudioKitDraftController['perform']>[0]) => {
    if (opening) return
    const bundle = record.mounts.find(mount => `${mount.name}@${mount.version}` === bundleKey)
    const next = await controller.perform(action, bundle ? { bundle, sampleSource: sample } : undefined)
    if (next) onRecord(next)
  }
  const disabled = opening || state.busy || record.confirmed
  return <section className="ygd-studio-draft-editor">
    <h2>{record.baseKit.name} @{record.baseKit.version} · r{record.revision} · {record.confirmed ? t.locked : t.draft}</h2>
    <div className="ygd-studio-draft-toolbar">
      <button type="button" disabled={disabled || !state.dirty} onClick={() => void run('save')}>{t.save}</button>
      <button type="button" disabled={disabled || state.dirty} onClick={() => void run('validate')}>{t.validate}</button>
      <button type="button" disabled={disabled || state.dirty || state.validation?.valid !== true} onClick={() => void run('confirm')}>{t.confirm}</button>
      {record.confirmed && <button type="button" disabled={opening || state.busy} onClick={() => void run('fork')}>{t.fork}</button>}
      <span role="status">{opening || state.busy ? t.pending : state.dirty ? t.dirty : state.validation?.valid ? t.valid : ''}</span>
    </div>
    {state.error && <p role="alert">{state.error}</p>}
    <ul className="ygd-studio-diagnostics">{[...(state.validation?.diagnostics ?? []), ...(state.preview?.diagnostics ?? [])].map((entry, index) => <li key={index}><strong>{entry.code}</strong>: {entry.message}</li>)}</ul>
    <fieldset className="ygd-studio-draft-sources" disabled={disabled}><label>mindset.md<textarea aria-label="mindset.md" value={state.mindsetSource} onChange={event => controller.edit({ mindsetSource: event.target.value })} /></label>
      <label><input type="checkbox" checked={state.relationsSource !== null} onChange={event => controller.edit({ relationsSource: event.target.checked ? '' : null })} />{t.relations}</label>
      {state.relationsSource !== null && <label>relations.yaml<textarea aria-label="relations.yaml" value={state.relationsSource} onChange={event => controller.edit({ relationsSource: event.target.value })} /></label>}
    </fieldset>
    <h3>{t.mounts}</h3><ul>{record.mounts.map(mount => <li key={`${mount.name}@${mount.version}`}>{mount.name} @{mount.version}</li>)}</ul>
    <div className="ygd-studio-draft-sources"><label>Bundle<StudioSelect aria-label="Preview Bundle" disabled={opening || state.busy} value={bundleKey} onValueChange={value => { controller.clearPreview(); setBundleKey(value) }} options={[{ value: '', label: '—' }, ...record.mounts.map(mount => ({ value: `${mount.name}@${mount.version}`, label: `${mount.name}@${mount.version}` }))]} /></label>
      <label>{t.sample}<textarea aria-label={t.sample} disabled={opening || state.busy} value={sample} onChange={event => { controller.clearPreview(); setSample(event.target.value) }} /></label>
      <button type="button" disabled={opening || state.busy || state.dirty || !bundleKey} onClick={() => void run('preview')}>{t.preview}</button>
    </div>
    {state.preview?.preview && <div className="ygd-studio-draft-preview">{authoring.renderPreview(state.preview.preview, value => { if (opening || controller.getSnapshot().busy) return; controller.clearPreview(); setSample(JSON.stringify(value, null, 2)) }, { readOnly: opening || state.busy })}</div>}
  </section>
}
