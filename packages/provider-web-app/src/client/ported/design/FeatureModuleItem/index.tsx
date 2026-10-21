import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../ui/cn.ts';
import { Textarea } from '../../ui/textarea.tsx';
import { Button } from '../../ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../ui/tooltip.tsx';
import type { IFunctionModuleType } from '../functionModulesTypes.ts';
import { useLang } from '../../host.ts';
import ModuleMarkDown from './ModuleMarkDown.tsx';
import { IconFont } from '../../ui/icon-font.tsx';
import { FunctionDetailsEditor } from '../../../panels/function-details.tsx';

/**
 * FeatureModuleItem - 单个功能模块卡片组件
 *
 * 设计 Token:
 * - paint_62:10670: #F5F4FF - 背景色（hover/编辑）
 * - paint_2:77894: rgba(102, 58, 232, 0.3) - 边框颜色（hover/编辑）
 * - paint_51:21438: #F5F5F9 - 背景色（禁用）
 * - paint_51:21591: #DEDEF7 - 边框颜色（禁用）
 * - paint_2:385: #10082B - 标题文字颜色
 * - paint_2:042: rgba(16, 8, 43, 0.6) - 描述文字颜色
 * - paint_51:15111: #663AE8 - 高优先级背景色
 * - paint_2:003: #FFFFFF - 白色文字
 * - paint_51:11315: rgba(187, 190, 255, 0.11) - AI建议背景色
 * - paint_21:14263: linear-gradient(...) - 编辑状态边框渐变
 */


export interface IFeatureModuleItemProps {
  /** 单个功能模块数据 */
  panelData: IFunctionModuleType;
  /** 数据变更回调函数，返回修改后的模块数据 */
  onChange?: (updatedModule: IFunctionModuleType) => void;
  /** 自定义类名 */
  className?: string;
  disabled: boolean;
}

/**
 * 优先级映射
 */
const PRIORITY_MAP: Record<IFunctionModuleType['priority'], string> = {
  High: '高优先级',
  Medium: '中优先级',
  Low: '低优先级',
};

/**
 * 优先级样式配置 - 使用不同程度的紫色区分
 */
const PRIORITY_STYLES: Record<
  IFunctionModuleType['priority'],
  { bg: string; text: string; border: string }
> = {
  High: {
    bg: 'bg-[var(--ds-brand-bg-default)]',
    text: 'text-[var(--ds-text-primary)] font-normal',
    border: 'border border-[var(--ds-divider-default)]',
  },
  Medium: {
    bg: 'bg-[var(--ds-brand-light-border)]',
    text: 'text-[var(--ds-text-primary)] font-normal',
    border: 'border border-[var(--ds-divider-default)]',
  },
  Low: {
    bg: 'bg-[var(--ds-icon-outline-muted)]',
    text: 'text-[var(--ds-text-primary)] font-normal',
    border: 'border border-[var(--ds-divider-default)]',
  },
};

