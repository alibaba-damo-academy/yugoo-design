/** Read-only presentation model. Layout groups never become design facts. */
export interface GraphNode { id: string; label: string; sourceLabel?: string; sourcePanel?: string; previewSourcePanel?: string; file: string; pointer: string; context: string; owner: string; record: boolean; recordId?: string; parentId?: string; contentKind?: 'container' | 'unit'; recordKind?: 'design-record' | 'design-content' | 'design-artifact'; ontologyType?: string; identityQuality?: 'stable' | 'structural' | 'anonymous'; schemaPointer?: string; ontologyRevision?: string }

/** Display groups are existing persisted units, never inferred from text or values. */
export function contentDetail(graph: Pick<DesignGraph, 'nodes'>, node: GraphNode) {
  return {
    kind: node.contentKind === 'container' ? '来源容器' : node.contentKind === 'unit' ? '设计单元' : node.record ? '来源记录' : '设计内容',
    source: graph.nodes.find(n => n.id === node.recordId),
    children: graph.nodes.filter(n => n.parentId === node.id && n.contentKind !== undefined),
  }
}
export interface RelationReading { relationType: string; meaning: string; origin: 'file' | 'embedding' | 'agent' | 'human' | 'unknown'; direction: 'forward' | 'symmetric' | 'unknown'; lifecycle: string }
export interface EdgeSource { id: string; from: string; to: string; label: string; evidence: string; reading?: RelationReading; kind?: string }
export interface GraphEdge extends EdgeSource { kind: string; members?: EdgeSource[] }
export interface DesignGraph { checkpoint: string; nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[]; projectId?: string; knowledgeRevision?: string; knowledgeStatus?: 'current' | 'due' | 'queued' | 'running' | 'failed' | 'disabled' | 'unavailable' | 'unknown'; recovery?: { state: 'rebuilding' | 'ready' | 'error'; message: string; generation?: string }; coverage?: { projection: string; embedding: string; phase?: 'projection' | 'semantic' | 'publication' | 'ready' | 'error' | 'disabled' | 'unknown'; review: string; ontology?: { contractRevision?: string; declaredTypes: number; instantiatedTypes: number; stable: number; structural: number; anonymous: number; untyped: number } }; freshness?: { sourceCheckpoint: string; indexedCheckpoint?: string; sourceEquivalent?: boolean }; semantic?: { state: string; completed: number; total: number; model: string; message?: string; cache?: 'persistent' | 'memory' } }
export interface GraphScope { nodes: GraphNode[]; edges: GraphEdge[]; total: number }

/** Legacy presentation kinds are not evidence of origin, lifecycle or business meaning. */
export function edgeReading(edge: EdgeSource): RelationReading {
  if (edge.reading) return edge.reading
  return { relationType: edge.kind ?? 'unknown', meaning: edge.kind === 'contains' ? 'contains' : edge.kind === 'semantic' ? 'similar' : 'unknown',
    origin: 'unknown', direction: edge.kind === 'contains' ? 'forward' : edge.kind === 'semantic' ? 'symmetric' : 'unknown', lifecycle: 'unknown' }
}
const meaningLabels: Record<string, string> = { contains: '包含', references: '引用', similar: '相似候选', supports: '支持', realizes: '实现', constrains: '约束', precedes: '先于', contradicts: '矛盾', unknown: '未分类' }
export const relationOriginLabels: Record<RelationReading['origin'], string> = { file: '文件投影', embedding: 'Embedding', agent: 'Agent 分析', human: '人工记录', unknown: '来源未知' }
export function relationMeaningLabel(meaning: string): string { return Object.hasOwn(meaningLabels, meaning) ? meaningLabels[meaning] : meaning }
export function relationDirectionLabel(direction: RelationReading['direction']): string {
  return direction === 'forward' ? '从源端到目标端' : direction === 'symmetric' ? '对称关系（无先后）' : '语义方向未声明'
}
export function relationLifecycleLabel(lifecycle: string): string {
  const labels: Record<string, string> = { observed: '已观测', proposed: '候选解释', accepted: '已采纳', rejected: '已拒绝', superseded: '已被替代', unknown: '状态未知' }
  return Object.hasOwn(labels, lifecycle) ? labels[lifecycle] : lifecycle
}
/** Independent filters, applied before neighborhood expansion and display limits. */
export function filterRelations(graph: GraphScope, meaning = 'all', origin = 'all'): GraphScope {
  return { ...graph, edges: graph.edges.filter(edge => {
    const reading = edgeReading(edge)
    return (meaning === 'all' || reading.meaning === meaning) && (origin === 'all' || reading.origin === origin)
  }) }
}
export function graphNodeMatches(node: GraphNode, query: string): boolean {
  return `${node.label} ${node.file} ${node.pointer} ${node.context}`.toLowerCase().includes(query.trim().toLowerCase())
}

