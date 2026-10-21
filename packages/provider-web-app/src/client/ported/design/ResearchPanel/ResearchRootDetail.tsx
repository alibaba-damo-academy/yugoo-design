import React from 'react';
import { cn } from '../../ui/cn.ts';
import { useLangSwitch } from './useLangSwitch.ts';
import type { IResearchRound } from './researchTypes.ts';
import ModuleMarkDown from '../FeatureModuleItem/ModuleMarkDown.tsx';
import { MessageTip } from '../../ui/message-tip.tsx';
import { ResearchRoundDashboard } from './ResearchRoundDashboard.tsx';

export interface IResearchRootDetailProps {
  round: IResearchRound;
  /** Navigate to a finished direction's detail (used by the live dashboard). */
  onSelectDirection: (directionId: string) => void;
}

/**
 * Root-node content for one research round — two modes:
 *
 * - **While researching** (round not yet completed): render the live
 *   {@link ResearchRoundDashboard} — all directions as split sections with
 *   rolling trace, each turning green + clickable on completion.
 * - **Once the round completes**: the dashboard is swapped out entirely for
 *   the round's goal + synthesized conclusion markdown.
 */
export const ResearchRootDetail: React.FC<IResearchRootDetailProps> = ({
  round,
  onSelectDirection,
}) => {
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';
  const hasConclusion = Boolean(round.conclusion && round.conclusion.trim());
  const hasConclusionRef = Boolean(round.conclusion_file);
  const producerActive = round.producer_status === 'queued' || round.producer_status === 'working';
  // The pilot now authors the round conclusion as a self-contained HTML deck;
  // sub-direction findings stay markdown. Render HTML in a sandboxed iframe.
  const conclusionIsHtml = /<!doctype html|<html[\s>]/i.test(
    round.conclusion ?? ''
  );
  const completedCount = round.directions.filter(
    direction => direction.status === 'completed'
  ).length;
  const isPartial = round.stage === 'partial';
  const failedCount = round.directions.filter(
    direction => direction.status === 'failed'
  ).length;
  const partialMessage = completedCount === 0
    ? isZh
      ? `本轮没有形成可核查结论；${failedCount} 个方向失败。现在结束设计会跳过未完成调研。`
      : `This round produced no verifiable conclusion; ${failedCount} direction${failedCount === 1 ? '' : 's'} failed. Finishing design now skips unfinished research.`
    : isZh
      ? `本轮 ${completedCount}/${round.directions.length} 个方向完成，综合结论仅基于成功方向生成；现在结束设计会跳过未完成调研。`
      : `${completedCount}/${round.directions.length} directions completed. The conclusion only uses successful directions; finishing design now skips unfinished research.`;
  const partialWarning = isPartial ? (
    <div role='status'>
      <MessageTip
        message={partialMessage}
        type='warning'
        showCloseButton={false}
      />
    </div>
  ) : null;

  // File-is-ground-truth: the conclusion's presence — not round.stage — drives
  // the view. Once the conclusion artifact lands on disk and ships in, render it;
  // until then the live dashboard. Avoids hiding a delivered conclusion when
  // stage lags at 'researching' (session 202606131733-fwxqpukh).
  if (!hasConclusionRef || (producerActive && (!round.conclusion_available || !hasConclusion))) {
    return (
      <ResearchRoundDashboard
        round={round}
        onSelectDirection={onSelectDirection}
      />
    );
  }

  if (round.conclusion_loading) {
    return (
      <div role='status' className='flex h-full items-center justify-center p-6 text-sm text-gray-500'>
        {isZh ? '正在加载综合结论…' : 'Loading research conclusion…'}
      </div>
    );
  }

  if (!round.conclusion_available || !hasConclusion) {
    return (
      <div role='status' className='flex h-full items-center justify-center p-6 text-sm text-gray-500'>
        {isZh
          ? '综合结论文件当前不可用。'
          : 'The research conclusion file is currently unavailable.'}
      </div>
    );
  }

  // Completed + HTML conclusion → show the slide deck full-bleed, no chrome.
  if (hasConclusion && conclusionIsHtml) {
    return (
      <div className='flex h-full min-h-0 flex-col gap-2'>
        {partialWarning}
        <iframe
          title='research-conclusion'
          srcDoc={round.conclusion ?? ''}
          sandbox='allow-same-origin allow-popups allow-popups-to-escape-sandbox'
          className='min-h-0 w-full flex-1 border-0 bg-white'
        />
      </div>
    );
  }

  // Completed → conclusion replaces the sections.
  return (
    <div className='p-4 space-y-5'>
      {partialWarning}
      {/* 研究目标 */}
      <section>
        <h5 className='text-sm font-medium text-gray-500 mb-2'>
          {isZh ? '研究目标' : 'Research Goal'}
        </h5>
        <div className='rounded-lg border border-[#ECEBEE] bg-white p-4'>
          <p className='text-sm text-[#10082B] leading-[22px]'>
            {round.topic || (isZh ? '（未指定主题）' : '(Topic not set)')}
          </p>
        </div>
      </section>

      {/* 综合结论 */}
      <section>
        <h5 className='text-sm font-medium text-gray-500 mb-2'>
          {isZh ? '综合结论' : 'Conclusion'}
        </h5>
        {hasConclusion ? (
          <div className='rounded-lg border border-[#ECEBEE] bg-white p-4'>
            <ModuleMarkDown className='panel-md'>
              {round.conclusion ?? ''}
            </ModuleMarkDown>
          </div>
        ) : (
          <div
            className={cn(
              'rounded-lg border border-dashed border-[#ECEBEE]',
              'bg-[#FAFAFC] p-4'
            )}
          >
            <p className='text-sm text-gray-500 leading-[22px]'>
              {isZh
                ? '本轮调研尚未生成综合结论。'
                : 'No conclusion has been written for this round yet.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
};
