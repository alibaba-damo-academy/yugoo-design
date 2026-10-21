import { CircleAlert, FileText, Image, LoaderCircle, Shapes } from 'lucide-react'
import type { ReactNode } from 'react'

/** Presentation of a read-only content region, separate from execution status.
 * Callers retain file authority, cancellation, retries and canonical state. */
export function PanelContentState({ state, message, kind = 'document', appearance = 'full', children }: {
  state: 'loading' | 'empty' | 'unavailable' | 'error'
  message: string
  kind?: 'document' | 'preview' | 'canvas'
  appearance?: 'full' | 'compact' | 'inline'
  children?: ReactNode
}) {
  const Icon = state === 'loading' ? LoaderCircle
    : state === 'error' || state === 'unavailable' ? CircleAlert
      : kind === 'preview' ? Image : kind === 'canvas' ? Shapes : FileText
  return <div className={`dsh-panel-content-state is-${appearance}`} data-content-state={state}
    role={state === 'error' ? 'alert' : 'status'}>
    <Icon className="dsh-panel-content-state-icon" aria-hidden="true" />
    <p className="dsh-panel-content-state-message">{message}</p>
    {children ? <div className="dsh-panel-content-state-actions">{children}</div> : null}
  </div>
}
