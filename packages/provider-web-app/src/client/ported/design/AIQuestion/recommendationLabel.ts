/**
 * Recommendation label helper (strict port of the original
 * Design/recommendationLabel.ts).
 */

const RECOMMENDATION_SUFFIX_PATTERN = /\s*[（(]推荐[）)]/g;

/** Strip the trailing 「推荐」/「(推荐)」 suffix from an option label. */
export const stripRecommendationSuffix = (label: string): string =>
  label.replace(RECOMMENDATION_SUFFIX_PATTERN, '');
