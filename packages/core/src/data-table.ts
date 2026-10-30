/** Host-neutral contract for an authored, editable sample-data table.
 * Values retain their lexical form; the declared column type validates their
 * meaning. Missing cells are unknown, never zero or false. No expressions run.
 */
import type { SchemaSpec } from './schema.ts'

export const DATA_TABLE_TYPES = ['text', 'number', 'boolean', 'date', 'select'] as const
export type DataTableType = typeof DATA_TABLE_TYPES[number]
export interface DataTableColumn {
  id: string
  name: string
  type: DataTableType
  role?: 'dimension' | 'value' | 'attribute'
  unit?: string
  description?: string
  options?: string[]
  /** Optional Bundle-owned metadata is preserved, never inferred by the grid. */
  [key: string]: unknown
}
export interface DataTableValue {
  columns: DataTableColumn[]
  rows: Record<string, Record<string, string>>
}
export const DATA_TABLE_LIMITS = { columns: 64, rows: 500, cell: 10000 } as const
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const dataTableId = (v: unknown): v is string => typeof v === 'string'
  && /^[A-Za-z][\w-]{0,63}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v)

export function dataTableCellIssue(column: DataTableColumn, value: unknown): string | undefined {
  if (value === undefined || value === '') return
  if (typeof value !== 'string' || value.length > DATA_TABLE_LIMITS.cell) return 'invalid_value'
  if (column.type === 'number' && (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) return 'number'
  if (column.type === 'boolean' && !['true', 'false'].includes(value)) return 'boolean'
  if (column.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) return 'date'
  if (column.type === 'select' && !column.options?.includes(value)) return 'select'
}

/** Structural errors prohibit editing; cell errors stay visible and repairable. */
export function dataTableIssues(value: unknown, cells = true): string[] {
  if (value === undefined) return []
  if (!object(value) || !Array.isArray(value.columns) || !object(value.rows)) return ['Expected columns and rows']
  const errors: string[] = [], ids = new Set<string>()
  if (Object.keys(value).some(k => !['columns', 'rows'].includes(k))) errors.push('Unknown table property')
  if (value.columns.length > DATA_TABLE_LIMITS.columns || Object.keys(value.rows).length > DATA_TABLE_LIMITS.rows) errors.push('Sample table exceeds row/column limit')
  for (const column of value.columns) {
    if (!object(column) || !dataTableId(column.id) || ids.has(column.id)) { errors.push('Invalid or duplicate field ID'); continue }
    ids.add(column.id)
    if (typeof column.name !== 'string' || !column.name.trim() || column.name.length > 120) errors.push(`${column.id}: invalid name`)
    if (!DATA_TABLE_TYPES.includes(column.type as DataTableType)) errors.push(`${column.id}: invalid type`)
    if (column.role !== undefined && !['dimension', 'value', 'attribute'].includes(String(column.role))) errors.push(`${column.id}: invalid role`)
    for (const key of ['unit', 'description']) if (column[key] !== undefined && typeof column[key] !== 'string') errors.push(`${column.id}: invalid ${key}`)
    if (column.options !== undefined && (!Array.isArray(column.options) || column.options.length > 100
      || column.options.some(v => typeof v !== 'string' || !v.trim() || v.length > 120)
      || new Set(column.options).size !== column.options.length)) errors.push(`${column.id}: invalid choices`)
    if (column.type === 'select' && (!Array.isArray(column.options) || column.options.length === 0)) errors.push(`${column.id}: choices required`)
  }
  for (const [id, row] of Object.entries(value.rows)) {
    if (!dataTableId(id) || !object(row)) { errors.push('Invalid row'); continue }
    for (const [key, cell] of Object.entries(row)) {
      if (!ids.has(key) || typeof cell !== 'string') errors.push(`${id}.${key}: unknown field or non-text cell`)
      else if (cells) {
        const column = value.columns.find(c => object(c) && c.id === key) as DataTableColumn
        const issue = dataTableCellIssue(column, cell)
        if (issue) errors.push(`${id}.${key}: ${issue}`)
      }
    }
  }
  return errors
}

/** Ensure the declared editor cannot escape its Bundle's schema authority. */
export function dataTableSchemaMatches(spec: SchemaSpec): boolean {
  const columns = spec.properties?.columns, rows = spec.properties?.rows, column = columns?.items
  return spec.type === 'object' && spec.additional_properties === false
    && spec.required?.includes('columns') === true && spec.required?.includes('rows') === true
    && Object.keys(spec.properties ?? {}).every(key => ['columns', 'rows'].includes(key))
    && columns?.type === 'array' && column?.type === 'object'
    && ['id', 'name', 'type'].every(key => column.required?.includes(key))
    && column.required?.every(key => ['id', 'name', 'type'].includes(key)) === true
    && ['id', 'name'].every(key => column.properties?.[key]?.type === 'string')
    && column.properties?.type?.type === 'enum'
    && DATA_TABLE_TYPES.every(type => column.properties!.type!.values?.includes(type))
    && column.properties!.type!.values?.length === DATA_TABLE_TYPES.length
    && column.properties?.role?.type === 'enum'
    && ['dimension', 'value', 'attribute'].every(role => column.properties!.role!.values?.includes(role))
    && ['unit', 'description'].every(key => column.properties?.[key]?.type === 'string')
    && column.properties?.options?.type === 'array' && column.properties.options.items?.type === 'string'
    && rows?.type === 'map' && rows.value?.type === 'map' && rows.value.value?.type === 'string'
}
