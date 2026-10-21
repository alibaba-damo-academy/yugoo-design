type Point = { x: number; y: number }

/** Preserve ReactFlow measurement and non-member identity during local animation. */
export function previewNavigationFrameMembers<T extends { data: { section?: unknown; record?: unknown }; position: Point }>(
  nodes: readonly T[], section: string, positions: Readonly<Record<string, Point>>,
): T[] {
  return nodes.map(node => {
    const id = node.data.record
    if (node.data.section !== section || typeof id !== 'string' || !Object.hasOwn(positions, id)) return node
    return { ...node, position: positions[id]! }
  })
}

/** A gesture always derives from its start, never from the previous animation frame. */
export function navigationFrameDragPositions(origin: Point, current: Point, starts: Readonly<Record<string, Point>>): Record<string, Point> {
  if (![origin.x, origin.y, current.x, current.y].every(Number.isFinite)) throw Error('Invalid frame drag position')
  return Object.fromEntries(Object.entries(starts).map(([id, position]) => {
    if (![position.x, position.y].every(Number.isFinite)) throw Error('Invalid frame member position')
    return [id, { x: position.x + current.x - origin.x, y: position.y + current.y - origin.y }]
  }))
}
