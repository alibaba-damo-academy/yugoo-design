# Web App content package

This engineering package ships one Kit and 15 independently identified Bundles.
The Kit is `kits/web_app/`: `mindset.md` supplies its method and `kit.yaml`
mounts exact Bundle name/version pairs in order. Bundle-owned methods, schemas,
validators, panel declarations and resources live in `bundles/<name>/`.
`skill.yaml` remains each Bundle's identity and execution contract. The npm
package is a distribution container, not the Kit or Bundle lifecycle authority.

`package.json.designSystem.kit` declares the Kit root, Mindset, mount manifest
and Bundle search root. Load the package root through the generic Kit resolver;
a bare Kit directory needs its exact Bundle resolver supplied separately.
Loading content never installs npm dependencies. Repository-only checks and
preview tools live in `test/` and `scripts/` and are excluded from package files.

## Script dependencies and distribution

| Package | Used by | Purpose |
| --- | --- | --- |
| `bpmn-moddle` ^9.0.1 | `bundles/flow_design/scripts/layout.mjs`, `bpmn-validator.mjs` | BPMN XML parse/serialize |
| `elkjs` ^0.10.0 | `bundles/flow_design/scripts/layout.mjs` | layered graph layout geometry |
| `bpmn-js` ^18.24.0 | `bundles/web_app_prd_assembly/scripts/visual-renderer.mjs` | conditional BPMN snapshots |
| `playwright` ^1.61.1 | `bundles/web_app_prd_assembly/scripts/visual-renderer.mjs` | conditional browser snapshots |

These dependencies belong to this engineering package. Source development uses
the repository's locked dependencies. Copying a bare Bundle does not install its
script dependencies or provide a browser. A distributable Bundle must include
or otherwise explicitly provision its required runtime and license materials;
the loader does not fetch them. Existing dependency diagnostics mention the
legacy “Kit package.json”; that means this engineering package, not `kit.yaml`.
Missing dependencies fail with a non-zero exit rather than fabricated output.

## Delivery context 2: packaged Companion payload

In the packaged payload, Kit files live in `kits/web_app/` and Bundle files
live independently in `bundles/<name>/`. `bundles/flow_design/scripts/layout.mjs` resolves against a
bundled dist (ELK and bpmn-moddle included); the layout entry was verified
self-contained by running it outside the repository with empty `NODE_PATH` and
`NODE_OPTIONS` and no `node_modules` present: exit 0 with BPMN DI injection.
Bundled third-party code retains its license materials in the distribution
package (`licenses/`); see `THIRD_PARTY_NOTICES.md` for the Kit-level inventory.

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

`web_app_prd_assembly` composes `prd.html` from design evidence; only its
**visual snapshot** path dynamically imports `playwright`, resolves the
`bpmn-js` viewer bundle when BPMN snapshots are requested, and requires a real
browser environment. PRD assembly without visual rendering does
not need them. The missing-dependency path of this entry is smoke-tested at
source level with synthetic fixtures (expected to fail with
`ERR_MODULE_NOT_FOUND` naming `playwright`); actual browser rendering with
playwright installed is not covered by that smoke test. Browser binary
availability and OS/sandbox constraints remain environment-specific and are not
verified by this package.

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
- The complete design_skills catalog moves to the end, with identical entries.
  It remains persisted runtime input, not merely a hidden UI representation.
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
- Schema comments and the fixed-card introduction no longer promise automatic
  Core seeding. The executor carries both existing fixed definitions/defaults
  and user-owned answers/details; fixed-card UI protection remains declared in
  `panel.yaml`. This correction does not relax those domain constraints.
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
(from the repository root) runs eight focused tests through the source loader:
legacy/preview schema, malformed entries, unchanged completion, declared
readonly/localized bindings, real Kit resource projection and reconstruction
contract discovery, optional summary separation, and real temporary Files/Git
save/reopen for both new and legacy state. The save checks preserve introductions,
answers, fixed definitions, rejected history, attachment bytes and neighboring
Bundle state, including after first-question deletion; invalid round entries
cannot change the saved bytes, HEAD or settlement count. These are source and
canonical-persistence checks, not installed-package or native-UI parity proof.
