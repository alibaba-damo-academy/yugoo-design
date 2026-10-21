import type { ComponentNode, PanelManifest } from './dsl.ts'
import { fieldValuesOf, pathGet, recordsAtPath, sectionBindingOf, type DesignData } from './record-state.ts'

type Inspector = NonNullable<NonNullable<ComponentNode['diagram']>['inspector']>
export type DiagramRecordGroup = Inspector['nodes'] | NonNullable<Inspector['related']>[number]

/** Projection only: preserve canonical maps, order and parent-scoped identities. */
export function diagramRecords(manifest: PanelManifest, data: DesignData, source: string) {
  const binding = sectionBindingOf(manifest, source), records = recordsAtPath(data, binding.recordsPath)
  const order = binding.orderPath ? pathGet(data, binding.orderPath) : undefined
  const ids = [...new Set([...(Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && Object.hasOwn(records, id)) : []), ...Object.keys(records)])]
  return ids.map(id => ({ id, record: records[id]!, values: fieldValuesOf(records[id]!, binding.fieldsPath) }))
}
export function diagramRecordProcess(manifest: PanelManifest, data: DesignData, group: DiagramRecordGroup, values: Record<string, unknown>, nodes?: Inspector['nodes']) {
  const direct = values[group.process_field]
  if (typeof direct === 'string' && direct) return direct
  if (!nodes || !('node_field' in group) || !group.node_field) return undefined
  const parent = diagramRecords(manifest, data, nodes.source).find(item => item.id === values[group.node_field!])
  return parent?.values[nodes.process_field]
}
export function diagramContextRecords(manifest: PanelManifest, data: DesignData, group: DiagramRecordGroup, process: string, node?: string, nodes?: Inspector['nodes']) {
  return diagramRecords(manifest, data, group.source).filter(item => diagramRecordProcess(manifest, data, group, item.values, nodes) === process
    && (!node || !('node_field' in group) || !group.node_field || item.values[group.node_field] === node))
}
/** Missing/duplicate bindings never guess a business record from an element name. */
export function diagramNodeForElement(manifest: PanelManifest, data: DesignData, group: Inspector['nodes'], process: string, element: string | undefined) {
  if (!element) return undefined
  const matches = diagramContextRecords(manifest, data, group, process).filter(item => item.values[group.element_field] === element)
  return matches.length === 1 ? matches[0] : undefined
}
