import { Clock3, LoaderCircle } from 'lucide-react';
import { cn } from '../../ui/cn.ts';

/** Shared visual lifecycle used by every official Web App artifact panel. */
export type DesignExecutionVisualStatus =
  | 'pending'
  | 'queued'
  | 'working'
  | 'completed'
  | 'failed';

export interface IDesignExecutionStatusIconProps {
  status: DesignExecutionVisualStatus;
  /** Accessible localized status text supplied by the owning panel. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Render one consistent artifact lifecycle marker across official panels.
 *
 * The owning panel retains its domain-specific wording; this component owns
 * icon geometry, motion, and lifecycle colors.
 */
export function DesignExecutionStatusIcon({
  status,
  label,
  size = 'sm',
  className,
}: IDesignExecutionStatusIconProps): JSX.Element {
  const box = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';
  return (
    <span
      role={status === 'working' ? 'status' : 'img'}
      aria-label={label}
      className={cn(
        box,
        'inline-flex shrink-0 items-center justify-center',
        className
      )}
    >
      {status === 'working' ? (
        <LoaderCircle
          aria-hidden='true'
          className='animate-spin text-[var(--ds-brand-text-primary)]'
          style={{ width: '100%', height: '100%' }}
        />
      ) : status === 'queued' ? (
        <Clock3
          aria-hidden='true'
          className='text-[var(--ds-brand-text-primary)]'
          style={{ width: '100%', height: '100%' }}
        />
      ) : status === 'failed' ? (
        <span className='text-[11px] font-semibold leading-none text-red-500'>×</span>
      ) : (
        <span
          className={cn(
            'h-full w-full rounded-full',
            status === 'completed'
              ? 'bg-emerald-500'
              : 'border border-violet-500 bg-transparent'
          )}
        />
      )}
    </span>
  );
}
