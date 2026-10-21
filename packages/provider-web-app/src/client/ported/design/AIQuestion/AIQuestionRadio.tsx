import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Input } from '../../ui/input.tsx'
import { IconFont } from '../../ui/icon-font.tsx'
import { RadioGroup, RadioGroupItem } from '../../ui/radio-group.tsx'
import { useLang } from '../../host.ts'
import { AnswerInfo } from './AnswerInfo.tsx'
import { QuestionImageAttachments } from './QuestionImageAttachments.tsx'
import { formatQuestionDisplayText, isMeaningfulSelectedValue } from './questionAnswerDisplay.ts'
import type { IMultimodalAnswer, ISelection } from './types.ts'

interface AIQuestionRadioProps {
  question?: string
  note?: string | null
  options: ISelection[]
  selectedOption: { selected_index: number; selected_value: string }
  onChange?: (value: string) => void
  onReject: () => void
  onSupplement?: (value: string) => void
  onFlipType?: () => void
  disabled: boolean
  defaultCollapsed?: boolean
  collapseOnSaved?: boolean
  preserveExpanded?: boolean
  is_answer: boolean
  supplement: string
  multimodalAnswer?: readonly IMultimodalAnswer[]
  onMultimodalAnswerChange?: (value: readonly IMultimodalAnswer[]) => void
  onUploadFiles?: (files: readonly File[]) => Promise<void>
  resolveImagePreview?: (image: IMultimodalAnswer) => Promise<string | undefined>
}

