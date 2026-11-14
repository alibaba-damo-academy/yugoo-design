# Web App content package

This engineering package ships one Kit and 15 independently identified Bundles.
The Kit is `kits/web_app/`: `mindset.md` supplies its method and `kit.yaml`
mounts exact Bundle name/version pairs in order. Bundle-owned methods, schemas,
validators, panel declarations and resources live in `bundles/<name>/`.
`skill.yaml` remains each Bundle's identity and execution contract. The npm
package is a distribution container, not the Kit or Bundle lifecycle authority.

`package.json.designSystem.kit` declares the built `lib/kits/web_app/` root,
Mindset, mount manifest and `lib/bundles/` search root. `node build.mjs` copies
the complete authoring trees and builds the three Flow CLI entries into `lib/`.
The npm files list selects this complete output; methods, schemas, examples and
other resources stay inside their owning Kit or Bundle. Load the package root through the generic Kit resolver;
a bare Kit directory needs its exact Bundle resolver supplied separately.
Loading content never installs npm dependencies. Repository-only checks and
preview tools live in `test/` and `scripts/` and are excluded from package files.

## Record IDs

For new independent design records, prefer short business numbers such as
`F-001` and `F-002`. This is a suggestion for generated content.
Apply this numbering to independent design records people name and reference,
not every stored key or heading. Reading groups, fields, configuration keys and
technical identifiers are not business numbers.
The readable name remains primary; the business number identifies that same
canonical record rather than becoming part of its title.

Ordinary edits preserve existing IDs and references. When the user explicitly
requests short business numbers for older records, revise their actual keys/IDs
and current references/orders together through the existing Bundle owners.
Where IDs determine artifact paths or prototype references, keep those current
paths and references consistent in the same authorized revision. Derived
assemblies consume the revised sources through their existing owner.
Do not add a second display identity or rewrite technical IDs and history.

| Records | Prefix |
| --- | --- |
| Functions; processes; Flow step supplements | `F`; `P`; `N` |
| Pages; connections | `PG`; `PC` |
| Business objects; object relations; business rules | `BO`; `REL`; `BR` |
| Roles; access policies; role inheritances | `ROLE`; `AP`; `RI` |
| Integrations; notifications; acceptance records | `INT`; `NT`; `AC` |
| Research rounds; directions | `R`; `D` |
| Free questions | `Q` |
| Boards | `WB` |
| Agents; Skills; Tools; model sources; knowledge resources | `A`; `S`; `T`; `M`; `K` |

These are authoring conventions in each Bundle's existing output contract, not
a format validator or numbering service. Fixed question keys, field/enum values,
numeric question rounds, Style semantic keys, canvas-section scene keys (including
existing `PS` keys), derived groups, source references and native canvas/DOM/BPMN
IDs retain their own meaning. PRD assembly references existing records rather
than creating a second identity. Each owner changes only its authorized Bundle content.

## Report document presentation

Research conclusions and assembled PRDs share a reading scale: one document
heading at 20px/1.4, section headings at 16px/1.5, body and subordinate headings
at 14px/1.65, and auxiliary text at 12px or larger. Major sections begin after
24px, subsections after 16px, and related content uses 8–12px spacing. Narrow
views reduce the outer gutter and keep tables reachable by scrolling. Hierarchy
comes from structure and weight rather than hero headings and large empty bands.

The Research conclusion shell and PRD template are their Bundle-reachable
resources; each retains its own evidence organization and semantics. This is a
report presentation standard, not a theme for generated application prototypes.
The shared Panel continues to confine authored HTML in its existing sandbox;
it does not inject tool typography into user artifacts or translate their content.

## Script dependencies and distribution

| Package | Used by | Purpose |
| --- | --- | --- |
| `bpmn-moddle` ^9.0.1 | `bundles/flow_design/scripts/layout.mjs`, `layout-metrics.mjs`, `layout-search.mjs` | BPMN XML parse/serialize |
| `elkjs` ^0.10.0 | `bundles/flow_design/scripts/layout.mjs` | layered graph layout geometry |
| `bpmn-js` ^18.24.0 | `bundles/web_app_prd_assembly/scripts/visual-renderer.mjs` | conditional BPMN snapshots |
| `playwright` ^1.61.1 | `bundles/web_app_prd_assembly/scripts/visual-renderer.mjs` | conditional browser snapshots |

These dependencies belong to this engineering package. Source development uses
the repository's locked dependencies. Distribution builds include the Flow
CLI dependency closure, so a complete distributed Flow Bundle can be copied
into a project and run without `node_modules`, `NODE_PATH` or an install step.
The structure/final validator already uses only Node built-ins and is copied
unchanged. A raw source Bundle still needs the repository's development
dependencies; loading content never installs them.

The PRD build also reuses the Panel package's pinned Excalidraw inputs and font
transformations. Its browser-only export entry is a build input, not an additional
user-side npm dependency or a directly runnable Node script. The built Bundle
carries the resulting export resource, viewer, Playwright production runtime,
original license materials and their output correspondence. It includes no
browser executable or installer. Complete resources remain subject to the same
64 MiB per-Bundle loading budget used by every Kit.

