import type { ComponentNode, EditorField } from './dsl.ts'
import type { RecordMap } from './visual-records.ts'
import { fieldIsVisible, fieldDisplayLabel } from './record-state.ts'
import { projectReferenceGraph, referenceNodeKey, referenceRecordLabel } from './reference-graph.ts'

type Bindings = NonNullable<ComponentNode['references']>
type Zone = 'center' | 'top' | 'bottom' | 'left' | 'right'
export interface HubNode {
  id: string; section: string; record: string; zone: Zone; name: string; description: string
  value: string; captions: Array<{ record: string; title: string; description: string }>
  x: number; y: number; width: number; height: number
  /** A transient resource list, never an owner or a new canonical record. */
  members?: HubNode[]
}
export interface HubGroup {
  id: string; label: string; x: number; y: number; width: number; height: number
  role?: HubNode
  columns?: Array<{ zone: 'left' | 'center' | 'right'; x: number; y: number }>
}
export const HUB_NODE_WIDTH = 248
const text = (value: unknown) => typeof value === 'string' ? value : ''
const lines = (value: string, width: number) => Math.max(1, Math.ceil([...value].reduce((sum, char) =>
  sum + (/[^\u0000-\u007f]/u.test(char) ? 14 : 7.5), 0) / width))

/** Read-only compact facts use the original form's labels, options and visibility.
 * They are not a new record, validation surface or hidden schema normalization. */
export function hubRecordFacts(fields: readonly EditorField[], values: Record<string, unknown>,
  excluded: readonly string[], name: (section: string, record: string) => string) {
  return fields.flatMap(field => {
    if (excluded.includes(field.key) || !fieldIsVisible(field, values)) return []
    const raw = values[field.key]
    const label = (value: unknown) => {
      if (value === undefined || value === null || value === '') return ''
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return ''
      return field.options_from_section ? name(field.options_from_section, String(value))
        : field.options?.find(option => option.value === String(value))?.label ?? String(value)
    }
    const value = Array.isArray(raw) ? raw.map(label).filter(Boolean).join(' · ') : label(raw)
    return value ? [{ key: field.key, label: fieldDisplayLabel(field, values), value }] : []
  })
}

/** Transient layout. Identities and edges come solely from declared references.
 * A shared label or equal prose never makes two records the same resource. */