export const FeatureModuleItem: React.FC<IFeatureModuleItemProps> = ({
  panelData: module,
  onChange,
  className,
  disabled,
}) => {
  const t = useLang();
  // 跟踪是否正在编辑
  const [isEditing, setIsEditing] = useState<boolean>(false);
  // 跟踪编辑中的临时数据
  const [editingData, setEditingData] = useState<{
    description?: string;
    priority?: IFunctionModuleType['priority'];
  }>({});
  // Textarea ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 编辑状态时，将光标移到文本末尾
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const textarea = textareaRef.current;
      const length = textarea.value.length;
      textarea.setSelectionRange(length, length);
      textarea.focus();
    }
  }, [isEditing]);

  /**
   * 更新模块数据
   */
  const updateModule = (updates: Partial<IFunctionModuleType>) => {
    onChange?.({
      ...module,
      ...updates,
    });
  };

  /**
   * 处理优先级变更
   */
  const handlePriorityChange = (value: 'High' | 'Medium' | 'Low') => {
    const priority = value;

    // 如果正在编辑，更新临时数据
    if (isEditing) {
      setEditingData(prev => ({ ...prev, priority }));
    } else {
      // 否则直接触发变更回调
      updateModule({ priority });
    }
  };

  /**
   * 处理描述变更
   */
  const handleDescriptionChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>
  ) => {
    const description = e.target.value;
    setEditingData(prev => ({ ...prev, description }));
  };

  /**
   * 开始编辑
   */
  const handleEditStart = () => {
    setIsEditing(true);
    setEditingData({
      description: module.function_description,
      priority: module.priority,
    });
  };

  /**
   * 保存编辑
   */
  const handleEditSave = () => {
    updateModule({
      function_description: editingData.description,
      priority: editingData.priority,
    });

    // 清空编辑状态
    setIsEditing(false);
    setEditingData({});
  };

  /**
   * 取消编辑
   */
  const handleEditCancel = () => {
    setIsEditing(false);
    setEditingData({});
  };

  /** 标记为已拒绝。拒绝项保留在面板中，可随时恢复。 */
  const handleDelete = () => {
    updateModule({ rejected: true });
  };

  /** 恢复已拒绝功能。 */
  const handleRestore = () => {
    updateModule({ rejected: false });
  };

  const isRejected = module.rejected;
  const isAISuggested = module.source === 'ai';

  // 显示数据：编辑模式下使用临时数据
  const displayDescription = isEditing
    ? (editingData.description ?? module.function_description)
    : module.function_description;

  const displayPriority = isEditing
    ? (editingData.priority ?? module.priority)
    : module.priority;

  const titleOpacity = isRejected ? 'opacity-50' : 'opacity-100';
  const descOpacity = isRejected ? 'opacity-50' : 'opacity-100';

  const priorityConfig = PRIORITY_STYLES[displayPriority];
  const priorityLabel = displayPriority;

  return (
    <div
      className={cn(
        'group relative w-full rounded-lg border border-[var(--ds-line-1)] bg-[var(--ds-static-white)] px-3 py-[10px] transition-all duration-200 hover:[box-shadow:var(--ds-shadow-1-center)]',
        className
      )}
    >
      <div>
        {/* 标题行 */}
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0 flex-1'>
            {/* AI 建议标签 - 放在标题左边 */}
            {/* {isAISuggested && !isRejected && (
              <span
                className='px-1.5 py-0.5 rounded-sm text-[10px] text-white font-medium'
                style={{
                  background:
                    'linear-gradient(90deg, #865FF1 0%, #8A97EA 100%)',
                  transform: 'scale(0.9)',
                }}
              >
                AI{t.suggestion_text}
              </span>
            )} */}
            <h4
              className={cn(
                'text-[14px] font-[500] leading-7 text-[var(--ds-text-primary)]',
                titleOpacity
              )}
            >
              {module.function_name}
            </h4>
          </div>
          <div className='flex shrink-0 items-center gap-2' data-testid='function-title-priority'>
            {!isRejected ? (
              <Select
                value={priorityLabel}
                onValueChange={handlePriorityChange}
                disabled={isRejected || disabled}
              >
                <SelectTrigger
                  data-tip-id='tip_capability_priority'
                  className={cn(
                    'h-[28px] min-w-[96px] w-auto rounded-full px-2 text-xs shadow-none',
                    'border-[var(--ds-line-1)] bg-[var(--ds-bg-white)]',
                    priorityConfig?.text,
                    priorityConfig?.border
                  )}
                >
                  <div className='flex items-center gap-2'>
                    <span
                      className={cn('h-2 w-2 rounded-full', priorityConfig?.bg)}
                    />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className='text-[12px]' value='High'>
                    {t.priority_high}
                  </SelectItem>
                  <SelectItem className='text-[12px]' value='Medium'>
                    {t.priority_medium}
                  </SelectItem>
                  <SelectItem className='text-[12px]' value='Low'>
                    {t.priority_low}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <>
                <div className='inline-flex h-7 items-center gap-1 rounded-full border border-[var(--ds-line-1)] px-2 text-[12px] leading-none text-[var(--ds-text-primary)]'>
                  <span className='h-[9px] w-[9px] rounded-full bg-[var(--ds-icon-outline-muted)]' />
                  <span>{t.filter_rejected}</span>
                </div>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={handleRestore}
                  className='h-7 !rounded-[999px]'
                >
                  {t.reset_text}
                </Button>
              </>
            )}
          </div>
        </div>

        {isEditing ? (
          <Textarea
            ref={textareaRef}
            disabled={disabled}
            value={displayDescription}
            onChange={handleDescriptionChange}
            className='min-h-[88px] w-full resize-none rounded-2xl border border-[var(--ds-border-default)] bg-[var(--ds-bg-white)] px-4 py-3 text-sm leading-6 text-[var(--ds-text-secondary)] focus:border-[var(--ds-border-default)] focus:outline-none focus:ring-0'
            placeholder={t.function_description_placeholder}
          />
        ) : (
          <ModuleMarkDown
            className={cn(
              'mt-0 whitespace-pre-wrap text-[12px] leading-6 text-[var(--ds-text-7)]',
              descOpacity
            )}
          >
            {displayDescription}
          </ModuleMarkDown>
        )}

        <div className='mt-1 flex items-end justify-end gap-2'>
          <div
            className={cn(
              'flex shrink-0 items-center gap-0 transition-opacity duration-200 ease-out',
              isEditing
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100'
            )}
          >
            {isEditing ? (
              <>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={handleEditCancel}
                  className='h-8 border-none px-2 text-xs text-[var(--ds-text-primary)]'
                >
                  {t.button_cancel}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={handleEditSave}
                  className='h-8 border-none px-2 text-xs text-[var(--ds-brand-text-primary)] hover:text-[var(--ds-brand-text-primary)]'
                >
                  {t.button_save}
                </Button>
              </>
            ) : (
              !isRejected && (
                <>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Button
                            variant='ghostIcon'
                            onClick={handleEditStart}
                            disabled={isRejected || disabled}
                          >
                            <IconFont type='icon-line-operation-edit' />
                          </Button>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{t.button_edit}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div>
                          <Button
                            variant='ghostIcon'
                            onClick={handleDelete}
                            disabled={disabled}
                          >
                            <IconFont type='icon-line-status-notfull' />
                          </Button>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{t.button_reject}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )
            )}
          </div>
        </div>
        <FunctionDetailsEditor module={module} onChange={onChange} disabled={disabled || isRejected} />
      </div>
    </div>
  );
};

export default FeatureModuleItem;
