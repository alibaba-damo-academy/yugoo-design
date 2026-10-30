/** Shared presentation of Host-recorded messages. Hosts still own execution and transport. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { renderStudioMarkdown } from './markdown.tsx'

export interface AgentConversationRow {
  id: string
  role: string
  label: string
  text: string
  status: string
}

export function ConversationActivity({ rows, active, terminal, locale = 'zh', renderText = renderStudioMarkdown }: {
  rows: readonly AgentConversationRow[]; active: boolean; terminal: boolean; locale?: 'zh' | 'en'; renderText?: (text: string) => ReactNode
}) {
  const [open, setOpen] = useState(active)
  const prior = useRef(active)
  useEffect(() => {
    if (active && !prior.current) setOpen(true)
    else if (terminal) setOpen(false)
    prior.current = active
  }, [active, terminal])
  const zh = locale === 'zh'
  const status = (value: string) => ({ running: zh ? '进行中' : 'Running', completed: zh ? '已完成' : 'Completed',
    failed: zh ? '失败' : 'Failed', cancelled: zh ? '已取消' : 'Cancelled', unknown: zh ? '结果待核对' : 'Outcome unknown' })[value] ?? value
  return <details className="companion-activity" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{active && <span className="companion-spinner" aria-hidden="true" />}
      {zh ? `工作记录 · ${rows.length} 项操作` : `Work activity · ${rows.length} operations`}{active && (zh ? ' · 进行中' : ' · Running')}
      {rows.some(row => row.status === 'failed') && <span className="companion-activity-failed">{zh ? ' · 有失败记录' : ' · Includes failed operations'}</span>}
    </summary>
    <div>{rows.map(row => <article key={row.id} data-role="tool" data-message-id={row.id}>
      <div className="companion-message-label">{row.label} · {status(row.status)}</div>
      {row.text && renderText(row.text)}
    </article>)}</div>
  </details>
}

export function ConversationMessage({ row, renderText = renderStudioMarkdown, children }: {
  row: AgentConversationRow; renderText?: (text: string) => ReactNode; children?: ReactNode
}) {
  return <article className="companion-message" data-role={row.role} data-message-id={row.id}>
    <div className="companion-message-label">{row.label}{row.role === 'tool' ? ` · ${row.status}` : ''}</div>
    {row.text && <div className="companion-message-content">{renderText(row.text)}</div>}
    {children}
  </article>
}

/** Contiguous tools share one disclosure; assistant messages keep their recorded order. */
export function ConversationMessages({ rows, active, terminal, locale }: {
  rows: readonly AgentConversationRow[]; active: boolean; terminal: boolean; locale: 'zh' | 'en'
}) {
  const entries: ({ kind: 'message'; row: AgentConversationRow } | { kind: 'activity'; rows: AgentConversationRow[] })[] = []
  for (const row of rows) {
    const prior = entries.at(-1)
    if (row.role === 'tool') {
      if (prior?.kind === 'activity') prior.rows.push(row)
      else entries.push({ kind: 'activity', rows: [row] })
    } else entries.push({ kind: 'message', row })
  }
  const latest = entries.at(-1)
  return <>{entries.map(entry => entry.kind === 'activity'
    ? <ConversationActivity key={entry.rows[0].id} rows={entry.rows} active={active && entry === latest} terminal={terminal} locale={locale} />
    : <ConversationMessage key={entry.row.id} row={entry.row} />)}</>
}

export const CONVERSATION_ACTIVITY_CSS = `
.companion-message{padding:12px 0;border:0;min-width:0;overflow-wrap:anywhere}
.companion-message-content{font-size:16px;line-height:24px;padding:9px 4px;min-width:0;overflow-wrap:anywhere}
.companion-message[data-role=assistant] .companion-message-content{font-size:14px;line-height:1.7}
.companion-message-content> :first-child{margin-top:0}.companion-message-content> :last-child{margin-bottom:0}
.companion-message[data-role=user]{display:flex;flex-direction:column;align-items:flex-end;padding-left:52px}
.companion-message[data-role=user] .companion-message-label{text-align:right}
.companion-message[data-role=user] .companion-message-content{box-sizing:border-box;max-width:100%;padding:10px 12px;border-radius:8px;background:var(--ds-surface-muted,#f6f6f6);font-size:14px}
.companion-message-label{font-size:12px;color:var(--ds-text-secondary,#6d6d6d);margin-bottom:4px}
.companion-activity{margin:8px 0;font-size:12px;color:var(--ds-text-secondary,#6d6d6d)}
.companion-spinner{display:inline-block;width:12px;height:12px;margin-right:6px;border:2px solid var(--ds-border,#ddd);border-top-color:var(--ds-text-secondary,#666);border-radius:50%;vertical-align:middle;animation:companion-spin .8s linear infinite}
@keyframes companion-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.companion-spinner{animation:none}}
.companion-activity>summary{cursor:pointer;padding:5px 0;overflow-wrap:anywhere}
.companion-activity>summary:focus-visible{outline:2px solid var(--ds-primary,#7c5af6);outline-offset:2px;border-radius:3px}
.companion-activity>div{padding-left:12px;border-left:1px solid var(--ds-border,#e8e8e8)}
.companion-activity article{padding:4px 0;border:0;overflow-wrap:anywhere}
.companion-activity .companion-message-label{margin:0}.companion-activity-failed{color:var(--ds-danger,#a34232)}
`