function readingKey(reading: RelationReading): string[] {
  return [reading.relationType, reading.meaning, reading.origin, reading.direction, reading.lifecycle]
}

/** Distinct other records, excluding contains and repeated evidence. Visual only. */
export function recordReach(graph: Pick<DesignGraph, 'nodes' | 'edges'>): Map<string, number> {
  const owners = new Map(graph.nodes.map(n => [n.id, recordOwner(graph, n.id)]))
  const neighbors = new Map(graph.nodes.filter(n => n.record).map(n => [n.id, new Set<string>()]))
  for (const e of graph.edges) {
    if (e.kind === 'contains') continue
    const a = owners.get(e.from), b = owners.get(e.to)
    if (!a || !b || a === b) continue
    neighbors.get(a)?.add(b); neighbors.get(b)?.add(a)
  }
  return new Map([...neighbors].map(([id, adjacent]) => [id, adjacent.size]))
}
export function nodeRadius(node: GraphNode, reach: Map<string, number>): number {
  return node.record ? Math.sqrt(6.25 + 9 * Math.min(48, Math.max(0, reach.get(node.id) ?? 0))) : 2
}

export function recordOwner(graph: Pick<DesignGraph, 'nodes' | 'edges'>, id: string): string | undefined {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]))
  const parents = new Map(graph.edges.filter(e => e.kind === 'contains').map(e => [e.to, e.from]))
  const seen = new Set<string>()
  while (!seen.has(id)) {
    seen.add(id)
    const node = nodes.get(id)
    if (node?.record) return id
    if (node?.recordId && nodes.get(node.recordId)?.record) return node.recordId
    const parent = node?.parentId ?? parents.get(id)
    if (!parent) return
    id = parent
  }
}

/** false=overview, true=all descendants, set=complete trees of selected records. */
export function projectRecords(graph: Pick<DesignGraph, 'nodes' | 'edges'>, expanded: boolean | ReadonlySet<string>): GraphScope {
  const owner = new Map(graph.nodes.map(n => [n.id, recordOwner(graph, n.id)]))
  const nodes = graph.nodes.filter(n => n.record || (owner.get(n.id) && (expanded === true || (typeof expanded !== 'boolean' && expanded.has(owner.get(n.id)!)))))
  const visible = new Set(nodes.map(n => n.id))
  const endpoint = (id: string) => visible.has(id) ? id : owner.get(id)
  const grouped = new Map<string, GraphEdge[]>()
  for (const edge of graph.edges) {
    let from = endpoint(edge.from), to = endpoint(edge.to)
    if (!from || !to || from === to || !visible.has(from) || !visible.has(to)) continue
    const reading = edgeReading(edge)
    if (reading.direction === 'symmetric' && from > to) [from, to] = [to, from]
    const key = JSON.stringify([edge.kind, from, to, ...readingKey(reading)])
    grouped.set(key, [...(grouped.get(key) ?? []), edge])
  }
  const edges: GraphEdge[] = []
  for (const [key, originals] of grouped) {
    const unique = [...new Map(originals.map(e => [JSON.stringify([e.from, e.to, e.kind, ...readingKey(edgeReading(e)), e.evidence]), e])).values()]
    const first = unique[0], reading = edgeReading(first)
    let from = endpoint(first.from)!, to = endpoint(first.to)!
    if (reading.direction === 'symmetric' && from > to) [from, to] = [to, from]
    edges.push({ ...first, from, to, reading,
      id: unique.length === 1 ? first.id : 'aggregate:' + key,
      label: unique.length === 1 ? first.label : first.label + ' · ' + unique.length + ' 处依据',
      evidence: unique.map(e => e.evidence).join('\n'),
      members: unique.map(e => ({ id: e.id, from: e.from, to: e.to, label: e.label, evidence: e.evidence, kind: e.kind, reading: edgeReading(e) })),
    })
  }
  return { nodes, edges, total: nodes.length }
}

export function scopeGraph(graph: GraphScope, kind: string, seed: string, depth: number, limit = 160): GraphScope {
  const edges = graph.edges.filter(e => kind === 'all' || e.kind === kind)
  const near = new Set<string>(seed ? [seed] : graph.nodes.map(n => n.id))
  for (let step = 0; seed && step < depth; step++) {
    const previous = new Set(near)
    for (const e of edges) if (previous.has(e.from) || previous.has(e.to)) { near.add(e.from); near.add(e.to) }
  }
  const eligible = graph.nodes.filter(n => near.has(n.id))
  const buckets = [...new Set(eligible.map(n => n.owner))].sort().map(owner => eligible.filter(n => n.owner === owner))
  const nodes: GraphNode[] = []
  const selected = eligible.find(n => n.id === seed)
  if (selected) nodes.push(selected)
  for (let row = 0; nodes.length < Math.min(limit, eligible.length); row++) {
    for (const bucket of buckets) { const n = bucket[row]; if (n && n.id !== seed && nodes.length < limit) nodes.push(n) }
  }
  const visible = new Set(nodes.map(n => n.id))
  return { nodes, edges: edges.filter(e => visible.has(e.from) && visible.has(e.to)), total: eligible.length }
}

