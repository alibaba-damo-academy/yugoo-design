import type { ComponentNode, PanelManifest } from './dsl.ts'
import {
  applyRecordFieldEdit, fieldValuesOf, freshRecordId, orderedRecordIds,
  pathGet, pathSet, recordsAtPath, sectionBindingOf,
} from './record-state.ts'
import { relationHasCycle } from './relation-records.ts'

type Graph = NonNullable<ComponentNode['graph']>
export interface RelationHierarchyCreation {
  updates: Record<string, unknown>
  nodeId: string
}

/** Plan one node + child-to-parent edge transaction, without editing or publishing.
 * The caller supplies the localized manifest and live draft, guards writability,
 * then emits updates once through the existing Panel update/save channel.
 */
export function planRelationHierarchyCreate(
  manifest: PanelManifest, data: Record<string, unknown>, graph: Graph, parent: string, name: string,
): RelationHierarchyCreation | undefined {
  const create = graph.hierarchy?.create
  if (graph.participants || !graph.source_field || !graph.target_field || !create || typeof name !== 'string' || !name.trim() || !graph.edge_kind_field
    || !graph.hierarchy!.values.includes(create.edge_kind)) return
  const nodeSection = manifest.sections.find(section => section.id === graph.nodes)
  const edgeSection = manifest.sections.find(section => section.id === graph.edges)
  if (!nodeSection || !edgeSection || graph.nodes === graph.edges) return
  const option = manifest.fields.find(field => field.key === graph.edge_kind_field
    && field.applies_to?.includes(graph.edges))?.options?.find(option => option.value === create.edge_kind)
  // Unresolved UI tokens must never become a saved relationship name.
  if (!option || !option.label.trim() || option.label.includes('$t:')) return
  const nodeBinding = sectionBindingOf(manifest, graph.nodes)
  const edgeBinding = sectionBindingOf(manifest, graph.edges)
  const paths = [nodeBinding.recordsPath, edgeBinding.recordsPath,
    ...[nodeBinding.orderPath, edgeBinding.orderPath].filter((path): path is string => path !== undefined)]
  if (paths.some((path, index) => paths.slice(index + 1).some(other =>
    path === other || path.startsWith(other + '.') || other.startsWith(path + '.')))) return
  const nodes = recordsAtPath(data, nodeBinding.recordsPath)
  if (!Object.hasOwn(nodes, parent)) return
  const rawMap = (path: string): Record<string, unknown> | undefined => {
    const value = pathGet(data, path)
    if (value === undefined) return {}
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : undefined
  }
  const rawNodes = rawMap(nodeBinding.recordsPath), rawEdges = rawMap(edgeBinding.recordsPath)
  if (!rawNodes || !rawEdges) return
  // Include malformed existing members in collision checks and preserve them for repair.
  const nodeId = freshRecordId(graph.nodes, rawNodes as Record<string, Record<string, unknown>>)
  const edgeId = freshRecordId(graph.edges, rawEdges as Record<string, Record<string, unknown>>)
  const nodeValues = {
    ...structuredClone(nodeSection.create?.defaults ?? {}), [graph.label_field]: name.trim(),
    ...(nodeSection.create?.id_field ? { [nodeSection.create.id_field]: nodeId } : {}),
  }
  // Reuse declared dependent-field clearing (e.g. quantities on a non-association).
  const edgeValues = applyRecordFieldEdit(manifest, graph.edges, {
    ...structuredClone(edgeSection.create?.defaults ?? {}), ...graph.edge_defaults,
    [graph.label_field]: option.label, [graph.source_field]: nodeId, [graph.target_field]: parent,
    ...(edgeSection.create?.id_field ? { [edgeSection.create.id_field]: edgeId } : {}),
  }, graph.edge_kind_field, create.edge_kind)
  const edges = Object.fromEntries(Object.entries(recordsAtPath(data, edgeBinding.recordsPath))
    .map(([id, record]) => [id, fieldValuesOf(record, edgeBinding.fieldsPath)]))
  if (relationHasCycle(edgeId, edgeValues, edges, graph)) return
  const node = nodeBinding.fieldsPath ? pathSet({}, nodeBinding.fieldsPath, nodeValues) : nodeValues
  const edge = edgeBinding.fieldsPath ? pathSet({}, edgeBinding.fieldsPath, edgeValues) : edgeValues
  const updates: Record<string, unknown> = {
    [nodeBinding.recordsPath]: { ...rawNodes, [nodeId]: node },
    [edgeBinding.recordsPath]: { ...rawEdges, [edgeId]: edge },
  }
  for (const [binding, map, id] of [[nodeBinding, rawNodes, nodeId], [edgeBinding, rawEdges, edgeId]] as const) {
    if (!binding.orderPath) continue
    const order = pathGet(data, binding.orderPath)
    updates[binding.orderPath] = [...orderedRecordIds(map as Record<string, Record<string, unknown>>,
      Array.isArray(order) ? order : undefined), id]
  }
  return { updates, nodeId }
}
