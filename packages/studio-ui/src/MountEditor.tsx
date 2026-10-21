import { useState } from 'react'
import type { StudioInstance, StudioInstanceClient } from './InstanceWorkbench.tsx'

export function MountEditor({ client, record, locale, onSaved, onClose }: { client: StudioInstanceClient; record: StudioInstance; locale: 'zh' | 'en'; onSaved: (value: StudioInstance) => void; onClose: () => void }) {
  const [selected, setSelected] = useState(() => new Set(record.mounts.map(m => `${m.bundle.name}@${m.bundle.version}`)))
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const zh = locale === 'zh', candidates = record.availableBundles ?? []
  const save = async () => {
    if (!client.updateMounts || busy) return
    setBusy(true); setError('')
    try { onSaved(await client.updateMounts({ id: record.id, expectedRevision: record.revision, bundles: candidates.filter(b => selected.has(`${b.name}@${b.version}`)).map(({ name, version, instanceId, revision }) => ({ name, version, ...(instanceId === undefined ? {} : { instanceId, revision }) })) })) }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <section aria-label={zh ? '挂载管理' : 'Mount management'} style={{ padding: '12px 20px', borderBottom: '1px solid var(--ds-border)' }}>
    <input type="search" className="ygd-studio-search-input" aria-label={zh ? '搜索 Bundle' : 'Search Bundles'} placeholder={zh ? '搜索 Bundle' : 'Search Bundles'} value={query} onChange={e => setQuery(e.target.value)} />
    <div style={{ maxHeight: 280, overflow: 'auto', padding: '8px 0' }}>{candidates.filter(b => `${b.name} ${b.title[locale]}`.toLowerCase().includes(query.toLowerCase())).map(b => { const key = `${b.name}@${b.version}`; return <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6 }}><input type="checkbox" disabled={busy} checked={selected.has(key)} onChange={e => setSelected(previous => { const next = new Set(previous); if (e.target.checked) next.add(key); else next.delete(key); return next })} />{b.title[locale]} <small>{b.version}</small></label> })}</div>
    {error && <p role="alert">{error}</p>}
    {!selected.size && <p role="status">{zh ? 'Kit 至少需要挂载一个 Bundle。' : 'A Kit requires at least one mounted Bundle.'}</p>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" className="ygd-studio-btn-secondary" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="ygd-studio-btn-primary" disabled={busy || !selected.size} onClick={() => void save()}>{zh ? '保存挂载' : 'Save mounts'}</button></div>
  </section>
}
