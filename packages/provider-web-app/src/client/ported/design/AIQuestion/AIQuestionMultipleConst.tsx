import { useMemo, type ReactElement } from 'react'
import { Checkbox } from '../../ui/checkbox.tsx'
import { useLang } from '../../host.ts'
import { normalizeQuestionSelectedValues } from './questionState.ts'
import { stripRecommendationSuffix } from './recommendationLabel.ts'
import type { ISelection } from './types.ts'

interface AIQuestionMultipleConstProps {
  question?: string
  note?: string | null
  options: ISelection[]
  selectedOptions?: unknown
  disabled: boolean
  onChange?: (values: string[]) => void
  is_answer: boolean
  suggest?: unknown
}

/** Fixed configuration card with multiple selectable values and AI recommendations. */
export function AIQuestionMultipleConst({
  question = '',
  note = '',
  options,
  selectedOptions = [],
  suggest = [],
  disabled,
  onChange = () => {},
}: AIQuestionMultipleConstProps): ReactElement {
  const t = useLang()
  const normalizedSelectedOptions = useMemo(
    () => normalizeQuestionSelectedValues(selectedOptions),
    [selectedOptions],
  )
  const normalizedSuggest = useMemo(
    () => normalizeQuestionSelectedValues(suggest),
    [suggest],
  )

  return (
    <>
      <div className='flex flex-col gap-3 rounded-xl border border-[var(--ds-fill-6)] bg-[var(--ds-fill-1)] px-4 py-3'>
        <div className='flex flex-col gap-[2px]'>
          <div className='text-md font-medium leading-[26px] text-[var(--ds-text-primary)]'>{question}</div>
          {note
            ? <div className='text-[14px] font-normal leading-[22px] text-[var(--ds-text-7)]'>{note}</div>
            : null}
        </div>

        <div className='flex flex-col gap-[12px]'>
          {options.map((option, index) => {
            const isAISuggested = normalizedSuggest.includes(option.value)
            const isSelected = normalizedSelectedOptions.includes(option.value)
            return (
              <div
                key={index}
                className={`question-option-frame relative ${disabled ? 'is-disabled' : ''} ${
                  isSelected ? 'is-selected' : ''
                }`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (disabled) return
                  onChange(isSelected
                    ? normalizedSelectedOptions.filter((value) => value !== option.value)
                    : [...normalizedSelectedOptions, option.value])
                }}
              >
                <Checkbox
                  disabled={disabled}
                  id={`checkbox-const-${option.value}`}
                  checked={isSelected}
                  onCheckedChange={() => {}}
                />
                <label className='cursor-pointer text-sm font-normal leading-[22px] text-[var(--ds-text-primary)]'>
                  {isAISuggested ? stripRecommendationSuffix(option.label) : option.label}
                </label>
                {isAISuggested
                  ? (
                    <div
                      className='absolute -right-2 -top-1.5 rounded-sm px-1.5 py-[3px] text-[10px] font-medium leading-none text-white'
                      style={{
                        background: 'linear-gradient(90deg, #865FF1 0%, #8A97EA 100%)',
                        transform: 'scale(0.85)',
                        transformOrigin: 'top right',
                      }}
                    >
                      {t.ai_recommendation}
                    </div>
                  )
                  : null}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
