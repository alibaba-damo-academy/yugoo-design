# Design System architecture baseline

This document is the normative product and architecture baseline for the Design System. It records durable ownership, extension, runtime, and data rules. Implementation status and delivery order belong in the [standalone roadmap](standalone-roadmap.md). Historical source-runtime migration records are internal development evidence, not prerequisites for reading or using the public distribution.

This baseline is a target contract, not a supported-host matrix or evidence that
every described surface is implemented. In particular, Studio authoring,
restart-free content updates, cross-host equivalence, and desktop support need
their own installed-candidate acceptance. The public plugin source distribution
does not include the DSH application or the development host submodule.

## Product definition

The Design System is one host-independent product for interactive, human-aligned software design. It combines agent instructions, Design Kits, durable design state, interactive panels, validation, execution workflows, and derived design context. DeepSeek Harness is the first implemented host integration. Planned Codex and Claude Code integrations must use the same product kernel, catalog, design state, and user interface through host-specific adapters.

The Design System distribution supports two authoring paths:

- Official Bundles may ship ordinary Agent-facing scripts inside their own
  `scripts/` directory and may reference prebuilt React panels registered by
  provider plugins shipped in the distribution.
- A content author may create a Kit from a Mindset and declarative Bundles without changing or rebuilding the plugin.

Kits and Bundles are units inside the Design System. They are not independently installed Agent Host plugins. Internal modules may register capabilities and drivers, but those registrations do not create additional products or installation steps.

## Behavioral foundation

Bundle state, validation, execution, handoff, worker, and artifact lifecycles preserve the observable design-runtime semantics defined in this baseline. Harness-specific mechanisms may strengthen isolation, durability, security, and customization, but they must not silently weaken those semantics. Historical migration records do not establish current implementation coverage; that requires installed-candidate acceptance against this contract.

## System composition

The released distribution comprises:

```text
Design System distribution
├── generic design runtime
├── generic declarative runtime
├── official Bundle and Mindset catalog
├── official Kit definitions and bindings
├── trusted providers
│   └── prebuilt native React panels and Host transport adapters
└── optional DesignGraph providers and advisory consumers
```

The generic runtime must not contain official Bundle names. Official behavior is registered under stable, versioned contribution ids and bound to a deployment-derived Bundle authority by trusted provider composition. A contribution is effect-owned and removed with its registering plugin scope. Missing, duplicate, unauthorized, or incompatible registrations fail at the earliest point at which the complete relationship can be checked.

The product has three primary user surfaces:

- The **Design Workspace** runs an interactive design session and renders the active Kit's Bundle panels.
- The **Design Studio** creates, searches, composes, edits, validates, previews and exchanges current Mindset, Bundle and Kit content.
- The **Alignment Workspace** presents grounding evidence, designed-product relationships, reflection findings, impact, proposals, and human decisions.

## Agent Host and user-interface integration

The Agent Host is the user's primary work surface. A user enters DeepSeek Harness, Codex, Claude Code, or another supported Agent Host, invokes the Design System in that existing conversation, completes interactive design work, and continues implementation in the same Agent session. The Design System does not replace the host with a second general-purpose chat, coding, terminal, or model-management application.

The user starts the Agent Host through its normal entry, then opens the Design
System in that existing conversation. Required host settings belong to explicit
setup before use. Adapters detect readiness and explain missing settings; they
must not provide a separate host launcher, replace the host's startup registration,
or silently restart the host. A host restart required by setup remains a normal
user-controlled host action, followed by exact-session reconnection.

The product is divided into a **Portable Kernel** and one **Host Provider** per integration. The Portable Kernel owns Design Projects, the Kit and Bundle catalog, version resolution, validation, execution policy, Design Files, Git checkpoints, DesignJournal, Design Knowledge, advisories, and the shared UI. It does not import a Host implementation or store Host-native event objects. A Host Provider owns session identity, command and tool registration, model-context delivery, human questions, subagent delegation, filesystem grants, and panel transport by adapting only public capabilities of its Host.

DeepSeek Harness `master` is a read-only compatibility target for the DSH Host Provider. The Design System installs through documented Cordis, command, tool, Agent, interaction, subagent, and client-module extension points; it does not require a Design-specific DSH API, event vocabulary, patch, fork, or release. The development repository's pinned `deepseek-harness/` submodule selects the exact official revision used by integration and release gates; it is not part of the public plugin source distribution. A missing public capability changes the provider's advertised capabilities or presentation mode instead of changing DSH.

One shared Design UI implements the Design Workspace, Studio, Alignment Workspace, official native panels, and declarative panel interpreter. A host adapter presents that UI through the strongest supported mode:

- **embedded**: the host mounts the Design UI in a persistent native client area, as DeepSeek Harness does;
- **inline**: a capable host renders an MCP App or equivalent interactive resource inside the Agent conversation;
- **companion**: a CLI or client without a rich extension area opens the Design UI in a local browser or host-managed window bound to the active design session.

Yugoo Design has one product npm entry, `yugoo-design`, and one product version. The native DSH integration and Companion integrations are peer host adapters over this shared infrastructure. The product installer selects the host route; DSH installs its exact native module dependency closure, while Companion hosts use the shared portable payload. Companion is a presentation and integration implementation, not the name or version authority of the whole product.

These are presentation modes for the same UI, not separate products or implementations. Capability detection selects embedded or inline presentation only when the host guarantees the required lifecycle and interaction APIs; companion presentation is the portable fallback. A companion panel contains design surfaces only and leaves conversation history, Agent controls, coding tools, and subsequent development in the originating host.

During active design, the Design panel is the primary visual workspace. When an embedded host automatically opens the panel for new Design activity, it collapses its conversation-history navigation and initially assigns about 70% of the available workspace to Design and 30% to the conversation. The user may resize the split or reopen navigation while Design remains open; reflow fits the dock to the available space, and later activity focuses the newest Design tab without overwriting those manual choices. Restoring an open dock after a session switch or client remount preserves its width within the current Host layout rather than repeating the initial layout policy. Closing the automatically opened panel restores navigation only when the Design integration originally collapsed it and no later Host or user transition superseded that ownership. Inline and companion hosts preserve the same Design-first emphasis within the space they control without modifying unsupported host chrome.

Each Host Provider packages the instructions, tools, lifecycle hooks, transport, and session binding appropriate to that Host. The Host's conversation log remains authoritative for Agent execution, while Design Files, Design System journal events, catalog versions, and accepted human decisions remain authoritative for design state. Every Host Provider associates those authorities explicitly and passes the same domain and UI conformance suite.

The shared kernel and native Host integration are equally important product
capabilities. Integration is a first-class engineering and delivery priority,
not incidental glue or a lesser completion criterion. Users receive a usable
plugin in their normal Host, so both layers must be reliable, efficient and
maintainable. A shared-library test cannot accept a Host whose installation,
session binding, saved-edit continuation, assessment reporting or advertised
background execution has not worked through its supported user path. Preserve
the distinction between shared conformance and each installed Host's actual
acceptance. A concrete native limitation must be disclosed and an intended
support-scope change decided explicitly; it is not permission to silently
downgrade the advertised feature or declare the Host finished.

Model-generated design assessments are derived interpretations, not execution
receipts. A Bundle's successful publication does not prove that optional Workers
ran. Completion reporting distinguishes Host-bound execution observations and
accepted artifact receipts from assessment text; rejected, missing, stale or
truncated delegation evidence cannot be promoted into Worker success. A receipt
used to claim integration must match the exact invocation, child lifecycle and
accepted publication, not mutable worktree bytes or a newer project HEAD.

Every host assembles the same instruction layers in this order: the host's own base instructions, the host-neutral Design Core policy, the selected Kit Mindset, and current version-pinned Design state plus accepted advisory reminders. The selected Bundle's complete Skill Body enters its invocation's executor: the isolated Producer for `execution.mode: subagent`, or the existing main conversation for `execution.mode: main`. The routing catalog does not inject every Bundle body. Reconstruction supplies the output contract and source-extraction task instead of the forward Skill Body. The Design Core owns the foreground decision loop and cannot be replaced by a Mindset. A Mindset calibrates the Core for one domain and exposes that Kit's Bundle catalog; it cannot override current user intent, persisted evidence, a selected Bundle, or the Bundle's execution rules. Host-specific response markup, phase routing, buttons, and development commands remain outside these shared layers.

DeepSeek Harness registers these layers and tools as native Cordis plugin contributions and embeds the shared Design UI in the Web application. Its Host Provider uses `agent.inject()` for durable, non-waking model context, exposes `ctx.userQuestions` for an in-turn blocking question when Bundle policy or the Agent requires native ask-user, creates each required Producer through the public Agent factory, and exposes native nested delegation to that Producer as an optional acceleration capability. It supplies package-owned `dsh.client` modules plus Remote services for the Design panel and Studio. Persistent asynchronous continuation is presented by the plugin continuation UI, and acceptance enters as an ordinary logged user turn; advisory dispositions remain plugin-owned review decisions rather than `ctx.userQuestions` interactions. The provider resolves the active Design Project through the Design System binding store instead of a Design Project, Kit, Design File, or clarity projection. Its standard `designAdvisoryInbox` projection is only a refresh/read-model mechanism and is not Design authority. CLI adapters render clarity and lifecycle state as deterministic text.

Every embedded client stylesheet participates in the Host's plugin-module lifecycle. The DSH provider tags its Panel-shell, trusted-provider, and third-party panel styles with the owning `dsh.client` plugin id at module materialization, so reload and HMR replace the complete style set atomically. A late injected service scope must not privately create or dispose global stylesheet tags; provider-specific styling and shared Panel chrome cannot therefore disappear independently. Component-local inline styles remain permissible only when their DOM lifetime intentionally owns them.

