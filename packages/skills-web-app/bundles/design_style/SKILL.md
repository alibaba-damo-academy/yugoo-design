---
name: design_style
description: |-
  - **Capability**: visual direction for a web/mobile product — palette, typography, component language, and one representative UI preview.
  - **Resolves**: S/T gaps in visual hierarchy, component language, and reviewable interface direction; visible feedback may also add U evidence.
  - **Candidate when**: the user explicitly asks for visual direction, one representative screen is the smallest useful way to settle a material product decision, or the user has explicitly requested high-fidelity pages and the project has no visual baseline.
  - **Do not infer**: website, page, or app alone does not make visual work mandatory; an explicit high-fidelity Page request is an output dependency rather than keyword inference.
  - **Output**: `design_style` panel, generated `DESIGN.md`, generated `tokens.css`, and one representative HTML preview.
---

# Visual Style

Create a product-specific visual system and prove it on one representative
screen. This is a design artifact; it is not a substitute for implementing every function.

This Bundle is the project's live visual-language control center, not a
one-time upstream stage. Every invocation is a focused revision of the same
persisted facet. Preserve settled decisions and update only the visual
language the user changed or a concrete Page Design gap requires. It owns
presentation grammar: semantic hierarchy roles, typography and token scales,
shell treatment, reusable component patterns and states, the selected icon
library and semantic icon mapping, and the exact brand assets. It does not
decide which product Pages exist or which business content belongs on them.

When the main Agent invokes this Bundle to satisfy an explicit Page Design request that has no active visual result, create a complete product-appropriate baseline from current Design evidence and sound defaults. Publish the ordinary Design Style artifacts and panel, and describe the baseline as adjustable. Do not emit a generic wireframe theme, ask the user to choose among arbitrary aesthetics before making progress, or claim user approval without evidence. The main Agent may then continue the already requested Page Design work in the same attached turn.



## Ownership and tools

`design_style/design_style.json` is the only canonical state. The Producer first
uses the project-scoped `list` and `read` tools to inspect that state, its owned
artifacts, and relevant upstream evidence. It uses `write` or `edit` to maintain
the complete state and representative self-contained HTML preview in its owned
working copy. Before publication it calls the bundled `design-style.mjs`
file-mode operations. The script processes project files directly and either
validates the preview or generates:

- `design_style/DESIGN.md` — semantic handoff for people and coding agents;
- `design_style/tokens.css` — executable `--ds-*` token projection.

Both projections are generated files. Users edit the structured design controls
(colors, typography, density, components, intent); the Producer reruns the
Bundle script and the Host writes both outputs directly. Never create a competing token
source. Once a preview exists, the terminal publication keeps the complete state
and existing or repaired HTML together in the Producer working copy. The
pre-preview plan remains an ordinary visible filesystem state, not a commit.
The Producer completes the visual work itself. Use `read_skill_resource` for
this Bundle's reference files.

## Existing design

The saved state is authoritative. On later requests, read the current state and
owned preview/projections before editing, then decide whether the request needs
a targeted edit or a genuinely necessary regeneration. Preserve explicit brand
constraints, unaffected valid decisions, direct artifact references, and
unchanged preview content. Change only the requested tokens, rationale,
preview, or assets. Regenerate the complete preview only when the requested
change invalidates its overall hierarchy or visual language. The working copy must
retain the complete state and owned artifact set even when `edit` changes only
one local region.

When `page_design` exists, inspect it as current usage evidence so the visual
system covers real interface needs without copying its Page map. A concrete
gap handed back by the main Agent is a focused Style revision: define or refine
only the missing hierarchy role, component pattern, state, icon mapping, or
brand asset. Never take ownership of Page HTML and never launch Page Design
from this Producer. The main Agent may let the user review the Style revision
and then invoke a fresh Page Design Producer for affected Pages.

For a legacy project whose preview record still contains inline `html`, treat
those bytes as migration input only. If its referenced preview file is missing,
write the inline bytes to the stable `design_style/preview_<name>.html` path;
then remove the inline field before validation. Never publish both forms.

The persisted visual result is the current design, not a draft awaiting promotion.
User approval alone does not require a confirmation-only rewrite. Revise the
design when actual changes are requested; validity does not imply user approval.
When revising legacy state, remove the obsolete `config.is_confirmed` marker
while preserving the design and unrelated fields. Do not rerun only to remove it.

## Grounding

Use supplied `<design_context>` before inventing content. Relevant evidence
includes answered structured questions, function modules, key business/user flows,
research conclusions, roles, constraints, and confirmed visual decisions. Read
a full artifact only when omitted detail would change the representative screen.

### Mandatory cross-design alignment check

Treat active function modules and confirmed flows as product constraints. Preserve the
relevant actor, action, state, decision, and outcome. If artifacts conflict,
surface the concrete conflict; do not hide it behind attractive UI. A preview
must contain recognizable product language and behavior, but need not cover all
modules. This is grounding, not coverage. Never invent a generic dashboard, landing page, or content hierarchy that contradicts the existing design.
Do not default to a dashboard.

## Progressive visual knowledge

Read [reference/artifact-contract.md](reference/artifact-contract.md) before maintaining state, projections or preview HTML. It is the shared output and script contract.

The shared output/CLI contract lives in the reference above; forward-design
choices remain here. Load visual domain knowledge progressively:

