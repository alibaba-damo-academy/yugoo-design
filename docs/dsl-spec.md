# Design Panel DSL Specification

The panel DSL is the declarative presentation profile defined by the [architecture baseline](system-design-baseline.md). A panel manifest is **pure data**—no JSX, CSS, or scripts—so a design system can be authored and shared as content. The `dsh-design-panel` interpreter renders it, and the host validates the same definition before publishing a Kit version.

The contributor scaffold emits this profile. A Bundle with `presentation.mode: native` instead resolves a prebuilt React panel registered by its trusted provider and does not require `panel.yaml`; native presentation never falls back to this DSL. An omitted `presentation` or explicit `presentation.mode: none` means no panel. Explicit `presentation.mode: auto` is a separate generated-Panel opt-in with no DSL files; it does not change this manifest grammar.

Version: `1`.

Before choosing components, use the [Panel UIUX standard](panel-uiux-standard.md) to identify the user's decision, information relationships, and editing feedback. This specification defines supported syntax; it does not prescribe one layout for every Bundle.

## Three layers

A manifest describes three things:

| Layer | Key | Purpose |
| --- | --- | --- |
| Data | `sections` | Named evidence sections; each is a map of records in the Design Files. |
| Editor | `fields` | Field controls bound to sections (how each record is edited). |
| View | `ui` | A component tree, data-bound to sections (how the panel is laid out). |

## Top-level shape

```yaml
version: 1
panel_kind: capability_map     # one of PANEL_KINDS
renderer: workspace            # optional top-level rendering strategy
item_name: 功能                 # optional singular item label
empty_description: …           # optional empty-state text
sections: […]
fields: […]
ui: {…}
```

### `panel_kind` (closed)

`evidence_workbook | capability_map | process | lifecycle | page_spec | document`

## `sections`

```yaml
sections:
  - id: functions          # stable logical section id; default record path
    title: 功能模块
    item_name: 功能         # optional
    add_label: 添加功能     # optional
    description: …         # optional
    navigation: primary    # optional: primary | contextual | advanced
```

`sections[].id` is the logical section id used by component and field bindings.
By default it also names the top-level Design Files record map (for example,
`functions` reads `{ functions: {…} }`). A section may instead declare
`records_path` for a nested record map, `fields_path` for editor fields inside
each record, and `order` for its durable record-id order list. These are safe
dotted paths, checked against the Bundle schema when the Kit is loaded; they
do not change the logical section id.

### New-record labels

Use `create.initial_label` when a newly added record needs a readable, localized
name before the user edits it. Do not put translation tokens in canonical defaults.

```yaml
create:
  id_field: id
  defaults: {title: ''}
  initial_label:
    field: title
    text: $t:newItem
    numbered_text: $t:newItemNumbered
```

The target must be a direct string field in the section's bound record schema,
not its `id_field` (or `id` when that option is omitted). Only these three label
options are supported. `text` is nonblank literal text or a whole `$t:key` token;
it has no placeholders. Optional `numbered_text` uses only `{index}`, which is
the existing record count plus one. It must contain that placeholder. An empty
collection uses `text`; a nonempty collection uses `numbered_text` if supplied,
otherwise `text`. This number is a display default, not a stable identity or a
guarantee of unique names after deletion.

Only the new record is seeded, in the existing atomic map/order insertion.
A nonblank supplied name wins, then a nonblank canonical default, then the label.
Existing records and their IDs are not renamed when the locale changes. The
Kit loader resolves just these label templates through the declared locales,
checks translated templates, and applies the usual default-locale fallback;
it never translates `create.defaults` or permits expressions/scripts.

This is an optional runtime capability. An older installed runtime does not
gain it just because this document or a source manifest was updated; load the
manifest against the actual target version before publishing it.

### Long text editing

Authored `textarea` fields may opt into `textarea_rows: 3..20` to give complete
instructions or configuration text a readable initial viewport. This is finite
presentation only: it does not trim text, parse it, change storage or impose a
character limit. Typed `record_map.item_fields` use the same leaf rule. Omission
preserves existing sizing; generated-origin panels do not expose this option.

### Same-record inspector views

An authored `record_inspector.sources` list can compose declared sections that
bind the same canonical record collection. On selection, only sections whose
`records_path` matches the selected source are rendered, in declared order.
The first section owns the title/actions; subsequent sections show their fields
without another record heading. Each section keeps its original `fields_path`
and edit binding. Omission preserves the single selected-section form.

For example, a navigator can select an external system or a contextual exchange
while its inspector uses `[systems, system_details, exchanges, exchange_details]`.
This exposes a record's title/source information and nested business fields
without copying or flattening saved data. Unknown, duplicate or unrelated
collection sources are rejected. Contextual creation through a nested projection
also retains the same collection's declared root creation defaults and identity.
Generated A2UI does not gain a new composition permission from this option.


`doc_lifecycle_studio` can be placed inside a `record_inspector` to reuse the
workspace's current document, state axis or action selection. It projects the
same `objects` / `axes` / `actions` records without storing a second matrix.
A document view retains both its own actions and actions affecting its states;
columns for affected other documents name their owner. Action and axis selection
narrows the same facts. Matrix edits retain their original action bindings;
movement rows read the declared movement fields on actions, not documents.
The surrounding workspace owns navigation, titles, editing and shared styles.
Standalone use retains the full-table view. This is a presentation composition,
not a new DSL field, required workflow or installed-runtime availability claim.

### Record workspace navigation groups

`record_workspace.navigation_group_by` optionally names a safe direct **string
or string-enum classification field** in every primary source's bound record
schema (after its section `fields_path`, if any). This field need not have an
editable control. Metadata, references, objects, arrays and non-text enums are
not supported. Contextual child collections and a relation graph's edge
collection are not grouped as primary sources.

```yaml
ui:
  component: record_workspace
  id: workbench
  sources: [items]
  navigation_group_by: category
  children:
    - {component: record_inspector, id: details}
```

Groups reuse the shared collapsible navigation tree. They are projections,
not selectable parent objects: no synthetic IDs, parent fields, inheritance,
order writes or new canonical collections. Exact nonblank field values are
labels; absent/blank values use the shared localized “Ungrouped” label without
normalizing saved text. Group order follows first appearance in the existing
record order. A real label equal to “Ungrouped” remains distinct from the
fallback group. Selection still identifies the real section/record, and
editing classification moves its navigation entry without changing its ID.

`navigation_layout: list` keeps group members flat; the default tree preserves
contextual children and same-group hierarchy. A parent outside a group is not
fabricated or copied there: its child appears at that group's root, while the
canonical reference remains unchanged. A single primary collection shows its
real records directly, with or without a graph; it does not add a redundant
collection header. Multiple primary collections retain their own collection
headers. Each collection keeps its ordinary add action,
with only its declared defaults; adding does not infer a category from a group.
Read-only views never add or initialize records. Omitting `navigation_group_by`
retains the existing navigation behavior.