Codex and Claude Code integrations begin with capability discrimination, not assumed native APIs. Each adapter proves which session identity, tool, filesystem, human-question, Agent, nested-delegation, and UI capabilities are available in the installed Host version and selects only supported mappings. MCP, Skills, hooks, commands, or a companion browser may carry those mappings. Subagent placement requires an isolated Producer runtime; main placement requires equivalent invocation-scoped Design capabilities in the existing conversation. An adapter must reject an unsupported requested placement, not silently replace it. Nested delegation remains a separate optional capability. Detached execution negotiation applies only to G/R/A advisories. These presentation and execution differences cannot change selection, validation, publication, foreground attachment, or handoff semantics.

Clarity is a Core capability, calibrated by the active Kit rather than owned by
its Mindset. The ordinary path is the main Agent assessing the current saved
design and reporting U/S/T through `report_design_clarity`. The tool validates
the scores and evidence against the selected project, its existing Git checkpoint
and Kit, persists the report, and returns the saved result. The shared Panel
reads that same project record. It does not infer a score from conversation text.
Reporting does not edit canonical Design Files, ask or answer questions, select a
Bundle, change the active Kit, or consume an execution gate.

A completed Bundle is completed by its validated, committed design result, not
by waiting for another model to score it. The main Agent may reuse an applicable
assessment or report at the next meaningful boundary. A missing or failed score
does not roll back saved work or prohibit an independently authorized user task.
Keep the last successfully saved assessment with its assessed checkpoint and
show that it needs updating when appropriate; no prior assessment means
unassessed, never an invented zero. Do not use stale scores as fresh evidence.
Display and Agent-context reads use the Git-published version of the same
`design_records/clarity.json` file. A local replacement awaiting publication
does not replace the last successful assessment; only an explicit report retry
may settle it. Records-only HEAD contention may retry the same frozen files
within a bounded publication attempt when Design evidence and target bytes
remain unchanged. Real Design changes, competing target changes, cancellation
and other failures still reject the report rather than claiming a saved score.

A meaningful Panel save uses the same main-Agent reporting path in its ordinary
continuation. The saved files and Git checkpoint establish what was saved;
delivery and any required user-edit gate settlement are separate outcomes.
The server supplies the saved diff and current project, checkpoint and Kit, and
the shared client submits the normal native continuation prompt. The main Agent
judges saved evidence together with the user's current intent. “Save and assess
next step” requests an assessment in that same ordinary main continuation:
report U/S/T before the next question, Bundle recommendation or closing reply,
unless a later user stop/cancellation supersedes it. An unavailable or failed
report is disclosed without undoing the save or blocking other authorized work.
Several saves before continuation need at most one assessment of their latest relevant state;
an unchanged save does not force another score. A changed user goal can justify
reassessment even without a new design commit.

Panel saves do not start a detached evaluator. A score is saved only by the
reporting tool, never by a browser claim or save receipt. The tool does not
reverse-search native transcripts to authenticate the main Agent, require the
calling log entry to be flushed or running, or restrict a user turn to one
report. Native call and turn metadata may be retained when already available;
missing metadata does not reject a score and must not be fabricated. Corrected
reports and ordinary retries use the existing project write lane. Retain normal
connection permissions, input validation, cancellation and protection against
writing a different project's or genuinely superseded design's score.

G/R/A remains separate from U/S/T assessment and design production. Saving
files, accepting a native prompt, persisting an assessment and consuming saved
edits are distinct observable
results. A delivery failure must not be reported as loss of a committed design;
an unknown delivery must not be blindly resent. These distinctions do not create
another project-state authority or require a new compensation state machine.

Assessment versions use the existing project Git history. `assessedCheckpoint`
names the design commit that was evaluated; the commit saving the score may be
its descendant. Changes only to explicitly system-owned assessment, advisory and
derived knowledge records do not make the design invalidate itself. Use the
existing Git content comparison to distinguish those changes from changed design
sources, not a second design-version service or native scope ticket. Actual
source artifacts and newly saved product facts remain part of design evidence.
The main Agent states its reasoning in the existing summary and evidence fields;
the server does not claim to prove every change of human intent from host logs.

## Design projects and persistence

A **Design Project** is the durable unit that contains one designed product's state. It is independent of an Agent Host working directory. DSH sessions can open it today; future Codex and Claude Code adapters must open the same format without changing its identity or persistence semantics. A plugin-owned binding store records which project a Host conversation selected, keyed by the Host Provider identity and opaque Host conversation id. This store lives outside every Design Project because it is the bootstrap authority used to find that project; it contains no Design File or Kit content. Every Design File, panel operation, Bundle execution, advisory input pin, and DesignJournal association resolves the selected project through that binding rather than deriving a path from the Host's current working directory. Persisted advisory publications, human dispositions and review policy belong to the Design Project and travel with its Git history; active review queues, native execution bindings and notification ownership remain Host-conversation scoped. Switching projects cancels queued analysis for the prior selection and clears its review projection; opening an existing project in a new conversation restores Design Files but does not inherit another conversation's review queue.

Each managed Design Project is an independent Git repository. Selecting a Kit
adds its definition files; the configured project's owned paths are:

```text
<project>/
├── .git/
├── .gitignore
├── README.md
├── project.json
├── design_kit/
│   ├── kit/
│   └── bundles/
├── design_files/
└── design_records/
    ├── clarity.json
    ├── journal/
    ├── reviews/
    └── knowledge/archive.json
```

Durable design information is self-contained in these project files and their
Git history. `design_kit/` contains the project's own Kit and Bundle definitions.
`design_files/` contains the native Bundle-owned product facts and
artifacts. `design_records/` contains the shared system's persisted assessment,
knowledge archive, suggestions and human decisions. Its files appear when first
needed, not as fabricated empty results. Reuse the existing structured records;
do not keep another authoritative copy in the Host's state directory.

Connection secrets, native execution handles, active locks, message delivery
state and transient drafts remain machine-local. Knowledge databases and vector
indexes are rebuildable caches of project sources and the portable knowledge
archive. Copying a project does not copy permission to resume native execution.
This change does not automatically import or migrate old external records.
Missing project records mean unassessed or absent data, not permission to recover
scores from chat text or an old Host profile. Existing design content can use the
ordinary explicit `migrate` operation when needed.

`/yugoo migrate <path>` creates a new current-format project from an existing
Design Files source, leaving the source files, identity and history unchanged.
It stages only Bundles recognized by the selected Kit; their ordinary executors
validate, adapt when necessary and publish in the new target. It does not restore
the source's complete Git or Host execution history. Unknown Bundles remain in
the source rather than being silently imported. `reconstruct` instead derives
design from non-Design materials and refuses a Design Files source.

The shared Core creation path writes a product-level `README.md` and includes it in
the initial checkpoint. It introduces Yugoo Design, the available acquisition path,
and how a receiving Agent can use or continue the design work; it is not a per-file
schema guide. This optional, user-editable document stays outside `design_files/`
and is not an independent KAG design source. Opening an existing project neither
requires nor creates it, and never overwrites an existing README. The project
format version and validation requirements remain unchanged.

`project.json` identifies the directory with `kind: "dsh-design-project"`, carries the project format version, stable id, name, and creation time, and may pin one exact Kit identity and version. The Kit pin is part of the project metadata; the format does not create a separate lock file. Host-conversation bindings, pending handoffs, execution locks, transient UI working copies, and process state do not belong in `project.json` or the project Git history.

```json
{
  "kind": "dsh-design-project",
  "formatVersion": 3,
  "id": "0198e58d-2fd4-7a45-b667-620f71dba9df",
  "name": "todo",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "kit": {
    "name": "web_app",
    "version": "1.0"
  }
}
```

New Design Projects default to the current operating-system user's Documents directory under `YuGoo/Projects`, resolved by the shared Core registry. Windows uses the current user's Documents Known Folder (including OneDrive/redirection); macOS uses `~/Documents`; Linux follows `XDG_DOCUMENTS_DIR` in the user-dirs configuration. Missing, disabled or invalid Linux directory declarations fall back to `~/Documents`; filesystem errors never silently choose another destination. WSL uses its Linux user's directories. Explicit `projectsRoot` configuration takes precedence. Only creation/migration needs the new destination: registered roots, conversation selections, runtime state and caches remain where they are, and opening an existing project does not probe or create the new destination. This default change does not move existing projects.

Each Bundle owns one directory below `design_files/`. Its canonical state and generated or imported artifacts remain together in that directory; the project has no separate top-level artifact tree. Bundle directories are created when first needed rather than pre-seeded as empty catalog entries.

Git provides project content history, checkpoints, and authoritative change detection. Project creation initializes the repository and records a baseline commit. A Producer invocation or panel save records the exact filesystem fact that exists when it settles, including failure/cancellation audit commits when no design progress was made. Workers and individual file operations do not commit independently. Session state and concurrency coordination use their owning stores rather than Git branches, locks, or commit messages.

Canonical Bundle state crosses one schema-owned publication boundary. The Producer authors the complete state and declared artifact set in its working copy, the Design System prepares and validates the complete write, and the Host settles it atomically against the recorded Git baseline. Deprecated `write_design_json`, `edit_design_json`, and `save_design_state` tool names are not part of the public surface; the Producer uses scoped file operations plus explicit validation and finish operations.

