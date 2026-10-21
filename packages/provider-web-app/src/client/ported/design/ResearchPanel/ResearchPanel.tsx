import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../ui/cn.ts';
import type {
  IResearchPanel as IResearchPanelData,
  IResearchRound,
} from './researchTypes.ts';
import { useLang } from '../../host.ts';
import { useLangSwitch } from './useLangSwitch.ts';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '../../ui/resizable.tsx';
import { IconFont } from '../../ui/icon-font.tsx';
import {
  ResearchNavTree,
  ROOT_DIRECTION_ID,
  type ISelectedNode,
} from './ResearchDirectionList.tsx';
import { ResearchDirectionDetail } from './ResearchDirectionDetail.tsx';
import { ResearchRootDetail } from './ResearchRootDetail.tsx';
import { deriveRoundDisplayStage } from './researchStatus.ts';
import { DesignPanelHeader, DesignPanelSidebar, DesignPanelTitle } from '../OfficialWebAppPanels/panelPrimitives.tsx';
import { useDesignLeftPanelSizes } from '../panelSizing.ts';

export interface IResearchPanelProps {
  data: IResearchPanelData;
  disabled?: boolean;
  // Fires a "start research" synthetic user message back into the chat. The
  // BE handles the rest (intent → research_batch_execute). Only invoked from
  // the header CTA when the stage is identified/confirmed (proposal phase);
  // hidden once research is actually running or done.
  onStartResearch?: () => void;
}

