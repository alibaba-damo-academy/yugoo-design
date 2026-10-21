---
name: web_app_prd_assembly
description: |-
  - **Capability**: generate or update one development-ready Web App PRD from current design evidence and user material.
  - **Candidate when**: the user asks to generate, export, update, or inspect a complete PRD.
  - **Do not infer**: PRD assembly is an on-demand delivery action, not a required design gate and not permission to mutate owner Bundles.
  - **Output**: one stable canonical `prd.html`; Git stores history.
---

# Web App PRD Assembly

Produce a product specification, not a summary of design panels or a report
about the assembly process. Product, design, engineering, test, implementation,
and operations must be able to understand the same product behavior without
knowing DSH, Bundle schemas, state revisions, or internal artifact mechanics.

## Execution ownership

The foreground Producer owns the complete logical job:

1. read the template, current canonical PRD, and current evidence;
2. create or target-edit `web_app_prd_assembly/prd.html` and its canonical JSON;
3. materialize visuals through the shared artifact contract's file-mode script call;
4. validate the landed HTML with the same contract's exact source files, state and template inputs;
5. use every returned diagnostic to make the smallest targeted repair;
6. keep the accepted state and artifact bytes in the WorkingCopy;
7. call `design_publish({action:"complete"})` only after the script and normal
   schema/declarative validation pass.

Like every other heavy Bundle, a new PRD keeps `html_file: null` until the
validated document exists in the Producer WorkingCopy. Host execution attempts,
not canonical PRD fields, describe queued, working, failed, or completed work.

The Producer uses the project-scoped `list` and `read` tools to inspect current
evidence, then `write` or `edit` for its owned state and HTML. On a later user
request it locates and reads the affected chapters, then modifies those
chapters, answers, decisions, and temporary-completion ledger in place. It preserves
unaffected content and never starts a new question round merely because an
existing PRD answer needs revision.

Keep reads bounded after visuals have been embedded: use native search and
range reads for the relevant heading or passage, not a full read of the HTML
containing SVG and base64 images. Pass whole files to the existing script by
path when validation or visual projection needs them.

The Producer performs the complete PRD assembly itself and retains validation
and publication authority. It may use read-only evidence tools for independent
source inspection, but does not delegate PRD file authorship.

Core owns path isolation, schema/declarative checks, atomic Design Files writes,
Git publication, and UI refresh. This Bundle's ordinary script deterministically
projects fixed visual artifacts and checks PRD semantics. The Producer owns
evidence selection, invoking that projection, repairs, and the final publication
decision.

## Shared output contract

Read [reference/artifact-contract.md](reference/artifact-contract.md) and its linked template before writing. These define the single HTML shell, visual reference syntax and file-mode finalization shared by normal PRD assembly and reconstruction.

## PRD writing standard

Write a conventional implementation-oriented PRD, not a collection of schema
tables. Prose carries the product reasoning; tables are supporting indexes for
comparison, lookup, matrices, field definitions, and exact rule values. Never
replace a chapter's explanation with one or more tables.

Use a progressive narrative in each applicable chapter: context and user
problem, intended outcome, product behavior, rationale and boundary, important
rules or exceptions, dependencies, and observable acceptance. Explain only
facts supported by the allowed evidence; use the existing temporary-completion
rail when a necessary decision is unsupported.

In particular:

- product definition explains the problem, product judgment, goals, principles,
  and non-goals as a coherent argument;
- user and scope content follows real scenarios and outcomes before summarizing
  segments or release scope in a table;
- capability architecture has one subsection per Epic/module and explains its
  user value, responsibility, boundary, collaboration, main behavior, rules,
  exceptions, priority, and dependencies;
- after the solution overview, every active `F-xxx` has an independently
  readable functional requirement covering its goal and scenario, actor and
  entry/precondition, system behavior, outcome, rules and exceptions, related
  Page/Flow evidence, and unresolved gaps. An Epic summary or one-line function
  table never substitutes for these functional requirements;
- format each functional requirement for scanning: one short prose paragraph
  states user value and the capability boundary; a compact bullet list states
  actor, entry, preconditions, inputs, and outputs; a numbered list states the
  main interaction or processing sequence; and a final bullet list states
  observable states, rules, exceptions, dependencies, related Page/Flow
  evidence, and unresolved gaps. Omit unsupported fields instead of inventing
  them. Do not simulate this structure with a stack of bold-labelled
  paragraphs;
- business information explains object lifecycles and relationships from
  `business_data` before any data dictionary. Distinguish subtype inheritance
  from association, explain both quantity directions in ordinary language,
  and preserve undecided quantities. Do not turn types into sample instances
  or copy inherited fields into a second owner;
- business rules explain why, when, and how controls apply before the rule table;
- integrations, notifications, security, analytics, quality, and operations
  explain runtime behavior, failure handling, and ownership instead of merely
  listing fields;
