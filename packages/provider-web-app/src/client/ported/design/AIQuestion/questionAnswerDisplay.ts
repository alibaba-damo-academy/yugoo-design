/**
 * Question answer display helpers (strict port of the original
 * Design/questionAnswerDisplay.ts).
 */

/** Placeholder value the backend uses for "no option selected". */
export const EMPTY_SELECTED_VALUE = 'none';

/** Whether a selected value is a real, non-placeholder option value. */
export const isMeaningfulSelectedValue = (value: unknown): value is string => {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().toLowerCase() !== EMPTY_SELECTED_VALUE
  );
};

/**
 * Display text for a translated string: falls back when the i18n layer
 * returned the raw key (or its spaced form) instead of a translation.
 */
export const formatQuestionDisplayText = (
  value: string,
  key: string,
  fallback: string
) => {
  return value === key || value === key.replace(/[-_]/g, ' ')
    ? fallback
    : value;
};
