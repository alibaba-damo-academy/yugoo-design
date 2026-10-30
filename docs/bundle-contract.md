# Declarative Design Bundle contract

## Typed sample tables

Typed sample tables use the shared `data_table: <field>` validation leaf, usually within `for_each_in_map`. The field declares the closed `columns` / `rows` shape in its Bundle schema; Core checks stable identities and typed cell values, and the existing Panel save path applies the same state rule. Empty draft fields remain optional unless the schema says otherwise. See [Data Table in the DSL](dsl-spec.md#可编辑数据表data-table) for the editor and data contract.

This document defines the zero-code declarative Bundle profile. The common Bundle responsibilities and the separate native profile are owned by the [Design System architecture baseline](system-design-baseline.md).

The governing ownership rule is: **Bundle-specific instructions, schemas, validation declarations, and presentation references belong to the Bundle; generic Core, Panel, and Studio code do not enumerate Bundle names.** Adding a declarative Bundle means adding content, while compiled native behavior remains in a separately installed trusted provider and is bound to the Bundle through stable contribution ids.

## Fixed slots of a declarative Bundle

Each required file answers exactly one question. Conditional presentation,
execution, and artifact contributions follow the profiles in the architecture
baseline.

| File | The question it answers | Required? |
|---|---|---|
| `skill.yaml` | Who am I, how do I run, when do I hand back to the user; start from the [manifest template](../.agents/skills/design-bundle-creator/assets/skill.template.yaml) | ✅ |
| `SKILL.md` | The Bundle executor's operating manual (main Agent or independent Producer; workflow, data rules, close-out discipline) | ✅ |
| `schema.yaml` | What my persisted state looks like (declarative translation of the Pydantic State; collection-level invariants live in `validation.yaml`) | ✅ |
| `validation.yaml` | How editable working copies, optional Worker artifacts, and prepared publications pass semantic validation | ✅ |
| `panel.yaml` | State → frontend panel, rendered by the panel DSL interpreter | Required for declarative presentation |
| `skill.yaml.summary` | Optional state → model-context summary rules (`fields` / `collections`); not a separate file | Optional for declarative presentation |

This profile keeps state, validation, panel, and model-summary definitions declarative. `schema.yaml` and `validation.yaml` are compiled into validation behavior; `panel.yaml` is required for declarative presentation. Summary omission emits no declarative summary and never disables the Panel, execution, validation or publication. Agents can read original Design Files when context is needed.

### Isolated Studio preview sample

Every Bundle must ship representative example data as an authoring and maintenance
requirement. For declarative Bundles, provide `reference/preview.json`: a small,
nonempty JSON object matching the state schema, so authors can open its Panel in
Studio without constructing JSON. Native or non-visual profiles retain examples
appropriate to their existing renderer/output contract; this does not require a
placeholder declarative Panel for those profiles.

On creation and update, maintain examples with the methods, schema, validation,
Panel bindings and language resources. Reuse a coherent domain fixture; examples
shared with readable output contracts must stay consistent. Exercise meaningful
records and the principal interaction, including relevant relationships or value
states. An empty object that passes the schema is not a representative example.
Validate with the actual loader/schema, then inspect affected rendering and
interactions in Studio. Pure method edits still require checking example meaning;
they do not require rerunning unrelated UI suites.

Examples are synthetic or explicitly identified demonstrations, not runtime
initialization, user answers or generated Design Files. Keep Studio sample JSON
within 256 KiB; include no secrets or dependency on a real project. The current
Studio sample preview receives only the selected Bundle's state and cannot load
other Bundles' records or real project artifact files. An explicit bounded
`reference/preview-artifacts.json` may register synthetic HTML/SVG resources from
the same captured Bundle definition, as described below; it never grants project
access. Record those limits and verify dependent
views through the existing isolated project/Panel path; do not claim that a JSON
sample proves a report, cross-Bundle selector, save/reopen or model run works.

Installed previews select explicit isolated input first, then this file, then
the existing `initial_values` if no preview file exists. Invalid sample data
reports a diagnostic; it must not silently fall back. Preview uses the existing
schema/compiler and runtime interpreter, without writing a project, creating a
draft, invoking a model or executing validation drivers. This convention adds no
required manifest field or loader rejection for older content, and never changes
the Bundle's execution behavior. This delivery requirement supersedes the former
optional authoring guidance; runtime compatibility remains unchanged.

### Validation versus design review

A hard validation rule needs an explicit consumer or invariant: schema shape,
file availability/confinement, resolvable references, unambiguous frontend
bindings, or an owned shared namespace. The rule must explain a concrete failure,
not estimate design quality from an incidental implementation choice.

Do not use document length, CSS layout counts, token quotas, fixed token-category
coverage, version-number regexes or serialized SVG equality as quality gates.
The author reviews content fidelity, visual consistency and usability against
the actual brief and evidence. A passing validator means its mechanical checks
passed; it does not establish that the design is complete, faithful or attractive.
Report that review and any unresolved gaps separately, without adding another
score, approval state or execution mechanism.

Page Design implements this boundary in its existing file validator: it retains
the prototype integration markers and reference checks, but does not mandate
audit-only navigation wrappers or SVG serialization. Its Skill Body still asks
the author to reuse the current Style assets and review shared navigation.
Other Bundles should use this boundary when their validation is revised; this
does not claim that all existing Bundle scripts have already been audited.

### Cooperation method resources

When a Bundle needs related design facts aligned or supplemented, use the
conditional `reference/cooperation-guide.md` content location. Follow the
[cooperation authoring convention](../.agents/skills/design-bundle-creator/references/cooperation-authoring.md)
for real fact owners, relevant evidence, missing/conflicting facts, bounded caller
handoffs and checking actual target state. Link it from both `SKILL.md` and
`reference/artifact-contract.md` for ordinary and reconstruction entry reachability.
Populate only genuine domain needs; no placeholder, fixed chapters or sequence of
every neighboring Bundle is required. This is an authoring convention, not a new
mandatory loader slot, schema/DSL field or automatic coordinator. Current-Bundle
write scope remains unchanged; the caller invokes target owners only under the
existing authorization, settlement, validation/publication and human-handoff rules.

### Choose a visual expression before binding fields

#### Canvas method resources

Bundles with a canvas use `reference/canvas-guide.md` as the common authoring
entry for their domain-specific generation methods. Follow the
[canvas authoring convention](../.agents/skills/design-bundle-creator/references/canvas-authoring.md)
for ownership, evidence, representation, generation/revision, layout responsibility,
uncertainty, interaction/save boundaries and verification. These are coverage
questions, not a fixed graphic, chapter template or new persisted state.
Different Bundles can use relationship graphs, BPMN, navigation maps, mind maps
or free drawing; shared UI controls do not make those languages interchangeable.

Link this resource from both `SKILL.md` and `reference/artifact-contract.md` so
ordinary design and explicit reconstruction can reach it. Preserve existing
specialist guides and scripts and index them from this entry, rather than copy
or trim their methods. Non-canvas Bundles need no placeholder. This is an
authoring convention using existing resources, not a new fixed loader slot,
manifest field, DSL capability or permission to execute scripts.

#### Expression and binding

Use the [Panel UIUX standard](panel-uiux-standard.md) for shared visual,
editing, feedback and review rules. It distinguishes default guidance from
confirmed scene-specific baselines without adding DSL properties or write rights.

Start with the user's question, not a component name. Use grouped cards to
compare independent capabilities; a relationship graph to explain named
associations or dependencies; a flow to explain sequence, decisions and actors;
a matrix to compare several objects along the same dimensions; and a form to
read or edit the selected object's precise attributes. These are expression
choices, not a promise that every matrix or flow operation is implemented:
check the [component catalog](../packages/core/src/panel-component-catalog.ts)
and [DSL contract](dsl-spec.md) before declaring an interaction.

Do not add a graph for a short list, a single fact, prose evidence, or relations
not supported by the input. A dependency arrow is not execution order. Dense
relationships can be genuine; provide selection and readable details rather
than promise a layout with no crossings. Keep critical meaning in labels and
text, not only color or position.

Two actual declarations show how overview and editing share one source:

- [Business Data](../packages/skills-web-app/bundles/business_data/panel.yaml)
  binds `record_workspace` to `objects` and `relations`. Its `relation_graph`
  uses object IDs and relation endpoints; `record_inspector` edits the selected
  record. Association counts and generalization are distinct domain meanings,
  not inferred from the graph's left-to-right placement.
- [AI capabilities](../packages/skills-web-app/bundles/ai_agent_capabilities/panel.yaml)
  binds independent Agent, Skill and Tool records, plus optional shared model
  entries and knowledge resources, to a `record_workspace`.
  Its `reference_graph` projects explicit resource and collaboration references;
  the inspector edits their original records, not a second graph-specific copy.
  Do not infer a shared resource from matching names or add MCP, memory or tools
  to fill every visual category. A canvas projection does not execute Agents or
  evaluations; supported views follow the loaded declaration and renderer.

For author feedback, a non-programmer need not edit YAML:

1. Supply a small, realistic case and say what the reader must understand or
   decide. Mark unknowns instead of filling them with plausible facts.
2. In an available interactive preview, select a card, node or edge and check
   that its details describe that exact object. Change one visible name and
   check that the overview reflects it without creating another record.
3. Describe a concrete difficulty in ordinary language: which label, relation,
   field or action is unclear, and what you expected. A screenshot can locate
   the issue; it does not prove persistence or successful execution.
4. Where save is supported, save once, inspect the persisted files and Git
   diff, then reopen to check that edit and unrelated records. The executor
   assesses already-saved changes instead of applying them again. Report save,
   notification and reopening outcomes separately. A sample preview is not a
   real Bundle trial or publication, and confirmation alone grants neither.

This author workflow introduces no new DSL, mandatory document, approval gate
or Studio capability. Keep the chosen expression and feedback in the existing
Bundle proposal or method; adjust the declaration using the current contract.

### Execution placement

```yaml
execution:
  mode: main # main | subagent; omitted means subagent (existing behavior)
  handoff: must_edit
```

Placement is independent of handoff and Worker fanout. A `main` Bundle runs in
the existing conversation; a `subagent` Bundle uses an independent Producer.
In either case, the executor owns canonical JSON, integration, validation/repair
and publication. Workers remain optional exact-artifact children according to
the Bundle method. No Worker topology schema or scheduler is added here.

Placement is resolved once when an invocation begins and is immutable for that
invocation. A manifest reload or configuration change applies only to the next
invocation; an active main invocation never becomes a Producer invocation (or
vice versa). Reconstruction may replace the terminal handoff with `none`, but
must preserve the resolved placement. Hosts reject overlapping main and
Producer ownership instead of silently falling back to another mode.

DSH `run_design_skill` returns `in_progress` only for prepared main execution;
the scoped `design_publish` response completes the same handoff and synchronous
clarity path. The generator must explicitly publish before ending main work.
Cancellation preserves working files. Ordinary host file tools do not gain
Design write authority. Completing a Bundle does not end the main session.

The Companion exposes the same mode in `prepareBundle`. Main work
uses `beginMainBundle` / `finishMainBundle`, with an invocation ID separate from
native Agent identity. Direct Workers register the actual main parent and that
exact invocation ID. Only real children produce execution/log rows; there is no
synthetic Producer rolling log for main execution. File publication and clarity
reminders reuse the existing native-host path. These APIs do not start a model.
Native session identity, child-Agent registration, notifications and permissions
remain host-adapter responsibilities. The current Claude Code plugin also
instructs its executor to use these shared main-Bundle APIs; those instructions
and shared manifest semantics alone do not establish actual four-host runtime
parity. Each claimed host must pass its own installed execution and handoff tests.

An official Bundle using native presentation instead provides the common
`SKILL.md`, `skill.yaml`, schema, and validation definitions and names a
provider-owned client-panel contribution. It does not require `panel.yaml` or
`renderer.md`; a missing panel contribution rejects Kit publication and never
falls back to this declarative profile. Domain generation, validation, repair,
candidate schemas, and artifact procedure remain in the Bundle.

A Bundle with no interactive editor may omit `presentation` (equivalent to `presentation.mode: none`) and carries neither `panel.yaml` nor `renderer.md`. The client omits its panel tab, while the server emits a bounded generic model summary. `presentation.mode: auto` is an explicit opt-in to a generated Panel; until a validated generated spec is ready, the client shows a read-only unavailable state. Native, auto, and no-panel Bundles that retain declarative presentation files are rejected rather than maintaining two conflicting definitions.

The Web App Flow Bundle carries its BPMN validation CLI and exact ELK layout
algorithm under `flow_design/scripts/`. Its executor invokes those ordinary
scripts explicitly, repairs failures, then writes the accepted BPMN through the
Bundle-scoped WorkingCopy and publishes validated JSON plus artifact as one Git
checkpoint. Sequential working-tree writes are not a filesystem transaction. Core and
the Provider do not spawn layout automatically or rewrite BPMN. The generic Host
only confines the selected Skill's script path and resources; changing this
Bundle logic requires no Host/Provider rebuild.

`schema.yaml` and `validation.yaml` are deliberately not merged: schema is the
persistable data shape; validation is the semantics and cross-file contract of
model candidates.

Object nodes are open unless they declare `additional_properties: false`.
Use the closed form for state translated from an `extra="forbid"` model so
unmodeled fields fail at the Design Files write boundary; keep the open form
only when the source model intentionally preserves extension fields. Reads
also validate against the active Kit version and reject incompatible stored
files instead of exposing stale fields to the model.

## Zero-code Kit discovery

Kit `mindset.md` frontmatter retains a string `description`. Optional
`display_description: {zh: <text>, en: <text>}` supplies bilingual human-facing
catalog/file-view copy; both values must be non-empty strings when provided.
The loader projects it as `DesignKit.pickerDescription`; Studio uses the selected
locale and otherwise falls back to `description`. It does not change identity,
mounts, the injected Mindset body, Bundle selection or version resolution.
Bundle display copy continues to use its existing locale/manifest contract below,
not this Kit-only field.

The structured Kit binding declaration is the authoritative Bundle allowlist.
Each binding must resolve to the Bundle identity in the current source tree; unknown and
duplicate members fail Kit loading. When the Mindset displays a
`<design_skills>` catalog, it is generated from the binding declaration or is
the co-located structured representation of that same authority. Bundle
definitions not bound by the Kit remain invisible to it.

A declarative Kit author creates Bundle definitions, a Mindset, and Kit bindings.
Discovery, validation, Mindset catalog injection, generic `design_state`
rendering, panel rendering, and Design Files save/restore must not require a
core dispatch entry or a React component registration. Official Kits may use
native panels, declarative panels, or both; ordinary user-authored Bundles use
the declarative runtime.

Panel sections name a logical `id` for component and field bindings. A section
may also declare dotted `records_path`, `fields_path`, and `order` paths when
its persisted records live inside an envelope. The Kit compiler resolves all
three paths against `schema.yaml`; the interpreter uses the same declarations
for edits and lifecycle operations. Cross-panel record option sources must
resolve to a `bindingKey` and exported section in the same Kit version before
publication; the runtime never guesses a Kit-local instance from a global
Bundle identity.

## Declarative model summary

A declarative Bundle sets only `presentation.mode: declarative`; the loader
selects the shared `pilot-design/v2` interpreter. Authors do not choose a renderer
version in `skill.yaml`. Explicit supported ids still load, and unknown ids fail.
Its optional `skill.yaml.summary` contains at least one
`fields` or `collections` entry, without a renderer id or repeated version. Each entry names a dotted state `source` and a
display `title`; collections may also declare an order-list source,
record-title fields, scalar record `fields`, and a positive output limit. The
loader validates every path and scalar type before publishing the Kit
version, and the shared renderer uses only these declarations—never the
Bundle id or guessed state keys—to construct the model-facing `design_state`
summary. The summary is derived model context, not an independent Design File
or KAG source. An absent summary is valid; an explicitly malformed summary is
an authoring error, not a reason to silently discard the configuration.

```yaml
summary:
  collections:
    - source: questions
      title: Questions and answers
      title_fields: [prompt]
      fields: [answer, detail, rejected]
```

Existing `renderer.md` declarations are read only as a legacy source. Do not
author both it and `summary`. To migrate, move its `fields`/`collections` into
`summary`, preserve useful prose as YAML comments, then remove `renderer.md`.
This changes the declaration location, not canonical data or summary output.

Bundles using native presentation instead set `presentation.mode: native` and an installed
provider contribution id. Unknown native contributions or declarative renderer ids fail Kit loading.
`presentation.mode: none` declares that the Bundle has no interactive panel and
does not select this renderer.
Omitting `presentation` has the same no-panel meaning. `presentation.mode: auto`
is reserved for the generated-Panel path and does not select this renderer or
allow a renderer id; it is not a fallback for missing native/declarative files.

## Current content and project definitions

A library Kit or Bundle has a stable identity and one current saved state.
Saving edits does not require a new version or publication. Copy is the explicit
operation for creating an independent identity. An upstream version is retained
as provenance where provided, not used as a local editing permission.

At project creation or first use, copy the complete Kit and mounted Bundle sources
to `design_kit/kit/` and `design_kit/bundles/<identity>/`. Runtime methods, schemas,
validation, Panels and resources use those project files. Later library changes
do not replace them. An Agent can compare and update project definitions using
normal file editing, validation and Git, preserving existing user data and custom
methods; this needs no separate local release or migration workflow.

Incomplete authoring can be saved. A loader or preview diagnoses the actual
missing/invalid content when needed. Internal revisions and hashes retain atomic
save, cache refresh and invocation consistency; they are not local product versions.

## SKILL.md frontmatter: the unified gap contract

The Mindset's `<design_skills>` section is the condensed routing index injected
into the parent Agent on every turn. Each `SKILL.md` frontmatter description is
Bundle metadata available to Design System catalog consumers; it is not
published through the stock dsh `skill` service. The following five items are
a useful routing-description structure, not a loader-required item count:

1. **Capability**: the user-visible design artifact this skill creates.
2. **Resolves**: which U/S/T evidence gap it can fill.
3. **Candidate when**: the facts or scenario that must already hold before invocation.
4. **Do not infer**: preconditions weak signals must never be allowed to infer, preventing a default pipeline.
5. **Output**: which frontend panel or visible artifact receives the result.

The frontmatter carries no detailed workflow, fixed questions, full schema,
execution steps, or score ranges; those live in the `SKILL.md` body supplied
to the selected invocation's executor. The routine routing catalog does not
inject every Bundle's full body. For `execution.mode: subagent`, the selected
body goes to the isolated Producer; for `execution.mode: main`, it goes to the
main conversation executing that Bundle. Reconstruction instead receives the
output contract and source-extraction guidance described below, not the forward
body. Every Design Bundle method must explain its output contract, revision
behavior, actual validation and completion evidence. A fixed `Close-out evidence`
heading or numeric U/S/T calibration range is not required; concise methods may
express these responsibilities in their own structure. Domain-specific evidence
guidance must not replace the shared assessment contract. An isolated
Producer reports its completion evidence to its caller and cannot invoke main-Agent-only
assessment tools. Main placement retains the same publication and evidence
requirements; it does not give ordinary host writes Design publication authority.

The active Mindset and the host's shared progression section together govern selection. The shared section owns request precedence, explicit authorization, foreground attachment, and post-completion close-out. The Mindset owns domain evidence relationships and candidate calibration. An extension Bundle repeats the prerequisite evidence it consumes in its own body so its executor cannot silently fabricate upstream facts; the relationship controls evidence quality, not execution order.

In DSH, a completed subagent `run_design_skill` result does not necessarily end the turn: its synchronous completion hook first assesses the committed revision, then the next model step receives both the newly logged Design state and the current clarity result and may summarize them or invoke another explicitly required Bundle. For main placement, the initial `in_progress` result only prepares execution; explicit `design_publish` returns the terminal handoff and clarity result. Every invocation stays in the foreground through its resolved executor, optional Worker tree, and completion assessment. Only subagent placement has a Producer; main placement must not invent one or its logs. A declared user action returns control for one visible main-Agent close-out that presents the action, then the turn ends; another Design invocation is rejected until that turn stops. A panel wait ends at the tool result. Ordinary Bundle delegation never becomes background execution.

The U/S/T clarity gauge is runtime state owned by `dsh-design-core`, not a Bundle slot or Mindset catalog entry. Bundle descriptions and close-out guidance identify relevant evidence. The DSH authoritative completion path—subagent `run_design_skill` or main `design_publish`—synchronously evaluates its exact committed revision and promotes one evidence-based assessment before returning; an unchanged assessment for that revision is reused. Preparing main execution is not completion or a scoring checkpoint. `report_design_clarity` remains the explicit main-Agent path for other meaningful checkpoints. The identity-checked DesignJournal record is authoritative, while the terminal tool result exposes the current assessment to the model and host UI. Evaluation failure never changes a successful Bundle outcome, but the result explicitly withholds next-step recommendations based on stale U/S/T. A clarity report never writes Design Files, asks a question, selects a Bundle, or changes the active Kit. Other host adapters must verify their own completion and clarity integration; these DSH tool names are not a portable host API.

## skill.yaml template

Isolated Studio demonstrations may provide `reference/preview.json` and the
optional bounded `reference/preview-artifacts.json` mapping described in the
[Studio README](../packages/studio/README.md#edit-current-content).
Mapped HTML/SVG resources are fixed synthetic source bytes, read through the
same readonly Panel sandbox without accessing a project. This does not add a
required Bundle slot or replace real artifact existence/publication checks.

[skill.template.yaml](../.agents/skills/design-bundle-creator/assets/skill.template.yaml)
is a copyable manifest starting point, not a complete Bundle or a requirement
that existing manifests share its field order and comments. Copy it to
`bundles/<catalog_identity>/skill.yaml`, replace the identity and user-facing copy,
then choose execution and presentation deliberately. The example uses main
placement, must-edit handoff and declarative presentation; these are not a
universal policy. The loader checks the actual fields and required profile
slots. Keep only applicable optional fields, and author the remaining slots
and readable output contract before trying to run the Bundle.

| Field | Purpose | Affects routing? |
|---|---|---|
| `identity` | Independent catalog id. File-backed Bundle resolution uses a directory with this id; Kit mounts reference it through `name` ; a declared `version` is source metadata. Omission falls back to the runtime `name` for compatible existing content | No, not a runtime routing override |
| `name` | Runtime skill id, matching `SKILL.md` frontmatter and `validation.yaml.skill`. Methods and canonical data paths use this id; it need not equal an independent catalog directory | Yes, as the explicit runtime skill id |
| `title` / `label` | Bilingual frontend title and picker action copy | No |
| `description` | Omit in new manifests. `SKILL.md` frontmatter owns routing/Studio descriptions. Optional translated picker copy belongs in the panel's existing `zh-CN` / `en-US` locale resources under `bundleDescription`; the loader projects it to the existing picker contract. Declaring both sources is rejected | No |
| `order` / `icon` | Frontend display order and icon; must not participate in skill suggestion | No |
| `review_support` | Optional list of `alignment` and/or `reflection` candidate hints; multiple Bundles may declare the same role, omission and an empty list are valid | Yes, as hints only; never automatic routing or write authority |
| `execution.handoff` | `none`, `must_edit`, or `user_continue` user hand-off point | Yes |
| `execution.resume_action` | The single resume action of a `user_continue` hand-off (route, label, chat aliases) | Yes, that hand-off only |

`bundleDescription` is reserved presentation copy in the locale resources already
declared by a declarative panel's `i18n.locales`. Both `zh-CN` and `en-US` must
provide non-empty strings when it is used. This does not change the Agent's
`SKILL.md` description. Native or unlocalized Bundles may retain the optional
manifest-only bilingual display description; without either display source,
the picker falls back to the method description. Do not author both sources.

The loader compiles `execution` once into a frozen hand-off policy that is also part of the Bundle version. `user_continue` requires `resume_action`; every other hand-off rejects it. `execution.mode` changes only the executor's location (main conversation or isolated Producer), not project permissions, Worker capabilities, artifact logging, validation or publication. The selected executor decides whether optional native delegation helps with the current work.

On DSH, an exact claimed human resume label/alias is resolved against the current
published gate before model assembly. It enters the same controller and installs
the current execution's scoped capabilities before the next model request.
Background notices and messages that change scope do not resume automatically;
ambiguous labels never select a Bundle by guessing. A plugin-owned resume uses
its own invocation identity and the originating human turn, not a fabricated
native tool call. The controller outcome is exposed through a logged prompt
section. Ordinary host writes and generic subagents are not recovery paths.

Forward-design behavior is described by the Bundle's Skill Body, resources,
and optional ordinary scripts. Reconstruction selects a source-extraction task
instead of injecting that forward Skill Body. Both use the same output contract
and file/validation tools. Core validates only the generic
delegation envelope, tracks native attempts, and serializes publications against
the latest Producer WorkingCopy; it never interprets Bundle task fields. The Host
resolves resources and scripts from the exact Kit and Bundle version selected by
the parent invocation and never consults a child's active Kit.

The registry merges the runtime skill name, `title`, `label`, and optional picker
`description` automatically, so adding a Bundle never edits a central table.
For a new file-backed catalog, keep Kit sources under `kits/` and independent
Bundle sources under `bundles/<catalog_identity>/`. The catalog identity and
runtime name are separate: a customized `team_questions` Bundle can retain
`name: smart_questions`, its method and `smart_questions/smart_questions.json`
while declaring `identity: team_questions`. Its Kit mount references
`name: team_questions` with the exact version and preserves
`bindingKey: smart_questions`; the Mindset catalog projects that binding key.
Each runtime binding must remain unique within a Kit, and a new identity does
not inherit native-provider trust. The existing `mindset.md + skills/` layout
is a compatibility input, not the template for a new independent content package.
See [content organization and copying](wiki/extending.md#当前内容组织).
Human-facing labels may use spaces or hyphens.

## File-backed script inputs (all Kits)

### Evidence and cooperation (all execution placements)

Core supplies shared executor/Worker evidence guidance. A task brief carries
the intended outcome, settled shared decisions, relevant excerpts with source
locators and revision basis, exact output ownership and validation contract.
Workers retrieve material gaps with available read-only tools, rather than
repeating a full-project intake. Context reduction must preserve conditions and
exceptions; exact assets and mechanical inputs retain file authority.

All Bundles may use KAG to locate dependencies, constraints and change impacts.
Verify retrieved claims against the relevant Design Files; graph similarity
and Agent relations are not confirmed product decisions. Pass real query pins
to descendants when useful. Missing or stale graph context does not prevent
source-backed work. This introduces no required Kit metadata, Worker topology,
graph query quota or new publication gate. The executor remains responsible for
cross-artifact synthesis and quality; receipts prove bytes, not design quality.

Agents own domain choices and repairs; scripts should consume authoritative
Design Files directly rather than require model-transcribed copies of existing
state, assets or token maps. Use `run_skill_script.input_file` plus `input_files`
for exact source bytes, with `input_context` reserved for small selectors and
operation metadata. Each Bundle documents the source paths it consumes and
interprets those bytes in its own script. Core does not infer a domain graph,
hardcode another Bundle's paths, or require new Kit configuration fields.

Where native hosts run scripts through shell, provide a documented equivalent
file interface with relative-path and realpath confinement; use the same domain
validator. Keep input/transport errors distinct from invalid artifacts. Missing
authoritative input must not silently fall back to a model summary. The
existing transport envelope remains subject to host-scoped read/write policy;
file inputs do not grant Workers canonical write authority.

Methods, Worker briefs and tool schemas must describe the same delegation
contract. A frontier call contains its complete items, not only a batch ID.
Revalidate existing artifacts against relevant current inputs on resume;
integrate valid receipts through the executor's canonical mutation path and
repair only affected artifacts. A file receipt is not domain acceptance, and
script success is not publication or proof of user-experience quality.

## Hand-off strategy

### Reconstruction uses the same outputs, not the forward playbook

`reconstruct=true` is an invocation input, not a persisted project mode. The
resolved executor (main Agent or isolated Producer) receives the exact loaded `schema.yaml` and `validation.yaml` from
Bundle metadata. It does not receive `skill.content` or instructions to perform
the ordinary design workflow, including on an explicit reconstruction resume.
The source facts are extracted, mapped into this schema and converted to usable
artifacts; required fields do not authorize invention.

Where artifact format or script operations need explanation, keep one ordinary
`reference/artifact-contract.md` resource and link it from `SKILL.md`. The
reconstruction prompt advertises that same readable resource, not an extracted
or regex-filtered version of the forward Body. Its linked resources describe
existing scripts, templates, file paths and panel bindings. JSON-only Bundles
do not need a placeholder reference. No reconstruction slot, task schema,
per-Bundle executor or new YAML control field is required. Missing contracts
must be reported, not replaced by executing the forward Body.

The existing reconstruction routing sets the invocation's effective handoff to
`none`; normal manifests and future ordinary invocations retain their policies.
Automatic settlement therefore uses complete validation, and cannot publish a
plan as a successful pause. Real validation failures remain repairable failures.
Unknowns use existing schema representations; if the evidence cannot legally
satisfy a required output, report the limitation rather than fabricate facts or
bypass validation. This does not change Git, polling, artifact receipts, domain
scripts or normal panel editing after reconstruction.

`execution.handoff: user_continue` with `execution.resume_action` declares that the executor publishes authoritative pending state and stops for user confirmation. The resume action's `label` and `aliases` are the visible frontend text and the complete set of chat controls accepted under the current pause. New scope or revision content in chat still goes through normal intent handling. Acceptance re-enters execution over the exact pending revision after validating the current gate and its invocation identity, using the resolved main or subagent placement; it does not resume a hidden Worker process. The migrated `research` skill uses this to publish its research plan before the user starts execution.

`execution.handoff: must_edit` marks a persisted panel as awaiting user edits. Saving writes and commits the authoritative panel state before recording one DesignJournal disposition keyed by the exact invocation, gate pin, and panel HEAD. The two durable stores do not share a transaction: save reports success only after the disposition is recorded, and an exact retry after a post-commit journal failure reconciles the missing disposition without another Bundle run. The next main-Agent turn receives the saved Git diff and a deterministic assessment instruction; it does not receive a generic continue command and does not re-run the completed Bundle. A driver-owned regenerate action is separate from ordinary Save.

All gates only define how the Agent parks, presents suggestions, and reminds unfinished context when no new instruction arrives; they never constrain the user. An explicit user instruction—choosing another skill, asking for a different design result, changing scope, or moving to development—takes precedence, and the runtime closes or replaces the old gate rather than demanding the original panel or resume action first.

Foreground execution returns one explicit result: `completed`, `failed`, `cancelled`, or `needs_user_input`. A complete result requires an accepted executor publication. Child completion is never Bundle completion, and a child failure is an observation the executor must resolve before it publishes or reports failure. Cancellation remains visible and stops the invocation and its attached children; in subagent placement that includes its Producer tree.

Heavy-artifact state carries authored targets, stable item ids when the design requires them, and direct accepted artifact references. It does not carry a generic desired-versus-accepted revision ledger or Runtime scheduling fields. The executor reads existing state and artifacts, decides whether the request is initial generation or a precise revision, and preserves unrelated accepted work. Host queued, running, and cancelled observations form a transient Panel projection and never become Design state. Exact project and dependency pins remain hard publication checks.

For every artifact-backed Bundle, three authorities remain separate: filesystem
bytes are content truth, Host-native Producer/Worker attempts are live execution
truth, and canonical JSON contains only durable design facts and accepted file
references. A successful Worker returns a Host-computed file receipt. The
executor integrates that reference without reading or retransmitting the whole
artifact merely to acknowledge completion. It reads content only for genuine
downstream synthesis or repair; when compact diagnostics or extracted metadata
are sufficient, it invokes the Bundle script by file path. Panel polling observes
worktree files and native attempts independently of Git publication.

Artifact panels share one execution projection and one per-file preview loader.
The latest bound Worker or explicitly focused Producer supplies queued/working/
failed status. A completed attempt is green only when its output file is present;
a canonical reference alone is not evidence of completion. With no live attempt,
an existing referenced file remains available as historical output. A busy root
Producer does not imply that it has taken over every failed Worker.

Preview availability is independent of the execution badge: readable bound bytes
can be displayed while validation or repair is still running. The existing shared
workspace poll supplies file content hashes; arrival, deletion, or same-path repair
invalidates only the affected preview. Each read updates independently, without
waiting for sibling artifacts, a canonical JSON rewrite, or Git publication. Future
fanout panels reuse these shared helpers and provide only item/path bindings.

## Validation contract

File integrity uses the same declarative rule engine for every Bundle:

```yaml
rules:
  - id: accepted_files
    scope: [state]
    code: example.referenced_artifact_invalid
    check: { referenced_files: ["items.*.output_file"] }
  - id: fixed_deliverables
    scope: [completion]
    code: example.required_artifact_invalid
    check: { required_files: ["example/summary.html"] }
```

`referenced_files` selects explicitly declared dotted state paths; `*` traverses
map entries or array elements. Missing, null, or empty references remain
unplanned/unaccepted and are ignored. Every populated reference must name a
safe Design Files-relative path whose bytes are readable and non-empty.
Required reference fields still use the existing `non_empty_string` completion
rules; `required_files` covers fixed paths that are not stored in state.
URLs and inline SVG/data are not local file references and must not be declared
as such. The file reader is required when a file needs checking; its absence
is a diagnostic, never a successful file audit.

Executor validation and both explicit and automatic settlement run these rules
against the prepared file snapshot. They do not infer references from field names,
run HTML/BPMN quality scripts, or block ordinary file editing. A failed check
returns the exact field/path and a repair hint; the same working copy can be
repaired and validated again. File polling and historical project loading are
unchanged. Bundles with only canonical JSON need no file rules.

Each skill's `validation.yaml` declares the rules the Core evaluates against the working copy and prepared state and artifacts. Validators only report facts—stable codes and locatable messages—and never edit files, call models, or decide delegation or retry counts. Artifact-local diagnostics return to the same optional Worker. Integration and completion diagnostics return to the executor, which repairs its working copy and validates again. Publication runs integration validation, trusted `preparePublication`, validation of the prepared write, dependency-pin and project-revision revalidation, then one atomic Git commit. No second control plane such as `repair`, `max_retries`, `staged`, or an execution topology belongs in `skill.yaml`.

Two generic relation-record invariants are available, independent of Kit names:

```yaml
check:
  acyclic_record_edges:
    map: links
    source: child
    target: parent
    where: { field: category, equals: ancestry } # optional filter
```

This structural check reports each selected edge participating in a directed
cycle, including self loops; multiple parents and diamonds are allowed. Missing
optional maps are accepted; schema and endpoint-membership checks remain separate.
`map` is a safe state path; source, target and filter fields are direct record keys.

```yaml
check:
  for_each_in_map: links
  fields_absent_when:
    field: category
    equals: ancestry
    fields: [quantity]
```

This leaf check forbids the listed own properties for matching records, even
when their values are empty or null. It does not invent or delete values.

## Optional versioned source locations

`schema.yaml` can annotate a metadata map of locator objects with
`knowledge: { role: metadata, source_reference: true }`. Its closed value
schema owns `file`, `revision` (exact Git commit), optional JSON `pointer`,
`note` and `subject_pointer` relative to the containing owner record. This
is distinct from `role: reference`, which annotates a single identifier
string and an optional declared target collection. Locator mechanics do not
become product-content nodes. A missing, unreadable, deleted, positional-array
or non-content target retains the original evidence but produces no guessed
current edge. Resolved current content gets only a `references` relation,
never mechanical support, causation or approval.

For an optional locator map, `validation.yaml` may use a leaf check
`source_reference_map: <field>` within `for_each_in_map`. It checks confined
paths, exact commit syntax, RFC6901 pointer syntax and a present non-array
local subject. Absent optional maps pass. History existence is checked when
reading/projecting evidence, not a save-time dependency on historical I/O.
DSH Panel Save applies these locator guards; Companion additionally applies
its complete state-scope checks. Empty-state publication rules remain different
between these two entry points.
