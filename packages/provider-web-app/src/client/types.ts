/**
 * Shared types for the Web App Kit's native Design panels. Values mirror the
 * skills-web-app Design File schemas supplied by the shared Panel registry.
 */

/** The skill.yaml manifest slice the tabs bar consumes. */
export interface SkillManifestLite {
  name?: string
  title?: { zh?: string; en?: string }
  label?: { zh?: string; en?: string }
  order?: number
  icon?: string
  presentation?: unknown
}

/** One Design advisory projected for human review. */
export interface DesignAdvisoryProjectionEntry {
  advisory: {
    id: string
    profile: string
    kind: 'reminder' | 'suggestion'
    attention: 'next-boundary' | 'human-review'
    summary: string
    items: readonly {
      id: string
      title: string
      detail: string
      rationale?: string
      references: readonly string[]
    }[]
    acceptanceInstruction?: string
  }
  status: 'pending' | 'accepted' | 'rejected' | 'deferred'
  /** True when the advisory's DesignJournal revision or Kit pin no longer matches current state. */
  stale: boolean
}

/** Stable local-file reference attached to a smart_questions answer. */
export interface SmartQuestionImageAnswer {
  /** `image` remains valid for references created before generic files. */
  type: 'file' | 'image'
  file_md5: string
  filename: string
  mime_type: string
  size_bytes: number
  /** Bundle-relative local Design File; absent only on legacy imported references. */
  artifact_file?: string
}

/** Panel-only bytes awaiting atomic materialization by generic Panel Save. */
export interface PendingSmartQuestionImageUpload extends SmartQuestionImageAnswer {
  question_id: string
  client_digest: string
  base64: string
}

/** One smart_questions question (schema.yaml `questions` value). */
export interface SmartQuestion {
  prompt: string
  kind?: 'single' | 'multiple' | 'text'
  choices?: { value: string; label: string; recommended?: boolean }[]
  answer?: string
  detail?: string
  multimodal_answer?: SmartQuestionImageAnswer[]
  round?: number
  rejected?: boolean
}

/** smart_questions state (fixed cards keyed const_*, dynamic by id). */
export interface SmartQuestionsState {
  skill_name?: string
  questions?: Record<string, SmartQuestion>
  question_order?: string[]
  /** Never persisted: removed by the native panel's browser-side save preparation. */
  pending_multimodal_uploads?: PendingSmartQuestionImageUpload[]
}

/** One function_modules function (schema.yaml `functions` value). */
export interface FunctionDetails {
  purpose?: string
  situation?: string
  behaviors?: Record<string, { description: string }>
  inputs?: Record<string, { description: string }>
  outputs?: Record<string, { description: string }>
  limits?: Record<string, { description: string }>
  exceptions?: Record<string, { condition: string; response: string }>
}

export interface FunctionSourceReference {
  file: string
  pointer?: string
  revision: string
  note?: string
  subject_pointer?: string
}

export interface FunctionModule {
  function_id: string
  function_name: string
  function_description: string
  function_epic: string
  priority?: 'High' | 'Medium' | 'Low'
  rejected?: boolean
  source?: 'ai' | 'user'
  reason?: string
  details?: FunctionDetails
  references?: Record<string, FunctionSourceReference>
}

/** function_modules state. */
export interface FunctionModulesState {
  skill_name?: string
  functions?: Record<string, FunctionModule>
}

/** One flow_design process (schema.yaml `processes` value). */
export interface FlowProcess {
  process_id: string
  title?: string
  description?: string
  tier?: 'core' | 'business' | 'auxiliary'
  process_type?: 'linear' | 'approval' | 'parallel' | 'event_driven'
  stakeholders?: string[]
  system_responsibilities?: string[]
  trigger_hints?: {
    kind: 'timer' | 'message' | 'error' | 'conditional' | 'signal'
    trigger: string
    expected_outcome: string
  }[]
  key_features?: string[]
  business_rules?: string[]
  exception_handling?: { scenario: string; handling: string }[]
  deleted?: boolean
  bpmn_file?: string | null
  bpmn_generated?: boolean
  bpmn_last_error?: string | null
  /** UI projection: durable artifact acceptance plus Host execution activity. */
  generation_status?: 'pending' | 'queued' | 'working' | 'completed' | 'failed'
  /** Transient panel-only field: edited XML awaiting save-time dehydration. */
  bpmn_xml?: string
  /** Transient panel-only flag: the user edited the XML in the Modeler. */
  bpmn_edited?: boolean
}

/** flow_design state. */
export interface FlowDesignState {
  skill_name?: string
  roles?: { id: string; name?: string }[]
  processes?: Record<string, FlowProcess>
  process_order?: string[]
}

/** One research direction (schema.yaml `rounds[].directions` value). */
export interface ResearchDirection {
  direction_id: string
  title: string
  source?: 'prerequisites' | 'analysis' | 'user'
  status?: 'pending' | 'queued' | 'working' | 'completed' | 'failed'
  research_points?: string[]
  findings_file?: string | null
  findings_sha256?: string | null
  source_urls?: string[]
}

/** One research round. */
export interface ResearchRound {
  round_id: string
  topic?: string
  stage?: 'identified' | 'confirmed' | 'researching' | 'completed' | 'partial'
  directions?: Record<string, ResearchDirection>
  direction_order?: string[]
  conclusion_file?: string | null
  conclusion_sha256?: string | null
  created_at?: number
  updated_at?: number
}

/** research state. */
export interface ResearchState {
  skill_name?: string
  rounds?: Record<string, ResearchRound>
  round_order?: string[]
  current_round_id?: string | null
  epoch?: number
}

/** design_style state (config tree is free-form per aesthetic_index). */
export interface DesignStyleState {
  skill_name?: string
  notes?: string
  config?: Record<string, unknown>
}

/** Plain-record guard shared by the panels. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
