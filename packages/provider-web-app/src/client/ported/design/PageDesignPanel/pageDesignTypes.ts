/**
 * page_design panel types: the dsh page-map state (pages + navigation
 * connections records, entry pages) the ported PageDesignPanel family
 * consumes. Field shapes mirror the page_design bundle schema; the panel
 * adapter hydrates each page's `artifact_file` into the transient `html`
 * field and dehydrates it before any state ships back to the host.
 */

/** Artifact generation lifecycle of one page. */
export type PageGenerationStatus =
  | 'pending'
  | 'queued'
  | 'working'
  | 'completed'
  | 'failed';

/** Semantic kind of a page in the map. */
export type PageType =
  | 'overview'
  | 'list'
  | 'detail'
  | 'form'
  | 'workspace'
  | 'content'
  | 'other';

/** One page node in the page map. */
export interface IPageNode {
  /** Page id (record key). */
  id: string;
  /** Display name. */
  name: string;
  /** What the page is for. */
  purpose?: string;
  /** Parent page whose functional navigation group this Page may inherit. */
  parent_id?: string | null;
  /** Semantic page kind. */
  page_type?: PageType;
  /** Intended audiences. */
  audience?: string[];
  /** Key content blocks. */
  key_content?: string[];
  /** Key user actions. */
  key_actions?: string[];
  /** Referenced function_modules ids. */
  function_refs?: string[];
  /** Persisted map position; absent → functional-group layout slot. */
  canvas_position?: { x: number; y: number };
  /** Artifact generation lifecycle. */
  generation_status?: PageGenerationStatus;
  /** Generated HTML artifact path (design_files-relative). */
  artifact_file?: string;
  /** Last generation failure message. */
  generation_error?: string;
  evidence_digest?: string;
  /** Transient panel-only field: HTML hydrated from `artifact_file`. */
  html?: string;
  /** Accepted Page ref exists and its content is still loading. */
  artifact_loading?: boolean;
  /** Accepted Page ref exists and readArtifact returned usable HTML. */
  artifact_available?: boolean;
  /** UI-only Host run id for the native Agent log. */
  execution_run_id?: string;
}

/** Directed navigation connection between two pages. */
export interface IPageConnection {
  /** Connection id (record key). */
  id: string;
  /** Page the user navigates from. */
  source_page_id: string;
  /** Page the user lands on. */
  target_page_id: string;
  /** Trigger label (e.g. the button text that performs the jump). */
  label?: string;
  /** `data-prototype-id` of the source element that triggers the jump. */
  source_element_id?: string;
  /** Human-readable label of the bound source element. */
  source_element_label?: string;
  /** Read-only preview selection parameters, never design facts or authority. */
  preview_context?: Readonly<Record<string, string>>;
}

/** User-authored geometry and title for one functional Page Map section. */
export interface IPageMapSectionState {
  /** Stable user-owned section id; initial projections are materialized on first edit. */
  id: string;
  /** Editable title shown in the section header. */
  label: string;
  /** Page ids currently represented by this section. */
  page_ids: string[];
  /** Persisted top-left canvas position. */
  canvas_position: { x: number; y: number };
  /** Persisted section frame size. */
  canvas_size: { width: number; height: number };
}

/** The main Logo reused by every generated Page. */
export interface IPageCommonLogo {
  /** Optional wordmark text. */
  name?: string;
  /** Shared Logo mark, wordmark, and placement. */
  description: string;
}

/** One exact item in the shared application navigation. */
export interface IPageCommonNavigationItem {
  /** Stable navigation item id. */
  id: string;
  /** User-visible label reused verbatim on every Page. */
  label: string;
  /** Target Page id, empty for a non-Page action. */
  target_page_id?: string;
  /** Optional navigation section label. */
  group?: string;
}

/** Shared application chrome fixed before parallel Page generation. */
export interface IPageCommonSpec {
  /** Shared shell layout. */
  layout: string;
  /** Main Logo reused by every Page. */
  logo: IPageCommonLogo;
  /** Exact shared navigation menu in display order. */
  navigation: IPageCommonNavigationItem[];
  /** Shared component treatments reused by every Page. */
  shared_components: string[];
  /** Evidence source used to define this spec. */
  source: 'design_style';
}

/** page_design panel state (the adapter's draft shape). */
export interface IPageDesignState {
  /** Map lifecycle stage. */
  stage?: 'mapped' | 'generating' | 'completed' | 'needs_revision';
  /** Page records keyed by id. */
  pages?: Record<string, IPageNode>;
  /** Sidebar / map ordering. */
  page_order?: string[];
  /** Pages the product can be entered from (never empty while pages exist). */
  entry_page_ids?: string[];
  /** Connection records keyed by id. */
  connections?: Record<string, IPageConnection>;
  /** Connection ordering. */
  connection_order?: string[];
  /** User-authored section frames; absent means auto projection, empty means no sections. */
  canvas_sections?: Record<string, IPageMapSectionState>;
  /** Shared application chrome fixed before Page generation. */
  common_spec?: IPageCommonSpec | null;
  /** Active design_style theme id. */
  style_theme?: string;
  /** Style regeneration epoch. */
  style_epoch?: number;
}

/** Props of the ported PageDesignPanel component. */
export interface IPageDesignPanelProps {
  /** Hydrated page_design state (pages may carry transient `html`). */
  data: IPageDesignState;
  /** Read-only interaction while a host save is in flight. */
  disabled?: boolean;
  /** Complete landed tokens.css stylesheet injected into preview srcDoc. */
  styleCss?: string;
  /** Adapter reader/save-revision identity; a change revokes preview arrival. */
  previewResetIdentity?: unknown;
  /** Reads the Host-authorized native log for the selected artifact worker. */
  readExecutionLog?: import('dsh-design-panel/client-api').ExecutionRollingLogProps['readExecutionLog'];
  /** Receives immutable state updates; partial states are merged by the adapter. */
  onChange: (next: IPageDesignState) => void;
}
