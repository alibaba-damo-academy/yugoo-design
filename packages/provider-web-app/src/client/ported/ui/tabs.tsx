import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from './cn.ts';

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, children, ...props }, ref) => {
  const listRef =
    React.useRef<React.ElementRef<typeof TabsPrimitive.List>>(null);
  const [indicatorStyle, setIndicatorStyle] =
    React.useState<React.CSSProperties>({
      opacity: 0,
      transform: 'translateX(0px)',
      width: 0,
    });

  React.useImperativeHandle(ref, () => listRef.current!);

  React.useLayoutEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    const updateIndicator = () => {
      const activeTrigger = listElement.querySelector<HTMLElement>(
        '[role="tab"][data-state="active"]'
      );

      if (!activeTrigger) {
        setIndicatorStyle(prev =>
          prev.opacity === 0 ? prev : { ...prev, opacity: 0 }
        );
        return;
      }

      const nextStyle = {
        opacity: 1,
        transform: `translateX(${activeTrigger.offsetLeft}px)`,
        width: activeTrigger.offsetWidth,
      };

      setIndicatorStyle(prev =>
        prev.opacity === nextStyle.opacity &&
        prev.transform === nextStyle.transform &&
        prev.width === nextStyle.width
          ? prev
          : nextStyle
      );
    };

    updateIndicator();

    const mutationObserver = new MutationObserver(updateIndicator);
    mutationObserver.observe(listElement, {
      attributes: true,
      attributeFilter: ['data-state'],
      childList: true,
      subtree: true,
    });

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateIndicator);
    resizeObserver?.observe(listElement);
    Array.from(listElement.children).forEach(child => {
      resizeObserver?.observe(child);
    });

    window.addEventListener('resize', updateIndicator);

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateIndicator);
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn(
        'relative inline-flex h-8 items-center justify-center rounded-lg bg-[var(--ds-other-overlay-1)] p-[3px] text-muted-foreground',
        className
      )}
      {...props}
    >
      <span
        aria-hidden='true'
        className='pointer-events-none absolute left-0 top-[3px] z-0 h-[calc(100%-6px)] rounded-[var(--ds-radius-3)] bg-background transition-[transform,width,opacity] duration-300 ease-out'
        style={indicatorStyle}
      />
      {children}
    </TabsPrimitive.List>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'focus-brand-border relative z-10 inline-flex items-center justify-center whitespace-nowrap rounded-[var(--ds-radius-3)] px-3 py-[3px] text-sm leading-[18px] font-normal ring-offset-background transition-[color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 text-[var(--ds-text-7)] data-[state=active]:text-[var(--ds-text-9)] data-[state=active]:[transition-delay:0ms,300ms] data-[state=active]:[box-shadow:var(--ds-shadow-1-center)]',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