Within a `record_workspace`, `navigation: contextual` declares a child-record
collection rather than another top-level navigation group. The renderer finds
its owning parent from a `record_select` or `record_multi_select` field whose
`options_from_section` names the parent section, then renders the generic
outline `parent record → child collection → child records`. Child records can
be added and selected from that outline; the fixed inspector edits only the
selected record and summarizes, rather than duplicates, its child collections.
No section id, field name, or domain vocabulary is built into this behavior.
With `record_multi_select`, the same child is visible beneath every referenced
parent. A contextual section without an in-workspace parent reference is
invalid instead of silently becoming a top-level section.
When the reference field is declared but a saved child has no existing parent,
the sidebar keeps a selectable warning entry so its details can be corrected.
This also applies when a related editor normally owns those children. The
projection does not infer, repair or remove a reference, and disappears once
the record has a valid parent. Multi-parent records with at least one existing
parent remain reachable there; their other invalid references stay visible in
the ordinary reference editor.

Workspace navigation has two shared presentation shapes, not one style per
Bundle. **Structure navigation** renders records or chapters, optional hierarchy
and explicitly supplied status/annotations. A flat list is its zero-hierarchy
case: `record_workspace.navigation_layout: list` shows primary records and
collection-tail add actions without category/contextual nodes, while retaining
related editors. `tree` (the default) exposes the declared grouping/hierarchy.
Both use the same wrapping labels, selection treatment and row geometry as
record boards, diagram, artifact and document workspaces. **Card navigation**
combines a title and secondary context, as in `question_workspace` rounds.
Do not choose round cards merely because a collection is flat. These are shared
renderer defaults, not new DSL components or arbitrary style overrides. The
Bundle supplies information bindings; status never creates canonical facts.

Nested form collections use the same content-group composition as ordinary
record details: parent-owned 16px between complete field groups, 8px within a
group, and its add action at the collection tail. A collapsible record owns only
its direct fields; nested radio/checkbox labels keep their own choice spacing.
Use existing field/group, `record_map` and related-editor declarations rather
than compensating with empty text nodes, ad-hoc separators or Bundle CSS.

An authored `reference_graph` is a read-only canvas for independent collections:
`references.nodes` binds unique workspace `source` sections with a text
`label_field`; `references.links` binds `source`, `field`, `target` and optional
display `label`/`reverse`. Each link field must be a declared `record_select` or
`record_multi_select` targeting that section. A link may instead declare
`item_field` to read a declared `record_map.item_fields` leaf `record_select`
targeting that section. This finite child editor reads options from parent Panel
sections; it cannot write the target, reference another Panel, nest another map,
or traverse arbitrary dotted paths. It derives transient nodes/edges
from current references, reports missing targets, and maps details back to the
original records. It never saves graph coordinates or creates connections.
Resource references do not create containment or implicit parent/back navigation.
A node may declare `label_scope: record` to read its direct root-record label
when the source section edits a nested `fields_path`. The same canonical
`records_path` must also have a root section declaring that text field; this
adds no copied title or editable alias. Omitting it retains field-scoped labels.
A record reference may use exclusive `options_from_sections: [a, b, ...]` to
select from a finite union of distinct local sections. Its graph link uses
`targets` with exactly those sections instead of `target`. Values remain the
original unqualified record IDs: a value present in several target collections
is ambiguous, is not offered as a new choice, and remains visible with a
diagnostic if already saved. Missing or ambiguous values create no guessed
edge and are never cleared by rendering. Hub layout retains single-target links.
An optional authored `references.layout: {kind: hub, center, top?, bottom?,
left?, right?}` arranges the same records in a hub-and-resources overview and a
focused internal view. Assign every node section to exactly one zone. Optional
`group_by` is a center-owned `record_select` into `top` with a declared link;
equal labels never imply a shared identity. `value_field` binds center-owned
text, and `entries: {field, title_field, description_field}` projects captions
from a center-owned `record_map`; complete rows remain in the existing form.
Node bindings may add `description_field`, scalar `kind_field` (localized through
the declared choice options) and a finite semantic `icon`. Optional `kind_icons`
maps declared kind-choice values to the same finite icons; unknown values, URLs
and executable artwork are rejected. The label remains visible, so color is not
the sole type cue. Optional `center_presentation: portrait` uses original,
decorative human-like portraits keyed only by stable record identity, with a
role header and brain/resource anatomy in focus. It adds no avatar field or
external image client. In portrait focus, each nonempty side is one connected
resource container with selectable internal mini-cards, not a separate connected
node per member. Container identities and aggregated edge routes are transient;
members retain their original record identity and all reference evidence. Large
lists scroll inside the container. Its handles remain measurable but invisible,
and connecting, moving or deleting records is prohibited. Compact profiles put
internal-view and original-form actions first, followed by bounded summaries;
complete entry/handoff facts remain in their existing original forms. Other hub
presets retain their individual resource cards.
The preset is authored-only, optional, and does not infer role traits from names.
Selection,
zoom, grouping frames and edge routes are transient, never new Design File facts.
Missing references stay diagnosable. This layout is optional and does not replace
BPMN, navigation maps, relation graphs or native whiteboard geometry.
`record_workspace.workspace_view: switch` accepts this canvas before its
`record_inspector`. Generated A2UI does not gain this static authored extension.
Matching state `member_of_map`/`members_of_map` rules participate in the existing
Panel integrity gate; absent/empty reference lists are valid, dangling targets
are not. Completion rules are not promoted into save gates.

For a nested link the same state rule uses
`members_of_map: {value: handoffs, item_field: target, map: agents}` inside the
owning `for_each_in_map`. Only explicit `item_field` selects a map-of-records;
ordinary list rules still reject maps. Absent/empty child references are valid
drafts; nonempty missing IDs fail without whitespace normalization. The save
gate matches source, field, target and item field exactly. Projection deduplicates
repeated targets visually while preserving every canonical handoff row.

In a workspace with a `relation_graph`, the graph's edge section remains in
the editing scope but is not duplicated as a sidebar tree. Select relationships
from the canvas to edit them in the same inspector. The same single-collection
navigation rule applies with or without a graph. Multi-collection and contextual
trees retain their declared grouping. A switching workspace reuses the shared
sidebar-edge canvas toggle and the same detail-form spacing as ordinary forms;
switching views changes neither records nor their stable identities.
Relationships with missing endpoints cannot be drawn but must not disappear:
the canvas exposes a localized warning with record selection into the same
inspector, including when both endpoints are absent. Read-only inspection stays
read-only; no placeholder endpoints are invented and no automatic repair occurs.

An authored `relation_graph` may instead bind
`graph.participants: {field, reference_field, role_field, order_field}`. The field
is an edge-owned `record_map` with a child `record_select` into the node section,
a text role, and the existing sibling string-array `order_field`. Stable child
keys identify participation rows; repeated references in different roles remain
distinct. This mode excludes source/target fields, endpoint annotations, binary
hierarchy and reversal declarations. Existing binary declarations retain their
behavior. Two complete participants render an ordered edge with role labels;
three or more render the original relation as a selectable incidence center and
one undirected line per row. The center is not another business object or saved
graph record. Dragging between objects creates two rows and their sibling order;
the inspector adds or reorders further participants. Relation centers cannot be
connection endpoints. Missing participants remain selectable and diagnosable.

