import { useEffect, useRef, useState } from 'react'
import { ChevronDown, MessageSquare, Plug, Plus, X } from 'lucide-react'
import type { FieldOption } from './dsl.ts'
import { usePanelI18n } from './panel-i18n.tsx'

/** Controlled string-list editor; labels/options are content, never domain code. */
export function TokenList(props: {
  value: unknown
  label: string
  options?: readonly FieldOption[]
  layout?: 'chips' | 'cards'
  addMode?: 'inline' | 'menu'
  addDescription?: string
  customIcon?: FieldOption['icon']
  customDescription?: string
  editable: boolean
  required?: boolean
  onChange: (value: string[]) => void
}) {
  const { t } = usePanelI18n()
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(false)
  const menuMode = props.addMode === 'menu'
  const glyph = (name: FieldOption['icon']) => name === 'message-square' ? <MessageSquare size={16} aria-hidden="true" /> : name === 'plug' ? <Plug size={16} aria-hidden="true" /> : null
  const menuDescription = (option: FieldOption) => (values.includes(option.value) ? option.selected_description : option.menu_description) ?? option.description
  const values = Array.isArray(props.value) ? props.value : []
  const valid = props.value === undefined || (Array.isArray(props.value) && props.value.every(value => typeof value === 'string'))
  const editable = props.editable && valid
  const close = () => { restoreFocus.current = true; setDraft(''); setMenuOpen(false); setCustomOpen(false) }
  const add = (next: string[]) => { props.onChange([...new Set([...values as string[], ...next])]); setDraft(''); if (menuMode) close() }
  const submit = () => { const next = draft.split(/[,，·;；\n]/).map(value => value.trim()).filter(Boolean); if (next.length) add(next) }
  useEffect(() => {
    if (!editable) { setMenuOpen(false); setCustomOpen(false); setDraft('') }
  }, [editable])
  useEffect(() => {
    if (!menuOpen) return
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menuOpen])
  useEffect(() => { if (customOpen && editable) input.current?.focus() }, [customOpen, editable])
  useEffect(() => {
    if (!menuOpen && !customOpen && restoreFocus.current) { restoreFocus.current = false; trigger.current?.focus() }
  }, [menuOpen, customOpen])
  const editor = <>
    <input ref={input} aria-label={t('newToken', { item: props.label })} placeholder={t('tokenPlaceholder')} value={draft} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); submit() }
        else if (menuMode && event.key === 'Escape') { event.preventDefault(); close() }
      }} />
    <button type="button" disabled={!draft.trim()} onClick={submit}>{t('add')}</button>
  </>
  return <div className={`dsh-token-list is-${props.layout ?? 'chips'}${menuMode ? ' is-menu' : ''}`} role="group"
    aria-label={props.required ? t('requiredFieldName', { item: props.label }) : props.label}>
    {!valid ? <p role="alert">{t('invalidTokens')}</p> : null}
    <div className="dsh-token-items">{values.map((value, index) => {
      const option = props.options?.find(option => option.value === value)
      return <span className="dsh-token-item" key={`${String(value)}:${index}`}>
        {props.layout === 'cards' && (option?.icon ?? props.customIcon) ? <span className="dsh-token-icon">{glyph(option?.icon ?? props.customIcon)}</span> : null}
        <span><strong>{option?.label ?? String(value)}</strong>
          {props.layout === 'cards' && (option?.description ?? props.customDescription) ? <small>{option?.description ?? props.customDescription}</small> : null}</span>
        {editable ? <button type="button" className="dsh-token-remove" aria-label={t('removeToken', { item: `${props.label}${option?.label ?? value}` })}
          title={t('removeToken', { item: `${props.label}${option?.label ?? value}` })}
          onClick={() => props.onChange((values as string[]).filter((_, i) => i !== index))}><X size={16} aria-hidden="true" /></button> : null}
      </span>
    })}
    {editable && menuMode ? <div className="dsh-token-menu-add">
      <button ref={trigger} type="button" className="dsh-token-add-trigger" aria-haspopup="menu" aria-expanded={menuOpen}
        hidden={customOpen} onClick={() => setMenuOpen(!menuOpen)}
        onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setMenuOpen(true) } }}>
        <Plus size={16} aria-hidden="true" /><span className="dsh-token-copy"><strong>{t('addTokens', { item: props.label })}</strong>{props.addDescription ? <small>{props.addDescription}</small> : null}</span><ChevronDown size={16} aria-hidden="true" />
      </button>
      {menuOpen ? <div ref={menu} role="menu" aria-label={t('chooseTokens', { item: props.label })} className="dsh-token-menu"
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); close(); return }
          if (event.key === 'Tab') { setMenuOpen(false); return }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
          buttons[index]?.focus()
        }}>
        {props.options?.map(option => <button key={option.value} type="button" role="menuitem" tabIndex={-1} disabled={values.includes(option.value)} onClick={() => add([option.value])}>
          {glyph(option.icon)}<span className="dsh-token-copy"><strong>{option.label}</strong>{menuDescription(option) ? <small>{menuDescription(option)}</small> : null}</span>
        </button>)}
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => { setMenuOpen(false); setCustomOpen(true) }}>
          {glyph(props.customIcon)}<span className="dsh-token-copy"><strong>{t('otherTokens', { item: props.label })}</strong>{props.customDescription ? <small>{props.customDescription}</small> : null}</span>
        </button>
      </div> : null}
      {customOpen ? <div className="dsh-token-custom-card">
        <div className="dsh-token-custom-header"><strong>{t('otherTokens', { item: props.label })}</strong>
          <button type="button" aria-label={t('cancelTokens', { item: props.label })} onClick={close}><X size={16} aria-hidden="true" /></button></div>
        <div className="dsh-token-add">{editor}</div>
      </div> : null}
    </div> : null}</div>
    {editable && !menuMode ? <div className="dsh-token-add">
      {props.options?.length ? <select aria-label={t('chooseTokens', { item: props.label })} value="" onChange={event => { if (event.target.value) add([event.target.value]) }}>
        <option value="">{t('addPreset')}</option>{props.options.map(option => <option key={option.value} value={option.value} disabled={values.includes(option.value)}>{option.label}</option>)}
      </select> : null}
      {editor}
    </div> : null}
  </div>
}
