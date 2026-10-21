/** Shared resizable workspace shell for the native Web App design panels. */
import { Children, useRef, type HTMLAttributes, type ReactElement, type ReactNode } from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '../../ui/resizable.tsx'
import { cn } from '../../ui/cn.ts'
import { useDesignLeftPanelSizes } from '../panelSizing.ts'

export interface NativeDesignPanelFrameProps {
  children: ReactNode
  className?: string
  autoSaveId?: string
  overlay?: ReactNode
  /** Remove outer card chrome when the frame is nested in another detail pane. */
  embedded?: boolean
}

export interface NativeDesignPanelContentProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'main'
  mode: 'scroll' | 'workspace'
}

/**
 * Give every native detail pane the same height, typography, background, and
 * overflow behavior. Canvas/iframe workspaces retain their own scrolling;
 * ordinary forms scroll at this shared boundary.
 */
export function NativeDesignPanelContent({
  as: Component = 'main',
  mode,
  className,
  ...props
}: NativeDesignPanelContentProps): ReactElement {
  return (
    <Component
      data-panel-content-mode={mode}
      className={cn(
        'h-full min-h-0 bg-background text-sm text-[var(--ds-text-primary)]',
        mode === 'scroll' ? 'overflow-y-auto' : 'overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}

/** Render a common two-pane frame inside the generic Panel-owned surface. */
export function NativeDesignPanelFrame({
  children,
  className,
  autoSaveId = 'official-design-panel-sidebar',
  overlay,
}: NativeDesignPanelFrameProps): ReactElement {
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const leftPanelSizes = useDesignLeftPanelSizes(splitContainerRef)
  const panels = Children.toArray(children)
  const split = panels.length === 2
    ? (
      <ResizablePanelGroup
        id={`${autoSaveId}-group`}
        autoSaveId={autoSaveId}
        direction='horizontal'
        className={cn('h-full min-h-0', className)}
      >
        <ResizablePanel
          id={`${autoSaveId}-navigation`}
          order={1}
          defaultSize={leftPanelSizes.defaultSize}
          minSize={leftPanelSizes.minSize}
          maxSize={leftPanelSizes.maxSize}
        >
          <div className='design-panel-pane-content'>
            {panels[0]}
          </div>
        </ResizablePanel>
        <ResizableHandle id={`${autoSaveId}-resize-handle`} className='design-panel-resize-handle' />
        <ResizablePanel
          id={`${autoSaveId}-content`}
          order={2}
          defaultSize={leftPanelSizes.rightDefaultSize}
          minSize={leftPanelSizes.rightMinSize}
        >
          <div className='design-panel-pane-content'>
            {panels[1]}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )
    : panels

  const content = (
    <div
      ref={splitContainerRef}
      className='relative h-full min-h-0 overflow-hidden'
    >
      {split}
      {overlay}
    </div>
  )

  return content
}
