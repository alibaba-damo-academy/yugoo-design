/** Shared, browser-safe vocabulary for authored and generated panels.
 * Trusted runtime code owns this catalog; Bundle content cannot register code
 * or grant itself edit authority. A catalog entry is not a renderer by itself.
 */
interface ComponentDescription {
  readonly description: string
  readonly sourceBound?: boolean
  /** The component fills the host panel; do not wrap it in document padding. */
  readonly ownsWorkspace?: boolean
  /** Owns a visible sidebar title that can receive an authored semantic icon. */
  readonly sidebarTitle?: boolean
  /** Stable position in the restricted generated-panel vocabulary. */
  readonly autoOrder?: number
}

export const PANEL_COMPONENT_CATALOG = {
  tabs: { description: 'Switch between uniquely identified, titled children with keyboard-accessible tabs; inactive content stays mounted to preserve drafts.', autoOrder: 2 },
  stack: { description: 'Arrange child components vertically.', autoOrder: 1 },
  panel_workspace: { description: 'Layout shell with sidebar/main slots. Plain main content scrolls within the shell; use record_workspace with record_inspector for record selection and editing.', ownsWorkspace: true },
  text_block: { description: 'Show escaped plain-text guidance; never executable markup.', autoOrder: 4 },
  record_form: { description: 'Edit records using declared fields and schema constraints. Static sections may opt into form.header detail/card, form.reorder:false and finite form.body field/row/group/tabs composition. Record-local tabs reuse mounted shared tabs; titled collapsible groups preserve their values. Unconsumed visible fields remain rendered. Fields can opt into choice_layout, radio_custom user-triggered custom_focus, select allow_clear:false and token_list token_add_mode:menu for presets plus a cancellable custom-entry card. Omitted configuration preserves legacy behavior; generated-origin forms reject these static extensions.', sourceBound: true, autoOrder: 5 },
  related_records: { description: 'Read references to other declared records.', sourceBound: true },
  question_list: { description: 'Compact editable question cards without a workspace sidebar. Authored card_groups frames contiguous questions without reordering them; optional presentation controls always_expanded/show_detail/show_attachments without granting edit access; generated panels reject this option.', sourceBound: true },
  question_rounds: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Authored card_groups frames contiguous questions within one round without reordering them; optional presentation controls always_expanded/show_detail/show_attachments without granting edit access; generated panels reject this option. Group question records by their saved rounds. Optional authored rounds_source binds a separate declared title/description map indexed by the saved round number, never a display index or a question prompt. Authored question_policy.allow_choice_actions opts dynamic cards into single-to-multiple and select/deselect-all actions; first_round_ids are excluded.', sourceBound: true, ownsWorkspace: true },
  question_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Question workspace with navigation, answers and supported attachments. Optional authored rounds_source binds a separate declared title/description map indexed by the saved round number; metadata does not create rounds or alter answers. Generated panels reject rounds_source. Authored card_groups frames contiguous questions within one round without reordering them; optional presentation controls always_expanded/show_detail/show_attachments without granting edit access; generated panels reject this option. Authored question_policy.allow_choice_actions opts dynamic cards into single-to-multiple and select/deselect-all actions; first_round_ids are excluded. Generated panels reject this option and keep kind protected.', sourceBound: true, ownsWorkspace: true, autoOrder: 8 },
  relation_matrix: { description: 'Read record relationships across declared dimensions.', sourceBound: true },
  mind_map: { description: 'Read record hierarchy as a mind map.', sourceBound: true },
  bpmn_canvas: { description: 'Render process records with declared BPMN bindings.', sourceBound: true },
  lifecycle_canvas: { description: 'Read lifecycle records as a state diagram.', sourceBound: true },
  doc_lifecycle_studio: { description: 'Compose document lifecycle inspection and editing.' },
  rowview_workbench: { description: 'Compose record-row inspection and editing.' },
  record_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Coordinate record selection, structure navigation and child views. navigation_layout defaults to tree; list is the same structure navigation without collection or contextual tree nodes, not round-card navigation. Optional navigation_group_by projects a declared string/enum classification field into collapsible navigation groups without parent records or data writes. Graph edges remain canvas-selectable and editable but are not duplicated in the sidebar; a single graph node collection has no redundant category root. Related editors and canonical data are unchanged.', ownsWorkspace: true },
  record_board: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Grouped cards and navigable mind map with rejection/restoration, selected-record editing, nested details and an optional parent-scoped record workspace. Optional board.id_field displays an existing readonly text ID beside the card title.', sourceBound: true, ownsWorkspace: true },
  document_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Read a confined static HTML artifact with document-derived chapter navigation and evidence annotations.', ownsWorkspace: true },
  execution_log: { description: 'Embed a bounded rolling read-only Host execution log for the current Bundle Producer or explicitly associated artifact; native run identity and transcript access remain Host-owned.' },
  artifact_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Navigate ordered parent/child records with live execution, bounded traces and on-demand Markdown/HTML artifacts; read-only canonical facts.', ownsWorkspace: true },
  diagram_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Full-height diagram navigation, declared record details and optional process-scoped node inspector, live artifact execution and bounded BPMN editing with atomic artifact saves.', sourceBound: true, ownsWorkspace: true },
  canvas_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Topic navigation with editable native Excalidraw scene files and separately saved local image attachments; no scene bytes in canonical records.', sourceBound: true, ownsWorkspace: true },
  preview_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Isolated live HTML preview with declared CSS variable projections, schema-bound adjustments and data-only presets.', ownsWorkspace: true },
  navigation_workspace: { sidebarTitle: true, description: 'Authored sidebar_icon selects a finite decorative title icon; generated panels reject it. Navigation map with independent node/link labels, saved positions and grouping frames, and selected-record inspection.', ownsWorkspace: true },
  record_inspector: { description: 'Edit the selected record inside its owning record workspace. Optional authored sources compose same-record root and nested section views, preserving their canonical field bindings.' },
  math_document: { description: 'Read mathematical statements beside their plain-language explanations, notation and source pointers. Authored math bindings use declared text/rows fields in a record workspace; optional LaTeX editing uses the existing field/save authority. Rendering is not mathematical verification.', sourceBound: true },
  record_preview: { description: 'Preview the selected record title, body and optional action without executing it. Static form.body groups may embed the same component via sidecar; bindings are declared same-section text fields and the preview follows that exact form record, stacking below fields in narrow containers. Generated-origin forms reject this static extension.' },
  record_related_editor: { description: 'Edit child records referencing the selected parent; additions bind that parent explicitly. Optional authored record_table groups the same declared editors into complete table columns without converting canonical records. Optional inherit_from_graph presents ancestors\' associated records as read-only source-linked groups, never copies or resolves domain policy conflicts.' },
  relation_graph: { description: 'Interact with record nodes and binary edges or ordered role-bearing participants; multi-party relation centers project the original relation record.' },
  reference_graph: { description: 'Read-only relation canvas derived from declared in-workspace record references; details edit the original records, never a graph copy. Nodes may use label_scope: record for a root text label declared on the same canonical collection. Links use target or finite targets matching the field options_from_section/options_from_sections; missing or ambiguous identities stay diagnostic without guessed edges.' },
  data_table: { description: 'Authored editable sample-data grid with saved column definitions, field types and row identities. Bound to a declared data_table field inside a record workspace; edits use existing save ports. Supports text, number, boolean, date and select cells, field properties and two-index matrix viewing. No file upload or expressions; not enabled for generated panels.' },
  record_matrix: { description: 'Pivot a declared rows field inside the selected record.' },
  record_artifact: { description: 'Preview an existing artifact of the selected record, or inline related artifacts through an explicit record_select reference_field. Missing related records create no empty view; unreadable referenced files remain visible.' },
  structured_data: { description: 'Read structured saved data without changing it.', autoOrder: 10 },
  artifact_gallery: { description: 'Preview artifacts from the bounded Bundle inventory.', autoOrder: 11 },
  grouped_records: { description: 'Group saved records by a declared scalar field.', autoOrder: 6 },
  nested_collection: { description: 'Read a two-level saved record collection.', autoOrder: 7 },
  related_artifacts: { description: 'Read artifacts referenced by schema-declared record fields.', autoOrder: 12 },
  schema_field: { description: 'Edit a schema-declared scalar via a supported control.', autoOrder: 9 },
} as const satisfies Record<string, ComponentDescription>