export function referenceHubProjection(bindings: Bindings, read: (source: string) => RecordMap,
  title: (source: string) => string, focus?: string, readRecord?: (source: string) => RecordMap) {
  const layout = bindings.layout!
  const base = projectReferenceGraph(bindings, read, title, readRecord)
  const centers = read(layout.center)
  const activeFocus = focus && Object.hasOwn(centers, focus) ? focus : undefined
  const portraits = layout.center_presentation === 'portrait'
  const focusKey = activeFocus && referenceNodeKey(layout.center, activeFocus)
  const zoneOf = (source: string): Zone => (['center', 'top', 'bottom', 'left', 'right'] as const)
    .find(zone => layout[zone] === source) ?? 'center'
  const all: HubNode[] = bindings.nodes.flatMap(binding => Object.entries(read(binding.source)).map(([record, value]) => {
    const zone = zoneOf(binding.source)
    const entries = zone === 'center' && layout.entries ? value[layout.entries.field] : undefined
    const captions = entries && typeof entries === 'object' && !Array.isArray(entries)
      ? Object.entries(entries).flatMap(([key, row]) => row && typeof row === 'object' && !Array.isArray(row)
        ? [{ record: key, title: text((row as Record<string, unknown>)[layout.entries!.title_field]),
          description: text((row as Record<string, unknown>)[layout.entries!.description_field]) }] : []) : []
    const name = referenceRecordLabel(binding, record, value, readRecord)
    const description = binding.description_field ? text(value[binding.description_field]) : ''
    const model = zone === 'center' && layout.value_field ? text(value[layout.value_field]) : ''
    // Match the actual 14px title/description and 12px caption wrapping below.
    const heading = activeFocus && zone === 'center' ? model || name : name
    // Reserve the icon, gap and border before estimating a wrapping title.
    // A 168px estimate can miss a second CJK line in the actual resource card.
    const headingHeight = Math.max(zone === 'center' && portraits ? 48 : 38,
      Math.min(4, lines(heading, portraits ? 152 : 168)) * 20 + 20)
    const descriptionHeight = description ? Math.min(3, lines(description, 216)) * 20 + 8 : 0
    const height = portraits && activeFocus && zone === 'center'
      ? 112 + Math.min(4, lines(heading, 216)) * 20
      : portraits ? 42 + headingHeight + (activeFocus ? 0 : descriptionHeight) + (zone === 'center' ? 100 : 30)
        : 48 + Math.min(4, lines(heading, 168)) * 20 + descriptionHeight + (zone === 'center' ? 100 : 32) + (binding.kind_field ? 24 : 0)
    return { id: referenceNodeKey(binding.source, record), section: binding.source, record, zone, name,
      description, value: model, captions, x: 0, y: 0, width: HUB_NODE_WIDTH, height }
  }))
  const allEdges = Object.entries(base.edges).map(([id, edge]) => ({ id, source: String(edge.source), target: String(edge.target), label: String(edge.name ?? '') }))
  const related = new Set(focusKey ? allEdges.filter(edge => edge.source === focusKey || edge.target === focusKey)
    .flatMap(edge => [edge.source, edge.target]) : [])
  let nodes = all.filter(node => activeFocus
    ? node.id === focusKey || (node.zone !== 'center' && related.has(node.id))
    : !['left', 'right'].includes(node.zone))
  const aggregateOf = new Map<string, string>()
  if (portraits && activeFocus) {
    for (const zone of ['left', 'right'] as const) {
      const members = nodes.filter(node => node.zone === zone)
      if (!members.length) continue
      const id = `resource-group:${focusKey}:${zone}`
      for (const member of members) aggregateOf.set(member.id, id)
      // Bound the resource band's height. Large lists scroll inside this one
      // card; individual identities and their complete forms stay reachable.
      const listHeight = Math.min(192, members.reduce((sum, member) =>
        sum + Math.min(2, lines(member.name, 176)) * 20 + 18 + (member.description ? 22 : 0), 0)
        + Math.max(0, members.length - 1) * 8)
      const group: HubNode = { id, section: members[0].section, record: '', zone,
        name: title(members[0].section), description: '', value: '', captions: [],
        x: 0, y: 0, width: HUB_NODE_WIDTH, height: 76 + listHeight, members }
      nodes = [...nodes.filter(node => node.zone !== zone), group]
    }
  }
  const groups: HubGroup[] = []
  if (activeFocus) {
    const center = nodes.find(node => node.id === focusKey)!
    center.x = 380
    const sideGap = portraits ? 24 : 48
    const columnHeight = (zone: Zone) => {
      const members = nodes.filter(node => node.zone === zone)
      return members.reduce((sum, member) => sum + member.height, 0) + Math.max(0, members.length - 1) * sideGap
    }
    // The original anatomy has a common horizontal centre: hands flank the
    // brain. Multiple real resources form balanced columns around that axis,
    // not lists starting at the brain's top edge. Non-portrait hubs stay intact.
    const bandHeight = Math.max(center.height, columnHeight('left'), columnHeight('right'))
    const bandTop = Math.max(portraits ? 210 : 260, ...nodes.filter(node => node.zone === 'top').map(node => 36 + node.height + (portraits ? 88 : 100)))
    center.y = bandTop + (portraits ? (bandHeight - center.height) / 2 : 0)
    for (const zone of ['top', 'bottom', 'left', 'right'] as const) {
      const members = nodes.filter(node => node.zone === zone)
      let cursor = 0
      for (const member of members) {
        if (zone === 'top' || zone === 'bottom') {
          member.x = center.x + (center.width - (members.length * (HUB_NODE_WIDTH + 56) - 56)) / 2 + cursor
          member.y = zone === 'top' ? 36 : center.y + center.height + 120
          cursor += HUB_NODE_WIDTH + 56
        } else {
          member.x = zone === 'left' ? 32 : center.x + center.width + 100
          member.y = portraits ? bandTop + (bandHeight - columnHeight(zone)) / 2 + cursor : center.y + cursor
          cursor += member.height + sideGap
        }
      }
    }
    // Long side lists must never overlap the bottom band.
    const sideBottom = Math.max(center.y + center.height, ...nodes.filter(node => ['left', 'right'].includes(node.zone)).map(node => node.y + node.height))
    for (const node of nodes.filter(node => node.zone === 'bottom')) node.y = sideBottom + (portraits ? 56 : 120)
    if (portraits) {
      for (const node of nodes) node.y += 120
      const left = Math.min(...nodes.map(node => node.x)) - 32
      const right = Math.max(...nodes.map(node => node.x + node.width)) + 32
      groups.push({ id: `role:${center.id}`, label: center.name, role: center,
        x: left, y: 0, width: right - left, height: Math.max(...nodes.map(node => node.y + node.height)) + 24,
        columns: (['left', 'center', 'right'] as const).flatMap(zone => {
          const member = nodes.find(node => node.zone === zone)
          return member ? [{ zone, x: member.x + member.width / 2 - left, y: bandTop + 120 - 32 }] : []
        }) })
    }
  } else {
    const top = nodes.filter(node => node.zone === 'top')
    const collaborationCount = allEdges.filter(edge => base.owners[edge.source]?.section === layout.center && base.owners[edge.target]?.section === layout.center).length
    const centerY = Math.max(200, ...top.map(node => node.height + 80)) + collaborationCount * 32
    const buckets = new Map<string, HubNode[]>()
    for (const node of nodes.filter(node => node.zone === 'center')) {
      const ref = layout.group_by ? centers[node.record]?.[layout.group_by] : undefined
      const source = typeof ref === 'string' && top.find(node => node.record === ref)
      // Unknown entries are NOT shared identities, even if their text matches.
      const key = source ? source.id : `unresolved:${node.id}`
      buckets.set(key, [...(buckets.get(key) ?? []), node])
    }
    let cursor = 32
    for (const [id, members] of buckets) {
      const width = members.length * (HUB_NODE_WIDTH + 48) + 16
      const source = top.find(node => node.id === id)
      if (source) { source.x = cursor + (width - source.width) / 2; source.y = 24 }
      const height = Math.max(...members.map(node => node.height)) + 64
      groups.push({ id, label: source?.name ?? '', x: cursor, y: centerY - 36, width, height })
      members.forEach((node, index) => { node.x = cursor + 32 + index * (HUB_NODE_WIDTH + 48); node.y = centerY })
      cursor += width + 48
    }
    for (const node of top.filter(node => !buckets.has(node.id))) { node.x = cursor; node.y = 24; cursor += node.width + 48 }
    const bottom = nodes.filter(node => node.zone === 'bottom')
    const bottomY = Math.max(centerY, ...nodes.filter(node => node.zone === 'center').map(node => node.y + node.height)) + 140
    const bottomWidth = bottom.length * (HUB_NODE_WIDTH + 56) - 56
    bottom.forEach((node, index) => { node.x = Math.max(32, (cursor - bottomWidth) / 2) + index * (HUB_NODE_WIDTH + 56); node.y = bottomY })
  }
  // Focus may be wider than the center's initial position; translate as one view.
  const minX = Math.min(0, ...nodes.map(node => node.x - 24))
  if (minX < 0) {
    nodes = nodes.map(node => ({ ...node, x: node.x - minX }))
    for (const group of groups) group.x -= minX
  }
  const visible = new Set(nodes.map(node => node.id))
  const edgeGroups = new Map<string, { id: string; source: string; target: string; label: string; referenceIds: string[] }>()
  for (const edge of allEdges) {
    const source = aggregateOf.get(edge.source) ?? edge.source
    const target = aggregateOf.get(edge.target) ?? edge.target
    if (!visible.has(source) || !visible.has(target)) continue
    const grouped = source !== edge.source || target !== edge.target
    const id = grouped ? JSON.stringify(['resource-link', source, target]) : edge.id
    const existing = edgeGroups.get(id)
    if (existing) existing.referenceIds.push(edge.id)
    else edgeGroups.set(id, { ...edge, id, source, target, referenceIds: [edge.id] })
  }
  const edges = [...edgeGroups.values()]
  return { ...base, nodes, edges, groups, all, allEdges, focus: activeFocus }
}
