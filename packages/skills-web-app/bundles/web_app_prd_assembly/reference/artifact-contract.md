# PRD output contract

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
- `all_bpmn` projects every active canonical `.bpmn` artifact.
- `page_map` projects the canonical page map.
- `all_page_prototypes` captures every completed page prototype.
- `design_preview` captures the representative design-style preview when present.

Resolve these directives from the exact owner states and artifacts in the same
Producer session. The Producer does not redraw them. It supplies the exact files
to `prd.mjs materialize-visuals`, which replaces only the five prescribed visual
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
- each completed Page prototype and Design Style preview is rendered temporarily
  from its exact source HTML at a 1440×900 desktop viewport.
  Its landed `design_style/tokens.css` dependency is injected before rendering;
  the resulting PNG is embedded directly in the PRD at full text width and a
  16:10 aspect ratio. Do not persist a companion screenshot or use an iframe.

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

Once the prose and provenance are complete, process the already-written HTML;
do not rewrite it for finalization. First call `run_skill_script` with
`path: "prd.mjs"`, `args: ["materialize-visuals"]`, and both `input_file` and
`output_file` equal to `web_app_prd_assembly/prd.html`. Pass bounded
`input_files`: every relevant canonical owner JSON plus every BPMN/Page/Design
Style artifact referenced by those states,
including `design_style/tokens.css` when a Page prototype or style preview uses
the shared Design System tokens.
The successful transform writes only the canonical HTML and returns a compact
file receipt, so source HTML and generated document bytes do not pass through
the model response.

Then call `run_skill_script` with `args: ["validate-html-file"]` and the same
`input_file` and the same `input_files`. Pass `input_context` containing the
current `state` with `html_file: web_app_prd_assembly/prd.html` for this
validation, and `template` equal to the exact template text. For a new document, keep the on-disk
JSON reference null until this check succeeds. The script verifies source availability, complete
visual coverage and source binding, iframe confinement, temporary-completion
authority, and verbatim claims. It returns only validity and diagnostics; the
complete HTML never returns through the model tool result.


On diagnostics, repair the existing document in bounded edits and repeat the file checks. Set the accepted `html_file` only after validation, then run normal `design_validate` and `design_publish({action:"complete"})`. Never return a full document or embedded image bytes through model arguments.
