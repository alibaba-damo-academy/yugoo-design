import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { browserRandomUuid } from '../browser-uuid.ts'
import { Settings } from 'lucide-react'
import type { DesignRuntime } from './workspace.tsx'
import { panelText, type PanelMessageKey } from '../panel-i18n.tsx'
import { useCurrentLanguage } from './ported/host.ts'

function reviewRejectionMessage(reason: string): PanelMessageKey {
  switch (reason) {
    case 'no-project': return 'reviewNeedsProject'
    case 'no-design-change':
    case 'no-published-commit': return 'reviewNeedsSavedDesign'
    case 'no-configured-profiles':
    case 'no-active-kit': return 'reviewNotConfigured'
    case 'advisory-runtime-unavailable':
    case 'host-adapter-missing-manual-trigger': return 'reviewUnavailable'
    case 'project-changed':
    case 'project-or-kit-changed':
    case 'request-id-target-mismatch': return 'reviewTargetChanged'
    default: return 'reviewRequestRejected'
  }
}

export function ReviewPolicyControl({ sessionId, runtime }: { sessionId: string; runtime: DesignRuntime }): ReactElement {
  const locale = useCurrentLanguage()
  const t = (key: PanelMessageKey, values?: Record<string, string | number>) => panelText(key, locale, values)
  type Policy = import('../../../core/src/design-review-policy.ts').DesignReviewPolicy
  const [policy, setPolicy] = useState<Policy>()
  const [seconds, setSeconds] = useState('30')
  const [minutes, setMinutes] = useState('10')
  const [error, setError] = useState('')
  const [saving, setSavingPolicy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [manualRequestId, setManualRequestId] = useState<string>()
  const [notice, setNotice] = useState<PanelMessageKey | ''>('')
  const [validation, setValidation] = useState<PanelMessageKey | ''>('')
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const scope = useMemo(() => ({}), [runtime, sessionId])
  const activeScope = useRef<object | undefined>(scope)
  activeScope.current = scope
  const isCurrent = () => activeScope.current === scope
  useEffect(() => {
    let disposed = false
    activeScope.current = scope
    setPolicy(undefined); setManualRequestId(undefined); setError(''); setNotice(''); setValidation('')
    setSavingPolicy(false); setChecking(false)
    void runtime.readReviewPolicy!(sessionId).then(value => {
      if (disposed) return
      setPolicy({...value,mode:value.mode==='every-publication'?'auto':value.mode}); setSeconds(String(value.autoMergeWindowMs / 1000)); setMinutes(String((value.continuousIntervalMs ?? 600000) / 60000))
    }).catch(failure => { if (!disposed) setError(String(failure)) })
    return () => { disposed = true; if (activeScope.current === scope) activeScope.current = undefined }
  }, [runtime, sessionId, scope])
  const edited = () => { setManualRequestId(undefined); setNotice('') }
  const saveSelectedPolicy = async (): Promise<boolean> => {
    if (!policy) return false
    const autoMergeWindowMs = Number(seconds) * 1000
    const continuousIntervalMs = Number(minutes) * 60000
    if (!seconds.trim() || !Number.isSafeInteger(autoMergeWindowMs) || autoMergeWindowMs < 0 || autoMergeWindowMs > 3600000) { setValidation('reviewSecondsInvalid'); return false }
    if (!minutes.trim() || !Number.isSafeInteger(Number(minutes)) || continuousIntervalMs < 60000 || continuousIntervalMs > 86400000) { setValidation('reviewMinutesInvalid'); return false }
    setSavingPolicy(true); setError(''); setValidation(''); setNotice('')
    try {
      const value = await runtime.updateReviewPolicy!(sessionId, { ...policy, autoMergeWindowMs, continuousIntervalMs })
      if (!isCurrent()) return false
      setPolicy(value)
      return true
    } catch (failure) {
      if (isCurrent()) { setError(String(failure)); setValidation('reviewSaveFailed') }
      return false
    } finally { if (isCurrent()) setSavingPolicy(false) }
  }
  return <div className='dsh-review-settings'>
    <button type='button' className='dsh-review-settings-trigger' aria-haspopup='dialog' onClick={() => settingsDialog.current?.showModal()}>
      <Settings size={14} aria-hidden='true' />{t('reviewSettings')}
    </button>
    <dialog ref={settingsDialog} className='dsh-review-settings-dialog' aria-labelledby={titleId}>
    <header className='dsh-review-settings-header'>
      <div><h2 id={titleId}>{t('reviewSettingsTitle')}</h2><p>{t('reviewSettingsScope')}</p></div>
      <button type='button' className='dsh-review-settings-close' aria-label={t('reviewSettingsClose')} onClick={() => settingsDialog.current?.close()}>×</button>
    </header>
    {policy ? <div className='dsh-review-settings-fields'>
      <label>{t('reviewMode')} <select aria-label={t('reviewMode')} disabled={saving || checking} value={policy.mode} onChange={event => { setPolicy({ ...policy, mode: event.target.value as Policy['mode'] }); edited() }}>
        <option value='continuous'>{t('reviewModeContinuous')}</option><option value='auto'>{t('reviewModeAuto')}</option><option value='off'>{t('reviewModeOff')}</option>
      </select></label>
      <label>{t('reviewDepth')} <select aria-label={t('reviewDepth')} disabled={saving || checking} value={policy.depth ?? 'standard'} onChange={event => { setPolicy({ ...policy, depth: event.target.value as NonNullable<Policy['depth']> }); edited() }}>
        <option value='light'>{t('reviewDepthLight')}</option><option value='standard'>{t('reviewDepthStandard')}</option><option value='thorough'>{t('reviewDepthThorough')}</option>
      </select></label>
      <p className='dsh-review-settings-help'>{t(policy.depth === 'light' ? 'reviewDepthLightHint' : policy.depth === 'thorough' ? 'reviewDepthThoroughHint' : 'reviewDepthStandardHint')}</p>
      <p className='dsh-review-settings-help'>{t('reviewDepthCostHint')}</p>
      {policy.mode === 'auto' && <label>{t('reviewMergeWindow')} <input aria-label={t('reviewMergeWindow')} type='number' min='0' max='3600' step='0.001' disabled={saving || checking} value={seconds} onChange={event => { setSeconds(event.target.value); edited() }} /></label>}
      {policy.mode === 'continuous' && <><label>{t('reviewInterval')} <input aria-label={t('reviewInterval')} type='number' min='1' max='1440' step='1' disabled={saving || checking} value={minutes} onChange={event=>{setMinutes(event.target.value);edited()}} /></label><p className='dsh-review-settings-help'>{t('reviewContinuousHint')}</p></>}
      <p className='dsh-review-settings-help'>{t('reviewOffHint')}</p>
      <div className='dsh-review-settings-actions'>
      <button type='button' className='dsh-review-settings-save' disabled={saving || checking} onClick={() => {
        void saveSelectedPolicy().then(saved => { if (saved && isCurrent()) setNotice('reviewSettingsSaved') })
      }}>{t(saving ? 'reviewSaving' : 'reviewSave')}</button>
      <button type='button' className='dsh-review-settings-check' disabled={checking||saving} onClick={()=>{
        setChecking(true)
        void (async () => {
          if (!await saveSelectedPolicy()) return
          const requestId=manualRequestId??browserRandomUuid()
          setManualRequestId(requestId)
          try {
            if (runtime.requestManualReview) {
              const result = await runtime.requestManualReview(sessionId, requestId)
              if (!isCurrent()) return
              if (result.outcome === 'accepted') setNotice('reviewQueued')
              else if (result.outcome === 'noop' && result.reason === 'request-already-completed') setNotice('reviewAlreadyCompleted')
              else if (result.outcome === 'noop' && result.reason === 'already-active-or-requested') setNotice('reviewAlreadyRequested')
              else { setValidation(reviewRejectionMessage(result.reason)); setError(result.reason) }
              setManualRequestId(undefined)
            } else {
              // Hosts without direct dispatch retain their native capability /
              // foreground-confirmation flow. A failed direct call never enters it.
              await runtime.sendPrompt(sessionId,t('reviewRequestPrompt', { requestId: JSON.stringify(requestId) }),requestId)
              if (isCurrent()) { setNotice('reviewRequestSent');setManualRequestId(undefined) }
            }
          } catch (failure) {
            if (isCurrent()) {
              setError(String(failure))
              if (runtime.requestManualReview) setValidation('reviewRequestUnconfirmed')
            }
          }
        })().finally(()=>{ if (isCurrent()) setChecking(false) })
      }}>{t(checking ? 'reviewSending' : 'reviewCheck')}</button>
      </div>
    </div> : <span>{t('reviewLoading')}</span>}
    {(validation || error) && <div className='dsh-review-settings-error' role='alert' title={error || undefined}>{validation ? t(validation) : error}</div>}
    {notice && <div className='dsh-review-settings-notice' role='status'>{t(notice)}</div>}
    </dialog>
  </div>
}
