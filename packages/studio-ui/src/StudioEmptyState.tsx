import type { StudioFeedbackAction } from './StudioFeedback.tsx'

/** Content absence belongs to the empty region; it is not an operation error. */
export function StudioEmptyState({ title, description, tone = 'warning', actions = [] }: {
  title: string
  description?: string
  tone?: 'warning' | 'info'
  actions?: readonly StudioFeedbackAction[]
}) {
  return <div className="ygd-studio-content-state" data-tone={tone} role="status">
    <div className="ygd-studio-content-state-card">
      <div className="ygd-studio-content-state-heading"><svg className="ygd-studio-content-state-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
        {tone === 'warning' ? <><path d="M12 3 22 21H2L12 3Z" strokeLinejoin="round" /><path d="M12 9v5M12 16.5V18" /></> : <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1.5" /></>}
      </svg>
      <strong>{title}</strong></div>
      {description && <p>{description}</p>}
      {actions.length > 0 && <div className="ygd-studio-content-state-actions">{actions.map(action => <button key={action.label} type="button" disabled={action.disabled}
        className={action.primary ? 'ygd-studio-btn-primary' : 'ygd-studio-btn-link'} onClick={action.onClick}>{action.label}</button>)}</div>}
    </div>
  </div>
}
