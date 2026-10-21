import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { cn } from '../../ui/cn.ts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../ui/tooltip.tsx';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import EllipsisTooltip from '../../ui/ellipsis-tooltip.tsx';
import { useLang } from '../../host.ts';

/**
 * 节点数据接口
 */
interface ICustomNodeData {
  label?: string;
  description?: string;
  priority?: 'High' | 'Medium' | 'Low';
  deleted?: boolean;
  rejected?: boolean;
  children?: string[]; // 子节点名称列表
  sourcePosition?: Position; // 源连接点位置
  targetPosition?: Position; // 目标连接点位置
  isBidirectionalRoot?: boolean; // 是否为双向布局的根节点
  hidden?: boolean; // 是否隐藏节点（不显示可见内容）
  [key: string]: unknown;
}

/**
 * 自定义节点组件 - 组织架构风格
 */
export const CustomNode: React.FC<NodeProps> = ({
  data,
  sourcePosition,
  targetPosition,
}) => {
  const t = useLang();
  const nodeData = data as ICustomNodeData;

  // 使用传入的位置，或使用 data 中的位置，或使用默认位置
  const finalSourcePosition =
    sourcePosition || nodeData.sourcePosition || Position.Bottom;
  const finalTargetPosition =
    targetPosition || nodeData.targetPosition || Position.Top;

  // 如果是隐藏节点，只渲染连接点，不显示可见内容
  if (nodeData.hidden) {
    return (
      <div className='w-1 h-1 opacity-0 pointer-events-none'>
        <Handle
          type='target'
          position={finalTargetPosition}
          className='!opacity-0 !pointer-events-none'
        />
        <Handle
          type='source'
          position={finalSourcePosition}
          className='!opacity-0 !pointer-events-none'
        />
      </div>
    );
  }
  // 根据节点是否有子节点来判断层级，只有叶子节点支持 tooltip
  const hasChildren = nodeData.children && nodeData.children.length > 0;
  const shouldShowTooltip = !hasChildren;
  const isRejected = Boolean(nodeData.rejected || nodeData.deleted);

  // 构建悬浮窗内容
  const tooltipContent = (
    <div className='max-w-[300px]'>
      <div className='font-medium text-[14px] text-[var(--ds-text-primary)]'>
        {nodeData.label}
      </div>
      {nodeData.description && (
        <div className='mt-1.5 text-xs text-[var(--ds-text-tertiary)]'>
          {nodeData.description}
        </div>
      )}
      {/* 额外的数据信息 */}
      {/**优先级信息 */}
      {nodeData.priority && !isRejected && (
        <div className='mt-3'>
          <div className='inline-flex h-7 items-center gap-1 rounded-full border border-[var(--ds-line-1)] px-2 text-[12px] leading-none text-[var(--ds-text-primary)]'>
            <span
              className={cn(
                'h-[9px] w-[9px] rounded-full',
                nodeData.priority === 'High' &&
                  'bg-[var(--ds-brand-bg-default)]',
                nodeData.priority === 'Medium' &&
                  'bg-[var(--ds-brand-light-border)]',
                nodeData.priority === 'Low' &&
                  'bg-[var(--ds-icon-outline-muted)]'
              )}
            />
            <span>
              {nodeData.priority === 'High'
                ? t.priority_high
                : nodeData.priority === 'Medium'
                  ? t.priority_medium
                  : t.priority_low}
            </span>
          </div>
        </div>
      )}
      {isRejected && (
        <div className='mt-3'>
          <div className='inline-flex h-7 items-center gap-1 rounded-full border border-[var(--ds-line-1)] px-2 text-[12px] leading-none text-[var(--ds-text-primary)]'>
            <span
              className={cn(
                'h-[9px] w-[9px] rounded-full',
                'bg-[var(--ds-icon-outline-muted)]'
              )}
            />
            <span>{t.filter_rejected}</span>
          </div>
        </div>
      )}
      {/* 子项列表 */}
      {nodeData.children && nodeData.children.length > 0 && (
        <div className='text-xs border-t border-border pt-2'>
          {/* <div className='font-medium mb-1'>
            子项 ({nodeData.children.length}):
          </div> */}
          <ul className='list-disc list-inside space-y-1 text-muted-foreground'>
            {nodeData.children.map((childName, index) => (
              <li key={index} className='truncate'>
                {childName}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
  const labelContent = shouldShowTooltip ? (
    <EllipsisTooltip width='100%'>{nodeData.label}</EllipsisTooltip>
  ) : (
    nodeData.label
  );

  const nodeContent = (
    <div
      className={cn(
        'w-[200px] rounded-xl border transition-all duration-300 cursor-pointer relative overflow-hidden bg-white hover:[box-shadow:var(--ds-shadow-2-center)]',
        isRejected
          ? 'border-red-200 bg-red-50 hover:border-red-300'
          : 'border-[var(--ds-line-1)] hover:border-[var(--ds-brand-5)]'
      )}
    >
      <Handle
        type='target'
        position={finalTargetPosition}
        className='!h-2 !w-2 !border-2 !border-indigo-400 !bg-background !opacity-0'
      />

      {nodeData.isBidirectionalRoot && (
        <>
          <Handle
            type='source'
            position={Position.Left}
            id='left'
            className='!h-2 !w-2 !border-2 !border-indigo-400 !bg-background !opacity-0'
          />
          <Handle
            type='source'
            position={Position.Right}
            id='right'
            className='!h-2 !w-2 !border-2 !border-indigo-400 !bg-background !opacity-0'
          />
        </>
      )}

      <div className='py-2.5 px-4'>
        {nodeData.label && (
          <div
            className={cn(
              'mb-0 break-words leading-tight dark:text-white',
              isRejected ? 'text-red-700' : 'text-[var(--ds-text-primary)]',
              hasChildren
                ? 'text-base font-semibold'
                : 'text-[14px] font-semibold'
            )}
          >
            {labelContent}
          </div>
        )}
      </div>

      {!nodeData.isBidirectionalRoot && (
        <Handle
          type='source'
          position={finalSourcePosition}
          className='!h-2 !w-2 !border-2 !border-indigo-400 !bg-background !opacity-0'
        />
      )}
    </div>
  );

  if (!shouldShowTooltip) {
    return nodeContent;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{nodeContent}</TooltipTrigger>
        <TooltipPrimitive.Portal>
          <TooltipContent
            side='bottom'
            align='start'
            className='pointer-events-auto z-[var(--z-tooltip)] overflow-visible border-none bg-transparent p-3 text-[var(--ds-text-primary)] !shadow-none translate-x-[-12px] translate-y-[-6px]'
            sideOffset={0}
            collisionPadding={20}
            avoidCollisions={true}
          >
            <div className='max-h-[min(20rem,calc(100vh-40px))] overflow-y-auto overscroll-contain rounded-[12px] bg-[#fff] px-3 py-2.5 [box-shadow:var(--ds-shadow-2-center)] break-words'>
              {tooltipContent}
            </div>
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </Tooltip>
    </TooltipProvider>
  );
};

export default CustomNode;
