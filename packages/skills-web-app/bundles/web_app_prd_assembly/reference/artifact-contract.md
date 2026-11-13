# PRD output contract

## Record IDs

This Bundle assembles existing design records; it does not mint new identities for the source entities. Preserve actual source record references, section/HTML identifiers and existing AI provenance identities under their own contracts.

Shared by normal assembly and reconstruction. State is `web_app_prd_assembly/web_app_prd_assembly.json`; document is `web_app_prd_assembly/prd.html`. This is a format/projection contract, not permission to fill missing product decisions. During reconstruction report absent evidence instead of inventing requirements to fill the template. If required evidence cannot be represented legally, report that limitation without bypassing validation.

## Single source of structure

Load the only PRD template with `read_skill_resource` from
`reference/prd-template.html`. It is the sole authority for the complete HTML
document shell and stylesheet, chapter IDs, chapter
policy, allowed evidence owners, missing-evidence behavior, and visual directive
locations. There is no second YAML template, hardcoded topic catalog, outline
ledger, coverage database, or content manifest.

Start from that HTML template and replace its title placeholders and chapter
guidance comments with product content. Keep its document stylesheet byte-for-byte,
use no additional `<style>` blocks or inline `style` attributes, and do not add
presentation classes. The fixed shell deliberately renders a plain white,
black-text, print-friendly document. The only authored semantic classes are the
template's note/warning markers, the purple `ai-provenance` rail, and optional
`prd-verbatim-source`; visual projection classes are written only by `prd.mjs`.

`detail_level: concise` and `detail_level: detailed` share that structure.
Concise compresses explanations and repeated rows; detailed expands all
applicable records. `policy: required` chapters always appear. A
`policy: conditional` chapter appears only when the product has that concern,
the corresponding owner evidence exists, or the user explicitly requests it.

## Visual evidence

Use the template's `prd-visual:*:start/end` regions verbatim. Do not author
parallel copies of function maps, BPMN XML/SVG, page maps, prototype
screenshots, or style previews inside this Bundle.

- `function_scope_map` projects all active functions once as a mind map: product
  root, Epic branches, and function leaves.
- `all_bpmn` projects every active canonical `.bpmn` artifact. Preserve the
  exported SVG's native dimensions and readable labels; a long flow extends
  the document vertically, and a wide one scrolls inside its figure. Do not
  shrink it to a fixed-height thumbnail or stretch a narrow flow to full width.
- `page_map` projects the canonical page map.
- `all_page_prototypes` captures every completed page prototype.
- `design_preview` captures the representative design-style preview when present.
- `all_whiteboards` projects every indexed saved Whiteboard scene through native
  Excalidraw export, preserving its elements, geometry, bindings and source path.
  A Whiteboard explains an idea or relationship; its proposals do not become
  confirmed product decisions by appearing in the PRD.

Resolve these directives from the exact owner states and artifacts in the same
Producer session. The Producer does not redraw them. It supplies the exact files
to `prd.mjs materialize-visuals`, which replaces only the prescribed visual
regions and writes the transformed bytes back to the same canonical HTML path:

- inside `all_bpmn`, place one empty
  `<!-- prd-visual-item:flow_design/P-001.bpmn:start -->` and matching `:end`
  pair inside a matching
  `<section data-prd-entity-ref="flow_design/P-001.bpmn">` immediately after
  the prose describing that exact process; repeat for every active process;
- inside `all_page_prototypes`, place the corresponding empty
  `prd-visual-item:page_design/pages/<page>.html` pair immediately after the
  prose describing that exact page, inside a matching
  `<section data-prd-entity-ref="page_design/pages/<page>.html">`; repeat for
  every completed page;
- inside `all_whiteboards`, place each
  `prd-visual-item:whiteboard/boards/<id>.json` pair after its explanation,
  inside a matching `<section data-prd-entity-ref="whiteboard/boards/<id>.json">`;
- do not collect all descriptions first and all visuals afterward. The Skill
  owns document order and proximity; the script only fills reference pairs.

- function and page maps are deterministic SVG projections of their canonical JSON;
- the PRD page map is a reading projection rather than a copy of editor canvas
  coordinates: it derives a primary navigation hierarchy from canonical
  connections, renders primary routes prominently, and keeps secondary
  cross-links visually subordinate. It does not mutate Page Design state;
- each active BPMN is rendered temporarily during PRD assembly through the
  standard `bpmn-js` viewer/exporter and embedded directly as vector SVG. Do not
  persist a companion `.svg` file and do not redraw BPMN notation by hand;
- each Whiteboard uses its exact `whiteboard/whiteboard.json` index and referenced
  native scene. Native Excalidraw rasterizes the scene with its prepared offline
  fonts into an embedded PNG, preserving the drawing's aspect ratio; the Producer
  never recreates its shapes or takes a screenshot of the Panel. Supply image
  bytes already present in the source scene as exact data URLs. The current
  text-file script input cannot hydrate separate binary attachments: a path-only
  image reference is an operation-specific evidence gap, never permission to
  omit the image, rewrite the source scene, or invent replacement content;