- acceptance criteria connect to the described behavior and are observable and
  testable; avoid generic claims such as “good experience” or “high performance”.

Do not inflate the document with repeated wording or arbitrary prose. Concise
means shorter reasoning and fewer examples, not removal of the reasoning.
Detailed means implementation-ready elaboration, not a larger table.

## Evidence authority

When function_modules contains optional structured `details`, consume its
purpose, situation, behaviors, inputs, outputs, limits and exceptions as
function-local specifications, not just the card description. Preserve their
meaning in the relevant functional requirement; do not flatten them into an
Epic index or invent missing fields to fill a template. Source `references`
are locations of evidence, not approvals. Read their exact pinned version
when needed, and compare with current owner evidence and later user intent;
an obsolete, unavailable or positional-array source cannot prove a current
decision. Existing shared Flow/Rule/Data/Access owners remain authoritative
for their shared specifications. Do not write back to functions or source
owners merely to assemble the PRD.

Read current owner state from `<skill>/<skill>.json` and artifacts referenced by
it. Use this precedence for every decision:

1. current user instruction;
2. confirmed owner evidence;
3. unconfirmed owner evidence;
4. conservative PRD-local AI completion.

Use only the source owners declared for the chapter in the template. Never
rewrite owner state or copy it into a parallel JSON ledger. Resolve naming
differences into one product vocabulary while preserving the actual semantics.
Do not average contradictory facts: state the adopted decision, reason, impact,
and confirmation owner in the PRD.

Encode sources directly on each chapter H2 as `data-prd-sources`; use
`data-prd-provenance-ids` only for temporary completions in that chapter. List
only sources actually used. Content quoted, summarized, reorganized, rewritten,
or synthesized from existing Design Files is ordinary grounded PRD content and
must not receive a purple rail. A direct, unchanged quotation may additionally
use `prd-verbatim-source` with its exact `data-prd-source-ref`; publication
verifies that quotation against the fixed source text.

## Temporary completions and pending assumptions

Create an `ai_provenance` state item only when the Producer must temporarily
fill an unsupported product decision so the PRD remains structurally complete.
Every item uses `operation: completion`, records its affected `section_ids`, a
concise `description`, the source refs considered, and a non-null `assumption`
with `decision`, `reason`, `impact`, and `decision_owner`. Wrap only that
temporary content in a transparent
`<div class="ai-provenance" data-provenance-id="AI-001">...</div>` purple left
rail. A marker may cover adjacent paragraphs, a list, or a table, but must not
contain grounded content merely because the Producer authored its wording.
Include each pending assumption in the final “决策、待确认与追溯” chapter and
mark repeated rendering with the same provenance ID.

The PRD must remain implementable when design evidence is incomplete. Fill the
smallest necessary semantic gap conservatively instead of blocking merely
because an optional design Bundle has not run. Use an `operation: completion`
item with its required `assumption`, keep its visible product content
inside the provenance rail, and ask for confirmation rather than presenting
the decision as user-approved.

Do not invent customer-specific SLA, laws, commercial terms, real credentials,
endpoint addresses, or irreversible commitments. Leave those as explicit open
questions. Ordinary connective words do not need their own ledger item, but
they must remain inside the marker for the generated passage they connect.

An empty `ai_provenance` array is valid only when every normative product
decision in the document is directly supported by available owner evidence.
The existence of several upstream Bundles does not prove completeness. When
business-data, business-rule, role, integration, notification, or acceptance
evidence is absent, any concrete behavior supplied for that concern is a
temporary completion and must use the purple marker and ledger. Never claim
that all chapters have complete evidence merely because the core Bundles exist.
For the business information, business rules, roles/security, integrations,
notifications, and quality/acceptance chapters, absence of that chapter's
authority Bundle means every concrete passage in the chapter is a temporary
completion. Keep the complete generated passage—not only a disclaimer—inside
declared `ai-provenance` rails. Structural headings may remain outside.

## Visual evidence

Follow the shared artifact contract’s visual directives. Place each process/page description beside its corresponding empty visual-item pair; the script fills that pair from exact owner files, never model-redrawn assets.

## Writing workflow

### 1. Establish the anchor

Only when no document exists, prepare schema version 8 with the product title, requested detail level,
`ai_provenance: []`, and `html_file: null`. Keep this in
the WorkingCopy while assembling the document; do not publish an intermediate
state. First write the template shell to
`web_app_prd_assembly/prd.html`, replacing only its title placeholders. Keep
the stylesheet, headings and visual markers intact. Do this before composing
chapter prose: never generate the complete PRD in one write or edit call.
Read owner states as needed per chapter; independent evidence reads may run
together, but do not preload every visual artifact into model context.
If a document already exists, use the interrupted-generation/revision path
below instead of reseeding the shell or resetting its provenance.

