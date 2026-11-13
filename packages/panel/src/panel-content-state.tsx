import { CircleAlert, FileText, Image, LoaderCircle, Shapes } from 'lucide-react'
import type { ReactNode } from 'react'

/** Presentation of a read-only content region, separate from execution status.
 * Callers retain file authority, cancellation, retries and canonical state. */
export function PanelContentState({ state, title, message, kind = 'document', appearance = 'full', children }: {
  state: 'loading' | 'empty' | 'unavailable' | 'error'
  title?: string
  message: string
  kind?: 'document' | 'preview' | 'canvas' | 'panel'
  appearance?: 'full' | 'compact' | 'inline'
  children?: ReactNode
}) {
  const Icon = state === 'loading' ? LoaderCircle
    : state === 'error' || state === 'unavailable' ? CircleAlert
      : kind === 'preview' ? Image : kind === 'canvas' ? Shapes : FileText
  return <div className={`dsh-panel-content-state is-${appearance}`} data-content-state={state}
    role={state === 'error' ? 'alert' : 'status'}>
    {kind === 'panel' && state === 'empty' ? <svg className="dsh-panel-empty-illustration" viewBox="0 0 176 112" aria-hidden="true" focusable="false" fill="none">
      <rect className="dsh-panel-empty-illustration-frame" x="12" y="12" width="152" height="88" rx="8" />
      <path d="M12 32h152M54 32v68" />
      <path d="M24 45h18M24 57h12M24 69h18" />
      <rect className="dsh-panel-empty-illustration-accent" x="66" y="44" width="84" height="16" rx="3" />
      <rect x="66" y="70" width="38" height="18" rx="3" />
      <rect x="112" y="70" width="38" height="18" rx="3" />
      <path d="M24 22h2m5 0h2m5 0h2" />
    </svg> : <Icon className="dsh-panel-content-state-icon" aria-hidden="true" />}
    {title ? <h3 className="dsh-panel-content-state-title">{title}</h3> : null}
    <p className="dsh-panel-content-state-message">{message}</p>
    {children ? <div className="dsh-panel-content-state-actions">{children}</div> : null}
  </div>
}