The npm content package and both Companion packaging routes reuse the same
three independent Node 22 ESM entries: layout, metrics and search. Search keeps
its explicit sibling metrics import to preserve both CLI entry guards. Matching
original licenses, notices and existing ELK source-availability materials live
inside `flow_design/licenses/`; project LICENSE, NOTICE and inventory texts also
remain at the Flow root, so copying the complete Bundle retains them.
`flow-build.json` records the actual observed build inputs and original-material
identities; it does not claim a complete nested-prebundle inventory or license
acceptance. The existing normal-build module observations bind output bytes and
source inputs for DSH release preparation.

`node --test test/portable-distribution.mjs` builds and packs the content package,
extracts its full Flow Bundle outside the repository, and exercises layout,
metrics, search and structure/final validation with no ancestor `node_modules`.

## flow_design layout contract (verified)

- `node bundles/flow_design/scripts/layout.mjs < input.bpmn > output.bpmn`
  reads structure-only BPMN XML from **stdin** and writes laid-out BPMN
  (`BPMNDiagram`/`BPMNShape`/`BPMNEdge` DI) to **stdout**. With `--validate` it
  only runs the authoritative bpmn-moddle import and exits on success.
- Errors go to stderr with a non-zero exit code; the script never publishes
  unvalidated fallback geometry. Runtime depends on graph size and search work;
  there is no fixed time bound. Waiting on stdin is expected behavior when no
  input is piped.
- Validator entry: `node bundles/flow_design/scripts/bpmn-validator.mjs
  validate-bpmn-file < input.txt` (and `validate-final-bpmn-file`); stdin contains
  a JSON context on the first line followed by BPMN XML, not a positional file
  path. Invoked without
  arguments it prints usage and exits non-zero.

## PRD visual rendering (conditional limits)

`web_app_prd_assembly` composes `prd.html` from saved owner evidence. The complete
built Bundle carries its renderer/runtime resources so project copies do not
resolve engines through a development checkout or `NODE_PATH`. BPMN uses the
shared presentation resource; Whiteboards use native Excalidraw export with
prepared offline fonts and become PNG images with their source geometry and
aspect ratio. No model redraw or Panel screenshot replaces an owner artifact.

The `finalize-html-file` operation projects visuals and validates the resulting
HTML before the existing exit-0 file write. It reads its own saved template
resource directly; callers do not serialize a second template through model
context or choose a different validation baseline. Missing renderer resources, source
image bytes or a supported browser fail that operation with a diagnostic;
ordinary schema validation does not replace it. Pure format validation does not
require a browser. Browser work uses its own normal launch/close lifecycle,
never an install/download step or the user's active Chrome profile. Availability
of a browser remains an operation-specific environment requirement. If the
Playwright Chromium executable is absent, the renderer tries installed Chrome,
then installed Microsoft Edge through their supported channels. Only a missing
executable permits this fallback; other launch failures are reported immediately.

Embedded BPMN keeps its native scale so long flows remain readable; document
scrolling and figure-local horizontal scrolling expose the complete diagram.
A presentation-only stylesheet revision reuses accepted, byte-unchanged
projections and validates the complete document against current sources.
Read-only `validate-html-file` returns JSON diagnostics and must not use the
script tool's `output_file`; that destination is for HTML-producing operations.

Source missing-dependency tests retain their real negative cases. Format checks,
synthetic transport checks, real browser rendering, project-copy execution and
installed-host validation are separate evidence boundaries; one does not stand
in for the others.

## Boundaries

### Reviewed Function detail update

Retention mapping for the user-authorized detail simplification:

- `SKILL.md` outcome/journey/granularity/priority/complete-scope methods remain in
  place. The former local purpose and situation share one `details.situation`
  usage scenario; both original texts survive explicit old-state conversion.
- Proposal basis remains in `reason` (displayed as Notes), alongside rationale,
  tradeoffs and supplementary/unresolved context. Behaviors, inputs, outcomes,
  boundaries and exceptions retain their own stable-key maps and methods.
- Output-contract reconstruction judgment, ownership, validate/repair/publish,
  rejection, evidence and handoff instructions remain reachable and unchanged.
  The local scenario/notes meanings are updated in both method and contract.
- Source file/revision/pointer and IDs are retained; only the local purpose
  subject locator moves to the combined scenario during explicit conversion.
  The conversion is Bundle-owned and never runs merely from viewing a Panel.
- Kit and Bundle manifest versions remain 1.0 during internal pre-release
  development, as requested. Existing project data and historical snapshots are
  not rewritten. Native-reference implementations are
  retained; this change targets the official declarative Panel, not old renderers.

The 1.0 decision above records the internal Function detail update. Flow and
Kit version metadata is upstream provenance. Each project owns its complete
saved definitions; a plugin update does not replace those files. An Agent may
compare and revise an explicitly selected project copy through the existing
editing and validation path, preserving user content without a version gate.

Verification is reported separately for conversion/validation, rendered edits,
durable save/reopen and native-model consumption; these claims are not implied
by this mapping. Fixed optional inputs are a view choice, not schema requiredness.

### Reviewed Mindset adoption (2026-10-08)