When reading a version 6 or 7 project, drop legacy `status`,
`failure_reason`, and `source_digests`, migrate to version 8, and treat its `html_file` as accepted
only when the referenced document is readable. Normalize the legacy
Bundle-relative `prd.html` value to the project-relative
`web_app_prd_assembly/prd.html` reference. Git publications provide history.

### 2. Work chapter by chapter

For each applicable template chapter:

1. inspect only its declared source owners and referenced artifacts;
2. extract product decisions, not schema telemetry;
3. reconcile terminology and cross-chapter references;
4. allocate an unused provenance ID and persist its assumption in the existing
   `ai_provenance` array before writing an unsupported decision; use that same
   ID in the passage and chapter heading, without marking grounded prose;
5. make one bounded `edit` to `web_app_prd_assembly/prd.html`: an ordinary short
   chapter, one functional requirement or a small related group, or one
   process/page description with its empty visual-item pair. A large chapter
   requires multiple edits, not a larger single output;
6. keep the prescribed outer visual region pair verbatim. Within distributed
   BPMN and Page regions, write the relevant prose and empty per-artifact
   reference pairs in natural reading order; never author figure bytes yourself.

Prefer targeted `edit` operations after the first write. Never restart a
complete document because one chapter, marker, or visual directive fails.
Use the template's unique guidance comment as the insertion anchor. For
multi-part chapters, retain that comment until all required items are written;
insert process/page items immediately before the corresponding existing outer
visual end marker, preserving it for the next insertion. Keep each inserted
HTML block balanced. Remove the chapter guidance only after checking its
coverage, and remove inapplicable conditional chapters rather than filling
them with invented requirements.

Only one Producer writes the PRD. Do not create chapter fragment files,
delegate concurrent edits to this HTML, or introduce a progress ledger.
The existing template anchors and landed content are sufficient.

### Interrupted generation or later revision

Inspect the current canonical JSON and bounded portions of the existing HTML.
Find remaining template guidance/title placeholders and compare the written
functional requirements and process/page sections with the current owner
records. Resume at the first unfinished item using a small edit; preserve
completed prose, IDs, stylesheet and embedded visuals. Do not reset the
provenance array or assume a missing tool result means its write did not land:
check the file before retrying that insertion.

An empty `data-prd-provenance-ids` is valid for grounded content, not an
unfinished-work signal. Reconcile orphan provenance entries and missing rails
left by interruption using the actual passage and existing ledger; do not
allocate a second ID for the same temporary decision. For an existing accepted
document, preserve its reference and edit only the requested content.

If output was truncated, reduce the next edit's scope instead of repeating
the same full chapter/document. Repeated truncation without landed progress
must be reported as incomplete; do not claim success or loop indefinitely.

### 3. Cross-check the product model

Before finalization, verify at least:

- no title placeholder or unfulfilled template guidance remains; required
  chapters and applicable owner entities have actual prose, not just headings;
- users, scenarios, roles, flows, pages, and acceptance use consistent names;
- each capability has an outcome, priority, page or explicit non-UI path;
- each state-changing action has actor/system, trigger, rule, result, and failure behavior;
- object, field, rule, permission, integration, notification, and acceptance references resolve;
- every active flow and completed page prototype has its template visual directive;
- every purple temporary-completion marker matches exactly one non-null pending
  assumption and the correct chapter;
- grounded passages remain normal content and list their actual source owners.

## Post-write Design projection self-check

Before publication, review all chapters in bounded reads against the current
owner evidence, without reading embedded image/SVG bytes into context. Compare the document headings, source
annotations, provenance IDs, pending assumptions, and deterministic visuals
with the pinned owner
evidence. Repair one owned deterministic issue with
at most one focused follow-up, then inspect the refreshed projection once more. Ask the user when a
real product decision is required. If an owner Bundle or referenced artifact is
missing, malformed, or unresolved, report that non-blocking evidence gap
without editing the owner Bundle or retrying indefinitely. After publication
enters Git history, G/R/A owns ongoing cross-Bundle drift checks.

### 4. Finalize inside the same agentic loop

Once prose and provenance are complete, run the shared contract’s file-mode finalization against the already-written HTML. Do not rewrite the document or transport visual bytes through model context.

If the script reports diagnostics, preserve valid content, apply the smallest
useful edit, and run it again. A repeated identical diagnostic with no file or
state progress is a real failure and must be reported; do not launch an
automatic full-document regeneration.

After successful validation, persist that same state with its accepted
`html_file` reference. Then call `design_publish({action:"complete"})` so the already-written state
and HTML publish atomically. In the user-facing summary, report the canonical
path and pending-assumption IDs. The Panel legend and document use the
template-defined transparent light-purple left rail only for unsupported
temporary completions that still need confirmation.
