/** Project explicitly authored cross-collection parents without changing facts.
 * Ambiguous, missing and cyclic parents stay visible as roots for repair. */
export interface HierarchyRecord { section: string; id: string; parent: unknown }
export const hierarchyKey = (record: Pick<HierarchyRecord, 'section' | 'id'>): string => JSON.stringify([record.section, record.id])
export function projectRecordHierarchy(entries: readonly HierarchyRecord[]) {
  const byId = new Map<string, HierarchyRecord[]>()
  for (const entry of entries) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry])
  const parents = new Map<string, string>()
  const issues = new Map<string, 'ambiguous' | 'missing' | 'cycle'>()
  for (const entry of entries) {
    if (typeof entry.parent !== 'string' || !entry.parent) continue
    const key = hierarchyKey(entry), matches = byId.get(entry.parent) ?? []
    if (matches.length !== 1) { issues.set(key, matches.length ? 'ambiguous' : 'missing'); continue }
    parents.set(key, hierarchyKey(matches[0]!))
  }
  for (const entry of entries) {
    const key = hierarchyKey(entry), seen = new Set<string>([key])
    let parent = parents.get(key)
    while (parent) {
      if (seen.has(parent)) { issues.set(key, 'cycle'); break }
      seen.add(parent); parent = parents.get(parent)
    }
  }
  for (const key of issues.keys()) parents.delete(key)
  const children = new Map<string, HierarchyRecord[]>()
  for (const entry of entries) {
    const parent = parents.get(hierarchyKey(entry))
    if (parent) children.set(parent, [...(children.get(parent) ?? []), entry])
  }
  return { parents, children, issues, roots: entries.filter(entry => !parents.has(hierarchyKey(entry))) }
}