/** Undirected connected components, not semantic communities. */
export function structuralGroups(graph: GraphScope): Map<string, number> {
  const adjacency = new Map(graph.nodes.map(n => [n.id, [] as string[]]))
  for (const e of graph.edges) { adjacency.get(e.from)?.push(e.to); adjacency.get(e.to)?.push(e.from) }
  const groups = new Map<string, number>()
  let index = 0
  for (const node of graph.nodes) {
    if (groups.has(node.id)) continue
    const queue = [node.id]; groups.set(node.id, index)
    for (let i = 0; i < queue.length; i++) for (const id of adjacency.get(queue[i]) ?? []) if (!groups.has(id)) { groups.set(id, index); queue.push(id) }
    index++
  }
  return groups
}

/** Size-aware disconnected-component packing; layout only, never domain clusters. */
export function componentCenters(graph: GraphScope): Map<string, { x: number; y: number }> {
  const groups = structuralGroups(graph), buckets = new Map<number, GraphNode[]>()
  for (const node of graph.nodes) { const key = groups.get(node.id)!; buckets.set(key, [...(buckets.get(key) ?? []), node]) }
  const blocks = [...buckets.values()].map(nodes => ({ nodes, size: 130 * Math.sqrt(nodes.length) + 120 }))
    .sort((a, b) => b.nodes.length - a.nodes.length || a.nodes.map(n => n.id).sort()[0].localeCompare(b.nodes.map(n => n.id).sort()[0]))
  const width = Math.max(1, Math.sqrt(blocks.reduce((sum, b) => sum + b.size ** 2, 0)) * 1.4)
  let x = 0, y = 0, rowHeight = 0
  const result = new Map<string, { x: number; y: number }>()
  for (const block of blocks) {
    if (x && x + block.size > width) { x = 0; y += rowHeight; rowHeight = 0 }
    for (const node of block.nodes) result.set(node.id, { x: x + block.size / 2, y: y + block.size / 2 })
    x += block.size; rowHeight = Math.max(rowHeight, block.size)
  }
  return result
}

export function edgeSpring(kind: string): { distance: number; strength: number } {
  return kind === 'semantic' ? { distance: 155, strength: .07 } : kind === 'contains' ? { distance: 105, strength: .25 } : { distance: 125, strength: .18 }
}

/** Presentation-only communities: greedily improve weighted modularity on records.
 * A single bridge does not collapse dense neighborhoods into one component.
 * Sorted IDs and strict positive gains make tie-breaking deterministic.
 */
export function relationshipGroups(graph: GraphScope): Map<string, string> {
  const ids = graph.nodes.map(n => n.id).sort(), present = new Set(ids)
  const weights = new Map<string, { a: string; b: string; w: number }>()
  for (const edge of graph.edges) {
    if (edge.kind === 'contains' || edge.from === edge.to || !present.has(edge.from) || !present.has(edge.to)) continue
    const [a, b] = [edge.from, edge.to].sort(), key = JSON.stringify([a, b])
    // Multiple evidence fields must not overwhelm a relationship with one good source.
    const w = edge.kind === 'semantic' ? 1 : 1.25
    if (w > (weights.get(key)?.w ?? 0)) weights.set(key, { a, b, w })
  }
  const groups = new Map(ids.map(id => [id, id])), degree = new Map(ids.map(id => [id, 0]))
  let m = 0
  for (const { a, b, w } of weights.values()) { degree.set(a, degree.get(a)! + w); degree.set(b, degree.get(b)! + w); m += w }
  if (!m) return groups
  for (let pass = 0; pass < ids.length; pass++) {
    const totals = new Map<string, number>(), between = new Map<string, { a: string; b: string; w: number }>()
    for (const id of ids) { const g = groups.get(id)!; totals.set(g, (totals.get(g) ?? 0) + degree.get(id)!) }
    for (const edge of weights.values()) {
      const [a, b] = [groups.get(edge.a)!, groups.get(edge.b)!].sort()
      if (a === b) continue
      const key = JSON.stringify([a, b]), pair = between.get(key) ?? { a, b, w: 0 }
      pair.w += edge.w; between.set(key, pair)
    }
    let best: { a: string; b: string } | undefined, gain = 1e-10
    for (const [, pair] of [...between].sort(([a], [b]) => a.localeCompare(b))) {
      const delta = pair.w / m - totals.get(pair.a)! * totals.get(pair.b)! / (2 * m * m)
      if (delta > gain) { gain = delta; best = pair }
    }
    if (!best) break
    for (const id of ids) if (groups.get(id) === best.b) groups.set(id, best.a)
  }
  return groups
}

