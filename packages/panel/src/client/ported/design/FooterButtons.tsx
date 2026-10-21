import React from 'react';
import { Button, type ButtonProps } from '../ui/button.tsx';
import { cn } from '../ui/cn.ts';

interface ISaveAndRegenerateButtonsProps {
  onSave?: () => void;
  onRegenerate?: () => void;
  saveText?: string;
  regenerateText?: string;
  className?: string;
  disabled: boolean;
  /** 保存按钮独立的禁用状态。未指定时回退到 `disabled`。
   *
   * 为什么需要分离：`disabled` 同时控制 "撤回（regenerate）" 与 "保存
   * （save）" 两个按钮。撤回的语义是 "撤销未保存的修改"——必须
   * 在 `hasPendingChanges=false` 时禁用。保存的语义则是 "确认提案 或
   * 保存编辑并评估下一步"——AI 完成提案后即使用户没有任何编辑，也应当能点
   * 击确认。两个语义的禁用条件不同，所以保存按钮需要自己的开关。 */
  saveDisabled?: boolean;
  /** 保存按钮样式。用于区分"确认保存"和"有未保存更新"的视觉强度。 */
  saveVariant?: ButtonProps['variant'];
  /** 自定义内容，显示在按钮左侧 */
  children?: React.ReactNode;
}

const FooterButtons: React.FC<ISaveAndRegenerateButtonsProps> = ({
  disabled,
  saveDisabled,
  onSave,
  onRegenerate,
  saveText = 'Save',
  regenerateText = 'Regenerate',
  className = '',
  children,
  saveVariant = 'default',
}) => {
  const effectiveSaveDisabled =
    saveDisabled !== undefined ? saveDisabled : disabled;
  return (
    <div
      className={cn(
        'relative z-[var(--z-elevated)] flex flex-col items-stretch gap-3 bg-background p-4 sm:flex-row sm:items-center sm:gap-4',
        children ? 'sm:justify-between' : 'sm:justify-end',
        className
      )}
    >
      {/* 左侧自定义内容区域；min-w-0 让长元数据行可以 ellipsis 而不挤占按钮 */}
      {children && <div className='flex min-w-0 items-center gap-2'>{children}</div>}

      {/* 右侧按钮区域 */}
      <div className='dsh-design-footer-actions flex items-center gap-2'>
        <Button
          data-testid='dsh-design-revert'
          className='min-w-0'
          variant='outline'
          onClick={onRegenerate}
          disabled={disabled}
        >
          {regenerateText}
        </Button>
        <Button
          data-testid='dsh-design-save'
          className='min-w-0'
          variant={saveVariant}
          onClick={() => onSave?.()}
          disabled={effectiveSaveDisabled}
        >
          {saveText}
        </Button>
      </div>
    </div>
  );
};

export default FooterButtons;
