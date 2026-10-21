import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from './cn.ts';

const TooltipProvider = TooltipPrimitive.Provider;

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'pointer-events-none z-[var(--z-tooltip)] overflow-hidden rounded-sm bg-[hsl(var(--tooltip))] px-2 py-1 text-xs leading-[18px] text-[hsl(var(--tooltip-foreground))] [box-shadow:var(--ds-shadow-2-center)] animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

interface IClickableTooltipProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>,
    'children' | 'open' | 'onOpenChange'
  > {
  trigger: React.ReactNode;
  children: React.ReactNode;
  triggerClassName?: string;
  triggerProps?: Omit<React.ComponentPropsWithoutRef<'span'>, 'children'>;
  contentProps?: React.ComponentPropsWithoutRef<typeof TooltipContent>;
  providerProps?: React.ComponentPropsWithoutRef<typeof TooltipProvider>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function ClickableTooltip({
  trigger,
  children,
  triggerClassName,
  triggerProps,
  contentProps,
  providerProps,
  open: controlledOpen,
  onOpenChange,
  ...tooltipProps
}: IClickableTooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const ignoreNextClickRef = React.useRef(false);
  const ignoreCloseUntilRef = React.useRef(0);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && Date.now() < ignoreCloseUntilRef.current) {
        return;
      }

      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange]
  );

  React.useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) ||
          contentRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, setOpen]);

  return (
    <TooltipProvider delayDuration={0} {...providerProps}>
      <Tooltip open={open} onOpenChange={setOpen} {...tooltipProps}>
        <TooltipTrigger asChild>
          <span
            {...triggerProps}
            ref={triggerRef}
            tabIndex={0}
            className={cn(triggerClassName, triggerProps?.className)}
            onPointerDown={event => {
              triggerProps?.onPointerDown?.(event);
              if (
                event.defaultPrevented ||
                event.button > 0 ||
                event.pointerType === 'mouse'
              ) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              ignoreNextClickRef.current = true;
              ignoreCloseUntilRef.current = Date.now() + 350;
              setOpen(true);
            }}
            onClick={event => {
              triggerProps?.onClick?.(event);
              if (ignoreNextClickRef.current) {
                ignoreNextClickRef.current = false;
                event.stopPropagation();
                return;
              }
            }}
          >
            {trigger}
          </span>
        </TooltipTrigger>
        <TooltipContent ref={contentRef} {...contentProps}>
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  ClickableTooltip,
};