- each completed Page prototype and Design Style preview is rendered temporarily
  from its exact source HTML at 1440px desktop width. Start at 900px height,
  measure the document, then resize the capture viewport to that content height
  before the full-page screenshot. Fixed sidebars and viewport-height elements
  therefore use the capture height rather than the initial 900px. Existing
  collapsed content and independently scrolling regions retain their authored state.
  Its landed `design_style/tokens.css` dependency is injected before rendering.
  For a Page reached by a bound canonical connection with `preview_context`,
  use the first such incoming connection in `connection_order` (then remaining
  saved order). Inject its existing selection through the shared reserved
  `dsh-design-preview-context` JSON block before the Page's own scripts run,
  using the existing flat string-map Page selection contract.
  The caption identifies the existing connection action. Keep one image per
  Page; do not invent a sample, another Page or a default entity. Pages without
  an incoming selection and Style previews keep their ordinary context-free
  behavior. The figure binds the canonical Page input as a dependency, and its
  existing source digest covers owner HTML plus the effective serialized
  context and capture settings, so changing either invalidates an earlier image.
  Local inline JavaScript may initialize the source DOM before capture. Each
  artifact uses a fresh temporary page; network and local-file requests remain
  blocked, with no persistent application storage or backend supplied.
  The resulting PNG is embedded directly in the PRD at full text width with its
  intrinsic aspect ratio and actual PNG dimensions, so long pages extend the
  report vertically. Do not persist a companion screenshot or use an iframe.

Every rendered figure carries its exact project-relative
`data-prd-source-ref`. The operation is idempotent and may read only files
explicitly supplied through `input_files`; the Host reads their exact bytes so
the model never copies or reconstructs file content. It never falls back to a
summary, prompt, model-redrawn image, guessed BPMN layout, browser screenshot,
or Provider runtime. Leave a region empty only when the corresponding owner
state or referenced artifact does not exist. If canonical owner state references
an artifact that is missing, malformed, or cannot be faithfully projected, the
script fails and the Producer reports or repairs the evidence gap before
publication. Git history binds the PRD publication to the source-file versions
used for assembly.

## Evidence markers and bounded writing

Chapter H2 `data-prd-sources` lists only owners actually used from the template's
allowed sources. `data-prd-provenance-ids` references temporary decisions in that
chapter. Preserve grounded facts as grounded content; reconstruction cannot
invent assumptions merely to satisfy a required chapter. Report an unsupported
required representation instead of disguising it as a fact.

Preserve source certainty in both assembly and reconstruction: observations,
inferences, proposals and unresolved conflicts do not become confirmed decisions
because they are saved or quoted. Retain material qualifications beside their
use, including summaries and the decision index. Research's documented scope
cannot prove all-product absence; an activity timeline alone does not prove
immutable full submission history. User requirements remain distinct from these
external comparisons. Authorship/reference metadata is not user approval.

Read each used current owner before asserting it is absent. An owner omitted
from `input_files` is an input gap, not proof of a missing design. Supply the
existing canonical source before changing grounded prose, sources or provenance.
A migration-only request preserves existing facts and source annotations;
stylesheet/input repairs do not authorize new product assumptions.

When `quality_acceptance` supplies a nonempty requirement `verification`, retain
its concrete procedure wording in the acceptance chapter near that criterion.
Existing prose, a list or quotation can carry it; no extra uniform table is
required. Preserve negative cases, repetitions and recovery checks. The script
does not repair source contradictions; make those visible beside the procedure
and leave the source owner's facts unchanged. It
checks the supplied verification text after HTML/whitespace normalization; an
ID/condition/pass summary alone fails that retention check. These instructions
are design evidence, not a receipt that those tests ran or passed.

Saved `ai_agent_capabilities` records are ordinary source evidence for the
applicable existing chapters. In the capability chapter, retain their meaningful
entries/context, actions with conditions and results, adoption/authority
boundaries, resource use, exceptions and recovery. Do not reduce these to a
generic feature summary or lose a condition merely because the same unit is
mentioned in a function. Related chapter annotations use the actual AI owner
when those facts are used, and any prose source index must agree with them.
Reconstruction preserves observed AI behavior and uncertainty rather than
inventing a complete Agent from a product mention. Missing AI evidence is not
permission to infer tools, memory, model access or successful execution.

When revising an existing PRD, retain its still-applicable ledger entries and
markers with their original IDs. Quoting or reorganizing facts or inferences
from other Design Files does not create a new purple marker merely because an
AI authored that source. Ordinary forward assembly records a newly supplied
unsupported product decision according to the Skill Body's completion policy;
reconstruction does not supply such new decisions to fill evidence gaps.

For a PRD-local temporary completion, the `ai_provenance` entry uses
`operation: completion`, `section_ids`, `description`,
source refs and `assumption` with `decision`, `reason`, `impact`, `decision_owner`.
The corresponding HTML uses
`<div class="ai-provenance" data-provenance-id="AI-001">...</div>` around only
that content, with the same ID in the chapter and traceability section.
A direct unchanged quotation may use `prd-verbatim-source` and its exact
`data-prd-source-ref`. Validation checks those claims against supplied files.

