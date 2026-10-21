export interface NavigationLayoutRecord {
  readonly id: string
  readonly parent?: string
  readonly position?: { x: number; y: number }
}
export interface NavigationLayoutGroup {
  readonly target: string
  readonly label?: string
}

export interface NavigationLayoutFrame {
  readonly id: string
  readonly label: string
  readonly members: readonly string[]
  readonly position: { x: number; y: number }
  readonly size: { width: number; height: number }
}

/** Reassign a moved record to the smallest enclosing displayed frame.
 * This returns a complete projection so the caller can materialize all derived
 * frames on the first user edit. No writes happen merely by displaying a map.
 */
export function assignNavigationFrame(frames: readonly NavigationLayoutFrame[], id: string,
  position: { x: number; y: number }, size: { width: number; height: number }): NavigationLayoutFrame[] {
  const center = { x: position.x + size.width / 2, y: position.y + size.height / 2 }
  const containing = frames.filter(frame => center.x >= frame.position.x && center.y >= frame.position.y
    && center.x <= frame.position.x + frame.size.width && center.y <= frame.position.y + frame.size.height)
    .sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height)[0]
  return frames.map(frame => ({ ...frame, position: { ...frame.position }, size: { ...frame.size },
    members: [...frame.members.filter(member => member !== id), ...(frame.id === containing?.id ? [id] : [])],
  }))
}

/** Generic projection of ordered records into inherited, named groups.
 * No canonical mutations: explicit user positions always win. Cycles, missing
 * parents and unreferenced records use the caller's localized fallback labels.
 */
export function navigationGroupedLayout(
  records: readonly NavigationLayoutRecord[],
  memberships: readonly NavigationLayoutGroup[],
  labels: { primary: string; other: string; generic: string },
  spacing = { column: 392, row: 348 },
) {
  const byId = new Map(records.map(record => [record.id, record]))
  const direct = new Map<string, string>()
  for (const item of memberships) {
    if (!byId.has(item.target) || direct.has(item.target)) continue
    direct.set(item.target, item.label?.trim() || labels.primary)
  }
  const groups = new Map<string, { id: string; label: string; members: string[] }>()
  for (const record of records) {
    const seen = new Set<string>()
    let current: NavigationLayoutRecord | undefined = record
    let label = labels.other
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      if (direct.has(current.id)) { label = direct.get(current.id)!; break }
      current = current.parent ? byId.get(current.parent) : undefined
    }
    let group = groups.get(label)
    if (!group) {
      group = { id: `derived-group:${groups.size}`, label, members: [] }
      groups.set(label, group)
    }
    group.members.push(record.id)
  }
  const sections = [...groups.values()]
  if (sections.length === 1 && sections[0]?.label === labels.other) sections[0].label = labels.generic
  const positions = new Map<string, { x: number; y: number }>()
  sections.forEach((section, row) => section.members.forEach((id, column) => {
    const saved = byId.get(id)?.position
    positions.set(id, saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? { ...saved } : { x: column * spacing.column, y: row * spacing.row })
  }))
  return { sections, positions }
}