| Resource | Load rule |
| --- | --- |
| `reference/aesthetic_index.yaml` | Read once after forming the physical scenario; choose before reading direction detail. |
| `reference/aesthetics/<id>/DESIGN.md` | Read exactly one selected seed. It is the seed's semantic and token source. |
| `reference/aesthetics/<id>/tokens.css` | Deterministic compiled sibling. Usually do not read; inspect only to diagnose CSS reproduction. |
| `reference/quality_rubric.md` | Read once before materializing a new preview or making a substantial redesign. |
| `reference/post_check.md` | Read after the preview exists, immediately before rendered review. |
| `reference/motion.md` | Read only when motion intensity is at least 7 or choreography is material. |
| `assets/icons/_index.md` | Read only when the preview needs bundled icons. |

Never combine multiple seeds in one proposal. An explicit brand/reference may
justify a bespoke direction without a seed.

## Execution

### 1. Reason before selecting an aesthetic

Privately form one physical-scenario sentence: who uses the product, where and
when, on what form factor, for how long, and with what attention pattern. This
is a reasoning input, not an aesthetic property: do **not** put it in a seed,
`DESIGN.md`, `tokens.css`, or canonical state unless the scenario itself is a
confirmed product requirement worth recording elsewhere.

Then identify the category's reflexive generic answer and reject it when it
does not fit. Set design variance, motion intensity, and visual density from
`0..10` with a short product-specific reason. Read the compact aesthetic index,
select one direction, and only then read its `DESIGN.md`. Choose the single
screen where the product's distinctive interaction is clearest.

### 2. Build and save the complete anchor

Build the complete anchor using the installed schema and [shared artifact contract](reference/artifact-contract.md), then generate its projections and author the preview through that contract.

### 3. Materialize the preview

Read `reference/quality_rubric.md`, then prepare one compact, complete responsive
HTML5 document at `design_style/preview_<name>.html`. Target 8–12 KB and never
exceed 16 KB. It must prove the product's distinctive hierarchy and primary
interaction in one representative viewport; compact does not mean a generic
sidebar, toolbar, stock table, or empty shell. Do not block the first useful
preview on image search, image generation, animation polish, secondary
sections, or exhaustive copy.

Keep the complete canonical state, referenced HTML path, and complete HTML
together in the current working copy. Publication atomically settles the state,
preview, `DESIGN.md`, and `tokens.css`; do not side-write a competing artifact
outside the project-scoped tools. When a later review finds a material defect,
use `edit` for the affected state or HTML region and preserve all unrelated
content. For a state-only repair, read and retain the existing complete HTML
unchanged.

- Follow the stylesheet, token and local-dependency requirements in the shared artifact contract.
- UI icons must be inline SVGs copied from the bundled `assets/icons/` catalog
  after reading `assets/icons/_index.md`. Never use emoji, bitmap images, icon
  fonts, or remote icon libraries as interface icons.
- Use vanilla JS only when interaction demonstrates a material design decision;
  keep it small and inline: no large datasets, SVG path libraries, or duplicated
  markup.
- Add images only when they are real decision inputs. Persist exact local paths
  and meaningful alt text in `config.images`; a deliberate CSS/SVG placeholder
  is better than a broken or irrelevant image.
Use only the documented `--ds-*` names emitted by the deterministic token
projection; never infer additional aliases from state field names. If the
compact page already passes the post-check, stop without optional changes.
The foreground Producer authors and repairs this compact visual system directly.
Use only the always-emitted token catalog; validator feedback never justifies
switching to another guessed naming convention.

### 4. Render, validate, repair, and close

Read `reference/post_check.md`, then use `read` on the working-copy preview HTML,
and inspect product specificity, hierarchy, spacing, color, typography,
responsiveness, interaction states, and material imagery. Make targeted
corrections for observed defects and re-render when the visible result changed.
If rendering is unavailable, inspect the HTML and report that visual review was
blocked.

Before preview authoring, write the valid canonical visual-system JSON whose
preview identity is present but whose `html_file` remains null, then generate
both projections through the file-mode operations above. File polling
immediately shows the selected direction and tokens; continue in the same
foreground Producer to author and inspect the preview, then set the direct ref
only after the validated HTML exists in the WorkingCopy. Do not call
`design_publish` for this intermediate filesystem state.
Run the shared contract’s landed-file token and preview checks, repair their diagnostics, then validate and publish the complete artifact set. Return a short summary of persisted output and material fixes.

Treat `DESIGN.md`, `tokens.css`, and preview HTML refs in canonical config as
the complete Design Style artifact set. When the design changes, explicitly
remove obsolete preview files from the WorkingCopy before the same publication;
do not keep obsolete previews for compatibility.

## Failure discipline

- A validator diagnostic names the repair target; fix it instead of guessing a
  second contract or restarting valid work.
- Validation and completion feedback stays with the Producer. Preserve
  valid decisions; never turn an artifact defect into a complete restart.
- Image failure keeps a deliberate placeholder; it does not restart design.
- Do not reread resources or loop review without new evidence.

## Close-out and U/S/T

Close only after state, both generated projections, and a usable representative
preview exist. A coherent system and preview normally add S/T evidence. Add U
only when visible feedback actually settles scope or intent; never award a
fixed increment merely because this skill ran. Typical confirmed work adds S
`+10..+15`, T `+10..+20`; early visual elicitation may add U `+10..+20`.
After the state, projections, and preview are persisted, report the evidence they add to U/S/T and any material uncertainty that remains.

## Attribution

Sources are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
That file is attribution, not runtime guidance.
