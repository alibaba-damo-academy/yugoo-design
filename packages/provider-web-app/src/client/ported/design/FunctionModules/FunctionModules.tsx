import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FrameworkChart } from '../FrameworkChart/FrameworkChart.tsx';
import { CapabilityBoard } from '../CapabilityBoard/CapabilityBoard.tsx';
import { FunctionModulesTree } from './FunctionModulesTree.tsx';
import { EllipsisTooltip } from '../../ui/ellipsis-tooltip.tsx';
import { IconButton } from '../../ui/icon-button.tsx';
import { IconFont } from '../../ui/icon-font.tsx';
import { Button, buttonVariants } from '../../ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.tsx';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../../ui/resizable.tsx';
import type { IFunctionModulesPanel } from '../functionModulesTypes.ts';
import { Loading } from '../../ui/loading.tsx';
import { useLang } from '../../host.ts';
import { getFunctionPanelAnchorId } from './moduleTreeAnchors.ts';
import EmptyPage from '../../ui/empty-page.tsx';
import { useDesignLeftPanelSizes } from '../panelSizing.ts';
import { DesignPanelHeader } from '../OfficialWebAppPanels/panelPrimitives.tsx';

export const FunctionModules = ({
  tabActive,
  moduleViewType,
  filterModule,
  disabled,
  moduleList,
  onAddFeature,
  onFilterChange,
  onAnswer,
  toolbarDisabled,
}: {
  tabActive: string;
  moduleViewType: 'board' | 'mindmap';
  filterModule: 'all' | 'use' | 'reject';
  disabled: boolean;
  moduleList: IFunctionModulesPanel[];
  onAddFeature?: () => void;
  onFilterChange?: (value: 'all' | 'use' | 'reject') => void;
  onAnswer?: (val: IFunctionModulesPanel) => void;
  toolbarDisabled?: boolean;
}) => {
  const t = useLang();

  const [isLoading, setIsLoading] = useState(false);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [showMindMapPreview, setShowMindMapPreview] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const boardContentRef = useRef<HTMLDivElement>(null);
  const leftPanelSizes = useDesignLeftPanelSizes(splitContainerRef);

  // 使用 useMemo 优化过滤逻辑，确保引用变化

  const showModuleList = useMemo(() => {
    try {
      const moduleListTemp = moduleList;

      if (filterModule === 'all') {
        return moduleListTemp;
      } else if (filterModule === 'reject') {
        // Filter for rejected modules only.
        const moduleData = moduleListTemp
          .map(panel => ({
            ...panel,
            modules:
              panel.modules
                ?.map(item => ({
                  ...item,
                  function_modules:
                    item.function_modules?.filter(
                      funEle => funEle?.rejected === true
                    ) ?? [],
                }))
                .filter(item => item.function_modules.length > 0) ?? [],
          }))
          .filter(panel => panel.modules && panel.modules.length > 0);

        return moduleData as IFunctionModulesPanel[];
      } else if (filterModule === 'use') {
        // Filter for active modules only.
        const moduleData = moduleListTemp
          .map(panel => ({
            ...panel,
            modules:
              panel.modules
                ?.map(item => ({
                  ...item,
                  function_modules:
                    item.function_modules?.filter(
                      funEle => !funEle?.rejected
                    ) ?? [],
                }))
                .filter(item => item.function_modules.length > 0) ?? [],
          }))
          .filter(panel => panel.modules && panel.modules.length > 0);

        return moduleData as IFunctionModulesPanel[];
      }

      return [];
    } catch (error) {
      return [];
    }
  }, [filterModule, moduleList]);

  // 当 filterModule 变化时，显示 loading
  useEffect(() => {
    setIsLoading(true);

    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 100); // 100ms 的 loading 动画时间

    return () => clearTimeout(timer);
  }, [filterModule]);

  useEffect(() => {
    if (!showModuleList.length) {
      setActiveAnchorId(null);
      return;
    }

    const firstPanel = showModuleList[0];
    setActiveAnchorId(getFunctionPanelAnchorId(firstPanel.panel_id, 0));
  }, [showModuleList]);

  // Auto-fold to the mind chart when generation finishes: while the skill is
  // running stay on the text cards (live updates), and on the running→done
  // transition (with modules present) reveal the chart. Manual toggle still
  // wins afterward — only fires on the edge, not every render.
  const wasGeneratingRef = useRef(false);
  useEffect(() => {
    if (toolbarDisabled) {
      wasGeneratingRef.current = true;
    } else if (wasGeneratingRef.current) {
      wasGeneratingRef.current = false;
      if (tabActive === 'function_modules' && showModuleList.length) {
        setShowMindMapPreview(true);
      }
    }
  }, [tabActive, toolbarDisabled, showModuleList.length]);

  const previousTabActiveRef = useRef(tabActive);
  useEffect(() => {
    const previousTabActive = previousTabActiveRef.current;
    previousTabActiveRef.current = tabActive;

    if (
      previousTabActive !== 'function_modules' &&
      tabActive === 'function_modules'
    ) {
      setShowMindMapPreview(false);
    }
  }, [tabActive]);

  const handleTreeSelect = (anchorId: string) => {
    setActiveAnchorId(anchorId);

    const container = boardContentRef.current;
    if (!container) {
      return;
    }

    const target = container.querySelector<HTMLElement>(`#${anchorId}`);
    if (!target) {
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const relativeTop = targetRect.top - containerRect.top;
    const nextScrollTop = Math.max(container.scrollTop + relativeTop - 12, 0);

    container.scrollTo({
      top: nextScrollTop,
      behavior: 'smooth',
    });
  };

  const handleCapabilityBoardAnswer = React.useCallback(
    (data: IFunctionModulesPanel) => {
      onAnswer?.(data);
    },
    [onAnswer]
  );

  const isModuleListEmpty = showModuleList.length === 0;

  const renderStatusFilter = () => (
    <Select
      disabled={toolbarDisabled}
      value={filterModule}
      onValueChange={(value: 'all' | 'use' | 'reject') =>
        onFilterChange?.(value)
      }
    >
      <SelectTrigger
        data-tip-id='tip_capability_status_filter'
        className={buttonVariants({
          variant: 'outline',
          size: 'default',
          className:
            'h-7 w-[max-content] min-w-[104px] justify-center px-4 [&>span]:line-clamp-none',
        })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='all'>{t.filter_all}</SelectItem>
        <SelectItem value='use'>{t.filter_adopted}</SelectItem>
        <SelectItem value='reject'>{t.filter_rejected}</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div
      className='h-full min-h-0'
      style={{
        display: tabActive === 'function_modules' ? 'block' : 'none',
        opacity: tabActive === 'function_modules' ? 1 : 0,
      }}
    >
      {/* Loading 状态 */}
      {isLoading && (
        <div className='flex items-center justify-center h-full'>
          <div className='flex flex-col items-center gap-2'>
            <Loading className='w-[100px] h-[100px]' />
          </div>
        </div>
      )}

      {/* 内容区域 */}
      {!isLoading && moduleViewType === 'board' && (
        <>
          {isModuleListEmpty ? (
            <EmptyPage
              description={
                filterModule === 'all'
                  ? t.no_data
                  : filterModule === 'use'
                    ? `${t.no_have_sth}${t.filter_adopted}${t.function_text}`
                    : `${t.no_have_sth}${t.filter_rejected}${t.function_text}`
              }
              className='min-h-[260px]'
            />
          ) : (
            <div
              ref={splitContainerRef}
              className='relative h-full min-h-0 overflow-hidden'
            >
              <ResizablePanelGroup
                direction='horizontal'
                className='h-full min-h-0'
                autoSaveId='function-modules-split-left-220'
              >
                <ResizablePanel
                  defaultSize={leftPanelSizes.defaultSize}
                  minSize={leftPanelSizes.minSize}
                  maxSize={leftPanelSizes.maxSize}
                >
                  <div className='relative h-full min-h-0 overflow-visible'>
                    <div className='w-full h-full min-h-0 overflow-visible'>
                      <div className='h-full min-h-0 overflow-hidden'>
                        <div className='h-full min-h-0 overflow-y-auto'>
                          <FunctionModulesTree
                            data={showModuleList}
                            activeAnchorId={activeAnchorId}
                            onSelect={handleTreeSelect}
                          />
                        </div>
                      </div>
                    </div>

                    <IconButton
                      type='button'
                      size='lg'
                      variant='transparent'
                      shape='square'
                      aria-label='expand capability mind map'
                      className='absolute right-0 top-[36vh] z-10 h-[48px] w-[24px] -translate-y-1/2 rounded-l-[8px] rounded-r-[0px] bg-white shadow-[-1px_1px_4px_0px_rgba(0,0,0,0.1)] text-[var(--ds-text-tertiary)] hover:text-[var(--ds-brand-text-primary)] hover:!bg-[#f6f6f6]'
                      onClick={() => {
                        setShowMindMapPreview(true);
                      }}
                    >
                      <ChevronRight className='h-4 w-4' />
                    </IconButton>
                  </div>
                </ResizablePanel>

                <ResizableHandle className='design-panel-resize-handle' />

                <ResizablePanel
                  defaultSize={leftPanelSizes.rightDefaultSize}
                  minSize={leftPanelSizes.rightMinSize}
                >
                  <div className='relative flex h-full min-h-0 min-w-0 flex-col bg-white overflow-hidden'>
                    <DesignPanelHeader className='justify-end gap-[12px]'>
                      <Button
                        data-tip-id='tip_capability_add_feature'
                        size='sm'
                        className='text-[14px] gap-1.5 px-4'
                        variant='outline'
                        onClick={onAddFeature}
                        disabled={toolbarDisabled}
                      >
                        <IconFont
                          type='icon-line-operation-add'
                          className='!text-[14px]'
                        />
                        {t.add_function}
                      </Button>
                      {renderStatusFilter()}
                    </DesignPanelHeader>
                    <div
                      ref={boardContentRef}
                      className='min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4'
                    >
                      {showModuleList?.map((ele, idx) => {
                        const panelAnchorId = getFunctionPanelAnchorId(
                          ele.panel_id,
                          idx
                        );

                        return (
                          <div
                            key={ele.panel_id || idx}
                            id={panelAnchorId}
                            className='animate-in fade-in slide-in-from-bottom-4 duration-500'
                            style={{
                              animationDelay: `${idx * 100}ms`,
                              animationFillMode: 'backwards',
                            }}
                          >
                            <CapabilityBoard
                              disabled={disabled}
                              data={ele}
                              onAnswer={handleCapabilityBoardAnswer}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </ResizablePanel>

                <div
                  aria-hidden={!showMindMapPreview}
                  className={`absolute inset-0 z-20 overflow-hidden rounded-[20px] bg-[var(--ds-bg-gary-default)] transition-[clip-path] duration-300 ease-out ${
                    showMindMapPreview
                      ? 'pointer-events-auto'
                      : 'pointer-events-none'
                  }`}
                  style={{
                    clipPath: showMindMapPreview
                      ? 'inset(0 0 0 0)'
                      : 'inset(0 100% 0 0)',
                  }}
                >
                  <div
                    className='h-full w-full overflow-hidden'
                    style={{ backgroundColor: '#F7F7F7' }}
                  >
                    <div className='h-full p-4 pt-3'>
                      <div className='flex items-center justify-between gap-2 pb-3 text-sm text-[var(--ds-text-9)]'>
                        <div className='flex items-center gap-2'>
                          <IconFont
                            type='icon-line-operation-unfold'
                            className='text-[var(--ds-text-7)]'
                          />
                          <EllipsisTooltip>
                            {t.application_mind_map}
                          </EllipsisTooltip>
                        </div>
                        {showMindMapPreview && renderStatusFilter()}
                      </div>
                      <div className='h-[calc(100%-36px)] overflow-hidden'>
                        <FrameworkChart data={showModuleList} />
                      </div>
                    </div>
                  </div>

                  <IconButton
                    type='button'
                    size='lg'
                    variant='transparent'
                    shape='square'
                    aria-label='collapse capability mind map'
                    className='absolute right-[13px] top-1/2 z-10 h-[48px] w-[24px] translate-x-1/2 -translate-y-1/2 rounded-l-[8px] rounded-r-[0px] bg-white [box-shadow:var(--ds-shadow-1-center)] text-[var(--ds-text-tertiary)] hover:text-[var(--ds-brand-text-primary)] md:right-[13px] md:top-[36vh]'
                    onClick={() => {
                      setShowMindMapPreview(false);
                    }}
                  >
                    <ChevronLeft className='h-4 w-4 text-[var(--ds-text-tertiary)]' />
                  </IconButton>
                </div>
              </ResizablePanelGroup>
            </div>
          )}
        </>
      )}

      {!isLoading && moduleViewType === 'mindmap' && (
        <>
          <div className='flex h-full min-h-0 flex-col p-4'>
            <div className='flex shrink-0 items-center justify-between gap-2 pb-3 text-[var(--ds-text-9)]'>
              <div className='flex items-center gap-2'>
                <IconFont
                  type='icon-line-operation-unfold'
                  className='text-[var(--ds-text-7)]'
                />
                <EllipsisTooltip>{t.application_mind_map}</EllipsisTooltip>
              </div>
              {renderStatusFilter()}
            </div>
            {isModuleListEmpty ? (
              <EmptyPage
                description={
                  filterModule === 'all'
                    ? t.no_data
                    : filterModule === 'use'
                      ? `${t.no_have_sth}${t.filter_adopted}${t.function_text}`
                      : `${t.no_have_sth}${t.filter_rejected}${t.function_text}`
                }
                className='min-h-[260px]'
              />
            ) : (
              <div className='min-h-0 flex-1 flex items-center justify-center text-gray-500'>
                <FrameworkChart data={showModuleList} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
