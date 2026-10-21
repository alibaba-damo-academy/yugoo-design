import { useState, type ReactElement } from 'react'
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group.tsx'

interface SimpleRadioProps {
  /** Option value to visible label. */
  options: Record<string, string>
  /** Initial value in uncontrolled mode and the AI-recommended marker. */
  defaultValue?: string
  /** Current value in controlled mode. */
  value?: string
  /** Receives the selected stable value. */
  onChange?: (value: string) => void
  className?: string
}

/** Compact controlled or uncontrolled radio-card group. */
export default function SimpleRadio({
  options,
  defaultValue,
  value: controlledValue,
  onChange,
  className = '',
}: SimpleRadioProps): ReactElement {
  const [internalValue, setInternalValue] = useState(defaultValue ?? Object.keys(options)[0] ?? '')
  const currentValue = controlledValue ?? internalValue

  const handleChange = (newValue: string): void => {
    if (controlledValue === undefined) setInternalValue(newValue)
    onChange?.(newValue)
  }

  return (
    <RadioGroup
      value={currentValue}
      onValueChange={handleChange}
      className={`flex gap-[12px] ${className}`}
      style={{ flexWrap: 'wrap', width: 'max-content' }}
    >
      {Object.entries(options).map(([key, label]) => {
        const isSelected = currentValue === key
        const isAI = key === defaultValue
        return (
          <div
            key={key}
            className={`relative flex cursor-pointer items-center rounded-lg border px-3 py-1.5 transition-colors ${
              isSelected ? 'border-purple-600' : 'border-gray-300 bg-white hover:border-purple-400'
            }`}
            style={{ height: 32 }}
          >
            <RadioGroupItem value={key} id={`radio-${key}`} className='sr-only' />
            <label
              htmlFor={`radio-${key}`}
              className={`cursor-pointer truncate text-sm ${isSelected ? 'text-purple-600' : 'text-gray-500'}`}
              style={{ fontSize: 14, lineHeight: '20px' }}
              title={label}
            >
              {label}
            </label>
            {isAI
              ? (
                <div
                  className='absolute -right-1 -top-1 flex items-center justify-center rounded-md'
                  style={{ backgroundColor: '#663AE8', width: 18, height: 12 }}
                >
                  <span className='text-center text-xs text-white' style={{ fontSize: 8, lineHeight: '8px' }}>AI</span>
                </div>
              )
              : null}
          </div>
        )
      })}
    </RadioGroup>
  )
}
