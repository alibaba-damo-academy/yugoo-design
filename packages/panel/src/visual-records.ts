/** Pure, domain-neutral projections. No inference, aggregation or hidden writes. */
import type { PanelManifest } from './dsl.ts'

export function displayValue(manifest: PanelManifest, section: string, field: string | undefined, value: unknown): string {
  if (field === undefined || value === undefined || value === null || value === '') return ''
  const definition = manifest.fields.find(candidate => candidate.key === field && candidate.applies_to?.includes(section))
  return definition?.options?.find(option => option.value === String(value))?.label ?? String(value)
}

/** Endpoints already have visible node titles. Suppress only an exact generated
 * endpoint-only label, never meaningful authored relationship text or facts.
 */
export function relationCanvasLabel(value: unknown, source: string, target: string, kind: string): string {
  const label = value === undefined || value === null ? '' : String(value)
  const endpointOnly = label === `${source} → ${target}` || label === `${source} -> ${target}`
    || label === `${source}→${target}` || label === `${source}->${target}`
  return !label || endpointOnly ? kind : label
}

export type RecordMap = Record<string, Record<string, unknown>>
export const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function pivotRows(value: unknown, binding: { row: string; column: string; value: string }) {
  const rows: string[] = [], columns: string[] = [], issues: string[] = []
  const cells = new Map<string, Map<string, number[]>>()
  if (value !== undefined && !Array.isArray(value)) issues.push('数据不是行数组；请在原始记录中修正。')
  const raw: unknown[] = Array.isArray(value) ? value : []
  raw.forEach((item, index) => {
    if (!isRecordValue(item) || typeof item[binding.row] !== 'string' || item[binding.row] === ''
      || typeof item[binding.column] !== 'string' || item[binding.column] === '') {
      issues.push(`第 ${index + 1} 行缺少有效行/列标识；原始数据保留。`); return
    }
    const row = item[binding.row] as string, column = item[binding.column] as string
    if (!cells.has(row)) { rows.push(row); cells.set(row, new Map()) }
    if (!columns.includes(column)) columns.push(column)
    const indices = cells.get(row)!.get(column) ?? []
    indices.push(index); cells.get(row)!.set(column, indices)
    if (indices.length === 2) issues.push(`${row} / ${column} 存在重复记录；不合并、不覆盖，请在原始数据中修正。`)
  })
  return { raw, rows, columns, cells, issues }
}

export function replaceMatrixCell(value: unknown, binding: { row: string; column: string; value: string }, row: string, column: string, next: string): unknown[] {
  const pivot = pivotRows(value, binding)
  const indices = pivot.cells.get(row)?.get(column)
  if (indices?.length !== 1) throw new Error('Matrix edit requires exactly one existing source row')
  return pivot.raw.map((item, index) => index === indices[0] && isRecordValue(item) ? { ...item, [binding.value]: next } : item)
}

export function graphRecords(nodes: RecordMap, edges: RecordMap, sourceField: string, targetField: string) {
  const valid: Array<{ id: string; source: string; target: string }> = [], issues: string[] = []
  for (const [id, value] of Object.entries(edges)) {
    const source = value[sourceField], target = value[targetField]
    if (typeof source !== 'string' || typeof target !== 'string' || !Object.hasOwn(nodes, source) || !Object.hasOwn(nodes, target)) {
      issues.push(`关系 ${String(value.title ?? id)} 的端点缺失或不存在；请从记录列表选择并修正。`)
    } else valid.push({ id, source, target })
  }
  return { valid, issues }
}