`graph.related` may reference either the node or relation section, enabling one
canonical property collection to retain its actual owner. State
`members_of_map: {value, item_field, map, order_field}` matches the participant
binding in the existing graph save gate. The optional sibling order must contain
unique, existing child keys; an absent/partial order remains a draft. A completion
rule may add `min_entries` to require the minimum number of nonempty references
and full order coverage. Old list and nested-reference behavior is unchanged
when these options are omitted. `member_of_map.allow_empty: true` explicitly
permits empty text in an optional reference; its default remains unchanged.
`exclusive_fields: {fields: [object_ref, relation_ref], allow_empty: true}` permits
an unfinished owner but rejects two nonempty owners. Omit `allow_empty` in a
completion rule to require exactly one nonempty owner. State exclusivity is
included in graph save only when every field is an explicitly bound related
reference; completion is never promoted into that save gate.

A record section can also declare a self-referential hierarchy on its parent
`record_select` field:

```yaml
fields:
  - key: parent_ref
    control: record_select
    options_from_section: items
    applies_to: [items]
    hierarchy:
      label_field: title
      group_label: More specific items
      create_label: Create a more specific item
      create_title: Create a more specific item
      description: Start from the selected item without changing the base taxonomy.
      inherit_fields: [kind]
```

The workspace then nests child records under their parent, provides the same
contextual create sheet from the tree and inspector, and writes the parent
reference plus the declared label. Only explicitly declared scalar
`inherit_fields` are copied; the renderer never invents domain inheritance or
duplicates related records. Cycles and missing parents remain visible at the
root rather than making records disappear. This is a generic record hierarchy,
not a Kit-specific type system.

An edge-based hierarchy can opt into child creation with
`graph.hierarchy.create: {edge_kind, create_label, create_title}`. The edge kind
must be one of the declared hierarchy kinds. The shared create sheet stores a
new node using `graph.label_field` and a new edge from that child (`source`) to
the selected parent (`target`) in one Panel transaction. The edge name uses the
localized kind option label; identity and enum values stay canonical. Existing
records and explicitly declared order bindings are retained, with no copies of
the parent's fields or related records. A read-only Panel, cancelled sheet or
missing parent emits no update. Merely declaring `hierarchy.values` does not
enable creation. Node, edge and order storage paths must be disjoint, and label
fields must be writable text distinct from IDs, endpoints and kind fields.

An authored edge hierarchy may declare `max_parents: 1` with exactly one
hierarchy kind. The shared inspector then offers a single-source selector;
changing it updates the existing edge in place, preserving ID, label and
metadata. Detaching removes only that edge/order entry. Missing endpoints,
cycles and duplicate parent edges do not cause implicit repair or copying.
Canvas connection uses the same presentation guard. The owning Bundle must
also validate single-parent and acyclic edges before persistence; a UI guard is
not the validation authority. No declaration changes existing multi-parent graphs.

Within that workspace, `record_related_editor.inherit_from_graph: true` opts
into read-only ancestor groups alongside the selected node's own editable
associated records. `bindings.reference` must target the graph's node section.
Ancestor facts retain their owner, conditions, restrictions and confirmation
requirements. A source link selects the original record; no associated record
is copied, merged or granted. The domain method must explain conflicts rather
than assuming override/deny precedence. This opt-in also avoids duplicating the
covered related collection as sidebar child branches. Generated Auto Panels
cannot declare this policy. View/locale changes do not emit canonical updates.

### `record_form`: headers, body composition and order actions

`sections[].form` configures shared `record_form` presentation, including forms
composed by an inspector or related-record editor. Omission preserves the old
record label, body fields and order-dependent move controls.

```yaml
sections:
  - id: entries
    title: Entries
    order: entry_order
    form:
      reorder: false
      header: {variant: detail, title: {field: caption, editable: true}}
  - id: notes
    title: Notes
    form:
      reorder: false
      header: {variant: card, title: {text: Note, numbered: true}}
```

The fixed `detail` header is 44px high, with a 32px editable title; `card` is
40px high with a display title and optional ordinal in the currently displayed
record list. Header text supports normal Bundle translation tokens. Ordinals
are presentation, not record identities or newly stored facts.

A field-bound title must reference an unconditional declared `text` field of
the same section, never its identity. `editable: true` additionally excludes
readonly and derived fields and schema metadata/references. It uses the same
field binding/edit channel as the body, and consumes that field once: no second
body input or title copy is created. Omitted/false `editable` presents it as
text. Host readonly mode never renders a title editor or lifecycle actions.
Title edits retain all other record fields, IDs, references and order. The
existing confirm/atomic-delete behavior is unaffected.

`reorder: false` hides move controls only. It does not remove stored order,
change how records are read/added/deleted, or authorize other writes. `true`
still requires an existing durable order binding. This configuration is a
static Panel capability: generated-origin A2UI panels currently reject `form`
explicitly on generation/export/reload rather than dropping it or widening
their write permissions.

`form.body` is an optional finite list of `field`, `row`, `group`, and `tabs` items:

```yaml
form:
  body:
    - kind: row
      items:
        - {kind: text, text: '$t:decisionPrefix'}
        - {kind: field, field: decision, label: visually_hidden, width: auto}
        - {kind: field, field: description, label: visually_hidden, width: fill}
    - kind: group
      title: $t:conditions
      description: $t:conditionsHelp
      separator: true
      items: [{kind: field, field: condition, label: inline}]
```

Rows contain fields or display-only text; groups contain fields or rows, never
nested groups. The shapes are closed, with no scripts, CSS or expressions.
Group titles are optional: use the field caption for one input, and title a
multi-field scope only when it adds meaning. The shared renderer removes an
exact duplicate title for a single direct field with a visible caption and no
sidecar. It retains differently named scopes, multi-field headings, sidecar
headings and the sole heading of a visually hidden caption. Required cues and
accessible names remain bound to the original field; near-synonyms are an
authoring review concern, not runtime guesses. Field groups share the 16px
section / 8px control rhythm; field help has 8px before it and no trailing
margin, so it cannot add a second section gap.
Groups may additionally declare one read-only preview beside their fields:

```yaml
sidecar:
  component: record_preview
  title: $t:preview
  preview: {title: title, body: description, action: next_action, empty: '$t:empty'}
```

This reuses `record_preview`, bound to the exact record rendered by the form,
including nested `records_path`/`fields_path`; it needs no workspace selection
and cannot bind another section or execute the displayed action. The closed
slot admits only `component`, optional display `title`, and `preview`.
Preview title/body and optional action reference declared, unconditional, non-hidden text or
textarea fields in the same section. Binding names never translate; only the
sidecar display title and `preview.empty` do. Fields remain editable through
their existing canonical channel; the preview owns no state or write channel.
It stacks below fields in narrow containers. An empty conditional group still
disappears rather than exposing its hidden fields through a preview. This is a
static authored capability; generated A2UI forms reject it explicitly along
with `form`, not silently drop it during retention/export.

