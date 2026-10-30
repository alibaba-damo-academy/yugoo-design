/** Screen-space labels; presentation never moves a graph node. */
import { edgeReading, type GraphNode, type GraphScope } from './graph-model.js'

/** Prefer record names, then short fields participating in explicit links.
 * This is a reading order, not a measure of business importance or certainty.
 */
export function graphLabelRanks(graph: Pick<GraphScope, 'nodes' | 'edges'>): Map<string, number> {
  const linked = new Set(graph.edges.filter(e => edgeReading(e).meaning !== 'contains').flatMap(e => [e.from, e.to]))
  return new Map([...graph.nodes].sort((a, b) => Number(b.record) - Number(a.record)
    || Number(linked.has(b.id)) - Number(linked.has(a.id))
    || [...a.label].length - [...b.label].length || a.id.localeCompare(b.id)).map((node, index) => [node.id, index]))
}

export function shortGraphLabel(node: GraphNode, detailed: boolean, contentCount = 0): string {
  const chars = [...node.label.replace(/\s+/g, ' ').trim()], limit = detailed ? 28 : node.record ? 18 : 10
  const title = chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : chars.join('')
  return title + (node.record && contentCount ? ` · ${contentCount}项` : '')
}

export interface LabelBox { x: number; y: number; w: number; h: number }
export interface LabelItem extends LabelBox { id: string }
export const intersects = (a: LabelBox, b: LabelBox) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
/** Caller supplies priority order and measured screen-space boxes, including all lines. */
export function visibleLabelIds(items: (LabelItem & { important?: boolean })[]): Set<string> {
  const occupied: LabelBox[] = []
  const visible = new Set<string>()
  for (const item of items) {
    const box = { x: item.x - 3, y: item.y - 3, w: item.w + 6, h: item.h + 6 }
    if (!item.important && occupied.some(other => intersects(other, box))) continue
    occupied.push(box); visible.add(item.id)
  }
  return visible
}
export function placeLabels<T extends LabelItem>(items: T[], obstacles: LabelBox[], width: number, height: number): (T & { box: LabelBox })[] {
  const placed: (T & { box: LabelBox })[] = []
  for (const item of items) {
    const { x, y, w, h } = item, gap = 12
    const offsets = [[-w / 2, gap], [-w / 2, -gap - h], [gap, -h / 2], [-gap - w, -h / 2], [gap, gap], [-gap - w, gap], [gap, -gap - h], [-gap - w, -gap - h]]
    for (const [dx, dy] of offsets) {
      const box = { x: x + dx, y: y + dy, w, h }
      if (box.x < 8 || box.y < 8 || box.x + w > width - 8 || box.y + h > height - 8) continue
      if (placed.some(p => intersects(p.box, box)) || obstacles.some(p => intersects(p, box))) continue
      placed.push({ ...item, box }); break
    }
  }
  return placed
}