export type ComponentKind = keyof typeof PANEL_COMPONENT_CATALOG

export const COMPONENT_KINDS = Object.freeze(Object.keys(PANEL_COMPONENT_CATALOG) as ComponentKind[])

export const WORKSPACE_COMPONENT_KINDS = Object.freeze(COMPONENT_KINDS
  .filter(name => (PANEL_COMPONENT_CATALOG[name] as ComponentDescription).ownsWorkspace === true))

export const SIDEBAR_TITLE_COMPONENT_KINDS = Object.freeze(COMPONENT_KINDS
  .filter(name => (PANEL_COMPONENT_CATALOG[name] as ComponentDescription).sidebarTitle === true))

export const SOURCE_BOUND_COMPONENTS: ReadonlySet<ComponentKind> = new Set(
  COMPONENT_KINDS.filter(name => (PANEL_COMPONENT_CATALOG[name] as ComponentDescription).sourceBound === true),
)

export const GENERATED_COMPONENT_KINDS = Object.freeze(COMPONENT_KINDS
  .filter(name => (PANEL_COMPONENT_CATALOG[name] as ComponentDescription).autoOrder !== undefined)
  .sort((left, right) => (PANEL_COMPONENT_CATALOG[left] as ComponentDescription).autoOrder!
    - (PANEL_COMPONENT_CATALOG[right] as ComponentDescription).autoOrder!))

/** AI guidance is derived from the actual vocabulary, not a second name list. */
export function describePanelComponents(generatedOnly = false): string {
  return (generatedOnly ? GENERATED_COMPONENT_KINDS : COMPONENT_KINDS)
    .map(name => `${name}: ${PANEL_COMPONENT_CATALOG[name].description}`).join('\n')
}
