/**
 * Design-panel DSL: the declarative contract a Design Bundle uses to describe
 * its editable panel. This is the community-facing API — a panel manifest is
 * pure data (no JSX/CSS/scripts), parsed and validated here, then rendered by
 * the client interpreter. Shared by the client renderer and any host-side
 * renderability check.
 */
import { parse } from 'yaml'
import { COMPONENT_KINDS, SOURCE_BOUND_COMPONENTS, SIDEBAR_TITLE_COMPONENT_KINDS, type ComponentKind } from './panel-component-catalog.ts'
import { validatePanelTranslations, isNavigationLabelTemplate, type PanelTranslations } from './panel-i18n.ts'
export { localizePanelManifest, panelTranslationKeys, validatePanelTranslations } from './panel-i18n.ts'
export { COMPONENT_KINDS, WORKSPACE_COMPONENT_KINDS, PANEL_COMPONENT_CATALOG, describePanelComponents, type ComponentKind } from './panel-component-catalog.ts'

/** Closed set of generic panel categories. */
export const PANEL_KINDS = [
  'evidence_workbook', 'capability_map', 'process', 'lifecycle', 'page_spec', 'document',
] as const
export type PanelKind = (typeof PANEL_KINDS)[number]

/** Authored sidebar-title decorations only; never URLs, JSX or record icons. */
export const SIDEBAR_ICONS = [
  'panels-top-left', 'bot', 'database', 'list-checks', 'palette', 'workflow',
  'blocks', 'plug', 'bell', 'map', 'clipboard-check', 'search', 'shield',
  'message-circle-question', 'file-text', 'pen-tool', 'columns-2', 'network',
  'chart-no-axes-combined', 'users', 'book-open',
] as const
export type SidebarIcon = (typeof SIDEBAR_ICONS)[number]

/** Closed set of editor field controls. */
export const CONTROL_KINDS = [
  'text', 'textarea', 'number', 'select', 'radio', 'list', 'multi_select',
  'record_select', 'record_multi_select', 'key_value', 'toggle', 'artifact_ref',
  'data_table', 'rows', 'source_list', 'token_list', 'radio_custom', 'record_map', 'source_reference_map', 'color',
] as const
export type ControlKind = (typeof CONTROL_KINDS)[number]

/** Closed set of typed column controls inside a `rows` sub-table. */
export const ROW_COLUMN_CONTROLS = ['text', 'textarea', 'select', 'ref'] as const
export type RowColumnControl = (typeof ROW_COLUMN_CONTROLS)[number]

/** Cross-panel reference: options/columns sourced from another skill panel's section. */
export interface PanelSectionRef {
  panel_type: string
  section_id: string
}

/**
 * Optional self-referential record hierarchy rendered by a record workspace.
 * The owning field is the parent reference; labels and inherited scalar fields
 * remain Bundle declarations rather than domain assumptions in the renderer.
 */
export interface RecordHierarchy {
  /** Field used as the new record's human-readable label. */
  label_field: string
  /** Outline subgroup shown beneath each parent record. */
  group_label: string
  /** Contextual create action; defaults to `Create ${group_label}`. */
  create_label?: string
  /** Heading of the create sheet; defaults to `create_label`. */
  create_title?: string
  /** Short explanation shown in the create sheet. */
  description?: string
  /** Scalar fields copied from the selected parent into the new record. */
  inherit_fields?: readonly string[]
}

/** One option of a choice control; `when` gates it on another field's value. */
export interface FieldOption {
  value: string
  label: string
  description?: string
  /** Optional glyph for token-list cards and their preset menu. */
  icon?: 'message-square' | 'plug'
  /** Token menu copy, separate from the saved-card description. */
  menu_description?: string
  selected_description?: string
  when?: { field: string; in: readonly string[] }
}

/** A typed column of the `rows` control (field value = array of row objects). */
export interface RowColumn {
  key: string
  control: RowColumnControl
  label: string
  required?: boolean
  wide?: boolean
  options?: readonly FieldOption[]
  /** `ref` column: options come from sections of this panel (value = record id). */
  ref_sections?: readonly string[]
  /** `ref` column: options come from another skill panel's section. */
  options_from_panel?: PanelSectionRef
  format?: 'upper_identifier'
}

/** Authored mathematical reading surface; every value stays in declared fields. */
export interface MathEntriesBinding {
  field: string
  formula: string
  meaning: string
  title?: string
  source?: string
  details?: readonly string[]
}
export interface MathDocumentBinding {
  heading: string
  introduction?: string
  notes?: string
  complete?: string
  symbols?: MathEntriesBinding
  statements: MathEntriesBinding
  /** Read-only landed output and recorded checks, never execution controls. */
  output?: { file: string; format?: string }
  checks?: { status: string; summary: string; evidence?: string }
  provenance?: readonly string[]
}

/** Finite record-form composition; references retain the section's canonical bindings. */
export interface FormField {
  kind: 'field'
  field: string
  label?: 'stacked' | 'inline' | 'visually_hidden'
  width?: 'auto' | 'fill'
}
export interface FormRow {
  kind: 'row'
  items: readonly (FormField | { kind: 'text'; text: string })[]
}
export interface FormGroup {
  kind: 'group'
  title?: string
  description?: string
  separator?: boolean
  /** Optional initially closed disclosure; contents retain their canonical values. */
  collapsible?: boolean
  items: readonly (FormField | FormRow)[]
  /** Read-only same-record preview beside this group's fields; stacks in narrow containers. */
  sidecar?: { component: 'record_preview'; title?: string; preview: NonNullable<ComponentNode['preview']> }
}
export interface FormTabs {
  kind: 'tabs'
  id: string
  title: string
  tabs: readonly { id: string; title: string; items: readonly (FormField | FormRow | FormGroup)[] }[]
}

/** A data section: a named collection of records in the Design Files. */
export interface PanelSection {
  id: string
  title: string
  item_name?: string
  add_label?: string
  description?: string
  /** Dotted schema/state path of this section's record collection; defaults to `id`. */
  records_path?: string
  /** Dotted path inside each record where editor fields are stored. */
  fields_path?: string
  /** Dotted schema/state path of the durable record-id order list. */
  order?: string
  /** Record-form presentation follows this section through inspectors and related editors.
   * Omitted configuration preserves the legacy title/body and order actions. */
  form?: {
    reorder?: boolean
    header?: {
      variant: 'detail' | 'card'
      title: { field: string; editable?: boolean } | { text: string; numbered?: boolean }
    }
    body?: readonly (FormField | FormRow | FormGroup | FormTabs)[]
  }
  /** Placement in a record-workspace navigator. Contextual records are
   * reached from the record they reference instead of becoming a competing
   * top-level category. */
  navigation?: 'primary' | 'contextual' | 'advanced'
  /** Where the shared UI creates new records for this section. */
  add_mode?: 'default' | 'graph' | 'context' | 'none'
  /** Optional canonical id field and initial scalar values for user-created records. */
  create?: {
    id_field?: string
    defaults?: Record<string, string | number | boolean | readonly string[]>
    /** Localized label for a newly inserted record only; never rewrites saved records.
     * A nonempty supplied name or default wins. numbered_text permits only {index}. */
    initial_label?: { field: string; text: string; numbered_text?: string }
  }
  confirm_delete?: boolean
  /** Explicit ownership cleanup, never inferred from ordinary references. */
  delete_children?: readonly { section: string; reference_field: string }[]
  /** Remove incident links, never another endpoint or another hop. */
  delete_relations?: readonly { section: string; reference_fields: readonly string[] }[]
  /** Canonical text summaries updated only when one of their inputs is edited. No expressions or code. */
  derived_fields?: Record<string, { parts: readonly { field: string; values?: Record<string, string>; fallback?: string }[]; separator?: string }>
}

/** An editor field bound to one or more sections. */
export interface EditorField {
  key: string
  control: ControlKind
  label?: string
  /** Ordered display-only labels gated by a sibling value; first match wins. */
  label_when?: readonly { field: string; in: readonly string[]; label: string }[]
  description?: string
  placeholder?: string
  max_length?: number
  input_type?: 'text' | 'url'
  /** Authored textarea viewport only; 3..20 visible rows, default unchanged. */
  textarea_rows?: number
  /** Choice presentation only; omitted keeps the legacy column layout. */
  choice_layout?: 'column' | 'row_wrap' | 'row_scroll'
  /** radio_custom: focus only following explicit user selection of Other. */
  custom_focus?: boolean
  /** select: false prevents new empty selections, without normalizing saved values. */
  allow_clear?: boolean
  readonly?: boolean
  /** Binding-only field (for example an owned parent reference); not an input. */
  hidden?: boolean
  /** token_list: suggestions remain optional; free text values are preserved. */
  token_layout?: 'chips' | 'cards'
  /** token_list: opt into a preset menu and cancellable custom-entry draft. */
  token_add_mode?: 'inline' | 'menu'
  token_add_description?: string
  token_custom_icon?: 'message-square' | 'plug'
  custom_description?: string
  applies_to?: readonly string[]
  /** Required-input presentation only; schema and validation own save/publication gates. */
  required?: boolean
  /** Section-specific alternative to required; no conditional expression or state mutation. */
  required_in?: readonly string[]
  wide?: boolean
  options?: readonly FieldOption[]
  /** Options come from a section of this panel (value = record id, label = record title). */
  options_from_section?: string
  /** Finite union of local record collections; duplicate identities are not selectable. */
  options_from_sections?: readonly string[]
  /** Options come from another skill panel's section (value = record id, label = record title). */
  options_from_panel?: PanelSectionRef
  /** Self-reference rendered as a navigable parent/child record hierarchy. */
  hierarchy?: RecordHierarchy
  /** Conditional visibility: a sibling value match, or all matches in a flat list. */
  visible_when?: { field: string; in: readonly string[] } | { all: readonly { field: string; in: readonly string[] }[] }
  /** Clear only on a visibility dependency edit: true empties text; 'omit'
   * removes an optional scalar property instead of inventing an empty enum. */
  clear_when_hidden?: true | 'omit'
  /** `rows` control: typed column declarations (field value = array of row objects). */
  columns?: readonly RowColumn[]
  /** `rows` control: row item noun used by add/remove affordances. */
  row_name?: string
  /** `rows` control: row count ceiling (default 50). */
  max_rows?: number
  /** record_map: optional child id copy and sibling order. Map keys always own identity. */
  id_field?: string
  order_field?: string
  /** record_map: typed child form, as an alternative to simple columns. Child
   * bindings are local fields, not new top-level sections or canonical records. */
  item_fields?: readonly EditorField[]
  item_defaults?: Record<string, string | number | boolean | readonly string[]>
  item_label_field?: string
  item_collapsible?: boolean
  readonly [extra: string]: unknown
}

