import { useEffect, useRef, useState, type ReactElement, type KeyboardEvent, type ClipboardEvent } from 'react'
import { Plus, Trash2, ChevronDown, ArrowLeft, ArrowRight, X, Copy } from 'lucide-react'
import { DATA_TABLE_TYPES, DATA_TABLE_LIMITS, dataTableIssues, dataTableCellIssue, type DataTableColumn, type DataTableValue, type DataTableType } from './dsl.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { emptyDataTable, tableId, tableCell, removeTableColumn, pasteTable, writeTableClipboard, matrixTable } from './data-table-state.ts'

interface Props {
  value: unknown
  label: string
  locale?: string
  editable?: boolean
  onChange: (value: DataTableValue) => void
  registerBeforeSave?: import('./client/panels/shared.ts').SkillPanelProps['registerBeforeSave']
}
const TYPE_MARKS: Record<DataTableType, string> = { text: 'Aa', number: '#', boolean: '✓', date: '▦', select: '≡' }

/** Pure shared grid. Field definitions and data use one existing field-edit port. */
export function DataTable({ value, label, editable, onChange, registerBeforeSave }: Props): ReactElement {
  const { t } = usePanelI18n()
  const [view, setView] = useState<'table' | 'matrix'>('table')
  const [editor, setEditor] = useState<{ column: DataTableColumn; original?: string }>()
  const [notice, setNotice] = useState(''), [fieldError, setFieldError] = useState('')
  const [active, setActive] = useState({ row: 0, column: 0 })
  const root = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null)
  const structural = dataTableIssues(value, false)
  const table = value === undefined ? emptyDataTable() : value as DataTableValue
  const typeName = (type: DataTableType) => t(({ text: 'tableTypeText', number: 'tableTypeNumber', boolean: 'tableTypeBoolean', date: 'tableTypeDate', select: 'tableTypeSelect' } as const)[type])
  useEffect(() => {
    if (!editor) return
    const before = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus()
    return () => { if (before?.isConnected) before.focus() }
  }, [editor?.column.id])
  const finishMessage = t('tableFinishField')
  useEffect(() => {
    if (!editor || !registerBeforeSave) return
    const remove = registerBeforeSave(async () => { throw Error(finishMessage) })
    remove.setPending?.(true)
    return remove
  }, [!!editor, registerBeforeSave, finishMessage])
  useEffect(() => { if (!editable) setEditor(undefined) }, [editable])
  if (structural.length) return <div className="dsh-data-table" role="alert"><p>{t('tableInvalidStructure')}</p><pre>{structural.slice(0, 4).join('\n')}</pre></div>
  const ids = Object.keys(table.rows), projection = matrixTable(table)
  const matrix = view === 'matrix' && projection && !projection.incomplete ? projection : undefined
  const canEdit = editable === true
  const emit = (next: DataTableValue) => { if (canEdit) { setNotice(''); onChange(next) } }
  const openField = (column?: DataTableColumn) => {
    if (!canEdit) return
    setFieldError('')
    setEditor(column ? { column: { ...column, options: column.options ? [...column.options] : undefined }, original: JSON.stringify(column) }
      : { column: { id: tableId('field', Object.fromEntries(table.columns.map(c => [c.id, c]))), name: '', type: 'text', role: 'attribute' } })
  }
  const applyField = () => {
    if (!editor || !canEdit) return
    const current = table.columns.find(c => c.id === editor.column.id)
    if ((editor.original && JSON.stringify(current) !== editor.original) || (!editor.original && current)) { setFieldError(t('tableFieldChanged')); return }
    const column = { ...editor.column }
    if (column.type !== 'select') delete column.options
    const next = { ...table, columns: editor.original ? table.columns.map(c => c.id === column.id ? column : c) : [...table.columns, column] }
    const errors = dataTableIssues(next)
    if (errors.length) { setFieldError(t('tableFieldInvalid') + ' ' + errors.slice(0, 3).join('; ')); return }
    emit(next); setEditor(undefined)
  }
  const focusCell = (row: number, column: number) => {
    if (row < 0 || column < 0) return
    const target = root.current?.querySelector<HTMLElement>(`[data-grid-row="${row}"][data-grid-column="${column}"]`)
    if (target) { setActive({ row, column }); target.focus() }
  }
  const move = (event: KeyboardEvent, row: number, column: number, columns: number, rows: number) => {
    let nextRow = row, nextColumn = column
    if (event.key === 'Tab') { nextColumn += event.shiftKey ? -1 : 1; if (nextColumn >= columns) { nextColumn = 0; nextRow++ } if (nextColumn < 0) { nextColumn = columns - 1; nextRow-- } }
    else if (event.key === 'Enter') nextRow += event.shiftKey ? -1 : 1
    else if (event.currentTarget.tagName !== 'SELECT' && event.key === 'ArrowDown') nextRow++
    else if (event.currentTarget.tagName !== 'SELECT' && event.key === 'ArrowUp') nextRow--
    else return
    if (nextRow >= 0 && nextRow < rows && nextColumn >= 0 && nextColumn < columns) { event.preventDefault(); focusCell(nextRow, nextColumn) }
  }
  const cell = (column: DataTableColumn, text: string | undefined, row: number, col: number, change: (text: string) => void, paste?: (text: string) => void) => {
    const issue = dataTableCellIssue(column, text)
    const aria = `${column.name} ${row + 1}`
    if (!canEdit) return <span className={text === undefined || text === '' ? 'is-missing' : ''}>{text === undefined || text === '' ? t('tableUnknown') : column.type === 'boolean' && !issue ? t(text === 'true' ? 'tableYes' : 'tableNo') : text}</span>
    const shared = { 'aria-label': aria, 'aria-invalid': issue ? true as const : undefined,
      title: issue ? `${t('tableInvalidCell')}: ${typeName(column.type)}` : column.description,
      'data-grid-row': row, 'data-grid-column': col,
      tabIndex: Math.min(active.row, (matrix ? matrix.rows.length : ids.length) - 1) === row && Math.min(active.column, (matrix ? matrix.columns.length : table.columns.length) - 1) === col ? 0 : -1,
      onFocus: () => setActive({ row, column: col }),
      onKeyDown: (event: KeyboardEvent) => move(event, row, col, matrix ? matrix.columns.length : table.columns.length, matrix ? matrix.rows.length : ids.length),
      onPaste: (event: ClipboardEvent) => {
        const content = event.clipboardData.getData('text/plain')
        if (!paste || (!content.includes('\t') && !content.includes('\n'))) return
        event.preventDefault(); paste(content)
      },
    }
    if (column.type === 'boolean' || column.type === 'select') return <select {...shared} value={text ?? ''} onChange={event => change(event.target.value)}>
      <option value="">{t('tableUnknown')}</option>
      {issue && text ? <option value={text}>{text}</option> : null}
      {column.type === 'boolean' ? <><option value="true">{t('tableYes')}</option><option value="false">{t('tableNo')}</option></>
        : (column.options ?? []).map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </select>
    return <input {...shared} type="text" inputMode={column.type === 'number' ? 'decimal' : undefined} value={text ?? ''}
      placeholder={column.type === 'date' ? 'YYYY-MM-DD' : t('tableUnknown')} onChange={event => change(event.target.value)} />
  }
  const copied = async () => {
    try { await navigator.clipboard.writeText(writeTableClipboard(table.columns, Object.values(table.rows))); setNotice(t('tableCopied')) }
    catch { setNotice(t('tableCopyFailed')) }
  }
  const addRow = () => {
    if (!canEdit || ids.length >= DATA_TABLE_LIMITS.rows || !table.columns.length) return
    const id = tableId('row', table.rows); emit({ ...table, rows: { ...table.rows, [id]: {} } }); setView('table')
    setActive({ row: ids.length, column: 0 }); setTimeout(() => focusCell(ids.length, 0), 0)
  }
  const errorCount = dataTableIssues(table).length
  return <div className="dsh-data-table" ref={root} aria-label={label}>
    <div className="dsh-data-table-toolbar">
      <div className="dsh-data-table-views" role="group" aria-label={t('tableView')}>
        <button type="button" aria-pressed={!matrix} onClick={() => setView('table')}>{t('tableDetailView')}</button>
        {projection && !projection.incomplete ? <button type="button" aria-pressed={!!matrix} onClick={() => setView('matrix')}>{t('tableMatrixView')}</button> : null}
      </div>
      <span className="dsh-data-table-count">{ids.length} {t('tableRows')} · {table.columns.length} {t('tableFields')}</span>
      <div className="dsh-data-table-actions">
        <button type="button" onClick={() => void copied()} disabled={!table.columns.length}><Copy size={14} />{t('tableCopy')}</button>
        {canEdit ? <button type="button" onClick={() => openField()} disabled={table.columns.length >= DATA_TABLE_LIMITS.columns}><Plus size={14} />{t('tableAddField')}</button> : null}
      </div>
    </div>
    {notice ? <p className="dsh-data-table-notice" role="status">{notice}</p> : null}
    {errorCount ? <p className="dsh-data-table-error" role="alert">{t('tableFixCells')}</p> : null}
    {!table.columns.length ? <div className="dsh-data-table-empty"><strong>{t('tableEmpty')}</strong><p>{t('tableEmptyHint')}</p>{canEdit ? <button type="button" onClick={() => openField()}><Plus size={16} />{t('tableAddField')}</button> : null}</div>
      : <div className="dsh-data-table-scroll" tabIndex={-1}>
        {matrix ? <table><thead><tr><th className="dsh-data-table-index-heading">{matrix.row.name} / {matrix.column.name}</th>{matrix.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{matrix.rows.map((r, ri) => <tr key={r}><th scope="row">{r}</th>{matrix.columns.map((c, ci) => {
            const found = matrix.cell(r, c)
            return <td key={c}>{found.length > 1 ? <span role="alert">{t('tableDuplicate')}</span> : cell(matrix.value, found[0]?.[1][matrix.value.id], ri, ci, next => {
              if (found.length === 1) emit(tableCell(table, found[0]![0], matrix.value.id, next))
              else if (ids.length >= DATA_TABLE_LIMITS.rows) setNotice(t('tableRowLimit'))
              else { const id = tableId('row', table.rows); emit({ ...table, rows: { ...table.rows, [id]: { [matrix.row.id]: r, [matrix.column.id]: c, [matrix.value.id]: next } } }) }
            })}</td>
          })}</tr>)}</tbody></table>
          : <table><thead><tr><th className="dsh-data-table-row-number" aria-label={t('tableRowNumber')}>#</th>{table.columns.map(column => <th key={column.id} scope="col">
            <button type="button" className="dsh-data-table-column" disabled={!canEdit} onClick={() => openField(column)} aria-label={`${t('tableEditField')}: ${column.name}`} title={column.description}>
              <span className="dsh-data-table-type" aria-hidden="true">{TYPE_MARKS[column.type]}</span><span>{column.name}{column.unit ? <small> · {column.unit}</small> : null}</span><ChevronDown size={13} />
            </button></th>)}<th className="dsh-data-table-row-action">{canEdit ? <button type="button" aria-label={t('tableAddField')} onClick={() => openField()} disabled={table.columns.length >= DATA_TABLE_LIMITS.columns}><Plus size={15} /></button> : null}</th></tr></thead>
            <tbody>{ids.map((id, ri) => <tr key={id} data-table-row={id}><th scope="row" className="dsh-data-table-row-number">{ri + 1}</th>{table.columns.map((column, ci) => <td key={column.id}>
              {cell(column, table.rows[id]![column.id], ri, ci, next => emit(tableCell(table, id, column.id, next)), text => {
                try { emit(pasteTable(table, ri, ci, text)) } catch (error) { setNotice(t('tablePasteFailed') + ' ' + String((error as Error).message)) }
              })}</td>)}<td className="dsh-data-table-row-action">{canEdit ? <button type="button" aria-label={`${t('tableDeleteRow')} ${ri + 1}`} onClick={() => {
                if (!window.confirm(t('tableDeleteRowConfirm'))) return
                const rows = { ...table.rows }; delete rows[id]; emit({ ...table, rows })
              }}><Trash2 size={14} /></button> : null}</td></tr>)}</tbody></table>}
      </div>}
    {canEdit && table.columns.length > 0 ? <button type="button" className="dsh-data-table-add-row" disabled={ids.length >= DATA_TABLE_LIMITS.rows} onClick={addRow}><Plus size={15} />{t('tableAddRow')}</button> : null}
    <p className="dsh-data-table-help">{!canEdit ? t('tableReadonlyHint') : matrix ? t('tableMatrixHint') : t('tableKeyboardHint')}</p>
    {editor && canEdit ? <div className="dsh-data-table-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setEditor(undefined) }}>
      <div className="dsh-data-table-field-dialog" role="dialog" aria-modal="true" aria-label={t('tableFieldProperties')} ref={dialog} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setEditor(undefined) }
        if (event.key === 'Tab') {
          const controls = [...dialog.current!.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)')]
          const first = controls[0], last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }
      }}>
        <div className="dsh-data-table-dialog-title"><strong>{t('tableFieldProperties')}</strong><button type="button" aria-label={t('tableCancel')} onClick={() => setEditor(undefined)}><X size={18} /></button></div>
        <label>{t('tableFieldName')}<input value={editor.column.name} maxLength={120} onChange={e => setEditor({ ...editor, column: { ...editor.column, name: e.target.value } })} /></label>
        <div className="dsh-data-table-field-pair"><label>{t('tableFieldType')}<select value={editor.column.type} onChange={e => setEditor({ ...editor, column: { ...editor.column, type: e.target.value as DataTableType } })}>{DATA_TABLE_TYPES.map(type => <option key={type} value={type}>{typeName(type)}</option>)}</select></label>
          <label>{t('tableFieldRole')}<select value={editor.column.role ?? 'attribute'} onChange={e => setEditor({ ...editor, column: { ...editor.column, role: e.target.value as DataTableColumn['role'] } })}><option value="attribute">{t('tableRoleAttribute')}</option><option value="dimension">{t('tableRoleDimension')}</option><option value="value">{t('tableRoleValue')}</option></select></label></div>
        {editor.column.type === 'select' ? <label>{t('tableChoices')}<textarea rows={3} value={(editor.column.options ?? []).join('\n')} onChange={e => setEditor({ ...editor, column: { ...editor.column, options: e.target.value.split('\n') } })} /></label> : null}
        <label>{t('tableUnit')}<input value={editor.column.unit ?? ''} onChange={e => setEditor({ ...editor, column: { ...editor.column, unit: e.target.value } })} /></label>
        <label>{t('tableDescription')}<textarea rows={3} value={editor.column.description ?? ''} onChange={e => setEditor({ ...editor, column: { ...editor.column, description: e.target.value } })} /></label>
        {fieldError ? <p role="alert" className="dsh-data-table-error">{fieldError}</p> : null}
        {editor.original ? <div className="dsh-data-table-field-order">
          {[[-1, t('tableMoveLeft'), ArrowLeft], [1, t('tableMoveRight'), ArrowRight]].map(([delta, title, Icon]) => {
            const index = table.columns.findIndex(c => c.id === editor.column.id), offset = Number(delta)
            const Symbol = Icon as typeof ArrowLeft
            return <button type="button" key={offset} disabled={index + offset < 0 || index + offset >= table.columns.length} onClick={() => {
              const columns = [...table.columns]; [columns[index], columns[index + offset]] = [columns[index + offset]!, columns[index]!]; emit({ ...table, columns })
            }}><Symbol size={14} />{String(title)}</button>
          })}<button type="button" className="is-danger" onClick={() => {
            if (window.confirm(t('tableDeleteFieldConfirm'))) { emit(removeTableColumn(table, editor.column.id)); setEditor(undefined) }
          }}><Trash2 size={14} />{t('tableDeleteField')}</button>
        </div> : null}
        <div className="dsh-data-table-dialog-actions"><button type="button" onClick={() => setEditor(undefined)}>{t('tableCancel')}</button><button type="button" className="is-primary" onClick={applyField}>{t('tableApply')}</button></div>
      </div>
    </div> : null}
  </div>
}
