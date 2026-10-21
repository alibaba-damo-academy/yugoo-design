/** HTML-only web_app_prd_assembly panel state. */

/** View-only assembly lifecycle projected from Host attempts and artifact presence. */
export type PrdAssemblyStatus = 'assembling' | 'completed' | 'failed';

/** Human confirmation metadata carried only by pending provenance records. */
export interface PrdPendingAssumption {
  decision: string;
  reason: string;
  impact: string;
  decision_owner: string;
}

/** One unsupported temporary completion that remains pending user confirmation. */
export interface PrdAiProvenance {
  id: string;
  section_ids: string[];
  operation: 'completion';
  description: string;
  source_refs: string[];
  assumption: PrdPendingAssumption;
}

/** Minimal persisted state; all fields remain optional while hydrating drafts. */
export interface PrdAssemblyState {
  schema_version?: 6 | 7 | 8;
  status?: PrdAssemblyStatus;
  title?: string;
  detail_level?: 'concise' | 'detailed';
  ai_provenance?: PrdAiProvenance[];
  html_file?: string;
}

/** TOC anchor projected directly from one hydrated HTML heading. */
export interface PrdSectionAnchor {
  id: string;
  title: string;
  sourceSkills: string[];
  provenanceIds: string[];
}
