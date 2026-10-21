import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { IFunctionModulesPanel } from '../functionModulesTypes.ts';
import { cn } from '../../ui/cn.ts';
import {
  getFunctionEpicAnchorId,
  getFunctionItemAnchorId,
} from './moduleTreeAnchors.ts';
import { EllipsisTooltip } from '../../ui/ellipsis-tooltip.tsx'
import { IconFont } from '../../ui/icon-font.tsx';
import { useLang } from '../../host.ts';

interface IFunctionModulesTreeProps {
  data: IFunctionModulesPanel[];
  activeAnchorId: string | null;
  onSelect: (anchorId: string) => void;
}

export const FunctionModulesTree: React.FC<IFunctionModulesTreeProps> = ({
  data,
  activeAnchorId,
  onSelect,
}) => {
  const t = useLang();
  const [expandedEpics, setExpandedEpics] = useState<Record<string, boolean>>(
    {}
  );

  const normalizedExpandedEpics = useMemo(() => {
    return data.reduce<Record<string, boolean>>((acc, panel) => {
      panel.modules.forEach((_, epicIndex) => {
        const anchorId = getFunctionEpicAnchorId(panel.panel_id, epicIndex);
        acc[anchorId] = expandedEpics[anchorId] ?? false;
      });
      return acc;
    }, {});
  }, [data, expandedEpics]);

  if (data.length === 0) {
    return null;
  }

  return (
    <aside className='h-full p-4 pt-3'>
      <div className='flex items-center gap-2 pb-3 text-[var(--ds-text-9)] text-sm'>
        <IconFont
          type='icon-line-operation-unfold'
          className='text-[var(--ds-text-7)]'
        />
        <EllipsisTooltip>{t.application_mind_map}</EllipsisTooltip>
      </div>

      <div className='h-[calc(100%-36px)] overflow-y-auto pr-1'>
        <div className='space-y-1'>
          {data.map((panel, panelIndex) => {
            return panel.modules.map((epic, epicIndex) => {
              const epicAnchorId = getFunctionEpicAnchorId(
                panel.panel_id,
                epicIndex
              );
              const isEpicExpanded = normalizedExpandedEpics[epicAnchorId];

              return (
                <div key={`${panelIndex}-${epicAnchorId}`}>
                  <button
                    type='button'
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg font-[500] px-2 py-2 text-left text-sm text-[var(--ds-text-primary)] transition-colors'
                    )}
                    onMouseDown={event => {
                      event.preventDefault();
                    }}
                    onClick={() => {
                      setExpandedEpics(prev => ({
                        ...prev,
                        [epicAnchorId]: !isEpicExpanded,
                      }));
                      onSelect(epicAnchorId);
                    }}
                  >
                    {isEpicExpanded ? (
                      <ChevronDown className='h-4 w-4 text-[var(--ds-text-tertiary)]' />
                    ) : (
                      <ChevronRight className='h-4 w-4 text-[var(--ds-text-tertiary)]' />
                    )}
                    <span className='truncate'>{epic.epic_name}</span>
                  </button>

                  {isEpicExpanded && (
                    <div className='relative ml-4 pl-4'>
                      <div>
                        {epic.function_modules.map((module, moduleIndex) => {
                          const functionAnchorId = getFunctionItemAnchorId(
                            module.function_id
                          );
                          const isLastNode =
                            moduleIndex === epic.function_modules.length - 1;

                          return (
                            <div key={module.function_id} className='relative'>
                              <div
                                className={cn(
                                  'pointer-events-none absolute -left-4 top-[-10px] w-px bg-[var(--ds-border-default)]',
                                  isLastNode ? 'h-[18px]' : 'h-full'
                                )}
                              />
                              <div
                                className={cn(
                                  'pointer-events-none absolute -left-4 top-[35%] h-[12px] w-4 -translate-y-1/2 rounded-bl-[12px] border-b border-l border-[var(--ds-border-default)]'
                                )}
                              />
                              <button
                                type='button'
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-[var(--ds-text-secondary)] transition-colors'
                                )}
                                onMouseDown={event => {
                                  event.preventDefault();
                                }}
                                onClick={() => onSelect(functionAnchorId)}
                              >
                                <span className='truncate'>
                                  {module.function_name}
                                </span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            });
          })}
        </div>
      </div>
    </aside>
  );
};

export default FunctionModulesTree;
