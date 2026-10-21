import { browserRandomUuid } from './browser-uuid.ts'
import { newRecordMapItem } from './record-map-state.ts'
import type { ReactElement } from 'react'
import type { EditorField } from './dsl.ts'
import { usePanelI18n } from './panel-i18n.tsx'

/** Optional dimensions can be added on demand or shown as fixed inputs.
 * Neither presentation initializes missing canonical fields on viewing. */
export function CompactRecordDetails({ fields, values, optional, editable, render, change }: {
  fields: readonly EditorField[]; values: Record<string, unknown>; optional: boolean; editable: boolean
  render: (field: EditorField) => ReactElement; change: (field: EditorField, value: unknown) => void
}) {
  const { t } = usePanelI18n()
  const visible = fields.filter(field => !field.hidden)
  const missing = visible.filter(field => optional && !field.required && values[field.key] === undefined)
  return <div className="dsh-compact-record-details">
    {visible.filter(field => !missing.includes(field)).map(field => <section key={field.key} data-detail-control={field.control}>
      <header><h5>{field.label ?? field.key}{field.required ? <span className="dsh-design-required-mark" aria-hidden="true" title={t('requiredField')}> *</span> : null}</h5>{editable && optional && !field.required && !field.readonly && field.control !== 'record_map'
        ? <button type="button" aria-label={t('remove', { item: field.label ?? field.key })} onClick={() => change(field, undefined)}>{t('remove', { item: '' })}</button> : null}</header>
      {render(field)}
    </section>)}
    {editable && missing.some(field => !field.readonly) ? <div className="dsh-compact-detail-add"><span>{t('addDetails')}</span>
      {missing.filter(field => !field.readonly).map(field => <button key={field.key} type="button" onClick={() => { const id = `item-${browserRandomUuid()}`; change(field, field.control === 'record_map' ? { [id]: newRecordMapItem(field, id) } : '') }}>＋ {field.label ?? field.key}</button>)}
    </div> : null}
  </div>
}