Managed versioning uses the shared Core library-Git implementation, rather than
requiring a system Git executable. Project creation and inspection, immutable
reads, publication, index maintenance, history and diff use the same facade in
each Host. Native calls run in owned workers, outside the Host event thread and
browser UI. An explicit CLI diagnostic backend remains available; a missing or
failed native capability never silently selects it.

Published byte identity belongs to the immutable Git blob, not to a checkout of
that blob. Committed artifact reads inspect object headers before allocating
bounded raw blob bytes, verify the object hash, and retain regular-file and path guards. Git attributes,
checkout filters, local `core.autocrlf` and host text decoding cannot change the
versioned evidence or the same-event replay comparison. An adapter without raw
byte capture reports that capability failure instead of returning decoded data.

The successful HEAD compare-and-swap is the content publication boundary.
Ordinary-index synchronization is subsequent maintenance: it holds only a lock
created by that operation, preserves unrelated and newly staged entries, and may
report a bounded `indexMaintenance: deferred` receipt without revoking the
commit. It never removes somebody else's index lock or changes Git configuration.
Journal settlement and committed diff projection are separate follow-up facts.
An ordinary index representation that the library cannot preserve losslessly is
left byte-for-byte intact and reported as deferred maintenance, rather than
rewritten or made a second authority for design publication. I/O and cancellation
errors are not reclassified as unsupported formats. Status queries reject an
unsupported representation when its flags are necessary to report truthful state.

History traversal and historical message decoding preserve the version identity
and audit lookup semantics. Textual status and diff are presentation projections:
renames can appear as deletion plus addition. For a merge commit, the library
returns a separately labeled unified diff against each parent, with exact parent
and result commit ids, instead of reconstructing Git's dense combined format.
An unchanged parent comparison is explicit when another parent has changes;
no changes within the requested scope return an empty diff. Diff alignment and
optional function-name hints can differ from a system-Git rendering. File paths,
modes, content changes and parent/result identity remain the versioned facts;
Hosts must not reconstruct a separate Git interpretation.

Agents use the shared read-only `design_git_read` capability for project status,
history, differences, tree listings and historical files, through the same Core
Git facade rather than requiring a system Git shell. Reads resolve an authorized
Design Project and exact checkpoint. Bounded pages identify how to continue;
history pages retain their original checkpoint even when HEAD advances. A page
limit is not a limit on the project's accessible history, and truncated data
must not be presented as a complete result. This capability grants no arbitrary
command, write, rollback, branch switch or publication authority.

Post-publication Journal or diff-projection failures retain the exact committed
receipt and recovery stage; they cannot be reported as pre-commit rejection.
An exact event replay can reconcile its
original commit against the original baseline without writing again, while a new
publication still rejects a stale baseline. Changed canonical bytes, artifact
bytes or a declared complete artifact set cannot reuse that event. Host adapters
deduplicate Journal facts and completed finish receipts. A Producer repairs its
Bundle content, not repository configuration, locks or the host environment.

DSH retains the accepted publication inputs after closing content mutation
authority. Its shared main/Producer publication controller makes one bounded
Host-side attempt to recover pending Journal/diff facts in the same invocation,
without another model turn. An exact retry may consume the same pending receipt;
it cannot change the outcome, reopen file writes, or regress a newer project HEAD.
Journal deduplication applies to both agent and panel origins and does not skip a
notification that failed after the fact became durable. Persistent failure stays
visible in the enclosing committed revision/handoff result. Disposal revokes the
invocation's recovery capability; this is not a background or process-restart
recovery service.

The Producer uses Host-native file semantics through a Design Project capability: it can read the complete selected project and mutate only the current Bundle's canonical state and declared artifacts in the invocation-local working copy. The capability exposes no unrestricted Host working-directory authority. A Host adapter that cannot grant equivalent project-scoped operations must fail before the Producer starts. Delegated Workers receive exact-path read/write/edit operations for one pre-bound Bundle artifact and never canonical JSON or publication authority.

The common project operations are `new`, `open`, `list`, `status`, Kit selection, checkpoint inspection, and `close`. DeepSeek Harness exposes them through `/yugoo`; future Codex and Claude Code adapters must route their native command, Skill, or MCP entry to the same project service. Presentation and command syntax may vary by host, but project identity, metadata, Git behavior, validation, and Design File paths do not.

## Kit and Bundle model

A **Design Kit** is a coherent, declarative design method for a domain. A Kit contains its Mindset, an ordered set of Bundle bindings, Kit-level resources and relationship mappings. The local library maintains current saved content; each project uses a complete project-owned copy. A Kit and its Bundles are runtime-loaded content, not Cordis plugins.

A **Design Bundle** owns one design facet. It owns its model instructions, persisted state definition, semantic validation, presentation selection, model-facing summary, and any execution or artifact requirements. Its namespace-qualified identity is independent of every Kit that uses it. The library stores its current saved content; an upstream version, when present, records provenance rather than a local release history.

The Mindset is the design reasoning and Bundle-selection layer. It does not hard-code a mandatory design sequence. The current user request, explicit authorization, available evidence, and active runtime state take precedence over gap-based suggestions. An output may nevertheless declare evidence required by its own completion definition: the Web App Page Design result is high-fidelity HTML, so a Page request without an active visual result also requires the main Agent to establish one unconfirmed Design Style baseline in the same attached request. The owning Producers remain separate, and Core does not encode this Kit-specific relationship.

Every active Kit participates in one host-neutral design progression loop. When the user has not selected a concrete result, the main Agent identifies the earliest missing evidence that would make downstream work unreliable, recommends one to three applicable Bundles from the active Kit, explains the different evidence each would add, and waits for selection. A completed Bundle returns control only after its committed revision's synchronous clarity assessment settles; the main Agent consumes the newly projected Design Files and returned assessment and states what landed. The Agent may invoke another Bundle in the same turn when the current user request explicitly requires more Design results; each invocation remains attached until terminal settlement. Otherwise it recommends another Bundle only if the next move remains open and the completion result carries current clarity. A real user-input gate ends the turn. Gap assessment never overrides a direct result request, authorization to use reasonable defaults, or a rejected method.

### Flat Bundle catalog and Kit composition

Bundles form one logically flat, searchable library. Membership is many-to-many:
a library Kit binds stable Bundle identities without creating another Bundle.
`kit.yaml` owns the ordered bindings; the Mindset's `<design_skills>` section is
its model-facing projection. Each binding preserves its runtime name, optional
configuration and relationship mappings. Duplicate runtime bindings and genuinely
unresolvable execution dependencies are diagnosed by the compiler.

The library stores one current saved state per identity. Editing updates that
state in place; an explicit Copy creates an independent identity and preserves the
original. Saved edits apply to new consumers without a publish, version bump or
remount operation. An upstream version can remain as provenance; local edits do
not claim a new upstream release. Internal revisions/hashes support concurrent
saves and cache invalidation, not a user-facing version registry.

A project materializes the complete selected Kit and its mounted Bundle trees in
`design_kit/kit/` and `design_kit/bundles/<identity>/`. Methods, schemas, validation,
Panels and resources all resolve from those project files. A library change or
removal does not mutate existing projects. Kit copies in the library still share
Bundle bindings; project initialization copies the complete closure, which is a
different operation. Binary resources, nested files and existing provenance are
preserved. Native executable contributions remain installed provider capabilities;
copying content does not install or authorize code.

Studio saves can retain incomplete definitions. Preview or execution reports the
specific missing or invalid input needed for that operation; unfinished authoring
is not forced through a publication workflow. Complete Kit transport includes its
Bundle closure. Import/export and local editing are separate from product npm
publishing and public-source synchronization.

### Common Bundle requirements

Every Bundle provides the semantic equivalents of:

- `SKILL.md`: model operating instructions and close-out evidence;
- `skill.yaml`: identity, labels, execution policy, explicit presentation selection or `none`, and required capability identifiers;
- a persisted-state schema;
- state and completion validation, plus optional artifact-local validation run by
  the Producer or an exact-path delegated Worker;
- optional ordinary `.mjs` scripts under that Bundle's `scripts/` directory for
  domain generation, validation, normalization, or repair performed by its Producer.

The standard content representation uses `schema.yaml` and `validation.yaml`. These are Harness-safe translations of the SDK responsibilities, not claims that the SDK uses YAML. A translation is acceptable only when its observable state, defaults, invariants, validation timing, and failure behavior match the source semantics.

Presentation, execution, and artifact files are conditional rather than universal Bundle slots.

## Panel model

An interactive Bundle selects exactly one presentation mode: `native`, `declarative`, or explicit `auto`. A Kit may contain different modes without changing its design data or execution placement.

A Bundle may omit `presentation` or declare `presentation.mode: none`. Both mean no panel; the loader normalizes omission to `none`, the host omits its panel tab, and the server uses a bounded generic summary for model context. Auto presentation is opt-in, not a fallback for an omitted declaration or a missing native renderer.

### Prebuilt React panel

A Bundle with `presentation.mode: native` references a versioned client-panel
contribution registered by a separately installed provider plugin. The Bundle
owns its Skill Body, schema, validation declarations, delegation schemas,
ordinary scripts, and artifact procedure. The provider owns only the compiled
native presentation and its UI hydration/dehydration. Generic Core supplies
Bundle-scoped files, confined script execution, generic delegation, validation
plumbing, and atomic publication without interpreting Bundle domain fields.

The official Web App Kit's members are declared in its [exact Bundle mount list](../packages/skills-web-app/kits/web_app/kit.yaml). Their active presentation modes are determined by their exact loaded manifests, not by a fixed Bundle or native-panel count. Declarative migration and installed-package parity remain release acceptance items; delivery status belongs in the [standalone roadmap](standalone-roadmap.md).

