import { useEffect, useState } from 'react'
import type { StudioInstance, StudioInstanceClient } from './InstanceWorkbench.tsx'
import { LoadingIndicator } from './LoadingIndicator.tsx'

export function BundleMounts({ client, bundle, installed, locale }: { client?: StudioInstanceClient; bundle: { name: string; version: string }; installed: readonly { name: string; version: string }[]; locale: 'zh' | 'en' }) {
  const [kits, setKits] = useState<readonly StudioInstance[]>([]), [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const zh = locale === 'zh'
  useEffect(() => {
    let active = true
    if (!client) return
    setBusy(true)
    void client.list({ kind: 'kit' }).then(records => Promise.all(records.map(record => client.read({ id: record.id })))).then(records => { if (active) setKits(records) }, failure => { if (active) setError(String(failure)) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [client, bundle.name, bundle.version])
  const matches = (pin: { name: string; version: string }) => pin.name === bundle.name && pin.version === bundle.version
  const toggle = async (kit: StudioInstance, checked: boolean) => {
    if (!client?.updateMounts || busy) return
    setBusy(true); setError('')
    try {
      const pins = new Set(kit.mounts.map(m => `${m.bundle.name}@${m.bundle.version}`)), key = `${bundle.name}@${bundle.version}`
      if (checked) pins.add(key); else pins.delete(key)
      const next = await client.updateMounts({ id: kit.id, expectedRevision: kit.revision, bundles: (kit.availableBundles ?? []).filter(b => pins.has(`${b.name}@${b.version}`)).map(({ name, version }) => ({ name, version })) })
      setKits(previous => previous.map(value => value.id === next.id ? next : value))
    } catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  const includes = (name: string) => name.toLowerCase().includes(query.toLowerCase())
  return <>
    <input type="search" className="ygd-studio-search-input" aria-label={zh ? '搜索 Kit' : 'Search Kits'} placeholder={zh ? '搜索 Kit' : 'Search Kits'} value={query} onChange={e => setQuery(e.target.value)} />
    <p>{zh ? '勾选或取消勾选会保存到本地 Kit 的 Mindset。已安装原件受保护。' : 'Selections update the local Kit’s Mindset. Installed originals remain protected.'}</p>
    {installed.filter(k => includes(k.name)).map(k => <label key={`${k.name}@${k.version}`} style={{ display: 'flex', gap: 8, padding: 6 }}><input type="checkbox" checked disabled />{k.name} <small>{zh ? '已安装 · 只读' : 'Installed · read-only'}</small></label>)}
    {kits.filter(k => includes(k.title[locale]) && k.availableBundles?.some(matches)).map(k => <label key={k.id} style={{ display: 'flex', gap: 8, padding: 6 }}><input type="checkbox" checked={k.mounts.some(m => matches(m.bundle))} disabled={busy || !client?.updateMounts} onChange={e => void toggle(k, e.target.checked)} />{k.title[locale]}</label>)}
    {busy && <LoadingIndicator label={zh ? '正在更新挂载' : 'Updating mounts'} />}
    {error && <p role="alert">{error}</p>}
    {!busy && !kits.length && <p>{zh ? '先复制一个 Kit，即可在本地副本中管理挂载。' : 'Copy a Kit to manage its mounts locally.'}</p>}
  </>
}
