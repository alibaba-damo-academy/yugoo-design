/** Canonical relationship vocabulary and presentation-only graph helpers. */
export type BusinessMultiplicity = '1' | '0..1' | '1..*' | '0..*'
export interface BusinessRelation {
  id: string
  kind: 'association' | 'generalization'
  name: string
  source: string
  target: string
  description?: string
  source_count?: BusinessMultiplicity
  target_count?: BusinessMultiplicity
}
export const BUSINESS_MULTIPLICITIES: readonly [BusinessMultiplicity, string][] = [
  ['1', '必须且仅一个'], ['0..1', '可以没有，最多一个'],
  ['1..*', '至少一个，可有多个'], ['0..*', '可以没有，也可有多个'],
]
export function businessQuantityLabel(value: BusinessMultiplicity | undefined): string {
  return BUSINESS_MULTIPLICITIES.find(([key]) => key === value)?.[1] ?? '尚未确定'
}
export function businessQuantityShort(value: BusinessMultiplicity | undefined): string {
  return value === '1' ? '仅一个' : value === '0..1' ? '可选一个' : value === '1..*' ? '至少一个' : value === '0..*' ? '可有多个' : '数量待定'
}

type CanvasPoint = {x: number; y: number}
type CanvasSide = 'left' | 'right' | 'top' | 'bottom'

/** Pick presentation ports from the current node geometry; dragging changes routing, not the relation. */
export function businessEdgePorts(source: CanvasPoint, target: CanvasPoint): {sourceHandle: `source-${CanvasSide}`; targetHandle: `source-${CanvasSide}`} {
  const dx = target.x - source.x, dy = target.y - source.y
  if (dx === 0 && dy === 0) return {sourceHandle: 'source-right', targetHandle: 'source-bottom'}
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0
    ? {sourceHandle: 'source-right', targetHandle: 'source-left'}
    : {sourceHandle: 'source-left', targetHandle: 'source-right'}
  return dy >= 0
    ? {sourceHandle: 'source-bottom', targetHandle: 'source-top'}
    : {sourceHandle: 'source-top', targetHandle: 'source-bottom'}
}

/** Keep endpoint quantities attached to their objects when reversing direction. */
export function reverseBusinessRelation(relation: BusinessRelation): BusinessRelation {
  const {source_count, target_count, ...rest} = relation
  return {...rest, source:relation.target, target:relation.source,
    ...(target_count !== undefined ? {source_count:target_count} : {}),
    ...(source_count !== undefined ? {target_count:source_count} : {})}
}

/** Reject a prospective inherited cycle without imposing single-parent ownership. */
export function businessRelationIssue(relation: BusinessRelation, relations: readonly BusinessRelation[], objectIds: readonly string[], requireName = true): string | undefined {
  if (!objectIds.includes(relation.source) || !objectIds.includes(relation.target)) return '请选择当前已有的两个业务对象。'
  if (requireName && !relation.name.trim()) return '请填写用户能理解的关系名称。'
  if (relation.kind !== 'generalization') return undefined
  const parents = new Map<string, string[]>()
  for (const item of [...relations.filter(item => item.id !== relation.id), relation]) {
    if (item.kind === 'generalization') parents.set(item.source, [...(parents.get(item.source) ?? []), item.target])
  }
  const pending = [relation.target], seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === relation.source) return '这条继承会形成循环：一个类型不能是自己的父类型。'
    if (!seen.has(current)) {seen.add(current);pending.push(...(parents.get(current) ?? []))}
  }
  return undefined
}

/** Presentation roots; every type remains accessible even for a malformed input. */
export function businessTreeRoots(ids: readonly string[], relations: readonly BusinessRelation[]): string[] {
  const links = relations.filter(r => r.kind === 'generalization' && ids.includes(r.source) && ids.includes(r.target))
  const roots = ids.filter(id => !links.some(r => r.source === id)), reached = new Set<string>()
  const visit = (id: string) => {
    if (reached.has(id)) return
    reached.add(id); links.filter(r => r.target === id).forEach(r => visit(r.source))
  }
  roots.forEach(visit)
  for (const id of ids) if (!reached.has(id)) {roots.push(id);visit(id)}
  return roots
}

/**
 * Initial canvas column per object: longest-path layering over the relation graph
 * AFTER cycle contraction, so a self-association or an association cycle can never
 * push columns outward. Presentation-only, driven purely by relation shape.
 */
export function businessLayoutColumns(ids: readonly string[], relations: readonly BusinessRelation[]): Record<string, number> {
  const edges = relations.filter(r => r.source !== r.target && ids.includes(r.source) && ids.includes(r.target))
  const adjacency = new Map<string, string[]>(ids.map(id => [id, []]))
  for (const r of edges) adjacency.get(r.source)!.push(r.target)
  const component = new Map<string, number>()
  const index = new Map<string, number>(), low = new Map<string, number>()
  const stack: string[] = [], onStack = new Set<string>()
  let stamp = 0, components = 0
  for (const root of ids) {
    if (index.has(root)) continue
    index.set(root, stamp); low.set(root, stamp); stamp += 1; stack.push(root); onStack.add(root)
    const frames = [{id: root, child: 0}]
    while (frames.length) {
      const frame = frames[frames.length - 1]
      const children = adjacency.get(frame.id) ?? []
      if (frame.child < children.length) {
        const next = children[frame.child]
        frame.child += 1
        if (!index.has(next)) {
          index.set(next, stamp); low.set(next, stamp); stamp += 1; stack.push(next); onStack.add(next)
          frames.push({id: next, child: 0})
        } else if (onStack.has(next)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(next)!))
        }
        continue
      }
      frames.pop()
      if (frames.length) low.set(frames[frames.length - 1].id, Math.min(low.get(frames[frames.length - 1].id)!, low.get(frame.id)!))
      if (low.get(frame.id) === index.get(frame.id)) {
        for (;;) {
          const member = stack.pop()!
          onStack.delete(member)
          component.set(member, components)
          if (member === frame.id) break
        }
        components += 1
      }
    }
  }
  const componentEdges: [number, number][] = []
  for (const r of edges) {
    const from = component.get(r.source)!, to = component.get(r.target)!
    if (from !== to) componentEdges.push([from, to])
  }
  const layer = new Map<number, number>(Array.from({length: components}, (_, i) => [i, 0]))
  for (let pass = 0; pass < components; pass += 1) {
    let changed = false
    for (const [from, to] of componentEdges) {
      const next = (layer.get(from) ?? 0) + 1
      if (next > (layer.get(to) ?? 0)) {layer.set(to, next); changed = true}
    }
    if (!changed) break
  }
  return Object.fromEntries(ids.map(id => [id, layer.get(component.get(id)!) ?? 0]))
}

