import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExecutionLogMessage, ExecutionRollingLog, useExecutionLogTail } from '../../panel/src/client/execution-rolling-log.tsx'
import type { DesignPanelWorkspaceRead, DesignExecutionLogRead } from '../../panel/src/client/types.ts'
import type { ReactNode } from 'react'
import { compactConversationHistory, conversationWork } from './conversation-history.mjs'

import { ConversationActivity as WorkActivity, ConversationMessage } from '../../studio-ui/src/ConversationActivity.tsx'

export interface RecordedConversation {
  available: boolean
  threadId?: string
  recordedStatus: string
  catchingUp?: boolean
  backgroundActivity?: boolean
  activityEpoch?: string | number
  lastEventAt?: string
  designSessionStartedAt?: string
  error?: string
  omitted: number
  rows: { id: string; role: string; label: string; text: string; status: string; timestamp?: string; activityEpoch?: string | number; childRunIds?: string[];
    questions?: { id: string; question: string; options: { label: string; description: string }[] }[] }[]
}

export function Conversation({ hostLabel = '原生 Agent', value, thread, visible, onClose, send, attempts = [], readExecutionLog, beforeComposer, continuation, composerDisabledReason, showDesignShortcut = true, onDraftChange, initialDraft, renderError }: { hostLabel?: string; value?: RecordedConversation; thread?: string; visible: boolean; onClose: () => void; send: (text: string) => Promise<void>; attempts?: DesignPanelWorkspaceRead['executionAttempts']; readExecutionLog?: (runId: string, afterSeq?: number) => Promise<DesignExecutionLogRead>; beforeComposer?: ReactNode; continuation?: ReactNode; composerDisabledReason?: string; showDesignShortcut?: boolean; onDraftChange?: (draft: string) => void; initialDraft?: string; renderError?: (message: string, source: 'history' | 'send') => ReactNode }) {
  const [draft, setDraft] = useState(initialDraft ?? '')
  const usedPrefill = useRef(initialDraft)
  useEffect(() => {
    if (!initialDraft || usedPrefill.current === initialDraft) return
    usedPrefill.current = initialDraft
    setDraft(current => current.trim() ? current : initialDraft)
  }, [initialDraft])
  useEffect(() => { onDraftChange?.(draft) }, [draft, onDraftChange])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notifying, setNotifying] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)
  const connectionInfo = useRef<HTMLDivElement>(null)
  const sendMenu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (sendMenu.current && !sendMenu.current.contains(event.target as Node)) sendMenu.current.open = false
      if (connectionInfo.current && !connectionInfo.current.contains(event.target as Node)) setConnectionOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:900px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width:900px)')
    const update = () => setCompact(media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])
  const savedScroll = useRef(0)
  const revision = `${visible}:${JSON.stringify(value)}`
  const { scrollRef, onScroll } = useExecutionLogTail<HTMLDivElement>(revision, value?.threadId)
  useLayoutEffect(() => {
    if (visible && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current
  }, [visible])
  const work=conversationWork(value, attempts)
  const state = ({ running: '运行中', background:'正在处理后台评审', waiting:'等待你回答', completed: '本轮已结束', interrupted: '已中断', failed: '失败', unknown: '状态同步中' } as Record<string, string>)[work.status] ?? '未知'
  return <section id="companion-conversation" className="companion-conversation" data-conversation-boundary data-advisory-cover-composer={compact || undefined} aria-label={`${hostLabel} 会话`} hidden={!visible}>
    <header className="dsh-design-project-header"><div className="companion-conversation-heading"><div className="companion-conversation-title"><strong>{hostLabel} 对话</strong>
      <div ref={connectionInfo} className="companion-connection" data-open={connectionOpen || undefined}>
        <button type="button" aria-label="连接信息" aria-expanded={connectionOpen} onClick={() => setConnectionOpen(open => !open)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6v1"/></svg></button>
        <div className="companion-connection-popover">
          <p>{hostLabel} · {thread ?? '连接中'}</p>
          <p>{work.status === 'unknown' ? '尚未确认主对话状态；不表示正在运行。' : `主对话：${state}`}</p>
          {value?.designSessionStartedAt && <p>仅同步本项目本次设计会话；此前记录请在 {hostLabel} 中查看。刷新或重开不会重设同步起点。</p>}
          <p>同步原生已记录消息，非逐 token 直播。权限审批和需要回答的问题请在 {hostLabel} 中处理；Producer 日志随历史显示，Worker 日志在对应产物中显示。</p>
        </div>
      </div>
      </div>
      {['running', 'waiting', 'failed', 'interrupted'].includes(work.status) && <span role="status">{work.status==='running' && <span className="companion-spinner" aria-hidden="true"/>}主对话：{state}</span>}</div>
      <button type="button" className="companion-icon-button" aria-label="关闭对话区域" title="收起对话" onClick={onClose}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>
      </button>
    </header>
    {!value?.available && (value?.error && renderError ? renderError(value.error, 'history') : <p role="status" className="companion-conversation-hint">{value?.error ?? '正在读取会话…'}</p>)}
    {value?.catchingUp && <p role="status" className="companion-conversation-hint companion-sync-status"><span className="companion-spinner" aria-hidden="true"/>正在追赶会话记录…</p>}
    <div className="companion-conversation-history" data-conversation-scroll ref={scrollRef} onScroll={event => {
      if (!visible || event.currentTarget.clientHeight === 0) return
      savedScroll.current = event.currentTarget.scrollTop
      onScroll(event)
    }}>
      {!!value?.omitted && <p className="companion-conversation-hint">显示最近 {value.rows.length} 条；更早记录请在 {hostLabel} 中查看。</p>}
      {visible && compactConversationHistory(value?.rows, attempts).map(entry => entry.kind === 'activity' ? <WorkActivity key={entry.rows[0].id} rows={entry.rows}
        active={work.activeId===entry.rows[0].id} terminal={['completed','failed','interrupted'].includes(work.status)} renderText={text => <ExecutionLogMessage message={text} />}/>
      : entry.kind === 'message' ? <ConversationMessage key={entry.row.id} row={entry.row} renderText={text => <ExecutionLogMessage message={text} />}>
        {entry.row.questions?.map(question => <section key={question.id} aria-label="原生提问" className="companion-native-question">
          <p>{question.question}</p>
          <ul>{question.options.map((option, i) => <li key={i}><span>{option.label}</span>{option.description && <p>{option.description}</p>}</li>)}</ul>
          <small>{entry.row.status === 'running' ? `请在 ${hostLabel} 中选择或回答；此处同步展示，不代替原生回答。` : `原生提问调用已结束，请以 ${hostLabel} 中的结果为准。`}</small>
        </section>)}
      </ConversationMessage> : <div key={entry.attempt.attemptId} data-producer-run={entry.attempt.runId}>
        {entry.earlier && <p className="companion-conversation-hint">该任务的启动条目不在当前历史窗口中</p>}
        <ExecutionRollingLog runId={entry.attempt.runId} label={`${entry.attempt.skill} · Producer`} presentation="conversation"
          active={entry.attempt.phase === 'working' || entry.attempt.phase === 'queued'}
          terminalSequence={['completed', 'failed', 'cancelled'].includes(entry.attempt.phase) ? entry.attempt.sequence : undefined}
          readExecutionLog={readExecutionLog} />
      </div>)}
    </div>
    {beforeComposer}
    {continuation}
    <form data-composer-card onSubmit={async event => {
      event.preventDefault()
      if (!thread || !draft.trim() || sending || composerDisabledReason) return
      setSending(true); setError('')
      try { await send(draft); setDraft(current => current === draft ? '' : current) }
      catch (error) { setError(String(error)) }
      finally { setSending(false) }
    }}>
      <div className="companion-input-shell">
      <textarea aria-label={`发送给当前 ${hostLabel} 会话`} rows={3} placeholder={`发送到同一个 ${hostLabel} 会话…（Enter 发送，Shift+Enter 换行）`} value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          if (!sending && thread && draft.trim() && !composerDisabledReason) event.currentTarget.form?.requestSubmit()
        }} />
      <div className="companion-composer-actions">
        <div className="companion-send-group">
          <button type="submit" disabled={!thread || sending || !draft.trim() || !!composerDisabledReason}>{sending ? '正在发送…' : `发送到 ${hostLabel}`}</button>
          {showDesignShortcut && <details ref={sendMenu} className="companion-send-menu" onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary aria-label="更多发送操作" title="更多发送操作">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
            </summary>
            <div className="companion-send-options">
              <button type="button" className="companion-notify" disabled={!thread || notifying} onClick={async () => {
                if (sendMenu.current) sendMenu.current.open = false
                setNotifying(true)
                try { await send('请读取当前设计文件，基于已保存的内容继续设计。') }
                catch { /* Delivery feedback is displayed by the shared send path. */ }
                finally { setNotifying(false) }
              }}>{notifying ? '正在通知…' : '读取当前设计文件并继续'}</button>
            </div>
          </details>}
        </div>
      </div>
      </div>
      {composerDisabledReason && <p role="status">{composerDisabledReason}</p>}
      {error && (renderError ? renderError(error, 'send') : <p role="alert">{error}</p>)}
    </form>
  </section>
}