One Producer owns the complete document. Start from the shell, then make bounded
edits per chapter or per function/process/page. Resume existing content rather
than writing the whole PRD in one tool call. Preserve the template anchors until
their content is complete; no parallel chapter files or concurrent authors of
the same HTML. Read bounded prose regions, not the embedded images/SVG, and
use file-mode scripts for transforms and final checks.

## File-mode finalization

Keep the document's `<html lang>` aligned with its authored language. The visual
script uses this existing language for fixed map captions, navigation legends
and empty-state labels (`en`/`en-*` use English; existing Chinese/default output
is retained otherwise). It does not translate source business text or follow
the Host UI language. Materialization and validation use the same document language.

Once the prose and provenance are complete, finalize the already-written HTML;
do not rewrite it for finalization. Call `run_skill_script` with
`path: "prd.mjs"`, `args: ["finalize-html-file"]`, and both `input_file` and
`output_file` equal to `web_app_prd_assembly/prd.html`. This existing file-mode
operation materializes the visuals and validates the resulting document before
returning HTML. The Host writes `output_file` only on exit 0; a dependency,
browser, source or document failure therefore leaves the existing file intact.

Pass bounded `input_files`: the actual canonical owner JSON and every referenced
BPMN, completed Page, Design Style preview, Whiteboard scene and required
`design_style/tokens.css`. Include the corresponding indexes:
`flow_design/flow_design.json`, `page_design/page_design.json`,
`design_style/design_style.json` and `whiteboard/whiteboard.json`.
Artifacts alone do not establish their active source records. Inspect the saved
owners before omitting an index; an omitted input does not prove that the
project has no such designs. If an artifact is supplied without its index, add
the missing owner JSON rather than deleting its visual directive.
The same rule applies to nonvisual sources used by the prose, such as
`smart_questions/smart_questions.json`, `research/research.json`,
`business_data/business_data.json`, `business_rules/business_rules.json` and
`quality_acceptance/quality_acceptance.json`. A source is not optional input
merely because it has no embedded figure. Supply its referenced evidence when
needed; never infer project absence from an incomplete script input map.

The product title is `state.title`, declared as `title` in this Bundle's
`schema.yaml`. A diagnostic for this property concerns canonical JSON;
the document's HTML title and headings are separate output content.

Pass `input_context` containing `state` equal to the complete current canonical
PRD object, with candidate `html_file: "web_app_prd_assembly/prd.html"` for
validation (not an object containing only `html_file`). The script reads
`reference/prd-template.html` directly from its own complete Bundle resources;
do not copy that template into `input_context`. Reading it for authoring and
validating against it use the same saved source, not a model-authored copy.
For a new PRD keep the on-disk JSON reference null until this operation returns
exit 0. When updating an existing accepted PRD, retain its `html_file` reference
while editing and finalizing, and after failure or cancellation. Do not reset it
to null as a progress marker: the report must remain accessible during revision.
Only set a new accepted reference after successful finalization; the candidate
reference in validation context does not replace the existing on-disk reference.

The complete distributed Bundle carries its renderer/runtime resources. It uses
an available supported browser through the existing launch/close lifecycle;
it never installs a module, downloads a browser, connects to a user's active
Chrome profile or reads a Provider's private runtime. A missing resource or
browser is reported by this operation. It does not prevent unrelated authoring,
conversation, repair or reading an earlier published PRD.

`materialize-visuals` and `validate-html-file` remain available for focused
diagnosis. Both accept the file-mode inputs above, but their outputs differ:
`materialize-visuals` returns projected HTML; `validate-html-file` returns only
JSON diagnostics. For `validate-html-file`, omit `output_file` entirely. Never
write its diagnostic JSON over `prd.html`. The Host-supplied `script_io` context
identifies an actual output destination; the validator rejects one before writing.
Neither a successful
materialization alone nor ordinary `design_validate` replaces the complete HTML
check. For a presentation-only revision of an already finalized PRD, preserve
the accepted embedded figure bytes and their exact source/projection bindings.
Replace only the document stylesheet from the current Bundle template and run
`validate-html-file` with the complete state and source inputs before normal
publication. Changed sources or projections require finalization again; do not
relabel a changed image as an unchanged accepted projection.
On a diagnostic, preserve landed prose and sources, repair the relevant
input, and retry only with meaningful progress. Never label missing renderer
capability as "no source visuals" or remove directives to obtain a passing check.
If the problem cannot be resolved in this invocation, report an incomplete PRD
with the exact diagnostic; do not set a new accepted reference or publish it as
complete. Existing accepted publications remain available at their Git checkpoint.

After exit 0, set the accepted `html_file`, then run normal `design_validate` and
`design_publish({action:"complete"})`. Schema validity and a nonempty file alone
do not prove visual assembly succeeded. These duties use the existing save and
publication boundary, not another receipt, workflow state or user approval.

A [synthetic reading example](prd-example.html) demonstrates this report's typography. It is illustrative content, not user evidence, a completed
Design task or proof of Agent execution.