const STAGE_STYLES: Record<string, { bg: string; text: string }> = {
  identified: { bg: 'bg-amber-50', text: 'text-amber-700' },
  confirmed: { bg: 'bg-blue-50', text: 'text-blue-700' },
  researching: { bg: 'bg-indigo-50', text: 'text-indigo-700' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  partial: { bg: 'bg-amber-50', text: 'text-amber-700' },
};

const STAGE_LABELS: Record<string, { en: string; zh: string }> = {
  identified: { en: 'Identified', zh: '已识别' },
  confirmed: { en: 'Confirmed', zh: '已确认' },
  researching: { en: 'Researching', zh: '调研中' },
  completed: { en: 'Completed', zh: '已完成' },
  partial: { en: 'Partially completed', zh: '部分完成' },
};

const DIRECTION_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700' },
  queued: { bg: 'bg-violet-50', text: 'text-violet-700' },
  working: { bg: 'bg-blue-50', text: 'text-blue-700' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  failed: { bg: 'bg-red-50', text: 'text-red-700' },
};

const DIRECTION_STATUS_LABELS: Record<string, { en: string; zh: string }> = {
  pending: { en: 'Pending', zh: '待调研' },
  queued: { en: 'Queued', zh: '排队中' },
  working: { en: 'Working', zh: '调研中' },
  completed: { en: 'Completed', zh: '已完成' },
  failed: { en: 'Failed', zh: '失败' },
};

const pickDefaultSelected = (
  rounds: IResearchRound[],
  currentRoundId: string | null | undefined
): ISelectedNode | null => {
  if (!rounds.length) return null;
  const preferred = currentRoundId
    ? rounds.find(r => r.round_id === currentRoundId)
    : undefined;
  const target = preferred ?? rounds[0];
  return { roundId: target.round_id, directionId: ROOT_DIRECTION_ID };
};

function readableConclusionRef(round: IResearchRound): string | null {
  return round.conclusion_available === true && Boolean(round.conclusion?.trim())
    ? round.conclusion_file ?? null
    : null;
}

/** Pick the round whose conclusion became readable in this update. */
export const pickNewlyConcludedRound = (
  rounds: IResearchRound[],
  previousRefs: ReadonlyMap<string, string | null>,
  currentRoundId: string | null
): IResearchRound | null => {
  const newlyConcluded = rounds.filter(round => {
    const nextRef = readableConclusionRef(round);
    return Boolean(nextRef) && previousRefs.get(round.round_id) !== nextRef;
  });
  return newlyConcluded.find(round => round.round_id === currentRoundId)
    ?? newlyConcluded[0]
    ?? null;
};

export const ResearchPanel: React.FC<IResearchPanelProps> = ({ data }) => {
  const t = useLang();
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const leftPanelSizes = useDesignLeftPanelSizes(splitContainerRef);

  const rounds = useMemo(() => data.rounds ?? [], [data.rounds]);
  const currentRoundId = data.current_round_id ?? null;
  const conclusionRefsRef = useRef(
    new Map(rounds.map(round => [round.round_id, readableConclusionRef(round)]))
  );

  // Default selection: current round's root; fall back to first round's root
  // if no current round hint. Re-sync when rounds change and the currently
  // selected node is no longer valid (e.g. the round was dropped). We do NOT
  // re-select on every update — users keep their navigation while trace
  // streams in (that's the bug we fixed in Z-1 via the stable React key
  // upstream).
  const [selected, setSelected] = useState<ISelectedNode | null>(() =>
    pickDefaultSelected(rounds, currentRoundId)
  );

  useEffect(() => {
    if (!rounds.length) {
      if (selected !== null) setSelected(null);
      return;
    }
    if (!selected) {
      setSelected(pickDefaultSelected(rounds, currentRoundId));
      return;
    }
    // Validate current selection still exists in the new data
    const stillValidRound = rounds.find(r => r.round_id === selected.roundId);
    if (!stillValidRound) {
      setSelected(pickDefaultSelected(rounds, currentRoundId));
      return;
    }
    if (selected.directionId !== ROOT_DIRECTION_ID) {
      const stillValidDirection = stillValidRound.directions.find(
        d => d.direction_id === selected.directionId
      );
      if (!stillValidDirection) {
        setSelected({
          roundId: stillValidRound.round_id,
          directionId: ROOT_DIRECTION_ID,
        });
      }
    }
  }, [rounds, currentRoundId]);

  // When a NEW round becomes current (latest action), snap the cursor to its
  // root node — that's where the newest activity is. Only on round change, so
  // mid-round trace streaming doesn't yank the user's manual navigation.
  const prevRoundRef = useRef<string | null>(currentRoundId);
  useEffect(() => {
    if (currentRoundId && currentRoundId !== prevRoundRef.current) {
      prevRoundRef.current = currentRoundId;
      if (rounds.some(r => r.round_id === currentRoundId)) {
        setSelected({
          roundId: currentRoundId,
          directionId: ROOT_DIRECTION_ID,
        });
      }
    }
  }, [currentRoundId, rounds]);

  // A newly published conclusion is the terminal product of a round. Move the
  // cursor to that round's root exactly once so its HTML replaces the live
  // dashboard, even when the user was inspecting a direction. Later hydration
  // updates keep normal manual navigation and do not repeatedly steal focus.
  useEffect(() => {
    const previousRefs = conclusionRefsRef.current;
    const target = pickNewlyConcludedRound(rounds, previousRefs, currentRoundId);
    conclusionRefsRef.current = new Map(
      rounds.map(round => [round.round_id, readableConclusionRef(round)])
    );
    if (target === null) return;
    setSelected({
      roundId: target.round_id,
      directionId: ROOT_DIRECTION_ID,
    });
  }, [currentRoundId, rounds]);

  // Resolve the selected round + direction objects for rendering
  const selectedRound = useMemo(() => {
    if (!selected) return null;
    return rounds.find(r => r.round_id === selected.roundId) ?? null;
  }, [rounds, selected]);

  const selectedDirection = useMemo(() => {
    if (!selected || !selectedRound) return null;
    if (selected.directionId === ROOT_DIRECTION_ID) return null;
    return (
      selectedRound.directions.find(
        d => d.direction_id === selected.directionId
      ) ?? null
    );
  }, [selectedRound, selected]);

  const selectedTitle = selectedDirection
    ? selectedDirection.title
    : selectedRound?.topic || selectedRound?.round_id || '';
  const selectedStatus =
    selectedDirection?.status ??
    (selectedRound ? deriveRoundDisplayStage(selectedRound) : undefined);
  const selectedStatusStyle = selectedDirection
    ? (DIRECTION_STATUS_STYLES[selectedDirection.status] ??
      DIRECTION_STATUS_STYLES.pending)
    : (STAGE_STYLES[selectedStatus ?? 'identified'] ?? STAGE_STYLES.identified);
  const selectedStatusLabel = selectedDirection
    ? (DIRECTION_STATUS_LABELS[selectedDirection.status]?.[
        isZh ? 'zh' : 'en'
      ] ?? selectedDirection.status)
    : (STAGE_LABELS[selectedStatus ?? 'identified']?.[isZh ? 'zh' : 'en'] ??
      selectedStatus ??
      'identified');
  if (!rounds.length) {
    return (
      <div className='flex items-center justify-center h-40 text-sm text-gray-400'>
        {t.no_data}
      </div>
    );
  }

  return (
    <div ref={splitContainerRef} className='flex h-full min-h-0 flex-col'>
      {/* 主体：左右分栏（用户可拖拽调整宽度）*/}
      <ResizablePanelGroup
        direction='horizontal'
        className='min-h-0 flex-1 overflow-hidden'
        autoSaveId='research-panel-split'
      >
        <ResizablePanel
          defaultSize={leftPanelSizes.defaultSize}
          minSize={leftPanelSizes.minSize}
          maxSize={leftPanelSizes.maxSize}
        >
          <DesignPanelSidebar
            icon={
              <IconFont
                type='icon-line-tool-dataquery'
                className='text-[var(--ds-text-7)]'
              />
            }
            title={t.research_analysis}
            ariaLabel={t.research_analysis}
          >
            <ResearchNavTree
              rounds={rounds}
              currentRoundId={currentRoundId}
              selected={selected}
              onSelect={setSelected}
            />
          </DesignPanelSidebar>
        </ResizablePanel>

        <ResizableHandle className='design-panel-resize-handle' />

        <ResizablePanel
          defaultSize={leftPanelSizes.rightDefaultSize}
          minSize={leftPanelSizes.rightMinSize}
        >
          <div className='relative h-full flex flex-col bg-white'>
            {!selectedRound ? (
              <div className='flex items-center justify-center h-full text-sm text-gray-400'>
                {t.research_select_round_or_direction}
              </div>
            ) : (
              <>
                <DesignPanelHeader>
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <DesignPanelTitle className='min-w-0 flex-1'>
                      {selectedTitle}
                    </DesignPanelTitle>
                    {selectedStatus && (
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs font-medium',
                          selectedStatusStyle.bg,
                          selectedStatusStyle.text
                        )}
                      >
                        {selectedStatusLabel}
                      </span>
                    )}
                  </div>
                </DesignPanelHeader>
                <div className='flex-1 min-h-0 overflow-y-auto bg-[var(--ds-bg-gary-default)]'>
                  {selectedDirection ? (
                    <ResearchDirectionDetail direction={selectedDirection} />
                  ) : (
                    <ResearchRootDetail
                      round={selectedRound}
                      onSelectDirection={directionId =>
                        setSelected({
                          roundId: selectedRound.round_id,
                          directionId,
                        })
                      }
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};
