import React, { useEffect, useState } from 'react';
import { cn } from '../ui/cn.ts';
import { IconFont } from '../ui/icon-font.tsx';
import { TAB_BUTTON_BG } from './assets.ts';
import { currentLanguage } from '../host.ts';

/**
 * DesignTabs - 简洁的 Tab 切换组件
 *
 * 设计 Token:
 * - paint_2:36031: #F9F9F9 (背景色)
 * - paint_2:98447: #ECEBEE (边框)
 * - paint_2:042: rgba(16, 8, 43, 0.6) (默认文字)
 * - paint_2:097: #663AE8 (激活文字)
 * - paint_2:230: #F93920 (徽章红点)
 * - effect_2:332: 0px 4px 16px rgba(0, 120, 0, 0.198) (阴影)
 */

export interface ITabOption {
  /** 标签值 */
  value: string;
  /** 标签文字 */
  label: string;
  /** 图标（可选） */
  icon?: string;
  /** 是否显示灰点（人工未保存编辑提醒） */
  badge?: boolean;
  /** 是否显示「new」未读角标（agent 离屏更新，未查看） */
  unread?: boolean;
}

export interface IDesignTabsProps {
  /** 当前选中的值 */
  value: string;
  /** 值变化回调 */
  onChange: (value: string) => void;
  /** 标签选项列表 */
  options: ITabOption[];
  /** 在屏 tab 被 agent 更新的瞬时闪烁信号（nonce 变化触发一次淡出动画） */
  flashTab?: { type: string; nonce: number } | null;
  /** 自定义类名 */
  className?: string;
}

export const DesignTabs: React.FC<IDesignTabsProps> = ({
  value,
  onChange,
  options,
  flashTab,
  className,
}) => {
  // 在屏 tab 更新：触发一次淡出 new 标记（notify but no lingering badge）。
  // 按 nonce 重置，使连续更新都能各闪一次。
  const [flash, setFlash] = useState<{ type: string; nonce: number } | null>(
    null
  );
  useEffect(() => {
    if (!flashTab) return;
    setFlash(flashTab);
    const id = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(id);
  }, [flashTab?.type, flashTab?.nonce]);
  return (
    <div
      data-testid='chat-design-tabs'
      className={cn(
        'w-full min-w-0 overflow-x-auto bg-[var(--ds-fill-1)] px-2 pt-2 shadow-[inset_0px_-1px_4px_0px_rgba(0,0,0,0.06)]',
        className
      )}
    >
      <div className='flex min-w-max items-end gap-1'>
        {options.map(option => {
          const isActive = value === option.value;

          return (
            <button
              key={option.value}
              type='button'
              data-testid={`chat-design-tab-${option.value}`}
              data-state={isActive ? 'active' : 'inactive'}
              onClick={() => onChange(option.value)}
              className={cn(
                'relative flex h-[34px] items-center',
                option.icon && 'gap-2',
                'text-sm font-normal leading-[22px] transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-brand-6)]/20',
                !isActive &&
                  'bg-transparent text-[var(--ds-text-7)] hover:text-[var(--ds-text-primary)] px-3',
                isActive && 'text-[var(--ds-text-9)] px-5'
              )}
              style={
                isActive
                  ? {
                      backgroundImage: `url(${TAB_BUTTON_BG})`,
                      backgroundPosition: 'center -3px',
                      backgroundRepeat: 'no-repeat',
                      backgroundSize: '120% 129%',
                    }
                  : undefined
              }
            >
              {option.icon ? (
                <IconFont
                  className={cn(
                    'text-[14px]',
                    isActive
                      ? 'text-[var(--ds-text-primary)]'
                      : 'text-[rgba(16,8,43,0.48)]'
                  )}
                  type={option.icon}
                />
              ) : null}
              <span>{option.label}</span>
              {option.badge ? (
                // 灰点：人工未保存编辑提醒（互斥优先于 new）。
                <span
                  className={`absolute ${isActive ? 'right-3' : 'right-1'} top-2 h-1.5 w-1.5 rounded-full bg-[var(--ds-icon-outline-muted)]`}
                />
              ) : option.unread ? (
                // 离屏 agent 更新：持久 new 角标，打开 tab 即清除。
                <span className='absolute -right-1 top-0 rounded-full bg-[var(--ds-brand-6)] px-1 text-[10px] leading-[14px] text-white'>
                  new
                </span>
              ) : flash?.type === option.value ? (
                // 在屏更新：与未读 new 区分，短暂显示已更新。
                <span
                  key={flash.nonce}
                  className='absolute -right-1 top-0 rounded-full bg-[var(--ds-brand-6)] px-1 text-[10px] leading-[14px] text-white animate-[ds-flash-out_1.5s_ease-out_forwards]'
                >
                  {currentLanguage() === 'zh_CN' ? '已更新' : 'updated'}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default DesignTabs;
