import type { ComponentNode, PanelManifest } from './dsl.ts'
import {
  applyRecordFieldEdit, fieldValuesOf, freshRecordId, pathGet, pathSet,
  recordsAtPath, sectionBindingOf,
} from './record-state.ts'
import { relationHasCycle } from './relation-records.ts'

type Graph = NonNullable<ComponentNode['graph']>
type Records = Record<string, Record<string, unknown>>

/** Presentation guard only: the owning Bundle separately validates saved edges. */
export function relationHasParentConflict(id: string, candidate: Record<string, unknown>, edges: Records, graph: Graph): boolean {
  if (graph.participants || !graph.source_field || !graph.target_field || graph.hierarchy?.max_parents !== 1 || !graph.edge_kind_field
    || !graph.hierarchy.values.includes(String(candidate[graph.edge_kind_field]))) return false
  return Object.entries(edges).some(([key, edge]) => edge !== null && typeof edge === 'object' && !Array.isArray(edge) && key !== id
    && edge[graph.source_field!] === candidate[graph.source_field!]
    && graph.hierarchy!.values.includes(String(edge[graph.edge_kind_field!])))
}

/** Change the single authoritative parent edge, retaining its identity/metadata.
 * No role, associated record or publication is created by this pure planner.
 */
export function planRelationParentEdit(manifest: PanelManifest, data: Record<string, unknown>, graph: Graph,
  child: string, parent: string): Record<string, unknown> | undefined {
  if (graph.participants || !graph.source_field || !graph.target_field || graph.hierarchy?.max_parents !== 1 || graph.hierarchy.values.length !== 1 || !graph.edge_kind_field) return
  const binding = sectionBindingOf(manifest, graph.edges), nodeBinding = sectionBindingOf(manifest, graph.nodes)
  const definition = manifest.sections.find(section => section.id === graph.edges)
  if (!definition || graph.nodes === graph.edges) return
  const paths = [binding.recordsPath, nodeBinding.recordsPath, ...[binding.orderPath].filter((value): value is string => value !== undefined)]
  if (paths.some((path, index) => paths.slice(index + 1).some(other =>
    path === other || path.startsWith(other + '.') || other.startsWith(path + '.')))) return
  const nodes = recordsAtPath(data, nodeBinding.recordsPath)
  if (!Object.hasOwn(nodes, child) || (parent !== '' && !Object.hasOwn(nodes, parent))) return
  const rawEdges = pathGet(data, binding.recordsPath)
  if (rawEdges !== undefined && (rawEdges === null || typeof rawEdges !== 'object' || Array.isArray(rawEdges))) return
  const raw = (rawEdges ?? {}) as Record<string, unknown>
  const rawOrder = binding.orderPath ? pathGet(data, binding.orderPath) : undefined
  if (rawOrder !== undefined && (!Array.isArray(rawOrder) || rawOrder.some(value => typeof value !== 'string'))) return
  const edges = Object.fromEntries(Object.entries(recordsAtPath(data, binding.recordsPath))
    .map(([id, record]) => [id, fieldValuesOf(record, binding.fieldsPath)]))
  const kind = graph.hierarchy.values[0]!
  const owned = Object.entries(edges).filter(([, value]) => value[graph.source_field!] === child
    && value[graph.edge_kind_field!] === kind)
  if (owned.length > 1) return // Invalid evidence remains intact for explicit repair.
  const existing = owned[0]
  if (!parent) {
    if (!existing) return {}
    const next = { ...raw }; delete next[existing[0]]
    return { [binding.recordsPath]: next,
      ...(binding.orderPath && rawOrder ? { [binding.orderPath]: rawOrder.filter((id: string) => id !== existing[0]) } : {}) }
  }
  if (existing?.[1][graph.target_field] === parent) return {}
  const id = existing?.[0] ?? freshRecordId(graph.edges, raw as Records)
  const option = manifest.fields.find(field => field.key === graph.edge_kind_field && field.applies_to?.includes(graph.edges))
    ?.options?.find(value => value.value === kind)
  if (!existing && (!option?.label.trim() || option.label.includes('$t:'))) return
  const initial = existing?.[1] ?? {
    ...structuredClone(definition.create?.defaults ?? {}), ...graph.edge_defaults,
    [graph.label_field]: option!.label,
    ...(definition.create?.id_field ? { [definition.create.id_field]: id } : {}),
  }
  const next = applyRecordFieldEdit(manifest, graph.edges,
    { ...initial, [graph.source_field]: child, [graph.target_field]: parent }, graph.edge_kind_field, kind)
  if (relationHasCycle(id, next, edges, graph) || relationHasParentConflict(id, next, edges, graph)) return
  const record = binding.fieldsPath ? pathSet((existing ? raw[id] : {}) as Record<string, unknown>, binding.fieldsPath, next) : next
  return { [binding.recordsPath]: { ...raw, [id]: record },
    ...(!existing && binding.orderPath ? { [binding.orderPath]: [...(rawOrder ?? Object.keys(raw)), id] } : {}) }
}
