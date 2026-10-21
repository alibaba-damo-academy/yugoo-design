import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { EditorField } from './dsl.ts'

/** Read-only facts use declared field labels/options, never an editable form. */
export function RecordFacts({ fields, value, rows, chips = [] }: {
  fields: readonly EditorField[]; value: Record<string, unknown>; rows: readonly (readonly string[])[]; chips?: readonly string[]
}) {
  const fieldOf = (key: string) => fields.find(field => field.key === key && !field.hidden)
  const hasValue = (key: string) => value[key] !== undefined && value[key] !== null && value[key] !== '' && (!Array.isArray(value[key]) || value[key].length > 0)
  return <div className="dsh-record-facts">{rows.map((row, index) => {
    const keys = row.filter(key => fieldOf(key) && hasValue(key))
    return keys.length ? <div className="dsh-record-facts-row" key={index}>{keys.map(key => {
      const field = fieldOf(key)!, content = value[key]
      return <section key={key}><h5>{field.label ?? key}</h5>
        {Array.isArray(content) ? field.columns ? <div className="dsh-record-facts-entries">{content.map((entry, ordinal) => <dl key={ordinal}>
          {field.columns!.map(column => <div key={column.key}><dt>{column.label}</dt><dd>{column.options?.find(option => option.value === entry?.[column.key])?.label ?? String(entry?.[column.key] ?? '')}</dd></div>)}
        </dl>)}</div> : chips.includes(key) ? <div className="dsh-record-facts-chips">{content.map((item, ordinal) => <span key={ordinal}>{String(item)}</span>)}</div>
          : <ul>{content.map((item, ordinal) => <li key={ordinal}>{String(item)}</li>)}</ul>
          : field.control === 'textarea' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(content)}</ReactMarkdown>
            : <p>{field.options?.find(option => option.value === content)?.label ?? String(content)}</p>}
      </section>
    })}</div> : null
  })}</div>
}
