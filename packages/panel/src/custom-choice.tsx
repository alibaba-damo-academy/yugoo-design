import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { FieldOption } from './dsl.ts'
import { usePanelI18n } from './panel-i18n.tsx'

/** Presets with an editable custom value; stored facts stay ordinary strings. */
export function CustomChoice(props: { value: string; options: readonly FieldOption[]; label: string; placeholder?: string; editable: boolean;
  required?: boolean; layout?: 'column' | 'row_wrap' | 'row_scroll'; customFocus?: boolean; onChange: (value: string) => void }) {
  const name = useId(), { t } = usePanelI18n()
  const [customSelected, setCustomSelected] = useState(false)
  const [, setFocusRequest] = useState(0)
  const customInput = useRef<HTMLInputElement>(null), pendingFocus = useRef(false)
  const known = props.options.some(option => option.value === props.value)
  const custom = !known && (props.value !== '' || customSelected)
  const requestFocus = () => {
    if (!props.customFocus) return
    pendingFocus.current = true
    setFocusRequest(previous => previous + 1)
  }
  useLayoutEffect(() => {
    if (pendingFocus.current && props.editable && custom && customInput.current) {
      customInput.current.focus()
      pendingFocus.current = false
    } else if (!props.editable) pendingFocus.current = false
  })
  if (!props.editable) return <span className="dsh-design-field-value">{props.options.find(option => option.value === props.value)?.label ?? props.value}</span>
  return <div className={`dsh-custom-choice${props.layout ? ' has-choice-layout' : ''}`} role="radiogroup" aria-label={props.label} aria-required={props.required || undefined}>
    <div className={`dsh-design-field-choices${props.layout ? ` is-${props.layout}` : ''}`}>
      {props.options.map(option => <label className="dsh-design-field-choice" key={option.value}>
        <input type="radio" name={name} checked={props.value === option.value} onClick={() => { pendingFocus.current = false }} onChange={() => { pendingFocus.current = false; setCustomSelected(false); props.onChange(option.value) }} />
        {option.label}
      </label>)}
      <label className="dsh-design-field-choice"><input type="radio" name={name} checked={custom}
        onClick={() => { if (custom) requestFocus() }}
        onChange={() => { setCustomSelected(true); requestFocus(); if (known) props.onChange('') }} />{t('other')}</label>
    </div>
    {custom ? <input ref={customInput} className="dsh-design-field-input" aria-label={t('customValue', { item: props.label })} aria-required={props.required || undefined} placeholder={props.placeholder} value={props.value} onChange={event => props.onChange(event.target.value)} /> : null}
  </div>
}
