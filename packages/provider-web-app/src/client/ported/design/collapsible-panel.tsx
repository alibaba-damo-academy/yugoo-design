import React, { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { cn } from '../ui/cn.ts';

/**
 * CollapsiblePanel - 可展开收起的容器组件
 *
 * 设计 Token:
 * - paint_2:006968: linear-gradient(84deg, #865FF1 0%, #8A97EA 107%) - 标题渐变背景
 * - paint_2:010: rgba(16, 8, 43, 0.08) - 边框颜色
 * - paint_2:003: #FFFFFF - 标题文字颜色
 * - paint_2:015: #FBFBFD - 内容背景色
 * - font_2:0236: 16px/24px Medium - 标题字体
 * - font_2:025: 14px/22px Regular - 统计信息字体
 */

export interface ICollapsiblePanelProps {
  /** 标题 */
  title: string;
  /** 统计信息（显示在右上角，如"12个故事"） */
  count?: string;
  /** 子元素内容 */
  children: React.ReactNode;
  /** 默认是否展开 */
  defaultExpanded?: boolean;
  /** 受控：是否展开 */
  expanded?: boolean;
  /** 受控：展开状态变化回调 */
  onExpandChange?: (expanded: boolean) => void;
  /** 自定义类名 */
  className?: string;
  /** 内容区域自定义类名 */
  contentClassName?: string;
}

export const CollapsiblePanel: React.FC<ICollapsiblePanelProps> = ({
  title,
  count,
  children,
  defaultExpanded = true,
  expanded: controlledExpanded,
  onExpandChange,
  className,
  contentClassName,
}) => {
  // 内部状态（非受控模式）
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  // 判断是否受控
  const isControlled = controlledExpanded !== undefined;
  const isExpanded = isControlled ? controlledExpanded : internalExpanded;

  // 切换展开状态
  const toggleExpanded = () => {
    const newExpanded = !isExpanded;

    if (!isControlled) {
      setInternalExpanded(newExpanded);
    }

    onExpandChange?.(newExpanded);
  };

  return (
    <div className={cn('w-full', className)}>
      {/* 标题栏 */}
      <div
        onClick={toggleExpanded}
        className={cn(
          'w-full px-[var(--ds-space-4)] flex items-center justify-between',
          'transition-all duration-200',
          'hover:opacity-90',
          'focus:outline-none focus:ring-2 focus:ring-[#865FF1] focus:ring-offset-2',
          'cursor-pointer',
          'select-none' // 禁止文本选择
        )}
      >
        {/* 左侧：标题 */}
        <span className='text-[rgba(16, 8, 43, 0.8)] text-base font-medium leading-6'>
          {title}
          {count && (
            <span className='text-[var(--ds-text-7)] text-sm font-[500] leading-[22px] ml-2'>
              {count}
            </span>
          )}
        </span>

        {/* 右侧：统计信息 + 展开图标 */}
        <div className='flex items-center gap-3'>
          <ChevronUp
            className={cn(
              'w-4 h-4 text-[var(--ds-text-7)] transition-transform duration-200 hover:text-[var(--ds-text-9)]',
              isExpanded ? 'rotate-180' : 'rotate-90'
            )}
          />
        </div>
      </div>

      {/* 内容区域 */}
      <div
        className={cn(
          'grid w-full transition-[grid-template-rows] duration-200 ease-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className='min-h-0 overflow-hidden'>
          <div
            className={cn(
              'w-full pt-3',
              'flex flex-col gap-[12px]',
              contentClassName
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CollapsiblePanel;
