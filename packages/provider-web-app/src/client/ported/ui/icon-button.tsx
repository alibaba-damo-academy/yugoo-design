import React from 'react';
import { cn } from './cn.ts';

const iconButtonSizeClassNames = {
  xs: 'h-5 w-5 [&_svg]:h-3 [&_svg]:w-3 [&_.iconfont]:text-[12px]',
  sm: 'h-6 w-6 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_.iconfont]:text-[14px]',
  md: 'h-[30px] w-[30px] [&_svg]:h-4 [&_svg]:w-4 [&_.iconfont]:text-[16px]',
  lg: 'h-8 w-8 [&_svg]:h-4 [&_svg]:w-4 [&_.iconfont]:text-[16px]',
} as const;

const iconButtonVariantClassNames = {
  default:
    'bg-[var(--ds-brand-bg-default)] text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-brand-bg-hover)]',
  destructive:
    'bg-[var(--ds-error-bg-default)] text-destructive-foreground hover:bg-[var(--ds-error-bg-hover)]',
  ghost:
    'text-[var(--ds-text-tertiary)] hover:text-foreground hover:bg-[hsl(var(--hover))]',
  ghostIcon:
    'text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-other-overlay-1)] active:bg-[var(--ds-other-overlay-2)]',
  soft: 'bg-[var(--ds-other-overlay-1)] text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-other-overlay-2)]',
  secondary:
    'bg-[var(--ds-other-overlay-1)] text-[var(--ds-text-tertiary)] hover:bg-[var(--ds-other-overlay-2)]',
  outline:
    'border border-[var(--ds-border-default)] bg-white text-[var(--ds-icon-outline-default)] [box-shadow:var(--ds-shadow-1-center)] hover:bg-[var(--ds-bg-gary-default)]',
  icon: 'border border-[var(--ds-fill-6)] bg-background text-[var(--ds-icon-outline-default)] hover:bg-[var(--ds-bg-gary-hover)] active:bg-[var(--ds-bg-gary-active)]',
  danger:
    'text-[var(--ds-text-primary)] hover:bg-[var(--ds-error-light-bg-default)] hover:text-[var(--ds-error-6)]',
  transparent: 'bg-transparent text-inherit hover:bg-transparent',
} as const;

const iconButtonShapeClassNames = {
  square: 'rounded-[4px]',
  rounded: 'rounded-[8px]',
  circle: 'rounded-full',
} as const;

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: keyof typeof iconButtonSizeClassNames;
  variant?: keyof typeof iconButtonVariantClassNames;
  shape?: keyof typeof iconButtonShapeClassNames;
  stopPropagation?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      children,
      onClick,
      active = false,
      disabled = false,
      size = 'md',
      variant = 'ghost',
      shape = 'square',
      stopPropagation = true,
      type = 'button',
      className,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          'inline-flex shrink-0 items-center justify-center font-normal transition-colors focus-brand-ring disabled:cursor-not-allowed disabled:text-disabled-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_.iconfont]:leading-none',
          iconButtonSizeClassNames[size],
          iconButtonShapeClassNames[shape],
          !active && !disabled && iconButtonVariantClassNames[variant],
          active && !disabled
            ? 'text-primary bg-[var(--ds-brand-light-bg-default)] hover:text-primary hover:bg-[var(--ds-brand-light-bg-default)]'
            : '',
          active && disabled
            ? 'bg-[var(--ds-brand-light-bg-default)] text-primary'
            : '',
          className
        )}
        onClick={e => {
          if (stopPropagation) {
            e.stopPropagation();
          }
          onClick?.(e);
        }}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
