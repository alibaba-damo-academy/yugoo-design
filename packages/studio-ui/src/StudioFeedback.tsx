import { useEffect, useId, useRef, useState } from 'react'
import { StudioErrorDialog } from './StudioErrorDialog.tsx'

export interface StudioFeedbackDetail {
  message: string
  file?: string
  onOpen?: () => void
}
export interface StudioFeedbackAction {
  label: string
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}
export interface StudioFeedbackProps {
  /** Identifies one outcome. Polling the same outcome must not reopen a dismissed notice. */
  feedbackId: string
  tone: 'success' | 'error' | 'info'
  title: string
  message?: string
  details?: readonly StudioFeedbackDetail[]
  actions?: readonly StudioFeedbackAction[]
  layout?: 'notice' | 'inline'
  dismissible?: boolean
  /** Explicitly failed blocking actions may open once. Other errors remain in context. */
  autoOpen?: boolean
  locale: 'zh' | 'en'
}

/** Presentation only. Owners supply outcomes, retry operations and exact file navigation. */
export function StudioFeedback(props: StudioFeedbackProps) {
  if (props.tone === 'error') return <ErrorFeedback {...props} />
  return <NoticeFeedback {...props} />
}

function ErrorFeedback({ feedbackId, title, message, details, actions = [], autoOpen = false, locale }: StudioFeedbackProps) {
  const seen = useRef(new Set<string>()), [opened, setOpened] = useState<string>()
  useEffect(() => {
    if (!autoOpen || seen.current.has(feedbackId)) return
    seen.current.add(feedbackId); setOpened(feedbackId)
  }, [feedbackId, autoOpen])
  return <div className="ygd-studio-error-entry">
    <svg className="ygd-studio-feedback-icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10" cy="10" r="7.5" /><path d="M10 5.5v5M10 13v1.5" /></svg>
    <span className="ygd-studio-error-title">{title}</span>
    {actions.map(action => <button key={action.label} type="button" disabled={action.disabled} className={action.primary ? 'ygd-studio-btn-primary' : 'ygd-studio-btn-secondary'} onClick={action.onClick}>{action.label}</button>)}
    <button type="button" className="ygd-studio-btn-secondary" onClick={() => { seen.current.add(feedbackId); setOpened(feedbackId) }}>{locale === 'zh' ? '查看问题' : 'View issues'}</button>
    <StudioErrorDialog open={opened === feedbackId} onClose={() => setOpened(undefined)} title={title}
      details={[...(message ? [{ message }] : []), ...(details ?? [])]} actions={actions} locale={locale} />
  </div>
}

function NoticeFeedback({ feedbackId, tone, title, message, details = [], actions = [], layout = 'notice', dismissible = layout === 'notice', locale }: StudioFeedbackProps) {
  const [dismissed, setDismissed] = useState<string>()
  const [expanded, setExpanded] = useState<string>()
  const detailsId = useId(), toggle = useRef<HTMLButtonElement>(null)
  const reopen = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false)
  const zh = locale === 'zh', closed = dismissed === feedbackId, open = expanded === feedbackId
  useEffect(() => {
    if (!restoreFocus.current) return
    restoreFocus.current = false
    const target = closed ? reopen.current : toggle.current
    target?.focus()
  }, [closed])
  useEffect(() => {
    if (tone !== 'success' || layout !== 'notice' || !dismissible) return
    const timer = setTimeout(() => setDismissed(feedbackId), 4000)
    return () => clearTimeout(timer)
  }, [feedbackId, tone, layout, dismissible])
  if (closed && tone === 'success') return null
  if (closed) return <div className="ygd-studio-notice-reopen">
    <span>{title}</span><button ref={reopen} type="button" className="ygd-studio-btn-link" onClick={() => { restoreFocus.current = true; setDismissed(undefined) }}>{zh ? '查看原因' : 'View reason'}</button>
  </div>
  const hasDetails = !!message || details.length > 0
  return <div className={`ygd-studio-notice ygd-studio-notice-${layout}`} data-tone={tone}>
    <div className="ygd-studio-notice-heading">
      <span className="ygd-studio-notice-title" role={layout === 'notice' ? tone === 'error' ? 'alert' : 'status' : undefined}>{title}</span>
      {hasDetails && <button ref={toggle} type="button" className="ygd-studio-btn-link" aria-expanded={open} aria-controls={detailsId}
        onClick={() => setExpanded(open ? undefined : feedbackId)}>{open ? (zh ? '收起详情' : 'Hide details') : (zh ? '查看问题' : 'View issues')}</button>}
      {actions.map(action => <button type="button" className={action.primary ? 'ygd-studio-btn-primary' : 'ygd-studio-btn-secondary'} key={action.label} disabled={action.disabled} onClick={action.onClick}>{action.label}</button>)}
      {dismissible && <button type="button" className="ygd-studio-btn-link" aria-label={zh ? '关闭提示' : 'Dismiss notice'} onClick={() => { restoreFocus.current = true; setDismissed(feedbackId) }}>×</button>}
    </div>
    {open && <div id={detailsId} className="ygd-studio-notice-details" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setExpanded(undefined); toggle.current?.focus() }
    }}>
      {message && <p>{message}</p>}
      {details.length > 0 && <ul>{details.map((detail, index) => <li key={index}>
        {detail.file && (detail.onOpen ? <button type="button" className="ygd-studio-btn-link" onClick={detail.onOpen}>{detail.file}</button> : <span>{detail.file}</span>)}
        <span>{detail.message}</span>
      </li>)}</ul>}
    </div>}
  </div>
}
