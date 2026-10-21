import { useCallback, useEffect, useRef, useState, type ReactElement, type RefObject, type UIEvent } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { DesignExecutionLogRead, DesignArtifactLogTarget } from './types.ts'
import { requestLivePoll, subscribeLivePoll } from './live-poll.ts'

export interface ExecutionRollingLogProps {
  runId?: string
  active?: boolean
  /** Host-verified artifact association; never a transcript path. */
  logTarget?: DesignArtifactLogTarget
  /** Monotonic Producer attempt sequence present only after this run settles. */
  terminalSequence?: number
  locale?: 'zh' | 'en'
  label?: string
  readExecutionLog?: (runId: string, afterSeq?: number, target?: DesignArtifactLogTarget) => Promise<DesignExecutionLogRead>
  unavailableLabel?: string
  maxEntries?: number
  presentation?: 'panel' | 'conversation'
}

/**
 * Conversation logs follow the lifecycle of their Producer by default: a new
 * or restarted run opens, and a run that just finished folds back to its
 * header. A user's manual choice remains untouched while the lifecycle is
 * otherwise stable.
 */
export function reconcileConversationLogExpanded(
  expanded: boolean,
  previousRunId: string | undefined,
  runId: string | undefined,
  previousActive: boolean,
  active: boolean,
): boolean {
  if (previousRunId !== runId) return active
  if (!previousActive && active) return true
  if (previousActive && !active) return false
  return expanded
}

/** Detect the exact terminal Producer observation that must fold an open conversation log once. */
export function isNewConversationLogTerminal(
  previousTerminalSequence: number | undefined,
  terminalSequence: number | undefined,
): boolean {
  return terminalSequence !== undefined && previousTerminalSequence !== terminalSequence
}

function ActivityIcon({ type }: { type: DesignExecutionLogRead['entries'][number]['eventType'] }): ReactElement {
  const path = type === 'message'
    ? <><path d='M3 3.5h10v7H7l-3 2v-2H3z'/></>
    : type === 'search'
    ? <><circle cx='7' cy='7' r='4'/><path d='m10 10 3 3'/></>
    : type === 'fetch'
      ? <><path d='M6.5 9.5 9.5 6.5'/><path d='M5 11H4a3 3 0 0 1 0-6h2'/><path d='M10 5h1a3 3 0 0 1 0 6H9'/></>
      : type === 'error'
        ? <><circle cx='8' cy='8' r='6'/><path d='m6 6 4 4m0-4-4 4'/></>
        : <><path d='M8 2v3M8 11v3M2 8h3M11 8h3'/><circle cx='8' cy='8' r='2'/></>
  return <svg viewBox='0 0 16 16' width='14' height='14' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round'>{path}</svg>
}

const ENTRY_ICON_COLOR: Record<DesignExecutionLogRead['entries'][number]['eventType'], string> = {
  message: '#475569',
  search: '#6366f1',
  fetch: '#0284c7',
  synthesize: '#8b5cf6',
  error: '#ef4444',
}

/** Small tolerance prevents fractional layout pixels from disabling tail follow. */
const SCROLL_BOTTOM_TOLERANCE_PX = 8
const TERMINAL_LOG_RETRY_LIMIT = 8
const isHttpLogUrl = (url: string): boolean => /^https?:\/\//iu.test(url)

/** Append one cursor response while preserving the complete visible transcript. */
export function mergeExecutionLogRead(
  previous: DesignExecutionLogRead | undefined,
  next: DesignExecutionLogRead,
): DesignExecutionLogRead | undefined {
  if (!next.found) return previous
  if (previous === undefined || !previous.found) return next
  // A server cursor reset (cache loss or a changed seed) carries the full
  // snapshot, so replace the accumulated transcript rather than append to it.
  if (next.reset) return next
  if (previous.revision === next.revision) return previous
  const lastSeq = previous.entries.at(-1)?.seq ?? -1
  const appended = next.entries.filter(entry => entry.seq > lastSeq)
  return {
    ...next,
    found: true,
    revision: next.revision,
    reset: false,
    entries: appended.length === 0 ? previous.entries : Object.freeze([...previous.entries, ...appended]),
  }
}

