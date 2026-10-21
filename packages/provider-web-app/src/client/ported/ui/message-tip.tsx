import React, { useState } from 'react';
import { Info, X } from 'lucide-react';
import { IconButton } from './icon-button.tsx';

export interface IMessageTipProps {
  /**
   * 提示文本内容
   */
  message: string;
  /**
   * 是否显示关闭按钮
   * @default true
   */
  showCloseButton?: boolean;
  /**
   * 自定义关闭按钮点击事件
   */
  onClose?: () => void;
  /**
   * 提示类型
   * @default 'info'
   */
  type?: 'info' | 'success' | 'warning' | 'error' | 'normal';
  /**
   * 自定义样式类名
   */
  className?: string;
  /**自定义icon */
  icon?: React.ReactNode;
}

export const MessageTip: React.FC<IMessageTipProps> = ({
  message,
  showCloseButton = true,
  onClose,
  icon,
  type = 'info',
  className = '',
}) => {
  const [visible, setVisible] = useState(true);

  const handleClose = () => {
    setVisible(false);
    if (onClose) {
      onClose();
    }
  };

  if (!visible) {
    return null;
  }

  // 根据不同类型设置不同的颜色和图标
  const getTypeColor = () => {
    switch (type) {
      case 'info':
        return 'bg-[var(--ds-notice-light-bg-default)] text-[var(--ds-text-primary)] border-[var(--ds-notice-light-border)]';
      case 'success':
        return 'bg-[var(--ds-success-light-bg-default)] text-[var(--ds-text-primary)] border-[var(--ds-success-light-border)]';
      case 'warning':
        return 'bg-[var(--ds-warning-light-bg-default)] text-[var(--ds-text-primary)] border-[var(--ds-warning-light-border)]';
      case 'error':
        return 'bg-[var(--ds-error-light-bg-default)] text-[var(--ds-text-primary)] border-[var(--ds-error-light-border)]';
      case 'normal':
        return 'border-[var(--ds-brand-light-border)] text-[var(--ds-text-primary)] bg-[var(--ds-brand-light-bg-default)]';
      default:
        return 'border-[var(--ds-brand-light-border)] text-[var(--ds-text-primary)] bg-[var(--ds-brand-light-bg-default)]';
    }
  };

  const getTypeIcon = () => {
    if (icon) {
      return icon;
    }
    switch (type) {
      case 'info':
        return <Info className='w-4 h-4 flex-shrink-0' />;
      case 'success':
        return <Info className='w-4 h-4 flex-shrink-0' />;
      case 'warning':
        return <Info className='w-4 h-4 flex-shrink-0' />;
      case 'error':
        return <Info className='w-4 h-4 flex-shrink-0' />;
      default:
        return <Info className='w-4 h-4 flex-shrink-0' />;
    }
  };

  return (
    <div
      className={`flex items-center justify-between w-full px-4 py-2.5 rounded-[12px] border ${getTypeColor()} ${className}`}
      style={{ minHeight: '32px', fontSize: '12px', lineHeight: '18px' }}
    >
      <div className='flex items-center gap-1 flex-1'>
        {getTypeIcon()}
        <span className='ml-2 text-sm text-[var(--ds-text-primary)]'>
          {message}
        </span>
      </div>

      {showCloseButton && (
        <IconButton
          size='sm'
          variant='transparent'
          shape='square'
          onClick={handleClose}
          className='text-[var(--ds-text-5)] hover:text-[var(--ds-text-6)]'
          aria-label='关闭提示'
        >
          <X className='w-4 h-4' />
        </IconButton>
      )}
    </div>
  );
};
