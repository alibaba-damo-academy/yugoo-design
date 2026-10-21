import React, { useEffect, useRef, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip.tsx';
import type { TooltipProps } from '@radix-ui/react-tooltip';
import { cn } from './cn.ts';

/**
 * Tooltip 位置类型
 */
export type ITipPlacement = 'top' | 'right' | 'bottom' | 'left';

/**
 * EllipsisTooltip 组件 Props
 */
export interface IEllipsisProps {
  /** 容器宽度 */
  width?: string;
  /** 最大宽度 */
  maxWidth?: string;
  /** 子元素内容 */
  children: React.ReactNode;
  /** 提示框位置 */
  placement?: ITipPlacement;
  /** 提示框层级 */
  zIndex?: number | string;
  /** 文本是否居中 */
  textCenter?: boolean;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** Tooltip 触发方式 */
  trigger?: TooltipProps['delayDuration'];
}

/**
 * EllipsisTooltip - 文本溢出省略号 + Tooltip 组件
 *
 * 功能特点：
 * - 自动检测文本是否溢出
 * - 溢出时显示省略号，悬浮显示完整内容
 * - 不溢出时不显示 Tooltip
 * - 支持监听尺寸变化，动态更新溢出状态
 *
 * @example
 * ```tsx
 * <EllipsisTooltip width="200px" placement="top">
 *   这是一段很长的文本内容，可能会溢出
 * </EllipsisTooltip>
 * ```
 */
export const EllipsisTooltip: React.FC<IEllipsisProps> = ({
  width,
  maxWidth,
  children,
  placement = 'top',
  zIndex = 'var(--z-tooltip)',
  textCenter = false,
  style,
  trigger,
}) => {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflow, setIsOverflow] = useState(false);

  // 检查文本是否溢出
  const checkOverflow = () => {
    if (textRef.current) {
      const { scrollWidth, clientWidth } = textRef.current;
      setIsOverflow(scrollWidth > clientWidth);
    }
  };

  // 初始化检查和监听尺寸变化
  useEffect(() => {
    checkOverflow();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    // 使用 ResizeObserver 监听尺寸变化
    const resizeObserver = new ResizeObserver(() => {
      checkOverflow();
    });

    if (textRef.current) {
      resizeObserver.observe(textRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [children]);

  // 文本容器样式
  const textContainerStyle: React.CSSProperties = {
    display: 'inline-block', // 使用 inline-block 支持宽度和省略号，同时可作为内联元素
    width,
    maxWidth: maxWidth || width,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: textCenter ? 'center' : 'left',
    verticalAlign: 'bottom', // 避免内联元素基线对齐问题
    ...style,
  };

  // 如果不溢出，直接渲染内容
  if (!isOverflow) {
    return (
      <span ref={textRef} style={textContainerStyle}>
        {children}
      </span>
    );
  }

  // 如果溢出，渲染带 Tooltip 的内容
  return (
    <TooltipProvider delayDuration={trigger}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            ref={textRef}
            style={{ ...textContainerStyle, cursor: 'pointer' }}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={placement}
          className={cn('max-w-[360px] break-words z-[var(--z-tooltip)]')}
          style={{ zIndex }}
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default EllipsisTooltip;
