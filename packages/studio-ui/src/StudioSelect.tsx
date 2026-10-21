import { createContext, createElement, useContext, type ReactElement } from 'react'

/** Host-neutral control contract; choosing only reports the exact caller value. */
export interface StudioSelectProps {
  readonly value: string
  readonly options: readonly { readonly value: string; readonly label: string; readonly disabled?: boolean }[]
  readonly onValueChange: (value: string) => void
  readonly disabled?: boolean
  readonly 'aria-label': string
  readonly className?: string
}

export type StudioSelectRenderer = (props: StudioSelectProps) => ReactElement
export const StudioSelectContext = createContext<StudioSelectRenderer | undefined>(undefined)

/** Hosts may supply their shared accessible control; minimal hosts keep a
 * controlled native select, including visible unknown values and disabled state. */
export function StudioSelect({ className, ...props }: StudioSelectProps): ReactElement {
  const renderer = useContext(StudioSelectContext)
  const controlProps = { ...props, className: `ygd-studio-select${className ? ` ${className}` : ''}` }
  if (renderer) return createElement(renderer, controlProps)
  const choices = props.options.some(option => option.value === props.value) ? props.options
    : [{ value: props.value, label: props.value, disabled: props.value !== '' }, ...props.options]
  return <select className={controlProps.className} aria-label={props['aria-label']} value={props.value} disabled={props.disabled}
    onChange={event => {
      const value = event.currentTarget.value
      if (!props.disabled && choices.some(option => option.value === value && !option.disabled)) props.onValueChange(value)
    }}>
    {choices.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select>
}
