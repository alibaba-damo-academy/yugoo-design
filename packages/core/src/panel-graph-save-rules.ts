/** Finite graph-integrity gates for the existing Panel save path.
 * The owning validation document supplies every rule; the current declaration
 * only selects matching graph or reference-canvas bindings. This never evaluates
 * completeness, clarity, undeclared references, or repairs submitted state.
 */
import type { ValidationDoc, ValidationRule } from './validation-rules.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface GraphBinding {
  nodes: string
  edges: string
  source: string
  target: string
  kind?: string
  hierarchy: readonly string[]
}

/** Select configured state rules for exactly the displayed canonical maps and
 * endpoint fields. Optional kind filters must describe the declared hierarchy.
 * No graph declaration means no additional save gates.
 */
export function panelGraphSaveRules(doc: ValidationDoc, panel: unknown): readonly ValidationRule[] {
  if (!record(panel) || !Array.isArray(panel.sections) || !record(panel.ui)) return []
  const sections = new Map(panel.sections.filter(record).map(section => [section.id, section]))
  const graphs: GraphBinding[] = []
  const references: Array<{ source: string; field: string; target: string; itemField?: string }> = []
  const pending = [panel.ui], visited = new Set<unknown>()
  while (pending.length) {
    const node = pending.pop()!
    if (visited.has(node)) continue
    visited.add(node)
    if (Array.isArray(node.children)) pending.push(...node.children.filter(record))
    if (record(node.slots)) pending.push(...Object.values(node.slots).filter(record))
    if (node.component === 'reference_graph' && record(node.references) && Array.isArray(node.references.links)) {
      for (const link of node.references.links.filter(record)) {
        const source = sections.get(link.source), target = sections.get(link.target)
        if (!source || !target || source.fields_path !== undefined || target.fields_path !== undefined
          || typeof link.field !== 'string') continue
        const sourcePath = source.records_path ?? source.id, targetPath = target.records_path ?? target.id
        if (typeof sourcePath === 'string' && typeof targetPath === 'string') references.push({
          source: sourcePath, field: link.field, target: targetPath,
          ...(typeof link.item_field === 'string' ? {itemField: link.item_field} : {}),
        })
      }
    }
    if (node.component !== 'relation_graph' || !record(node.graph)) continue
    const graph = node.graph, nodes = sections.get(graph.nodes), edges = sections.get(graph.edges)
    if (Array.isArray(graph.related) && Array.isArray(panel.fields)) for (const related of graph.related.filter(record)) {
      const source = sections.get(related.source)
      const field = panel.fields.filter(record).find(field => field.key === related.reference_field
        && Array.isArray(field.applies_to) && field.applies_to.includes(related.source))
      const target = field && sections.get(field.options_from_section)
      if (source && target && source.fields_path === undefined && target.fields_path === undefined) references.push({
        source: String(source.records_path ?? source.id), field: String(related.reference_field), target: String(target.records_path ?? target.id),
      })
    }
    if (nodes && edges && edges.fields_path === undefined && nodes.fields_path === undefined && record(graph.participants)) {
      const source = edges.records_path ?? edges.id, target = nodes.records_path ?? nodes.id
      if (typeof source === 'string' && typeof target === 'string'
        && typeof graph.participants.field === 'string' && typeof graph.participants.reference_field === 'string')
        references.push({ source, target, field: graph.participants.field, itemField: graph.participants.reference_field })
    }
    // Graph operators address direct record fields. A nested editor's field
    // path cannot accidentally match a rule for a different canonical field.
    if (!nodes || !edges || edges.fields_path !== undefined
      || typeof graph.source_field !== 'string' || typeof graph.target_field !== 'string') continue
    const nodesPath = nodes.records_path ?? nodes.id, edgesPath = edges.records_path ?? edges.id
    if (typeof nodesPath !== 'string' || typeof edgesPath !== 'string') continue
    graphs.push({ nodes: nodesPath, edges: edgesPath, source: graph.source_field, target: graph.target_field,
      ...(typeof graph.edge_kind_field === 'string' ? { kind: graph.edge_kind_field } : {}),
      hierarchy: record(graph.hierarchy) && Array.isArray(graph.hierarchy.values)
        ? graph.hierarchy.values.filter((value): value is string => typeof value === 'string') : [],
    })
  }
  return doc.rules.filter(rule => rule.scope.includes('state') && ((record(rule.check.exclusive_fields)
    && rule.check.exclusive_fields.allow_empty === true && Array.isArray(rule.check.exclusive_fields.fields)
    && rule.check.exclusive_fields.fields.every(field => references.some(reference => reference.source === rule.check.for_each_in_map
      && reference.field === field && reference.itemField === undefined))) || references.some(reference => {
    const spec = rule.check.member_of_map ?? rule.check.members_of_map
    return rule.check.for_each_in_map === reference.source && record(spec)
      && spec.value === reference.field && spec.map === reference.target && spec.item_field === reference.itemField
  }) || graphs.some(graph => {
    const check = rule.check
    for (const operator of ['acyclic_record_edges', 'single_parent_record_edges'] as const) {
      const spec = check[operator]
      if (!record(spec) || spec.map !== graph.edges || spec.source !== graph.source || spec.target !== graph.target) continue
      return spec.where === undefined || (record(spec.where) && spec.where.field === graph.kind
        && typeof spec.where.equals === 'string' && graph.hierarchy.includes(spec.where.equals))
    }
    const endpoint = check.member_of_map
    return check.for_each_in_map === graph.edges && record(endpoint) && endpoint.map === graph.nodes
      && (endpoint.value === graph.source || endpoint.value === graph.target)
  })))
}
