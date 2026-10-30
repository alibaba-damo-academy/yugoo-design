# Contributor and coding-agent entry

## Start with the owning contract

Read the relevant parts of [the architecture baseline](docs/system-design-baseline.md)
and the owning package's README before changing a cross-layer contract. For Bundle
work, read [the Bundle contract](docs/bundle-contract.md), [the DSL](docs/dsl-spec.md)
and the relevant authoring skill under `.agents/skills/`. Treat documented plans
as plans: confirm implemented behavior in source and focused tests.

- `packages/core`: host-neutral project, validation and execution semantics.
- `packages/panel`: shared presentation, declarative interpreter and UI primitives.
- `packages/skills-*`: domain methods, schemas, examples and declarations.
- `packages/provider-*`: explicitly trusted executable/native contributions.
- `packages/companion`, `packages/dsh`, `packages/studio-dsh`: host integration.
- `packages/studio`, `packages/studio-ui`: shared authoring domain and UI.

Do not hard-code a Bundle name in a shared layer to repair one Bundle. Reuse
existing save, validation, publication and host adapters rather than creating
parallel authorities. A graph and its detail form edit the same canonical data.
Panel changes should reuse shared components/styles and preserve existing native
behavior. All Kits share one Panel foundation: sidebar/tree navigation, content
frames, typography, spacing, controls, and reading/editing/add/delete/disclosure
patterns. Maintain its base presentation in
`packages/panel/src/visual-components.css` and its behavior in the shared
components; no Kit-specific base stylesheet, copied control or CSS override.
Host chrome, theme resources and specialist canvas assets have separate owners,
but must not redefine the Kit's ordinary navigation or form foundation.
Bundle authors declare business objects, relationships, fields, ordering and
supported view choices. They do not tune fonts, gutters or basic action geometry,
or reconstruct shared interactions from low-level components. A missing reusable
pattern is a shared component gap, not permission for a local styling workaround.
Fix defaults at their owning definitions and remove superseded selectors. Reuse
unchanged evidence and check affected representative views across Kits, without
turning every content edit into a UI redesign or full-product audit. Choosing
useful information and a readable organization remains the Bundle author's duty.
React 18 is the current UI compatibility boundary.

For Panel, Studio or A2UI/DSL presentation work, read the shared
[Panel UIUX standard](docs/panel-uiux-standard.md). Choose a visual expression
from the user's decision and real data before selecting components. Reuse
semantic tokens, controls and state feedback; distinguish common defaults from
confirmed scene-specific baselines. The standard is authoring/review guidance,
not another DSL schema or proof of runtime conformance. Update it when a shared
interaction decision changes, and verify the affected representative view.