A Bundle using native presentation does not require `panel.yaml` or `renderer.md`. Its manifest names the required trusted contributions. Kit publication fails when a contribution is absent, incompatible, or registered for another Bundle authority. Native presentation never silently falls back to the declarative interpreter.

### Declarative panel

A `declarative` Bundle provides `panel.yaml` and may provide `summary` in `skill.yaml`. The generic compiler validates the panel and any explicit summary against the Bundle schema and the Kit catalog before publishing a version. The generic client interpreter renders the panel; optional summary rules produce derived model context, not a separate authoritative Design File or KAG source. Omitting summary does not block Bundle loading, execution, Panel save or publication: Agents can read original Design Files as needed. Invalid explicit summary declarations still fail validation. Legacy `renderer.md` is readable during source migration but cannot coexist with `summary`; new content uses only the manifest block.

The declarative interpreter is a runtime default, not an author-configurable
choice: `skill.yaml` needs only `presentation.mode: declarative`. Native
presentation still requires an explicit trusted contribution id. Bundle
capability descriptions are authored once in `SKILL.md` frontmatter; Studio
and Agent routing use that source without a second manifest description.

This is the default path for user-authored Kits because content versions contain no executable code and can be validated and hot-loaded. A missing component, field path, cross-panel reference, renderer source, or required driver rejects the candidate version rather than producing a partial panel.

Official future Bundles may also use declarative presentation when the component library expresses their interaction faithfully. Being official does not imply native presentation, and being declarative does not imply third-party ownership.

### Generated panel

An `auto` Bundle declares neither `panel.yaml` nor `renderer.md` and does not
name a renderer. The system generates a validated A2UI presentation from the
Bundle's output schema and current design artifacts using the shared component
catalog. Generated UI is data, not permission to execute arbitrary frontend
code. Until a usable specification is ready, the panel exposes an explicit
generation or unavailable state with read-only source access. Generated
presentation does not change schema validation or publication authority.

## Foreground design loop

The main Agent follows one host-neutral, user-directed, gap-driven loop. It helps the user think by exposing contradictions and the root evidence gap, express the product through the most useful available aid, and align only on explicit decisions or persisted Design evidence. Questions, research, modules, flows, and visual work are alternative aids rather than mandatory stages. Silence, an old artifact, and the model's own assumptions are not alignment.

The shared host prompt owns request precedence, authorization and rejected methods, the causal U/S/T evidence model, and post-Bundle close-out. It traces weak downstream structure or testability to the earliest missing evidence rather than routing mechanically from the lowest score. A Kit Mindset only calibrates domain evidence and ranks genuine alternatives. A Bundle owns its production method, validation, and handoff. Host-specific phase routing, response markup, suggestion buttons, and development-mode transitions do not belong in this shared prompt.

## Execution and lifecycle

Each invocation resolves `execution.mode` once: `subagent` (the default) uses
an isolated Producer attached to the calling main-Agent turn; `main` runs the
same Bundle in that existing conversation. The executor reads the selected
Design Project, authors the Bundle working copy, validates and repairs its
work, and settles publication through Design System operations. In main mode,
the initial tool returns `in_progress` with the scoped method installed;
`design_publish`, not the end of the main response, establishes settlement.
Placement changes neither output contracts, file permissions, optional Worker
fanout, logs, validation nor handoff. It cannot change during an invocation.
Unsupported placement fails explicitly rather than silently switching modes.
Workers retain exact-artifact ownership, never canonical JSON or publication
authority. Foreground work remains attached until the executor, its children,
and settlement reach a terminal outcome; it never becomes detached advisory
work. The manifest declares real human interaction points such as `must_edit`
or `user_continue`, not a Worker topology.

An ordinary Bundle script is executable only through the Host's confined
`run_skill_script` capability. The Host binds it to the active, version-pinned
Skill `scripts/` directory and supplies literal argv. The selected executor names either
a small structured input or a project file; the Host transports file bytes to
the process internally and can write successful generated output directly back
to an explicit Bundle-owned path. Scripts never receive Design Files or Git
authority. The selected executor inspects compact receipts and diagnostics and repairs
failures through its Bundle-scoped WorkingCopy.
Exact-path Worker assignments are explicit generic delegation calls authored by
the selected executor from the Skill Body. The selected executor chooses task decomposition and
concurrency, while Core only binds the requested artifact identity and path,
tracks the native attempt, and returns a file receipt.

The shared runtime supplies the current user brief, bounded conversation evidence, current Bundle state, complete Kit-projected Design state, exact version-pinned resources, and a project-wide read/current-Bundle write capability to the selected executor: the isolated Producer in subagent placement or the existing main Agent in main placement. Validation diagnostics return to the Agent that can repair the rejected material: artifact-local diagnostics return to the same delegated child, while integration and completion diagnostics return to the selected executor. A failed child is only an observation; the selected executor may repair, delegate again, proceed serially, revise the plan, or report a real failure. The main Agent cannot bypass Design persistence with Host filesystem or shell tools.

Page Design fixes one `common_spec` before generating Page artifacts. The persisted spec contains the shared application shell, main Logo, ordered navigation menu with Page targets, and shared component treatments; its source is always the active Design Style result. `design_style` remains the only visual-language authority, and Page Design never copies its palette, typography, spacing, radius, shadow, or motion values into `common_spec`. When no valid Design Style state exists, the main Agent first runs Design Style to publish an adjustable, product-specific baseline and expose its panel, then resumes the already requested Page Design work in the same foreground turn. Page Design cannot publish a provisional map or unstyled HTML.

Page authors own the page map, evidence references, and which Pages require generation or replacement. Each Page keeps its accepted HTML path in `artifact_file`; one Producer publication versions that reference and its file together. The Producer may delegate independent Page files. Each Worker writes and validates its exact path; the Producer consumes the file receipt and obtains compact hotspot bindings through the file validator rather than reading the complete HTML again. It then updates canonical refs and remains responsible for cross-Page consistency and completion. A failed or running replacement leaves the previous authoritative prototype visible. Queued, running, and cancelled states are Host lifecycle observations projected transiently to the Panel and never form a generic revision ledger.

The Page Producer gives each optional Page Worker the same resolved visual tokens and `common_spec` together with the Page map, assigned functions, and relevant upstream evidence. The Producer can generate the same Pages itself when delegation is unavailable. Each Page is one complete, self-contained HTML document with a single application shell and Page-specific content. The common spec is a cross-Page design input rather than an HTML template or assembly artifact: it fixes navigation items, labels, order, Logo, layout direction, and shared component language without introducing Foundation, fragment, slot, or nested-shell mechanics. Page validation rejects token redefinition, unknown token use, hard-coded visual values that bypass the projection, missing navigation labels, and missing Logo wordmarks.

`handoff: must_edit` pauses after persisted production. The authoritative panel save commits the edited state and does not return success until that exact version-pinned handoff is recorded as consumed. An exact retry after a post-commit persistence failure reconciles the existing commit and missing consumption idempotently. The client may open a following main-Agent turn to reassess the saved diff and recommend the next action, but the main Agent does not call the same Bundle again merely to release its gate. `handoff: user_continue` exposes one server-owned action whose Host-owned conversation interaction and accepted conversation command resolve to the same pinned continuation. The workspace projects that real Runtime gate from the current Git publication and DesignJournal authority; the client never infers it from Bundle JSON stages. A Bundle panel never renders a second resume control.

Validation occurs inside the selected executor's lifecycle, in either main or subagent placement. Working-copy edits are visible filesystem facts but are not a publication. An optional Worker repairs and revalidates its exact artifact before returning a file receipt. The selected executor integrates that receipt without re-reading or retransmitting large artifact bytes merely to record completion. It reads a landed artifact only when its content is a real input to downstream synthesis or repair, and otherwise uses file-path scripts for compact validation or metadata. At publication, the trusted Provider contribution's `preparePublication` operation first normalizes state and materializes deterministic or Host-owned artifacts without writing Design Files; schema, state, completion, ownership, and cross-Bundle validation then evaluate that prepared write; private dependency pins and the project revision are rechecked immediately before the atomic commit. Validators report facts and repair targets without choosing delegation, retry, or regeneration policy. A handoff gate controls continuation of the existing workflow; it never prevents a new user instruction.

The main Agent's generic filesystem or shell tools do not grant Design write
or publication authority. During a main-placement invocation it uses the same
scoped Design operations as a Producer: selected-project reads and
current-Bundle working-copy mutations. Optional Workers receive one exact
artifact path plus declared evidence tools and resources. The Design System
validates and commits the executor's accepted publication beneath the selected
Design Project; the Agent Host working directory is neither Design ownership
authority nor a fallback path.

Model reasoning is not user-facing design output. Hosts may retain provider reasoning blocks in their durable execution log and developer trajectory, but the ordinary conversation renders only final text, tool activity intended for the user, Design progress, and explicit advisory output. A provider response that places reasoning markup or an internal planning transcript inside an ordinary text block violates the model-adapter response contract and is rejected or normalized at that provider boundary; Bundle prompts and UI components do not guess at leaked reasoning.

## State, events, and versions

Design Files are the authoritative state of the designed product. Each Bundle owns its canonical JSON and related artifacts. Large artifacts remain files referenced by canonical state rather than being duplicated into session events or panel payloads.

Reusing a Bundle definition never shares runtime design data. Canonical state, transient working copies, and artifacts are isolated by project or session, exact Kit version, and `bindingKey`; the global Bundle identity addresses behavior and content, not one shared instance of product state.

