import { useEffect, useMemo, useRef, useState } from 'react'
import { StudioFeedback } from './StudioFeedback.tsx'
import { BundleCard } from './BundleCard.tsx'
import type { StudioInstance, StudioInstanceClient } from './InstanceWorkbench.tsx'
import { mountSaveMatches, mountWriteWasRejected, selectedMountPins, type PendingMountSave, mountKey } from './mount-save-receipt.ts'

export interface MountEditorActions {
  canSave: boolean; status: string; save: () => Promise<void>
  saveUnverified: boolean; isSaveSubmitted: () => boolean; verifySave: () => Promise<void>
}

interface MountEditorProps { client: StudioInstanceClient; record: StudioInstance; locale: 'zh' | 'en'; onSaved: (value: StudioInstance) => void; onActions: (actions: MountEditorActions | undefined) => void; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }
export function MountEditor(props: MountEditorProps) {
  return <MountEditorSession key={`${props.record.id}:${props.record.revision}`} {...props} />
}
function MountEditorSession({ client, record, locale, onSaved, onActions, onDirtyChange, onBusyChange }: MountEditorProps) {
  const [selected, setSelected] = useState(() => new Set(record.mounts.map(m => mountKey(m.bundle))))
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [saveUnverified, setSaveUnverified] = useState(false)
  const pending = useRef<PendingMountSave>(), working = useRef(false), live = useRef(true)
  const owner = useMemo(() => ({ client, id: record.id, revision: record.revision }), [client, record.id, record.revision])
  const current = useRef(owner); current.current = owner
  const callbacks = useRef({ onSaved, onDirtyChange, onBusyChange }); callbacks.current = { onSaved, onDirtyChange, onBusyChange }
  const zh = locale === 'zh', candidates = record.availableBundles ?? []
  const original = new Set(record.mounts.map(m => mountKey(m.bundle)))
  const dirty = selected.size !== original.size || [...selected].some(key => !original.has(key))
  useEffect(() => { onDirtyChange?.(dirty || saveUnverified) }, [dirty, saveUnverified, onDirtyChange])
  useEffect(() => { live.current = true; return () => { live.current = false; callbacks.current.onDirtyChange?.(false); callbacks.current.onBusyChange?.(false) } }, [])
  useEffect(() => {
    working.current = false; setBusy(false); callbacks.current.onBusyChange?.(false)
    if (pending.current) { setSaveUnverified(true); setError(zh ? '连接已改变，请核对上次挂载保存结果。' : 'The connection changed. Verify the previous mount save.') }
  }, [owner])
  const keyOf = mountKey
  const choices = new Map(candidates.map(bundle => [keyOf(bundle), bundle]))
  const missing = [...selected].filter(key => !choices.has(key))
  const available = candidates.filter(bundle => !selected.has(keyOf(bundle)))
  const filtered = available.filter(bundle => [bundle.name, bundle.title[locale], bundle.displayDescription?.[locale], bundle.description].filter(Boolean).join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  const change = (key: string, add: boolean) => {
    if (working.current || pending.current) return
    setSelected(previous => { const next = new Set(previous); if (add) next.add(key); else next.delete(key); return next })
  }
  const save = async () => {
    if (!client.updateMounts || working.current || pending.current || !dirty) return
    working.current = true
    const valid = () => live.current && current.current === owner
    setBusy(true); onBusyChange?.(true); setError('')
    try {
      const submitted = { base: structuredClone(record), bundles: selectedMountPins(record, selected) }
      pending.current = submitted
      const saved = await client.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: structuredClone(submitted.bundles) })
      if (!valid()) return
      if (!mountSaveMatches(saved, submitted)) throw Error(zh ? '挂载回执与副本、版本或选择不一致。请核对结果。' : 'The mount receipt does not match the copy, revision or selection. Verify the result.')
      pending.current = undefined; setSaveUnverified(false); callbacks.current.onSaved(saved)
    } catch (failure) { if (valid()) {
      if (mountWriteWasRejected(failure)) pending.current = undefined
      setSaveUnverified(!!pending.current); setError(failure instanceof Error ? failure.message : String(failure))
    } }
    finally { if (valid()) { working.current = false; setBusy(false); callbacks.current.onBusyChange?.(false) } }
  }
  const verifySave = async () => {
    const submitted = pending.current
    if (!submitted || working.current) return
    const valid = () => live.current && current.current === owner
    working.current = true; setBusy(true); onBusyChange?.(true); setError('')
    try {
      const saved = await client.read({ id: submitted.base.id })
      if (!valid()) return
      if (!mountSaveMatches(saved, submitted)) throw Error(zh ? '当前副本尚不能确认这次保存，选择仍保留。不会自动重试写入。' : 'The current copy does not confirm this save. Your selection is retained; the write will not retry automatically.')
      pending.current = undefined; setSaveUnverified(false); callbacks.current.onSaved(saved)
    } catch (failure) { if (valid()) setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { if (valid()) { working.current = false; setBusy(false); callbacks.current.onBusyChange?.(false) } }
  }
  useEffect(() => {
    onActions({ canSave: !!client.updateMounts && !busy && !pending.current && dirty, save, verifySave, saveUnverified, isSaveSubmitted: () => !!pending.current,
      status: saveUnverified ? (zh ? '保存结果待核对' : 'Save needs verification') : dirty ? (zh ? `未保存 · 新增 ${[...selected].filter(key => !original.has(key)).length} · 移除 ${[...original].filter(key => !selected.has(key)).length}`
        : `Unsaved · ${[...selected].filter(key => !original.has(key)).length} added · ${[...original].filter(key => !selected.has(key)).length} removed`) : (zh ? '已保存' : 'Saved') })
  }, [selected, record, busy, dirty, saveUnverified, locale, client, onActions])
  useEffect(() => () => onActions(undefined), [onActions])
  return <section className="ygd-studio-mounts-editor" aria-label={zh ? '挂载管理' : 'Mount management'}>
    <div className="ygd-studio-mounts-columns">
      <section className="ygd-studio-mounts-column ygd-studio-mounts-candidates" aria-label={zh ? '全部备选' : 'Available Bundles'}>
        <header className="ygd-studio-mounts-heading"><h2>{zh ? '全部备选' : 'Available Bundles'}</h2><span>{filtered.length === available.length ? available.length : `${filtered.length} / ${available.length}`}</span>
          <input type="search" className="ygd-studio-search-input ygd-studio-mounts-search" aria-label={zh ? '搜索备选技能包' : 'Search available Bundles'} placeholder={zh ? '搜索技能包…' : 'Search Bundles…'} value={query} onChange={e => setQuery(e.target.value)} />
        </header>
        <div className="ygd-studio-mounts-card-list">
          {filtered.map(bundle => { const key = keyOf(bundle); return <BundleCard key={key} bundle={bundle} locale={locale}>
            <button type="button" className="ygd-studio-btn-secondary" disabled={busy || saveUnverified} onClick={() => change(key, true)}>{zh ? '添加' : 'Add'}</button>
          </BundleCard> })}
          {!filtered.length && <p className="ygd-studio-empty">{!available.length ? (zh ? '可用技能包均已挂载。' : 'All available Bundles are mounted.') : (zh ? '没有匹配的技能包。' : 'No matching Bundles.')}</p>}
        </div>
      </section>
      <section className="ygd-studio-mounts-column ygd-studio-mounts-selected" aria-label={zh ? '已挂载' : 'Mounted Bundles'}>
        <header className="ygd-studio-mounts-heading"><h2>{zh ? '已挂载' : 'Mounted Bundles'}</h2><span>{selected.size}</span></header>
        <div className="ygd-studio-mounts-card-list">
          {[...selected].map(key => {
            const bundle = choices.get(key) ?? record.mounts.find(mount => keyOf(mount.bundle) === key)?.bundle ?? { name: key.split('@')[0], version: key.split('@')[1] }
            return <BundleCard key={key} bundle={bundle} locale={locale}>
              {!choices.has(key) && <StudioFeedback feedbackId={`source:${key}`} layout="inline" tone="info" locale={locale} title={zh ? '来源暂不可用' : 'Source unavailable'} />}
              <button type="button" className="ygd-studio-btn-secondary" disabled={busy || saveUnverified} onClick={() => change(key, false)}>{zh ? '移除' : 'Remove'}</button>
            </BundleCard>
          })}
          {!selected.size && <p className="ygd-studio-empty">{zh ? '从左侧添加技能包。' : 'Add Bundles from the left.'}</p>}
        </div>
      </section>
    </div>
    {(error || saveUnverified) && <StudioFeedback feedbackId={`mount:${record.id}:${record.revision}:${saveUnverified}:${error}`} tone="error" locale={locale}
      title={saveUnverified ? (zh ? '挂载保存结果待核对，选择已保留' : 'Mount save needs verification; your selection is retained') : (zh ? '未能保存挂载，选择已保留' : 'Mounts could not be saved; your selection is retained')}
      message={saveUnverified ? (zh ? '核对仅读取当前副本，不会再次提交保存。' : 'Verification reads the current copy without submitting another save.') : undefined}
      details={error ? [{ message: error }] : []} actions={saveUnverified ? [{ label: zh ? '核对挂载结果' : 'Verify mounts', disabled: busy, onClick: () => { void verifySave() } }] : []} />}
    {!!missing.length && <StudioFeedback feedbackId="missing-mount-source" layout="inline" tone="info" locale={locale} title={zh ? '部分已挂载来源暂不可用。保存会保留这些挂载。' : 'Some mounted sources are unavailable. Saving will preserve these mounts.'} />}
    {!selected.size && <StudioFeedback feedbackId="empty-mounts" layout="inline" tone="info" locale={locale} title={zh ? '尚未挂载技能包，可稍后添加。' : 'No Bundles are mounted yet. You can add them later.'} />}
  </section>
}
