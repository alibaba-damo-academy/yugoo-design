import type { ReactElement } from 'react'

/** Shared indeterminate loading state; status text remains available to assistive technology. */
export function LoadingIndicator({ label }: { label: string }): ReactElement {
  return <div className="ygd-studio-loading" role="status" aria-label={label}>
    <span className="ygd-studio-spinner" aria-hidden="true" />
  </div>
}