Panel UX must help people understand, think, express intent and align with AI.
For new, revised or migrated Panels, answer the standard's
[Panel self-review questions](docs/panel-uiux-standard.md#面板自查): does the
representation aid understanding and judgment; are interactions convenient and
familiar; do information density and organization support human rewriting; can
people see how their changes affect the design? Review a representative reading
and editing path, not only field coverage. Multiple internal tabs are discouraged
by default; do not turn storage sections into navigation. Justify necessary task
or view switches and preserve context. Keep findings in the existing work record;
this adds no separate approval stage or full-product test requirement.

Every independently editable Panel field must serve a concrete user purpose.
Explain who supplies or confirms it, which decision it informs or how it is used
later, and why an existing field cannot express the same fact. Schema presence or
a generic "design rationale" label is not sufficient. This applies to every
Bundle in every Kit: consolidate ordinary pending questions, assumptions,
rationale and source explanations into the object's optional remarks. Do not
add a generic "pending questions and evidence" section, split remarks into
several inputs, or merely rename such a field cluster. Keep uncertainty explicit
in the remarks without requiring a separate field for it. Independent business
rules, constraints, and purpose-built question/answer or evidence artifacts keep
their own meaningful controls. Present derived values and technical provenance
as readable context when useful rather than asking users to re-enter them.
Apply the [field-value guidance](docs/panel-uiux-standard.md#独立填写字段的价值)
when simplifying existing Panels: preserve user content, source references and
canonical semantics, and update methods/contracts if those semantics change.

For a Bundle with a canvas, follow the [canvas authoring convention](.agents/skills/design-bundle-creator/references/canvas-authoring.md).
Use its own `reference/canvas-guide.md` as the discoverable method entry, reachable
from both `SKILL.md` and the readable output contract. Standardize file ownership,
method coverage and verification, not the graph type or domain visual language.
Preserve and index existing specialized guides; do not create placeholder guides
for non-canvas Bundles or add a new loader requirement.

Keep Bundle capability descriptions in `SKILL.md` frontmatter, not a second
`skill.yaml` description. Optional translated picker copy belongs in the existing
panel locale resources (`bundleDescription`), not another routing authority.
Declarative manifests need `presentation.mode`, not
the fixed interpreter id; native renderer ids remain explicit. Simplifying
metadata must not trim domain methods or output contracts. Verify loaded
descriptions, execution policy, panel and summary parity after such changes.

Skill Body authoring follows the required questions in
`.agents/skills/design-skill-creator/references/standards.md`, not mandatory
chapter names or separate forward/reconstruction chapters. Explain domain
evidence and the differences between proposing a design, restoring observed
behavior and revising saved facts. Output contracts do not replace professional
methods. Shared critical constraints must remain Bundle-reachable from both
execution entry points; repository guidance is not installed runtime input.
Before reorganizing existing methods, provide a retention mapping for principles,
domain reasoning, failure handling and protocols. Only duplicated runtime
protocols may move to an existing system injection after verifying the actual
host, execution mode and phase coverage. Unverified protocols stay in place;
never delete methods under the label of standardization.
Retention does not justify conflicting executable instructions. Identify the old
statement and current owning contract, obtain direction where scope is unclear,
and record the authorized correction or supersession in the retention mapping;
never silently delete the conflict or present it as a current requirement.

When a Bundle needs cross-Bundle fact alignment or supplements, follow the
[cooperation authoring convention](.agents/skills/design-bundle-creator/references/cooperation-authoring.md).
Use the conditional `reference/cooperation-guide.md` content location and link it
from both the method and output contract. Fill only actual domain needs; this is
not a required loader slot, universal workflow or permission to write other
Bundles. The caller coordinates authorized target-owner invocations using the
existing validation, publication and handoff boundaries.

KAG tracks independent native design sources and artifacts. PRD/spec assemblies
and model-facing state summaries are derived, not independent knowledge sources.
For declarative Bundles, author optional summary rules in `skill.yaml.summary`,
not a separate `renderer.md`. Summary absence must not gate execution or Panel
save; explicit invalid rules still fail validation. Preserve summary semantics
and useful comments when migrating existing declarations.
Preserve source references, user-owned fields and project-owned definitions.
Studio library content has one current saved state; projects use their own complete
Kit and Bundle files. Library edits do not silently replace an existing project's
definitions. Upstream version metadata is provenance, not a local release gate.

## Apply Occam's razor

Choose the smallest mechanism that solves the user's present task. Reuse existing
file editing, save, validation, host adapters and native Agent capabilities before
adding another workflow, state machine, permission layer or version system.
Comparison, customization and updating project definitions can be ordinary Agent
work; do not build an orchestration system merely to automate that judgment.

New restrictions or confirmation steps must address a concrete failure or an
explicit user requirement, not hypothetical future cases. Let people and Agents
save unfinished authoring work and correct it in place. Report actual parsing or
execution problems where they occur; do not require unrelated publication,
version upgrades or remounting to make a saved local edit usable. Preserve atomic
saves, user data and meaningful conflict/error detection.

When simplifying, remove superseded implementations, states and UI together
instead of layering another workaround over them. Keep internal consistency
tokens and technical provenance out of ordinary user decisions. Apply this
principle in the existing implementation and review process; it adds no new
approval stage or separate checklist.

## Work safely and in parallel

Check `git status` first. Existing uncommitted changes are not yours to discard or
include in a commit. Use a separate branch/worktree for concurrent implementation;
agree shared-file ownership and integrate fixed commits deliberately. When using
Chatroom, follow `.agents/skills/agent-comms/SKILL.md` and keep the existing ledger
accurate. Close a task only for its stated verified outcome, not an acknowledgement.

Keep test projects, runtime state, ports and outputs isolated. A temporary
`DSH_HOME` does not by itself isolate DesignService storage or Electron userData.
Do not change real user profiles, authentication or installed plugins without
explicit scope/authorization. Existing authorization remains valid within its
stated scope; do not repeatedly ask for the same permission. Native hosts own model access and credentials;
do not introduce a second model client to simulate a successful host integration.

Check disk capacity before large builds/copies. Reuse unchanged artifacts and
read-only dependencies where safe; do not repeatedly copy node_modules or entire
release trees. Keep bounded evidence and an explicit cleanup list. Stop only owned
processes; never broadly delete evidence, profiles or workspaces to free space.

Keep durable documentation at its maintained source and task receipts in
task-scoped storage. Group temporary worktrees and extra generated copies by
task, with an owner, consumers and cleanup conditions in the existing work
record; avoid a general artifact directory becoming a second document home.
Preserve referenced immutable inputs and meaningful failures. Task completion
does not authorize deleting another task's dependencies or user state.
Private workstation locations belong in internal maintainer guidance rather
than exported product instructions.

## Verify the claimed result

Use the Node/package-manager versions declared in `package.json` and the checked-in
lockfile. Consult package scripts rather than guessing commands. Build dependencies
before tests that consume `lib`; source-alias checks must be reported as such.
Start with the smallest relevant regression/typecheck/build, then add integration
or real UI/host checks when the change requires them. Do not repeat the full
automated product suite for an unrelated documentation or local presentation
change; the required Agentic E2E check below has its own completion rules.

Report compilation, rendered interaction, durable save/reopen, native-agent
consumption and installed-package validation separately. A fixture or probe proves
only its tested boundary. Preserve meaningful negative tests; do not remove a
guard simply to make tests pass. Document untested behavior and concrete failures.

### Required UI and UX walkthrough

For user-facing UI changes, operate the affected flow in a real browser before
handoff, using the 9222 Chrome session when available. Confirm that it loads the
current implementation. Check both functional correctness and whether the
interface and interaction make sense: can users find the entry, understand each
action, finish without unnecessary decisions or internal terminology, and see
the result? Exercise relevant success, error, cancellation and retry states;
check that navigation preserves user input. Inspect the rendered screen for
missing styles, hierarchy, spacing, alignment, readable feedback and usable
controls, using DOM/computed styles to diagnose defects. Code review, compilation,
API tests and DOM assertions do not replace this hands-on visual walkthrough.
UX skills can guide it but must respect the established shared UI foundation.
For public Panel components, verify the catalog's actual example composition,
including record selection and reaching the end of long content by scrolling.
Registration, valid DSL and static markup alone do not establish a usable
component. Remove superseded implementations and their authoring examples
together; keep ordinary navigation and scrolling in the shared workspace.
Follow the maintained [UIUX walkthrough loop](docs/testing/agentic-e2e.md#uiux-实际操作闭环)
and record functional and UIUX results separately.
Fix obvious visual or interaction defects and recheck the affected path before
claiming completion. Record the actual path, findings and untested boundaries in
the existing work record; if browser access is blocked, report that gap instead
of claiming UI acceptance. Keep this scoped to the changed flow, without adding
a user approval stage or repeating unrelated full-product tests.

Before implementation, identify the existing interaction and shared component
that owns the change. Preserve confirmed entry points, navigation, button order,
feedback and draft retention; compare the affected view before and after an
integration so an older implementation cannot silently replace them. Studio
feedback follows the standard's [feedback mapping](docs/panel-uiux-standard.md#studio-信息反馈).
Do not append bare diagnostics, native-looking controls or a new ad hoc modal
to finish a feature. Missing shared behavior is fixed at its owner.

The implementing agent owns basic usability acceptance. A missing style,
inaccessible action, conflicting/duplicated status, unexplained disabled action,
lost input or failure without a recovery path fails the affected UIUX checkpoint,
even when its API passes. Human product feedback does not substitute for this
check. On a repeated defect, record the root cause and why existing checks missed
it; fix the shared cause, add an appropriate regression at that boundary and
revisit the original visible path plus one affected shared use. Update the
existing standard or playbook when the decision generalizes, replacing obsolete
guidance instead of accumulating one-off rules. Mechanical checks catch specific
regressions; they do not certify the whole experience.

### Required Agentic E2E check

Before every development handoff, complete the maintained
[Agentic E2E playbook](docs/testing/agentic-e2e.md) and record the result of all
three chains: a new design task covering QA, research, functions, flows,
execution/handoffs, recommendations and UST/KAG/GRA; migration of the existing
example followed by fresh UST/KAG/GRA; and Studio Kit/Bundle creation, editing,
saved-content consumption, project-copy isolation and import/export. Use a real native Host Agent. Browser
automation acts as the user, not as a replacement author of the Agent's files.
Compilation, unit tests, fixture outputs and an opened page do not satisfy this
check. Report failed, blocked and unrun checkpoints explicitly; do not close a
broader acceptance claim with partial results or silently remove an unavailable
capability. Evidence reuse must follow the playbook's unchanged-input rules.

After each product release, verify both a clean installation from the actual npm
registry and an upgrade from the previous stable npm version. In addition, rerun
at least one complete playbook chain in a verified installed environment. Select
the chain and environment before execution, prioritizing changed/high-risk paths;
use recorded rotation or reproducible sampling when risks are equal. Keep these
post-release results separate from candidate tests and publication success.

Maintain the playbook in the same change whenever entry points, execution policy,
handoffs, migration, authoring or installation behavior changes. Keep per-run
evidence in the existing task record, not another maintained copy of the playbook.

## Reader-focused documentation

Write for the reader's task, not the history of producing the document. README
introduces purpose, capabilities and a usable starting path; user guides explain
actions and expected results; technical references explain responsibilities,
interfaces and mechanisms. Keep internal planning, editing notes and test logs
in maintenance or historical records, not normal usage steps. Explain necessary
limits beside the relevant capability, without repeating defensive disclaimers.
Preserve substantive methods, examples, screenshots and precise contracts when
improving readability. Check whether a new reader can understand and act on the
instructions, not only whether all topics and links exist. These principles also
guide the documentation produced or revised by authoring skills. This is a
documentation principle, not authorization to change runtime behavior, execution
workflows, ownership, validation or other technical contracts.

## Delivery boundaries

Follow the Wiki [naming and translation standard](docs/wiki/terminology.md)
for product copy and documentation. Chinese documents introduce the product as
语构设计系统（Yugoo Design） and pair Chinese terminology with its English name.
Keep executable commands, package names and protocol identifiers exact.

Public-facing README, Wiki, contribution and security guidance have one maintained
source at their formal paths in this development repository. Update the
[document sync contract](docs/public-document-sync.md) and existing export
classification when that boundary changes. Current public document exports
preserve their paths and bytes; internal plans and retained historical drafts
remain excluded. Verify local links/anchors and fixed-source parity before
synchronization. Do not restore a second public README authority.
Maintain complete Chinese and English README versions with corresponding
chapters, capabilities, examples and status. Before restructuring, map original
ideas to their retained destinations; verify content retention as well as links.
Include screenshots and their purpose in that mapping. Preserve the depicted
workflow and relevant interface context; a business artifact alone does not
replace a screenshot showing conversation and Panel interaction.

This repository is the internal development source. The public `yugoo-design`
tree is a reviewed export of a fixed main-branch commit, using the existing export
tools and policy; do not edit it as a second development source. New files require
classification under the existing export policy and normal maintainer review,
not a new per-file user-approval gate. See [contribution/release guidance](CONTRIBUTING.md).
Preserve native-reference implementations, provenance and third-party notices.
Apache-2.0 project licensing does not override a dependency's or imported Kit's
license. Source commits, public-source synchronization, npm packaging and publishing
are distinct operations; do not claim or perform one merely because another passed.

All official npm packages are published only by GitHub Actions from reviewed
public `main` history and a matching release tag. Local development, testing,
building and `npm pack` are allowed; direct local `npm publish` is prohibited.
The separate DSH chain uses the same Actions-only boundary. Do not substitute
a local publisher, token or account change for a missing workflow/OIDC setup.
