import React, { useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../ui/cn.ts';
import { IconFont } from '../ui/icon-font.tsx';
import { resolveActiveMindset, groupEntriesByLayer, type IDesignSkillCard, type IMindsetCatalogs } from './skillCatalog.ts';

// 卡片描述是 SKILL.md frontmatter 的 markdown 列表（`- **能力**: …`）。用紧凑的
// 渲染器把加粗、条目正确呈现，避免卡片里出现裸 `**` 文本。卡片本身是 role=button
// 的 div（button 不能包含 ul/p 这类块级内容）。
const cardDescriptionComponents: Components = {
  p: ({ node, ...props }) => <p className='mb-1.5 last:mb-0' {...props} />,
  ul: ({ node, ...props }) => (
    <ul className='m-0 list-disc space-y-1 pl-4' {...props} />
  ),
  ol: ({ node, ...props }) => (
    <ol className='m-0 list-decimal space-y-1 pl-4' {...props} />
  ),
  li: ({ node, ...props }) => (
    <li className='marker:text-[var(--ds-text-tertiary)]' {...props} />
  ),
  strong: ({ node, ...props }) => (
    <strong
      className='font-semibold text-[var(--ds-text-primary)]'
      {...props}
    />
  ),
  code: ({ node, ...props }) => (
    <code
      className='rounded bg-[var(--ds-fill-3)] px-1 py-0.5 text-[11px]'
      {...props}
    />
  ),
  a: ({ node, ...props }) => (
    <a
      className='text-[var(--ds-brand-6)] hover:underline'
      target='_blank'
      rel='noreferrer'
      onClick={e => e.stopPropagation()}
      {...props}
    />
  ),
};

/**
 * SkillCatalogPicker - 设计子面板「+ 新面板」空面板。
 *
 * 展示「当前活跃 mindset」的完整设计技能目录，按 mindset 分层（基础 / 专业深化 /
 * 领域扩展 / 实现与交付）分组，每张卡片可点选。点选不是本地开面板：它把带隐藏
 * `[[route:<id>]]` 标记的文本通过 `onPick` 交给上层 → `sendMessage` 发进聊天 →
 * agent 走 engage_skill 真正启动 → 面板由后端预发射（pre-emission）后出现。
 *
 * 活跃 mindset 由「当前已打开面板类型」反推（panel.type === skill id），因为 BE
 * 只对活跃 mindset 内的 route id 生效。
 */
export interface ISkillCatalogPickerProps {
  /** 当前已打开的设计面板类型集合（= skill id），用于反推活跃 mindset + 标记已打开。 */
  openPanelTypes: readonly string[];
  /** mindset 分层技能目录（designPanel.listSkills 归一化结果）。 */
  mindsets: IMindsetCatalogs | null;
  /** 目录拉取进行中。 */
  fetching: boolean;
  /** 点选某张技能卡片：上层据此发送启动聊天消息。 */
  onPick: (card: IDesignSkillCard) => void;
  className?: string;
}

export const SkillCatalogPicker: React.FC<ISkillCatalogPickerProps> = ({
  openPanelTypes,
  mindsets,
  fetching,
  onPick,
  className,
}) => {
  const activeMindset = useMemo(
    () => resolveActiveMindset(openPanelTypes, mindsets),
    [openPanelTypes, mindsets]
  );

  const groups = useMemo(() => {
    if (!mindsets || !activeMindset) return [];
    const catalog = mindsets[activeMindset];
    return catalog ? groupEntriesByLayer(catalog) : [];
  }, [mindsets, activeMindset]);

  const openSet = useMemo(() => new Set(openPanelTypes), [openPanelTypes]);

  return (
    <div
      data-testid='chat-design-skill-picker'
      className={cn('h-full overflow-y-auto px-6 pb-8', className)}
    >
      {groups.length === 0 ? (
        <div
          data-testid='chat-design-skill-picker-empty'
          className='flex h-full flex-col items-center justify-center gap-3 py-10 text-[13px] text-[var(--ds-text-secondary)]'
        >
          {mindsets === null && fetching ? (
            <>
              <div className='h-6 w-6 animate-spin rounded-full border-2 border-[var(--ds-fill-3)] border-t-[var(--ds-text-primary)]' />
              <span>正在加载设计能力…</span>
            </>
          ) : (
            <span>暂时没有可添加的设计能力。</span>
          )}
        </div>
      ) : (
        <div className='flex flex-col gap-7 py-5'>
          {groups.map(group => (
            <section
              key={group.layer.id}
              data-testid={`skill-layer-${group.layer.id}`}
            >
              <h3 className='mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--ds-text-primary)]'>
                <span className='h-3.5 w-1 rounded-full bg-[var(--ds-brand-6)]' />
                {group.layer.title}
              </h3>
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {group.entries.map(card => {
                  const isOpen = openSet.has(card.id);
                  return (
                    <div
                      key={card.id}
                      role='button'
                      tabIndex={0}
                      data-testid={`skill-card-${card.id}`}
                      onClick={() => onPick(card)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onPick(card);
                        }
                      }}
                      className={cn(
                        'group flex w-full cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                        'border-[var(--ds-line-1)] bg-[var(--ds-fill-1)]',
                        'hover:border-[var(--ds-brand-6)] hover:bg-[var(--ds-brand-1)]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-6)]/30'
                      )}
                    >
                      <span
                        className='mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--ds-fill-3)] text-[15px] text-[var(--ds-text-primary)]'
                        aria-hidden
                      >
                        {card.icon ? <IconFont type={card.icon} /> : '✦'}
                      </span>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='truncate text-[14px] font-medium text-[var(--ds-text-primary)]'>
                            {card.title}
                          </span>
                          {isOpen ? (
                            <span className='shrink-0 rounded bg-[var(--ds-fill-3)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--ds-text-secondary)]'>
                              已打开
                            </span>
                          ) : null}
                        </div>
                        {card.description ? (
                          <div className='mt-2 text-[12px] leading-[18px] text-[var(--ds-text-secondary)]'>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={cardDescriptionComponents}
                            >
                              {card.description}
                            </ReactMarkdown>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default SkillCatalogPicker;
