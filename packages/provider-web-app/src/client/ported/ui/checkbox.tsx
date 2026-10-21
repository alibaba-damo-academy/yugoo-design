import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon, MinusIcon } from '@radix-ui/react-icons';

import { cn } from './cn.ts';

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn('dsh-design-checkbox focus-brand-ring peer', className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator className='dsh-design-checkbox-indicator group'>
      <CheckIcon className='h-4 w-4 group-data-[state=indeterminate]:hidden' />
      <MinusIcon className='hidden h-4 w-4 group-data-[state=indeterminate]:block' />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
