import { PanelTextarea } from './panel-textarea.tsx'
import { Children, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { browserRandomUuid } from './browser-uuid.ts'
import type { EditorField } from './dsl.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { PanelDisclosureIcon, PanelFieldCaption } from './panel-workspace.tsx'
import { moveRecordMapItem, newRecordMapItem, recordMapPatch, recordMapState } from './record-map-state.ts'

/** Shared by field rendering and its containing form: compact rows do not own record cards. */
export function isCompactRecordMap(field: EditorField, compactFields = false): boolean {
  return compactFields || Boolean((field.columns?.length ?? 0) > 1 && !field.item_fields && !field.item_collapsible)
}

/** Ordered nested records. Writes map + sibling order together, with opaque ids. */
export function RecordMap(props: { field: EditorField; record: Record<string, unknown>; editable: boolean; compact?: boolean; onPatch: (patch: Record<string, unknown>) => void;
  renderItem?: (id: string, value: Record<string, unknown>, change: (next: Record<string, unknown>) => void) => ReactNode }) {
  const { field, record } = props, { t } = usePanelI18n()
  const [expanded, setExpanded] = useState<string | null>()
  const state = recordMapState(field, record)
  if (!state) return <p role="alert">{t('invalidRecords')}</p>
  const { items, ids } = state
  const emit = (next: typeof items, order = ids) => { if (props.editable) props.onPatch(recordMapPatch(field, next, order)) }
  const columns = field.columns ?? []
  const addLabel = t('addItem', { item: field.row_name ?? field.label ?? field.key })
  const tabular = props.compact && columns.length > 1 && !field.item_collapsible && !field.item_fields && !props.renderItem
  const renderActions = (id: string, index: number, open: boolean) => props.editable ? <div className="dsh-record-map-actions dsh-design-record-actions dsh-panel-record-actions">
    {field.order_field ? <><button type="button" aria-label={`${t('moveUp')} ${index + 1}`} disabled={index === 0}
      onClick={event => { event.preventDefault(); emit(items, moveRecordMapItem(ids, id, -1)) }}><ArrowUp size={16} aria-hidden="true" /></button>
    <button type="button" aria-label={`${t('moveDown')} ${index + 1}`} disabled={index === ids.length - 1}
      onClick={event => { event.preventDefault(); emit(items, moveRecordMapItem(ids, id, 1)) }}><ArrowDown size={16} aria-hidden="true" /></button></> : null}
    <button type="button" aria-label={t('remove', { item: `${field.row_name ?? field.label} ${index + 1}` })} onClick={event => {
      event.preventDefault()
      const next = { ...items }; delete next[id]; const order = ids.filter(key => key !== id); emit(next, order)
      if (open) setExpanded(order[0] ?? null)
    }}><Trash2 size={16} aria-hidden="true" /></button>
  </div> : null
  const renderColumn = (column: NonNullable<EditorField['columns']>[number], id: string, index: number) => {
    const text = String(items[id]![column.key] ?? '')
    const change = (text: string) => emit({ ...items, [id]: { ...items[id], [column.key]: column.format === 'upper_identifier' ? text.toUpperCase().replace(/[^A-Z0-9_]/g, '_') : text } })
    return !props.editable ? <span>{text}</span>
      : column.control === 'textarea' ? <PanelTextarea aria-label={`${column.label} ${index + 1}`} aria-required={column.required || undefined} value={text} onChange={event => change(event.target.value)} />
      : column.control === 'select' ? <select aria-label={`${column.label} ${index + 1}`} aria-required={column.required || undefined} value={text} onChange={event => change(event.target.value)}>
        <option value="" />{text && !column.options?.some(option => option.value === text) ? <option value={text}>{text}</option> : null}
        {column.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      : <input aria-label={`${column.label} ${index + 1}`} aria-required={column.required || undefined} value={text} onChange={event => change(event.target.value)} />
  }
  return <div className={`dsh-record-map${props.compact ? ' is-compact' : ''}`} data-record-map={field.key}>
    {tabular ? <div className="dsh-record-map-table-scroll" tabIndex={0} role="region" aria-label={field.label ?? field.key}>
      <table className="dsh-record-map-table" aria-label={field.label ?? field.key}
        style={{ minWidth: columns.length * 180 + 48 + (props.editable ? field.order_field ? 112 : 44 : 0) }}>
        <colgroup><col style={{ width: 48 }} />{columns.map(column => <col key={column.key} />)}{props.editable ? <col style={{ width: field.order_field ? 112 : 44 }} /> : null}</colgroup>
        <thead><tr><th scope="col">{t('rowNumber')}</th>{columns.map(column => <th scope="col" key={column.key}><PanelFieldCaption label={column.label} required={column.required} /></th>)}{props.editable ? <th scope="col" aria-label={t('edit')} /> : null}</tr></thead>
        <tbody>{ids.map((id, index) => <tr key={id} data-child-record={id} aria-label={`${field.row_name ?? field.label ?? t('row')} ${index + 1}`}>
          <th scope="row"><span>{index + 1}.</span></th>
          {columns.map(column => <td key={column.key}>{renderColumn(column, id, index)}</td>)}
          {props.editable ? <td>{renderActions(id, index, true)}</td> : null}
        </tr>)}</tbody>
      </table>
    </div> : ids.map((id, index) => {
      const label = field.item_label_field && typeof items[id]![field.item_label_field] === 'string' && items[id]![field.item_label_field]
        ? String(items[id]![field.item_label_field]) : `${field.row_name ?? field.label ?? field.key} ${index + 1}`
      const open = !field.item_collapsible || (expanded === undefined ? ids[0] : expanded) === id
      const content = [
        ...Children.toArray(field.item_fields ? props.renderItem?.(id, items[id]!, next => emit({ ...items, [id]: next })) : null),
        ...columns.map(column => <label key={column.key}><span><PanelFieldCaption label={column.label} required={column.required} /></span>{renderColumn(column, id, index)}</label>),
      ]
      const cardClass = `dsh-panel-record-action-context${props.compact ? '' : ' dsh-panel-content-card'}${props.editable ? ' is-editing' : ''}`
      if (field.item_collapsible) return <details key={id} data-child-record={id} className={cardClass} open={open}
        onToggle={event => {
          if (event.target !== event.currentTarget) return
          const nextOpen = event.currentTarget.open
          setExpanded(current => {
            const currentId = current === undefined ? ids[0] : current
            if (nextOpen) return currentId === id ? current : id
            return currentId === id ? null : current
          })
        }}>
        <summary className="dsh-record-map-heading dsh-panel-disclosure">
          <span className="dsh-panel-disclosure-label">{label}</span>
          {renderActions(id, index, open)}
          <PanelDisclosureIcon expanded={false} />
        </summary>
        {props.compact ? content : content.length > 0 ? <div className="dsh-record-map-body">{content}</div> : null}
      </details>
      return <section key={id} data-child-record={id} className={cardClass}>
      <header><strong>{props.compact ? `${index + 1}.` : label}</strong>
        {renderActions(id, index, open)}</header>
      {props.compact ? content : content.length > 0 ? <div className="dsh-record-map-body">{content}</div> : null}
    </section>})}
    {props.editable ? <button type="button" className="dsh-record-map-add" aria-label={addLabel} title={addLabel} disabled={ids.length >= (field.max_rows ?? 50)} onClick={() => {
      let id = `item-${browserRandomUuid()}`
      while (Object.hasOwn(items, id)) id = `item-${browserRandomUuid()}`
      emit({ ...items, [id]: newRecordMapItem(field, id) }, [...ids, id])
      setExpanded(id)
    }}><Plus size={16} aria-hidden="true" />{field.label || props.compact ? t('add') : addLabel}</button> : null}
  </div>
}
