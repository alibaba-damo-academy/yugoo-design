---
name: page_design
description: |-
  - **Capability**: design the complete page map, then generate every confirmed page as a coherent HTML prototype using the active visual system.
  - **Resolves**: S/T gaps about product structure, concrete screens, and whether principal journeys can be clicked through.
  - **Candidate when**: functions and journeys are understood but the product lacks a page inventory, navigation structure, or complete concrete screens.
  - **Do not infer**: this skill does not redefine visual style, permissions, business rules, business-object meaning, external integration, or implementation architecture merely because those facts appear in an interface.
  - **Output**: `page_design` panel, one HTML artifact per page, and source-hotspot bindings for meaningful page jumps.
---

# Page Design

For canvas generation or revision, read [the canvas guide](reference/canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

## Core responsibility

Help a non-professional user answer one progressively deep question:

> What pages does this product need, how are they organized and connected, and
> after that structure is confirmed, what does every page actually look like
> and where can the user click to continue?

This is a two-stage capability: first a lightweight editable Page map, then the
concrete Page artifacts after user confirmation.

This Bundle is also a live design facet, not a one-time downstream stage.
Later invocations revise the smallest affected map or Page set while preserving
all accepted unaffected work.

The persisted JSON is always the page map and the panel renders that map
directly. Generated HTML is always file-backed artifact content. Never create
a second map projection or embed HTML inside JSON.

## Shared output contract

Read [reference/artifact-contract.md](reference/artifact-contract.md) before map/artifact work; give the same reference to every Page Worker. It documents file paths, shared Style inputs, script calls and preview bindings for both authoring and reconstruction.

These references and `scripts/page-design.mjs` belong to the installed Bundle,
not the project's WorkingCopy. On DSH, read this contract with
`read_skill_resource({path:"reference/artifact-contract.md"})`; call
`run_skill_script` with `path:"page-design.mjs"` (the path below `scripts/`,
without that prefix). Project `list`/`glob` cannot establish whether those
installed resources exist. Never replace the file validator with hand-written
hotspot bindings because a WorkingCopy search found no script. If the actual
resource or script tool fails, report its diagnostic and keep the affected
artifact unaccepted until repaired.

For forward design, also read [reference/task-to-page-method.md](reference/task-to-page-method.md)
before deciding the map. It defines task synthesis, navigation choices and
bounded Worker briefs using the existing state fields. Reconstruction preserves
observed page organization and reports its problems instead of redesigning it.

## Ownership and tools

`page_design/page_design.json` is the only canonical state. The foreground
Producer owns the complete Page map, every referenced HTML artifact, hotspot
bindings, validation, and publication. It first uses project-scoped `list` and
`read` to inspect the current state, owned artifacts, and relevant upstream
evidence. It uses `write` or `edit` to maintain the complete state and Page HTML
in its owned WorkingCopy. A delegated Worker's write/repair authority covers only
the exact `artifact_file` bound in its task; it cannot write canonical JSON.
Available read-only evidence tools may inspect a missing relevant source.

The Producer may author every Page serially itself. When two or more confirmed
Pages can be authored independently from the same `common_spec` and
`design_delegate_frontier` is available, it should submit one call with a
`batch_id` and the complete ordered `items` list (the exact shape is in the
shared contract). Use `design_delegate` for a single page or as a fallback,
dispatching independent sibling calls together. It may keep dependent Pages serial or take over any Page when
delegation is unavailable or a Worker fails. There is no required Worker count
or fixed work-item order. The Worker runs the Bundle's
`scripts/page-design.mjs validate-html-file` directly against its own HTML file and repairs every
diagnostic before it finishes. Immediately after writing, it invokes that
validator with `input_file`; it never reads the whole HTML merely to decide
whether the write was complete or performs a speculative full rewrite. After the Worker returns a successful file
receipt, the Producer does not read or resend the complete HTML merely to
acknowledge persistence. Quality review may inspect the relevant content or
preview. It invokes the
same file validator once by path to obtain its compact `bindings` result, then
writes the stable artifact ref and bindings into canonical JSON. File polling
shows every write; the Producer publishes only at the configured handoff or
terminal close through `design_publish`.

Each delegated call passes `artifact_kind: "page_html"`, `artifact_id` equal
to the stable Page ID, `artifact_file` equal to the exact HTML path, and a
complete `prompt` containing the common specification, Page brief, connections,
relevant evidence, active Design Style projection, and validation loop. These
explicit call arguments bind runtime status and panel logs; no task declaration
or domain validator belongs in `skill.yaml`. Before serially authoring or taking
over one Page, call `design_focus_artifact` with that same kind, ID, and file.

Pages without an accepted artifact ref remain planned; Pages with a readable
accepted artifact ref are complete. The Host records Producer and Worker
attempts and the Panel polls those native events.

## Maintaining existing design

Read the saved `page_design` state before proposing or changing anything. It
is the authority for page IDs, entry pages, hierarchy, page order, placement
of accepted functions on pages, page-level connections, and artifact
references. Attempt detail remains in the existing session/tool
log; the canonical Page record keeps only durable planned/accepted facts and
never duplicates attempt state or error payloads.

If a legacy project contains `page_design/page-map.svg`, delete that obsolete
derived file on the next Page Design write. The canonical JSON and current
panel already contain the complete map; do not regenerate the SVG.

- Preserve unaffected page and connection IDs. A rename does not justify a
  new ID.
- Maintain the complete updated map state for the first material map and every
  later revision. Validate and publish that canonical WorkingCopy through the
  scoped Producer tools.
- When adding, removing, or reordering pages or connections, carry the
  complete affected `page_order` or `connection_order`; order lists replace
  rather than append.
- Preserve frontend-authored `canvas_position` values unless the user
  explicitly asks to rearrange the map. Do not invent positions in the
  initial proposal; let the canvas auto-layout the first map.
- Preserve frontend-authored `canvas_sections` values unless the user asks to
  reorganize the Page Map. Section titles, membership, positions, and sizes are
     layout-only design evidence: they organize the editor, but do not rename product navigation groups or invalidate
  Page HTML. Do not invent section geometry in the initial proposal; the panel
  materializes the complete section set only after the user edits or adds a
  frame.
- Treat a panel-authored connection add, removal, or label change as a real
  navigation decision. Preserve it, clear the affected source Page's stale
  `artifact_file`, and repair only that source Page. A Page
  position or section-only edit never makes an HTML artifact stale.
- Interpret panel saves by the evidence they change, not as a blanket request
  to regenerate the Bundle. Page positions and section title, membership,
  position, or size update only the canonical JSON. A connection add, removal, target, or label change updates
  navigation evidence and requires only the source Page hotspot to be checked
  or repaired. A Page name, purpose, type, content, action, function, evidence,
  entry, hierarchy, add, or removal changes Page semantics and requires the
  smallest affected Page set plus the complete orders and shared navigation
  projection to be reconciled. Canvas viewport, zoom, selection, and an open
  inspector are local UI state and never enter Design Files.
- Every accepted Page Map panel save writes only the user-edited canonical JSON
  through the ordinary Host path. The panel and downstream consumers project
  the map from that same canonical state; no duplicate SVG map artifact is
  generated or published.
- Preserve the established `common_spec` unless the user explicitly changes
  the cross-page layout, navigation, Logo, or component treatments. When a Page is
  added, removed, renamed, or reordered, update the complete
  `common_spec.navigation` list in the same WorkingCopy update; the list replaces its
  predecessor rather than appending to it.
- Never write an `html` field or execution status in JSON. An accepted Page
  points to its stable
  `page_design/pages/<page-id>.html` artifact. Preserve
  valid `stage`, `artifact_file`, `style_theme`, and `style_epoch` values in
  unrelated edits.
- When the user explicitly asks to replace a Page artifact, read the accepted
  HTML and use `edit` for the affected HTML region whenever the requested
  change is local. Preserve the stable `artifact_file`, unrelated markup,
  hotspot IDs, and every unaffected Page. Rewrite the complete document only
  when the requested change invalidates its overall shell or interaction.
  Ordinary wording edits do not imply regeneration.
- A page-level connection is the durable navigation decision. Store its
  natural-language jump trigger in `label`; `trigger` is not a connection
  field. Its
  source-hotspot binding is a refinement of that same connection, never a
  second navigation record.
- `function_refs` is the durable placement decision that says where an
  accepted `function_modules` capability is actually usable. Preserve
  established references unless the page task or function scope changes.

When a requested revision makes a Page prototype obsolete but cannot yet be
completed, clear only that Page's accepted artifact reference and preserve every
unaffected Page. During an active completion run, repair that same canonical
artifact and restore its reference only after validation accepts the integrated
WorkingCopy.

## Prerequisite evidence

This Bundle deepens the capability map from `function_modules` through the visual language from `design_style`. Treat their persisted records as references and never copy functions or visual tokens into a parallel model. A valid Design Style result is required before Page HTML generation because this Bundle produces high-fidelity pages, never unstyled wireframes. The Web App Mindset tells the main Agent to satisfy an explicit Page Design request by first running `design_style` for an unconfirmed, product-appropriate baseline when the selected project has no valid visual result, then to continue this Bundle in the same attached request. The Page Producer does not create or mutate that other Bundle's state. When `function_modules` is absent, keep only page decisions grounded by the current request and visible design evidence; do not invent a complete capability map merely to start generation. The user may explicitly authorize reasonable assumptions, but unsupported decisions remain visible assumptions rather than facts attributed to another Bundle. This evidence relationship is not a fixed execution order: the visual baseline is a completion requirement of the explicitly requested Page result, not a Core-owned execution graph.

## Post-write Design projection self-check

Page Design instantiates the current visual language; it never fills a missing
visual contract by inventing a Page-private logo, icon library, hierarchy, or
component system. If concrete Page work exposes a missing Style decision,
report the exact missing semantic role, pattern, state, or asset to the main
Agent and stop only the affected Page work. The main Agent decides whether to
invoke a separate, sequential Design Style revision and later resume Page
Design. This Producer must not switch Bundles itself, and dependent Style and
Page Producers must not run concurrently. Pure token changes flow into current
previews through `tokens.css`; structural or asset changes require a focused
Page revision, never automatic full-site regeneration.

After changing the map or artifacts, review the affected files against current
Page, Style and upstream evidence before closing. Repair source-proven issues
owned by Page Design; report missing shared decisions to the main Agent and
ask the user only for a real product choice. Script success does not replace
this review. Preserve unrelated work, rerun mechanical checks after repairs,
and report the checks actually performed plus remaining gaps. Ongoing G/R/A
review does not retroactively establish the quality of this result.

## Evidence ownership and inputs

This skill uniquely owns the complete page inventory, prototype entry pages,
page hierarchy and order, meaningful directional page-to-page jumps, each
page's primary task/audience/content/actions, the function-to-page placement
map, and the binding between an outgoing jump and one real element in its
source-page artifact.

Consume accepted functions and module boundaries from `function_modules`,
journeys from `flow_design`, information from `business_data`, conditions from
`business_rules`, audience visibility from `role_access`, visual tokens from
`design_style`, and relevant external/message behavior from
`integration_design` and `notification_design`. Do not copy those owners into
a second field dictionary, rule table, permission matrix, theme, or flow.

## Hard execution rules

### Validation boundary

The script checks complete HTML, reference resolution, prototype bindings and
the ownership of the shared `--ds-*` namespace. The existing schema and
declarative validator check the map and referenced files. These are mechanical
checks, not a design-quality score. No HTML-length, layout-count, token-count,
token-category, version-regex or SVG-text-equality test establishes quality.

The author reviews content fidelity, navigation meaning, responsive behavior,
accessibility and visual consistency against the current Page brief and Style
assets. In reconstruction, compare with the source UI. Reuse the chosen Logo
and icon system; do not redraw different assets merely because the script
passes. Report remaining design discrepancies separately from script results.
If a missing shared decision belongs to Style, use the existing main-Agent
handoff rather than inventing a private replacement or a new validator rule.

Only `data-prototype-page`, `data-prototype-id`, `data-prototype-connection`
and `data-prototype-label` serve the preview/navigation integration described
below. `data-nav-*`, `data-design-wordmark`, and SVG wrapper placement are not
required HTML structure. Optional `data-design-icon` / `data-design-brand`
markers must refer to existing Style IDs; their presence is not proof of fidelity.

1. Map before Pages. The first material write contains only the complete Page
   map and connections; it never contains HTML or a speculative
   `artifact_file`. Leave that ref null or absent until the accepted HTML exists.
2. Write the valid initial map so the polling panel appears before Page
   generation. Stop at the configured
   `user_continue` gate after the initial map or a material pre-generation
   revision with `design_publish({action:"handoff"})`. Do not
   author confirmed Page HTML before the user continues.
3. After confirmation, the Producer completes the Page artifacts in the same
   foreground engagement. It batches independent bounded Page candidates with
   `design_delegate_frontier` (or sibling single calls when unavailable);
   delegation is never required. An explicit replacement request edits only
   affected Pages and does not manufacture a semantic map change.
4. Validate and integrate every new or changed Page by the shared artifact contract’s file-mode validation procedure. Then run `design_validate` and close through `design_publish({action:"complete"})` once.
5. Partial failure is visible from the Host attempt plus its session tool log
   and is retryable. Preserve successful siblings and never write an error into the
   canonical Page map or regenerate all Pages merely because one failed.
6. Close only when every confirmed Page has a validated artifact and the publication
   validation passes.
7. Pages using the shared layout follow the decisions in `common_spec`:
   the same navigation items, labels, order, Logo, layout direction, and
   component language. The spec is a design input, not an HTML template or
   assembly layer. Any Page candidate that invents competing decisions must be
   reviewed and repaired before integration. This does not prescribe identical
   DOM structure across responsive or source-specific layouts.
8. `design_style` is the visual-language authority. Read its current assets and
   token catalog before authoring. Do not declare or override its `--ds-*`
   namespace in Page HTML. Use its tokens for shared design decisions; local
   CSS is allowed for page-specific implementation, not as a private theme.

## Workflow: Map → Author → Connect

### Phase 1 — Map the whole product

Before creating Pages, synthesize the current user's goals, meaningful tasks,
object context and state transitions from the relevant saved evidence, using
the task-to-page method. Decide which work shares a surface, which needs a
separate page, and which destinations deserve global navigation. Then read the
active Design Style result and define `common_spec`, the cross-page Page System Spec
that shared-layout Pages independently implement. Derive it from active `design_style` evidence and
set `source: "design_style"`. Never create a provisional map or use missing visual evidence to justify unstyled HTML.
It contains one shared page-layout description, one main `logo`, the complete ordered
`navigation` menu with final labels, Page targets, and semantic `icon_ref`
values, plus the `shared_components` and `visual_pattern_refs` all Pages reuse.
Page hierarchy and menu membership are independent: include only real menu
destinations, not every top-level Page. The menu may be empty when appropriate.
Set each new Page's `uses_shared_layout` explicitly: true uses the common
navigation and Logo; false uses its own layout described in purpose/key_content
(for example authorization or standalone preview). Omitted values in old files
retain shared-layout behavior; do not mass-rewrite old projects. Never infer
layout membership from page type, parent, or menu presence. Independent Pages
still consume the same Style tokens and exact icon assets.
This record contains decisions, not HTML, CSS,
component source, slots, or an assembly plan. Do not leave these decisions to
later Page authoring.

`logo.mark_ref` refers to `design_style.config.brand.mark_id`; navigation
`icon_ref` values refer to stable keys in `design_style.config.icons`. Page
HTML reuses the referenced assets where a standalone artifact needs them;
it does not invent substitutes. Optional semantic asset markers may aid review
but require no particular wrapper. For a raster Logo, omit SVG-only `mark_ref`
and reuse Style's `brand.logo_image.path`; describe its scope in the existing
Logo specification. If Style has no accepted graphic asset, omit `mark_ref`
and use the agreed wordmark. Existing HTML remains readable without
adding audit-only markers.

Before delegating or serially generating HTML, run the shared contract’s map check against the current Style authority; repair missing references before sending the same bad input to every Worker.

Derive Pages from user tasks rather than database objects. Give each Page a
stable ID, one primary purpose, the closest ordinary page type, audience
context, major content, principal actions, exact accepted `function_refs`, and
the most relevant `evidence_refs` (`skill:id`) into confirmed flows, data
objects, rules, roles, integrations, notifications, and acceptance cases.
References preserve traceability and focus Page authoring; they are not a
requirement to mirror every upstream record or place one marker per fact.
Every accepted user-facing function must be usable on at least one Page.

Record at least one entry Page and only meaningful directional jumps. A
connection initially contains `id`, `source_page_id`,
`target_page_id`, and `label`; put the natural user-visible trigger in
`label`, never in an invented `trigger` property. Omit the HTML-derived
`source_element_id` and `source_element_label` until source HTML exists;
hierarchy never implies a jump. Multi-Page maps cannot contain unexplained
isolated Pages.

When distinct items lead to one detail surface, use separate stable connections
with optional `preview_context` selection metadata as defined in the shared
contract. Do not duplicate entity facts into connections or create a Page per
sample merely to retain identity. The target artifact must read the Host's
reserved JSON context block, select the corresponding existing content, and
handle absent/unknown selections honestly. Do not author the reserved block or
invent URL/storage navigation. Preserve unaffected connection contexts during
revision; a context change requires the affected target behavior to be checked
as well as its source hotspot. Verify this on the actual supported preview,
not by a source handler or a valid binding alone.

Write the complete initial map state, then enter map review with
`design_publish({action:"handoff"})`. Later
revisions maintain the complete updated state with full replacement orders
whenever Pages or connections change.

### Phase 2 — Generate confirmed Pages

After confirmation, the Producer reads the confirmed map, relevant upstream
evidence, and active Design Style projection. It groups independent Pages into
one complete `design_delegate_frontier` call when optional delegation would materially
reduce latency; it does not await one independent Page before dispatching the
next. For any delegated Page, supply the full `common_spec`, its current
Page brief, a compact inventory of relevant neighboring Pages' IDs and purposes,
incoming and outgoing connections, assigned functions, sliced upstream evidence, and
the active Design Style projection, plus the exact `artifact_file`. Include the
full shared navigation where applicable. Supply source locators and relevant
excerpts, with confirmed facts separated from proposed design choices. Do not
also require blanket rereads of the complete Page Map, Style preview and every
upstream Bundle. Workers read missing evidence or exact assets as needed. The Worker
writes and repairs one complete HTML document at that path. Supply file paths
for mechanical validation, not model-copied state, token maps or SVG data.
Use the shared contract's native CLI equivalent on other hosts. The foreground
Producer consumes the successful file receipt, obtains compact bindings through
the file validator, integrates the artifact reference, and publishes it; it
does not move the HTML bytes through model tool arguments again.

Every accepted Page candidate is one complete, self-contained HTML document. Every Page
artifact contains its applicable layout, Page content,
styles, and local interactions. `common_spec` keeps separately authored
Pages consistent by fixing shared design decisions; it is never generated as a
separate artifact, injected as an HTML layer, or combined through fragments,
slots, or nested shells.

- The assigned `page_map_brief.page` is the authority for this Page. Implement
  every explicit fact in its name, purpose, audience, `key_content`, and
  `key_actions`. Do not invent a competing label, state, count, version,
  example value, or workflow outcome. Fill genuinely unspecified presentation
  details with coherent examples, but never use those examples to contradict
  or replace an explicit Page fact.
- Shared-layout Pages follow the navigation, Logo, shell direction and component
  language agreed in `common_spec`; the author checks their meaning and visual
  consistency. Responsive or source-specific layouts need not share a DOM shape.
  Each cross-Page navigation control uses `data-prototype-page="<page-id>"`
  so the host preview can switch artifacts without adding routing code.
- Every Page input includes its assigned functions and sliced upstream evidence:
  each
  `evidence_refs` entry (`skill:id`, e.g. `flow_design:P-001`,
  `business_data:orders`) plus its `function_refs`. Respect each reference's
  relevant constraints; a broad flow/object reference does not require displaying
  all of that record on this Page. Render the task's real state and interaction
  (list, form, empty, and error states as applicable) by synthesizing the records into the Page's
  information, controls, feedback, and transitions. Do not render evidence as
  explanatory cards or mechanically create one widget per record.
  `data-function-ref` and `data-evidence-ref` may preserve useful provenance on
  major regions, but marker presence is never the quality criterion — the
  prototype is judged by whether the interaction faithfully expresses the
  confirmed design.
- Review readable hierarchy, appropriate typography/spacing, responsive behavior
  and accessible interaction feedback for the actual page task. Choose layout
  techniques and token usage accordingly; do not add decoration or markup to
  satisfy a numerical quota.
- Choose representative content by what can change the user's decision or the
  interaction's outcome, using the confirmed task and upstream evidence. Derive
  the starting condition, user action and observable result before implementing
  the interaction. Vary content or conditions where that changes usability or
  permitted behavior; do not invent product rules, enumerate every theoretical
  state, or require a separate sample-data artifact.
- Reuse Style's chosen icon library, semantic mapping and brand assets. Keep
  their visual identity consistent across pages; optional markers and exact
  SVG serialization are not substitutes for that review.
- Consume shared design decisions from Style tokens. Page-specific CSS values
  are not inherently errors; review whether they contradict the agreed system.
- meaningful interactive elements carry unique `data-prototype-id` and
  readable `data-prototype-label` values;
- every outgoing jump is marked exactly once with
  `data-prototype-connection="<connection-id>"`, and incoming jumps are never
  marked;
- no remote dependency, navigation URL, or cross-Page routing script;
- the result remains useful at a 1280px canvas and adapts to narrower
  previews.

Each delegated Worker writes its validated HTML to the stable Page path, making
the file visible while siblings continue. The Producer consumes that Page's
file receipt, runs `validate-html-file` by path for compact diagnostics and
bindings, updates that Page's canonical state, and validates the complete
canonical result. It may inspect targeted HTML or the preview for a named
quality question or integration defect; it does not reread all HTML just to
acknowledge receipts. Takeover repairs the affected file.
When a
revision to `common_spec`, the Page's task, outgoing connections, assigned
functions, or referenced evidence requires new HTML, edit only that Page's
canonical artifact whenever possible. Unaffected Pages preserve their
accepted artifacts. After completion validation passes, call
`design_publish({action:"complete"})` to publish atomically.

### Phase 3 — Verify connections and completion

Derive each outgoing connection's `source_element_id` and label from validated
source HTML in the integrated WorkingCopy. Verify the principal journey from
the user's starting task and object context to its observable outcome, including
whether global navigation is justified and the same object/state survives each
transition. Function coverage and matching shell styles alone do not pass this
review. Explain the principal route in a recognizable user situation at the
existing map handoff; do not add another approval round. Verify the journey from
every entry Page through real hotspots. The Page author checks local actions
against the expected results derived from the brief, and the Producer checks
the integrated journey. With an available browser/preview, perform the actions
and inspect the visible result for the intended object and state; a handler,
result string or valid binding in source is not evidence that the user can
complete the task. Include alternate conditions that materially change the
confirmed outcome, not a fixed catalogue of test cases. After a local revision,
repeat the affected interaction and check the neighboring behavior it depends
on. Without an execution surface, report the static review and unverified
behavior explicitly instead of claiming a click-through pass. Repair only
named failed Pages or map defects without disturbing successful siblings.

## Minimal initial state

```json
{
  "schema_version": 7,
  "stage": "mapped",
  "common_spec": {
    "layout": "左侧固定主导航，右侧为带顶部标题栏的主内容区。",
    "logo": {
      "name": "云帆订单",
      "description": "侧边栏顶部显示统一主标记和「云帆订单」字标。",
      "mark_ref": "primary"
    },
    "navigation": [
      {
        "id": "orders-nav",
        "label": "订单",
        "target_page_id": "order-list",
        "group": "工作台",
        "icon_ref": "navigation_orders"
      }
    ],
    "shared_components": ["页面标题栏", "主按钮", "状态标签", "空状态"],
    "visual_pattern_refs": ["primary_navigation", "page_header", "status_badge"],
    "source": "design_style"
  },
  "pages": {
    "order-list": {
      "id": "order-list",
      "name": "订单列表",
      "purpose": "查找并进入需要处理的订单。",
      "page_type": "list",
      "uses_shared_layout": true,
      "audience": ["销售代表"],
      "key_content": ["订单筛选", "订单结果与状态"],
      "key_actions": ["新建订单", "查看订单"],
      "function_refs": ["list-orders", "create-order"],
      "evidence_refs": ["business_data:orders", "flow_design:P-001"],
      "style_pattern_refs": ["page_header", "status_badge"],
      "artifact_file": ""
    }
  },
  "page_order": ["order-list"],
  "entry_page_ids": ["order-list"],
  "connections": {},
  "connection_order": []
}
```

## Author quality review

- The map covers accepted tasks without mechanically mirroring storage.
- The map fixes one complete `common_spec`; menu targets exist and shared-layout
  Pages render its labels and Logo. Independent Pages preserve their own layout,
  while retaining Style asset, token and connection validation.
- Resolve every declared `function_ref` and `evidence_ref` during the
  revision-pinned post-write self-check. An unresolved upstream record is a
  reported evidence gap, not a pre-write rejection of otherwise valid Page
  state or HTML. Page mapping does not need to enumerate every upstream
  record; G/R/A analysis identifies meaningful omissions and drift after
  commits without turning traceability metadata into a rigid execution gate.
- The prototype is a cohesive high-fidelity application prototype and a direct
  implementation reference. Its information, controls, states, feedback, and
  transitions visibly implement the confirmed product rather than displaying
  a generic dashboard or explanatory evidence cards.
- Every generated artifact is one complete, self-contained HTML Page. Shared
  consistency comes from the same `common_spec` and Design Style projection,
  not from nested shells, HTML fragments, slots, or mechanical composition.
- Page order, hierarchy, entry points, and labelled connections form one
  coherent reachable product structure.
- Every Page with an accepted artifact reference has exactly one confined,
  validated HTML artifact.
- Page artifacts share the pinned visual system, realistic product content,
  unique prototype IDs, and correct hotspot bindings. Optional provenance
  markers do not substitute for faithful functions, flows, entities, states,
  rules, permissions, and interactions.
- Every committed Page uses the same authoritative visual token projection;
  candidate HTML neither redefines the projection nor references unknown tokens.
  Review visual fidelity separately; successful script validation alone does
  not establish it.
- JSON remains the only map, and HTML remains file-backed.
- The Producer treats the current Page HTML refs as the complete Page Design
  artifact set and explicitly removes older Page artifacts
  that the canonical map no longer references before publication.

## Interaction gate and close-out

This Bundle uses `user_continue`, not `must_edit`. Map-changing chat remains a
map revision; only a pure confirmation consumes the gate and authorizes the
Producer to complete the confirmed Pages. The Producer repairs validation
failures itself; ask the user only when completion needs a missing product
  decision. Close with the entry structure, principal clickable journeys, and
  accepted or still-unresolved artifact refs only after the complete
  JSON-and-artifact publication passes.
