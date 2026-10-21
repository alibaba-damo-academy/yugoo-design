import React from 'react';
import { cn } from '../../ui/cn.ts';
import type { IFlowProcessItem } from './flowDesignTypes.ts';
import { useLang } from '../../host.ts';
import { useLangSwitch } from '../ResearchPanel/useLangSwitch.ts';
import ModuleMarkDown from '../FeatureModuleItem/ModuleMarkDown.tsx';

export interface IFlowProcessDetailProps {
  process: IFlowProcessItem;
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

const PROCESS_TYPE_LABELS: Record<string, { en: string; zh: string }> = {
  linear: { en: 'Linear', zh: '线性' },
  approval: { en: 'Approval', zh: '审批' },
  parallel: { en: 'Parallel', zh: '并行' },
  event_driven: { en: 'Event-driven', zh: '事件驱动' },
};

const TRIGGER_KIND_LABELS: Record<string, { en: string; zh: string }> = {
  timer: { en: 'Timer', zh: '定时' },
  message: { en: 'Message', zh: '消息' },
  error: { en: 'Error', zh: '错误' },
  conditional: { en: 'Condition', zh: '条件' },
  signal: { en: 'Signal', zh: '信号' },
};

export interface IFlowProcessTagsProps {
  process: IFlowProcessItem;
}

export const FlowProcessTags: React.FC<IFlowProcessTagsProps> = ({
  process,
}) => {
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';
  const t = useLang();
  const priorityLabel =
    PRIORITY_LABELS[process.priority]?.[isZh ? 'zh' : 'en'] ?? process.priority;
  const processTypeLabel =
    PROCESS_TYPE_LABELS[process.process_type]?.[isZh ? 'zh' : 'en'] ??
    process.process_type;

  return (
    <div className='flex shrink-0 items-center gap-1.5'>
      <span
        className={cn(
          'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
          PRIORITY_STYLES[process.priority] ?? PRIORITY_STYLES.medium
        )}
      >
        {priorityLabel}
      </span>
      <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-50 text-gray-600'>
        {processTypeLabel}
      </span>
      {process.deleted && (
        <span className='inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500'>
          {t.filter_rejected}
        </span>
      )}
    </div>
  );
};

interface ISectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

/** Visual chrome for a single info section. White card, subtle border. */
const Section: React.FC<ISectionProps> = ({ title, children, className }) => (
  <section
    className={cn('rounded-lg border border-[#ECEBEE] bg-white p-4', className)}
  >
    <h5 className='text-xs font-medium text-gray-500 uppercase tracking-wide mb-2.5'>
      {title}
    </h5>
    {children}
  </section>
);

interface IBulletListProps {
  items: string[];
  /** Marker color override (default purple). */
  color?: string;
}

const BulletList: React.FC<IBulletListProps> = ({
  items,
  color = '#663AE8',
}) => (
  <ul className='space-y-1.5'>
    {items.map((item, idx) => (
      <li
        key={idx}
        className='flex items-start gap-2 text-sm text-[rgba(16,8,43,0.85)] leading-[22px]'
      >
        <span
          className='mt-2 w-1.5 h-1.5 rounded-full shrink-0'
          style={{ backgroundColor: color }}
        />
        <span className='flex-1'>{item}</span>
      </li>
    ))}
  </ul>
);

export const FlowProcessDetail: React.FC<IFlowProcessDetailProps> = ({
  process,
}) => {
  const t = useLang();
  const { currentLanguage: language } = useLangSwitch();
  const isZh = language === 'zh_CN';

  const hasFeatures = (process.key_features?.length ?? 0) > 0;
  const hasRules = (process.business_rules?.length ?? 0) > 0;
  const hasExceptions = (process.exception_handling?.length ?? 0) > 0;
  const hasSystemResponsibilities =
    (process.system_responsibilities?.length ?? 0) > 0;
  const hasTriggerHints = (process.trigger_hints?.length ?? 0) > 0;

  return (
    <div className={cn('p-4 space-y-4', process.deleted && 'opacity-60')}>
      {/* Description (markdown) */}
      {process.description && (
        <FlowProcessDescriptionSection process={process} />
      )}

      {/* Stakeholders */}
      {process.stakeholders?.length > 0 && (
        <FlowProcessRolesSection process={process} />
      )}

      {(hasSystemResponsibilities || hasTriggerHints) && (
        <div
          className='grid gap-4'
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
        >
          {hasSystemResponsibilities && (
            <Section title={isZh ? '系统责任' : 'System responsibilities'}>
              <BulletList items={process.system_responsibilities} />
            </Section>
          )}
          {hasTriggerHints && (
            <Section title={isZh ? '事件触发' : 'Event triggers'}>
              <div className='space-y-2'>
                {process.trigger_hints.map((hint, index) => (
                  <div
                    key={`${hint.kind}-${hint.trigger}-${index}`}
                    className='flex min-w-0 items-start gap-2 rounded-md border border-[var(--ds-border-default)] bg-[var(--ds-bg-gary-default)] p-2.5'
                  >
                    <span className='inline-flex shrink-0 items-center rounded bg-[var(--ds-fill-3)] px-2 py-0.5 text-xs font-medium text-[var(--ds-text-secondary)]'>
                      {TRIGGER_KIND_LABELS[hint.kind]?.[isZh ? 'zh' : 'en'] ?? hint.kind}
                    </span>
                    <div className='min-w-0 break-words text-sm leading-[22px] text-[var(--ds-text-primary)]'>
                      <div>{hint.trigger}</div>
                      <div className='text-[var(--ds-text-secondary)]'>
                        → {hint.expected_outcome}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* Two-column row for features + rules.
          Auto-fit: stays one-up on narrow widths (when the user shrinks
          the right pane), goes two-up when there's room. */}
      {(hasFeatures || hasRules) && (
        <div
          className='grid gap-4'
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {hasFeatures && (
            <Section title={t.flow_core_features}>
              <BulletList items={process.key_features} color='#663AE8' />
            </Section>
          )}
          {hasRules && (
            <Section title={t.flow_business_rules}>
              <BulletList items={process.business_rules} color='#F59E0B' />
            </Section>
          )}
        </div>
      )}

      {/* Exception handling */}
      {hasExceptions && (
        <Section title={t.flow_exception_handling}>
          <div className='space-y-2'>
            {process.exception_handling.map((eh, idx) => (
              <div
                key={idx}
                className='flex items-start gap-3 rounded-md bg-[#FAFAFC] border border-[#ECEBEE] p-3'
              >
                <span
                  className='mt-0.5 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 shrink-0'
                  style={{ minWidth: '40px', justifyContent: 'center' }}
                >
                  {t.flow_case}
                </span>
                <div className='flex-1 min-w-0 space-y-1'>
                  <div className='text-sm font-medium text-[#10082B] leading-[22px]'>
                    {eh.scenario}
                  </div>
                  <div className='text-sm text-[rgba(16,8,43,0.75)] leading-[22px]'>
                    <span className='text-gray-400 mr-1'>
                      {t.flow_handling}
                    </span>
                    {eh.handling}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
};

/**
 * Reusable description / 流程说明 section.
 *
 * Exported alongside FlowProcessRolesSection so the FlowDesignPanel
 * collapsed-state bottom bar can stack both summary sections (description
 * + roles) without duplicating markup.
 */
export interface IFlowProcessDescriptionSectionProps {
  process: IFlowProcessItem;
  className?: string;
}

export const FlowProcessDescriptionSection: React.FC<
  IFlowProcessDescriptionSectionProps
> = ({ process, className }) => {
  const t = useLang();
  return (
    <Section title={t.flow_description} className={className}>
      {process.description ? (
        <ModuleMarkDown className='panel-md'>
          {process.description}
        </ModuleMarkDown>
      ) : (
        <div className='text-sm text-gray-400 italic'>
          {t.flow_no_description}
        </div>
      )}
    </Section>
  );
};

/**
 * Reusable stakeholders / 参与角色 section.
 *
 * Exported separately so the FlowDesignPanel bottom bar can render the same
 * chip styling without duplicating markup. When `process.stakeholders` is
 * empty, falls back to a placeholder so the bottom bar never collapses to
 * zero height.
 */
export interface IFlowProcessRolesSectionProps {
  process: IFlowProcessItem;
  className?: string;
}

export const FlowProcessRolesSection: React.FC<
  IFlowProcessRolesSectionProps
> = ({ process, className }) => {
  const t = useLang();
  const hasRoles = (process.stakeholders?.length ?? 0) > 0;

  return (
    <Section title={t.flow_stakeholders} className={className}>
      {hasRoles ? (
        <div className='flex flex-wrap gap-1.5'>
          {process.stakeholders.map((stakeholder, idx) => (
            <span
              key={idx}
              className='inline-flex items-center px-2.5 py-1 rounded-full text-sm bg-indigo-50 text-indigo-700'
            >
              {stakeholder}
            </span>
          ))}
        </div>
      ) : (
        <div className='text-sm text-gray-400 italic'>
          {t.flow_no_stakeholders}
        </div>
      )}
    </Section>
  );
};
