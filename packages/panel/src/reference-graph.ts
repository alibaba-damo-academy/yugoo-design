import type { ComponentNode } from './dsl.ts'
import type { RecordMap } from './visual-records.ts'

type ReferenceNode = NonNullable<ComponentNode['references']>['nodes'][number]

/** A declared root label is a read-only projection, never a nested field alias. */
export function referenceRecordLabel(node: ReferenceNode, record: string, value: Record<string, unknown>,
  readRecord?: (section: string) => RecordMap): string {
  const raw = node.label_scope === 'record' ? readRecord?.(node.source)[record]?.[node.label_field] : value[node.label_field]
  return typeof raw === 'string' && raw.trim() !== '' ? raw : record
}

/** Resolve only explicitly declared collections, preserving same-ID ambiguity. */
export function referenceMatches(sections: readonly string[], id: string, read: (section: string) => RecordMap): string[] {
  return sections.filter(section => Object.hasOwn(read(section), id))
}

export const referenceNodeKey = (section: string, record: string): string => JSON.stringify([section, record])

/** Disposable view, never an editable Design File or a second relation authority. */
export function projectReferenceGraph(bindings: NonNullable<ComponentNode['references']>,
  read: (section: string) => RecordMap, title: (section: string) => string, readRecord?: (section: string) => RecordMap) {
  const nodes: RecordMap = {}, edges: RecordMap = {}
  const owners: Record<string, { section: string; record: string }> = {}
  const missing: Array<{ section: string; record: string; field: string; target: string; targets: readonly string[]; id: string; reason: 'missing' | 'ambiguous' }> = []
  for (const node of bindings.nodes) for (const [record, value] of Object.entries(read(node.source))) {
    const key = referenceNodeKey(node.source, record)
    nodes[key] = { name: referenceRecordLabel(node, record, value, readRecord), kind: title(node.source) }
    owners[key] = { section: node.source, record }
  }
  for (const link of bindings.links) for (const [record, value] of Object.entries(read(link.source))) {
    const raw = value[link.field]
    const ids = link.item_field === undefined ? (Array.isArray(raw) ? raw : raw === undefined || raw === '' ? [] : [raw])
      : raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.values(raw).map(item => item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)[link.item_field!] : undefined).filter(id => id !== undefined && id !== '') : []
    for (const id of new Set(ids)) {
      if (typeof id !== 'string') continue
      const targets = link.targets ?? [link.target!]
      const matches = referenceMatches(targets, id, read)
      if (matches.length !== 1) { missing.push({ section: link.source, record, field: link.field,
        target: link.target ?? targets.join(', '), targets, id, reason: matches.length ? 'ambiguous' : 'missing' }); continue }
      const from = referenceNodeKey(link.source, record), to = referenceNodeKey(matches[0]!, id)
      const key = JSON.stringify([link.source, record, link.field, id])
      edges[key] = { name: link.label ?? '', source: link.reverse ? to : from, target: link.reverse ? from : to }
      owners[key] = { section: link.source, record }
    }
  }
  return { nodes, edges, owners, missing }
}
