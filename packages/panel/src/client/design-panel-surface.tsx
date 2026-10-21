/** Generic outer surface for every resolved Design panel presentation. */
import type { ReactElement, ReactNode } from 'react'

/** Wrap one declarative or native renderer in the Panel shell's shared card. */
export function DesignPanelSurface({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div
      data-testid='dsh-design-panel-surface'
      className='relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--ds-divider-default)] bg-[var(--ds-bg-gary-default)]'
      style={{ fontFamily: 'var(--font-main)' }}
    >
      {children}
    </div>
  )
}
