import { useEffect, useId, useRef } from 'react'
import type { StudioFeedbackAction, StudioFeedbackDetail } from './StudioFeedback.tsx'

export interface StudioErrorDialogProps {
  open: boolean
  onClose: () => void
  title: string
  message?: string
  details?: readonly StudioFeedbackDetail[]
  actions?: readonly StudioFeedbackAction[]
  locale: 'zh' | 'en'
}

/** One shared error surface. Closing or inspecting never saves, retries or discards input. */
export function StudioErrorDialog({ open, onClose, title, message, details = [], actions = [], locale }: StudioErrorDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(true)
  const titleId = useId(), messageId = useId(), zh = locale === 'zh'
  useEffect(() => {
    if (!open) return
    restoreFocus.current = true
    const element = dialog.current, opener = document.activeElement as HTMLElement | null
    if (element?.showModal) element.showModal()
    else element?.setAttribute('open', '')
    close.current?.focus()
    return () => {
      if (element?.open && element.close) element.close()
      else element?.removeAttribute('open')
      if (restoreFocus.current && opener?.isConnected) opener.focus()
    }
  }, [open])
  const runAction = (action: () => void) => {
    restoreFocus.current = false
    // Release the native modal's inert background before an action focuses the
    // editor. React batches onClose; unmounting alone happens after the callback.
    if (dialog.current?.close) dialog.current.close()
    else dialog.current?.removeAttribute('open')
    onClose()
    action()
  }
  if (!open) return null
  return <dialog ref={dialog} className="ygd-studio-modal ygd-studio-error-dialog" role="dialog" aria-modal="true"
    aria-labelledby={titleId} aria-describedby={message ? messageId : undefined}
    onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
    <header><h2 id={titleId}>{title}</h2><button ref={close} type="button" className="ygd-studio-btn-link" aria-label={zh ? '关闭错误对话框' : 'Close error dialog'} onClick={onClose}>×</button></header>
    {message && <p id={messageId}>{message}</p>}
    {details.length > 0 && <details className="ygd-studio-error-details">
      <summary>{zh ? '查看详情' : 'View details'}</summary>
      <ul>{details.map((detail, index) => <li key={index}>
        {detail.file && (detail.onOpen ? <button type="button" className="ygd-studio-btn-link" onClick={() => runAction(detail.onOpen!)}>{detail.file}</button> : <span>{detail.file}</span>)}
        <span>{detail.message}</span>
      </li>)}</ul>
    </details>}
    <footer className="ygd-studio-modal-actions">
      {actions.map(action => <button key={action.label} type="button" disabled={action.disabled}
        className={action.primary ? 'ygd-studio-btn-primary' : 'ygd-studio-btn-secondary'}
        onClick={() => runAction(action.onClick)}>{action.label}</button>)}
      <button type="button" className={actions.length ? 'ygd-studio-btn-secondary' : 'ygd-studio-btn-primary'} onClick={onClose}>{actions.length ? (zh ? '关闭' : 'Close') : (zh ? '继续编辑' : 'Continue editing')}</button>
    </footer>
  </dialog>
}