Field references are same-section declared undotted keys, cannot be binding-only
hidden fields, and cannot repeat another body/header editor. Conditional fields
keep their existing visibility/cleanup rules; empty groups and rows whose fields
are all invisible disappear. Explicit text-only rows are allowed. Unconsumed
visible fields are appended with their original renderer: partial layouts never
silently omit facts. `label` is `stacked` (default), `inline` (stacks in narrow
containers), or `visually_hidden` (accessible name remains). `width` is `auto`
or `fill`; this changes presentation, not write authority. Group titles/help and
row text use existing Bundle translations; keys, IDs and canonical values do not.

For longer records, a top-level body item may declare bounded record-local tabs:

```yaml
- kind: tabs
  id: record-design
  title: Design views
  tabs:
    - id: experience
      title: Experience
      items: [{kind: field, field: purpose}]
    - id: agreements
      title: Agreements
      items:
        - kind: group
          title: Optional references
          collapsible: true
          items: [{kind: field, field: notes}]
```

Tab-group IDs are unique in a body, and tab IDs unique within that group. Tabs
contain only the existing field/row/group items: no nested tabs or groups.
They reuse the shared `tabs` component, including keyboard navigation, stable
ID selection and mounted inactive editors. Fields remain unique across all
pages and the record header; fallback fields are appended once outside tabs.
Changing page, language or disclosure state emits no canonical edit and never
clears existing values. Readonly follows the original field's authority.
`group.collapsible: true` requires a nonempty title, starts closed and uses the
shared disclosure glyph with native keyboard-accessible details semantics.
Its content remains mounted; display state is not another data field. Choose
this only for optional material, not to hide an unresolved blocking decision.
Both additions are static authored form presentation; generated-origin A2UI
still rejects the complete `form` extension rather than silently dropping it.

`EditorField.choice_layout` is `column`, `row_wrap`, or `row_scroll`, only for
`radio`, `radio_custom`, and `multi_select`. Omission keeps the old layout.
`custom_focus: true` is only for `radio_custom` and focuses its custom input after
the user selects Other, not on mount, polling, locale switching or readonly.
`allow_clear: false` is only for `select` and suppresses new empty selections.
An existing missing value gets a disabled blank placeholder; a stale saved value
remains visible. Neither is normalized on load. Omitted/true retains the original
empty option and `undefined` edit. These field presentation extensions, like
`form`, explicitly reject in generated A2UI panels until separately supported.

## `fields`

`required: true` presents an expected input, including accessible naming and a
visible indicator. It does **not** add a browser submit constraint, rewrite an
empty value, or introduce a save/completion validator. Schema `required` checks
property presence; nonempty text and other content invariants belong to the
Bundle's existing scoped validation and methods. Panel Save and executor
publication retain their current different validation paths.

For a field shared by sections with different requirements, use the authored
alternative `required_in: [section_id]`. Each entry must be a distinct declared
`applies_to` section; it cannot coexist with `required`. Only those sections show
the requirement. The field keeps one canonical key and the same edit channel.
Generated A2UI currently rejects this authored extension explicitly; it does not
silently drop section-specific requirements.

Ordinary controls expose `aria-required`; radio choices expose it on the
`radiogroup`. Multi-value/token editors use a named group with a localized
required indication, not unsupported `aria-required` on `group` and not a
requirement on every draft token input. A matching single-field group title owns
the visible indicator when the field caption is visually hidden; otherwise a
small inline indicator remains beside the control. Conditional fields lose their
indicator when hidden. Optional notes must not declare either requirement form.

```yaml
fields:
  - key: priority          # record field key
    control: select        # one of CONTROL_KINDS
    label: 优先级
    applies_to: [functions]  # sections this field edits
    required: true
    wide: true             # optional full-width hint
    options:               # for select/radio/multi_select
      - { value: High, label: 高 }
```

### `control` (closed)

`text | textarea | number | select | radio | list | multi_select |
record_select | record_multi_select | key_value | toggle | artifact_ref |
rows | source_list | token_list | radio_custom | record_map |
source_reference_map | color`

The authoritative closed set is `CONTROL_KINDS` in
[the shared DSL contract](../packages/core/src/panel-dsl.ts). A control being
listed here does not make its parameters interchangeable with other controls;
use the corresponding field contract and validator when authoring a Bundle.

### Schema binding for `select` and `radio`

A `select` or `radio` field binds to a section record property declared in the
Bundle schema as `{"type": "enum", "values": [...]}` with a non-empty `values`
list. In generated A2UI, `options` must contain exactly those enum values, one
option per value, with display labels. There is no `enum` key on `type: "string"`:
declaring `{type: string, enum: [...]}` leaves a plain string property, and the
existing validators reject the mismatch instead of coercing it. Exact diagnostics:

- a generated `select`/`radio` field bound to a non-`enum` property, or an `enum`
  property with missing/empty `values` or mismatched options, fails with
  `auto panel: field "<key>" does not match schema`;
- keeping `options` on a control that does not consume them (e.g. `text`)
  fails manifest parsing with
  `field "<key>" control "text" does not consume options`.

