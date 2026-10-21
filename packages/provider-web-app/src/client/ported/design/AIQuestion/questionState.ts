/**
 * Question answer-state helpers (strict port of the original
 * @/utils/designQuestionAnswerState, scoped to the smart_questions shapes).
 */
import type { IQuestionType, ISmartQuestionsPanel } from './types.ts';

type IQuestionAnswerLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<unknown>
  | Record<string, unknown>;

/** Whether a selected value is a real, non-placeholder option value. */
export const isMeaningfulQuestionSelectedValue = (
  value: unknown
): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().toLowerCase() !== 'none';

/** Flatten any answer-ish value into its list of selected option values. */
export const normalizeQuestionSelectedValues = (value: unknown): string[] => {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeQuestionSelectedValues(item));
  }

  if (
    typeof value === 'object' &&
    'selected_value' in value &&
    typeof value.selected_value === 'string'
  ) {
    return value.selected_value.trim().length > 0
      ? [value.selected_value]
      : [];
  }

  return [];
};

const hasNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Whether an answer value carries real content. */
export const hasQuestionAnswerValue = (
  answer: IQuestionAnswerLike
): boolean => {
  if (answer === null || answer === undefined) return false;
  if (typeof answer === 'boolean') return true;
  if (typeof answer === 'number') return true;
  if (typeof answer === 'string') return answer.trim().length > 0;

  if (Array.isArray(answer)) {
    return answer.some(item =>
      hasQuestionAnswerValue(item as IQuestionAnswerLike)
    );
  }

  if (typeof answer === 'object') {
    if ('text' in answer) {
      return hasNonEmptyString(answer.text);
    }

    if ('selected_value' in answer) {
      return isMeaningfulQuestionSelectedValue(answer.selected_value);
    }
  }

  return false;
};

/** Supplementary context alone does not establish an answer. */
export const hasDesignQuestionAnswerContent = (
  question: Pick<IQuestionType, 'answer' | 'supplement' | 'multimodal_answer'>
): boolean =>
  hasQuestionAnswerValue(question.answer as IQuestionAnswerLike) ||
  Boolean(question.multimodal_answer?.length);

/**
 * Whether a question panel should default to collapsed based on its answers:
 * once any active question is answered the panel reads as saved.
 */
export const shouldCollapseQuestionPanelByAnswerState = (
  panel: Pick<ISmartQuestionsPanel, 'questions'>
) => {
  const activeQuestions = (panel.questions ?? []).filter(
    question => !question.rejected
  );

  return (
    activeQuestions.length > 0 &&
    !activeQuestions.every(question => question.is_answer === false)
  );
};
