import React from 'react';
import { cn } from '../../ui/cn.ts';
import type { IResearchDirectionItem, IResearchRound } from './researchTypes.ts';
import { useLangSwitch } from './useLangSwitch.ts';
import { TraceSection } from './ResearchTraceSection.tsx';
import { DesignExecutionStatusIcon } from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';

/**
 * Round-level "live dashboard": while a round is researching, the round-root
 * view splits into one section per direction — each showing its title, key
 * points, and rolling search/fetch trace — all on screen at once. A direction
 * turns green + becomes clickable when it completes (click opens its detail).
 * When the whole round completes, ResearchRootDetail swaps this out for the
 * conclusion markdown.
 */

export interface IResearchRoundDashboardProps {
  round: IResearchRound;
  /** Navigate to a finished direction's detail view. */
  onSelectDirection: (directionId: string) => void;
}

const STATUS_META: Record<
  string,
  { zh: string; en: string; card: string }
> = {
  pending: {
    zh: '待调研',
    en: 'Pending',
    card: 'border-[#ECEBEE]',
  },
  queued: {
    zh: '排队中',
    en: 'Queued',
    card: 'border-violet-200',
  },
  working: {
    zh: '调研中',
    en: 'Working',
    card: 'border-indigo-200',
  },
  completed: {
    zh: '已完成',
    en: 'Completed',
    card: 'border-emerald-300',
  },
  failed: {
    zh: '失败',
    en: 'Failed',
    card: 'border-red-200',
  },
};

const DirectionSection: React.FC<{
  direction: IResearchDirectionItem;
  isZh: boolean;
  onSelect: (id: string) => void;
}> = ({ direction, isZh, onSelect }) => {
  const meta = STATUS_META[direction.status] ?? STATUS_META.pending;
  const isResearching = direction.status === 'working';
  const isQueued = direction.status === 'queued';
  const isCompleted = direction.status === 'completed';
  const points = direction.research_points ?? [];
  const trace = direction.trace ?? [];

  return (
    <div
      className={cn(
        'rounded-xl border bg-white p-4 transition-colors',
        meta.card,
        isCompleted && 'cursor-pointer hover:bg-emerald-50/40'
      )}
      onClick={isCompleted ? () => onSelect(direction.direction_id) : undefined}
      role={isCompleted ? 'button' : undefined}
      tabIndex={isCompleted ? 0 : undefined}
      onKeyDown={
        isCompleted
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(direction.direction_id);
              }
            }
          : undefined
      }
    >
      {/* header: status indicator + title */}
      <div className='flex items-center gap-2'>
        <DesignExecutionStatusIcon
          size='md'
          label={isZh ? meta.zh : meta.en}
          status={isResearching
            ? 'working'
            : isQueued
              ? 'queued'
              : direction.status === 'completed'
                  ? 'completed'
                  : direction.status === 'failed'
                    ? 'failed'
                    : 'pending'}
        />
        <h5 className='flex-1 min-w-0 text-sm font-semibold text-[#10082B] truncate'>
          {direction.title}
        </h5>
        <span
          className={cn(
            'shrink-0 text-xs',
            isCompleted ? 'text-emerald-600' : 'text-gray-400'
          )}
        >
          {isZh ? meta.zh : meta.en}
        </span>
      </div>

      {/* key points (compact) */}
      {points.length > 0 && (
        <ul className='mt-2 space-y-1'>
          {points.slice(0, 3).map((p, i) => (
            <li
              key={i}
              className='flex items-start gap-1.5 text-xs text-[rgba(16,8,43,0.7)] leading-[18px]'
            >
              <span className='mt-1.5 w-1 h-1 rounded-full bg-[#663AE8] shrink-0' />
              <span className='flex-1 truncate'>{p}</span>
            </li>
          ))}
        </ul>
      )}

      {/* rolling search/fetch trace (always-visible while present) */}
      {(trace.length > 0 || direction.trace_unavailable) && (
        <div className='mt-3'>
          <TraceSection entries={trace} isZh={isZh} autoExpand headless unavailable={direction.trace_unavailable} />
        </div>
      )}

      {/* completed → clickable affordance */}
      {isCompleted && (
        <div className='mt-3 text-xs font-medium text-emerald-600'>
          {isZh ? '点击查看调研结果 →' : 'Click to view findings →'}
        </div>
      )}
    </div>
  );
};

export const ResearchRoundDashboard: React.FC<IResearchRoundDashboardProps> = ({
  round,
  onSelectDirection,
}) => {
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';
  const directions = round.directions ?? [];
  const done = directions.filter(d => d.status === 'completed').length;

  return (
    <div className='p-4 space-y-3'>
      <div className='flex items-center gap-2'>
        {round.stage === 'researching' && (
          <DesignExecutionStatusIcon
            status='working'
            label={isZh ? '调研执行中' : 'Research in progress'}
          />
        )}
        <p className='text-xs text-gray-500'>
          {isZh
            ? `${directions.length} 个方向 · ${done} 已完成`
            : `${directions.length} directions · ${done} completed`}
        </p>
      </div>
      <div className='space-y-3'>
        {directions.map(d => (
          <DirectionSection
            key={d.direction_id}
            direction={d}
            isZh={isZh}
            onSelect={onSelectDirection}
          />
        ))}
      </div>
    </div>
  );
};