Minimal matching pair (synthetic; the JSON is the record property's schema):

```yaml
fields:
  - key: status
    label: Status
    control: select
    applies_to: [devices]
    options:
      - {value: normal, label: Normal}
      - {value: anomaly, label: Anomaly}
```

```json
{"type": "enum", "values": ["normal", "anomaly"]}
```

### Field extensions for `record_form`

```yaml
fields:
  - key: detail
    control: textarea
    applies_to: [adaptations]
    visible_when: { field: decision, in: [adapt] }   # conditional visibility
  - key: standard_ref
    control: record_select
    applies_to: [adaptations]
    options_from_section: standards                  # options = section records
  - key: module_ref
    control: record_select
    applies_to: [adaptations]
    options_from_panel:                              # cross-panel option source
      panel_type: function_modules
      section_id: functions
  - key: steps
    control: rows                                    # typed sub-table
    applies_to: [adaptations]
    row_name: 步骤
    max_rows: 3                                      # default 50
    columns:
      - { key: title, control: text, label: 步骤 }
      - key: kind
        control: select
        label: 类型
        options: [{ value: dev, label: 开发 }]
      - { key: owner, control: ref, label: 负责标准, ref_sections: [standards] }
  - key: sources
    control: source_list                             # `kind:name` ref chips
    applies_to: [adaptations]
```

- `visible_when` hides the field unless another field of the same record
  currently holds a value in `in`; the gate re-evaluates on every edit.
  Authored fields may use `visible_when: {all: [{field: source_ref, in: ['']},
  {field: connection, in: [existing]}]}` for a nonempty, flat conjunction of
  these same conditions. Missing/null scalar values match `''`; arrays match
  if any string member matches. Every clause must match. Hidden values are
  retained unless the existing explicit `clear_when_hidden` contract applies;
  a change to any declared dependency then re-evaluates that contract. No
  recursive condition/expression language or executable predicates are allowed.
- Authored `label_when: [{field: mode, in: [automatic], label: When it runs}]`
  selects display copy from sibling values, using the same matching rule as
  `visible_when`. The first matching entry wins; no match keeps `label` (or the
  field key). Dependencies must be declared on a shared section, or on the same
  child for `record_map.item_fields`. Labels support `$t:` translations and are
  used consistently for captions and accessible control names. This never
  changes bindings, values, requirements or save rules. Hide inapplicable fields
  with `visible_when`; do not erase data unless an existing, explicit clearing
  contract requires it. Generated Auto Panel editor fields do not yet accept
  `label_when` (like the existing authored visibility extension).
- `options_from_section` / `options_from_panel` resolve choice options from
  record ids (label = record title). Cross-panel refs resolve through the
  host-supplied `panelData` render option; an absent resolver yields no
  options and never copies data into this panel.
- Static `options[]` entries may carry `when: { field, in }` to offer the
  option only while another field of the record matches.
- `rows` edits an array of row objects cell-by-cell; column controls are
  `text | textarea | select | ref`. `ref` columns need `ref_sections`
  (this panel) or `options_from_panel` (cross-panel).
- `source_list` edits an array of `kind:name` reference strings and renders
  readable chips (`standard:*` → 标准参考, `upload|user|research|ai`
  suffixed); unknown kinds pass through.
- `token_list` edits free string lists with optional suggested `options`. `token_layout:
  cards` displays option descriptions and `custom_description` for custom entries.
  Authored fields may opt into `token_add_mode: menu`: a keyboard-accessible preset
  menu disables already selected values and opens a cancellable custom-entry card.
  In card layout, the add/custom card shares the existing card grid (two columns
  in a wide workspace, one in a narrow workspace). `token_add_description` supplies
  a content-owned subtitle. `token_custom_icon` and each option's `icon` can select
  the shared `message-square` or `plug` glyph; arbitrary markup and unknown glyphs
  are rejected. These attributes are only valid on `token_list`, never generated
  scalar fields. Omission preserves the original inline editor.
  Options may declare `menu_description` and `selected_description` for distinct
  unselected/selected menu copy, both falling back to `description`. Saved cards
  keep the original `description`; copy never changes stored values.
  Cancel/Escape discard only the unsaved input; Add/Enter split and deduplicate values
  into the same bound list. Selecting another record discards the local entry draft.
  Omission or `inline` preserves the existing preset select and always-visible input.
  This static extension grants no new write scope; generated panels reject it explicitly.

  ```yaml
  - key: delivery_methods
    control: token_list
    token_layout: cards
    token_add_mode: menu
    custom_description: Requires an external service
    options: [{value: internal, label: Internal, description: Built in}]
    applies_to: [records]
  ```

Semantics decisions:

- Resolved options are deduped by value; earlier sources win (static
  `options`, then `options_from_section`, then `options_from_panel`).
  Record ids are Kit-level global reference ids.
- Stored row/ref arrays are never destructively normalized: a
  non-conforming member disables the whole field's editing with a clear
  diagnostic while the raw value is preserved verbatim; explicit deletion
  (after fixing the data) is the only removal path.
- `rows` keys React nodes through a module-level identity map over row
  objects, so deleting a middle row never re-keys the surviving rows;
  edited rows are cloned, untouched rows keep identity.
- `multi_select`/`record_multi_select` round-trip as string arrays; a
  comma-separated string is an accepted input contract on read (split and
  trimmed), while writes always emit arrays.
- `record_form` carries a generic record lifecycle in editable mode:
  add/remove/reorder emit whole-section rewrites through the panel-update
  channel (map insertion order is the record order); read-only renders no
  lifecycle affordances.
- `visible_when` and option `when` gates must reference a declared field
  sharing at least one `applies_to` section (column option gates must
  reference a column of the same `rows` field).

## `ui` component tree

A node binds a component to sections and may nest children or named slots.

```yaml
ui:
  component: record_tree
  id: functions-view
  source: functions            # section this component renders
  row_group:                   # optional grouping (record_tree)
    source: functions
    parent_field: function_epic
```

Layout nodes use `children` (list) or `slots` (`sidebar`/`main`/`overlay`):

```yaml
ui:
  component: panel_workspace
  id: root
  slots:
    sidebar: { component: record_nav, id: nav, source: roles }
    main:    { component: record_form, id: form, source: roles }
```

### `guidance` — independent Panel action guidance

An authored UI node may provide optional nonempty `guidance` text, including an
existing `$t:guidance` locale token. Put it on the owning workspace (or the root
of a plain form composition), once per Panel. It tells users what to do after
opening the Panel; it is not `SKILL.md` capability copy, `bundleDescription`,
empty-state `description`, field help, execution status or an error.

Shared workspaces render this guidance above their tools and content, with a
localized dismiss button. Dismissal is presentation-only for the mounted
workspace: it does not edit canonical data, invoke save, or persist a user
profile preference. Editing and changing language do not reopen it; reopening
the workspace may. Plain compositions use the same guidance primitive.
Record/board/question workspaces retain their old action-description fallback;
artifact, document and preview empty-state descriptions remain empty-state copy.
Do not declare both properties with the same action message or duplicate a
parent's guidance on its nested child. Omission adds no banner; an explicit
blank or non-string guidance value fails the existing Panel validation.

Editable record headers use the shared pencil to focus the original title
input, with no second rename control or title `*`. Required aria semantics and
owning schema/save checks remain; ordinary required fields keep their marks.
Readonly/derived names and missing update callbacks do not gain a pencil or
write authority. Special workspace names use their existing metadata bindings.

### `sidebar_icon` — authored sidebar title icons

An authored workspace may set `sidebar_icon: users` beside its `title`.
It selects a decorative 16px Lucide icon in the owning sidebar header, not
an icon on each record, a button, or a business-data field. The visible title
and navigation accessibility label remain authoritative.

The finite vocabulary is `SIDEBAR_ICONS` / `SidebarIcon` in
[`panel-dsl.ts`](../packages/core/src/panel-dsl.ts); supported components are
derived from the catalog's `sidebarTitle` capability. They currently include
`question_workspace`, `question_rounds`, `record_workspace`, `record_board`,
`document_workspace`, `artifact_workspace`, `diagram_workspace`,
`canvas_workspace`, `preview_workspace`, and `navigation_workspace`.
Raw `panel_workspace` slots, forms and `question_list` have no owning sidebar
title and reject this field. Omission preserves the component's existing chrome.

Only a finite string is accepted: URLs, SVG/HTML, import paths, expressions,
objects, null and unknown names fail validation. Content cannot load code or
register icons. Generated A2UI panels reject the field even on an otherwise
allowed component; static authoring capability does not expand that subset.
The icon does not alter canonical data, selection, edits, execution or save.

### `component` (trusted, extensible library)

The authoritative vocabulary is [`PANEL_COMPONENT_CATALOG`](../packages/core/src/panel-component-catalog.ts).
`COMPONENT_KINDS`, workspace ownership, source bindings and the generated-panel
subset are derived from that one registry; this document is not a second
validation whitelist. Bundle data cannot register executable components.

The shared library includes basic layouts and controls, question workspaces,
record navigation/editing, diagrams, canvases, artifact readers and previews.
Full-height workspace components preserve scroll and navigation ownership:
`record_board`, `document_workspace`, `artifact_workspace`, `diagram_workspace`,
`canvas_workspace`, `preview_workspace` and `navigation_workspace` expose their
behavior through explicit data bindings rather than Kit names. These are reusable
capabilities, not a guarantee that every record schema fits every workspace.

`record_board.board.detail_sources` can embed exactly one `record_workspace`
under the selected card. Each `{section, reference}` binding declares an unordered
direct record collection and a readonly `record_select` back to the board's
parent section. The child workspace sources must belong to those bindings.
Owner and child storage paths cannot alias or overlap. The renderer filters
children by the selected parent, binds new records to it, and merges hidden
sibling records back into canonical updates. It refuses sibling-id replacement,
reparenting and writes outside these collections. This is a view projection,
not a second stored copy; it does not support independently ordered child maps,
nested `fields_path` records or artifact staging in this first composition slice.
Ordinary `detail_sections` retain their existing same-record nested-form meaning.

`record_board` uses full-width cards and a workspace-covering overview. Optional
`board.group` binds a real grouping field. When omitted, the sidebar lists records
directly, cards have no artificial group heading, and the overview connects the
root directly to records. Do not bind long summaries merely to satisfy grouping;
this projection never adds a grouping field to canonical records.
Sidebar selection scrolls to a card; it does not start editing. Description and
badge drafts have explicit Save/Cancel, while rejected records remain inspectable
without granting edit access. Optional `board.id_field` binds a declared visible,
readonly `text` field and displays its existing string beside the card title and
at the top of cover details. Inline details retain the same card header. It does
not add an ID editor, generate a fallback ID or write state; omission retains the
existing title-only presentation. `board.detail_fields` restricts the parent fields
shown in the detail fold, and `details_title` localizes its heading. Optional nested
dimensions can be added or removed without replacing unrelated record fields.
`board.detail_fields_mode: fixed` instead shows every declared nested input and
removes dimension-level add/delete controls; collection item add/delete still
uses its usual editor. Fields remain schema-optional, including empty inputs.
Viewing does not insert missing strings/maps. Omitted/`on_demand` retains the
existing optional-dimension behavior. This option grants no new write authority.

`record_workspace.workspace_view: switch` puts the first child canvas over the
whole workspace. The edge action opens it, and the return action or a node's
details action returns to the selected record. It does not add form/canvas tabs
to the sidebar. Covered content stays mounted and inert to preserve selection,
drafts and the graph viewport without allowing hidden controls to receive input.

`record_related_editor.record_table` is an authored-only table presentation of
the same child collection, not a conversion to a `rows` array. Its finite
`columns: [{fields: [field_key, ...], label?: string}]` groups existing field
editors into cells. Every non-hidden field declared for that child section must
appear exactly once; hidden/foreign/duplicate bindings and unknown column keys
are rejected. Column labels default to the first field's label and use the usual
locale resolution. A cell retains field visibility, help, requiredness, custom
conditions and existing edit/derived-field rules. Record creation still binds
the selected parent, deletion preserves the normal section cleanup rules, and
`inherit_from_graph` tables remain source-linked and read-only. The shared table
wrapper owns horizontal scrolling at narrow widths. This does not promote the
component or this declaration to generated A2UI.

An authored graph hierarchy with `max_parents: 1` may opt into
`parent_control: header`. The existing single-parent selector then sits beside
the selected record's form title, rather than above the whole inspector. It
still updates the same relation edge, rejects cycles, retains the source-record
navigation and shows the actual parent in read-only mode. Omission preserves
the prior inspector presentation; neither view creates an extra parent field.

`diagram_workspace.diagram.detail_rows` groups declared read-only fields into
responsive fact cards. `chip_fields` selects string-list fields rendered as tags;
`detail_hint_fields` supplies the populated field labels for the details action.
`tags` maps declared enum fields to labels and finite semantic tones. These are
presentation declarations, not new edit rights or storage. Diagram details cover
only the content pane; the navigator remains available. Leaving an edited diagram
still requires successful serialization through the existing save barrier.

`diagram_workspace.diagram.label_source` can read a declared label from another
section bound to the same record collection. The optional `inspector` keeps a
context editor alongside the BPMN canvas: `process_sections` edit the selected
process; `nodes` binds `source`, `process_field`, `element_field`, `label_field`
and same-collection `sections`. Optional `related` groups use a process reference
and an optional `node_field`; `advanced: true` starts the group collapsed.
References must be declared `record_select` fields targeting the corresponding
collection. Clicking an element resolves its exact ID within the selected
process only; absent or duplicate bindings do not guess a record. Existing field
edit permissions and the atomic artifact save barrier remain authoritative.
This is contextual navigation, not automatic synchronization of BPMN structure
and business facts; authors must explain how structural changes are reconciled.

For an exact component contract and on-demand local type declarations, use the
authoring inspector from the repository root:

```sh
node .agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs . navigation_workspace --type ComponentNode.navigation_map.edges
```

Use the [component extension contract](a2ui-component-catalog-contract.md) when
adding a component: catalog, validation, renderer, styles, edit boundaries,
tests and authoring guidance must agree. Trusted runtime additions are possible;
unknown component names in a manifest are rejected.

Acceptance of a component name alone does not establish rendering fidelity,
editable lifecycle support, or compatibility with every host; those require
the component's binding contract and actual runtime verification.

Predefined DSL and A2UI-derived panels share this library, but generated panels
may use only the subset with an implemented generation/edit-authority contract.
An authored workspace is not automatically promoted into that subset.
Supported generated results can be deterministically retained as DSL; unsupported
capabilities must fail explicitly, never disappear during conversion. This is
not an arbitrary bidirectional A2UI protocol converter.

`question_list` is the standard controlled question interaction. Each source
record uses `prompt`, optional `note`, `kind` (`text | single | multiple`),
optional `choices[]` (`value`, `label`, `recommended`), `answer`, and optional
`detail`. Text answers render as one multiline input; an existing text-question
`detail` remains visible as read-only context rather than becoming a second
answer box. Single/multiple answers use accessible choice rows and may edit
`detail`; cards with a non-empty `answer` collapse to a readable result and can
be reopened for editing. The component writes only the fields exposed by that
interaction back to the owning record. It does not invent approval state, and an
empty answer remains unanswered even when `detail` contains context. Native
providers may explicitly extend answer-state semantics for attachments, and
may add rounds or rejection around this base contract without making those
extensions mandatory for other Kits.

Authored `question_list`, `question_rounds`, and `question_workspace` may declare
`card_groups` with a unique `id`, `title`, and ordered `question_ids`. Members
must be contiguous in the existing record order and, for round workspaces, stay
within one round. Invalid groups fall back to ordinary cards with a diagnostic;
grouping never reorders canonical records. Generated-origin Panels reject this
authored extension.

Each group may declare a `presentation` object containing only optional boolean
`always_expanded`, `show_detail`, and `show_attachments` properties. These select
shared component behavior, not Bundle-specific styling. Omission preserves the
usual collapse, detail, and attachment controls. Hiding a control preserves its
canonical data; keeping a card expanded does not grant editing permission.
Read-only, disabled, protected, historical and rejection guards still apply.

`question_workspace` composes the same question cards with the standard
`panel_workspace` navigation shell. It groups records by optional numeric
`round`, shows answer progress, and keeps only the selected group in the main
pane; records without a round form one current group. Its optional
`description` is rendered through the shared sticky workspace Tip Bar above
the main content, never squeezed into the navigation sidebar. `question_rounds` is the
backward-compatible alias for this workspace behavior. Optional
`multimodal_answer[]` entries use the Web App-compatible local reference shape
(`type`, `file_md5`, `filename`, `mime_type`, `size_bytes`, `artifact_file`).
The client keeps pending bytes in a reserved browser-only transport, strips it
before schema validation, and atomically saves only files still referenced by
canonical state. The transport is framework state, never a Bundle field.

Authored `question_workspace` / `question_rounds` nodes may explicitly set
`question_policy.allow_choice_actions: true`. Expanded editable dynamic single
cards offer “Switch to multiple choice”; multiple cards offer “Select all” /
“Deselect all”. Omission or `false` preserves the existing controls. The shared
runtime owns these actions and their localized styling, not Bundle CSS or an
author-supplied `renderActions` callback. Switching changes only `kind` to
`multiple`, preserving the exact answer bytes and keeping the editor open.
Select-all writes choice values in declared order through the existing
comma-separated `answer` contract; deselect-all writes an empty answer. Neither
action changes detail, attachments, identity, choices or round. Records declared
in `first_round_ids` are the fixed first-round configuration and do not receive
these actions; `protected_ids` still controls rejection only. Read-only,
disabled, rejected and read-only historical cards cannot invoke the actions.
Generated-origin/A2UI auto Panels reject this configuration, even when `false`;
their existing answer/detail-only write authority and protected `kind` remain
unchanged. Converting a generated view into an authored reusable panel does not
silently grant this capability: the author must opt in under the static contract.

`panel_workspace` is the reusable panel-internal left navigation + main content
layout. It standardizes containment, scroll ownership and narrow-panel fallback;
it does not define domain records or selection semantics. Use it rather than
copying a Kit-specific two-column shell.

The shared runtime `PanelWorkspaceNavigation` accepts optional per-item
`description`, `supporting`, and `statusLabel` display slots alongside the
label/current row. These are supplied display text, not canonical fields or
new DSL expressions. Omitted slots render no empty rows. The `meta` fallback
remains supported. A marker requires both explicit `statusIndicator: true`
and an existing `status`; a label-only item never gains an inferred status dot.
Flat record navigation, question rounds, and future workspace consumers share
the same base navigation typography, spacing and selected appearance. Bundle
CSS is not required. Hierarchical trees retain their separate structure.
Question progress excludes rejected items from answered/completion checks,
while retaining all group records in the displayed total and preserving fixed
question grouping, stable IDs, selection and canonical answers. The original
Web App question panel used body round sections, not this sidebar; the shared
sidebar is an enhanced structure using the original public navigation style,
not a claim of one-to-one restoration of a nonexistent original sidebar.

`doc_lifecycle_studio` binds `objects`/`axes`/`actions` sections (validation
fails loud when one is missing) and renders the fact table (actions × state
axes, per-cell effects) plus process/derivation/ledger projections derived at
render time; unavailable views render disabled with a reason, never hidden.
`rowview_workbench` renders the residue envelope (below) and requires a
`source` declaring the add section it owns — the details-envelope schema
check and the renderer are both scoped to that section; a workbench without
`source` is rejected at compile time.

In editable mode `bpmn_canvas` edits bidirectionally: each process record's
`name` and `steps` array (step name, `kind` task/gateway/event, order, add,
remove) round-trip through the panel Save like any field edit.

### `execution_log` — embedded Host logs (authored Panels)

`execution_log` embeds the shared rolling Host log in an authored layout. It is
read-only runtime observation: it does not create executions, edit Design Files,
or grant access to arbitrary transcripts. Discover it with
`design_list_panel_components` before authoring. Generated Panels cannot add it.

```yaml
ui:
  component: stack
  id: research-layout
  children:
    - component: execution_log
      id: producer-progress
      title: Execution progress
      log: {scope: producer, max_entries: 200}
    - component: execution_log
      id: selected-artifact-progress
      title: Artifact progress
      log:
        scope: artifact
        artifact_id_path: selected_artifact_id
        artifact_kind: research_direction
        artifact_file_path: selected_artifact_file
        max_entries: 200
```

`scope: producer` resolves the current Bundle's root native Producer.
`scope: artifact` requires exactly one `artifact_id` (literal) or
`artifact_id_path` (safe dotted path in this Panel's canonical data). Optional
`artifact_kind` and `artifact_file_path` disambiguate the Host's existing
association; these are selectors, not authorization. Canonical paths are read
only, and this component does not infer a selected record from a neighboring
workspace. Do not persist a transient selection merely to connect logs.

Only observations belonging to the owning Bundle are eligible. Native run ids,
invocation ids, transcript paths and credentials cannot be authored in `log`.
The Host still verifies every read. Main-mode artifact logs require an explicit
Host focus association; a main conversation must never substitute for an
unavailable Producer or artifact log. Missing associations/read capability show
an unavailable message. Support for exact artifact targets depends on the Host
adapter; a rendered log alone does not prove a native execution succeeded.

`max_entries` is an integer from 1 to 1000 (default 200). The log follows new rows
while the reader remains at the bottom, preserves manual scrolling, expands on
active execution and folds when it finishes. A run/target change clears old rows
and ignores late responses from the previous target. Temporary read failures
retain the last readable rows and active logs retry through the shared polling
scheduler. All these surfaces use the same `ExecutionRollingLog` client component.

### `tabs` — mounted views with stable identities

Use `tabs` to switch between declared child views, not to split canonical data
into copies. Its inputs are `id`, optional `title` (the tablist accessible name),
and `children`. Each child needs a non-empty `id`, unique among its siblings;
its optional `title` is the tab label, falling back to its ID. IDs are data
identities, not translated labels. Nested groups may reuse IDs because their
DOM relationships are independently scoped. Empty children render no tabs.

Selection is local presentation state. The first child is initially active;
changing labels or child order preserves selection by ID. Removing the active
child selects the first remaining child; re-adding it does not steal selection.
Inactive children stay mounted but are hidden, preserving their local drafts.
Do not use this component when inactive content must be unloaded or its readers
must stop: it does not promise lazy loading or cancellation. Hidden controls
are not reachable through ordinary keyboard focus.

Click/focus selects a tab. ArrowLeft/ArrowRight wrap between tabs; Home/End
select the first/last. The active tab is the one tablist entry in the Tab order;
each panel is linked through reciprocal `aria-controls`/`aria-labelledby`.
Tab selection emits no canonical edit. Child editors retain their existing
schema, save and read-only authority; a hidden editor is not an authorization
boundary. The host still owns atomic persistence and unsaved-change handling.

This non-Web equipment note example composes existing components only:

```yaml
version: 1
panel_kind: evidence_workbook
sections:
  - {id: equipment, title: Equipment notes, add_mode: none}
fields:
  - {key: title, label: Equipment, control: text, applies_to: [equipment]}
  - {key: note, label: Inspection note, control: textarea, applies_to: [equipment]}
ui:
  component: tabs
  id: equipment-views
  title: Equipment views
  children:
    - {component: text_block, id: guidance, title: Guidance, text: Record observations without inventing inspection results.}
    - {component: record_form, id: notes, title: Notes, source: equipment}
```

This notes-only example explicitly sets `add_mode: none`; adding or removing
equipment records is not authorized by its editors. It expects a declared
`equipment` map of records containing string `title` and
`note` fields, e.g. `{equipment: {pump_a: {title: 'Synthetic pump', note: ''}}}`.
It is a composition example, not a complete Kit or verified inspection fact.
The executable example test validates the actual YAML, schema-bound generated
adapter, retention and editor permissions; installed-host save/reopen remains
a separate verification layer. For localization, put display strings in Bundle
locale resources and replace titles/labels/text with `$t:` tokens; do not
translate `equipment`, `pump_a`, child IDs or stored observations.

The trusted catalog registers `tabs` for the supported generated subset. A2UI
conversion must still validate the complete child tree and edit bindings; tabs
cannot authorize an unsupported child, action or wider write scope. Generated
and retained DSL use the same renderer. Unknown components or incompatible
retained definitions must fail explicitly, not silently drop a tab.

Styles use the dedicated `.dsh-component-tabs` namespace so public `renderNode`
mounting does not collide with host navigation. Hosts must load shared Panel
styles; the component does not inject CSS. Test keyboard/hidden behavior and
narrow-container overflow in a real browser in addition to structural checks.

## Validation rules (fail loud)

`parsePanelManifest` / `validatePanelManifest` reject a manifest when:

- `version` is not `1`, or `panel_kind`/`control`/`component` is not in the
  closed sets;
- `sections`/`fields` are not lists, a field lacks a string key, or field
  keys duplicate;
- a `field.applies_to` references an undeclared section or is not a string
  list;
- a `ui` node's `source`/`sources` references an undeclared section;
- an `options[]` entry lacks string `value`/`label`, duplicates a value, or
  carries a malformed `when` (gate field must be declared and share an
  `applies_to` section; `in` must be a non-empty string list);
- `options_from_section` references an undeclared section, or
  `options_from_panel` lacks a non-empty `panel_type`/`section_id`;
- `visible_when` is malformed or its field is undeclared / shares no
  section with the gated field, or `in` is not a non-empty string list;
- a `rows` field lacks `columns` or `columns` is not a list, duplicates a
  column key, uses a column control outside the closed set, declares a
  `ref` column without exactly one of `ref_sections`/`options_from_panel`,
  references an undeclared section in `ref_sections`, carries malformed
  column options (a column option `when` must reference a column of the
  same `rows` field), or sets a non-positive `max_rows`;
- the YAML does not parse. The validator itself never throws on malformed
  shapes — every malformation surfaces as an error string.

The interpreter uses an exhaustive trusted renderer registry. Unknown components
are rejected, not silently replaced by a labelled placeholder. This structural
contract does not establish installed-host, artifact, save/reopen, language or
browser fidelity; those require the corresponding runtime acceptance tests.

## Data binding model

The interpreter projects Design Files by logical section: its record map is
read from `section.records_path ?? section.id`. With default paths, a component
with `source: functions` renders `data.functions`, and field values read
`record[field.key]`. A declared `fields_path` routes those fields into the
record's nested object instead. Cross-panel references
(`record_select` / `options_from_panel`) resolve against the owning skill's
Design Files by stable record id — references are never copied.

## Residue envelope (rowview_workbench)

The panel working copy's top level may carry the frozen A11 envelope, recognized by shape
only:

- `sync.refs[]` — read-only aggregation references
  (`{concern, record_ref, projection?}`). The renderer groups them by concern;
  a ref whose projection carries no title/summary/status degrades to a warning
  row showing the raw `record_ref` (never silently dropped).
- `add` / `add_order` — the exclusive editable region: sections of evidence
  records (`{id, title, summary?, details}`); manifest fields declared for the
  section edit `record.details`; add/remove/update emit panel-level
  `{add, add_order}` updates through the host merge.
- `module` / `residue_shape` — render-time metadata chips.

## Presentation contract

Dispatch between bespoke and declarative rendering is decided by the bundle's
`skill.yaml`, never by the skill name:

```yaml
presentation:
  mode: native
  renderer: io.deepseek.design.web-app.research/v1
```

The client reads the metadata from the projected `skillManifest`; `native`
resolves the matching compiled renderer from the lifecycle-owned client
registry, while `declarative` renders through this DSL. An unavailable native
renderer displays an explicit error and never falls back to the DSL, because
the declarative editor may not preserve the provider contribution's state semantics.
`none` creates no panel tab. A Bundle author may omit `presentation` from
`skill.yaml`; the Kit loader normalizes that omission to `{ mode: none }`
before publishing metadata. The client also treats an absent presentation as
no panel. A present declaration with an unrecognized mode is invalid and must
not silently select another rendering mode.

### Board user requests

Authored `record_board.board.request_create` declares `fields` (nonempty unique
editable text/textarea/choice field keys in the board's source), `prompt`, and
`submit_label` (localized display text). The Add action opens a local dialog and
sends the user-confirmed values through the current host's existing message
adapter. It never inserts a provisional canonical record. Required fields and
choices are checked before sending; a rejected send retains the dialog and values.
The action is unavailable in read-only mode or without a host message adapter.
Generated panels do not receive this adapter. Boards without this declaration
retain the existing declared direct-record creation behavior.

`navigation_map.nodes.caption_fields` optionally lists visible text, select or list fields from the node section for the native-style map card subtitle. Select values use declared labels; lists show their count and field label. This projection grants no edit authority. Artifact navigation retains the flat page list, preview toolbar, map cover and transient visual-geometry diagnostics; it does not substitute a generic record form for the live preview.

`board.detail_presentation: cover` promotes the selected record’s explicitly scoped `detail_sources` workspace into a full workspace cover. The board stays mounted to retain selection, scroll and local drafts; closing the cover restores it. The optional declaration changes presentation only: all child edits retain the same scoped merge and owning-record checks. Omitted/`inline` preserves ordinary card details.