const CANVAS_COLUMN_GAP = 370, CANVAS_ROW_GAP = 200

/** Initial canvas positions: one column per layout layer, stacked inside the column. */
export function businessLayoutPositions(ids: readonly string[], relations: readonly BusinessRelation[]): Record<string, CanvasPoint> {
  const columns = businessLayoutColumns(ids, relations)
  const rows = new Map<number, number>()
  return Object.fromEntries(ids.map(id => {
    const column = columns[id] ?? 0
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)
    return [id, {x: column * CANVAS_COLUMN_GAP, y: row * CANVAS_ROW_GAP}]
  }))
}

/** Minimal shape a canvas node must expose to be reconciled. */
export interface BusinessCanvasNode {
  id: string
  position: CanvasPoint
  data?: Record<string, unknown>
  selected?: boolean
}

/** Owned by the canvas: drag results and library measurements are never overwritten by a re-render. */
const CANVAS_OWNED_KEYS = new Set(['position', 'measured', 'internals'])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

function sameRecord(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const keys = Object.keys(right)
  return keys.length === Object.keys(left).length && keys.every(key => left[key] === right[key])
}

function sameNode(left: BusinessCanvasNode, right: BusinessCanvasNode): boolean {
  if (left === right) return true
  const before = left as unknown as Record<string, unknown>, after = right as unknown as Record<string, unknown>
  return Object.keys(after).every(key => {
    if (CANVAS_OWNED_KEYS.has(key)) return true
    if (before[key] === after[key]) return true
    if (key !== 'data') return false
    const leftData = asRecord(before[key]), rightData = asRecord(after[key])
    return leftData !== undefined && rightData !== undefined && sameRecord(leftData, rightData)
  })
}

/**
 * Reconcile desired canvas nodes onto the previous ones. Reusing an unchanged node
 * object is what keeps React Flow's measurement and handle bounds alive; dropping it
 * hides nodes and erases every edge. Returns the previous array untouched when
 * nothing but canvas-owned state differs, so callers never churn state.
 */
export function reconcileBusinessNodes<TNode extends BusinessCanvasNode>(previous: readonly TNode[], desired: readonly TNode[], relations: readonly BusinessRelation[]): TNode[] {
  const existing = new Map(previous.map(node => [node.id, node]))
  const layout = businessLayoutPositions(desired.map(node => node.id), relations)
  let changed = previous.length !== desired.length
  const next = desired.map(node => {
    const kept = existing.get(node.id)
    if (!kept) {changed = true; return {...node, position: layout[node.id] ?? node.position} as TNode}
    if (sameNode(kept, node)) return kept
    changed = true
    return {...kept, ...node, position: kept.position} as TNode
  })
  return changed ? next : previous as TNode[]
}

/** Direct parent types of one object via generalization, in declaration-stable order. Cycle-guarded. */
export function businessParents(id: string, relations: readonly BusinessRelation[], ids: readonly string[]): string[] {
  const seen = new Set<string>()
  return relations
    .filter(r => r.kind === 'generalization' && r.source === id && ids.includes(r.target) && !seen.has(r.target) && (seen.add(r.target), true))
    .map(r => r.target)
}

/** Ancestor chain (parents, then grandparents…) for revealing parent branches. Cycle-guarded. */
export function businessAncestors(id: string, relations: readonly BusinessRelation[], ids: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  let frontier = businessParents(id, relations, ids)
  while (frontier.length) {
    const next: string[] = []
    for (const parent of frontier) {
      if (seen.has(parent)) continue
      seen.add(parent); out.push(parent)
      next.push(...businessParents(parent, relations, ids))
    }
    frontier = next
  }
  return out
}

/** Plain-language summary of one relation in both directions; unknown quantities stay undecided. */
export function businessRelationSentence(relation: BusinessRelation, nameOf: (id: string) => string): string {
  const source = nameOf(relation.source), target = nameOf(relation.target)
  if (relation.kind === 'generalization') return `${source}是一种${target}，沿用父类型的定义与信息`
  return `每个${source}关联${target}：${businessQuantityLabel(relation.target_count)}；每个${target}关联${source}：${businessQuantityLabel(relation.source_count)}`
}

/**
 * Parent-branch presentation groups. Direct parents and higher ancestors are kept
 * SEPARATE and unchained: a multi-parent diamond must never render siblings as a
 * single inheritance path.
 */
export function businessParentBranch(id: string, relations: readonly BusinessRelation[], ids: readonly string[]): {parents: string[]; higher: string[]} {
  const parents = businessParents(id, relations, ids)
  const higher = businessAncestors(id, relations, ids).filter(a => !parents.includes(a))
  return {parents, higher}
}