/** Whether one scroll container is still at its live tail. */
export function isExecutionLogAtBottom(element: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_BOTTOM_TOLERANCE_PX
}

/** Shared sticky-tail behavior for every native Producer/Worker log surface. */
export function useExecutionLogTail<T extends HTMLElement = HTMLDivElement>(
  revision: unknown,
  resetKey?: unknown,
): Readonly<{ scrollRef: RefObject<T>; onScroll: (event: UIEvent<T>) => void }> {
  const scrollRef = useRef<T>(null)
  const followTailRef = useRef(true)
  useEffect(() => {
    followTailRef.current = true
  }, [resetKey])
  useEffect(() => {
    const element = scrollRef.current
    if (element !== null && followTailRef.current) element.scrollTop = element.scrollHeight
  }, [revision])
  const onScroll = useCallback((event: UIEvent<T>): void => {
    followTailRef.current = isExecutionLogAtBottom(event.currentTarget)
  }, [])
  return { scrollRef, onScroll }
}

/** Compact HH:MM:SS clock for one transcript row, matching the research trace. */
function formatExecutionTimestamp(timestamp: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function ExternalLinkIcon(): ReactElement {
  return <svg viewBox='0 0 16 16' width='11' height='11' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round'><path d='M9 3.5h3.5v3.5' /><path d='M12.5 3.5 7.5 8.5' /><path d='M11 9.5V13H3V5h3.5' /></svg>
}

const executionLogMarkdownComponents: Components = {
  p: ({ node, ...props }) => <p style={{ margin: 0 }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '3px 0 7px', paddingLeft: 20 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '3px 0 7px', paddingLeft: 20 }} {...props} />,
  li: ({ node, ...props }) => <li style={{ margin: '2px 0' }} {...props} />,
  h1: ({ node, ...props }) => <h1 style={{ margin: '7px 0 4px', fontSize: '1.08em', fontWeight: 650 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ margin: '7px 0 4px', fontSize: '1.04em', fontWeight: 650 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ margin: '6px 0 3px', fontSize: '1em', fontWeight: 650 }} {...props} />,
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 650, color: 'rgba(16,8,43,0.9)' }} {...props} />,
  code: ({ node, ...props }) => <code style={{ borderRadius: 3, background: '#f2eff7', padding: '1px 4px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.92em' }} {...props} />,
  pre: ({ node, ...props }) => <pre style={{ margin: '5px 0 7px', overflowX: 'auto', borderRadius: 5, background: '#f6f4f9', padding: '7px 9px', whiteSpace: 'pre' }} {...props} />,
  blockquote: ({ node, ...props }) => <blockquote style={{ margin: '5px 0', borderLeft: '2px solid #d8d1e7', paddingLeft: 9, color: '#625879' }} {...props} />,
  a: ({ node, ...props }) => <a style={{ color: '#663AE8', textDecoration: 'none' }} target='_blank' rel='noopener noreferrer' {...props} />,
}

export function ExecutionLogMessage({ message }: { message: string }): ReactElement {
  return (
    <div className='dsh-execution-log-markdown' style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={executionLogMarkdownComponents} skipHtml>
        {message}
      </ReactMarkdown>
    </div>
  )
}

