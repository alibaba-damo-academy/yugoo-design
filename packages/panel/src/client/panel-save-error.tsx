import type { ReactElement } from 'react'

/** A host may own presentation of this exact error, without clearing save state. */
export function PanelSaveError(props: { error?: string; hostReportedError?: string }): ReactElement | null {
  if (props.error === undefined || props.error === props.hostReportedError) return null
  return <div className='dsh-design-save-error absolute inset-x-4 top-1 z-30' title={props.error}>{props.error}</div>
}
