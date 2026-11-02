/** Generic outer surface for every resolved Design panel presentation. */
import type { ReactElement, ReactNode } from 'react'

/** Fill the selected workspace viewport; nested content owns its own boundaries. */
export function DesignPanelSurface({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div
      data-testid='dsh-design-panel-surface'
      className='relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ds-bg-gary-default)]'
      style={{ fontFamily: 'var(--font-main)' }}
    >
      {children}
    </div>
  )
}
