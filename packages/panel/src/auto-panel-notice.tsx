import type { ReactElement } from 'react'
import { panelText } from './panel-i18n.tsx'

/** Host-neutral generated/retained layout chrome. Persistence is a host action,
 * never an action granted by a model-generated component definition. */
export function AutoPanelNotice(props: {
  locale: string
  origin?: 'generated' | 'retained'
  sourceChanged?: boolean
  readOnly?: boolean
  retaining?: boolean
  onRetain?: () => void
  generation?: { phase: string; durationMs?: number; attempts?: number; fallbackReason?: string }
}): ReactElement {
  const t = (key: Parameters<typeof panelText>[0], values?: Record<string, string | number>) => panelText(key, props.locale, values)
  const generation = props.origin === 'retained' ? undefined : props.generation
  return <div className="dsh-auto-panel-notice" role="status">
    <span>{props.origin === 'retained' ? t('retainedPanel') : generation?.fallbackReason !== undefined ? t('autoPanelFallback') : t('autoPanelLoaded')}</span>
    {props.sourceChanged ? <p>{t('retainedSourceChanged')}</p> : null}
    {props.origin === 'generated' && props.onRetain ? <button type="button" disabled={props.readOnly || props.retaining} onClick={props.onRetain}>
      {t(props.retaining ? 'retainingPanel' : 'retainPanel')}
    </button> : null}
    {generation?.phase === 'ready' && generation.durationMs !== undefined ? <span>{t('autoPanelDuration', { seconds: (generation.durationMs / 1000).toFixed(1) })}</span> : null}
    {generation?.phase === 'ready' && generation.attempts !== undefined ? <span>{t('autoPanelAttempts', { count: generation.attempts })}</span> : null}
    {generation?.fallbackReason !== undefined ? <details><summary>{t('autoPanelFallbackReason')}</summary>{generation.fallbackReason}</details> : null}
  </div>
}
