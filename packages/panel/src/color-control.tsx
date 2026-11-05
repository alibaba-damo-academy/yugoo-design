import { usePanelI18n } from './panel-i18n.tsx'

/** Preserve arbitrary CSS color strings; the picker never normalizes stored
 * rgba()/var()/named colors into an unrelated default. */
export function ColorControl({ value, label, onChange, disabled = false }: {
  value: string; label: string; onChange: (value: string) => void; disabled?: boolean
}) {
  const { t } = usePanelI18n()
  const empty = !value.trim()
  const hex = /^#[a-f\d]{6}$/i.test(value) ? value : /^#[a-f\d]{3}$/i.test(value) ? `#${value.slice(1).split('').map(v => v + v).join('')}` : '#000000'
  return <span className="dsh-color-control"><span className="dsh-color-picker">
    <span className="dsh-color-swatch" aria-hidden="true" style={{ backgroundColor: empty ? undefined : value }}>{empty ? '—' : null}</span>
    <input type="color" value={hex} disabled={disabled} aria-label={`${label} · ${empty ? t('colorNotSet') + ' · ' : ''}HEX`}
      onChange={event => { if (!disabled) onChange(event.target.value) }} />
    </span><input type="text" value={value} placeholder={t('colorNotSet')} disabled={disabled} aria-label={label}
    onChange={event => { if (!disabled) onChange(event.target.value) }} /></span>
}
