import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { Check, X } from 'lucide-react';

import { cn } from './cn.ts';

type TSwitchVariant = 'default' | 'text' | 'icon';

interface ISwitchProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>,
    'children'
  > {
  variant?: TSwitchVariant;
  checkedContent?: React.ReactNode;
  uncheckedContent?: React.ReactNode;
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  ISwitchProps
>(
  (
    {
      className,
      variant = 'default',
      checkedContent,
      uncheckedContent,
      ...props
    },
    ref
  ) => {
    const isDecoratedVariant = variant !== 'default';
    const checkedDisplay =
      checkedContent ??
      (variant === 'text' ? (
        'ON'
      ) : variant === 'icon' ? (
        <Check className='h-2.5 w-2.5' strokeWidth={2.5} />
      ) : null);
    const uncheckedDisplay =
      uncheckedContent ??
      (variant === 'text' ? (
        'OFF'
      ) : variant === 'icon' ? (
        <X className='h-2.5 w-2.5' strokeWidth={2.5} />
      ) : null);

    return (
      <SwitchPrimitives.Root
        className={cn(
          'group peer relative inline-flex shrink-0 cursor-pointer items-center border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
          isDecoratedVariant
            ? 'h-[18px] w-9 rounded-full data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--ds-fill-3)]'
            : 'h-[18px] w-9 rounded-full data-[state=checked]:bg-primary data-[state=unchecked]:bg-[var(--ds-fill-6)]',
          className
        )}
        {...props}
        ref={ref}
      >
        {isDecoratedVariant ? (
          <>
            <span
              aria-hidden='true'
              className={cn(
                'pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[8px] font-normal leading-none transition-opacity group-data-[state=unchecked]:opacity-0',
                variant === 'icon'
                  ? 'text-background'
                  : 'text-background tracking-tight'
              )}
            >
              {checkedDisplay}
            </span>
            <span
              aria-hidden='true'
              className={cn(
                'pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[8px] font-normal leading-none transition-opacity group-data-[state=checked]:opacity-0',
                variant === 'icon'
                  ? 'text-[var(--ds-text-7)]'
                  : 'text-[var(--ds-text-7)] tracking-tight'
              )}
            >
              {uncheckedDisplay}
            </span>
          </>
        ) : null}
        <SwitchPrimitives.Thumb
          className={cn(
            'pointer-events-none block rounded-full bg-background ring-0 transition-transform',
            isDecoratedVariant
              ? 'h-[14px] w-[14px] shadow-sm data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0'
              : 'h-[14px] w-[14px] data-[state=checked]:translate-x-[17px] data-[state=unchecked]:translate-x-0'
          )}
        />
      </SwitchPrimitives.Root>
    );
  }
);
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
export type { ISwitchProps, TSwitchVariant };
