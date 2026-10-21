import React from 'react';
import type { IResearchDirectionItem } from './researchTypes.ts';
import { useLangSwitch } from './useLangSwitch.ts';
import ModuleMarkDown from '../FeatureModuleItem/ModuleMarkDown.tsx';
import { TraceSection } from './ResearchTraceSection.tsx';

export interface IResearchDirectionDetailProps {
  direction: IResearchDirectionItem;
}

export const ResearchDirectionDetail: React.FC<
  IResearchDirectionDetailProps
> = ({ direction }) => {
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';

  const traceEntries = direction.trace ?? [];
  const hasFindingsRef = Boolean(direction.findings_file);
  const findingsUnavailable = hasFindingsRef
    && !direction.findings_loading
    && !direction.findings_available;

  return (
    <div className='p-4 space-y-5'>
      {/* 调研要点 */}
      {direction.research_points?.length > 0 && (
        <div>
          <h5 className='text-sm font-medium text-gray-500 mb-2'>
            {isZh ? '调研要点' : 'Research Points'}
          </h5>
          <ul className='space-y-1.5'>
            {direction.research_points.map((point, idx) => (
              <li
                key={idx}
                className='flex items-start gap-2 text-sm text-[rgba(16,8,43,0.85)] leading-[22px]'
              >
                <span className='mt-2 w-1.5 h-1.5 rounded-full bg-[#663AE8] shrink-0' />
                <span className='flex-1'>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 执行过程：调研中自动展开，结果就绪后自动折叠；用户点击仍可手动覆盖 */}
      <TraceSection
        entries={traceEntries}
        isZh={isZh}
        autoExpand={direction.status === 'working' && !direction.findings}
        unavailable={direction.trace_unavailable}
      />

      {/* 调研结果 */}
      {direction.findings && (
        <div>
          <h5 className='text-sm font-medium text-gray-500 mb-2'>
            {isZh ? '调研结果' : 'Findings'}
          </h5>
          <div className='rounded-lg border border-[#ECEBEE] p-4 bg-white'>
            <ModuleMarkDown className='panel-md'>
              {direction.findings}
            </ModuleMarkDown>
          </div>
        </div>
      )}

      {hasFindingsRef && direction.findings_loading && (
        <div role='status' className='rounded-lg border border-[#ECEBEE] bg-white p-4 text-sm text-gray-500'>
          {isZh ? '正在加载调研报告…' : 'Loading research report…'}
        </div>
      )}

      {findingsUnavailable && (
        <div role='status' className='rounded-lg border border-dashed border-[#ECEBEE] bg-[#FAFAFC] p-4 text-sm text-gray-500'>
          {isZh
            ? '调研报告文件当前不可用。'
            : 'The research report file is currently unavailable.'}
        </div>
      )}

      {/* 来源链接 */}
      {direction.source_urls?.length > 0 && (
        <div>
          <h5 className='text-sm font-medium text-gray-500 mb-2'>
            {isZh ? '信息来源' : 'Sources'}
          </h5>
          <div className='space-y-1.5'>
            {direction.source_urls.map((url, idx) => (
              <a
                key={idx}
                href={url}
                target='_blank'
                rel='noopener noreferrer'
                className='block text-sm text-[#663AE8] hover:underline truncate leading-[22px]'
              >
                {url}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
