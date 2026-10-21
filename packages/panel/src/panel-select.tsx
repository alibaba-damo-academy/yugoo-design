import { useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { PANEL_SELECT_MENU_CSS } from './client/styles.ts'

export interface PanelSelectOption { value: string; label: string; disabled?: boolean }

interface PanelSelectProps extends Omit<ComponentPropsWithoutRef<typeof Select.Trigger>, 'value' | 'defaultValue' | 'onChange' | 'children'> {
  value: string
  options: readonly PanelSelectOption[]
  onValueChange: (value: string) => void
}

/** Capture the trigger's actual theme before moving the menu outside clipped
 * workspaces. The popup owns its styles; it does not reset the host/body theme. */
function menuTheme(trigger: HTMLElement): CSSProperties {
  const computed = trigger.ownerDocument.defaultView!.getComputedStyle(trigger)
  const theme: Record<string, string> = {}
  for (let index = 0; index < computed.length; index += 1) {
    const property = computed[index]!
    if (/^--(?:ds-|ygd-|font-|z-)/u.test(property)) theme[property] = computed.getPropertyValue(property)
  }
  for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'color', 'colorScheme', 'direction'] as const) theme[property] = computed[property]
  return theme as CSSProperties
}

/** Shared single-value choice. Values remain caller-owned, including unknown
 * stored values; Radix owns keyboard navigation, focus and popup positioning. */
export function PanelSelect({ value, options, onValueChange, className, disabled, ...props }: PanelSelectProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [theme, setTheme] = useState<CSSProperties>()
  const unique = [...new Map(options.map(option => [option.value, option])).values()]
  const values = new Set(unique.map(option => option.value))
  const choices = values.has(value) ? unique : [{ value, label: value, disabled: value !== '' }, ...unique]
  // Radix reserves the empty string for its placeholder. Keep that translation
  // internal and collision-free; callers still read and write the exact value.
  let empty = '__ygd_empty__'
  while (values.has(empty) || value === empty) empty += '_'
  const encode = (item: string) => item === '' ? empty : item
  const selected = choices.find(option => option.value === value)
  return <Select.Root value={encode(value)} disabled={disabled} onOpenChange={open => {
    if (open && trigger.current) setTheme(menuTheme(trigger.current))
  }} onValueChange={next => {
    const decoded = next === empty ? '' : next
    if (!disabled && choices.some(option => option.value === decoded && !option.disabled)) onValueChange(decoded)
  }}>
    <Select.Trigger {...props} ref={trigger} value={value} disabled={disabled} className={`dsh-panel-select-trigger${className ? ` ${className}` : ''}`}>
      <Select.Value>{selected?.label || '\u00a0'}</Select.Value>
      <Select.Icon className="dsh-panel-select-icon"><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
    </Select.Trigger>
    <Select.Portal container={trigger.current?.closest<HTMLDialogElement>('dialog[open]') ?? trigger.current?.ownerDocument.body}>
      <Select.Content className="dsh-panel-select-content" style={theme} position="popper" sideOffset={4} collisionPadding={8}>
        <style>{PANEL_SELECT_MENU_CSS}</style>
        <Select.ScrollUpButton className="dsh-panel-select-scroll"><ChevronUp size={16} aria-hidden="true" /></Select.ScrollUpButton>
        <Select.Viewport className="dsh-panel-select-viewport">
          {choices.map(option => <Select.Item key={option.value} value={encode(option.value)} data-value={option.value} disabled={option.disabled} className="dsh-panel-select-option">
            <Select.ItemText>{option.label || '\u00a0'}</Select.ItemText>
            <Select.ItemIndicator className="dsh-panel-select-indicator"><Check size={16} aria-hidden="true" /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
        <Select.ScrollDownButton className="dsh-panel-select-scroll"><ChevronDown size={16} aria-hidden="true" /></Select.ScrollDownButton>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
}
