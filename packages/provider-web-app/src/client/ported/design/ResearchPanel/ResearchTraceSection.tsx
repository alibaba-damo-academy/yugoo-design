import React, { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown,
  ChevronRight,
  CircleDot,
  FileText,
  MessageSquareText,
  Search,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { IconFont } from '../../ui/icon-font.tsx';
import { useExecutionLogTail } from 'dsh-design-panel/client-api';
import type { IDirectionTraceEntry } from './researchTypes.ts';

/**
 * Shared rolling execution-trace renderer for a research direction.
 *
 * Extracted from ResearchDirectionDetail so both the per-direction detail view
 * and the round-level split dashboard (ResearchRoundDashboard) render the live
 * native Agent transcript identically. The full bounded Host transcript stays
 * available in a scroll container; the panel does not discard earlier rows.
 */

const TRACE_EVENT_ICONS: Record<
  IDirectionTraceEntry['event_type'],
  { icon: LucideIcon; className: string }
> = {
  message: { icon: MessageSquareText, className: 'text-slate-600' },
  search: { icon: Search, className: 'text-indigo-500' },
  fetch: { icon: FileText, className: 'text-sky-600' },
  synthesize: { icon: Sparkles, className: 'text-violet-500' },
  error: { icon: TriangleAlert, className: 'text-red-500' },
};

const traceMarkdownComponents: Components = {
  p: ({ node, ...props }) => <p className='m-0' {...props} />,
  ul: ({ node, ...props }) => <ul className='my-1 pl-5 list-disc space-y-0.5' {...props} />,
  ol: ({ node, ...props }) => <ol className='my-1 pl-5 list-decimal space-y-0.5' {...props} />,
  li: ({ node, ...props }) => <li className='m-0' {...props} />,
  h1: ({ node, ...props }) => <h1 className='my-1 text-sm font-semibold' {...props} />,
  h2: ({ node, ...props }) => <h2 className='my-1 text-[13px] font-semibold' {...props} />,
  h3: ({ node, ...props }) => <h3 className='my-1 text-xs font-semibold' {...props} />,
  code: ({ node, ...props }) => <code className='rounded bg-[#F2EFF7] px-1 py-0.5 font-mono text-[0.92em]' {...props} />,
  pre: ({ node, ...props }) => <pre className='my-1 overflow-x-auto rounded bg-[#F6F4F9] px-2 py-1.5 whitespace-pre' {...props} />,
  blockquote: ({ node, ...props }) => <blockquote className='my-1 border-l-2 border-[#D8D1E7] pl-2 text-[#625879]' {...props} />,
  a: ({ node, ...props }) => <a className='text-[#663AE8] hover:underline' target='_blank' rel='noopener noreferrer' {...props} />,
};

const TraceMessage: React.FC<{ message: string }> = ({ message }) => (
  <div className='min-w-0 flex-1 break-words text-[rgba(16,8,43,0.75)]'>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={traceMarkdownComponents} skipHtml>
      {message}
    </ReactMarkdown>
  </div>
);

export const formatTraceTimestamp = (ts: number): string => {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export interface ITraceSectionProps {
  entries: IDirectionTraceEntry[];
  isZh: boolean;
  /**
   * Drives auto-expand: true while the direction is mid-flight (researching,
   * no findings yet), false once findings are ready or terminal. Re-syncs when
   * this flips so progress shows live and settles on completion; user clicks
   * during a steady state still win.
   */
  autoExpand: boolean;
  /** Render without the collapsible header — used by the dashboard where the
   * section card already conveys context and we want the log always visible. */
  headless?: boolean;
  /** The native log endpoint failed; existing entries remain visible while polling retries. */
  unavailable?: boolean;
}

export const TraceSection: React.FC<ITraceSectionProps> = ({
  entries,
  isZh,
  autoExpand,
  headless = false,
  unavailable = false,
}) => {
  const [expanded, setExpanded] = useState(autoExpand);
  const first = entries[0];
  const last = entries.at(-1);
  const traceIdentity = first === undefined
    ? 'empty'
    : `${first.timestamp}:${first.event_type}:${first.message}`;
  const traceRevision = last === undefined
    ? 'empty'
    : `${entries.length}:${last.timestamp}:${last.event_type}:${last.message}`;
  const { scrollRef, onScroll } = useExecutionLogTail<HTMLOListElement>(traceRevision, traceIdentity);

  useEffect(() => {
    setExpanded(autoExpand);
  }, [autoExpand]);

  if (entries.length === 0 && !unavailable) return null;

  const total = entries.length;
  const list = entries.length > 0 ? (
    <ol ref={scrollRef} onScroll={onScroll} className='max-h-64 overflow-y-auto rounded-lg border border-[#ECEBEE] bg-[#FAFAFC] p-3 space-y-1.5'>
      {entries.map((entry, idx) => {
        const iconMeta = TRACE_EVENT_ICONS[entry.event_type];
        const EventIcon = iconMeta?.icon ?? CircleDot;
        return (
          <li
            key={`${entry.timestamp}-${idx}`}
            className='flex items-start gap-2 text-xs leading-[18px]'
          >
            <span className={`shrink-0 mt-1 ${iconMeta?.className ?? 'text-gray-400'}`}>
              <EventIcon aria-hidden='true' className='h-3.5 w-3.5' strokeWidth={1.8} />
            </span>
            <span className='shrink-0 text-xs text-gray-400 font-mono mt-1'>
              {formatTraceTimestamp(entry.timestamp)}
            </span>
            <div className='min-w-0 flex-1'>
              {entry.event_type === 'message'
                ? <TraceMessage message={entry.message} />
                : <span className='break-words whitespace-pre-wrap text-[rgba(16,8,43,0.75)]'>{entry.message}</span>}
              {entry.url && (
                <a
                  href={entry.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  aria-label={isZh ? '打开引用链接' : 'Open reference link'}
                  className='ml-1 text-[#663AE8] hover:underline'
                  onClick={e => e.stopPropagation()}
                >
                  <IconFont type='icon-line-operation-relevance' />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  ) : null;

  const content = (
    <div className='space-y-2'>
      {unavailable && (
        <div role='status' className='rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-700'>
          {isZh ? '实时日志暂不可用，正在重试…' : 'Live logs are temporarily unavailable. Retrying…'}
        </div>
      )}
      {list}
    </div>
  );

  if (headless) {
    return content;
  }

  return (
    <div>
      <button
        type='button'
        onClick={() => setExpanded(!expanded)}
        className='flex items-center gap-1 text-sm font-medium text-gray-500 mb-2 hover:text-[#663AE8] transition-colors'
      >
        {expanded ? (
          <ChevronDown className='h-4 w-4 shrink-0 text-[var(--ds-text-tertiary)]' />
        ) : (
          <ChevronRight className='h-4 w-4 shrink-0 text-[var(--ds-text-tertiary)]' />
        )}
        {isZh ? '执行过程' : 'Execution Trace'}
        <span className='ml-1 text-gray-400 font-normal'>({total})</span>
      </button>
      {expanded && content}
    </div>
  );
};