/** Editable single-choice smart-question card. */
export function AIQuestionRadio({
  question = '',
  note = '',
  options,
  selectedOption,
  disabled,
  defaultCollapsed = false,
  collapseOnSaved = false,
  preserveExpanded = false,
  is_answer = false,
  onChange = () => {},
  onReject = () => {},
  onSupplement = () => {},
  onFlipType = () => {},
  supplement = '',
  multimodalAnswer = [],
  onMultimodalAnswerChange,
  onUploadFiles,
  resolveImagePreview,
}: AIQuestionRadioProps): ReactElement {
  const hasSelectedOption = useMemo(
    () => isMeaningfulSelectedValue(selectedOption.selected_value),
    [selectedOption.selected_value],
  )
  const hasSupplement = useMemo(() => Boolean(supplement.trim()), [supplement])
  const hasMultimodalAnswer = multimodalAnswer.length > 0
  const [isExpanded, setIsExpanded] = useState(() => preserveExpanded ? true : defaultCollapsed ? false : !is_answer)
  const prevDisabledRef = useRef(disabled)
  const prevDefaultCollapsedRef = useRef(defaultCollapsed)
  const t = useLang()
  const notSelectedText = formatQuestionDisplayText(
    t.design_question_not_selected,
    'design_question_not_selected',
    '未回答',
  )

  useEffect(() => {
    if (!prevDisabledRef.current && disabled) setIsExpanded(false)
    prevDisabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    const defaultCollapsedChanged = prevDefaultCollapsedRef.current !== defaultCollapsed
    prevDefaultCollapsedRef.current = defaultCollapsed
    if (!defaultCollapsedChanged) return
    setIsExpanded(defaultCollapsed ? false : !is_answer)
  }, [defaultCollapsed, is_answer])

  useEffect(() => {
    if (collapseOnSaved) setIsExpanded(false)
  }, [collapseOnSaved])

  useEffect(() => {
    if (preserveExpanded && !disabled) setIsExpanded(true)
  }, [disabled, preserveExpanded])

  const visibleOptions = useMemo(() => {
    if (isExpanded) return options
    if (!hasSelectedOption) return []
    return options.filter((option) => option.value === selectedOption.selected_value)
  }, [hasSelectedOption, isExpanded, options, selectedOption.selected_value])

  return (
    <>
      <style>{`
        .ai-radio-item[data-state="checked"] {
          background-color: #FFFFFF;
        }
        .ai-radio-item[data-state="unchecked"] {
          background-color: #FFFFFF;
          border-color: var(--ds-border-default);
        }
        .ai-radio-item[data-state="checked"] svg {
          display: none;
        }
      `}</style>
      <div className='group flex flex-col gap-3 rounded-xl border border-[var(--ds-fill-6)] bg-[var(--ds-fill-1)] px-4 py-3'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-md font-medium leading-[26px] text-[var(--ds-text-primary)]'>{question}</div>
            {note
              ? <div className='text-[14px] font-normal leading-[22px] text-[var(--ds-text-7)]'>{note}</div>
              : null}
          </div>
          <div className='flex items-center gap-[8px] opacity-100 transition-opacity duration-200 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100'>
            {!isExpanded
              ? (
                <div
                  data-tip-id='tip_qa_edit_answer'
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!disabled) setIsExpanded(!isExpanded)
                  }}
                  className={`flex h-[26px] items-center gap-[4px] text-sm font-normal transition-colors ${
                    disabled
                      ? 'cursor-not-allowed text-[var(--ds-text-4)]'
                      : 'cursor-pointer text-[var(--ds-text-9)] hover:text-[var(--ds-brand-text-primary)]'
                  }`}
                >
                  <IconFont type='icon-line-operation-edit' />
                  <span className='whitespace-nowrap'>{t.button_edit}</span>
                </div>
              )
              : null}
            {isExpanded
              ? (
                <div
                  data-tip-id='tip_qa_flip_type'
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!disabled) onFlipType()
                  }}
                  className={`flex h-[26px] items-center gap-[4px] text-sm font-normal transition-colors ${
                    disabled
                      ? 'cursor-not-allowed text-[var(--ds-text-4)]'
                      : 'cursor-pointer text-[var(--ds-text-9)] hover:text-[var(--ds-brand-text-primary)]'
                  }`}
                >
                  <IconFont type='icon-gaiweiduoxuan' />
                  <span className='whitespace-nowrap'>{t.design_question_switch_multiple}</span>
                </div>
              )
              : null}
            <div
              data-tip-id='tip_qa_reject_question'
              onClick={(event) => {
                event.stopPropagation()
                if (!disabled) onReject()
              }}
              className={`flex h-[26px] items-center gap-[4px] text-sm font-normal transition-colors ${
                disabled
                  ? 'cursor-not-allowed text-[var(--ds-text-4)]'
                  : 'cursor-pointer text-[var(--ds-text-9)] hover:text-[var(--ds-brand-text-primary)]'
              }`}
            >
              <IconFont className='text-[18px]' type='icon-line-operation-close' />
              <div className='whitespace-nowrap'>{t.button_reject}</div>
            </div>
          </div>
        </div>

        {isExpanded
          ? (
            <RadioGroup
              disabled={disabled}
              value={selectedOption.selected_value}
              onValueChange={(value) => { if (!disabled) onChange(value) }}
              className='question-radio flex flex-col gap-[12px]'
            >
              {options.map((option, index) => (
                <div
                  key={`${option.index} ${option.label} ${index}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (!disabled) onChange(option.value)
                  }}
                  className={`question-option-frame ${disabled ? 'is-disabled' : ''} ${
                    option.value === selectedOption.selected_value ? 'is-selected' : ''
                  }`}
                >
                  <RadioGroupItem
                    value={option.value}
                    className='ai-radio-item'
                    onClick={(event) => { event.stopPropagation() }}
                  />
                  <label className='cursor-pointer text-sm font-normal leading-[22px] text-[var(--ds-text-primary)]'>
                    {option.label}
                  </label>
                </div>
              ))}
            </RadioGroup>
          )
          : null}
        <QuestionImageAttachments
          images={multimodalAnswer}
          editable={isExpanded}
          disabled={disabled}
          onChange={onMultimodalAnswerChange}
          onUploadFiles={onUploadFiles}
          resolvePreview={resolveImagePreview}
        >
          {isExpanded
            ? (
              <Input
                value={supplement}
                className='w-full shadow-none disabled:opacity-100'
                onChange={(event) => { onSupplement(event.target.value) }}
                disabled={disabled}
                placeholder={t.question_additions}
              />
            )
            : null}
        </QuestionImageAttachments>
        {!isExpanded && visibleOptions.length > 0 ? <AnswerInfo data={visibleOptions[0]?.label ?? ''} /> : null}
        {!isExpanded && hasSupplement ? <AnswerInfo data={supplement} /> : null}
        {!isExpanded && !hasSelectedOption && !hasSupplement && !hasMultimodalAnswer
          ? <AnswerInfo data={notSelectedText} variant='muted' />
          : null}
      </div>
    </>
  )
}
