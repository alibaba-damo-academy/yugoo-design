import { pathGet, recordsAtPath } from './record-state.ts'
import type { ComponentNode } from './dsl.ts'
import { validatePreviewNavigationContext } from './preview-navigation-context.ts'
import type { PreviewLink } from './preview-navigation.ts'

/** Declarative navigation diagrams keep their canonical fields and independent labels. */
export type NavigationMapBinding = NonNullable<ComponentNode['navigation_map']>
type RecordValue = Record<string, unknown>
type Point = { x: number; y: number }

function ordered(state: RecordValue, path: string, order: string) {
  const records = recordsAtPath(state, path), preferred = pathGet(state, order)
  const ids = [...new Set([...(Array.isArray(preferred) ? preferred.filter((id): id is string => typeof id === 'string' && Object.hasOwn(records, id)) : []), ...Object.keys(records)])]
  return ids.map(id => ({ id, record: records[id]! }))
}

export function projectNavigationMap(state: RecordValue, binding: NavigationMapBinding) {
  const nodes = ordered(state, binding.nodes.path, binding.nodes.order).map(({ id, record }) => ({
    id, label: String(record[binding.nodes.label] ?? id), position: record[binding.nodes.position],
  }))
  const ids = new Set(nodes.map(node => node.id))
  const edges = ordered(state, binding.edges.path, binding.edges.order).map(({ id, record }) => ({
    id, label: String(record[binding.edges.label] ?? ''), source: String(record[binding.edges.source] ?? ''), target: String(record[binding.edges.target] ?? ''),
  }))
  const frames = Object.entries(recordsAtPath(state, binding.frames.path)).map(([id, record]) => ({
    id, label: String(record[binding.frames.label] ?? id), members: record[binding.frames.members],
    position: record[binding.frames.position], size: record[binding.frames.size],
  }))
  return { nodes, edges, frames, invalidEdges: edges.filter(edge => !ids.has(edge.source) || !ids.has(edge.target)).map(edge => edge.id) }
}

/** Only explicit, live source/target bindings become executable preview links. */
export function navigationPreviewLinks(state: RecordValue, binding: NavigationMapBinding, source: string): PreviewLink[] {
  if (!binding.edges.hotspot) return []
  const nodes = recordsAtPath(state, binding.nodes.path)
  if (!Object.hasOwn(nodes, source)) return []
  return ordered(state, binding.edges.path, binding.edges.order).flatMap(({ id, record }) => {
    const target = record[binding.edges.target], element = record[binding.edges.hotspot!]
    if (record[binding.edges.source] !== source || typeof target !== 'string' || !Object.hasOwn(nodes, target)
      || typeof element !== 'string' || !element.trim()) return []
    const link: PreviewLink = { id, target, element }
    if (binding.edges.context && Object.hasOwn(record, binding.edges.context)) {
      try { link.context = validatePreviewNavigationContext(record[binding.edges.context]) }
      catch (failure) { link.contextError = `${id}: ${String(failure)}` }
    }
    return [link]
  })
}

/** Bind against the currently displayed source, not a stale selected edge. */
/** Remove only the declared hotspot fields, preserving the navigation edge. */
export function unbindNavigationHotspot(state: RecordValue, binding: NavigationMapBinding, edgeId: string): RecordValue {
  const edges = recordsAtPath(state, binding.edges.path)
  const edge = edges[edgeId]
  if (!binding.edges.hotspot || !edge) throw Error('Invalid or stale hotspot binding')
  const next = { ...edge }
  delete next[binding.edges.hotspot]
  if (binding.edges.hotspot_label) delete next[binding.edges.hotspot_label]
  return { [binding.edges.path]: { ...edges, [edgeId]: next } }
}

export function bindNavigationHotspot(state: RecordValue, binding: NavigationMapBinding, source: string,
  edgeId: string, element: string, label: string) {
  const edges = recordsAtPath(state, binding.edges.path), nodes = recordsAtPath(state, binding.nodes.path)
  const edge = edges[edgeId]
  if (!binding.edges.hotspot || !edge || edge[binding.edges.source] !== source || !Object.hasOwn(nodes, source)
    || typeof edge[binding.edges.target] !== 'string' || !Object.hasOwn(nodes, edge[binding.edges.target] as string)
    || !element.trim() || element.length > 512 || label.length > 512) throw Error('Invalid or stale hotspot binding')
  if (Object.entries(edges).some(([id, candidate]) => id !== edgeId && candidate[binding.edges.source] === source
    && candidate[binding.edges.hotspot!] === element)) throw Error('Hotspot already belongs to another navigation edge')
  return { [binding.edges.path]: { ...edges, [edgeId]: { ...edge, [binding.edges.hotspot]: element,
    ...(binding.edges.hotspot_label ? { [binding.edges.hotspot_label]: label } : {}) } } }
}

/** Geometry-only transactions must not invalidate accepted HTML or mutate input. */
export function moveNavigationNodes(state: RecordValue, binding: NavigationMapBinding, moves: Record<string, Point>, frames?: Record<string, RecordValue>) {
  const original = recordsAtPath(state, binding.nodes.path), nodes = { ...original }
  for (const [id, point] of Object.entries(moves)) {
    if (!Object.hasOwn(original, id)) throw new Error(`Unknown navigation node: ${id}`)
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid navigation position')
    nodes[id] = { ...original[id], [binding.nodes.position]: { x: point.x, y: point.y } }
  }
  return { [binding.nodes.path]: nodes, ...(frames === undefined ? {} : { [binding.frames.path]: structuredClone(frames) }) }
}

/** Edit an existing jump; only old/new source artifacts become stale. */
export function editNavigationEdge(state: RecordValue, binding: NavigationMapBinding, id: string, patch: RecordValue) {
  const edges = recordsAtPath(state, binding.edges.path), nodes = recordsAtPath(state, binding.nodes.path)
  if (!Object.hasOwn(edges, id)) throw new Error(`Unknown navigation edge: ${id}`)
  const allowed = [binding.edges.source, binding.edges.target, binding.edges.label]
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error('Unsupported navigation edit')
  const previous = edges[id]!, next = { ...previous, ...patch }
  for (const field of [binding.edges.source, binding.edges.target]) {
    if (typeof next[field] !== 'string' || !Object.hasOwn(nodes, next[field] as string)) throw new Error('Unknown navigation endpoint')
  }
  const updates: RecordValue = { [binding.edges.path]: { ...edges, [id]: next } }
  if (binding.nodes.artifact && allowed.some(field => next[field] !== previous[field])) {
    const changed = { ...nodes }
    for (const source of new Set([previous[binding.edges.source], next[binding.edges.source]])) {
      if (typeof source === 'string' && Object.hasOwn(nodes, source)) changed[source] = { ...nodes[source], [binding.nodes.artifact]: null }
    }
    updates[binding.nodes.path] = changed
  }
  return updates
}