The reviewed Studio content is adopted selectively, not as a directory overwrite.
The withdrawn method-cleanup candidate is excluded; all Bundle SKILL.md methods,
schemas, panels, execution policies and summary declarations are retained.

Retention mapping for the Mindset reorganization:

- Role/boundary and response calibration remain in sections 1–2; candidate
  selection and revision ownership become sections 3–4 without removing rules.
- The complete experience guidance moves from the opening to section 5.
- Case strategies and enterprise calibration move to sections 6–7; reconstruction
  and source-evidence review remain complete in section 8.
- The ordered `design_skills` headings remain at the end as the runtime
  membership list, matching `kit.yaml`. Capability descriptions come from each
  mounted Bundle's `SKILL.md` frontmatter rather than repeating them in Mindset.
  The professional guidance in sections 1–8 remains complete.
- Those descriptions retain the same-source AI graph and Host boundary, Plugin
  URL/Secret requirements/Prompt and recovery, observable acceptance scenarios
  and grounded measurable quality targets, and shared whiteboard scene files.
  Existing applicability and negative routing conditions remain intact.
- The AI Bundle's current independent Agent/resource records and same-source
  graph supersede the old catalog's grouped-card and supporting-harness wording.
  Its existing method does not require manual functional groups or SDK selection.
  Saving a design does not execute its tools or reconfigure the coding host;
  no new behavior or field is introduced.
- A purpose introduction and AI-capability candidate row clarify existing scope.
- “Producers own product design choices” becomes “selected Bundle executor” to
  include the existing main execution mode (architecture baseline, Execution).
- The old required “Close-out and score update” heading is superseded by the
  existing shared-runtime assessment contract (architecture baseline, Foreground
  design loop; design-core-prompt.ts completion guidance). Domain completion
  evidence remains required; no Bundle scoring or acceptance method is removed.

This source adoption does not replace retained content in existing projects or
change their exact version pins. Fresh-content Studio checks must use isolated
storage; old snapshots must not be overwritten to force a refresh.

- This README is documentation only: it does not add install automation, a
  generic dependency resolver, or new runtime behavior.
- Verification statements above describe the flow-design layout entry and the
  PRD renderer's declared conditional requirements; they are not a claim that
  every Kit script was exercised, nor a host-compatibility matrix.

### Smart Questions independent round introductions

Retention mapping for the user-authorized round title/description separation:

- `smart_questions/SKILL.md` product-background ownership, evidence-first
  elicitation, coherent decisions, reversible proposals, revisit rules and
  situation-expression methods remain in place. Each question's full `prompt`
  is retained; a round introduction does not replace the question or its context.
- `reference/artifact-contract.md` retains the shared 5W1H lenses,
  reconstruction judgments, unknown/inferred/confirmed distinction, fixed
  definitions, answer/detail semantics, rejection and atomic attachment rules.
  Both ordinary design and reconstruction still reach this installed resource.
- The prior top-level `questions`-only example and prohibition on planning
  metadata now explicitly allow optional `rounds` solely for round display copy,
  as authorized. Hidden queues, strategies and duplicate response flags remain
  prohibited; missing legacy metadata is not synthesized from a question.
- The old “receive the next round automatically” statement is superseded by
  executor-owned explicit round assignment: no current declarative write hook
  was found to provide the claimed allocation. Preserve saved round values and
  histories; no new write hook, migration or questionnaire lifecycle is added.
- Schema comments and the question contract do not promise automatic Core
  seeding. New initial background panels use neutral App basics questions with
  evidence-backed or empty answers. The former login/storage defaults remain
  readable existing settings: preserve their IDs, meanings and user content,
  without automatically replacing them or changing a project's Kit copy.
  Grouping and question protection remain declared in `panel.yaml`.
- Round titles/descriptions are canonical display context, not answers, user
  confirmation or execution status. New rounds require meaningful nonempty
  text in the method; schema requires both string keys on present entries.
  No title-length gate or mandatory legacy backfill is introduced.
- The synthetic preview moves its whole-round explanation to `rounds.0` and
  keeps concrete questions and fixed-card definitions. The optional summary
  retains question prompt/answer/detail/rejected and separately projects rounds.

This is a Bundle content change, coordinated with the shared DSL/loader and
question-workspace implementation owned by the integrating maintainer. The
`rounds_source` declaration requires that shared renderer support; retaining a
property in the source loader alone does not prove the UI consumes it. Focused
schema, resource, summary and canonical-save checks do not establish rendered
round introductions, installed-host loading or real Agent generation.
`node --test packages/core/test/smart-question-rounds-content.test.mjs`
(from the repository root) runs focused checks through the source loader:
legacy/preview schema, malformed entries, unchanged completion, declared
readonly/localized bindings, real Kit resource projection and reconstruction
contract discovery, optional summary separation, and real temporary Files/Git
save/reopen for both new and legacy state. The save checks preserve introductions,
answers, fixed definitions, rejected history, attachment bytes and neighboring
Bundle state, including after first-question deletion; invalid round entries
cannot change the saved bytes, HEAD or settlement count. These are source and
canonical-persistence checks, not installed-package or native-UI parity proof.
