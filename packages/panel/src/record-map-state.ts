import type { EditorField } from './dsl.ts'

type Records = Record<string, Record<string, unknown>>
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Read only. Missing order entries appear without rewriting saved facts. */
export function recordMapState(field: EditorField, record: Record<string, unknown>): { items: Records; ids: string[] } | undefined {
  const value = record[field.key], order = field.order_field ? record[field.order_field] : undefined
  if ((value !== undefined && (!isRecord(value) || !Object.values(value).every(isRecord)))
    || (order !== undefined && (!Array.isArray(order) || !order.every(id => typeof id === 'string')))) return
  const items = (value ?? {}) as Records
  const ids = [...new Set([...(Array.isArray(order) ? order.filter(id => Object.hasOwn(items, id)) : []), ...Object.keys(items)])]
  return { items, ids }
}

export function recordMapPatch(field: EditorField, items: Records, ids: readonly string[]): Record<string, unknown> {
  return { [field.key]: items, ...(field.order_field ? { [field.order_field]: ids } : {}) }
}

/** Only declared defaults: do not fabricate optional enums or erase unknowns. */
export function newRecordMapItem(field: EditorField, id: string): Record<string, unknown> {
  return { ...(field.item_fields ? structuredClone(field.item_defaults ?? {}) : Object.fromEntries((field.columns ?? []).map(column => [column.key, '']))),
    ...(field.id_field ? { [field.id_field]: id } : {}) }
}

export function moveRecordMapItem(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id), target = index + delta, next = [...ids]
  if (index >= 0 && target >= 0 && target < ids.length) { next.splice(index, 1); next.splice(target, 0, id) }
  return next
}
