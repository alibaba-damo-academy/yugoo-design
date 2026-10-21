import type { ReactElement } from 'react'
import { cn } from './cn.ts'

/**
 * Loading spinner stand-in for the original Lottie animation (deviation:
 * Lottie JSON asset not portable to the CSS-as-text bundle; a CSS spinner
 * keeps the same usage shape `<Loading className='w-[100px] h-[100px]' />`).
 */
export function Loading({ className }: { className?: string }): ReactElement {
  return (
    <div
      className={cn(
        'dsh-design-loading rounded-full border-[3px] border-[var(--ds-border-default)] border-t-[var(--ds-brand-fill-default)] animate-spin',
        className,
      )}
      role='status'
      aria-label='loading'
    />
  )
}

export default Loading
