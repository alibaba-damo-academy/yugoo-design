import { useEffect, useId, useRef, useState, type ReactElement } from 'react'
import { browserRandomUuid } from '../browser-uuid.ts'
import { Settings } from 'lucide-react'
import type { DesignRuntime } from './workspace.tsx'

export function ReviewPolicyControl({ sessionId, runtime }: { sessionId: string; runtime: DesignRuntime }): ReactElement {
  type Policy = import('../../../core/src/design-review-policy.ts').DesignReviewPolicy
  const [policy, setPolicy] = useState<Policy>()
  const [seconds, setSeconds] = useState('30')
  const [minutes, setMinutes] = useState('10')
  const [error, setError] = useState('')
  const [saving, setSavingPolicy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [manualRequestId, setManualRequestId] = useState<string>()
  const [notice, setNotice] = useState('')
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
      <Settings size={14} aria-hidden='true' />设置
    </button>
    <dialog ref={settingsDialog} className='dsh-review-settings-dialog' aria-labelledby={titleId}>
    <header className='dsh-review-settings-header'>
      <div><h2 id={titleId}>GRA 评审设置</h2><p>仅对当前项目生效，保存后应用。</p></div>
      <button type='button' className='dsh-review-settings-close' aria-label='关闭评审设置' onClick={() => settingsDialog.current?.close()}>×</button>
    </header>
    {policy ? <div className='dsh-review-settings-fields'>
      <label>评审模式 <select aria-label='评审模式' disabled={saving} value={policy.mode} onChange={event => { setPolicy({ ...policy, mode: event.target.value as Policy['mode'] }); setNotice('') }}>
        <option value='continuous'>持续（定时重新检查）</option><option value='auto'>自动（AI + 发布规则）</option><option value='off'>关闭（仅用户手动检查）</option>
      </select></label>
      {policy.mode === 'auto' && <label>自动合并窗口（秒） <input aria-label='自动合并窗口（秒）' type='number' min='0' max='3600' step='0.001' disabled={saving} value={seconds} onChange={event => { setSeconds(event.target.value); setNotice('') }} /></label>}
      {policy.mode === 'continuous' && <><label>检查间隔（分钟） <input aria-label='检查间隔（分钟）' type='number' min='1' max='1440' step='1' disabled={saving} value={minutes} onChange={event=>{setMinutes(event.target.value);setNotice('')}} /></label><p className='dsh-review-settings-help'>内容不变也重审，会消耗 Token；服务在线时运行，忙时不积累补跑。</p></>}
      <p className='dsh-review-settings-help'>关闭不影响 KAG 更新或 Clarity。</p>
      <div className='dsh-review-settings-actions'>
      <button type='button' className='dsh-review-settings-save' disabled={saving} onClick={() => {
        const autoMergeWindowMs = Number(seconds) * 1000
        const continuousIntervalMs = Number(minutes) * 60000
        if (!seconds.trim() || !Number.isSafeInteger(autoMergeWindowMs) || autoMergeWindowMs < 0 || autoMergeWindowMs > 3600000) { setError('请输入 0–3600 秒'); return }
        if (!minutes.trim() || !Number.isSafeInteger(Number(minutes)) || continuousIntervalMs < 60000 || continuousIntervalMs > 86400000) { setError('请输入 1–1440 分钟'); return }
        setSavingPolicy(true); setError('')
        void runtime.updateReviewPolicy!(sessionId, { ...policy, autoMergeWindowMs, continuousIntervalMs }).then(value=>{setPolicy(value);setNotice('设置已保存并生效。')})
          .catch(failure => setError(String(failure))).finally(() => setSavingPolicy(false))
      }}>{saving ? '保存中…' : '保存设置'}</button>
      <button type='button' className='dsh-review-settings-check' disabled={checking||saving} onClick={()=>{
        const requestId=manualRequestId??browserRandomUuid()
        setManualRequestId(requestId);setChecking(true);setError('');setNotice('')
        void runtime.sendPrompt(sessionId,`用户明确要求对当前已发布设计手动执行 GRA 检查，requestId=${JSON.stringify(requestId)}。先读取当前能力与评审策略；可用且不占用主对话时，使用 design_recheck_reviews 正常后台执行，不等待完成。后台不可用或会占用主对话时，先询问用户是否关闭自动 GRA（保留手动检查），或确认本次在主对话同步检查；只有明确确认同步后，才使用 executionMode="foreground"。未经用户选择不改变评审策略、不自动同步运行。`,requestId)
          .then(()=>{setNotice('手动检查请求已发送，请在原对话查看执行状态。');setManualRequestId(undefined)})
          .catch(failure=>setError(String(failure))).finally(()=>setChecking(false))
      }}>{checking?'发送请求中…':'手动检查一次'}</button>
      </div>
    </div> : <span>正在读取设置…</span>}
    {error && <div className='dsh-review-settings-error' role='alert'>{error}</div>}
    {notice && <div className='dsh-review-settings-notice' role='status'>{notice}</div>}
    </dialog>
  </div>
}
