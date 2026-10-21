import type { ComponentNode, PanelManifest } from './dsl.ts'
import { pathSet, recordsAtPath, sectionBindingOf, type DesignData } from './record-state.ts'

/** A view over flat canonical records. Hidden siblings are never replaced by a filtered save. */
export function boardDetailScope(manifest: PanelManifest, data: DesignData, bindings: NonNullable<ComponentNode['board']>['detail_sources'], parent: string) {
  const scopes = (bindings ?? []).map(binding => ({ ...binding, path: sectionBindingOf(manifest, binding.section).recordsPath }))
  let view = data as unknown as Record<string, unknown>
  for (const scope of scopes) {
    const records = recordsAtPath(data, scope.path)
    view = pathSet(view, scope.path, Object.fromEntries(Object.entries(records).filter(([, record]) => record[scope.reference] === parent)))
  }
  return {
    data: view as unknown as DesignData,
    allowsEdit(section: string, record: string, field: string) {
      const scope = scopes.find(scope => scope.section === section)
      return !!scope && field !== scope.reference && recordsAtPath(data, scope.path)[record]?.[scope.reference] === parent
    },
    merge(updates: Record<string, unknown>): Record<string, unknown> {
      const next: Record<string, unknown> = {}
      for (const [path, value] of Object.entries(updates)) {
        const scope = scopes.find(scope => scope.path === path)
        if (!scope || value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('Out-of-scope board detail update')
        const original = recordsAtPath(data, path)
        const hidden = Object.fromEntries(Object.entries(original).filter(([, record]) => record[scope.reference] !== parent))
        let incoming: Record<string, unknown> = {}
        for (const [id, raw] of Object.entries(value)) {
          if (Object.hasOwn(hidden, id) || raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Foreign board detail record')
          const record = raw as Record<string, unknown>
          if (record[scope.reference] !== undefined && record[scope.reference] !== parent) throw Error('Board detail parent cannot change')
          incoming = { ...incoming, [id]: { ...record, [scope.reference]: parent } }
        }
        next[path] = { ...hidden, ...incoming }
      }
      return next
    },
  }
}
