import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from './cn.ts';

const buttonVariants = cva(
  'focus-brand-ring inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button font-normal transition-colors cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_.iconfont]:leading-none !shadow-none',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--ds-brand-bg-default)] text-primary-foreground shadow-sm hover:bg-[var(--ds-brand-bg-hover)] disabled:bg-[var(--ds-other-overlay-1)] disabled:cursor-not-allowed disabled:text-[var(--ds-text-disabled)] disabled:border-none',
        destructive:
          'bg-[var(--ds-error-bg-default)] text-destructive-foreground shadow-sm hover:bg-[var(--ds-error-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--ds-error-bg-disabled)]',
        outline:
          'border border-[var(--ds-fill-6)] bg-background shadow-sm hover:bg-[var(--ds-bg-white-hover)] active:bg-[hsl(var(--active))] hover:text-accent-foreground disabled:border-input disabled:border-[--ds-divider-default] disabled:cursor-not-allowed disabled:hover:bg-background disabled:text-[var(--ds-text-disabled)]',
        secondary:
          'bg-[var(--ds-brand-light-bg-default)] text-[var(--ds-brand-text-primary)] border border-[var(--ds-brand-light-border)] hover:bg-[var(--ds-brand-light-bg-hover)] active:bg-[var(--ds-brand-light-bg-active)] disabled:text-[var(--ds-text-disabled)] disabled:cursor-not-allowed disabled:bg-[var(--ds-other-overlay-1)] disabled:border-none',
        tertiary:
          'bg-[var(--ds-other-overlay-1)] text-[var(--ds-text-primary)] shadow-sm hover:bg-[var(--ds-other-overlay-2)] active:bg-[var(--ds-other-overlay-3)] disabled:text-[var(--ds-text-disabled)] disabled:cursor-not-allowed disabled:bg-[var(--ds-other-overlay-1)]',
        ghost:
          'text-[var(--ds-text-primary)] hover:bg-[var(--ds-other-overlay-1)] active:bg-[var(--ds-other-overlay-2)] disabled:text-[var(--ds-text-disabled)] disabled:cursor-not-allowed disabled:hover:bg-transparent',
        link: 'text-primary underline-offset-4 hover:underline disabled:opacity-80 disabled:cursor-not-allowed disabled:hover:no-underline',
        icon: 'border border-[var(--ds-fill-6)] text-[var(--ds-text-7)] bg-background shadow-sm hover:bg-[var(--ds-bg-white-hover)] hover:text-[var(--ds-text-8)] active:bg-[hsl(var(--active))] active:text-[var(--ds-text-primary)] disabled:opacity-80 disabled:cursor-not-allowed disabled:hover:bg-background disabled:text-[var(--ds-text-disabled)]',
        ghostIcon:
          'text-[var(--ds-text-7)] hover:bg-[var(--ds-other-overlay-1)] hover:text-[var(--ds-text-8)] active:bg-[var(--ds-other-overlay-2)] active:text-[var(--ds-text-primary)] disabled:text-[var(--ds-text-disabled)] disabled:cursor-not-allowed disabled:hover:bg-transparent',
        warning:
          'bg-[var(--ds-error-light-bg-default)] text-[var(--ds-error-text-primary)] border border-[var(--ds-error-light-border)] hover:bg-[var(--ds-error-light-bg-hover)] active:bg-[var(--ds-error-light-bg-active)] disabled:text-[var(--ds-error-text-placeholder)] disabled:cursor-not-allowed disabled:bg-[var(--ds-error-1)] disabled:border-[var(--ds-error-light-bg-hover)]',
      },
      size: {
        default: 'h-8 px-4 py-[5px] text-[14px] leading-[22px]',
        sm: 'h-7 px-3 py-[5px] text-[12px] leading-[18px]',
        lg: 'h-9 px-8 text-[16px]',
        icon: 'h-8 w-8 rounded-[var(--ds-radius-4)] text-[var(--ds-icon-outline-default)] hover:bg-[var(--ds-bg-gary-hover)] active:bg-[var(--ds-bg-gary-active)] [&_svg]:!h-5 [&_svg]:!w-5',
      },
    },
    compoundVariants: [
      {
        variant: 'ghostIcon',
        size: 'default',
        className: 'p-2 [&_.iconfont]:!text-[16px]',
      },
      {
        variant: 'ghostIcon',
        size: 'sm',
        className: 'p-[7px] [&_.iconfont]:!text-[14px]',
      },
      {
        variant: 'ghostIcon',
        size: 'lg',
        className: 'p-[9px] [&_.iconfont]:!text-[18px]',
      },
      {
        variant: 'icon',
        size: 'default',
        className: 'px-[7px] py-2 [&_.iconfont]:!text-[16px]',
      },
      {
        variant: 'icon',
        size: 'sm',
        className: 'px-[6px] py-[7px] [&_.iconfont]:!text-[14px]',
      },
      {
        variant: 'icon',
        size: 'lg',
        className: 'px-[8px] py-[9px] [&_.iconfont]:!text-[18px]',
      },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
