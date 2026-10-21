import { recordsAtPath } from './record-state.ts'
import type { NavigationMapBinding } from './navigation-map-state.ts'
import { interpolatePanelText } from './panel-i18n.tsx'

/** Creation-only label; existing labels remain authored design facts. */
export function newNavigationConnectionLabel(data: Record<string, unknown>, binding: NavigationMapBinding,
  source: string, target: string): string | undefined {
  const template = binding.edges.new_label
  if (template === undefined) return undefined
  const nodes = recordsAtPath(data, binding.nodes.path)
  return interpolatePanelText(template, {
    source: String(nodes[source]?.[binding.nodes.label] ?? source),
    target: String(nodes[target]?.[binding.nodes.label] ?? target),
  })
}

/** Directed endpoint policy. Ports do not change a relation's endpoint identity. */
export function canCreateNavigationConnection(
  data: Record<string, unknown>, binding: NavigationMapBinding,
  source: string | null | undefined, target: string | null | undefined,
): boolean {
  if (typeof source !== 'string' || typeof target !== 'string') return false
  const nodes = recordsAtPath(data, binding.nodes.path)
  if (!Object.hasOwn(nodes, source) || !Object.hasOwn(nodes, target)) return false
  if (binding.connection_policy?.allow_self === false && source === target) return false
  if (binding.connection_policy?.allow_parallel === false
    && Object.values(recordsAtPath(data, binding.edges.path)).some(edge =>
      edge[binding.edges.source] === source && edge[binding.edges.target] === target)) return false
  return true
}