Runtime paths, panel routes, and state mutation events address the Kit-local instance by `bindingKey` and also carry the qualified Bundle identity and version for provenance. A binding key remains stable across compatible Kit upgrades. Changing it is an explicit remove-and-add operation that requires a reviewed state migration; it is never interpreted as a transparent rename.

The Agent Host log is the authority for conversation execution and model-visible interaction changes. Design System state does not require Host-specific Session event types or projections. The authorities for the five former DSH custom events are:

| Former event | Current authority |
|---|---|
| `design/project-selected` | The binding store's active `{hostProvider, conversationId} → projectId` record |
| `design/project-unselected` | Absence of an active record, with the binding store's own durable replacement or removal audit |
| `design/project-loaded` | A derived snapshot read from the active binding, `project.json`, exact Kit version, Design Files, DesignJournal, and knowledge provider |
| `design/kit-selected` | An audit DesignJournal fact recording the exact Kit identity and version checkpointed in the selected project's `project.json` and Git history; selection authority lives in the project pin |
| `design/changed` | The validated Design Project Git checkpoint and its DesignJournal change reference |

The DSH provider records model-visible Design context through standard `agent.inject()` inbox and Session behavior. When Bundle policy or the Agent requires an in-turn blocking native ask-user interaction, the Host Provider exposes `ctx.userQuestions`, whose question and answer use standard tool call/result logging. Persistent asynchronous continuation instead appears in the plugin continuation UI; accepting it submits an ordinary logged user turn. Durable advisory dispositions belong to the project; acceptance may submit a separate ordinary instruction to the main Agent. `report_design_clarity` validates ordinary report content and project/version input, saves the project record, and returns it through the ordinary tool result. It does not authenticate its caller by reverse-searching the Host log. The Panel reads that same current record. Project records travel with Git; native conversation execution remains the Host's responsibility.

Selecting a Kit initializes the project's own complete definition tree and
records the source identity in project metadata. Later reads use that tree,
including after restart; they do not fall back to newer library content. When
opening an older project without this tree, its actually retained exact closure
and overrides may initialize it once. Missing or corrupt source is reported
explicitly instead of inventing a replacement.

Updating a project's definitions is ordinary Agent work over its project files:
compare the current library with project content, preserve user customizations and
saved facts, edit the required files and check the affected Design Files. Existing
file and Git operations provide persistence and history. This does not introduce
an upgrade wizard, separate migration transaction or a universal migration gate.
A saved project definition is used on the next read/invocation. An active invocation
must not combine methods from one definition with schema or resources from another;
real concurrent changes are reported at the existing consistency boundary.

Design Files, artifacts, Git history, and DesignJournal catch-up use a recoverable ordered protocol rather than a cross-store transaction. A Bundle settlement validates and commits Git, then appends the matching DesignJournal change reference before reporting success. Journal settlement failure fails the execution while the Git checkpoint remains authoritative and recoverable by retry or later reconciliation. A process crash or asynchronous persistence failure must not make an uncommitted worktree state authoritative. Reads and writes remain confined beneath the Design Files root even when hostile symlinks or path components are present.

Pure content may reload without restarting the Harness process after a complete candidate is validated. Changes to compiled React panels, Producer contributions, artifact code, dependencies, exports, or plugin composition require a rebuilt plugin and the lifecycle restart required by Harness.

## Grounding, reflection, and alignment

The DesignGraph is an AI-maintained design knowledge graph. Its entity and relationship types are open, namespaced Design System identifiers rather than a closed product schema. A Kit may declare mappings for structured Bundle records, while a free-canvas Bundle may introduce additional types for diagrams, tables, annotations, and their design relationships. The generic runtime owns only identity, evidence, lifecycle, provenance, revisions, and bounded mutation and query semantics.

The DesignGraph does not duplicate the complete design process. Agent steps, tool calls, worker attempts, ordinary chat turns, temporary candidates, and user-interface activity remain in the session, workflow, or telemetry logs. A process fact enters the graph only when it has durable value for a later design decision, has a stable evidence or product anchor, or must participate in impact, contradiction, coverage, or lifecycle analysis.

Graph syntax is generic; design semantics are Kit- and Bundle-owned. A Grounding Agent may infer additional evidence-anchored entities and relationships while reading scattered Design Files, but every mutation retains its producer, source revisions, confidence-bearing properties, and stable Design System ids. Rich source artifacts such as BPMN, HTML, visual tokens, documents, free-canvas diagrams, and complex matrices remain in their owning Bundle and are referenced from graph records.

`DesignKnowledgeService` is a Design System capability, not a second product-design authority. Native Design Files remain the facet authorities. The project's portable knowledge archive preserves AI-maintained relationships, findings and source references; its project journals preserve explicit human accept, reject, defer and supersede decisions. These records travel with Git. The local graph database and vector index can be discarded and rebuilt from those files and native design sources; they must not be the only place an accepted insight or decision exists. A cache must not silently overwrite a Git-restored project archive with newer machine-local data.

G/R/A, impact analysis, and the Alignment Workspace use bounded provider-neutral reads such as query, trace, and impact. A separate projection/materialization lifecycle owns graph deltas, rebuild, and decision projection; it does not expose mutation authority to review profiles. Studio remains a separate catalog, current-source editing, validation and preview capability; Studio-level advisory profiles may consume Design Knowledge without making the Studio repository part of the graph. Raw SurrealQL, Cypher, database record ids, and provider-specific indexes never cross the knowledge API. The experimental default local provider is LadybugDB's Node WASM build, with one persistent database per Design Project under its external runtime state root. It must pass the shared provider conformance suite and real Node 22 Linux, macOS, and Windows gates before the experimental qualifier is removed. Ladybug Native is an optional compatible-host optimization; SurrealDB remains an optional future provider rather than a fallback after failing the initial embedded transaction and current-host packaging gates. A configured Neo4j provider may serve remote team deployments. Provider changes are explicit pause, export, import, validate, switch, and resume operations. There is no silent fallback, dual writer, or dual authority.

File projection and complete semantic publication have separate read guarantees.
An embedding failure does not invalidate already projected source facts. Ordinary
Companion Knowledge context and pinned queries may expose a source-only view of
one existing provider revision after comparing every projected entity and relation
with the complete pinned source set through the original projection rules. Equal
node checkpoints alone do not prove that a projection completed. Empty,
incomplete, mixed, or stale projections remain unavailable. This read creates no
projection, publication pointer, or alternative graph authority.

Source-only context reports its original source checkpoint, graph revision,
bounded coverage and the unchanged Knowledge status. It includes file-derived
records, explicit references and literal-text evidence; it excludes semantic
candidates and other non-file interpretations. A semantic maintenance failure
remains `failed`, and an older latest-complete publication keeps its original
pins and freshness. Ordinary source availability never marks semantic publication
`current` or relaxes the complete-publication guard on advisory review capture.
The derived read basis travels with Companion query pins so a source view cannot
silently become a mixed or complete view after later publication. Existing
unqualified historical queries keep their read contract and are identified as
historical snapshots, without asserting current semantic completeness.

Grounding, reflection, and alignment are the three advisory review profiles; impact analysis supplies affected-context discovery:

- Grounding checks cross-file consistency. It reports a correction only when at least two Design File facets disagree and an existing authoritative Design File fact makes the repair deterministic; the affected owning Bundles remain the only normal write path.
- Reflection checks whether consequential design choices rest on doubtful domain knowledge, industry practice, regulation, market facts, or external product behavior. It recommends bounded investigation only when external evidence can materially resolve that uncertainty; the main Agent chooses a suitable Bundle or host-native retrieval.
- Alignment identifies consequential product decisions that remain genuinely ambiguous and can be resolved only by the user. The main Agent chooses a suitable Bundle or host-native questioning; the review does not own question or answer state.
- Impact analysis selects the affected graph neighborhood after a change.

All three review profiles investigate the pinned Design Project checkpoint with read-only file and Git tools. They do not depend on prompt-injected file bodies or KAG availability. A Design State summary or KAG query may accelerate discovery when available, but every finding is verified against published Design Files. KAG does not establish decision authority. Review Agents have no graph-write tool; optional evidence-backed relationship observations are returned through the review result and validated by the runtime as described below. The profiles have no shared issue taxonomy, owner-arbitration phase, aggregate review transaction, or inter-loop state machine.

These profiles produce bounded reminders and suggestions. They never silently rewrite authoritative design state. After a human accepts a recommendation, the host submits its acceptance instruction as ordinary user-authorized input to the main Agent, which uses the normal Kit, Bundle, validation, and persistence mechanisms. Inferred relationships remain marked as derived with their method, model or rule version, confidence, sources, and input revisions.

`ground.json` and `accepted-assertions.jsonl` are migration inputs, compatibility exports, or temporary file-provider storage only. They are not required project files and do not remain online authorities beside a graph provider. A provider-neutral archive may contain a manifest plus entity, relation, proposal, and decision records for recovery and migration; agents never maintain that archive as the live graph. Proposal decisions bind both the source-provider revision reviewed by the human and a provider-neutral proposal digest. Import validates the digest, remaps provider revisions explicitly, and preserves Design System identities and journal decisions rather than pretending two providers share revision ids.

Question delivery remains an ordinary main-Agent action. After accepted Alignment or Reflection advice, the main Agent revalidates current necessity and respects rejection and deferral. Optional `review_support: [alignment, reflection]` Bundle metadata supplies non-exclusive candidates, not bindings or permissions. The Agent considers the current catalog and methods, then records a suitable Bundle, host-native question/research, or a reasoned no-action choice. A missing or unsuitable candidate never forces a Bundle invocation. Acceptance grants no Design File write authority: selecting a Bundle resolves one exact current Kit/Bundle/version target and action receipt through the shared journal before ordinary execution. Host-native choices mint no Design write receipt and do not themselves prove that investigation or questioning completed. Grounding retains its affected-owner routing. The advisory subsystem neither duplicates Bundle question state nor branches on a Bundle name.

