import { DATA_TABLE_LIMITS, dataTableIssues, type DataTableColumn, type DataTableValue } from './dsl.ts'

export const emptyDataTable = (): DataTableValue => ({ columns: [], rows: {} })
export function tableId(prefix: string, existing: Readonly<Record<string, unknown>>): string {
  let index = 1
  while (Object.hasOwn(existing, `${prefix}_${index}`)) index++
  return `${prefix}_${index}`
}
export function tableCell(table: DataTableValue, row: string, column: string, value: string): DataTableValue {
  if (!Object.hasOwn(table.rows, row) || !table.columns.some(field => field.id === column)) throw Error('Unknown table cell')
  return { ...table, rows: { ...table.rows, [row]: { ...table.rows[row], [column]: value } } }
}
export function removeTableColumn(table: DataTableValue, id: string): DataTableValue {
  return { ...table, columns: table.columns.filter(column => column.id !== id),
    rows: Object.fromEntries(Object.entries(table.rows).map(([key, row]) => [key, Object.fromEntries(Object.entries(row).filter(([field]) => field !== id))])) }
}
/** Tab-separated clipboard data; quoted multiline cells are preserved. */
export function readTableClipboard(text: string): string[][] {
  if (text.length > 1024 * 1024) throw Error('Clipboard limit exceeded')
  const rows: string[][] = [], row: string[] = []; let cell = '', quoted = false, closed = false
  const flush = () => { row.push(cell); cell = ''; closed = false }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') { quoted = false; closed = true }
      else cell += ch
    } else if (ch === '"' && cell === '' && !closed) quoted = true
    else if (ch === '\t') flush()
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      flush(); rows.push(row.splice(0))
    } else { if (closed) throw Error('Invalid quoted clipboard cell'); cell += ch }
  }
  if (quoted) throw Error('Unclosed clipboard cell')
  if (cell !== '' || row.length || !/[\r\n]$/.test(text)) { flush(); rows.push(row) }
  return rows
}
export function writeTableClipboard(columns: readonly DataTableColumn[], rows: readonly Record<string, string>[], headers = true): string {
  const quote = (s: string) => /[\t\r\n"]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  const lines = rows.map(row => columns.map(column => quote(row[column.id] ?? '')).join('\t'))
  if (headers) lines.unshift(columns.map(column => quote(column.name)).join('\t'))
  return lines.join('\n')
}
/** Atomic paste: never drops excess columns, invalid cells or hidden rows. */
export function pasteTable(table: DataTableValue, rowIndex: number, columnIndex: number, text: string): DataTableValue {
  const cells = readTableClipboard(text), ids = Object.keys(table.rows)
  if (rowIndex < 0 || rowIndex > ids.length || columnIndex < 0 || !table.columns[columnIndex]
    || cells.some(row => row.length + columnIndex > table.columns.length)
    || rowIndex + cells.length > DATA_TABLE_LIMITS.rows) throw Error('Clipboard does not fit the table')
  const next: DataTableValue = { ...table, rows: { ...table.rows } }
  for (let y = 0; y < cells.length; y++) {
    const id = ids[rowIndex + y] ?? tableId('row', next.rows)
    next.rows[id] = { ...next.rows[id] }
    cells[y]!.forEach((value, x) => { next.rows[id]![table.columns[columnIndex + x]!.id] = value })
  }
  const errors = dataTableIssues(next)
  if (errors.length) throw Error(errors.slice(0, 3).join('; '))
  return next
}
export function matrixTable(table: DataTableValue) {
  const dimensions = table.columns.filter(column => column.role === 'dimension')
  const values = table.columns.filter(column => column.role === 'value')
  if (dimensions.length !== 2 || values.length !== 1 || table.columns.length !== 3) return undefined
  const [row, column] = dimensions as [DataTableColumn, DataTableColumn], value = values[0]!
  const entries = Object.entries(table.rows)
  const labels = (field: DataTableColumn) => [...new Set([
    ...(field.type === 'select' ? field.options ?? [] : []), ...entries.map(([, r]) => r[field.id]).filter(v => v !== undefined && v !== ''),
  ])]
  return { row, column, value, rows: labels(row), columns: labels(column),
    incomplete: entries.some(([, r]) => !r[row.id] || !r[column.id]),
    cell: (r: string, c: string) => entries.filter(([, entry]) => entry[row.id] === r && entry[column.id] === c) }
}
