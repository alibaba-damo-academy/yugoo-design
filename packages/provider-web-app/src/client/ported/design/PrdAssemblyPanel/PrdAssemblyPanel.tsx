/** Read-only HTML PRD preview with document-derived navigation metadata. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import EmptyPage from '../../ui/empty-page.tsx';
import { IconFont } from '../../ui/icon-font.tsx';
import { cn } from '../../ui/cn.ts';
import { useLang } from '../../host.ts';
import { NativeDesignPanelContent, NativeDesignPanelFrame } from '../OfficialWebAppPanels/NativeDesignPanelFrame.tsx';
import {
  DesignPanelHeader,
  DesignPanelHeaderText,
  DesignPanelNavItem,
  DesignPanelSidebar,
} from '../OfficialWebAppPanels/panelPrimitives.tsx';
import type { PrdAssemblyState, PrdAssemblyStatus, PrdSectionAnchor } from './prdAssemblyTypes.ts';
import { confinePrdArtifactPath } from './prdArtifactPath.ts';
import { secureDesignSrcDoc } from '../../../srcdoc-security.ts';
import { prdProvenanceCounts } from './prdProvenance.ts';

export interface PrdAssemblyPanelProps {
  state: PrdAssemblyState;
  htmlContent: string | null;
  refreshing: boolean;
  onRefreshHtml: () => void;
  onNavigateSkill?: (skill: string) => void;
}

const STATUS_STYLES: Record<PrdAssemblyStatus, string> = {
  assembling: 'border-[var(--ds-warning-light-border)] bg-[var(--ds-warning-light-bg-default)] text-[var(--ds-warning-text-primary)]',
  completed: 'border-[var(--ds-success-light-border)] bg-[var(--ds-success-light-bg-default)] text-[var(--ds-success-text-primary)]',
  failed: 'border-[var(--ds-error-light-border)] bg-[var(--ds-error-light-bg-default)] text-[var(--ds-error-text-primary)]',
};

const STATUS_LABELS: Record<PrdAssemblyStatus, string> = {
  assembling: '生成中',
  completed: '已完成',
  failed: '需修复',
};

const SOURCE_LABELS: Record<string, string> = {
  smart_questions: '需求梳理',
  research: '调研',
  function_modules: '功能结构',
  flow_design: '业务流程',
  design_style: '视觉风格',
  business_data: '业务对象',
  business_rules: '业务规则',
  role_access: '角色权限',
  page_design: '页面设计',
  integration_design: '系统集成',
  notification_design: '通知设计',
  quality_acceptance: '验收标准',
  user: '用户输入',
  upload: '用户资料',
};

function splitAttribute(value: string | null, expression: RegExp): string[] {
  return Array.from(new Set((value ?? '').split(expression).map(item => item.trim()).filter(Boolean)));
}

export const PrdAssemblyPanel = ({
  state,
  htmlContent,
  refreshing,
  onRefreshHtml,
  onNavigateSkill,
}: PrdAssemblyPanelProps) => {
  const t = useLang();
  const label = (key: string, fallback: string): string => t[key] === key ? fallback : t[key];
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const removeScrollListenerRef = useRef<(() => void) | null>(null);
  const [sections, setSections] = useState<PrdSectionAnchor[]>([]);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [documentReady, setDocumentReady] = useState(false);

  useEffect(() => () => removeScrollListenerRef.current?.(), []);
  useEffect(() => {
    removeScrollListenerRef.current?.();
    removeScrollListenerRef.current = null;
    setSections([]);
    setActiveSectionId(null);
    setDocumentReady(false);
  }, [htmlContent]);

  const readDocumentSections = useCallback(() => {
    removeScrollListenerRef.current?.();
    removeScrollListenerRef.current = null;
    const doc = iframeRef.current?.contentDocument;
    const frameWindow = iframeRef.current?.contentWindow;
    if (doc === undefined || doc === null || frameWindow === undefined || frameWindow === null) return;
    const annotated = Array.from(doc.querySelectorAll<HTMLHeadingElement>('h2[data-prd-section-id]'));
    const headings = annotated.length > 0 ? annotated : Array.from(doc.querySelectorAll<HTMLHeadingElement>('h2'));
    const next = headings.flatMap((heading, index): PrdSectionAnchor[] => {
      const title = heading.textContent?.trim() ?? '';
      if (title === '') return [];
      const id = `prd-section-${index + 1}`;
      heading.id = id;
      heading.style.scrollMarginTop = '24px';
      return [{
        id,
        title,
        sourceSkills: splitAttribute(heading.getAttribute('data-prd-sources'), /[,，、]/u),
        provenanceIds: splitAttribute(heading.getAttribute('data-prd-provenance-ids'), /[\s,，、]+/u),
      }];
    });
    setSections(next);
    setActiveSectionId(next[0]?.id ?? null);
    const updateActive = () => {
      let active = next[0]?.id ?? null;
      for (const section of next) {
        if ((doc.getElementById(section.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY) <= 96) active = section.id;
      }
      setActiveSectionId(active);
    };
    frameWindow.addEventListener('scroll', updateActive, { passive: true });
    removeScrollListenerRef.current = () => frameWindow.removeEventListener('scroll', updateActive);
  }, []);

  const handleIframeLoad = useCallback(() => {
    readDocumentSections();
    setDocumentReady(true);
  }, [readDocumentSections]);

  const jumpToSection = (id: string) => {
    iframeRef.current?.contentDocument?.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSectionId(id);
  };

  const activeSection = sections.find(section => section.id === activeSectionId);
  const provenance = state.ai_provenance ?? [];
  const provenanceCounts = prdProvenanceCounts(provenance, activeSection?.provenanceIds);
  const documentSrcDoc = useMemo(
    () => htmlContent === null ? null : secureDesignSrcDoc(htmlContent, 'static-document'),
    [htmlContent],
  );
  const invalidHtmlRef = state.html_file !== undefined && confinePrdArtifactPath(state.html_file, 'html') === undefined;
  const canNavigate = onNavigateSkill !== undefined;

  return (
    <NativeDesignPanelFrame autoSaveId='prd-assembly-sidebar'>
      <DesignPanelSidebar
        icon={<IconFont type='icon-line-operation-unfold' className='text-[var(--ds-text-7)]' />}
        title={label('prd_toc', 'PRD 目录')}
        ariaLabel={label('prd_toc_aria', 'PRD 章节')}
      >
        {sections.map(section => (
          <DesignPanelNavItem
            key={section.id}
            aria-label={`${label('prd_jump_to', '跳转到')}${section.title}`}
            selected={activeSectionId === section.id}
            onMouseDown={event => event.preventDefault()}
            onClick={() => jumpToSection(section.id)}
          >
            <span className='truncate'>{section.title}</span>
          </DesignPanelNavItem>
        ))}
        {sections.length === 0 ? (
          <p className='px-2 py-2 text-sm text-[var(--ds-text-primary)]'>
            {htmlContent !== null && !documentReady
              ? label('prd_toc_loading', '正在读取章节…')
              : label('prd_toc_empty', '暂无章节目录')}
          </p>
        ) : null}
      </DesignPanelSidebar>

      <NativeDesignPanelContent as='div' mode='workspace' className='flex flex-col'>
        <DesignPanelHeader variant='workspace'>
          <div className='flex min-w-0 items-center gap-2'>
            <DesignPanelHeaderText title={state.title || label('prd_default_title', 'PRD')} subtitle='HTML 文档' />
            {state.status !== undefined ? (
              <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', STATUS_STYLES[state.status])}>
                {label(`prd_status_${state.status}`, STATUS_LABELS[state.status])}
              </span>
            ) : null}
          </div>
          <Button
            type='button'
            variant='outline'
            size='sm'
            aria-label={label('prd_refresh_title', '刷新 PRD 预览')}
            title={label('prd_refresh_title', '刷新 PRD 预览')}
            disabled={state.html_file === undefined || refreshing}
            onClick={onRefreshHtml}
          >
            <IconFont type='icon-line-operation-refresh' />
            {refreshing ? label('prd_refreshing', '刷新中…') : label('prd_refresh', '刷新')}
          </Button>
        </DesignPanelHeader>

        <div
          data-prd-provenance-legend
          className='flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-4 py-2 text-xs text-[hsl(var(--muted-foreground))]'
        >
          <span className='border-l-[3px] border-[#b7a5ec] pl-2 text-[var(--ds-text-primary)]'>
            {label('prd_ai_provenance_legend', '紫色左轨：为保持 PRD 结构完整而临时补全，尚待用户确认')}
          </span>
          <span>{label('prd_pending_assumption_count', '待确认')} ×{provenanceCounts.pendingAssumptions}</span>
        </div>

        {activeSection !== undefined && (activeSection.sourceSkills.length > 0 || activeSection.provenanceIds.length > 0) ? (
          <div className='flex min-h-10 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-1.5 text-sm'>
            <span className='text-[hsl(var(--muted-foreground))]'>{label('prd_sources', '来源')}</span>
            {activeSection.sourceSkills.map(skill => (
              <button
                key={skill}
                type='button'
                disabled={!canNavigate || skill === 'user' || skill === 'upload'}
                className={cn(
                  'rounded-[var(--button-radius)] border border-[var(--ds-brand-light-border)] bg-[var(--ds-brand-light-bg-default)] px-2 py-1 text-xs text-[var(--ds-brand-text-primary)]',
                  canNavigate && skill !== 'user' && skill !== 'upload' ? 'hover:bg-[var(--ds-brand-light-bg-hover)]' : 'cursor-default',
                )}
                onClick={canNavigate && skill !== 'user' && skill !== 'upload' ? () => onNavigateSkill(skill) : undefined}
              >
                {SOURCE_LABELS[skill] ?? skill}
              </button>
            ))}
            {provenanceCounts.sectionPendingAssumptions > 0 ? (
              <span className='rounded-[var(--button-radius)] border-l-[3px] border-[#b7a5ec] bg-[var(--ds-warning-light-bg-default)] px-2 py-1 text-xs text-[var(--ds-warning-text-primary)]'>
                {label('prd_pending_assumption', '待确认')} ×{provenanceCounts.sectionPendingAssumptions}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className='min-h-0 flex-1 bg-white p-4'>
          {documentSrcDoc !== null ? (
            <iframe
              ref={iframeRef}
              title={state.title || 'PRD'}
              srcDoc={documentSrcDoc}
              sandbox='allow-same-origin'
              referrerPolicy='no-referrer'
              className='h-full min-h-0 w-full rounded-[var(--radius)] border border-border bg-background'
              onLoad={handleIframeLoad}
            />
          ) : invalidHtmlRef ? (
            <div role='alert' className='rounded-[var(--radius)] border border-[var(--ds-error-light-border)] bg-[var(--ds-error-light-bg-default)] px-4 py-3 text-sm text-[var(--ds-error-text-primary)]'>
              {label('prd_artifact_invalid', '产物路径无效，请重新组装')}：{state.html_file}
            </div>
          ) : (
            <EmptyPage
              isSmall
              title={label('prd_empty_title', '暂无 PRD 预览')}
              description={label('prd_empty_description', '生成完成后，这里会展示唯一的 HTML PRD 文档。')}
            />
          )}
        </div>
      </NativeDesignPanelContent>
    </NativeDesignPanelFrame>
  );
};
