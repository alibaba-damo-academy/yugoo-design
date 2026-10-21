import { useEffect, type RefObject } from 'react'
import type { ReactFlowInstance } from '@xyflow/react'
import { RELATION_GRAPH_AUTO_FIT, relationGraphFitViewport } from './relation-graph-layout.ts'

/** Refit on container geometry changes, not on selection or data edits.
 * Sidebar/window resizing refits, but a same-size map returning from a hidden
 * preview preserves the user's pan/zoom. Never persist viewport changes as facts.
 */
export function useFlowContainerFit(elementRef: RefObject<HTMLDivElement | null>, flow: ReactFlowInstance | undefined,
  bounds?: Readonly<{ current: { x: number; y: number; width: number; height: number } | undefined }>): void {
  useEffect(() => {
    const element = elementRef.current
    if (!element || !flow || typeof ResizeObserver === 'undefined') return
    let frame = 0
    let width = 0, height = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const nextWidth = Math.round(entry.contentRect.width), nextHeight = Math.round(entry.contentRect.height)
      if (nextWidth <= 0 || nextHeight <= 0) { cancelAnimationFrame(frame); return }
      cancelAnimationFrame(frame)
      if (nextWidth === width && nextHeight === height) return
      frame = requestAnimationFrame(() => {
        width = nextWidth; height = nextHeight
        if (bounds?.current) void flow.setViewport(relationGraphFitViewport(bounds.current, width, height))
        else void flow.fitView(RELATION_GRAPH_AUTO_FIT)
      })
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [elementRef, flow, bounds])
}
