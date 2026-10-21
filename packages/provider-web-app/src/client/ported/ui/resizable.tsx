import { DragHandleDots2Icon } from '@radix-ui/react-icons';
import * as ResizablePrimitive from 'react-resizable-panels';
import type { ComponentProps } from 'react';

import { cn } from './cn.ts';

const ResizablePanelGroup = ({
  className,
  children,
  ...props
}: ComponentProps<typeof ResizablePrimitive.PanelGroup>) => {
  return (
    <ResizablePrimitive.PanelGroup
      className={cn(
        'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
        className
      )}
      {...props}
    >
      {children}
    </ResizablePrimitive.PanelGroup>
  );
};

const ResizablePanel = ResizablePrimitive.Panel;

/** Pointer tolerance around the one-pixel visual resize rule. */
const DEFAULT_HIT_AREA_MARGINS = { coarse: 16, fine: 8 } as const;

const ResizableHandle = ({
  withHandle,
  className,
  hitAreaMargins,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) => (
  <ResizablePrimitive.PanelResizeHandle
    hitAreaMargins={hitAreaMargins ?? DEFAULT_HIT_AREA_MARGINS}
    className={cn(
      'relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90',
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className='z-[var(--z-elevated)] flex h-4 w-3 items-center justify-center rounded-sm border bg-border'>
        <DragHandleDots2Icon className='h-2.5 w-2.5' />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
