import { Clock3, LoaderCircle } from 'lucide-react'
import type { ProjectedArtifactStatus } from './artifact-execution.ts'

/** Kit-neutral lifecycle geometry; wording comes from the owning panel locale. */
export function ArtifactStatusIcon({ status, label }: { status: ProjectedArtifactStatus; label: string }) {
  const size = { width: 12, height: 12 }
  return <span role={status === 'working' ? 'status' : 'img'} aria-label={label} data-execution-status={status}
    style={{ ...size, display: 'inline-flex', flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
    {status === 'working' ? <LoaderCircle aria-hidden='true' className='animate-spin' style={{ ...size, color: 'var(--ds-brand-text-primary, #7c3aed)' }} />
      : status === 'queued' ? <Clock3 aria-hidden='true' style={{ ...size, color: 'var(--ds-brand-text-primary, #7c3aed)' }} />
        : status === 'unknown' ? <span aria-hidden='true' style={{ color: 'var(--ds-text-tertiary, #64748b)', fontSize: 11, lineHeight: 1 }}>?</span>
          : status === 'failed' ? <span aria-hidden='true' style={{ color: 'var(--ds-error-text-primary, #ef4444)', fontSize: 11, lineHeight: 1 }}>×</span>
          : <span aria-hidden='true' style={{ ...size, borderRadius: '50%', boxSizing: 'border-box',
            background: status === 'completed' ? 'var(--ds-success-6, #10b981)' : 'transparent',
            border: status === 'completed' ? undefined : '1px solid var(--ds-brand-text-primary, #8b5cf6)' }} />}
  </span>
}
