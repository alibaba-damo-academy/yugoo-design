import type { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk-api.js'
import { getViewportForBounds } from '@xyflow/react'

/** Automatic framing never magnifies 14px labels beyond their authored size.
 * Users can still zoom in manually; this is view geometry, not Design state.
 */
export const RELATION_GRAPH_AUTO_FIT = { maxZoom: 1, padding: 0.2 } as const

export function relationGraphFitViewport(bounds: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  return getViewportForBounds(bounds, width, height, 0.15, RELATION_GRAPH_AUTO_FIT.maxZoom, RELATION_GRAPH_AUTO_FIT.padding)
}

export interface GraphSize { width: number; height: number }
export interface GraphPoint { x: number; y: number }
export const RELATION_SIDES = ['left', 'right', 'top', 'bottom'] as const
export type RelationSide = typeof RELATION_SIDES[number]
export const isRelationSide = (side: unknown): side is RelationSide => RELATION_SIDES.some(value => value === side)
const sideVector = (side: RelationSide): GraphPoint => ({
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 },
})[side]

/** A dragged node temporarily has no ELK route. Preserve side tangents and
 * separate parallel edges until the next measured auto-layout, without writes.
 */
export function relationFallbackCurve(source: GraphPoint, target: GraphPoint, sourceSide: RelationSide, targetSide: RelationSide, offset = 0) {
  const dx = target.x - source.x, dy = target.y - source.y
  const length = Math.hypot(dx, dy)
  const lane = length ? { x: -dy / length * offset, y: dx / length * offset } : { x: 0, y: offset }
  const spread = Math.max(70, length * 0.35)
  const from = sideVector(sourceSide), to = sideVector(targetSide)
  const control = (point: GraphPoint, vector: GraphPoint) => ({ x: point.x + vector.x * spread + lane.x, y: point.y + vector.y * spread + lane.y })
  const a = control(source, from), b = control(target, to)
  const annotation = (point: GraphPoint, vector: GraphPoint) => ({ x: point.x + vector.x * 80, y: point.y + vector.y * 80 - 28 })
  return {
    path: `M ${source.x} ${source.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${target.x} ${target.y}`,
    label: { x: (source.x + target.x) / 2 + lane.x * 0.75, y: (source.y + target.y) / 2 + lane.y * 0.75 },
    sourceAnnotation: annotation(source, from), targetAnnotation: annotation(target, to),
  }
}
export interface RelationLayoutLink {
  id: string
  source: string
  target: string
  sourceSide?: RelationSide
  targetSide?: RelationSide
  labels: Array<GraphSize & { id: string; placement: 'CENTER' | 'TAIL' | 'HEAD' }>
}
export interface RelationRoute {
  points: GraphPoint[]
  labels: Record<string, GraphPoint>
}

export const relationNodeId = (id: string) => `node:${encodeURIComponent(id)}`
export const relationEdgeId = (id: string) => `edge:${encodeURIComponent(id)}`

/** Layout must reserve the rendered text boxes, not just the object rectangles.
 * Fixed ports match all four shared node handles. Unspecified sides retain
 * the original right-out/left-in layout. Hand-selected sides are transient. All
 * output is transient view geometry; it never goes into Design Files.
 */
export function relationLayoutInput(nodes: Array<GraphSize & { id: string }>, links: RelationLayoutLink[]): ElkNode {
  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '48', 'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.spacing.edgeLabel': '8', 'elk.spacing.labelLabel': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24', 'elk.spacing.edgeNode': '24',
      'elk.layered.mergeEdges': 'false', 'elk.edgeLabels.inline': 'false',
    },
    children: nodes.map(node => ({
      ...node, id: relationNodeId(node.id),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: RELATION_SIDES.map(side => ({ id: `${relationNodeId(node.id)}:${side}`,
        x: side === 'left' ? 0 : side === 'right' ? node.width : node.width / 2,
        y: side === 'top' ? 0 : side === 'bottom' ? node.height : node.height / 2, width: 0, height: 0,
        layoutOptions: { 'elk.port.side': { left: 'WEST', right: 'EAST', top: 'NORTH', bottom: 'SOUTH' }[side] },
      })),
    })),
    edges: links.map(link => ({
      id: relationEdgeId(link.id), sources: [`${relationNodeId(link.source)}:${link.sourceSide ?? 'right'}`], targets: [`${relationNodeId(link.target)}:${link.targetSide ?? 'left'}`],
      labels: link.labels.map(label => ({ id: label.id, text: label.id, width: label.width, height: label.height,
        layoutOptions: { 'elk.edgeLabels.placement': label.placement } })),
    })),
  }
}

export function relationRoute(edge: ElkExtendedEdge): RelationRoute | undefined {
  const section = edge.sections?.[0]
  if (!section) return
  return { points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
    labels: Object.fromEntries((edge.labels ?? []).filter(label => label.id && label.x !== undefined && label.y !== undefined)
      .map(label => [label.id!, { x: label.x! + (label.width ?? 0) / 2, y: label.y! + (label.height ?? 0) / 2 }])) }
}
