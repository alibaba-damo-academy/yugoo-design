import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useLang } from '../../host.ts'
import { AIQuestionMultiple } from './AIQuestionMultiple.tsx'
import { AIQuestionMultipleConst } from './AIQuestionMultipleConst.tsx'
import { AIQuestionRadio } from './AIQuestionRadio.tsx'
import { AIQuestionRadioConst } from './AIQuestionRadioConst.tsx'
import { AIQuestionText } from './AIQuestionText.tsx'
import { normalizeQuestionSelectedValues, shouldCollapseQuestionPanelByAnswerState } from './questionState.ts'
import type { IMultimodalAnswer, IQuestionAnswer, IQuestionType, ISmartQuestionsPanel } from './types.ts'

type ChoiceQuestionType = 'single_choice' | 'multiple_choice'

interface AIQuestionProps {
  panel: ISmartQuestionsPanel
  onChange: (data: ISmartQuestionsPanel) => void
  disabled: boolean
  defaultCollapsed?: boolean
  collapseOnSaved?: boolean
  inlineMultipleChoiceOptions?: boolean
  flushTop?: boolean
  onMultimodalAnswerChange?: (questionId: string, value: readonly IMultimodalAnswer[]) => void
  onUploadFiles?: (questionId: string, files: readonly File[]) => Promise<void>
  resolveImagePreview?: (image: IMultimodalAnswer) => Promise<string | undefined>
}

function getQuestions(panel: ISmartQuestionsPanel | null | undefined): IQuestionType[] {
  return Array.isArray(panel?.questions) ? panel.questions : []
}

