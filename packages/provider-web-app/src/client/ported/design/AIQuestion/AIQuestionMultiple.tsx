import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Checkbox } from '../../ui/checkbox.tsx'
import { IconFont } from '../../ui/icon-font.tsx'
import { Input } from '../../ui/input.tsx'
import { useLang } from '../../host.ts'
import { AnswerInfo } from './AnswerInfo.tsx'
import { QuestionImageAttachments } from './QuestionImageAttachments.tsx'
import { formatQuestionDisplayText, isMeaningfulSelectedValue } from './questionAnswerDisplay.ts'
import type { IMultimodalAnswer, ISelection } from './types.ts'

interface AIQuestionMultipleProps {
  question?: string
  note?: string | null
  options: ISelection[]
  selectedOptions: string[]
  disabled: boolean
  defaultCollapsed?: boolean
  collapseOnSaved?: boolean
  preserveExpanded?: boolean
  onSupplement?: (value: string) => void
  onChange?: (values: string[]) => void
  onReject?: () => void
  is_answer: boolean
  supplement: string
  inlineOptions?: boolean
  multimodalAnswer?: readonly IMultimodalAnswer[]
  onMultimodalAnswerChange?: (value: readonly IMultimodalAnswer[]) => void
  onUploadFiles?: (files: readonly File[]) => Promise<void>
  resolveImagePreview?: (image: IMultimodalAnswer) => Promise<string | undefined>
}

/** Editable multiple-choice smart-question card. */
export function AIQuestionMultiple({
  question = '',
  note = '',
  options,
  selectedOptions = [],
  disabled,
  defaultCollapsed = false,
  collapseOnSaved = false,
  preserveExpanded = false,
  is_answer = false,
  onSupplement = () => {},
  onChange = () => {},
  onReject = () => {},
  supplement,
  inlineOptions = false,
  multimodalAnswer = [],
  onMultimodalAnswerChange,
  onUploadFiles,
  resolveImagePreview,
}: AIQuestionMultipleProps): ReactElement {
  const meaningfulSelectedOptions = useMemo(
    () => selectedOptions.filter(isMeaningfulSelectedValue),
    [selectedOptions],
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

  const visibleOptions = useMemo(
    () => isExpanded ? options : options.filter((option) => meaningfulSelectedOptions.includes(option.value)),
    [isExpanded, meaningfulSelectedOptions, options],
  )
  const isAllSelected = useMemo(
    () => options.length > 0 && selectedOptions.length === options.length,
    [options.length, selectedOptions.length],
  )

  const handleToggleSelectAll = (): void => {
    onChange(isAllSelected ? [] : options.map((option) => option.value))
  }

  return (
    <>
      <div className='group flex flex-col gap-3 rounded-xl border border-[var(--ds-fill-6)] bg-[var(--ds-fill-1)] px-4 py-3'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex flex-col gap-[2px]'>
            <div className='text-md font-medium leading-[26px] text-[var(--ds-text-primary)]'>{question}</div>
            {note
              ? <div className='text-[14px] font-normal leading-[22px] text-[var(--ds-text-7)]'>{note}</div>
              : null}
          </div>

          <div className='flex items-center gap-[10px] opacity-100 transition-opacity duration-200 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100'>
            {!disabled && isExpanded
              ? (
                <div
                  onClick={handleToggleSelectAll}
                  className='w-[max-content] cursor-pointer text-sm font-normal text-[var(--ds-text-9)] transition-colors hover:text-[var(--ds-brand-text-primary)]'
                >
                  {isAllSelected ? t.button_deselect_all : t.button_select_all}
                </div>
              )
              : null}
            <div className='flex items-center gap-[8px]'>
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
        </div>

        {isExpanded
          ? (
            <div className={inlineOptions ? 'flex flex-wrap gap-3' : 'flex flex-col gap-3'}>
              {options.map((option, index) => (
                <div
                  key={index}
                  className={`question-option-frame ${disabled ? 'is-disabled' : ''} ${
                    selectedOptions.includes(option.value) ? 'is-selected' : ''
                  }`}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (disabled) return
                    onChange(selectedOptions.includes(option.value)
                      ? selectedOptions.filter((value) => value !== option.value)
                      : [...selectedOptions, option.value])
                  }}
                >
                  <Checkbox
                    disabled={disabled}
                    id={`checkbox-${option.value}`}
                    checked={selectedOptions.includes(option.value)}
                    onCheckedChange={() => {}}
                  />
                  <label className='cursor-pointer text-sm font-normal leading-[22px] text-[var(--ds-text-primary)]'>
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
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
        {!isExpanded
          ? (
            <div className={inlineOptions ? 'flex flex-wrap gap-3' : 'contents'}>
              {visibleOptions.map((option) => (
                <AnswerInfo key={option.index} data={option.label} className={inlineOptions ? 'w-auto' : ''} />
              ))}
              {hasSupplement
                ? <AnswerInfo data={supplement} className={inlineOptions ? 'basis-full' : ''} />
                : null}
              {meaningfulSelectedOptions.length === 0 && !hasSupplement && !hasMultimodalAnswer
                ? <AnswerInfo data={notSelectedText} variant='muted' />
                : null}
            </div>
          )
          : null}
      </div>
    </>
  )
}
