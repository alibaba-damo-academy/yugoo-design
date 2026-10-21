/**
 * smart_questions panel types (strict port). Answer/selection shapes come from
 * the original Design/types.ts; the question and panel shapes from the
 * original @/lib/delta IQuestionType / ISmartQuestionsPanel that AIQuestion
 * consumed.
 */

// ==================== Answer Types ====================

/** Single-choice answer: the picked option's index and stable value. */
export interface ISingleChoiceAnswer {
  selected_index: number;
  selected_value: string;
}

/** One picked option of a multiple-choice answer. */
export interface ISelectedItem {
  selected_index: number;
  selected_value: string;
}

/** Text-input answer. */
export interface ITextInputAnswer {
  text: string;
}

/** Stable persisted local-file reference attached to a question answer. */
export interface IMultimodalAnswer {
  type: 'file' | 'image';
  file_md5: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Bundle-relative local Design File; absent only on legacy imported references. */
  artifact_file?: string;
}

/** Any question answer variant (text/choice answers only reach the panel). */
export type IQuestionAnswer =
  | ISingleChoiceAnswer
  | ISelectedItem[]
  | ITextInputAnswer
  | boolean
  | null;

// ==================== Selection and Question Types ====================

/** One choice option of a choice question. */
export interface ISelection {
  index: number;
  label: string;
  value: string;
}

/** Single-choice suggestion: the recommended option's index and value. */
export interface ISingleChoiceSuggest {
  selected_index: number;
  selected_value: string;
}

/** Multiple-choice suggestion: the recommended options' indexes and values. */
export type IMultipleChoiceSuggest = ISingleChoiceSuggest[];

/** One question of the smart_questions panel (original delta shape). */
export interface IQuestionType {
  /** Unique question id; `const_*` ids anchor the bottom config section. */
  question_id: string;
  /** Question kind: single choice / multiple choice / free text. */
  type: 'single_choice' | 'multiple_choice' | 'text_input';
  /** Question text. */
  question: string;
  /** Optional question note rendered under the question text. */
  note?: string | null;
  /** Whether the question is answered (drives collapsed answer display). */
  is_answer: boolean;
  /** Generation round; questions group into epoch sections. */
  generate_epoch: number;
  /** AI-recommended options (derived from option.recommended upstream). */
  suggest: ISingleChoiceSuggest | IMultipleChoiceSuggest | null;
  /** The user's answer. */
  answer: IQuestionAnswer;
  /** Choice options (choice questions only). */
  selections: ISelection[];
  /** Free-form supplement appended to the answer. */
  supplement: string;
  /** Persisted file references attached to the user's answer. */
  multimodal_answer?: IMultimodalAnswer[];
  /** Whether the user rejected the question; rejected items stay in state. */
  rejected?: boolean;
}

// ==================== Panel Types ====================

/** The smart_questions panel payload the strict-port AIQuestion consumes. */
export interface ISmartQuestionsPanel {
  panel_id: string;
  title?: string;
  questions: IQuestionType[];
}
