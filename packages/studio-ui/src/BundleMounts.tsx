import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioInstance, StudioInstanceClient } from './InstanceWorkbench.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { StudioFeedback } from './StudioFeedback.tsx'
import { mountKey, mountSaveMatches, mountWriteWasRejected, selectedMountPins, type PendingMountSave } from './mount-save-receipt.ts'

export function BundleMounts({ client, bundle, installed, locale, onEditKit }: { client?: StudioInstanceClient; bundle: { name: string; version: string }; installed: readonly { name: string; version: string }[]; locale: 'zh' | 'en'; onEditKit?: (kit: { name: string; version: string }) => void }) {
  const owner = useMemo(() => ({ client, name: bundle.name, version: bundle.version }), [client, bundle.name, bundle.version])
  const current = useRef(owner); current.current = owner
  const live = useRef(true), writing = useRef<typeof owner>()
  const pending = useRef<{ owner: typeof owner; save: PendingMountSave }>()
  const [query, setQuery] = useState(''), [retry, refresh] = useState(0)
  const [catalog, setCatalog] = useState<{ owner: typeof owner; kits: readonly StudioInstance[]; busy: boolean; error?: string }>()
  const [operation, setOperation] = useState<{ owner: typeof owner; busy: boolean; error?: string; pending?: PendingMountSave }>()
  const listing = catalog?.owner === owner ? catalog : undefined
  const update = operation?.owner === owner ? operation : undefined
  const kits = listing?.kits ?? [], loading = listing?.busy ?? !!client, busy = loading || !!update?.busy
  const displayedKits = update?.pending && !kits.some(kit => kit.id === update.pending!.base.id) ? [...kits, update.pending.base] : kits
  const zh = locale === 'zh'
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => {
    let active = true
    setCatalog(old => ({ owner, kits: old?.owner === owner ? old.kits : [], busy: !!client }))
    if (!client) return
    void Promise.resolve().then(() => client.list({ kind: 'kit' })).then(records => Promise.all(records.map(async record => {
      const value = await client.read({ id: record.id })
      if (value.id !== record.id || value.kind !== 'kit' || value.deletedAt) throw Error('The mount read does not match the selected Kit.')
      return value
    }))).then(records => {
      if (active && current.current === owner) {
        setCatalog({ owner, kits: records, busy: false })
        const submitted = pending.current?.owner === owner ? pending.current.save : undefined
        if (submitted && !mountSaveMatches(records.find(record => record.id === submitted.base.id)!, submitted)) {
          setOperation({ owner, busy: false, pending: submitted, error: locale === 'zh' ? '当前副本尚不能确认这次挂载保存，选择仍保留。不会自动重试写入。' : 'The current copy does not confirm this mount save. Your selection is retained; the write will not retry automatically.' })
        } else { if (pending.current?.owner === owner) pending.current = undefined; setOperation(undefined) }
      }
    }, failure => {
      if (active && current.current === owner) setCatalog(old => ({ owner, kits: old?.owner === owner ? old.kits : [], busy: false, error: String(failure) }))
    })
    return () => { active = false }
  }, [owner, retry])
  const matches = (pin: { name: string; version: string }) => pin.name === bundle.name
  const toggle = async (kit: StudioInstance, checked: boolean) => {
    if (!client?.updateMounts || busy || listing?.error || pending.current?.owner === owner || writing.current === owner) return
    writing.current = owner; setOperation({ owner, busy: true })
    const valid = () => live.current && current.current === owner
    let submitted: PendingMountSave | undefined
    try {
      const pins = new Set(kit.mounts.map(m => mountKey(m.bundle))), key = mountKey(bundle)
      if (checked) pins.add(key); else pins.delete(key)
      submitted = { base: structuredClone(kit), bundles: selectedMountPins(kit, pins) }
      pending.current = { owner, save: submitted }; setOperation({ owner, busy: true, pending: submitted })
      const next = await client.updateMounts({ id: kit.id, expectedRevision: kit.revision, bundles: structuredClone(submitted.bundles) })
      if (!valid()) return
      if (!mountSaveMatches(next, submitted)) throw Error(zh ? '挂载回执与副本、版本或选择不一致。' : 'The mount receipt does not match the copy, revision or selection.')
      pending.current = undefined
      setCatalog(previous => previous?.owner === owner ? { ...previous, kits: previous.kits.map(value => value.id === next.id ? next : value) } : previous)
      setOperation(undefined)
    } catch (failure) { if (valid()) {
      if (!submitted || mountWriteWasRejected(failure)) pending.current = undefined
      setOperation({ owner, busy: false, pending: pending.current?.owner === owner ? pending.current.save : undefined, error: failure instanceof Error ? failure.message : String(failure) })
    } }
    finally { if (writing.current === owner) writing.current = undefined }
  }
  const includes = (name: string) => name.toLowerCase().includes(query.toLowerCase())
  return <>
    <input type="search" className="ygd-studio-search-input" aria-label={zh ? '搜索 Kit' : 'Search Kits'} placeholder={zh ? '搜索 Kit' : 'Search Kits'} value={query} onChange={e => setQuery(e.target.value)} />
    <p>{zh ? '挂载变更保存到库中的设计套件，已有项目保持原有内容。' : 'Mount changes update the library Kit. Existing projects keep their own content.'}</p>
    {installed.filter(k => includes(k.name) && !displayedKits.some(local => local.current && local.kit?.name === k.name)).map(k => <div key={k.name} className="ygd-studio-bundle-mount-choice">{k.name}{onEditKit && <button className="ygd-studio-btn-secondary" type="button" onClick={() => onEditKit(k)}>{zh ? '编辑' : 'Edit'}</button>}</div>)}
    {displayedKits.filter(k => includes(k.title[locale]) && k.availableBundles?.some(matches)).map(k => <label key={k.id} className="ygd-studio-bundle-mount-choice"><input type="checkbox" checked={update?.pending?.base.id === k.id ? update.pending.bundles.some(matches) : k.mounts.some(m => matches(m.bundle))} disabled={busy || !!listing?.error || !!update?.pending || !client?.updateMounts} onChange={e => void toggle(k, e.target.checked)} />{k.title[locale]}</label>)}
    {busy && <LoadingIndicator label={loading ? (zh ? '正在读取挂载' : 'Loading mounts') : (zh ? '正在更新挂载' : 'Updating mounts')} />}
    {listing?.error && <StudioFeedback feedbackId={`list:${retry}:${listing.error}`} tone="error" locale={locale} title={zh ? '未能读取挂载' : 'Could not load mounts'} message={listing.error}
      actions={[{ label: zh ? '重试读取' : 'Retry loading', disabled: busy, onClick: () => refresh(value => value + 1) }]} />}
    {update?.error && <StudioFeedback feedbackId={`write:${retry}:${update.error}`} tone="error" locale={locale} title={update.pending ? (zh ? '挂载结果需要核对，选择已保留' : 'Verify the mount result; your selection is retained') : (zh ? '未能保存挂载' : 'Mounts could not be saved')} message={update.error}
      actions={[{ label: zh ? '刷新挂载' : 'Refresh mounts', disabled: busy, onClick: () => refresh(value => value + 1) }]} />}
    {!busy && !listing?.error && !displayedKits.length && !installed.length && <p>{zh ? '尚未挂载到设计套件。' : 'Not mounted in any Kit yet.'}</p>}
  </>
}
