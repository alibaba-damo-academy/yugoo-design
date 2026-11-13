import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { Settings } from 'lucide-react'
import type { DesignRuntime } from './workspace.tsx'
import { panelText, type PanelMessageKey } from '../panel-i18n.tsx'
import { useCurrentLanguage } from './ported/host.ts'

type Policy = import('../../../core/src/design-review-policy.ts').DesignReviewPolicy
const REVIEW_SCOPES = ['light', 'standard', 'thorough'] as const
const SCOPE_LABELS = ['reviewDepthLight', 'reviewDepthStandard', 'reviewDepthThorough'] as const
const SCOPE_HINTS = ['reviewDepthLightHint', 'reviewDepthStandardHint', 'reviewDepthThoroughHint'] as const

export function ReviewPolicyControl({ sessionId, runtime }: { sessionId: string; runtime: DesignRuntime }): ReactElement {
  const locale = useCurrentLanguage()
  const t = (key: PanelMessageKey, values?: Record<string, string | number>) => panelText(key, locale, values)
  const [policy, setPolicy] = useState<Policy>()
  const [seconds, setSeconds] = useState('30')
  const [minutes, setMinutes] = useState('10')
  const [error, setError] = useState('')
  const [saving, setSavingPolicy] = useState(false)
  const [validation, setValidation] = useState<PanelMessageKey | ''>('')
  const savedPolicy = useRef<Policy>()
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const scopeHintId = useId()
  const scope = useMemo(() => ({}), [runtime, sessionId])
  const activeScope = useRef<object | undefined>(scope)
  activeScope.current = scope
  const isCurrent = () => activeScope.current === scope
  const applyPolicy = (value: Policy): void => {
    const selected = { ...value, mode: value.mode === 'every-publication' ? 'auto' as const : value.mode }
    setPolicy(selected)
    setSeconds(String(selected.autoMergeWindowMs / 1000))
    setMinutes(String((selected.continuousIntervalMs ?? 600000) / 60000))
  }
  const cancel = (): void => {
    if (saving) return
    if (savedPolicy.current) applyPolicy(savedPolicy.current)
    setError(''); setValidation('')
    settingsDialog.current?.close()
  }
  useEffect(() => {
    let disposed = false
    activeScope.current = scope
    savedPolicy.current = undefined
    setPolicy(undefined); setError(''); setValidation(''); setSavingPolicy(false)
    void runtime.readReviewPolicy!(sessionId).then(value => {
      if (disposed) return
      savedPolicy.current = value
      applyPolicy(value)
    }).catch(failure => { if (!disposed) setError(String(failure)) })
    return () => { disposed = true; if (activeScope.current === scope) activeScope.current = undefined }
  }, [runtime, sessionId, scope])
  const edited = (): void => { setError(''); setValidation('') }
  const saveSelectedPolicy = async (): Promise<void> => {
    if (!policy) return
    const autoMergeWindowMs = policy.mode === 'auto' ? Number(seconds) * 1000 : policy.autoMergeWindowMs
    const continuousIntervalMs = policy.mode === 'continuous' ? Number(minutes) * 60000 : policy.continuousIntervalMs ?? 600000
    if (policy.mode === 'auto' && (!seconds.trim() || !Number.isSafeInteger(autoMergeWindowMs) || autoMergeWindowMs < 0 || autoMergeWindowMs > 3600000)) { setValidation('reviewSecondsInvalid'); return }
    if (policy.mode === 'continuous' && (!minutes.trim() || !Number.isSafeInteger(Number(minutes)) || continuousIntervalMs < 60000 || continuousIntervalMs > 86400000)) { setValidation('reviewMinutesInvalid'); return }
    setSavingPolicy(true); setError(''); setValidation('')
    try {
      const value = await runtime.updateReviewPolicy!(sessionId, { ...policy, autoMergeWindowMs, continuousIntervalMs })
      if (!isCurrent()) return
      savedPolicy.current = value
      applyPolicy(value)
      settingsDialog.current?.close()
    } catch (failure) {
      if (isCurrent()) { setError(String(failure)); setValidation('reviewSaveFailed') }
    } finally { if (isCurrent()) setSavingPolicy(false) }
  }
  const scopeIndex = REVIEW_SCOPES.indexOf(policy?.depth ?? 'standard')
  return <div className='dsh-review-settings'>
    <button type='button' className='dsh-review-settings-trigger' aria-label={t('reviewSettingsTitle')} title={t('reviewSettingsTitle')} aria-haspopup='dialog' onClick={() => settingsDialog.current?.showModal()}>
      <Settings size={16} aria-hidden='true' />
    </button>
    <dialog ref={settingsDialog} className='dsh-review-settings-dialog' aria-labelledby={titleId} onCancel={event => { event.preventDefault(); cancel() }}>
      <header className='dsh-review-settings-header'>
        <h2 id={titleId}>{t('reviewSettingsTitle')}</h2>
        <button type='button' className='dsh-review-settings-close' aria-label={t('reviewSettingsClose')} disabled={saving} onClick={cancel}>×</button>
      </header>
      {policy ? <div className='dsh-review-settings-fields'>
        <div className='dsh-review-mode'>
          <label>{t('reviewMode')} <select aria-label={t('reviewMode')} disabled={saving} value={policy.mode} onChange={event => { setPolicy({ ...policy, mode: event.target.value as Policy['mode'] }); edited() }}>
            <option value='continuous'>{t('reviewModeContinuous')}</option><option value='auto'>{t('reviewModeAuto')}</option><option value='off'>{t('reviewModeOff')}</option>
          </select></label>
          <p className='dsh-review-settings-help dsh-review-off-hint' aria-hidden={policy.mode !== 'off'}>{t('reviewOffHint')}</p>
        </div>
        <fieldset className='dsh-review-scope' disabled={saving || policy.mode === 'off'}>
          <legend>{t('reviewDepth')}</legend>
          <div className='dsh-review-scope-track'>
            <div className='dsh-review-scope-stops' aria-hidden='true'>{REVIEW_SCOPES.map(depth => <span key={depth} />)}</div>
            <input type='range' min='0' max='2' step='1' aria-label={t('reviewDepth')} aria-describedby={scopeHintId}
              aria-valuetext={t(SCOPE_LABELS[scopeIndex]!)} value={scopeIndex}
              onChange={event => { setPolicy({ ...policy, depth: REVIEW_SCOPES[Number(event.target.value)]! }); edited() }} />
          </div>
          <div className='dsh-review-scope-labels' aria-hidden='true'>
            {REVIEW_SCOPES.map((depth, index) => <span key={depth} data-selected={scopeIndex === index}>{t(SCOPE_LABELS[index]!)}</span>)}
          </div>
          <div className='dsh-review-scope-hints'>
            {REVIEW_SCOPES.map((depth, index) => <p key={depth} id={scopeIndex === index ? scopeHintId : undefined} className='dsh-review-settings-help' aria-hidden={scopeIndex !== index}>{t(SCOPE_HINTS[index]!)}</p>)}
          </div>
        </fieldset>
        {policy.mode === 'auto' && <label>{t('reviewMergeWindow')} <input aria-label={t('reviewMergeWindow')} type='number' min='0' max='3600' step='0.001' disabled={saving} value={seconds} onChange={event => { setSeconds(event.target.value); edited() }} /></label>}
        {policy.mode === 'continuous' && <div className='dsh-review-timing'>
          <label>{t('reviewInterval')} <input aria-label={t('reviewInterval')} type='number' min='1' max='1440' step='1' disabled={saving} value={minutes} onChange={event => { setMinutes(event.target.value); edited() }} /></label>
          <p className='dsh-review-settings-help'>{t('reviewContinuousHint')}</p>
        </div>}
        <div className='dsh-review-settings-actions'>
          <button type='button' className='dsh-review-settings-cancel' disabled={saving} onClick={cancel}>{t('cancel')}</button>
          <button type='button' className='dsh-review-settings-save' disabled={saving} onClick={() => { void saveSelectedPolicy() }}>{t(saving ? 'reviewSaving' : 'reviewSave')}</button>
        </div>
      </div> : <span>{t('reviewLoading')}</span>}
      {(validation || error) && <div className='dsh-review-settings-error' role='alert' title={error || undefined}>{validation ? t(validation) : error}</div>}
    </dialog>
  </div>
}