export interface LayoutAnchor { x: number; y: number; record: string; group: string; dx: number; dy: number }
/** Record neighborhoods form separate packed regions; descendants orbit their owner.
 * No new graph nodes, relations or user-confirmed themes are created here.
 */
export function readableLayout(graph: GraphScope): Map<string, LayoutAnchor> {
  const records = projectRecords(graph, false), communities = relationshipGroups(records)
  const owner = new Map(graph.nodes.map(n => [n.id, recordOwner(graph, n.id) ?? n.id]))
  const buckets = new Map<string, GraphNode[]>()
  for (const n of [...graph.nodes].sort((a,b) => a.id.localeCompare(b.id))) {
    const id = owner.get(n.id)!; buckets.set(id, [...(buckets.get(id) ?? []), n])
  }
  const blocks = new Map<string, string[]>()
  for (const id of [...buckets.keys()].sort()) {
    const group = communities.get(id) ?? id; blocks.set(group, [...(blocks.get(group) ?? []), id])
  }
  const prepared = [...blocks].map(([group, ids]) => {
    const cells = ids.map(id => ({ id, size: Math.max(250, 130 + 145 * Math.sqrt(buckets.get(id)!.length - 1)) }))
    const columns = Math.ceil(Math.sqrt(cells.length)), width = Math.max(...cells.map(c => c.size))
    const height = cells.every(c => buckets.get(c.id)!.length === 1) ? 120 : width
    return { group, cells, columns, cellSize: width, cellHeight: height, w: columns * width + 70, h: Math.ceil(cells.length / columns) * height + 70 }
  }).sort((a,b) => b.cells.length - a.cells.length || a.group.localeCompare(b.group))
  const rowWidth = Math.max(1, Math.sqrt(prepared.reduce((sum,b) => sum + b.w*b.h,0)) * 1.8)
  const anchors = new Map<string, LayoutAnchor>()
  let x = 0, y = 0, rowHeight = 0
  for (const block of prepared) {
    if (x && x + block.w > rowWidth) { x = 0; y += rowHeight + 50; rowHeight = 0 }
    for (const [i, cell] of block.cells.entries()) {
      const cx = x + 35 + (i % block.columns + .5) * block.cellSize, cy = y + 35 + (Math.floor(i / block.columns) + .5) * block.cellHeight
      let j = 0
      for (const node of buckets.get(cell.id)!) {
        const child = node.id !== cell.id, angle = j * 2.399963
        const radius = child ? 70 * Math.sqrt(++j) : 0
        const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius
        anchors.set(node.id, { x: cx + dx, y: cy + dy, dx, dy, record: cell.id, group: block.group })
      }
    }
    x += block.w + 50; rowHeight = Math.max(rowHeight, block.h)
  }
  // Bounded deterministic slot swaps reduce total squared relationship length.
  // Keep region membership and record footprints intact; this is not a new relation.
  const edges = records.edges.filter(e => e.kind !== 'contains')
  const cost = (subset: GraphEdge[]) => subset.reduce((sum,e) => {
    const a=anchors.get(e.from), b=anchors.get(e.to)
    return !a || !b ? sum : sum + (a.x-b.x)**2 + (a.y-b.y)**2
  },0)
  const swap = (a: string,b: string) => {
    const first=anchors.get(a),second=anchors.get(b)
    if(!first||!second)return
    const dx=second.x-first.x,dy=second.y-first.y
    for(const n of anchors.values())if(n.record===a){n.x+=dx;n.y+=dy}else if(n.record===b){n.x-=dx;n.y-=dy}
  }
  let work=0
  for(let pass=0;pass<3;pass++) {
    let improved=false
    for(const block of prepared)for(let i=0;i<block.cells.length;i++)for(let j=i+1;j<block.cells.length;j++) {
      const a=block.cells[i].id,b=block.cells[j].id
      const affected=edges.filter(e=>e.from===a||e.to===a||e.from===b||e.to===b)
      work+=edges.length+affected.length*2
      if(work>2_000_000)return anchors
      const before=cost(affected)
      swap(a,b);const candidate=cost(affected)
      if(candidate+1e-6<before){improved=true}else swap(a,b)
    }
    if(!improved)break
  }
  return anchors
}