Only user-provided or explicitly confirmed answers can become `human_confirmed` evidence. Answering a question does not authorize a background advisory profile to modify another Bundle's Design Files.

### Background design Agent execution

Grounding, reflection, and alignment are Kit-neutral capabilities installed with the Design System integration, not Bundles or optional members of a Kit. Their ordinary background runs leave the foreground conversation available and inherit the primary Agent's active model route, credentials, authentication, permissions, and tool infrastructure; the Design System does not select a separate advisory model. Background completion never gates the foreground conversation. When non-blocking background execution is unavailable, only the explicit user choice described below may authorize a one-time foreground review. Their output is advisory and safe to discard or recompute; partial output is never authoritative.

The Design System owns the profile instructions, bounded input and output schemas, exact input pins, budgets, stale-result checks, and advisory projection. A host or standalone runtime owns model inference and its internal model-to-tool loop. The three profiles share host-neutral `AdvisoryDeliveryPort` and `HumanAttentionPort` interfaces so their semantics do not depend on DeepSeek Harness.

Each result names its exact authoritative input revisions. If an input changes before delivery or acceptance, the result is stale and may be recomputed. Selecting or closing a Design Project cancels scheduled or running analysis for the previous selection and clears that Host conversation's derived Design, clarity, scheduler, and advisory views before the new project's checkpoint-pinned evidence is loaded. No evidence, pending advice, or scheduler status from one project may appear as evidence for another. Scheduling, debounce, coalescing, and retry are adapter policies that can evolve through product tuning; the durable product object is the advisory, not a second general-purpose workflow state machine.

An accepted Design Files write and its matching DesignJournal `design/changed` fact mark the latest Design Project revision dirty for detached Grounding, Reflection, and Alignment analysis. The DSH adapter waits until the authoritative change burst has remained quiet for its configured window; a newer revision resets that window and cancels obsolete analysis. Each review reads the published Git commit recorded by its target revision, never the live worktree. Foreground Design production therefore does not block review of the preceding completed revision and its unpublished bytes cannot enter the evidence set. When `run_design_skill` is still attached, its Bundle name and brief are supplied only as transient activity context, not as an exclusion rule or Design evidence; earlier completed content from that same Bundle remains reviewable in the pinned commit. One Bundle publication may cover many files, and several publications in one attached foreground turn coalesce to the latest revision rather than scheduling per-file reviews. Each profile still owns an independent latest-wins loop, explores the pinned Design Files commit with read-only Git commands, performs its own stale checks, and publishes its own result without waiting for either sibling. Raw filesystem activity, temporary artifacts, and uncommitted Worker output never trigger or enter review. Project, Kit, Design, and commit pins suppress only the result whose input became stale. Profile enablement and budgets remain deployment tunables. The Design Core always owns the gap-driven foreground loop.

The scheduler isolates each configured profile run. A Grounding, Reflection, or Alignment failure is recorded as a bounded profile error while the remaining profiles continue against the same pinned input. `/yugoo status` reports the installed profile roster, scheduler phase, last successful publication, and bounded last error; an absent scheduler is reported as unavailable rather than as an idle healthy runtime.

G/R/A review execution receives only non-mutating investigation tools. Optional
access to `DesignKnowledgeService` is read-only. Advisory publication and human
disposition are recorded in DesignJournal; an accepted Design File change still
runs through the owning Bundle's ordinary executor, validation, and publication
path. The separate KAG projection lifecycle owns saved-record entities.

A review may also return bounded `knowledgeRelations` or explicit
`knowledgeRetractions`. These are optional derived maintenance, not Design File
writes or human confirmations. After advisory settlement, the runtime may
publish observations through its serialized, checkpoint- and generation-fenced
knowledge operation. Both endpoints must be existing saved Design records, with
quotes verified against their pinned fields and relation semantics validated
against the active vocabulary. Observations remain `proposed`; they cannot
replace projection-owned containment or invent requirements from unanswered
questions or prior recommendations. Retraction is restricted to the same
profile's unchanged proposed review relationships and retains an audit record.
Empty output does not clear relationships. A writeback failure must not suppress
the settled advisory or keep its profile running; it does not confer graph
mutation authority on the review Agent.

Host capability negotiation selects the first usable execution mode:

1. **Native detached** uses a programmatic background Subagent facility supplied by the active Agent Host. The DeepSeek Harness adapter is the reference implementation and starts DSH Subagents from the Design System scheduler, outside the main Agent tool call.
2. **Cooperative background** packages Design System Skills, Agent definitions, prompts, and MCP tools that instruct a capable CLI Agent to launch its own background Subagent. The adapter reports this mode separately because model cooperation is weaker than a programmatic spawn guarantee. A host-specific integration may upgrade to native detached mode when its stable public API supports it.
3. **Standalone Pi** runs the same advisory profiles through an embedded Pi Agent runtime only after the user explicitly configures a model provider and credential for the Design System. It supports an independent Studio, unattended execution, and hosts without a usable background facility; it is never activated implicitly.
4. **Queued unavailable** retains the request until a runtime becomes available. The system never silently falls back to a foreground Subagent that blocks the main conversation.

All execution modes inspect the current filesystem and Git history, retain lifecycle pins for stale-result rejection, and return the same strict advisory outputs. Background review Agents cannot write authoritative Design Files, Question Bundle state, or KAG. A formal design change enters only through the main Agent's ordinary validated path after human confirmation or an explicit recorded delegation policy.

### Explicit foreground GRA fallback

The shared source implementation adds a user-confirmed manual review path when
background execution is unavailable or a
native asynchronous run still occupies the main conversation.
Present **Disable automatic GRA** or **Run this review synchronously in the main
conversation**, explaining that the latter occupies the conversation. No choice
means no policy change and no review. The first choice reuses the existing `off`
policy, which continues to permit explicit manual review.

An explicit foreground request uses the existing manual review operation for
one batch. The main Agent reads the same Grounding, Reflection and Alignment
profiles and submits their results without requiring a synchronous child,
background readiness probe or native run descriptor. Preserve the shared input
pins, result schemas, stale-result checks, advisory persistence and Git history;
review itself grants no authority to change Design Files. Do not create a second
model client, durable consent ticket or permanent automatic foreground policy.
Manual review retains its asynchronous path and exact native binding
requirements when the host leaves the main conversation available. U/S/T remains
main-Agent assessment and KAG retains its separate projection/maintenance lifecycle.

