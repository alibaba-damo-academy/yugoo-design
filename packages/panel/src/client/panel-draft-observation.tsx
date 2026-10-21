import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { currentLanguage } from './ported/host.ts'
import { PanelDraftLease, type PanelDraftFlags, type PanelDraftMessage } from '../panel-draft-lease.ts'

/** Both native and Companion pages use the same draft lifecycle and explicit reload disposition. */
export function usePanelDraftObservation(binding: { key: string; projectId: string } | undefined,
  send: (message: PanelDraftMessage) => Promise<unknown>): { observe: (flags: PanelDraftFlags | undefined) => void; notice: ReactElement | null } {
  const lease = useRef<PanelDraftLease>()
  const leaseKey = useRef<string>()
  const controls = useRef<{ key: string | undefined; flags: PanelDraftFlags }>()
  const bindingKey = useRef(binding?.key); bindingKey.current = binding?.key
  const sender = useRef(send); sender.current = send
  const [unknown, setUnknown] = useState(false)
  useEffect(() => {
    if (!binding) return
    let storage: Storage | undefined
    try { storage = sessionStorage } catch { /* Host can explicitly settle disconnected observations. */ }
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const boundSender = sender.current
    const current = new PanelDraftLease(`design-panel-draft:${binding.key}`, binding.projectId, storage,
      boundSender, navigation?.type === 'reload' || navigation?.type === 'back_forward')
    lease.current = current
    leaseKey.current = binding.key
    setUnknown(current.unresolved)
    current.open()
    if (controls.current?.key === binding.key) current.report(controls.current.flags)
    const timer = setInterval(() => current.heartbeat(), 10_000)
    const close = () => current.close()
    const reopen = () => { current.open(); current.heartbeat() }
    window.addEventListener('pagehide', close)
    window.addEventListener('pageshow', reopen)
    return () => {
      clearInterval(timer); window.removeEventListener('pagehide', close); window.removeEventListener('pageshow', reopen)
      current.close(); if (lease.current === current) { lease.current = undefined; leaseKey.current = undefined }
    }
  }, [binding?.key, binding?.projectId])
  const observe = useCallback((flags: PanelDraftFlags | undefined) => {
    if (!flags) return
    controls.current = { key: bindingKey.current, flags: { dirty: flags.dirty, saving: flags.saving } }
    if (leaseKey.current === bindingKey.current) lease.current?.report(controls.current.flags)
  }, [])
  const zh = currentLanguage() === 'zh_CN'
  const notice = unknown ? <div role='alert' className='border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900'>
    {zh ? '上次页面有未保存编辑，刷新不会自动视为已保存。' : 'The previous page had unsaved edits. Reloading does not save them.'}
    <button type='button' className='ml-2 underline' onClick={() => {
      if (!window.confirm(zh ? '确认放弃上次页面的未保存编辑？这不会保存任何文件。' : 'Discard the previous page’s unsaved edits? No files will be saved.')) return
      lease.current?.discardPriorDraft(); setUnknown(false)
    }}>{zh ? '确认放弃旧草稿' : 'Discard prior draft'}</button>
  </div> : null
  return { observe, notice }
}
