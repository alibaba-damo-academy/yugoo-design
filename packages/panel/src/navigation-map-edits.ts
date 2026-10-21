import { editNavigationEdge, moveNavigationNodes, type NavigationMapBinding } from './navigation-map-state.ts'
import { recordsAtPath, pathGet, applyPanelUpdatesToDraft } from './record-state.ts'

/** Consume complete form updates while retaining navigation invalidation semantics. */
export function navigationFormUpdates(state: Record<string, unknown>, binding: NavigationMapBinding, updates: Record<string, unknown>) {
  // Only a real deletion in this transaction authorizes reference cleanup.
  // Existing malformed references remain visible instead of being silently repaired.
  if (Object.hasOwn(updates, binding.nodes.path)) {
    const before = recordsAtPath(state, binding.nodes.path), after = recordsAtPath(updates, binding.nodes.path)
    const removed = new Set(Object.keys(before).filter(id => !Object.hasOwn(after, id)))
    if (removed.size) {
      updates = { ...updates }
      const proposed = applyPanelUpdatesToDraft(state, updates)
      if (binding.nodes.parent) {
        const parent = binding.nodes.parent
        updates[binding.nodes.path] = Object.fromEntries(Object.entries(after).map(([id, record]) => {
          if (!removed.has(String(record[parent]))) return [id, record]
          const copy = { ...record }; delete copy[parent]
          return [id, copy]
        }))
      }
      const edges = recordsAtPath({ ...state, ...updates }, binding.edges.path)
      const deletedEdges = new Set(Object.entries(edges).filter(([, edge]) =>
        removed.has(String(edge[binding.edges.source])) || removed.has(String(edge[binding.edges.target]))).map(([id]) => id))
      updates[binding.edges.path] = Object.fromEntries(Object.entries(edges).filter(([id]) => !deletedEdges.has(id)))
      for (const [path, ids] of [[binding.nodes.order, removed], [binding.edges.order, deletedEdges]] as const) {
        const order = pathGet(updates, path) ?? pathGet(state, path)
        if (Array.isArray(order)) updates[path] = order.filter(id => !ids.has(id))
      }
      // Missing frames mean an automatic view projection, not an empty manual
      // layout. Deleting a record must not silently claim layout ownership.
      if (pathGet(proposed, binding.frames.path) !== undefined) {
        const frames = recordsAtPath(proposed, binding.frames.path)
        updates[binding.frames.path] = Object.fromEntries(Object.entries(frames).map(([id, frame]) => {
          const members = frame[binding.frames.members]
          return [id, Array.isArray(members) ? { ...frame, [binding.frames.members]: members.filter(id => !removed.has(id)) } : frame]
        }))
      }
      if (binding.entry_ids) {
        const entries = pathGet(proposed, binding.entry_ids)
        if (Array.isArray(entries)) updates[binding.entry_ids] = entries.filter(id => !removed.has(id))
      }
      for (const ref of binding.reference_lists ?? []) {
        const rows = pathGet(proposed, ref.path)
        if (Array.isArray(rows)) updates[ref.path] = rows.filter(row => !row || typeof row !== 'object'
          || !removed.has(String(row[ref.target])))
      }
    }
  }
  if (!Object.hasOwn(updates, binding.edges.path)) return updates
  const previous = recordsAtPath(state, binding.edges.path), next = recordsAtPath(updates, binding.edges.path)
  let working = { ...state, ...updates }
  const result = { ...updates }
  for (const [id, edge] of Object.entries(next)) {
    if (!Object.hasOwn(previous, id)) continue
    const patch = Object.fromEntries([binding.edges.source, binding.edges.target, binding.edges.label]
      .filter(key => previous[id]![key] !== edge[key]).map(key => [key, edge[key]]))
    if (!Object.keys(patch).length) continue
    const update = editNavigationEdge({ ...working, [binding.edges.path]: { ...next, [id]: previous[id] } }, binding, id, patch)
    Object.assign(result, update)
    working = { ...working, ...update }
  }
  if (binding.nodes.artifact) {
    const nodes = { ...recordsAtPath(working, binding.nodes.path) }
    let invalidated = false
    for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      if (Object.hasOwn(previous, id) === Object.hasOwn(next, id)) continue
      const edge = previous[id] ?? next[id]!, source = edge[binding.edges.source]
      if (typeof source === 'string' && Object.hasOwn(nodes, source)) {
        nodes[source] = { ...nodes[source], [binding.nodes.artifact]: null }; invalidated = true
      }
    }
    if (invalidated) result[binding.nodes.path] = nodes
  }
  return result
}

/** A frame translation moves precisely its saved members, never unrelated nodes. */
export function translateNavigationFrame(state: Record<string, unknown>, binding: NavigationMapBinding, id: string,
  position: { x: number; y: number }, displayed: Record<string, { x: number; y: number }>, displayedOrigin?: { x: number; y: number }) {
  const frames = recordsAtPath(state, binding.frames.path), frame = frames[id]
  if (!frame) throw Error('Unknown navigation frame')
  const saved = frame[binding.frames.position] as { x: number; y: number } | undefined
  const before = saved === undefined || saved === null ? displayedOrigin : saved
  if (!before || !Number.isFinite(before.x) || !Number.isFinite(before.y)
    || !Number.isFinite(position.x) || !Number.isFinite(position.y)) throw Error('Invalid frame position')
  const members = frame[binding.frames.members]
  if (!Array.isArray(members) || members.some(id => typeof id !== 'string')) throw Error('Invalid frame membership')
  const moves: Record<string, { x: number; y: number }> = {}
  for (const member of members) {
    const current = displayed[member]
    if (!current) throw Error('Missing frame member position')
    moves[member] = { x: current.x + position.x - before.x, y: current.y + position.y - before.y }
  }
  return moveNavigationNodes(state, binding, moves, { ...frames, [id]: { ...frame, [binding.frames.position]: { ...position } } })
}
