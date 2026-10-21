import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Textarea } from '../../ui/textarea.tsx'
import { IconFont } from '../../ui/icon-font.tsx'
import { useLang } from '../../host.ts'
import { AnswerInfo } from './AnswerInfo.tsx'
import { formatQuestionDisplayText } from './questionAnswerDisplay.ts'
import type { IMultimodalAnswer, ITextInputAnswer } from './types.ts'
import { QuestionImageAttachments } from './QuestionImageAttachments.tsx'

interface AIQuestionTextProps {
  question?: string
  note?: string | null
  answer?: ITextInputAnswer | null
  supplement?: string
  multimodalAnswer?: readonly IMultimodalAnswer[]
  onAnswerChange?: (value: string) => void
  onReject?: () => void
  onMultimodalAnswerChange?: (value: readonly IMultimodalAnswer[]) => void
  onUploadFiles?: (files: readonly File[]) => Promise<void>
  resolveImagePreview?: (image: IMultimodalAnswer) => Promise<string | undefined>
  disabled: boolean
  defaultCollapsed?: boolean
  collapseOnSaved?: boolean
  is_answer: boolean
}

/** Free-text smart-question card with collapsed answer display. */
export function AIQuestionText({
  question = '',
  note = '',
  answer = null,
  supplement = '',
  multimodalAnswer = [],
  disabled,
  defaultCollapsed = false,
  collapseOnSaved = false,
  is_answer = false,
  onAnswerChange = () => {},
  onReject,
  onMultimodalAnswerChange,
  onUploadFiles,
  resolveImagePreview,
}: AIQuestionTextProps): ReactElement {
  const t = useLang()
  const hasTextAnswer = Boolean(answer?.text?.trim())
  const hasSupplement = Boolean(supplement.trim())
  const hasAnswer = hasTextAnswer || multimodalAnswer.length > 0
  const [isEdit, setIsEdit] = useState(() => defaultCollapsed ? false : !is_answer)
  const prevDisabledRef = useRef(disabled)
  const prevDefaultCollapsedRef = useRef(defaultCollapsed)
  const noAnswerText = formatQuestionDisplayText(
    t.design_question_no_answer,
    'design_question_no_answer',
    '未回答',
  )

  useEffect(() => {
    if (!prevDisabledRef.current && disabled) setIsEdit(false)
    prevDisabledRef.current = disabled
  }, [disabled])

  useEffect(() => {
    const defaultCollapsedChanged = prevDefaultCollapsedRef.current !== defaultCollapsed
    prevDefaultCollapsedRef.current = defaultCollapsed
    if (!defaultCollapsedChanged) return
    setIsEdit(defaultCollapsed ? false : !is_answer)
  }, [defaultCollapsed, is_answer])

  useEffect(() => {
    if (collapseOnSaved) setIsEdit(false)
  }, [collapseOnSaved])

  const [textValue, setTextValue] = useState(answer?.text ?? '')

  useEffect(() => {
    setTextValue(answer?.text ?? '')
  }, [answer?.text])

  return (
    <div className='group flex flex-col gap-3 rounded-xl border border-[var(--ds-fill-6)] bg-[var(--ds-fill-1)] px-4 py-3'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex flex-col gap-[2px]'>
          <div className='text-md font-medium leading-[26px] text-[var(--ds-text-primary)]'>{question}</div>
          {note
            ? <div className='text-[14px] font-normal leading-[22px] text-[var(--ds-text-7)]'>{note}</div>
            : null}
        </div>

        <div className='flex items-center gap-[8px] opacity-100 transition-opacity duration-200 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-focus-within:opacity-100'>
          {!isEdit
            ? (
              <div
                data-tip-id='tip_qa_edit_answer'
                onClick={(event) => {
                  event.stopPropagation()
                  if (!disabled) setIsEdit(!isEdit)
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
          {onReject !== undefined
            ? (
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
            )
            : null}
        </div>
      </div>

      {isEdit
        ? (
          <div className='flex-1 rounded border border-[#E0DDE6] bg-white p-3 transition-all focus-within:border-[#663AE8]'>
            <QuestionImageAttachments images={multimodalAnswer} editable disabled={disabled} onChange={onMultimodalAnswerChange} onUploadFiles={onUploadFiles} resolvePreview={resolveImagePreview}>
              <Textarea
                className='h-24 w-full resize-none border-none bg-transparent p-0 text-sm text-[#59556B] shadow-none outline-none placeholder:text-[#59556B] placeholder:opacity-35 focus-visible:ring-0'
                placeholder={t.preview_design_please_enter_answer}
                value={textValue}
                onChange={(event) => {
                  setTextValue(event.target.value)
                  if (!disabled) onAnswerChange(event.target.value)
                }}
                disabled={disabled || !isEdit}
              />
            </QuestionImageAttachments>
            {hasSupplement
              ? <div data-testid='question-text-supplement' className='mt-2'><span className='text-xs text-[var(--ds-text-secondary)]'>{t.question_additions}</span><AnswerInfo data={supplement} className='whitespace-pre-wrap' /></div>
              : null}
          </div>
        )
        : (
          <div className='space-y-2'>
            <QuestionImageAttachments images={multimodalAnswer} resolvePreview={resolveImagePreview} />
            {hasTextAnswer || !hasAnswer
              ? (
                <AnswerInfo
                  data={hasTextAnswer ? textValue : noAnswerText}
                  variant={hasAnswer ? 'default' : 'muted'}
                />
              )
              : null}
            {hasSupplement
              ? <div data-testid='question-text-supplement'><span className='text-xs text-[var(--ds-text-secondary)]'>{t.question_additions}</span><AnswerInfo data={supplement} className='whitespace-pre-wrap' /></div>
              : null}
          </div>
        )}
    </div>
  )
}

/** Render persisted attachment references when this host cannot resolve previews. */
export function QuestionImageReferences({ images }: { images: readonly IMultimodalAnswer[] }): ReactElement | null {
  return <QuestionImageAttachments images={images} />
}