/** Poll one Host-authorized native Agent log and preserve the last readable entries. */
export function ExecutionRollingLog({
  runId,
  logTarget,
  active = false,
  terminalSequence,
  locale = 'zh',
  label,
  unavailableLabel,
  readExecutionLog,
  maxEntries,
  presentation = 'panel',
}: ExecutionRollingLogProps): ReactElement | null {
  const identity = JSON.stringify([runId, logTarget?.invocationId, logTarget?.artifactId])
  const limit = Number.isSafeInteger(maxEntries) ? Math.max(1, Math.min(1000, maxEntries!)) : 200
  const [read, setRead] = useState<DesignExecutionLogRead>()
  const [readIdentity, setReadIdentity] = useState(identity)
  const readRef = useRef<DesignExecutionLogRead>()
  const [retrying, setRetrying] = useState(false)
  const [conversationExpanded, setConversationExpanded] = useState(active)
  const previousRunId = useRef(identity)
  const previousActive = useRef(active)
  const previousTerminalSequence = useRef(terminalSequence)
  const { scrollRef, onScroll: handleScroll } = useExecutionLogTail(
    `${identity}:${read?.revision}:${conversationExpanded}`, identity,
  )
  useEffect(() => {
    if (presentation === 'conversation') {
      setConversationExpanded(expanded => reconcileConversationLogExpanded(
        expanded,
        previousRunId.current,
        identity,
        previousActive.current,
        active,
      ))
    }
    previousRunId.current = identity
    previousActive.current = active
  }, [active, presentation, identity])
  useEffect(() => {
    if (presentation === 'conversation'
      && isNewConversationLogTerminal(previousTerminalSequence.current, terminalSequence)) {
      setConversationExpanded(false)
    }
    previousTerminalSequence.current = terminalSequence
  }, [presentation, terminalSequence])
  useEffect(() => {
    setReadIdentity(identity)
    readRef.current = undefined
    setRead(undefined)
    setRetrying(false)
  }, [identity])
  useEffect(() => {
    if (runId === undefined || readExecutionLog === undefined) return
    let disposed = false
    let polling = false
    let terminalAttempts = 0
    let unsubscribe: (() => void) | undefined
    const poll = async (): Promise<void> => {
      if (disposed || polling) return
      polling = true
      try {
        const afterSeq = readRef.current?.entries.at(-1)?.seq
        const next = await readExecutionLog(runId, afterSeq, logTarget)
        if (!disposed) {
          if (next.found) {
            terminalAttempts = TERMINAL_LOG_RETRY_LIMIT
            const result = mergeExecutionLogRead(readRef.current, next)
            const merged = result && result.entries.length > limit ? { ...result, entries: result.entries.slice(-limit) } : result
            readRef.current = merged
            setRead(previous => previous === merged ? previous : merged)
            if (!active) unsubscribe?.()
          } else {
            terminalAttempts += 1
          }
          setRetrying(previous => previous === !next.found ? previous : !next.found)
        }
      } catch {
        if (!disposed) {
          terminalAttempts += 1
          setRetrying(true)
        }
      } finally {
        polling = false
        if (!active && terminalAttempts >= TERMINAL_LOG_RETRY_LIMIT) unsubscribe?.()
      }
    }
    void poll()
    unsubscribe = subscribeLivePoll(() => { void poll() })
    requestLivePoll()
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [active, readExecutionLog, identity, limit])
  if (runId === undefined || readExecutionLog === undefined) return null
  const entries = read === undefined || readIdentity !== identity
    ? []
    : read.entries
  const title = label ?? (locale === 'zh' ? '实时执行日志' : 'Live execution log')
  if (presentation === 'conversation') {
    return (
      <section aria-label={title} aria-live='polite' data-execution-log='producer' style={{ width: '100%', maxWidth: 720, marginTop: 4, border: '1px solid #e5e1ef', borderRadius: 8, background: '#fff', overflow: 'hidden', textAlign: 'left' }}>
        <button
          type='button'
          className='dsh-execution-log-toggle'
          aria-expanded={conversationExpanded}
          onClick={() => { setConversationExpanded(expanded => !expanded) }}
          style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 7, padding: '7px 10px', borderTop: 0, borderRight: 0, borderLeft: 0, borderBottom: conversationExpanded && entries.length > 0 ? '1px solid #eeeaf5' : 0, background: 'transparent', color: '#625879', font: 'inherit', fontSize: 12, fontWeight: 600, textAlign: 'left', cursor: 'pointer' }}
        >
          {active ? <svg aria-hidden viewBox='0 0 16 16' width='12' height='12' fill='none' stroke='#8b5cf6' strokeWidth='2'>
            <circle cx='8' cy='8' r='6' opacity='.24' />
            <path d='M8 2a6 6 0 0 1 6 6'><animateTransform attributeName='transform' type='rotate' from='0 8 8' to='360 8 8' dur='1s' repeatCount='indefinite' /></path>
          </svg> : null}
          <span>{title}</span>
          {retrying ? <span role='status' style={{ marginLeft: 'auto', color: '#8b8498', fontWeight: 400 }}>{unavailableLabel ?? (locale === 'zh' ? '正在连接…' : 'Connecting…')}</span> : null}
          <svg aria-hidden viewBox='0 0 16 16' width='12' height='12' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' style={{ marginLeft: retrying ? 0 : 'auto', transform: conversationExpanded ? 'rotate(180deg)' : undefined, transition: 'transform 120ms ease' }}><path d='m4 6 4 4 4-4' /></svg>
        </button>
        {conversationExpanded && entries.length > 0 ? <div ref={scrollRef} onScroll={handleScroll} style={{ maxHeight: 320, overflow: 'auto', padding: '3px 0' }}>
          {entries.map(entry => <div key={`${entry.seq}:${entry.timestamp}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 10px', fontSize: 13, lineHeight: '19px' }}>
            <span style={{ flex: '0 0 auto', marginTop: 2, color: ENTRY_ICON_COLOR[entry.eventType] ?? '#8b8498' }}><ActivityIcon type={entry.eventType} /></span>
            <span style={{ flex: '0 0 auto', marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, color: '#a49db2' }}>{formatExecutionTimestamp(entry.timestamp)}</span>
            <div style={{ flex: 1, minWidth: 0, color: entry.eventType === 'error' ? 'var(--k-color-danger, #b42318)' : 'rgba(16,8,43,0.78)', overflowWrap: 'anywhere' }}>
              {entry.eventType === 'message' ? <ExecutionLogMessage message={entry.message} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{entry.message}</span>}
              {entry.url && isHttpLogUrl(entry.url) ? <a href={entry.url} target='_blank' rel='noopener noreferrer' aria-label={locale === 'zh' ? '打开链接' : 'Open link'} style={{ marginLeft: 6, color: '#663AE8', display: 'inline-flex', verticalAlign: 'middle' }}><ExternalLinkIcon /></a> : null}
            </div>
          </div>)}
        </div> : conversationExpanded && active ? <div style={{ padding: '8px 10px', color: 'var(--k-color-text-light, #8b8498)', fontSize: 13 }}>
          {retrying
            ? (unavailableLabel ?? (locale === 'zh' ? '正在连接…' : 'Connecting…'))
            : (locale === 'zh' ? 'Agent 正在准备下一步…' : 'Agent is preparing the next step…')}
        </div> : null}
      </section>
    )
  }
  return (
    <section aria-label={title} aria-live='polite' style={{ width: '100%', maxWidth: 560, marginTop: 8, border: '1px solid #e5e1ef', borderRadius: 8, background: '#fff', overflow: 'hidden', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 10px', borderBottom: entries.length > 0 ? '1px solid #eeeaf5' : undefined, color: '#625879', fontSize: 12, fontWeight: 600 }}>
        {active ? <svg aria-hidden viewBox='0 0 16 16' width='12' height='12' fill='none' stroke='#8b5cf6' strokeWidth='2'>
          <circle cx='8' cy='8' r='6' opacity='.24' />
          <path d='M8 2a6 6 0 0 1 6 6'><animateTransform attributeName='transform' type='rotate' from='0 8 8' to='360 8 8' dur='1s' repeatCount='indefinite' /></path>
        </svg> : null}
        <span>{title}</span>
        {retrying ? <span role='status' style={{ marginLeft: 'auto', color: '#8b8498', fontWeight: 400 }}>{unavailableLabel ?? (locale === 'zh' ? '正在连接…' : 'Connecting…')}</span> : null}
      </div>
      {entries.length > 0 ? <div ref={scrollRef} onScroll={handleScroll} style={{ maxHeight: 150, overflow: 'auto', padding: '3px 0' }}>
        {entries.map(entry => <div key={`${entry.seq}:${entry.timestamp}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '2px 10px', color: entry.eventType === 'error' ? '#b42318' : '#5f576c', fontSize: 12, lineHeight: '17px' }}>
          <span style={{ flex: '0 0 auto', marginTop: 1 }}><ActivityIcon type={entry.eventType} /></span>
          <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {entry.eventType === 'message' ? <ExecutionLogMessage message={entry.message} /> : <span style={{ whiteSpace: 'pre-wrap' }}>{entry.message}</span>}
          </div>
        </div>)}
      </div> : active && !retrying ? <div style={{ padding: '8px 10px', color: '#8b8498', fontSize: 12 }}>{locale === 'zh' ? 'Agent 正在准备下一步…' : 'Agent is preparing the next step…'}</div> : null}
    </section>
  )
}
