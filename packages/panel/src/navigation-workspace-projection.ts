import { projectNavigationMap, moveNavigationNodes, type NavigationMapBinding } from './navigation-map-state.ts'
import { navigationGroupedLayout, assignNavigationFrame } from './navigation-layout.ts'
import { pathGet, pathSet, recordsAtPath } from './record-state.ts'

/** The same read-only frame projection feeds canvas, navigation and inspector.
 * The caller persists it only in an explicit layout edit transaction.
 */
export function projectNavigationWorkspace(state: Record<string, unknown>, binding: NavigationMapBinding,
  frameIdentity: string | undefined, labels: { primary: string; other: string; generic: string }) {
  const map = projectNavigationMap(state, binding)
  const records = recordsAtPath(state, binding.nodes.path)
  const rows = binding.grouping ? pathGet(state, binding.grouping.path) : undefined
  const layout = navigationGroupedLayout(map.nodes.map(node => ({ id: node.id,
    position: node.position as { x: number; y: number } | undefined,
    parent: binding.nodes.parent && typeof records[node.id]?.[binding.nodes.parent] === 'string'
      ? records[node.id]![binding.nodes.parent] as string : undefined,
  })), Array.isArray(rows) ? rows.flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const target = row[binding.grouping!.target], label = row[binding.grouping!.label]
    return typeof target === 'string' ? [{ target, label: typeof label === 'string' ? label : undefined }] : []
  }) : [], labels)
  const automatic = !!binding.grouping && pathGet(state, binding.frames.path) === undefined
  const frames = automatic ? Object.fromEntries(layout.sections.map(section => {
    const points = section.members.map(id => layout.positions.get(id)!)
    const x = Math.min(...points.map(point => point.x)), y = Math.min(...points.map(point => point.y))
    return [section.id, {
      ...(frameIdentity ? { [frameIdentity]: section.id } : {}),
      [binding.frames.label]: section.label, [binding.frames.members]: [...section.members],
      [binding.frames.position]: { x: x - 24, y: y - 48 },
      // A full record card includes its title, entry marker and execution status.
      [binding.frames.size]: { width: Math.max(...points.map(point => point.x)) - x + 320 + 48,
        height: Math.max(...points.map(point => point.y)) - y + 228 + 48 + 24 },
    }]
  })) : recordsAtPath(state, binding.frames.path)
  const displayData = automatic ? pathSet(state, binding.frames.path, frames) : state
  return { displayData, frames, automatic, positions: layout.positions, map: projectNavigationMap(displayData, binding) }
}

export function moveNavigationWorkspaceRecord(state: Record<string, unknown>, binding: NavigationMapBinding,
  projection: ReturnType<typeof projectNavigationWorkspace>, id: string,
  position: { x: number; y: number }, size: { width: number; height: number }) {
  const frames = assignNavigationFrame(projection.map.frames.map(frame => ({ id: frame.id, label: frame.label,
    members: Array.isArray(frame.members) ? frame.members.filter((value): value is string => typeof value === 'string') : [],
    position: frame.position as { x: number; y: number } ?? { x: 0, y: 0 },
    size: frame.size as { width: number; height: number } ?? { width: 500, height: 300 },
  })), id, position, size)
  const saved = Object.fromEntries(frames.map(frame => [frame.id, {
    ...projection.frames[frame.id], [binding.frames.members]: frame.members,
  }]))
  return moveNavigationNodes(state, binding, { [id]: position },
    binding.grouping || pathGet(state, binding.frames.path) !== undefined ? saved : undefined)
}