function AIQuestionComponent({
  panel,
  onChange,
  disabled,
  defaultCollapsed,
  collapseOnSaved,
  inlineMultipleChoiceOptions = false,
  flushTop = false,
  onMultimodalAnswerChange,
  onUploadFiles,
  resolveImagePreview,
}: AIQuestionProps): ReactElement {
  const t = useLang()
  const panelData = useMemo(() => panel, [panel])
  const [preservedExpandedQuestionTypes, setPreservedExpandedQuestionTypes] =
    useState<Map<string, ChoiceQuestionType>>(() => new Map())

  const onAnswer = useCallback((answer: IQuestionAnswer, questionId: string): void => {
    onChange({
      ...panelData,
      questions: getQuestions(panelData).map((question) =>
        question.question_id === questionId ? { ...question, answer } : question),
    })
  }, [onChange, panelData])

  const onSupplement = useCallback((supplement: string, questionId: string): void => {
    onChange({
      ...panelData,
      questions: getQuestions(panelData).map((question) =>
        question.question_id === questionId ? { ...question, supplement } : question),
    })
  }, [onChange, panelData])

  const onFlipType = useCallback((questionId: string): void => {
    let targetType: ChoiceQuestionType | null = null
    const questions = getQuestions(panelData).map((question): IQuestionType => {
      if (question.question_id !== questionId) return question
      if (question.type === 'single_choice') {
        targetType = 'multiple_choice'
        const current = question.answer !== null && typeof question.answer === 'object' && !Array.isArray(question.answer)
          && 'selected_value' in question.answer
          ? question.answer
          : null
        return {
          ...question,
          type: 'multiple_choice',
          answer: current?.selected_value ? [current] : [],
          is_answer: false,
        }
      }
      if (question.type === 'multiple_choice') {
        targetType = 'single_choice'
        const first = Array.isArray(question.answer) ? question.answer[0] : null
        return {
          ...question,
          type: 'single_choice',
          answer: first ?? { selected_index: -1, selected_value: '' },
          is_answer: false,
        }
      }
      return question
    })
    if (targetType !== null) {
      const expectedType = targetType
      setPreservedExpandedQuestionTypes((previous) => {
        const updated = new Map(previous)
        updated.set(questionId, expectedType)
        return updated
      })
    }
    onChange({ ...panelData, questions })
  }, [onChange, panelData])

  const { constQuestion, questions } = useMemo(() => {
    const fixed: IQuestionType[] = []
    const regular: IQuestionType[] = []
    for (const question of getQuestions(panelData)) {
      if (question.question_id.startsWith('const_')) fixed.push(question)
      else regular.push(question)
    }
    return { constQuestion: fixed, questions: [...regular].reverse() }
  }, [panelData])

  useEffect(() => {
    if (preservedExpandedQuestionTypes.size === 0) return
    setPreservedExpandedQuestionTypes((previous) => {
      const next = new Map(previous)
      for (const question of getQuestions(panelData)) {
        if (next.get(question.question_id) === question.type) next.delete(question.question_id)
      }
      return next.size === previous.size ? previous : next
    })
  }, [panelData, preservedExpandedQuestionTypes.size])

  const activeQuestions = useMemo(
    () => questions.filter((question) => !question.rejected),
    [questions],
  )
  const rejectedQuestions = useMemo(
    () => questions.filter((question) => question.rejected),
    [questions],
  )
  const epochSections = useMemo(() => {
    const groups = new Map<number, IQuestionType[]>()
    for (const question of activeQuestions) {
      const epoch = question.generate_epoch ?? 0
      groups.set(epoch, [...(groups.get(epoch) ?? []), question])
    }
    const latestEpoch = groups.size > 0 ? Math.max(...groups.keys()) : 0
    return [...groups.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([epoch, sectionQuestions]) => ({
        epoch,
        questions: sectionQuestions,
        isLatestEpoch: epoch === latestEpoch,
      }))
  }, [activeQuestions])

  const computedDefaultQuestionCollapsed = shouldCollapseQuestionPanelByAnswerState({
    questions: getQuestions(panelData),
  })
  const defaultQuestionCollapsed = defaultCollapsed ?? computedDefaultQuestionCollapsed

  const onReject = useCallback((questionId: string): void => {
    onChange({
      ...panelData,
      questions: getQuestions(panelData).map((question) =>
        question.question_id === questionId ? { ...question, rejected: true } : question),
    })
  }, [onChange, panelData])

  const onRestore = useCallback((questionId: string): void => {
    onChange({
      ...panelData,
      questions: getQuestions(panelData).map((question) =>
        question.question_id === questionId ? { ...question, rejected: false } : question),
    })
  }, [onChange, panelData])

  const regularCard = (question: IQuestionType, sectionDefaultCollapsed: boolean, sectionCollapseOnSaved: boolean): ReactElement => {
    switch (question.type) {
      case 'text_input': {
        const textAnswer = question.answer !== null && typeof question.answer === 'object'
          && !Array.isArray(question.answer) && 'text' in question.answer
          ? question.answer
          : null
        return (
          <AIQuestionText
            disabled={disabled}
            defaultCollapsed={sectionDefaultCollapsed}
            collapseOnSaved={sectionCollapseOnSaved}
            is_answer={question.is_answer}
            question={question.question}
            note={question.note}
            answer={textAnswer}
            supplement={question.supplement}
            multimodalAnswer={question.multimodal_answer}
            onMultimodalAnswerChange={(value) => { onMultimodalAnswerChange?.(question.question_id, value) }}
            onUploadFiles={async (files) => { await onUploadFiles?.(question.question_id, files) }}
            resolveImagePreview={resolveImagePreview}
            onAnswerChange={(value) => { onAnswer({ text: value }, question.question_id) }}
            onReject={() => { onReject(question.question_id) }}
          />
        )
      }
      case 'single_choice': {
        const singleAnswer = question.answer !== null && typeof question.answer === 'object'
          && !Array.isArray(question.answer) && 'selected_index' in question.answer && 'selected_value' in question.answer
          ? question.answer
          : { selected_index: -1, selected_value: '' }
        return (
          <AIQuestionRadio
            disabled={disabled}
            defaultCollapsed={sectionDefaultCollapsed}
            collapseOnSaved={sectionCollapseOnSaved}
            preserveExpanded={preservedExpandedQuestionTypes.get(question.question_id) === question.type}
            question={question.question}
            note={question.note}
            is_answer={question.is_answer}
            supplement={question.supplement}
            multimodalAnswer={question.multimodal_answer}
            onMultimodalAnswerChange={(value) => { onMultimodalAnswerChange?.(question.question_id, value) }}
            onUploadFiles={async (files) => { await onUploadFiles?.(question.question_id, files) }}
            resolveImagePreview={resolveImagePreview}
            selectedOption={singleAnswer}
            options={question.selections}
            onChange={(value) => {
              const selection = question.selections.find((option) => option.value === value)
              onAnswer({
                selected_index: selection?.index ?? -1,
                selected_value: selection?.value ?? '',
              }, question.question_id)
            }}
            onSupplement={(value) => { onSupplement(value, question.question_id) }}
            onFlipType={() => { onFlipType(question.question_id) }}
            onReject={() => { onReject(question.question_id) }}
          />
        )
      }
      case 'multiple_choice': {
        const multipleAnswer = Array.isArray(question.answer) ? question.answer : []
        return (
          <AIQuestionMultiple
            disabled={disabled}
            defaultCollapsed={sectionDefaultCollapsed}
            collapseOnSaved={sectionCollapseOnSaved}
            preserveExpanded={preservedExpandedQuestionTypes.get(question.question_id) === question.type}
            question={question.question}
            note={question.note}
            supplement={question.supplement}
            multimodalAnswer={question.multimodal_answer}
            onMultimodalAnswerChange={(value) => { onMultimodalAnswerChange?.(question.question_id, value) }}
            onUploadFiles={async (files) => { await onUploadFiles?.(question.question_id, files) }}
            resolveImagePreview={resolveImagePreview}
            is_answer={question.is_answer}
            options={question.selections}
            selectedOptions={multipleAnswer.map((item) => item.selected_value)}
            inlineOptions={inlineMultipleChoiceOptions}
            onReject={() => { onReject(question.question_id) }}
            onChange={(values) => {
              const selectedValues = normalizeQuestionSelectedValues(values)
              onAnswer(question.selections
                .filter((selection) => selectedValues.includes(selection.value))
                .map((selection) => ({
                  selected_index: selection.index,
                  selected_value: selection.value,
                })), question.question_id)
            }}
            onSupplement={(value) => { onSupplement(value, question.question_id) }}
          />
        )
      }
    }
  }

  const fixedCard = (question: IQuestionType): ReactElement => {
    switch (question.type) {
      case 'text_input': {
        const answer = question.answer !== null && typeof question.answer === 'object'
          && !Array.isArray(question.answer) && 'text' in question.answer
          ? question.answer
          : null
        return (
          <AIQuestionText
            disabled={disabled}
            defaultCollapsed={defaultQuestionCollapsed}
            collapseOnSaved={collapseOnSaved}
            is_answer={question.is_answer}
            question={question.question}
            note={question.note}
            answer={answer}
            supplement={question.supplement}
            multimodalAnswer={question.multimodal_answer}
            onAnswerChange={(value) => { onAnswer({ text: value }, question.question_id) }}
          />
        )
      }
      case 'single_choice': {
        const answer = question.answer !== null && typeof question.answer === 'object'
          && !Array.isArray(question.answer) && 'selected_index' in question.answer && 'selected_value' in question.answer
          ? question.answer
          : { selected_index: -1, selected_value: '' }
        const suggest = question.suggest !== null && !Array.isArray(question.suggest)
          ? question.suggest
          : undefined
        return (
          <AIQuestionRadioConst
            disabled={disabled}
            question={question.question}
            note={question.note}
            is_answer={question.is_answer}
            suggest={suggest}
            selectedOption={answer}
            options={question.selections}
            onChange={(value) => {
              const selection = question.selections.find((option) => option.value === value)
              onAnswer({
                selected_index: selection?.index ?? -1,
                selected_value: selection?.value ?? '',
              }, question.question_id)
            }}
          />
        )
      }
      case 'multiple_choice': {
        const answer = Array.isArray(question.answer) ? question.answer : []
        const suggest = Array.isArray(question.suggest) ? question.suggest : []
        return (
          <AIQuestionMultipleConst
            disabled={disabled}
            question={question.question}
            note={question.note}
            is_answer={question.is_answer}
            options={question.selections}
            suggest={suggest.map((item) => item.selected_value)}
            selectedOptions={answer.map((item) => item.selected_value)}
            onChange={(values) => {
              const selectedValues = normalizeQuestionSelectedValues(values)
              onAnswer(question.selections
                .filter((selection) => selectedValues.includes(selection.value))
                .map((selection) => ({
                  selected_index: selection.index,
                  selected_value: selection.value,
                })), question.question_id)
            }}
          />
        )
      }
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .fade-in-card {
          animation: fadeIn 0.6s ease-out forwards;
          opacity: 0;
        }
      `}</style>
      <div className={`flex flex-1 flex-col gap-[12px] ${flushTop ? '' : 'mt-[12px]'}`}>
        {epochSections.map((section) => {
          const keepOpen = section.isLatestEpoch && !collapseOnSaved
          const sectionCollapseOnSaved = !keepOpen
          const sectionDefaultCollapsed = !keepOpen
          return (
            <div
              key={`epoch-${section.epoch}`}
              className={keepOpen
                ? 'flex flex-col gap-[12px]'
                : 'flex flex-col gap-[12px] rounded-xl bg-[var(--ds-fill-2)] p-2'}
            >
              {section.questions.map((question, index) => (
                <div
                  key={question.question_id}
                  className='fade-in-card'
                  style={{ animationDelay: `${index * 0.15}s` }}
                >
                  {regularCard(question, sectionDefaultCollapsed, sectionCollapseOnSaved)}
                </div>
              ))}
            </div>
          )
        })}

        {rejectedQuestions.length > 0
          ? (
            <div className='rounded-xl border border-[hsl(var(--error)/0.35)] bg-[hsl(var(--error-bg))] p-3'>
              <div className='mb-2 text-sm font-medium text-[hsl(var(--error))]'>{t.design_rejected_questions}</div>
              <div className='flex flex-col gap-2'>
                {rejectedQuestions.map((question) => (
                  <div
                    key={question.question_id}
                    className='flex items-center justify-between gap-3 text-sm text-[var(--ds-text-secondary)]'
                  >
                    <span className='line-through'>{question.question}</span>
                    <button
                      type='button'
                      className='shrink-0 text-[hsl(var(--error))] underline underline-offset-2'
                      onClick={() => { onRestore(question.question_id) }}
                    >
                      {t.button_restore}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
          : null}

        {constQuestion.length > 0
          ? (
            <div
              className='fade-in-card flex flex-col gap-3 rounded-xl border border-[var(--ds-fill-6)] bg-[var(--ds-fill-1)] px-4 py-3'
              style={{ animationDelay: `${questions.length * 0.15}s` }}
            >
              <div className='text-md relative font-medium leading-[26px] text-[var(--ds-text-primary)]'>
                {t.preview_design_config}
              </div>
              {constQuestion.map((question, index) => (
                <div
                  key={question.question_id}
                  className='fade-in-card'
                  style={{ animationDelay: `${(questions.length + index + 1) * 0.15}s` }}
                >
                  {fixedCard(question)}
                </div>
              ))}
            </div>
          )
          : null}
      </div>
    </>
  )
}

/** Strict-port smart-question panel with round grouping and fixed cards. */
export const AIQuestion = memo(AIQuestionComponent)
AIQuestion.displayName = 'AIQuestion'
