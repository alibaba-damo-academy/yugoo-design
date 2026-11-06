import type { ReactNode } from 'react'
import { PanelContentState } from '../panel-content-state.tsx'
import { useLang } from './ported/host.ts'
import { Button } from './ported/ui/button.tsx'

/** Only a completed first read can establish that a workspace is empty.
 * Later refresh failures keep the mounted workspace and its local drafts. */
export function WorkspaceReadBoundary({ loaded, failure, onRetry, children }: {
  loaded: boolean
  failure?: string
  onRetry: () => void
  children: ReactNode
}) {
  const t = useLang()
  if (loaded) return children
  return <PanelContentState state={failure === undefined ? 'loading' : 'error'}
    message={failure === undefined ? t.design_workspace_loading : `${t.design_workspace_load_failed}\n${failure}`}>
    {failure === undefined ? null : <Button variant='outline' onClick={onRetry}>{t.button_retry}</Button>}
  </PanelContentState>
}
