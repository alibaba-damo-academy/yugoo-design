import type { ComponentNode } from './dsl.ts'

type Graph = NonNullable<ComponentNode['graph']>
type Records = Record<string, Record<string, unknown>>

/** Preserve row identity and multiplicity, even when two roles reference one object. */
export function relationParticipants(edge: Record<string, unknown>, graph: Graph) {
  const binding = graph.participants
  if (!binding) return []
  const raw = edge[binding.field]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const order = edge[binding.order_field]
  const ids = [...new Set([...(Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && Object.hasOwn(raw, id)) : []), ...Object.keys(raw)])]
  return ids.map(id => {
    const item = (raw as Record<string, unknown>)[id]
    const value = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : {}
    return { id, object: value[binding.reference_field], role: value[binding.role_field] }
  })
}

export function projectParticipantRelations(nodes: Records, relations: Records, graph: Graph) {
  const projectedNodes: Records = {}, projectedEdges: Records = {}
  const owners: Record<string, { section: string; record: string }> = {}
  const objectKey = (id: string) => JSON.stringify([graph.nodes, id])
  const connectable = new Set<string>(), invalid: string[] = []
  for (const [id, value] of Object.entries(nodes)) {
    const key = objectKey(id)
    projectedNodes[key] = { title: value[graph.label_field], kind: value[graph.node_kind_field ?? ''] }
    owners[key] = { section: graph.nodes, record: id }; connectable.add(key)
  }
  for (const [id, value] of Object.entries(relations)) {
    const participants = relationParticipants(value, graph)
    const valid = participants.length >= 2 && participants.every(item => typeof item.object === 'string' && Object.hasOwn(nodes, item.object))
    if (!valid) invalid.push(id)
    const owner = { section: graph.edges, record: id }
    const common = { title: value[graph.label_field], kind: value[graph.edge_kind_field ?? ''], state: value[graph.edge_state_field ?? ''] }
    if (valid && participants.length === 2) {
      const key = JSON.stringify([graph.edges, id, 'binary'])
      projectedEdges[key] = { ...common, source: objectKey(participants[0]!.object as string), target: objectKey(participants[1]!.object as string),
        source_role: participants[0]!.role, target_role: participants[1]!.role }
      owners[key] = owner
    } else {
      const key = JSON.stringify([graph.edges, id])
      projectedNodes[key] = { title: value[graph.label_field], kind: value[graph.edge_kind_field ?? ''] }
      owners[key] = owner
      for (const participant of participants) {
        if (typeof participant.object !== 'string' || !Object.hasOwn(nodes, participant.object)) continue
        const edge = JSON.stringify([graph.edges, id, participant.id])
        projectedEdges[edge] = { title: participant.role ?? '', state: common.state,
          source: objectKey(participant.object), target: key }
        owners[edge] = owner
      }
    }
  }
  return { nodes: projectedNodes, edges: projectedEdges, owners, connectable, invalid }
}

/** Selected relationship kinds form a view, not an inferred ownership model. */
export function hierarchyLinks(nodes: Records, edges: Records, graph: Graph): Array<{ source: string; target: string }> {
  if (graph.participants || !graph.source_field || !graph.target_field || !graph.hierarchy || !graph.edge_kind_field) return []
  return Object.values(edges).flatMap(edge => {
    const source = edge[graph.source_field!], target = edge[graph.target_field!]
    return typeof source === 'string' && typeof target === 'string'
      && Object.hasOwn(nodes, source) && Object.hasOwn(nodes, target)
      && graph.hierarchy!.values.includes(String(edge[graph.edge_kind_field!])) ? [{ source, target }] : []
  })
}

export function relationParents(id: string, nodes: Records, edges: Records, graph: Graph): string[] {
  return [...new Set(hierarchyLinks(nodes, edges, graph).filter(link => link.source === id).map(link => link.target))]
}

export function relationAncestors(id: string, nodes: Records, edges: Records, graph: Graph): string[] {
  const result: string[] = [], seen = new Set([id]), pending = relationParents(id, nodes, edges, graph)
  for (let i = 0; i < pending.length; i++) {
    const parent = pending[i]!
    if (seen.has(parent)) continue
    seen.add(parent); result.push(parent)
    pending.push(...relationParents(parent, nodes, edges, graph))
  }
  return result
}

/** Malformed cycles remain reachable for repair; diamonds keep both parents. */
export function relationRoots(nodes: Records, edges: Records, graph: Graph): string[] {
  const links = hierarchyLinks(nodes, edges, graph), ids = Object.keys(nodes)
  const roots = ids.filter(id => !links.some(link => link.source === id)), reached = new Set<string>()
  const visit = (root: string) => {
    const pending = [root]
    while (pending.length) {
      const current = pending.pop()!
      if (reached.has(current)) continue
      reached.add(current)
      pending.push(...links.filter(link => link.target === current).map(link => link.source))
    }
  }
  roots.forEach(visit)
  for (const id of ids) if (!reached.has(id)) { roots.push(id); visit(id) }
  return roots
}

export function relationHasCycle(id: string, candidate: Record<string, unknown>, edges: Records, graph: Graph): boolean {
  if (graph.participants || !graph.source_field || !graph.target_field || !graph.hierarchy || !graph.edge_kind_field || !graph.hierarchy.values.includes(String(candidate[graph.edge_kind_field]))) return false
  const source = candidate[graph.source_field], target = candidate[graph.target_field]
  if (typeof source !== 'string' || typeof target !== 'string') return false
  const others = { ...edges, [id]: candidate }, pending = [target], seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === source) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of Object.values(others)) if (edge[graph.source_field] === current
      && graph.hierarchy.values.includes(String(edge[graph.edge_kind_field]))
      && typeof edge[graph.target_field] === 'string') pending.push(edge[graph.target_field] as string)
  }
  return false
}

/** Missing endpoint quantities remain missing, even when only one end is known. */
export function reverseRelation(record: Record<string, unknown>, graph: Graph): Record<string, unknown> {
  if (graph.participants || !graph.source_field || !graph.target_field) return { ...record }
  const result = { ...record }
  for (const [left, right] of [[graph.source_field, graph.target_field], ...(graph.reverse?.pairs ?? [])]) {
    delete result[left!]; delete result[right!]
    if (Object.hasOwn(record, left!)) result[right!] = record[left!]
    if (Object.hasOwn(record, right!)) result[left!] = record[right!]
  }
  return result
}
