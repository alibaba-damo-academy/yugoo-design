import React from 'react';
import { cn } from '../../ui/cn.ts';
import type { IFlowProcessItem } from './flowDesignTypes.ts';
import { useLangSwitch } from '../ResearchPanel/useLangSwitch.ts';
import { DesignPanelNavItem } from '../OfficialWebAppPanels/panelPrimitives.tsx';
import { DesignExecutionStatusIcon } from '../OfficialWebAppPanels/DesignExecutionStatusIcon.tsx';

export interface IFlowProcessNavProps {
  active: IFlowProcessItem[];
  rejected: IFlowProcessItem[];
  selectedId: string | null;
  onSelect: (processId: string) => void;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-red-50 text-red-600',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-emerald-50 text-emerald-700',
};

const PRIORITY_LABELS: Record<string, { en: string; zh: string }> = {
  high: { en: 'High', zh: '高' },
  medium: { en: 'Medium', zh: '中' },
  low: { en: 'Low', zh: '低' },
};

interface IPriorityTagProps {
  priority: string;
  isZh: boolean;
}

const PriorityTag: React.FC<IPriorityTagProps> = ({ priority, isZh }) => {
  const label = PRIORITY_LABELS[priority]?.[isZh ? 'zh' : 'en'] ?? priority;
  return (
    <span
      className={cn(
        'shrink-0 inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none',
        PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
      )}
      aria-label={isZh ? `优先级 ${label}` : `${label} priority`}
    >
      {label}
    </span>
  );
};

interface IGenerationStatusProps {
  bpmnGenerated: boolean;
  status?: IFlowProcessItem['generation_status'];
}

const GenerationStatus: React.FC<IGenerationStatusProps> = ({
  bpmnGenerated,
  status,
}) => (
  <DesignExecutionStatusIcon
    status={status === 'working'
      ? 'working'
      : status === 'queued'
        ? 'queued'
        : status === 'failed'
            ? 'failed'
            : bpmnGenerated && status === 'completed'
              ? 'completed'
              : 'pending'}
    label={status ?? 'pending'}
  />
);

interface IProcessRowProps {
  process: IFlowProcessItem;
  selected: boolean;
  rejected?: boolean;
  isZh: boolean;
  onSelect: (processId: string) => void;
}

const ProcessRow: React.FC<IProcessRowProps> = ({
  process,
  selected,
  rejected,
  isZh,
  onSelect,
}) => (
  <DesignPanelNavItem
    selected={selected}
    onClick={() => onSelect(process.process_id)}
    className={cn('font-normal', rejected && 'opacity-60')}
  >
    {/* <PriorityTag priority={process.priority} isZh={isZh} /> */}
    <span
      className={cn(
        'text-sm leading-[22px] flex-1 min-w-0 break-words',
        rejected && 'line-through',
        selected && !rejected
          ? 'text-[#10082B] font-medium'
          : 'text-[rgba(16,8,43,0.85)]'
      )}
      title={process.title}
    >
      {process.title}
    </span>
    {!rejected && <GenerationStatus bpmnGenerated={process.bpmn_generated} status={process.generation_status} />}
  </DesignPanelNavItem>
);

export const FlowProcessNav: React.FC<IFlowProcessNavProps> = ({
  active,
  rejected,
  selectedId,
  onSelect,
}) => {
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';

  return (
    <div className='py-1'>
      {active.map(process => (
        <ProcessRow
          key={process.process_id}
          process={process}
          selected={process.process_id === selectedId}
          isZh={isZh}
          onSelect={onSelect}
        />
      ))}

      {rejected.length > 0 && (
        <>
          <div className='mt-2 px-2 py-1 text-xs font-medium text-[var(--ds-text-secondary)]'>
            {isZh ? '已拒绝' : 'Rejected'}
          </div>
          {rejected.map(process => (
            <ProcessRow
              key={process.process_id}
              process={process}
              selected={process.process_id === selectedId}
              rejected
              isZh={isZh}
              onSelect={onSelect}
            />
          ))}
        </>
      )}
    </div>
  );
};
