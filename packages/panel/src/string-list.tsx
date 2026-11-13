import { PanelTextarea } from './panel-textarea.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { PanelCollectionActions } from './panel-workspace.tsx'

/** One editor per complete string; punctuation, newlines and duplicate entries are data. */
export function StringList({ value, label, required, editable, onChange }: {
  value: unknown
  label: string
  required?: boolean
  editable: boolean
  onChange: (value: string[]) => void
}) {
  const { t } = usePanelI18n()
  const values = Array.isArray(value) ? value : []
  const canEdit = editable && (value === undefined || Array.isArray(value) && value.every(item => typeof item === 'string'))
  if (!canEdit) return <ul className="dsh-string-list-read">{values.map((item, index) => <li key={index}>{String(item)}</li>)}</ul>
  return <div className="dsh-string-list" role="group" aria-label={required ? t('requiredFieldName', { item: label }) : label}>
    {values.map((item, index) => <div className="dsh-string-list-item" key={index}>
      <PanelTextarea className="dsh-design-field-input" aria-label={`${label} ${index + 1}`} value={item}
        onChange={event => onChange(values.map((previous, position) => position === index ? event.target.value : previous))} />
      <PanelCollectionActions label={`${label} ${index + 1}`} first={index === 0} last={index === values.length - 1}
        onMove={delta => { const next = [...values]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; onChange(next) }}
        onRemove={() => onChange(values.filter((_, position) => position !== index))} />
    </div>)}
    <button type="button" className="dsh-design-record-add" onClick={() => onChange([...values, ''])}>+ {t('addItem', { item: label })}</button>
  </div>
}