/** A node in the UI component tree, data-bound to sections. */
export interface ComponentNode {
  /** Read-only Host activity selector; not a transcript or execution authority. */
  log?: {
    scope: 'producer' | 'artifact'
    artifact_id?: string
    artifact_id_path?: string
    artifact_kind?: string
    artifact_file_path?: string
    max_entries?: number
  }
  navigation_map?: {
    /** Creation policy only; never filters existing design facts. Omitted flags allow connections. */
    connection_policy?: { allow_self?: boolean; allow_parallel?: boolean }
    /** Project-relative shared stylesheet, read through the host artifact reader. */
    stylesheet?: string
    /** Ordered entry-node identities; independent of node geometry. */
    entry_ids?: string
    /** Explicit ancillary navigation rows removed with their target node. */
    reference_lists?: readonly { path: string; target: string }[]
    /** Read-only group membership rows; absent saved frames are derived from these. */
    grouping?: { path: string; target: string; label: string }
    nodes: { path: string; order: string; label: string; position: string; artifact?: string; artifact_kind?: string; parent?: string; caption_fields?: readonly string[] }
    edges: { path: string; order: string; source: string; target: string; label: string; hotspot?: string; hotspot_label?: string; new_label?: string; context?: string }
    frames: { path: string; label: string; members: string; position: string; size: string }
  }
  /** Optional alternate full-width form/canvas views sharing one selection. */
  workspace_view?: 'split' | 'switch'
  /** Record sidebar presentation; list omits collection and contextual tree nodes. Default: tree. */
  navigation_layout?: 'list' | 'tree'
  /** record_workspace: group primary navigation by a direct string/enum field
   * in each section's bound record. Groups are views, never parent records. */
  navigation_group_by?: string
  live_preview?: {
    file_path: string
    title_path?: string
    description_path?: string
    stylesheet?: string
    design_width?: number
    tokens: readonly { variable: string; path: string; fallback_path?: string; fallback?: string; values?: Record<string, string>; font_fallback?: string }[]
    presets?: readonly { id: string; title: string; description?: string; values: Record<string, string | number | boolean> }[]
    swatch_paths?: readonly string[]
    restore_paths?: readonly string[]
  }
  canvas?: { format: 'excalidraw'; file_field: string; label_field: string; id_field: string; scene_directory: string; asset_directory: string; new_title: string }
  diagram?: { format: 'bpmn'; file_field: string; label_field: string; label_source?: string; artifact_kind: string; order_only?: boolean; summary_fields?: readonly string[]; detail_rows?: readonly (readonly string[])[]; detail_hint_fields?: readonly string[]; chip_fields?: readonly string[]; tags?: readonly { field: string; labels?: Record<string, string>; tones?: Record<string, 'danger' | 'warning' | 'success' | 'neutral'> }[]
    /** Opt-in contextual record editor beside the diagram; all sections keep their existing bindings. */
    inspector?: {
      process_sections: readonly string[]
      nodes: { source: string; process_field: string; element_field: string; label_field: string; sections: readonly string[] }
      related?: readonly { source: string; process_field: string; node_field?: string; sections: readonly string[]; advanced?: boolean }[]
    }
  }
  artifacts?: {
    records_path: string
    order_path?: string
    current_path?: string
    title_field: string
    file_field: string
    artifact_kind: string
    children: {
      records_field: string
      order_field?: string
      title_field: string
      file_field: string
      points_field?: string
      links_field?: string
      artifact_kind: string
      scoped_ids?: boolean
    }
  }
  document?: {
    path: string
    title_path?: string
    allowed_files: readonly string[]
    aliases?: Record<string, string>
    source_attribute?: string
    references_attribute?: string
    references_path?: string
    references_id_field?: string
    references_label?: string
    legend?: string
    sources?: readonly { value: string; label: string; navigable?: boolean }[]
  }
  /** Card-board bindings are ordinary declared fields, not Kit-specific semantics. */
  board?: { label: string; description: string; group?: string; rejected?: string; badge?: string; detail_sections?: readonly string[]; detail_fields?: readonly string[]; details_title?: string; detail_presentation?: 'inline' | 'cover';
    /** Optional existing record ID, displayed without an editor or generated fallback. */
    id_field?: string;
    /** Fixed nested inputs remain visible even when optional/absent; viewing never initializes state. */
    detail_fields_mode?: 'fixed' | 'on_demand';
    /** User-authored request sent through the existing host composer, never inserted as a record. */
    request_create?: { fields: readonly string[]; prompt: string; submit_label: string };
    /** Authored child workspace collections filtered by their declared parent reference. */
    detail_sources?: readonly { section: string; reference: string }[] }
  /** Read-only visual preview of selected record fields. */
  preview?: { title: string; body: string; action?: string; empty?: string }
  component: ComponentKind
  id: string
  /** Optional header title rendered above the component body. */
  title?: string
  /** Static-only semantic icon beside the owning sidebar title. */
  sidebar_icon?: SidebarIcon
  /** Plain text only; React escapes it. Useful for generated explanatory UI. */
  text?: string
  /** Optional header description rendered under the title. */
  description?: string
  /** Independent panel-use guidance, not a Bundle description or empty-state message. */
  guidance?: string
  source?: string
  sources?: readonly string[]
  /** Studio field bindings (e.g. object_ref, axis_effects); keys are logical roles. */
  bindings?: Record<string, string>
  /** Reuse the function-board reading/editing card for same-record views. */
  record_cards?: { label: string; description: string; details_title: string; attention_fields?: readonly string[] }
  /** An explicitly declared parent reference across workspace collections. */
  navigation_hierarchy?: { field: string; root_source: string; child_source: string }
  /** Related editor: show ancestor-owned records read-only through the workspace's
   * declared graph hierarchy. This never copies records or grants edit authority. */
  inherit_from_graph?: true
  /** Authored related-record table: cells reuse the declared field editors and
   * canonical collection. No row conversion or generated-panel write grant. */
  record_table?: { columns: readonly { fields: readonly string[]; label?: string }[] }
  /** Declared references for reference_graph, or contextual records on a
   * participant relation_graph. All sections belong to the same workspace. */
  references?: {
    nodes: Array<{ source: string; label_field: string; label_scope?: 'fields' | 'record'; description_field?: string; kind_field?: string; icon?: SidebarIcon;
      /** Static enum-value decorations. No name guessing or external images. */
      kind_icons?: Record<string, SidebarIcon> }>
    links: Array<{ source: string; field: string; target?: string; targets?: readonly string[]; item_field?: string; label?: string; reverse?: boolean }>
    /** Optional authored hub-and-resources view. Section roles are geometry,
     * not Bundle names, runtime execution or a second relationship authority. */
    layout?: {
      kind: 'hub'
      center: string
      /** Decorative role portraits and anatomy view over the same center records. */
      center_presentation?: 'portrait'
      top?: string
      bottom?: string
      left?: string
      right?: string
      /** A center-owned single reference into top, used only to group its cards. */
      group_by?: string
      /** Optional center-owned text shown inside the focus view's center node. */
      value_field?: string
      /** Optional record-map captions. Full rows remain in the original form. */
      entries?: { field: string; title_field: string; description_field: string }
    }
  }
  graph?: {
    nodes: string
    edges: string
    source_field?: string
    target_field?: string
    /** Alternative to binary endpoints: ordered, role-bearing participation rows.
     * Rows remain owned by the relation; incidence nodes are view projections. */
    participants?: { field: string; reference_field: string; role_field: string; order_field: string }
    label_field: string
    node_kind_field?: string
    node_description_field?: string
    edge_kind_field?: string
    /** Optional scalar annotations adjacent to the declared source/target ports. */
    source_annotation_field?: string
    target_annotation_field?: string
    edge_state_field?: string
    edge_pending_values?: readonly string[]
    related?: readonly {
      source: string
      reference_field: string
      label_field: string
      value_field?: string
    }[]
    edge_defaults?: Record<string, string | number | boolean>
    /** Edge kinds whose source inherits from target; never copy parent records. */
    hierarchy?: {
      values: readonly string[]
      label: string
      description?: string
      /** Optional single-parent presentation policy; Bundle state validation
       * must enforce the same invariant independently of the UI. */
      max_parents?: 1
      /** Put the existing single-parent editor beside the record form title. */
      parent_control?: 'header'
      /** Opt-in child creation: new source node inherits from the selected target. */
      create?: { edge_kind: string; create_label: string; create_title: string }
    }
    /** Swap endpoints and explicitly paired endpoint properties atomically. */
    reverse?: { label: string; pairs?: readonly (readonly [string, string])[] }
  }
  /** Pivot a declared rows field without interpreting its business values. */
  matrix?: { field: string; row: string; column: string; value: string }
  /** Authored dynamic-field table in the selected record. */
  table?: { field: string }
  /** Read explanations beside LaTeX, with optional same-record editing. */
  math?: MathDocumentBinding
  /** Preview an existing artifact reference, never an arbitrary URL. */
  artifact?: {
    field: string
    /** Inline all artifacts explicitly referring to the selected parent record. */
    reference_field?: string
    /** Saved plain-text reading guidance, not executable artifact content. */
    explanation_field?: string
  }
  /** Bundle-owned artifact paths. The auto Panel validator pins these to the current inventory. */
  paths?: readonly string[]
  /** A schema-declared scalar field used only to group records in the view. */
  group_by?: string
  /** Two-level map navigation, with labels taken from existing record fields. */
  children_field?: string
  label_field?: string
  child_label_field?: string
  /** Authored question-workspace context, indexed by the saved numeric round. */
  rounds_source?: string
  /** Contiguous cards sharing a content-owned frame, without changing record order. */
  card_groups?: readonly { id: string; title: string; question_ids: readonly string[];
    presentation?: { always_expanded?: boolean; show_detail?: boolean; show_attachments?: boolean }
  }[]
  /** Optional question-workspace behavior; record identities belong to the Bundle. */
  question_policy?: {
    first_round_ids?: readonly string[]
    protected_ids?: readonly string[]
    history_readonly?: boolean
    numbered_rounds?: boolean
    allow_rejection?: boolean
    /** Authored dynamic choice cards only; generated panels cannot opt in. */
    allow_choice_actions?: boolean
  }
  /** Dotted Design JSON paths; '*' traverses one map level. */
  paths_from?: readonly string[]
  /** Auto Panel scalar field binding into the canonical Design JSON. */
  path?: string
  control?: ControlKind
  options?: readonly FieldOption[]
  children?: readonly ComponentNode[]
  slots?: { sidebar?: ComponentNode; main?: ComponentNode; overlay?: ComponentNode }
  readonly [extra: string]: unknown
}

/** A complete panel manifest. */
export interface PanelManifest {
  i18n?: PanelTranslations
  version: number
  panel_kind: PanelKind
  renderer?: string
  item_name?: string
  empty_description?: string
  /** Absent top-level scalar defaults applied only when the user edits; never overwrite saved facts. */
  initial_values?: Record<string, string | number | boolean>
  sections: readonly PanelSection[]
  fields: readonly EditorField[]
  ui: ComponentNode
}

import { isPanelSection, isEditorField, isRowColumn, isStringList, isSafeDottedPath, isUnsafePanelKey, validateScalarDefaults } from './panel-contract-primitives.ts'
import { validateNestedRecordField, validateIncidentDeletion } from './panel-record-contracts.ts'

/**
 * True when the gated field and the `when`-referenced field apply to at
 * least one common section, so the gate can observe the target's value on
 * the same record.
 * @param gated - the field carrying the conditional option.
 * @param targetKey - the field key referenced by `when.field`.
 * @param fields - all declared fields of the manifest (arbitrary JSON).
 * @returns whether a shared section exists.
 */
function sharesAppliesTo(gated: EditorField, targetKey: string, fields: readonly unknown[]): boolean {
  const target = fields.find((candidate): candidate is EditorField => isEditorField(candidate) && candidate.key === targetKey)
  if (target === undefined) return false
  const gatedSections = new Set(Array.isArray(gated.applies_to) ? gated.applies_to : [])
  const targetSections = Array.isArray(target.applies_to) ? target.applies_to : []
  return targetSections.some((section) => gatedSections.has(section))
}

/**
 * Validate a panel manifest, returning human-readable errors (empty = valid).
 * @param manifest - the candidate manifest.
 * @returns the list of validation errors.
 */
