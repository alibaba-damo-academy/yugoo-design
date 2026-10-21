import { useMemo, type ReactElement } from 'react'
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group.tsx'
import { useLang } from '../../host.ts'
import { stripRecommendationSuffix } from './recommendationLabel.ts'
import type { ISelection, ISingleChoiceSuggest } from './types.ts'

interface AIQuestionRadioConstProps {
  question?: string
  note?: string | null
  options: ISelection[]
  selectedOption: { selected_index: number; selected_value: string }
  onChange?: (value: string) => void
  suggest?: ISingleChoiceSuggest
  disabled: boolean
  is_answer: boolean
}

/** Fixed configuration card with one selectable value and an AI recommendation. */
export function AIQuestionRadioConst({
  question = '',
  note = '',
  options,
  selectedOption,
  disabled,
  suggest,
  onChange = () => {},
}: AIQuestionRadioConstProps): ReactElement {
  const t = useLang()
  const visibleOptions = useMemo(() => options, [options])

  return (
    <>
      <style>{`
        .ai-const-radio-item[data-state="checked"] {
          background-color: #FFFFFF;
        }
        .ai-const-radio-item[data-state="unchecked"] {
          background-color: #FFFFFF;
          border-color: var(--ds-border-default);
        }
        .ai-const-radio-item[data-state="checked"] svg {
          display: none;
        }
        .question_label::before {
          content: '';
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 6px;
          height: 6px;
          background-color: #10082B;
          border-radius: 50%;
        }
      `}</style>
      <div className='flex flex-col gap-3'>
        <div className='flex flex-col gap-[2px]'>
          <div className='question_label relative pl-[20px] text-sm font-medium leading-[26px] text-[var(--ds-text-9)]'>
            {question}
          </div>
          {note
            ? <div className='text-[14px] font-normal leading-[22px] text-[var(--ds-text-7)]'>{note}</div>
            : null}
        </div>

        <RadioGroup
          disabled={disabled}
          value={selectedOption.selected_value}
          onValueChange={(value) => { if (!disabled) onChange(value) }}
          className='question-const-radio flex flex-col gap-[12px]'
        >
          {visibleOptions.map((option, index) => {
            const isAISuggested = suggest?.selected_value === option.value
            const isSelected = option.value === selectedOption.selected_value
            return (
              <div
                key={`${option.index} ${option.label} ${index}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!disabled) onChange(option.value)
                }}
                className={`question-option-frame relative text-sm font-normal leading-[22px] ${
                  disabled ? 'is-disabled' : ''
                } ${isSelected ? 'is-selected' : ''}`}
              >
                <RadioGroupItem
                  value={option.value}
                  className='ai-const-radio-item'
                  onClick={(event) => { event.stopPropagation() }}
                />
                <label className='cursor-pointer text-sm font-normal leading-[22px] text-[var(--ds-text-9)]'>
                  {isAISuggested ? stripRecommendationSuffix(option.label) : option.label}
                </label>
                {isAISuggested
                  ? (
                    <span
                      className='absolute -right-1 -top-2 rounded-sm px-1.5 py-[3px] text-[11px] font-medium leading-none text-white'
                      style={{
                        background: 'linear-gradient(90deg, #865FF1 0%, #8A97EA 100%)',
                      }}
                    >
                      {t.ai_recommendation}
                    </span>
                  )
                  : null}
              </div>
            )
          })}
        </RadioGroup>
      </div>
    </>
  )
}