The fixed shared implementation has passed focused source regressions; package
delivery and actual host acceptance remain separate and are not established by
those tests. The version-specific reason for the current QwenWork limitation is
documented in its [owning guide](../packages/companion/hosts/qwenwork/README.md#qwenworkcn-132-background-agent-policy).

### Main-conversation notifications

Background output returns to the originating conversation as human-facing design assistance rather than a silent mutation. Grounding produces cross-file correction suggestions, Reflection produces bounded Research suggestions, and Alignment produces clarification reminders for the main Agent. Each result is persisted independently. The host may render the current journal entries through one aggregate, non-waking projection for the next natural model-context boundary; that projection is a display/read-model convenience and never turns the loops into one transaction.

Advice that needs a decision also appears as a proactive review card. In DSH Web, each pending advisory is a separate non-modal card above the composer rather than content inside the Design Panel. When the main Agent asks the user to choose the next Design action and current advisory cards exist, the host-native question reserves one option for reviewing the current advisory set and offers at most two Bundle choices beside it. Selecting that option only exposes review; it accepts nothing and runs no Bundle. Rejecting or deferring a card does not wake the main Agent. Accepting a card submits one bounded, self-contained instruction containing the accepted review items through the host's authenticated user-input path, which records the action and may wake the main Agent; the advisory is marked accepted only after that submission succeeds. This preserves timely interaction without granting the background analysis its own execution authority. Completion never interrupts a model response already in progress or injects unbounded worker transcripts into the main context.

Every model-visible advisory is recorded by the Agent Host's conversation mechanism and is reconstructable from its Design System journal record and pinned inputs. DSH uses its non-waking Agent inbox for model delivery and its composer review cards for human attention. An active Codex or Claude CLI adapter may use the host's native user-question interaction; without an active interaction surface it queues the request for the next session boundary instead of inventing an out-of-band confirmation. Adapters preserve each accept, reject, and defer decision. When several acceptance receipts reach the same natural main-Agent boundary, the Agent revalidates them together, drops resolved items, and merges overlapping work by affected Bundle and entity into one revision plan; a later receipt arriving during attached foreground Design work waits for the next boundary. Acceptance records authority separately from applying a change, and only the subsequent validated write creates authoritative design state.

Autonomous Agent design still produces rationale nodes, but never stores hidden reasoning or chain-of-thought. It records the evidence used, explicit assumptions, material alternatives, selected decision, affected product entities, confidence, unresolved questions, producing Agent or workflow, and exact input revisions. Decision authority is explicit: `agent_proposed` awaits approval, `agent_selected_under_policy` was selected within a recorded delegation, `human_confirmed` was explicitly approved, and rejected or superseded decisions retain their lifecycle state. Autonomous execution never implies human confirmation.

The graph provider remains an implementation choice. An embedded provider may optimize the local desktop experience, while a remote provider may support a shared team service. Provider choice must not change Bundle semantics or make graph storage authoritative.

## Trust and extension rules

- Kit content is data. A watched or third-party Kit cannot execute JavaScript, TypeScript, Python, shell commands, or package-local binaries.
- Prebuilt panels and executable behavior are trusted code shipped by provider plugins and registered through explicit versioned identifiers owned by one Bundle contribution.
- A content package cannot claim an official contribution or obtain its capabilities by copying an identifier. Provider installation establishes trust; Kit content only references the installed identifier.
- Native and declarative presentation are explicit modes. Unknown native contributions and invalid declarative definitions fail loudly.
- Generic runtime and declarative tests use domain-neutral fixtures. Official Web App behavior is tested through its trusted Bundle providers.
- Model tools cannot write arbitrary graph queries or bypass Design File validation. Graph-facing model access is read-only unless a dedicated, validated Design System operation grants a narrower mutation.

## Distribution and customization

### Design-to-development handoff

Development consumes the Design Project as evidence, not as an instruction to
implement every generated artifact. The first handoff is a task-scoped reading
and decision procedure using existing project files, checkpoint inspection,
Host read tools and, when available, the shared KAG query. It does not require
a new Kit schema, a second requirements database, or a separate coding runtime.
This is the handoff contract; the fresh Coding Agent acceptance story remains
open in the release checklist.

For an explicitly requested development task, the receiving Agent:

1. Identifies the selected project, its exact Kit pin and published Git
   checkpoint, then states the requested outcome and exclusions. Dirty files
   are disclosed separately, never silently mixed with that checkpoint.
2. Discovers the Kit's actual Bundle schemas and relevant source records;
   it does not assume Web App filenames in another Kit. It reads the smallest
   coherent slice covering the user's operation, participating objects,
   constraints, permissions, transitions and visible feedback. Missing facets
   are recorded, not fabricated to complete a template.
3. Uses a bounded, version-pinned KAG query to locate related sources when
   useful, verifies the cited records and artifacts, and preserves source
   paths and record identifiers or JSON pointers. Similarity, inferred edges,
   diagrams and prototypes do not establish confirmed requirements. If KAG
   is missing or stale, scoped file reads remain available and coverage is
   explicitly limited; development does not wait for an unnecessary rebuild.
4. Produces a concise task brief: outcome/non-goals, source checkpoint,
   relevant evidence, explicit decisions, unresolved assumptions and conflicts,
   normal/exceptional behavior, and observable acceptance checks. A schema
   describes structure, not authority; a generated or saved record is not
   automatically a human-confirmed decision. Critical unresolved choices go
   back to the user before implementation; reversible implementation details
   follow the user's actual delegation.
5. Implements only the authorized slice in the coding workspace and reports
   code/test evidence against those checks. It does not modify Design Files
   through ordinary coding tools to hide a mismatch. Design changes return to
   the owning Bundle's existing validated publication path after appropriate
   user direction.
6. Reports a discovered gap with the implicated source, observed behavior and
   proposed decision. After design revision, it refreshes the relevant brief
   against the new checkpoint and identifies which implementation or test
   must change. A persisted brief is a derived snapshot with provenance, not
   a second live authority or an instruction to write inside `design_files/`.

Handoff readiness is local to the requested task. It does not require a
perfect project-wide clarity score, all Bundles to be complete, or a GRA run
with no suggestions. Conversely, a high score does not waive a material
unknown. The receiving Host retains responsibility for coding permissions,
model access and its own implementation workflow.

The user installs one Design System integration for the chosen Agent Host. The DeepSeek Harness integration is the single `@yugoo-design/dsh-design-system-dsh` installation distribution (the sole source-package naming exception; internal package, Loader and service identities remain unchanged), represented to Harness as a Profile Bundle and distinct from a Design Bundle. Its six direct physical dependencies provide Core, Design Knowledge, Panel, Studio, the official Web App Kit content, and the trusted Web App provider. Its patch assembles eleven direct Cordis infrastructure rows: Core, Design Knowledge, Web App provider, Web App Kit loader, advisory scheduler, Bundle execution, panel Remote, panel, Studio inspection service, Studio page, and Studio authoring service. DeepSeek Harness discovers each package-root browser contribution through that package's own `dsh.client` declaration; the distribution does not compile a combined browser client or hide providers behind subpath facades. Future Codex and Claude integrations must use the same product kernel, Kit and Bundle definitions, Design Project service, validation and execution semantics, and shared Design UI through native plugin, Skill, hook, or MCP adapters. Where those clients cannot embed the UI, they must open the session-bound UI in an external browser while the CLI remains the primary conversation and development surface.

Kit packages declare their content through the host-neutral `designSystem.kit` manifest. They contain Mindset and Bundle resources, not Cordis patches, model providers, host adapters, or system plugin dependencies. Installing, importing, selecting, or removing a Web App, Game, or custom Kit cannot enable or disable grounding, reflection, alignment, Design Projects, execution, Studio, or panel services. Pure content Kits are discovered at runtime and never require a dependency or rebuild in Core, Panel, Studio, or the host integration.

Trusted providers are separate plugins. A server contribution may register one Bundle's execution, procedural validation, artifact production, model/tool capability, and native-presentation claims; a browser contribution registers the native Panel implementation. The registries resolve stable ids directly and never through a Kit-wide runtime pack. Each contribution is bound to a deployment-derived Bundle authority calculated from the trusted source identity and catalog Bundle name. That authority is not authored in `skill.yaml`, and every lookup checks both the referenced id and authority, so copied provider ids do not grant executable or native-Panel trust. The authority remains stable across content versions. The official host distribution may preinstall the official Web App Kit and providers for a one-install experience, while an additional provider is installed independently without changing generic packages.

Host deployment configuration is a later overlay over the installed integration. It may select model providers, credentials, budgets, storage locations, and other documented tunables; it does not reproduce the integration's plugin roster. The DSH adapter exposes the advisory runtime's registered profiles, current phase, last publication, and bounded last error through `/yugoo status`, so an incomplete installation cannot appear as an idle healthy scheduler.

A user creates a custom design method by authoring a Mindset and declarative Bundles. Adding or revising that content must not require editing generic core code, registering React components, or restarting Harness after saving the content. Custom native or agentic behavior requires a future reviewed extension mechanism and is not granted to ordinary content packages.

The authoring Studio uses the runtime's compiler, validation, renderer and interpreter. Its source editor saves current definitions; runtime Design File publication remains a separate operation. Preview and runtime consumption do not define a second Bundle format.

## Design Studio

The Design Studio is the authoring and management GUI for Kits, Mindsets, and the flat Bundle catalog. It is a first-class product surface of the installed integration, not a second runtime or a separate Bundle format. The Studio defaults to Kit-first and Mindset-centered: the Kit is the primary workspace, and each Kit's Mindset anchors its design method. The flat Bundle catalog remains the shared source of Bundle definitions; it serves Kit authoring rather than defining the Studio's primary surface.

The catalog maintains current saved Kit and Bundle content. Editing, copying and importing use the same source-instance service. Projects copy the selected current definitions once and subsequently use their own files. There is no local publication state, confirmation lock or version-switching workflow.

UI and Agent discovery share the current Kit choices, including saved local
imports. Installed-source inspection remains distinct: its absence cannot make
a local Kit unavailable. Discovery reads do not update an existing project's
Kit copy or add another persistent catalog.

Local Studio working-copy persistence has editor-level guarantees. The filesystem
adapter writes, syncs and closes a temporary file before atomic replacement. A
successful save is readable by another process or a reopened application;
process interruption exposes a complete old or new snapshot, write failures
are reported, and revision conflicts cannot silently overwrite newer edits.
An interrupted response requires reopening to determine whether the save
committed. This is not a power-loss durability claim: the latest save is not
guaranteed to survive power failure or an operating-system crash, and a single
record save is not a multi-record transaction. Platform adapters preserve these
semantics and the existing access/path checks without requiring identical Unix
permission bits or a database storage medium. Stronger platform-specific flush
behavior is not a prerequisite for this contract.

The optional `dsh-design-studio/node` entry supplies the shared filesystem-backed
snapshot and atomic working-copy adapters. Companion's original paths forward
to that implementation; another Host reuses those adapters rather than copying
the repository. The domain root remains independent of filesystem storage.
Native authoring receives only exact-revision read/prepare capabilities over
that same working copy. Candidate preparation, source save and native
turn completion remain separate results; the shared adapters do not establish
that any Host has connected or accepted the complete authoring loop.

The DSH native authoring adapter creates a restricted SDK child from the exact
live parent and inherits that parent's model route. Only the bound Studio
read/prepare capability enters its tools. Its native message consumption,
matching turn outcome, candidate receipt and witnessed reference retention are
separate observations. A session-bound Studio entry must use the Host's existing
agent-context lookup, rather than treating browser parameters as native authority.

Studio authoring opens as a complete workspace in an independent tab or browser.
Browsing retains product navigation and does not show a conversation. Creating
or editing a Kit or Bundle adds the bound Host conversation on the left of the
workspace, with the selected working copy's source or preview on the right.
Opening review, returning and explicitly saving preserve that conversation and
unsent input. Requests originating in the Host's main conversation lead to this
same standalone editor, either before or after preparing changes. Embedding
Studio inside the Host is outside this authoring flow; explicit legacy
content-only URLs remain a compatibility path. These entry choices do not change
the native parent, source ownership or save protocol. An exact current request opens its proposed
result directly in the content area without a separate review gate. File changes
use inline additions/removals in the existing source-file view, alongside the
ordinary preview choice; they do not add a separate changes panel. The current browser projection retains requests
and execution feedback witnessed while that editor is open; it does not claim
restored native conversation history.

The intended host-conversation and Studio entry points share the same exact
working copy, native binding, validation, preview and explicit-save boundaries.
Conversation transport must not introduce a second model client, transcript or
source authority. Full customization from both entry points remains an integration
goal; scoped native dispatch alone does not establish that capability.

The currently approved lightweight Studio layout has Kits and Bundles, with an
optional Component Library supplied by the host. The earlier five-area proposal
(Kits, Bundles, Test Lab, Projects, Activity) is superseded as a top-level UI
requirement by the accepted Studio iteration: trial execution stays inside the
selected Bundle, and storage/history concepts must not introduce unused sidebar
sections. Future project/activity capabilities require their own scoped design.
The Component Library reads the same compiled DSL catalog and shared renderer;
its synthetic previews grant no project writes, host execution, dynamic code
installation or publication. The copyable authoring Skill follows the existing
component extension contract. This layout decision is not evidence that every
host has wired or accepted the optional view.

The Kit Workspace preserves the shared Studio shell and uses Source Files and
Mount Management tabs. Source files are editable in the current-content editor.
Mount management shows available Bundles on the left and mounted Bundles on the
right; a binding follows the current library Bundle identity. Empty or incomplete
Kit authoring may be saved and completed later.

The Bundle workspace shares that editor, with Source Files and Panel Preview.
Save and Revert are global object actions. Panel Preview renders the current
`panel.yaml` and associated draft files; it is not a second save target. The source
view supports human editing and Git-style inline diff. Native Agent proposals
enter the same files, preview and explicit Save path. Validation diagnostics
explain why a preview or execution cannot proceed; they do not block preserving
unfinished source. Copy creates an independent object only when the user chooses it.

The Test Lab hosts the Custom Panel Lab: custom panel content is previewed through the same renderer and interpreter the runtime uses, against fixtures or live snapshots, on an isolated host port. A CLI fallback covers environments without an available browser surface.

The Projects area presents design knowledge for a selected Design Project. It will visualize Design Files, accepted assertions, and the grounding, reflection, and alignment graph through DesignKnowledgeService with its Ladybug provider. Those presentations are derived projections of authoritative state, not editing surfaces.

Import and export operate on complete content trees. Bundle import accepts ZIP,
folder or bare `SKILL.md`; missing companion files produce an incomplete-content
notice and can be completed through the ordinary editor and bound Host Agent.
Kit import requires `kit.yaml` and `mindset.md`. Identity collisions create a
renamed independent item. Export downloads ZIP directly; source/license fields
are not admission requirements. Existing files and notices are preserved. Path
integrity and actual read/parse failures remain concrete checks. Imported content
does not grant native provider authority. These operations do not publish npm.


The Studio can run as a route inside the local plugin or expose the same service API through a separate process. Both deployments use the same catalog, current-source persistence, compiler, preview and validation implementations. Search indexes and graph views are derived and rebuildable; they never become authorities for the Kit catalog.

## Alignment Workspace and advisories

The Alignment Workspace is the GUI for grounding, reflection, alignment, impact analysis, and their reviewable advisories. It combines graph exploration with an actionable findings inbox rather than exposing an uncurated database browser.

Advisories and human dispositions have explicit durable schemas and Design System journal records; they do not require host-specific conversation event types. Each advisory has stable identity, exact input revisions, bounded recommendations, and an attention policy. The review surface projects only the current useful set rather than a business-level suggestion history; journal facts remain an audit record. Human-review advice moves from pending to accepted, rejected, or deferred. Acceptance submits one ordinary, self-contained instruction to the main Agent, so no host needs an out-of-band advisory lookup; it is not permission for background analysis to mutate design state.

Kit-owned grounding declarations tell the profiles which Bundle records produce domain entities, references, requirements, evidence, and verification relationships. The generic runtime executes those declarations without Bundle-name branches. Reflection and impact analysis are addressed through their exact input pins and discard stale results when their inputs change during analysis.

The same advisory model applies at two levels. Runtime profiles examine the software product being designed. Studio profiles examine the evidence, compatibility, dependencies, validation coverage, and internal consistency of Mindsets, Bundles, and Kits themselves. Accepted Studio advice uses ordinary source editing and saving. It does not update existing projects' own definition files implicitly.

## Acceptance invariants

The architecture is preserved only when all of the following remain true:

- One installation for a selected Agent Host provides the generic runtime and official Kit behavior without installing Kits or Bundles separately.
- The Agent Host remains the primary conversation and development surface; a companion Design UI never becomes a second general-purpose Agent client.
- Embedded, inline, and companion presentations use one shared Design UI and preserve the same design-session identity and state semantics.
- Every design operation resolves an explicitly selected Design Project; an Agent Host working directory never selects or identifies a project implicitly.
- Every managed Design Project is an independent Git repository whose root `project.json` identifies the project and selected Kit; initialized Kit and Bundle definitions belong to the project's `design_kit/` tree.
- Bundle state and its artifacts remain together under that Bundle's `design_files/` directory; there is no project-level artifact directory.
- Successful validated operations create project checkpoints, while session state, handoffs, locks, and transient working copies remain outside project Git history.
- Host adapters change transport, lifecycle, tool registration, and presentation only; they do not fork Kit, Bundle, validation, Design File, Studio, or DesignGraph behavior.
- Every host injects the Design Core before the selected Kit Mindset; selected Bundle instructions reach only the resolved invocation executor, with reconstruction using the output contract instead.
- Main and subagent placement preserve the same scoped capabilities, Worker ownership, output contract and settlement; validation diagnostics return to the responsible executor or exact artifact Worker for repair.
- The main Agent reads committed Design Files and inspects project status, diff and history through the shared read-only Git capability; it grants no write or publication authority. Only an active Bundle's scoped Design capabilities may modify or publish Design Files.
- Automatic Grounding, reflection, and alignment run in the background without making the foreground conversation wait. When non-blocking background execution is unavailable, the user chooses between disabling automatic review while retaining manual review and explicitly running the requested batch in the foreground; there is no automatic synchronous fallback or policy change without that choice.
- Ordinary advice is injected without waking an idle Agent; only an authenticated human acceptance may submit a normal prompt that wakes it.
- Alignment advice never writes or routes Question state; after acceptance, the main Agent chooses a suitable active-Kit Bundle, host-native questioning, or no action. Optional review-support hints are neither an exclusive binding nor execution authority.
- Advisory runtime capability negotiation distinguishes guaranteed detached execution, cooperative background execution, explicitly configured standalone execution, and an unavailable queue; foreground Bundle execution is always attached and never enters this fallback ladder.
- Every background run pins its authoritative inputs, and a result from stale inputs cannot modify the current design.
- Background results return as bounded, durable reminders, suggestions, or review requests; full worker transcripts do not flood the main conversation.
- Generic server and client code do not dispatch on official Bundle names.
- Generic Core, Panel, and Studio packages do not import or depend on a concrete Kit or provider.
- Adding a pure content Kit changes only the catalog; it does not change package dependencies or compiled output.
- Every interactive Bundle explicitly selects native, declarative or auto presentation; omitted presentation and explicit none both mean no panel.
- A Bundle using native presentation cannot fall back to declarative rendering.
- A declarative Bundle can be added with content alone and survives save, reopen, project reload and cross-panel references.
- A project's Kit and mounted Bundle files remain independent of later catalog saves or removals.
- A Kit binding cannot mutate the referenced Bundle's schema, validation, presentation, or executable behavior.
- Studio and runtime share definition compilation, validation and rendering. Studio source saves and runtime Design File publication keep their distinct persistence responsibilities.
- Execution metadata has real runtime consumers; agentic or handoff behavior is never simulated only by prose.
- Semantic validation runs before authoritative persistence and inside the selected executor's lifecycle.
- Active sessions resolve their project's Kit files, including model-visible resources and behavior identifiers.
- Model-visible state, decisions, clarity, and advisories are replayable from durable inputs.
- The DesignGraph is evidence-addressed, provider-replaceable, and rebuildable from authoritative state.
- The DesignGraph contains durable product and rationale knowledge, not a duplicate execution log or hidden Agent reasoning.
- Every decision records its authority state; Agent autonomy never implies human confirmation.
- Reflection and alignment propose changes but cannot bypass human authority or the validated write path.

## Open decisions

The following choices remain open and must not be implied by implementation convenience:

- removal of the experimental qualifier from the selected local Ladybug WASM provider after shared conformance and real platform acceptance, and any future remote-provider deployment;
- the graph projection declaration format for declarative Bundles;
- garbage collection for unreferenced internal source snapshots; snapshots are storage details, not a local version catalog;
- the retention and recoverable repair policy for interrupted dirty Design Project work trees;
- the public extension model, if any, for third-party trusted native panels or Producer contributions;


### Product entry naming

The public product name is **Yugoo Design**, the host plugin/suite ID is
`yugoo-design`, and the daily entry is `yugoo`. Use each host's native syntax:
DSH `/yugoo`, Codex's `yugoo` Skill picker, and plugin-qualified entries where
required. `yugoo` is the sole public project entry. Neither DSH nor Companion
registers `design` as a command, entry Skill or compatibility alias, even when
that name is unoccupied. Other plugins' commands remain untouched; a conflict
on `yugoo` fails registration rather than falling back to another name.
This naming change does not rename domain tools, project identities, state paths,
MCP server keys, DSH Cordis/package identities or the existing terminal installer.
Old owned installation receipts remain recoverable/uninstallable. A legacy and
renamed plugin must not both activate the same Hooks or MCP tools.
