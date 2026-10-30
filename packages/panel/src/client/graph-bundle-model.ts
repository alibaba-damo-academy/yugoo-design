import { edgeReading, recordOwner, relationMeaningLabel, type DesignGraph, type GraphEdge, type GraphNode, type GraphScope } from './graph-model.js'

export const edgeMembers = (edge: GraphEdge) => edge.members ?? [edge]
export function graphColor(owner: string): string {
  let hash = 2166136261
  for (const char of owner) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  return 'hsl(' + ((hash >>> 0) % 360) + ' 85% 74%)'
}
function key(parts: unknown[]) { return JSON.stringify(parts) }
function aggregate(edges: GraphEdge[], endpoint: (id: string) => string | undefined): GraphEdge[] {
  const groups = new Map<string, GraphEdge>()
  for (const edge of edges) {
    let from = endpoint(edge.from), to = endpoint(edge.to)
    if (!from || !to) continue
    const reading = edgeReading(edge)
    if (reading.direction === 'symmetric' && from > to) [from, to] = [to, from]
    const id = 'view-relation:' + key([from, to, edge.kind, reading.relationType, reading.meaning, reading.origin, reading.direction, reading.lifecycle])
    const previous = groups.get(id)
    const members = [...(previous?.members ?? []), ...edgeMembers(edge)]
    // Identity, evidence and original endpoints survive every display fold.
    groups.set(id, { ...edge, id, from, to, reading, label: members.length > 1 ? relationMeaningLabel(reading.meaning) + ' · ' + members.length + ' 条原始关系' : members[0]!.label, members })
  }
  return [...groups.values()]
}
/** Same record projection as the normal graph, retaining all original member IDs. */
export function projectExplorationRecords(graph: DesignGraph, expanded: ReadonlySet<string>): GraphScope {
  const owners = new Map(graph.nodes.map(node => [node.id, recordOwner(graph, node.id)]))
  const nodes = graph.nodes.filter(node => node.record || !owners.get(node.id) || expanded.has(owners.get(node.id)!))
  const visible = new Set(nodes.map(node => node.id))
  const edges = aggregate(graph.edges, id => visible.has(id) ? id : owners.get(id))
  return { nodes, edges, total: nodes.length }
}
export interface BundleDisplayNode { id: string; owner: string; label: string; sources: string[]; node?: GraphNode }
export interface BundleSector { owner: string; label: string; start: number; end: number; angle: number; count: number }
export function bundleDisplay(scope: GraphScope, collapsed: ReadonlySet<string>) {
  const byOwner = new Map<string, GraphNode[]>()
  for (const node of scope.nodes) { const group = byOwner.get(node.owner) ?? []; group.push(node); byOwner.set(node.owner, group) }
  const nodes: BundleDisplayNode[] = [], sectors: BundleSector[] = []
  const endpoint = new Map<string, string>(), ids = new Set(scope.nodes.map(node => node.id))
  let offset = 0
  const total = scope.nodes.length + byOwner.size * 2
  for (const [owner, group] of [...byOwner].sort(([a], [b]) => a.localeCompare(b))) {
    const start = (offset + .7) / total * Math.PI * 2, end = (offset + group.length + 1.3) / total * Math.PI * 2
    const angle = (start + end) / 2
    sectors.push({ owner, label: group.find(node => node.sourcePanel)?.sourcePanel ?? owner, start, end, angle, count: group.length })
    let groupId = 'view-bundle:' + owner
    while (ids.has(groupId)) groupId += ':'
    const sorted = [...group].sort((a, b) => (a.recordId ?? a.id).localeCompare(b.recordId ?? b.id) || a.pointer.localeCompare(b.pointer) || a.id.localeCompare(b.id))
    if (collapsed.has(owner)) nodes.push({ id: groupId, owner, label: owner, sources: sorted.map(node => node.id) })
    else nodes.push(...sorted.map(node => ({ id: node.id, owner, label: node.label, sources: [node.id], node })))
    for (const node of group) endpoint.set(node.id, collapsed.has(owner) ? groupId : node.id)
    offset += group.length + 2
  }
  const edges = aggregate(scope.edges, id => endpoint.get(id))
  return { nodes, edges, sectors }
}
export function bundleCoordinates(display: ReturnType<typeof bundleDisplay>) {
  const points = new Map<string, { x: number; y: number; angle: number }>()
  for (const sector of display.sectors) {
    const members = display.nodes.filter(node => node.owner === sector.owner)
    for (const [index, node] of members.entries()) {
      const angle = members.length === 1 ? sector.angle : sector.start + (sector.end - sector.start) * (index + .5) / members.length
      const radius = node.node?.record ? .86 : 1
      points.set(node.id, { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius, angle })
    }
  }
  return points
}
