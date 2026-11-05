import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { browserRandomUuid } from '../browser-uuid.ts'
import { Settings } from 'lucide-react'
import type { DesignRuntime } from './workspace.tsx'
import { panelText, type PanelMessageKey } from '../panel-i18n.tsx'
import { useCurrentLanguage } from './ported/host.ts'

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
  useEffect(() => {
    let disposed = false
    void runtime.readReviewPolicy!(sessionId).then(value => {
      if (disposed) return
      setPolicy({...value,mode:value.mode==='every-publication'?'auto':value.mode}); setSeconds(String(value.autoMergeWindowMs / 1000)); setMinutes(String((value.continuousIntervalMs ?? 600000) / 60000))
    }).catch(failure => { if (!disposed) setError(String(failure)) })
    return () => { disposed = true }
  }, [runtime, sessionId])
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
      <label>{t('reviewMode')} <select aria-label={t('reviewMode')} disabled={saving} value={policy.mode} onChange={event => { setPolicy({ ...policy, mode: event.target.value as Policy['mode'] }); setNotice('') }}>
        <option value='continuous'>{t('reviewModeContinuous')}</option><option value='auto'>{t('reviewModeAuto')}</option><option value='off'>{t('reviewModeOff')}</option>
      </select></label>
      {policy.mode === 'auto' && <label>{t('reviewMergeWindow')} <input aria-label={t('reviewMergeWindow')} type='number' min='0' max='3600' step='0.001' disabled={saving} value={seconds} onChange={event => { setSeconds(event.target.value); setNotice('') }} /></label>}
      {policy.mode === 'continuous' && <><label>{t('reviewInterval')} <input aria-label={t('reviewInterval')} type='number' min='1' max='1440' step='1' disabled={saving} value={minutes} onChange={event=>{setMinutes(event.target.value);setNotice('')}} /></label><p className='dsh-review-settings-help'>{t('reviewContinuousHint')}</p></>}
      <p className='dsh-review-settings-help'>{t('reviewOffHint')}</p>
      <div className='dsh-review-settings-actions'>
      <button type='button' className='dsh-review-settings-save' disabled={saving} onClick={() => {
        const autoMergeWindowMs = Number(seconds) * 1000
        const continuousIntervalMs = Number(minutes) * 60000
        if (!seconds.trim() || !Number.isSafeInteger(autoMergeWindowMs) || autoMergeWindowMs < 0 || autoMergeWindowMs > 3600000) { setValidation('reviewSecondsInvalid'); return }
        if (!minutes.trim() || !Number.isSafeInteger(Number(minutes)) || continuousIntervalMs < 60000 || continuousIntervalMs > 86400000) { setValidation('reviewMinutesInvalid'); return }
        setSavingPolicy(true); setError(''); setValidation('')
        void runtime.updateReviewPolicy!(sessionId, { ...policy, autoMergeWindowMs, continuousIntervalMs }).then(value=>{setPolicy(value);setNotice('reviewSettingsSaved')})
          .catch(failure => setError(String(failure))).finally(() => setSavingPolicy(false))
      }}>{t(saving ? 'reviewSaving' : 'reviewSave')}</button>
      <button type='button' className='dsh-review-settings-check' disabled={checking||saving} onClick={()=>{
        const requestId=manualRequestId??browserRandomUuid()
        setManualRequestId(requestId);setChecking(true);setError('');setValidation('');setNotice('')
        void runtime.sendPrompt(sessionId,t('reviewRequestPrompt', { requestId: JSON.stringify(requestId) }),requestId)
          .then(()=>{setNotice('reviewRequestSent');setManualRequestId(undefined)})
          .catch(failure=>setError(String(failure))).finally(()=>setChecking(false))
      }}>{t(checking ? 'reviewSending' : 'reviewCheck')}</button>
      </div>
    </div> : <span>{t('reviewLoading')}</span>}
    {(validation || error) && <div className='dsh-review-settings-error' role='alert'>{validation ? t(validation) : error}</div>}
    {notice && <div className='dsh-review-settings-notice' role='status'>{t(notice)}</div>}
    </dialog>
  </div>
}
