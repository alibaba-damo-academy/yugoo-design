import { MarkerType, Position, type Edge } from '@xyflow/react'

export const NAVIGATION_HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const
export const navigationHandleId = (_type: 'source' | 'target', position: Position) => position

/** Match the native navigation map's dominant-axis routing using live positions.
 * Handle choice and selection are view state, never new canonical edge fields.
 */
export function navigationEdge(edge: { id: string; source: string; target: string; label: string },
  source: { x: number; y: number }, target: { x: number; y: number }, selected = false): Edge {
  const dx = target.x - source.x, dy = target.y - source.y
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const start = horizontal ? (dx >= 0 ? Position.Right : Position.Left) : (dy >= 0 ? Position.Bottom : Position.Top)
  const end = horizontal ? (dx >= 0 ? Position.Left : Position.Right) : (dy >= 0 ? Position.Top : Position.Bottom)
  return {
    ...edge, source: `node:${edge.source}`, target: `node:${edge.target}`,
    sourceHandle: navigationHandleId('source', start), targetHandle: navigationHandleId('target', end),
    type: 'smoothstep', zIndex: 1, selected,
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--ds-text-tertiary, #737780)' },
    style: { stroke: 'var(--ds-text-tertiary, #737780)', strokeWidth: selected ? 2.4 : 1.6 },
    labelStyle: { fontSize: 12, fontWeight: 500, fill: 'var(--ds-text-secondary, #454954)' },
    labelShowBg: true, labelBgPadding: [6, 4], labelBgBorderRadius: 4,
    labelBgStyle: { fill: 'var(--ds-static-white, #fff)', fillOpacity: 0.94 },
  }
}
