import type { ReactElement } from 'react'
import { usePanelI18n } from '../panel-i18n.tsx'

/** A host may own presentation of this exact error, without clearing save state. */
export function PanelSaveError(props: { error?: string; hostReportedError?: string }): ReactElement | null {
  const { t } = usePanelI18n()
  if (props.error === undefined || props.error === props.hostReportedError) return null
  const message = props.error.includes('PANEL_SAVE_CONFLICT') ? t('panelSaveConflict') : props.error
  return <div className='dsh-design-save-error' role='alert'>{message}</div>
}