export function validatePanelManifest(manifest: PanelManifest): string[] {
  if (manifest === null || typeof manifest !== 'object') return ['manifest is not an object']
  const errors: string[] = []
  if (manifest.version !== 1) errors.push(`unsupported manifest version ${String(manifest.version)}`)
  if (!(PANEL_KINDS as readonly string[]).includes(manifest.panel_kind)) {
    errors.push(`unknown panel_kind "${String(manifest.panel_kind)}"`)
  }
  if (!Array.isArray(manifest.sections)) errors.push('sections must be a list')
  if (!Array.isArray(manifest.fields)) errors.push('fields must be a list')
  // Iterate as unknown: candidate manifests are arbitrary JSON, and every
  // shape check below reports instead of throwing.
  const sections: readonly unknown[] = Array.isArray(manifest.sections) ? manifest.sections : []
  const fields: readonly unknown[] = Array.isArray(manifest.fields) ? manifest.fields : []
  const sectionIds = new Set<string>()
  errors.push(...validatePanelTranslations(manifest))
  const scalarDefaults = (value: unknown, path: string, allowLists = true): void => { errors.push(...validateScalarDefaults(value, path, allowLists)) }
  if (manifest.initial_values !== undefined) scalarDefaults(manifest.initial_values, 'initial_values', false)
  for (const entry of sections) {
    if (!isPanelSection(entry)) {
      errors.push('section missing id')
      continue
    }
    if (!isSafeDottedPath(entry.id) || entry.id.includes('.')) errors.push(`section id "${entry.id}" must be a safe path segment`)
    if (sectionIds.has(entry.id)) errors.push(`duplicate section id "${entry.id}"`)
    sectionIds.add(entry.id)
    if (entry.confirm_delete !== undefined && typeof entry.confirm_delete !== 'boolean') errors.push(`section ${entry.id}: confirm_delete must be boolean`)
    if (entry.create !== undefined) {
      if (entry.create === null || typeof entry.create !== 'object' || Array.isArray(entry.create)) errors.push(`section ${entry.id}: invalid create contract`)
      else {
        if (entry.create.id_field !== undefined && (!isSafeDottedPath(entry.create.id_field) || entry.create.id_field.includes('.'))) errors.push(`section ${entry.id}: invalid id_field`)
        if (entry.create.defaults !== undefined) scalarDefaults(entry.create.defaults, `section ${entry.id}.create.defaults`)
        if (entry.create.initial_label !== undefined) {
          const label = entry.create.initial_label
          const path = `section ${entry.id}.create.initial_label`
          if (!label || typeof label !== 'object' || Array.isArray(label)) errors.push(`${path}: invalid label contract`)
          else {
            if (Object.keys(label).some(key => !['field', 'text', 'numbered_text'].includes(key))) errors.push(`${path}: unknown label option`)
            if (!isSafeDottedPath(label.field) || label.field.includes('.') || label.field === (entry.create.id_field ?? 'id')) errors.push(`${path}: field must be a safe non-id field`)
            const validText = (value: unknown, numbered: boolean): boolean => {
              if (typeof value !== 'string' || !value.trim()) return false
              if (/^\$t:[a-zA-Z0-9_.-]+$/.test(value)) return true
              if (value.includes('$t:')) return false
              return numbered
                ? value.includes('{index}') && !/[{}]/.test(value.replaceAll('{index}', ''))
                : !/[{}]/.test(value)
            }
            if (!validText(label.text, false)) errors.push(`${path}: invalid text template`)
            if (label.numbered_text !== undefined && !validText(label.numbered_text, true)) errors.push(`${path}: invalid numbered_text template`)
          }
        }
      }
    }
    if (typeof entry.title !== 'string' || entry.title.trim() === '') errors.push(`section "${entry.id}" missing title`)
    if (entry.navigation !== undefined && !['primary', 'contextual', 'advanced'].includes(entry.navigation)) {
      errors.push(`section "${entry.id}" has invalid navigation mode`)
    }
    if (entry.add_mode !== undefined && !['default', 'graph', 'context', 'none'].includes(entry.add_mode)) {
      errors.push(`section "${entry.id}" has invalid add mode`)
    }
    for (const key of ['records_path', 'fields_path', 'order'] as const) {
      const value = entry[key]
      if (value !== undefined && !isSafeDottedPath(value)) {
        errors.push(`section "${entry.id}" ${key} must be a safe dotted path`)
      }
    }
  }
  const fieldKeys = new Set<string>()
  for (const entry of fields) {
    if (!isEditorField(entry)) {
      errors.push('field missing string key')
      continue
    }
    if (fieldKeys.has(entry.key)) errors.push(`duplicate field key "${entry.key}"`)
    fieldKeys.add(entry.key)
  }
  for (const entry of fields) {
    if (!isEditorField(entry)) continue
    const field = entry
    for (const key of ['description', 'placeholder', 'custom_description'] as const) if (field[key] !== undefined && typeof field[key] !== 'string') errors.push(`field ${field.key}: ${key} must be text`)
    if (field.readonly !== undefined && typeof field.readonly !== 'boolean') errors.push(`field ${field.key}: readonly must be boolean`)
    if (field.hidden !== undefined && typeof field.hidden !== 'boolean') errors.push(`field ${field.key}: hidden must be boolean`)
    if (field.required !== undefined && typeof field.required !== 'boolean') errors.push(`field ${field.key}: required must be boolean`)
    if (field.required_in !== undefined) {
      if (!isStringList(field.required_in) || field.required_in.length === 0 || !isStringList(field.applies_to)
        || new Set(field.required_in).size !== field.required_in.length
        || field.required_in.some(section => !sectionIds.has(section) || !field.applies_to?.includes(section))) {
        errors.push(`field ${field.key}: required_in must name distinct applies_to sections`)
      }
      if (field.required !== undefined) errors.push(`field ${field.key}: use required or required_in, not both`)
    }
    if (!(CONTROL_KINDS as readonly string[]).includes(field.control)) {
      errors.push(`field "${field.key}" has unknown control "${String(field.control)}"`)
    }
    if (field.control === 'data_table' && ['columns', 'options', 'item_fields', 'max_rows', 'options_from_panel', 'options_from_section'].some(key => field[key] !== undefined)) errors.push(`field ${field.key}: data_table uses saved column definitions, not static editor options`)
    const choiceControl = ['select', 'radio', 'multi_select', 'record_select', 'record_multi_select', 'token_list', 'radio_custom'].includes(field.control)
    if (field.choice_layout !== undefined && (!['radio', 'radio_custom', 'multi_select'].includes(field.control)
      || !['column', 'row_wrap', 'row_scroll'].includes(field.choice_layout))) errors.push(`field ${field.key}: invalid choice_layout`)
    if (field.custom_focus !== undefined && (field.control !== 'radio_custom' || typeof field.custom_focus !== 'boolean')) errors.push(`field ${field.key}: custom_focus requires radio_custom and boolean`)
    if (field.allow_clear !== undefined && (field.control !== 'select' || typeof field.allow_clear !== 'boolean')) errors.push(`field ${field.key}: allow_clear requires select and boolean`)
    if (field.token_layout !== undefined && (field.control !== 'token_list' || !['chips', 'cards'].includes(field.token_layout))) errors.push(`field ${field.key}: invalid token_layout`)
    if (field.token_add_mode !== undefined && (field.control !== 'token_list' || !['inline', 'menu'].includes(field.token_add_mode))) errors.push(`field ${field.key}: invalid token_add_mode`)
    if (field.token_add_description !== undefined && (field.control !== 'token_list' || typeof field.token_add_description !== 'string')) errors.push(`field ${field.key}: invalid token_add_description`)
    if (field.token_custom_icon !== undefined && (field.control !== 'token_list' || !['message-square', 'plug'].includes(field.token_custom_icon))) errors.push(`field ${field.key}: invalid token_custom_icon`)
    if (Array.isArray(field.options)) for (const option of field.options) {
      if (option && option.icon !== undefined && (field.control !== 'token_list' || !['message-square', 'plug'].includes(option.icon))) errors.push(`field ${field.key}: invalid token option icon`)
      for (const key of ['menu_description', 'selected_description'] as const) if (option && option[key] !== undefined && (field.control !== 'token_list' || typeof option[key] !== 'string')) errors.push(`field ${field.key}: invalid token option ${key}`)
    }
    if (!choiceControl && field.options !== undefined) errors.push(`field "${field.key}" control "${field.control}" does not consume options`)
    if (!choiceControl && field.options_from_section !== undefined) errors.push(`field "${field.key}" control "${field.control}" does not consume options_from_section`)
    if (field.options_from_sections !== undefined) {
      if (!['record_select', 'record_multi_select'].includes(field.control)
        || !isStringList(field.options_from_sections) || field.options_from_sections.length < 2
        || new Set(field.options_from_sections).size !== field.options_from_sections.length
        || field.options_from_sections.some(section => !sectionIds.has(section))
        || field.options !== undefined || field.options_from_section !== undefined || field.options_from_panel !== undefined)
        errors.push(`field "${field.key}" options_from_sections needs distinct declared sections and an exclusive record reference source`)
    }
    if (!choiceControl && field.options_from_panel !== undefined) errors.push(`field "${field.key}" control "${field.control}" does not consume options_from_panel`)
    const hasStaticOptions = Array.isArray(field.options) && field.options.length > 0
    if (choiceControl && field.control !== 'token_list' && !hasStaticOptions && field.options_from_section === undefined && field.options_from_sections === undefined && field.options_from_panel === undefined) {
      errors.push(`field "${field.key}" control "${field.control}" requires an option source`)
    }
    if (field.applies_to !== undefined && !isStringList(field.applies_to)) {
      errors.push(`field "${field.key}" applies_to must be a string list`)
    }
    if (isStringList(field.applies_to)) {
      for (const target of field.applies_to) {
        if (!sectionIds.has(target)) errors.push(`field "${field.key}" applies_to unknown section "${target}"`)
      }
    }
    if (field.options !== undefined) {
      if (!Array.isArray(field.options)) {
        errors.push(`field "${field.key}" options must be a list`)
      } else {
        const optionValues = new Set<string>()
        field.options.forEach((option, index) => {
          if (option === null || typeof option !== 'object' || typeof option.value !== 'string' || option.value === '' || typeof option.label !== 'string' || option.label.trim() === '') {
            errors.push(`field "${field.key}" options[${index}] needs non-empty string value and label`)
            return
          }
          if (optionValues.has(option.value)) errors.push(`field "${field.key}" duplicates option value "${option.value}"`)
          optionValues.add(option.value)
          const when = option.when
          if (when !== undefined) {
            if (when === null || typeof when !== 'object' || typeof when.field !== 'string' || !fieldKeys.has(when.field) || !sharesAppliesTo(field, when.field, fields)) {
              errors.push(`field "${field.key}" options[${index}].when must reference a declared field sharing a section`)
            }
            if (when === null || typeof when !== 'object' || !isStringList(when.in) || when.in.length === 0) {
              errors.push(`field "${field.key}" options[${index}].when needs a non-empty string list "in"`)
            }
          }
        })
      }
    }
    if (field.options_from_section !== undefined && (typeof field.options_from_section !== 'string' || !sectionIds.has(field.options_from_section))) {
      errors.push(`field "${field.key}" options_from_section references unknown section "${String(field.options_from_section)}"`)
    }
    const hierarchy = field.hierarchy
    if (hierarchy !== undefined) {
      const targets = isStringList(field.applies_to) ? field.applies_to : []
      if (field.control !== 'record_select' || targets.length !== 1 || field.options_from_section !== targets[0]) {
        errors.push(`field "${field.key}" hierarchy requires one self-referencing record_select section`)
      }
      if (hierarchy === null || typeof hierarchy !== 'object'
        || !isSafeDottedPath(hierarchy.label_field) || hierarchy.label_field.includes('.')
        || typeof hierarchy.group_label !== 'string' || hierarchy.group_label.trim() === '') {
        errors.push(`field "${field.key}" hierarchy needs label_field and non-empty group_label`)
      } else {
        const target = targets[0]
        const label = fields.find((candidate): candidate is EditorField => isEditorField(candidate)
          && candidate.key === hierarchy.label_field && candidate.control === 'text'
          && target !== undefined && candidate.applies_to?.includes(target) === true)
        if (!label) errors.push(`field "${field.key}" hierarchy label_field must be a text field on the same section`)
        for (const key of ['create_label', 'create_title', 'description'] as const) {
          const value = hierarchy[key]
          if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
            errors.push(`field "${field.key}" hierarchy ${key} must be a non-empty string`)
          }
        }
        if (hierarchy.inherit_fields !== undefined) {
          if (!isStringList(hierarchy.inherit_fields)) errors.push(`field "${field.key}" hierarchy inherit_fields must be a string list`)
          else for (const inherited of hierarchy.inherit_fields) {
            const declaration = fields.find((candidate): candidate is EditorField => isEditorField(candidate)
              && candidate.key === inherited && target !== undefined && candidate.applies_to?.includes(target) === true)
            if (!declaration || !['text', 'textarea', 'number', 'select', 'radio', 'toggle', 'record_select'].includes(declaration.control)
              || inherited === field.key || inherited === hierarchy.label_field) {
              errors.push(`field "${field.key}" hierarchy inherits invalid field "${inherited}"`)
            }
          }
        }
      }
    }
    const panelRef = field.options_from_panel
    if (panelRef !== undefined && (panelRef === null || typeof panelRef !== 'object' || typeof panelRef.panel_type !== 'string' || panelRef.panel_type === '' || typeof panelRef.section_id !== 'string' || panelRef.section_id === '')) {
      errors.push(`field "${field.key}" options_from_panel needs non-empty panel_type and section_id`)
    }
    const visibleWhen = field.visible_when
    if (field.label_when !== undefined) {
      if (!Array.isArray(field.label_when) || field.label_when.length === 0) {
        errors.push(`field "${field.key}" label_when must be a non-empty list`)
      } else for (const variant of field.label_when) {
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)
          || Object.keys(variant).some(key => !['field', 'in', 'label'].includes(key))
          || typeof variant.field !== 'string' || !fieldKeys.has(variant.field) || !sharesAppliesTo(field, variant.field, fields)
          || !isStringList(variant.in) || variant.in.length === 0
          || typeof variant.label !== 'string' || variant.label.trim() === '') {
          errors.push(`field "${field.key}" label_when needs a declared sibling field, non-empty in and label`)
        }
      }
    }
    if (visibleWhen !== undefined) {
      if (visibleWhen !== null && typeof visibleWhen === 'object' && 'all' in visibleWhen) {
        if (Array.isArray(visibleWhen) || Object.keys(visibleWhen).some(key => key !== 'all')
          || !Array.isArray(visibleWhen.all) || visibleWhen.all.length === 0) {
          errors.push(`field "${field.key}" visible_when.all must be a non-empty flat condition list with no sibling keys`)
        } else for (const [index, condition] of visibleWhen.all.entries()) {
          const path = `field "${field.key}" visible_when.all[${index}]`
          if (!condition || typeof condition !== 'object' || Array.isArray(condition)
            || Object.keys(condition).some(key => !['field', 'in'].includes(key))) {
            errors.push(`${path} must be a flat field/in condition`)
          } else {
            if (typeof condition.field !== 'string' || !fieldKeys.has(condition.field) || !sharesAppliesTo(field, condition.field, fields)) {
              errors.push(`${path} must reference a declared field sharing a section`)
            }
            if (!isStringList(condition.in) || condition.in.length === 0) {
              errors.push(`${path}.in must be a non-empty string list`)
            }
          }
        }
      } else {
        if (visibleWhen === null || typeof visibleWhen !== 'object' || typeof visibleWhen.field !== 'string' || !fieldKeys.has(visibleWhen.field) || !sharesAppliesTo(field, visibleWhen.field, fields)) {
          errors.push(`field "${field.key}" visible_when must reference a declared field sharing a section`)
        }
        if (visibleWhen === null || typeof visibleWhen !== 'object' || !isStringList(visibleWhen.in) || visibleWhen.in.length === 0) {
          errors.push(`field "${field.key}" visible_when.in must be a non-empty string list`)
        }
      }
    }
    if (field.clear_when_hidden !== undefined && (visibleWhen === undefined
      || (field.clear_when_hidden === true ? !['text', 'textarea', 'list'].includes(field.control)
        : field.clear_when_hidden !== 'omit' || !['text', 'textarea', 'number', 'toggle', 'select', 'radio', 'radio_custom', 'color'].includes(field.control)))) errors.push(`field ${field.key}: clear_when_hidden requires conditional text/list or optional scalar omission`)
    if (field.item_collapsible !== undefined && (field.control !== 'record_map' || typeof field.item_collapsible !== 'boolean')) errors.push(`field ${field.key}: item_collapsible requires a record map and boolean`)
    if (field.control === 'record_map') {
      if ((field.id_field !== undefined && (!isSafeDottedPath(field.id_field) || field.id_field.includes('.')))
        || (field.order_field !== undefined && (!isSafeDottedPath(field.order_field) || field.order_field.includes('.') || field.order_field === field.key))) errors.push(`field ${field.key}: record_map requires safe optional id_field and sibling order_field`)
      if (Array.isArray(field.columns) && field.columns.some(column => !isRowColumn(column) || !['text', 'textarea', 'select'].includes(column.control) || column.key === field.id_field || (Array.isArray(column.options) && column.options.some(option => option?.when !== undefined)))) errors.push(`field ${field.key}: record_map requires scalar text columns or unconditional select options, excluding identity`)
    }
    errors.push(...validateNestedRecordField(field, manifest, validatePanelManifest))
    if (field.max_length !== undefined && (!['text', 'textarea'].includes(field.control) || !Number.isSafeInteger(field.max_length) || field.max_length <= 0)) errors.push(`field ${field.key}: max_length requires a positive integer on text or textarea`)
    if (field.input_type !== undefined && (field.control !== 'text' || !['text', 'url'].includes(field.input_type))) errors.push(`field ${field.key}: input_type is only supported on text`)
    if (field.textarea_rows !== undefined && (field.control !== 'textarea' || !Number.isSafeInteger(field.textarea_rows)
      || field.textarea_rows < 3 || field.textarea_rows > 20)) errors.push(`field ${field.key}: textarea_rows requires textarea and an integer from 3 to 20`)
    if (field.control === 'rows' || (field.control === 'record_map' && field.item_fields === undefined)) {
      const columns = field.columns
      if (columns === undefined || (Array.isArray(columns) && columns.length === 0)) {
        errors.push(`field "${field.key}" control "rows" requires columns`)
      } else if (!Array.isArray(columns)) {
        errors.push(`field "${field.key}" columns must be a list`)
      } else {
        // Precompute the complete valid key set: a column option's `when`
        // may reference a later-declared column.
        const validColumnKeys = new Set(columns.filter(isRowColumn).map((candidate) => candidate.key))
        const columnKeys = new Set<string>()
        for (const columnEntry of columns) {
          if (!isRowColumn(columnEntry)) {
            errors.push(`field "${field.key}" has a rows column without key`)
            continue
          }
          if (columnEntry.format !== undefined && (field.control !== 'record_map' || columnEntry.format !== 'upper_identifier' || columnEntry.control !== 'text')) errors.push(`field ${field.key}: invalid column format`)
          const column = columnEntry
          if (column.required !== undefined && typeof column.required !== 'boolean') errors.push(`field ${field.key}: column ${column.key} required must be boolean`)
          if (typeof column.label !== 'string' || column.label.trim() === '') {
            errors.push(`field "${field.key}" rows column "${column.key}" missing label`)
          }
          if (columnKeys.has(column.key)) errors.push(`field "${field.key}" duplicates rows column "${column.key}"`)
          columnKeys.add(column.key)
          if (!(ROW_COLUMN_CONTROLS as readonly string[]).includes(column.control)) {
            errors.push(`field "${field.key}" rows column "${column.key}" has unknown control "${String(column.control)}"`)
          }
          if (column.control !== 'select' && column.options !== undefined) {
            errors.push(`field "${field.key}" rows column "${column.key}" control "${column.control}" does not consume options`)
          }
          if (column.control === 'select' && (!Array.isArray(column.options) || column.options.length === 0)) {
            errors.push(`field "${field.key}" rows column "${column.key}" select requires non-empty options`)
          }
          const hasSections = column.ref_sections !== undefined
          const hasPanel = column.options_from_panel !== undefined
          if (column.control !== 'ref' && (hasSections || hasPanel)) {
            errors.push(`field "${field.key}" rows column "${column.key}" control "${column.control}" does not consume a ref option source`)
          }
          if (column.control === 'ref') {
            if (hasSections === hasPanel) {
              errors.push(`field "${field.key}" rows column "${column.key}" ref needs exactly one of ref_sections or options_from_panel`)
            }
            if (hasSections && (!isStringList(column.ref_sections) || column.ref_sections.length === 0)) {
              errors.push(`field "${field.key}" rows column "${column.key}" ref_sections must be a non-empty string list`)
            }
          }
          const columnPanelRef = column.options_from_panel
          if (columnPanelRef !== undefined && (columnPanelRef === null || typeof columnPanelRef !== 'object' || typeof columnPanelRef.panel_type !== 'string' || columnPanelRef.panel_type === '' || typeof columnPanelRef.section_id !== 'string' || columnPanelRef.section_id === '')) {
            errors.push(`field "${field.key}" rows column "${column.key}" options_from_panel needs non-empty panel_type and section_id`)
          }
          if (isStringList(column.ref_sections)) {
            for (const target of column.ref_sections) {
              if (!sectionIds.has(target)) errors.push(`field "${field.key}" rows column "${column.key}" ref_sections references unknown section "${target}"`)
            }
          }
          if (column.options !== undefined) {
            if (!Array.isArray(column.options)) {
              errors.push(`field "${field.key}" rows column "${column.key}" options must be a list`)
            } else {
              const columnOptionValues = new Set<string>()
              column.options.forEach((option, index) => {
                if (option === null || typeof option !== 'object' || typeof option.value !== 'string' || option.value === '' || typeof option.label !== 'string' || option.label.trim() === '') {
                  errors.push(`field "${field.key}" rows column "${column.key}" options[${index}] needs non-empty string value and label`)
                  return
                }
                if (columnOptionValues.has(option.value)) errors.push(`field "${field.key}" rows column "${column.key}" duplicates option value "${option.value}"`)
                columnOptionValues.add(option.value)
                const when = option.when
                if (when !== undefined) {
                  if (when === null || typeof when !== 'object' || typeof when.field !== 'string' || !validColumnKeys.has(when.field)) {
                    errors.push(`field "${field.key}" rows column "${column.key}" options[${index}].when must reference a column of the same rows field`)
                  }
                  if (when === null || typeof when !== 'object' || !isStringList(when.in) || when.in.length === 0) {
                    errors.push(`field "${field.key}" rows column "${column.key}" options[${index}].when needs a non-empty string list "in"`)
                  }
                }
              })
            }
          }
        }
      }
      if (field.max_rows !== undefined && (!Number.isInteger(field.max_rows) || field.max_rows <= 0)) {
        errors.push(`field "${field.key}" max_rows must be a positive integer`)
      }
    }
  }
  for (const section of sections) {
    if (!isPanelSection(section) || section.form === undefined) continue
    const form = section.form
    const path = `section ${section.id}.form`
    if (!form || typeof form !== 'object' || Array.isArray(form)) { errors.push(`${path}: invalid form contract`); continue }
    if (Object.keys(form).some(key => !['header', 'reorder', 'body'].includes(key))) errors.push(`${path}: unknown form option`)
    if (form.reorder !== undefined && typeof form.reorder !== 'boolean') errors.push(`${path}: reorder must be boolean`)
    if (form.body !== undefined) {
      const seen = new Set<string>()
      const tabGroups = new Set<string>()
      if (form.header?.title && typeof form.header.title === 'object' && 'field' in form.header.title) seen.add(form.header.title.field)
      const visit = (raw: unknown, allowed: readonly string[], at: string): void => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { errors.push(`${at}: invalid body item`); return }
        const item = raw as Record<string, unknown>
        if (typeof item.kind !== 'string' || !allowed.includes(item.kind)) { errors.push(`${at}: invalid body kind`); return }
        const keys = item.kind === 'field' ? ['kind', 'field', 'label', 'width']
          : item.kind === 'text' ? ['kind', 'text'] : item.kind === 'row' ? ['kind', 'items']
          : item.kind === 'tabs' ? ['kind', 'id', 'title', 'tabs'] : ['kind', 'title', 'description', 'separator', 'collapsible', 'items', 'sidecar']
        if (Object.keys(item).some(key => !keys.includes(key))) errors.push(`${at}: unknown body option`)
        if (item.kind === 'tabs') {
          if (typeof item.id !== 'string' || !item.id.trim() || tabGroups.has(item.id)) errors.push(`${at}: tabs require a unique nonempty id`)
          else tabGroups.add(item.id)
          if (typeof item.title !== 'string' || !item.title.trim()) errors.push(`${at}: tabs require a title`)
          if (!Array.isArray(item.tabs) || item.tabs.length === 0) { errors.push(`${at}: tabs must be a nonempty list`); return }
          const ids = new Set<string>()
          item.tabs.forEach((tab, i) => {
            if (!tab || typeof tab !== 'object' || Array.isArray(tab)
              || Object.keys(tab).some(key => !['id', 'title', 'items'].includes(key))
              || typeof tab.id !== 'string' || !tab.id.trim() || ids.has(tab.id)
              || typeof tab.title !== 'string' || !tab.title.trim()
              || !Array.isArray(tab.items) || !tab.items.length) { errors.push(`${at}.tabs[${i}]: invalid tab`); return }
            ids.add(tab.id)
            tab.items.forEach((child: unknown, j: number) => visit(child, ['field', 'row', 'group'], `${at}.tabs[${i}].items[${j}]`))
          })
        } else if (item.kind === 'field') {
          if (!isSafeDottedPath(item.field) || item.field.includes('.')) { errors.push(`${at}: invalid field reference`); return }
          const field = fields.find((entry): entry is EditorField => isEditorField(entry)
            && entry.key === item.field && entry.applies_to?.includes(section.id) === true)
          if (!field || field.hidden) errors.push(`${at}: body needs an applicable visible field`)
          if (seen.has(item.field)) errors.push(`${at}: duplicate body/header field ${item.field}`)
          seen.add(item.field)
          if (item.label !== undefined && (typeof item.label !== 'string' || !['stacked', 'inline', 'visually_hidden'].includes(item.label))) errors.push(`${at}: invalid label placement`)
          if (item.width !== undefined && (typeof item.width !== 'string' || !['auto', 'fill'].includes(item.width))) errors.push(`${at}: invalid field width`)
        } else if (item.kind === 'text') {
          if (typeof item.text !== 'string' || !item.text.trim()) errors.push(`${at}: display text must be nonempty`)
        } else {
          if (item.kind === 'group') {
            for (const key of ['title', 'description']) if (item[key] !== undefined && (typeof item[key] !== 'string' || !(item[key] as string).trim())) errors.push(`${at}: ${key} must be nonempty text`)
            if (item.separator !== undefined && typeof item.separator !== 'boolean') errors.push(`${at}: separator must be boolean`)
            if (item.collapsible !== undefined && (typeof item.collapsible !== 'boolean' || (item.collapsible && (typeof item.title !== 'string' || !item.title.trim())))) errors.push(`${at}: collapsible group requires boolean and nonempty title`)
            if (item.sidecar !== undefined) {
              const sidecar = item.sidecar as Record<string, unknown>
              if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)
                || Object.keys(sidecar).some(key => !['component', 'title', 'preview'].includes(key))
                || sidecar.component !== 'record_preview') errors.push(`${at}: sidecar requires a closed record_preview contract`)
              else {
                if (sidecar.title !== undefined && (typeof sidecar.title !== 'string' || !sidecar.title.trim())) errors.push(`${at}: sidecar title must be nonempty text`)
                const preview = sidecar.preview as Record<string, unknown>
                if (!preview || typeof preview !== 'object' || Array.isArray(preview)
                  || Object.keys(preview).some(key => !['title', 'body', 'action', 'empty'].includes(key))) errors.push(`${at}: invalid sidecar preview binding`)
                else {
                  for (const key of ['title', 'body', 'action']) {
                    const value = preview[key]
                    if (key === 'action' && value === undefined) continue
                    const field = fields.find((entry): entry is EditorField => isEditorField(entry)
                      && entry.key === value && entry.applies_to?.includes(section.id) === true)
                    if (!isSafeDottedPath(value) || value.includes('.') || !field || field.hidden || field.visible_when
                      || !['text', 'textarea'].includes(field.control)) errors.push(`${at}: sidecar ${key} requires a declared unconditional same-section text field`)
                  }
                  if (preview.empty !== undefined && (typeof preview.empty !== 'string' || !preview.empty.trim())) errors.push(`${at}: sidecar empty must be nonempty text`)
                }
              }
            }
          }
          if (!Array.isArray(item.items) || item.items.length === 0) { errors.push(`${at}: items must be a nonempty list`); return }
          item.items.forEach((child, i) => visit(child, item.kind === 'row' ? ['field', 'text'] : ['field', 'row'], `${at}.items[${i}]`))
        }
      }
      if (!Array.isArray(form.body)) errors.push(`${path}: body must be a list`)
      else form.body.forEach((item, i) => visit(item, ['field', 'row', 'group', 'tabs'], `${path}.body[${i}]`))
    }
    if (form.header === undefined) continue
    const header = form.header
    if (!header || typeof header !== 'object' || Array.isArray(header)
      || !['detail', 'card'].includes(header.variant)
      || Object.keys(header).some(key => !['variant', 'title'].includes(key))) { errors.push(`${path}: invalid header`); continue }
    const title = header.title
    if (!title || typeof title !== 'object' || Array.isArray(title)) { errors.push(`${path}: invalid header title`); continue }
    if ('field' in title) {
      if (Object.keys(title).some(key => !['field', 'editable'].includes(key))
        || !isSafeDottedPath(title.field) || title.field.includes('.')
        || title.field === (section.create?.id_field ?? 'id')
        || (title.editable !== undefined && typeof title.editable !== 'boolean')) errors.push(`${path}: invalid title field binding`)
      const field = fields.find((entry): entry is EditorField => isEditorField(entry)
        && entry.key === title.field && entry.applies_to?.includes(section.id) === true)
      if (!field || field.control !== 'text' || field.hidden || field.visible_when
        || (title.editable && (field.readonly || Object.hasOwn(section.derived_fields ?? {}, title.field)))) {
        errors.push(`${path}: title needs an unconditional declared text field; editable title must be writable and not derived`)
      }
    } else if (!('text' in title) || typeof title.text !== 'string' || !title.text.trim()
      || Object.keys(title).some(key => !['text', 'numbered'].includes(key))
      || (title.numbered !== undefined && typeof title.numbered !== 'boolean')) errors.push(`${path}: invalid display title`)
  }
  for (const section of sections) {
    if (!isPanelSection(section) || section.derived_fields === undefined) continue
    const derived = section.derived_fields
    if (!derived || typeof derived !== 'object' || Array.isArray(derived)) { errors.push(`section ${section.id}: invalid derived_fields`); continue }
    for (const [target, definition] of Object.entries(derived)) {
      if (!isSafeDottedPath(target) || target.includes('.') || target === section.create?.id_field
        || fields.some(field => isEditorField(field) && field.key === target && field.applies_to?.includes(section.id) && !field.readonly)) errors.push(`section ${section.id}: derived target ${target} cannot be editable or an identity`)
      if (!definition || typeof definition !== 'object' || !Array.isArray(definition.parts) || !definition.parts.length || definition.parts.length > 8
        || (definition.separator !== undefined && typeof definition.separator !== 'string')) { errors.push(`section ${section.id}: invalid derived text ${target}`); continue }
      for (const part of definition.parts) {
        if (!part || typeof part !== 'object' || typeof part.field !== 'string' || Object.hasOwn(derived, part.field)
          || !fields.some(field => isEditorField(field) && field.key === part.field && field.applies_to?.includes(section.id) && ['text', 'textarea', 'select', 'radio', 'radio_custom'].includes(field.control))) errors.push(`section ${section.id}: derived text must use declared scalar inputs without chaining`)
        if (part && typeof part === 'object') {
          if (part.fallback !== undefined && typeof part.fallback !== 'string') errors.push(`section ${section.id}: derived fallback must be text`)
          if (part.values !== undefined && (!part.values || typeof part.values !== 'object' || Array.isArray(part.values) || Object.values(part.values).some(value => typeof value !== 'string'))) errors.push(`section ${section.id}: derived values must be a text map`)
        }
      }
    }
  }
  for (const section of sections) {
    if (!isPanelSection(section) || section.delete_children === undefined) continue
    if (!Array.isArray(section.delete_children)) { errors.push(`section ${section.id}: delete_children must be a list`); continue }
    const seen = new Set<string>()
    for (const target of section.delete_children) {
      if (!target || typeof target !== 'object' || typeof target.section !== 'string' || seen.has(target.section)
        || target.section === section.id || !sectionIds.has(target.section)) { errors.push(`section ${section.id}: invalid delete_children target`); continue }
      seen.add(target.section)
      const reference = fields.find((field): field is EditorField => isEditorField(field) && field.key === target.reference_field
        && field.applies_to?.includes(target.section) === true)
      if (reference?.control !== 'record_select' || reference.options_from_section !== section.id) errors.push(`section ${section.id}: delete_children needs a declared single reference to its owner`)
      // Keep ownership deletion bounded. Multi-hop/cyclic cleanup is not inferred.
      if (sections.some(candidate => isPanelSection(candidate) && candidate.id === target.section && candidate.delete_children?.length)) errors.push(`section ${section.id}: chained delete_children is not supported`)
    }
  }
  errors.push(...validateIncidentDeletion(sections, fields))
  const checkNode = (node: unknown, path: string, workspace?: readonly string[], workspaceGraph?: ComponentNode['graph']): void => {
    if (node === undefined) {
      errors.push(`${path}: missing component node`)
      return
    }
    if (node === null || typeof node !== 'object') {
      errors.push(`${path}: component node must be an object`)
      return
    }
    const component = node as ComponentNode
    let scope = workspace
    let graphScope = workspaceGraph
    if (component.sidebar_icon !== undefined) {
      if (typeof component.sidebar_icon !== 'string' || !(SIDEBAR_ICONS as readonly string[]).includes(component.sidebar_icon))
        errors.push(`${path}: invalid sidebar_icon`)
      if (!(SIDEBAR_TITLE_COMPONENT_KINDS as readonly string[]).includes(component.component))
        errors.push(`${path}: sidebar_icon requires a component with a sidebar title`)
    }
    if (!(COMPONENT_KINDS as readonly string[]).includes(component.component)) {
      errors.push(`${path}: unknown component "${String(component.component)}"`)
    }
    if (typeof component.id !== 'string' || component.id.trim() === '') errors.push(`${path}: component missing id`)
    if (component.guidance !== undefined && (typeof component.guidance !== 'string' || !component.guidance.trim())) errors.push(`${path}: guidance must be nonempty text`)
    const fieldOf = (section: unknown, key: unknown): EditorField | undefined => typeof key === 'string' && isSafeDottedPath(key) && !key.includes('.')
      ? fields.find((field): field is EditorField => isEditorField(field) && field.key === key
        && Array.isArray(field.applies_to) && field.applies_to.includes(String(section)))
      : undefined
    const ownsField = (section: unknown, key: unknown) => fieldOf(section, key) !== undefined
    if (component.component === 'navigation_workspace') {
      const config = component.navigation_map
      if (!config || !config.nodes || !config.edges || !config.frames) errors.push(`${path}: navigation workspace requires nodes, edges and frames bindings`)
      else {
        if (config.stylesheet !== undefined && (typeof config.stylesheet !== 'string' || !/^[\w-]+\/(?:[\w-]+\/)*[\w.-]+\.css$/.test(config.stylesheet))) errors.push(`${path}: invalid preview stylesheet`)
        const groups = [config.nodes, config.edges, config.frames]
        if (config.connection_policy !== undefined) {
          const policy = config.connection_policy
          if (!policy || typeof policy !== 'object' || Array.isArray(policy)
            || Object.entries(policy).some(([key, value]) => !['allow_self', 'allow_parallel'].includes(key) || typeof value !== 'boolean')) {
            errors.push(`${path}: invalid navigation connection policy`)
          }
        }
        if (config.grouping !== undefined) {
          const grouping = config.grouping
          if (!grouping || typeof grouping !== 'object' || Array.isArray(grouping)
            || !isSafeDottedPath(grouping.path)
            || [grouping.target, grouping.label].some(key => typeof key !== 'string' || !isSafeDottedPath(key) || key.includes('.'))
            || grouping.target === grouping.label) errors.push(`${path}: invalid navigation grouping binding`)
        }
        if (config.entry_ids !== undefined && (typeof config.entry_ids !== 'string' || !isSafeDottedPath(config.entry_ids))) errors.push(`${path}: invalid navigation entry binding`)
        if (config.reference_lists !== undefined && (!Array.isArray(config.reference_lists)
          || config.reference_lists.some(ref => !ref || !isSafeDottedPath(ref.path) || !isSafeDottedPath(ref.target) || ref.target.includes('.')))) errors.push(`${path}: invalid navigation reference list`)
        if (config.nodes.parent !== undefined) {
          const parent = fieldOf(config.nodes.path, config.nodes.parent)
          if (parent?.control !== 'record_select' || parent.options_from_section !== config.nodes.path) errors.push(`${path}: navigation parent must reference nodes`)
        }
        if (config.nodes.caption_fields !== undefined && (!Array.isArray(config.nodes.caption_fields)
          || new Set(config.nodes.caption_fields).size !== config.nodes.caption_fields.length
          || config.nodes.caption_fields.some(key => { const field = fieldOf(config.nodes.path, key); return !field || field.hidden === true || !['text', 'select', 'list'].includes(field.control) }))) errors.push(`${path}: navigation captions require distinct visible text, select or list fields`)
        for (const group of groups) {
          if (!group || typeof group !== 'object' || Array.isArray(group)
            || Object.entries(group).some(([key, value]) => group === config.nodes && key === 'caption_fields' ? false : group === config.edges && key === 'new_label'
              ? value !== undefined && !isNavigationLabelTemplate(value, true)
              : typeof value !== 'string' || !isSafeDottedPath(value))) errors.push(`${path}: invalid navigation binding`)
          if (!sections.some(section => isPanelSection(section) && section.id === group.path && !section.fields_path && !section.records_path)) errors.push(`${path}: navigation collections must bind direct declared sections`)
          if (!ownsField(group.path, group.label)) errors.push(`${path}: navigation label requires a declared field`)
        }
        if (new Set(groups.map(group => group.path)).size !== 3) errors.push(`${path}: navigation collections must differ`)
        for (const field of [config.edges.source, config.edges.target]) {
          const def = fieldOf(config.edges.path, field)
          if (def?.control !== 'record_select' || def.options_from_section !== config.nodes.path) errors.push(`${path}: navigation endpoints must reference nodes`)
        }
        if (config.edges.source === config.edges.target) errors.push(`${path}: navigation endpoints must differ`)
        for (const key of [config.edges.hotspot, config.edges.hotspot_label]) {
          if (key !== undefined && !ownsField(config.edges.path, key)) errors.push(`${path}: navigation hotspot requires a declared field`)
        }
        if (config.edges.hotspot_label && !config.edges.hotspot) errors.push(`${path}: navigation hotspot label requires an identity field`)
        // Context is canonical read-only metadata, not an editor string field.
        if (config.edges.context !== undefined && (!config.edges.hotspot || !isSafeDottedPath(config.edges.context) || config.edges.context.includes('.'))) errors.push(`${path}: navigation context requires a direct metadata field and hotspot`)
        const navigationFields = [config.edges.source, config.edges.target, config.edges.label, config.edges.hotspot, config.edges.hotspot_label, config.edges.context].filter(key => key !== undefined)
        if (new Set(navigationFields).size !== navigationFields.length) errors.push(`${path}: navigation edge fields must differ`)
      }
    }
    if (component.component === 'canvas_workspace') {
      const config = component.canvas, section = sections.find((section): section is PanelSection => isPanelSection(section) && section.id === component.source)
      if (!config || typeof config !== 'object' || config.format !== 'excalidraw') errors.push(`${path}: canvas requires a supported native format`)
      else {
        if (!section?.order || section.fields_path) errors.push(`${path}: canvas requires directly owned records with an explicit order`)
        if (fieldOf(component.source, config.file_field)?.control !== 'artifact_ref') errors.push(`${path}: canvas file must bind an artifact_ref field`)
        for (const key of [config.label_field, config.id_field]) if (!ownsField(component.source, key)) errors.push(`${path}: canvas identity and title require declared fields`)
        if (new Set([config.file_field, config.label_field, config.id_field]).size !== 3) errors.push(`${path}: canvas fields must be distinct`)
        for (const directory of [config.scene_directory, config.asset_directory]) if (typeof directory !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(directory)
          || ['__proto__', 'constructor', 'prototype'].includes(directory)) errors.push(`${path}: canvas directories must be safe Bundle-relative directory names`)
        if (config.scene_directory === config.asset_directory) errors.push(`${path}: canvas scenes and images require separate directories`)
        if (typeof config.new_title !== 'string' || !config.new_title.trim()) errors.push(`${path}: canvas requires an initial title`)
      }
    }
    if (component.component === 'diagram_workspace') {
      const config = component.diagram
      if (!config || typeof config !== 'object' || config.format !== 'bpmn') errors.push(`${path}: diagram workspace requires a supported format`)
      else {
        if (fieldOf(component.source, config.file_field)?.control !== 'artifact_ref') errors.push(`${path}: diagram file must bind an artifact_ref field`)
        const collectionOf = (id: string | undefined) => { const section = manifest.sections.find(item => item.id === id); return section ? section.records_path ?? section.id : undefined }
        if (!ownsField(config.label_source ?? component.source, config.label_field)) errors.push(`${path}: diagram label must bind a declared field`)
        if (config.label_source !== undefined && collectionOf(config.label_source) !== collectionOf(component.source)) errors.push(`${path}: diagram label source must share the diagram collection`)
        if (config.inspector !== undefined) {
          const inspector = config.inspector
          const sameSections = (sections: unknown, source: string | undefined) => isStringList(sections) && sections.length > 0
            && new Set(sections).size === sections.length && !!collectionOf(source)
            && sections.every(id => collectionOf(id) === collectionOf(source))
          if (!inspector || typeof inspector !== 'object' || Array.isArray(inspector)
            || !sameSections(inspector.process_sections, component.source)) errors.push(`${path}: diagram inspector requires same-collection process sections`)
          else {
            const checkGroup = (group: typeof inspector.nodes | NonNullable<typeof inspector.related>[number], nodes: boolean) => {
              if (!group || typeof group !== 'object' || !sameSections(group.sections, group.source)) { errors.push(`${path}: invalid diagram inspector record sections`); return }
              const processField = fieldOf(group.source, group.process_field)
              if (processField?.control !== 'record_select' || collectionOf(processField.options_from_section) !== collectionOf(component.source)) errors.push(`${path}: diagram inspector process reference must target the diagram collection`)
              if (nodes) {
                const node = group as typeof inspector.nodes
                if (!['text', 'textarea'].includes(fieldOf(node.source, node.element_field)?.control ?? '') || !ownsField(node.source, node.label_field)) errors.push(`${path}: diagram inspector nodes require declared element and label fields`)
              } else {
                const related = group as NonNullable<typeof inspector.related>[number]
                if (related.node_field !== undefined) {
                  const field = fieldOf(related.source, related.node_field)
                  if (field?.control !== 'record_select' || collectionOf(field.options_from_section) !== collectionOf(inspector.nodes?.source)) errors.push(`${path}: diagram inspector node reference must target its node collection`)
                }
                if (related.advanced !== undefined && typeof related.advanced !== 'boolean') errors.push(`${path}: diagram inspector advanced must be boolean`)
              }
            }
            checkGroup(inspector.nodes, true)
            if (inspector.related !== undefined && !Array.isArray(inspector.related)) errors.push(`${path}: diagram inspector related must be an array`)
            else inspector.related?.forEach(group => checkGroup(group, false))
          }
        }
        if (typeof config.artifact_kind !== 'string' || !/^[a-zA-Z][\w-]*$/u.test(config.artifact_kind)) errors.push(`${path}: invalid diagram artifact kind`)
        if (config.order_only !== undefined && typeof config.order_only !== 'boolean') errors.push(`${path}: order_only must be boolean`)
        if (config.detail_rows !== undefined && (!Array.isArray(config.detail_rows) || config.detail_rows.some(row => !isStringList(row) || !row.length || row.some(key => !ownsField(component.source, key))))) errors.push(`${path}: invalid diagram detail rows`)
        if (config.detail_hint_fields !== undefined && (!isStringList(config.detail_hint_fields) || config.detail_hint_fields.some(key => !ownsField(component.source, key) || fieldOf(component.source, key)?.hidden))) errors.push(`${path}: invalid diagram detail hint fields`)
        if (config.chip_fields !== undefined && (!isStringList(config.chip_fields) || config.chip_fields.some(key => !ownsField(component.source, key)))) errors.push(`${path}: invalid diagram chip fields`)
        if (config.tags !== undefined && (!Array.isArray(config.tags) || config.tags.some(tag => !tag || !ownsField(component.source, tag.field) || fieldOf(component.source, tag.field)?.hidden
          || (tag.labels !== undefined && (!tag.labels || typeof tag.labels !== 'object' || Array.isArray(tag.labels) || Object.values(tag.labels).some(label => typeof label !== 'string')))
          || (tag.tones !== undefined && (!tag.tones || typeof tag.tones !== 'object' || Array.isArray(tag.tones) || Object.values(tag.tones).some(tone => typeof tone !== 'string' || !['danger', 'warning', 'success', 'neutral'].includes(tone))))))) errors.push(`${path}: invalid diagram tags`)
        if (config.summary_fields !== undefined && (!isStringList(config.summary_fields) || config.summary_fields.some(key => !ownsField(component.source, key)))) errors.push(`${path}: invalid diagram summary fields`)
      }
    }
    if (component.component === 'execution_log') {
      const log = component.log
      const allowed = ['scope', 'artifact_id', 'artifact_id_path', 'artifact_kind', 'artifact_file_path', 'max_entries']
      if (!log || typeof log !== 'object' || Array.isArray(log)
        || Object.keys(log).some(key => !allowed.includes(key))
        || !['producer', 'artifact'].includes(log.scope)) errors.push(`${path}: execution_log needs a Host activity selector`)
      else {
        if (log.max_entries !== undefined && (!Number.isSafeInteger(log.max_entries) || log.max_entries < 1 || log.max_entries > 1000)) errors.push(`${path}: execution_log max_entries must be between 1 and 1000`)
        if (log.scope === 'producer' && ['artifact_id', 'artifact_id_path', 'artifact_kind', 'artifact_file_path'].some(key => Object.hasOwn(log, key))) errors.push(`${path}: Producer log cannot declare an artifact target`)
        if (log.scope === 'artifact') {
          if ((log.artifact_id === undefined) === (log.artifact_id_path === undefined)) errors.push(`${path}: artifact log requires exactly one artifact identity binding`)
          if (log.artifact_id !== undefined && (typeof log.artifact_id !== 'string' || !log.artifact_id.trim() || log.artifact_id.length > 256 || /[\u0000-\u001f]/u.test(log.artifact_id))) errors.push(`${path}: invalid artifact log identity`)
          for (const key of ['artifact_id_path', 'artifact_file_path'] as const) if (log[key] !== undefined && !isSafeDottedPath(log[key])) errors.push(`${path}: invalid artifact log path`)
          if (log.artifact_kind !== undefined && (typeof log.artifact_kind !== 'string' || !/^[a-z][a-z0-9_]*$/.test(log.artifact_kind))) errors.push(`${path}: invalid artifact log kind`)
        }
      }
    }
    if (component.component === 'artifact_workspace') {
      const config = component.artifacts
      if (!config || typeof config !== 'object' || Array.isArray(config) || !config.children || typeof config.children !== 'object' || Array.isArray(config.children)) errors.push(`${path}: artifact workspace requires parent and child bindings`)
      else {
        for (const binding of [config.records_path, config.title_field, config.file_field, config.children.records_field, config.children.title_field, config.children.file_field]) if (!isSafeDottedPath(binding)) errors.push(`${path}: invalid artifact workspace binding`)
        for (const binding of [config.order_path, config.current_path, config.children.order_field, config.children.points_field, config.children.links_field]) if (binding !== undefined && !isSafeDottedPath(binding)) errors.push(`${path}: invalid optional artifact workspace binding`)
        for (const kind of [config.artifact_kind, config.children.artifact_kind]) if (typeof kind !== 'string' || !/^[a-zA-Z][\w-]*$/u.test(kind)) errors.push(`${path}: invalid artifact kind`)
        if (config.children.scoped_ids !== undefined && typeof config.children.scoped_ids !== 'boolean') errors.push(`${path}: scoped_ids must be boolean`)
      }
    }
    if (component.component === 'document_workspace') {
      const doc = component.document
      const safeFile = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_./-]+\.html$/u.test(value)
        && !value.split('/').some(part => part === '..' || part === '.' || part === '')
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) errors.push(`${path}: document_workspace requires document bindings`)
      else {
        for (const text of [doc.legend, doc.references_label]) if (text !== undefined && typeof text !== 'string') errors.push(`${path}: document labels must be plain text`)
        if (!isSafeDottedPath(doc.path) || (doc.title_path !== undefined && !isSafeDottedPath(doc.title_path))) errors.push(`${path}: document paths must be safe schema paths`)
        if (!Array.isArray(doc.allowed_files) || !doc.allowed_files.length || doc.allowed_files.some(value => !safeFile(value))) errors.push(`${path}: document requires confined HTML allowed_files`)
        if (doc.aliases !== undefined && (doc.aliases === null || typeof doc.aliases !== 'object' || Array.isArray(doc.aliases)
          || Object.entries(doc.aliases).some(([alias, target]) => !/^[a-zA-Z0-9_-]+\.html$/u.test(alias) || !Array.isArray(doc.allowed_files) || !doc.allowed_files.includes(target)))) errors.push(`${path}: document aliases must map bare legacy filenames to allowed files`)
        for (const name of [doc.source_attribute, doc.references_attribute]) if (name !== undefined && !/^data-[a-z][a-z0-9-]*$/u.test(name)) errors.push(`${path}: document annotation must be a data attribute`)
        if (doc.references_path !== undefined && (!isSafeDottedPath(doc.references_path) || !isSafeDottedPath(doc.references_id_field) || doc.references_id_field?.includes('.'))) errors.push(`${path}: document reference collection requires a safe path and id field`)
        if (doc.sources !== undefined && (!Array.isArray(doc.sources) || doc.sources.some(value => !value || typeof value.value !== 'string' || !/^[a-zA-Z][\w-]*$/u.test(value.value)
          || typeof value.label !== 'string' || (value.navigable !== undefined && typeof value.navigable !== 'boolean')))) errors.push(`${path}: invalid document source labels`)
      }
    }
    if (component.component === 'record_board') {
      const board = component.board
      if (!board || typeof board !== 'object' || Array.isArray(board)) errors.push(`${path}: record_board requires board bindings`)
      else {
        if ([board.label, board.description].some(key => typeof key !== 'string' || !key)) errors.push(`${path}: board requires label and description fields`)
        if (board.group !== undefined && (typeof board.group !== 'string' || !board.group)) errors.push(`${path}: board group must name a declared text field`)
        for (const key of [board.label, board.description, board.group, board.badge].filter(value => value !== undefined)) {
          if (!['text', 'textarea', 'select', 'radio', 'radio_custom'].includes(fieldOf(component.source, key)?.control ?? '')) errors.push(`${path}: board needs declared text fields`)
        }
        if (board.id_field !== undefined) {
          const identity = fieldOf(component.source, board.id_field)
          if (!identity || identity.control !== 'text' || !identity.readonly || identity.hidden)
            errors.push(`${path}: board id_field requires a declared visible readonly text field`)
        }
        if (board.request_create !== undefined) {
          const request = board.request_create
          if (!request || typeof request !== 'object' || !isStringList(request.fields) || !request.fields.length
            || new Set(request.fields).size !== request.fields.length || request.fields.some(key => {
              const field = fieldOf(component.source, key)
              return !field || field.readonly || field.hidden || !['text', 'textarea', 'select', 'radio'].includes(field.control)
            }) || typeof request.prompt !== 'string' || !request.prompt.trim() || typeof request.submit_label !== 'string' || !request.submit_label.trim())
            errors.push(`${path}: board request_create requires editable text/choice fields and plain prompt/submit labels`)
        }
        if (board.rejected !== undefined && fieldOf(component.source, board.rejected)?.control !== 'toggle') errors.push(`${path}: board rejected must bind a toggle`)
        if (board.detail_presentation !== undefined && !['inline', 'cover'].includes(board.detail_presentation)) errors.push(`${path}: invalid board detail presentation`)
        if (board.detail_presentation === 'cover' && !board.detail_sources?.length) errors.push(`${path}: board detail cover requires scoped detail sources`)
        if (board.detail_fields !== undefined && (!isStringList(board.detail_fields) || board.detail_fields.some(key => !fieldOf(component.source, key)))) errors.push(`${path}: board detail_fields must reference declared fields`)
        if (board.details_title !== undefined && typeof board.details_title !== 'string') errors.push(`${path}: board details_title must be plain text`)
        if (board.detail_sections !== undefined && !isStringList(board.detail_sections)) errors.push(`${path}: board detail_sections must be a list`)
        if (board.detail_fields_mode !== undefined && !['fixed', 'on_demand'].includes(board.detail_fields_mode)) errors.push(`${path}: board detail_fields_mode must be fixed or on_demand`)
        if (board.detail_sources !== undefined) {
          if (!Array.isArray(board.detail_sources) || !board.detail_sources.length || board.detail_sources.length > 8) errors.push(`${path}: board detail_sources requires 1–8 bindings`)
          else {
            const seen = new Set<string>()
            const ownerSection = sections.find(value => isPanelSection(value) && value.id === component.source) as PanelSection | undefined
            const paths = new Set<string>(ownerSection ? [ownerSection.records_path ?? ownerSection.id] : [])
            for (const scope of board.detail_sources) {
              const section = sections.find(value => isPanelSection(value) && value.id === scope?.section) as PanelSection | undefined
              const reference = fieldOf(scope?.section, scope?.reference)
              const recordsPath = section?.records_path ?? section?.id
              if (!section || seen.has(scope.section) || (recordsPath !== undefined && [...paths].some(existing => recordsPath === existing || recordsPath.startsWith(existing + '.') || existing.startsWith(recordsPath + '.'))) || scope.section === component.source || section.fields_path || section.order
                || reference?.control !== 'record_select' || reference.options_from_section !== component.source || !reference.readonly)
                errors.push(`${path}: board detail_sources requires unique direct unordered collections with readonly parent references`)
              seen.add(scope?.section)
              if (recordsPath !== undefined) paths.add(recordsPath)
            }
          }
          if (component.children?.length !== 1 || component.children[0]?.component !== 'record_workspace'
            || !Array.isArray(board.detail_sources)
            || component.children[0]?.sources?.some(source => !board.detail_sources?.some(scope => scope?.section === source)))
            errors.push(`${path}: scoped board requires one record_workspace using declared detail_sources`)
        } else if (component.children?.length) errors.push(`${path}: board children require detail_sources`)
        const owner = sections.find(section => isPanelSection(section) && section.id === component.source) as PanelSection | undefined
        for (const id of Array.isArray(board.detail_sections) ? board.detail_sections : []) {
          const section = sections.find(section => isPanelSection(section) && section.id === id) as PanelSection | undefined
          if (!owner || !section || !section.fields_path || (section.records_path ?? id) !== (owner.records_path ?? owner.id)
            || section.add_mode !== 'none') errors.push(`${path}: board detail sections must share the owner records and bind nested fields without creation`)
        }
      }
    }
    if (component.component === 'record_inspector' && component.sources !== undefined) {
      if (!isStringList(component.sources) || !component.sources.length || new Set(component.sources).size !== component.sources.length) {
        errors.push(`${path}: inspector sources must be a nonempty unique list`)
      } else {
        const paths = new Set((workspace ?? []).map(id => {
          const section = sections.find(value => isPanelSection(value) && value.id === id) as PanelSection | undefined
          return section?.records_path ?? id
        }))
        for (const id of component.sources) {
          const section = sections.find(value => isPanelSection(value) && value.id === id) as PanelSection | undefined
          if (!section || !paths.has(section.records_path ?? id)) errors.push(`${path}: inspector sources must share a workspace record collection`)
        }
      }
    }
    if (component.component === 'record_preview') {
      if (!workspace || !component.preview || !component.source || !workspace.includes(component.source)) errors.push(`${path}: record_preview requires a workspace source and preview binding`)
      else for (const key of [component.preview.title, component.preview.body, component.preview.action].filter(value => value !== undefined)) {
        if (!ownsField(component.source, key)) errors.push(`${path}: undeclared preview field ${key}`)
      }
    }
    if (component.record_cards !== undefined) {
      const card = component.record_cards
      const candidates = component.sources ?? (component.source ? [component.source] : [])
      if (!['record_inspector', 'record_related_editor'].includes(component.component)
        || !card || typeof card !== 'object' || Array.isArray(card)
        || Object.keys(card).some(key => !['label', 'description', 'details_title', 'attention_fields'].includes(key))
        || typeof card.label !== 'string' || typeof card.description !== 'string'
        || typeof card.details_title !== 'string' || !card.details_title.trim()
        || (card.attention_fields !== undefined && !isStringList(card.attention_fields))) errors.push(`${path}: invalid record_cards reading bindings`)
      else {
        const byPath = new Map<string, string[]>()
        for (const source of candidates) {
          const section = sections.find(value => isPanelSection(value) && value.id === source) as PanelSection | undefined
          if (section) byPath.set(section.records_path ?? source, [...(byPath.get(section.records_path ?? source) ?? []), source])
        }
        if (!byPath.size || [...byPath.values()].some(sources => sources.filter(source => {
          const label = fieldOf(source, card.label), description = fieldOf(source, card.description)
          return label?.control === 'text' && !label.hidden && ['text','textarea'].includes(description?.control ?? '') && !description?.hidden
            && (card.attention_fields ?? []).every(key => ownsField(source, key))
        }).length !== 1)) errors.push(`${path}: record_cards needs exactly one declared reading source per canonical collection`)
      }
    }
    if (component.navigation_hierarchy !== undefined) {
      const hierarchy = component.navigation_hierarchy
      const sources = component.sources ?? []
      const family = hierarchy && typeof hierarchy === 'object' ? [...new Set([hierarchy.root_source, hierarchy.child_source])] : []
      if (component.component !== 'record_workspace' || !hierarchy || typeof hierarchy !== 'object'
        || Object.keys(hierarchy).some(key => !['field','root_source','child_source'].includes(key))
        || !sources.includes(hierarchy.root_source) || !sources.includes(hierarchy.child_source)
        || component.navigation_group_by !== undefined
        || family.some(source => {
          const field = fieldOf(source, hierarchy.field)
          const targets = field?.options_from_sections ?? (field?.options_from_section ? [field.options_from_section] : [])
          return field?.control !== 'record_select' || field.readonly || targets.length !== family.length || family.some(value => !targets.includes(value))
        })) errors.push(`${path}: navigation_hierarchy needs editable parent references over the workspace sources`)
    }
    if (component.math !== undefined && component.component !== 'math_document') errors.push(`${path}: math belongs to math_document`)
    if (component.component === 'math_document') {
      const config = component.math
      if (!workspace?.includes(component.source ?? '') || !config || typeof config !== 'object' || Array.isArray(config)) {
        errors.push(`${path}: math_document requires a workspace source and math bindings`)
      } else {
        if (Object.keys(config).some(key => !['heading', 'introduction', 'notes', 'complete', 'symbols', 'statements', 'output', 'checks', 'provenance'].includes(key))) errors.push(`${path}: unknown math binding`)
        const used = new Set<string>()
        const bind = (key: unknown, controls: readonly string[]) => {
          const field = typeof key === 'string' && isSafeDottedPath(key) && !key.includes('.') ? fieldOf(component.source, key) : undefined
          if (!field || field.hidden || !controls.includes(field.control) || used.has(String(key))) errors.push(`${path}: math needs distinct declared visible ${controls.join('/')} fields (${String(key)})`)
          used.add(String(key))
          return field
        }
        bind(config.heading, ['text'])
        for (const key of ['introduction', 'notes', 'complete'] as const) if (config[key] !== undefined) bind(config[key], ['text', 'textarea'])
        for (const key of ['symbols', 'statements'] as const) {
          const rows = config[key]
          if (rows === undefined && key === 'symbols') continue
          if (!rows || typeof rows !== 'object' || Array.isArray(rows)) { errors.push(`${path}: math ${key} needs row bindings`); continue }
          if (Object.keys(rows).some(key => !['field', 'formula', 'meaning', 'title', 'source', 'details'].includes(key))) errors.push(`${path}: unknown math row binding`)
          const field = bind(rows.field, ['rows'])
          if (!field?.columns?.length || field.columns.some(column => !['text', 'textarea'].includes(column.control))) errors.push(`${path}: math entries require text/textarea columns`)
          if (rows.details !== undefined && (!isStringList(rows.details) || rows.details.length > 6)) errors.push(`${path}: math details must be a list of up to six columns`)
          const columns = [rows.formula, rows.meaning, rows.title, rows.source, ...(Array.isArray(rows.details) ? rows.details : [])].filter(value => value !== undefined)
          if (typeof rows.formula !== 'string' || typeof rows.meaning !== 'string' || new Set(columns).size !== columns.length
            || columns.some(key => !field?.columns?.some(column => column.key === key && ['text', 'textarea'].includes(column.control)))) errors.push(`${path}: math row bindings need distinct declared text columns`)
        }
        const readonlyBind = (key: unknown, controls: readonly string[]) => {
          const field = bind(key, controls)
          if (field && field.readonly !== true) errors.push(`${path}: math output, checks and provenance fields must be readonly`)
        }
        for (const [key, allowed] of [['output', ['file', 'format']], ['checks', ['status', 'summary', 'evidence']]] as const) {
          const group = config[key]
          if (group === undefined) continue
          if (!group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(name => !(allowed as readonly string[]).includes(name))) {
            errors.push(`${path}: invalid math ${key} bindings`); continue
          }
          if (key === 'output') {
            const output = config.output!
            readonlyBind(output.file, ['artifact_ref'])
            if (output.format !== undefined) readonlyBind(output.format, ['text'])
          } else {
            const checks = config.checks!
            readonlyBind(checks.status, ['select'])
            readonlyBind(checks.summary, ['text', 'textarea'])
            if (checks.evidence !== undefined) readonlyBind(checks.evidence, ['text', 'textarea'])
          }
        }
        if (config.provenance !== undefined) {
          if (!isStringList(config.provenance)) errors.push(`${path}: math provenance must list declared readonly fields`)
          else for (const key of config.provenance) readonlyBind(key, ['text', 'textarea', 'artifact_ref'])
        }
      }
    }
    if (component.component === 'record_related_editor') {
      const reference = fieldOf(component.source, component.bindings?.reference)
      const referenceTargets = reference?.options_from_sections ?? (reference?.options_from_section ? [reference.options_from_section] : [])
      if (!workspace?.includes(component.source ?? '') || !['record_select', 'record_multi_select'].includes(reference?.control ?? '')
        || !referenceTargets.length || referenceTargets.some(target => !workspace.includes(target))
        || (referenceTargets.length === 1 && referenceTargets[0] === component.source)) errors.push(`${path}: related editor needs an in-workspace child section and declared parent reference`)
      if (component.sources !== undefined) {
        const owner = sections.find(value => isPanelSection(value) && value.id === component.source) as PanelSection | undefined
        if (!isStringList(component.sources) || !component.sources.length || new Set(component.sources).size !== component.sources.length
          || component.sources.some(source => {
            const view = sections.find(value => isPanelSection(value) && value.id === source) as PanelSection | undefined
            return !owner || !view || (view.records_path ?? source) !== (owner.records_path ?? owner.id)
          })) errors.push(`${path}: related editor sources must share its canonical collection`)
      }
      if (component.record_table !== undefined) {
      if (component.record_cards !== undefined) errors.push(`${path}: choose a record table or reading cards, not both`)
      const table = component.record_table
      const columns = table?.columns
      const keys = new Set<string>()
      if (component.component !== 'record_related_editor' || !table || typeof table !== 'object' || Array.isArray(table)
        || Object.keys(table).some(key => key !== 'columns') || !Array.isArray(columns) || !columns.length || columns.length > 12) {
        errors.push(`${path}: record_table requires related-editor columns`)
      } else {
        for (const column of columns) {
          if (!column || typeof column !== 'object' || Array.isArray(column)
            || Object.keys(column).some(key => !['fields', 'label'].includes(key))
            || !isStringList(column.fields) || !column.fields.length || column.fields.length > 8
            || (column.label !== undefined && (typeof column.label !== 'string' || !column.label.trim()))) {
            errors.push(`${path}: invalid record_table column`); continue
          }
          for (const key of column.fields) {
            const field = fieldOf(component.source, key)
            if (!field || field.hidden || keys.has(key)) errors.push(`${path}: record_table needs unique visible declared fields: ${key}`)
            keys.add(key)
          }
        }
        for (const field of fields) {
          if (isEditorField(field) && field.applies_to?.includes(component.source ?? '') && !field.hidden && !keys.has(field.key)) {
            errors.push(`${path}: record_table must retain visible field ${field.key}`)
          }
        }
      }
    }
    if (component.inherit_from_graph !== undefined && (component.inherit_from_graph !== true
        || !workspaceGraph?.hierarchy || workspaceGraph.nodes !== reference?.options_from_section
        || workspaceGraph.edges === component.source)) errors.push(`${path}: inherit_from_graph needs the workspace hierarchy and an associated record section`)
    }
    if (component.record_table !== undefined) {
      const table = component.record_table
      const columns = table?.columns
      const keys = new Set<string>()
      if (component.component !== 'record_related_editor' || !table || typeof table !== 'object' || Array.isArray(table)
        || Object.keys(table).some(key => key !== 'columns') || !Array.isArray(columns) || !columns.length || columns.length > 12) {
        errors.push(`${path}: record_table requires related-editor columns`)
      } else {
        for (const column of columns) {
          if (!column || typeof column !== 'object' || Array.isArray(column)
            || Object.keys(column).some(key => !['fields', 'label'].includes(key))
            || !isStringList(column.fields) || !column.fields.length || column.fields.length > 8
            || (column.label !== undefined && (typeof column.label !== 'string' || !column.label.trim()))) {
            errors.push(`${path}: invalid record_table column`); continue
          }
          for (const key of column.fields) {
            const field = fieldOf(component.source, key)
            if (!field || field.hidden || keys.has(key)) errors.push(`${path}: record_table needs unique visible declared fields: ${key}`)
            keys.add(key)
          }
        }
        for (const field of fields) {
          if (isEditorField(field) && field.applies_to?.includes(component.source ?? '') && !field.hidden && !keys.has(field.key)) {
            errors.push(`${path}: record_table must retain visible field ${field.key}`)
          }
        }
      }
    }
    if (component.inherit_from_graph !== undefined && component.component !== 'record_related_editor') {
      errors.push(`${path}: inherit_from_graph is only supported by record_related_editor`)
    }
    if (component.card_groups !== undefined) {
      if (!['question_list', 'question_workspace', 'question_rounds'].includes(component.component) || !Array.isArray(component.card_groups)) {
        errors.push(`${path}: card_groups requires a question component and a list`)
      } else {
        const groupIds = new Set<string>()
        const members = new Set<string>()
        for (const group of component.card_groups) {
          if (!group || typeof group !== 'object' || Array.isArray(group)
            || Object.keys(group).some(key => !['id', 'title', 'question_ids', 'presentation'].includes(key))
            || typeof group.id !== 'string' || !group.id.trim() || isUnsafePanelKey(group.id) || groupIds.has(group.id)
            || typeof group.title !== 'string' || !group.title.trim()
            || !isStringList(group.question_ids) || group.question_ids.length === 0
            || group.question_ids.some((id: string) => !id.trim() || isUnsafePanelKey(id) || members.has(id))
            || new Set(group.question_ids).size !== group.question_ids.length) {
            errors.push(`${path}: card_groups must contain unique safe groups and members with a title`)
            continue
          }
          if (group.presentation !== undefined && (!group.presentation || typeof group.presentation !== 'object'
            || Array.isArray(group.presentation) || Object.entries(group.presentation).some(([key, value]) =>
              !['always_expanded', 'show_detail', 'show_attachments'].includes(key) || typeof value !== 'boolean'))) {
            errors.push(`${path}: card_groups presentation must contain only supported boolean options`)
          }
          groupIds.add(group.id)
          group.question_ids.forEach((id: string) => members.add(id))
        }
      }
    }
    if (component.rounds_source !== undefined) {
      if (!['question_workspace', 'question_rounds'].includes(component.component)
        || typeof component.rounds_source !== 'string' || !sectionIds.has(component.rounds_source)
        || component.rounds_source === component.source
        || !ownsField(component.rounds_source, 'title') || !ownsField(component.rounds_source, 'description')) {
        errors.push(`${path}: rounds_source requires a separate declared question-round section with title and description fields`)
      }
    }
    if (component.question_policy !== undefined) {
      const policy = component.question_policy
      if (!['question_workspace', 'question_rounds'].includes(component.component)
        || policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
        errors.push(`${path}: question_policy requires a question workspace and an object`)
      } else {
        for (const key of Object.keys(policy)) {
          if (!['first_round_ids', 'protected_ids', 'history_readonly', 'numbered_rounds', 'allow_rejection', 'allow_choice_actions'].includes(key)) errors.push(`${path}: unknown question policy ${key}`)
        }
        for (const key of ['first_round_ids', 'protected_ids'] as const) {
          const ids = policy[key]
          if (ids !== undefined && (!isStringList(ids)
            || ids.some(id => id.trim() === '' || isUnsafePanelKey(id))
            || new Set(ids).size !== ids.length)) errors.push(`${path}: ${key} must contain unique safe record ids`)
        }
        for (const key of ['history_readonly', 'numbered_rounds', 'allow_rejection', 'allow_choice_actions'] as const) {
          if (policy[key] !== undefined && typeof policy[key] !== 'boolean') errors.push(`${path}: ${key} must be boolean`)
        }
        if (policy.allow_rejection && !ownsField(component.source, 'rejected')) errors.push(`${path}: rejection needs a declared rejected field`)
      }
    }
    if (component.navigation_layout !== undefined && (component.component !== 'record_workspace'
      || !['list', 'tree'].includes(component.navigation_layout))) errors.push(`${path}: navigation_layout requires record_workspace and list or tree`)
    if (component.navigation_group_by !== undefined && (component.component !== 'record_workspace'
      || !isSafeDottedPath(component.navigation_group_by) || component.navigation_group_by.includes('.'))) {
      errors.push(`${path}: navigation_group_by requires record_workspace and a safe direct field`)
    }
    if (component.component === 'record_workspace') {
      if (component.workspace_view !== undefined && !['split', 'switch'].includes(component.workspace_view)) errors.push(`${path}: invalid workspace_view`)
      if (component.workspace_view === 'switch' && (component.children?.length !== 2
        || !['relation_graph', 'reference_graph'].includes(component.children?.[0]?.component ?? '') || component.children?.[1]?.component !== 'record_inspector')) {
        errors.push(`${path}: switch view requires a relation_graph or reference_graph and record_inspector`)
      }
      if (workspace) errors.push(`${path}: nested record_workspace is not supported`)
      if (!isStringList(component.sources) || component.sources.length === 0) errors.push(`${path}: record_workspace needs sources`)
      if (Array.isArray(component.sources) && new Set(component.sources).size !== component.sources.length) errors.push(`${path}: duplicate workspace sources`)
      scope = isStringList(component.sources) ? component.sources : []
      graphScope = Array.isArray(component.children) ? component.children.find(child => child?.component === 'relation_graph')?.graph : undefined
      for (const sectionId of scope) {
        const section = sections.find((candidate): candidate is PanelSection => isPanelSection(candidate) && candidate.id === sectionId)
        if (!section) continue
        if (section.navigation === 'contextual' || section.add_mode === 'context') {
          const reference = fields.find((field): field is EditorField => isEditorField(field) && field.applies_to?.includes(sectionId) === true
            && ['record_select', 'record_multi_select'].includes(field.control)
            && (field.options_from_sections ?? (field.options_from_section ? [field.options_from_section] : [])).some(target => scope?.includes(target)))
          if (!reference) errors.push(`${path}: contextual section "${sectionId}" needs an in-workspace record reference`)
        }
        if (section.add_mode === 'graph') {
          const hasEdgeGraph = (candidate: ComponentNode): boolean => candidate.component === 'relation_graph'
            && candidate.graph?.edges === sectionId
            || (candidate.children ?? []).some(hasEdgeGraph)
            || Object.values(candidate.slots ?? {}).some(child => child !== undefined && hasEdgeGraph(child))
          if (!hasEdgeGraph(component)) errors.push(`${path}: graph-add section "${sectionId}" needs a relation_graph edge binding`)
        }
      }
    }
    if (component.component === 'panel_workspace') {
      if (component.slots?.sidebar === undefined || component.slots?.main === undefined) {
        errors.push(`${path}: panel_workspace requires sidebar and main slots`)
      }
      if ((component.children?.length ?? 0) > 0) errors.push(`${path}: panel_workspace uses slots, not children`)
    }
    if (component.component === 'structured_data' && !isSafeDottedPath(component.source)) {
      errors.push(`${path}: structured_data needs a safe source path`)
    }
    if (component.component === 'schema_field'
      && (!isSafeDottedPath(component.path) || !['text', 'textarea', 'number', 'select', 'toggle', 'list', 'color'].includes(String(component.control)))) {
      errors.push(`${path}: schema_field needs a safe path and scalar control`)
    }
    if (component.component === 'preview_workspace') {
      const config = component.live_preview
      if (!config || !isSafeDottedPath(config.file_path)) errors.push(`${path}: preview needs a file_path binding`)
      if (config) {
        for (const key of ['restore_paths', 'swatch_paths'] as const) if (config[key] !== undefined && !isStringList(config[key])) errors.push(`${path}: invalid preview ${key}`)
        for (const value of [config.title_path, config.description_path, ...(isStringList(config.restore_paths) ? config.restore_paths : []), ...(isStringList(config.swatch_paths) ? config.swatch_paths : [])]) {
          if (value !== undefined && !isSafeDottedPath(value)) errors.push(`${path}: invalid preview data path`)
        }
        if (config.stylesheet !== undefined && (typeof config.stylesheet !== 'string' || !/^[\w-]+\/(?:[\w-]+\/)*[\w.-]+\.css$/.test(config.stylesheet))) errors.push(`${path}: invalid preview stylesheet`)
        if (config.design_width !== undefined && (!Number.isFinite(config.design_width) || config.design_width < 240 || config.design_width > 3840)) errors.push(`${path}: invalid preview width`)
        if (!Array.isArray(config.tokens)) errors.push(`${path}: preview tokens must be a list`)
        const variables = new Set<string>()
        for (const token of Array.isArray(config.tokens) ? config.tokens : []) {
          if (!token || !/^--[A-Za-z0-9_-]+$/.test(token.variable) || !isSafeDottedPath(token.path)
            || (token.fallback_path !== undefined && !isSafeDottedPath(token.fallback_path))) { errors.push(`${path}: invalid preview token`); continue }
          if (variables.has(token.variable)) errors.push(`${path}: duplicate preview token ${token.variable}`)
          variables.add(token.variable)
          for (const key of ['fallback', 'font_fallback'] as const) if (token[key] !== undefined && typeof token[key] !== 'string') errors.push(`${path}: invalid token ${key}`)
          if (token.values !== undefined && (!token.values || typeof token.values !== 'object' || Array.isArray(token.values) || Object.values(token.values).some(value => typeof value !== 'string'))) errors.push(`${path}: invalid token mapping`)
        }
        if (config.presets !== undefined && !Array.isArray(config.presets)) errors.push(`${path}: preview presets must be a list`)
        const ids = new Set<string>()
        for (const preset of Array.isArray(config.presets) ? config.presets : []) {
          if (!preset || typeof preset.id !== 'string' || !preset.id || typeof preset.title !== 'string' || !preset.title || !preset.values || typeof preset.values !== 'object' || Array.isArray(preset.values)) { errors.push(`${path}: invalid preview preset`); continue }
          if (ids.has(preset.id)) errors.push(`${path}: duplicate preview preset ${preset.id}`)
          ids.add(preset.id)
          for (const [key, value] of Object.entries(preset.values)) if (!isSafeDottedPath(key) || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) errors.push(`${path}: invalid preset value ${key}`)
        }
      }
    }
    if (component.component === 'artifact_gallery'
      && (!isStringList(component.paths) || component.paths.length === 0
        || component.paths.some(entry => entry.startsWith('/') || entry.includes('..') || entry.includes('\\')))) {
      errors.push(`${path}: artifact_gallery needs safe relative paths`)
    }
    if (component.component === 'grouped_records'
      && (typeof component.source !== 'string' || !sectionIds.has(component.source)
        || !isSafeDottedPath(component.group_by) || component.group_by?.includes('.'))) {
      errors.push(`${path}: grouped_records needs a section and scalar group_by field`)
    }
    if (component.component === 'nested_collection'
      && (!isSafeDottedPath(component.source) || !isSafeDottedPath(component.children_field)
        || !isSafeDottedPath(component.label_field) || !isSafeDottedPath(component.child_label_field)
        || [component.source, component.children_field, component.label_field, component.child_label_field]
          .some(value => String(value).includes('.')))) {
      errors.push(`${path}: nested_collection needs safe two-level map bindings`)
    }
    if (component.component === 'related_artifacts'
      && (!isStringList(component.paths_from) || component.paths_from.length === 0
        || component.paths_from.length > 12 || component.paths_from.some(pattern =>
          pattern.split('.').some(part => part !== '*'
            && (!/^[a-zA-Z][\w-]*$/u.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part)))))) {
      errors.push(`${path}: related_artifacts needs safe dotted path patterns`)
    }
    if (['record_inspector', 'relation_graph', 'reference_graph', 'record_matrix', 'data_table', 'record_artifact'].includes(component.component) && !scope) {
      errors.push(`${path}: ${component.component} requires record_workspace`)
    }
    if (component.component === 'record_artifact') {
      if (!scope?.includes(component.source ?? '')) errors.push(`${path}: artifact source must belong to workspace`)
      if (!ownsField(component.source, component.artifact?.field) || !fields.some(field => isEditorField(field)
        && field.key === component.artifact?.field && field.control === 'artifact_ref')) {
        errors.push(`${path}: artifact must bind a declared artifact_ref field`)
      }
      const reference = component.artifact?.reference_field
      if (reference !== undefined) {
        const field = fields.find((field): field is EditorField => isEditorField(field)
          && field.key === reference && field.applies_to?.includes(component.source ?? '') === true)
        if (!field || field.hidden || field.visible_when || field.control !== 'record_select'
          || !scope?.includes(field.options_from_section ?? '') || field.options_from_section === component.source) {
          errors.push(`${path}: artifact reference_field must bind a record_select to another workspace section`)
        }
      }
      const explanation = component.artifact?.explanation_field
      if (explanation !== undefined && !fields.some(field => isEditorField(field) && field.key === explanation
        && field.applies_to?.includes(component.source ?? '') && !field.hidden && !field.visible_when
        && ['text', 'textarea'].includes(field.control))) {
        errors.push(`${path}: artifact explanation_field must bind declared visible text`)
      }
    }
    if (component.references !== undefined && !['reference_graph', 'relation_graph'].includes(component.component)) errors.push(`${path}: references belongs to a reference or participant relation graph`)
    if (component.component === 'reference_graph' || (component.component === 'relation_graph' && component.references !== undefined)) {
      const bindings = component.references
      if (!bindings || !Array.isArray(bindings.nodes) || !bindings.nodes.length || !Array.isArray(bindings.links)) {
        errors.push(`${path}: reference_graph needs nodes and links`)
      } else {
        const sources = new Set<string>()
        for (const node of bindings.nodes) {
          const section = sections.find((section): section is PanelSection => isPanelSection(section) && section.id === node?.source)
          const rootLabel = sections.some(owner => isPanelSection(owner) && owner.fields_path === undefined
            && (owner.records_path ?? owner.id) === (section?.records_path ?? section?.id)
            && ['text', 'textarea'].includes(fieldOf(owner.id, node?.label_field)?.control ?? ''))
          const label = node?.label_scope === 'record' ? rootLabel
            : ['text', 'textarea'].includes(fieldOf(node?.source, node?.label_field)?.control ?? '')
          const kindOptions = node?.kind_field && fieldOf(node.source, node.kind_field)?.options
          const validKindIcons = node?.kind_icons === undefined || (node.kind_icons !== null
            && typeof node.kind_icons === 'object' && !Array.isArray(node.kind_icons) && Array.isArray(kindOptions)
            && Object.entries(node.kind_icons).every(([value, icon]) => kindOptions.some(option => option.value === value)
              && (SIDEBAR_ICONS as readonly string[]).includes(icon)))
          if (!node || typeof node !== 'object' || !scope?.includes(node.source) || sources.has(node.source)
            || !label || !isSafeDottedPath(node.label_field) || node.label_field.includes('.')
            || (node.label_scope !== undefined && !['fields', 'record'].includes(node.label_scope))
            || (node.description_field !== undefined && !['text', 'textarea'].includes(fieldOf(node.source, node.description_field)?.control ?? ''))
            || (node.kind_field !== undefined && !['text', 'select', 'radio'].includes(fieldOf(node.source, node.kind_field)?.control ?? ''))
            || (node.icon !== undefined && !(SIDEBAR_ICONS as readonly string[]).includes(node.icon)) || !validKindIcons) {
            errors.push(`${path}: reference node needs a unique workspace section and text label field`)
          } else sources.add(node.source)
        }
        const links = new Set<string>()
        for (const link of bindings.links) {
          const field = link && fieldOf(link.source, link.field)
          const key = link && JSON.stringify([link.source, link.field])
          const reference = link?.item_field === undefined ? field
            : field?.control === 'record_map' && isSafeDottedPath(link.item_field) && !link.item_field.includes('.')
              ? field.item_fields?.find(child => child.key === link.item_field && child.control === 'record_select') : undefined
          const targets = link?.targets ?? (typeof link?.target === 'string' ? [link.target] : [])
          const validTargets = link?.targets === undefined ? typeof link?.target === 'string'
            : link.target === undefined && isStringList(link.targets) && link.targets.length >= 2
              && new Set(link.targets).size === link.targets.length
          const declaredTargets = reference?.options_from_sections ?? (reference?.options_from_section ? [reference.options_from_section] : [])
          if (!link || !sources.has(link.source) || !validTargets || targets.some(target => !sources.has(target)) || links.has(key)
            || !reference || !['record_select', 'record_multi_select'].includes(reference.control)
            || targets.length !== declaredTargets.length || targets.some(target => !declaredTargets.includes(target))
            || (link.label !== undefined && typeof link.label !== 'string') || (link.reverse !== undefined && typeof link.reverse !== 'boolean')) {
            errors.push(`${path}: reference link needs a unique declared record reference between node sections`)
          } else links.add(key)
        }
        const layout = bindings.layout
        if (layout !== undefined) {
          if (bindings.links.some(link => link?.targets !== undefined)) errors.push(`${path}: multi-target references are not supported by hub layout`)
          const keys = ['kind', 'center', 'center_presentation', 'top', 'bottom', 'left', 'right', 'group_by', 'value_field', 'entries']
          if (!layout || typeof layout !== 'object' || Array.isArray(layout) || layout.kind !== 'hub'
            || Object.keys(layout).some(key => !keys.includes(key))) {
            errors.push(`${path}: reference layout needs the bounded hub contract`)
          } else {
            const zones = [layout.center, layout.top, layout.bottom, layout.left, layout.right].filter(value => value !== undefined)
            if (layout.center_presentation !== undefined && layout.center_presentation !== 'portrait')
              errors.push(`${path}: hub center_presentation accepts only the decorative portrait preset`)
            if (!sources.has(layout.center) || zones.some(source => !sources.has(source)) || new Set(zones).size !== zones.length
              || sources.size !== zones.length) errors.push(`${path}: hub zones must assign each reference node section exactly once`)
            if (layout.group_by !== undefined) {
              const grouping = fieldOf(layout.center, layout.group_by)
              if (!layout.top || grouping?.control !== 'record_select' || grouping.options_from_section !== layout.top
                || !bindings.links.some(link => link?.source === layout.center && link.field === layout.group_by && link.target === layout.top && link.item_field === undefined))
                errors.push(`${path}: hub group_by needs a declared center-to-top single reference link`)
            }
            if (layout.value_field !== undefined && !['text', 'textarea'].includes(fieldOf(layout.center, layout.value_field)?.control ?? ''))
              errors.push(`${path}: hub value_field must be a center-owned text field`)
            if (layout.entries !== undefined) {
              const entries = layout.entries
              const field = entries && fieldOf(layout.center, entries.field)
              if (!entries || typeof entries !== 'object' || Array.isArray(entries)
                || Object.keys(entries).some(key => !['field', 'title_field', 'description_field'].includes(key))
                || field?.control !== 'record_map'
                || ![entries.title_field, entries.description_field].every(key => field.item_fields?.some(item => item.key === key && ['text', 'textarea'].includes(item.control))))
                errors.push(`${path}: hub entries must bind text captions in a declared center-owned record_map`)
            }
          }
        }
      }
      if (component.component === 'reference_graph' && (component.graph !== undefined || component.children?.length)) errors.push(`${path}: reference_graph cannot own editable graph bindings or children`)
      if (component.component === 'relation_graph') {
        const primary = Array.isArray(bindings?.nodes) ? bindings.nodes.find(node => node?.source === component.graph?.nodes) : undefined
        if (!component.graph?.participants || !primary || primary.label_field !== component.graph.label_field
          || (Array.isArray(bindings?.nodes) && bindings.nodes.some(node => node?.source === component.graph?.edges))
          || bindings?.layout !== undefined || component.children?.length) {
          errors.push(`${path}: relation references need participants, the same primary node label, no relation-section nodes, layout or children`)
        }
      }
    }
    if (component.component === 'relation_graph') {
      const graph = component.graph
      if (!graph || typeof graph !== 'object' || Array.isArray(graph)) errors.push(`${path}: relation_graph needs graph bindings`)
      else {
        for (const section of [graph.nodes, graph.edges]) {
          if (typeof section !== 'string' || !sectionIds.has(section) || !scope?.includes(section)) errors.push(`${path}: graph section must belong to workspace`)
        }
        if (graph.nodes === graph.edges) errors.push(`${path}: graph node and edge sections must differ`)
        if (graph.participants !== undefined) {
          const binding = graph.participants
          const field = binding && fieldOf(graph.edges, binding.field)
          if (!binding || typeof binding !== 'object' || Array.isArray(binding)
            || Object.keys(binding).some(key => !['field', 'reference_field', 'role_field', 'order_field'].includes(key))
            || [binding.field, binding.reference_field, binding.role_field, binding.order_field].some(key => typeof key !== 'string' || !isSafeDottedPath(key) || key.includes('.'))
            || new Set([binding.reference_field, binding.role_field, binding.order_field]).size !== 3
            || field?.control !== 'record_map' || field.order_field !== binding.order_field
            || !field.item_fields?.some(item => item.key === binding.reference_field && item.control === 'record_select' && item.options_from_section === graph.nodes)
            || !field.item_fields?.some(item => item.key === binding.role_field && item.control === 'text')) {
            errors.push(`${path}: participants needs a declared ordered record_map with an object reference and text role`)
          }
          if ([graph.source_field, graph.target_field, graph.source_annotation_field, graph.target_annotation_field, graph.hierarchy, graph.reverse].some(value => value !== undefined))
            errors.push(`${path}: participants cannot combine with binary endpoints, annotations, hierarchy or reverse`)
        } else {
        for (const key of [graph.source_field, graph.target_field]) {
          const endpoint = fieldOf(graph.edges, key)
          if (!endpoint || endpoint.control !== 'record_select' || endpoint.options_from_section !== graph.nodes) {
            errors.push(`${path}: graph endpoint must be a record_select targeting the node section`)
          }
        }
        if (graph.source_field === graph.target_field) errors.push(`${path}: graph endpoints must differ`)
        }
        if (!ownsField(graph.nodes, graph.label_field) || !ownsField(graph.edges, graph.label_field)) errors.push(`${path}: graph label must bind a field of both sections`)
        for (const key of [graph.node_kind_field, graph.node_description_field]) {
          if (key !== undefined && !ownsField(graph.nodes, key)) errors.push(`${path}: graph node display field must belong to the node section`)
        }
        for (const key of [graph.edge_kind_field, graph.edge_state_field]) {
          if (key !== undefined && !ownsField(graph.edges, key)) errors.push(`${path}: graph edge display field must belong to the edge section`)
        }
        for (const key of [graph.source_annotation_field, graph.target_annotation_field]) {
          if (key !== undefined && !['text', 'textarea', 'number', 'select', 'radio'].includes(fieldOf(graph.edges, key)?.control ?? '')) {
            errors.push(`${path}: graph endpoint annotation must bind a scalar edge field`)
          }
        }
        if (graph.edge_pending_values !== undefined && (!isStringList(graph.edge_pending_values)
          || graph.edge_pending_values.length === 0 || graph.edge_state_field === undefined)) {
          errors.push(`${path}: edge_pending_values needs edge_state_field and a non-empty string list`)
        }
        if (graph.related !== undefined) {
          if (!Array.isArray(graph.related)) errors.push(`${path}: graph related bindings must be an array`)
          else for (const [index, related] of graph.related.entries()) {
            const relatedPath = `${path}.graph.related[${index}]`
            if (!related || typeof related !== 'object' || Array.isArray(related)) { errors.push(`${relatedPath}: invalid related binding`); continue }
            if (!scope?.includes(related.source) || related.source === graph.nodes || related.source === graph.edges) errors.push(`${relatedPath}: source must be another workspace section`)
            const reference = fieldOf(related.source, related.reference_field)
            if (!reference || !['record_select', 'record_multi_select'].includes(reference.control)
              || ![graph.nodes, graph.edges].includes(reference.options_from_section ?? '')) {
              errors.push(`${relatedPath}: reference must target the graph node or edge section`)
            }
            if (!ownsField(related.source, related.label_field)) errors.push(`${relatedPath}: label field must belong to the related section`)
            if (related.value_field !== undefined && !ownsField(related.source, related.value_field)) errors.push(`${relatedPath}: value field must belong to the related section`)
          }
        }
        if (graph.edge_defaults !== undefined) {
          if (!graph.edge_defaults || typeof graph.edge_defaults !== 'object' || Array.isArray(graph.edge_defaults)) errors.push(`${path}: edge_defaults must be an object`)
          else for (const [key, value] of Object.entries(graph.edge_defaults)) {
            if (!ownsField(graph.edges, key) || !['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) errors.push(`${path}: invalid edge default ${key}`)
          }
        }
        if (graph.hierarchy !== undefined) {
          const hierarchy = graph.hierarchy
          const kind = graph.edge_kind_field ? fieldOf(graph.edges, graph.edge_kind_field) : undefined
          if (!hierarchy || !isStringList(hierarchy.values) || !hierarchy.values.length
            || typeof hierarchy.label !== 'string' || !hierarchy.label
            || (hierarchy.description !== undefined && typeof hierarchy.description !== 'string')
            || !kind || !['select', 'radio'].includes(kind.control)
            || hierarchy.values.some(value => !kind.options?.some(option => option.value === value))) {
            errors.push(`${path}: hierarchy needs declared edge kind values and a label`)
          }
          if (hierarchy?.max_parents !== undefined && (hierarchy.max_parents !== 1
            || !isStringList(hierarchy.values) || hierarchy.values.length !== 1)) {
            errors.push(`${path}: max_parents supports one parent with one explicit hierarchy kind`)
          }
          if (hierarchy?.parent_control !== undefined && (hierarchy.parent_control !== 'header' || hierarchy.max_parents !== 1)) {
            errors.push(`${path}: parent_control header requires single-parent hierarchy`)
          }
          if (hierarchy && typeof hierarchy === 'object' && hierarchy.create !== undefined) {
            const create = hierarchy.create
            const nodeLabel = fieldOf(graph.nodes, graph.label_field)
            const edgeLabel = fieldOf(graph.edges, graph.label_field)
            const nodeId = manifest.sections.find(section => section.id === graph.nodes)?.create?.id_field ?? 'id'
            const edgeId = manifest.sections.find(section => section.id === graph.edges)?.create?.id_field ?? 'id'
            const storagePaths = [graph.nodes, graph.edges].flatMap(id => {
              const section = manifest.sections.find(section => section.id === id)
              return section ? [section.records_path ?? section.id, ...(section.order ? [section.order] : [])] : []
            })
            if (storagePaths.some((value, index) => storagePaths.slice(index + 1).some(other =>
              value === other || value.startsWith(other + '.') || other.startsWith(value + '.')))) {
              errors.push(`${path}: hierarchy create requires disjoint node, edge and order storage paths`)
            }
            if (!create || typeof create !== 'object' || Array.isArray(create)
              || Object.keys(create).some(key => !['edge_kind', 'create_label', 'create_title'].includes(key))
              || typeof create.edge_kind !== 'string' || !create.edge_kind.trim()
              || !Array.isArray(hierarchy.values) || !hierarchy.values.includes(create.edge_kind)
              || !kind?.options?.some(option => option.value === create.edge_kind)
              || ['create_label', 'create_title'].some(key => typeof create[key as 'create_label' | 'create_title'] !== 'string'
                || !create[key as 'create_label' | 'create_title'].trim())) {
              errors.push(`${path}: hierarchy create needs a declared hierarchy edge_kind and non-empty create_label/create_title`)
            }
            if (!nodeLabel || !edgeLabel || nodeLabel.control !== 'text' || edgeLabel.control !== 'text'
              || nodeLabel.readonly || edgeLabel.readonly || kind?.readonly
              || [nodeId, edgeId, graph.source_field, graph.target_field, graph.edge_kind_field].includes(graph.label_field)) {
              errors.push(`${path}: hierarchy create needs editable text labels distinct from ids, endpoints and edge kind`)
            }
          }
        }
        if (graph.reverse !== undefined) {
          const reverse = graph.reverse
          if (!reverse || typeof reverse.label !== 'string' || !reverse.label
            || (reverse.pairs !== undefined && !Array.isArray(reverse.pairs))) {
            errors.push(`${path}: reverse needs a label and optional field pairs`)
          } else {
            const seen = new Set([graph.source_field, graph.target_field])
            for (const pair of reverse.pairs ?? []) {
              if (!Array.isArray(pair) || pair.length !== 2 || !isStringList(pair)) { errors.push(`${path}: invalid reverse pair`); continue }
              const [left, right] = pair.map(key => fieldOf(graph.edges, key))
              if (!left || !right || left.readonly || right.readonly || left.control !== right.control
                || !['text', 'textarea', 'number', 'toggle', 'select', 'radio'].includes(left.control)
                || JSON.stringify(left.options?.map(option => option.value)) !== JSON.stringify(right.options?.map(option => option.value))
                || pair[0] === pair[1] || pair.some(key => seen.has(key))) errors.push(`${path}: reverse pairs must bind distinct compatible editable fields`)
              for (const key of pair) seen.add(key)
            }
          }
        }
      }
    }
    if (component.table !== undefined && component.component !== 'data_table') errors.push(`${path}: table binding requires data_table`)
    if (component.component === 'data_table') {
      const binding = component.table
      if (!scope?.includes(component.source ?? '') || !binding || typeof binding !== 'object'
        || Object.keys(binding).some(key => key !== 'field')
        || !ownsField(component.source, binding.field)
        || !fields.some(field => isEditorField(field) && field.key === binding.field && field.control === 'data_table' && field.applies_to?.includes(component.source ?? '')))
        errors.push(`${path}: data_table requires a declared data_table field in its workspace source`)
    }
    if (component.component === 'record_matrix') {
      const matrix = component.matrix
      if (!scope?.includes(component.source ?? '')) errors.push(`${path}: matrix source must belong to workspace`)
      const field = fields.find(field => isEditorField(field) && field.key === matrix?.field
        && field.control === 'rows' && Array.isArray(field.applies_to) && field.applies_to.includes(component.source ?? '')) as EditorField | undefined
      if (!matrix || typeof matrix !== 'object' || !field) errors.push(`${path}: matrix must bind a declared rows field`)
      else {
        const columns = Array.isArray(field.columns) ? field.columns.filter(isRowColumn) : []
        if (new Set([matrix.row, matrix.column, matrix.value]).size !== 3) errors.push(`${path}: matrix row/column/value must differ`)
        for (const key of [matrix.row, matrix.column, matrix.value]) {
          if (typeof key !== 'string' || !isSafeDottedPath(key) || key.includes('.') || !columns.some(column => column.key === key)) errors.push(`${path}: invalid matrix column ${String(key)}`)
        }
        const valueColumn = columns.find(column => column.key === matrix.value)
        if (valueColumn && !['text', 'textarea'].includes(valueColumn.control)) errors.push(`${path}: matrix value supports text/textarea columns only`)
      }
    }
    if (SOURCE_BOUND_COMPONENTS.has(component.component) && typeof component.source !== 'string') {
      errors.push(`${path}: component "${component.component}" requires source`)
    }
    if (component.component === 'doc_lifecycle_studio') {
      for (const required of ['objects', 'axes', 'actions']) {
        if (!sectionIds.has(required)) errors.push(`${path}: doc_lifecycle_studio requires section "${required}"`)
      }
    }
    if (component.component === 'rowview_workbench'
      && (typeof component.source !== 'string' || component.source === '' || !sectionIds.has(component.source))) {
      errors.push(`${path}: rowview_workbench requires a source declaring its add section`)
    }
    if (component.source !== undefined && !['structured_data', 'nested_collection'].includes(component.component)
      && (typeof component.source !== 'string' || !sectionIds.has(component.source))) {
      errors.push(`${path}: source references unknown section "${String(component.source)}"`)
    }
    if (component.sources !== undefined) {
      if (!Array.isArray(component.sources)) {
        errors.push(`${path}: sources must be a list`)
      } else {
        for (const source of component.sources) {
          if (typeof source !== 'string' || !sectionIds.has(source)) errors.push(`${path}: sources references unknown section "${String(source)}"`)
        }
      }
    }
    if (component.children !== undefined) {
      if (!Array.isArray(component.children)) {
        errors.push(`${path}: children must be a list`)
      } else {
        if (component.component === 'tabs') {
          const siblingIds = new Set<string>()
          component.children.forEach((child, index) => {
            // Generic recursion diagnoses malformed nodes and absent/empty IDs.
            // Identity is local to this tab group, not the whole authored tree.
            if (!child || typeof child !== 'object' || typeof child.id !== 'string' || !child.id.trim()) return
            if (siblingIds.has(child.id)) errors.push(`${path}.children[${index}]: duplicate tabs child id "${child.id}"`)
            siblingIds.add(child.id)
          })
        }
        component.children.forEach((child, index) => checkNode(child, `${path}.children[${index}]`, scope, graphScope))
      }
    }
    if (component.slots !== undefined) {
      if (component.slots === null || typeof component.slots !== 'object') {
        errors.push(`${path}: slots must be an object`)
      } else {
        if (component.slots.sidebar !== undefined) checkNode(component.slots.sidebar, `${path}.slots.sidebar`, scope, graphScope)
        if (component.slots.main !== undefined) checkNode(component.slots.main, `${path}.slots.main`, scope, graphScope)
        if (component.slots.overlay !== undefined) checkNode(component.slots.overlay, `${path}.slots.overlay`, scope, graphScope)
      }
    }
  }
  checkNode(manifest.ui, 'ui')
  return errors
}

/**
 * Parse and validate a panel manifest from YAML.
 * @param text - the panel.yaml source.
 * @returns the validated manifest.
 * @throws when the manifest is invalid (fail loud, listing every error).
 */
export function parsePanelManifest(text: string): PanelManifest {
  const manifest = parse(text) as PanelManifest
  const errors = validatePanelManifest(manifest)
  if (errors.length > 0) {
    throw new Error(`panel manifest invalid:\n- ${errors.join('\n- ')}`)
  }
  return manifest
}

export { DATA_TABLE_TYPES, DATA_TABLE_LIMITS, dataTableIssues, dataTableCellIssue, dataTableId, type DataTableValue, type DataTableColumn, type DataTableType } from './data-table.ts'
export { queryPanelAuthoringReference } from './panel-authoring-reference.ts'
