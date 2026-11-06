import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ExecutionLogMessage, ExecutionRollingLog, useExecutionLogTail } from '../../panel/src/client/execution-rolling-log.tsx'
import type { DesignPanelWorkspaceRead, DesignExecutionLogRead } from '../../panel/src/client/types.ts'
import type { ReactNode } from 'react'
import { compactConversationHistory, conversationWork } from './conversation-history.mjs'
import { companionChromeText, type CompanionChromeKey } from './locale.ts'

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

export function Conversation({ locale = 'zh', hostLabel: suppliedHostLabel, value, thread, visible, onClose, send, attempts = [], readExecutionLog, beforeComposer, continuation, composerDisabledReason, showDesignShortcut = true, onDraftChange, initialDraft, renderError }: { locale?: string; hostLabel?: string; value?: RecordedConversation; thread?: string; visible: boolean; onClose: () => void; send: (text: string) => Promise<void>; attempts?: DesignPanelWorkspaceRead['executionAttempts']; readExecutionLog?: (runId: string, afterSeq?: number) => Promise<DesignExecutionLogRead>; beforeComposer?: ReactNode; continuation?: ReactNode; composerDisabledReason?: string; showDesignShortcut?: boolean; onDraftChange?: (draft: string) => void; initialDraft?: string; renderError?: (message: string, source: 'history' | 'send') => ReactNode }) {
  const t = (key: CompanionChromeKey, values?: Record<string, string | number>) => companionChromeText(key, locale, values)
  const hostLabel = suppliedHostLabel || t('nativeAgent')
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
  const state = ({ running: t('workRunning'), background: t('workBackground'), waiting: t('workWaiting'), completed: t('workCompleted'), interrupted: t('workInterrupted'), failed: t('workFailed'), unknown: t('workUnknown') } as Record<string, string>)[work.status] ?? t('unknown')
  return <section id="companion-conversation" className="companion-conversation" data-conversation-boundary data-advisory-cover-composer={compact || undefined} aria-label={t('conversationTitle', { host: hostLabel })} hidden={!visible}>
    <header className="dsh-design-project-header"><div className="companion-conversation-heading"><div className="companion-conversation-title"><strong>{t('conversationTitle', { host: hostLabel })}</strong>
      <div ref={connectionInfo} className="companion-connection" data-open={connectionOpen || undefined}>
        <button type="button" aria-label={t('connectionInfo')} aria-expanded={connectionOpen} onClick={() => setConnectionOpen(open => !open)}><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6v1"/></svg></button>
        <div className="companion-connection-popover">
          <p>{hostLabel} · {thread ?? t('connecting')}</p>
          <p>{work.status === 'unknown' ? t('conversationStatusUnknown') : t('mainConversationStatus', { state })}</p>
          {value?.designSessionStartedAt && <p>{t('conversationSessionBoundary', { host: hostLabel })}</p>}
          <p>{t('conversationRecordedMessages', { host: hostLabel })}</p>
        </div>
      </div>
      </div>
      {['running', 'waiting', 'failed', 'interrupted'].includes(work.status) && <span role="status">{work.status==='running' && <span className="companion-spinner" aria-hidden="true"/>}{t('mainConversationStatus', { state })}</span>}</div>
      <button type="button" className="companion-icon-button" aria-label={t('closeConversation')} title={t('collapseConversation')} onClick={onClose}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg>
      </button>
    </header>
    {!value?.available && (value?.error && renderError ? renderError(value.error, 'history') : <p role="status" className="companion-conversation-hint">{value?.error ?? t('conversationReading')}</p>)}
    {value?.catchingUp && <p role="status" className="companion-conversation-hint companion-sync-status"><span className="companion-spinner" aria-hidden="true"/>{t('conversationCatchingUp')}</p>}
    <div className="companion-conversation-history" data-conversation-scroll ref={scrollRef} onScroll={event => {
      if (!visible || event.currentTarget.clientHeight === 0) return
      savedScroll.current = event.currentTarget.scrollTop
      onScroll(event)
    }}>
      {!!value?.omitted && <p className="companion-conversation-hint">{t('conversationRecent', { count: value.rows.length, host: hostLabel })}</p>}
      {visible && compactConversationHistory(value?.rows, attempts).map(entry => entry.kind === 'activity' ? <WorkActivity key={entry.rows[0].id} rows={entry.rows}
        locale={locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'} active={work.activeId===entry.rows[0].id} terminal={['completed','failed','interrupted'].includes(work.status)} renderText={text => <ExecutionLogMessage message={text} />}/>
      : entry.kind === 'message' ? <ConversationMessage key={entry.row.id} row={entry.row} renderText={text => <ExecutionLogMessage message={text} />}>
        {entry.row.questions?.map(question => <section key={question.id} aria-label={t('nativeQuestion')} className="companion-native-question">
          <p>{question.question}</p>
          <ul>{question.options.map((option, i) => <li key={i}><span>{option.label}</span>{option.description && <p>{option.description}</p>}</li>)}</ul>
          <small>{t(entry.row.status === 'running' ? 'nativeAnswerInHost' : 'nativeQuestionEnded', { host: hostLabel })}</small>
        </section>)}
      </ConversationMessage> : <div key={entry.attempt.attemptId} data-producer-run={entry.attempt.runId}>
        {entry.earlier && <p className="companion-conversation-hint">{t('conversationEarlierTask')}</p>}
        <ExecutionRollingLog locale={locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'} runId={entry.attempt.runId} label={`${entry.attempt.skill} · Producer`} presentation="conversation"
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
      <textarea aria-label={t('messageCurrentHost', { host: hostLabel })} rows={3} placeholder={t('messagePlaceholder', { host: hostLabel })} value={draft} onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          event.preventDefault()
          if (!sending && thread && draft.trim() && !composerDisabledReason) event.currentTarget.form?.requestSubmit()
        }} />
      <div className="companion-composer-actions">
        <div className="companion-send-group">
          <button type="submit" disabled={!thread || sending || !draft.trim() || !!composerDisabledReason}>{sending ? t('sending') : t('sendToHost', { host: hostLabel })}</button>
          {showDesignShortcut && <details ref={sendMenu} className="companion-send-menu" onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary aria-label={t('moreSendOptions')} title={t('moreSendOptions')}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
            </summary>
            <div className="companion-send-options">
              <button type="button" className="companion-notify" disabled={!thread || notifying} onClick={async () => {
                if (sendMenu.current) sendMenu.current.open = false
                setNotifying(true)
                try { await send(t('readAndContinuePrompt')) }
                catch (error) { setError(String(error)) }
                finally { setNotifying(false) }
              }}>{notifying ? t('notifying') : t('readAndContinue')}</button>
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
